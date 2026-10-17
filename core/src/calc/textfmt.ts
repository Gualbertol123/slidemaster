/* TEXT with this PC's Excel language (M8, Decisions 2026-10-17: "Yes, in M8"). The formula engine formats TEXT with
   English codes only, so a workbook made in Italian Excel – TESTO(B9;"mmmm aaaa"), TESTO(x;"#.##0,0") – would show
   other texts (or #VALUE!) than Excel. These are the rules this Italian Excel applies, so the engine's adapter can format
   such calls itself (engine.ts ownText) and they follow a scenario:
   * date codes: a = year, g = day (gg, ggg, gggg the weekday), m = month or minute, h, s; "d" and "y" are not codes
     (Excel shows them as they are: "dd mmm yyyy" → "dd set yyyy");
   * numbers: "." groups thousands and "," is the decimal point – the other way round from the file's own number formats;
   * month and day names in Italian.
   Pure functions; the page's number formatter (xlsx/numfmt) does the formatting. */
import { formatValue } from "../xlsx/numfmt";
import { tokenize } from "./refs";
import type { CellValue } from "./engine";

/** an Italian TEXT format as the file's (English-coded) number formats write it, with the Italian locale tag */
export function italianTextFormat(fmt: string): string {
  if (/^\s*standard\s*$/i.test(fmt)) return "General";
  let out = "", date = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') { const j = fmt.indexOf('"', i + 1); const end = j < 0 ? fmt.length : j; out += fmt.slice(i, end + 1); i = end; continue; }
    if (ch === "\\" && i + 1 < fmt.length) { out += fmt.slice(i, i + 2); i++; continue; }
    if (ch === "[") { const j = fmt.indexOf("]", i); const end = j < 0 ? fmt.length - 1 : j; out += fmt.slice(i, end + 1); i = end; continue; }
    const ap = /^(AM\/PM|A\/P)/i.exec(fmt.slice(i));
    if (ap) { out += ap[0]; i += ap[0].length - 1; date = true; continue; }
    if (ch === ".") out += ",";
    else if (ch === ",") out += ".";
    else if (ch === "a" || ch === "A") { out += "y"; date = true; }
    else if (ch === "g" || ch === "G") { out += "d"; date = true; }
    else if (/[dDyY]/.test(ch)) out += "\\" + ch;                   // not codes in Italian Excel: shown as they are
    else { if (/[mMhHsS]/.test(ch)) date = true; out += ch; }
  }
  // dates and times: Italian month and day names (numfmt's locale tag)
  return date ? "[$-410]" + out : out;
}

/** what TEXT(value, fmt) shows in Italian Excel; null when it cannot say (the caller keeps Excel's saved text) */
export function excelText(value: CellValue, fmt: CellValue): string | null {
  if (typeof fmt !== "string" || value === null || typeof value === "object") return null;
  if (typeof value === "boolean") return null;                         // (VERO / FALSO: not worth the guess)
  let n: number | null = typeof value === "number" ? value : null;
  if (typeof value === "string") { const t = value.trim(); if (t !== "" && isFinite(+t)) n = +t; else return value; }   // a text stays as it is
  if (n === null || !isFinite(n)) return null;
  const f = italianTextFormat(fmt);
  try { return formatValue({ v: n, t: "n", fmt: f }, { intZeros: true }).text; } catch { return null; }
}

/** the TEXT(…) calls of a formula (the file's text, "," between arguments): where each starts and ends and its two
    arguments; a call inside another's arguments, or one with other than two arguments, is left out (null: the cell
    is kept as Excel saved it) */
export function textCalls(formula: string): { start: number; end: number; value: string; format: string }[] | null {
  const out: { start: number; end: number; value: string; format: string }[] = [];
  const rx = /(^|[^\w.])((?:_xlfn\.)?TEXT)\s*\(/gi;
  let m: RegExpExecArray | null, from = 0;
  while ((m = rx.exec(formula))) {
    const start = m.index + m[1].length;
    if (start < from) continue;
    if (inString(formula, start)) continue;
    let i = m.index + m[0].length, depth = 1, comma = -1;
    for (; i < formula.length && depth; i++) {
      const ch = formula[i];
      if (ch === '"') { i = skipString(formula, i); continue; }
      if (ch === "'") { i = skipQuoted(formula, i); continue; }
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") depth--;
      else if (ch === "," && depth === 1) { if (comma >= 0) return null; comma = i; }
    }
    if (depth || comma < 0) return null;
    const open = m.index + m[0].length, end = i;                        // `end`: after the ")"
    const value = formula.slice(open, comma).trim(), format = formula.slice(comma + 1, end - 1).trim();
    if (/(^|[^\w.])(?:_xlfn\.)?TEXT\s*\(/i.test(value) || /(^|[^\w.])(?:_xlfn\.)?TEXT\s*\(/i.test(format)) return null;
    out.push({ start, end, value, format });
    from = end;
  }
  return out;
}
const skipString = (f: string, i: number) => { let j = i + 1; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { j += 2; continue; } break; } j++; } return j; };
const skipQuoted = (f: string, i: number) => { let j = i + 1; while (j < f.length) { if (f[j] === "'") { if (f[j + 1] === "'") { j += 2; continue; } break; } j++; } return j; };
function inString(f: string, at: number) { let q = false; for (let i = 0; i < at; i++) if (f[i] === '"') q = !q; return q; }

/** an expression moved to another sheet: its references without a sheet get `prefix` ("'Control'!"), so they still
    point at the cell's own sheet */
export function qualify(expr: string, prefix: string): string {
  return tokenize(expr).map(t => t.kind === "ref" && t.sheet === null ? prefix + t.s : t.s).join("");
}
