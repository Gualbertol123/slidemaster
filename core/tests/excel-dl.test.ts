/* Excel and Excel Refined → display list (S3.3): v3's markup rules (renderExcel + slide.css) as nodes. The pixels and
   boxes against the goldens are tools/dlparity.mjs's job; these tests pin the rules with a deterministic measurer. */
import { describe, expect, it } from "vitest";
import { parseColor } from "../src/dl/color";
import { validate, type DisplayList, type GroupNode, type HitNode, type LineNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { resolveStyle } from "../src/model/style";
import type { RenderCtx } from "../src/render/context";
import { borderDash, BORDER_W, cssFont, lu, excelToDisplayList, measuredBuild, primaryFamily, roughMetrics, type Metrics } from "../src/render/excel-dl";
import { setPlatform, resetPlatform } from "../src/platform";
import { breakRuns, collapse, wrapLines } from "../src/text/lines";

/** advances of 0.5 em per character, ascent .8 em, descent .2 em; wraps by those widths */
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const ctx = (st = {}): RenderCtx => ({ style: resolveStyle(st), edits: {}, slides: [], preset: null, workbook: "w", logoSrc: "" });
function item(o: Record<string, unknown>) {
  return { b: { r: 2, c: 2, r2: 2, c2: 2, src: { r: 2, c: 2 } }, bx: 0, by: 0, bw: 100, bh: 20, text: "", isText: true, fill: null, baseFill: null, color: "#000000",
    font: { name: "Calibri", sz: 11 }, align: "left", valign: "bottom", wrap: false, indent: 0, rot: 0, ctype: "s", ...o };
}
function layout(items: Record<string, unknown>[], more: Record<string, unknown> = {}) {
  const L: any = { id: "t", def: { id: "t" }, rows: [2], cols: [2], items: items.map(item), colX: new Map([[2, 0]]), colW: new Map([[2, 100]]), rowY: new Map([[2, 0]]), rowH: new Map([[2, 20]]),
    W: 300, H: 200, g: { r1: 2, c1: 2, r2: 2, c2: 2 }, pics: [], rects: [], texts: [], sheet: { name: "S", get: () => null }, ...more };
  L.items.forEach((it: any) => it.L = L);
  return L;
}
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");

describe("cell text: the .t flex box of v3", () => {
  const size = +(11 * 96 / 72).toFixed(2), lh = lu(1.15 * size), lead = Math.floor((lh - size) / 2);   // Chromium floors the half-leading
  it("left, bottom: padding 3 px, 1 px at the bottom, baseline from the line box", () => {
    const { nodes } = excelToDisplayList(layout([{ text: "Loans" }]), ctx(), M);
    const [t] = texts(nodes);
    expect(t.x).toBe(3);
    expect(t.y).toBeCloseTo(20 - 1 - lh + lead + .8 * size, 2);
    expect([t.size, t.font, t.css, t.w]).toEqual([size, "Calibri", expect.stringContaining("'Calibri'"), 5 * size * .5]);
    expect(validate(nodes)).toEqual([]);
  });
  it("right / centre: the run's end at the box's end, or centred; top / centre vertically", () => {
    const w = 4 * size * .5;
    const [r] = texts(excelToDisplayList(layout([{ text: "1234", align: "right", valign: "top" }]), ctx(), M).nodes);
    expect(r.x).toBeCloseTo(100 - 3 - w, 2); expect(r.y).toBeCloseTo(lead + .8 * size, 2);
    const [c] = texts(excelToDisplayList(layout([{ text: "1234", align: "center", valign: "center" }]), ctx(), M).nodes);
    expect(c.x).toBeCloseTo(3 + (94 - w) / 2, 2); expect(c.y).toBeCloseTo((20 - lh) / 2 + lead + .8 * size, 2);
  });
  it("indent: 3 + 9 px per level on the aligned side", () => {
    expect(texts(excelToDisplayList(layout([{ text: "a", indent: 2 }]), ctx(), M).nodes)[0].x).toBe(21);
    const [r] = texts(excelToDisplayList(layout([{ text: "a", indent: 1, align: "right" }]), ctx(), M).nodes);
    expect(r.x).toBeCloseTo(100 - 12 - size * .5, 2);
  });
  it("overflow: clipped at the cell unless it may run over (ov), right-aligned text overflows to the left", () => {
    const long = "a long text that does not fit the cell";
    const clipped = excelToDisplayList(layout([{ text: long }]), ctx(), M).nodes;
    const g = clipped.find(n => n.t === "group") as GroupNode;
    expect(g.clip).toEqual({ x: 0, y: 0, w: 100, h: 20 });
    expect(excelToDisplayList(layout([{ text: long, ov: true }]), ctx(), M).nodes.some(n => n.t === "group")).toBe(false);
    const [r] = texts(excelToDisplayList(layout([{ text: long, align: "right" }]), ctx(), M).nodes);
    expect(r.x).toBeLessThan(0);                                       // flex-end: the start overflows
    // with a superscript the text is one block <span> of max-width 100 %: it overflows to the right instead
    const [s0] = texts(excelToDisplayList(layout([{ text: long + "(1)", scripts: [[long.length, long.length + 3, "sup"]], align: "right" }]), ctx(), M).nodes);
    expect(s0.x).toBeCloseTo(3, 6);
    // …unless the cell may overflow (.ov span{max-width:none}): a centred one then overflows both ways, as without it
    const head = "a long centred header text";
    const [c0] = texts(excelToDisplayList(layout([{ text: head, align: "center", ov: true }]), ctx(), M).nodes);
    const [c1] = texts(excelToDisplayList(layout([{ text: head + "(1)", scripts: [[head.length, head.length + 3, "sup"]], align: "center", ov: true }]), ctx(), M).nodes);
    expect(c0.x).toBeLessThan(0);
    expect(c1.x).toBeLessThan(0);
  });
  it("wrap: lines of 1.15 em, text-align inside the item; one line when it fits", () => {
    const { nodes } = excelToDisplayList(layout([{ text: "Eom Budget totals", wrap: true, bw: 60, bh: 60, align: "center" }]), ctx(), M);
    const ts = texts(nodes);
    expect(ts.length).toBeGreaterThan(1);
    expect(ts[1].y - ts[0].y).toBeCloseTo(lh, 1);                    // coordinates are kept to 0.01 px
    for (const t of ts) expect(t.x + t.w! / 2).toBeCloseTo(3 + 54 / 2, 1);          // each line centred
    expect(texts(excelToDisplayList(layout([{ text: "Eom", wrap: true, bw: 60 }]), ctx(), M).nodes)).toHaveLength(1);
  });
  it("spaces collapse as CSS does; the hit carries the cell's text", () => {
    const { nodes } = excelToDisplayList(layout([{ text: "  two   spaces\nand a break " }]), ctx(), M);
    expect(texts(nodes)[0].src).toBe("two spaces and a break");
    expect((nodes.find(n => n.t === "hit") as HitNode)).toMatchObject({ kind: "t", id: "2,2", label: "two spaces and a break", x: 0, y: 0, w: 100, h: 20 });
  });
  it("superscript and subscript parts: .62 em, raised .55 em / lowered .25 em", () => {
    const [a, sup, b] = texts(excelToDisplayList(layout([{ text: "Loans(1) x", scripts: [[5, 8, "sup"]] }]), ctx(), M).nodes);
    expect([a.src, sup.src, b.src]).toEqual(["Loans", "(1)", " x"]);
    expect(sup.size).toBeCloseTo(size * .62, 2);
    expect(a.y - sup.y).toBeCloseTo(.55 * sup.size, 1);                // em of the sup element itself (CSS)
    expect(sup.x).toBeCloseTo(a.x + a.w!, 1);
    const [, sub] = texts(excelToDisplayList(layout([{ text: "H2O", scripts: [[1, 2, "sub"]] }]), ctx(), M).nodes);
    expect(sub.y - texts(excelToDisplayList(layout([{ text: "H2O" }]), ctx(), M).nodes)[0].y).toBeCloseTo(.25 * sub.size, 1);
    // wrapped over several lines: the superscript stays small and raised on its line
    const w = texts(excelToDisplayList(layout([{ text: "Total loans of the banks(1)", scripts: [[24, 27, "sup"]], wrap: true, bw: 70, bh: 80 }]), ctx(), M).nodes);
    const s1 = w.find(t => t.src === "(1)")!;
    expect(s1.size).toBeCloseTo(size * .62, 2);
    expect(w.filter(t => t.y > w[0].y + 1).length).toBeGreaterThan(0);
  });
  it("bold, italic, underline, strike, colour, a user font", () => {
    const [t] = texts(excelToDisplayList(layout([{ text: "x", font: { name: "Calibri", sz: 11, b: true, i: true, u: true, s: true }, color: "#FF0000" }]), ctx(), M).nodes);
    expect(t).toMatchObject({ b: true, i: true, decoration: { underline: true, strike: true }, fill: { solid: [255, 0, 0] } });
    const [u] = texts(excelToDisplayList(layout([{ text: "x", userFont: "Georgia" }]), ctx(), M).nodes);
    expect(u.font).toBe("Georgia");
  });
  it("rotation: a run centred in the cell and turned about the centre; 255 stacks the letters", () => {
    const g = excelToDisplayList(layout([{ text: "Week", rot: 90, bw: 20, bh: 80 }]), ctx(), M).nodes.find(n => n.t === "group") as GroupNode;
    expect(g.transform!.map(v => Math.round(v * 1000) / 1000)).toEqual([0, -1, 1, 0, 10, 39.5]);      // the content box: 1 px bottom padding
    const ind = excelToDisplayList(layout([{ text: "W", rot: 45, bw: 40, bh: 40, indent: 1, valign: "top", font: { name: "Calibri", sz: 11, u: true } }]), ctx(), M).nodes.find(n => n.t === "group") as GroupNode;
    expect(ind.transform![4]).toBeCloseTo(12 + (40 - 12 - 3) / 2, 6);                 // centred between the paddings
    expect((ind.children[0] as TextNode).decoration).toEqual({ underline: true });
    const st = texts(excelToDisplayList(layout([{ text: "AB", rot: 255, bw: 20, bh: 80 }]), ctx(), M).nodes);
    expect(st.map(t => t.src)).toEqual(["A", "B"]);
    expect(st[1].y - st[0].y).toBeCloseTo(size, 1);
    // vertical-rl upright: a letter's slot is the font's line height (ascent + descent), not one em
    const tall: Metrics = { ...M, run: (t, font) => { const r = M.run(t, font), sz = parseFloat(/([\d.]+)px/.exec(font)![1]); return { ...r, asc: sz * .9, desc: sz * .3 }; } };
    const st2 = texts(excelToDisplayList(layout([{ text: "ABC", rot: 255, bw: 20, bh: 80, valign: "top" }]), ctx(), tall).nodes);
    expect(st2[1].y - st2[0].y).toBeCloseTo(1.2 * size, 1);                        // (positions rounded to .01)
    expect(st2[0].y).toBeCloseTo(80 / 2 - 3 * 1.2 * size / 2 + .9 * size, 1);
  });
  it("no text with noText (thumbnails of big tables)", () => {
    expect(texts(excelToDisplayList(layout([{ text: "x", fill: "#FFFF00" }]), ctx(), M, { noText: true }).nodes)).toEqual([]);
  });
});

describe("fills and borders: the .b boxes", () => {
  it("a fill is the cell box; borders lie inside it, along each side", () => {
    const { nodes } = excelToDisplayList(layout([{ fill: "#1F4E79", top: { style: "thin", color: "#000" }, bottom: { style: "medium", color: "#FF0000" }, left: { style: "thick", color: "#000" } }]), ctx(), M);
    expect(nodes[0]).toEqual({ t: "rect", x: 0, y: 0, w: 100, h: 20, fill: { solid: [31, 78, 121] } });
    const lines = nodes.filter((n): n is LineNode => n.t === "line");
    expect(lines.map(l => [l.x1, l.y1, l.x2, l.y2, l.stroke.w])).toEqual([[0, .5, 100, .5, 1], [1.5, 0, 1.5, 20, 3], [0, 19, 100, 19, 2]]);
  });
  it("widths and dashes per style; double = two lines", () => {
    expect([BORDER_W.hair, BORDER_W.thin, BORDER_W.medium, BORDER_W.thick]).toEqual([.5, 1, 2, 3]);
    expect(borderDash("dotted", 1)).toEqual([1, 1]);
    expect(borderDash("dashed", 1)).toEqual([3, 3]);
    expect(borderDash("dashDot", 2)).toEqual([6, 2, 2, 2]);
    expect(borderDash("slantDashDot", 2)).toEqual([6, 2, 2, 2]);
    expect(borderDash("thin", 1)).toBeNull();
    const d = excelToDisplayList(layout([{ top: { style: "double", color: "#000" } }]), ctx(), M).nodes.filter(n => n.t === "line") as LineNode[];
    expect(d.map(l => [l.y1, l.stroke.w])).toEqual([[.5, 1], [2.5, 1]]);
    const h = excelToDisplayList(layout([{ left: { style: "hair", color: "#000" } }]), ctx(), M).nodes.find(n => n.t === "line") as LineNode;
    expect([h.x1, h.stroke.w]).toEqual([.25, .5]);
  });
});

describe("shapes, text boxes, pictures", () => {
  it("a shape's border is inside its box; rounded by the deck's radius; ellipses; rotation about the centre", () => {
    const L = layout([], { rects: [{ x: 10, y: 10, w: 100, h: 50, rot: 0, flipH: false, flipV: false, name: "r", fill: "#FFC000", line: { w: 2, color: "#000" }, round: true }, { x: 0, y: 0, w: 40, h: 20, rot: 90, flipH: false, flipV: false, name: "e", fill: "#0F0", line: null, round: false, ellipse: true }] });
    const nodes = excelToDisplayList(L, ctx(), M).nodes, rr = Math.round(8 * resolveStyle({}).radius / 100);
    expect(nodes[0]).toMatchObject({ t: "rect", x: 10, y: 10, w: 100, h: 50, r: rr, fill: { solid: [255, 192, 0] } });
    expect(nodes[1]).toMatchObject({ t: "rect", x: 11, y: 11, w: 98, h: 48, stroke: { w: 2 } });
    const g = nodes[2] as GroupNode;
    expect(g.transform!.map(v => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0, 30, -10]);
    expect(g.children[0].t).toBe("path");
  });
  it("a text box: padding 4 / 8 px, paragraphs of runs, anchored, clipped", () => {
    const L = layout([], { texts: [{ x: 0, y: 0, w: 216, h: 100, rot: 0, flipH: false, flipV: false, name: "tb", fill: "#FFFFFF", line: { w: 1, color: "#000" }, round: false, anchorV: "ctr",
      paras: [{ align: "center", sz: null, runs: [{ text: "Total ", sz: null, b: true, i: false, color: null }, { text: "loans", sz: 18, b: false, i: true, color: "#FF0000" }] }, { align: "left", sz: null, runs: [] }] }] });
    const nodes = excelToDisplayList(L, ctx(), M).nodes, ts = texts(nodes);
    expect(ts.map(t => [t.src, t.b ?? false, t.i ?? false])).toEqual([["Total", true, false], ["loans", false, true]]);
    expect(ts[1].size).toBe(24);
    expect(ts[1].fill).toEqual({ solid: [255, 0, 0] });
    const hit = nodes.find(n => n.t === "hit") as HitNode;
    expect(hit.label).toBe("Total loans");
    expect((nodes.find(n => n.t === "group") as GroupNode).clip).toEqual({ x: 1, y: 1, w: 214, h: 98 });   // the padding box (1 px border)
    expect(Math.min(...ts.map(t => t.x))).toBeGreaterThan(1 + 8 - .01);
  });
  it("text box lines: a word never splits between its runs, spaces collapse across runs, empty paragraphs", () => {
    const tb = (paras: any[], w = 216) => ({ x: 0, y: 0, w, h: 200, rot: 0, flipH: false, flipV: false, name: "t", fill: null, line: null, round: false, anchorV: "t", paras });
    const run = (text: string, extra = {}) => ({ text, sz: null, b: false, i: false, color: null, ...extra });
    // "Hel" + "lo world": breaks only at the space, so "Hel" and "lo" stay on one line
    const ts = texts(excelToDisplayList(layout([], { texts: [tb([{ align: "left", sz: null, runs: [run("aaaa Hel"), run("lo world")] }], 16 + 7 * 7.335)] }), ctx(), M).nodes);
    const hel = ts.find(t => t.src === "Hel")!, lo = ts.find(t => t.src.startsWith("lo"))!;
    expect(lo.y).toBe(hel.y);
    // two spaces across runs are one
    const two = texts(excelToDisplayList(layout([], { texts: [tb([{ align: "left", sz: null, runs: [run("a "), run(" b")] }])] }), ctx(), M).nodes);
    expect(two[1].x - two[0].x).toBeCloseTo(2 * 7.335, 2);
    // a paragraph without runs is one line (&nbsp;), one whose runs are empty is none
    const lines = (paras: any[]) => texts(excelToDisplayList(layout([], { texts: [tb(paras)] }), ctx(), M).nodes).map(t => t.y);
    const [y1, y2] = lines([{ align: "left", sz: null, runs: [run("x")] }, { align: "left", sz: null, runs: [] }, { align: "left", sz: null, runs: [run("y")] }]);
    const [z1, z2] = lines([{ align: "left", sz: null, runs: [run("x")] }, { align: "left", sz: null, runs: [run("")] }, { align: "left", sz: null, runs: [run("y")] }]);
    expect(y2 - y1).toBeCloseTo(2 * 1.25 * 14.67, 0);
    expect(z2 - z1).toBeCloseTo(1.25 * 14.67, 0);
    // a larger run makes its line taller
    const big = lines([{ align: "left", sz: null, runs: [run("x"), run("Y", { sz: 24 })] }, { align: "left", sz: null, runs: [run("z")] }]);
    expect(big[2] - big[0]).toBeGreaterThan(1.25 * 14.67 + 4);          // the 32 px run: 10.4 below its baseline + the next line's 12.74
  });
  it("pictures by content id, with crop and rotation; a missing one is a placeholder on screen only", () => {
    const pic = { x: 5, y: 5, w: 50, h: 40, rot: 15, flipH: true, flipV: false, name: "Logo", src: "data:image/png;base64,AAAA", crop: { l: .1, t: 0, r: 0, b: .2 } };
    const { nodes, images } = excelToDisplayList(layout([], { pics: [pic, { ...pic, src: null, name: "Chart 1", unsupported: "Chart" }] }), ctx(), M);
    const img = nodes.find(n => n.t === "image")!;
    expect(img).toMatchObject({ x: 5, y: 5, w: 50, h: 40, rotation: 15, flipH: true, crop: { l: .1, t: 0, r: 0, b: .2 } });
    expect(images[(img as { id: string }).id]).toBe(pic.src);
    expect(texts(nodes).map(t => t.src)).toEqual(["Chart"]);
    const exp = excelToDisplayList(layout([], { pics: [{ ...pic, src: null, unsupported: "Chart" }] }), { ...ctx(), forExport: true }, M).nodes;
    expect(flat(exp).filter(n => n.t !== "hit" && n.t !== "group")).toEqual([]);
  });
});

describe("measuring", () => {
  it("one batch per round from the platform; without a measurer, a rough estimate", async () => {
    const calls: string[] = [];
    setPlatform({ text: { maxDigitWidth: () => 7,
      measureRuns: async runs => { calls.push("runs " + runs.length); return runs.map(r => M.run(r.text, r.font)); },
      breakLines: async reqs => { calls.push("lines " + reqs.length); return reqs.map(q => M.lines(q.text, q.font, q.width)); } } });
    try {
      const L = layout([{ text: "a b c d e f g h i j k l", wrap: true, bw: 40, bh: 100 }, { text: "x" }]);
      const dl = await measuredBuild(m => excelToDisplayList(L, ctx(), m));
      expect(texts(dl.nodes).map(t => t.src)).toEqual(texts(excelToDisplayList(L, ctx(), M).nodes).map(t => t.src));
      expect(calls.length).toBeLessThanOrEqual(6);                              // a few rounds: units, then the runs of the broken lines
      // however many lines: a cell and a text box of 30 lines settle in the same few rounds
      const long = Array.from({ length: 30 }, (_, i) => "word" + i).join(" ");
      const tb = { x: 0, y: 0, w: 70, h: 900, rot: 0, flipH: false, flipV: false, name: "t", fill: null, line: null, round: false, anchorV: "t", paras: [{ align: "left", sz: null, runs: [{ text: long, sz: null, b: false, i: false, color: null }] }] };
      const L2 = layout([{ text: long + " " + "x".repeat(40), wrap: true, bw: 50, bh: 900 }], { texts: [tb] });
      calls.length = 0;
      const dl2 = await measuredBuild(m => excelToDisplayList(L2, ctx(), m));
      expect(calls.length).toBeLessThanOrEqual(4);
      const ref = texts(excelToDisplayList(L2, ctx(), M).nodes);
      expect(texts(dl2.nodes).map(t => [t.src, t.x, t.y])).toEqual(ref.map(t => [t.src, t.x, t.y]));
      expect(ref.length).toBeGreaterThan(55);
    } finally { resetPlatform(); }
    expect(texts((await measuredBuild(m => excelToDisplayList(layout([{ text: "abc" }]), ctx(), m))).nodes)[0].w).toBe(roughMetrics.run("abc", cssFont(14.67, "x")).w);
  });
  it("CSS helpers", () => {
    expect(cssFont(14.67, "'Calibri',Arial", true, true)).toBe("italic 700 14.67px 'Calibri',Arial");
    expect(primaryFamily(`"Century Gothic", Arial`)).toBe("Century Gothic");
    expect(collapse("a \n\t b")).toBe("a b");
    expect(wrapLines("well-known words", 30, s => s.length * 5)).toEqual(["well-", "known", "words"]);
    expect(wrapLines("ééé", 5, s => s.length * 5).every(l => !/^\p{M}/u.test(l))).toBe(true);
    expect(wrapLines("", 10, s => s.length)).toEqual([""]);
    expect(breakRuns([{ text: "ab " }, { text: " cd" }], 100, t => t.length).map(l => l.map(p => p.text))).toEqual([["ab ", "cd"]]);
    expect(parseColor("rgba(255, 0, 0, .5)")).toEqual({ c: [255, 0, 0], a: .5 });
    expect(parseColor("#0f08")).toEqual({ c: [0, 255, 0], a: 136 / 255 });
    expect(parseColor("transparent").a).toBe(0);
    expect(parseColor("nonsense")).toEqual({ c: [0, 0, 0], a: 1 });
  });
});
export type { RectNode };
