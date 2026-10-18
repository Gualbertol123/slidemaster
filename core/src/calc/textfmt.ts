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
import { parseNumber } from "../export/scenario";
import { tokenize } from "./refs";

/** colour names a format's [brackets] may carry, in Italian and English (TEXT shows no colour: they are dropped) */
const COLOURS = /^(rosso|nero|blu|verde|giallo|bianco|magenta|ciano|red|black|blue|green|yellow|white|cyan|colou?re?\s*\d+|color\s*\d+)$/i;
import type { CellValue } from "./engine";

/** an Italian TEXT format as the file's (English-coded) number formats write it, with the Italian locale tag */
export function italianTextFormat(fmt: string): string {
  if (/^\s*standard\s*$/i.test(fmt)) return "General";
  let out = "", date = false, hasLocale = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') { const j = fmt.indexOf('"', i + 1); const end = j < 0 ? fmt.length : j; out += fmt.slice(i, end + 1); i = end; continue; }
    if (ch === "\\" && i + 1 < fmt.length) { out += fmt.slice(i, i + 2); i++; continue; }
    if (ch === "[") {
      const j = fmt.indexOf("]", i), end = j < 0 ? fmt.length - 1 : j, inner = fmt.slice(i + 1, end);
      if (COLOURS.test(inner.trim())) { i = end; continue; }                       // a colour: TEXT shows none
      if (/^\$/.test(inner)) hasLocale = true;                                       // a locale tag of its own: kept
      // a condition's number has the Italian decimal comma: [>=0,5] is [>=0.5]
      out += "[" + (/^[<>=]/.test(inner) ? inner.replace(/[.,]/g, c => c === "," ? "." : ",") : inner) + "]";
      i = end; continue;
    }
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
  return date && !hasLocale ? "[$-410]" + out : out;
}

/** what TEXT(value, fmt) shows in Italian Excel; null when it cannot say (the caller keeps Excel's saved text) */
export function excelText(value: CellValue, fmt: CellValue): string | null {
  if (typeof fmt === "number") fmt = String(fmt);                    // TEXT(5;0): the format "0"
  if (typeof fmt !== "string" || value === null || typeof value === "object") return null;
  if (typeof value === "boolean") return null;                         // (VERO / FALSO: not worth the guess)
  const f = italianTextFormat(fmt);
  let n: number | null = typeof value === "number" ? value : null;
  if (typeof value === "string") {
    // a text that reads as a number (as this Italian Excel reads it) is formatted as one; any other text stays, put
    // into a format's text section ("@ mln") when it has one
    n = value.trim() === "" ? null : parseNumber(value);
    if (n === null) return /@/.test(f) ? formatValue({ v: value, t: "s", fmt: f }).text : value;
  }
  if (n === null || !isFinite(n)) return null;
  const codes = f.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""), time = /[hs]/i.test(codes) || /\[[hms]+\]/i.test(f);
  // a date part: a year or a day, or a month where no hour or second makes "m" the minutes
  const day = /[yd]/i.test(codes) || (/m/i.test(codes) && !time);
  if (day || time) {
    if (n < 0) return null;                                              // (Excel shows no negative date or time)
    // 1900's false 29 February puts every date before 1 March 1900 a day off: not said (a time alone is fine)
    if (day && n < 61) return null;
    n = Math.round(n * 86400) / 86400;                                  // to the second, as Excel rounds before it shows a time
  }
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
    // (a call whose value depends on its own cell – ROW(), COLUMN(), INDIRECT, OFFSET, CELL – cannot move: left out)
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
    if (/(^|[^\w.])(ROW|COLUMN|ROWS|COLUMNS|INDIRECT|OFFSET|CELL|INFO)\s*\(/i.test(value + " " + format)) return null;
    out.push({ start, end, value, format });
    from = end;
  }
  return out;
}
const skipString = (f: string, i: number) => { let j = i + 1; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { j += 2; continue; } break; } j++; } return j; };
const skipQuoted = (f: string, i: number) => { let j = i + 1; while (j < f.length) { if (f[j] === "'") { if (f[j + 1] === "'") { j += 2; continue; } break; } j++; } return j; };
/** whether `at` lies inside a "string" or a 'quoted sheet name' */
function inString(f: string, at: number) {
  for (let i = 0; i < at; i++) {
    if (f[i] === '"') { const j = skipString(f, i); if (j >= at) return true; i = j; }
    else if (f[i] === "'") { const j = skipQuoted(f, i); if (j >= at) return true; i = j; }
  }
  return false;
}

/** an expression moved to another sheet: its references without a sheet get `prefix` ("'Control'!"), so they still
    point at the cell's own sheet */
export function qualify(expr: string, prefix: string): string {
  return tokenize(expr).map(t => t.kind === "ref" && t.sheet === null ? prefix + t.s : t.s).join("");
}
