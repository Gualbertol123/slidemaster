/* Liquid Glass → display list (PLAN S3.4): the plan v3's renderGlass wrote as HTML (glass.ts glassPlan: buildScene,
   inferRoles and every material decision unchanged; the HTML went in S4.5), drawn with the recipes of 03 §4.3 from
   the values of v3's slide.css, the CSS calc() expressions evaluated here for the glass level (--gi), the contrast
   veil (--gfade) and the corner radius (--rk):
   - a material (.gls.wb card / panel / chip / tile, list / tinted): its outer box-shadows, then inside its rounded
     box the blurred wallpaper at v3's placeGlass lens (LENS = 1 + .06 · gi, positioned on the slide), the tint, the
     contrast veil, its inset shadows, the rim (::before, a 135° gradient ring) and the sheen (::after, two
     elliptical radial gradients). Shadows are the 5-layer recipe (v3's printcss.ts STEPS = 5, decision 2026-10-12);
     the screen's real blur differs (B3, accepted pending G1);
   - hairlines and accent rules (.hsep, .vsep, .rule.accent), capsules (.cap), icons (.gls.icon: a glass disc with the
     picture clipped to a circle), pictures (.pic.gpic with its shadows, .pic.gcut keyed pictures), text boxes
     (.tbox.gtb on a card), texts (.t in the glass font, letter-spacing −.12 px, the plan's size, weight and ink; a
     strong capsule's text shadow as a decorative copy).
   Coordinates are in table px (the slide places and scales the table); the blurred wallpaper needs the table's
   placement on the slide.
   Not drawn yet (no corpus deck has them; named for G1): the drop shadow of keyed pictures (.gcut, CSS filter:
   drop-shadow – ImageNode.shadow is ready for a raster of it) and object-fit: cover for icons that are not square
   (drawn d × d). */
import { parseColor, solid } from "../dl/color";
import type { DisplayList, Node, Paint, PathCmd, RGB, Stop, TextNode } from "../dl/types";
import { glassLevel } from "../model/style";
import { fontStack } from "../model/fonts";
import { hexRgb } from "../xlsx/color";
import { breakRuns, collapse } from "../text/lines";
import type { RenderCtx } from "./context";
import { halfLeading, inlineLayout, lu, measuredBuild, primaryFamily, runsOf, type Metrics, type Run, type TableDL } from "./excel-dl";
import { GLASS_FONT, gItem, glassGeom, glassPlan, type GCap, type GlassPlan, type GLine, type GShell, type GTbox, type GText } from "./glass";
import { contrastVars, themeVars } from "./slide";
import { cfLookOf, cfNodes } from "./cf-dl";
import { effItems } from "./edits";

/** where the slide puts the table: its top left in slide px and its scale */
export interface Placement { x: number; y: number; scale: number }
/** the blurred wallpaper (800 × 450 JPEG) as an image id of the display list */
export interface Wallpaper { blurId: string; blurSrc: string }

export { GLASS_FONT } from "./glass";
export const GLASS_TBOX_FONT = `-apple-system,'SF Pro Text','Segoe UI',Arial,sans-serif`;
const LETTER = -.12;                                   // .slide.glass .t letter-spacing

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const r1 = (v: number) => +v.toFixed(1);               // the HTML's rounding of positions (toFixed(1))
const WHITE: RGB = [255, 255, 255];
const stop = (o: number, c: RGB, a: number): Stop => ({ o, c, a: clamp01(a) });

/** a CSS linear-gradient(<angle>) as the display list's unit-box coordinates of its gradient line (the line through
    the box centre at that angle, long enough to reach the corners: CSS Images 3 §3.1.1) */
export function cssLinear(deg: number, w: number, h: number): [number, number, number, number] {
  const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), len = Math.abs(w * dx) + Math.abs(h * dy);
  const x0 = w / 2 - dx * len / 2, y0 = h / 2 - dy * len / 2, x1 = w / 2 + dx * len / 2, y1 = h / 2 + dy * len / 2;
  return w && h ? [x0 / w, y0 / h, x1 / w, y1 / h] : [0, 0, 0, 1];
}
const linear = (deg: number, w: number, h: number, stops: Stop[]): Paint => ({ linear: cssLinear(deg, w, h), stops });

/* ---- the materials: box-shadow lists, tints, rims and sheens of v3's slide.css, as functions of --gi ---- */
interface Sh { inset?: boolean; dx: number; dy: number; blur: number; spread: number; c: RGB; a: number }
const S = (inset: boolean, dx: number, dy: number, blur: number, spread: number, c: RGB, a: number): Sh => ({ inset, dx, dy, blur, spread, c, a: clamp01(a) });
const NAVY: RGB = [28, 40, 100];
interface Material { tint: (w: number, h: number) => Paint; rim: number; sheen: number; shadows: Sh[] }
export function material(cls: string, gi: number, amt = .35): Material {
  const has = (k: string) => cls.split(/\s+/).includes(k);
  const m: Material = { tint: () => ({ solid: WHITE, a: .5 }), rim: 1.25, sheen: .6, shadows: [] };
  if (has("card")) m.shadows = [S(false, 0, 22, 48, -24, NAVY, .14 + .22 * gi), S(false, 0, 6, 16, -8, NAVY, .06 + .1 * gi), S(true, 0, 0, 0, .5, WHITE, .6), S(true, 0, 1, 1, 0, WHITE, .95),
    S(true, 0, -16, 30, -20, [40, 60, 150], .22 * gi), S(true, 0, 16, 32, -22, WHITE, .8 * gi)];
  if (has("list")) m.tint = (w, h) => linear(180, w, h, [stop(0, WHITE, .86 - .14 * gi), stop(1, WHITE, .78 - .18 * gi)]);
  if (has("tile")) {
    m.tint = (w, h) => linear(118, w, h, [stop(0, WHITE, .92 - .12 * gi), stop(.5, WHITE, .76 - .24 * gi), stop(1, WHITE, .86 - .16 * gi)]);
    m.rim = 1 + gi; m.sheen = .75;
    m.shadows = [S(false, 0, 26, 52, -24, NAVY, .16 + .26 * gi), S(false, 0, 8, 18, -10, NAVY, .08 + .14 * gi), S(true, 0, 0, 0, .5, WHITE, .65), S(true, 0, 1.5, 1, 0, WHITE, 1),
      S(true, 0, -18, 32, -20, [40, 60, 150], .26 * gi), S(true, 0, 18, 32, -20, WHITE, .9 * gi)];
  }
  if (has("chip")) { m.tint = (w, h) => linear(180, w, h, [stop(0, WHITE, .92), stop(1, WHITE, .8)]); m.rim = 1; m.sheen = .5;
    m.shadows = [S(false, 0, 2, 7, -3, NAVY, .16 + .14 * gi), S(true, 0, 1, 1, 0, WHITE, .95), S(true, 0, 0, 0, .5, [30, 40, 80], .06)]; }
  if (has("panel")) { m.tint = (w, h) => linear(180, w, h, [stop(0, WHITE, .55), stop(1, WHITE, .38)]); m.rim = 1; m.sheen = .45;
    m.shadows = [S(true, 0, 1, 1, 0, WHITE, .9), S(true, 0, 0, 0, .5, WHITE, .5), S(false, 0, 3, 10, -6, NAVY, .12 + .12 * gi)]; }
  if (has("tinted")) m.sheen = .5;
  if (has("icon")) { m.tint = (w, h) => linear(145, w, h, [stop(0, WHITE, .78), stop(1, WHITE, .42)]); m.rim = 1.2; m.shadows = [S(false, 0, 4, 10, -3, NAVY, .14 + .2 * gi), S(true, 0, 1, 1, 0, WHITE, .95)]; }
  if (has("chrome")) { m.tint = (w, h) => linear(180, w, h, [stop(0, WHITE, .8 - .16 * gi), stop(1, WHITE, .62 - .2 * gi)]);
    m.shadows = [S(false, 0, 14, 30, -16, NAVY, .14 + .22 * gi), S(true, 0, 0, 0, .5, WHITE, .6), S(true, 0, 1.5, 1, 0, WHITE, .95)]; }
  // the cover's glass shapes (.slide.glass .cv-orb / .cv-tile, after .gls.chrome): their own tints, --amt the colour
  if (has("cv-orb")) { m.tint = (w, h) => linear(145, w, h, [stop(0, WHITE, .6 - .12 * gi), stop(.7, [147, 170, 255], .16 + .1 * (1 - amt)), stop(1, [190, 160, 255], .14 + .1 * (1 - amt))]); m.sheen = .8; }
  if (has("cv-tile")) m.tint = (w, h) => linear(145, w, h, [stop(0, WHITE, .68 - .12 * gi), stop(1, [120, 200, 255], .12 + .1 * (1 - amt))]);
  return m;
}
/** glass.ts tintGrad: the fill mixed towards white, two stops (alpha, alpha − .08) */
function tintPaint(t: NonNullable<GShell["tint"]>, w: number, h: number): Paint {
  const mixWhite = (hex: string, k: number): RGB => hexRgb(hex).map(v => Math.round(255 + (v - 255) * k)) as RGB;
  return linear(180, w, h, [stop(0, mixWhite(t.hex, t.strength), t.alpha), stop(1, mixWhite(t.hex, t.strength * 1.25), t.alpha - .08)]);
}

/** everything of the CSS variables a table's glass needs */
export interface GlassVars { gi: number; amt: number; gfade: number; rk: number; a1: RGB; a2: RGB; a2rgb: RGB; posrgb: RGB | null; negrgb: RGB | null }
export function glassVars(ctx: RenderCtx): GlassVars {
  const v = themeVars(ctx), cv = contrastVars(ctx.style.contrast);
  const rgbOf = (s: string | undefined, d: RGB): RGB => s ? (s.startsWith("#") ? parseColor(s).c : s.split(",").map(Number) as RGB) : d;
  return { gi: glassLevel(ctx.style), amt: Math.max(0, Math.min(100, +ctx.style.color || 0)) / 100, gfade: +(cv["--gfade"] || 0), rk: ctx.style.radius / 100,
    a1: rgbOf(v["--a1"], [59, 130, 246]), a2: rgbOf(v["--a2"], [139, 92, 246]), a2rgb: rgbOf(v["--a2rgb"], [139, 92, 246]),
    posrgb: v["--posrgb"] ? rgbOf(v["--posrgb"], [0, 0, 0]) : null, negrgb: v["--negrgb"] ? rgbOf(v["--negrgb"], [0, 0, 0]) : null };
}

/** the shadows of a box, in CSS's painting order: outer ones below everything (the first listed on top), inset ones
    above the background (the first listed on top) */
function shadowNodes(list: Sh[], x: number, y: number, w: number, h: number, r: number, inset: boolean): Node[] {
  return list.filter(s => !!s.inset === inset && s.a > 0).reverse().map(s => ({ t: "shadow", x, y, w, h, r, dx: s.dx, dy: s.dy, blur: s.blur, spread: s.spread, c: s.c, a: s.a, ...(inset ? { inset: true } : {}) }));
}

/** a glass material (.gls.wb): see the header */
export function glassBox(cls: string, x: number, y: number, w: number, h: number, rad: number, V: GlassVars, place: Placement, wall: Wallpaper | null,
  opts: { tint?: GShell["tint"]; ring?: string; content?: Node[]; /** the hit node it gets (default: kind "wb", the material's classes) */ hit?: { kind: string; id: string; label?: string } } = {}): Node[] {
  const m = material(cls, V.gi, V.amt), r = Math.max(0, rad);
  let shadows = m.shadows;
  if (opts.ring) shadows = [S(true, 0, 0, 0, 1.5, parseColor(opts.ring).c, .75), S(false, 0, 2, 6, -3, NAVY, .25)];
  const inner: Node[] = [];
  if (wall) {
    // v3's placeGlass: the blurred wallpaper magnified by LENS about the element's centre, positioned on the slide
    const LENS = 1 + .06 * V.gi, sc = place.scale, ex = place.x + x * sc, ey = place.y + y * sc, cx = ex + w * sc / 2, cy = ey + h * sc / 2;
    const bw = +(1600 * LENS / sc).toFixed(2), bh = +(900 * LENS / sc).toFixed(2), px = +(-(ex + (LENS - 1) * cx) / sc).toFixed(2), py = +(-(ey + (LENS - 1) * cy) / sc).toFixed(2);
    inner.push({ t: "image", id: wall.blurId, x: x + px, y: y + py, w: bw, h: bh });
  }
  inner.push({ t: "rect", x, y, w, h, fill: opts.tint ? tintPaint(opts.tint, w, h) : m.tint(w, h) });
  if (V.gfade > 0) inner.push({ t: "rect", x, y, w, h, fill: { solid: WHITE, a: clamp01(V.gfade) } });
  inner.push(...shadowNodes(shadows, x, y, w, h, r, true));
  const gi = V.gi, rim = m.rim;
  // ::before: a ring of the rim's width just inside the edge, a 135° gradient
  const rimPaint = linear(135, w, h, [stop(0, WHITE, .55 + .45 * gi), stop(.13, WHITE, .6 * gi), stop(.36, WHITE, .1 * gi), stop(.52, WHITE, 0), stop(.72, WHITE, .16 * gi), stop(1, WHITE, .35 + .55 * gi)]);
  if (w > rim && h > rim) inner.push({ t: "rect", x: x + rim / 2, y: y + rim / 2, w: w - rim, h: h - rim, r: Math.max(0, r - rim / 2), stroke: { w: rim, paint: rimPaint } });
  if (opts.content) inner.push(...opts.content);
  // ::after: two elliptical radial sheens
  const sheen = m.sheen * gi;
  inner.push({ t: "rect", x, y, w, h, fill: { radial: { cx: .88, cy: 1.2, rx: .8, ry: .55, stops: [stop(0, WHITE, .34 * gi), stop(.55, WHITE, 0)] } } });
  inner.push({ t: "rect", x, y, w, h, fill: { radial: { cx: .16, cy: -.2, rx: 1.3, ry: .85, stops: [stop(0, WHITE, sheen), stop(.36, WHITE, .16 * gi), stop(.56, WHITE, 0)] } } });
  return [{ t: "hit", kind: "wb", id: cls, x, y, w, h, ...opts.hit }, ...shadowNodes(shadows, x, y, w, h, r, false), { t: "group", clip: { x, y, w, h, r }, children: inner }];
}

function lineNodes(l: GLine, V: GlassVars): Node[] {
  const x = r1(l.x), y = r1(l.y), w = Math.max(0, r1(l.w)), h = Math.max(0, r1(l.h)), INK: RGB = [30, 40, 80];
  if (l.k === "cell") { const p = parseColor(l.color || "#404040"); return [{ t: "rect", x: l.x, y: l.y, w: Math.max(0, l.w), h: Math.max(0, l.h), fill: p.a < 1 ? { solid: p.c, a: p.a } : { solid: p.c } }]; }
  if (l.k === "rule") return [{ t: "rect", x, y, w, h, r: 1, fill: linear(90, w, h, [stop(0, V.a1, 1), stop(.7, V.a2, 1), stop(1, V.a2rgb, .15)]) }];
  if (l.k === "hsep") return [{ t: "shadow", x, y, w, h, dx: 0, dy: 1, blur: 0, spread: 0, c: WHITE, a: .6 }, { t: "rect", x, y, w, h, fill: linear(90, w, h, [stop(0, INK, 0), stop(.05, INK, .14), stop(.95, INK, .14), stop(1, INK, 0)]) }];
  return [{ t: "shadow", x, y, w, h, dx: 1, dy: 0, blur: 0, spread: 0, c: WHITE, a: .5 }, { t: "rect", x, y, w, h, fill: linear(180, w, h, [stop(0, INK, 0), stop(.5, INK, .16), stop(1, INK, 0)]) }];
}

function capNodes(c: GCap, V: GlassVars): Node[] {
  const x = r1(c.x), y = r1(c.y), w = Math.max(0, r1(c.w)), h = Math.max(0, r1(c.h)), r = Math.max(0, c.rad), cls = c.cls.split(" ");
  const pos = V.posrgb, neg = V.negrgb, solidCap = cls.includes("solid");
  let fill: Paint, shadows: Sh[] = [];
  if (c.bg) { const k = parseColor(c.bg[0]).c; fill = linear(180, w, h, [stop(0, k, c.bg[1]), stop(1, k, c.bg[2])]); }
  else if (cls.includes("pos") && solidCap) { fill = linear(180, w, h, [stop(0, pos || [95, 224, 133], .9), stop(.55, pos || [52, 199, 89], 1), stop(1, pos || [42, 176, 77], 1)]); shadows = [S(false, 0, 5, 12, -6, [30, 160, 70], .5), S(true, 0, 1, 1, 0, WHITE, .6)]; }
  else if (cls.includes("neg") && solidCap) { fill = linear(180, w, h, [stop(0, neg || [255, 119, 109], .9), stop(.55, neg || [255, 59, 48], 1), stop(1, neg || [226, 38, 28], 1)]); shadows = [S(false, 0, 5, 12, -6, [215, 40, 30], .45), S(true, 0, 1, 1, 0, WHITE, .55)]; }
  else if (cls.includes("pos")) fill = linear(180, w, h, [stop(0, pos || [64, 208, 102], .62), stop(1, pos || [46, 190, 84], .46)]);
  else if (cls.includes("neg")) fill = linear(180, w, h, [stop(0, neg || [255, 82, 72], .56), stop(1, neg || [245, 52, 42], .4)]);
  else fill = { solid: WHITE, a: 0 };
  // border-top: 1px solid rgba(255,255,255,.55), inside the rounded box
  const inner: Node[] = [{ t: "rect", x, y, w, h, fill }, { t: "rect", x, y, w, h: Math.min(1, h), fill: { solid: WHITE, a: .55 } }, ...shadowNodes(shadows, x, y, w, h, r, true)];
  // its hit (kind "cap", the classes as id): the stage gives the capsule's rect its classes, as the page's .cap had
  return [{ t: "hit", kind: "cap", id: c.cls, x, y, w, h }, ...shadowNodes(shadows, x, y, w, h, r, false), { t: "group", clip: { x, y, w, h, r }, children: inner }];
}

/** a glass cell text (.t): see the header. Letter-spacing (CSS: after every character) is part of every advance. */
export function glassText(t: GText, m: Metrics, scene = GLASS_FONT): Node[] {
  const it = t.it, family = t.font ? fontStack(t.font) : scene, size = t.size, i = t.italic;
  const fontAt = (sz: number) => `${i ? "italic " : ""}${t.weight} ${sz}px ${family}`;
  const font = fontAt(size), ink = solid(t.ink);
  const x = r1(t.x), y = r1(t.y), w = Math.max(0, r1(t.w)), h = Math.max(0, r1(t.h));
  const out: Node[] = [{ t: "hit", kind: "t", id: `${it.b.r},${it.b.c}`, x, y, w, h, label: collapse(String(it.text)).trim() }];
  // a number's cell has font-variant-numeric: tabular-nums (t.num)
  const adv = (s: string, sz = size) => m.run(s, fontAt(sz), t.num).w + [...s].length * LETTER;
  const node = (src: string, xx: number, yy: number, sz: number): TextNode => {
    const run = m.run(src, fontAt(sz), t.num), n = [...src].length;
    const tab = t.num && run.adv && run.adv.length === n ? { tnum: true, adv: run.adv.map(a => a + LETTER) } : t.num ? { tnum: true } : {};
    return { t: "text", font: primaryFamily(family), css: family, weight: t.weight, ...(i ? { i: true } : {}), size: sz, x: +xx.toFixed(2), y: +yy.toFixed(2), src,
      w: Math.max(0, run.w + (n - 1) * LETTER), ls: LETTER, fill: ink, ...tab };
  };
  // a strong capsule's text-shadow 0 1px 1px rgba(0,0,0,.2): a decorative copy 1 px lower
  const shadowed = (n: TextNode): Node[] => t.shadow ? [{ ...n, y: n.y + 1, fill: { solid: [0, 0, 0], a: .2 }, decorative: true }, n] : [n];
  const pl = t.padL ?? 3, pr = t.padR ?? 3, cx = x + pl, cw = Math.max(0, w - pl - pr);
  const base = m.run("", font), plain = collapse(String(it.text)).trim();
  const nodes: Node[] = [];
  if (it.rot) {
    // .t.ov + rotBox: the span centred in the content box, line-height 1.1, turned about its centre (rotSpan);
    // 255: writing-mode vertical-rl, upright – the letters stacked, each the font's line height (ascent + descent)
    // plus the letter-spacing down the column
    const lh = lu(1.1 * size), lead = halfLeading(lh, base), cxm = cx + cw / 2, cym = y + h / 2;
    if (it.rot === 255) {
      const chars = [...plain], step = base.asc + base.desc + LETTER, total = chars.length * step;
      chars.forEach((ch, k) => nodes.push(...shadowed(node(ch, cxm - m.run(ch, font, t.num).w / 2, cym - total / 2 + k * step + base.asc, size))));     // (a digit: its tabular width)
      return [...out, ...nodes];
    }
    const wd = adv(plain), deg = it.rot <= 90 ? -it.rot : it.rot - 90, a = deg * Math.PI / 180;
    const n = node(plain, -wd / 2, -lh / 2 + lead + base.asc, size);
    nodes.push({ t: "group", transform: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cxm, cym], children: shadowed(n) });
    return [...out, ...nodes];
  }
  const runs = runsOf(it, size), runW = (r: Run) => adv(r.text, r.size);
  const place = (ln: Run[], lx: number, by: number) => { let xx = lx; for (const r of ln) { nodes.push(...shadowed(node(r.text, xx, by + r.dy, r.size))); xx += runW(r); } };
  if (t.single) {
    // display: block, line-height = the cell's height, text-align; a line wider than the box starts at the start
    // edge and overflows at the end (CSS Text 3 §7.1)
    const lh = it.bh, lead = halfLeading(lh, base), wd = runs.reduce((s, r) => s + runW(r), 0);
    const lx = wd > cw + 1e-6 ? cx : t.align === "right" ? cx + cw - wd : t.align === "center" ? cx + (cw - wd) / 2 : cx;
    place(runs, lx, y + lead + base.asc);
  } else {
    // the flex box: justify-content by alignment, align-items centre (or top), line-height 1.15; wrapping as
    // white-space normal + break-word over the runs (excel-dl.ts)
    const lh = lu(1.15 * size), lead = halfLeading(lh, base);
    const lines: Run[][] = it.wrap ? breakRuns(runs, cw, (s, r) => adv(s, r.size)).map(ps => ps.map(p => ({ ...p.run, text: p.text }))) : [runs];
    const widths = lines.map(l => l.reduce((s, r) => s + runW(r), 0)), multi = lines.length > 1;
    const spanned = !!it.scripts?.length && !it.edited && !it.ov;
    const itemW = multi ? cw : spanned ? Math.min(widths[0], cw) : widths[0], itemH = lines.length * lh;
    const ix = t.align === "right" ? cx + cw - itemW : t.align === "center" ? cx + (cw - itemW) / 2 : cx;
    const iy = t.valign === "top" ? y : t.valign === "bottom" && it.userVAlign ? y + h - itemH : y + (h - itemH) / 2;
    lines.forEach((l, k) => {
      const lx = ix + (multi ? (t.align === "right" ? itemW - widths[k] : t.align === "center" ? (itemW - widths[k]) / 2 : 0) : 0);
      place(l, lx, iy + k * lh + lead + base.asc);
    });
  }
  if (it.ov) out.push(...nodes); else out.push({ t: "group", clip: { x, y, w, h }, children: nodes });
  return out;
}

export function glassToDisplayList(L: import("../xlsx/types").TableLayout, ctx: RenderCtx, place: Placement, wall: Wallpaper | null, m: Metrics, opts: { noText?: boolean } = {}, given?: GlassPlan): TableDL {
  const plan = given ?? glassPlan(L, ctx, opts), V = glassVars(ctx), images: Record<string, string> = {}, nodes: DisplayList = [];
  if (wall) images[wall.blurId] = wall.blurSrc;
  for (const s of plan.shells) nodes.push(...glassBox(s.cls, r1(s.x), r1(s.y), Math.max(0, r1(s.w)), Math.max(0, r1(s.h)), +Math.max(0, s.rad).toFixed(1), V, place, wall, { tint: s.tint, ring: s.ring }));
  for (const l of plan.lines) nodes.push(...lineNodes(l, V));
  for (const c of plan.caps) nodes.push(...capNodes(c, V));
  for (const p of plan.pics) {
    if (p.k === "icon") {
      // .gls.wb.icon: a disc with padding 2.5 px, the picture clipped to a circle inside (object-fit: cover)
      const id = picId(p.src); images[id] = p.src;
      const d = p.d, X = p.x, Y = p.y, D = d + 5, c = X + D / 2, cy = Y + D / 2;
      const disc: PathCmd[] = circle(c, cy, d / 2);
      nodes.push(...glassBox("icon", X, Y, D, D, D / 2, V, place, wall, { content: [{ t: "group", clip: { d: disc }, children: [{ t: "image", id, x: X + 2.5, y: Y + 2.5, w: d, h: d }] }] }));
      continue;
    }
    nodes.push(...glassPic(p.p, p.cls, V, images, !!ctx.forExport));
  }
  // painting order inside .xt (a stacking context): the elements without z-index in tree order – text boxes' cards
  // too – then the z-index 3 ones (.t cells, .tbox.gtb bodies) in tree order
  for (const e of plan.tbx) if (e.k === "shell") nodes.push(...glassBox(e.cls, r1(e.x), r1(e.y), Math.max(0, r1(e.w)), Math.max(0, r1(e.h)), +Math.max(0, e.rad).toFixed(1), V, place, wall, { tint: e.tint }));
  const cfs = effItems(L, ctx).filter(it => it.cfBar || it.cfIcon);
  if (cfs.length) { const G = glassGeom(L, ctx); nodes.push(...cfNodes(cfs.map(it => gItem(it, G)), cfLookOf(ctx))); }
  if (!opts.noText) for (const t of plan.texts) nodes.push(...glassText(t, m));
  for (const e of plan.tbx) if (e.k !== "shell") nodes.push(...tboxNodes(e, m));
  return { nodes, images };
}
/** a text box's body (.tbox.gtb): its paragraphs in the text box font, the colours of its runs as the plan inks them */
export function tboxNodes(e: GTbox, m: Metrics, family = GLASS_TBOX_FONT, color = "#0B0D17"): Node[] {
  const tb = e.tb, paras = (tb.paras || []).map(p => ({ ...p, runs: p.runs.map(r => r.color ? { ...r, color: e.ink(r.color) } : r) }));
  const x = r1(tb.x), y = r1(tb.y), w = Math.max(0, r1(tb.w)), h = Math.max(0, r1(tb.h));
  const inner = inlineLayout(paras, x + 12, y + 8, Math.max(0, w - 24), Math.max(0, h - 16), tb.anchorV || "t", m, { family, size: 14.67, color, lh: 1.25 });
  const label = (tb.paras || []).map(p => collapse(p.runs.map(r => r.text).join("")).trim() || " ").join("\n").replace(/\s+\n/g, "\n").trim();
  const body: Node[] = [{ t: "hit", kind: "tbox", id: tb.name || "", x, y, w, h, label }, { t: "group", clip: { x, y, w, h }, children: inner }];
  const M = tb.rot || tb.flipH || tb.flipV ? rotFlip(tb) : null;
  return M ? [{ t: "group" as const, transform: M, children: body }] : body;
}

const KAPPA = .5522847498;
export function circle(cx: number, cy: number, r: number): PathCmd[] {
  const k = r * KAPPA;
  return [["M", cx + r, cy], ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r], ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy], ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r], ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy], ["Z"]];
}
function rotFlip(o: { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }): [number, number, number, number, number, number] {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = (o.rot || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), sx = o.flipH ? -1 : 1, sy = o.flipV ? -1 : 1;
  const A = cos * sx, B = sin * sx, C = -sin * sy, D = cos * sy;
  return [A, B, C, D, cx - A * cx - C * cy, cy - B * cx - D * cy];
}
export function picId(src: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < src.length; i++) { const c = src.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15); }
  return "p" + (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0") + src.length.toString(36);
}
/** .pic.gpic (rounded, shadowed) and .pic.gcut (keyed, a drop shadow: its raster comes with the picture analysis; without
    one the picture is drawn plainly) */
export function glassPic(p: import("../xlsx/types").Pic, cls: "gcut" | "gpic", V: GlassVars, images: Record<string, string>, forExport: boolean): Node[] {
  const hit: Node = { t: "hit", kind: "pic", id: p.name || "", x: p.x, y: p.y, w: p.w, h: p.h };
  const M = p.rot || p.flipH || p.flipV ? rotFlip(p) : null;
  if (p.unsupported || !p.src) return forExport ? [] : [hit];
  const id = picId(p.src); images[id] = p.src;
  const c = p.crop, crop = c && (c.l || c.t || c.r || c.b) ? { crop: { l: c.l, t: c.t, r: c.r, b: c.b } } : {};
  const img: Node = { t: "image", id, x: p.x, y: p.y, w: p.w, h: p.h, ...crop };
  let body: Node[];
  if (cls === "gpic") {
    const r = 10 * V.rk;
    body = [{ t: "shadow", x: p.x, y: p.y, w: p.w, h: p.h, r, dx: 0, dy: 0, blur: 0, spread: 1, c: WHITE, a: .7 }, { t: "shadow", x: p.x, y: p.y, w: p.w, h: p.h, r, dx: 0, dy: 14, blur: 30, spread: -14, c: NAVY, a: .4 },
      { t: "group", clip: { x: p.x, y: p.y, w: p.w, h: p.h, r }, children: [img] }];
  } else body = [img];
  return M ? [{ t: "group", transform: M, children: [hit, ...body] }] : [hit, ...body];
}

/** a table's display list with the page's measurements (Liquid Glass); the plan does not depend on them, so it is made
    once, not in every measuring round */
export function glassTableDL(L: import("../xlsx/types").TableLayout, ctx: RenderCtx, place: Placement, wall: Wallpaper | null, opts: { noText?: boolean } = {}) {
  const plan = glassPlan(L, ctx, opts);
  return measuredBuild(m => glassToDisplayList(L, ctx, place, wall, m, opts, plan));
}
