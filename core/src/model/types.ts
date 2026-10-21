/* Persistent data (see docs/ARCHITECTURE.md §2) and runtime slide objects. */
import type { TableLayout } from "../xlsx/types";

export interface Layout { bands: number[][]; w: number[] }
/** colour scale: deeper green/red with the size of the number (per row, per column or the whole range) */
export interface ScaleRule { range: string; dir: "row" | "col" | "all"; mode: "zero" | "minmax"; fill: boolean; ink: boolean; invert?: boolean }
interface TableExtras { name?: string; cols?: Record<string, number>; rows?: Record<string, number>; scales?: Record<string, ScaleRule>; merges?: Record<string, "merge" | "split">;
  /** gridlines: "on" draws a line at every row/column edge, "off" removes them; unset = as in Excel */ gridH?: "on" | "off"; gridV?: "on" | "off";
  /** column widths / row heights of one design (over cols/rows, which older decks share between designs) */ sizes?: Partial<Record<Design, TableSizes>>;
  /** gridlines on selected cells (4.4, B20), by the cell's A1 address: a light layer of their own, never a border */ cellGrid?: Record<string, CellGrid>;
  /** cell borders on the slide (4.4, B28), by the cell's A1 address: over the workbook's, which is never changed */ borders?: Record<string, CellBorders> }
/** a cell's own border on one side (product owner 2026-10-19: Borders ▾ as Excel's): a style and a colour, or "none" (the
    workbook's border of that side removed on the slide) */
export type CellBorderSide = { style: "thin" | "medium" | "thick" | "dashed" | "dotted" | "double"; color: string } | "none";
export type CellBorders = Partial<Record<"top" | "left" | "right" | "bottom", CellBorderSide>>;
/** a cell's own gridlines (07 §5.2; product owner 2026-10-19: separate from the cell borders, drawn where the cell has no
    border): h = its top and bottom edges, v = its left and right ("off" = none, as unset); o = part of an outlined rectangle
    (its edges where the next cell is not outlined – the outline of the selection); c = colour, w = weight in px (0.5–3) */
export interface CellGrid { h?: "on" | "off"; v?: "on" | "off"; o?: boolean; c?: string; w?: number }
export interface TableSizes { cols?: Record<string, number>; rows?: Record<string, number> }
export type TableDef =
  | ({ id: string; sheet: string; kind: "markers"; anchor: string; index: number } & TableExtras)
  | ({ id: string; sheet: string; kind: "range"; range: string; grow?: boolean } & TableExtras);
export type SlideType = "cover" | "index" | "content";
export type Side = "top" | "bottom" | "left" | "right";
/** text box next to a table; key in SlideDef.notes = "<tableId>:<side>" */
/** formatting of one piece of slide text (titles, cover texts, text boxes, deck text styles); size in slide px */
export interface TextFmt { font?: string; size?: number; b?: boolean; i?: boolean; color?: string; align?: "left" | "center" | "right";
  /** line spacing (1 = single) */ lh?: number }
/** deck-wide text styles: one per kind of text, so all text of a kind is edited in one place */
export type TextRole = "title" | "subtitle" | "table" | "note" | "index" | "pageno";
/** slide texts that can be formatted one by one (stored in SlideDef.fmt) */
export type SlideTextKey = "title" | "subtitle" | "note" | "date";
export interface Note { text: string; font?: string; size?: number; /** line spacing (1 = single) */ lh?: number; /** space between paragraphs, in lines */ pgap?: number; b?: boolean; i?: boolean; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; color?: string; w?: number; h?: number;
  /** draw the text box as a card (glass bubble / Excel-style box) */ bubble?: boolean;
  /** placed freely on the slide at x/y (slide px) after being moved; unset = next to its table */ x?: number; y?: number;
  /** left/right box only: a column beside ALL the tables of the slide, as tall as all of them */ span?: boolean;
  /** automated comment: the text is written from the table's numbers with these settings (model/comment.ts) */ auto?: import("./comment").CommentCfg }
/* ---- slide items (4.3, B16/B17; docs/next/07 §2.2, ADR-015): charts and callouts, drawn in every design ---- */
/** cells an item reads: a sheet id ("Sheet" or "[File.xlsx]Sheet") + one A1 rectangle, or a table of the deck + a range inside its sheet */
export type DataRef = { sheet: string; range: string } | { table: string; range: string };
/** a rectangle in slide px (1600 × 900) */
export interface Box { x: number; y: number; w: number; h: number }
export type ItemKind = "chart" | "shape" | "line";
/* ---- charts with series (4.7, M14; docs/next/09 §2.2, ADR-015 amendment). Every field optional: a chart without `sers`
   draws exactly as before (values / labels / series / legend / colors keep their meaning; a pie stays a pie) ---- */
export type ChartType = "pie" | "donut" | "bar" | "column" | "line" | "area" | "scatter" | "waterfall" | "combo";
export type SeriesType = "column" | "bar" | "line" | "area" | "scatter";
/** a line's look: colour, weight px, dash */
export interface LineStyle { color?: string; w?: number; dash?: "solid" | "dashed" | "dotted" | "dashdot" }
/** a line that can be switched off (S14.P review, 2): unset = the design's default, "none" = no line, else its look.
    Not `null`: item.patch's null deletes a plain key, so a stored null could never exist for `frame` / `titleRule`. Inside
    a map entry (`groups[g].divider`, `axes[a].line`) the whole entry is cloned, so a null there would survive – the
    page writes "none" there too, and a reader takes a null as "none" */
export type LineOrNone = LineStyle | "none";
export interface ChartSeries {
  /** order (ties: id); series are drawn and listed by n */ n: number;
  /** text, or a cell (follows the workbook) */ name?: string | DataRef;
  /** one or more rectangles, concatenated (values from different places) */ vals: DataRef[];
  /** scatter: the x values */ xs?: DataRef[];
  /** "actual inside target": the target per point (an outlined bar of that height) */ target?: DataRef[];
  /** the category group the values stand on (default: the first) */ group?: string;
  /** combo: this series' type (else the chart's) */ type?: SeriesType;
  /** the value axis (y2 = right) */ axis?: "y" | "y2";
  /** series with the same stack key stack (column / bar / area) */ stack?: string;
  color?: string; line?: LineStyle; fill?: "solid" | "none";
  /** line / scatter: smoothed (Catmull–Rom, 09 §3.2) */ smooth?: boolean;
  marker?: { shape?: "circle" | "square" | "diamond" | "triangle" | "none"; size?: number; color?: string };
  labels?: { show: ("value" | "name" | "category" | "percent" | "ofTarget")[];
    pos?: "above" | "below" | "left" | "right" | "center" | "inEnd" | "inBase" | "outEnd";
    fmt?: TextFmt; /** a number format code; else the cells' */ num?: string };
  /** per point, by index: colour, marker colour (hex), label text (null = none); `total`: a waterfall's total column,
      standing on the axis (Excel's "Set as total"; 09 §2.2, §3.2) */
  points?: Record<string, { color?: string; marker?: string; label?: string | null; total?: boolean }>;
  /** kept, not drawn */ hide?: boolean;
}
/** a list of categories on the x axis; groups stand side by side, an optional divider between them */
export interface ChartGroup { n: number; cats: DataRef | string[]; divider?: LineOrNone | null; label?: string }
export interface ChartAxis { show?: boolean; min?: number; max?: number; step?: number; num?: string; title?: string;
  grid?: boolean; fmt?: TextFmt; line?: LineOrNone | null }
/** where a mark stands: a series' point, a category group's edge, or data coordinates (a category name or index) */
export type MarkAt = { s: string; i: number }
  | { g: string; edge: "start" | "end" }
  | { x: number | string; y: number; axis?: "y" | "y2" };
/** an annotation in data coordinates (it follows the data and a scenario value) */
export interface ChartMark { kind: "arrow" | "line" | "band" | "icon" | "text";
  a: MarkAt; b?: MarkAt | "floor" | "ceiling";
  style?: LineStyle & { heads?: Heads }; icon?: string; size?: number; text?: string; fmt?: TextFmt; dy?: number }
/** the legend's place (F15); "inside-*" draws a card behind it */
export type LegendAt = "right" | "left" | "top" | "bottom" | "top-right" | "inside-tl" | "inside-tr" | "none";
export interface ChartItem { kind: "chart"; /** without `sers` a type other than donut draws as a pie, as before 4.7 (09 §2.2) */ type: ChartType;
  values: DataRef; labels?: DataRef; /** series name: the title when `title` is unset */ series?: string;
  /** "" = no title; unset = the series name */ title?: string; legend?: "right" | "bottom" | "none"; show?: ("label" | "value" | "percent")[];
  /** slice index → colour; absent = the design's palette */ colors?: Record<string, string>; /** degrees clockwise from 12 o'clock */ startAngle?: number;
  /** label text style over the deck's "note" style */ fmt?: TextFmt;
  box: Box; /** laid out beside a table, as a text box; else placed at `box` */ attach?: { table: string; side: Side };
  /* 4.7 (M14; 09 §2.2): maps merged per entry by item.patch (a whole series / group / axis / mark) */
  sers?: Record<string, ChartSeries>; groups?: Record<string, ChartGroup>; axes?: Partial<Record<"x" | "y" | "y2", ChartAxis>>;
  marks?: Record<string, ChartMark>;
  stack?: "none" | "stacked" | "percent"; /** % of a bar */ gap?: number; overlap?: number;
  /** wins over `legend` when set */ legendAt?: LegendAt;
  /** series id (or a pie's point index) → out of the legend, still drawn */ legendHide?: Record<string, true>;
  /** unset = the design's; "none" = none */ frame?: LineOrNone; titleRule?: LineOrNone; /** the plot area inside the box (optional) */ plot?: Box;
  /** the title's own format (`fmt` is the labels') */ titleFmt?: TextFmt }
/* ---- lines and annotations on the slide (4.8, M15; docs/next/09 §2.3) ---- */
/** "bar" = a limiter tick */
export type Head = "none" | "arrow" | "triangle" | "stealth" | "oval" | "diamond" | "bar";
export interface Heads { a?: Head; b?: Head; size?: "s" | "m" | "l" }
/** an end attached to an object: it follows that point of the object in the design being drawn */
export interface Anchor { /** "t:<table>" | "i:<item>" | "n:<noteKey>" */ to: string;
  at: "l" | "r" | "t" | "b" | "c" | "tl" | "tr" | "bl" | "br"; dx?: number; dy?: number }
export type LineRoute = "straight" | "elbow" | "curve" | "bracket" | "range";
export interface LineItem { kind: "line"; route: LineRoute;
  /** slide px; the ends when not attached */ a: { x: number; y: number }; b: { x: number; y: number };
  /** elbow: where the bend sits (0–1 along the run); bracket: depth px; curve: bulge */ mid?: number;
  /** elbow: horizontal first or vertical first */ bend?: "hv" | "vh";
  /** attachment per end */ ends?: { a?: Anchor; b?: Anchor };
  /** colour, weight 0.5–8 px, dash, heads */ style?: LineStyle & { heads?: Heads };
  /** a label at the middle (may quote cells, {Sheet!C7}) */ text?: string; fmt?: TextFmt;
  /** the bounds of a–b padded to ≥ 1 px each side (item.patch needs w, h > 0); drawing, hits and exports take the
      geometry from the resolved ends, never from it */ box: Box;
  /** never beside a table: a line's ends attach instead (`ends`) */ attach?: undefined }
export type ShapeKind = "rect" | "round" | "circle" | "pill" | "arrow" | "bubble" | "icon";
export interface ShapeItem { kind: "shape"; shape: ShapeKind;
  /** a built-in icon name (render/icons.ts), or "tabler:<name>" / "tabler-filled:<name>" (4.8, 09 §2.4) */ icon?: string;
  /** an outline icon's stroke width, px at 24 (1–3, default 2; 4.8) */ stroke?: number;
  /** may quote cells: {Sheet!C7} / {[Peers.xlsx]Peer!F7} */ text?: string;
  /** unset = the design's material; "none" = no fill */ fill?: string; border?: { color: string; w: number; dash?: "solid" | "dashed" | "dotted" } | null; radius?: number;
  fmt?: TextFmt & { valign?: "top" | "middle" | "bottom"; pad?: number }; /** bubble tail tip, slide px */ tail?: { x: number; y: number };
  box: Box; attach?: { table: string; side: Side } }
export type Item = ChartItem | ShapeItem | LineItem;
/** free layout of one design of a slide (4.4, B18; docs/next/07 §5.1, ADR-017): with `on`, the slide's tables, text boxes and
    items sit at these boxes (slide px) – keys "t:<tableId>", "n:<noteKey>", "i:<itemId>"; a table's `scale` is its drawn
    scale (its box's width and height follow from it); `on: false` keeps the boxes for the next switch-on. The slide's notes
    section ("slide:notes") is not in it: it is placed by its own x / y in every layout */
export interface FreeLayout { on: boolean; items: Record<string, Box & { scale?: number; /** a line's ends in this design (4.8, 09 §2.3) */ a?: { x: number; y: number }; b?: { x: number; y: number } }> }
export interface SlideDef {
  id: string; type: SlideType;
  title?: string | null; subtitle?: string | null; date?: string | null; note?: string | null;
  tables: string[]; layout?: Layout | null; logo?: boolean;
  align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; scale?: number; notes?: Record<string, Note>;
  /** index slide: show the subtitles of the slides (default true) */ subs?: boolean;
  /** formatting of this slide's title, subtitle, cover note and date (over the deck text styles) */ fmt?: Partial<Record<SlideTextKey, TextFmt>>;
  /** table sizing of one design (over layout/scale, which older decks share between designs) */ sizes?: Partial<Record<Design, SlideSizing>>;
  /** charts and callouts (4.3), by item id; changed only by `item.patch` */ items?: Record<string, Item>;
  /** free layout per design (4.4, B18); an entry is replaced whole by slide.patch */ free?: Partial<Record<Design, FreeLayout>>;
  /** this slide's own parts of a consulting design's look, over the deck's (B29, 08 §2.8); an entry is replaced whole by
      slide.patch */ looks?: Partial<Record<Design, Partial<import("./designs").ConsultOptions>>>;
  /** hidden in these designs (4.6, B47): left out of their exports, page numbers and contents; merged per design */ hide?: Partial<Record<Design, true>>;
}
/** how one design shows a slide's tables: arrangement and weights, fixed scale, alignment */
export interface SlideSizing { layout?: Layout; scale?: number; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom" }
/** a named version of the deck (e.g. "Chief", "All"): the cells removed from it, per sheet ("C5:D9" ranges) */
export interface DeckVersion { id: string; name: string; hide: Record<string, string[]> }
export interface Preset { sheets: string[]; tables: TableDef[]; slides: SlideDef[]; version?: number; updated?: number;
  /** named versions for export (wizard › Versions) */ versions?: DeckVersion[];
  /** linked workbooks (4.2, B22): file names in the same folder whose sheets the deck draws from, named by the sheet id
      "[File.xlsx]Sheet" wherever a sheet name is stored (ADR-014) */ links?: string[] }

export interface PageNumbers { on: boolean; start: number; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; font: string; size: number; format: "n" | "nN" | "page" | "p"; style: "capsule" | "plain"; cover: boolean }
export interface Footer { on: boolean; text: string; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; size: number; style: "capsule" | "plain"; cover: boolean }
/** colour theme: c1–c4 = wallpaper colours, a1/a2 = accent (cover bar, index numbers, heading rules) */
export interface Theme { id: string; c1: string; c2: string; c3: string; c4: string; a1: string; a2: string }
/** colours that override the theme (all designs; some only apply to the Excel designs, see model/style.ts COLOR_KEYS) */
export type ColorKey = "accent" | "bg" | "head" | "headInk" | "total" | "totalInk" | "ink" | "pos" | "neg" | "stripe" | "rule";
/** the slide design; "mckinsey" / "bain" are the consulting designs, shown as "Consulting Navy" / "Consulting Red" (model/designs.ts) */
export type Design = "glass" | "excel" | "clean" | "mckinsey" | "bain";
export interface Style { design: Design; glass: "subtle" | "medium" | "strong"; color: number; logo: string; pn: PageNumbers;
  /** corner roundness, % of default (0–200) */ radius: number; /** background ↔ surfaces contrast 0–100 (50 = as designed) */ contrast: number; logoBubble: boolean; footer: Footer; theme: Theme;
  /** text styles of the deck, per kind of text */ text: Partial<Record<TextRole, TextFmt>>;
  /** colour overrides over the theme */ colors: Partial<Record<ColorKey, string>>;
  /** the current consulting design's look, as set for it (the ribbon's parts, B29; a slide's own over it in its context, render/look.ts); defaults in model/designs.ts */ consult?: Partial<import("./designs").ConsultOptions> }
/** theme, colours and text styles – shared by all designs, or for one design only (StylePatch.designs) */
export interface Look { theme?: Partial<Theme>; colors?: Partial<Record<ColorKey, string>>; text?: Partial<Record<TextRole, TextFmt>>;
  /** a consulting design's options (model/designs.ts ConsultOptions; kept under designs[d] only) */ consult?: Partial<import("./designs").ConsultOptions> }
export type StylePatch = Partial<Omit<Style, "pn" | "footer" | "theme" | "text" | "colors">> & { pn?: Partial<PageNumbers>; footer?: Partial<Footer>; theme?: Partial<Theme>; text?: Partial<Record<TextRole, TextFmt>>; colors?: Partial<Record<ColorKey, string>>;
  /** settings for one design only, over the shared ones */ designs?: Partial<Record<Design, Look>> };

/** fill = highlight (a capsule in Liquid Glass); bg = cell colour that replaces the Excel colour ("none" removes it) */
export interface CellEdit { text?: string; orig?: string; font?: string; sz?: number; b?: boolean; i?: boolean; color?: string; fill?: string; bg?: string;
  /** conditional formatting copied with the format painter: the rules of "Sheet!A1" applied to this cell ("none" = no rules) */ cf?: string; align?: string; role?: string }
export type Edits = Record<string, Record<string, CellEdit>>;

/** data formats this page reads and writes – the same numbers as SCHEMA in helper/slidebuilder/upgrade.py
    (a test checks it). Sent with every change; a helper with other formats refuses it ("reload the page"). */
export const FORMATS = { workbook: 3, config: 3, prefs: 1 } as const;
export interface WorkbookDoc {
  schema: number; workbook: string; rev: number; updated?: number; updatedBy?: string;
  preset: Preset | null; style: StylePatch; edits: Edits;
  /** last 20 revisions (written by the helper): who changed what, so clients can name remote authors */
  log?: { rev: number; by: string | null; at: number | null }[];
}
export interface ConfigDoc { schema: number; rev: number; updated?: number; updatedBy?: string; defaults: { style: StylePatch } }
export interface Prefs { lastFile?: string | null; pdfMode?: "exact" | "vector" | null; zoom?: number | "fit" | null; /** version shown on screen, per workbook */ versions?: Record<string, string> | null; /** soft shadows on screen: one blurred shape instead of the 5 layers the PDF draws (B3) */ softShadows?: boolean | null }

type Nullable<T> = { [K in keyof T]?: T[K] | null };
type ItemMaps = "colors" | "fmt" | "sers" | "groups" | "axes" | "marks" | "legendHide" | "titleFmt";
type ItemFields = Omit<ChartItem, "kind" | ItemMaps> & Omit<ShapeItem, "kind" | "fmt"> & Omit<LineItem, "kind" | "fmt" | "attach">;
/** an item.patch: plain keys replaced whole (null deletes), maps merged per entry (null deletes an entry, or the map) */
export type ItemPatch = Nullable<Partial<ItemFields>> & { kind?: ItemKind; colors?: Record<string, string | null> | null; fmt?: Record<string, unknown> | null;
  sers?: Record<string, ChartSeries | null> | null; groups?: Record<string, ChartGroup | null> | null;
  axes?: Partial<Record<"x" | "y" | "y2", ChartAxis | null>> | null; marks?: Record<string, ChartMark | null> | null;
  legendHide?: Record<string, true | null> | null; titleFmt?: Record<string, unknown> | null };
export type Op =
  | { op: "preset.set"; preset: Preset | null }
  | { op: "slide.patch"; id: string; patch: Nullable<Pick<SlideDef, "title" | "subtitle" | "date" | "note" | "logo" | "layout" | "align" | "valign" | "scale" | "subs">> & { notes?: Record<string, Note | null> | null; sizes?: Partial<Record<Design, SlideSizing | null>> | null; fmt?: Partial<Record<SlideTextKey, TextFmt | null>> | null; free?: Partial<Record<Design, FreeLayout | null>> | null; looks?: Partial<Record<Design, Partial<import("./designs").ConsultOptions> | null>> | null; hide?: Partial<Record<Design, true | null>> | null } }
  | { op: "table.patch"; id: string; patch: { name?: string | null; gridH?: "on" | "off" | null; gridV?: "on" | "off" | null; cols?: Record<string, number | null> | null; rows?: Record<string, number | null> | null; scales?: Record<string, ScaleRule | null> | null; merges?: Record<string, "merge" | "split" | null> | null; sizes?: Partial<Record<Design, TableSizes | null>> | null; cellGrid?: Record<string, CellGrid | null> | null; borders?: Record<string, CellBorders | null> | null } }
  | { op: "cell.patch"; sheet: string; ref: string; patch: Nullable<CellEdit> }
  /** field-level patch of one slide item; `patch: null` deletes it; a patch with `kind` on a missing id creates it */
  | { op: "item.patch"; slide: string; id: string; patch: ItemPatch | null }
  | { op: "style.patch"; patch: Nullable<Omit<StylePatch, "pn" | "footer" | "theme" | "text" | "colors">> & { pn?: Nullable<PageNumbers> | null; footer?: Nullable<Footer> | null; theme?: Nullable<Theme> | null; text?: Partial<Record<TextRole, TextFmt | null>> | null; colors?: Partial<Record<ColorKey, string | null>> | null; designs?: Partial<Record<Design, Look | null>> | null } }
  /* New slide, Add table (4.6, F16; docs/next/09 §2.8). A deck receiving them is format 5 first (ops.ts needsV5) */
  /** a slide inserted after that slide id (null = first; a missing one = at the end); skipped when its id exists */
  | { op: "slide.add"; slide: SlideDef; after: string | null }
  /** the inverse of slide.add (and the undo of New slide); skipped when the id is missing */
  | { op: "slide.remove"; id: string }
  /** the def joins preset.tables if its id is new (an existing def is kept); its id joins slide.tables at `at` (else at
      the end); skipped when the table is on that slide already */
  | { op: "table.add"; table: TableDef; slide: string; at?: number }
  /** the inverse of table.add: the id leaves the slide's tables; the def stays in preset.tables */
  | { op: "table.remove"; id: string; slide: string };

/* ---- runtime ---- */
export interface RuntimeSlide {
  id: string; type: SlideType; cfg: SlideDef; tables: TableLayout[]; missing: number;
  title: string; subtitle: string; label: string;
  _auto?: Layout | null;
}
