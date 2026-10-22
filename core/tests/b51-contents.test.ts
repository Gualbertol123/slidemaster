/* B51 (4.9, product owner 2026-10-22): in a free layout the contents slide's title and its list move and resize like a
   table – the design's free entry holds their boxes under "c:title" / "c:toc" (render/contents.ts). Here: the boxes'
   vectors and the format guard (shared/ops-vectors.d/b51.json: a deck holding one is format 6, 4.6–4.8 would draw the
   contents unmoved), the drawing in every design (never moved: the same display list; moved: the part's elements at
   the saved box and scale, the list still following the deck – B47's hidden slides), Liquid Glass's card frosted with
   the wallpaper under its new place, and the PowerPoint export (the title placeholder and the rows' text boxes where
   the slide draws them, in EMU). SB_PPTX_OUT=<folder> writes the files for tools/pptxcheck.py. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import type { DisplayList, HitNode, ImageNode, Matrix, Node, TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, docNeedsV5, docNeedsV6, emptyDoc, knownOp, needsV5, needsV6 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout, freeBoxes, freeKey } from "../src/render/layout";
import { partBox, partOf, partTransform } from "../src/render/contents";
import { chartLook } from "../src/render/chart-dl";
import { wrapLines } from "../src/text/lines";
import { writePptx } from "../src/pptx/writer";
import { E } from "../src/pptx/drawingml";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";
import { loadVectors } from "./vectors";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const mul = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
/** every node with the matrix it is drawn under */
function flat(l: DisplayList, Mx: Matrix = [1, 0, 0, 1, 0, 0]): { n: Node; M: Matrix }[] {
  return l.flatMap(n => n.t === "group" ? [{ n, M: Mx }, ...flat(n.children, n.transform ? mul(Mx, n.transform) : Mx)] : [{ n, M: Mx }]);
}
/** the furniture's hits on the slide (slide px) */
const hitsOn = (l: DisplayList) => flat(l).flatMap(({ n, M: m }) => n.t === "hit" && n.kind === "f"
  ? [{ id: n.id, x: m[0] * n.x + m[4], y: m[3] * n.y + m[5], w: m[0] * n.w, h: m[3] * n.h }] : []);
const near = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, e = 1e-6) =>
  [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every(d => Math.abs(d) <= e);

async function deck(design: Design, file = "weekly-options.json") {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = resolveStyle({}, view.style, { design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const ix = slides.findIndex(S => S.type === "index");
  const wall = { sharp: { id: "w", src: "w.png" }, blur: { blurId: "wb", blurSrc: "wb.png" }, base: "#E9EDF6" } as unknown as Parameters<typeof slideToDisplayList>[5]["wall"];
  const build = (i: number, sem = false, withWall = false) => {
    const R = slides[i], boxes = computeLayout(R, ctx).boxes;
    return slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: withWall ? wall : null, logo: { id: "logo", src: "logo.png", w: 900, h: 100 } }, M, "1 October 2026", { sem });
  };
  const free = (items: Record<string, unknown> | null) => { slides[ix].cfg = { ...slides[ix].cfg, free: items ? { [design]: { on: true, items } } as never : undefined }; };
  return { ctx, slides, ix, build, free };
}

describe("B51 vectors and the format guard (shared/ops-vectors.d/b51.json)", () => {
  const mine = loadVectors().filter(v => /^B51 /.test(v.name));
  it("three cases", () => expect(mine.length).toBe(3));
  for (const v of mine) it(v.name + ": knownOp, needsV5 / needsV6, docNeedsV5 / docNeedsV6", () => {
    expect(v.ops.every((op: Op) => knownOp(op))).toBe(true);
    expect(v.ops.map((op: Op) => needsV5(op))).toEqual(v.expect.needsV5);
    expect(v.ops.map((op: Op) => needsV6(op))).toEqual(v.expect.needsV6);
    expect(docNeedsV5(v.expect)).toBe(v.expect.docNeedsV5);
    expect(docNeedsV6(v.expect)).toBe(v.expect.docNeedsV6);
  });
  it("a slide.add or preset.set carrying a moved contents part is format 6; a removed box (null) is not", () => {
    const slide = { id: "s9", type: "index", tables: [], free: { glass: { on: true, items: { "c:toc": { x: 1, y: 2, w: 3, h: 4 } } } } };
    expect(needsV6({ op: "slide.add", slide } as unknown as Op)).toBe(true);
    expect(needsV6({ op: "preset.set", preset: { sheets: [], tables: [], slides: [slide] } } as unknown as Op)).toBe(true);
    expect(needsV6({ op: "slide.patch", id: "s9", patch: { free: { glass: { on: true, items: { "c:toc": null } } } } } as unknown as Op)).toBe(false);
    expect(needsV6({ op: "slide.patch", id: "s9", patch: { free: { glass: null } } } as unknown as Op)).toBe(false);
  });
});

describe("the parts (render/contents.ts)", () => {
  it("the title and subtitle are the title; what the list draws (numbers, entries, the glass card, the empty line) the list", () => {
    expect(["title", "subtitle"].map(partOf)).toEqual(["title", "title"]);
    expect(["ix-txt", "ix-n", "ix-sep", "gls wb chrome card ix-card", "ix-empty", "ix-p"].map(partOf)).toEqual(Array(6).fill("toc"));
    expect(["ix-row x", "ix-row g"].map(partOf)).toEqual([null, null]);                // a row's box: its column's width
    expect(["pageno", "footer", "logo", "cv-title", "tnote"].map(partOf)).toEqual(Array(5).fill(null));
    expect(partBox([{ id: "title", x: 10, y: 10, w: 100, h: 40 }, { id: "subtitle", x: 12, y: 60, w: 200, h: 20 }], "title")).toEqual({ x: 10, y: 10, w: 202, h: 70 });
  });
  it("the transform: the saved scale (else the widths'), the box's corner to the saved place; none when nothing moves", () => {
    const D = { x: 100, y: 200, w: 400, h: 100 };
    expect(partTransform(D, { x: 100, y: 200, w: 400 })).toBeNull();
    expect(partTransform(D, { x: 100, y: 200, w: 999, scale: 1 })).toBeNull();
    expect(partTransform(D, { x: 150, y: 250, w: 400 })).toEqual([1, 0, 0, 1, 50, 50]);
    expect(partTransform(D, { x: 0, y: 0, w: 200 })).toEqual([.5, 0, 0, .5, -50, -100]);
    expect(partTransform(D, { x: 0, y: 0, w: 1, scale: 2 })).toEqual([2, 0, 0, 2, -200, -400]);
  });
});

describe("switching the free layout on again keeps the parts' places (review)", () => {
  it("freeBoxes carries the saved c: boxes (with their scale) through; a bad or empty one is left out", async () => {
    const { ix, slides, ctx } = await deck("excel");
    const R = slides[ix], T = { x: 900, y: 700, w: 300, h: 60, scale: .6 }, L = { x: 40, y: 30, w: 800, h: 300 };
    const withSaved = (items: Record<string, unknown>) => ({ ...R, cfg: { ...R.cfg, free: { excel: { on: true, items } } } }) as typeof R;
    expect(freeBoxes(withSaved({ "c:title": T, "c:toc": L }), ctx)).toEqual({ "c:title": T, "c:toc": L });
    expect(freeBoxes(withSaved({ "c:title": { x: "a" }, "c:toc": null }), ctx)).toEqual({});
    expect(freeBoxes(R, ctx)).toEqual({});
  });
});

describe("the contents slide drawn with moved parts, in every design", () => {
  for (const design of DESIGNS) {
    it(`${design}: never moved – the same display list (free layout off, on without the parts' boxes); moved – at the saved boxes`, async () => {
      const { ix, build, free, slides } = await deck(design);
      expect(ix).toBeGreaterThanOrEqual(0);
      // (the display list and what the exports are told; `parts` is the stage's)
      const drawn = (dl: ReturnType<typeof build>) => JSON.stringify({ ...dl, parts: undefined });
      const base = drawn(build(ix, true));
      free({}); expect(drawn(build(ix, true))).toBe(base);
      free({ "t:x": { x: 1, y: 1, w: 10, h: 10 } }); expect(drawn(build(ix, true))).toBe(base);
      // free layout on: the parts' boxes for the stage's handles (the title's: its text's, not its element's whole width)
      free({});
      const P = build(ix).parts!, T0 = P.title!, L0 = P.toc!;
      expect(T0 && L0).toBeTruthy();
      free(null);
      const d0 = build(ix).nodes, h0 = hitsOn(d0);
      expect(build(ix).parts).toBeUndefined();
      expect(near(partBox(h0, "toc")!, L0)).toBe(true);
      const th = h0.find(h => h.id === "title")!;
      expect(T0.y).toBe(th.y); expect(T0.w).toBeLessThanOrEqual(th.w); expect(T0.x).toBeGreaterThanOrEqual(th.x);
      // saved where they are: drawn as before
      free({ [freeKey.part("title")]: { ...T0, scale: 1 }, [freeKey.part("toc")]: { ...L0 } });
      expect(drawn(build(ix, true))).toBe(base);
      // the title to the bottom right at 0.6, the list to the top left at its size
      const T = { x: 900, y: 700, w: T0.w * .6, h: T0.h * .6, scale: .6 }, L = { x: 40, y: 30, w: L0.w, h: L0.h };
      free({ [freeKey.part("title")]: T, [freeKey.part("toc")]: L });
      const dl = build(ix), h1 = hitsOn(dl.nodes);
      expect(near(dl.parts!.title!, T)).toBe(true);
      expect(near(dl.parts!.toc!, L)).toBe(true);
      expect(near(partBox(h1, "toc")!, L)).toBe(true);
      // the title's element moved and scaled with its text
      const th1 = h1.find(h => h.id === "title")!;
      expect(th1.x - T.x).toBeCloseTo((th.x - T0.x) * .6, 6); expect(th1.w).toBeCloseTo(th.w * .6, 6);
      // the same elements, the same texts, the title's at 0.6 of its size
      expect(h1.map(h => h.id).sort()).toEqual(h0.map(h => h.id).sort());
      const texts = (l: DisplayList) => flat(l).flatMap(({ n, M: m }) => n.t === "text" && !n.decorative ? [{ src: n.src, size: n.size * m[0] }] : []);
      const t0 = texts(d0);
      expect(texts(dl.nodes).map(t => t.src)).toEqual(t0.map(t => t.src));
      const titleSize = (l: DisplayList) => { const f = flat(l), k = f.findIndex(({ n }) => n.t === "hit" && n.id === "title"); const t = f.slice(k).find(({ n }) => n.t === "text" && !n.decorative)!; return (t.n as TextNode).size * t.M[0]; };
      expect(titleSize(dl.nodes)).toBeCloseTo(titleSize(d0) * .6, 6);
      // what is not a part stays (the page number, the logo)
      const others = (hs: typeof h0) => hs.filter(h => !partOf(h.id) && !/^ix-row\b/.test(h.id)).map(h => JSON.stringify(h));
      expect(others(h1)).toEqual(others(h0));
      // B47: a content slide hidden in this design leaves the moved list, which still starts at the saved place
      const rows = (l: DisplayList) => hitsOn(l).filter(h => /^ix-row\b/.test(h.id)).length;
      const n = rows(dl.nodes), k = slides.findIndex(S => S.type === "content");
      slides[k].cfg = { ...slides[k].cfg, hide: { [design]: true } };
      const dl2 = build(ix);
      expect(rows(dl2.nodes)).toBe(n - 1);
      const L2 = dl2.parts!.toc!;
      expect([L2.x, L2.y]).toEqual([L.x, L.y]);
    });
  }
  it("Liquid Glass: the moved card is frosted with the wallpaper under its new place (drawn again for it)", async () => {
    const { ix, build, free } = await deck("glass");
    const blur = (l: DisplayList) => flat(l).flatMap(({ n, M: m }) => n.t === "image" && (n as ImageNode).id === "wb" ? [{ x: m[0] * n.x + m[4], s: m[0] }] : [])[0];
    const card = (l: DisplayList) => hitsOn(l).find(h => /ix-card/.test(h.id))!;
    const d0 = build(ix, false, true), c0 = card(d0.nodes), b0 = blur(d0.nodes);
    free({ [freeKey.part("toc")]: { x: c0.x + 300, y: c0.y + 50, w: c0.w * .5, h: c0.h * .5, scale: .5 } });
    const d1 = build(ix, false, true), c1 = card(d1.nodes), b1 = blur(d1.nodes);
    // the blurred wallpaper sits at −(LENS − 1) × the card's centre, on the slide, wherever the card is
    const lens = -b0.x / (c0.x + c0.w / 2);
    expect(lens).toBeGreaterThan(0);
    expect(b1.x).toBeCloseTo(-lens * (c1.x + c1.w / 2), 4);
  });
});

describe("the PowerPoint export: the moved parts where the slide draws them", () => {
  const pptx = async (design: Design, move: boolean, out?: string) => {
    const { slides, ix, build, free, ctx } = await deck(design);
    if (move) {
      free({});
      const { title: T0, toc: L0 } = build(ix).parts!;
      free({ [freeKey.part("title")]: { x: T0!.x + 200, y: T0!.y + 600, w: T0!.w, h: T0!.h, scale: 1 }, [freeKey.part("toc")]: { x: L0!.x + 40, y: L0!.y - 60, w: L0!.w * .8, h: L0!.h * .8, scale: .8 } });
    }
    const lists = slides.map((R, i) => {
      const dl = build(i, true);
      return { nodes: dl.nodes, sem: { type: (R.type === "cover" || R.type === "index" ? R.type : "content") as "content", items: {}, palette: chartLook(ctx, "").colors.slice(0, 6), ...(dl.layout ? { layout: dl.layout } : {}) } };
    });
    const bytes = writePptx({ slides: lists, image: () => PNG, face: c => c.split(",")[0].replace(/['"]/g, ""), title: "T", design: "Excel" });
    if (out && process.env.SB_PPTX_OUT) { fs.mkdirSync(process.env.SB_PPTX_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.SB_PPTX_OUT, out), bytes); }
    const z = unzipSync(bytes);
    return { xml: strFromU8(z[`ppt/slides/slide${ix + 1}.xml`]), ix };
  };
  /** the shapes of a slide: name, placeholder, offset, text */
  const shapes = (xml: string) => [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(m => ({
    ph: /<p:ph type="(\w+)"/.exec(m[1])?.[1] ?? null, x: +(/<a:off x="(-?\d+)"/.exec(m[1])?.[1] ?? NaN), y: +(/<a:off x="-?\d+" y="(-?\d+)"/.exec(m[1])?.[1] ?? NaN),
    text: [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join(""), sz: [...m[1].matchAll(/sz="(\d+)"/g)].map(t => +t[1]) }));
  for (const design of ["excel", "clean", "glass", "mckinsey", "bain"] as Design[]) {
    it(`${design}: the title a placeholder 200 × 600 px further (EMU); the rows' texts at 0.8 from the list's new corner; no connector, no picture more`, async () => {
      const a = await pptx(design, false), b = await pptx(design, true, `b51-${design}.pptx`);
      const s0 = shapes(a.xml), s1 = shapes(b.xml);
      const t0 = s0.find(s => s.ph === "title")!, t1 = s1.find(s => s.ph === "title")!;
      expect(t1.text).toBe(t0.text);
      expect(Math.abs(t1.x - t0.x - E(200))).toBeLessThanOrEqual(1);
      expect(Math.abs(t1.y - t0.y - E(600))).toBeLessThanOrEqual(1);
      // every text of the list: the same text, its size × 0.8 (the page numbers of the rows among them)
      const rowsOf = (ss: typeof s0) => ss.filter(s => !s.ph && s.text);
      const r0 = rowsOf(s0), r1 = rowsOf(s1);
      expect(r1.map(r => r.text)).toEqual(r0.map(r => r.text));
      for (let k = 0; k < r0.length; k++) if (r0[k].sz.length) expect(Math.abs(r1[k].sz[0] - Math.round(r0[k].sz[0] * .8))).toBeLessThanOrEqual(1);
      expect(b.xml).not.toContain("<p:cxnSp");
      expect(b.xml.split("<p:pic>").length).toBe(a.xml.split("<p:pic>").length);
    });
  }
});
