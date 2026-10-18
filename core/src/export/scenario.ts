/* "Run for each value…" (M8, B15, docs/next/07 §2.4, §8 Q7): what the dialog reads from its fields before it asks the
   core worker for a scenario – the input cell in the name box's syntax, the list of values, and the type a value goes
   into the engine with. Pure functions (no DOM): the page and the tests share them. */
import { colToNum } from "../xlsx/util";
import type { CellType } from "../xlsx/types";

/** the input cell: a sheet id (a linked workbook's sheet as "[Peers.xlsx]Peer", ADR-014) and a cell reference "C7" */
export interface InputCell { sheet: string; ref: string }

/** the name box's syntax: "Sheet!C7", "'My sheet'!$C$7", "[Peers.xlsx]Peer!C7" or "'[Peers.xlsx]My sheet'!C7"; the
    sheet's name as typed (the page matches it against the workbook's sheets), the cell in capitals without "$".
    Null: not a single cell of a named sheet (a range, a bare "C7", a cell past XFD1048576) */
export function parseInputCell(text: string): InputCell | null {
  const s = text.trim(), bang = s.lastIndexOf("!");
  if (bang <= 0) return null;
  let sheet = s.slice(0, bang).trim();
  const q = /^'(.*)'$/.exec(sheet);
  if (q) sheet = q[1].replace(/''/g, "'");
  else if (sheet.startsWith("'")) return null;                       // a quote not closed
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.slice(bang + 1).trim());
  if (!sheet || !m) return null;
  const col = m[1].toUpperCase(), row = +m[2];
  if (row < 1 || row > 1048576 || colToNum(col) > 16384) return null;
  return { sheet, ref: col + row };
}
/** the cell as the name box writes it: a sheet name with spaces or punctuation in quotes */
export function inputCellText(c: InputCell): string {
  return (/^[A-Za-z_][A-Za-z0-9_.]*$|^\[[^\]]+\][A-Za-z_][A-Za-z0-9_.]*$/.test(c.sheet) ? c.sheet : "'" + c.sheet.replace(/'/g, "''") + "'") + "!" + c.ref;
}

/** the values of a run, one per line (typed or pasted; a paste from Excel brings tabs between a row's cells: each cell
    is a value): spaces around a value trimmed, blank lines skipped, duplicates removed keeping the first (07 §6.2 SC-01) */
export function scenarioValues(text: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n|\t/)) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v); out.push(v);
  }
  return out;
}

/** a number as it is typed or shown. The page shows numbers with Italian separators (xlsx/numfmt: "1.234,5"), so a
    value taken from a range or pasted from the slides reads that way first: "1.234" is 1234, "1,5" is 1.5,
    "1.234.567,89"; a dot that cannot be a thousands group is a decimal point ("1.5", ".5"), and English grouping is
    read where it cannot be Italian ("1,234.5", "1,234,567"). Also a sign, "(12)" for -12, "12,5%", "1,23E-04".
    Null when it is not a number (a date, a label, an amount with a currency) */
export function parseNumber(text: string): number | null {
  let s = text.trim().replace(/−/g, "-"), neg = false, pct = false, exp = "";
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.endsWith("%")) { pct = true; s = s.slice(0, -1).trim(); }
  const sign = /^[-+]/.exec(s)?.[0] || ""; s = s.slice(sign.length);
  const e = /[eE]([-+]?\d+)$/.exec(s); if (e) { exp = "e" + e[1]; s = s.slice(0, e.index); }
  let plain: string | null = null;
  // (a thousands group never starts with 0: "0.035" is a decimal point)
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) plain = s.replace(/\./g, "").replace(",", ".");   // 1.234 · 1.234,5
  else if (/^\d+,\d+$/.test(s)) plain = s.replace(",", ".");                                 // 1,5
  else if (/^\d*\.\d+$|^\d+$/.test(s)) plain = s;                                            // 1.5 · .5 · 12
  else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s) && (s.includes(".") || /,.*,/.test(s))) plain = s.replace(/,/g, "");   // 1,234.5 · 1,234,567
  if (plain === null || (neg && sign)) return null;
  const n = Number(sign + plain + exp);
  if (!isFinite(n)) return null;
  return (neg ? -n : n) / (pct ? 100 : 1);
}

/** the value the engine gets for a typed text (07 §8 Q7): a number when the text reads as one and the input cell holds
    a number today; TRUE / FALSE when it holds a logical; otherwise – or with "Treat as text" ticked – the text itself.
    `now`: the input cell's type in the workbook (null: empty or unknown) */
export function typedValue(text: string, now: CellType | null, asText: boolean): number | string | boolean {
  const v = text.trim();
  if (asText) return v;
  if (now === "n") { const n = parseNumber(v); if (n !== null) return n; }
  if (now === "b" && /^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  return v;
}
