/* Slide furniture → display list (S3.5): the whole slide as slideMarkup + slide.css draw it. The pixels and boxes
   against the goldens are tools/dlparity.mjs's job; these tests pin the rules with a deterministic measurer. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type DisplayList, type HitNode, type Node, type TextNode } from "../src/dl/types";
import { premulStops } from "../src/dl/geom";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, lu, measuredBuild, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout, memoPart, noteParts, slideMarkup } from "../src/render/slide";
import { breakRuns, wrapLines } from "../src/text/lines";
import { setPlatform, resetPlatform } from "../src/platform";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
/** advances of 0.5 em per character, ascent .8 em, descent .2 em; text boxes keep their size unless told */
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
  noteSize: (_n, start) => start,
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const hits = (l: DisplayList) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === "f");
const textsAfter = (l: DisplayList, cls: string) => { const all = flat(l), k = all.findIndex(n => n.t === "hit" && n.kind === "f" && n.id === cls); const out: TextNode[] = []; for (const n of all.slice(k + 1)) { if (n.t === "hit") break; if (n.t === "text" && !n.decorative) out.push(n); } return out; };

async function deck(file: string, design: Design) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = { ...resolveStyle({}, view.style), design };
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (i: number) => {
    const R = slides[i], boxes = computeLayout(R, ctx).boxes;
    const tables = R.tables.map(L => excelToDisplayList(L, ctx, M));
    return slideToDisplayList(R, i, ctx, tables, boxes, { wall: null, logo: { id: "logo", src: "logo.png", w: 400, h: 100 } }, M, "1 October 2026");
  };
  return { ctx, slides, build };
}
/** the classes of the elements slideMarkup writes that the parity tools pair with hits */
const markupClasses = (html: string) => [...html.matchAll(/class="([^"]+)"/g)].map(m => m[1])
  .filter(c => /^(title|subtitle|tnote|notebub|gls wb card notebub|pageno|gls wb chrome|logowrap|logo$|cv-|cvx-|ix-|tw$)/.test(c) && !/^(cv-orb|cv-tile)/.test(c));

describe("the whole slide", () => {
  for (const design of ["excel", "clean", "glass"] as Design[]) it(`${design}: every furniture element of slideMarkup has its hit, in the same order per class; the lists validate`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design);
    for (let i = 0; i < slides.length; i++) {
      const dl = build(i);
      expect(validate(dl.nodes)).toEqual([]);
      const html = slideMarkup(slides[i], i, ctx).html, want = markupClasses(html).filter(c => c !== "logo" || !!ctx.logoSrc);
      const got = hits(dl.nodes).map(h => h.id);
      for (const c of new Set(want)) expect(got.filter(g => g === c).length, `${design} slide ${i + 1}: ${c}`).toBe(want.filter(w => w === c).length);
    }
  });
  it("a logo file that cannot be read (no size): no bubble and no picture, as v3 hid it; the page number stays put", async () => {
    for (const design of ["glass", "excel"] as Design[]) {
      const { ctx, slides } = await deck("weekly-options.json", design);
      const R = slides[slides.length - 1], i = slides.length - 1, boxes = computeLayout(R, ctx).boxes, tables = R.tables.map(L => excelToDisplayList(L, ctx, M));
      const make = (w: number) => slideToDisplayList(R, i, ctx, tables, boxes, { wall: null, logo: { id: "logo", src: "logo.png", w, h: w ? 100 : 0 } }, M, "x").nodes;
      const ok = hits(make(400)).map(h => h.id), missing = hits(make(0));
      expect(ok.some(c => /logowrap|^logo$/.test(c)), design).toBe(true);
      expect(missing.some(h => /logowrap|^logo$/.test(h.id)), design).toBe(false);
      expect(flat(make(0)).some(n => n.t === "image" && n.id === "logo")).toBe(false);
      const pn = (l: DisplayList) => hits(l).filter(h => /pageno/.test(h.id)).map(h => [h.x, h.y]);
      expect(pn(make(0))).toEqual(pn(make(400)));
    }
  });
  it("a title too long for its box is cut with an ellipsis that fits; the hit keeps the whole text", async () => {
    const { ctx, slides, build } = await deck("weekly.json", "excel");
    slides[0].title = "A very long title ".repeat(10).trim();
    const t = textsAfter(build(0).nodes, "title")[0], h = hits(build(0).nodes).find(x => x.id === "title")!;
    expect(t.src.endsWith("…")).toBe(true);
    expect(t.w!).toBeLessThanOrEqual(1600 - 54 - 150);
    expect(h.label).toBe(slides[0].title);
    expect(h.h).toBeCloseTo(lu(1.4 * 44), 2);                        // the page's line-height 1.4 (body font: 13px/1.4)
    void ctx;
  });
  it("text boxes: padding, the page's fitted size, pre-wrap lines, the side's alignment and justification", async () => {
    const { ctx, slides } = await deck("weekly-options.json", "clean");
    const R = slides[2], parts = noteParts(R, 0, ctx), boxes = computeLayout(R, ctx).boxes;
    expect(parts.length).toBeGreaterThan(0);
    const asked: number[] = [];
    const m: Metrics = { ...M, noteSize: (n, start) => { asked.push(start); return start - 4; } };
    const dl = slideToDisplayList(R, 2, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, m, "x");
    expect(asked.length).toBeGreaterThan(0);
    const p = parts[0], ts = textsAfter(dl.nodes, p.cls);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[0].size).toBe((p.n.size || 18) - 4);
    const nb = boxes[0].notes[p.side]!, bub = p.cls.includes(" bub");
    expect(Math.min(...ts.map(t => t.x))).toBeGreaterThanOrEqual(nb.x + (bub ? 18 : 6) - .01);
  });
  it("a page number in the top-left corner moves the title and subtitle to 56 + its width + 22, in every design", async () => {
    for (const design of ["excel", "glass"] as Design[]) {
      const { ctx, slides, build } = await deck("weekly.json", design);
      ctx.style.pn = { ...ctx.style.pn, on: true, pos: "tl" };
      slides[0].subtitle = slides[0].subtitle || "A subtitle";
      const html = slideMarkup(slides[0], 0, ctx).html, left = +/class="title"[^>]*style="left:([\d.]+)px/.exec(html)![1];
      const hs = hits(build(0).nodes);
      expect(hs.find(h => h.id === "title")!.x).toBeCloseTo(left, 6);
      expect(hs.find(h => h.id === "subtitle")!.x).toBeCloseTo(left, 6);
    }
  });
  it("a cover without a subtitle: the subtitle is its min-height, 36 px, the block above it in place", async () => {
    const { slides, build } = await deck("weekly-options.json", "excel");
    const cover = slides.findIndex(S => S.type === "cover");
    slides[cover].subtitle = "";
    const sub = hits(build(cover).nodes).find(h => h.id === "cv-sub")!;
    expect(sub.h).toBe(36);
    expect(sub.y + sub.h).toBeCloseTo(730, 6);
  });
  it("a text box's line ends: spaces before a line break count for the alignment while they fit, beyond the box they hang", async () => {
    const { ctx, slides } = await deck("weekly-options.json", "clean");
    const R = slides[2], boxes = computeLayout(R, ctx).boxes, part = noteParts(R, 0, ctx)[0], nb = boxes[0].notes[part.side]!;
    const bub = part.cls.includes(" bub"), padX = bub ? 18 : 6, cw = nb.w - 2 * padX, size = part.n.size || 18, adv = size * .5;
    const run = (text: string) => {
      part.n.text = text; (R.cfg.notes as Record<string, { text: string }>)[part.key].text = text;
      part.n.align = "right"; (R.cfg.notes as Record<string, { align?: string }>)[part.key].align = "right";
      const dl = slideToDisplayList(R, 2, ctx, [], boxes, { wall: null, logo: null }, M, "x");
      return textsAfter(dl.nodes, noteParts(R, 0, ctx)[0].cls)[0];
    };
    const right = nb.x + nb.w - padX;
    expect(run("ab  \ncd").x).toBeCloseTo(right - 4 * adv, 6);                      // two set spaces: "ab" ends 2 spaces early
    const wide = run("ab" + " ".repeat(Math.ceil(cw / adv) + 4) + "\ncd");
    expect(wide.x).toBeCloseTo(right - cw, 6);                                     // more spaces than the box: "ab" at the start edge
  });
  it("the notes section sits at its box; the footer and page number in their corners", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "glass");
    const i = slides.findIndex((S, k) => memoPart(S, ctx) && k >= 0);
    if (i >= 0) { const mp = memoPart(slides[i], ctx)!, h = hits(build(i).nodes).find(x => x.id === mp.cls)!; expect([h.x, h.y, h.w, h.h]).toEqual([mp.box.x, mp.box.y, mp.box.w, mp.box.h]); }
    const pn = hits(build(slides.length - 1).nodes).filter(x => x.id.includes("pageno"));
    expect(pn.length).toBeGreaterThan(0);
  });
  it("text boxes are fitted by the page in batches (fitNotes), one round with the rest", async () => {
    const { ctx, slides } = await deck("weekly-options.json", "clean");
    const R = slides[2], boxes = computeLayout(R, ctx).boxes;
    let fits = 0;
    setPlatform({ text: { maxDigitWidth: () => 7, noteFits: () => true,
      measureRuns: async runs => runs.map(r => M.run(r.text, r.font)), breakLines: async reqs => reqs.map(q => [q.text]),
      fitNotes: async reqs => { fits++; return reqs.map(r => r.start - 2); } } });
    try {
      const dl = await measuredBuild(m => slideToDisplayList(R, 2, ctx, [], boxes, { wall: null, logo: null }, m, "x"));
      expect(fits).toBe(1);
      const p = noteParts(R, 0, ctx)[0];
      expect(textsAfter(dl.nodes, p.cls)[0].size).toBe((p.n.size || 18) - 2);
    } finally { resetPlatform(); }
  });
});

describe("text and paint rules found against Chromium (S3.5)", () => {
  it("pre-wrap: line breaks end lines, an empty line is a line, a paragraph keeps its leading spaces", () => {
    const ls = breakRuns([{ text: "  ab cd\n\nef" }], 100, t => t.length, { pre: true }).map(l => l.map(p => p.text).join(""));
    expect(ls).toEqual(["  ab cd", "", "ef"]);
    expect(breakRuns([{ text: "aaa bbb" }], 4, t => t.length, { pre: true }).map(l => l.map(p => p.text).join(""))).toEqual(["aaa", "bbb"]);
  });
  it("hyphens break as Chromium breaks them (probed in Chromium 153, monospace)", () => {
    const w = (t: string, n: number) => wrapLines(t, n, s => s.length);
    expect(w("Period 2020-2021", 12)).toEqual(["Period 2020-", "2021"]);
    expect(w("Loans x-1234", 8)).toEqual(["Loans x-", "1234"]);
    expect(w("ab (-abcd", 5)).toEqual(["ab (-", "abcd"]);
    expect(w("ab (-78", 5)).toEqual(["ab", "(-78"]);                               // a minus sign before digits stays
    expect(w("rate -0.5%", 6)).toEqual(["rate", "-0.5%"]);
    expect(w("well-known", 5)).toEqual(["well-", "known"]);
    expect(w("ab -abcd", 5)).toEqual(["ab -", "abcd"]);                            // a word-initial hyphen breaks too
  });
  it("pre-wrap: the spaces before a line break are set (they count for the alignment), a soft wrap's hang", () => {
    const ls = breakRuns([{ text: "ab   \ncd ef" }], 4, t => t.length, { pre: true }).map(l => l.map(p => p.text).join(""));
    expect(ls).toEqual(["ab   ", "cd", "ef"]);
  });
  it("line heights in Chromium's 1/64 px units", () => {
    expect(lu(1.28 * 13.33)).toBe(1091 / 64);
    expect(lu(19.2)).toBe(19.1875);
    expect(lu(21.76)).toBe(21.75);
  });
  it("gradient stops mixed premultiplied, as CSS: white into a translucent tint stays white", () => {
    const st = premulStops([{ o: 0, c: [255, 255, 255], a: .6 }, { o: 1, c: [0, 0, 255], a: .1 }]);
    expect(st.length).toBe(17);
    const mid = st[8];
    expect(mid.a).toBeCloseTo(.35, 6);
    expect(mid.c[0]).toBeCloseTo((255 * .6 * .5) / .35, 6);           // premultiplied: (c0·a0 + c1·a1)/2 ÷ a
    expect(premulStops([{ o: 0, c: [1, 2, 3], a: .5 }, { o: 1, c: [1, 2, 3], a: 1 }]).length).toBe(2);  // same colour: nothing to add
  });
});
