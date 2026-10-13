/* Export (PLAN S3.7, Part B §4): the slides' display lists, built by the core worker, are written by export workers
   (rpc/export.ts) – a vector PDF, a PDF of pictures (PNG pages at 2×, B9), PNG files at 3× or a PNG on the
   clipboard – and saved by the helper in the export folder (POST /api/export-file), or downloaded when the page was
   opened from disk (B1). Fonts: the deck's library fonts and this PC's own (the helper's /sysfonts; from disk, the
   browser's local fonts, with permission). Every version × design runs as one job per (design, version), three at a
   time, named "<workbook> - <version> - <design>.pdf" (B11).
   The old engine (the helper renders the slide DOM in a headless browser; without one, the slides are drawn in this
   window) stays for one release as "PDF · text & tables (old engine)". */
import { get, hideBusy, patch, showBusy, toast } from "../state/store";
import { core, ctx, flushDoc, htmlFor, setPrefs, slidesFor, style } from "../state/app";
import type { RenderCtx } from "@slide-builder/core/render/context";
import type { Design } from "@slide-builder/core/model/types";
import { todayLabel } from "@slide-builder/core/render/cover";
import type { CatalogFont } from "@slide-builder/core/text/resolve";
import type { ExportJob, ExportResult } from "@slide-builder/core/rpc/messages";
import { openInstaller } from "../state/dialogs";
import { backend, ApiError, type ExportRes } from "../sync/api";
import { ExportPool } from "../rpc/export";
import { buildSlide } from "../render/slidedom";
import { esc } from "@slide-builder/core/xlsx/util";
import { embeddedFontCss } from "../state/fonts";
import { PRINT_CSS, printReady } from "@slide-builder/core/render/printcss";

export type ExportKind = "pdf" | "pdf-exact" | "pdf-vector" | "pdf-current" | "png-current" | "png-all" | "copy" | "pdf-old";
export const DESIGN_LABEL: Record<Design, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined" };
/** pixels per slide px: PDF pages as pictures (B9: 2×, was 4×) and PNG files / the clipboard (4800 × 2700, as before) */
export const PICTURE_SCALE = 2, PNG_SCALE = 3;

/* ---------------------------------------------------------------- fonts and pictures for the export workers */
/** this PC's fonts: from the helper's index, or (from disk) the browser's local fonts – asked once, with permission */
type LocalFont = { family: string; style: string; postscriptName: string; blob(): Promise<Blob> };
let sysCatalog: Promise<CatalogFont[]> | null = null;
const localFonts = new Map<string, LocalFont>();
const STYLE_WEIGHT: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/semi ?light/i, 350], [/light/i, 300], [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
const styleWeight = (s: string) => STYLE_WEIGHT.find(([re]) => re.test(s))?.[1] ?? 400;
function systemCatalog(): Promise<CatalogFont[]> {
  if (sysCatalog) return sysCatalog;
  const p = (async (): Promise<CatalogFont[]> => {
    if (backend.served) return (await backend.sysFonts()).map(f => ({ source: "system" as const, file: f.file, family: f.family, weight: f.weight, italic: f.italic }));
    const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
    if (!q) return [];
    const list = await q.call(window);
    for (const f of list) localFonts.set(f.postscriptName, f);
    return list.map(f => ({ source: "system" as const, file: f.postscriptName, family: f.family, weight: styleWeight(f.style), italic: /italic|oblique/i.test(f.style) }));
  })();
  sysCatalog = p;
  p.then(l => { if (!l.length) sysCatalog = null; }, () => { sysCatalog = null; });       // asked again next time
  return p;
}
/** the fonts an export may embed: the deck's library faces (their @font-face rules), then this PC's */
async function catalog(): Promise<CatalogFont[]> {
  const lib: CatalogFont[] = get().doc.fonts.flatMap(f => f.faces.map(x => ({ source: "library" as const, file: x.file, family: f.family, weight: Math.round(+x.weight || 400), italic: x.style === "italic" })));
  let sys: CatalogFont[] = [];
  try { sys = await systemCatalog(); } catch (e) { console.warn("this PC's fonts could not be listed:", e); }
  return [...lib, ...sys];
}
async function fontFile(a: { source: "library" | "system"; file: string }): Promise<ArrayBuffer | null> {
  try {
    if (a.source === "library") { if (!backend.served) return null; const r = await fetch(backend.fontUrl(a.file)); return r.ok ? await r.arrayBuffer() : null; }
    if (backend.served) return await backend.sysFontBytes(a.file);
    const f = localFonts.get(a.file);
    return f ? await (await f.blob()).arrayBuffer() : null;
  } catch (e) { console.warn("font not readable:", a.file, e); return null; }
}
/** a picture the workers cannot take as it is (a logo by URL, GIF / SVG / WebP / BMP) as PNG bytes; null = left out.
    A file next to the page opened from disk cannot be read by the page (the browser's file:// rules) and is left out */
async function pictureBytes(a: { src: string }): Promise<ArrayBuffer | null> {
  try {
    const href = new URL(a.src, location.href);
    if (!/^(https?|data|blob):$/.test(href.protocol)) return null;
    const res = await fetch(href);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (/^image\/(png|jpeg)$/.test(blob.type)) return await blob.arrayBuffer();
    const img = new Image(), url = URL.createObjectURL(blob);
    try {
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      const c = document.createElement("canvas"); c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const png = await new Promise<Blob | null>(ok => c.toBlob(ok, "image/png"));
      return png ? await png.arrayBuffer() : null;
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}
let exportPool: ExportPool | null = null;
export const pool = () => exportPool ||= new ExportPool(core, { fontFile, pictureBytes });

/* ---------------------------------------------------------------- writing the files */
const stemOf = (name: string) => name.replace(/\.[^.]+$/, "");
/** as the helper cleans names (exports.py clean_name) */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[\\/:*?"<>|]+/g, "_").trim().replace(/^\.+|\.+$/g, "") || "slide";
/** saved in the export folder (helper) or downloaded (from disk); returns the name used */
async function save(name: string, data: ArrayBuffer, type: string): Promise<string> {
  if (backend.served) return (await backend.exportFile(name, data)).files![0];
  download(name, data, type);
  return name;
}
/** a file given to the browser's downloads (the page opened from disk) */
export function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a"), url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
function job(kind: ExportJob["kind"], design: Design, version: string, slides: number[] | undefined, title: string, cat: CatalogFont[]): ExportJob {
  return { kind, design, version, forExport: true, thumb: false, slides, today: todayLabel(), scale: kind === "pictures" ? PICTURE_SCALE : PNG_SCALE, title, catalog: cat };
}
/** a vector PDF, or – from disk, when the browser gives no access to the PC's fonts – a PDF of pictures (the toast says so) */
async function runPdf(j: ExportJob): Promise<{ r: ExportResult; kind: ExportJob["kind"] }> {
  if (j.kind !== "pdf" || backend.served || j.catalog.some(f => f.source === "system")) return { r: await pool().run(j), kind: j.kind };
  return { r: await pool().run({ ...j, kind: "pictures", scale: PICTURE_SCALE }), kind: "pictures" };
}
const NO_FONTS = " · as pictures: this browser gave no access to the PC's fonts";
const missingNote = (m: string[], u: string[] = []) => (u.length ? ` · fonts that could not be embedded (the next one of their list is used): ${esc(u.slice(0, 3).join(", "))}` : "")
  + (m.length ? ` · drawn with a default font: ${esc(m.slice(0, 3).join(" · "))}` : "");
/** from disk, several files are several downloads: a browser may ask once to allow that (refused, some are missing) */
const MANY = " · if the browser asked to allow several downloads, allow them – otherwise some files are missing";
const secs = (t0: number) => ` · ${((performance.now() - t0) / 1000).toFixed(1)} s`;

/** the last export's files and time (click to saved), for tests and the bench */
export const lastExport = { files: [] as string[], ms: 0 };
/** what the last export made (or why it failed), for "Report a problem with this export" (the pilot, S3.8) */
export interface ExportRecord {
  kind: string; workbook: string; design: string; /** version ids ("" = the whole deck), " + " between several */ version: string;
  files: string[]; seconds: number; missing: string[]; unreadable: string[]; failed?: string[]; engine?: string;
  /** where a native export's time went (ms): getting a worker, display lists, fonts, writing */ phases?: Record<string, number>; at: string;
}
export let lastMade: ExportRecord | null = null;
function remember(r: Omit<ExportRecord, "at" | "seconds" | "workbook" | "phases">, t0: number) {
  lastMade = { ...r, workbook: get().deck.file?.name || "", seconds: +((performance.now() - t0) / 1000).toFixed(2), at: new Date().toISOString(),
    ...(r.kind !== "pdf-old" && exportPool ? { phases: { ...exportPool.last } } : {}) };
}

export async function doExport(kind: ExportKind) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file) return;
  if (kind === "pdf-old") return exportOldEngine();
  if (get().ui.exporting) return;
  // the clipboard is written now, while the click still counts as the user's (its PNG follows when it is drawn)
  let clip: { ok(b: Blob): void; no(e: unknown): void } | null = null, clipDone: Promise<void> | null = null;
  if (kind === "copy") {
    const png = new Promise<Blob>((ok, no) => { clip = { ok, no }; });
    png.catch(() => undefined);
    try { clipDone = navigator.clipboard.write([new ClipboardItem({ "image/png": png })]); }
    catch (e) { toast("⚠ This browser does not allow copying pictures: " + esc((e as Error).message || e), [], true); return; }
    clipDone.catch(() => undefined);
  }
  const t0 = performance.now();
  patch("ui", { exporting: true });
  try {
    const cat = catalog();                                     // (from disk: asks for the PC's fonts while the click counts)
    await flushDoc();
    const pdfMode = get().prefs.prefs.pdfMode || "vector", all = get().deck.slides.map((_, i) => i), cur = get().deck.cur;
    if (kind === "pdf-exact" || kind === "pdf-vector") setPrefs({ pdfMode: kind === "pdf-exact" ? "exact" : "vector" });
    const mode = kind === "pdf-exact" ? "exact" : kind === "pdf-vector" ? "vector" : pdfMode;
    const idx = kind === "pdf-current" || kind === "png-current" || kind === "copy" ? [cur] : all;
    const stem = clean(stemOf(file.name)), label = (i: number) => clean(get().deck.slides[i].label || "slide");
    const design = style().design, version = get().deck.version;
    if (kind === "png-current" || kind === "png-all" || kind === "copy") {
      const r = await pool().run(job("png", design, version, idx, stem, await cat));
      if (kind === "copy") {
        (clip as unknown as { ok(b: Blob): void }).ok(new Blob([r.files[0]], { type: "image/png" }));
        await clipDone;
        remember({ kind, design, version, files: [], missing: r.missing, unreadable: r.unreadable || [] }, t0);
        lastExport.files = []; lastExport.ms = performance.now() - t0;
        toast("Slide copied as a high-resolution image: paste it into PowerPoint.");
        return;
      }
      const names: string[] = [];
      for (const [k, b] of r.files.entries()) names.push(await save(`${stem} - ${label(idx[k])}.png`, b, "image/png"));
      remember({ kind, design, version, files: names, missing: r.missing, unreadable: r.unreadable || [] }, t0);
      return done(names, t0, "");
    }
    // "<workbook> - slides.pdf" for the deck (one slide: that slide's name), " (images)" for pictures – as before
    const whole = idx.length === all.length && idx.length > 1;
    const { r, kind: made } = await runPdf(job(mode === "exact" ? "pictures" : "pdf", design, version, kind === "pdf-current" ? idx : undefined, stem, await cat));
    const name = `${stem} - ${whole ? "slides" : label(idx[0])}${made === "pictures" ? " (images)" : ""}.pdf`, saved = await save(name, r.files[0], "application/pdf");
    remember({ kind: made === "pictures" ? kind + " (as pictures)" : kind, design, version, files: [saved], missing: r.missing, unreadable: r.unreadable || [] }, t0);
    done([saved], t0, (made === "pictures" && mode !== "exact" ? NO_FONTS : "") + missingNote(r.missing, r.unreadable));
  } catch (e) {
    console.error(e);
    remember({ kind, design: style().design, version: get().deck.version, files: [], missing: [], unreadable: [], failed: [String((e as Error).message || e)] }, t0);
    (clip as { no(e: unknown): void } | null)?.no(e);
    toast("⚠ Export failed: " + esc((e as Error).message || e), [], true);
  } finally { patch("ui", { exporting: false }); }
}
function done(files: string[], t0: number, note: string) {
  lastExport.files = files; lastExport.ms = performance.now() - t0;
  if (!backend.served) { toast(`Downloaded <b>${esc(files.join(", "))}</b>${note}${files.length > 1 ? MANY : ""}`); return; }
  const acts = [{ label: "Open", fn: () => { void backend.open({ name: files[0] }); } }, { label: "Show folder", fn: () => { void backend.open({ folder: true }); } }];
  toast(`Saved <b>${esc(files.join(", "))}</b> in the export folder${secs(t0)}${note}`, files.length === 1 ? acts : acts.slice(1));
}

/* ---- every version (wizard › Versions), in the current design or in several designs: one PDF each, named
   "<workbook> - <version> - <design>.pdf" (B11), three at a time ---- */
export async function exportVersions(designs: Design[] | null) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file || get().ui.exporting) return;
  const versions = get().doc.view?.preset?.versions || [];
  if (!versions.length) { toast("No versions yet: open the ✦ Wizard › 4 · Versions to create them (e.g. Chief and All)."); return; }
  const t0 = performance.now();
  patch("ui", { exporting: true });
  const stem = clean(stemOf(file.name)), saved: string[] = [], missing = new Set<string>(), unreadable = new Set<string>();
  try {
    const cat = catalog();
    await flushDoc();
    const pictures = (get().prefs.prefs.pdfMode || "vector") === "exact", list = designs || [style().design], total = versions.length * list.length;
    let noFonts = false;
    showBusy(`Exporting ${total} PDFs…`, 0);
    // every job runs to its end (one failing does not stop the others, which still save their files); the busy
    // screen goes once all have settled, then the toast names what was saved and what failed
    const results = await Promise.allSettled(list.flatMap(d => versions.map(async v => {
      const title = `${stem} - ${clean(v.name)} - ${DESIGN_LABEL[d]}`;
      try {
        const { r, kind } = await runPdf(job(pictures ? "pictures" : "pdf", d, v.id, undefined, title, await cat));
        if (kind === "pictures" && !pictures) noFonts = true;
        r.missing.forEach(m => missing.add(m)); r.unreadable?.forEach(m => unreadable.add(m));
        saved.push(await save(`${title}${kind === "pictures" ? " (images)" : ""}.pdf`, r.files[0], "application/pdf"));
        showBusy(`Exported ${saved.length} of ${total}…`, saved.length / total);
      } catch (e) { throw new Error(`${v.name} – ${DESIGN_LABEL[d]}: ${(e as Error).message || e}`); }
    })));
    hideBusy();
    const failed = results.flatMap(r => r.status === "rejected" ? [String((r.reason as Error).message || r.reason)] : []);
    failed.forEach(f => console.error("export failed:", f));
    lastExport.files = [...saved]; lastExport.ms = performance.now() - t0;
    remember({ kind: designs ? `versions-${list.length}` : "versions", design: list.join(" + "), version: versions.map(v => v.id).join(" + "), files: [...saved], missing: [...missing], unreadable: [...unreadable], failed }, t0);
    toast(`Saved <b>${saved.length}</b> PDFs${backend.served ? " in the export folder" : " (downloaded)"}${saved.length ? ": " + esc(saved.join(", ")) : ""}${secs(t0)}${noFonts ? NO_FONTS : ""}${missingNote([...missing], [...unreadable])}${!backend.served && saved.length > 1 ? MANY : ""}`
      + (failed.length ? ` · ⚠ ${failed.length} failed: ${esc(failed.slice(0, 2).join(" · "))}` : ""),
      backend.served ? [{ label: "Show folder", fn: () => { void backend.open({ folder: true }); } }] : [], failed.length > 0);
  } catch (e) {
    console.error(e); hideBusy();
    remember({ kind: designs ? `versions-${designs.length}` : "versions", design: (designs || [style().design]).join(" + "), version: versions.map(v => v.id).join(" + "), files: [...saved], missing: [], unreadable: [], failed: [String((e as Error).message || e)] }, t0);
    toast("⚠ Export failed: " + esc((e as Error).message || e), [], true);
  } finally { patch("ui", { exporting: false }); }
}

/* ---------------------------------------------------------------- the old engine, for one release (S3.7 → S3.9) */
const toDataUrl = async (url: string) => { const b = await (await fetch(url)).blob(); return await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(b); }); };
const slideCss = () => [document.getElementById("slidecss")?.textContent || "", document.getElementById("wallcss")?.textContent || ""].join("\n");

/** the exact slide DOM + slide CSS, self-contained (pictures and logo as data URLs), made light for a vector PDF */
async function exportPayload(idx: number[], base: RenderCtx = ctx()) {
  // the tables as the core worker draws them for this design and version
  const c = { ...base, forExport: true, htmlOf: await htmlFor(base.style.design, base.version?.id || "", true) }, slides: string[] = [], src = slidesFor(base.style.design);
  for (const i of idx) {
    const s = buildSlide(src[i], i, c);
    s.querySelectorAll(".pic.missing").forEach(e => e.remove());
    for (const img of Array.from(s.querySelectorAll<HTMLImageElement>("img.logo"))) { try { img.setAttribute("src", await toDataUrl(img.src)); } catch { img.parentNode && (img.parentNode as HTMLElement).remove(); } }
    slides.push(printReady(s.outerHTML));
  }
  // text & tables: shadows and fonts the PDF can draw as vector (no pictures, no glyph-by-glyph fonts)
  return { css: printReady(slideCss()) + "\n" + PRINT_CSS + "\n" + await embeddedFontCss(slides.join("")), slides, names: idx.map(i => get().deck.slides[i].label) };
}
async function clientRender(i: number, scale: number, base: RenderCtx = ctx()): Promise<string> {
  const c = { ...base, forExport: true, htmlOf: await htmlFor(base.style.design, base.version?.id || "", true) };
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
  return cv.toDataURL("image/jpeg", .95);
}
/** "PDF · text & tables (old engine)": the helper's export engine, else the slides drawn in this window (as v3.6) */
async function exportOldEngine() {
  const { file } = get().deck;
  if (!backend.served) { toast("The old engine runs through the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return; }
  if (file!.src === "local") { toast("This workbook was opened without the helper. Open it again from the Open menu.", [], true); return; }
  if (get().ui.exporting) return;
  const t0 = performance.now();
  patch("ui", { exporting: true });
  try {
    await flushDoc();
    const all = get().deck.slides.map((_, i) => i);
    // "<workbook> (old engine) - slides.pdf": next to the native export's file, to compare them (the pilot, S3.8)
    const oldName = stemOf(file!.name) + " (old engine)" + (/\.[^.]+$/.exec(file!.name)?.[0] || "");
    let j: ExportRes | null = null, fallback = false;
    if (get().ui.health?.engine?.state === "ready") {
      try { j = await backend.exportSlides({ name: oldName, format: "pdf", mode: "vector", scale: 4, all: all.length > 1, ...(await exportPayload(all)) }); }
      catch (e) { if ((e instanceof ApiError && (e.status === 503 || e.status === 0)) || e instanceof TypeError) { fallback = true; console.warn(e); } else throw e; }
    } else fallback = true;
    if (fallback) { const images: string[] = []; for (const i of all) images.push(await clientRender(i, 3)); j = await backend.assemble(oldName, images); }
    const f = j!.files![0];
    remember({ kind: "pdf-old", design: style().design, version: get().deck.version, files: j!.files!, missing: [], unreadable: [], engine: fallback ? "drawn in the app window" : j!.engine || "" }, t0);
    const acts = [{ label: "Open", fn: () => { void backend.open({ name: f }); } }, { label: "Show folder", fn: () => { void backend.open({ folder: true }); } }];
    if (fallback && get().ui.health?.engine?.state !== "starting") acts.push({ label: "Install export engine", fn: openInstaller });
    toast(`Saved <b>${esc(j!.files!.join(", "))}</b> in the export folder (old engine)` + (j!.seconds ? ` · ${j!.seconds}s` : "") + (j!.engine ? ` · ${esc(j!.engine)}` : "") + (fallback ? " · rendered in the app window" : ""), acts);
  } catch (e) {
    console.error(e);
    remember({ kind: "pdf-old", design: style().design, version: get().deck.version, files: [], missing: [], unreadable: [], failed: [String((e as Error).message || e)] }, t0);
    toast("⚠ Export failed: " + esc((e as Error).message || e), [], true);
  } finally { patch("ui", { exporting: false }); }
}
