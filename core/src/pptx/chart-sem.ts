/* What the core says of a chart for the PowerPoint export (07 §4.2, B21): render/chart-dl.ts chartSem makes it, chart.ts
   writes it as a native chart part. Its own file since S14.P, so that M14 (series charts, 09 §4.2) grows it without
   touching scene.ts, which M15 owns. */
import type { Box } from "./scene";

export interface FontSem { css: string; size: number; color: string; b: boolean; i: boolean }
export interface ChartSem {
  /** column / bar (4.7, S14.2): a series chart, written from `bars`; the pie fields then carry its first series */
  type: "pie" | "donut" | "column" | "bar"; title: string; titleFont: FontSem; labelFont: FontSem; series: string;
  labels: string[]; values: number[]; colors: string[]; show: ("label" | "value" | "percent")[]; legend: "right" | "bottom" | "none";
  startAngle: number; /** the plot's frame inside the card, slide px */ box: Box; sep: { w: number; color: string } | null; fmt: string; hole: number;
  /** a column or bar chart (09 §4.2): set exactly when type is "column" or "bar" */
  bars?: BarsSem;
}
/** a line of an axis or of the gridlines: colour, width px, dash */
export interface LineSem { color: string; w: number; dash?: "dash" | "sysDot" }
/** the value axis exactly as drawn: fixed bounds and unit (never PowerPoint's own), its format, gridlines, line, font */
export interface ValAxisSem { min: number; max: number; step: number; num: string; grid: LineSem | null; line: LineSem | null; show: boolean; font: FontSem }
export interface CatAxisSem { line: LineSem | null; show: boolean; font: FontSem; /** a label every n categories */ skip: number }
/** a point's own label: its text ("" = hidden) and / or the colour it is drawn in (white inside a dark bar) */
export interface PointLabelSem { i: number; text?: string; hide?: boolean; color?: string }
export interface BarSerSem {
  name: string; /** per category; null = no bar (a gap) */ values: (number | null)[]; color: string; fmt: string;
  /** per point colours (points[i].color) */ points: { i: number; color: string }[];
  labels: { show: ("value" | "name" | "category" | "percent")[]; pos: "outEnd" | "inEnd" | "ctr" | "inBase"; num: string | null; font: FontSem; points: PointLabelSem[] } | null;
}
export interface BarsSem {
  dir: "col" | "bar"; grouping: "clustered" | "stacked" | "percentStacked"; gap: number; overlap: number;
  cats: string[]; series: BarSerSem[]; val: ValAxisSem; cat: CatAxisSem; /** the title's drawn box (null = no title) */ title: Box | null;
  /** the plot rectangle (the bars' area, inside the axes' labels), slide px: c:plotArea manualLayout inner */ plot: Box;
  /** the legend's box, slide px (manual layout), its position and the entries left out (series indexes); null = none */
  legend: { pos: "r" | "l" | "t" | "b" | "tr"; box: Box; overlay: boolean; hide: number[] } | null;
}
