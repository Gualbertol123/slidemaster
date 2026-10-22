/* Excel's conditional formats, evaluated per cell (S16.4, B39; 09 §2.9, §3.10). Moved here from layout.ts and grown:
   - rules on the cell's value: cellIs (any operand formula), expression (a formula, xlsx/cf.ts's own evaluator below),
     containsText / notContainsText / beginsWith / endsWith, containsBlanks / notContainsBlanks, containsErrors /
     notContainsErrors, timePeriod (the workbook's day: this PC's date when the workbook was read – dayOf);
   - rules on the rule's range: top10 (top / bottom, n or %), aboveAverage (above / below, or equal, standard
     deviations), duplicateValues / uniqueValues, colorScale (2 and 3 stops; min / max / num / percent / percentile /
     formula), dataBar (with the 2010 extension of an .xlsx: lengths, axis, negative colours, border, gradient,
     direction), iconSet (the built-in sets, reverse, custom icons, value hidden);
   - as Excel: rules apply in priority order, the first true rule sets a property (fill, font colour, bold …) and a later
     true rule only adds what is still unset; a colour scale is a fill; the first data bar and the first icon win;
     stopIfTrue ends the cell's rules.
   The range statistics (min, max, sorted values, counts, average) are kept per sheet and rule (a scenario's sheet is
   another sheet: its own). Formulas are compiled once per text. Relative references are offsets from the top-left
   cell of the rule's first range (as Excel writes them).
   Deviation from 09 §2.9 (decided in S16.4): `expression` formulas are evaluated by the small evaluator here, not by
   the WASM formula engine – the tables are laid out synchronously on the page, where the engine is never loaded; the
   evaluator knows references in the sheet, operators and ≈ 50 functions; a formula it does not know is listed under
   "not reproduced" (unsupportedOf), and a rule naming another sheet too.
   Today (S16.4 review): timePeriod rules and TODAY() read the workbook's day (Shared.today, given to readWorkbook / set
   from this PC's date when the workbook is read, sent to the page with the shared styles), not the clock: the tables are
   laid out once per workbook – before any RenderCtx, shared by every design and by the page's mirror – so the day lives
   with the workbook, which the layout caches already key on. An open deck keeps the day it was opened on (its screen
   and its exports agree) until the workbook is read again (opened again, or its file changed). */
import { colToNum, inRange } from "./util";
import type { Range } from "./util";
import type { Border, Cell, CFBarLook, CFIconLook, CFRule, CFVO, Dxf, Item, Sheet } from "./types";
import { Kind, cellIndex } from "./sheetstore";
import { formatValue } from "./numfmt";

export interface CFResult { dxf: Dxf | null; bar?: CFBarLook; icon?: CFIconLook; hide?: boolean }

/* ===================================================================== values of a range (statistics) */
interface Stats { nums: Float64Array; min: number; max: number; avg: number; sd: number; counts: Map<string, number>;
  /** the rule's thresholds (a scale's, a bar's, an icon set's), computed once */ th?: (number | null)[];
  /** a colour scale's colour by value */ fills?: Map<number, string | null> }
const STATS = new WeakMap<Sheet, Map<CFRule, Stats>>();
const keyOf = (v: Cell["v"], t: Cell["t"]) => t === "n" || t === "d" ? "n:" + v : t === "s" ? "s:" + String(v).toLowerCase() : t === "b" ? "b:" + v : null;
/** every non-empty cell of the ranges (each cell once): kind as the store's, the number or string */
function eachValue(S: Sheet, ranges: Range[], fn: (num: number | null, key: string | null) => void) {
  const seen = ranges.length > 1 ? new Set<string>() : null;
  const C = S.cols?.cells;
  if (C) {
    for (const g of ranges) {
      // rows of the range present in the store (binary search to the first)
      let lo = 0, hi = C.rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (C.rows[m] < g.r1) lo = m + 1; else hi = m; }
      for (let k = lo; k < C.rows.length && C.rows[k] <= g.r2; k++) {
        for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) {
          const c = C.col[i]; if (c < g.c1 || c > g.c2) continue;
          if (seen) { const id = C.rows[k] + "," + c; if (seen.has(id)) continue; seen.add(id); }
          const kd = C.kind[i], n = C.num[i];
          if (kd === Kind.Num || kd === Kind.Date) fn(n, "n:" + n);
          else if (kd === Kind.Shared) { const s = S.ctx.sst[n] ?? ""; if (s !== "") fn(null, "s:" + s.toLowerCase()); }
          else if (kd === Kind.Str) { const s = C.strs[n]; if (s !== "") fn(null, "s:" + s.toLowerCase()); }
          else if (kd === Kind.Bool) fn(null, "b:" + (n === 1));
        }
      }
    }
    return;
  }
  for (const x of S.cells.values()) {
    if (!ranges.some(g => inRange(g, x.r, x.c)) || x.t === "blank" || x.t === "e") continue;
    fn(x.t === "n" || x.t === "d" ? x.v as number : null, keyOf(x.v, x.t));
  }
}
function statsOf(S: Sheet, rule: CFRule): Stats {
  let m = STATS.get(S); if (!m) STATS.set(S, m = new Map());
  let st = m.get(rule); if (st) return st;
  const nums: number[] = [], counts = new Map<string, number>();
  eachValue(S, rule.ranges, (n, k) => { if (n !== null && isFinite(n)) nums.push(n); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
  const a = Float64Array.from(nums).sort();
  let sum = 0; for (const v of a) sum += v;
  const avg = a.length ? sum / a.length : 0;
  let ss = 0; for (const v of a) ss += (v - avg) * (v - avg);
  // Excel's "standard deviation above / below" is the population's (STDEV.P over the range)
  st = { nums: a, min: a.length ? a[0] : 0, max: a.length ? a[a.length - 1] : 0, avg, sd: a.length ? Math.sqrt(ss / a.length) : 0, counts };
  m.set(rule, st); return st;
}
/** PERCENTILE.INC */
function percentile(a: Float64Array, p: number): number {
  if (!a.length) return 0;
  const h = (a.length - 1) * Math.max(0, Math.min(1, p)), lo = Math.floor(h);
  return lo + 1 < a.length ? a[lo] + (h - lo) * (a[lo + 1] - a[lo]) : a[lo];
}

/* ===================================================================== the formula evaluator */
type Err = { e: string };
type Val = number | string | boolean | null | Err;
interface Env { S: Sheet; dr: number; dc: number; r: number; c: number }
type RangeRef = { rg: Range };
type Fn = (env: Env) => Val | RangeRef;
const isErr = (v: unknown): v is Err => !!v && typeof v === "object" && "e" in (v as object);
const isRange = (v: unknown): v is RangeRef => !!v && typeof v === "object" && "rg" in (v as object);
const NA: Err = { e: "#N/A" }, VALUE: Err = { e: "#VALUE!" }, DIV0: Err = { e: "#DIV/0!" };
const cellVal = (x: Cell | null): Val => !x || x.t === "blank" ? null : x.t === "e" ? { e: String(x.v) } : x.v as Val;

class Unsupported extends Error {}
/** tokens: numbers, strings, references, names / functions, errors, operators */
const TOK = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)|("(?:[^"]|"")*")|((?:'[^']+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\w(])|([A-Za-z_][\w.]*)|(#[A-Z0-9/]+[!?]?)|(<>|<=|>=|[-+*/^&=<>%(),;:]))/y;
type Tok = { k: "num" | "str" | "ref" | "name" | "err" | "op"; s: string; sheet?: string };
function lex(f: string): Tok[] {
  const out: Tok[] = []; TOK.lastIndex = 0; let i = 0;
  while (i < f.length) {
    if (/^\s*$/.test(f.slice(i))) break;
    TOK.lastIndex = i; const m = TOK.exec(f); if (!m) throw new Unsupported(f);
    i = TOK.lastIndex;
    if (m[1] !== undefined) out.push({ k: "num", s: m[1] });
    else if (m[2] !== undefined) out.push({ k: "str", s: m[2].slice(1, -1).replace(/""/g, '"') });
    else if (m[4] !== undefined) out.push({ k: "ref", s: m[4].toUpperCase(), sheet: m[3] ? m[3].slice(0, -1).replace(/^'|'$/g, "") : undefined });
    else if (m[5] !== undefined) out.push({ k: "name", s: m[5].toUpperCase() });
    else if (m[6] !== undefined) out.push({ k: "err", s: m[6] });
    else out.push({ k: "op", s: m[7] === ";" ? "," : m[7] });
  }
  return out;
}
const toNum = (v: Val): number | Err => v === null ? 0 : typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : isErr(v) ? v
  : v.trim() !== "" && isFinite(+v.replace(",", ".")) ? +v.replace(",", ".") : VALUE;
const toStr = (v: Val): string | Err => v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : isErr(v) ? v : typeof v === "number" ? String(+v.toPrecision(15)) : v;
const toBool = (v: Val): boolean | Err => v === null ? false : typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : isErr(v) ? v
  : /^true$/i.test(v) ? true : /^false$/i.test(v) ? false : VALUE;
/** a reference's range for the cell at (dr, dc) from the rule's anchor */
function refRange(s: string): (env: Env) => Range {
  const part = (p: string) => {
    const m = /^(\$?)([A-Z]{1,3})?(\$?)(\d+)?$/.exec(p)!;
    return { cAbs: !!m[1], c: m[2] ? colToNum(m[2]) : null, rAbs: !!m[3], r: m[4] ? +m[4] : null };
  };
  const [a, b0] = s.split(":"), A = part(a), B = b0 ? part(b0) : A;
  return env => {
    const r1 = A.r === null ? 1 : A.rAbs ? A.r : A.r + env.dr, r2 = B.r === null ? 1048576 : B.rAbs ? B.r : B.r + env.dr;
    const c1 = A.c === null ? 1 : A.cAbs ? A.c : A.c + env.dc, c2 = B.c === null ? 16384 : B.cAbs ? B.c : B.c + env.dc;
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  };
}
const deref = (v: Val | RangeRef, env: Env): Val => {
  if (!isRange(v)) return v;
  const g = v.rg;
  // a range in a single-value place: the cell in the evaluated cell's row or column (implicit intersection), as Excel
  if (g.r1 === g.r2 && g.c1 === g.c2) return cellVal(env.S.get(g.r1, g.c1));
  if (g.c1 === g.c2 && env.r >= g.r1 && env.r <= g.r2) return cellVal(env.S.get(env.r, g.c1));
  if (g.r1 === g.r2 && env.c >= g.c1 && env.c <= g.c2) return cellVal(env.S.get(g.r1, env.c));
  return VALUE;
};
/** the values of a function's argument (a range: its non-empty cells; bounded to 200,000 cells) */
function* valuesOf(v: Val | RangeRef, env: Env): Generator<Val> {
  if (!isRange(v)) { yield v; return; }
  const g = v.rg, C = env.S.cols?.cells;
  if (C) {
    let lo = 0, hi = C.rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (C.rows[m] < g.r1) lo = m + 1; else hi = m; }
    for (let k = lo; k < C.rows.length && C.rows[k] <= g.r2; k++) for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) {
      const c = C.col[i]; if (c >= g.c1 && c <= g.c2) yield cellVal(env.S.get(C.rows[k], c));
    }
    return;
  }
  if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 200000) return;
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const x = env.S.get(r, c); if (x && x.t !== "blank") yield cellVal(x); }
}
const cmpVals = (op: string, a: Val, b: Val): boolean | Err => {
  if (isErr(a)) return a; if (isErr(b)) return b;
  // Excel: blank compares as 0 with numbers, "" with text; text > numbers; booleans > text; text without case
  const rank = (v: Val) => typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  let d: number;
  if (rank(a) !== rank(b)) d = rank(a) - rank(b);
  else if (typeof a === "string") { const x = a.toLowerCase(), y = (b as string).toLowerCase(); d = x < y ? -1 : x > y ? 1 : 0; }
  else d = (+a!) - (+b!);
  switch (op) { case "=": return d === 0; case "<>": return d !== 0; case "<": return d < 0; case ">": return d > 0; case "<=": return d <= 0; case ">=": return d >= 0; }
  return VALUE;
};
const num1 = (f: (x: number) => number) => (a: Val) => { const x = toNum(a); return isErr(x) ? x : f(x); };
const roundTo = (x: number, d: number, mode: "r" | "u" | "d") => {
  const k = Math.pow(10, d), y = Math.abs(x) * k, r = mode === "r" ? Math.round(+y.toPrecision(15)) : mode === "u" ? Math.ceil(+y.toPrecision(15)) : Math.floor(+y.toPrecision(15));
  return Math.sign(x) * r / k;
};
/** today's Excel serial (1900 system, this PC's date) */
export function todaySerial(now = new Date()): number { return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 864e5); }
/** the day date rules and TODAY() take as today: the workbook's, fixed when it was read (Shared.today) – never the clock
    while drawing, so a display list, its hash and the layout caches depend on the workbook alone (and tests give the day) */
const dayOf = (S: Sheet) => S.ctx.today ?? (S.ctx.today = todaySerial());
const dateOf = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5);
type FImpl = (args: (Val | RangeRef)[], env: Env) => Val;
const sv = (a: Val | RangeRef, env: Env) => deref(a, env);
const FUNCS: Record<string, FImpl> = {
  AND: (as, env) => logic(as, env, true),
  OR: (as, env) => logic(as, env, false),
  NOT: ([a], env) => { const b = toBool(sv(a, env)); return isErr(b) ? b : !b; },
  IF: ([a, b, c], env) => { const t = toBool(sv(a, env)); return isErr(t) ? t : t ? (b === undefined ? true : sv(b, env)) : (c === undefined ? false : sv(c, env)); },
  IFERROR: ([a, b], env) => { const v = sv(a, env); return isErr(v) ? sv(b, env) : v; },
  ISBLANK: ([a], env) => sv(a, env) === null,
  ISNUMBER: ([a], env) => typeof sv(a, env) === "number",
  ISTEXT: ([a], env) => typeof sv(a, env) === "string",
  ISNONTEXT: ([a], env) => typeof sv(a, env) !== "string",
  ISLOGICAL: ([a], env) => typeof sv(a, env) === "boolean",
  ISERROR: ([a], env) => isErr(sv(a, env)),
  ISERR: ([a], env) => { const v = sv(a, env); return isErr(v) && v.e !== "#N/A"; },
  ISNA: ([a], env) => { const v = sv(a, env); return isErr(v) && v.e === "#N/A"; },
  ISEVEN: ([a], env) => { const x = toNum(sv(a, env)); return isErr(x) ? x : Math.trunc(x) % 2 === 0; },
  ISODD: ([a], env) => { const x = toNum(sv(a, env)); return isErr(x) ? x : Math.abs(Math.trunc(x)) % 2 === 1; },
  ABS: ([a], env) => num1(Math.abs)(sv(a, env)),
  INT: ([a], env) => num1(Math.floor)(sv(a, env)),
  SIGN: ([a], env) => num1(Math.sign)(sv(a, env)),
  SQRT: ([a], env) => num1(x => x < 0 ? NaN : Math.sqrt(x))(sv(a, env)),
  ROUND: ([a, d], env) => { const x = toNum(sv(a, env)), k = toNum(d === undefined ? 0 : sv(d, env)); return isErr(x) ? x : isErr(k) ? k : roundTo(x, Math.trunc(k), "r"); },
  ROUNDUP: ([a, d], env) => { const x = toNum(sv(a, env)), k = toNum(d === undefined ? 0 : sv(d, env)); return isErr(x) ? x : isErr(k) ? k : roundTo(x, Math.trunc(k), "u"); },
  ROUNDDOWN: ([a, d], env) => { const x = toNum(sv(a, env)), k = toNum(d === undefined ? 0 : sv(d, env)); return isErr(x) ? x : isErr(k) ? k : roundTo(x, Math.trunc(k), "d"); },
  MOD: ([a, b], env) => { const x = toNum(sv(a, env)), y = toNum(sv(b, env)); return isErr(x) ? x : isErr(y) ? y : y === 0 ? DIV0 : x - y * Math.floor(x / y); },
  LEN: ([a], env) => { const s = toStr(sv(a, env)); return isErr(s) ? s : s.length; },
  LEFT: ([a, n], env) => { const s = toStr(sv(a, env)), k = toNum(n === undefined ? 1 : sv(n, env)); return isErr(s) ? s : isErr(k) ? k : s.slice(0, Math.max(0, k)); },
  RIGHT: ([a, n], env) => { const s = toStr(sv(a, env)), k = toNum(n === undefined ? 1 : sv(n, env)); return isErr(s) ? s : isErr(k) ? k : k <= 0 ? "" : s.slice(-k); },
  MID: ([a, p, n], env) => { const s = toStr(sv(a, env)), i = toNum(sv(p, env)), k = toNum(sv(n, env)); return isErr(s) ? s : isErr(i) ? i : isErr(k) ? k : i < 1 ? VALUE : s.substr(i - 1, Math.max(0, k)); },
  UPPER: ([a], env) => { const s = toStr(sv(a, env)); return isErr(s) ? s : s.toUpperCase(); },
  LOWER: ([a], env) => { const s = toStr(sv(a, env)); return isErr(s) ? s : s.toLowerCase(); },
  TRIM: ([a], env) => { const s = toStr(sv(a, env)); return isErr(s) ? s : s.trim().replace(/ +/g, " "); },
  EXACT: ([a, b], env) => { const x = toStr(sv(a, env)), y = toStr(sv(b, env)); return isErr(x) ? x : isErr(y) ? y : x === y; },
  SEARCH: ([n, h, p], env) => {
    const x = toStr(sv(n, env)), y = toStr(sv(h, env)), s = toNum(p === undefined ? 1 : sv(p, env));
    if (isErr(x)) return x; if (isErr(y)) return y; if (isErr(s)) return s;
    const re = new RegExp(x.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?"), "i");
    const m = re.exec(y.slice(s - 1)); return m ? m.index + s : VALUE;
  },
  FIND: ([n, h, p], env) => { const x = toStr(sv(n, env)), y = toStr(sv(h, env)), s = toNum(p === undefined ? 1 : sv(p, env)); if (isErr(x)) return x; if (isErr(y)) return y; if (isErr(s)) return s; const k = y.indexOf(x, s - 1); return k < 0 ? VALUE : k + 1; },
  VALUE: ([a], env) => toNum(sv(a, env)),
  ROW: ([a], env) => a === undefined ? env.r : isRange(a) ? a.rg.r1 : VALUE,
  COLUMN: ([a], env) => a === undefined ? env.c : isRange(a) ? a.rg.c1 : VALUE,
  TODAY: (_, env) => dayOf(env.S),
  YEAR: ([a], env) => num1(n => dateOf(n).getUTCFullYear())(sv(a, env)),
  MONTH: ([a], env) => num1(n => dateOf(n).getUTCMonth() + 1)(sv(a, env)),
  DAY: ([a], env) => num1(n => dateOf(n).getUTCDate())(sv(a, env)),
  WEEKDAY: ([a, t], env) => { const x = toNum(sv(a, env)), k = toNum(t === undefined ? 1 : sv(t, env)); if (isErr(x)) return x; if (isErr(k)) return k; const d = dateOf(x).getUTCDay(); return k === 2 ? (d + 6) % 7 + 1 : k === 3 ? (d + 6) % 7 : d + 1; },
  SUM: (as, env) => agg(as, env, v => v.reduce((s, x) => s + x, 0)),
  AVERAGE: (as, env) => agg(as, env, v => v.length ? v.reduce((s, x) => s + x, 0) / v.length : DIV0),
  MIN: (as, env) => agg(as, env, v => v.length ? Math.min(...v) : 0),
  MAX: (as, env) => agg(as, env, v => v.length ? Math.max(...v) : 0),
  COUNT: (as, env) => agg(as, env, v => v.length),
  COUNTA: (as, env) => { let n = 0; for (const a of as) for (const v of valuesOf(a, env)) if (v !== null) n++; return n; },
  COUNTBLANK: ([a], env) => { if (!isRange(a)) return VALUE; let n = 0; for (const v of valuesOf(a, env)) if (v !== null && v !== "") n++; return (a.rg.r2 - a.rg.r1 + 1) * (a.rg.c2 - a.rg.c1 + 1) - n; },
  COUNTIF: ([a, crit], env) => {
    const c = sv(crit, env); if (isErr(c)) return c;
    const m = typeof c === "string" ? /^(<>|<=|>=|=|<|>)?(.*)$/.exec(c)! : null;
    const op = m?.[1] || "=", rhs: Val = m ? (m[2] !== "" && isFinite(+m[2]) ? +m[2] : m[2]) : c;
    let n = 0;
    for (const v of valuesOf(a, env)) {
      if (typeof rhs === "string" && /[*?]/.test(rhs) && typeof v === "string") { const re = new RegExp("^" + rhs.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i"); if (re.test(v) === (op !== "<>")) n++; continue; }
      if (typeof rhs === "number" && typeof v !== "number") { if (op === "<>") n++; continue; }
      const h = cmpVals(op, v, rhs); if (h === true) n++;
    }
    return n;
  },
};
/** AND (all) / OR (any): a range's text and empty cells are left out, as Excel */
function logic(as: (Val | RangeRef)[], env: Env, all: boolean): Val {
  let r = all;
  for (const a of as) {
    if (!isRange(a)) { if (a === null) continue; const b = toBool(a); if (isErr(b)) return b; r = all ? r && b : r || b; continue; }
    for (const v of valuesOf(a, env)) { if (v === null || typeof v === "string") continue; const b = toBool(v); if (isErr(b)) return b; r = all ? r && b : r || b; }
  }
  return r;
}
function agg(as: (Val | RangeRef)[], env: Env, f: (v: number[]) => Val): Val {
  const v: number[] = [];
  for (const a of as) {
    if (!isRange(a)) { const x = toNum(a); if (isErr(x)) return x; v.push(x); continue; }
    for (const x of valuesOf(a, env)) { if (isErr(x)) return x; if (typeof x === "number") v.push(x); }
  }
  return f(v);
}
const BIN: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };
/** a formula (without "=") compiled to a function of the cell; null when it holds what the evaluator does not know */
function compile(f: string): Fn | null {
  let toks: Tok[];
  try { toks = lex(f.replace(/^=/, "")); } catch { return null; }
  let p = 0;
  const peek = () => toks[p], take = () => toks[p++];
  const expect = (s: string) => { const t = take(); if (!t || t.k !== "op" || t.s !== s) throw new Unsupported(s); };
  const primary = (): Fn => {
    const t = take(); if (!t) throw new Unsupported("end");
    if (t.k === "num") { const v = +t.s; return () => v; }
    if (t.k === "str") { const v = t.s; return () => v; }
    if (t.k === "err") { const v: Err = { e: t.s }; return () => v; }
    if (t.k === "ref") {
      if (t.sheet) throw new Unsupported("sheet");                  // another sheet: not reproduced
      const rg = refRange(t.s); return env => ({ rg: rg(env) });
    }
    if (t.k === "name") {
      if (t.s === "TRUE" || t.s === "FALSE") { const v = t.s === "TRUE"; if (peek()?.s === "(") { take(); expect(")"); } return () => v; }
      const fn = FUNCS[t.s.replace(/^_XLFN\./, "")]; if (!fn || peek()?.s !== "(") throw new Unsupported(t.s);
      take(); const args: Fn[] = [];
      if (peek()?.s !== ")") { args.push(expr(0)); while (peek()?.s === ",") { take(); args.push(expr(0)); } }
      expect(")");
      return env => fn(args.map(a => a(env)), env);
    }
    if (t.s === "(") { const e = expr(0); expect(")"); return e; }
    if (t.s === "-" || t.s === "+") { const e = unary(); const neg = t.s === "-"; return env => { const x = toNum(deref(e(env), env)); return isErr(x) ? x : neg ? -x : x; }; }
    throw new Unsupported(t.s);
  };
  const unary = (): Fn => {
    let e = primary();
    while (peek()?.k === "op" && peek().s === "%") { take(); const a = e; e = env => { const x = toNum(deref(a(env), env)); return isErr(x) ? x : x / 100; }; }
    return e;
  };
  const expr = (min: number): Fn => {
    let left = unary();
    for (;;) {
      const t = peek(); if (!t || t.k !== "op" || !(t.s in BIN) || BIN[t.s] < min) break;
      take(); const prec = BIN[t.s], right = expr(t.s === "^" ? prec : prec + 1), l = left, op = t.s;
      left = env => {
        const a = deref(l(env), env), b = deref(right(env), env);
        if (prec === 1) return cmpVals(op, a, b);
        if (op === "&") { const x = toStr(a), y = toStr(b); return isErr(x) ? x : isErr(y) ? y : x + y; }
        const x = toNum(a), y = toNum(b); if (isErr(x)) return x; if (isErr(y)) return y;
        switch (op) { case "+": return x + y; case "-": return x - y; case "*": return x * y; case "/": return y === 0 ? DIV0 : x / y; default: return Math.pow(x, y); }
      };
    }
    return left;
  };
  try { const e = expr(0); if (p !== toks.length) return null; return e; } catch { return null; }
}
const COMPILED = new Map<string, Fn | null>();
const compiled = (f: string) => { let fn = COMPILED.get(f); if (fn === undefined) { fn = compile(f); if (COMPILED.size > 5000) COMPILED.clear(); COMPILED.set(f, fn); } return fn; };
/** the value of a rule's formula at (r, c): dr / dc from the rule's anchor; null = cannot be evaluated */
function evalFormula(S: Sheet, f: string, r: number, c: number, dr: number, dc: number): Val | undefined {
  const fn = compiled(f); if (!fn) return undefined;
  const env: Env = { S, dr, dc, r, c };
  return deref(fn(env), env);
}
/** why a rule is not reproduced (null: it is): a formula the evaluator does not know, a reference to another sheet */
export function unsupportedOf(rule: CFRule): string | null {
  const fs = rule.type === "expression" || rule.type === "cellIs" ? rule.formulas
    : [...(rule.scale?.cfvo || []), ...(rule.bar?.x14?.cfvo || rule.bar?.cfvo || []), ...(rule.icons?.cfvo || [])].filter(v => v.type === "formula" || (v.val !== undefined && !isFinite(+v.val))).map(v => v.val || "");
  for (const f of fs) if (f === "#NAME?" || !compiled(f)) return /!/.test(f.replace(/"(?:[^"]|"")*"/g, "")) ? "formulas naming another sheet" : "formulas Slide Builder cannot evaluate";
  return KNOWN.has(rule.type) ? null : `"${rule.type}" rules`;
}
const KNOWN = new Set(["cellIs", "expression", "colorScale", "dataBar", "iconSet", "top10", "aboveAverage", "duplicateValues", "uniqueValues",
  "containsText", "notContainsText", "beginsWith", "endsWith", "containsBlanks", "notContainsBlanks", "containsErrors", "notContainsErrors", "timePeriod"]);

/* ===================================================================== thresholds, scales, bars, icons */
function cfvoValue(S: Sheet, v: CFVO, st: Stats, r: number, c: number): number | null {
  const p = v.val !== undefined && v.val !== "" && isFinite(+v.val) ? +v.val : null;
  const formula = () => { const x = evalFormula(S, v.val || "", r, c, 0, 0); return typeof x === "number" ? x : null; };
  switch (v.type) {
    case "min": return st.min;
    case "max": return st.max;
    case "autoMin": return Math.min(0, st.min);
    case "autoMax": return Math.max(0, st.max);
    case "num": return p ?? formula();
    case "percent": { const q = p ?? formula(); return q === null ? null : st.min + q / 100 * (st.max - st.min); }
    case "percentile": { const q = p ?? formula(); return q === null ? null : percentile(st.nums, q / 100); }
    case "formula": return formula();
  }
  return null;
}
const hexRgb = (h: string): [number, number, number] => { const x = parseInt(h.slice(1), 16); return [x >> 16 & 255, x >> 8 & 255, x & 255]; };
const mix = (a: string, b: string, t: number) => {
  const x = hexRgb(a), y = hexRgb(b);
  return "#" + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
};
function scaleFill(S: Sheet, rule: CFRule, v: number): string | null {
  const st = statsOf(S, rule), m = st.fills ||= new Map(), hit = m.get(v);
  if (hit !== undefined) return hit;
  const f = scaleFill0(S, rule, st, v); if (m.size < 100000) m.set(v, f);
  return f;
}
function scaleFill0(S: Sheet, rule: CFRule, st: Stats, v: number): string | null {
  const sc = rule.scale!, o = rule.ranges[0];
  const t = st.th ||= sc.cfvo.map(x => cfvoValue(S, x, st, o.r1, o.c1));
  if (t.some(x => x === null) || sc.colors.length < t.length) return null;
  const th = t as number[];
  if (v <= th[0]) return sc.colors[0];
  for (let k = 1; k < th.length; k++) if (v < th[k]) { const span = th[k] - th[k - 1]; return mix(sc.colors[k - 1], sc.colors[k], span > 0 ? (v - th[k - 1]) / span : 1); }
  return sc.colors[th.length - 1];
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function barLook(S: Sheet, rule: CFRule, v: number): CFBarLook | null {
  const b = rule.bar!, x = b.x14, st = statsOf(S, rule), o = rule.ranges[0];
  const vos = x?.cfvo?.length === 2 ? x.cfvo : b.cfvo;
  const th = st.th ||= [cfvoValue(S, vos[0], st, o.r1, o.c1), cfvoValue(S, vos[1], st, o.r1, o.c1)];
  let lo = th[0], hi = th[1];
  if (lo === null || hi === null) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  const minL = (x?.minLength ?? b.minLength) / 100, maxL = (x?.maxLength ?? b.maxLength) / 100;
  const axisMode = x ? x.axis || "automatic" : "none", neg = v < 0;
  let from = 0, to: number, axis: number | null = null;
  if (axisMode !== "none" && (lo < 0 || axisMode === "middle")) {
    const L = Math.min(lo, 0), H = Math.max(hi, 0);
    axis = axisMode === "middle" ? .5 : H - L > 0 ? -L / (H - L) : 0;
    if (v >= 0) { from = axis; to = axis + (1 - axis) * (H > 0 ? clamp01(v / (axisMode === "middle" ? Math.max(H, -L) : H)) : 0); }
    else { to = axis; from = axis - axis * (L < 0 ? clamp01(v / (axisMode === "middle" ? Math.min(L, -H) : L)) : 0); }
  } else {
    const f = hi > lo ? clamp01((v - lo) / (hi - lo)) : v >= hi ? 1 : 0;
    to = minL + f * (maxL - minL);
  }
  if (x?.direction === "rightToLeft") { const f0 = from; from = 1 - to; to = 1 - f0; if (axis !== null) axis = 1 - axis; }
  const negBar = neg && !!x;
  const fill = negBar && !x!.negSame ? x!.negColor || "#FF0000" : b.color;
  const border = x?.border ? (negBar && x.negBorderSame === false ? x.negBorderColor || "#FF0000" : x.borderColor || b.color) : null;
  return { from: r4(from), to: r4(to), fill, border, gradient: x ? x.gradient !== false : true, neg: negBar, axis: axis === null ? null : r4(axis), axisColor: x?.axisColor || "#000000" };
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
function iconLook(S: Sheet, rule: CFRule, v: number): CFIconLook | null {
  const ic = rule.icons!, st = statsOf(S, rule), o = rule.ranges[0], n = ic.cfvo.length;
  let k = 0;
  const th = st.th ||= ic.cfvo.map(v => cfvoValue(S, v, st, o.r1, o.c1));
  for (let j = 1; j < n; j++) {
    const t = th[j]; if (t === null) return null;
    if (ic.cfvo[j].gte === false ? v > t : v >= t) k = j;
  }
  if (ic.custom) { const c = ic.custom[k]; return c ? { set: c[0], i: c[1] } : null; }
  return { set: ic.set, i: ic.reverse ? n - 1 - k : k };
}

/* ===================================================================== a cell's rules */
const OPS: Record<string, string> = { equal: "=", notEqual: "<>", greaterThan: ">", greaterThanOrEqual: ">=", lessThan: "<", lessThanOrEqual: "<=" };
function periodHit(p: string | undefined, d: number, t: number): boolean {
  const wd = dateOf(t).getUTCDay(), ws = t - wd;              // weeks from Sunday, as Excel
  const now = dateOf(t), y = now.getUTCFullYear(), m = now.getUTCMonth(), dd = dateOf(d), dy = dd.getUTCFullYear(), dm = dd.getUTCMonth();
  const mon = (k: number) => { const q = y * 12 + m + k; return dy * 12 + dm === q; };
  d = Math.floor(d);
  switch (p) {
    case "today": return d === t; case "yesterday": return d === t - 1; case "tomorrow": return d === t + 1;
    case "last7Days": return d > t - 7 && d <= t;
    case "thisWeek": return d >= ws && d < ws + 7; case "lastWeek": return d >= ws - 7 && d < ws; case "nextWeek": return d >= ws + 7 && d < ws + 14;
    case "thisMonth": return mon(0); case "lastMonth": return mon(-1); case "nextMonth": return mon(1);
  }
  return false;
}
/** whether a rule on the cell's value holds: formulas read S (the cell's sheet), statistics RS (the rule's) */
function ruleHit(S: Sheet, RS: Sheet, rule: CFRule, cell: Cell | null, r: number, c: number, dr: number, dc: number): boolean {
  const t = cell ? cell.t : "blank", v = cell ? cell.v : null;
  const isNum = t === "n" || t === "d";
  switch (rule.type) {
    case "cellIs": {
      if (!cell || t === "blank" || t === "e" || !rule.op) return false;
      const val: Val = t === "b" ? (v ? 1 : 0) : v as Val;
      const [a, b] = rule.formulas.map(f => evalFormula(S, f, r, c, dr, dc));
      if (a === undefined || a === null || isErr(a)) return false;
      if (rule.op === "between" || rule.op === "notBetween") {
        if (typeof val !== "number" || typeof a !== "number" || typeof b !== "number") return false;
        const lo = Math.min(a, b), hi = Math.max(a, b), inside = val >= lo && val <= hi;
        return rule.op === "between" ? inside : !inside;
      }
      // text against a number (or the reverse) never matches, but for "not equal" (Excel)
      if ((typeof val === "string") !== (typeof a === "string")) return rule.op === "notEqual";
      return cmpVals(OPS[rule.op] || "", val, a) === true;
    }
    case "expression": {
      const x = evalFormula(S, rule.formulas[0] || "", r, c, dr, dc);
      return x !== undefined && !isErr(x) && (typeof x === "boolean" ? x : typeof x === "number" ? x !== 0 : false);
    }
    case "containsText": case "notContainsText": case "beginsWith": case "endsWith": {
      if (rule.text === undefined) { const x = evalFormula(S, rule.formulas[0] || "", r, c, dr, dc); return x === true || (typeof x === "number" && x !== 0); }
      if (t === "e") return false;
      const s = (t === "blank" ? "" : t === "b" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(+v.toPrecision(15)) : String(v)).toLowerCase(), q = rule.text.toLowerCase();
      return rule.type === "containsText" ? s.includes(q) : rule.type === "notContainsText" ? !s.includes(q) : rule.type === "beginsWith" ? s.startsWith(q) : s.endsWith(q);
    }
    case "containsBlanks": return t === "blank" || (t === "s" && String(v).trim() === "");
    case "notContainsBlanks": return !(t === "blank" || (t === "s" && String(v).trim() === ""));
    case "containsErrors": return t === "e";
    case "notContainsErrors": return t !== "e";
    case "timePeriod": return isNum && periodHit(rule.period, v as number, dayOf(S));
    case "top10": {
      if (!isNum) return false;
      const a = statsOf(RS, rule).nums; if (!a.length) return false;
      const n = Math.max(1, rule.percent ? Math.floor(a.length * (rule.rank ?? 10) / 100) : Math.min(rule.rank ?? 10, a.length));
      return rule.bottom ? (v as number) <= a[Math.min(n, a.length) - 1] : (v as number) >= a[a.length - Math.min(n, a.length)];
    }
    case "aboveAverage": {
      if (!isNum) return false;
      const st = statsOf(RS, rule), k = rule.stdDev || 0, x = v as number, above = rule.above !== false;
      const lim = st.avg + (above ? 1 : -1) * k * st.sd;
      return above ? (rule.equal ? x >= lim : x > lim) : (rule.equal ? x <= lim : x < lim);
    }
    case "duplicateValues": case "uniqueValues": {
      const k = cell && t !== "blank" && t !== "e" ? keyOf(v, t) : null; if (!k) return false;
      const n = statsOf(RS, rule).counts.get(k) || 0;
      return rule.type === "duplicateValues" ? n > 1 : n === 1;
    }
  }
  return false;
}

/** the conditional formats of cell r,c. from = use the rules that cover another cell instead (format painter):
    they are applied to this cell's value, relative references shifted by the distance – like Excel copies them; the
    range statistics are the source rule's range */
export function cfAt(S: Sheet, r: number, c: number, from?: { S: Sheet; r: number; c: number }): CFResult | null {
  const RS = from ? from.S : S, sr = from ? from.r : r, sc = from ? from.c : c;
  let out: CFResult | null = null, dxf: Dxf | null = null;
  // the value from the store when there is one (no Cell object unless a rule reads the cell itself)
  const C = S.cols?.cells;
  let cell: Cell | null | undefined, num: number | null = null;
  if (C) { const i = cellIndex(C, r, c), k = i < 0 ? Kind.Blank : C.kind[i]; if (k === Kind.Num || k === Kind.Date) num = C.num[i]; }
  else { cell = S.get(r, c); num = cell && (cell.t === "n" || cell.t === "d") ? cell.v as number : null; }
  for (const rule of RS.cfRules) {
    let inside = false; for (const g of rule.ranges) if (sr >= g.r1 && sr <= g.r2 && sc >= g.c1 && sc <= g.c2) { inside = true; break; }
    if (!inside) continue;
    const o = rule.ranges[0], dr = r - o.r1, dc = c - o.c1;   // relative refs are written for the first cell of sqref (shifted to r,c)
    // (a colour scale, bar or icon reads the range's statistics on the rule's own sheet)
    let hit = false;
    if (rule.type === "colorScale" && rule.scale) {
      if (num === null) continue;
      const f = scaleFill(RS, rule, num); if (!f) continue;
      hit = true; if (!dxf) dxf = {}; if (dxf.fill === undefined) dxf.fill = f;
    } else if (rule.type === "dataBar" && rule.bar) {
      if (num === null) continue;
      const b = barLook(RS, rule, num); if (!b) continue;
      hit = true; out ||= { dxf: null };
      if (!out.bar) { out.bar = b; if (!rule.bar.showValue) out.hide = true; }
    } else if (rule.type === "iconSet" && rule.icons) {
      if (num === null) continue;
      const ic = iconLook(RS, rule, num);
      hit = true; out ||= { dxf: null };
      if (!out.icon && ic) { out.icon = ic; if (!rule.icons.showValue) out.hide = true; }
    } else {
      if (cell === undefined) cell = S.get(r, c);
      hit = ruleHit(S, RS, rule, cell, r, c, dr, dc);
      if (hit && rule.dxf) {
        if (!dxf) dxf = {};
        for (const k of Object.keys(rule.dxf) as (keyof Dxf)[]) if (dxf[k] === undefined && rule.dxf[k] !== undefined) (dxf as Record<string, unknown>)[k] = rule.dxf[k];
      }
    }
    if (hit && rule.stop) break;
  }
  if (dxf && Object.keys(dxf).length) (out ||= { dxf: null }).dxf = dxf;
  return out;
}
/** the look of the conditional formats of cell r,c (fill, font colour, bold …; null: none) – cfAt's dxf */
export function evalCF(S: Sheet, r: number, c: number, from?: { S: Sheet; r: number; c: number }): Dxf | null {
  return cfAt(S, r, c, from)?.dxf || null;
}
/** the Item keys of a result (layout.ts, edits.ts): the bar, the icon, the hidden value (the cell's text is then empty, as
    Excel shows it: every design and PowerPoint draw only the bar / icon) */
export function cfKeys(x: CFResult | null): Partial<Pick<Item, "cfBar" | "cfIcon" | "cfHide" | "text">> {
  return x ? { ...(x.bar ? { cfBar: x.bar } : {}), ...(x.icon ? { cfIcon: x.icon } : {}), ...(x.hide ? { cfHide: true, text: "" } : {}) } : {};
}
/** a cell's text under a rule's number format */
export const cfText = (cell: Pick<Cell, "v" | "t" | "fmt">, dxf: Dxf | null) => formatValue(dxf?.fmt ? { ...cell, fmt: dxf.fmt } : cell);
/** a cell's text as its table shows it (layout.ts): under its rules' number format, empty when a rule shows only the bar
    or icon */
export function cfShownText(S: Sheet, r: number, c: number): string {
  const cell = S.get(r, c); if (!cell || cell.t === "blank") return "";
  const x = cfAt(S, r, c);
  return x?.hide ? "" : cfText(cell, x?.dxf || null).text;
}
/** the text a chart or a text box's {Sheet!C7} shows for a cell (plain: its formatted value): a text edit's when it was
    made on that value or – since S16.4 the editor records the text as the table shows it – on the value under the
    cell's conditional formats (render/edits.ts origMatches, for the tables; S16.4 re-check) */
export function editedCellText(S: Sheet, r: number, c: number, plain: string, e: { text?: string; orig?: string } | undefined): string {
  if (!e || e.text === undefined) return plain;
  return e.orig === plain || (S.cfRules.length > 0 && e.orig === cfShownText(S, r, c)) ? e.text : plain;
}
/** a rule's border sides: they replace the cell's (each box draws its top / left, the last row / column also its bottom /
    right, layout.ts): a bottom inside the table becomes the top of the boxes below, a right the left of those on its right */
export function cfBorders(items: Item[], rows: number[], cols: number[]) {
  if (!items.some(it => it.cf?.border)) return;
  const at = new Map<string, Item>();
  for (const it of items) for (const r of rows) if (r >= it.b.r && r <= it.b.r2) for (const c of cols) if (c >= it.b.c && c <= it.b.c2) at.set(r + "," + c, it);
  const lastR = rows[rows.length - 1], lastC = cols[cols.length - 1];
  for (const it of items) {
    const bd: Border | undefined = it.cf?.border; if (!bd) continue;
    if (bd.top) it.top = bd.top;
    if (bd.left) it.left = bd.left;
    if (bd.bottom) { if (it.b.r2 >= lastR) it.bottom = bd.bottom; else { const r = rows[rows.indexOf(it.b.r2) + 1]; for (const c of cols) if (c >= it.b.c && c <= it.b.c2) { const o = at.get(r + "," + c); if (o && !o.cf?.border?.top) o.top = bd.bottom; } } }
    if (bd.right) { if (it.b.c2 >= lastC) it.right = bd.right; else { const c = cols[cols.indexOf(it.b.c2) + 1]; for (const r of rows) if (r >= it.b.r && r <= it.b.r2) { const o = at.get(r + "," + c); if (o && !o.cf?.border?.left) o.left = bd.right; } } }
  }
}
