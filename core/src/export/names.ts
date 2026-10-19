/* Export file names (M8 S8.2, docs/next/07 §2.5; B11). Pure functions shared by the page and the tests.
   * The names exports always had (B11, moved here unchanged from app/src/editor/export.ts): "<workbook> - slides.pdf",
     "<workbook> - <slide>.pdf / .png", "<workbook> - <version> - <design>.pdf", " (images)" for a PDF of pictures.
   * A scenario run's names (B15): "<value> - <design>.<ext>", with several versions "<value> - <version> - <design>.<ext>";
     a run of PDFs and PowerPoint files (4.5, B21) gives each value the same first part, cut to fit the longer .pptx.
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
/** the deck or one slide as a PowerPoint file (4.5, B21): the PDF's name with .pptx – "<workbook> - slides.pptx" */
export const pptxName = (stem: string, slide: string | null) => `${stem} - ${slide === null ? "slides" : cleanName(slide)}.pptx`;
/** a slide as a PNG: "<workbook> - <slide>.png" */
export const pngName = (stem: string, slide: string) => `${stem} - ${cleanName(slide)}.png`;


/* ---------------------------------------------------------------- scenario runs (07 §2.5) */
/** the length of a full path the helper writes (its temporary file included) is kept under this (audit SEC-6) */
export const PATH_LIMIT = 240;
/** the export folder's length when the page does not know it (the brief's figure; a run started by the page waits for
    /api/health's folder, S8.3 – the team's share folder is 77 characters) */
export const ASSUMED_FOLDER = 60;
/** ".<32 hex>.tmp" after the name, and the "\" before it */
const TMP_EXTRA = 1 + 32 + 4 + 1;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
/** the name of the full deck in a run with several versions */
export const FULL_DECK = "Full deck";
/** how Windows compares file names (an upper-case table: "ſ" is "S" there) */
const fileKey = (s: string) => s.toUpperCase();

/** a value as a file name's first part: safe characters (controls – C0, DEL, C1 – and \ / : * ? " < > | and a lone
    surrogate → "_"), no leading / trailing spaces or dots, never a device name, never empty */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
export function safeValue(text: string): string {
  let s = text.replace(UNSAFE, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  if (!s) return "(blank)";
  if (RESERVED.test(s.split(".")[0].trim())) s = "_" + s;
  return s;
}
/** the longest name (its extension included) the helper can write in an export folder of `folder` characters */
export const nameBudget = (folder = ASSUMED_FOLDER) => PATH_LIMIT - 1 - TMP_EXTRA - folder;
/** "<value> - <design>.<ext>" or "<value> - <version> - <design>.<ext>": the rest of the name after the value
    (`label`: the version as runVersionLabels names it, null for none) */
const restOf = (design: Design, label: string | null, ext: string) => (label === null ? "" : ` - ${label}`) + ` - ${DESIGN_LABEL[design]}.${ext}`;
/** cut to `n` characters (never inside a surrogate pair), then no trailing spaces or dots */
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  let t = s.slice(0, Math.max(1, n));
  if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1);
  return t.replace(/[\s.]+$/, "") || "_";
}

/** the versions of a run as its file names show them: none for a run of the full deck alone; with several versions
    every one is named – the full deck "Full deck" – cleaned as B11's names, and two that clean alike (Windows ignores
    case) get " (2)", " (3)". `versions`: the versions' names, null for the full deck */
export function runVersionLabels(versions: (string | null)[]): (string | null)[] {
  if (versions.length === 1 && versions[0] === null) return [null];
  const used = new Set<string>();
  return versions.map(v => {
    // B11's cleaning, then what Windows and the request's URL cannot take either (C1 controls, a lone surrogate)
    const base = cleanName((v ?? FULL_DECK).replace(UNSAFE, "_"));
    for (let k = 1; ; k++) { const l = k === 1 ? base : `${base} (${k})`; if (!used.has(fileKey(l))) { used.add(fileKey(l)); return l; } }
  });
}

/** one file of a run on its own: the value made safe and cut so the name fits the export folder (`folder` characters;
    when not known, ASSUMED_FOLDER). In a folder so deep that not even the rest of the name fits, the value keeps one
    character (the helper then refuses the file, and the run's report says so) */
export function scenarioFileName(valueText: string, design: Design, version: string | null, ext: string, folder = ASSUMED_FOLDER): string {
  const rest = restOf(design, version === null ? null : cleanName(version), ext);
  return cut(safeValue(valueText), nameBudget(folder) - rest.length) + rest;
}

/** a whole run's names (S8.2, SC-03): `stems[i]` is value i's first part – safe, cut to fit the run's longest
    (version, design) – and `labels[j]` version j's part; runFileName joins them. A value whose files would equal a
    file of an earlier value (Windows ignores case; " - " can sit inside a value or a version name) gets " (2)", " (3)"
    after the value, so no two files of a run are the same file */
export function scenarioRunNames(values: string[], designs: Design[], versions: (string | null)[], ext: string, folder = ASSUMED_FOLDER): {
  stems: string[]; labels: (string | null)[];
  /** value i's first part with " (k)" (k ≥ 2), cut to fit as the others: for a name taken meanwhile (the helper's own
      " (2)" for a file open elsewhere took a name the run planned) */
  bump: (i: number, k: number) => string } {
  const labels = runVersionLabels(versions);
  const rests = designs.flatMap(d => labels.map(l => restOf(d, l, ext)));
  const room = nameBudget(folder) - Math.max(0, ...rests.map(r => r.length)), used = new Set<string>();
  const stems = values.map(v => {
    const base = safeValue(v);
    for (let k = 1; ; k++) {
      const suffix = k === 1 ? "" : ` (${k})`, stem = cut(base, room - suffix.length) + suffix;
      const keys = rests.map(r => fileKey(stem + r));
      if (keys.some(x => used.has(x))) continue;
      keys.forEach(x => used.add(x)); return stem;
    }
  });
  return { stems, labels, bump: (i, k) => cut(safeValue(values[i]), room - ` (${k})`.length) + ` (${k})` };
}
/** the file of one value (its stem) in one design and version (its label), both from scenarioRunNames */
export const runFileName = (stem: string, design: Design, label: string | null, ext: string) => stem + restOf(design, label, ext);
