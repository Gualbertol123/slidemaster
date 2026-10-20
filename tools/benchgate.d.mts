/* types for tools/benchgate.mjs (imported by core/bench/*.bench.test.ts and core/tests/benchgate.test.ts) */
export interface Gate { key: string; limit: number; first: number; repeat?: number; pass: boolean; repeated: boolean; strict?: boolean }
export declare const SLACK: number;
export declare function onCI(): boolean;
export declare function isTiming(key: string): boolean;
export declare function judge(a: { limits: Record<string, number>; first: Record<string, number>; again?: (keys: string[]) => Promise<Record<string, number>> | Record<string, number>; ci?: boolean; slack?: number; strict?: boolean; timing?: (key: string) => boolean }): Promise<{ gates: Gate[]; bad: string[] }>;
export declare function describe(g: Gate, slack?: number): string;
export declare function annotation(title: string, g: Gate): string;
