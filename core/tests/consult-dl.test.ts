/* The consulting designs' tables (consult-dl.ts, docs/next/08-consulting-designs.md §2.1 / §2.2 "Tables"): every corpus
   table in every version and both designs builds a valid display list of the eight node types in the design's fonts,
   and the recipe – rules, header band, highlights, scales, sup / sub, merges, removed cells, the workbook's drawings –
   holds on the tables that have them. A deterministic measurer, as slide-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validate, type DisplayList, type LineNode, type Node, type TextNode } from "../src/dl/types";
import { solid } from "../src/dl/color";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { cssFont, excelToDisplayList, forgetMeasurements, picNodes, primaryFamily, runsOf, shapeNodes, textBoxNodes, type Metrics } from "../src/render/excel-dl";
import { consultRows, consultTableDL, consultToDisplayList, MIN_FIT } from "../src/render/consult-dl";
import { SPECS, specOf } from "../src/render/consult-spec";
import { effItems, keyOf } from "../src/render/edits";
import { wrapLines } from "../src/text/lines";
import { resetPlatform, setPlatform } from "../src/platform";
import type { RenderCtx } from "../src/render/context";
import type { Item, Rect, TableLayout } from "../src/xlsx/types";
import type { DeckVersion, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const DESIGNS = ["mckinsey", "bain"] as const;
type CD = typeof DESIGNS[number];
const EIGHT = new Set(["rect", "path", "line", "image", "shadow", "text", "group", "hit"]);
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function deck(file: string, design: CD, extra: Op[] = []) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), [...d.ops, ...extra]).doc;
  const style = { ...resolveStyle({}, view.style), design };
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx = (version: DeckVersion | null = null): RenderCtx => ({ style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version });
  return { ctx, slides, versions: view.preset?.versions || [], edits: view.edits || {} };
}
const table = (slides: { tables: TableLayout[] }[], id: string) => slides.flatMap(R => R.tables).find(L => L.id === id)!;
/** the text nodes of each cell, by its hit's id ("r,c") */
function cellTexts(nodes: DisplayList): Map<string, TextNode[]> {
  const out = new Map<string, TextNode[]>(); let at: string | null = null;
  for (const n of nodes) {
    if (n.t === "hit") { at = n.kind === "t" ? n.id : null; if (at) out.set(at, []); continue; }
    if (at) for (const x of flat([n])) if (x.t === "text") out.get(at)!.push(x);
  }
  return out;
}
const hlines = (nodes: DisplayList) => nodes.filter((n): n is LineNode => n.t === "line" && near(n.y1, n.y2));
const vlines = (nodes: DisplayList) => nodes.filter((n): n is LineNode => n.t === "line" && near(n.x1, n.x2));
const strokeIs = (n: LineNode, s: { w: number; color: string }) => n.stroke.w === s.w && JSON.stringify(n.stroke.paint) === JSON.stringify(solid(s.color));
const filled = (nodes: DisplayList, color: string) => nodes.filter(n => (n.t === "rect" || n.t === "path") && JSON.stringify(n.fill) === JSON.stringify(solid(color)));
const top = (L: TableLayout, r: number) => L.rowY.get(r)!, bot = (L: TableLayout, r: number) => L.rowY.get(r)! + L.rowH.get(r)!;

describe("every corpus table, every version, both designs", () => {
  for (const file of fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort()) it(file, async () => {
    for (const design of DESIGNS) {
      const { ctx, slides, versions, edits } = await deck(file, design);
      const userFonts = new Set(Object.values(edits).flatMap(s => Object.values(s).flatMap(e => e.font ? [e.font] : [])));
      for (const v of [null, ...versions]) for (const R of slides) for (const L of R.tables) {
        const c = ctx(v), dl = consultToDisplayList(L, c, M), all = flat(dl.nodes), where = `${file} ${design} ${v?.id || "full"} ${L.id}`;
        expect(validate(dl.nodes), where).toEqual([]);
        expect(all.filter(n => !EIGHT.has(n.t)), where).toEqual([]);
        // fonts: the design's, the user's, the deck's table style; the workbook's text boxes and missing pictures as Excel draws them
        const ok = new Set([primaryFamily(SPECS[design].table.family), ...userFonts, ...(c.style.text?.table?.font ? [c.style.text.table.font] : []),
          ...(L.texts.length ? ["Century Gothic"] : []), ...(L.pics.some(p => p.unsupported || !p.src) ? ["Segoe UI"] : [])]);
        expect([...new Set(all.flatMap(n => n.t === "text" ? [n.font] : []))].filter(f => !ok.has(f)), where).toEqual([]);
        // no workbook fill, no workbook border: every fill is the design's or the cell's (scale, cf, user, highlight)
        const its = effItems(L, c), T = specOf(c).table;
        const fills = new Set([T.head.fill, T.highlight, T.strong.fill, ...its.flatMap(it => [it.scaleFill, it.cf?.fill, it.userBg])].filter(Boolean).map(x => JSON.stringify(solid(x!))));
        const cellFills = L.rects.length || L.texts.length ? [] : dl.nodes.filter(n => (n.t === "rect" || n.t === "path") && n.fill);
        for (const n of cellFills) expect(fills.has(JSON.stringify((n as { fill: unknown }).fill)), where).toBe(true);
        // a cell's text is drawn once, behind its hit, as excel-dl draws it
        const hitIds = all.flatMap(n => n.t === "hit" && n.kind === "t" ? [n.id] : []);
        expect(hitIds.length, where).toBe(its.filter(it => it.text).length);
      }
    }
  }, 120_000);
});

describe("snapshots (08 §5 S7b.2): any change to a consulting table's display list shows here", () => {
  it("every corpus deck × version × table × design: sha1 of its nodes", async () => {
    const snap: Record<string, string> = {};
    for (const file of fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort()) for (const design of DESIGNS) {
      const { ctx, slides, versions } = await deck(file, design);
      for (const v of [null, ...versions]) slides.forEach((R, i) => R.tables.forEach((L, j) => {
        snap[`${file.replace(/\.json$/, "")}/${v?.id || "full"}/${i}.${j}:${L.id}/${design}`] = createHash("sha1").update(JSON.stringify(consultToDisplayList(L, ctx(v), M).nodes)).digest("hex");
      }));
    }
    expect(snap).toMatchSnapshot();
  }, 120_000);
});

describe("the recipe", () => {
  it("header, body and total rules at their rows; Consulting Navy draws no verticals, no workbook fills", async () => {
    const { ctx, slides } = await deck("weekly.json", "mckinsey"), L = table(slides, "l4tsxhl"), c = ctx(), T = SPECS.mckinsey.table;
    const kind = consultRows(L, c, effItems(L, c)), rows = L.rows, k = rows.map(r => kind.get(r));
    expect(k.slice(0, 5).join(",")).toBe("header,header,spacer,total,spacer");
    const dl = consultToDisplayList(L, c, M), H = hlines(dl.nodes), at = (y: number, s: { w: number; color: string }) => H.filter(n => near(n.y1, y) && strokeIs(n, s));
    expect(at(T.top!.w / 2, T.top!).length).toBeGreaterThan(0);
    expect(at(bot(L, rows[1]) - T.head.rule!.w / 2, T.head.rule!).length).toBeGreaterThan(0);          // under the last header row
    expect(at(top(L, rows[3]) + T.totalRule.w / 2, T.totalRule).length).toBeGreaterThan(0);            // above the total
    const last = rows.filter(r => ["header", "body", "total"].includes(kind.get(r)!)).pop()!;
    expect(at(bot(L, last) - T.bottom.w / 2, T.bottom).length).toBeGreaterThan(0);
    // a hairline under each body row followed by a body row, none under the last
    for (let i = 0; i + 1 < rows.length; i++) if (k[i] === "body") expect(at(bot(L, rows[i]) - T.rowRule.w / 2, T.rowRule).length > 0, `row ${rows[i]}`).toBe(k[i + 1] === "body");
    for (const n of H) { expect(n.x1).toBeGreaterThanOrEqual(0); expect(n.x2).toBeLessThanOrEqual(L.W + 1e-6); }
    expect(vlines(dl.nodes)).toEqual([]);
    // fills: only the conditional formats' results (the workbook's own fills are gone)
    const cf = new Set(effItems(L, c).flatMap(it => it.cf?.fill ? [JSON.stringify(solid(it.cf.fill))] : []));
    for (const n of dl.nodes) if (n.t === "rect" || n.t === "path") expect(cf.has(JSON.stringify(n.fill))).toBe(true);
    // header and total rows bold, the design's family and ink
    const texts = cellTexts(dl.nodes), its = effItems(L, c);
    for (const it of its.filter(it => it.text && (kind.get(it.b.r) === "header" || kind.get(it.b.r) === "total"))) for (const t of texts.get(`${it.b.r},${it.b.c}`)!) {
      expect(t.b).toBe(true); expect(t.font).toBe("Arial");
      if (!it.nfColor && !it.cf?.color) expect(t.fill).toEqual(solid(T.ink));
    }
  });

  it("Consulting Red: a black header band with white bold text and white separators; a heavy rule above the total", async () => {
    const { ctx, slides } = await deck("weekly.json", "bain"), L = table(slides, "l4tsxhl"), c = ctx(), T = SPECS.bain.table, rows = L.rows;
    const dl = consultToDisplayList(L, c, M), its = effItems(L, c), kind = consultRows(L, c, its);
    const band = dl.nodes[0];
    expect(band).toMatchObject({ t: "rect", x: 0, y: top(L, rows[0]), w: L.W, h: bot(L, rows[1]) - top(L, rows[0]), fill: solid("#000000") });
    const texts = cellTexts(dl.nodes);
    for (const it of its.filter(it => it.text && kind.get(it.b.r) === "header")) for (const t of texts.get(`${it.b.r},${it.b.c}`)!) { expect(t.b).toBe(true); expect(t.fill).toEqual(solid("#FFFFFF")); }
    const seps = vlines(dl.nodes);
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) {
      expect(strokeIs(s, T.head.sep!)).toBe(true);
      expect(s.x1 > 0 && s.x1 < L.W).toBe(true);
      expect(s.y1 >= top(L, rows[0]) - 1e-6 && s.y2 <= bot(L, rows[1]) + 1e-6).toBe(true);
      // never through a header cell merged across columns
      for (const it of its.filter(it => kind.get(it.b.r) === "header")) if (s.y1 < it.by + it.bh - 1e-6 && s.y2 > it.by + 1e-6) expect(s.x1 > it.bx + 1e-6 && s.x1 < it.bx + it.bw - 1e-6).toBe(false);
    }
    const H = hlines(dl.nodes);
    expect(T.top).toBeNull();
    expect(H.filter(n => n.y1 < bot(L, rows[1]))).toEqual([]);                                          // no top rule, no rule in the band
    expect(H.some(n => near(n.y1, top(L, rows[3]) + T.totalRule.w / 2) && strokeIs(n, T.totalRule))).toBe(true);
  });

  it("Consulting Red: a highlighted cell on the header band draws the dark ink on its tint, a user's text colour stays", async () => {
    const { ctx: c0, slides: s0 } = await deck("weekly.json", "bain"), L0 = table(s0, "l4tsxhl"), its0 = effItems(L0, c0()), kind = consultRows(L0, c0(), its0);
    const [h1, h2] = its0.filter(it => it.text && kind.get(it.b.r) === "header");
    const { ctx, slides } = await deck("weekly.json", "bain", [
      { op: "cell.patch", sheet: L0.sheet.name, ref: keyOf(h1), patch: { fill: "#FFD60A" } } as Op,
      { op: "cell.patch", sheet: L0.sheet.name, ref: keyOf(h2), patch: { fill: "#FFD60A", color: "#00B050" } } as Op]);
    const L = table(slides, "l4tsxhl"), c = ctx(), T = specOf(c).table, texts = cellTexts(consultToDisplayList(L, c, M).nodes);
    for (const t of texts.get(`${h1.b.r},${h1.b.c}`)!) expect(t.fill).toEqual(solid(T.ink));
    for (const t of texts.get(`${h2.b.r},${h2.b.c}`)!) expect(t.fill).toEqual(solid("#00B050"));
  });

  it("a cell's role on the label cell makes its row a total / header (weekly-looks)", async () => {
    const { ctx, slides } = await deck("weekly-looks.json", "mckinsey"), L = table(slides, "l4tsxhl"), c = ctx(), its = effItems(L, c), kind = consultRows(L, c, its);
    const role = (r: string) => its.find(it => it.role === r)!;
    expect(kind.get(role("total").b.r)).toBe("total");
    expect(kind.get(role("header").b.r)).toBe("header");
    const dl = consultToDisplayList(L, c, M), T = SPECS.mckinsey.table;
    expect(hlines(dl.nodes).some(n => near(n.y1, top(L, role("total").b.r) + T.totalRule.w / 2) && strokeIs(n, T.totalRule))).toBe(true);
  });

  it("highlights: the tint under a cell; on a total row the solid accent with light bold text", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deck("weekly-options.json", design), L = table(slides, "l4tsxhl"), c = ctx(), T = specOf(c).table;
      expect(T.highlight).not.toBe(SPECS[design].table.highlight);                         // the deck's accent: its tint
      const hi = effItems(L, c).find(it => it.userFill)!;
      expect(keyOf(hi)).toBe("C10");
      const dl = consultToDisplayList(L, c, M);
      expect(filled(dl.nodes, T.highlight).length, design).toBe(1);
      expect(filled(dl.nodes, "#FFD60A")).toEqual([]);                                          // the user's highlight colour is the design's
      // a highlighted total
      const its = effItems(L, c), kind = consultRows(L, c, its), tot = its.find(it => kind.get(it.b.r) === "total" && it.text)!;
      const d2 = await deck("weekly-options.json", design, [{ op: "cell.patch", sheet: L.sheet.name, ref: keyOf(tot), patch: { fill: "#FFD60A" } } as Op]);
      const L2 = table(d2.slides, "l4tsxhl"), dl2 = consultToDisplayList(L2, d2.ctx(), M);
      const f = filled(dl2.nodes, T.strong.fill);
      expect(f.length, design).toBe(1);
      for (const t of cellTexts(dl2.nodes).get(`${tot.b.r},${tot.b.c}`)!) { expect(t.b).toBe(true); expect(t.fill).toEqual(solid(T.strong.ink)); }
    }
  });

  it("colour scales, the user's gridlines and cell colours are kept", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deck("weekly-options.json", design, [{ op: "cell.patch", sheet: "LOANS_DEPOSITS", ref: "C12", patch: { bg: "#DDEBF7" } } as Op]);
      const L = table(slides, "l4tsxhl"), c = ctx(), its = effItems(L, c), dl = consultToDisplayList(L, c, M);
      const scaled = its.filter(it => it.scaleFill && !it.userFill);
      expect(scaled.length).toBeGreaterThan(10);
      for (const it of scaled) expect(filled(dl.nodes, it.scaleFill!).length, keyOf(it)).toBeGreaterThan(0);
      expect(filled(dl.nodes, "#DDEBF7").length).toBe(1);                                   // the user's cell colour (C12)
      const bg = its.find(it => keyOf(it) === "D12")!;                                      // the user's text colour #C00000 (its #DDEBF7 is under the scale)
      expect(cellTexts(dl.nodes).get(`${bg.b.r},${bg.b.c}`)!.every(t => JSON.stringify(t.fill) === JSON.stringify(solid("#C00000")))).toBe(true);
      // gridH on, gridV off: the gridlines' grey across, never down
      const grid = (n: LineNode) => JSON.stringify(n.stroke.paint) === JSON.stringify(solid("#BFBFBF"));
      expect(hlines(dl.nodes).filter(grid).length).toBeGreaterThan(0);
      expect(vlines(dl.nodes).filter(grid)).toEqual([]);
    }
  });

  it("the bottom rule lies under the data, above trailing notes / sources (report: its last row is a note)", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deck("report.json", design), L = table(slides, "dhnms9c"), c = ctx(), T = SPECS[design].table;
      const kind = consultRows(L, c, effItems(L, c)), rows = L.rows;
      expect(kind.get(rows[rows.length - 1])).toBe("other");
      const last = rows.filter(r => ["header", "body", "total"].includes(kind.get(r)!)).pop()!, H = hlines(consultToDisplayList(L, c, M).nodes);
      expect(H.some(n => near(n.y1, bot(L, last) - T.bottom.w / 2) && strokeIs(n, T.bottom)), design).toBe(true);
      expect(H.filter(n => n.y1 > bot(L, last) + 1e-6), design).toEqual([]);
    }
  });

  it("a one-line cell too wide in Arial is drawn smaller (down to 0.7×), all its runs alike; Excel and Refined keep its size", async () => {
    let shrunk = 0;
    for (const file of ["weekly.json", "deck20.json", "edge-formats.json"]) for (const design of DESIGNS) {
      const { ctx, slides } = await deck(file, design), c = ctx();
      for (const L of slides.flatMap(R => R.tables)) {
        const its = effItems(L, c), texts = cellTexts(consultToDisplayList(L, c, M).nodes);
        const ex = cellTexts(excelToDisplayList(L, { ...c, style: { ...c.style, design: "clean" } }, M).nodes);
        for (const it of its) {
          if (!it.text || it.wrap || it.rot || it.ov) continue;
          const id = `${it.b.r},${it.b.c}`, ts = texts.get(id)!, size = +((it.font.sz || 11) * 96 / 72).toFixed(2);
          const b = ts[0].b ?? false, w0 = runsOf(it, size).reduce((s, r) => s + M.run(r.text, cssFont(r.size, ts[0].css!, b, !!it.font.i)).w, 0);
          const ind = it.indent ? 3 + it.indent * 9 : 3, avail = (it.tw || it.bw) - (it.indent ? ind : 3) - 3;
          const main = Math.max(...ts.map(t => t.size)), excelMain = Math.max(...ex.get(id)!.map(t => t.size));
          expect(excelMain, id).toBe(size);                                                    // Excel / Refined: the workbook's size
          if (w0 <= avail + .01) { expect(main, id).toBe(size); continue; }
          shrunk++;
          expect(main, id).toBeLessThan(size);
          expect(main / size, id).toBeGreaterThanOrEqual(MIN_FIT - .01);
          const w1 = ts.reduce((s, t) => s + (t.w ?? 0), 0);
          if (main / size > MIN_FIT + .01) expect(w1, id).toBeLessThanOrEqual(avail + .5);       // fits, or is clipped at 0.7×
          for (const t of ts) if (t.size < main) expect(t.size / main, id).toBeCloseTo(.62, 1);           // sup / sub keep their ratio
        }
      }
    }
    expect(shrunk).toBeGreaterThan(0);
  });
  it("with the page's measurer, the shrinking settles in a few rounds and gives the same list", async () => {
    const { ctx, slides } = await deck("weekly.json", "mckinsey"), L = table(slides, "l4tsxhl"), c = ctx();
    let rounds = 0;
    setPlatform({ text: { maxDigitWidth: () => 7, measureRuns: async runs => { rounds++; return runs.map(r => M.run(r.text, r.font)); }, breakLines: async reqs => reqs.map(q => M.lines(q.text, q.font, q.width)) } });
    try {
      forgetMeasurements();
      const dl = await consultTableDL(L, c);
      expect(rounds).toBeLessThanOrEqual(3);
      expect(dl).toEqual(consultToDisplayList(L, c, M));
    } finally { resetPlatform(); forgetMeasurements(); }
  });

  it("superscripts stay small and raised", async () => {
    const { ctx, slides } = await deck("weekly.json", "mckinsey"), L = table(slides, "l4tsxhl"), c = ctx();
    const it = effItems(L, c).find(x => x.scripts?.length)!, ts = cellTexts(consultToDisplayList(L, c, M).nodes).get(`${it.b.r},${it.b.c}`)!;
    expect(ts.length).toBeGreaterThan(1);
    const big = Math.max(...ts.map(t => t.size)), small = ts.find(t => t.size < big)!;
    expect(small.size).toBeCloseTo(big * .62, 1);
    expect(small.y).toBeLessThan(ts.find(t => t.size === big)!.y);
    expect(ts.every(t => t.font === "Arial")).toBe(true);
  });

  it("a merged cell: one text, and no rule through it", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deck("weekly-options.json", design), L = table(slides, "l4tsxhl"), c = ctx(), its = effItems(L, c);
      const m = its.find(it => keyOf(it) === "C17")!;
      expect(m.b.r2).toBeGreaterThan(m.b.r);
      const dl = consultToDisplayList(L, c, M);
      for (const n of hlines(dl.nodes)) if (n.y1 > m.by + 1 && n.y1 < m.by + m.bh - 1) expect(n.x2 <= m.bx + 1e-6 || n.x1 >= m.bx + m.bw - 1e-6, design).toBe(true);
      expect(cellTexts(dl.nodes).has(`${m.b.r},${m.b.c}`)).toBe(!!m.text);
    }
  });

  it("cells removed in a version draw empty", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides, versions } = await deck("weekly-options.json", design), L = table(slides, "l4tsxhl");
      const v = versions.find(x => x.id === "vAll")!, c = ctx(v), its = effItems(L, c), cut = its.filter(it => it.removed);
      expect(cut.length).toBeGreaterThan(0);
      const full = effItems(L, ctx()), dl = consultToDisplayList(L, c, M), texts = cellTexts(dl.nodes);
      for (const it of cut) {
        expect(texts.has(`${it.b.r},${it.b.c}`)).toBe(false);
        expect(full.find(x => keyOf(x) === keyOf(it))!.text).not.toBe("");
        expect(dl.nodes.some(n => n.t === "rect" && n.fill && near(n.x, it.bx) && near(n.y, it.by) && near(n.w, it.bw))).toBe(false);
      }
    }
  });

  it("the workbook's pictures, shapes and text boxes are drawn exactly as in Excel", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deck("edge-pictures.json", design), L = slides[0].tables[0];
      for (const forExport of [false, true]) {
        const c = { ...ctx(), forExport }, dl = consultToDisplayList(L, c, M);
        const rr = Math.round(8 * c.style.radius / 100), imgs: Record<string, string> = {};
        const tail = [...L.rects.flatMap(r => shapeNodes(r, rr)), ...(L.texts as Rect[]).flatMap(t => textBoxNodes(t, rr, M)), ...L.pics.flatMap(p => picNodes(p, forExport, imgs, M))];
        expect(tail.length).toBeGreaterThan(0);
        expect(dl.nodes.slice(-tail.length)).toEqual(tail);
        const ex = excelToDisplayList(L, { ...c, style: { ...c.style, design: "clean" } }, M);
        expect(ex.nodes.slice(-tail.length)).toEqual(tail);
        expect(dl.images).toEqual(ex.images);
        expect(flat(dl.nodes).filter(n => n.t === "hit" && n.kind === "pic").length).toBe(L.pics.length);
      }
    }
  });

  it("fonts: the user's font, else the deck's table text style, else the design's", async () => {
    const { ctx, slides } = await deck("weekly.json", "bain", [{ op: "cell.patch", sheet: "LOANS_DEPOSITS", ref: "C10", patch: { font: "Georgia" } } as Op]);
    const L = table(slides, "l4tsxhl"), c = ctx(), it = effItems(L, c).find(x => keyOf(x) === "C10")!;
    const fontOf = (cc: RenderCtx, x: Item) => cellTexts(consultToDisplayList(L, cc, M).nodes).get(`${x.b.r},${x.b.c}`)![0];
    expect(fontOf(c, it).font).toBe("Georgia");
    const other = effItems(L, c).find(x => x.text && !x.userFont)!;
    expect(fontOf(c, other).font).toBe("Arial");
    const deckFont = { ...c, style: { ...c.style, text: { ...c.style.text, table: { ...(c.style.text?.table || {}), font: "Verdana" } } } } as RenderCtx;
    expect(fontOf(deckFont, other).font).toBe("Verdana");
    expect(fontOf(deckFont, other).css).toContain("Arial");
  });
});
