/* Export file names (M8 S8.2, docs/next/07 §2.5; B11). Pure functions shared by the page and the tests.
   * The names exports always had (B11, moved here unchanged from app/src/editor/export.ts): "<workbook> - slides.pdf",
     "<workbook> - <slide>.pdf / .png", "<workbook> - <version> - <design>.pdf", " (images)" for a PDF of pictures.
   * A scenario run's names (B15): "<value> - <design>.<ext>", with several versions "<value> - <version> - <design>.<ext>".
     <value> is the input cell's displayed text, made safe for Windows: \ / : * ? " < > | and control characters → "_",
     spaces and dots trimmed at both ends, a reserved device name (CON, NUL, COM1, … – audit SEC-7) prefixed "_", empty →
     "(blank)"; cut so that the helper's temporary file "<export folder>\<name>.<32 hex>.tmp" (helper util.write_tmp)
     stays under 240 characters (audit SEC-6); values whose names come out equal in one run – Windows file names ignore
     case – get " (2)", " (3)" after the value, before the helper's own " (2)" for a target open in Acrobat (EX-11). */
import { DESIGN_LABEL } from "../model/designs";
import type { Design } from "../model/types";

/* ---------------------------------------------------------------- B11 (unchanged) */
/** a workbook's file name without its extension */
export const stemOf = (name: string) => name.replace(/\.[^.]+$/, "");
/** as the helper cleans names (exports.py clean_name): control characters → a space, \ / : * ? " < > | → "_" */
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[\\/:*?"<>|]+/g, "_").trim().replace(/^\.+|\.+$/g, "") || "slide";
/** every version × design (B11): "<workbook> - <version> - <design>" (the PDF's title too) */
export const versionTitle = (stem: string, version: string, design: Design) => `${stem} - ${cleanName(version)} - ${DESIGN_LABEL[design]}`;
/** a PDF of the deck or of one slide: "<workbook> - slides.pdf", "<workbook> - <slide>.pdf"; pictures: " (images)" */
export const pdfName = (stem: string, slide: string | null, pictures: boolean) => `${stem} - ${slide === null ? "slides" : cleanName(slide)}${pictures ? " (images)" : ""}.pdf`;
/** a slide as a PNG: "<workbook> - <slide>.png" */
export const pngName = (stem: string, slide: string) => `${stem} - ${cleanName(slide)}.png`;

/* ---------------------------------------------------------------- scenario runs (07 §2.5) */
/** the length of a full path the helper writes (its temporary file included) is kept under this (audit SEC-6) */
export const PATH_LIMIT = 240;
/** the export folder's length when the page does not know it (from disk, or before /api/health answered) */
export const ASSUMED_FOLDER = 60;
/** ".<32 hex>.tmp" after the name, and the "\" before it */
const TMP_EXTRA = 1 + 32 + 4 + 1;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** a value as a file name's first part: safe characters, no leading / trailing spaces or dots, never a device name,
    never empty */
export function safeValue(text: string): string {
  let s = text.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  if (!s) return "(blank)";
  if (RESERVED.test(s.split(".")[0].trim())) s = "_" + s;
  return s;
}
/** the longest name (its extension included) the helper can write in an export folder of `folder` characters */
export const nameBudget = (folder = ASSUMED_FOLDER) => PATH_LIMIT - 1 - TMP_EXTRA - folder;
/** "<value> - <design>.<ext>" or "<value> - <version> - <design>.<ext>": the rest of the name after the value */
const restOf = (design: Design, version: string | null, ext: string) => (version === null ? "" : ` - ${cleanName(version)}`) + ` - ${DESIGN_LABEL[design]}.${ext}`;
/** cut to `n` characters (never inside a surrogate pair), then no trailing spaces or dots */
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  let t = s.slice(0, Math.max(1, n));
  if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1);
  return t.replace(/[\s.]+$/, "") || "_";
}

/** one file of a run: the value made safe and cut so the name fits the export folder (`folder` characters; when not
    known, ASSUMED_FOLDER). In a folder so deep that not even the rest of the name fits, the value keeps one character
    (the helper then refuses the file, and the run's report says so) */
export function scenarioFileName(valueText: string, design: Design, version: string | null, ext: string, folder = ASSUMED_FOLDER): string {
  const rest = restOf(design, version, ext);
  return cut(safeValue(valueText), nameBudget(folder) - rest.length) + rest;
}

/** a whole run's names: for each value, its first part – safe, cut to fit the longest (design, version) of the run, and
    " (2)", " (3)" when it equals an earlier value's (ignoring case, as Windows does) – so that no two files of a run
    are the same file. `versions`: the versions' names, null for "the deck without versions" (one file per design) */
export function scenarioRunStems(values: string[], designs: Design[], versions: (string | null)[], ext: string, folder = ASSUMED_FOLDER): string[] {
  const longest = Math.max(0, ...designs.flatMap(d => versions.map(v => restOf(d, v, ext).length)));
  const room = nameBudget(folder) - longest, used = new Set<string>();
  return values.map(v => {
    const base = safeValue(v);
    for (let k = 1; ; k++) {
      const suffix = k === 1 ? "" : ` (${k})`, stem = cut(base, room - suffix.length) + suffix;
      if (!used.has(stem.toLowerCase())) { used.add(stem.toLowerCase()); return stem; }
    }
  });
}
/** the file of one value (its stem from scenarioRunStems) in one design and version */
export const runFileName = (stem: string, design: Design, version: string | null, ext: string) => stem + restOf(design, version, ext);
