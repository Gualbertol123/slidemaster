/* Fonts: the fonts installed on Windows, popular Google Fonts, and the shared font library (fonts
   uploaded by users or saved from Google Fonts, kept by the helper in data/fonts, see ARCHITECTURE §3.4).
   Text formats store a font by its family name ("Roboto"); fontStack() turns it into CSS. */

export interface FontFace { file: string; weight: number; style: "normal" | "italic"; range?: string }
export interface LibraryFont { family: string; source: "upload" | "google"; faces: FontFace[]; by?: string | null; at?: number | null }

/** fonts that come with Windows / Office: no download needed */
export const SYSTEM_FONTS = ["Segoe UI", "Arial", "Calibri", "Cambria", "Candara", "Century Gothic", "Consolas", "Constantia", "Corbel",
  "Franklin Gothic Medium", "Garamond", "Georgia", "Palatino Linotype", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];

/** popular Google Fonts offered in the font menus (any other family can be added by name) */
export const GOOGLE_POPULAR = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Source Sans 3", "Raleway", "Nunito", "Nunito Sans",
  "Work Sans", "DM Sans", "Manrope", "Plus Jakarta Sans", "IBM Plex Sans", "Noto Sans", "PT Sans", "Fira Sans", "Rubik", "Barlow",
  "Mulish", "Outfit", "Figtree", "Titillium Web", "Ubuntu", "Oswald", "Archivo", "Libre Franklin", "Josefin Sans", "Quicksand",
  "Merriweather", "Playfair Display", "Lora", "Libre Baskerville", "Source Serif 4", "EB Garamond", "Crimson Pro", "PT Serif", "Roboto Slab",
  "IBM Plex Serif", "Bitter", "DM Serif Display", "Roboto Mono", "JetBrains Mono", "IBM Plex Mono", "Fira Code"];

/** generic fallbacks when a font is missing on a PC */
export const FALLBACK = { sans: "'Segoe UI',Arial,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "Consolas,'Courier New',monospace" };
const SERIF = /serif|garamond|georgia|times|baskerville|merriweather|lora|playfair|bitter|cambria|constantia|palatino|crimson|slab/i;
const MONO = /mono|code|consolas|courier/i;

/** a family name that is safe inside CSS and HTML attributes (letters, digits, spaces and . - _ & +) */
export function cleanFamily(name: string): string {
  return String(name || "").replace(/[^\p{L}\p{N} .\-_&+]/gu, "").replace(/\s+/g, " ").trim().slice(0, 64);
}
/** CSS font-family for a family name, with a fallback of the same kind */
export function fontStack(name: string | null | undefined, fallback?: string): string {
  const f = cleanFamily(name || "");
  if (!f) return fallback || FALLBACK.sans;
  const generic = MONO.test(f) ? FALLBACK.mono : SERIF.test(f) && !/sans/i.test(f) ? FALLBACK.serif : FALLBACK.sans;
  return `'${f}',${fallback || generic}`;
}

/** @font-face rules for the library; url(file) gives the address of a font file */
export function fontFaceCss(lib: LibraryFont[], url: (file: string) => string): string {
  let css = "";
  for (const f of lib) {
    const fam = cleanFamily(f.family); if (!fam) continue;
    for (const x of f.faces) {
      const fmt = /\.woff2$/i.test(x.file) ? "woff2" : /\.woff$/i.test(x.file) ? "woff" : /\.otf$/i.test(x.file) ? "opentype" : "truetype";
      const range = x.range && /^[uU0-9A-Fa-f+?, -]+$/.test(x.range) ? `unicode-range:${x.range};` : "";
      css += `@font-face{font-family:'${fam}';src:url(${JSON.stringify(url(x.file))}) format('${fmt}');font-weight:${Math.round(+x.weight || 400)};font-style:${x.style === "italic" ? "italic" : "normal"};${range}font-display:swap}\n`;
    }
  }
  return css;
}

/* ---- reading the family, weight and style out of a font file (TTF / OTF / WOFF) ---- */
export interface FontInfo { family: string; weight: number; style: "normal" | "italic" }

/** weight/style from a file name like "OpenSans-SemiBoldItalic.ttf" */
export function guessFromName(fileName: string): FontInfo {
  const base = fileName.replace(/\.[^.]+$/, ""), parts = base.split(/[-_ ]+/);
  const tail = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const W: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi ?bold|demi ?bold/i, 600],
    [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
  const weight = (W.find(([re]) => re.test(tail)) || [null, 400])[1] as number;
  const family = (parts.length > 1 ? parts[0] : base).replace(/([a-z])([A-Z])/g, "$1 $2");
  return { family: cleanFamily(family) || "Font", weight, style: /italic|oblique/i.test(tail) ? "italic" : "normal" };
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {   // WOFF tables are zlib streams
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
/** the sfnt tables we need: name and OS/2 (WOFF tables are inflated); null when the file is not readable */
async function tables(buf: ArrayBuffer): Promise<Record<string, DataView> | null> {
  const v = new DataView(buf), sig = v.getUint32(0), out: Record<string, DataView> = {};
  const want = (tag: string) => tag === "name" || tag === "OS/2";
  if (sig === 0x774F4646) {                      // 'wOFF'
    const n = v.getUint16(12);
    for (let i = 0; i < n; i++) {
      const e = 44 + i * 20, tag = String.fromCharCode(v.getUint8(e), v.getUint8(e + 1), v.getUint8(e + 2), v.getUint8(e + 3));
      if (!want(tag)) continue;
      const off = v.getUint32(e + 4), comp = v.getUint32(e + 8), orig = v.getUint32(e + 12);
      let bytes: Uint8Array = new Uint8Array(buf, off, comp);
      if (comp < orig) bytes = await inflate(bytes);
      out[tag] = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return out;
  }
  if (sig !== 0x00010000 && sig !== 0x4F54544F && sig !== 0x74727565) return null;   // TrueType, 'OTTO', 'true'
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const e = 12 + i * 16, tag = String.fromCharCode(v.getUint8(e), v.getUint8(e + 1), v.getUint8(e + 2), v.getUint8(e + 3));
    if (want(tag)) out[tag] = new DataView(buf, v.getUint32(e + 8), v.getUint32(e + 12));
  }
  return out;
}
function nameOf(t: DataView, ids: number[]): string {
  const count = t.getUint16(2), strOff = t.getUint16(4), found: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, plat = t.getUint16(r), enc = t.getUint16(r + 2), lang = t.getUint16(r + 4), id = t.getUint16(r + 6), len = t.getUint16(r + 8), off = t.getUint16(r + 10);
    if (!ids.includes(id) || found[id]) continue;
    let s = "";
    if (plat === 3 && (enc === 1 || enc === 10) && (lang & 0xFF) === 0x09) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(t.getUint16(strOff + off + k));
    else if (plat === 1 && enc === 0) for (let k = 0; k < len; k++) s += String.fromCharCode(t.getUint8(strOff + off + k));
    if (s) found[id] = s;
  }
  for (const id of ids) if (found[id]) return found[id];
  return "";
}
/** family (typographic family first), weight and italic from the font itself; the file name when unreadable */
export async function readFontInfo(buf: ArrayBuffer, fileName: string): Promise<FontInfo> {
  const guess = guessFromName(fileName);
  try {
    const t = await tables(buf); if (!t) return guess;
    const family = t.name ? cleanFamily(nameOf(t.name, [16, 1])) : "";
    const os2 = t["OS/2"], weight = os2 && os2.byteLength > 6 ? os2.getUint16(4) : guess.weight;
    const italic = os2 && os2.byteLength > 64 ? !!(os2.getUint16(62) & 1) : guess.style === "italic";
    return { family: family || guess.family, weight: weight >= 100 && weight <= 1000 ? Math.round(weight / 100) * 100 : guess.weight, style: italic ? "italic" : "normal" };
  } catch { return guess; }
}

/* ---- Google Fonts ---- */
export const googleCssUrl = (family: string, spec = ":ital,wght@0,400;0,700;1,400;1,700") =>
  "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(cleanFamily(family)).replace(/%20/g, "+") + spec + "&display=swap";
/** the @font-face blocks of a Google Fonts stylesheet; only the latin subsets when the sheet names subsets */
export function parseGoogleCss(css: string): { weight: number; style: "normal" | "italic"; url: string; range?: string }[] {
  const out: { weight: number; style: "normal" | "italic"; url: string; range?: string; subset: string }[] = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[2], url = /url\(([^)]+)\)/.exec(body)?.[1]?.replace(/["']/g, "");
    if (!url) continue;
    out.push({ subset: m[1] || "", weight: parseInt(/font-weight:\s*(\d+)/.exec(body)?.[1] || "400", 10), style: /font-style:\s*italic/.test(body) ? "italic" : "normal",
      url, range: /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() });
  }
  const named = out.some(x => x.subset);
  return out.filter(x => !named || x.subset === "latin" || x.subset === "latin-ext").map(({ subset: _s, ...x }) => x);
}
