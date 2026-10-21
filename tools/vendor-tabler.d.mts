/* types for tools/vendor-tabler.mjs (imported by app/tests/ui-icons.test.tsx: the toolbar subset checked point by point) */
export type Cmd = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];
export type SrcCmd = Cmd | ["Q", number, number, number, number] | ["A", number, number, number, number, number, number, number];
export declare const GRID: number, FORMAT: number, VERSION: string;
export declare function parsePath(d: string): [string, number[]][];
/** SVG path data → absolute M L C Q A Z (H / V as L, S as C, T as Q) */
export declare function toCmds(d: string): SrcCmd[];
