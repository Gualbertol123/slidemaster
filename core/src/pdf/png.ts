/* PNG → 8-bit RGB + alpha for the PDF writer (pictures with transparency become an image with an SMask). Every
   colour type and bit depth of PNG 1.2, interlaced or not; 16-bit samples keep their high byte. */
import { unzlibSync } from "fflate";

export interface Raster { w: number; h: number; rgb: Uint8Array; /** null = opaque */ alpha: Uint8Array | null }

const u32 = (d: Uint8Array, o: number) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
export const isPng = (d: Uint8Array) => d.length > 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;
export const isJpeg = (d: Uint8Array) => d.length > 3 && d[0] === 0xff && d[1] === 0xd8;

export function decodePng(d: Uint8Array): Raster {
  if (!isPng(d)) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= d.length) {
    const len = u32(d, p), tag = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]), body = d.subarray(p + 8, p + 8 + len);
    if (tag === "IHDR") { w = u32(body, 0); h = u32(body, 4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (tag === "PLTE") palette = body;
    else if (tag === "tRNS") trns = body;
    else if (tag === "IDAT") idat.push(body);
    else if (tag === "IEND") break;
    p += 12 + len;
  }
  if (!w || !h) throw new Error("PNG without a header");
  const total = idat.reduce((s, c) => s + c.length, 0), z = new Uint8Array(total);
  { let o = 0; for (const c of idat) { z.set(c, o); o += c.length; } }
  const raw = unzlibSync(z);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error("PNG colour type " + type);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h).fill(255);
  let hasAlpha = false;
  const sample = (row: Uint8Array, i: number): number => {          // the i-th sample of a row, scaled to 0–255 (or a palette index)
    if (depth === 8) return row[i];
    if (depth === 16) return row[2 * i];
    const per = 8 / depth, byte = row[(i / per) | 0], shift = 8 - depth * (i % per + 1), v = (byte >> shift) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
  };
  const sample16 = (row: Uint8Array, i: number) => depth === 16 ? (row[2 * i] << 8) | row[2 * i + 1] : -1;
  const put = (x: number, y: number, row: Uint8Array, k: number) => {
    const o = y * w + x;
    if (type === 3) {
      const idx = sample(row, k);
      rgb[3 * o] = palette![3 * idx]; rgb[3 * o + 1] = palette![3 * idx + 1]; rgb[3 * o + 2] = palette![3 * idx + 2];
      if (trns && idx < trns.length) { alpha[o] = trns[idx]; if (trns[idx] < 255) hasAlpha = true; }
      return;
    }
    const s = k * channels;
    const g0 = sample(row, s);
    if (type === 0 || type === 4) {
      rgb[3 * o] = rgb[3 * o + 1] = rgb[3 * o + 2] = g0;
      if (type === 4) { alpha[o] = sample(row, s + 1); if (alpha[o] < 255) hasAlpha = true; }
      else if (trns && trns.length >= 2) {
        const key = (trns[0] << 8) | trns[1], v = depth === 16 ? sample16(row, s) : depth === 8 ? row[s] : (sample(row, s) * ((1 << depth) - 1) / 255);
        if (Math.round(v) === key) { alpha[o] = 0; hasAlpha = true; }
      }
    } else {
      rgb[3 * o] = g0; rgb[3 * o + 1] = sample(row, s + 1); rgb[3 * o + 2] = sample(row, s + 2);
      if (type === 6) { alpha[o] = sample(row, s + 3); if (alpha[o] < 255) hasAlpha = true; }
      else if (trns && trns.length >= 6) {
        const key = depth === 16 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : [trns[1], trns[3], trns[5]];
        const v = depth === 16 ? [sample16(row, s), sample16(row, s + 1), sample16(row, s + 2)] : [row[s], row[s + 1], row[s + 2]];
        if (v[0] === key[0] && v[1] === key[1] && v[2] === key[2]) { alpha[o] = 0; hasAlpha = true; }
      }
    }
  };
  /** unfilter one pass of pw × ph pixels starting at `at`; calls back each row */
  const pass = (at: number, pw: number, ph: number, row: (y: number, data: Uint8Array) => void): number => {
    if (!pw || !ph) return at;
    const stride = Math.ceil(pw * channels * depth / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const ft = raw[at++];
      for (let i = 0; i < stride; i++) {
        const x = raw[at++], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        switch (ft) {
          case 0: v = x; break;
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: throw new Error("PNG filter " + ft);
        }
        cur[i] = v & 255;
      }
      row(y, cur);
      [prev, cur] = [cur, prev];
    }
    return at;
  };
  if (!interlace) pass(0, w, h, (y, r) => { for (let x = 0; x < w; x++) put(x, y, r, x); });
  else {
    const A = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
    let at = 0;
    for (const [x0, y0, dx, dy] of A) {
      const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
      if (x0 >= w || y0 >= h) continue;
      at = pass(at, pw, ph, (y, r) => { for (let k = 0; k < pw; k++) put(x0 + k * dx, y0 + y * dy, r, k); });
    }
  }
  return { w, h, rgb, alpha: hasAlpha ? alpha : null };
}

/** width, height, components and Adobe (inverted CMYK) flag of a JPEG */
export function jpegInfo(d: Uint8Array): { w: number; h: number; comps: number; adobe: boolean } {
  let p = 2, adobe = false;
  while (p + 4 <= d.length) {
    if (d[p] !== 0xff) { p++; continue; }
    const m = d[p + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (d[p + 2] << 8) | d[p + 3];
    if (m === 0xee && String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7], d[p + 8]) === "Adobe") adobe = true;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { h: (d[p + 5] << 8) | d[p + 6], w: (d[p + 7] << 8) | d[p + 8], comps: d[p + 9], adobe };
    p += 2 + len;
  }
  throw new Error("not a JPEG");
}
