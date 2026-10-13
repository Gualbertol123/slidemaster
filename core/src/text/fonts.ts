/* The font registry (03 §2.5, ADR-005): every font face the core draws or measures with, by the SHA-1 of its sfnt
   bytes (for a plain .ttf/.otf the hash the helper names library files with; for WOFF and collections the hash of
   the unpacked face). Sources: the shared library (data/fonts), the Windows fonts
   the helper serves (GET /sysfonts/<file>), anything a host adds. A text node's (family, bold, italic) resolves to
   a face as CSS does (the family by name, the nearest weight, italic preferred), so the PDF uses the file the
   screen uses. Fonts are plain bytes here; WOFF is unpacked to sfnt, a collection (.ttc) is split into its faces. */
import { fvarAxes } from "./fvar";
import { unzlibSync } from "fflate";
import { weightOf, type TextNode } from "../dl/types";
import { parseFont, type Font } from "../pdf/ttf";
import { sha1 } from "./sha1";

export interface FaceInfo {
  /** SHA-1 of the sfnt bytes */
  id: string;
  family: string; weight: number; italic: boolean;
  source: "library" | "system" | "other";
  /** the file it came from (library or system file name), for messages */
  file?: string;
  data: Uint8Array;
  font: Font;
  /** has an fvar table (a variable font: instanced before use, never embedded as is) */
  variable: boolean;
}

const u16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const u32 = (d: Uint8Array, o: number) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
const tag = (d: Uint8Array, o: number) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

/** an sfnt from its tables (tags sorted, 4-byte aligned, checksums) */
export function buildSfnt(flavor: number, tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort(), n = tags.length;
  let size = 12 + 16 * n; for (const t of tags) size += (tables.get(t)!.length + 3) & ~3;
  const o = new Uint8Array(size), w16 = (p: number, v: number) => { o[p] = v >> 8; o[p + 1] = v & 255; };
  const w32 = (p: number, v: number) => { o[p] = v >>> 24; o[p + 1] = (v >> 16) & 255; o[p + 2] = (v >> 8) & 255; o[p + 3] = v & 255; };
  w32(0, flavor); w16(4, n); let es = 0; while (1 << (es + 1) <= n) es++; w16(6, 16 << es); w16(8, es); w16(10, n * 16 - (16 << es));
  let pos = 12 + 16 * n;
  tags.forEach((t, i) => {
    const b = tables.get(t)!, r = 12 + 16 * i; for (let k = 0; k < 4; k++) o[r + k] = t.charCodeAt(k);
    let sum = 0; for (let k = 0; k < b.length; k += 4) sum = (sum + ((b[k] << 24) | ((b[k + 1] || 0) << 16) | ((b[k + 2] || 0) << 8) | (b[k + 3] || 0))) >>> 0;
    w32(r + 4, sum); w32(r + 8, pos); w32(r + 12, b.length); o.set(b, pos); pos += (b.length + 3) & ~3;
  });
  return o;
}

/** the sfnt font(s) in a file: TrueType / OpenType as is, WOFF unpacked, a collection split into its faces.
    WOFF2 needs Brotli and glyf reconstruction: not supported (the library keeps such files for the screen only) */
export function sfntFaces(d: Uint8Array): Uint8Array[] {
  const sig = tag(d, 0);
  if (sig === "wOFF") {
    const n = u16(d, 12), tables = new Map<string, Uint8Array>();
    for (let i = 0; i < n; i++) {
      const e = 44 + 20 * i, t = tag(d, e), off = u32(d, e + 4), comp = u32(d, e + 8), orig = u32(d, e + 12);
      const raw = d.subarray(off, off + comp);
      tables.set(t, comp < orig ? unzlibSync(raw) : raw.slice());
    }
    return [buildSfnt(u32(d, 4), tables)];
  }
  if (sig === "wOF2") throw new Error("WOFF2 fonts cannot be read by the core yet (no Brotli decoder)");
  if (sig === "ttcf") {
    const n = u32(d, 8), out: Uint8Array[] = [];
    for (let f = 0; f < n; f++) {
      const at = u32(d, 12 + 4 * f), nt = u16(d, at + 4), tables = new Map<string, Uint8Array>();
      for (let i = 0; i < nt; i++) { const r = at + 12 + 16 * i; tables.set(tag(d, r), d.slice(u32(d, r + 8), u32(d, r + 8) + u32(d, r + 12))); }
      out.push(buildSfnt(u32(d, at), tables));
    }
    return out;
  }
  if (sig === "\x00\x01\x00\x00" || sig === "OTTO" || sig === "true") return [d];
  throw new Error("not a font file");
}

/** a name-table string (Windows Unicode English first, then Mac Roman) */
export function fontName(f: Font, ids: number[]): string {
  const t = f.tables.get("name"); if (!t) return "";
  const d = f.data, o = t.off, count = u16(d, o + 2), strings = o + u16(d, o + 4), found = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = o + 6 + 12 * i, pid = u16(d, r), eid = u16(d, r + 2), lang = u16(d, r + 4), id = u16(d, r + 6), len = u16(d, r + 8), off = u16(d, r + 10);
    if (!ids.includes(id) || found.has(id)) continue;
    const b = d.subarray(strings + off, strings + off + len);
    if (pid === 3 && (eid === 1 || eid === 10) && (lang & 0xff) === 0x09) found.set(id, String.fromCharCode(...Array.from({ length: len >> 1 }, (_, k) => u16(b, 2 * k))));
    else if (pid === 1 && eid === 0 && !found.has(id)) found.set(id, String.fromCharCode(...b));
  }
  for (const id of ids) if (found.get(id)) return found.get(id)!;
  return "";
}
/** family (typographic first), weight class and italic of a font, as readFontInfo reads them for the library */
export function faceStyle(f: Font): { family: string; weight: number; italic: boolean } {
  const os2 = f.tables.get("OS/2"), d = f.data;
  const weight = os2 && os2.len > 6 ? u16(d, os2.off + 4) : 400;
  const italic = os2 && os2.len > 64 ? !!(u16(d, os2.off + 62) & 1) : f.italicAngle !== 0;
  return { family: fontName(f, [16, 1]) || f.name, weight: weight >= 1 && weight <= 1000 ? weight : 400, italic };
}

export class FontRegistry {
  private byId = new Map<string, FaceInfo>();
  private byFamily = new Map<string, FaceInfo[]>();

  /** add a font file's faces (meta overrides what the file says, e.g. the library's family name and weight) */
  add(file: Uint8Array, meta: Partial<Pick<FaceInfo, "family" | "weight" | "italic" | "source" | "file">> = {}): FaceInfo[] {
    const out: FaceInfo[] = [];
    for (const data of sfntFaces(file)) {
      const id = sha1(data);
      let face = this.byId.get(id);
      if (!face) {
        const font = parseFont(data, id), st = faceStyle(font);
        face = { id, family: st.family, weight: st.weight, italic: st.italic, source: "other", data, font, variable: font.tables.has("fvar") };
        this.byId.set(id, face);
      }
      const f: FaceInfo = { ...face, ...defined(meta) };
      if (f.family !== face.family || f.weight !== face.weight || f.italic !== face.italic || f.source !== face.source || f.file !== face.file) this.byId.set(id, f);
      const key = f.family.toLowerCase(), list = this.byFamily.get(key) || [];
      if (!list.some(x => x.id === id && x.weight === f.weight && x.italic === f.italic)) list.push(f);
      this.byFamily.set(key, list);
      out.push(f);
    }
    return out;
  }
  get(id: string) { return this.byId.get(id) || null; }
  families() { return [...new Set([...this.byFamily.values()].map(l => l[0].family))].sort(); }
  /** the face for a family, bold and italic: CSS font matching (CSS Fonts 4 §5.2: the style first, then the weight –
      for 700 heavier ones ascending, then lighter ones descending; for 400 up to 500 ascending, then lighter ones
      descending, then heavier ones ascending) */
  match(family: string, bold: boolean | number = false, italic = false): FaceInfo | null {
    let list = this.byFamily.get(family.trim().toLowerCase());
    // "Segoe UI Variable Display" / "… Text" / "… Small": Windows lists a variable font's optical-size instances as
    // families of their own; the font itself is "Segoe UI Variable" (its opsz is pinned to the size, text/pdf.ts)
    if (!list?.length) {
      const m = /^(.*\S)\s+(Display|Text|Small)$/i.exec(family.trim());
      const base = m ? this.byFamily.get(m[1].toLowerCase()) : undefined;
      const opsz = base?.filter(f => f.variable && fvarAxes(f.data).some(a => a.tag === "opsz"));
      if (opsz?.length) list = opsz;
    }
    if (!list?.length) return null;
    const styled = list.filter(f => f.italic === italic), pool = styled.length ? styled : list;
    const want = typeof bold === "number" ? bold : bold ? 700 : 400;
    // a Windows font: DirectWrite's nearest weight, as Chromium draws it (resolve.ts pickFace)
    if (pool.every(f => f.source === "system" && !f.variable)) return [...pool].sort((a, b) => Math.abs(a.weight - want) - Math.abs(b.weight - want) || (want >= 400 ? b.weight - a.weight : a.weight - b.weight))[0];
    const rank = (w: number) => w === want ? 0
      : want > 500 ? (w > want ? w - want : 1000 + want - w)
      : want < 400 ? (w < want ? want - w : 1000 + w - want)
      : (w > want && w <= 500 ? w - want : w < want ? 100 + want - w : 1000 + w);
    // equal weights: a static face before a variable one (instanced static copies stand in for it)
    return [...pool].sort((a, b) => rank(a.weight) - rank(b.weight) || Number(a.variable) - Number(b.variable))[0];
  }
  /** the PDF writer's font callback: the file of a text node's face */
  pdfFace = (n: TextNode) => {
    const f = this.match(n.font, weightOf(n), !!n.i);
    // synthetic styles, as Chrome draws them: italic asked of a face without one is slanted; bold (600 and above)
    // asked of a lighter static face is emboldened
    return f ? { key: f.id, data: f.data, ...(n.i && !f.italic ? { oblique: true } : {}), ...(weightOf(n) >= 600 && f.weight < 600 && !f.variable ? { bold: true } : {}) } : undefined;
  };
}
function defined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  return r;
}
