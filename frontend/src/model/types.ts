/* Persistent data (see docs/ARCHITECTURE.md §3) and runtime slide objects. */
import type { TableLayout } from "../xlsx/types";

export interface Layout { bands: number[][]; w: number[] }
export type TableDef =
  | { id: string; sheet: string; kind: "markers"; anchor: string; index: number; name?: string }
  | { id: string; sheet: string; kind: "range"; range: string; grow?: boolean; name?: string };
export type SlideType = "cover" | "index" | "content";
export interface SlideDef {
  id: string; type: SlideType;
  title?: string | null; subtitle?: string | null; date?: string | null; note?: string | null;
  tables: string[]; layout?: Layout | null; logo?: boolean;
}
export interface Preset { sheets: string[]; tables: TableDef[]; slides: SlideDef[]; version?: number; updated?: number }

export interface PageNumbers { on: boolean; start: number; pos: "tl" | "tc" | "tr" | "bl" | "bc" | "br"; font: string; size: number; format: "n" | "nN" | "page" | "p"; style: "capsule" | "plain"; cover: boolean }
export interface Style { design: "glass" | "excel"; glass: "subtle" | "medium" | "strong"; color: number; logo: string; pn: PageNumbers }
export type StylePatch = Partial<Omit<Style, "pn">> & { pn?: Partial<PageNumbers> };

export interface CellEdit { text?: string; orig?: string; sz?: number; b?: boolean; i?: boolean; color?: string; fill?: string; align?: string; role?: string }
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
  | { op: "slide.patch"; id: string; patch: Nullable<Pick<SlideDef, "title" | "subtitle" | "date" | "note" | "logo" | "layout">> }
  | { op: "cell.patch"; sheet: string; ref: string; patch: Nullable<CellEdit> }
  | { op: "style.patch"; patch: Nullable<Omit<StylePatch, "pn">> & { pn?: Nullable<PageNumbers> | null } };

/* ---- runtime ---- */
export interface RuntimeSlide {
  id: string; type: SlideType; cfg: SlideDef; tables: TableLayout[]; missing: number;
  title: string; subtitle: string; label: string;
  _auto?: Layout | null;
}
