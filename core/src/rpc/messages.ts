/* The messages between the page and the core worker (PLAN S2.4). The worker owns the workbook, the shared
   deck (DocSync: storage v4, snapshot + journals, S5.2) and undo/redo; the page sends operations and requests, and
   receives document snapshots, sheet slices and the stage's slides. The worker asks the page for what only the page
   has: the helper's API (the page's backend: HTTP with its token, or the browser's own storage from file://), Excel's
   digit width with the page's fonts, and EMF/WMF picture conversion. */
import type { DeckVersion, Design, Op, Preset, Style, WorkbookDoc } from "../model/types";
import type { SheetMeta } from "../xlsx/types";
import type { SharedSlice, SheetSlice } from "../xlsx/slice";
import type { ImgMeta } from "../xlsx/drawing";
import type { CellInfo, SheetInfo, SheetWindow } from "../xlsx/sheetview";
import type { TableDef } from "../model/types";
import type { HistorySummary } from "../sync/history";
import type { Change, DeckOpen, SaveState, TailResult } from "../sync/docsync";
import type { DeckRecord, DeckSnapshot } from "../model/fold";

/** what the page knows of a workbook before its sheets are read (indexWorkbook) */
export interface WorkbookInfo {
  meta: SheetMeta[]; skipped: { name: string; why: string }[]; hiddenSheets: string[]; extLinks: number;
  total: number; ssSize: number; big: boolean;
  /** which workbook (counted per index call): slices name it */
  book: number;
}
/** what the renderers need from the page to draw like it (RenderCtx inputs that the worker cannot know) */
export interface ViewInputs { defaults: Style | Record<string, unknown>; logoSrc: string; version: string; workbook: string }
/** the open deck on the share, for the side panel's deck-health line (S5.5) */
export interface DeckHealth { gen: number; backlog: number; /** the journals holding those records */ journals: number }
export interface DocState { view: WorkbookDoc; save: SaveState; error: string; history: HistorySummary; deck: DeckHealth }
export interface DocEvent extends Omit<DocState, "view"> {
  /** the document, only when its content changed since the last snapshot (not for a save-state or history change) */
  view?: WorkbookDoc;
  /** what changed (null: only the history or the inputs) */
  change: Change | null;
  /** how many of the page's apply/undo calls the snapshot includes */
  ack: number;
}
/** which design, version and purpose a display list is for */
export interface DesignReq { design: Style["design"]; version: string; forExport: boolean; thumb: boolean }

/** calls the page makes */
export interface CoreMethods {
  init(a: { served: boolean; client: string; me: string }): void;
  /** read a workbook's index (its sheets are read on demand); throws with `code` CFB/ENCRYPTED/NOTZIP/NOTXLSX */
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
  /** the indexed workbook becomes the open one, with its deck as the helper opened it (snapshot and first tail);
      `preset` = a new preset to save first. `book`: the workbook index gave (refused when another one is being
      opened since) */
  start(a: { book?: number; name: string; deck: DeckOpen; preset: Preset | null; inputs: ViewInputs; /** the slide the stage will show: drawn first (S4.1) */ stage?: StageReq }): DocState;
  inputs(a: ViewInputs): void;
  apply(a: { label: string; ops: Op[]; coalesce?: string }): { changed: boolean };
  undo(a: { redo: boolean }): { label: string | null; changed: boolean };
  flush(a: Record<string, never>): void;
  /** read the journals now (the worker reads them every 1.5 s by itself) */
  poll(a: Record<string, never>): void;
  /** the page's presence heartbeat: whether this page is the only one with the deck open (it then compacts the deck
      when it is at rest, 04 §4.4) */
  alone(a: { alone: boolean }): void;
  /** Prepare rollback (04 §4.4), for the open deck: saved, then compacted until nothing lies past the frontier */
  compactAll(a: { /** how long to wait for records younger than the compaction margin */ waitMs?: number }): boolean;
  /** a font file for the library (S3.2): a variable font becomes a static face at the weight the upload declares
      (every other axis at its default; hb-subset), so no PDF ever embeds a variable font; other fonts come back as
      they are (`variable: false`) */
  staticFont(a: { buf: ArrayBuffer; weight: number }): { buf: ArrayBuffer; variable: boolean };
  /** whole slides as display lists in slide px (S3.5): background, furniture, the tables placed, text boxes */
  slideLists(a: SlideListsReq): SlideList[];
  /** whether a font that missed its measuring budget is still coming (its slide is drawn again then): for the
      capture tools, which wait for false before they read a slide */
  fontsSettling(a: Record<string, never>): boolean;
  /** the slide on the stage (S4.1), current design and version, in layers; null when there is no such slide */
  stage(a: StageReq): StageSlide | null;
  /** an export worker's channel (S3.7): the worker asks for display lists on it directly, so they never pass
      through the page's main thread */
  linkExport(a: { id: number; port: MessagePort }): void;
  /** that export worker stopped: its channel is closed */
  unlinkExport(a: { id: number }): void;
  /** the formula engine's self-check of the open workbook (PLAN S7.2, docs/next/07 §1.4): every formula cell
      recomputed and compared with Excel's cached value; the engine is instantiated on this first use (B23). Null
      when no workbook is open */
  calcCheck(a: Record<string, never>): CalcCheck | null;
  /** a linked workbook joins workbook `book` (S7.3, B22, ADR-014): the page gives its bytes (a file of the same folder),
      its sheets are listed under their ids "[file]Sheet" and read like the others; the answer is the workbook's new
      index, or null when the file is not available */
  link(a: { book: number; name: string }): WorkbookInfo | null;
  /** a scenario on the stage (S7.4, docs/next/07 §2.4): the input cell set to `value` in the engine, every slide drawn
      from the recomputed values until `null` clears it. Nothing is saved: the document, the deck and the workbook file
      are untouched. The answer: how many formula cells moved, how many of them the self-check classes `different`
      (the gate of a run, 07 §1.4 (4)), and the self-check itself */
  scenarioPreview(a: ScenarioInput | null): ScenarioAnswer | null;
}
export interface ScenarioInput { sheet: string; ref: string; value: number | string | boolean }
export interface ScenarioAnswer { changed: number; different: number; check: CalcCheck }
/** the self-check's result: how many formula cells are exact / volatile / locale-dependent / external / unreadable /
    different, the first differences, the engine's times (ms) */
export interface CalcCheck { counts: import("../calc/engine").SelfCheck["counts"]; different: import("../calc/engine").SelfCheck["different"]; formulas: number;
  /** why values were read in the engine's General format (null: the 15-digit format applied) */ styleError: string | null;
  ms: { load: number; build: number; evaluate: number; check: number } }
export type SlideListsReq = DesignReq & { slides?: number[]; /** the date the page shows (its clock) */ today?: string };
export interface SlideList { slide: number; dl: import("../render/excel-dl").TableDL }
/** the stage's request: slide `slide` of the current design and version. `known`: the image ids the page already has
    (not sent again); `fresh`: measure everything again (fonts arrived) */
export interface StageReq { slide: number; today?: string; known: string[]; fresh?: boolean;
  /** soft shadows (B3: the page's option) */ soft?: boolean;
  /** "all": every font's text drawn as outlines (S4.4: screen = PDF in pixels; a switch until decided) */ outlines?: "all";
  /** the tables' nodes too (tests and the parity tools; the page draws the markup) */ nodes?: boolean;
  /** the keys of the layers the page shows: those come without their markup (the page keeps its own) */ have?: string[] }
/** a layer of the stage (its key names its markup: the same key, the same markup): one table (its display list in table px, placed by `box`: x, y, the scale and its size in
    slide px), one text box (`note`: its bubble and text in slide px, `box` its own box) or the furniture painted
    between them (slide px). `key` names the content: the same key, the same nodes (a table keeps its key while its
    cells do not change, wherever it moves). Text boxes come in the order the slide draws them: each table's (top,
    bottom, left, right, as noteParts lists them) then the notes section */
export interface StageLayer { key: string; table: number | null; note?: boolean; box: { x: number; y: number; w: number; h: number; scale: number } | null;
  /** the nodes (a table's only when asked: StageReq.nodes) */
  nodes: import("../dl/types").DisplayList;
  /** the layer as SVG markup, one piece per node (core/dl/svg.ts svgChunks), pictures as "sbimg:<id>" for the page to
      replace with its URL for them */
  svg: string[] }
export interface StageSlide {
  slide: number; /** the runtime slide's id */ id: string; design: Design;
  layers: StageLayer[];
  /** pictures the page did not have (`known`), by image id */
  images: Record<string, string>;
}
/** calls the worker makes */
export interface PageMethods {
  /* the deck's storage (helper/slidebuilder/decks.py, through the page's backend) */
  deckSnapshot(a: { key: string }): DeckSnapshot;
  deckTail(a: { key: string; since: Record<string, number> }): TailResult;
  deckAppend(a: { key: string; writer: string; record: DeckRecord }): { journal: string; offset: number; at: number };
  deckCompact(a: { key: string; baseGen: number; snapshot: DeckSnapshot }): { gen: number };
  deckRotate(a: { key: string; writer: string }): { deleted: string[] };
  deckPrepare(a: { key: string; writer: string }): unknown;
  digitWidth(a: { font: string }): number;
  /** text measured with the page's fonts for the display list (decision 2026-10-12, 3): one call per measuring round of a table */
  measureRuns(a: { runs: import("../platform").RunReq[] }): import("../platform").RunMetrics[];
  breakLines(a: { reqs: import("../platform").LinesReq[] }): string[][];
  convertPicture(a: { bytes: Uint8Array; ext: string }): string | null;
  /** Liquid Glass's picture analysis (xlsx/drawing.ts analyzeImages) with the page's canvas */
  analyzeImages(a: { srcs: string[] }): [string, ImgMeta][];
  /** the fonts the core measures text with (S4.4): the library's faces and this PC's (state/fontfiles.ts measureCatalog) */
  fontCatalog(a: Record<string, never>): import("../text/resolve").CatalogFont[];
  /** a font file of that catalog (null: unreadable) */
  fontFile(a: { source: "library" | "system"; file: string }): ArrayBuffer | null;
  /** the bytes of a linked workbook: a file of the same folder as the open one (null when it is not there, or the
      page runs from disk) */
  linkedWorkbook(a: { name: string }): ArrayBuffer | null;
}
/** events from the worker */
export interface CoreEvents {
  [k: string]: unknown;
  doc: DocEvent;
  /** slices of workbook `book` (the open one, or the one being opened) */
  slices: { book: number; shared: SharedSlice | null; sheets: SheetSlice[] };
  /** after a change, the slide on the stage drawn again (the stage's last request, S4.1) */
  stage: StageSlide;
  progress: { text: string; frac: number | null } | null;
  error: { message: string; stack?: string };
  /** a workbook left while its changes were not saved yet: they are saved now */
  retiredSaved: { name: string };
  /** the open deck at rest while this page is the only one there: the snapshot the page sends on pagehide to compact
      it (04 §4.4); null when there is none any more */
  rest: { key: string; baseGen: number; json: string } | null;
}
export type PageEvents = Record<string, never>;
export type { DeckVersion };

/* ---- the export workers (PLAN S3.7): on demand, up to three; each takes one (design, version) at a time ---- */
/** what an export makes: a vector PDF, a PDF of pictures (PNG pages at `scale`), or PNG files */
export type ExportKind = "pdf" | "pictures" | "png";
export interface ExportJob extends SlideListsReq {
  kind: ExportKind;
  /** pixels per slide px for pictures and PNGs (2: "as pictures", B9; 3: PNG and clipboard, 4800 × 2700) */
  scale: number;
  /** the PDF's title */
  title: string;
  /** the fonts the PDF may embed: the deck's library faces and this PC's font files (the helper's /sysfonts) */
  catalog: import("../text/resolve").CatalogFont[];
}
export interface ExportResult {
  /** the PDF, or one PNG per slide */
  files: ArrayBuffer[];
  /** CSS font lists none of whose families could be embedded (drawn with a default face) */
  missing: string[];
  /** fonts of the deck's library or this PC that could not be read (WOFF2 …): the next family of the list drew them */
  unreadable?: string[];
  /** where the time went, ms */
  ms: { lists: number; fonts: number; write: number };
}
/** thumbnails (S4.3, B14): slides of a design and version as pictures `width` px wide, drawn by an export worker */
export interface ThumbJob extends SlideListsReq {
  /** pixels across (the thumbnail's CSS width × the screen's pixel ratio) */
  width: number;
  /** the deck's library fonts (the slides may use them; this PC's fonts the worker has already) */
  library: import("../text/resolve").CatalogFont[];
  /** the key of the picture the page shows of each slide (by slide number): drawn again only when the slide changed */
  have: Record<number, string>;
}
/** a slide's picture (null: the page has it – the same key – or it cannot be drawn here) and the key of what it shows */
export interface Thumb { slide: number; key: string; bitmap: ImageBitmap | null }
/** calls the page makes on an export worker */
export interface ExportMethods {
  run(a: ExportJob): ExportResult;
  thumbs(a: ThumbJob): Thumb[];
  /** the channel to the core worker (see CoreMethods.linkExport) */
  linkCore(a: { port: MessagePort }): void;
}
/** calls an export worker makes on the page */
export interface ExportPageMethods {
  /** a font file of the catalog (null: unreadable); its bytes are kept by the worker */
  fontFile(a: { source: "library" | "system"; file: string }): ArrayBuffer | null;
  /** a picture the PDF cannot take as it is (GIF, SVG, WebP, BMP, or a URL a worker cannot read) as PNG bytes, drawn
      by the page; null when it cannot be read (it is left out, as a broken picture) */
  pictureBytes(a: { src: string }): ArrayBuffer | null;
}
/** what an export worker asks the core worker on its channel */
export interface ExportCoreMethods { slideLists(a: SlideListsReq): SlideList[] }
