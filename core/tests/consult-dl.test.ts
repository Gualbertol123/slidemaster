/* The consulting designs' tables (consult-dl.ts) in every option (designs.ts consultOptions): tables "exhibit" (exhibit.ts:
   numbers "full" – every cell's number in tabular columns, the graphics beside them – or "compact" – Navy's "Insight
   board", Red's "Signal" concepts), "cards" (the Liquid Glass scene in flat materials, consult-cards.ts) and "rules" (the
   workbook's layout ruled, consult-rules.ts); and the clean typographic table for what does not read as an exhibit. Every
   corpus table in every version and both designs builds a valid list of the eight node types in the design's font, with
   a hit at every drawn value's box; Liquid Glass, Excel and Excel Refined are unchanged. A deterministic measurer. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validate, type DisplayList, type HitNode, type LineNode, type Node, type PathNode, type RectNode, type TextNode } from "../src/dl/types";
import { solid } from "../src/dl/color";
import { excelToDisplayList, forgetMeasurements, type Metrics } from "../src/render/excel-dl";
import { consultTableDL, consultToDisplayList } from "../src/render/consult-dl";
import { flatCap, flatShell } from "../src/render/consult-cards";
import { glassGeom, glassPlan } from "../src/render/glass";
import type { RenderCtx } from "../src/render/context";
import type { ConsultOptions } from "../src/model/designs";
import { SPECS } from "../src/render/consult-spec";
import { EXF, EXG, EXT, exhibitGeom, exhibitLayout } from "../src/render/exhibit";
import { glassToDisplayList } from "../src/render/glass-dl";
import { computeLayout, geomOf, tableH, tableW } from "../src/render/layout";
import { wrapLines } from "../src/text/lines";
import { resetPlatform, setPlatform } from "../src/platform";
import { deckOf } from "./corpus-deck";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks");
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const DESIGNS = ["mckinsey", "bain"] as const;
const EIGHT = new Set(["rect", "path", "line", "image", "shadow", "text", "group", "hit"]);
const FILES = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort();
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const near = (a: number, b: number, e = .02) => Math.abs(a - b) <= e;
const same = (p: unknown, c: string) => JSON.stringify(p) === JSON.stringify(solid(c));
const sha = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex");
/** a drawing context with the consulting options set */
const withOpts = (c: RenderCtx, o: Partial<ConsultOptions>): RenderCtx => ({ ...c, style: { ...c.style, consult: { ...(c.style.consult || {}), ...o } } } as RenderCtx);
const hits = (l: DisplayList) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === "t");
/** the text nodes after each cell's hit, by "r,c" */
function cellTexts(nodes: DisplayList): Map<string, TextNode[]> {
  const out = new Map<string, TextNode[]>(); let at: string | null = null;
  for (const n of nodes) {
    if (n.t === "hit") { at = n.kind === "t" ? n.id : null; if (at && !out.has(at)) out.set(at, []); continue; }
    if (at && n.t === "text") out.get(at)!.push(n);
  }
  return out;
}

describe("every corpus table, every version, both designs", () => {
  for (const file of FILES) it(file, async () => {
    for (const design of DESIGNS) {
      const { ctx, slides, versions } = await deckOf(file, design);
      for (const v of [null, ...versions]) for (const R of slides) for (const L of R.tables) {
        const c = ctx(v), dl = consultToDisplayList(L, c, M), all = flat(dl.nodes), g = exhibitGeom(L, c), lay = exhibitLayout(L, c)!, where = `${file} ${design} ${v?.id || "full"} ${L.id}`;
        expect(validate(dl.nodes), where).toEqual([]);
        expect(all.filter(n => !EIGHT.has(n.t)), where).toEqual([]);
        // the design's font (a plain table's workbook text boxes as Excel draws them)
        const fonts = new Set(all.flatMap(n => n.t === "text" ? [n.font] : []));
        expect([...fonts].filter(f => f !== "Arial" && !(L.texts.length && f === "Century Gothic")), where).toEqual([]);
        // the geometry the slide lays out and the page hit-tests with
        expect(tableW(L, c), where).toBe(g.W); expect(tableH(L, c), where).toBe(g.H);
        if (lay.ex.kind === "exhibit") {
          // a hit at every drawn value, at its box
          for (const h of hits(dl.nodes)) { const b = g.boxes.get(h.id)!; expect(b, `${where} ${h.id}`).toBeTruthy(); expect([h.x, h.y, h.w, h.h].every((x, k) => near(x, [b.x, b.y, b.w, b.h][k])), `${where} ${h.id}`).toBe(true); }
          const drawn = new Set(hits(dl.nodes).map(h => h.id));
          for (const k of g.boxes.keys()) expect(drawn.has(k), `${where} ${k}`).toBe(true);
          expect(dl.images).toEqual({});
          for (const n of all) if (n.t === "rect") { expect(n.x).toBeGreaterThanOrEqual(-.01); expect(n.x + n.w, where).toBeLessThanOrEqual(g.W + .01); }
        }
      }
    }
  }, 120_000);
});

describe("snapshots", () => {
  it("every consulting table: sha1 of its nodes", async () => {
    const snap: Record<string, string> = {};
    for (const file of FILES) for (const design of DESIGNS) {
      const { ctx, slides, versions } = await deckOf(file, design);
      for (const v of [null, ...versions]) slides.forEach((R, i) => R.tables.forEach((L, j) => { snap[`${file.replace(/\.json$/, "")}/${v?.id || "full"}/${i}.${j}:${L.id}/${design}`] = sha(consultToDisplayList(L, ctx(v), M).nodes); }));
    }
    expect(snap).toMatchSnapshot();
  }, 120_000);
  it("Liquid Glass, Excel and Excel Refined are unchanged by the consulting designs", async () => {
    const snap: Record<string, string> = {};
    for (const file of FILES) {
      const gl = await deckOf(file, "glass");
      for (const L of gl.slides.flatMap(R => R.tables)) snap[`${file.replace(/\.json$/, "")}/${L.id}`] = sha(glassToDisplayList(L, gl.ctx(), { x: 0, y: 0, scale: 1 }, null, M).nodes);
      for (const d of ["excel", "clean"] as const) { const x = await deckOf(file, d); for (const L of x.slides.flatMap(R => R.tables)) { snap[`${file.replace(/\.json$/, "")}/${L.id}/${d}`] = sha(excelToDisplayList(L, x.ctx(), M).nodes); expect(tableW(L, x.ctx())).toBe(L.W); expect(tableH(L, x.ctx())).toBe(L.H); } }
    }
    expect(snap).toMatchSnapshot();
  }, 120_000);
});

describe("numbers compact · Consulting Navy · Insight board (deck20)", () => {
  it("heads, rule, labels, latest values, references, trend lines, diverging bars with their %, the total band", async () => {
    const { ctx, slides } = await deckOf("deck20.json", "mckinsey"), L = slides[0].tables[0], c = withOpts(ctx(), { numbers: "compact" }), g = exhibitLayout(L, c)!, ex = g.ex;
    const dl = consultToDisplayList(L, c, M), texts = cellTexts(dl.nodes), N = SPECS.mckinsey.table.head.ink, B = SPECS.mckinsey.accent;
    expect(g.cols.map(k => k.kind)).toEqual(["label", "latest", "trend", "ref", "dbar", "dbar", "dbar", "dbar", "dbar"]);
    // workbook scale: the table's rows (deck20: 20 px → a 22 px pitch), so two exhibits fit a slide at a scale near 1
    expect(g.pitch).toBe(22);
    expect(g.H).toBe(EXG.mckinsey.head + 12 * g.pitch);
    expect(g.W).toBeGreaterThan(1100); expect(g.W).toBeLessThan(1300); expect(g.H).toBeLessThan(310);
    // heads: small capitals, letter-spaced, grey (a head wider than its column on two lines); a navy rule under them
    const heads = dl.nodes.filter((n): n is TextNode => n.t === "text" && n.size === EXT.head);
    expect(heads.map(h => h.src)).toEqual(["WEEK39", "WEEK37–", "WEEK39", "EOM BUDGET", "Δ VS BUDGET", "Δ VS PREV. WEEK", "Δ VS EOM AUG 2026", "Δ VS Q2", "Δ VS BOY"]);
    expect(heads.every(h => h.b && h.ls === EXT.ls && same(h.fill, "#5B6B7A"))).toBe(true);
    expect(dl.nodes.some(n => n.t === "rect" && n.y === EXG.mckinsey.rule && n.h === 1.5 && same(n.fill, N))).toBe(true);
    const vub = ex.rows[0], cy = g.tops.get(vub.r)! + g.pitch / 2;
    expect(texts.get(`${vub.label!.r},${vub.label!.c}`)![0]).toMatchObject({ src: "VUB", size: EXT.text, b: true });
    const latest = texts.get(`${vub.r},6`)![0], lc = g.cols[1];
    expect(latest.src).toBe("2.037"); expect(near(latest.x + latest.w!, lc.x + lc.w)).toBe(true);           // right-aligned
    expect(same(texts.get(`${vub.r},7`)![0].fill, "#0E2238")).toBe(true);                                    // the budget in the dark ink (round 4)
    // the trend: three points rising, an end dot
    const paths = dl.nodes.filter((n): n is PathNode => n.t === "path" && !!n.stroke && same(n.stroke.paint, B));
    expect(paths.length).toBe(11);
    const pts = paths[0].d.map(p => p as [string, number, number]);
    expect(pts.length).toBe(3);
    expect(pts[0][2]).toBeGreaterThan(pts[1][2]); expect(pts[1][2]).toBeGreaterThan(pts[2][2]);           // 2.007 < 2.025 < 2.037: up
    expect(near(pts[0][2] - pts[2][2], EXG.mckinsey.sparkH)).toBe(true);
    // a 1 px axis per Δ column and body row; bars: blue up, red down, length ∝ |abs| / the column's max
    const axes = dl.nodes.filter((n): n is LineNode => n.t === "line" && same(n.stroke.paint, "#C9D3DF"));
    expect(axes.length).toBe(5 * 11);
    const bud = g.cols[4], cx = bud.x + bud.w / 2, bars = dl.nodes.filter((n): n is RectNode => n.t === "rect" && n.h === EXG.mckinsey.barH);
    const vubBar = bars.find(b => near(b.y + b.h / 2, cy) && near(b.x + b.w, cx))!;                         // −69: left of the axis
    expect(same(vubBar.fill, "#D93025")).toBe(true);
    expect(near(vubBar.w, 69 / 90 * EXG.mckinsey.half)).toBe(true);                                         // the column's max |abs|: Alex +90
    const alexCy = g.tops.get(ex.rows[3].r)! + g.pitch / 2, alex = bars.find(b => near(b.y + b.h / 2, alexCy) && near(b.x, cx))!;
    expect(same(alex.fill, B)).toBe(true); expect(near(alex.w, EXG.mckinsey.half)).toBe(true);
    // its label: the % beside the bar's end, red when negative
    const pct = texts.get(`${vub.r},9`)![0];
    expect(pct.src).toBe("-3,3%"); expect(same(pct.fill, "#D93025")).toBe(true); expect(near(pct.x + pct.w!, vubBar.x - 4)).toBe(true);
    // EximBank: no budget → "–" and no bar
    const ex9 = g.tops.get(ex.rows[9].r)! + g.pitch / 2;
    expect(bars.some(b => near(b.y + b.h / 2, ex9) && (near(b.x, cx) || near(b.x + b.w, cx)))).toBe(false);
    // the total: a pale band under a navy rule, "abs · %" bold, red when negative
    const ty = g.tops.get(ex.total!.r)!;
    expect(dl.nodes.some(n => n.t === "rect" && n.y === ty && n.h === g.pitch && same(n.fill, "#E4EBF3"))).toBe(true);
    expect(dl.nodes.some(n => n.t === "rect" && n.y === ty && n.h === 1.5 && same(n.fill, N))).toBe(true);
    const tt = dl.nodes.filter((n): n is TextNode => n.t === "text" && n.b === true && / · /.test(n.src));
    expect(tt.map(t => t.src)).toEqual(["-43 · -0,1%", "+192 · +0,2%", "+454 · +0,6%", "+565 · +0,7%", "+3.245 · +4,4%"]);
    expect(same(tt[0].fill, "#D93025") && same(tt[1].fill, "#0E2238")).toBe(true);
    // the total's cells keep their hits (the abs and the % halves of the column)
    const th = hits(dl.nodes).filter(h => h.id.startsWith(ex.total!.r + ","));
    expect(th.map(h => h.id)).toEqual(expect.arrayContaining([`${ex.total!.r},8`, `${ex.total!.r},9`, `${ex.total!.r},4`, `${ex.total!.r},5`, `${ex.total!.r},6`]));
  });
});

describe("numbers compact · Consulting Red · Signal (deck20)", () => {
  it("grey bars for the latest period, the first two variances as dark / red bars, the others as % texts, the total under a black rule", async () => {
    const { ctx, slides } = await deckOf("deck20.json", "bain"), L = slides[0].tables[0], c = withOpts(ctx(), { numbers: "compact" }), g = exhibitLayout(L, c)!, ex = g.ex;
    const dl = consultToDisplayList(L, c, M), texts = cellTexts(dl.nodes), RED = SPECS.bain.accent;
    expect(g.cols.map(k => k.kind)).toEqual(["label", "latest", "dbar", "dbar", "dpct", "dpct", "dpct"]);
    expect(g.W / 980).toBeLessThanOrEqual(1 / .85);                                                       // its 980-px column at a scale ≥ 0.85
    const lc = g.cols[1], grey = dl.nodes.filter((n): n is RectNode => n.t === "rect" && same(n.fill, "#E3E3E3"));
    expect(grey.length).toBe(11);
    ex.rows.forEach((r, i) => expect(near(grey[i].w, r.cells.get(6)!.v! / 12037 * EXG.bain.bar)).toBe(true));       // ∝ value / the column's max
    expect(grey.every(b => near(b.x, lc.x))).toBe(true);
    const vub = ex.rows[0], n = texts.get(`${vub.r},6`)![0];
    expect(n.src).toBe("2.037"); expect(near(n.x, lc.x + grey[0].w + 6)).toBe(true);
    const bars = dl.nodes.filter((x): x is RectNode => x.t === "rect" && x.h === EXG.bain.barH && !same(x.fill, "#E3E3E3"));
    expect(new Set(bars.map(b => JSON.stringify(b.fill)))).toEqual(new Set([JSON.stringify(solid("#4A4A4A")), JSON.stringify(solid(RED))]));
    // the first variance's labels bold, the second's not; red when negative
    const a = texts.get(`${vub.r},8`)![0], b = texts.get(`${vub.r},10`)![0];
    expect(a).toMatchObject({ src: "-69", b: true }); expect(same(a.fill, RED)).toBe(true);
    expect(b.src).toBe("+12"); expect(b.b).toBeUndefined(); expect(same(b.fill, "#1A1A1A")).toBe(true);
    // the % columns: right-aligned, bold, red when negative (Pravex −0,1% vs BoY)
    const p = texts.get(`${ex.rows[10].r},17`)![0], pc = g.cols[6];
    expect(p).toMatchObject({ src: "-0,1%", b: true }); expect(same(p.fill, RED)).toBe(true); expect(near(p.x + p.w!, pc.x + pc.w)).toBe(true);
    const ty = g.tops.get(ex.total!.r)!;
    expect(dl.nodes.some(x => x.t === "rect" && x.y === ty && x.h === 2 && same(x.fill, "#1A1A1A"))).toBe(true);
    expect(same(texts.get(`${ex.total!.r},8`)![0].fill, RED)).toBe(true);
    expect(texts.get(`${ex.total!.r},6`)![0]).toMatchObject({ src: "77.407", b: true, size: EXT.totalRed });
    // the total's label whole at this size (the label column is as wide as it needs, within the design's range)
    const lab = texts.get(`${ex.total!.r},${ex.labelCol}`)![0];
    expect(lab.src).toBe("TOTAL BANKS LOANS (1)"); expect(lab.x + lab.w!).toBeLessThanOrEqual(g.cols[1].x);
  });
});

describe("numbers full (default): every cell's number, the graphics beside them", () => {
  for (const design of DESIGNS) it(`${design} · deck20: every series period, reference, absolute and % shown, right-aligned, red when negative`, async () => {
    const { ctx, slides } = await deckOf("deck20.json", design), L = slides[0].tables[0], c = ctx(), g = exhibitLayout(L, c)!, ex = g.ex, F = EXF[design];
    expect(g.numbers).toBe("full");
    const dl = consultToDisplayList(L, c, M), texts = cellTexts(dl.nodes), navy = design === "mckinsey";
    const ink = navy ? "#0E2238" : "#1A1A1A", neg = navy ? "#D93025" : SPECS.bain.accent, pct = navy ? "#4E5B66" : "#555555";
    const numCols = g.cols.filter(k => k.kind === "num");
    expect(numCols.map(k => k.col)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);       // nothing hidden
    for (const r of [...ex.rows, ex.total!]) for (const k of numCols) {
      const x = r.cells.get(k.col!)!, t = texts.get(`${x.r},${x.c}`)!;
      expect(t.length, `${x.r},${x.c}`).toBe(1);
      expect(t[0].src).toBe(x.text.trim() || "–");
      expect(t[0].size).toBe(EXT.text);
      if (x.v !== null) {
        expect(near(t[0].x + t[0].w!, k.x + k.w - 2), `${x.r},${x.c}`).toBe(true);                      // right-aligned in its column
        expect(same(t[0].fill, x.v < 0 ? neg : k.role === "pct" ? pct : ink), `${x.r},${x.c}`).toBe(true);
        expect(!!t[0].b).toBe(r.kind === "total");
      }
    }
    // the lanes: Navy every variance, Red the first two; the bars centred on their axes, height 8
    const lanes = g.cols.filter(k => k.kind === "lane");
    expect(lanes.length).toBe(navy ? 5 : 2);
    expect(lanes.every(k => k.w === F.lane)).toBe(true);
    const bars = dl.nodes.filter((n): n is RectNode => n.t === "rect" && n.h === F.barH);
    const vubCy = g.tops.get(ex.rows[0].r)! + g.pitch / 2, lane = lanes[0], cx = lane.x + lane.w / 2;
    const vub = bars.find(b => near(b.y + b.h / 2, vubCy) && near(b.x + b.w, cx))!;                         // −69: left of the axis
    expect(vub).toBeTruthy(); expect(same(vub.fill, navy ? "#D93025" : SPECS.bain.accent)).toBe(true);
    expect(near(vub.w, 69 / 90 * (lane.w / 2 - 3))).toBe(true);
    expect(dl.nodes.filter(n => n.t === "line").length).toBe(lanes.length * 11);                           // an axis per lane and body row
    // heads: the group's title over the group, "Abs." / "%" over their numbers; the dates under the weeks
    const heads = dl.nodes.filter((n): n is TextNode => n.t === "text" && n.size === EXT.head).map(n => n.src);
    expect(heads).toEqual(expect.arrayContaining(["WEEK37", "11/09/26", "WEEK39", "25/09/26", "Δ VS. BUDGET", "ABS.", "%", "Δ VS. BOY"]));
    expect(heads.filter(h => h === "ABS.").length).toBe(5);
    if (navy) {
      // the trend after the last period; the total on its band under the navy rule
      const tr = g.cols.find(k => k.kind === "trend")!;
      expect(g.cols.indexOf(tr)).toBe(g.cols.findIndex(k => k.role === "latest") + 1);
      expect(dl.nodes.filter(n => n.t === "path" && !!n.stroke).length).toBe(12);
      expect(dl.nodes.some(n => n.t === "rect" && same(n.fill, "#E4EBF3") && n.h === g.pitch)).toBe(true);
    } else {
      // the latest period's value as a light band under its number, ∝ value
      const lat = g.cols.find(k => k.role === "latest")!, band = dl.nodes.filter((n): n is RectNode => n.t === "rect" && same(n.fill, "#E3E3E3"));
      expect(band.length).toBe(11);
      ex.rows.forEach((r, i) => expect(near(band[i].w, r.cells.get(6)!.v! / 12037 * (lat.w - 4))).toBe(true));
      expect(band.every(b => near(b.x, lat.x))).toBe(true);
      expect(g.W / 980).toBeLessThanOrEqual(1 / .75);                                                     // its 980-px column at ≥ 0.75
    }
    // no table background: the slide's tint shows (only bands, bars, rules and hairlines are drawn)
    expect(dl.nodes.filter((n): n is RectNode => n.t === "rect" && n.w === g.W && n.h > g.pitch)).toEqual([]);
  });

  it("deck20 still fits two tables per slide readably (Navy ≥ 0.8, Red ≥ 0.75)", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deckOf("deck20.json", design), boxes = computeLayout(slides[0], ctx()).boxes;
      expect(boxes.length).toBe(2);
      for (const b of boxes) expect(b.scale, design).toBeGreaterThanOrEqual(design === "mckinsey" ? .8 : .75);
    }
  });
});

describe("options: tables cards and rules, numbers compact", () => {
  const OPTS: Partial<ConsultOptions>[] = [{ tables: "exhibit", numbers: "full" }, { tables: "exhibit", numbers: "compact" }, { tables: "cards" }, { tables: "rules" }];
  for (const file of ["deck20.json", "weekly-options.json"]) for (const design of DESIGNS) it(`${file} ${design}: every option validates, eight node types, its geometry`, async () => {
    const { ctx, slides, versions } = await deckOf(file, design);
    for (const o of OPTS) for (const v of [null, ...versions]) for (const L of slides.flatMap(R => R.tables)) {
      const c = withOpts(ctx(v), o), dl = consultToDisplayList(L, c, M), all = flat(dl.nodes), where = `${file} ${design} ${JSON.stringify(o)} ${L.id}`;
      expect(validate(dl.nodes), where).toEqual([]);
      expect(all.filter(n => !EIGHT.has(n.t)), where).toEqual([]);
      const geom = geomOf(c);
      expect(geom).toBe(o.tables === "cards" ? "scene" : o.tables === "rules" ? "workbook" : "exhibit");
      if (geom === "scene") { expect(tableW(L, c)).toBe(glassGeom(L, c).W); expect(tableH(L, c)).toBe(L.H); }
      else if (geom === "workbook") { expect(tableW(L, c)).toBe(L.W); expect(tableH(L, c)).toBe(L.H); }
      else { const g = exhibitGeom(L, c); expect(tableW(L, c)).toBe(g.W); expect(tableH(L, c)).toBe(g.H); for (const h of hits(dl.nodes)) expect(g.boxes.has(h.id), `${where} ${h.id}`).toBe(true); }
      // flat: no gradients, no wallpaper
      expect(all.filter(n => (n.t === "rect" || n.t === "path") && n.fill && !("solid" in n.fill)), where).toEqual([]);
      if (o.tables !== "rules") expect(new Set(all.flatMap(n => n.t === "text" ? [n.font] : [])), where).toEqual(new Set(["Arial"]));
    }
  }, 120_000);

  it("cards: the scene's shells, capsules and inks in look.flat", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deckOf("weekly-options.json", design), c = withOpts(ctx(), { tables: "cards" }), L = slides.flatMap(R => R.tables).find(t => t.id === "l4tsxhl")!;
      const F = SPECS[design].look.flat, plan = glassPlan(L, c), dl = consultToDisplayList(L, c, M), all = flat(dl.nodes);
      expect(plan.shells.length).toBeGreaterThan(0);
      for (const s of plan.shells) expect(all.some(n => n.t === "rect" && same(n.fill, flatShell(s, F).fill)), s.cls).toBe(true);
      for (const cap of plan.caps) expect(all.some(n => n.t === "rect" && same(n.fill, flatCap(cap, F).fill)), cap.cls).toBe(true);
      expect(all.some(n => n.t === "shadow")).toBe(true);
      expect(hits(dl.nodes).length).toBe(plan.texts.length);
      expect(await consultTableDL(L, c)).toEqual(consultToDisplayList(L, c, (await import("../src/render/excel-dl")).roughMetrics));
    }
  });

  it("rules: horizontal rules, the header band (Red), signal chips, the workbook's geometry", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deckOf("weekly.json", design), c = withOpts(ctx(), { tables: "rules" }), L = slides[0].tables[0], T = SPECS[design].table;
      const dl = consultToDisplayList(L, c, M), all = flat(dl.nodes);
      expect(all.filter(n => n.t === "line" && near(n.x1, n.x2) && same(n.stroke.paint, T.bottom.color) && n.stroke.w === T.bottom.w).length).toBe(0);   // no verticals in the ink
      expect(all.some(n => n.t === "line" && near(n.y1, n.y2) && n.stroke.w === T.rowRule.w && same(n.stroke.paint, T.rowRule.color))).toBe(true);
      if (design === "bain") expect(all.some(n => n.t === "rect" && same(n.fill, T.head.fill!) && n.w === L.W)).toBe(true);
      const K = SPECS[design].look.chips;
      expect(all.some(n => n.t === "rect" && n.r === K.r && (same(n.fill, K.pos.fill) || same(n.fill, K.neg.fill)))).toBe(true);
      expect(hits(dl.nodes).length).toBe(L.items.filter(it => it.text).length);
    }
  });

  it("snapshots of every option on deck20 and weekly-options", async () => {
    const snap: Record<string, string> = {};
    for (const file of ["deck20.json", "weekly-options.json"]) for (const design of DESIGNS) {
      const { ctx, slides } = await deckOf(file, design);
      for (const o of OPTS) slides.forEach((R, i) => R.tables.forEach((L, j) => { snap[`${file.replace(/\.json$/, "")}/${i}.${j}/${design}/${o.tables}${o.numbers ? "-" + o.numbers : ""}`] = sha(consultToDisplayList(L, withOpts(ctx(), o), M).nodes); }));
    }
    expect(snap).toMatchSnapshot();
  }, 120_000);
});

describe("plain tables and measuring", () => {
  it("a table that is not an exhibit: the workbook's geometry, grey bold heads over a rule, hairlines, no bars, no fills", async () => {
    for (const design of DESIGNS) {
      const { ctx, slides } = await deckOf("report.json", design), L = slides[0].tables[0], c = ctx(), g = exhibitLayout(L, c)!, dl = consultToDisplayList(L, c, M);
      expect(g.ex.kind).toBe("plain");
      expect(exhibitGeom(L, c)).toMatchObject({ W: L.W, H: L.H });
      const rects = dl.nodes.filter((n): n is RectNode => n.t === "rect");
      expect(rects.every(r => r.h <= 1.5)).toBe(true);                                                   // rules and hairlines only
      expect(dl.nodes.filter(n => n.t === "line" || n.t === "path")).toEqual([]);
      const t = cellTexts(dl.nodes), head = [...t.values()].flat().find(x => x.src === "Loans")!;
      expect(head.b).toBe(true);
      expect(hits(dl.nodes).length).toBe(L.items.filter(it => it.text).length);
    }
  });

  it("with the page's measurer, the build settles in a few rounds and gives the same list", async () => {
    const { ctx, slides } = await deckOf("deck20.json", "mckinsey"), L = slides[0].tables[0], c = ctx();
    let rounds = 0;
    setPlatform({ text: { maxDigitWidth: () => 7, measureRuns: async runs => { rounds++; return runs.map(r => M.run(r.text, r.font)); }, breakLines: async reqs => reqs.map(q => M.lines(q.text, q.font, q.width)) } });
    try {
      forgetMeasurements();
      const dl = await consultTableDL(L, c);
      expect(rounds).toBeLessThanOrEqual(3);
      expect(dl).toEqual(consultToDisplayList(L, c, M));
    } finally { resetPlatform(); forgetMeasurements(); }
  });
});
