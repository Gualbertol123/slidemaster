/* Consulting Navy / Consulting Red tables, option tables: "cards" (product owner 2026-10-16: "add options to make
   different hybrids"): the Liquid Glass SCENE (glass.ts glassPlan, unchanged: header blocks, body cards, emphasised rows
   as tiles, signal capsules, separators, columns widened for the design's font by glassGeom) drawn with FLAT PREMIUM
   MATERIALS instead of frosted glass – no wallpaper, no rims, no sheens: every colour from the spec's look.flat
   (consult-spec.ts, following the deck's colours through specOf).
   - shells: a card is white with a hairline border and a soft drop shadow; a block tinted from a dark, grey or coloured
     fill (header bands) is solid in the design's dark with white bold text; a light-tinted block a pale accent tint; a
     tile (emphasised rows, totals) a tint with an accent bar on its left edge; panels a flat grey tint; chips white with
     a hairline; a signal ring (a coloured outline in the workbook) stays as a ring;
   - capsules: soft green / red with a dark ink, strong ones solid with white text, colour scales and other signals
     their colour mixed with white;
   - separators hairlines, heading underlines a 2 px accent rule;
   - texts as Liquid Glass lays them out (glassText), in the design's table font unless the user or the deck chose one,
     weights 400 / 700, the ink by what lies behind the text (decided by geometry: the innermost shell or capsule under
     the text box's centre);
   - pictures as Liquid Glass draws them; icons on a white disc. */
import type { TableLayout } from "../xlsx/types";
import type { DisplayList, Node } from "../dl/types";
import { solid } from "../dl/color";
import { fillClass } from "../xlsx/color";
import { mix } from "../model/style";
import type { Metrics, TableDL } from "./excel-dl";
import { glassPlan, sceneFont, type GCap, type GlassPlan, type GShell, type GText } from "./glass";
import { circle, glassPic, glassText, glassVars, picId, tboxNodes } from "./glass-dl";
import { specOf, type FlatLook } from "./consult-spec";
import type { RenderCtx } from "./context";

const r1 = (v: number) => +v.toFixed(1);               // glass-dl's rounding of positions
const WHITE = "#FFFFFF";
/** Liquid Glass's label ink (glass.ts SYS0.label) and its green / red inks: drawn in the design's */
const GLASS_LABEL = "#0B0D17", GLASS_GREEN = "#136B2E", GLASS_RED = "#A8101A";

/** what a shell is drawn as */
interface Flat { fill: string; border?: { w: number; color: string } | null; shadow?: FlatLook["card"]["shadow"]; bar?: { w: number; color: string }; ring?: string;
  /** its texts: in this ink and bold (dark blocks, tiles), else as planned */ ink?: string }
export function flatShell(s: Pick<GShell, "cls" | "tint" | "ring">, F: FlatLook): Flat {
  const cls = s.cls.split(/\s+/), card = cls.includes("card"), shadow = card ? F.card.shadow : null, ring = s.ring ? { ring: s.ring } : {};
  if (cls.includes("tinted") && s.tint) {
    if (fillClass(s.tint.hex) === "light") return { fill: F.light, shadow, ...ring };
    return { fill: F.head.fill, shadow, ink: F.head.ink, ...ring };
  }
  if (cls.includes("tile")) return { fill: F.tile.fill, bar: F.tile.bar, shadow, ink: F.tile.ink, ...ring };
  if (card) return { fill: F.card.fill, border: F.card.border, shadow, ...ring };
  if (cls.includes("chip")) return { fill: F.chip.fill, border: F.chip.border, ...ring };
  return { fill: F.panel, ...ring };                                          // panel
}
function shellNodes(s: GShell, F: FlatLook): Node[] {
  const f = flatShell(s, F), x = r1(s.x), y = r1(s.y), w = Math.max(0, r1(s.w)), h = Math.max(0, r1(s.h)), r = +Math.max(0, s.rad).toFixed(1);
  const out: Node[] = [{ t: "hit", kind: "wb", id: s.cls, x, y, w, h }];
  if (f.shadow && f.shadow.a > 0) out.push({ t: "shadow", x, y, w, h, r, dx: 0, dy: f.shadow.dy, blur: f.shadow.blur, spread: f.shadow.spread, c: f.shadow.c, a: f.shadow.a });
  const inner: Node[] = [{ t: "rect", x, y, w, h, fill: solid(f.fill) }];
  if (f.bar) inner.push({ t: "rect", x, y, w: Math.min(w, f.bar.w), h, fill: solid(f.bar.color) });
  out.push({ t: "group", clip: { x, y, w, h, r }, children: inner });
  // a border inside the edge (border-box), a signal ring 1.5 px
  const line = f.ring ? { w: 1.5, color: f.ring } : f.border;
  if (line && line.w > 0 && w > line.w && h > line.w) out.push({ t: "rect", x: x + line.w / 2, y: y + line.w / 2, w: w - line.w, h: h - line.w, r: Math.max(0, r - line.w / 2), stroke: { w: line.w, paint: solid(line.color) } });
  return out;
}

/** a capsule's fill and the ink of its text */
export function flatCap(c: Pick<GCap, "cls" | "bg">, F: FlatLook): { fill: string; ink: string } {
  const cls = c.cls.split(/\s+/), C = F.caps, solidCap = cls.includes("solid");
  if (cls.includes("scale") && c.bg) return { fill: mix(c.bg[0], WHITE, C.scaleMix), ink: F.ink };
  if (cls.includes("pos")) return solidCap ? { fill: C.solidPos, ink: WHITE } : C.pos;
  if (cls.includes("neg")) return solidCap ? { fill: C.solidNeg, ink: WHITE } : C.neg;
  return { fill: mix(c.bg ? c.bg[0] : "#8E8E93", WHITE, C.otherMix), ink: F.ink };
}
function capNodes(c: GCap, F: FlatLook): Node[] {
  const x = r1(c.x), y = r1(c.y), w = Math.max(0, r1(c.w)), h = Math.max(0, r1(c.h)), r = Math.max(0, c.rad);
  return [{ t: "hit", kind: "cap", id: c.cls, x, y, w, h }, { t: "rect", x, y, w, h, r, fill: solid(flatCap(c, F).fill) }];
}

/** the text's ink and weight by what lies under its centre: a capsule, else the innermost shell; the user's own text
    colour always wins */
function textLook(t: GText, plan: GlassPlan, F: FlatLook): GText {
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2, inside = (b: { x: number; y: number; w: number; h: number }) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  const cap = plan.caps.find(inside);
  const shell = cap ? null : plan.shells.filter(inside).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  const flat = shell ? flatShell(shell, F) : null;
  let ink = t.ink, bold = t.weight >= 600;
  if (cap) { const k = flatCap(cap, F); if (!t.it.userColor && !t.it.scaleInk) ink = k.ink; if (cap.cls.includes("solid")) bold = true; }
  else if (flat?.ink) { if (!t.it.userColor) ink = flat.ink; bold = t.it.userB !== false; }
  else if (ink === GLASS_LABEL) ink = F.ink;
  else if (ink === GLASS_GREEN) ink = F.caps.pos.ink;
  else if (ink === GLASS_RED) ink = F.caps.neg.ink;
  return { ...t, ink, weight: bold ? 700 : 400, shadow: false };
}

export function cardsToDisplayList(L: TableLayout, ctx: RenderCtx, m: Metrics, opts: { noText?: boolean } = {}, given?: GlassPlan): TableDL {
  const plan = given ?? glassPlan(L, ctx, opts), F = specOf(ctx).look.flat, family = sceneFont(ctx);
  const nodes: DisplayList = [], images: Record<string, string> = {};
  for (const s of plan.shells) nodes.push(...shellNodes(s, F));
  for (const l of plan.lines) {
    const x = r1(l.x), y = r1(l.y), w = Math.max(0, r1(l.w)), h = Math.max(0, r1(l.h));
    if (l.k === "rule") nodes.push({ t: "rect", x, y, w, h: F.rule.w, fill: solid(F.rule.color) });
    else if (l.k === "hsep") nodes.push({ t: "rect", x, y, w, h: F.sep.w, fill: solid(F.sep.color) });
    // a cell's own gridline (4.4, B20): its colour and weight
    else if (l.k === "cell") nodes.push({ t: "rect", x: l.x, y: l.y, w: Math.max(0, l.w), h: Math.max(0, l.h), fill: solid(l.color || "#404040") });
    else nodes.push({ t: "rect", x, y, w: F.sep.w, h, fill: solid(F.sep.color) });
  }
  for (const c of plan.caps) nodes.push(...capNodes(c, F));
  const V = glassVars(ctx);
  for (const p of plan.pics) {
    if (p.k === "icon") {
      // a white disc with a hairline, the picture clipped to a circle inside (padding 2.5 px, as Liquid Glass)
      const id = picId(p.src); images[id] = p.src;
      const d = p.d, D = d + 5, cx = p.x + D / 2, cy = p.y + D / 2, b = F.chip.border;
      nodes.push({ t: "hit", kind: "wb", id: "icon", x: p.x, y: p.y, w: D, h: D },
        { t: "path", d: circle(cx, cy, D / 2), fill: solid(F.chip.fill) }, { t: "path", d: circle(cx, cy, (D - b.w) / 2), stroke: { w: b.w, paint: solid(b.color) } },
        { t: "group", clip: { d: circle(cx, cy, d / 2) }, children: [{ t: "image", id, x: p.x + 2.5, y: p.y + 2.5, w: d, h: d }] });
      continue;
    }
    nodes.push(...glassPic(p.p, p.cls, V, images, !!ctx.forExport));
  }
  for (const e of plan.tbx) if (e.k === "shell") nodes.push(...shellNodes(e, F));
  if (!opts.noText) for (const t of plan.texts) nodes.push(...glassText(textLook(t, plan, F), m, family));
  for (const e of plan.tbx) if (e.k !== "shell") nodes.push(...tboxNodes(e, m, family, F.ink));
  return { nodes, images };
}
