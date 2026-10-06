/* Persistent data (see docs/ARCHITECTURE.md §3) and runtime slide objects. */
import type { TableLayout } from "../xlsx/types";

export interface Layout { bands: number[][]; w: number[] }
/** colour scale: deeper green/red with the size of the number (per row, per column or the whole range) */
export interface ScaleRule { range: string; dir: "row" | "col" | "all"; mode: "zero" | "minmax"; fill: boolean; ink: boolean; invert?: boolean }
interface TableExtras { name?: string; cols?: Record<string, number>; rows?: Record<string, number>; scales?: Record<string, ScaleRule>; merges?: Record<string, "merge" | "split"> }
export type TableDef =
  | ({ id: string; sheet: string; kind: "markers"; anchor: string; index: number } & TableExtras)
  | ({ id: string; sheet: string; kind: "range"; range: string; grow?: boolean } & TableExtras);
export type SlideType = "cover" | "index" | "content";
export type Side = "top" | "bottom" | "left" | "right";
/** text box next to a table; key in SlideDef.notes = "<tableId>:<side>" */
export interface Note { text: string; size?: number; b?: boolean; i?: boolean; align?: "left" | "center" | "right"; color?: string; w?: number; h?: number }
export interface SlideDef {
  id: string; type: SlideType;
  title?: string | null; subtitle?: string | null; date?: string | null; note?: string | null;
  tables: string[]; layout?: Layout | null; logo?: boolean;
  align?: "left" | "center" | "right"; scale?: number; notes?: Record<string, Note>;
}
export interface Preset { sheets: string[]; tables: TableDef[]; slides: SlideDef[]; version?: number; updated?: number }

export interface PageNumbers { on: boolean; start: number; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; font: string; size: number; format: "n" | "nN" | "page" | "p"; style: "capsule" | "plain"; cover: boolean }
export interface Footer { on: boolean; text: string; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; size: number; style: "capsule" | "plain"; cover: boolean }
export interface Style { design: "glass" | "excel"; glass: "subtle" | "medium" | "strong"; color: number; logo: string; pn: PageNumbers;
  /** corner roundness, % of default (0–200) */ radius: number; /** background ↔ surfaces contrast 0–100 (50 = as designed) */ contrast: number; logoBubble: boolean; footer: Footer }
export type StylePatch = Partial<Omit<Style, "pn" | "footer">> & { pn?: Partial<PageNumbers>; footer?: Partial<Footer> };

/** fill = highlight (a capsule in Liquid Glass); bg = cell colour that replaces the Excel colour ("none" removes it) */
export interface CellEdit { text?: string; orig?: string; sz?: number; b?: boolean; i?: boolean; color?: string; fill?: string; bg?: string; align?: string; role?: string }
export type Edits = Record<string, Record<string, CellEdit>>;

export interface WorkbookDoc {
  schema: 3; workbook: string; rev: number; updated?: number; updatedBy?: string;
  preset: Preset | null; style: StylePatch; edits: Edits;
  /** last 20 revisions (written by the helper): who changed what, so clients can name remote authors */
  log?: { rev: number; by: string | null; at: number | null }[];
}
export interface ConfigDoc { schema: 3; rev: number; updated?: number; updatedBy?: string; defaults: { style: StylePatch } }
export interface Prefs { lastFile?: string | null; pdfMode?: "exact" | "vector" | null; zoom?: number | "fit" | null }

type Nullable<T> = { [K in keyof T]?: T[K] | null };
export type Op =
  | { op: "preset.set"; preset: Preset | null }
  | { op: "slide.patch"; id: string; patch: Nullable<Pick<SlideDef, "title" | "subtitle" | "date" | "note" | "logo" | "layout" | "align" | "scale">> & { notes?: Record<string, Note | null> | null } }
  | { op: "table.patch"; id: string; patch: { name?: string | null; cols?: Record<string, number | null> | null; rows?: Record<string, number | null> | null; scales?: Record<string, ScaleRule | null> | null; merges?: Record<string, "merge" | "split" | null> | null } }
  | { op: "cell.patch"; sheet: string; ref: string; patch: Nullable<CellEdit> }
  | { op: "style.patch"; patch: Nullable<Omit<StylePatch, "pn" | "footer">> & { pn?: Nullable<PageNumbers> | null; footer?: Nullable<Footer> | null } };

/* ---- runtime ---- */
export interface RuntimeSlide {
  id: string; type: SlideType; cfg: SlideDef; tables: TableLayout[]; missing: number;
  title: string; subtitle: string; label: string;
  _auto?: Layout | null;
}
