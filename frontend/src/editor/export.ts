/* Export: the helper renders the exact slide DOM in a headless browser. When no engine works
   (blocked by policy), slides are rendered in this window (SVG foreignObject → JPEG) and the helper
   only assembles the PDF. */
import { S, emit, toast } from "../state/store";
import { ctx, setPrefs } from "../state/app";
import { openInstaller } from "../state/dialogs";
import { backend, ApiError, type ExportRes } from "../sync/api";
import { buildSlide } from "../render/slide";
import { esc } from "../xlsx/util";

export type ExportKind = "pdf" | "pdf-exact" | "pdf-vector" | "pdf-current" | "png-current" | "png-all" | "copy";

const toDataUrl = async (url: string) => { const b = await (await fetch(url)).blob(); return await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(b); }); };
const slideCss = () => [document.getElementById("slidecss")?.textContent || "", document.getElementById("wallcss")?.textContent || ""].join("\n");

/** the exact slide DOM + slide CSS, self-contained (pictures and logo as data URLs) */
async function exportPayload(idx: number[]) {
  const c = { ...ctx(), forExport: true }, slides: string[] = [];
  for (const i of idx) {
    const s = buildSlide(S.slides[i], i, c);
    s.querySelectorAll(".pic.missing").forEach(e => e.remove());
    for (const img of Array.from(s.querySelectorAll<HTMLImageElement>("img.logo"))) { try { img.setAttribute("src", await toDataUrl(img.src)); } catch { img.parentNode && (img.parentNode as HTMLElement).remove(); } }
    slides.push(s.outerHTML);
  }
  return { css: slideCss(), slides, names: idx.map(i => S.slides[i].label) };
}

async function clientRender(i: number, scale: number, type: string): Promise<string> {
  const c = { ...ctx(), forExport: true };
  const slide = buildSlide(S.slides[i], i, c);
  slide.querySelectorAll(".pic.missing").forEach(e => e.remove());
  for (const img of Array.from(slide.querySelectorAll<HTMLImageElement>("img.logo"))) { try { img.src = await toDataUrl(img.src); } catch { img.parentNode && (img.parentNode as HTMLElement).remove(); } }
  const css = Array.from(document.querySelectorAll("style")).map(s => s.textContent).join("\n");
  const xml = new XMLSerializer().serializeToString(slide);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${1600 * scale}" height="${900 * scale}" viewBox="0 0 1600 900"><foreignObject x="0" y="0" width="1600" height="900"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xml}</div></foreignObject></svg>`;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("render failed")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const cv = document.createElement("canvas"); cv.width = 1600 * scale; cv.height = 900 * scale;
  const x = cv.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL(type, .95);
}
async function exportInWindow(format: "pdf" | "png", idx: number[], inline: boolean): Promise<ExportRes & { downloaded?: boolean }> {
  const scale = 3, name = S.file!.name;
  if (format === "pdf") {
    const images: string[] = []; for (const i of idx) images.push(await clientRender(i, scale, "image/jpeg"));
    return backend.assemble(name, images);
  }
  const png = await clientRender(idx[0], scale, "image/png");
  if (inline) return { ok: true, images: [png] };
  const a = document.createElement("a"); a.href = png; a.download = name.replace(/\.[^.]+$/, "") + " - " + S.slides[idx[0]].label + ".png"; a.click();
  return { ok: true, files: [], downloaded: true };
}

export async function doExport(kind: ExportKind) {
  if (!S.slides.length || !S.file) return;
  if (!backend.served) { toast("Exports run through the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return; }
  if (S.file.src === "local") { toast("This workbook was opened without the helper. Open it again from the Open menu.", [], true); return; }
  if (S.exporting) return;
  S.exporting = true; emit();
  try {
    await S.sync?.flush();
    const pdfMode = S.prefs.pdfMode || "exact";
    const all = S.slides.map((_, i) => i);
    const spec = {
      "pdf": { format: "pdf", mode: pdfMode, idx: all }, "pdf-exact": { format: "pdf", mode: "exact", idx: all }, "pdf-vector": { format: "pdf", mode: "vector", idx: all },
      "pdf-current": { format: "pdf", mode: "exact", idx: [S.cur] }, "png-current": { format: "png", idx: [S.cur] }, "png-all": { format: "png", idx: all }, "copy": { format: "png", idx: [S.cur], inline: true },
    }[kind] as { format: "pdf" | "png"; mode?: "exact" | "vector"; idx: number[]; inline?: boolean };
    if (kind === "pdf-exact" || kind === "pdf-vector") setPrefs({ pdfMode: spec.mode });
    let j: (ExportRes & { downloaded?: boolean }) | null = null, fallback = false, note = "";
    const usable = S.health?.engine?.state === "ready";      // while engines are still being tested, don't wait: render here
    if (usable) {
      try { j = await backend.exportSlides({ name: S.file.name, format: spec.format, mode: spec.mode, scale: 3, inline: spec.inline, all: spec.idx.length === S.slides.length && spec.idx.length > 1, ...(await exportPayload(spec.idx)) }); }
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
    if (fallback && S.health?.engine?.state !== "starting") acts.push({ label: "Install export engine", fn: openInstaller });
    toast(`Saved <b>${esc(j.files!.join(", "))}</b> in the export folder` + (j.seconds ? ` · ${j.seconds}s` : "") + (j.engine ? ` · ${esc(j.engine)}` : "") + note, acts);
  } catch (e) { console.error(e); toast("⚠ Export failed: " + esc((e as Error).message || e), [], true); }
  finally { S.exporting = false; emit(); }
}
