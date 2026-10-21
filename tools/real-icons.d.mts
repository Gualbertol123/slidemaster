/* types for tools/real-icons.mjs (imported by core/tests/real-icons.test.ts) */
import type { RealObjects } from "./real-objects.mjs";
export interface RealIcons { slide: number; icons: number }
type Lists = { dl: { nodes: unknown[] }; sem?: { items: Record<string, { kind: string; icon?: string } | object> } }[];
export function iconsOf(lists: Lists): RealIcons[];
export function pageIcons(design: string): string;
export function withIcons(real: RealObjects[], icons: RealIcons[]): (RealObjects & { icons?: number })[];
