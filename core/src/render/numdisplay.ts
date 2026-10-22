/* A cell's number display (4.9, S16.3, B38; docs/next/09 §9 Q9): the ribbon's Decimals −/+, % and Thousands change the
   Excel format code a cell is shown with (CellEdit.num, over the workbook's own). Each step rewrites the code as Excel's
   buttons do – every numeric section of it, quoted text, [colour] / [condition] tags and escaped characters untouched –
   and returns null when it does not apply (a date or text format, no decimals left to take away). The text is then
   numfmt.ts formatValue's, so the PDF, the PNG and PowerPoint's native table cell show the same digits. */
import { fmtGeneral, isDateFmt } from "../xlsx/numfmt";

export type NumStep = "dec+" | "dec-" | "pct" | "thou";
/** at most this many decimals (Excel allows 30; a slide never needs more) */
export const MAX_DEC = 10;

/** a section split into pieces: literal ones (quoted, bracketed, escaped, _x / *x) are never changed */
type Piece = { s: string; lit: boolean };
function pieces(sec: string): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < sec.length;) {
    const ch = sec[i];
    let j = i + 1;
    if (ch === '"') { j = sec.indexOf('"', i + 1); j = j < 0 ? sec.length : j + 1; }
    else if (ch === "[") { j = sec.indexOf("]", i + 1); j = j < 0 ? sec.length : j + 1; }
    else if (ch === "\\" || ch === "_" || ch === "*") j = Math.min(sec.length, i + 2);
    const lit = j - i > 1 || ch === '"' || ch === "[";
    if (!lit && out.length && !out[out.length - 1].lit) out[out.length - 1].s += ch; else out.push({ s: sec.slice(i, j), lit });
    i = j;
  }
  return out;
}
/** the positions (in the joined section) of the characters a step may change: the free ones */
function freeChars(ps: Piece[]): { text: string; free: boolean[] } {
  let text = ""; const free: boolean[] = [];
  for (const p of ps) { text += p.s; for (let k = 0; k < p.s.length; k++) free.push(!p.lit); }
  return { text, free };
}
const PH = /[0#?]/;
const splitSections = (f: string) => f.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);

/** one numeric section changed by a step; null: no change */
function stepSection(sec: string, step: NumStep): string | null {
  const { text, free } = freeChars(pieces(sec));
  const isFree = (k: number) => free[k];
  // the mantissa ends at an exponent's E (a scientific format's decimals sit before it)
  let end = text.length;
  for (let k = 0; k < text.length; k++) if (isFree(k) && /[eE]/.test(text[k]) && /[+-]/.test(text[k + 1] || "")) { end = k; break; }
  const phs: number[] = [];
  for (let k = 0; k < end; k++) if (isFree(k) && PH.test(text[k])) phs.push(k);
  if (!phs.length) return null;                                         // a section with no digits (text, a literal)
  let dot = -1;
  for (let k = 0; k < end; k++) if (isFree(k) && text[k] === ".") { dot = k; break; }
  const decs = dot < 0 ? [] : phs.filter(k => k > dot);
  const ints = dot < 0 ? phs : phs.filter(k => k < dot);
  const ins = (at: number, s: string) => text.slice(0, at) + s + text.slice(at);
  const del = (at: number, n = 1) => text.slice(0, at) + text.slice(at + n);
  switch (step) {
    case "dec+":
      if (decs.length >= MAX_DEC) return null;
      if (dot >= 0) return ins((decs.length ? decs[decs.length - 1] : dot) + 1, "0");
      return ins(ints[ints.length - 1] + 1, ".0");
    case "dec-":
      if (!decs.length) return null;
      if (decs.length === 1) { const t = del(decs[0]); return t.slice(0, dot) + t.slice(dot + 1); }
      return del(decs[decs.length - 1]);
    case "pct": {
      const at: number[] = [];
      for (let k = 0; k < text.length; k++) if (isFree(k) && text[k] === "%") at.push(k);
      if (at.length) { let t = text; for (const k of at.reverse()) t = t.slice(0, k) + t.slice(k + 1); return t; }
      return ins(phs[phs.length - 1] + 1, "%");
    }
    case "thou": {
      if (!ints.length) return null;
      const i0 = ints[0], i1 = ints[ints.length - 1];
      const inner: number[] = [];
      for (let k = i0; k < i1; k++) if (isFree(k) && text[k] === ",") inner.push(k);
      // the separator taken out: the integer part's leading # dropped too ("#,##0" → "0", "#,###" → "#")
      if (inner.length) {
        let t = text; for (const k of [...inner].reverse()) t = t.slice(0, k) + t.slice(k + 1);
        const e = i1 - inner.length;
        return t.slice(0, i0) + t.slice(i0, e + 1).replace(/^#+(?=[0#?])/, "") + t.slice(e + 1);
      }
      // a comma before the last three integer placeholders (padded with # to four: "0" → "#,##0", "00" → "#,#00")
      const run = text.slice(i0, i1 + 1);
      if (!/^[0#?]+$/.test(run)) return null;
      const pad = "#".repeat(Math.max(0, 4 - run.length)) + run;
      return text.slice(0, i0) + pad.slice(0, pad.length - 3) + "," + pad.slice(pad.length - 3) + text.slice(i1 + 1);
    }
  }
}
/** General has no placeholders: the code that shows the value as General does now (its decimals), to step from */
function fromGeneral(v: number | null): string {
  if (v === null || !isFinite(v)) return "0";
  const s = fmtGeneral(v);
  if (/E/.test(s)) return "0";
  const k = s.indexOf(","); return k < 0 ? "0" : "0." + "0".repeat(s.length - k - 1);
}
/** the format code after one of the ribbon's steps, from the code the cell is shown with now (`v`: its value, for General);
    null when the step does not apply */
export function stepNum(fmt: string | null | undefined, step: NumStep, v: number | null = null): string | null {
  let f = fmt || "General";
  if (isDateFmt(f)) return null;
  if (/^(General|@)$/i.test(f.trim())) {
    if (f.trim() === "@") return null;
    if (step === "pct") return "0%";
    if (step === "thou") f = "#,##0" + fromGeneral(v).slice(1);
    else { f = fromGeneral(v); if (step === "dec-" && f === "0") return null; }
    if (step === "thou") return f;
  }
  const secs = splitSections(f);
  let changed = false;
  // up to three numeric sections (positive; negative; zero) – the fourth is text's
  const out = secs.map((s, k) => { if (k > 2 || s.includes("@") || /^\s*General\s*$/i.test(s)) return s; const n = stepSection(s, step); if (n === null) return s; changed = true; return n; });
  return changed ? out.join(";") : null;
}
/** the code has a % / a thousands separator (the ribbon shows the button pressed) */
export function numHas(fmt: string | null | undefined, what: "pct" | "thou"): boolean {
  const f = fmt || "General"; if (isDateFmt(f)) return false;
  const sec = splitSections(f)[0], { text, free } = freeChars(pieces(sec));
  if (what === "pct") return [...text].some((ch, k) => free[k] && ch === "%");
  const phs = [...text].map((ch, k) => free[k] && PH.test(ch) ? k : -1).filter(k => k >= 0);
  const dot = [...text].findIndex((ch, k) => free[k] && ch === ".");
  const ints = phs.filter(k => dot < 0 || k < dot);
  return ints.length > 1 && [...text].some((ch, k) => free[k] && ch === "," && k > ints[0] && k < ints[ints.length - 1]);
}
/** a stored code is used only when it is a sane string (a later page's or a hand-edited one is ignored when not) */
export const validNum = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 255;
