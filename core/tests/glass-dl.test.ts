/* Liquid Glass → display list (S3.4): the same plan as renderGlass, drawn with 03 §4.3's recipes. The pixels and
   boxes against the goldens are tools/dlparity.mjs's job; these tests pin the plan's translation, the CSS values
   and the text rules with a deterministic measurer. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type DisplayList, type GroupNode, type HitNode, type ImageNode, type Node, type TextNode } from "../src/dl/types";
import { charPositions } from "../src/dl/geom";
import { toSvg } from "../src/dl/svg";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { glassLevel, resolveStyle } from "../src/model/style";
import { measuredBuild, type Metrics } from "../src/render/excel-dl";
import { cssLinear, glassText, glassToDisplayList, material } from "../src/render/glass-dl";
import { glassPlan, renderGlass, type GText } from "../src/render/glass";
import { setPlatform, resetPlatform } from "../src/platform";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Op } from "../src/model/types";
import type { Workbook } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/** advances of 0.5 em per character (tabular: 0.6 em per digit), ascent .8 em, descent .2 em */
const M: Metrics = {
  run: (t, font, tnum) => {
    const size = parseFloat(/([\d.]+)px/.exec(font)![1]), adv = [...t].map(ch => size * (tnum && /\d/.test(ch) ? .6 : .5));
    return { w: adv.reduce((s, a) => s + a, 0), asc: size * .8, desc: size * .2, ...(tnum ? { adv } : {}) };
  },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");
const hits = (l: DisplayList, kind: string) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === kind);

async function deckCtx(file: string): Promise<{ wb: Workbook; ctx: RenderCtx }> {
  const deck = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, deck.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), deck.ops).doc;
  const style = { ...resolveStyle({}, view.style), design: "glass" as const };
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", "glass");
  return { wb, ctx: { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null } };
}

describe("Liquid Glass: the display list draws renderGlass's plan", () => {
  const decks = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort();
  for (const f of decks) it(f + ": every material, text, text box and picture of the HTML, at its box", async () => {
    const { ctx } = await deckCtx(f);
    for (const R of ctx.slides) for (const L of R.tables) {
      const html = renderGlass(L, ctx), plan = glassPlan(L, ctx);
      const dl = glassToDisplayList(L, ctx, { x: 100, y: 80, scale: 1 }, { blurId: "wb", blurSrc: "data:image/jpeg;base64," }, M);
      expect(validate(dl.nodes)).toEqual([]);
      // the .wb materials of the HTML, in its order, with its rounded boxes
      const box = /class="gls wb ([^"]*)" style="left:([-\d.]+)px;top:([-\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/g;
      const fromHtml = [...html.matchAll(box)].map(m => [m[1], +m[2], +m[3], +m[4], +m[5]]);
      const icons = [...html.matchAll(/class="gls wb icon" style="left:([-\d.e]+)px;top:([-\d.e]+)px;width:([\d.e]+)px/g)];
      const wb = hits(dl.nodes, "wb");
      expect(wb.length).toBe(fromHtml.length + icons.length);
      expect(wb.filter(h => h.id !== "icon").map(h => [h.id, h.x, h.y, h.w, h.h])).toEqual(fromHtml);
      // a text for every cell text, with the cell's text
      expect(hits(dl.nodes, "t").map(h => h.label)).toEqual(plan.texts.map(t => String(t.it.text).replace(/[ \t\n\r\f]+/g, " ").trim()));
      expect(hits(dl.nodes, "tbox").length).toBe(plan.tbx.filter(e => e.k === "tbox").length);
      expect(hits(dl.nodes, "pic").length).toBe(plan.pics.filter(p => p.k === "pic").length);
      // every material samples the blurred wallpaper
      expect(flat(dl.nodes).filter((n): n is ImageNode => n.t === "image" && n.id === "wb").length).toBe(wb.length);
    }
  });
});

describe("Liquid Glass recipes", () => {
  it("CSS linear-gradient angles as the display list's unit-box gradient line", () => {
    expect(cssLinear(180, 100, 40).map(v => +v.toFixed(6) + 0)).toEqual([.5, 0, .5, 1]);
    expect(cssLinear(90, 100, 40).map(v => +v.toFixed(6))).toEqual([0, .5, 1, .5]);
    // 135°: the line reaches the corners (CSS Images 3)
    const [x0, y0, x1, y1] = cssLinear(135, 100, 100);
    expect([x0, y0, x1, y1].map(v => +v.toFixed(6) + 0)).toEqual([0, 0, 1, 1]);
  });
  it("materials follow --gi: deeper shadows and stronger rims with the glass level", () => {
    const sub = material("gls wb card list", 0), strong = material("gls wb card list", 1);
    expect(sub.shadows.length).toBe(6);
    expect(strong.shadows[0].a).toBeCloseTo(.36, 6);
    expect(sub.shadows[0].a).toBeCloseTo(.14, 6);
    expect(material("gls wb card tile", 1).rim).toBe(2);
    expect(material("gls wb chip tinted", .5).shadows.some(s => s.inset)).toBe(true);
  });
  it("the blurred wallpaper at placeGlass's lens: magnified about the material's centre, positioned on the slide", async () => {
    const { ctx } = await deckCtx("weekly-looks.json");          // glass: medium
    const L = ctx.slides[0].tables[0], place = { x: 120, y: 90, scale: .8 };
    const dl = glassToDisplayList(L, ctx, place, { blurId: "wb", blurSrc: "data:," }, M);
    const first = hits(dl.nodes, "wb")[0], img = flat(dl.nodes).find((n): n is ImageNode => n.t === "image" && n.id === "wb")!;
    const gi = glassLevel(ctx.style), LENS = 1 + .06 * gi, sc = place.scale;
    const ex = place.x + first.x * sc, ey = place.y + first.y * sc, cx = ex + first.w * sc / 2, cy = ey + first.h * sc / 2;
    expect(img.w).toBeCloseTo(1600 * LENS / sc, 2);
    expect(img.h).toBeCloseTo(900 * LENS / sc, 2);
    expect(img.x - first.x).toBeCloseTo(-(ex + (LENS - 1) * cx) / sc, 2);
    expect(img.y - first.y).toBeCloseTo(-(ey + (LENS - 1) * cy) / sc, 2);
  });
});

describe("Liquid Glass cell texts", () => {
  const base: GText = { k: "text", it: { b: { r: 1, c: 1 }, text: "", bh: 20, wrap: false, rot: 0, ov: false } as any, cls: "t", x: 0, y: 0, w: 100, h: 20, size: 14, ink: "#1D1D1F", weight: 520,
    single: true, align: "right", valign: "center", italic: false, num: false, shadow: false };
  const T = (o: Omit<Partial<GText>, "it"> & { it?: Record<string, unknown> }) => texts(glassText({ ...base, ...o, it: { ...base.it, ...(o.it || {}) } }, M));
  it("letter-spacing −.12 px after every character, in every advance", () => {
    const [n] = T({ it: { text: "abcd" }, align: "left" });
    expect(n.w).toBeCloseTo(4 * 7 - 3 * .12, 6);
    expect(n.x).toBeCloseTo(3, 6);
    const [r] = T({ it: { text: "abcd" }, align: "right" });
    expect(r.x).toBeCloseTo(100 - 3 - (4 * 7 - 4 * .12), 6);   // the trailing spacing counts in the line's width
  });
  it("numbers in tabular figures: measured so, each character's advance kept for the backends", () => {
    const [n] = T({ it: { text: "1.234" }, num: true });
    expect(n.tnum).toBe(true);
    expect(n.adv!.map(a => +a.toFixed(2))).toEqual([8.4 - .12, 7 - .12, 8.4 - .12, 8.4 - .12, 8.4 - .12].map(a => +a.toFixed(2)));
    expect(charPositions(n)!.length).toBe(5);
    expect(toSvg([n], { imageHref: () => undefined })).toContain("font-variant-numeric:tabular-nums");
  });
  it("a single line wider than its box starts at the start edge (CSS Text 3), whatever the alignment", () => {
    const [n] = T({ it: { text: "a very long label that overflows" }, align: "right" });
    expect(n.x).toBeCloseTo(3, 6);
  });
  it("superscripts as in the Excel designs: small, raised, on the same line", () => {
    const [a, s] = T({ it: { text: "Loans(1)", scripts: [[5, 8, "sup"]] }, align: "left" });
    expect(s.src).toBe("(1)");
    expect(s.size).toBeCloseTo(14 * .62, 2);
    expect(a.y - s.y).toBeCloseTo(.55 * s.size, 1);
  });
  it("rotation 255 stacks the letters, each the font's line height plus the spacing apart, centred in the content box", () => {
    // ascent .9 em + descent .3 em: a slot of 1.2 em (vertical-rl upright, as Chromium lays it out)
    const tall: Metrics = { ...M, run: (t, font, tnum) => { const r = M.run(t, font, tnum), sz = parseFloat(/([\d.]+)px/.exec(font)![1]); return { ...r, asc: sz * .9, desc: sz * .3 }; } };
    const ns = texts(glassText({ ...base, it: { ...base.it, text: "ABC", rot: 255, bh: 80 }, h: 80, padL: 10 }, tall));
    expect(ns.map(n => n.src)).toEqual(["A", "B", "C"]);
    const step = 1.2 * 14 - .12;
    expect(ns[1].y - ns[0].y).toBeCloseTo(step, 6);
    expect(ns[0].y).toBeCloseTo(40 - 3 * step / 2 + .9 * 14, 6);
    expect(ns[0].x + 7 / 2).toBeCloseTo(10 + (100 - 10 - 3) / 2, 6);
  });
  it("painting order: text boxes' cards under the cell texts, their bodies above (z-index 3 in .xt)", async () => {
    const { ctx } = await deckCtx("edge-pictures.json");
    for (const L of ctx.slides.flatMap(R => R.tables)) {
      const plan = glassPlan(L, ctx), shells = plan.tbx.filter(e => e.k === "shell").length;
      if (!shells || !plan.texts.length) continue;
      const list = flat(glassToDisplayList(L, ctx, { x: 0, y: 0, scale: 1 }, null, M).nodes);
      const wb = list.map((n, k) => n.t === "hit" && n.kind === "wb" ? k : -1).filter(k => k >= 0);
      const firstText = list.findIndex(n => n.t === "hit" && n.kind === "t"), firstBox = list.findIndex(n => n.t === "hit" && n.kind === "tbox");
      expect(wb[wb.length - 1]).toBeLessThan(firstText);
      expect(firstBox).toBeGreaterThan(firstText);
      return;
    }
    throw new Error("no table with a text box card and cell texts in edge-pictures");
  });
  it("a strong capsule's text shadow is a decorative copy 1 px below", () => {
    const [sh, n] = T({ it: { text: "+12" }, shadow: true });
    expect(sh.decorative).toBe(true);
    expect(sh.y - n.y).toBeCloseTo(1, 6);
  });
  it("tabular runs are asked of the page as such", async () => {
    const asked: { text: string; tnum?: boolean }[] = [];
    setPlatform({ text: { maxDigitWidth: () => 7, noteFits: () => true,
      measureRuns: async runs => { asked.push(...runs); return runs.map(r => M.run(r.text, r.font, r.tnum)); },
      breakLines: async reqs => reqs.map(q => [q.text]) } });
    try {
      const out = await measuredBuild(m => glassText({ ...base, it: { ...base.it, text: "42" }, num: true }, m));
      expect(asked.some(r => r.text === "42" && r.tnum)).toBe(true);
      expect(texts(out)[0].adv).toHaveLength(2);
    } finally { resetPlatform(); }
  });
  it("the group clips at the cell unless it may run over", () => {
    const g = glassText({ ...base, it: { ...base.it, text: "x" } }, M).find(n => n.t === "group") as GroupNode;
    expect(g.clip).toEqual({ x: 0, y: 0, w: 100, h: 20 });
    expect(glassText({ ...base, it: { ...base.it, text: "x", ov: true } }, M).some(n => n.t === "group")).toBe(false);
  });
});
