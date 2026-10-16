/* Formula text helpers (PLAN S7.1, docs/next/07 §1.4, §2.1): a tokenizer that finds the A1 references of a formula
   without touching its strings and quoted sheet names, the shift of a shared formula from its master cell to a child
   cell (as Excel does when it writes the child's text), and the sheet ids of linked workbooks ("[File.xlsx]Sheet"). */
import { colToNum, numToCol } from "../xlsx/util";

/** a piece of a formula: text as written, a cell/range reference (with its parts), or a string / quoted name */
export type FToken =
  | { kind: "text"; s: string }
  | { kind: "str"; s: string }
  | { kind: "ref"; s: string; sheet: string | null; c1: number | null; r1: number | null; c1Abs: boolean; r1Abs: boolean; c2?: number | null; r2?: number | null; c2Abs?: boolean; r2Abs?: boolean };

const isWord = (ch: string) => /[\w.]/.test(ch);
/** `$A$1`, `A1`, `A:A`, `1:1`, `A1:B2`, with an optional sheet prefix read by the caller */
const REF = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Z]{1,3})(\$?)(\d{1,7}))?(?![\w(])|^(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![\w(])|^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w(])/;

/** the tokens of a formula (without a leading "="). Sheet prefixes ('Name'!, Name!, [1]Name!, '[File.xlsx]Name'!) stay
    attached to the reference token that follows them */
export function tokenize(f: string): FToken[] {
  const out: FToken[] = []; let i = 0, text = "";
  const flush = () => { if (text) { out.push({ kind: "text", s: text }); text = ""; } };
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') { let j = i + 1; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { j += 2; continue; } break; } j++; } flush(); out.push({ kind: "str", s: f.slice(i, j + 1) }); i = j + 1; continue; }
    if (ch === "'") {                                                // a quoted sheet name, up to '! (a '' inside is a quote)
      let j = i + 1; while (j < f.length) { if (f[j] === "'") { if (f[j + 1] === "'") { j += 2; continue; } break; } j++; }
      const q = f.slice(i, j + 1);
      if (f[j + 1] === "!") { const m = REF.exec(f.slice(j + 2)); if (m) { flush(); out.push(refToken(m, q.slice(1, -1).replace(/''/g, "'"), q + "!")); i = j + 2 + m[0].length; continue; } }
      text += q; i = j + 1; continue;
    }
    // an unquoted sheet prefix: [n]Name! or Name! (word characters; the "[" of an external book may start it)
    if (!isWord(f[i - 1] || "") && f[i - 1] !== "$" && (/[A-Za-z_[$0-9]/.test(ch))) {
      const pm = /^(\[\d+\])?([A-Za-z_][\w.]*)!/.exec(f.slice(i));
      if (pm) { const m = REF.exec(f.slice(i + pm[0].length)); if (m) { flush(); out.push(refToken(m, (pm[1] || "") + pm[2], pm[0])); i += pm[0].length + m[0].length; continue; } }
      const m = REF.exec(f.slice(i));
      if (m) { flush(); out.push(refToken(m, null, "")); i += m[0].length; continue; }
      // a word (function name, name, TRUE): copied whole so its letters are never read as a reference; anything
      // else here ("[" of a structured reference, a stray "$") is one character of text, so the loop always moves on
      let j = i; while (j < f.length && isWord(f[j])) j++;
      if (j === i) j = i + 1;
      text += f.slice(i, j); i = j; continue;
    }
    text += ch; i++;
  }
  flush();
  return out;
}
function refToken(m: RegExpExecArray, sheet: string | null, prefix: string): FToken {
  if (m[2]) return { kind: "ref", s: prefix + m[0], sheet, c1: colToNum(m[2]), r1: +m[4], c1Abs: !!m[1], r1Abs: !!m[3], ...(m[6] ? { c2: colToNum(m[6]), r2: +m[8], c2Abs: !!m[5], r2Abs: !!m[7] } : {}) };
  if (m[10]) return { kind: "ref", s: prefix + m[0], sheet, c1: colToNum(m[10]), r1: null, c1Abs: !!m[9], r1Abs: true, c2: colToNum(m[12]), r2: null, c2Abs: !!m[11], r2Abs: true };
  return { kind: "ref", s: prefix + m[0], sheet, c1: null, r1: +m[14], c1Abs: true, r1Abs: !!m[13], c2: null, r2: +m[16], c2Abs: true, r2Abs: !!m[15] };
}
const wrapRow = (r: number) => ((r - 1) % 1048576 + 1048576) % 1048576 + 1, wrapCol = (c: number) => ((c - 1) % 16384 + 16384) % 16384 + 1;
/** the text of a reference token after moving its relative parts by (dr, dc) */
function shifted(t: Extract<FToken, { kind: "ref" }>, dr: number, dc: number): string {
  const part = (c: number | null, r: number | null, cAbs: boolean, rAbs: boolean) =>
    (c === null ? "" : (cAbs ? "$" : "") + numToCol(cAbs ? c : wrapCol(c + dc))) + (r === null ? "" : (rAbs ? "$" : "") + (rAbs ? r : wrapRow(r + dr)));
  const prefix = t.s.slice(0, t.s.length - t.s.replace(/^.*!/, "").length);
  const a = part(t.c1, t.r1, t.c1Abs, t.r1Abs);
  return prefix + (t.c2 === undefined && t.r2 === undefined ? a : a + ":" + part(t.c2 ?? null, t.r2 ?? null, !!t.c2Abs, !!t.r2Abs));
}
/** a shared formula's text for the cell (dr, dc) away from its master cell: relative references move, absolute
    ones, strings and names stay (what Excel writes in the child's own <f> when it does not share) */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!dr && !dc) return f;
  return tokenize(f).map(t => t.kind === "ref" ? shifted(t, dr, dc) : t.s).join("");
}

/* ---- sheet ids (docs/next/07 §2.1, ADR-014): "Sheet" of the deck's workbook, "[File.xlsx]Sheet" of a linked one ---- */
export interface SheetId { book: string | null; sheet: string }
export function parseSheetId(id: string): SheetId {
  const m = /^\[([^\]]+)\](.*)$/.exec(id);
  return m ? { book: m[1], sheet: m[2] } : { book: null, sheet: id };
}
export const sheetId = (book: string | null, sheet: string) => book ? "[" + book + "]" + sheet : sheet;
