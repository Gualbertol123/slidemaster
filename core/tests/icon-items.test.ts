/* S15.2 · Icon items (09 §2.4, §3.5, §4.3; IC-01, IC-02, CL-01 + Tabler icons): a shape item of shape "icon" with a
   "tabler:" / "tabler-filled:" name draws the vendored icon with display-list nodes only – outline paths stroked
   `stroke × size / 24` wide with round caps and joins, filled ones filled – in all five designs; a name the set does not
   have draws "info" and gives an Issues line; the 17 built-in icons draw exactly as before. PowerPoint: each icon is a
   native custom-geometry shape (a:custGeom), never a picture or a preset. The picker's search and tiles
   (render/icon-search.ts) run over the registered set (tests/setup-icons.ts registers it as the workers do).
   PPTX_OUT=dir writes the PowerPoint file of the five designs there (tools/pptxcheck.py check). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validate, type Node, type PathNode } from "../src/dl/types";
import { toSvg } from "../src/dl/svg";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import { ICON_NAMES, iconCmds } from "../src/render/icons";
import { iconId, iconSearch, iconTiles, svgD } from "../src/render/icon-search";
import { sceneOf, type El, type ShapeEl, type SlideSem } from "../src/pptx/scene";
import { writePptx } from "../src/pptx/writer";
import { pptxFamily } from "../src/text/resolve";
import { tabler, tablerLoaded } from "../src/icons";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op, ShapeItem } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const SLIDE = "u9t3fqb";
async function build(design: Design, items: Record<string, ShapeItem>) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: SLIDE, id, patch }) as Op)];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const R = ctx.slides[0], boxes = computeLayout(R, ctx).boxes;
  const dl = slideToDisplayList(R, 0, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true });
  const sem: SlideSem = { type: "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] };
  return { dl, sem };
}
const icon = (name: string, extra: Partial<ShapeItem> = {}): ShapeItem => ({ kind: "shape", shape: "icon", icon: name, box: { x: 700, y: 400, w: 96, h: 96 }, ...extra });
const nodesOf = (dl: Awaited<ReturnType<typeof build>>["dl"], id: string) => dl.nodes.slice(dl.items[id].at[0], dl.items[id].at[1]);
const paths = (ns: Node[]) => ns.filter((n): n is PathNode => n.t === "path");
const flat = (els: El[]): El[] => els.flatMap(e => e.k === "grp" ? [e, ...flat(e.children)] : [e]);

describe("icon items on the slide (IC-02, CL-01: every design, display-list nodes only)", () => {
  it("an outline Tabler icon: stroked paths, width stroke × size / 24, round caps and joins, no fill, in the design's ink – in all five designs", async () => {
    const inks = new Set<string>();
    for (const design of DESIGNS) {
      const { dl } = await build(design, { a: icon("tabler:building-bank"), b: icon("tabler:target", { stroke: 1, box: { x: 300, y: 300, w: 48, h: 72 } }) });
      expect(validate(dl.nodes), design).toEqual([]);
      const a = nodesOf(dl, "a"), b = nodesOf(dl, "b");
      expect(a[0]).toMatchObject({ t: "hit", kind: "item", id: "a" });
      expect(a.slice(1).every(n => n.t === "path"), design).toBe(true);           // nothing but paths: no image, no text
      const pa = paths(a), pb = paths(b);
      expect(pa.length).toBe(tabler().icon("outline", "building-bank")!.length);
      for (const p of pa) { expect(p.fill).toBeUndefined(); expect(p.stroke).toMatchObject({ w: 8, cap: "round", join: "round" }); }   // 2 × 96 / 24
      for (const p of pb) expect(p.stroke!.w).toBe(2);                                                                                  // 1 × 48 / 24 (the square in the box)
      expect(dl.items.a.issue).toBeNull();
      const ink = pa[0].stroke!.paint;
      if (!("solid" in ink)) throw new Error("not solid");
      inks.add(ink.solid.join(","));
      // the icon sits in its box's square, centred
      const xs = pb.flatMap(p => p.d.flatMap(c => c[0] === "Z" ? [] : c.slice(1).filter((_, k) => k % 2 === 0) as number[]));
      const ys = pb.flatMap(p => p.d.flatMap(c => c[0] === "Z" ? [] : c.slice(1).filter((_, k) => k % 2 === 1) as number[]));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(300); expect(Math.max(...xs)).toBeLessThanOrEqual(348);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(312); expect(Math.max(...ys)).toBeLessThanOrEqual(360);
      expect(toSvg(dl.nodes, { imageHref: () => undefined })).toContain('stroke-linejoin="round"');
    }
    expect(inks.size).toBeGreaterThan(1);                                         // the designs' inks differ (consulting: the accent)
  });
  it("a filled Tabler icon: filled paths; the item's fill colours it; its text colour does when no fill is set", async () => {
    const { dl } = await build("excel", { f: icon("tabler-filled:star", { fill: "#C42B1C" }), g: icon("tabler-filled:heart", { fmt: { color: "#1E8E3E" } }) });
    const pf = paths(nodesOf(dl, "f")), pg = paths(nodesOf(dl, "g"));
    expect(pf.length).toBeGreaterThan(0);
    for (const p of pf) { expect(p.stroke).toBeUndefined(); expect(p.fill).toEqual({ solid: [196, 43, 28] }); }
    for (const p of pg) expect(p.fill).toEqual({ solid: [30, 142, 62] });
  });
  it("stroke (09 §2.4: 1–3 at 24, default 2) is clamped; an old name of the release's alias table draws its icon", async () => {
    const { dl } = await build("clean", { lo: icon("tabler:target", { stroke: .2 }), hi: icon("tabler:target", { stroke: 9 }), mid: icon("tabler:target", { stroke: 2.5 }) });
    expect(paths(nodesOf(dl, "lo"))[0].stroke!.w).toBe(4);
    expect(paths(nodesOf(dl, "hi"))[0].stroke!.w).toBe(12);
    expect(paths(nodesOf(dl, "mid"))[0].stroke!.w).toBe(10);
    // "2fa" is the release's old name of auth-2fa
    expect(tabler().oldNames("auth-2fa")).toContain("2fa");
    const { dl: d2 } = await build("excel", { o: icon("tabler:2fa") });
    expect(d2.items.o.issue).toBeNull();
    expect(paths(nodesOf(d2, "o")).length).toBe(tabler().icon("outline", "auth-2fa")!.length);
  });
  it("a name the set does not have draws the built-in “info” and gives the Issues line (no silent stand-in)", async () => {
    const { dl } = await build("glass", { x: icon("tabler:no-such-icon-anywhere"), y: icon("not-an-icon") });
    for (const id of ["x", "y"]) {
      const p = paths(nodesOf(dl, id));
      expect(p).toHaveLength(1);
      expect(p[0].rule).toBe("evenodd");
      expect(p[0].d).toEqual(iconCmds("info", 700, 400, 4));
    }
    expect(dl.items.x.issue).toBe("the icon “tabler:no-such-icon-anywhere” is not in the icon set");
    expect(dl.items.y.issue).toBe("the icon “not-an-icon” is not in the icon set");
  });
  it("the 17 built-in icons draw exactly as before (one even-odd filled path of the built-in outline)", async () => {
    const items = Object.fromEntries(ICON_NAMES.map((n, k) => [n, icon(n, { box: { x: 100 + k * 80, y: 600, w: 64, h: 64 } })]));
    const { dl, sem } = await build("excel", items);
    ICON_NAMES.forEach((n, k) => {
      const ns = nodesOf(dl, n);
      expect(ns).toHaveLength(2);
      expect(ns[1]).toEqual({ t: "path", d: iconCmds(n, 100 + k * 80, 600, 64 / 24), fill: { solid: [22, 24, 29] }, rule: "evenodd" });
      expect(dl.items[n].issue).toBeNull();
      expect(sem.items[n]).not.toHaveProperty("icon");
    });
  });
});

describe("icons in PowerPoint (09 §4.3): native custom geometry, never a picture", () => {
  it("outline: one custGeom shape of open paths (fill none), a:ln with round caps and joins at the drawn width, noFill", async () => {
    const { dl, sem } = await build("excel", { a: icon("tabler:building-bank") });
    expect(sem.items.a).toMatchObject({ kind: "shape", shape: "icon", icon: "tabler" });
    const els = flat(sceneOf(dl.nodes, sem, () => true));
    const shapes = els.filter((e): e is ShapeEl => e.k === "sp" && e.name === "Icon");
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    if ("prst" in s.geom) throw new Error("a preset");
    expect(s.geom.parts!.length).toBe(tabler().icon("outline", "building-bank")!.length);
    expect(s.geom.parts!.every(p => p.stroke && !p.fill)).toBe(true);
    expect(s.fill).toBeNull();
    expect(s.line).toMatchObject({ w: 8, cap: "round", join: "round" });
    const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => undefined, face: css => pptxFamily(css) });
    const z = unzipSync(bytes), slide = strFromU8(z["ppt/slides/slide1.xml"]);
    const sp = slide.match(/<p:sp>(?:(?!<p:sp>).)*?name="Icon \d+"[\s\S]*?<\/p:sp>/)![0];
    expect(sp).toContain("<a:custGeom>");
    expect(sp).not.toContain("prstGeom");
    expect((sp.match(/<a:path /g) || []).length).toBe(s.geom.parts!.length);
    expect((sp.match(/<a:path [^>]*fill="none"/g) || []).length).toBe(s.geom.parts!.length);
    expect(sp).toMatch(/<a:ln w="\d+" cap="rnd"><a:solidFill>[\s\S]*?<a:round\/><\/a:ln>/);
    expect(sp).toMatch(/<\/a:custGeom><a:noFill\/>/);
    expect(Object.keys(z).some(n => /^ppt\/media\//.test(n))).toBe(false);
    expect(slide).not.toContain("<p:pic>");
    expect(slide).not.toContain("<p:cxnSp>");
  });
  it("filled: solidFill, no line; an outline icon's filled dots share its one shape (a:path stroke and fill flags)", async () => {
    // an outline icon with stroked paths and filled ones (its dots)
    const mixed = tabler().names.find(n => { const p = tabler().icon("outline", n); return !!p && p.some(x => x.paint.fill) && p.some(x => !x.paint.fill) && p.every(x => x.paint.alpha === 1); })!;
    expect(mixed).toBeTruthy();
    const { dl, sem } = await build("excel", { f: icon("tabler-filled:star"), d: icon("tabler:" + mixed, { box: { x: 200, y: 200, w: 48, h: 48 } }) });
    const els = flat(sceneOf(dl.nodes, sem, () => true)).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Icon");
    expect(els).toHaveLength(2);
    const [f, d] = els;
    expect(f.fill).toEqual({ solid: [22, 24, 29] }); expect(f.line).toBeNull();
    if ("prst" in d.geom) throw new Error("a preset");
    // every path a part of the one shape, with its own fill flag; the shape has both a fill and a line
    const want = tabler().icon("outline", mixed)!;
    expect(d.geom.parts!.map(p => [p.fill, p.stroke])).toEqual(want.map(p => [p.paint.fill, p.paint.stroke]));
    expect(d.fill).not.toBeNull(); expect(d.line).not.toBeNull();
    const bytes = writePptx({ slides: [{ nodes: dl.nodes, sem }], image: () => undefined, face: css => pptxFamily(css) });
    const slide = strFromU8(unzipSync(bytes)["ppt/slides/slide1.xml"]);
    expect((slide.match(/<a:custGeom>/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(slide).not.toContain("<p:pic>");
  });
  it("paths that differ in ink (a half-ink path) are separate shapes of one group named Icon", async () => {
    const half = "brand-parsinta";
    expect(tabler().icon("outline", half)!.some(p => p.paint.alpha < 1)).toBe(true);
    const { dl, sem } = await build("excel", { h: icon("tabler:" + half) });
    const top = sceneOf(dl.nodes, sem, () => true).filter(e => e.name === "Icon");
    expect(top).toHaveLength(1);
    expect(top[0].k).toBe("grp");
    const kids = flat(top).filter((e): e is ShapeEl => e.k === "sp");
    expect(kids.length).toBeGreaterThan(1);
    expect(kids.every(k => !("prst" in k.geom))).toBe(true);
  });
  it("every design: icons are custGeom shapes, the file has no picture of an icon (PPTX_OUT writes it for pptxcheck)", async () => {
    const slides = [];
    for (const design of DESIGNS) {
      const { dl, sem } = await build(design, { a: icon("tabler:building-bank"), f: icon("tabler-filled:star", { box: { x: 820, y: 400, w: 96, h: 96 } }), b: icon("target", { box: { x: 940, y: 400, w: 96, h: 96 } }), x: icon("tabler:nope-nope", { box: { x: 1060, y: 400, w: 96, h: 96 } }) });
      const els = flat(sceneOf(dl.nodes, sem, () => true)).filter((e): e is ShapeEl => e.k === "sp" && e.name === "Icon");
      expect(els.length, design).toBe(2);
      expect(els.every(e => !("prst" in e.geom)), design).toBe(true);
      slides.push({ nodes: dl.nodes, sem });
    }
    const bytes = writePptx({ slides, image: () => new Uint8Array(0), face: css => pptxFamily(css), title: "Icons", design: "Excel" });
    if (process.env.PPTX_OUT) fs.writeFileSync(path.join(process.env.PPTX_OUT, "icons-5-designs.pptx"), bytes);
    const z = unzipSync(bytes);
    for (let k = 1; k <= DESIGNS.length; k++) {
      const s = strFromU8(z[`ppt/slides/slide${k}.xml`]);
      expect((s.match(/name="Icon \d+"/g) || []).length).toBe(2);
    }
  });
});

describe("the picker's search and tiles (IC-01; render/icon-search.ts, in the worker)", () => {
  it("searches names and tags in one set and category, best first; tiles of the first hits and of the recent ids", () => {
    // `cold` (the bench's first use, 09 §7.4): whether the set was not inflated before this search
    const wasLoaded = tablerLoaded();
    const a = iconSearch({ query: "bank", style: "outline", category: null, draw: 10, also: ["tabler-filled:star", "target", "tabler:zzz-none"] })!;
    expect(a.cold).toBe(!wasLoaded);
    expect(iconSearch({ query: "bank", style: "outline", category: null, draw: 0 })!.cold).toBe(false);
    expect(a.categories.length).toBe(41);
    expect(a.names[0]).toBe("building-bank");
    expect(a.names.length).toBeGreaterThan(1);
    expect(Object.keys(a.tiles)).toEqual(expect.arrayContaining([...a.names.slice(0, 10).map(n => iconId("outline", n)), "tabler-filled:star", "target", "tabler:zzz-none"]));
    expect(a.tiles["tabler:zzz-none"]).toEqual({ id: "tabler:zzz-none", paths: [], missing: true });
    expect(a.tiles.target.paths[0]).toMatchObject({ fill: true, evenodd: true });
    const t = a.tiles["tabler:building-bank"];
    expect(t.paths.every(p => p.stroke && /^M[\d. -]+/.test(p.d))).toBe(true);
    expect(t.paths.map(p => p.d)).toEqual(tabler().icon("outline", "building-bank")!.map(p => svgD(p.d)));
    // a category narrows; the filled set has its own names
    const cat = tabler().category("building-bank")!;
    const c = iconSearch({ query: "", style: "outline", category: cat, draw: 0 })!;
    expect(c.names.length).toBeGreaterThan(0);
    expect(c.names.every(n => tabler().category(n) === cat)).toBe(true);
    expect(Object.keys(c.tiles)).toEqual([]);
    const f = iconSearch({ query: "star", style: "filled", category: null, draw: 5 })!;
    expect(f.names.every(n => tabler().has("filled", n))).toBe(true);
    expect(Object.keys(f.tiles).every(id => id.startsWith("tabler-filled:"))).toBe(true);
    // everything: the whole outline set; an unknown category is ignored
    expect(iconSearch({ query: "", style: "outline", category: "No such", draw: 0 })!.names.length).toBe(5184);
    expect(iconSearch({ query: "", style: "filled", category: null, draw: 0 })!.names.length).toBe(1054);
  });
  it("tiles by id (the grid as it scrolls): at most 400, missing ones said", () => {
    const t = iconTiles(["tabler:home", "tabler-filled:home", "bank", "nope"]);
    expect(t["tabler:home"].paths.length).toBeGreaterThan(0);
    expect(t["tabler-filled:home"].paths.every(p => p.fill)).toBe(true);
    expect(t.bank.paths).toHaveLength(1);
    expect(t.nope.missing).toBe(true);
    expect(Object.keys(iconTiles(tabler().names.slice(0, 500).map(n => "tabler:" + n))).length).toBeLessThanOrEqual(400);
  });
});
