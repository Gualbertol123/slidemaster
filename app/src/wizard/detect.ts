/* Table suggestions: blocks of filled cells (one empty row is bridged; an empty column separates tables). */
import { tone } from "@slide-builder/core/xlsx/color";
import { A1 } from "@slide-builder/core/xlsx/util";
import type { Cell, Sheet } from "@slide-builder/core/xlsx/types";

export function usedRange(S: Sheet) {
  let r2 = 1, c2 = 1;
  for (const x of S.cells.values()) { if ((x.t !== "blank" && String(x.v ?? "").trim() !== "") || (x.xf && x.xf.fill)) { if (x.r > r2) r2 = x.r; if (x.c > c2) c2 = x.c; } }
  return { r2: Math.min(r2, 400), c2: Math.min(c2, 80), clipped: r2 > 400 || c2 > 80 };
}
export function detectTables(S: Sheet): string[] {
  const occ = new Map<string, Cell>(), U = usedRange(S);
  for (const x of S.cells.values()) {
    if (x.r > U.r2 || x.c > U.c2 || S.rowHidden(x.r) || S.colHidden(x.c)) continue;
    const has = (x.t !== "blank" && String(x.v ?? "").trim() !== "" && String(x.v).trim().toLowerCase() !== "x") || (x.xf && x.xf.fill && tone(x.xf.fill));
    if (has && !(x.r === 1 && x.c === 1)) occ.set(x.r + "," + x.c, x);
  }
  const seen = new Set<string>(), boxes: { r1: number; c1: number; r2: number; c2: number; n: number }[] = [];
  for (const [k, x] of occ) {
    if (seen.has(k)) continue;
    const q = [x]; seen.add(k); const b = { r1: x.r, c1: x.c, r2: x.r, c2: x.c, n: 0 };
    while (q.length) {
      const p = q.pop()!; b.n++; b.r1 = Math.min(b.r1, p.r); b.r2 = Math.max(b.r2, p.r); b.c1 = Math.min(b.c1, p.c); b.c2 = Math.max(b.c2, p.c);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const key = (p.r + dr) + "," + (p.c + dc);
        if (occ.has(key) && !seen.has(key)) { seen.add(key); q.push(occ.get(key)!); }
      }
    }
    if (b.r2 - b.r1 >= 1 && b.c2 - b.c1 >= 1 && b.n >= 4) boxes.push(b);
  }
  // merge overlapping boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      if (a.r1 <= c.r2 && a.r2 >= c.r1 && a.c1 <= c.c2 && a.c2 >= c.c1) { boxes[i] = { r1: Math.min(a.r1, c.r1), c1: Math.min(a.c1, c.c1), r2: Math.max(a.r2, c.r2), c2: Math.max(a.c2, c.c2), n: a.n + c.n }; boxes.splice(j, 1); merged = true; break; }
    }
  }
  return boxes.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1).map(b => A1(b.r1, b.c1) + ":" + A1(b.r2, b.c2));
}
