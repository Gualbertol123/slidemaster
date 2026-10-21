/* The PowerPoint writer (4.5, B21; docs/next/07 §4, PX-01…PX-03): the display list → native scene (pptx/scene.ts) –
   tables from the cells' hits, text boxes and placeholders, glass surfaces as one cropped picture under shapes, shadows,
   lines, callout presets, charts –, the package (pptx/writer.ts: parts, content types, relationships, slide size,
   the master and layouts made from the slides, pictures once, the same bytes for the same slides) and the chart part
   with its embedded workbook (pptx/chart.ts), on synthetic lists and on the corpus's report deck. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import type { DisplayList, Node } from "../src/dl/types";
import { baselineIn, sceneOf, type El, type ShapeEl, type SlideSem, type TableEl } from "../src/pptx/scene";
import { writePptx } from "../src/pptx/writer";
import { chartXml, chartWorkbook } from "../src/pptx/chart";
import { E, PT } from "../src/pptx/drawingml";
import { pptxFamily } from "../src/text/resolve";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { areaFor, computeLayout } from "../src/render/layout";
import { pageNoFor } from "../src/render/pagenumbers";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op, ShapeItem } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const flat = (els: El[]): El[] => els.flatMap(e => e.k === "grp" ? [e, ...flat(e.children)] : [e]);
/** well-formed XML (strict enough for the writer's output): one root, every tag closed in order, attributes quoted,
    no bare & or < in text or attribute values */
function xmlOk(s: string): boolean {
  const body = s.replace(/^<\?xml[^?]*\?>\s*/, ""), stack: string[] = [];
  let roots = 0, at = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const between = body.slice(at, m.index);
    if (/[<]/.test(between) || /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(between + m[3])) return false;
    at = m.index! + m[0].length;
    if (m[1]) { if (stack.pop() !== m[2]) return false; }
    else { if (!stack.length) roots++; if (!m[4]) stack.push(m[2]); }
  }
  return !stack.length && roots === 1 && !/[<>]/.test(body.slice(at).trim());
}
const content: SlideSem = { type: "content", items: {}, palette: ["#1F77B4"] };
const txt = (src: string, x: number, y: number, size = 14, extra: Partial<Extract<Node, { t: "text" }>> = {}): Node =>
  ({ t: "text", font: "Arial", css: "Arial,sans-serif", size, x, y, src, w: src.length * size * .5, fill: { solid: [0, 0, 0] }, ...extra });

describe("the scene: tables (07 §4.2)", () => {
  // a table drawn at 2× from (100, 100): two columns of 50 table px, two rows of 20; the second row one merged cell
  const table: DisplayList = [
    { t: "hit", kind: "f", id: "tw", x: 100, y: 100, w: 200, h: 80 },
    { t: "group", transform: [2, 0, 0, 2, 100, 100], children: [
      { t: "rect", x: 0, y: 0, w: 50, h: 20, fill: { solid: [31, 78, 121] } },
      // a seam polygon: the fill reaching 1 px under its right neighbour
      { t: "path", d: [["M", 50, 0], ["L", 100, 0], ["L", 100, 20], ["L", 50, 20], ["L", 49, 20], ["L", 49, 0], ["Z"]], fill: { solid: [200, 0, 0] } },
      { t: "line", x1: 0, y1: 19.5, x2: 100, y2: 19.5, stroke: { w: 1, paint: { solid: [0, 0, 0] } } },
      { t: "hit", kind: "t", id: "1,1", x: 0, y: 0, w: 50, h: 20, label: "Bank" },
      { t: "group", clip: { x: 0, y: 0, w: 50, h: 20 }, children: [txt("Bank", 3, 15, 11)] },
      { t: "hit", kind: "t", id: "1,2", x: 50, y: 0, w: 50, h: 20, label: "12" },
      txt("12", 100 - 3 - 11, 15, 11),
      { t: "hit", kind: "t", id: "2,1", x: 0, y: 20, w: 100, h: 20, label: "Total" },
      txt("Total", 50 - 13.75, 35, 11),
      // text that runs past its cell (an overflowing cell): over the table, not in it
      { t: "hit", kind: "t", id: "3,1", x: 0, y: 40, w: 50, h: 20, label: "a much longer text" },
      txt("a much longer text", 3, 55, 11),
    ] },
  ];
  const els = sceneOf(table, content, () => true);
  const all = flat(els), tbl = all.find(e => e.k === "tbl") as TableEl;
  it("the grid from the cells' boxes, in slide px; merged cells span; fills (seams too) and borders on their cells", () => {
    expect(tbl.box).toEqual({ x: 100, y: 100, w: 200, h: 120 });
    expect(tbl.cols).toEqual([100, 100]);
    expect(tbl.rows).toEqual([40, 40, 40]);
    expect(tbl.cells[0][0].fill).toEqual({ solid: [31, 78, 121] });
    expect(tbl.cells[0][1].fill).toEqual({ solid: [200, 0, 0] });
    expect(tbl.cells[1][0].span).toEqual([1, 2]);
    expect(tbl.cells[1][1].merged).toBe(true);
    // the line on the first row's bottom edge: both cells' bottom and the merged cell's top, 2 px (scaled)
    expect(tbl.cells[0][0].b).toEqual({ w: 2, paint: { solid: [0, 0, 0], a: 1 } });
    expect(tbl.cells[1][0].t).toEqual({ w: 2, paint: { solid: [0, 0, 0], a: 1 } });
    // nothing of it left as a shape: fills and the line are the table's
    expect(all.filter(e => e.k === "sp" && !e.text)).toEqual([]);
  });
  it("cell texts are the cells' paragraphs: size, alignment from where they sit, margins from the padding", () => {
    const run = tbl.cells[0][0].text!.paras[0].runs[0];
    expect([run.text, run.size, tbl.cells[0][0].text!.paras[0].align]).toEqual(["Bank", 22, "l"]);
    expect(tbl.cells[0][0].mar![0]).toBe(6);                                   // 3 table px of padding × 2
    expect(tbl.cells[0][1].text!.paras[0].align).toBe("r");
    expect(tbl.cells[0][1].mar![2]).toBe(6);
    expect(tbl.cells[1][0].text!.paras[0].align).toBe("ctr");
    // a row never grows in PowerPoint: one line's pitch at most the row's height
    for (const row of tbl.cells) for (const c of row) for (const p of c.text?.paras || []) expect(p.pitch).toBeLessThanOrEqual(40);
  });
  it("a text wider than its cell stays a text box over the table, in the table's group", () => {
    expect(tbl.cells[2][0].text).toBeUndefined();
    const free = all.find(e => e.k === "sp" && e.text?.paras[0]?.runs[0]?.text === "a much longer text") as ShapeEl;
    expect(free).toBeTruthy();
    expect(els).toHaveLength(1);
    expect(els[0].k).toBe("grp");
  });
});

describe("the scene: text, pictures, shapes", () => {
  it("a title: the title placeholder, its box the element's, the first baseline where the display list has it, its text shadow", () => {
    const dl: DisplayList = [{ t: "hit", kind: "f", id: "title", x: 58, y: 20, w: 1372, h: 67.2, label: "Loans" },
      { t: "group", clip: { x: 58, y: 20, w: 1372, h: 67.2 }, children: [txt("Loans", 58, 74, 48, { decorative: true, fill: { solid: [255, 255, 255], a: .6 } }), txt("Loans", 58, 73, 48, { b: true })] }];
    const [t] = sceneOf(dl, content, () => true) as ShapeEl[];
    expect(t.ph).toBe("title");
    expect(t.text!.paras).toHaveLength(1);
    const p = t.text!.paras[0], r = p.runs[0];
    expect([r.text, r.b, p.pitch]).toEqual(["Loans", true, 67.2]);
    expect(r.shadow).toEqual({ dx: 0, dy: 1, blur: 0, c: [255, 255, 255], a: .6 });
    // PowerPoint's baseline in a 67.2 px line of a 48 px font: 0.75 of the line (measured, pptx/scene.ts)
    expect(t.box.y + t.text!.ins[1] + baselineIn(67.2, 48)).toBeCloseTo(73, 5);
  });
  it("PowerPoint's baseline rule (measured on PowerPoint 16): 0.75 S, S − 0.225 em between 0.9 and 1.2 em", () => {
    expect(baselineIn(80 * .8, 80)).toBeCloseTo(48);
    expect(baselineIn(80, 80)).toBeCloseTo(62);
    expect(baselineIn(80 * 1.15, 80)).toBeCloseTo(74);
    expect(baselineIn(80 * 1.4, 80)).toBeCloseTo(84);
  });
  it("wrapped lines are one paragraph (PowerPoint wraps it); the label's line breaks are paragraphs", () => {
    const dl: DisplayList = [{ t: "hit", kind: "f", id: "tnote", x: 100, y: 100, w: 300, h: 200, label: "One two three four\nFive" },
      txt("One two", 106, 120), txt("three four", 106, 140), txt("Five", 106, 160)];
    const [t] = sceneOf(dl, content, () => true) as ShapeEl[];
    expect(t.text!.paras.map(p => p.runs.map(r => r.text).join(""))).toEqual(["One two three four", "Five"]);
    expect(t.text!.paras[0].pitch).toBe(20);
    expect(t.text!.wrap).toBe(true);
    expect(t.text!.ins[0]).toBe(6);
  });
  it("Liquid Glass: a surface is the one blurred wallpaper cropped to its rounded box, its tint and sheens shapes of the same outline, its shadow the picture's", () => {
    const dl: DisplayList = [{ t: "shadow", x: 100, y: 100, w: 300, h: 200, r: 26, dx: 0, dy: 6, blur: 16, spread: -8, c: [20, 30, 60], a: .1 },
      { t: "group", clip: { x: 100, y: 100, w: 300, h: 200, r: 26 }, children: [
        { t: "image", id: "blur", x: 0, y: 0, w: 1600, h: 900 },
        { t: "rect", x: 100, y: 100, w: 300, h: 200, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: [255, 255, 255], a: .5 }, { o: 1, c: [255, 255, 255], a: .3 }] } },
        { t: "shadow", x: 100, y: 100, w: 300, h: 200, r: 26, dx: 0, dy: 16, blur: 32, spread: -22, c: [255, 255, 255], a: .3, inset: true },
        { t: "rect", x: 100, y: 100, w: 300, h: 200, fill: { radial: { cx: .2, cy: 0, rx: 1, ry: .8, stops: [{ o: 0, c: [255, 255, 255], a: .3 }, { o: .6, c: [255, 255, 255], a: 0 }] } } }] }];
    const els = sceneOf(dl, content, () => true);
    expect(els.map(e => e.k)).toEqual(["pic", "sp", "sp"]);
    const pic = els[0] as Extract<El, { k: "pic" }>;
    expect(pic.box).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(pic.crop).toEqual({ l: 100 / 1600, t: 100 / 900, r: 1200 / 1600, b: 600 / 900 });
    expect(pic.geom).toEqual({ prst: "roundRect", adj: { adj: 13000 } });
    expect(pic.outer).toMatchObject({ dy: 6, blur: 16, a: .1 });
    const tint = els[1] as ShapeEl;
    expect(tint.geom).toEqual({ prst: "roundRect", adj: { adj: 13000 } });
    expect(tint.inner).toMatchObject({ dy: 16, blur: 32 });
  });
  it("a sharp shadow is a shape of its own; a line is a line shape (never a connector); a turned group turns its shapes", () => {
    const dl: DisplayList = [{ t: "shadow", x: 10, y: 10, w: 100, h: 1, dx: 0, dy: 1, blur: 0, spread: 0, c: [255, 255, 255], a: .6 },
      { t: "line", x1: 10, y1: 50, x2: 300, y2: 50, stroke: { w: 2, paint: { solid: [0, 0, 255] }, dash: [2, 8] } },
      { t: "group", transform: [0, 1, -1, 0, 500, 0], children: [{ t: "rect", x: 0, y: 0, w: 100, h: 20, fill: { solid: [9, 9, 9] } }] }];
    const [sh, ln, rot] = sceneOf(dl, content, () => true) as ShapeEl[];
    expect(sh).toMatchObject({ box: { x: 10, y: 11, w: 100, h: 1 }, fill: { solid: [255, 255, 255], a: .6 } });
    expect(ln.geom).toEqual({ path: [["M", 0, 0], ["L", 290, 0]], open: true });
    expect(ln.line).toEqual({ w: 2, paint: { solid: [0, 0, 255] }, dash: [2, 8] });
    expect(rot.rot).toBeCloseTo(90);
    expect(rot.box).toMatchObject({ w: 100, h: 20 });
  });
});

/* ---- the package ---- */
function unzip(b: Uint8Array) { const z = unzipSync(b); return { z, s: (n: string) => strFromU8(z[n]) }; }
function slides(n: number, kind: (i: number) => SlideSem["type"] = i => i ? "content" : "cover"): { nodes: DisplayList; sem: SlideSem }[] {
  return Array.from({ length: n }, (_, i) => ({ sem: { ...content, type: kind(i) }, nodes: [
    { t: "image", id: "wall", x: 0, y: 0, w: 1600, h: 900 },
    { t: "rect", x: 0, y: 0, w: 1600, h: 6, fill: { solid: [5, 28, 44] } },
    { t: "hit", kind: "f", id: i ? "title" : "cv-title", x: 60, y: 20, w: 1400, h: 60, label: "Slide " + (i + 1) }, txt("Slide " + (i + 1), 60, 66, 40),
    { t: "hit", kind: "f", id: "pageno plain", x: 1500, y: 860, w: 60, h: 20, label: String(i + 1) }, txt(String(i + 1), 1540, 876, 13),
    { t: "image", id: "logo", x: 1400, y: 850, w: 80, h: 30 }] }));
}
const write = (n = 3, extra: Partial<Parameters<typeof writePptx>[0]> = {}) => writePptx({ slides: slides(n), image: id => id === "wall" ? JPEG : id === "logo" ? PNG : undefined, face: css => pptxFamily(css), title: "Weekly", design: "Excel", ...extra });

describe("the package (pptx/writer.ts)", () => {
  const bytes = write(), { z, s } = unzip(bytes), names = Object.keys(z);
  it("parts typed, relationships resolved inside the file, XML well-formed, 16:9, slides in order", () => {
    // (the check itself refuses what is not well-formed)
    for (const bad of ["<a><b></a>", "<a x=1/>", "<a>&</a>", "<a/><b/>", "<a>"]) expect(xmlOk(bad), bad).toBe(false);
    const ct = s("[Content_Types].xml");
    for (const n of names.filter(n => n !== "[Content_Types].xml")) {
      const ext = n.split(".").pop()!;
      expect(ct.includes(`PartName="/${n}"`) || ct.includes(`Extension="${ext}"`), n).toBe(true);
      if (/\.(xml|rels)$/.test(n)) expect(xmlOk(s(n)), n).toBe(true);
    }
    for (const r of names.filter(n => n.endsWith(".rels"))) {
      const base = r.replace(/_rels\/[^/]*\.rels$/, "");
      for (const m of s(r).matchAll(/Target="([^"]+)"/g)) {
        const parts = (base + m[1]).split("/"), out: string[] = [];
        for (const p of parts) if (p === "..") out.pop(); else if (p && p !== ".") out.push(p);
        expect(names, `${r} → ${m[1]}`).toContain(out.join("/"));
      }
      expect(s(r)).not.toContain("External");
    }
    const pres = s("ppt/presentation.xml");
    expect(pres).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    expect((pres.match(/<p:sldId /g) || []).length).toBe(3);
    expect(names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort()).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]);
    for (const n of names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) expect(s(n)).not.toContain("p:cxnSp");
  });
  it("the master and its layouts are made from the slides: a layout per kind of slide, its title where the slides put it", () => {
    const layouts = names.filter(n => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n)).map(s);
    expect(layouts.map(l => /<p:cSld name="([^"]+)"/.exec(l)![1])).toEqual(["Title Slide", "Title Only", "Blank"]);
    // the content layout's title: the frame the content slides' titles have (60, 20 …)
    const title = /<p:sp>.*?<p:ph type="title"\/>.*?<a:off x="(\d+)" y="(\d+)"\/>/.exec(layouts[1])!;
    expect([+title[1], +title[2]]).toEqual([E(60), Math.round(s("ppt/slides/slide2.xml").match(/<p:ph type="title"\/>.*?<a:off x="\d+" y="(\d+)"/)![1] as unknown as number)]);
    expect(s("ppt/slides/slide1.xml")).toContain('<p:ph type="ctrTitle"/>');
    expect(s("ppt/slides/slide2.xml")).toContain('<p:ph type="sldNum" sz="quarter" idx="12"/>');
    // the theme names the design and its fonts
    expect(s("ppt/theme/theme1.xml")).toContain('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Excel">');
    expect(s("ppt/theme/theme1.xml")).toContain('<a:latin typeface="Arial"/>');
  });
  it("lean (product owner, 2026-10-19): the wallpaper is the master's background, the bar every content slide shares is on their layout, each picture once", () => {
    const master = s("ppt/slideMasters/slideMaster1.xml");
    expect(master).toMatch(/<p:bg><p:bgPr><a:blipFill[^>]*><a:blip r:embed="rId\d+"\/>/);
    expect(s("ppt/slideLayouts/slideLayout2.xml")).toContain('<a:srgbClr val="051C2C"/>');
    // the content slides hold neither the wallpaper nor the bar; the cover keeps its own bar (one cover: nothing shared)
    expect(s("ppt/slides/slide2.xml")).not.toContain("051C2C");
    expect(s("ppt/slides/slide2.xml")).not.toContain("<p:bg>");
    expect(s("ppt/slides/slide1.xml")).toContain("051C2C");
    // two pictures in all: the wallpaper and the logo, each a part of its own however many slides show it
    expect(names.filter(n => n.startsWith("ppt/media/")).sort()).toEqual(["ppt/media/image1.jpeg", "ppt/media/image2.png"]);
    expect((s("ppt/slides/slide3.xml").match(/<p:pic>/g) || []).length).toBe(1);
  });
  it("the same slides give the same bytes (no clock in the file); one slide is a file too", () => {
    expect(Buffer.from(write()).equals(Buffer.from(bytes))).toBe(true);
    const one = unzip(write(1)).s;
    expect((one("ppt/presentation.xml").match(/<p:sldId /g) || []).length).toBe(1);
  });
  it("font sizes in points of the slide: px × 0.6 (1600 px are 960 pt), named not embedded", () => {
    expect(PT).toBe(.6);
    expect(s("ppt/slides/slide2.xml")).toContain('sz="2400"');                    // the 40 px title
    expect(names.some(n => /fonts?\//.test(n))).toBe(false);
  });
});

describe("fonts are named (07 §4.2): the first family PowerPoint can find", () => {
  it("system faces the PDF skips are skipped, generic ones mapped, an installed one preferred", () => {
    expect(pptxFamily(`-apple-system,"SF Pro Display","Segoe UI","Helvetica Neue",Inter,Arial,sans-serif`)).toBe("Segoe UI");
    expect(pptxFamily(`'Century Gothic','CenturyGothic','URW Gothic',Arial,sans-serif`)).toBe("Century Gothic");
    expect(pptxFamily(`Inter,Arial`, f => f === "Arial")).toBe("Arial");
    expect(pptxFamily(`Inter,Arial`, f => f === "Inter")).toBe("Inter");
    expect(pptxFamily(`sans-serif`)).toBe("Arial");
  });
});

/* ---- charts and callouts from the corpus's report deck (S9.2's items) ---- */
const PIE: ChartItem = { kind: "chart", type: "pie", values: { table: "dhnms9c", range: "D6:D11" }, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } };
const DONUT: ChartItem = { kind: "chart", type: "donut", values: { sheet: "Numbers", range: "B2:B6" }, title: "Numbers", legend: "bottom", box: { x: 60, y: 520, w: 420, h: 330 } };
const BUBBLE: ShapeItem = { kind: "shape", shape: "bubble", text: "Loans up", box: { x: 600, y: 120, w: 300, h: 120 }, tail: { x: 640, y: 300 } };
const ARROW: ShapeItem = { kind: "shape", shape: "arrow", text: "Next", fill: "#0B2A6F", box: { x: 600, y: 400, w: 300, h: 80 } };
async function report(design: Design) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const items = { pie: PIE, donut: DONUT, bubble: BUBBLE, arrow: ARROW };
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: "u9t3fqb", id, patch }) as Op)];
  const { doc: view } = applyOps(emptyDoc("W.xlsx"), ops);
  const style = resolveStyle({}, { ...view.style, design });
  const sl = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides: sl, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const R = sl[0], boxes = computeLayout(R, ctx).boxes;
  const dl = slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true });
  const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
  return { wb, dl, sem };
}

describe("charts (S11.3, PX-03): native pie and donut charts with their data", () => {
  it("the core says what each chart is: its cells' values and labels, the colours drawn, the card alone (no slice drawn twice)", async () => {
    const { wb, sem } = await report("clean");
    const pie = sem.items.pie, donut = sem.items.donut;
    if (pie?.kind !== "chart" || donut?.kind !== "chart") throw new Error("no chart semantics");
    const S = wb.sheets.find(s => s.name === "SLIDE_1")!;
    // D6:D11 of the table's sheet: the numbers, as the cells hold them
    // (hidden rows skipped, as the chart skips them)
    const cells = [6, 7, 8, 9, 10, 11].filter(r => !S.rowHidden(r)).map(r => S.get(r, 4)).filter(c => c && c.t === "n").map(c => c!.v);
    expect(pie.chart.values).toEqual(cells);
    expect(pie.chart.type).toBe("pie");
    expect(pie.chart.show).toEqual(["label", "percent"]);
    expect(pie.chart.colors).toHaveLength(cells.length);
    expect(donut.chart.type).toBe("donut");
    expect(donut.chart.title).toBe("Numbers");
    expect(donut.chart.legend).toBe("bottom");
    // Excel Refined's card: shadows and a white rounded box, no path (the slices are the chart's)
    expect(pie.card.some(n => n.t === "path")).toBe(false);
    expect(pie.card.some(n => n.t === "rect")).toBe(true);
  });
  it("the chart part: c:pieChart / c:doughnutChart, each point's colour, the cached labels and values, the embedded workbook Edit Data opens", async () => {
    const { sem } = await report("excel");
    const pie = sem.items.pie;
    if (pie?.kind !== "chart") throw new Error("no chart");
    const x = chartXml(pie.chart, "rId1", css => pptxFamily(css));
    expect(xmlOk(x)).toBe(true);
    expect(x).toContain("<c:pieChart><c:varyColors val=\"1\"/>");
    expect((x.match(/<c:dPt>/g) || []).length).toBe(pie.chart.values.length);
    expect(x).toContain(`<c:ptCount val="${pie.chart.values.length}"/>`);
    // the cache in Excel's 15 significant digits
    const cached = [...x.matchAll(/<c:numCache>.*?<\/c:numCache>/g)][0][0].match(/<c:v>([^<]+)<\/c:v>/g)!.map(v => +v.slice(5, -6));
    cached.forEach((v, i) => expect(v).toBeCloseTo(pie.chart.values[i], 6));
    expect(x).toContain('<c:showCatName val="1"/>'); expect(x).toContain('<c:showPercent val="1"/>');
    expect(x).toContain('<c:externalData r:id="rId1">');
    const book = unzipSync(chartWorkbook(pie.chart)), sheet = strFromU8(book["xl/worksheets/sheet1.xml"]);
    expect(Object.keys(book).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const inBook = sheet.match(/<v>([^<]+)<\/v>/g)!.map(v => +v.slice(3, -4));
    inBook.forEach((v, i) => expect(v).toBeCloseTo(pie.chart.values[i], 6));
    expect(xmlOk(sheet)).toBe(true);
  });
  it("in the file: a chart frame per chart, its part and embedding related, typed; the slide's table a real table", async () => {
    const { dl, sem } = await report("glass");
    const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => PNG, face: css => pptxFamily(css) });
    const { z, s } = unzip(bytes), names = Object.keys(z);
    expect(names.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(2);
    expect(names.filter(n => /^ppt\/embeddings\/.+\.xlsx$/.test(n))).toHaveLength(2);
    expect(s("[Content_Types].xml")).toContain('PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"');
    const slide = s("ppt/slides/slide1.xml");
    expect((slide.match(/<c:chart /g) || []).length).toBe(2);
    expect(slide).toContain("<a:tbl>");
    expect(slide).toContain('<a:tableStyleId>{2D5ABB26-0587-4C30-8999-92F81FD0307C}</a:tableStyleId>');
    expect(s("ppt/slides/_rels/slide1.xml.rels")).toContain('Target="../charts/chart1.xml"');
    // the same bytes again, the charts' embedded workbooks included (no clock in any zip)
    const again = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => PNG, face: css => pptxFamily(css) });
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("review fixes (S11.1–S11.3)", () => {
  it("a chart's label inside a dark slice is white at its centre; a thin slice's label outside, in the ink", async () => {
    const { sem } = await report("excel");
    const pie = sem.items.pie;
    if (pie?.kind !== "chart") throw new Error("no chart");
    const ch = { ...pie.chart, values: [90, 2, 8], labels: ["A", "B", "C"], colors: ["#051C2C", "#051C2C", "#FFFFFF"] };
    const x = chartXml(ch, "rId1", css => pptxFamily(css)), lbl = x.match(/<c:dLbl>[\s\S]*?<\/c:dLbl>/g)!;
    expect(lbl).toHaveLength(3);
    expect(lbl[0]).toContain('<c:dLblPos val="ctr"/>'); expect(lbl[0]).toContain('val="FFFFFF"');
    expect(lbl[1]).toContain('<c:dLblPos val="outEnd"/>'); expect(lbl[1]).not.toContain('val="FFFFFF"/></a:solidFill><a:latin');
  });
  it("a cell text left out of the table is drawn over it; a second translucent fill does not replace an opaque one", () => {
    const dl: DisplayList = [{ t: "hit", kind: "f", id: "tw", x: 0, y: 0, w: 200, h: 40 }, { t: "group", children: [
      { t: "rect", x: 0, y: 0, w: 100, h: 20, fill: { solid: [0, 0, 200] } },
      { t: "hit", kind: "t", id: "1,1", x: 0, y: 0, w: 100, h: 20, label: "a much longer header than its cell" },
      txt("a much longer header than its cell", 3, 15, 11),
      { t: "rect", x: 0, y: 0, w: 100, h: 20, fill: { solid: [255, 255, 0], a: .3 } },
      { t: "hit", kind: "t", id: "1,2", x: 100, y: 0, w: 100, h: 20, label: "x" }, txt("x", 103, 15, 11)] }];
    const g = sceneOf(dl, content, () => true)[0] as Extract<El, { k: "grp" }>;
    const order = g.children.map(e => e.k === "tbl" ? "TABLE" : e.k === "sp" && e.text ? "text" : e.k);
    expect(order.indexOf("TABLE")).toBeLessThan(order.indexOf("text"));
    const tbl = g.children.find(e => e.k === "tbl") as TableEl;
    expect(tbl.cells[0][0].fill).toEqual({ solid: [0, 0, 200] });
    // the translucent fill left out is drawn over the table, as it is over the cell's own fill
    const tint = g.children.findIndex(e => e.k === "sp" && !e.text && !!e.fill && "solid" in e.fill && e.fill.a === .3);
    expect(tint).toBeGreaterThan(g.children.findIndex(e => e.k === "tbl"));
  });
  it("a capsule's 1 px highlight is the capsule's inner shadow, not a shape of its own", () => {
    const dl: DisplayList = [{ t: "group", clip: { x: 10, y: 10, w: 60, h: 16, r: 8 }, children: [
      { t: "rect", x: 10, y: 10, w: 60, h: 16, fill: { solid: [52, 199, 89] } }, { t: "rect", x: 10, y: 10, w: 60, h: 1, fill: { solid: [255, 255, 255], a: .55 } }] }];
    const els = sceneOf(dl, content, () => true) as ShapeEl[];
    expect(els).toHaveLength(1);
    expect(els[0].inner).toEqual({ dx: 0, dy: 1, blur: 0, c: [255, 255, 255], a: .55 });
  });
});

describe("callouts (S11.2): preset shapes holding their text", () => {
  it("a bubble is wedgeRoundRectCallout with its tail; an arrow rightArrow; each with its text inside", async () => {
    const { dl, sem } = await report("excel");
    const els = flat(sceneOf(dl.nodes, sem, () => true));
    const bubble = els.find(e => e.k === "sp" && "prst" in e.geom && e.geom.prst === "wedgeRoundRectCallout") as ShapeEl;
    const arrow = els.find(e => e.k === "sp" && "prst" in e.geom && e.geom.prst === "rightArrow") as ShapeEl;
    expect(bubble.text!.paras[0].runs.map(r => r.text).join("")).toBe("Loans up");
    // the tail's tip as the preset's adjustments: its offset from the centre in 1/100 000 of the box
    expect((bubble.geom as { adj: Record<string, number> }).adj).toMatchObject({ adj1: Math.round((640 - 750) / 300 * 100000), adj2: Math.round((300 - 180) / 120 * 100000) });
    expect(arrow.text!.paras[0].runs[0].text).toBe("Next");
    expect(arrow.fill).toEqual({ solid: [11, 42, 111] });
    // the text stays in the shape: no text box of its own over it
    expect(els.filter(e => e.k === "sp" && e.text?.paras[0]?.runs[0]?.text === "Next")).toHaveLength(1);
  });
});

/* ---- a slide with no tables (S13.3, 09 §2.8: New slide; blank slides and added tables must export, VER-3) ---- */
const BLANK: Op = { op: "slide.add", slide: { id: "nb1", type: "content", title: "New slide", tables: [] }, after: "index1" };
const PILL: Op = { op: "item.patch", slide: "nb1", id: "k1", patch: { kind: "shape", shape: "pill", text: "Next steps", box: { x: 200, y: 300, w: 400, h: 120 } } };
const PN: Op = { op: "style.patch", patch: { pn: { on: true, format: "n", start: 1 } } };
async function weekly(design: Design, extra: Op[]) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "weekly-options.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), [...d.ops, ...extra]);
  expect(skipped).toEqual([]);
  const style = { ...resolveStyle({}, view.style), design }, sl = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides: sl, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const draw = (i: number) => { const R = sl[i], boxes = computeLayout(R, ctx).boxes; return slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }); };
  return { sl, ctx, draw };
}
const texts = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? texts(n.children) : []);
const hits = (ns: Node[]): Extract<Node, { t: "hit" }>[] => ns.flatMap(n => n.t === "hit" ? [n] : n.t === "group" ? hits(n.children) : []);

describe("a slide with no tables (S13.3, 09 §2.8): lays out, draws and exports in every design", () => {
  it("computeLayout returns the title area, the content area and the items' boxes (no table box)", async () => {
    const { sl, ctx } = await weekly("excel", [BLANK, PILL]);
    const R = sl.find(s => s.id === "nb1")!, L = computeLayout(R, ctx);
    expect(R.tables).toEqual([]); expect(R.title).toBe("New slide");
    expect(L.boxes).toEqual([]);
    expect(L.area).toEqual(areaFor(R, ctx));
    expect(L.title).toEqual({ x: L.area!.x, y: 0, w: L.area!.w, h: L.area!.y });
    expect(L.items).toEqual({ k1: { x: 200, y: 300, w: 400, h: 120 } });
    // a blank slide without items: no item boxes, the areas still there
    const { sl: s2, ctx: c2 } = await weekly("glass", [BLANK]);
    const L2 = computeLayout(s2.find(s => s.id === "nb1")!, c2);
    expect([L2.boxes, L2.items]).toEqual([[], {}]);
    expect(L2.area!.h).toBeGreaterThan(600);
  });
  for (const design of ["glass", "excel", "clean", "mckinsey", "bain"] as Design[]) it(design + ": the display list holds the title and the item; the PowerPoint slide has its title and no table", async () => {
    const { sl, draw } = await weekly(design, [BLANK, PILL]);
    const i = sl.findIndex(s => s.id === "nb1"), dl = draw(i);
    expect(texts(dl.nodes).join(" ")).toContain("New slide");
    expect(dl.items.k1).toBeDefined();
    const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
    const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => PNG, face: css => pptxFamily(css) });
    const { s } = unzip(bytes), slide = s("ppt/slides/slide1.xml");
    expect(xmlOk(slide)).toBe(true);
    expect(slide).not.toContain("<a:tbl>");
    expect(slide).toContain(">New slide<");
    expect(slide).toContain(">Next steps<");
  });
  it("slide numbers and the contents slide follow added and removed slides (their positions in the slide list)", async () => {
    const pn = (ctx: RenderCtx, id: string) => pageNoFor(ctx, ctx.slides.findIndex(s => s.id === id));
    const before = await weekly("excel", [PN]);
    expect(pn(before.ctx, "p2knyyz")).toBe("3");
    const added = await weekly("excel", [PN, BLANK]);
    expect(added.sl.map(s => s.id)).toEqual(["cover1", "index1", "nb1", "p2knyyz"]);
    expect([pn(added.ctx, "nb1"), pn(added.ctx, "p2knyyz")]).toEqual(["3", "4"]);
    // the contents slide lists the new slide first (01, page 3), the old one second (02, page 4)
    const ix = added.draw(1);
    expect(hits(ix.nodes).filter(h => h.id === "ix-n").map(h => h.label)).toEqual(["01", "02"]);
    expect(texts(ix.nodes)).toEqual(expect.arrayContaining(["New slide", "3", "4"]));
    const removed = await weekly("excel", [PN, BLANK, { op: "slide.remove", id: "nb1" }]);
    expect(pn(removed.ctx, "p2knyyz")).toBe("3");
    expect(hits(removed.draw(1).nodes).filter(h => h.id === "ix-n").map(h => h.label)).toEqual(["01"]);
  });
});
