/* Font files for the workers (S3.7, S4.4): the deck's library faces and this PC's fonts – the helper's /sysfonts index,
   or, opened from disk, the browser's local fonts (asked once, with permission) – and their bytes. The export workers
   embed them in PDFs; the core worker measures the slides' text with them (S4.4, `measureCatalog`). */
import { get, patch, THUMBS } from "./store";
import { backend } from "../sync/api";
import type { CatalogFont } from "@slide-builder/core/text/resolve";
import { catalogFamily } from "@slide-builder/core/text/family";
import { setFontGate } from "../platform";

/** this PC's fonts: from the helper's index, or (from disk) the browser's local fonts – asked once, with permission */
type LocalFont = { family: string; style: string; postscriptName: string; blob(): Promise<Blob> };
let sysCatalog: Promise<CatalogFont[]> | null = null;
const localFonts = new Map<string, LocalFont>();
const STYLE_WEIGHT: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/semi ?light/i, 350], [/light/i, 300], [/medium/i, 500],
  [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
const styleWeight = (s: string) => STYLE_WEIGHT.find(([re]) => re.test(s))?.[1] ?? 400;
export function systemCatalog(): Promise<CatalogFont[]> {
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
/** the deck's library faces (their @font-face rules) */
export const libraryCatalog = (): CatalogFont[] => get().doc.fonts.flatMap(f => f.faces.map(x => ({ source: "library" as const, file: x.file, family: f.family, weight: Math.round(+x.weight || 400), italic: x.style === "italic",
  ...(f.source === "system" ? { copied: true } : {}) })));
/** the fonts an export may embed: the deck's library faces, then this PC's */
export async function catalog(): Promise<CatalogFont[]> {
  const lib = libraryCatalog();
  let sys: CatalogFont[] = [];
  try { sys = await systemCatalog(); } catch (e) { console.warn("this PC's fonts could not be listed:", e); }
  return [...lib, ...sys];
}
/** the Windows fonts the workers read, captured once each (W13): the helper records this PC's build; another PC with
    another build is named in the side panel (its slides may lay out a little differently); in copy mode (the licence
    owner's yes recorded, helper sysfonts.py) the helper puts the family into the shared library, and every PC then
    measures and draws it from the library's file */
const captured = new Set<string>(), waiting: string[] = [];
let quiet: ReturnType<typeof setTimeout> | null = null, sending = false;
/** captures are not urgent: they wait until the workers have asked for no font for CAPTURE_QUIET_MS (a deck's first
    slide waits for its font files – the helper's work for a capture must not delay them), then go one at a time */
export const CAPTURE_QUIET_MS = 3000;
function capture(file: string) {
  const k = file.toLowerCase();
  if (!backend.served || captured.has(k)) return;
  captured.add(k); waiting.push(file);
  if (quiet) clearTimeout(quiet);
  quiet = setTimeout(() => { quiet = null; void sendCaptures(); }, CAPTURE_QUIET_MS);
}
async function sendCaptures() {
  if (sending) return;
  sending = true;
  try { for (let f = waiting.shift(); f !== undefined; f = waiting.shift()) await captureNow(f); }
  finally { sending = false; }
}
async function captureNow(file: string) {
  const k = file.toLowerCase();
  let r: Awaited<ReturnType<typeof backend.captureFont>>;
  try { r = await backend.captureFont(file); }
  catch (e) { console.info("font capture:", file, e); setTimeout(() => captured.delete(k), 60_000); return; }      // (asked again a minute later at most)
  if (!r) return;
  if (r.mode === "copy" && r.copied) {
    if (!get().doc.fonts.some(f => f.family.toLowerCase() === r!.family.toLowerCase())) {
      const { loadFonts } = await import("./fonts");
      await loadFonts(); THUMBS.render();
    }
    return;
  }
  const hosts = (r.otherHosts || []).filter(h => h !== get().prefs.host);
  if (!hosts.length) return;
  const was = get().ui.fontBuilds, same = was.find(x => x.family === r!.family);
  const all = [...new Set([...(same?.hosts || []), ...hosts])].sort();
  if (!same || all.length !== same.hosts.length) patch("ui", { fontBuilds: [...was.filter(x => x.family !== r!.family), { family: r.family, hosts: all }] });
}
export async function fontFile(a: { source: "library" | "system"; file: string }): Promise<ArrayBuffer | null> {
  if (a.source === "system") capture(a.file);
  try {
    if (a.source === "library") { if (!backend.served) return null; const r = await fetch(backend.fontUrl(a.file), { signal: AbortSignal.timeout(20_000) }); return r.ok ? await r.arrayBuffer() : null; }
    if (backend.served) return await backend.sysFontBytes(a.file);
    const f = localFonts.get(a.file);
    return f ? await (await f.blob()).arrayBuffer() : null;
  } catch (e) { console.warn("font not readable:", a.file, e); return null; }
}
/** the catalog the core worker measures with, once it asked for it (the page's width() follows it: fontReadable) */
let known: Map<string, CatalogFont[]> | null = null;
/** whether the core worker can read a catalog file: not a WOFF2 (no Brotli in the core), not a library file from disk
    (the page cannot read the Slide Builder folder then) */
const readable = (f: CatalogFont) => !/\.woff2$/i.test(f.file) && (f.source === "system" || backend.served);
/** whether a CSS font is measured from a file by the core worker – the page's width() answers only then, so Liquid
    Glass's columns come out the same on the page and in the worker (null: the catalog is not known yet) */
export function fontReadable(families: string[]): boolean | null {
  if (!known) return null;
  const k = known, fam = catalogFamily(families, x => k.has(x));
  return !!fam && k.get(fam.toLowerCase())!.some(readable);
}
/** the fonts the core worker measures text with: the library's faces and this PC's – from disk only when the browser
    has already given its local fonts (measuring never asks: a page that has not been given them measures as before) */
export async function measureCatalog(): Promise<CatalogFont[]> {
  let list: CatalogFont[];
  // (systemCatalog's failure is not swallowed here: the worker asks again rather than keep a list without this PC's fonts)
  if (backend.served) list = [...libraryCatalog(), ...await systemCatalog()];
  else {
    const perm = await navigator.permissions?.query({ name: "local-fonts" as PermissionName }).catch(() => null);
    list = perm?.state === "granted" ? [...libraryCatalog(), ...await systemCatalog()] : libraryCatalog();
  }
  // as the worker keeps it: a library family shadows a Windows font of the same name
  const lib = new Set(list.filter(f => f.source === "library").map(f => f.family.toLowerCase())), m = new Map<string, CatalogFont[]>();
  for (const f of list) { const k = f.family.toLowerCase(); if (f.source === "system" && lib.has(k)) continue; const l = m.get(k) || []; l.push(f); m.set(k, l); }
  known = m;
  setFontGate(fontReadable);                                         // (the page's widths follow the new catalog)
  return list;
}
