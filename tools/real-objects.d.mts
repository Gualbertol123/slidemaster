/* types for tools/real-objects.mjs (imported by core/tests/real-objects.test.ts) */
export interface RealObjects { slide: number; tables: number; charts: number }
export function realObjectsOf(lists: { dl: { nodes: unknown[] }; sem?: { items: Record<string, { kind: string }> } }[]): RealObjects[];
export function pageRealObjects(design: string): string;
