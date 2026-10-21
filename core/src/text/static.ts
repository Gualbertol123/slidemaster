/* A static face of an uploaded variable font (PLAN S3.2): the wght axis at the weight the upload declares, every
   other axis at its default – what the browser draws for that @font-face today, so the screen does not change –
   and no variation tables left, so the PDF never embeds a variable font. Fonts that are not variable come back
   unchanged; so do files the core cannot read (WOFF2), which keep working on screen as before. */
import { buildSfnt, fontName, sfntFaces } from "./fonts";
import type { Font } from "../pdf/ttf";
import { fvarAxes } from "./fvar";
import { hbSubsetter, instanceFont, isVariable } from "./subset";

export async function staticFace(file: Uint8Array, weight: number, style: { family?: string; italic?: boolean } = {}): Promise<{ data: Uint8Array; variable: boolean }> {
  let faces: Uint8Array[];
  try { faces = sfntFaces(file); } catch { return { data: file, variable: false }; }
  if (faces.length !== 1 || !isVariable(faces[0])) return { data: file, variable: false };
  // the screen applies wght from the declared weight (one value: Chrome pins the axis to it), but also opsz from the
  // font size (font-optical-sizing: auto) and wdth / slnt / ital from font-stretch and font-style: a font with any
  // axis other than wght, whose default is not what the browser would pick, would look different once pinned. Such
  // a font is stored as it is (prepareTextForPdf instances it for the PDF as the screen draws it: wght at the
  // declared weight, opsz at the run's size)
  const axes = fvarAxes(faces[0]), browserDefault: Record<string, number> = { wdth: 100, slnt: 0, ital: 0 };
  if (axes.some(a => a.tag !== "wght" && !(a.tag in browserDefault && a.def === browserDefault[a.tag]))) return { data: file, variable: false };
  const hb = await hbSubsetter(), pin: Record<string, number> = {};
  if (axes.some(a => a.tag === "wght")) pin.wght = weight;
  return { data: nameStaticFace(instanceFont(hb, faces[0], pin), weight, style), variable: true };
}

const WEIGHTS: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
const STYLE_WORD = /\s+(thin|hairline|extra|ultra|semi|demi|light|regular|normal|book|medium|bold|extrabold|ultrabold|semibold|demibold|extralight|ultralight|black|heavy|italic|oblique)$/i;

/** B45: an instance keeps the variable font's default names ("Quicksand Light", PostScript "Quicksand-Light") for
    every weight. The stored face is named for itself: family (the one chosen, else the font's typographic family),
    Regular / Bold / Italic / Bold Italic (another weight: its own family "Family Light", 16 / 17 typographic), full
    and PostScript names, and the fsSelection / macStyle bits to match. A font without a name table (or unreadable)
    comes back as it is */
export function nameStaticFace(data: Uint8Array, weight: number, style: { family?: string; italic?: boolean } = {}): Uint8Array {
  try {
    const u16 = (o: number) => (data[o] << 8) | data[o + 1], u32 = (o: number) => ((data[o] << 24) >>> 0) + (data[o + 1] << 16) + (data[o + 2] << 8) + data[o + 3];
    const tables = new Map<string, Uint8Array>(), at = new Map<string, { off: number; len: number }>();
    for (let i = 0, n = u16(4); i < n; i++) {
      const r = 12 + 16 * i, t = String.fromCharCode(data[r], data[r + 1], data[r + 2], data[r + 3]), off = u32(r + 8), len = u32(r + 12);
      at.set(t, { off, len }); tables.set(t, data.slice(off, off + len));
    }
    const name = tables.get("name"); if (!name || name.length < 6) return data;
    const os2 = tables.get("OS/2"), head = tables.get("head"), font = { data, tables: at } as unknown as Font;
    let family = (style.family || "").trim();
    if (!family) { family = fontName(font, [16]); if (!family) { family = fontName(font, [1]); while (STYLE_WORD.test(family)) family = family.replace(STYLE_WORD, ""); } }
    if (!family) return data;
    const italic = style.italic ?? (os2 && os2.length > 63 ? !!(os2[63] & 1) : head && head.length > 45 ? !!(head[45] & 2) : false);
    const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100)), ribbi = w === 400 || w === 700, bold = w === 700;
    const sub = (bold ? "Bold" : "Regular") + (italic ? " Italic" : ""), sub2 = ribbi ? (bold ? "Bold" : "") : WEIGHTS[w];
    const typo = (ribbi ? sub : WEIGHTS[w] + (italic ? " Italic" : "")).replace(/^Regular Italic$/, "Italic");
    const ps = ((family.replace(/[^A-Za-z0-9]/g, "") || "Font").slice(0, 40) + "-" + typo.replace(/ /g, "")).slice(0, 63);
    const set = new Map<number, string>([[1, ribbi ? family : family + " " + sub2], [2, sub.replace(/^Regular Italic$/, "Italic")], [3, ps], [4, family + (typo === "Regular" ? " Regular" : " " + typo)], [6, ps]]);
    if (!ribbi) { set.set(16, family); set.set(17, typo); }
    // the other records stay (copyright, version, licence, STAT's names ≥ 256…); these, the WWS names (21 / 22) and
    // the variations' PostScript prefix (25) are written again or dropped
    const drop = new Set([1, 2, 3, 4, 6, 16, 17, 21, 22, 25]), recs: { pid: number; eid: number; lang: number; id: number; b: Uint8Array }[] = [];
    const count = (name[2] << 8) | name[3], str = (name[4] << 8) | name[5];
    for (let i = 0; i < count; i++) {
      const r = 6 + 12 * i, g = (o: number) => (name[r + o] << 8) | name[r + o + 1], id = g(6);
      if (!drop.has(id)) recs.push({ pid: g(0), eid: g(2), lang: g(4), id, b: name.subarray(str + g(10), str + g(10) + g(8)) });
    }
    for (const [id, v] of set) { const b = new Uint8Array(2 * v.length); for (let k = 0; k < v.length; k++) { b[2 * k] = v.charCodeAt(k) >> 8; b[2 * k + 1] = v.charCodeAt(k) & 255; } recs.push({ pid: 3, eid: 1, lang: 0x409, id, b }); }
    recs.sort((a, b) => a.pid - b.pid || a.eid - b.eid || a.lang - b.lang || a.id - b.id);
    const size = recs.reduce((s, r) => s + r.b.length, 0), out = new Uint8Array(6 + 12 * recs.length + size), w16 = (o: number, v: number) => { out[o] = v >> 8; out[o + 1] = v & 255; };
    w16(2, recs.length); w16(4, 6 + 12 * recs.length);
    let p = 0;
    recs.forEach((r, i) => { const o = 6 + 12 * i; w16(o, r.pid); w16(o + 2, r.eid); w16(o + 4, r.lang); w16(o + 6, r.id); w16(o + 8, r.b.length); w16(o + 10, p); out.set(r.b, 6 + 12 * recs.length + p); p += r.b.length; });
    tables.set("name", out);
    if (os2 && os2.length > 63) { const f = (((os2[62] << 8) | os2[63]) & ~(1 | 32 | 64)) | (italic ? 1 : 0) | (bold ? 32 : 0) | (!italic && !bold ? 64 : 0); os2[62] = f >> 8; os2[63] = f & 255; }
    tables.delete("DSIG");                                   // a signature of the old bytes
    if (head && head.length > 45) {
      head[45] = (head[45] & ~3) | (bold ? 1 : 0) | (italic ? 2 : 0);
      head.fill(0, 8, 12);
      const o = buildSfnt(u32(0), tables);
      let sum = 0; for (let k = 0; k < o.length; k += 4) sum = (sum + ((o[k] << 24) | (o[k + 1] << 16) | (o[k + 2] << 8) | o[k + 3])) >>> 0;
      // head.checkSumAdjustment: the whole font sums to 0xB1B0AFBA (head's own directory checksum is taken with it 0)
      const adj = (0xb1b0afba - sum) >>> 0, r = 12 + 16 * [...tables.keys()].sort().indexOf("head");
      const hoff = ((o[r + 8] << 24) >>> 0) + (o[r + 9] << 16) + (o[r + 10] << 8) + o[r + 11];
      o[hoff + 8] = adj >>> 24; o[hoff + 9] = (adj >> 16) & 255; o[hoff + 10] = (adj >> 8) & 255; o[hoff + 11] = adj & 255;
      return o;
    }
    return buildSfnt(u32(0), tables);
  } catch { return data; }
}

export { fvarAxes } from "./fvar";
