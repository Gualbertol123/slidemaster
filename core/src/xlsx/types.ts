/* Data structures produced by the workbook reader. */
import type { Zip } from "./zip";
import type { ColorFn } from "./color";
import type { Range, Rel } from "./util";

export interface Font { name?: string; sz?: number; b?: boolean; i?: boolean; u?: boolean; s?: boolean; color?: string | null }
export interface BorderSide { style: string; color: string; /** px, over the style's width (a cell gridline's weight, 4.4) */ w?: number }
export type Side = "left" | "right" | "top" | "bottom";
export type Border = Partial<Record<Side, BorderSide>>;
export interface Xf { fmt: string; font: Font; fill: string | null; border: Border; h: string; v: string; wrap: boolean; indent: number; rot: number }
/** a conditional format's look (a <dxf>); a colour scale's result is a dxf fill. fmt: a number format code, u / s:
    underline and strike, border: the sides it sets (S16.4) */
export interface Dxf { fill?: string; color?: string; b?: boolean; i?: boolean; u?: boolean; s?: boolean; fmt?: string; border?: Border }
export type CellType = "s" | "n" | "b" | "e" | "d" | "blank";
/** a raised or lowered part of a cell's text: [start, end, kind] (Excel rich text, e.g. a footnote "(1)") */
export type Script = [number, number, "sup" | "sub"];
export interface Cell { r: number; c: number; v: string | number | boolean | null; t: CellType; xf: Xf; fmt: string; scr?: Script[] }
/** a threshold of a colour scale, data bar or icon set: min, max, num, percent, percentile, formula (autoMin / autoMax of
    the 2010 data bars); val as written (a number or a formula's text); gte false: the icon's threshold is ">" */
export interface CFVO { type: string; val?: string; gte?: boolean }
/** the 2010 extension of a data bar (x14:dataBar; .xlsx only – an .xlsb keeps it in future records not read) */
export interface CFBar14 { minLength?: number; maxLength?: number; border?: boolean; gradient?: boolean; direction?: string; axis?: string;
  negSame?: boolean; negBorderSame?: boolean; borderColor?: string; negColor?: string; negBorderColor?: string; axisColor?: string; cfvo?: CFVO[] }
/** a rule (S16.4, B39: every type Excel 2016 writes is evaluated, xlsx/cf.ts). Only the keys of its type are set */
export interface CFRule { ranges: Range[]; type: string; op: string | null; priority: number; stop: boolean; dxf: Dxf | null; formulas: string[];
  /** containsText / notContainsText / beginsWith / endsWith */ text?: string;
  /** top10 */ rank?: number; percent?: boolean; bottom?: boolean;
  /** aboveAverage: below when false, equalAverage, standard deviations */ above?: boolean; equal?: boolean; stdDev?: number;
  /** timePeriod: today, yesterday, tomorrow, last7Days, thisWeek, lastWeek, nextWeek, thisMonth, lastMonth, nextMonth */ period?: string;
  scale?: { cfvo: CFVO[]; colors: string[] };
  bar?: { cfvo: CFVO[]; color: string; minLength: number; maxLength: number; showValue: boolean; x14?: CFBar14 };
  /** custom: per threshold its icon [set, index] (x14:cfIcon; NoIcons = null) */
  icons?: { set: string; cfvo: CFVO[]; reverse: boolean; showValue: boolean; custom?: ([string, number] | null)[] } }

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
  /** read only (a columnar store behind it: xlsx/sheetstore.ts) */
  cells: ReadonlyMap<string, Cell>;
  rowInfo: ReadonlyMap<number, RowInfo>;
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
  /** the columns behind cells and rowInfo (absent for a broken sheet) */
  cols?: { cells: import("./sheetstore").SheetColumns; rows: import("./sheetstore").RowColumns };
  get(r: number, c: number): Cell | null;
  /** the cell's formula as A1 text without "=" (PLAN S7.1), null for a constant or an unreadable formula */
  formula(r: number, c: number): string | null;
  /** the range of the array formula the cell masters, e.g. "C5:C9" (null: none) */
  arrayRef(r: number, c: number): string | null;
  /** formula cells of an .xlsb whose formula could not be decompiled (they keep their cached value only) */
  unreadableFormulas?: number;
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

/** a sheet of the workbook; of a linked workbook (S7.3, ADR-014) its `name` is the sheet id "[File.xlsx]Sheet" and
    `linked` the file */
export interface SheetMeta { name: string; path: string; size: number; linked?: string }
export interface Workbook {
  zip: Zip;
  wbRels: Record<string, Rel>;
  meta: SheetMeta[];
  skipped: { name: string; why: string }[];
  hiddenSheets: string[];
  /** the hidden worksheets' parts: read for the formula engine only (Decisions 2026-10-18), never listed (WB-18), never
      in `sheets`, never on a slide or the page */
  hiddenMeta?: SheetMeta[];
  extLinks: number;
  /** the file names the workbook's external links point at, in the "[n]" order of its formulas (S7.2; "?" when a
      link has no readable target) */
  externals: string[];
  /** the workbook's defined names (workbook.xml <definedName>; Excel's own _xlnm.* and #REF! ones left out): `scope` the
      sheet of a sheet-level name, null for the workbook's; `formula` as Excel wrote it (M8, for the formula engine) */
  names?: { name: string; scope: string | null; formula: string }[];
  /** the linked workbooks attached to this one (S7.3), by file name: their sheets are read into `sheets` under their
      sheet ids, their own `meta` / `externals` / `hiddenSheets` serve the formula engine */
  linked: Map<string, Workbook>;
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
  /** Excel's data bar and icon (S16.4, xlsx/cf.ts; drawn by render/cf-dl.ts); cfHide: only the bar / icon shows */ cfBar?: CFBarLook; cfIcon?: CFIconLook; cfHide?: boolean;
  /* effective values after user edits */
  /** colour scale result (variable conditional formatting) */
  scaleFill?: string; scaleInk?: string;
  /** user cell colour (replaces the Excel colour) */
  userBg?: string;
  /** superscript / subscript parts of the text (from Excel) */ scripts?: Script[];
  /** removed in the version being shown (drawn empty) */ removed?: boolean;
  /** the cell's own gridlines (TableDef.cellGrid, 4.4, B20): the edges they are drawn on (each edge once), after the fills
      and borders – by Excel, Excel Refined, the consulting rules and cards tables, Liquid Glass */ cgrid?: Partial<Record<"top" | "left" | "right" | "bottom", BorderSide>>;
  /** of those, the edges a border covers in the designs that draw the workbook's borders (Excel, Excel Refined): the border
      shows there instead */ cgx?: Partial<Record<"top" | "left" | "right" | "bottom", true>>;
  /** of those, the edges a border set on the slide covers (the consulting rules tables draw only those borders) */ cgu?: Partial<Record<"top" | "left" | "right" | "bottom", true>>;
  /** the workbook's sides of a cell whose borders were set on the slide (Liquid Glass builds its scene from these) */ wb?: Pick<Item, "top" | "left" | "right" | "bottom">;
  /** the sides whose border the user set on the slide (TableDef.borders, 4.4, B28): the consulting rules tables draw these */ ub?: Partial<Record<"top" | "left" | "right" | "bottom", true>>;
  edited?: boolean; /** font chosen on the slide (cell edit) */ userFont?: string; userB?: boolean; userI?: boolean; userColor?: string; userFill?: string; noFill?: boolean; role?: string;
  L?: TableLayout;
}
/** a data bar in a cell: from / to as fractions of the cell's bar area (0 = its left), the axis as a fraction (null: none) */
export interface CFBarLook { from: number; to: number; fill: string; border: string | null; gradient: boolean; neg: boolean; axis: number | null; axisColor: string }
/** an icon of an icon set: the set's name and the icon's index in it (0 = the lowest values' icon) */
export interface CFIconLook { set: string; i: number }
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
