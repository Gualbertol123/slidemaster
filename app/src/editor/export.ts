/* Export (PLAN S3.7, Part B §4): the slides' display lists, built by the core worker, are written by export workers
   (rpc/export.ts) – a vector PDF, a PDF of pictures (PNG pages at 2×, B9), PNG files at 3× or a PNG on the
   clipboard – and saved by the helper in the export folder (POST /api/export-file), or downloaded when the page was
   opened from disk (B1). Fonts: the deck's library fonts and this PC's own (the helper's /sysfonts; from disk, the
   browser's local fonts, with permission). Every version × design runs as one job per (design, version), three at a
   time, named "<workbook> - <version> - <design>.pdf" (B11). A PowerPoint file (4.5, B21; docs/next/07 §4) is made the
   same way, by the same workers, next to or instead of each PDF: ".pptx" for ".pdf" in every name. */
import { get, hideBusy, patch, showBusy, toast } from "../state/store";
import { core, flushDoc, setPrefs, style } from "../state/app";
import type { Design } from "@slide-builder/core/model/types";
import { DESIGN_LABEL } from "@slide-builder/core/model/designs";
import { todayLabel } from "@slide-builder/core/render/cover";
import type { CatalogFont } from "@slide-builder/core/text/resolve";
import type { ExportJob, ExportResult, Thumb } from "@slide-builder/core/rpc/messages";
import { backend } from "../sync/api";
import { ExportPool } from "../rpc/export";
import { catalog, fontFile, libraryCatalog } from "../state/fontfiles";
import { esc } from "@slide-builder/core/xlsx/util";
import { cleanName as clean, pdfName, pngName, pptxName, stemOf, versionTitle } from "@slide-builder/core/export/names";
import type { FileKind } from "@slide-builder/core/rpc/messages";

export type ExportKind = "pdf" | "pdf-exact" | "pdf-vector" | "pdf-current" | "png-current" | "png-all" | "copy"
  /* PowerPoint (B21): the deck or the current slide, alone or with its PDF */ | "pptx" | "pptx-current" | "both" | "both-current";
/** the files an export makes per design and version (B21): a PDF, a PowerPoint file or both */
export type Formats = FileKind[];
export const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** the names users see (B11: in export file names) */
export { DESIGN_LABEL };
/** pixels per slide px: PDF pages as pictures (B9: 2×, was 4×) and PNG files / the clipboard (4800 × 2700, as before) */
export const PICTURE_SCALE = 2, PNG_SCALE = 3;

/* ---------------------------------------------------------------- pictures for the export workers */
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
/** thumbnails (S4.3, B14): slides of the current design and version as pictures `width` px wide, drawn by an export
    worker as the PNG export draws them; `have`: the key of the picture shown of each slide (not drawn again) */
export function thumbPictures(slides: number[], width: number, have: Record<number, string>): Promise<Thumb[]> {
  // the stage's values: a scenario previewed shows on the thumbnails too (S8.3: lists name whose values they draw)
  return pool().thumbs({ design: style().design, version: get().deck.version, forExport: false, thumb: false, slides, today: todayLabel(), width, library: libraryCatalog(), have, scenario: "preview" });
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
/** PowerPoint names fonts, it does not embed them (07 §4.2): the deck's library fonts are said */
const namedNote = (n: string[] = []) => n.length ? ` · PowerPoint: fonts named, not embedded (PowerPoint substitutes them where they are not installed): ${esc(n.slice(0, 3).join(", "))}` : "";
/** from disk, several files are several downloads: a browser may ask once to allow that (refused, some are missing) */
const MANY = " · if the browser asked to allow several downloads, allow them – otherwise some files are missing";
const secs = (t0: number) => ` · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
/** an export while a scenario is previewed draws the workbook's own values (S8.3): said so */
const previewNote = () => get().ui.preview ? ` · with the workbook's own values (the preview of “${esc(get().ui.preview!.value)}” is not exported: Run for each value… exports values)` : "";

/** the last export's files and time (click to saved), for tests and the bench */
export const lastExport = { files: [] as string[], ms: 0 };
/** what the last export made (or why it failed), for "Report a problem with this export" (the pilot, S3.8) */
export interface ExportRecord {
  kind: string; workbook: string; design: string; /** version ids ("" = the whole deck), " + " between several */ version: string;
  files: string[]; seconds: number; missing: string[]; unreadable: string[]; failed?: string[];
  /** where a native export's time went (ms): getting a worker, display lists, fonts, writing */ phases?: Record<string, number>; at: string;
}
export let lastMade: ExportRecord | null = null;
function remember(r: Omit<ExportRecord, "at" | "seconds" | "workbook" | "phases">, t0: number) {
  lastMade = { ...r, workbook: get().deck.file?.name || "", seconds: +((performance.now() - t0) / 1000).toFixed(2), at: new Date().toISOString(),
    ...(exportPool ? { phases: { ...exportPool.last } } : {}) };
}

export async function doExport(kind: ExportKind) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file) return;
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
    const idx = kind === "pdf-current" || kind === "pptx-current" || kind === "both-current" || kind === "png-current" || kind === "copy" ? [cur] : all;
    const stem = clean(stemOf(file.name)), label = (i: number) => get().deck.slides[i].label || "slide";
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
      for (const [k, b] of r.files.entries()) names.push(await save(pngName(stem, label(idx[k])), b, "image/png"));
      remember({ kind, design, version, files: names, missing: r.missing, unreadable: r.unreadable || [] }, t0);
      return done(names, t0, "");
    }
    // "<workbook> - slides.pdf" for the deck (one slide: that slide's name), " (images)" for pictures – as before; the
    // PowerPoint file "<workbook> - slides.pptx" (B21), made by another worker at the same time
    const whole = idx.length === all.length && idx.length > 1, current = idx.length === 1 && idx.length < all.length || /current$/.test(kind);
    const formats: Formats = kind === "pptx" || kind === "pptx-current" ? ["pptx"] : kind === "both" || kind === "both-current" ? ["pdf", "pptx"] : ["pdf"];
    const c = await cat, slides = current ? idx : undefined;
    // (both at once: a file that was made is saved even when the other one failed – then the failure is said)
    const [p1, p2] = await Promise.allSettled([
      formats.includes("pdf") ? runPdf(job(mode === "exact" ? "pictures" : "pdf", design, version, slides, stem, c)) : null,
      formats.includes("pptx") ? pool().run(job("pptx", design, version, slides, stem, c)) : null]);
    const pdf = p1.status === "fulfilled" ? p1.value : null, ppt = p2.status === "fulfilled" ? p2.value : null;
    const files: string[] = [];
    if (pdf) files.push(await save(pdfName(stem, whole ? null : label(idx[0]), pdf.kind === "pictures"), pdf.r.files[0], "application/pdf"));
    if (ppt) files.push(await save(pptxName(stem, whole ? null : label(idx[0])), ppt.files[0], PPTX_TYPE));
    const fails = [p1, p2].flatMap(p => p.status === "rejected" ? [p.reason as Error] : []);
    if (fails.length && !files.length) throw fails[0];
    const failed = fails.map(e => `${p1.status === "rejected" ? "PDF" : "PowerPoint"}: ${e.message || String(e)}`);
    const missing = pdf?.r.missing || [], unreadable = pdf?.r.unreadable || [];
    remember({ kind: pdf?.kind === "pictures" ? kind + " (as pictures)" : kind, design, version, files, missing, unreadable, ...(failed.length ? { failed } : {}) }, t0);
    done(files, t0, (pdf?.kind === "pictures" && mode !== "exact" ? NO_FONTS : "") + missingNote(missing, unreadable) + namedNote(ppt?.notEmbedded)
      + (fails.length ? ` · ⚠ ${p1.status === "rejected" ? "the PDF" : "the PowerPoint file"} could not be made: ${esc(fails[0].message || String(fails[0]))}` : ""), fails.length > 0);
  } catch (e) {
    console.error(e);
    remember({ kind, design: style().design, version: get().deck.version, files: [], missing: [], unreadable: [], failed: [String((e as Error).message || e)] }, t0);
    (clip as { no(e: unknown): void } | null)?.no(e);
    toast("⚠ Export failed: " + esc((e as Error).message || e), [], true);
  } finally { patch("ui", { exporting: false }); }
}
function done(files: string[], t0: number, note: string, warn = false) {
  lastExport.files = files; lastExport.ms = performance.now() - t0;
  if (!backend.served) { toast(`Downloaded <b>${esc(files.join(", "))}</b>${note}${files.length > 1 ? MANY : ""}`, [], warn); return; }
  const acts = [{ label: "Open", fn: () => { void backend.open({ name: files[0] }); } }, { label: "Show folder", fn: () => { void backend.open({ folder: true }); } }];
  toast(`Saved <b>${esc(files.join(", "))}</b> in the export folder${secs(t0)}${note}${previewNote()}`, files.length === 1 ? acts : acts.slice(1), warn);
}

/* ---- every version (wizard › Versions), in the current design or in several designs: one PDF each, named
   "<workbook> - <version> - <design>.pdf" (B11), three at a time; a PowerPoint file each instead or as well (B21) ---- */
export async function exportVersions(designs: Design[] | null, formats: Formats = ["pdf"]) {
  const { file } = get().deck;
  if (!get().deck.slides.length || !file || get().ui.exporting) return;
  const versions = get().doc.view?.preset?.versions || [];
  if (!versions.length) { toast("No versions yet: open the ✦ Wizard › 4 · Versions to create them (e.g. Chief and All)."); return; }
  const t0 = performance.now();
  patch("ui", { exporting: true });
  const stem = clean(stemOf(file.name)), saved: string[] = [], missing = new Set<string>(), unreadable = new Set<string>(), named = new Set<string>();
  const what = formats.includes("pptx") ? "files" : "PDFs";
  try {
    const cat = catalog();
    await flushDoc();
    const pictures = (get().prefs.prefs.pdfMode || "vector") === "exact", list = designs || [style().design], total = versions.length * list.length * formats.length;
    let noFonts = false;
    showBusy(`Exporting ${total} ${what}…`, 0);
    // every job runs to its end (one failing does not stop the others, which still save their files); the busy
    // screen goes once all have settled, then the toast names what was saved and what failed
    const results = await Promise.allSettled(list.flatMap(d => versions.flatMap(v => formats.map(async f => {
      const title = versionTitle(stem, v.name, d);
      try {
        if (f === "pptx") {
          const r = await pool().run(job("pptx", d, v.id, undefined, title, await cat));
          r.notEmbedded?.forEach(n => named.add(n));
          saved.push(await save(`${title}.pptx`, r.files[0], PPTX_TYPE));
        } else {
          const { r, kind } = await runPdf(job(pictures ? "pictures" : "pdf", d, v.id, undefined, title, await cat));
          if (kind === "pictures" && !pictures) noFonts = true;
          r.missing.forEach(m => missing.add(m)); r.unreadable?.forEach(m => unreadable.add(m));
          saved.push(await save(`${title}${kind === "pictures" ? " (images)" : ""}.pdf`, r.files[0], "application/pdf"));
        }
        showBusy(`Exported ${saved.length} of ${total}…`, saved.length / total);
      } catch (e) { throw new Error(`${v.name} – ${DESIGN_LABEL[d]}${formats.length > 1 ? ` (${f === "pptx" ? "PowerPoint" : "PDF"})` : ""}: ${(e as Error).message || e}`); }
    }))));
    hideBusy();
    const failed = results.flatMap(r => r.status === "rejected" ? [String((r.reason as Error).message || r.reason)] : []);
    failed.forEach(f => console.error("export failed:", f));
    lastExport.files = [...saved]; lastExport.ms = performance.now() - t0;
    remember({ kind: (designs ? `versions-${list.length}` : "versions") + (formats.includes("pptx") ? " " + formats.join("+") : ""), design: list.join(" + "), version: versions.map(v => v.id).join(" + "), files: [...saved], missing: [...missing], unreadable: [...unreadable], failed }, t0);
    toast(`Saved <b>${saved.length}</b> ${what}${backend.served ? " in the export folder" : " (downloaded)"}${saved.length ? ": " + esc(saved.join(", ")) : ""}${secs(t0)}${previewNote()}${noFonts ? NO_FONTS : ""}${missingNote([...missing], [...unreadable])}${namedNote([...named])}${!backend.served && saved.length > 1 ? MANY : ""}`
      + (failed.length ? ` · ⚠ ${failed.length} failed: ${esc(failed.slice(0, 2).join(" · "))}` : ""),
      backend.served ? [{ label: "Show folder", fn: () => { void backend.open({ folder: true }); } }] : [], failed.length > 0);
  } catch (e) {
    console.error(e); hideBusy();
    remember({ kind: designs ? `versions-${designs.length}` : "versions", design: (designs || [style().design]).join(" + "), version: versions.map(v => v.id).join(" + "), files: [...saved], missing: [], unreadable: [], failed: [String((e as Error).message || e)] }, t0);
    toast("⚠ Export failed: " + esc((e as Error).message || e), [], true);
  } finally { patch("ui", { exporting: false }); }
}

/* ---- Run for each value (S8.3, B15): one file of a run, asked by the core worker for each value × design × version ---- */
/** the PowerPoint file of one design and version drawn from the run's view (B21), saved as `name` */
export async function scenarioPptx(a: { id: string; design: Design; version: string; name: string; title: string; today?: string }, cat: Promise<CatalogFont[]>): Promise<{ file: string; notEmbedded: string[] }> {
  const r = await pool().run({ ...job("pptx", a.design, a.version, undefined, a.title, await cat), scenario: a.id, ...(a.today ? { today: a.today } : {}) });
  return { file: await save(a.name, r.files[0], PPTX_TYPE), notEmbedded: r.notEmbedded || [] };
}
/** the PDF of one design and version drawn from the run's view (`id`: the run's), saved as `name` (S8.2's names); a
    PDF of pictures when that is the chosen mode, or – from disk – when the browser gave no access to the PC's fonts
    (" (images)", as every export). The name the helper saved it under */
export async function scenarioPdf(a: { id: string; design: Design; version: string; name: string; title: string; today?: string }, cat: Promise<CatalogFont[]>): Promise<{ file: string; missing: string[]; unreadable: string[] }> {
  const pictures = (get().prefs.prefs.pdfMode || "vector") === "exact";
  const { r, kind } = await runPdf({ ...job(pictures ? "pictures" : "pdf", a.design, a.version, undefined, a.title, await cat), scenario: a.id, ...(a.today ? { today: a.today } : {}) });
  const name = kind === "pictures" ? a.name.replace(/\.pdf$/i, " (images).pdf") : a.name;
  return { file: await save(name, r.files[0], "application/pdf"), missing: r.missing, unreadable: r.unreadable || [] };
}
