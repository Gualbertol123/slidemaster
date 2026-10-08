/* Minimal TrueType reader + subsetter for the PDF spike.
   - reads cmap (format 4 / 12), hmtx, head, hhea, maxp, loca, glyf, OS/2, post
   - measures text with advance widths (no kerning, no ligatures: the same rule is used on screen)
   - subsets by keeping the glyph ids and emptying every unused glyph ("CID = GID"), plus composite
     components; tables needed by PDF viewers are kept, everything else is dropped.
   Real implementation: HarfBuzz hb-subset (WASM) for CFF and variable fonts, see docs/next/03. */

export interface Font {
  name: string; data: Uint8Array; tables: Map<string, { off: number; len: number }>;
  unitsPerEm: number; ascent: number; descent: number; capHeight: number; bbox: number[];
  numGlyphs: number; advances: Uint16Array; cmap: Map<number, number>; italicAngle: number; flags: number;
}
const u16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const i16 = (d: Uint8Array, o: number) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (d: Uint8Array, o: number) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];

export function parseFont(data: Uint8Array, name: string): Font {
  const tables = new Map<string, { off: number; len: number }>();
  const n = u16(data, 4);
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i, tag = String.fromCharCode(data[r], data[r + 1], data[r + 2], data[r + 3]);
    tables.set(tag, { off: u32(data, r + 8), len: u32(data, r + 12) });
  }
  const T = (t: string) => { const x = tables.get(t); if (!x) throw new Error("missing table " + t); return x.off; };
  const head = T("head"), hhea = T("hhea"), maxp = T("maxp"), hmtx = T("hmtx");
  const unitsPerEm = u16(data, head + 18), numGlyphs = u16(data, maxp + 4), nh = u16(data, hhea + 34);
  const advances = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) advances[g] = u16(data, hmtx + 4 * Math.min(g, nh - 1));
  const cmap = new Map<number, number>(), cm = T("cmap"), nsub = u16(data, cm + 2);
  let best = -1, fmtBest = 0;
  for (let i = 0; i < nsub; i++) {
    const pid = u16(data, cm + 4 + 8 * i), eid = u16(data, cm + 6 + 8 * i), off = cm + u32(data, cm + 8 + 8 * i), fmt = u16(data, off);
    if (pid === 3 && (eid === 1 || eid === 10) && (fmt === 4 || fmt === 12) && fmt >= fmtBest) { best = off; fmtBest = fmt; }
  }
  if (fmtBest === 4) {
    const segX2 = u16(data, best + 6), ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ro = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(data, ends + 2 * s), start = u16(data, starts + 2 * s), delta = i16(data, deltas + 2 * s), rOff = u16(data, ro + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (rOff === 0) g = (c + delta) & 0xffff;
        else { g = u16(data, ro + 2 * s + rOff + 2 * (c - start)); if (g) g = (g + delta) & 0xffff; }
        if (g) cmap.set(c, g);
      }
    }
  } else if (fmtBest === 12) {
    const ng = u32(data, best + 12);
    for (let i = 0; i < ng; i++) { const o = best + 16 + 12 * i, a = u32(data, o), b = u32(data, o + 4), g = u32(data, o + 8); for (let c = a; c <= b; c++) cmap.set(c, g + c - a); }
  }
  const os2 = tables.get("OS/2"), post = tables.get("post");
  const ascent = os2 ? i16(data, os2.off + 68) : i16(data, hhea + 4), descent = os2 ? i16(data, os2.off + 70) : i16(data, hhea + 6);
  const capHeight = os2 && u16(data, os2.off) >= 2 ? i16(data, os2.off + 88) : ascent;
  const italicAngle = post ? i16(data, post.off + 4) : 0;
  return { name, data, tables, unitsPerEm, ascent, descent, capHeight, italicAngle, numGlyphs, advances, cmap,
    bbox: [i16(data, head + 36), i16(data, head + 38), i16(data, head + 40), i16(data, head + 42)], flags: 32 | (italicAngle ? 64 : 0) };
}

export const glyphOf = (f: Font, cp: number) => f.cmap.get(cp) || 0;
/** width of a string in units of the font size (multiply by size) – identical rule on screen and in the PDF */
export function measure(f: Font, s: string): number {
  let w = 0; for (const ch of s) w += f.advances[glyphOf(f, ch.codePointAt(0)!)];
  return w / f.unitsPerEm;
}

/** a font file holding only the glyphs in `used` (+ .notdef and composite components) */
export function subset(f: Font, used: Set<number>): Uint8Array {
  const d = f.data, head = f.tables.get("head")!.off, longLoca = i16(d, head + 50) === 1;
  const loca = f.tables.get("loca")!.off, glyf = f.tables.get("glyf")!.off;
  const at = (g: number) => longLoca ? u32(d, loca + 4 * g) : 2 * u16(d, loca + 2 * g);
  const keep = new Set<number>([0, ...used]), stack = [...keep];
  while (stack.length) {                                   // composite glyphs pull in their components
    const g = stack.pop()!, a = at(g), b = at(g + 1);
    if (b > a && i16(d, glyf + a) < 0) {
      let p = glyf + a + 10, more = true;
      while (more) {
        const flags = u16(d, p), comp = u16(d, p + 2);
        if (!keep.has(comp)) { keep.add(comp); stack.push(comp); }
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        more = !!(flags & 0x20);
      }
    }
  }
  const parts: Uint8Array[] = [], offs: number[] = []; let pos = 0;
  for (let g = 0; g < f.numGlyphs; g++) {
    offs.push(pos);
    if (keep.has(g)) { const a = at(g), b = at(g + 1); if (b > a) { const len = (b - a + 3) & ~3, p = new Uint8Array(len); p.set(d.subarray(glyf + a, glyf + b)); parts.push(p); pos += len; } }
  }
  offs.push(pos);
  const newGlyf = new Uint8Array(pos); { let o = 0; for (const p of parts) { newGlyf.set(p, o); o += p.length; } }
  const newLoca = new Uint8Array(4 * offs.length); offs.forEach((v, i) => { newLoca[4 * i] = v >>> 24; newLoca[4 * i + 1] = (v >> 16) & 255; newLoca[4 * i + 2] = (v >> 8) & 255; newLoca[4 * i + 3] = v & 255; });
  const newHead = d.slice(head, head + 54); newHead[50] = 0; newHead[51] = 1; newHead[8] = newHead[9] = newHead[10] = newHead[11] = 0;   // long loca, checksum adj 0
  const out = new Map<string, Uint8Array>();
  for (const t of ["cvt ", "fpgm", "prep", "hhea", "hmtx", "maxp", "OS/2", "post"]) { const x = f.tables.get(t); if (x) out.set(t, d.slice(x.off, x.off + x.len)); }
  const post = out.get("post"); if (post) { const p = post.slice(0, 32); p[0] = 0; p[1] = 3; p[2] = p[3] = 0; out.set("post", p); }   // post 3.0: no glyph names
  out.set("head", newHead); out.set("loca", newLoca); out.set("glyf", newGlyf);
  return buildSfnt(out);
}
function buildSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort(), n = tags.length;
  let size = 12 + 16 * n; for (const t of tags) size += (tables.get(t)!.length + 3) & ~3;
  const o = new Uint8Array(size), w16 = (p: number, v: number) => { o[p] = v >> 8; o[p + 1] = v & 255; }, w32 = (p: number, v: number) => { o[p] = v >>> 24; o[p + 1] = (v >> 16) & 255; o[p + 2] = (v >> 8) & 255; o[p + 3] = v & 255; };
  w32(0, 0x00010000); w16(4, n); let es = 0; while (1 << (es + 1) <= n) es++; w16(6, 16 << es); w16(8, es); w16(10, n * 16 - (16 << es));
  let pos = 12 + 16 * n;
  tags.forEach((t, i) => {
    const b = tables.get(t)!, r = 12 + 16 * i; for (let k = 0; k < 4; k++) o[r + k] = t.charCodeAt(k);
    let sum = 0; for (let k = 0; k < b.length; k += 4) sum = (sum + ((b[k] << 24) | ((b[k + 1] || 0) << 16) | ((b[k + 2] || 0) << 8) | (b[k + 3] || 0))) >>> 0;
    w32(r + 4, sum); w32(r + 8, pos); w32(r + 12, b.length); o.set(b, pos); pos += (b.length + 3) & ~3;
  });
  return o;
}
