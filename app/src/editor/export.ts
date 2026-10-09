/* Export: the helper renders the exact slide DOM in a headless browser. When no engine works
   (blocked by policy), slides are rendered in this window (SVG foreignObject → JPEG) and the helper
   only assembles the PDF. */
import { get, hideBusy, patch, showBusy, toast } from "../state/store";
import { ctx, setPrefs, slidesFor, style } from "../state/app";
import { resolveStyle } from "../model/style";
import type { RenderCtx } from "../render/context";
import type { Design } from "../model/types";
import { openInstaller } from "../state/dialogs";
import { backend, ApiError, type ExportRes } from "../sync/api";
import { buildSlide } from "../render/slide";
import { esc } from "../xlsx/util";
import { embeddedFontCss } from "../state/fonts";
import { PRINT_CSS, printReady } from "../render/printcss";

export type ExportKind = "pdf" | "pdf-exact" | "pdf-vector" | "pdf-current" | "png-current" | "png-all" | "copy";

const toDataUrl = async (url: string) => { const b = await (await fetch(url)).blob(); return await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(b); }); };
const slideCss = () => [document.getElementById("slidecss")?.textContent || "", document.getElementById("wallcss")?.textContent || ""].join("\n");

/** the exact slide DOM + slide CSS, self-contained (pictures and logo as data URLs) */
async function exportPayload(idx: number[], base: RenderCtx = ctx(), vector = false) {
  const c = { ...base, forExport: true }, slides: string[] = [], src = slidesFor(base.style.design);
  for (const i of idx) {
    const s = buildSlide(src[i], i, c);
    s.querySelectorAll(".pic.missing").forEach(e => e.remove());
    for (const img of Array.from(s.querySelectorAll<HTMLImageElement>("img.logo"))) { try { img.setAttribute("src", await toDataUrl(img.src)); } catch { img.parentNode && (img.parentNode as HTMLElement).remove(); } }
    slides.push(vector ? printReady(s.outerHTML) : s.outerHTML);
  }
  // text & tables: shadows and fonts the PDF can draw as vector (no pictures, no glyph-by-glyph fonts)
  return { css: (vector ? printReady(slideCss()) + "\n" + PRINT_CSS : slideCss()) + "\n" + await embeddedFontCss(slides.join("")), slides, names: idx.map(i => get().deck.slides[i].label) };
}

async function clientRender(i: number, scale: number, type: string, base: RenderCtx = ctx()): Promise<string> {
  const c = { ...base, forExport: true };
  const slide = buildSlide(slidesFor(base.style.design)[i], i, c);
  slide.querySelectorAll(".pic.missing").forEach(e => e.remove());
  for (const img of Array.from(slide.querySelectorAll<HTMLImageElement>("img.logo"))) { try { img.src = await toDataUrl(img.src); } catch { img.parentNode && (img.parentNode as HTMLElement).remove(); } }
  const xml = new XMLSerializer().serializeToString(slide);
  // the same CSS the export engine gets (slide styles only – the app's own styles must not reach the
  // slide), fonts as data URLs (an SVG image cannot load the helper's font files); escaped, because the
  // SVG is XML: a "<" or "&" in the CSS (the wallpaper is an inline SVG) made the whole picture fail
  const css = (slideCss() + "\n" + await embeddedFontCss(xml)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${1600 * scale}" height="${900 * scale}" viewBox="0 0 1600 900"><foreignObject x="0" y="0" width="1600" height="900"><div xmlns="http://www.w3.org/1999/xhtml" style="width:1600px;height:900px;margin:0;overflow:hidden"><style>${css}</style>${xml}</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("render failed")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const cv = document.createElement("canvas"); cv.width = 1600 * scale; cv.height = 900 * scale;
  const x = cv.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL(type, .95);
}
async function exportInWindow(format: "pdf" | "png", idx: number[], inline: boolean, base: RenderCtx = ctx(), name = get().deck.file!.name): Promise<ExportRes & { downloaded?: boolean }> {
  const scale = 3;
  if (format === "pdf") {
    const images: string[] = []; for (const i of idx) images.push(await clientRender(i, scale, "image/jpeg", base));
    return backend.assemble(name, images);
  }
  const png = await clientRender(idx[0], scale, "image/png");
  if (inline) return { ok: true, images: [png] };
  const a = document.createElement("a"); a.href = png; a.download = name.replace(/\.[^.]+$/, "") + " - " + get().deck.slides[idx[0]].label + ".png"; a.click();
  return { ok: true, files: [], downloaded: true };
}

export async function doExport(kind: ExportKind) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file) return;
  if (!backend.served) { toast("Exports run through the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return; }
  if (file.src === "local") { toast("This workbook was opened without the helper. Open it again from the Open menu.", [], true); return; }
  if (get().ui.exporting) return;
  patch("ui", { exporting: true });
  try {
    await get().doc.sync?.flush();
    // PDFs are text and tables (vector) unless pictures of the slides are asked for explicitly
    const pdfMode = get().prefs.prefs.pdfMode || "vector";
    const all = get().deck.slides.map((_, i) => i);
    const spec = {
      "pdf": { format: "pdf", mode: pdfMode, idx: all }, "pdf-exact": { format: "pdf", mode: "exact", idx: all }, "pdf-vector": { format: "pdf", mode: "vector", idx: all },
      "pdf-current": { format: "pdf", mode: pdfMode, idx: [get().deck.cur] }, "png-current": { format: "png", idx: [get().deck.cur] }, "png-all": { format: "png", idx: all }, "copy": { format: "png", idx: [get().deck.cur], inline: true },
    }[kind] as { format: "pdf" | "png"; mode?: "exact" | "vector"; idx: number[]; inline?: boolean };
    if (kind === "pdf-exact" || kind === "pdf-vector") setPrefs({ pdfMode: spec.mode });
    let j: (ExportRes & { downloaded?: boolean }) | null = null, fallback = false, note = "";
    const usable = get().ui.health?.engine?.state === "ready";      // while engines are still being tested, don't wait: render here
    if (usable) {
      try { j = await backend.exportSlides({ name: file.name, format: spec.format, mode: spec.mode, scale: spec.format === "pdf" ? 4 : 3, inline: spec.inline, all: spec.idx.length === get().deck.slides.length && spec.idx.length > 1, ...(await exportPayload(spec.idx, ctx(), spec.format === "pdf" && spec.mode !== "exact")) }); }
      catch (e) { if ((e instanceof ApiError && (e.status === 503 || e.status === 0)) || e instanceof TypeError) { fallback = true; console.warn(e); } else throw e; }
    } else fallback = true;
    if (fallback) { j = await exportInWindow(spec.format, spec.idx, !!spec.inline); note = " · rendered in the app window"; }
    if (!j) return;
    if (j.downloaded) { toast("PNG downloaded (rendered in this window)."); return; }
    if (kind === "copy") {
      const blob = await (await fetch(j.images![0])).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Slide copied as a high-resolution image: paste it into PowerPoint.");
      return;
    }
    const f = j.files![0];
    const acts = [{ label: "Open", fn: () => { void backend.open({ name: f }); } }, { label: "Show folder", fn: () => { void backend.open({ folder: true }); } }];
    if (fallback && get().ui.health?.engine?.state !== "starting") acts.push({ label: "Install export engine", fn: openInstaller });
    toast(`Saved <b>${esc(j.files!.join(", "))}</b> in the export folder` + (j.seconds ? ` · ${j.seconds}s` : "") + (j.engine ? ` · ${esc(j.engine)}` : "") + note, acts);
  } catch (e) { console.error(e); toast("⚠ Export failed: " + esc((e as Error).message || e), [], true); }
  finally { patch("ui", { exporting: false }); }
}

/* ---- every version (wizard › Versions), in the current design or in several designs: one PDF each,
   named "<workbook> - <version> - <design>" ---- */
const DESIGN_LABEL: Record<Design, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined" };
export async function exportVersions(designs: Design[] | null) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file || get().ui.exporting) return;
  if (!backend.served) { toast("Exports run through the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return; }
  const versions = get().doc.view?.preset?.versions || [];
  if (!versions.length) { toast("No versions yet: open the ✦ Wizard › 4 · Versions to create them (e.g. Chief and All)."); return; }
  patch("ui", { exporting: true });
  const done: string[] = [], stem = file.name.replace(/\.[^.]+$/, ""), all = get().deck.slides.map((_, i) => i);
  try {
    await get().doc.sync?.flush();
    for (const d of designs || [style().design]) {
      for (const v of versions) {
        const base: RenderCtx = { ...ctx(), style: resolveStyle(get().doc.config.defaults.style, { ...(get().doc.view?.style || {}), design: d }), version: v };
        const name = `${stem} - ${v.name}${designs ? " - " + DESIGN_LABEL[d] : ""}.xlsx`;
        let j: ExportRes | null = null;
        if (get().ui.health?.engine?.state === "ready") {
          try { j = await backend.exportSlides({ name, format: "pdf", mode: get().prefs.prefs.pdfMode || "vector", scale: 4, all: true, ...(await exportPayload(all, base, (get().prefs.prefs.pdfMode || "vector") === "vector")) }); }
          catch (e) { if (!((e instanceof ApiError && (e.status === 503 || e.status === 0)) || e instanceof TypeError)) throw e; }
        }
        if (!j) j = await exportInWindow("pdf", all, false, base, name);
        done.push(...(j.files || []));
        showBusy(`Exported ${done.length} of ${versions.length * (designs || [0]).length}…`, done.length / (versions.length * (designs || [0]).length));
      }
    }
    hideBusy();
    toast(`Saved <b>${done.length}</b> PDFs in the export folder: ${esc(done.join(", "))}`, [{ label: "Show folder", fn: () => { void backend.open({ folder: true }); } }]);
  } catch (e) { console.error(e); hideBusy(); toast("⚠ Export failed: " + esc((e as Error).message || e), [], true); }
  finally { patch("ui", { exporting: false }); }
}
