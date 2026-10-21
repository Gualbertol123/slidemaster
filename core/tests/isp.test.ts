/* Excel and Excel Refined follow the Intesa Sanpaolo 16:9 template (B48, product owner 2026-10-21; render/isp.ts,
   model/isp.ts): the palette, the content slides' title and subtitle, the page number and logo where the template's
   master has them, the cover, the contents ("INDICE"), the bullets and boxes of text boxes, thinner doughnuts – and the
   PowerPoint export's layouts made from them. Liquid Glass and the consulting designs keep their look (their display
   lists were compared before and after, slide by slide, over the corpus: unchanged). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type DisplayList, type HitNode, type Node, type PathNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle, themeOf } from "../src/model/style";
import { ispChartColors, ispTint, ISP_CHART, ISP_FILLS, ISP_RGB, ISP_TEXT } from "../src/model/isp";
import { ISP, tiltedSquare } from "../src/render/isp";
import { excelToDisplayList, lu, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { noteParts } from "../src/render/slide";
import { areaFor, computeLayout } from "../src/render/layout";
import { pageNoFor, pageNoGeom } from "../src/render/pagenumbers";
import { chartLook } from "../src/render/chart-dl";
import { wrapLines } from "../src/text/lines";
import { writePptx } from "../src/pptx/writer";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const hits = (l: DisplayList) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === "f");
const textsAfter = (l: DisplayList, cls: string) => { const all = flat(l), k = all.findIndex(n => n.t === "hit" && n.kind === "f" && n.id === cls); const out: TextNode[] = []; for (const n of all.slice(k + 1)) { if (n.t === "hit") break; if (n.t === "text" && !n.decorative) out.push(n); } return out; };
const BLU = [0, 58, 121];

async function deck(file: string, design: Design, pn: Record<string, unknown> | null = null) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = resolveStyle({}, view.style, { design, ...(pn ? { pn } : {}) });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (i: number, sem = false) => {
    const R = slides[i], boxes = computeLayout(R, ctx).boxes;
    return slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: { id: "logo", src: "logo.png", w: 900, h: 100 } }, M, "1 October 2026", { sem });
  };
  return { ctx, slides, build };
}

describe("the template's colours (model/isp.ts)", () => {
  it("transparency over white; the chart palette at 25 %; the swatches unique", () => {
    expect(ispTint(ISP_RGB.blu, .25)).toBe("#406B9B");
    expect(ispTint(ISP_RGB.blu, .5)).toBe("#809DBC");
    expect(ispTint(ISP_RGB.blu, .75)).toBe("#BFCEDE");
    expect(ISP_CHART.slice(0, 4)).toEqual(["#406B9B", "#F18B40", "#F1CE40", "#40915B"]);
    expect(new Set(ISP_FILLS.map(f => f[0])).size).toBe(ISP_FILLS.length);
    expect(new Set(ISP_TEXT.map(f => f[0])).size).toBe(ISP_TEXT.length);
  });
  it("Aurora and Intesa Sanpaolo are the template's colours in Excel and Excel Refined only; other themes stay the user's", () => {
    const th = (id: string) => ({ id, c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" });
    for (const design of ["excel", "clean"] as Design[]) {
      expect(themeOf({ design, theme: th("aurora") }).x).toBe("#003A79");
      expect(themeOf({ design, theme: th("intesa") })).toMatchObject({ id: "intesa", x: "#003A79", a2: "#EC6400" });
      expect(themeOf({ design, theme: th("forest") }).x).toBe("#1E5E3A");
      expect(ispChartColors({ design, theme: th("aurora") })![0]).toBe("#406B9B");
      expect(ispChartColors({ design, theme: th("ocean") })).toBeNull();
    }
    for (const design of ["glass", "mckinsey", "bain"] as Design[]) expect(ispChartColors({ design, theme: th("aurora") })).toBeNull();
    expect(themeOf({ design: "glass", theme: th("intesa") }).x).toBe("#006A35");
    expect(themeOf({ design: "glass", theme: th("aurora") }).x).toBe("#1C4F8C");
  });
});

describe("content slides (pages 3–13)", () => {
  for (const design of ["excel", "clean"] as Design[]) it(`${design}: title 26 pt bold Blu and subtitle 16 pt Nero 50 % at the template's place; the area under them`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design);
    const i = slides.findIndex(S => S.type === "content"), R = slides[i];
    R.cfg.fmt = {};                                                            // the deck's own sizes left out
    ctx.style.text = {};
    const dl = build(i), hs = hits(dl.nodes), t = hs.find(h => h.id === "title")!, s = hs.find(h => h.id === "subtitle")!;
    expect(validate(dl.nodes)).toEqual([]);
    expect([t.x, t.y]).toEqual([69.76, 45]);
    expect(t.h).toBeCloseTo(lu(1.4 * 43.33), 2);
    expect([s.x, s.y]).toEqual([69.76, 124]);
    const tt = textsAfter(dl.nodes, "title")[0], st = textsAfter(dl.nodes, "subtitle")[0];
    expect([tt.size, tt.weight, tt.fill]).toEqual([43.33, 700, { solid: BLU }]);
    expect([st.size, st.weight, st.fill]).toEqual([26.67, 400, { solid: [127, 127, 127] }]);
    expect(tt.css).toMatch(/^"Century Gothic"/);
    expect(areaFor(R, ctx)).toEqual({ x: 70, y: 176, w: 1460, h: 646 });
    R.subtitle = "";
    expect(areaFor(R, ctx)).toEqual({ x: 70, y: 122, w: 1460, h: 700 });
  });
  it("the page number at the master's top right (bottom right, the default, too); the logo at its bottom right, drawn first", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "excel", { on: true, pos: "br", format: "n", size: 16 });
    const i = slides.findIndex(S => S.type === "content"), label = pageNoFor(ctx, i)!;
    const g = pageNoGeom(ctx, label, false, true, false);
    expect([g.left + g.w, g.top]).toEqual([ISP.pageno.right, ISP.pageno.top]);
    const dl = build(i), pn = hits(dl.nodes).find(h => /pageno/.test(h.id))!;
    expect(pn.x + pn.w).toBeCloseTo(1537, 6);
    const pt = textsAfter(dl.nodes, pn.id)[0];
    expect([pt.weight, pt.fill]).toEqual([700, { solid: BLU }]);
    expect(pt.x + pt.w!).toBeCloseTo(1537, 6);                               // right-aligned
    // another corner: as chosen; Liquid Glass: unchanged
    ctx.style.pn = { ...ctx.style.pn, pos: "bl" };
    expect(pageNoGeom(ctx, label, false, true, false).left).toBe(56);
    const glass = await deck("weekly-options.json", "glass", { on: true, pos: "br" });
    expect(pageNoGeom(glass.ctx, label, true, true, false).top).toBeGreaterThan(800);
    // the logo: right edge and foot as the master's picture, the first thing after the background
    const nodes = dl.nodes, logo = hs(nodes, "logo");
    expect(logo.x + logo.w).toBeCloseTo(ISP.logo.right, 1);
    expect([logo.y, logo.h]).toEqual([ISP.logo.top, ISP.logo.h]);
    expect(nodes.findIndex(n => n.t === "image" && n.id === "logo")).toBeLessThan(nodes.findIndex(n => n.t === "hit" && n.id === "title"));
  });
});
const hs = (l: DisplayList, id: string) => hits(l).find(h => h.id === id)!;

describe("the cover (page 1) and the contents (page 2)", () => {
  it("the band is Blu at 75 % from the top left; logo, title, subtitle left-aligned at 1.771 in", async () => {
    const { slides, build } = await deck("weekly-options.json", "clean");
    const nodes = build(slides.findIndex(S => S.type === "cover")).nodes;
    const band = flat(nodes).find((n): n is PathNode => n.t === "path")!;
    expect(band.d).toEqual([["M", 0, 0], ["L", 821.17, 0], ["L", 22.85, 140.35], ["Z"]]);
    expect(band.fill).toEqual({ solid: BLU, a: .75 });
    expect(hs(nodes, "logo")).toMatchObject({ x: 283.36, y: 337.76, h: 67.84 });
    expect(hs(nodes, "cv-title")).toMatchObject({ x: 283.36, y: 456.16 });
    expect(textsAfter(nodes, "cv-sub")[0].fill).toEqual({ solid: [127, 127, 127] });
    // nothing of the old cover: no panel, bar or rule
    expect(hits(nodes).map(h => h.id).filter(id => /cvx-panel|cv-bar|cvx-rule/.test(id))).toEqual([]);
  });
  it("INDICE: the heading at 3.086 in, a row every 0.4 in from 1.866 in – a tilted square, the page bold in Blu, the entry", async () => {
    const { slides, build } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "index"), nodes = build(i).nodes;
    expect(hs(nodes, "title")).toMatchObject({ x: ISP.index.x, y: ISP.index.top });
    const row = hs(nodes, "ix-row x"), p = hs(nodes, "ix-p"), t = hs(nodes, "ix-t");
    expect([row.y, row.h]).toEqual([ISP.index.rowTop, ISP.index.pitch]);
    expect(p.x).toBe(ISP.index.rowX);
    expect(t.x).toBeGreaterThan(p.x + p.w);
    const pt = textsAfter(nodes, "ix-p")[0];
    expect([pt.weight, pt.fill, pt.size]).toEqual([700, { solid: BLU }, 26.67]);
    const mark = flat(nodes).find((n): n is PathNode => n.t === "path")!;
    expect(mark.fill).toEqual({ solid: BLU, a: .75 });
    expect(hs(nodes, "ix-n").label).toBe("01");
    expect(hits(nodes).some(h => h.id === "ix-lead")).toBe(false);
  });
  it("many entries: closer rows, then two columns, all above the content area's foot", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "excel");
    const content = slides.find(S => S.type === "content")!;
    for (let k = 0; k < 24; k++) ctx.slides.push({ ...content, id: "x" + k, title: "Entry " + k });
    const nodes = build(slides.findIndex(S => S.type === "index")).nodes, rows = hits(nodes).filter(h => h.id === "ix-row x");
    expect(rows.length).toBe(25);
    expect(new Set(rows.map(r => r.x)).size).toBe(2);
    expect(Math.max(...rows.map(r => r.y + r.h))).toBeLessThanOrEqual(ISP.area.bottom);
  });
});

describe("text boxes (pages 4, 5, 12)", () => {
  it("bullets: \"- \" a filled square tilted 10° at 25 % transparency, an indented \"- \" the square in outline; the text hangs 1 em in", async () => {
    const { ctx, slides } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "content"), R = slides[i], part = noteParts(R, 0, ctx)[0];
    const n = (R.cfg.notes as Record<string, { text: string; align?: string; size?: number }>)[part.key];
    n.text = "- First level\n  - Second level\nA paragraph"; n.align = "left"; n.size = 18;
    const boxes = computeLayout(R, ctx).boxes, dl = slideToDisplayList(R, i, ctx, [], boxes, { wall: null, logo: null }, M, "x");
    const cls = noteParts(R, 0, ctx)[0].cls, k = dl.nodes.findIndex(x => x.t === "hit" && x.id === cls), box = dl.nodes[k + 1];
    const paths = (box.t === "group" ? flat(box.children) : []).filter((x): x is PathNode => x.t === "path"), texts = textsAfter(dl.nodes, cls);
    expect(paths).toHaveLength(2);
    expect(paths[0].fill).toEqual({ solid: BLU, a: .75 }); expect(paths[0].stroke).toBeUndefined();
    expect(paths[1].fill).toBeUndefined(); expect(paths[1].stroke?.paint).toEqual({ solid: BLU, a: .75 });
    expect(texts.map(t => t.src)).toEqual(["First level", "Second level", "A paragraph"]);
    const size = texts[0].size;
    expect(texts[0].x - texts[2].x).toBeCloseTo(ISP.bullet.indent * size, 6);
    expect(texts[1].x).toBeCloseTo(texts[0].x, 6);                          // the second level at the same indent (page 5)
    // the square: tilted −10°, its centre on the first line's x-height
    const sq = tiltedSquare(0, 0, 10);
    expect(sq[1][2]).toBeLessThan(sq[0][2]);                                 // its top edge rises to the right
    // Liquid Glass: "- " stays text
    const g = await deck("weekly-options.json", "glass"), gR = g.slides[i], gp = noteParts(gR, 0, g.ctx)[0];
    (gR.cfg.notes as Record<string, { text: string }>)[gp.key].text = "- First level";
    const gdl = slideToDisplayList(gR, i, g.ctx, [], computeLayout(gR, g.ctx).boxes, { wall: null, logo: null }, M, "x");
    expect(textsAfter(gdl.nodes, noteParts(gR, 0, g.ctx)[0].cls)[0].src).toBe("- First level");
  });
  it("a text box in a box: white with the template's outline, Nero 50 % at 1 pt, no shadow", async () => {
    for (const design of ["excel", "clean"] as Design[]) {
      const { slides, build } = await deck("weekly-options.json", design);
      const nodes = flat(build(slides.findIndex(S => S.type === "content")).nodes), k = nodes.findIndex(x => x.t === "hit" && x.id === "notebub x");
      expect(k).toBeGreaterThanOrEqual(0);
      expect(nodes[k + 1]).toMatchObject({ t: "rect", fill: { solid: [255, 255, 255] }, stroke: { w: 5 / 3, paint: { solid: [127, 127, 127] } } });
      expect(nodes.some(x => x.t === "shadow")).toBe(false);
    }
  });
});

describe("charts (page 10)", () => {
  it("thinner doughnuts and the template's palette in the Excel designs; Liquid Glass and the consulting designs as before", async () => {
    const x = await deck("report.json", "excel"), g = await deck("report.json", "glass"), n = await deck("report.json", "mckinsey");
    expect(chartLook(x.ctx, "x")).toMatchObject({ hole: .75, colors: expect.arrayContaining(["#406B9B"]) });
    expect(chartLook(g.ctx, "x").hole).toBeUndefined();
    expect(chartLook(n.ctx, "x").hole).toBeUndefined();
  });
});

describe("the PowerPoint export (layouts made from the deck)", () => {
  it("the content layout carries the logo; titles 26 pt Blu, subtitles 16 pt grey; the cover's band a freeform at 75 %", async () => {
    for (const file of ["report-looks.json", "weekly-options.json"]) {
      const { ctx, slides, build } = await deck(file, "excel");
      const lists = slides.map((R, i) => {
        const dl = build(i, true);
        return { nodes: dl.nodes, sem: { type: (R.type === "cover" || R.type === "index" ? R.type : "content") as "content", items: {}, palette: chartLook(ctx, "").colors.slice(0, 6) } };
      });
      const z = unzipSync(writePptx({ slides: lists, image: () => PNG, face: c => c.split(",")[0].replace(/['"]/g, ""), title: "T", design: "Excel" }));
      const xml = (p: string) => strFromU8(z[p]);
      const layouts = Object.keys(z).filter(p => /slideLayouts\/slideLayout\d+\.xml$/.test(p)).map(xml);
      const slideXml = Object.keys(z).filter(p => /slides\/slide\d+\.xml$/.test(p)).map(xml).join("");
      if (file === "report-looks.json") {
        // two content slides: the logo is their layout's, not theirs
        const titleOnly = layouts.find(l => /name="Title Only"/.test(l))!;
        expect(titleOnly).toContain("<p:pic>");
        expect(slideXml).not.toContain("<p:pic>");
      } else {
        expect(slideXml).toMatch(/<a:custGeom>[\s\S]*?<a:srgbClr val="003A79"><a:alpha val="75000"\/>/);
      }
      expect(slideXml).toMatch(/sz="2600" b="1"/);                         // (the decks' own title colours and styles apply)
      expect(slideXml).toMatch(/sz="1600"[^>]*><a:solidFill><a:srgbClr val="7F7F7F"/);
    }
  });
});
