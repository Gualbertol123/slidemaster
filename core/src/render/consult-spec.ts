/* The two consulting designs as data (docs/next/08-consulting-designs.md §2, ADR-018): one renderer – consult-dl.ts for
   tables, the consult branch of slide-dl.ts for the furniture – reads everything it draws from a DesignSpec. Values are
   slide px (1600 × 900); the reference each comes from is in 08 §2. The accent, ink, background, positive and negative
   follow the deck's colours (palette(): the design's own palette, or the user's overrides), so specOf(ctx) resolves them. */
import type { RenderCtx } from "./context";
import { mix, palette } from "../model/style";
import type { ConsultDesign } from "../model/designs";

export interface Stroke { w: number; color: string }
export interface TextSpec { family: string; size: number; weight: number; color: string; lh?: number; ls?: number; caps?: boolean }
export interface DesignSpec {
  id: ConsultDesign;
  /** CSS font stacks: titles / headings (serif in Consulting Navy) and everything else */
  font: { title: string; body: string };
  accent: string; ink: string; bg: string; pos: string; neg: string;
  /** accent tints, lightest last (charts, highlights), and how much white each mixes in when the accent is overridden */ tints: string[]; tintMix: number[];
  /** the title band (08 §2.0): two lines, bottom-anchored */
  band: { trackerTop: number; trackerH: number; titleTop: number; lines: number; subTop: number; ruleY: { sub: number; none: number }; x: number; w: number };
  title: TextSpec; subtitle: TextSpec;
  /** the rule under the title block; the rule above the footer (null = none) */
  rule: Stroke; bottomRule: (Stroke & { y: number }) | null;
  /** the tracker / sticker slot (empty in M7b: no data for it yet) */ tracker: TextSpec & { align: "left" | "right" };
  table: {
    family: string; ink: string;
    /** "rules": bold text over a heavier rule; "fill": a filled header band with light text */
    head: { kind: "rules" | "fill"; fill: string | null; ink: string; sep: Stroke | null; rule: Stroke | null };
    top: Stroke | null; rowRule: Stroke; totalRule: Stroke; bottom: Stroke;
    /** CE-11 highlight under a cell; a highlighted total = solid accent with white bold text */
    highlight: string; strong: { fill: string; ink: string };
  };
  /** text boxes, automated comments */
  note: { family: string; size: number; lh: number; ink: string; h1: TextSpec; h2: TextSpec; bullet: string; bulletColor: string };
  /** a text box with its card on: the so-what / takeaway box */
  card: { fill: string; bar: Stroke; padY: number; padX: number };
  /** the notes section: footnotes ("Note:" / "Source:"), with its card on the kicker / takeaway bar */
  memo: TextSpec & { kicker: { fill: string; ink: string; size: number; weight: number } };
  pageno: TextSpec;
  cover: {
    bg: string; band: { y: number; h: number; fill: string } | null; bar: { x: number; y: number; w: number; h: number; fill: string };
    title: TextSpec & { x: number; top: number; w: number; maxLines: number }; subtitle: TextSpec & { a?: number };
    date: TextSpec & { x: number; y: number }; note: TextSpec & { a?: number };
  };
  index: {
    bg: string; heading: TextSpec & { x: number; y: number }; headingRule: Stroke | null;
    entry: TextSpec; number: TextSpec & { circle: string | null; d: number }; page: TextSpec; leader: Stroke | null; pitch: number; top: number;
  };
  /** the design pass (08 §2.5, product owner 2026-10-16: "more aesthetically appealing, like the liquid glass – still
      professional"): what gives each design its own character beyond rules and colours */
  look: {
    /** a brand band across the top of content slides (null = none) */ topBand: { h: number; fill: string } | null;
    /** the short thick segment at the left end of the title rule, sitting on it */ ruleAccent: { w: number; h: number; color: string } | null;
    /** signal chips: a conditional-format or colour-scale cell is drawn as a small rounded tag (as Liquid Glass's capsules)
        in a soft tint with its number in the dark tone – green / red by the colour's hue, anything else in the accent's tint */
    chips: { r: number; insetX: number; insetY: number; pos: { fill: string; ink: string }; neg: { fill: string; ink: string }; other: { fill: string; ink: string } };
    /** the underline of a header cell that spans columns (a group header such as "Δ vs. Budget") */ group: Stroke & { inset: number };
    /** total rows: a tinted band under them (null = none) */ totalBand: string | null;
    /** cards (so-what / takeaway boxes): corner radius and a soft shadow (the shadow node's fields) */
    card: { radius: number; shadow: { dy: number; blur: number; spread: number; c: [number, number, number]; a: number } | null };
    /** cover ornament: concentric arcs from the bottom-right corner (Consulting Navy) or pinstripes across the band (Consulting Red) */
    cover: { arcs: { cx: number; cy: number; r: number[]; w: number; color: string; a: number[]; disc: { r: number; a: number } | null } | null;
      stripes: { x0: number; x1: number; y0: number; y1: number; gap: number; w: number; color: string; a: number } | null };
    /** contents: the numbers in an outlined ring (null = as index.number) */ numberRing: Stroke | null;
    /** flat premium materials (product owner 2026-10-16): the tables are drawn from the Liquid Glass scene (glassPlan),
        each glass material replaced by a flat one (consult-dl.ts) */
    flat: FlatLook;
  };
  /** M9 hooks (07 §3): charts and callouts drawn in this design */
  chart: {
    palette: string[]; other: string; highlightRest: string; label: TextSpec; legend: { kind: "square" | "line"; w: number; h: number; pos: "top-right" };
    separator: Stroke; callout: { outline: Stroke; shape: "circle" | "ellipse"; deltaWeight: number; numbered: boolean; shadow: false };
  };
}

/** a material: its fill, a 1 px border inside its edge (null = none), an outer shadow (the shadow node's fields) */
export interface FlatShadow { dy: number; blur: number; spread: number; c: [number, number, number]; a: number }
export interface FlatLook {
  /** the scene's cards ("card list", plain blocks): white, a hairline border, a soft drop shadow */
  card: { fill: string; border: Stroke | null; shadow: FlatShadow | null };
  /** shells tinted from a dark, grey or coloured fill (header blocks): solid, light bold text */
  head: { fill: string; ink: string };
  /** shells tinted from a light fill */ light: string;
  /** "card tile" (emphasised rows, e.g. totals): a tint with an accent bar on its left edge, bold text */
  tile: { fill: string; bar: Stroke; ink: string };
  /** "panel" (blocks nested in a card): a flat tint, no shadow */ panel: string;
  /** "chip" (small blocks): white with a hairline border */ chip: { fill: string; border: Stroke };
  /** signal capsules: soft green / red with a dark ink; strong ones solid with white text; a colour scale's colour and
      any other signal's mixed with white by scaleMix / otherMix (their text in the ink) */
  caps: { pos: { fill: string; ink: string }; neg: { fill: string; ink: string }; solidPos: string; solidNeg: string; scaleMix: number; otherMix: number };
  /** the scene's separators (hsep / vsep) and heading underlines */ sep: Stroke; rule: Stroke;
  /** the table text (Liquid Glass's label ink) */ ink: string;
}
const CAPS = { pos: { fill: "#DDF3E4", ink: "#13753A" }, neg: { fill: "#FBE3E1", ink: "#B3261E" }, solidPos: "#1E8E3E", solidNeg: "#D93025", scaleMix: .6, otherMix: .75 };

export const GEORGIA = `Georgia,Gelasio,"Times New Roman",serif`;
export const ARIAL = `Arial,"Liberation Sans",Arimo,sans-serif`;
const BAND = { trackerTop: 10, trackerH: 16, titleTop: 30, lines: 2, subTop: 124, ruleY: { sub: 158, none: 126 }, x: 50, w: 1500 };

/** the spec as designed (08 §2.1, §2.2), before the deck's colours */
export const SPECS: Record<ConsultDesign, DesignSpec> = {
  mckinsey: {
    id: "mckinsey", font: { title: GEORGIA, body: ARIAL },
    accent: "#2251FF", ink: "#000000", bg: "#FFFFFF", pos: "#1E8E3E", neg: "#D93025", tints: ["#00A9F4", "#99E6FF", "#CAEFFF"], tintMix: [.45, .72, .85],
    band: BAND,
    title: { family: GEORGIA, size: 40, weight: 700, color: "#051C2C", lh: 1.1 },
    subtitle: { family: ARIAL, size: 24, weight: 400, color: "#4E5B66", lh: 1.1 },
    rule: { w: 1, color: "#051C2C" }, bottomRule: { y: 828, w: 1, color: "#D6DEE6" },
    tracker: { family: ARIAL, size: 15, weight: 700, color: "#000000", align: "right" },
    table: {
      family: ARIAL, ink: "#000000",
      head: { kind: "rules", fill: null, ink: "#051C2C", sep: null, rule: { w: 2, color: "#051C2C" } },
      top: null, rowRule: { w: 1, color: "#E3E8EE" }, totalRule: { w: 1, color: "#051C2C" }, bottom: { w: 1, color: "#051C2C" },
      highlight: "#CAEFFF", strong: { fill: "#2251FF", ink: "#FFFFFF" },
    },
    note: { family: ARIAL, size: 18, lh: 1.25, ink: "#000000",
      h1: { family: GEORGIA, size: 22, weight: 700, color: "#051C2C" }, h2: { family: ARIAL, size: 18, weight: 700, color: "#2251FF" },
      bullet: "▪", bulletColor: "#2251FF" },
    card: { fill: "#F4F7FB", bar: { w: 4, color: "#2251FF" }, padY: 14, padX: 16 },
    memo: { family: ARIAL, size: 13, weight: 400, color: "#4E5B66", lh: 1.2, kicker: { fill: "#051C2C", ink: "#FFFFFF", size: 18, weight: 700 } },
    pageno: { family: ARIAL, size: 15, weight: 400, color: "#000000" },
    cover: {
      bg: "#051C2C", band: null, bar: { x: 96, y: 280, w: 72, h: 6, fill: "#2251FF" },
      title: { family: GEORGIA, size: 64, weight: 700, color: "#FFFFFF", lh: 1.1, x: 96, top: 300, w: 1100, maxLines: 3 },
      subtitle: { family: ARIAL, size: 32, weight: 400, color: "#FFFFFF", a: .85, lh: 1.2 },
      date: { family: ARIAL, size: 18, weight: 400, color: "#99E6FF", x: 96, y: 780 },
      note: { family: ARIAL, size: 16, weight: 400, color: "#FFFFFF", a: .7, lh: 1.3 },
    },
    index: {
      bg: "#051C2C", heading: { family: GEORGIA, size: 40, weight: 700, color: "#FFFFFF", x: 96, y: 70 }, headingRule: null,
      entry: { family: ARIAL, size: 28, weight: 400, color: "#FFFFFF" }, number: { family: ARIAL, size: 28, weight: 400, color: "#00A9F4", circle: null, d: 0 },
      page: { family: ARIAL, size: 28, weight: 400, color: "#99E6FF" }, leader: null, pitch: 56, top: 190,
    },
    look: {
      topBand: { h: 6, fill: "#051C2C" }, ruleAccent: { w: 96, h: 4, color: "#2251FF" },
      chips: { r: 3, insetX: 3, insetY: 2, pos: { fill: "#E2F2E7", ink: "#1E8E3E" }, neg: { fill: "#FBE4E1", ink: "#D93025" }, other: { fill: "#E5ECFF", ink: "#051C2C" } },
      group: { w: 2, color: "#2251FF", inset: 6 }, totalBand: "#EEF3FF",
      card: { radius: 0, shadow: { dy: 6, blur: 18, spread: -10, c: [5, 28, 44], a: .18 } },
      cover: { arcs: { cx: 1600, cy: 900, r: [420, 560, 700, 840], w: 2, color: "#2251FF", a: [.55, .4, .28, .18], disc: { r: 300, a: .14 } }, stripes: null },
      numberRing: { w: 1.5, color: "#00A9F4" },
      flat: {
        card: { fill: "#FFFFFF", border: { w: 1, color: "#E3E8EE" }, shadow: { dy: 12, blur: 32, spread: -14, c: [5, 28, 44], a: .22 } },
        head: { fill: "#051C2C", ink: "#FFFFFF" }, light: "#E8EEFF",
        tile: { fill: "#E8EEFF", bar: { w: 4, color: "#2251FF" }, ink: "#051C2C" },
        panel: "#F5F7FB", chip: { fill: "#FFFFFF", border: { w: 1, color: "#E3E8EE" } }, caps: CAPS,
        sep: { w: 1, color: "#E8ECF2" }, rule: { w: 2, color: "#2251FF" }, ink: "#051C2C",
      },
    },
    chart: {
      palette: ["#051C2C", "#2251FF", "#00A9F4", "#99E6FF"], other: "#B3B3B3", highlightRest: "#B3B3B3",
      label: { family: ARIAL, size: 14, weight: 400, color: "#000000" }, legend: { kind: "square", w: 10, h: 10, pos: "top-right" },
      separator: { w: 1.5, color: "#FFFFFF" }, callout: { outline: { w: 2, color: "#2251FF" }, shape: "circle", deltaWeight: 700, numbered: false, shadow: false },
    },
  },
  bain: {
    id: "bain", font: { title: ARIAL, body: ARIAL },
    accent: "#CC0000", ink: "#000000", bg: "#FFFFFF", pos: "#1E8E3E", neg: "#D93025", tints: ["#F16666", "#F5CCCC"], tintMix: [.4, .8],
    band: BAND,
    title: { family: ARIAL, size: 40, weight: 400, color: "#000000", lh: 1.1 },
    subtitle: { family: ARIAL, size: 22, weight: 400, color: "#666666", lh: 1.1 },
    rule: { w: 1, color: "#D6D6D6" }, bottomRule: null,
    tracker: { family: ARIAL, size: 12, weight: 700, color: "#CC0000", ls: 1.5, caps: true, align: "left" },
    table: {
      family: ARIAL, ink: "#000000",
      head: { kind: "fill", fill: "#1F1F1F", ink: "#FFFFFF", sep: { w: .8, color: "#5A5A5A" }, rule: null },
      top: null, rowRule: { w: 1, color: "#E6E6E6" }, totalRule: { w: 2, color: "#CC0000" }, bottom: { w: 1, color: "#1F1F1F" },
      highlight: "#F5CCCC", strong: { fill: "#CC0000", ink: "#FFFFFF" },
    },
    note: { family: ARIAL, size: 18, lh: 1.25, ink: "#000000",
      h1: { family: ARIAL, size: 22, weight: 700, color: "#000000" }, h2: { family: ARIAL, size: 14, weight: 700, color: "#CC0000", caps: true, ls: 1.2 },
      bullet: "►", bulletColor: "#CC0000" },
    card: { fill: "#F7F7F7", bar: { w: 4, color: "#CC0000" }, padY: 14, padX: 16 },
    memo: { family: ARIAL, size: 13, weight: 400, color: "#666666", lh: 1.2, kicker: { fill: "#CC0000", ink: "#FFFFFF", size: 18, weight: 700 } },
    pageno: { family: ARIAL, size: 15, weight: 400, color: "#5C5C5C" },
    cover: {
      bg: "#FFFFFF", band: { y: 0, h: 520, fill: "#CC0000" }, bar: { x: 96, y: 250, w: 72, h: 4, fill: "#FFFFFF" },
      title: { family: ARIAL, size: 60, weight: 700, color: "#FFFFFF", lh: 1.1, x: 96, top: 270, w: 1200, maxLines: 3 },
      subtitle: { family: ARIAL, size: 28, weight: 400, color: "#FFFFFF", lh: 1.2 },
      date: { family: ARIAL, size: 16, weight: 700, color: "#666666", ls: 2, caps: true, x: 96, y: 580 },
      note: { family: ARIAL, size: 16, weight: 400, color: "#666666", lh: 1.3 },
    },
    index: {
      bg: "#FFFFFF", heading: { family: ARIAL, size: 40, weight: 400, color: "#000000", x: 96, y: 70 }, headingRule: { w: 2, color: "#CC0000" },
      entry: { family: ARIAL, size: 26, weight: 400, color: "#000000" }, number: { family: ARIAL, size: 20, weight: 700, color: "#FFFFFF", circle: "#CC0000", d: 36 },
      page: { family: ARIAL, size: 26, weight: 400, color: "#000000" }, leader: { w: 2, color: "#A4A4A3" }, pitch: 56, top: 190,
    },
    look: {
      topBand: null, ruleAccent: { w: 120, h: 4, color: "#CC0000" },
      chips: { r: 3, insetX: 3, insetY: 2, pos: { fill: "#E2F2E7", ink: "#1E8E3E" }, neg: { fill: "#FBE4E1", ink: "#D93025" }, other: { fill: "#F5E0E0", ink: "#1F1F1F" } },
      group: { w: 2, color: "#CC0000", inset: 6 }, totalBand: "#F3F3F3",
      card: { radius: 0, shadow: { dy: 6, blur: 18, spread: -10, c: [0, 0, 0], a: .16 } },
      cover: { arcs: null, stripes: { x0: 1040, x1: 1600, y0: 0, y1: 520, gap: 12, w: 1, color: "#FFFFFF", a: .1 } },
      numberRing: null,
      flat: {
        card: { fill: "#FFFFFF", border: { w: 1, color: "#E6E6E6" }, shadow: { dy: 12, blur: 32, spread: -14, c: [0, 0, 0], a: .14 } },
        head: { fill: "#1F1F1F", ink: "#FFFFFF" }, light: "#F5E6E6",
        tile: { fill: "#FBEAEA", bar: { w: 4, color: "#CC0000" }, ink: "#1A1A1A" },
        panel: "#F6F6F6", chip: { fill: "#FFFFFF", border: { w: 1, color: "#E6E6E6" } }, caps: CAPS,
        sep: { w: 1, color: "#EBEBEB" }, rule: { w: 2, color: "#CC0000" }, ink: "#1A1A1A",
      },
    },
    chart: {
      palette: ["#CC0000", "#333332", "#777776", "#A4A4A3", "#D6D6D6"], other: "#D6D6D6", highlightRest: "#A4A4A3",
      label: { family: ARIAL, size: 14, weight: 400, color: "#000000" }, legend: { kind: "line", w: 16, h: 2, pos: "top-right" },
      separator: { w: 1.5, color: "#FFFFFF" }, callout: { outline: { w: 2.5, color: "#CC0000" }, shape: "ellipse", deltaWeight: 700, numbered: true, shadow: false },
    },
  },
};

/** the spec with the deck's colours: an accent / ink / background / positive / negative of the user (Design… › Colours, or
    a theme chosen for this design) replaces the design's, and the colours derived from the accent follow it */
export function specOf(ctx: RenderCtx): DesignSpec {
  const d = ctx.style.design as ConsultDesign, S = SPECS[d] || SPECS.mckinsey, P = palette(ctx.style), a = P.accent.toUpperCase();
  const ink = P.ink.toUpperCase(), bg = P.bg.toUpperCase();
  if (a === S.accent && ink === S.ink && bg === S.bg && P.pos === S.pos && P.neg === S.neg) return S;
  const swap = (c: string) => c === S.accent ? a : c;
  const tints = a === S.accent ? S.tints : S.tints.map((_t, i) => mix(a, "#FFFFFF", S.tintMix[i] ?? .85));
  const tint = (c: string) => { const i = S.tints.indexOf(c); return i >= 0 ? tints[i] : c; };
  const inkOf = (c: string) => c === S.ink ? ink : c;
  return {
    ...S, accent: a, ink, bg, pos: P.pos, neg: P.neg, tints,
    title: { ...S.title, color: inkOf(S.title.color) }, subtitle: { ...S.subtitle, color: inkOf(S.subtitle.color) }, pageno: { ...S.pageno, color: inkOf(S.pageno.color) },
    rule: { ...S.rule, color: swap(S.rule.color) },
    tracker: { ...S.tracker, color: swap(S.tracker.color) },
    table: { ...S.table, ink: inkOf(S.table.ink), totalRule: { ...S.table.totalRule, color: swap(S.table.totalRule.color) }, head: { ...S.table.head, ink: inkOf(S.table.head.ink) }, highlight: tint(S.table.highlight), strong: { ...S.table.strong, fill: swap(S.table.strong.fill) } },
    note: { ...S.note, ink: inkOf(S.note.ink), h1: { ...S.note.h1, color: inkOf(S.note.h1.color) }, h2: { ...S.note.h2, color: swap(S.note.h2.color) }, bulletColor: swap(S.note.bulletColor) },
    card: { ...S.card, bar: { ...S.card.bar, color: swap(S.card.bar.color) } },
    memo: { ...S.memo, color: inkOf(S.memo.color), kicker: { ...S.memo.kicker, fill: swap(S.memo.kicker.fill) } },
    cover: { ...S.cover, band: S.cover.band && { ...S.cover.band, fill: swap(S.cover.band.fill) }, bar: { ...S.cover.bar, fill: swap(S.cover.bar.fill) }, date: { ...S.cover.date, color: tint(S.cover.date.color) } },
    index: { ...S.index, heading: { ...S.index.heading, color: inkOf(S.index.heading.color) }, entry: { ...S.index.entry, color: inkOf(S.index.entry.color) }, headingRule: S.index.headingRule && { ...S.index.headingRule, color: swap(S.index.headingRule.color) },
      number: { ...S.index.number, color: tint(S.index.number.color), circle: S.index.number.circle && swap(S.index.number.circle) }, page: { ...S.index.page, color: inkOf(tint(S.index.page.color)) } },
    look: { ...S.look,
      ruleAccent: S.look.ruleAccent && { ...S.look.ruleAccent, color: swap(S.look.ruleAccent.color) },
      chips: { ...S.look.chips, pos: { fill: mix(P.pos, "#FFFFFF", .86), ink: P.pos }, neg: { fill: mix(P.neg, "#FFFFFF", .86), ink: P.neg },
        other: { fill: a === S.accent ? S.look.chips.other.fill : mix(a, "#FFFFFF", .88), ink: inkOf(S.look.chips.other.ink) } },
      group: { ...S.look.group, color: swap(S.look.group.color) },
      totalBand: S.look.totalBand && (a === S.accent ? S.look.totalBand : S.id === "mckinsey" ? mix(a, "#FFFFFF", .93) : S.look.totalBand),
      cover: { ...S.look.cover, arcs: S.look.cover.arcs && { ...S.look.cover.arcs, color: swap(S.look.cover.arcs.color) } },
      numberRing: S.look.numberRing && { ...S.look.numberRing, color: tint(S.look.numberRing.color) },
      flat: flatOf(S, a, P.pos, P.neg) },
    chart: { ...S.chart, palette: S.chart.palette.map(c => tint(swap(c))), callout: { ...S.chart.callout, outline: { ...S.chart.callout.outline, color: swap(S.chart.callout.outline.color) } } },
  };
}
/** the flat materials with the deck's colours: the accent's tints and bars follow the accent, the capsules the positive /
    negative colours */
function flatOf(S: DesignSpec, a: string, pos: string, neg: string): FlatLook {
  const F = S.look.flat, own = a === S.accent, swap = (c: string) => c === S.accent ? a : c;
  const caps = pos === S.pos && neg === S.neg ? F.caps : { ...F.caps,
    pos: { fill: mix(pos, "#FFFFFF", .84), ink: mix(pos, "#000000", .2) }, neg: { fill: mix(neg, "#FFFFFF", .86), ink: mix(neg, "#000000", .2) }, solidPos: pos, solidNeg: neg };
  return { ...F, caps, light: own ? F.light : mix(a, "#FFFFFF", .9), tile: { ...F.tile, fill: own ? F.tile.fill : mix(a, "#FFFFFF", .91), bar: { ...F.tile.bar, color: swap(F.tile.bar.color) } },
    rule: { ...F.rule, color: swap(F.rule.color) } };
}
