/* Persistent data (see docs/ARCHITECTURE.md §3) and runtime slide objects. */
import type { TableLayout } from "../xlsx/types";

export interface Layout { bands: number[][]; w: number[] }
/** colour scale: deeper green/red with the size of the number (per row, per column or the whole range) */
export interface ScaleRule { range: string; dir: "row" | "col" | "all"; mode: "zero" | "minmax"; fill: boolean; ink: boolean; invert?: boolean }
interface TableExtras { name?: string; cols?: Record<string, number>; rows?: Record<string, number>; scales?: Record<string, ScaleRule>; merges?: Record<string, "merge" | "split">;
  /** gridlines: "on" draws a line at every row/column edge, "off" removes them; unset = as in Excel */ gridH?: "on" | "off"; gridV?: "on" | "off" }
export type TableDef =
  | ({ id: string; sheet: string; kind: "markers"; anchor: string; index: number } & TableExtras)
  | ({ id: string; sheet: string; kind: "range"; range: string; grow?: boolean } & TableExtras);
export type SlideType = "cover" | "index" | "content";
export type Side = "top" | "bottom" | "left" | "right";
/** text box next to a table; key in SlideDef.notes = "<tableId>:<side>" */
/** formatting of one piece of slide text (titles, cover texts, text boxes, deck text styles); size in slide px */
export interface TextFmt { font?: string; size?: number; b?: boolean; i?: boolean; color?: string; align?: "left" | "center" | "right" }
/** deck-wide text styles: one per kind of text, so all text of a kind is edited in one place */
export type TextRole = "title" | "subtitle" | "table" | "note" | "index" | "pageno";
/** slide texts that can be formatted one by one (stored in SlideDef.fmt) */
export type SlideTextKey = "title" | "subtitle" | "note" | "date";
export interface Note { text: string; font?: string; size?: number; b?: boolean; i?: boolean; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; color?: string; w?: number; h?: number;
  /** draw the text box as a card (glass bubble / Excel-style box) */ bubble?: boolean;
  /** placed freely on the slide at x/y (slide px) after being moved; unset = next to its table */ x?: number; y?: number;
  /** left/right box only: a column beside ALL the tables of the slide, as tall as all of them */ span?: boolean;
  /** automated comment: the text is written from the table's numbers with these settings (model/comment.ts) */ auto?: import("./comment").CommentCfg }
export interface SlideDef {
  id: string; type: SlideType;
  title?: string | null; subtitle?: string | null; date?: string | null; note?: string | null;
  tables: string[]; layout?: Layout | null; logo?: boolean;
  align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; scale?: number; notes?: Record<string, Note>;
  /** index slide: show the subtitles of the slides (default true) */ subs?: boolean;
  /** formatting of this slide's title, subtitle, cover note and date (over the deck text styles) */ fmt?: Partial<Record<SlideTextKey, TextFmt>>;
}
export interface Preset { sheets: string[]; tables: TableDef[]; slides: SlideDef[]; version?: number; updated?: number }

export interface PageNumbers { on: boolean; start: number; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; font: string; size: number; format: "n" | "nN" | "page" | "p"; style: "capsule" | "plain"; cover: boolean }
export interface Footer { on: boolean; text: string; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; size: number; style: "capsule" | "plain"; cover: boolean }
/** colour theme: c1–c4 = wallpaper colours, a1/a2 = accent (cover bar, index numbers, heading rules) */
export interface Theme { id: string; c1: string; c2: string; c3: string; c4: string; a1: string; a2: string }
/** colours that override the theme (all designs; some only apply to the Excel designs, see model/style.ts COLOR_KEYS) */
export type ColorKey = "accent" | "bg" | "head" | "headInk" | "total" | "totalInk" | "ink" | "pos" | "neg" | "stripe" | "rule";
export type Design = "glass" | "excel" | "clean";
export interface Style { design: Design; glass: "subtle" | "medium" | "strong"; color: number; logo: string; pn: PageNumbers;
  /** corner roundness, % of default (0–200) */ radius: number; /** background ↔ surfaces contrast 0–100 (50 = as designed) */ contrast: number; logoBubble: boolean; footer: Footer; theme: Theme;
  /** text styles of the deck, per kind of text */ text: Partial<Record<TextRole, TextFmt>>;
  /** colour overrides over the theme */ colors: Partial<Record<ColorKey, string>> }
export type StylePatch = Partial<Omit<Style, "pn" | "footer" | "theme" | "text" | "colors">> & { pn?: Partial<PageNumbers>; footer?: Partial<Footer>; theme?: Partial<Theme>; text?: Partial<Record<TextRole, TextFmt>>; colors?: Partial<Record<ColorKey, string>> };

/** fill = highlight (a capsule in Liquid Glass); bg = cell colour that replaces the Excel colour ("none" removes it) */
export interface CellEdit { text?: string; orig?: string; font?: string; sz?: number; b?: boolean; i?: boolean; color?: string; fill?: string; bg?: string;
  /** conditional formatting copied with the format painter: the rules of "Sheet!A1" applied to this cell ("none" = no rules) */ cf?: string; align?: string; role?: string }
export type Edits = Record<string, Record<string, CellEdit>>;

/** data formats this page reads and writes – the same numbers as SCHEMA in backend/slidebuilder/upgrade.py
    (a test checks it). Sent with every change; a helper with other formats refuses it ("reload the page"). */
export const FORMATS = { workbook: 3, config: 3, prefs: 1 } as const;
export interface WorkbookDoc {
  schema: number; workbook: string; rev: number; updated?: number; updatedBy?: string;
  preset: Preset | null; style: StylePatch; edits: Edits;
  /** last 20 revisions (written by the helper): who changed what, so clients can name remote authors */
  log?: { rev: number; by: string | null; at: number | null }[];
}
export interface ConfigDoc { schema: number; rev: number; updated?: number; updatedBy?: string; defaults: { style: StylePatch } }
export interface Prefs { lastFile?: string | null; pdfMode?: "exact" | "vector" | null; zoom?: number | "fit" | null }

type Nullable<T> = { [K in keyof T]?: T[K] | null };
export type Op =
  | { op: "preset.set"; preset: Preset | null }
  | { op: "slide.patch"; id: string; patch: Nullable<Pick<SlideDef, "title" | "subtitle" | "date" | "note" | "logo" | "layout" | "align" | "valign" | "scale" | "subs">> & { notes?: Record<string, Note | null> | null; fmt?: Partial<Record<SlideTextKey, TextFmt | null>> | null } }
  | { op: "table.patch"; id: string; patch: { name?: string | null; gridH?: "on" | "off" | null; gridV?: "on" | "off" | null; cols?: Record<string, number | null> | null; rows?: Record<string, number | null> | null; scales?: Record<string, ScaleRule | null> | null; merges?: Record<string, "merge" | "split" | null> | null } }
  | { op: "cell.patch"; sheet: string; ref: string; patch: Nullable<CellEdit> }
  | { op: "style.patch"; patch: Nullable<Omit<StylePatch, "pn" | "footer" | "theme" | "text" | "colors">> & { pn?: Nullable<PageNumbers> | null; footer?: Nullable<Footer> | null; theme?: Nullable<Theme> | null; text?: Partial<Record<TextRole, TextFmt | null>> | null; colors?: Partial<Record<ColorKey, string | null>> | null } };

/* ---- runtime ---- */
export interface RuntimeSlide {
  id: string; type: SlideType; cfg: SlideDef; tables: TableLayout[]; missing: number;
  title: string; subtitle: string; label: string;
  _auto?: Layout | null;
}
