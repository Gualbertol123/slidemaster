/* The display list (03 §2.4, ADR-004 with its 2026-10-12 amendment): the only contract between the designs and
   the three backends (svg.ts for the stage, canvas.ts for thumbnails / PNG / clipboard, ../pdf for the PDF).
   A slide is a flat, serialisable array of eight node types, in slide px (1600 × 900, y down), paint resolved.
   Nothing else may reach a backend, so nothing can be drawn on screen that the PDF cannot draw. */

/** 0–255 per channel */
export type RGB = [number, number, number];
/** a gradient stop: offset 0–1, colour, alpha 0–1 */
export interface Stop { o: number; c: RGB; a: number }
/** Paint: solid; linear in the unit box of the shape ([0,0] top left, [1,1] bottom right, as CSS gradients);
    radial: an ellipse in box units (centre cx, cy; radii rx, ry), centre outside the box allowed. Colour and alpha
    interpolate separately (unpremultiplied, as canvas and PDF shadings do; CSS gradients are premultiplied, so a
    design converting `transparent` stops gives them the neighbour's colour). A linear paint whose two points
    coincide is drawn as its last stop (CSS), in every backend (geom.ts paintOf) */
export type Paint =
  | { solid: RGB; a?: number }
  | { linear: [number, number, number, number]; stops: Stop[] }
  | { radial: { cx: number; cy: number; rx: number; ry: number; stops: Stop[] } };
/** a stroke, centred on the outline. A gradient stroke is allowed on rect and line only (drawn as a filled ring) */
export interface Stroke { w: number; paint: Paint; dash?: number[]; cap?: "butt" | "round" | "square";
  /** how segments meet (ADR-004 amendment, ADR-020; 09 §3): unset = "miter" (limit 10), as before */ join?: "miter" | "round" | "bevel" }
/** one corner radius, or [top-left, top-right, bottom-right, bottom-left] */
export type Radii = number | [number, number, number, number];
export interface RRect { x: number; y: number; w: number; h: number; r?: Radii }
/** path commands, absolute: move, line, cubic, close */
export type PathCmd = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];
/** affine [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (as SVG matrix(), canvas setTransform, PDF cm) */
export type Matrix = [number, number, number, number, number, number];

export interface RectNode extends RRect { t: "rect"; fill?: Paint; stroke?: Stroke }
export interface PathNode { t: "path"; d: PathCmd[]; fill?: Paint; stroke?: Stroke; rule?: "nonzero" | "evenodd" }
export interface LineNode { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
export interface ImageNode {
  t: "image";
  /** content hash of the picture (the backends' image stores are keyed by it) */
  id: string;
  x: number; y: number; w: number; h: number;
  /** the parts cut away, as fractions of the picture (Excel's srcRect) */
  crop?: { l: number; t: number; r: number; b: number };
  /** degrees clockwise about the box centre */
  rotation?: number; flipH?: boolean; flipV?: boolean;
  alpha?: number;
  /** a drop shadow of the picture's alpha (keyed pictures' filter: drop-shadow), rasterised once per picture by the
      design and placed as an image under it */
  shadow?: { id: string; x: number; y: number; w: number; h: number };
}
export interface ShadowNode {
  t: "shadow";
  /** the shape that casts it (box-shadow semantics: offset, blur, spread; 5 sharp layers, dl/geom.ts) */
  x: number; y: number; w: number; h: number; r?: Radii;
  dx: number; dy: number; blur: number; spread: number;
  c: RGB; a: number;
  /** inside the shape (drawn within its clip), as an inset box-shadow */
  inset?: boolean;
}
export interface TextNode {
  t: "text";
  /** font family key; b / i choose the face (the font registry maps them to a file for the PDF) */
  font: string; b?: boolean; i?: boolean;
  /** the CSS font-family list the screen backends draw with (the page's fallbacks), default the key */
  css?: string;
  /** a CSS font weight other than b's 400 / 700 (e.g. 520, 600) */
  weight?: number;
  /** px */
  size: number;
  /** start of the run on its baseline */
  x: number; y: number;
  /** the Unicode text (selection, search, ToUnicode) */
  src: string;
  /** the run's measured advance, px: every backend pins the run to it (SVG textLength, canvas letterSpacing, PDF Tc) */
  w?: number;
  /** the CSS letter-spacing included in w (px between characters; S4.4: SP compares the browser's own width with
      w less it) – informative, every backend draws by w */
  ls?: number;
  /** a shaped glyph run (S3.2): glyph ids and their x advances in px (sum = w). `adv` without `gids`: each
      character's advance (one per code point) as the screen measured it, letter-spacing included (tabular figures;
      their sum is w plus the last character's spacing) */
  gids?: number[]; adv?: number[];
  /** tabular figures (OpenType tnum, CSS font-variant-numeric: tabular-nums): the PDF shapes with the feature; a
      canvas, which cannot, centres each character in its advance */
  tnum?: boolean;
  /** the UTF-16 offset in src of each glyph's cluster (HarfBuzz's cluster): a ligature maps back to its letters */
  cl?: number[];
  /** each glyph's offset from its pen position, px, y up (HarfBuzz's x/y_offset: a mark on its base) */
  dx?: number[]; dy?: number[];
  fill: Paint;
  decoration?: { underline?: boolean; strike?: boolean };
  /** a decorative copy (a title's text shadow, ADR-004 amendment): drawn, but not selectable or searchable text
      (the PDF marks it as an artifact) */
  decorative?: boolean;
}
export type Clip = RRect | { d: PathCmd[] };
export interface GroupNode {
  t: "group";
  clip?: Clip;
  /** opacity of the group as a whole (a transparency group: overlapping children do not show through each other) */
  alpha?: number;
  transform?: Matrix;
  blend?: "multiply";
  children: Node[];
}
export interface HitNode {
  t: "hit"; kind: string; id: string; x: number; y: number; w: number; h: number;
  /** the text the region shows, as a reader (or innerText) has it: tests compare it with the goldens */
  label?: string;
}

export type Node = RectNode | PathNode | LineNode | ImageNode | ShadowNode | TextNode | GroupNode | HitNode;
export type DisplayList = Node[];
/** the CSS weight of a text node */
export const weightOf = (n: TextNode) => n.weight ?? (n.b ? 700 : 400);
export const NODE_TYPES = ["rect", "path", "line", "image", "shadow", "text", "group", "hit"] as const;

/* ---- validators: what a design hands a backend is checked in tests and before an export ---- */
/** finite and within ±1e6 (slide px are 0–1600; farther is a bug, and very large numbers break PDF syntax) */
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6;
const bad = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? "outside ±1e6" : "not a number";
const rgbOk = (c: unknown) => Array.isArray(c) && c.length === 3 && c.every(v => num(v) && v >= 0 && v <= 255);
const unit = (v: unknown) => num(v) && v >= 0 && v <= 1;

function paintErrors(p: unknown, at: string, out: string[]) {
  const P = p as Record<string, unknown>;
  if (!P || typeof P !== "object") { out.push(`${at}: not a paint`); return; }
  const stops = (s: unknown, where: string) => {
    if (!Array.isArray(s) || !s.length) { out.push(`${where}: no stops`); return; }
    let last = -1;
    for (const [k, st] of s.entries()) {
      const S = st as Stop;
      if (!unit(S?.o) || !rgbOk(S?.c) || !unit(S?.a)) out.push(`${where}[${k}]: bad stop`);
      else if (S.o < last) out.push(`${where}[${k}]: offsets go back`);
      else last = S.o;
    }
  };
  if ("solid" in P) { if (!rgbOk(P.solid)) out.push(`${at}.solid: bad colour`); if (P.a !== undefined && !unit(P.a)) out.push(`${at}.a: not 0–1`); }
  else if ("linear" in P) { const l = P.linear; if (!Array.isArray(l) || l.length !== 4 || !l.every(num)) out.push(`${at}.linear: 4 numbers`); stops(P.stops, at + ".stops"); }
  else if ("radial" in P) {
    const r = P.radial as Record<string, unknown>;
    if (!r || !num(r.cx) || !num(r.cy) || !num(r.rx) || !num(r.ry) || (r.rx as number) <= 0 || (r.ry as number) <= 0) out.push(`${at}.radial: cx, cy, rx > 0, ry > 0`);
    else stops(r.stops, at + ".radial.stops");
  } else out.push(`${at}: not a paint`);
}
const isGradient = (p: Paint | undefined) => !!p && !("solid" in p);
function strokeErrors(s: unknown, at: string, out: string[], gradientOk: boolean) {
  const S = s as Stroke;
  if (!S || !num(S.w) || S.w <= 0) { out.push(`${at}.w: > 0`); return; }
  paintErrors(S.paint, at + ".paint", out);
  if (!gradientOk && isGradient(S.paint)) out.push(`${at}: a gradient stroke only on rect and line`);
  if (S.dash !== undefined && (!Array.isArray(S.dash) || !S.dash.length || !S.dash.every(v => num(v) && v >= 0) || S.dash.every(v => v === 0))) out.push(`${at}.dash: non-negative numbers, not all 0`);
  if (S.cap !== undefined && !["butt", "round", "square"].includes(S.cap)) out.push(`${at}.cap`);
  if (S.join !== undefined && !["miter", "round", "bevel"].includes(S.join)) out.push(`${at}.join`);
}
function radiiErrors(r: unknown, at: string, out: string[]) {
  if (r === undefined) return;
  if (num(r)) { if (r < 0) out.push(`${at}: < 0`); return; }
  if (!Array.isArray(r) || r.length !== 4 || !r.every(v => num(v) && v >= 0)) out.push(`${at}: a number or 4 numbers ≥ 0`);
}
function boxErrors(n: Record<string, unknown>, at: string, out: string[]) {
  for (const k of ["x", "y", "w", "h"]) if (!num(n[k])) out.push(`${at}.${k}: ${bad(n[k])}`);
  if (num(n.w) && n.w < 0) out.push(`${at}.w: < 0`);
  if (num(n.h) && n.h < 0) out.push(`${at}.h: < 0`);
}
function pathErrors(d: unknown, at: string, out: string[]) {
  if (!Array.isArray(d) || !d.length) { out.push(`${at}: empty path`); return; }
  const ARGS: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
  d.forEach((c, k) => {
    if (!Array.isArray(c) || !(c[0] in ARGS) || c.length !== ARGS[c[0]] + 1 || !c.slice(1).every(num)) out.push(`${at}[${k}]: bad command`);
    else if (k === 0 && c[0] !== "M") out.push(`${at}[0]: must start with M`);
  });
}

/** every problem of a display list, as "path: what" (empty = valid) */
export function validate(list: unknown, at = "dl"): string[] {
  const out: string[] = [];
  if (!Array.isArray(list)) return [`${at}: not an array`];
  list.forEach((n, i) => nodeErrors(n, `${at}[${i}]`, out));
  return out;
}
function nodeErrors(node: unknown, at: string, out: string[]) {
  const n = node as Record<string, unknown>;
  if (!n || typeof n !== "object" || !NODE_TYPES.includes(n.t as never)) { out.push(`${at}: unknown node`); return; }
  at += ":" + n.t;
  switch (n.t) {
    case "rect":
      boxErrors(n, at, out); radiiErrors(n.r, at + ".r", out);
      if (n.fill !== undefined) paintErrors(n.fill, at + ".fill", out);
      if (n.stroke !== undefined) strokeErrors(n.stroke, at + ".stroke", out, true);
      if (n.fill === undefined && n.stroke === undefined) out.push(`${at}: neither fill nor stroke`);
      break;
    case "path":
      pathErrors(n.d, at + ".d", out);
      if (n.fill !== undefined) paintErrors(n.fill, at + ".fill", out);
      if (n.stroke !== undefined) strokeErrors(n.stroke, at + ".stroke", out, false);
      if (n.fill === undefined && n.stroke === undefined) out.push(`${at}: neither fill nor stroke`);
      if (n.rule !== undefined && n.rule !== "nonzero" && n.rule !== "evenodd") out.push(`${at}.rule`);
      break;
    case "line":
      for (const k of ["x1", "y1", "x2", "y2"]) if (!num(n[k])) out.push(`${at}.${k}: not a number`);
      strokeErrors(n.stroke, at + ".stroke", out, true);
      break;
    case "image": {
      if (typeof n.id !== "string" || !n.id) out.push(`${at}.id: empty`);
      boxErrors(n, at, out);
      const c = n.crop as Record<string, number> | undefined;
      if (c !== undefined && (!["l", "t", "r", "b"].every(k => unit(c[k])) || c.l + c.r >= 1 || c.t + c.b >= 1)) out.push(`${at}.crop: fractions, less than the whole picture`);
      if (n.rotation !== undefined && !num(n.rotation)) out.push(`${at}.rotation`);
      if (n.alpha !== undefined && !unit(n.alpha)) out.push(`${at}.alpha: not 0–1`);
      const s = n.shadow as Record<string, unknown> | undefined;
      if (s !== undefined) { if (typeof s.id !== "string" || !s.id) out.push(`${at}.shadow.id: empty`); boxErrors(s, at + ".shadow", out); }
      break;
    }
    case "shadow":
      boxErrors(n, at, out); radiiErrors(n.r, at + ".r", out);
      for (const k of ["dx", "dy", "blur", "spread", "a"]) if (!num(n[k])) out.push(`${at}.${k}: not a number`);
      if (num(n.blur) && n.blur < 0) out.push(`${at}.blur: < 0`);
      if (!rgbOk(n.c)) out.push(`${at}.c: bad colour`);
      if (num(n.a) && !unit(n.a)) out.push(`${at}.a: not 0–1`);
      break;
    case "text":
      if (typeof n.font !== "string" || !n.font) out.push(`${at}.font: empty`);
      if (!num(n.size) || n.size <= 0) out.push(`${at}.size: > 0`);
      if (!num(n.x) || !num(n.y)) out.push(`${at}: x, y`);
      if (typeof n.src !== "string") out.push(`${at}.src: not a string`);
      if (n.weight !== undefined && (!num(n.weight) || n.weight < 1 || n.weight > 1000)) out.push(`${at}.weight: 1–1000`);
      if (n.w !== undefined && (!num(n.w) || n.w < 0)) out.push(`${at}.w: ≥ 0`);
      if (n.gids === undefined && n.adv !== undefined) {
        // per-character advances (tabular figures): one per code point
        const a = n.adv as unknown[];
        if (!Array.isArray(a) || !a.every(num) || typeof n.src !== "string" || a.length !== [...n.src].length) out.push(`${at}.adv: one advance per character`);
        if (n.dx !== undefined || n.dy !== undefined || n.cl !== undefined) out.push(`${at}: dx, dy and cl need gids`);
      } else if (n.gids !== undefined) {
        const g = n.gids as unknown[], a = n.adv as unknown[];
        if (!Array.isArray(g) || !Array.isArray(a) || g.length !== a.length || !g.every(v => num(v) && v >= 0 && Number.isInteger(v)) || !a.every(num)) out.push(`${at}: gids and adv of equal length`);
        for (const k of ["dx", "dy"] as const) { const o = n[k] as unknown[] | undefined; if (o !== undefined && (!Array.isArray(o) || !Array.isArray(g) || o.length !== g.length || !o.every(num))) out.push(`${at}.${k}: one offset per glyph`); }
        const cl = n.cl as unknown[] | undefined;
        if (cl !== undefined && (!Array.isArray(cl) || !Array.isArray(g) || cl.length !== g.length || !cl.every(v => num(v) && Number.isInteger(v) && v >= 0 && v <= (n.src as string).length))) out.push(`${at}.cl: one offset in src per glyph`);
      }
      if (n.decoration !== undefined && n.w === undefined) out.push(`${at}.decoration: needs w`);
      paintErrors(n.fill, at + ".fill", out);
      if (isGradient(n.fill as Paint)) out.push(`${at}.fill: text is solid`);
      break;
    case "group": {
      const c = n.clip as Record<string, unknown> | undefined;
      if (c !== undefined) { if ("d" in c) pathErrors(c.d, at + ".clip.d", out); else { boxErrors(c, at + ".clip", out); radiiErrors(c.r, at + ".clip.r", out); } }
      if (n.alpha !== undefined && !unit(n.alpha)) out.push(`${at}.alpha: not 0–1`);
      if (n.transform !== undefined && (!Array.isArray(n.transform) || n.transform.length !== 6 || !n.transform.every(num))) out.push(`${at}.transform: 6 numbers`);
      if (n.blend !== undefined && n.blend !== "multiply") out.push(`${at}.blend: only multiply`);
      if (!Array.isArray(n.children)) out.push(`${at}.children: not an array`);
      else n.children.forEach((ch, k) => nodeErrors(ch, `${at}.children[${k}]`, out));
      break;
    }
    case "hit":
      if (typeof n.kind !== "string" || typeof n.id !== "string") out.push(`${at}: kind, id`);
      if (n.label !== undefined && typeof n.label !== "string") out.push(`${at}.label: not a string`);
      boxErrors(n, at, out);
      break;
  }
}

/** every image id a list draws (pictures and their shadows), for the backends' image stores */
export function imageIds(list: DisplayList, out = new Set<string>()): Set<string> {
  for (const n of list) {
    if (n.t === "image") { out.add(n.id); if (n.shadow) out.add(n.shadow.id); }
    else if (n.t === "group") imageIds(n.children, out);
  }
  return out;
}
