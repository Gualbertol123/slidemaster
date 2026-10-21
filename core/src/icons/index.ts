/* The vendored Tabler icon set (09 §2.4, §3.5, ADR-020; S15.1): @tabler/icons 3.49.0 (MIT, ./LICENSE-tabler), 5,184
   outline and 1,054 filled icons, their 41 categories, tags and the release's alias table, packed by
   tools/vendor-tabler.mjs into ./data.ts and inflated here on first use (the owner's decision of 2026-10-21, option A:
   inside the page, no network).
   ONLY THE WORKERS import this module (core/src/workers/main.ts calls installTabler): the page's own bundle must not, or it
   would carry the set a second time (core/tests/icons.test.ts checks the imports). The page asks the core worker
   (search, path data) instead.
   The packed format (tools/vendor-tabler.mjs FORMAT 1; varints are LEB128, signed ones zig-zag):
     "TBLR" · format byte · grid (varint) · version (string) · categories (count, strings) · tags (count, strings, most
     used first) · icons (count; each: shared prefix with the previous name, the rest of the name, category byte, set bits
     (1 outline, 2 filled), tag count, tag ids as ascending deltas) · aliases per set, outline then filled (count; each:
     old name, the icon's index) · the outline icons' bytes, then the filled ones', each prefixed by its length, in name
     order. An icon's bytes: PATH + paint (1 stroke, 2 fill, 4 half ink) starts a path; M L (dx dy), H (dx), V (dy),
     C (c1 from the start, end from the start, c2 from the end), Q (control from the start, end from the start), ARC + bits
     (1 large, 2 sweep, 4 rx = ry, 8 rotated: rx [ry] [rotation] dx dy), Z. Coordinates are 1/grid of the 24 × 24 box.
   Decoding gives the display list's absolute M L C Z: Q as its exact cubic, every arc as cubics of at most 90° each. */
import type { PathCmd } from "../dl/types";
import { setIconCatalog, setVendoredIcons, type IconPaint, type IconSet } from "../render/icons";
import { decode64 } from "../text/hb";
import { TABLER, TABLER_VERSION } from "./data";
import { IT_WORDS } from "./search-it";

export type TablerStyle = "outline" | "filled";
/** one path of an icon on the 24 × 24 grid, and how it is painted */
export interface TablerPath { d: PathCmd[]; paint: IconPaint }
export interface TablerHit { name: string; category: string; outline: boolean; filled: boolean }
export interface TablerSearch { style?: TablerStyle; category?: string; limit?: number }

const OP = { M: 1, L: 2, H: 3, V: 4, C: 5, Z: 6, Q: 7, PATH: 8, ARC: 16 };

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  byte() { if (this.p >= this.b.length) throw new Error("Tabler data: truncated"); return this.b[this.p++]; }
  u() { let v = 0, m = 1, c: number; do { c = this.byte(); v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  s() { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  str() {
    const n = this.u(), b = this.b, end = this.p + n;
    if (end > b.length) throw new Error("Tabler data: truncated");
    let s = "", i = this.p;
    for (; i < end && b[i] < 128; i++) s += String.fromCharCode(b[i]);          // names and tags are ASCII but for a few
    if (i < end) s = DEC.decode(b.subarray(this.p, end));
    this.p = end;
    return s;
  }
}
const DEC = new TextDecoder();

/** an SVG arc from (x1, y1) to (x2, y2) as cubics of at most 90° each (SVG 1.1 F.6.5, F.6.6) */
export function arcCubics(x1: number, y1: number, rx: number, ry: number, rot: number, large: boolean, sweep: boolean, x2: number, y2: number): PathCmd[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [["L", x2, y2]];
  const phi = rot * Math.PI / 180, cs = Math.cos(phi), sn = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, xp = cs * dx + sn * dy, yp = -sn * dx + cs * dy;
  const lam = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = co * rx * yp / ry, cyp = -co * ry * xp / rx;
  const cx = cs * cxp - sn * cyp + (x1 + x2) / 2, cy = sn * cxp + cs * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry, t1 = ang(1, 0, ux, uy);
  let dt = ang(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), h = dt / n, k = 4 / 3 * Math.tan(h / 4);
  const pt = (t: number) => [cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs];
  const dv = (t: number) => [-rx * Math.sin(t) * cs - ry * Math.cos(t) * sn, -rx * Math.sin(t) * sn + ry * Math.cos(t) * cs];
  const out: PathCmd[] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * h, b = a + h, [ax, ay] = pt(a), [bx, by] = i === n - 1 ? [x2, y2] : pt(b), [dax, day] = dv(a), [dbx, dby] = dv(b);
    out.push(["C", ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

/** one icon's bytes → its paths */
export function decodeIcon(b: Uint8Array, grid: number): TablerPath[] {
  const r = new Reader(b), out: TablerPath[] = [];
  let X = 0, Y = 0, SX = 0, SY = 0, d: PathCmd[] | null = null;
  const f = (v: number) => v / grid;
  while (r.p < b.length) {
    const op = r.byte();
    if (op >= OP.PATH && op < OP.ARC) { d = []; const p = op - OP.PATH; out.push({ d, paint: { stroke: !!(p & 1), fill: !!(p & 2), alpha: p & 4 ? .5 : 1 } }); continue; }
    if (!d) throw new Error("Tabler data: a command before its path");
    if (op === OP.M) { X += r.s(); Y += r.s(); SX = X; SY = Y; d.push(["M", f(X), f(Y)]); }
    else if (op === OP.L) { X += r.s(); Y += r.s(); d.push(["L", f(X), f(Y)]); }
    else if (op === OP.H) { X += r.s(); d.push(["L", f(X), f(Y)]); }
    else if (op === OP.V) { Y += r.s(); d.push(["L", f(X), f(Y)]); }
    else if (op === OP.C) {
      const a1 = X + r.s(), b1 = Y + r.s(), a = X + r.s(), bb = Y + r.s(), a2 = a + r.s(), b2 = bb + r.s();
      d.push(["C", f(a1), f(b1), f(a2), f(b2), f(a), f(bb)]); X = a; Y = bb;
    }
    else if (op === OP.Q) {
      const qx = X + r.s(), qy = Y + r.s(), a = X + r.s(), bb = Y + r.s();
      d.push(["C", f(X + 2 / 3 * (qx - X)), f(Y + 2 / 3 * (qy - Y)), f(a + 2 / 3 * (qx - a)), f(bb + 2 / 3 * (qy - bb)), f(a), f(bb)]); X = a; Y = bb;
    }
    else if (op === OP.Z) { d.push(["Z"]); X = SX; Y = SY; }
    else if (op >= OP.ARC && op < OP.ARC + 16) {
      const bits = op - OP.ARC, rx = r.u(), ry = bits & 4 ? rx : r.u(), rot = bits & 8 ? r.s() : 0, x0 = X, y0 = Y;
      X += r.s(); Y += r.s();
      d.push(...arcCubics(f(x0), f(y0), f(rx), f(ry), f(rot), !!(bits & 1), !!(bits & 2), f(X), f(Y)));
    }
    else throw new Error(`Tabler data: opcode ${op}`);
  }
  return out;
}

/** the inflated set: its index, the search over it and each icon's paths (decoded once, on first use) */
export class Tabler {
  readonly version: string;
  readonly grid: number;
  readonly categories: string[];
  readonly names: string[];
  /** per icon: its category's index, set bits (1 outline, 2 filled) */
  private readonly cat: Uint8Array;
  private readonly sets: Uint8Array;
  private readonly tagText: string[];
  /** per icon: its old names ("\n"-separated, from the release's alias table), or undefined */
  private readonly oldText: (string | undefined)[];
  /** per icon: what the search matches beyond the name – its tags and its old names */
  private readonly findText: string[];
  private readonly at = new Map<string, number>();
  private readonly alias: Record<TablerStyle, Map<string, number>> = { outline: new Map(), filled: new Map() };
  private readonly span: Record<TablerStyle, Int32Array>;
  private readonly cache: Record<TablerStyle, Map<number, TablerPath[]>> = { outline: new Map(), filled: new Map() };
  constructor(private readonly raw: Uint8Array) {
    const r = new Reader(raw);
    if (DEC.decode(raw.subarray(0, 4)) !== "TBLR") throw new Error("Tabler data: not the packed set");
    r.p = 4;
    if (r.byte() !== 1) throw new Error("Tabler data: an unknown format");
    this.grid = r.u(); this.version = r.str();
    this.categories = Array.from({ length: r.u() }, () => r.str());
    const tags = Array.from({ length: r.u() }, () => r.str()), n = r.u();
    this.names = new Array(n); this.cat = new Uint8Array(n); this.sets = new Uint8Array(n); this.tagText = new Array(n); this.oldText = new Array(n);
    let prev = "";
    for (let i = 0; i < n; i++) {
      const k = r.u(), name = prev.slice(0, k) + r.str();
      this.names[i] = prev = name; this.at.set(name, i);
      this.cat[i] = r.byte(); this.sets[i] = r.byte();
      let t = "\n", id = 0;
      for (let m = r.u(); m > 0; m--) { id += r.u(); t += tags[id] + "\n"; }
      this.tagText[i] = t;
    }
    for (const s of ["outline", "filled"] as const) for (let m = r.u(); m > 0; m--) {
      const from = r.str(), to = r.u();
      this.alias[s].set(from, to);
      if (!(this.oldText[to] ?? "\n").includes("\n" + from + "\n")) this.oldText[to] = (this.oldText[to] ?? "\n") + from + "\n";
    }
    this.findText = this.tagText.map((t, i) => this.oldText[i] ? t + this.oldText[i]!.slice(1) : t);   // an old name finds its icon
    this.span = { outline: new Int32Array(2 * n).fill(-1), filled: new Int32Array(2 * n).fill(-1) };
    for (const [s, bit] of [["outline", 1], ["filled", 2]] as const) for (let i = 0; i < n; i++) if (this.sets[i] & bit) {
      const len = r.u(); this.span[s][2 * i] = r.p; this.span[s][2 * i + 1] = len; r.p += len;
    }
    if (r.p !== raw.length) throw new Error("Tabler data: bytes after the last icon");
  }
  /** the icon's index for a name or an old name of this set, or -1 */
  indexOf(style: TablerStyle, name: string): number {
    const i = this.at.get(name);
    if (i !== undefined && this.sets[i] & (style === "outline" ? 1 : 2)) return i;
    return this.alias[style].get(name) ?? -1;
  }
  has(style: TablerStyle, name: string) { return this.indexOf(style, name) >= 0; }
  /** the icon's paths on the 24 × 24 grid, or null when the set has no such name */
  icon(style: TablerStyle, name: string): TablerPath[] | null {
    const i = this.indexOf(style, name);
    if (i < 0) return null;
    let p = this.cache[style].get(i);
    if (!p) { const o = this.span[style][2 * i]; p = decodeIcon(this.raw.subarray(o, o + this.span[style][2 * i + 1]), this.grid); this.cache[style].set(i, p); }
    return p;
  }
  /** the icon's index for a name or an old name of either set, or -1 */
  private find(name: string): number { return this.at.get(name) ?? this.alias.outline.get(name) ?? this.alias.filled.get(name) ?? -1; }
  /** the icon's category (an old name gives its icon's) */
  category(name: string): string | null { const i = this.find(name); return i < 0 ? null : this.categories[this.cat[i]]; }
  /** the icon's tags, the release's only (an old name gives its icon's; old names are oldNames) */
  tags(name: string): string[] { const i = this.find(name); return i < 0 ? [] : this.tagText[i].split("\n").filter(Boolean); }
  /** the icon's old names in the release's alias table (an old name gives its icon's) */
  oldNames(name: string): string[] { const i = this.find(name); return i < 0 ? [] : (this.oldText[i] ?? "").split("\n").filter(Boolean); }
  /** icons for a query (words, each matching a word of the name or a tag: whole, start or inside; an Italian word of
      ./search-it.ts matches its targets as whole words or names) in a category and set, best first: the name itself, then
      the names an Italian word stands for (in its order), then name words, then tags; whole before start before inside,
      then shorter names. Accents are folded */
  search(query: string, o: TablerSearch = {}): TablerHit[] {
    const words = queryWords(query), whole = words.map(w => w.w).join("-"), exact = exactNames(words);
    const ci = o.category === undefined ? -1 : this.categories.indexOf(o.category), bit = o.style === "filled" ? 2 : o.style === "outline" ? 1 : 3;
    if (o.category !== undefined && ci < 0) return [];
    const hits: [number, number][] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (!(this.sets[i] & bit) || (ci >= 0 && this.cat[i] !== ci)) continue;
      const name = this.names[i], nm = "-" + name + "-", tg = this.findText[i];
      let score = name === whole ? -100 : exact.get(name) ?? 0;
      for (const { w, alts } of words) {
        let s = nm.includes("-" + w + "-") ? 0 : nm.includes("-" + w) ? 1 : tg.includes("\n" + w + "\n") ? 2 : tg.includes("\n" + w) ? 3 : name.includes(w) ? 4 : tg.includes(w) ? 5 : 9;
        for (const t of alts) if (s > 0 && nm.includes("-" + t + "-")) s = 0; else if (s > 2 && tg.includes("\n" + t + "\n")) s = 2;
        if (s > 5) { score = NaN; break; }
        score += s;
      }
      if (score === score) hits.push([i, score]);
    }
    hits.sort((a, b) => a[1] - b[1] || this.names[a[0]].length - this.names[b[0]].length || (this.names[a[0]] < this.names[b[0]] ? -1 : 1));
    return hits.slice(0, o.limit ?? hits.length).map(([i]) => ({ name: this.names[i], category: this.categories[this.cat[i]], outline: !!(this.sets[i] & 1), filled: !!(this.sets[i] & 2) }));
  }
}

/** accents off and lower case: "Città" → "citta" */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const IT_STOP = new Set(["di", "del", "della", "dei", "delle", "il", "lo", "la", "le", "gli", "un", "una", "uno", "per", "con", "da"]);
let itWords: Map<string, string[]> | null = null;
/** the Italian words (./search-it.ts), folded: word or phrase (words joined by spaces) → its targets, best first */
export function italianWords(): Map<string, string[]> {
  if (itWords) return itWords;
  itWords = new Map();
  for (const line of IT_WORDS.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const targets = line.slice(c + 1).trim().split(/\s+/).filter(Boolean);
    for (const k of line.slice(0, c).split("/")) itWords.set(fold(k).trim().replace(/\s+/g, " "), targets);
  }
  return itWords;
}
/** a query's words, each with the English targets it stands for when it is an Italian word; an Italian phrase of the list
    is one word, and Italian articles and prepositions between words are dropped */
function queryWords(query: string): { w: string; alts: string[] }[] {
  const it = italianWords(), t = fold(query).split(/[\s,]+/).map(w => w.replace(/^-+|-+$/g, "")).filter(Boolean), out: { w: string; alts: string[] }[] = [];
  for (let i = 0; i < t.length;) {
    let n = Math.min(4, t.length - i);
    for (; n > 1; n--) if (it.has(t.slice(i, i + n).join(" "))) break;
    const k = t.slice(i, i + n).join(" ");
    i += n;
    if (n === 1 && IT_STOP.has(k) && t.length > 1) continue;
    out.push({ w: k.replace(/ /g, "-"), alts: it.get(k) ?? [] });
  }
  return out;
}
/** the names the Italian words stand for, as a whole (each word's targets in turn, at most 64): name → its score */
function exactNames(words: { w: string; alts: string[] }[]): Map<string, number> {
  let combos: string[][] = [[]];
  for (const { w, alts } of words) combos = combos.flatMap(c => [w, ...alts].map(a => [...c, a])).slice(0, 64);
  const out = new Map<string, number>();
  combos.slice(1).forEach((c, k) => { const n = c.join("-"); if (!out.has(n)) out.set(n, -50 + k / 100); });
  return out;
}

let set: Tabler | null = null;
/** the set, inflated on the first call (≈ 0.87 MB from the 0.38 MB inlined) */
export function tabler(): Tabler {
  if (set) return set;
  set = new Tabler(decode64(TABLER));                    // the one base64 + zlib decoder (text/hb.ts, as the HarfBuzz modules)
  if (set.version !== TABLER_VERSION) throw new Error(`Tabler data ${set.version}, ${TABLER_VERSION} expected`);
  return set;
}
/** whether the set has been inflated (for the first-use budget's measurement, 09 §7.4) */
export const tablerLoaded = () => set !== null;

/** register the set for resolveIcon (render/icons.ts): "tabler:x" and "tabler-filled:x" draw it from now on, and for the
    icon picker's search (S15.2, render/icon-search.ts). The set is inflated only when the first Tabler name is drawn or
    the picker first asks */
export function installTabler() {
  setIconCatalog(tabler, tablerLoaded);
  setVendoredIcons((s: IconSet, name: string) => {
    const p = tabler().icon(s === "tabler" ? "outline" : "filled", name);
    return p && { paths: p.map(x => x.d), paint: p.map(x => x.paint) };
  });
}
