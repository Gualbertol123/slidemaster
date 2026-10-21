/* types for tools/real-icons.mjs (imported by core/tests/real-icons.test.ts) */
import type { RealObjects } from "./real-objects.mjs";
export interface RealIcons { slide: number; icons: number }
type Lists = { dl: { nodes: unknown[] }; sem?: { items: Record<string, { kind: string; icon?: string } | object> } }[];
export function iconsOf(lists: Lists): RealIcons[];
export function pageIcons(design: string): string;
export function withIcons(real: RealObjects[], icons: RealIcons[]): (RealObjects & { icons?: number })[];
export interface RealLines { slide: number; lines: number }
export function linesOf(lists: Lists): RealLines[];
export function pageLines(design: string): string;
export function withLines<T extends RealObjects>(real: T[], lines: RealLines[]): (T & { lines?: number })[];
