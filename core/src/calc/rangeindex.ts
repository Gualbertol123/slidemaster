/* A range that ends where INDEX points – `SUM(D7:INDEX(D7:O7,1,MATCH(…)))`, an Excel idiom for "from January to the
   chosen month" – is a reference IronCalc does not build (#VALUE!; found on the product owner's real deck,
   2026-10-18). The same range written with OFFSET it does: `A:INDEX(R, i, j)` is `OFFSET(A, MIN(0,dr), MIN(0,dc),
   ABS(dr)+1, ABS(dc)+1)` with dr / dc the distance from A to the cell INDEX names – also when that cell lies before A
   (Excel reads O7:N7 as N7:O7) – and `INDEX(R,i1,j1):INDEX(R,i2,j2)` likewise from R's first cell. Rewritten in the
   formula's text before the engine reads it (engine.ts prep). OFFSET costs nothing more here: the engine evaluates the
   whole model each time. What this cannot say (INDEX over another sheet than A's, a 2-D range with one index, a 0
   index, a linked workbook's unquoted "[1]Sheet!" prefix – a quoted '[1]Sheet'! is rewritten like any sheet) is left as
   written – the self-check reports such cells. */

const CELL = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})$/;
const colNum = (s: string) => { let n = 0; for (const ch of s.replace(/\$/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const cellOf = (s: string) => { const m = CELL.exec(s); return m ? { r: +m[4], c: colNum(m[2]) } : null; };
const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!";
const START = new RegExp(`(${SHEET})?(\\$?[A-Z]{1,3}\\$?\\d{1,7}):((?:_xlfn\\.)?INDEX)\\s*\\(`, "gi");
const RANGE = new RegExp(`^(${SHEET})?(\\$?[A-Z]{1,3}\\$?\\d{1,7})(?::(\\$?[A-Z]{1,3}\\$?\\d{1,7}))?$`, "i");
/** whole columns ("$D:$Q", "A:A"): from row 1 */
const COLS = new RegExp(`^(${SHEET})?(\\$?[A-Z]{1,3}):(\\$?[A-Z]{1,3})$`, "i");

/** a range argument: its sheet prefix, its first and last cells, and its first cell as text (for OFFSET) */
function rangeOf(text: string): { prefix: string; r0: { r: number; c: number }; r1: { r: number; c: number }; first: string } | null {
  const r = RANGE.exec(text);
  if (r) {
    const r0 = cellOf(r[2].toUpperCase()), r1 = r[3] ? cellOf(r[3].toUpperCase()) : r0;
    return r0 && r1 ? { prefix: r[1] || "", r0, r1, first: r[2] } : null;
  }
  const c = COLS.exec(text);
  if (c) { const a = colNum(c[2].toUpperCase()), b = colNum(c[3].toUpperCase()); return { prefix: c[1] || "", r0: { r: 1, c: a }, r1: { r: 1048576, c: b }, first: c[2] + "$1" }; }   // (row 1 fixed: the column's top)
  return null;
}
/** INDEX's row and column indexes, given its arguments (one index over a row or a column range) */
function indexes(list: string[], g: { r0: { r: number; c: number }; r1: { r: number; c: number } }): [string, string] | null {
  const ij: [string, string] | null = list.length === 3 ? [list[1].trim(), list[2].trim()]
    : list.length === 2 && g.r0.r === g.r1.r ? ["1", list[1].trim()] : list.length === 2 && g.r0.c === g.r1.c ? [list[1].trim(), "1"] : null;
  return ij && ij.every(e => e && !/^0+$/.test(e)) ? ij : null;     // (a 0 index – a whole row or column – is not rewritten)
}
/** "(e)+k" without a "+0" */
const plus = (e: string, k: number) => k === 0 ? `(${e})` : `(${e})${k > 0 ? "+" : ""}${k}`;

/** the formula with every `A:INDEX(R, …)` and `INDEX(R, …):INDEX(R, …)` it can rewrite as OFFSET (the text without "=";
    unchanged otherwise) */
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
function rewriteOnce(f: string): string {
  const ii = rewriteIndexIndex(f);
  if (ii !== f) return ii;
  START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START.exec(f))) {
    if (inString(f, m.index)) continue;
    const before = f[m.index - 1];
    if (before && /[\w$.:\]]/.test(before)) continue;               // part of a longer token (B2:C3:INDEX…, [1]Data!…)
    const open = m.index + m[0].length, args = splitArgs(f, open);
    if (!args) continue;
    const prefix = m[1] || "", a = cellOf(m[2].toUpperCase()), g = rangeOf(args.list[0].trim());
    if (!a || !g || g.prefix.toLowerCase() !== prefix.toLowerCase()) continue;
    const ij = indexes(args.list, g); if (!ij) continue;
    // the distance from A to the cell INDEX names, rows and columns; the range runs either way from A
    const dr = plus(ij[0], g.r0.r - a.r - 1), dc = plus(ij[1], g.r0.c - a.c - 1);
    const repl = `OFFSET(${prefix}${m[2]},MIN(0,${dr}),MIN(0,${dc}),ABS(${dr})+1,ABS(${dc})+1)`;
    return f.slice(0, m.index) + repl + f.slice(args.end);
  }
  return f;
}
/** INDEX(R, i1, j1):INDEX(R, i2, j2) over the same R – the range between two INDEX results, either way round – is
    OFFSET(R's first cell, MIN(i1,i2)-1, MIN(j1,j2)-1, ABS(i2-i1)+1, ABS(j2-j1)+1) */
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
    const g = rangeOf(R); if (!g) continue;
    const p = indexes(a1.list, g), q = indexes(a2.list, g);
    if (!p || !q) continue;
    const repl = `OFFSET(${g.prefix}${g.first},MIN(${p[0]},${q[0]})-1,MIN(${p[1]},${q[1]})-1,ABS((${q[0]})-(${p[0]}))+1,ABS((${q[1]})-(${p[1]}))+1)`;
    return f.slice(0, start) + repl + f.slice(a2.end);
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
