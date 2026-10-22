/* The icon picker's answers (S15.2; 09 §3.5, IC-01): a search over the vendored set's index – words of the name and tags,
   in one set (outline or filled) and one category – and the tiles the picker draws, as SVG path data on the icons' own
   24 × 24 grid. Runs in the core worker (worker/host.ts "iconSearch", "iconTiles") over the catalogue installTabler
   registered (render/icons.ts): the page holds no copy of the set and draws only the ≈ 120 tiles in view. Pure. */
import type { PathCmd } from "../dl/types";
import { ICONS, iconCatalog, iconCatalogLoaded, iconCmds, type IconStyle } from "./icons";

/** one path of a tile: SVG path data on the 24 grid, and how it is painted (stroked at the item's width, filled, half ink) */
export interface IconTilePath { d: string; stroke: boolean; fill: boolean; alpha: number; evenodd?: boolean }
/** a tile: an icon id ("tabler:x", "tabler-filled:x" or a built-in name) and its paths; `missing`: the set has no such icon */
export interface IconTile { id: string; paths: IconTilePath[]; missing?: boolean }
export interface IconSearchReq {
  /** what was typed: words of the name or its tags (whole, start or inside) */ query: string;
  style: IconStyle; /** a category of the set, or null for all */ category: string | null;
  /** how many of the first hits come with their tiles (the grid's first screen) */ draw: number;
  /** ids whose tiles come too (the recent icons) */ also?: string[];
}
export interface IconSearchAnswer {
  version: string; categories: string[];
  /** every hit's name, best first */ names: string[];
  /** tiles of the first `draw` hits and of `also`, by id */ tiles: Record<string, IconTile>;
  /** the worker's time for this answer, ms; whether it was this worker's first search (it may have inflated the set) */ ms: number; first: boolean;
  /** whether the set was not inflated before this search (its time is then the cold first use, 09 §7.4) */ cold: boolean;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const n3 = (v: number) => { const r = Math.round(v * 1000) / 1000 || 0; return String(r); };
/** display-list path commands → SVG path data */
export const svgD = (d: PathCmd[]) => d.map(c => c[0] === "Z" ? "Z" : c[0] + c.slice(1).map(v => n3(v as number)).join(" ")).join("");
/** the icon id of a name in a style */
export const iconId = (style: IconStyle, name: string) => (style === "filled" ? "tabler-filled:" : "tabler:") + name;

/** the set's tiles made so far, by id (an icon's paths never change: each tile's SVG path data is written once, not per
    keystroke) */
const madeBy = new WeakMap<object, Map<string, IconTile>>();
/** the tiles of these ids (a built-in name draws its own outline; an id the set does not have is `missing`) */
export function iconTiles(ids: string[]): Record<string, IconTile> {
  const out: Record<string, IconTile> = {}, cat = ids.some(id => typeof id === "string" && id.startsWith("tabler")) ? iconCatalog() : null;
  let made = cat ? madeBy.get(cat) : undefined;
  if (cat && !made) madeBy.set(cat, made = new Map());
  for (const id of ids.slice(0, 400)) {
    if (typeof id !== "string" || out[id]) continue;
    const had = made?.get(id);
    if (had) { out[id] = had; continue; }
    const m = /^(tabler|tabler-filled):(.+)$/.exec(id);
    if (!m) {
      out[id] = Object.prototype.hasOwnProperty.call(ICONS, id) ? { id, paths: [{ d: svgD(iconCmds(id, 0, 0, 1)), stroke: false, fill: true, alpha: 1, evenodd: true }] } : { id, paths: [], missing: true };
      continue;
    }
    const p = cat?.icon(m[1] === "tabler" ? "outline" : "filled", m[2]);
    out[id] = p ? { id, paths: p.map(x => ({ d: svgD(x.d), stroke: x.paint.stroke, fill: x.paint.fill, alpha: x.paint.alpha })) } : { id, paths: [], missing: true };
    made?.set(id, out[id]);
  }
  return out;
}

/** whether this worker answered a search before (its first one may inflate the set) */
let loaded = false;
/** a search of the picker, or null when no set is registered (the page's in-thread fallback) */
export function iconSearch(a: IconSearchReq): IconSearchAnswer | null {
  const t0 = now(), first = !loaded, cold = !iconCatalogLoaded();
  const cat = iconCatalog();
  if (!cat) return null;
  loaded = true;
  const style: IconStyle = a.style === "filled" ? "filled" : "outline";
  const category = typeof a.category === "string" && cat.categories.includes(a.category) ? a.category : undefined;
  const names = cat.search(typeof a.query === "string" ? a.query.slice(0, 200) : "", { style, ...(category ? { category } : {}) }).map(h => h.name);
  const draw = Math.max(0, Math.min(400, Math.floor(+a.draw) || 0));
  const tiles = iconTiles([...names.slice(0, draw).map(n => iconId(style, n)), ...(Array.isArray(a.also) ? a.also.slice(0, 40) : [])]);
  return { version: cat.version, categories: cat.categories, names, tiles, ms: Math.round((now() - t0) * 100) / 100, first, cold };
}
