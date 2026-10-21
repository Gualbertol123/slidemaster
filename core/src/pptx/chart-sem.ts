/* What the core says of a chart for the PowerPoint export (07 §4.2, B21): render/chart-dl.ts chartSem makes it, chart.ts
   writes it as a native chart part. Its own file since S14.P, so that M14 (series charts, 09 §4.2) grows it without
   touching scene.ts, which M15 owns. */
import type { Box } from "./scene";

export interface FontSem { css: string; size: number; color: string; b: boolean; i: boolean }
export interface ChartSem {
  type: "pie" | "donut"; title: string; titleFont: FontSem; labelFont: FontSem; series: string;
  labels: string[]; values: number[]; colors: string[]; show: ("label" | "value" | "percent")[]; legend: "right" | "bottom" | "none";
  startAngle: number; /** the plot's frame inside the card, slide px */ box: Box; sep: { w: number; color: string } | null; fmt: string; hole: number;
}
