/* A variable font's axes (its fvar table), read without any other module: fonts.ts and static.ts both need it. */
/** the axes of an fvar table: tag, minimum, default and maximum */
export function fvarAxes(d: Uint8Array): { tag: string; def: number; min: number; max: number }[] {
  const n = (d[4] << 8) | d[5], out: { tag: string; def: number; min: number; max: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i;
    if (String.fromCharCode(d[r], d[r + 1], d[r + 2], d[r + 3]) !== "fvar") continue;
    const at = ((d[r + 8] << 24) >>> 0) + (d[r + 9] << 16) + (d[r + 10] << 8) + d[r + 11];
    const axesAt = at + ((d[at + 4] << 8) | d[at + 5]), count = (d[at + 8] << 8) | d[at + 9], size = (d[at + 10] << 8) | d[at + 11];
    for (let k = 0; k < count; k++) {
      const p = axesAt + k * size, fixed = (o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) / 65536;
      out.push({ tag: String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]), min: fixed(p + 4), def: fixed(p + 8), max: fixed(p + 12) });
    }
  }
  return out;
}
