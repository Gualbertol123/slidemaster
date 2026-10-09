/* Data structures produced by the workbook reader. */
import type JSZip from "jszip";
import type { ColorFn } from "./color";
import type { Range, Rel } from "./util";

export interface Font { name?: string; sz?: number; b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string | null }
export interface BorderSide { style: string; color: string }
export type Side = "left" | "right" | "top" | "bottom";
export type Border = Partial<Record<Side, BorderSide>>;
export interface Xf { fmt: string; font: Font; fill: string | null; border: Border; h: string; v: string; wrap: boolean; indent: number; rot: number }
export interface Dxf { fill?: string; color?: string; b?: boolean; i?: boolean }
export type CellType = "s" | "n" | "b" | "e" | "d" | "blank";
/** a raised or lowered part of a cell's text: [start, end, kind] (Excel rich text, e.g. a footnote "(1)") */
export type Script = [number, number, "sup" | "sub"];
export interface Cell { r: number; c: number; v: string | number | boolean | null; t: CellType; xf: Xf; fmt: string; scr?: Script[] }
export interface CFRule { ranges: Range[]; type: string; op: string | null; priority: number; stop: boolean; dxf: Dxf | null; formulas: string[] }

export interface Shared { sst: string[]; sstRuns?: (Script[] | undefined)[]; xfs: Xf[]; dxfs: Dxf[]; defaultFont: Font; color: ColorFn; theme: string[]; mdw: number }

export interface AnchorPos { c: number; r: number; co: number; ro: number }
export interface Crop { l: number; t: number; r: number; b: number }
export interface Frac { x: number; y: number; w: number; h: number }
export interface Para { align: "left" | "center" | "right"; runs: Run[]; sz: number | null }
export interface Run { text: string; sz: number | null; b: boolean; i: boolean; color: string | null }
export interface Line { w: number; color: string }
export interface DrawObjBase { frac: Frac; rot: number; flipH: boolean; flipV: boolean; name: string }
export type DrawObj =
  | (DrawObjBase & { kind: "pic"; src?: string | null; crop?: Crop | null; unsupported?: string })
  | (DrawObjBase & { kind: "box" | "text"; prst: string; fill: string | null; line: Line | null; paras: Para[]; anchorV: string });
export interface Anchor { type: "two" | "one" | "abs"; editAs: string; from?: AnchorPos; to?: AnchorPos; ext?: { w: number; h: number }; pos?: { x: number; y: number }; objects: DrawObj[] }
export interface Drawing { anchors: Anchor[]; charts: string[]; unsupported: string[]; skipped: number }

export interface ColInfo { w: number; hidden: boolean; s: number | null }
export interface RowInfo { h: number; hidden: boolean; s: number | null }

export interface Sheet {
  name: string;
  hidden: boolean;
  error?: string;
  size?: number;
  cells: Map<string, Cell>;
  rowInfo: Map<number, RowInfo>;
  colRanges: { min: number; max: number; info: ColInfo }[];
  merges: Range[];
  cfRules: CFRule[];
  unsupportedCF: Set<string>;
  unpaired: string[];
  drawing: Drawing;
  defColW: number; defRowH: number; zeroH: boolean;
  ctx: Shared;
  title: string; subtitle: string;
  tables: TableLayout[];
  get(r: number, c: number): Cell | null;
  rowHidden(r: number): boolean;
  colHidden(c: number): boolean;
  colInfo(c: number): ColInfo | undefined;
  rowPx(r: number): number;
  colPx(c: number): number;
  colStart(c: number): number;
  rowStart(r: number): number;
  cellAt(px: number, py: number): AnchorPos;
  xfAt(r: number, c: number): Xf;
}

export interface SheetMeta { name: string; path: string; size: number }
export interface Workbook {
  zip: JSZip;
  wbRels: Record<string, Rel>;
  meta: SheetMeta[];
  skipped: { name: string; why: string }[];
  hiddenSheets: string[];
  extLinks: number;
  sheets: Sheet[];
  shared: Shared | null;
  total: number; ssSize: number; big: boolean;
  isLoaded(n: string): boolean;
  ensure(names: string[], progress?: Progress): Promise<Sheet[]>;
}
export type Progress = (text: string, frac: number | null) => void;

/* ---- layout of one table region (exclusive bounds: g.r1/g.c1/g.r2/g.c2 are the marker cells) ---- */
export interface Box { r: number; c: number; r2: number; c2: number; src: { r: number; c: number }; m?: Range }
export interface Item {
  b: Box; bx: number; by: number; bw: number; bh: number;
  fill: string | null; top?: BorderSide | null; left?: BorderSide | null; right?: BorderSide | null; bottom?: BorderSide | null;
  text: string; font: Font; color: string; align: string; valign: string; wrap: boolean; indent: number; rot: number;
  isText: boolean; merged: boolean; baseFill: string | null; /** font colour before conditional formatting */ baseColor?: string; cf: Dxf | null; nfColor: string | null; ctype: CellType;
  tw?: number; ov?: boolean;
  /* effective values after user edits */
  /** colour scale result (variable conditional formatting) */
  scaleFill?: string; scaleInk?: string;
  /** user cell colour (replaces the Excel colour) */
  userBg?: string;
  /** superscript / subscript parts of the text (from Excel) */ scripts?: Script[];
  /** removed in the version being shown (drawn empty) */ removed?: boolean;
  edited?: boolean; /** font chosen on the slide (cell edit) */ userFont?: string; userB?: boolean; userI?: boolean; userColor?: string; userFill?: string; noFill?: boolean; role?: string;
  L?: TableLayout;
}
export interface Pic { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean; name: string; src?: string | null; crop?: Crop | null; unsupported?: string }
export interface Rect { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean; name: string; fill: string | null; line: Line | null; round: boolean; ellipse?: boolean; paras?: Para[]; anchorV?: string }
export interface TableLayout {
  g: Range; rows: number[]; cols: number[]; W: number; H: number;
  items: Item[]; pics: Pic[]; rects: Rect[]; texts: Rect[];
  hiddenRows: number; hiddenCols: number; errors: string[];
  colX: Map<number, number>; colW: Map<number, number>; rowY: Map<number, number>; rowH: Map<number, number>;
  /** columns whose width the user set (Liquid Glass keeps them exactly) */
  fixedCols?: Set<number>;
  /* attached at runtime */
  sheet: Sheet;
  def?: import("../model/types").TableDef;
  id?: string;
  /* caches */
  _cache?: Record<string, unknown>;
}
