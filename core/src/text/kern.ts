/* The legacy TrueType 'kern' table (format 0 pairs), applied as HarfBuzz applies it in Chromium: only when the font's
   GPOS has no 'kern' feature (Segoe UI Italic, for one, kerns "Va" or "Yo" only there). The harfbuzzjs build the
   core carries leaves the legacy table out (a lean build), so the shaper adds these pairs itself (S4.4: the measured
   widths are the screen's). */
import type { Font } from "../pdf/ttf";

const u16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const i16 = (d: Uint8Array, o: number) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };

/** whether a GPOS table lists a 'kern' feature */
function gposKerns(f: Font): boolean {
  const t = f.tables.get("GPOS"); if (!t) return false;
  const d = f.data, list = t.off + u16(d, t.off + 6), n = u16(d, list);
  for (let i = 0; i < n; i++) if (String.fromCharCode(d[list + 2 + 6 * i], d[list + 3 + 6 * i], d[list + 4 + 6 * i], d[list + 5 + 6 * i]) === "kern") return true;
  return false;
}
/** the kern pairs (left glyph << 16 | right glyph → value in font units), or null when HarfBuzz would not use them */
export function legacyKern(f: Font): Map<number, number> | null {
  const t = f.tables.get("kern"); if (!t || gposKerns(f)) return null;
  const d = f.data;
  if (u16(d, t.off) !== 0) return null;                     // version 0 (Microsoft); Apple's version 1 is not on Windows
  const pairs = new Map<number, number>();
  let o = t.off + 4;
  for (let s = 0, n = u16(d, t.off + 2); s < n; s++) {
    const len = u16(d, o + 2), cov = u16(d, o + 4), format = cov >> 8;
    // horizontal kerning values, not minimums, not cross-stream
    if (format === 0 && (cov & 1) && !(cov & 2) && !(cov & 4)) {
      const np = u16(d, o + 6), override = (cov & 8) !== 0;
      for (let i = 0; i < np; i++) {
        const p = o + 14 + 6 * i, key = (u16(d, p) << 16 | u16(d, p + 2)) >>> 0, v = i16(d, p + 4);
        pairs.set(key, override ? v : (pairs.get(key) ?? 0) + v);
      }
    }
    o += len;
  }
  return pairs.size ? pairs : null;
}
