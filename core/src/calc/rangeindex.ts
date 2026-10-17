/* A range that ends where INDEX points – `SUM(D7:INDEX(D7:O7,1,MATCH(…)))`, an Excel idiom for "from January to the
   chosen month" – is a reference IronCalc does not build (#VALUE!; found on the product owner's real deck,
   2026-10-18). The same range written with OFFSET it does: `A:INDEX(R, i, j)` is `OFFSET(A, 0, 0, h, w)` with h and w
   counted from A to the cell INDEX names. Rewritten in the formula's text before the engine reads it (engine.ts prep);
   what this cannot say (INDEX over another sheet than A's, a 2-D range with one index, a 0 index) is left as written. */

const CELL = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})$/;
const colNum = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const cellOf = (s: string) => { const m = CELL.exec(s); return m ? { r: +m[4], c: colNum(m[2]) } : null; };
const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!";
const START = new RegExp(`(${SHEET})?(\\$?[A-Z]{1,3}\\$?\\d{1,7}):((?:_xlfn\\.)?INDEX)\\s*\\(`, "gi");
const RANGE = new RegExp(`^(${SHEET})?(\\$?[A-Z]{1,3}\\$?\\d{1,7})(?::(\\$?[A-Z]{1,3}\\$?\\d{1,7}))?$`, "i");

/** the formula with every `A:INDEX(R, …)` it can rewrite as OFFSET (the text without "="; unchanged otherwise) */
export function rewriteRangeIndex(formula: string): string {
  if (!/:\s*(?:_xlfn\.)?INDEX\s*\(/i.test(formula)) return formula;
  let out = formula;
  for (let guard = 0; guard < 20; guard++) {
    const next = rewriteOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}
/** INDEX(R, i1, j1):INDEX(R, i2, j2) over the same R – the range between two INDEX results – is
    OFFSET(R's first cell, i1-1, j1-1, i2-i1+1, j2-j1+1) (with one index each over a row or a column range) */
function rewriteIndexIndex(f: string): string {
  const rx = /(^|[^\w.$:])((?:_xlfn\.)?INDEX)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(f))) {
    const start = m.index + m[1].length;
    if (inString(f, start)) continue;
    const a1 = splitArgs(f, m.index + m[0].length); if (!a1) continue;
    const after = /^\s*:\s*((?:_xlfn\.)?INDEX)\s*\(/i.exec(f.slice(a1.end)); if (!after) continue;
    const a2 = splitArgs(f, a1.end + after[0].length); if (!a2) continue;
    const R = a1.list[0].trim();
    if (R.toLowerCase() !== a2.list[0].trim().toLowerCase()) continue;
    const r = RANGE.exec(R); if (!r) continue;
    const r0 = cellOf(r[2].toUpperCase()), r1 = r[3] ? cellOf(r[3].toUpperCase()) : r0;
    if (!r0 || !r1) continue;
    const ij = (list: string[]): [string, string] | null => list.length === 3 ? [list[1].trim(), list[2].trim()]
      : list.length === 2 && r0.r === r1.r ? ["1", list[1].trim()] : list.length === 2 && r0.c === r1.c ? [list[1].trim(), "1"] : null;
    const p = ij(a1.list), q = ij(a2.list);
    if (!p || !q || [...p, ...q].some(e => !e || /^0+$/.test(e))) continue;
    const first = (r[1] || "") + r[2];
    const repl = `OFFSET(${first},(${p[0]})-1,(${p[1]})-1,(${q[0]})-(${p[0]})+1,(${q[1]})-(${p[1]})+1)`;
    return f.slice(0, start) + repl + f.slice(a2.end);
  }
  return f;
}
function rewriteOnce(f: string): string {
  const ii = rewriteIndexIndex(f);
  if (ii !== f) return ii;
  START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START.exec(f))) {
    if (inString(f, m.index)) continue;
    const before = f[m.index - 1];
    if (before && /[\w$.:]/.test(before)) continue;                 // part of a longer token (B2:C3:INDEX…)
    const open = m.index + m[0].length, args = splitArgs(f, open);
    if (!args) continue;
    const prefix = m[1] || "", a = cellOf(m[2].toUpperCase()), r = RANGE.exec(args.list[0].trim());
    if (!a || !r || (r[1] || "").toLowerCase() !== prefix.toLowerCase()) continue;
    const r0 = cellOf(r[2].toUpperCase()), r1 = r[3] ? cellOf(r[3].toUpperCase()) : r0;
    if (!r0 || !r1) continue;
    let i: string, j: string;
    if (args.list.length === 3) { i = args.list[1].trim(); j = args.list[2].trim(); }
    else if (args.list.length === 2 && r0.r === r1.r) { i = "1"; j = args.list[1].trim(); }
    else if (args.list.length === 2 && r0.c === r1.c) { i = args.list[1].trim(); j = "1"; }
    else continue;
    if (!i || !j || /^0+$/.test(i) || /^0+$/.test(j)) continue;   // a whole row / column: not rewritten
    const off = (e: string, d: number) => d === 0 ? `(${e})` : `(${e})${d > 0 ? "+" : ""}${d}`;
    const repl = `OFFSET(${prefix}${m[2]},0,0,${off(i, r0.r - a.r)},${off(j, r0.c - a.c)})`;
    return f.slice(0, m.index) + repl + f.slice(args.end);
  }
  return f;
}
/** the arguments of a call whose "(" ends at `open`: split at its own commas (strings, quoted sheet names, nested
    calls and array constants skipped); `end` is after its ")" */
function splitArgs(f: string, open: number): { list: string[]; end: number } | null {
  const list: string[] = []; let depth = 1, from = open;
  for (let i = open; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"') { i = skip(f, i, '"'); continue; }
    if (ch === "'") { i = skip(f, i, "'"); continue; }
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") { depth--; if (!depth) { list.push(f.slice(from, i)); return { list, end: i + 1 }; } }
    else if (ch === "," && depth === 1) { list.push(f.slice(from, i)); from = i + 1; }
  }
  return null;
}
function skip(f: string, i: number, q: string) { let j = i + 1; while (j < f.length) { if (f[j] === q) { if (f[j + 1] === q) { j += 2; continue; } break; } j++; } return j; }
function inString(f: string, at: number) {
  for (let i = 0; i < at; i++) {
    if (f[i] === '"') { const j = skip(f, i, '"'); if (j >= at) return true; i = j; }
    else if (f[i] === "'") { const j = skip(f, i, "'"); if (j >= at) return true; i = j; }
  }
  return false;
}
