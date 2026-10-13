/* A short name for a piece of a display list: the same nodes, the same name. The stage names its layers with it (the
   page keeps the markup it has), the thumbnails their pictures (a slide is drawn again only when its list changed). */
import type { DisplayList } from "./types";

/** FNV-1a over the JSON of `nodes` (and `extra`), 2 × 32 bits, and the JSON's length */
export function contentKey(nodes: DisplayList, extra = ""): string {
  const s = JSON.stringify(nodes) + extra;
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36);
}
