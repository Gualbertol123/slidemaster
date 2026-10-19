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
export type ItemKind = "chart" | "shape";
export interface ChartItem { kind: "chart"; type: "pie" | "donut" | "bar" | "column" | "line";
  values: DataRef; labels?: DataRef; /** series name: the title when `title` is unset */ series?: string;
  /** "" = no title; unset = the series name */ title?: string; legend?: "right" | "bottom" | "none"; show?: ("label" | "value" | "percent")[];
  /** slice index → colour; absent = the design's palette */ colors?: Record<string, string>; /** degrees clockwise from 12 o'clock */ startAngle?: number;
  /** label text style over the deck's "note" style */ fmt?: TextFmt;
  box: Box; /** laid out beside a table, as a text box; else placed at `box` */ attach?: { table: string; side: Side } }
export type ShapeKind = "rect" | "round" | "circle" | "pill" | "arrow" | "bubble" | "icon";
export interface ShapeItem { kind: "shape"; shape: ShapeKind; /** a built-in icon name (render/icons.ts) */ icon?: string;
  /** may quote cells: {Sheet!C7} / {[Peers.xlsx]Peer!F7} */ text?: string;
  /** unset = the design's material; "none" = no fill */ fill?: string; border?: { color: string; w: number; dash?: "solid" | "dashed" | "dotted" } | null; radius?: number;
  fmt?: TextFmt & { valign?: "top" | "middle" | "bottom"; pad?: number }; /** bubble tail tip, slide px */ tail?: { x: number; y: number };
  box: Box; attach?: { table: string; side: Side } }
export type Item = ChartItem | ShapeItem;
/** free layout of one design of a slide (4.4, B18; docs/next/07 §5.1, ADR-017): with `on`, the slide's tables, text boxes and
    items sit at these boxes (slide px) – keys "t:<tableId>", "n:<noteKey>", "i:<itemId>"; a table's `scale` is its drawn
    scale (its box's width and height follow from it); `on: false` keeps the boxes for the next switch-on. The slide's notes
    section ("slide:notes") is not in it: it is placed by its own x / y in every layout */
export interface FreeLayout { on: boolean; items: Record<string, Box & { scale?: number }> }
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
  /** the current consulting design's options, as set for it (Design… › Layout); defaults in model/designs.ts */ consult?: Partial<import("./designs").ConsultOptions> }
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
type ItemFields = Omit<ChartItem, "kind" | "colors" | "fmt"> & Omit<ShapeItem, "kind" | "fmt">;
export type ItemPatch = Nullable<Partial<ItemFields>> & { kind?: ItemKind; colors?: Record<string, string | null> | null; fmt?: Record<string, unknown> | null };
export type Op =
  | { op: "preset.set"; preset: Preset | null }
  | { op: "slide.patch"; id: string; patch: Nullable<Pick<SlideDef, "title" | "subtitle" | "date" | "note" | "logo" | "layout" | "align" | "valign" | "scale" | "subs">> & { notes?: Record<string, Note | null> | null; sizes?: Partial<Record<Design, SlideSizing | null>> | null; fmt?: Partial<Record<SlideTextKey, TextFmt | null>> | null; free?: Partial<Record<Design, FreeLayout | null>> | null } }
  | { op: "table.patch"; id: string; patch: { name?: string | null; gridH?: "on" | "off" | null; gridV?: "on" | "off" | null; cols?: Record<string, number | null> | null; rows?: Record<string, number | null> | null; scales?: Record<string, ScaleRule | null> | null; merges?: Record<string, "merge" | "split" | null> | null; sizes?: Partial<Record<Design, TableSizes | null>> | null; cellGrid?: Record<string, CellGrid | null> | null; borders?: Record<string, CellBorders | null> | null } }
  | { op: "cell.patch"; sheet: string; ref: string; patch: Nullable<CellEdit> }
  /** field-level patch of one slide item; `patch: null` deletes it; a patch with `kind` on a missing id creates it */
  | { op: "item.patch"; slide: string; id: string; patch: ItemPatch | null }
  | { op: "style.patch"; patch: Nullable<Omit<StylePatch, "pn" | "footer" | "theme" | "text" | "colors">> & { pn?: Nullable<PageNumbers> | null; footer?: Nullable<Footer> | null; theme?: Nullable<Theme> | null; text?: Partial<Record<TextRole, TextFmt | null>> | null; colors?: Partial<Record<ColorKey, string | null>> | null; designs?: Partial<Record<Design, Look | null>> | null } };

/* ---- runtime ---- */
export interface RuntimeSlide {
  id: string; type: SlideType; cfg: SlideDef; tables: TableLayout[]; missing: number;
  title: string; subtitle: string; label: string;
  _auto?: Layout | null;
}
