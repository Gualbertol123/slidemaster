/* Font files for the workers (S3.7, S4.4): the deck's library faces and this PC's fonts – the helper's /sysfonts index,
   or, opened from disk, the browser's local fonts (asked once, with permission) – and their bytes. The export workers
   embed them in PDFs; the core worker measures the slides' text with them (S4.4, `measureCatalog`). */
import { get } from "./store";
import { backend } from "../sync/api";
import type { CatalogFont } from "@slide-builder/core/text/resolve";

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
export const libraryCatalog = (): CatalogFont[] => get().doc.fonts.flatMap(f => f.faces.map(x => ({ source: "library" as const, file: x.file, family: f.family, weight: Math.round(+x.weight || 400), italic: x.style === "italic" })));
/** the fonts an export may embed: the deck's library faces, then this PC's */
export async function catalog(): Promise<CatalogFont[]> {
  const lib = libraryCatalog();
  let sys: CatalogFont[] = [];
  try { sys = await systemCatalog(); } catch (e) { console.warn("this PC's fonts could not be listed:", e); }
  return [...lib, ...sys];
}
export async function fontFile(a: { source: "library" | "system"; file: string }): Promise<ArrayBuffer | null> {
  try {
    if (a.source === "library") { if (!backend.served) return null; const r = await fetch(backend.fontUrl(a.file)); return r.ok ? await r.arrayBuffer() : null; }
    if (backend.served) return await backend.sysFontBytes(a.file);
    const f = localFonts.get(a.file);
    return f ? await (await f.blob()).arrayBuffer() : null;
  } catch (e) { console.warn("font not readable:", a.file, e); return null; }
}
/** the fonts the core worker measures text with: the library's faces and this PC's – from disk only when the browser
    has already given its local fonts (measuring never asks: a page that has not been given them measures as before) */
export async function measureCatalog(): Promise<CatalogFont[]> {
  if (backend.served) return catalog();
  const perm = await navigator.permissions?.query({ name: "local-fonts" as PermissionName }).catch(() => null);
  return perm?.state === "granted" ? catalog() : libraryCatalog();
}
