/* types for tools/real-charts.mjs (imported by core/tests/pptx-charts-m14.test.ts) */
export interface ChartKinds { slide: number; kinds: string[] }
export function chartKindsOf(lists: { sem?: { items: Record<string, { kind: string }> } }[]): ChartKinds[];
export function pageChartKinds(design: string): string;
export function withChartKinds<T extends { slide: number }>(real: T[], kinds: ChartKinds[]): (T & { kinds?: string[] })[];
