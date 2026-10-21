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
import { designOf, resolveStyle, themeOf } from "../src/model/style";
import { ispChartColors, ispTint, ISP_CHART, ISP_FILLS, ISP_RGB, ISP_TEXT } from "../src/model/isp";
import { ISP, K, tiltedSquare, tpt } from "../src/render/isp";
import { excelToDisplayList, lu, type Metrics } from "../src/render/excel-dl";
import { ISP_BULLET, slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
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

describe("one scale (B48 review, 4): the template's 10 in slide onto the export's 13.33 in, positions, type and lines alike", () => {
  it("26 pt is 34.67 pt in the export (57.78 px at 0.6 pt per px), 16 pt 21.33 pt, 1 pt 1.33 pt; 0.436 in is 0.581 in", () => {
    expect(K).toBeCloseTo(1600 / 1200, 9);                                   // 13.33 in / 10 in: 160 px per template inch
    expect(tpt(26) * .6).toBeCloseTo(26 * K, 1);
    expect([ISP.title.size, ISP.sub.size, ISP.cover.title.size, ISP.index.size]).toEqual([tpt(26), tpt(16), tpt(26), tpt(16)]);
    expect(ISP.box.w * .6).toBeCloseTo(K, 2);
    // a position and a type size keep their proportion to the slide: the title's size against the slide's width is the
    // template's (26 pt of 720 pt), as its x is (0.436 in of 10 in)
    expect(ISP.title.size / 1600).toBeCloseTo(26 / 720, 4);
    expect(ISP.title.x / 1600).toBeCloseTo(.436 / 10, 4);
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
    expect([t.x, t.y]).toEqual([69.76, ISP.title.top]);
    expect(t.h).toBeCloseTo(lu(1.4 * tpt(26)), 1);
    expect([s.x, s.y]).toEqual([69.76, ISP.sub.top]);
    const tt = textsAfter(dl.nodes, "title")[0], st = textsAfter(dl.nodes, "subtitle")[0];
    expect([tt.size, tt.weight, tt.fill]).toEqual([tpt(26), 700, { solid: BLU }]);
    expect([st.size, st.weight, st.fill]).toEqual([tpt(16), 400, { solid: [127, 127, 127] }]);
    expect(tt.css).toMatch(/^"Century Gothic"/);
    expect(areaFor(R, ctx)).toEqual({ x: 70, y: 178, w: 1460, h: 644 });
    R.subtitle = "";
    expect(areaFor(R, ctx)).toEqual({ x: 70, y: 130, w: 1460, h: 692 });
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
    // another corner: as chosen – at the bottom on the logo's row, a bottom-left one at the content's margin (B48 fix);
    // Liquid Glass: unchanged
    ctx.style.pn = { ...ctx.style.pn, pos: "bl" };
    const bl = pageNoGeom(ctx, label, false, true, false);
    expect(bl.left).toBe(ISP.area.x);
    expect(bl.top + bl.h / 2).toBeCloseTo(ISP.logo.top + ISP.logo.h / 2, 0);
    const glass = await deck("weekly-options.json", "glass", { on: true, pos: "br" });
    expect(pageNoGeom(glass.ctx, label, true, true, false).top).toBeGreaterThan(800);
    // the logo: right edge and foot as the master's picture, the first thing after the background
    const nodes = dl.nodes, logo = hs(nodes, "logo");
    expect(logo.x + logo.w).toBeCloseTo(ISP.logo.right, 1);
    expect([logo.y, logo.h]).toEqual([ISP.logo.top, ISP.logo.h]);
    expect(nodes.findIndex(n => n.t === "image" && n.id === "logo")).toBeLessThan(nodes.findIndex(n => n.t === "hit" && n.id === "title"));
  });
  it("the page number on by default in Excel and Excel Refined, top right, not on the cover; a deck's own choice kept (B48)", async () => {
    for (const d of ["excel", "clean"] as const) {
      const { ctx, slides, build } = await deck("weekly-options.json", d);         // (its cover; the deck's own settings dropped)
      ctx.style = resolveStyle({ design: d });
      expect(ctx.style.pn.on).toBe(true);
      const c = slides.findIndex(S => S.type === "cover"); expect(c).toBeGreaterThanOrEqual(0);
      expect(pageNoFor(ctx, c)).toBeNull();                                      // the cover: none, as the template
      const i = slides.findIndex(S => S.type === "content"), label = pageNoFor(ctx, i)!;
      expect(label).toBe(String(i + 1));
      const g = pageNoGeom(ctx, label, false, true, false);
      expect([g.left + g.w, g.top]).toEqual([ISP.pageno.right, ISP.pageno.top]);
      expect(hits(build(i).nodes).some(h => /pageno/.test(h.id))).toBe(true);
      // turned off by the deck, or by the shared defaults: stays off
      ctx.style = resolveStyle({ design: d }, { pn: { on: false } });
      expect(pageNoFor(ctx, i)).toBeNull();
      expect((await deck("weekly-looks.json", d, { on: false })).ctx.style.pn.on).toBe(false);
      expect((await deck("weekly-looks.json", d)).ctx.style.pn.on).toBe(true);
      expect(resolveStyle({ pn: { on: false } }, { design: d }).pn.on).toBe(false);
      expect(resolveStyle({ design: d, pn: { on: null as never } }).pn.on).toBe(true);    // a removed setting: the default
    }
    // the other designs: off unless set, as before
    for (const d of ["glass", "mckinsey", "bain"] as const) expect(resolveStyle({ design: d }).pn.on).toBe(false);
    expect((await deck("weekly-looks.json", "glass")).ctx.style.pn.on).toBe(false);
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
    expect(hs(nodes, "cv-title")).toMatchObject({ x: 283.36, y: ISP.cover.title.top });
    expect(textsAfter(nodes, "cv-title")[0].size).toBe(tpt(26));
    // the subtitle at 3.880 in (B48 review, 5): its baseline one ascent under 620.8 px, where PowerPoint draws it
    expect(hs(nodes, "cv-sub")).toMatchObject({ x: 283.36, y: ISP.cover.sub.top });
    expect(ISP.cover.sub.top).toBeCloseTo(3.88 * 160, -1);
    expect(textsAfter(nodes, "cv-sub")[0].fill).toEqual({ solid: [127, 127, 127] });
    expect(textsAfter(nodes, "cv-sub")[0].size).toBe(tpt(16));
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
    expect([pt.weight, pt.fill, pt.size]).toEqual([700, { solid: BLU }, tpt(16)]);
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
    expect(sq[1][2] as number).toBeLessThan(sq[0][2] as number);                                 // its top edge rises to the right
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
      expect(nodes[k + 1]).toMatchObject({ t: "rect", fill: { solid: [255, 255, 255] }, stroke: { w: tpt(1), paint: { solid: [127, 127, 127] } } });
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
      expect(slideXml).toMatch(/sz="3467" b="1"/);                         // 26 pt × 4/3 (the decks' own title colours and styles apply)
      expect(slideXml).toMatch(/sz="213[34]"[^>]*><a:solidFill><a:srgbClr val="7F7F7F"/);   // 16 pt × 4/3 (the scene's px to 1/100)
    }
  });
});

describe("B48 review fixes", () => {
  const pptxOf = (lists: { nodes: DisplayList; sem: Parameters<typeof writePptx>[0]["slides"][number]["sem"] }[]) => {
    const z = unzipSync(writePptx({ slides: lists, image: () => PNG, face: c => c.split(",")[0].replace(/['"]/g, ""), title: "T", design: "Excel" }));
    const xml = (p: string) => strFromU8(z[p]);
    const parts = (re: RegExp) => Object.keys(z).filter(p => re.test(p)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    return { xml, layouts: parts(/slideLayouts\/slideLayout\d+\.xml$/).map(xml), slides: parts(/slides\/slide\d+\.xml$/).map(xml), rels: parts(/slides\/_rels\/slide\d+\.xml\.rels$/).map(xml) };
  };
  const semOf = (R: { type: string }, dl: SlideDL, palette: string[]) =>
    ({ type: (R.type === "cover" || R.type === "index" ? R.type : "content") as "content", items: {}, palette, ...(dl.layout ? { layout: dl.layout } : {}) });

  it("5: the cover's subtitle stays at 3.880 in under a one-line title; a long title pushes it down by the gap", async () => {
    const { slides, build } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "cover");
    expect(hs(build(i).nodes, "cv-sub").y).toBe(ISP.cover.sub.top);
    slides[i].title = "A cover title long enough to wrap onto a second and then a third line in the template's frame of seven inches";
    const nodes = build(i).nodes, t = hs(nodes, "cv-title"), s = hs(nodes, "cv-sub");
    expect(t.y + t.h).toBeGreaterThan(ISP.cover.sub.top - ISP.cover.sub.gap);
    expect(s.y).toBeCloseTo(t.y + t.h + ISP.cover.sub.gap, 1);
  });

  it("7: \"- \" before a figure is a minus, not a bullet", async () => {
    for (const t of ["- Revenue up", "  - second level", "• Point", "◦ Point"]) expect(ISP_BULLET.test(t), t).toBe(true);
    for (const t of ["- 12 mln", "-  12 mln", "- €3 mln", "- .5 %", "- 0,5", "- $4", "-12 mln", "  - 3"]) expect(ISP_BULLET.test(t), t).toBe(false);
    const { ctx, slides } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "content"), R = slides[i], part = noteParts(R, 0, ctx)[0];
    (R.cfg.notes as Record<string, { text: string; align?: string }>)[part.key].text = "- 12 mln vs budget\n- Revenue up";
    (R.cfg.notes as Record<string, { align?: string }>)[part.key].align = "left";
    const dl = slideToDisplayList(R, i, ctx, [], computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "x");
    const cls = noteParts(R, 0, ctx)[0].cls, k = dl.nodes.findIndex(x => x.t === "hit" && x.id === cls), box = dl.nodes[k + 1];
    expect(textsAfter(dl.nodes, cls).map(t => t.src)).toEqual(["- 12 mln vs budget", "Revenue up"]);
    expect((box.t === "group" ? flat(box.children) : []).filter(x => x.t === "path")).toHaveLength(1);
  });

  it("2: in PowerPoint a bullet is its paragraph's own (a square character in Blu at 75 %, hanging), not a shape over the text", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "content"), R = slides[i], part = noteParts(R, 0, ctx)[0];
    const n = (R.cfg.notes as Record<string, { text: string; align?: string; size?: number }>)[part.key];
    n.text = "- First level\n  - Second level\nA paragraph"; n.align = "left"; n.size = 18;
    // the stage's, PDF's and PNG's list: the tilted squares, no "bu" hit; the PowerPoint export's: a "bu" hit before each
    const boxOf = (l: DisplayList) => { const k = l.findIndex(x => x.t === "hit" && x.id === part.cls), g = l[k + 1]; return g.t === "group" ? flat(g.children) : []; };
    expect(boxOf(build(i).nodes).some(x => x.t === "hit" && x.kind === "bu")).toBe(false);
    expect(boxOf(build(i, true).nodes).filter(x => x.t === "hit" && x.kind === "bu").map(x => (x as HitNode).id)).toEqual(["1", "2"]);
    const dl = build(i, true), { slides: xs } = pptxOf([{ nodes: dl.nodes, sem: semOf(R, dl, chartLook(ctx, "").colors.slice(0, 6)) }]);
    const x = xs[0], paras = [...x.matchAll(/<a:p><a:pPr([^>]*)>(.*?)<\/a:pPr>(.*?)<\/a:p>/g)].map(m => ({ attrs: m[1], pPr: m[2], text: [...m[3].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join("") }));
    const first = paras.find(p => p.text === "First level")!, second = paras.find(p => p.text === "Second level")!, plainP = paras.find(p => p.text === "A paragraph")!;
    expect(first.pPr).toContain('<a:buClr><a:srgbClr val="003A79"><a:alpha val="75000"/></a:srgbClr></a:buClr>');
    expect(first.pPr).toContain('<a:buChar char="■"/>');
    expect(second.pPr).toContain('<a:buChar char="□"/>');
    expect(plainP.pPr).toContain("<a:buNone/>");
    // hanging: the text 1 em (18 px = 137 160 EMU, less the square's offset) right of the bullet, the bullet at or right of the inset
    const mi = (a: string) => [+/marL="(-?\d+)"/.exec(a)![1], +/indent="(-?\d+)"/.exec(a)![1]];
    const [marL, indent] = mi(first.attrs);
    expect(indent).toBeLessThan(0);
    expect(marL + indent).toBeGreaterThanOrEqual(0);
    expect(-indent).toBeGreaterThan(.6 * 18 * 7620);
    expect(-indent).toBeLessThan(18 * 7620);
    expect(mi(plainP.attrs)).toEqual([0, 0]);
    // the text runs carry no "- " and no freeform lies over the text box (the only custom geometry is none here)
    expect(x).not.toContain("<a:t>- ");
    expect(x).not.toContain("<a:custGeom>");
  });

  it("3: the layouts carry the template's furniture even with one slide of each kind – the cover's band and logo, the logo of contents and content slides", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "excel");
    const pick = ["cover", "index", "content"].map(k => slides.findIndex(S => S.type === k));
    expect(pick.every(k => k >= 0)).toBe(true);
    const pal = chartLook(ctx, "").colors.slice(0, 6);
    const lists = pick.map(i => { const dl = build(i, true); return { nodes: dl.nodes, sem: semOf(slides[i], dl, pal) }; });
    const p = pptxOf(lists), byName = (name: string) => p.layouts.find(l => l.includes(`<p:cSld name="${name}">`))!;
    const cover = byName("Title Slide"), contents = byName("Contents"), content = byName("Title Only");
    for (const l of [cover, contents, content]) expect(l).toContain("<p:pic>");
    expect(cover).toMatch(/<a:custGeom>[\s\S]*?<a:srgbClr val="003A79"><a:alpha val="75000"\/>/);
    expect(content).not.toContain("<a:custGeom>");
    // the slides hold no logo and no band: theirs is the layout's
    for (const s of p.slides) expect(s).not.toContain("<p:pic>");
    expect(p.slides[0]).not.toContain("<a:custGeom>");
    // each slide on its own kind's layout
    expect(p.rels.map(r => /slideLayout(\d+)\.xml/.exec(r)![1])).toEqual(["1", "2", "3"]);
    // a content slide without the logo: a layout of its own, without the picture (the other keeps it)
    const j = pick[2], R = slides[j];
    R.cfg = { ...R.cfg, logo: false };
    const dl2 = build(j, true), p2 = pptxOf([...lists, { nodes: dl2.nodes, sem: semOf(R, dl2, pal) }]);
    const second = p2.layouts.find(l => l.includes('<p:cSld name="Title Only 2">'))!;
    expect(second).toBeTruthy();
    expect(second).not.toContain("<p:pic>");
    expect(p2.layouts.find(l => l.includes('<p:cSld name="Title Only">'))).toContain("<p:pic>");
  });

  it("10: the swatches' subscription reads the design alone – designOf is resolveStyle's design", () => {
    const layers = [[], [null, { design: "excel" }], [{ design: "clean" }, { design: "mckinsey" }], [{ design: "excel" }, { glass: "subtle" }], [{ design: "nonsense" }], [{ design: "bain" }, { design: null }]] as unknown as Parameters<typeof designOf>[];
    for (const l of layers) expect(designOf(...l)).toBe(resolveStyle(...l).design);
  });

  it("3: the other designs' lists name no layout nodes (their PowerPoint export is unchanged)", async () => {
    for (const design of ["glass", "mckinsey", "bain"] as Design[]) {
      const { slides, build } = await deck("weekly-options.json", design);
      for (let i = 0; i < slides.length; i++) expect(build(i, true).layout, design).toBeUndefined();
    }
    const { slides, build } = await deck("weekly-options.json", "clean");
    expect(build(slides.findIndex(S => S.type === "cover"), true).layout).toBeDefined();
    expect(build(slides.findIndex(S => S.type === "cover")).layout).toBeUndefined();   // (the stage's list: none)
  });
});

/* The slide's furniture never overlaps (B48 fix: the sample's source note was drawn over the footer "Confidential -
   internal use only"). Each furniture text – title, subtitle, page number, footer, the notes section (sources) – and the
   logo, as drawn: the box of its runs (the test metrics' ascent 0.8 em, descent 0.2 em) or the picture; the content –
   tables, text boxes (their frame and text) and items – where it is drawn. */
type Rect = { x: number; y: number; w: number; h: number };
const runW = (n: TextNode) => n.w ?? M.run(n.src, `${n.size}px x`).w;
const inkOf = (ts: TextNode[]): Rect | null => {
  const rs = ts.filter(t => t.src.trim()).map(t => ({ x0: t.x, x1: t.x + runW(t), y0: t.y - .8 * t.size, y1: t.y + .2 * t.size }));
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map(r => r.x0)), y0 = Math.min(...rs.map(r => r.y0));
  return { x: x0, y: y0, w: Math.max(...rs.map(r => r.x1)) - x0, h: Math.max(...rs.map(r => r.y1)) - y0 };
};
const furnitureKind = (id: string) => id === "title" || id === "subtitle" ? id : /^pageno/.test(id) ? (/footer/.test(id) ? "footer" : "pageno")
  : id === "logo" ? "logo" : /^tnote memo/.test(id) ? "note" : null;
function slideParts(dl: SlideDL) {
  const all = flat(dl.nodes), furniture: (Rect & { kind: string; text: string })[] = [], content: (Rect & { kind: string })[] = [];
  const after = (k: number) => { const out: TextNode[] = []; for (const n of all.slice(k + 1)) { if (n.t === "hit") break; if (n.t === "text" && !n.decorative) out.push(n); } return out; };
  all.forEach((n, k) => {
    if (n.t !== "hit" || n.kind !== "f") return;
    const kind = furnitureKind(n.id);
    if (kind === "logo") furniture.push({ kind, text: "", x: n.x, y: n.y, w: n.w, h: n.h });
    else if (kind) { const ts = after(k), r = inkOf(ts); if (r) furniture.push({ kind, text: ts.map(t => t.src).join(""), ...r }); }
    else if (n.id === "tw" || /^notebub/.test(n.id)) content.push({ kind: n.id, x: n.x, y: n.y, w: n.w, h: n.h });
    else if (/^tnote /.test(n.id)) { const r = inkOf(after(k)); if (r) content.push({ kind: "text box", ...r }); }
  });
  for (const [id, it] of Object.entries(dl.items)) content.push({ kind: "item " + id, ...it.box });
  return { furniture, content };
}
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > .5;
const SOURCE = "Source: internal data; figures not audited";

describe("B48 fix: the furniture never overlaps – the source note and the footer side by side on the logo's row", () => {
  const files = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort();
  const decks = async (file: string, design: Design) => { try { return await deck(file, design); } catch { return null; } };   // (the corpus's unreadable book)
  for (const design of ["excel", "clean"] as Design[]) it(`${design}: every corpus deck, as saved and with a footer, a page number and a source note in each corner`, async () => {
    const bad: string[] = [];
    let checked = 0;
    for (const file of files) {
      const D = await decks(file, design); if (!D) continue;
      const { ctx, slides, build } = D, saved = { pn: { ...ctx.style.pn }, footer: { ...ctx.style.footer } };
      const variants: [string, () => void][] = [["as saved", () => {}]];
      for (const fpos of ["bl", "bc", "br"]) for (const ppos of ["br", "bl", "tr"]) variants.push([`footer ${fpos}, page ${ppos}, source note`, () => {
        ctx.style.footer = { ...saved.footer, on: true, pos: fpos, text: saved.footer.text || "Confidential - internal use only", size: 12, cover: false } as typeof ctx.style.footer;
        ctx.style.pn = { ...saved.pn, on: true, pos: ppos, format: "nN", size: 14 } as typeof ctx.style.pn;
        for (const R of slides) if (R.type === "content" && !(R.cfg.notes || {})["slide:notes"]) R.cfg.notes = { ...(R.cfg.notes || {}), "slide:notes": { text: SOURCE, size: 13 } };
      }]);
      for (const [name, apply] of variants) {
        apply();
        slides.forEach((R, i) => {
          const { furniture, content } = slideParts(build(i)), at = `${file} ${name} slide ${i + 1}`;
          checked++;
          furniture.forEach((a, k) => {
            for (const b of furniture.slice(k + 1)) if (overlap(a, b)) bad.push(`${at}: ${a.kind} "${a.text}" over ${b.kind} "${b.text}"`);
            for (const c of content) if (overlap(a, c)) bad.push(`${at}: ${a.kind} "${a.text}" over the content (${c.kind})`);
            if (a.kind !== "logo" && (a.x < 0 || a.y < 0 || a.x + a.w > 1600 || a.y + a.h > 900)) bad.push(`${at}: ${a.kind} "${a.text}" off the slide`);
            if (/…$/.test(a.text)) bad.push(`${at}: ${a.kind} "${a.text}" cut`);
          });
        });
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  }, 120_000);   // ~3 s alone (every corpus deck × 10 variants); several times that under the full parallel suite
  it("the sample (weekly-options): the footer at the content's left margin on the logo's row, the source note beside it, the logo at the right", async () => {
    const { slides, build } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "content"), { furniture } = slideParts(build(i));
    const f = furniture.find(p => p.kind === "footer")!, n = furniture.find(p => p.kind === "note")!, logo = furniture.find(p => p.kind === "logo")!;
    const mid = (r: Rect) => r.y + r.h / 2, row = ISP.logo.top + ISP.logo.h / 2;
    expect(f.x).toBeCloseTo(ISP.area.x, 6);
    for (const r of [f, n, logo]) expect(Math.abs(mid(r) - row)).toBeLessThan(3);
    expect(n.x).toBeGreaterThanOrEqual(f.x + f.w + ISP.row.gap);
    expect(n.x + n.w).toBeLessThan(logo.x);
    const memo = hits(build(i).nodes).find(h => /^tnote memo/.test(h.id))!;
    expect(memo.y).toBeGreaterThanOrEqual(ISP.area.bottom);                   // under the content area
    expect(memo.y + memo.h).toBeLessThanOrEqual(900);
    // a notes section the user moved stays where it was put
    slides[i].cfg.notes = { ...slides[i].cfg.notes, "slide:notes": { ...slides[i].cfg.notes!["slide:notes"]!, x: 300, y: 700 } };
    const moved = hits(build(i).nodes).find(h => /^tnote memo/.test(h.id))!;
    expect([moved.x, moved.y]).toEqual([300, 700]);
  });
  it("a title too long for the 26 pt type shrinks to fit (not under 20 pt) before it is cut, on the same baseline", async () => {
    const { slides, build } = await deck("weekly-options.json", "excel");
    const i = slides.findIndex(S => S.type === "content");
    slides[i].title = "Merges, hidden rows and columns, colours, wrapping and formats";   // 61 characters (edge-formats' kind)
    const t = textsAfter(build(i).nodes, "title")[0];
    expect(t.src).toBe(slides[i].title);
    expect(t.size).toBeLessThan(ISP.title.size);
    expect(t.size).toBeGreaterThanOrEqual(ISP.title.min);
    expect(t.x + runW(t)).toBeLessThanOrEqual(ISP.area.x + ISP.area.w + .01);
    // the baseline the 26 pt title has
    const short = textsAfter((await deck("weekly-options.json", "excel")).build(i).nodes, "title")[0];
    expect(t.y).toBeCloseTo(short.y, 6);
  });
});
