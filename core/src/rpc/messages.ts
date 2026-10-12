/* The messages between the page and the core worker (PLAN S2.4). The worker owns the workbook, the shared
   document (DocSync, still v3's HTTP ops protocol) and undo/redo; the page sends operations and requests, and
   receives document snapshots, sheet slices and table HTML. The worker asks the page for what only the page has:
   the helper's API (the page's backend: HTTP with its token, or the browser's own storage from file://), Excel's
   digit width with the page's fonts, and EMF/WMF picture conversion. */
import type { DeckVersion, Op, Preset, Style, WorkbookDoc } from "../model/types";
import type { SheetMeta } from "../xlsx/types";
import type { SharedSlice, SheetSlice } from "../xlsx/slice";
import type { ImgMeta } from "../xlsx/drawing";
import type { CellInfo, SheetInfo, SheetWindow } from "../xlsx/sheetview";
import type { TableDef } from "../model/types";
import type { HistorySummary } from "../sync/history";
import type { Change, SaveState } from "../sync/docsync";

/** what the page knows of a workbook before its sheets are read (indexWorkbook) */
export interface WorkbookInfo {
  meta: SheetMeta[]; skipped: { name: string; why: string }[]; hiddenSheets: string[]; extLinks: number;
  total: number; ssSize: number; big: boolean;
  /** which workbook (counted per index call): slices name it */
  book: number;
}
/** what the renderers need from the page to draw like it (RenderCtx inputs that the worker cannot know) */
export interface ViewInputs { defaults: Style | Record<string, unknown>; logoSrc: string; version: string; workbook: string }
export interface DocState { view: WorkbookDoc; save: SaveState; error: string; history: HistorySummary }
export interface DocEvent extends Omit<DocState, "view"> {
  /** the document, only when its content changed since the last snapshot (not for a save-state or history change) */
  view?: WorkbookDoc;
  /** what changed (null: only the history or the inputs) */
  change: Change | null;
  /** how many of the page's apply/undo calls the snapshot includes */
  ack: number;
}
export interface HtmlReq { design: Style["design"]; version: string; forExport: boolean; thumb: boolean }

/** calls the page makes */
export interface CoreMethods {
  init(a: { served: boolean; client: string; me: string }): void;
  /** read a workbook's index (its sheets are read on demand); throws with `code` CFB/XLSB/NOTZIP/NOTXLSX */
  index(a: { buf: ArrayBuffer }): WorkbookInfo;
  /** read sheets of workbook `book` (progress events while reading); the page gets their slices with the next
      "slices" event; a workbook that is neither the open one nor the one being opened is refused */
  ensure(a: { book: number; names: string[] }): void;
  /* what the wizard and the formula bar read of workbook `book`'s sheets (S2.5): summaries, windows of cells,
     suggestions, one cell – never a whole sheet */
  /** the sheets' summaries (`load`: read them first; else the loaded ones only) and the sizes of table definitions */
  getSheetMeta(a: { book: number; names: string[]; load: boolean; tables?: TableDef[] }): { sheets: SheetInfo[]; sizes: [string, [number, number] | null][] };
  getSheetWindow(a: { book: number; sheet: string; r0: number; r1: number; c0: number; c1: number }): SheetWindow | null;
  detectTables(a: { book: number; sheet: string }): string[];
  getCell(a: { book: number; sheet: string; ref: string }): CellInfo | null;
  /** `book`: the workbook being opened (without: the candidate, else the open one) */
  defaultPreset(a: { book?: number }): Preset;
  /** the indexed workbook becomes the open one, with its document; `preset` = a new preset to save first */
  /** `book`: the workbook index gave (refused when another one is being opened since) */
  start(a: { book?: number; name: string; doc: WorkbookDoc; preset: Preset | null; inputs: ViewInputs }): DocState;
  inputs(a: ViewInputs): void;
  apply(a: { label: string; ops: Op[]; coalesce?: string }): { changed: boolean };
  undo(a: { redo: boolean }): { label: string | null; changed: boolean };
  flush(a: Record<string, never>): void;
  poll(a: Record<string, never>): void;
  /** table HTML for other designs, versions, exports and thumbnails: [table id, kind, key, html] */
  html(a: HtmlReq): [string, string, string, string][];
  /** a font file for the library (S3.2): a variable font becomes a static face at the weight the upload declares
      (every other axis at its default; hb-subset), so no PDF ever embeds a variable font; other fonts come back as
      they are (`variable: false`) */
  staticFont(a: { buf: ArrayBuffer; weight: number }): { buf: ArrayBuffer; variable: boolean };
  /** whole slides as display lists in slide px (S3.5): background, furniture, the tables placed, text boxes */
  slideLists(a: HtmlReq & { slides?: number[]; /** the date the page shows (its clock) */ today?: string }): { slide: number; dl: import("../render/excel-dl").TableDL }[];
}
/** calls the worker makes */
export interface PageMethods {
  getDoc(a: { name: string; since?: number }): WorkbookDoc | null;
  postOps(a: { name: string; ops: Op[]; client: string }): { doc: WorkbookDoc };
  digitWidth(a: { font: string }): number;
  /** text measured with the page's fonts for the display list (decision 2026-10-12, 3): one call per measuring round of a table */
  measureRuns(a: { runs: import("../platform").RunReq[] }): import("../platform").RunMetrics[];
  breakLines(a: { reqs: import("../platform").LinesReq[] }): string[][];
  fitNotes(a: { reqs: import("../platform").NoteFitReq[] }): number[];
  convertPicture(a: { bytes: Uint8Array; ext: string }): string | null;
  /** Liquid Glass's picture analysis (xlsx/drawing.ts analyzeImages) with the page's canvas */
  analyzeImages(a: { srcs: string[] }): [string, ImgMeta][];
}
/** events from the worker */
export interface CoreEvents {
  [k: string]: unknown;
  doc: DocEvent;
  /** slices of workbook `book` (the open one, or the one being opened) */
  slices: { book: number; shared: SharedSlice | null; sheets: SheetSlice[] };
  /** table HTML of the current design and version, new keys only: [table id, kind, key, html] */
  html: [string, string, string, string][];
  progress: { text: string; frac: number | null } | null;
  error: { message: string; stack?: string };
  /** a workbook left while its changes were not saved yet: they are saved now */
  retiredSaved: { name: string };
}
export type PageEvents = Record<string, never>;
export type { DeckVersion };
