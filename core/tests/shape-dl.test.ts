/* Callouts (S9.4, docs/next/07 §3, CL-01, CL-02): every shape and icon in every design – valid nodes, the item's hit
   first, the design's material (Liquid Glass's glass card, Excel's framed box, Excel Refined's card, the consulting
   outline) – and the text with its cell references replaced by the cells' texts (their number formats, cell edits, a
   scenario's view), #REF and the Issues line for one that cannot be read. Same corpus loader and measurer as
   chart-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type DisplayList, type Node, type PathNode, type TextNode } from "../src/dl/types";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { presetSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { bubbleCmds, calloutText, shapeNodes } from "../src/render/shape-dl";
import { ICON_NAMES, iconCmds } from "../src/render/icons";
import { glassVars } from "../src/render/glass-dl";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op, ShapeItem } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const r1 = (v: number) => Math.round(v * 10) / 10;
const summary = (l: DisplayList): unknown[] => l.map(n => n.t === "path" ? ["path", n.d.length, JSON.stringify(n.fill ?? null), n.stroke ? n.stroke.w : 0, n.rule ?? ""]
  : n.t === "text" ? ["text", n.src, r1(n.x), r1(n.y), n.size, n.weight, JSON.stringify(n.fill)] : n.t === "rect" ? ["rect", r1(n.x), r1(n.y), r1(n.w), r1(n.h), n.r ?? 0, JSON.stringify(n.fill ?? null), n.stroke ? JSON.stringify(n.stroke) : ""]
  : n.t === "group" ? ["group", n.clip ? "clip" : "", summary(n.children)] : n.t === "hit" ? ["hit", n.kind, n.id] : [n.t]);

const box = { x: 600, y: 200, w: 360, h: 140 };
async function setup(design: Design, items: Record<string, ShapeItem> = {}) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const ops = [...d.ops, ...Object.entries(items).map(([id, patch]) => ({ op: "item.patch", slide: "u9t3fqb", id, patch }) as Op)];
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design });
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (c = ctx) => { const R = c.slides[0], b = computeLayout(R, c).boxes; return slideToDisplayList(R, 0, c, R.tables.map(L => excelToDisplayList(L, c, M)), b, { wall: null, logo: null }, M, "1 October 2026"); };
  return { wb, ctx, view, build, env: { V: glassVars(ctx), wall: null } };
}
const part = (l: DisplayList, id: string) => { const k = l.findIndex(n => n.t === "hit" && n.kind === "item" && n.id === id); const e = l.findIndex((n, j) => j > k && n.t === "hit" && (n.kind === "item" || /^logo/.test(n.id))); return l.slice(k, e < 0 ? undefined : e); };

describe("cell references in a callout's text (CL-02)", () => {
  it("a cell's text as the workbook shows it, through ctx.sheet; a sheet on no slide; #REF for what cannot be read", async () => {
    const { ctx, view } = await setup("excel");
    expect(calloutText("Loans {SLIDE_1!D6} · {Numbers!B9} · {'Numbers'!B11}", ctx)).toEqual({ text: "Loans 1.234.568 · 1.235 € · 25%", missing: [] });
    expect(calloutText("{Gone!A1} and {Hidden data!A1}", ctx)).toEqual({ text: "#REF and #REF", missing: ["Gone!A1", "Hidden data!A1"] });
    expect(calloutText("{SLIDE_1!$D$6} {not a ref} {SLIDE_1!D0}", ctx)).toEqual({ text: "1.234.568 {not a ref} #REF", missing: ["SLIDE_1!D0"] });
    // a callout's sheets are read with the deck (presetSheets)
    const { doc } = applyOps(view, [{ op: "item.patch", slide: "u9t3fqb", id: "k", patch: { kind: "shape", shape: "pill", text: "{Numbers!B9} {[Peers.xlsx]Peer!E5}", box } } as Op]);
    expect(presetSheets(doc.preset)).toEqual(expect.arrayContaining(["Numbers", "[Peers.xlsx]Peer"]));
  });
  it("a cell edit's text; a scenario's view of the sheet (another sheet object)", async () => {
    const { ctx, wb } = await setup("excel");
    const edited: RenderCtx = { ...ctx, edits: { SLIDE_1: { C6: { text: "Alfa", orig: "Alpha" } } } };
    expect(calloutText("{SLIDE_1!C6}", edited).text).toBe("Alfa");
    const S = wb.sheets.find(s => s.name === "SLIDE_1")!, view = Object.create(S) as Sheet;
    view.get = (r: number, c: number) => r === 6 && c === 3 ? { ...S.get(r, c)!, v: "Bank C" } : S.get(r, c);
    expect(calloutText("{SLIDE_1!C6}", { ...ctx, sheet: n => n === "SLIDE_1" ? view : ctx.sheet!(n), scenario: "x" }).text).toBe("Bank C");
  });
});

describe("shapes and icons in every design (CL-01)", () => {
  const SHAPES: ShapeItem["shape"][] = ["rect", "round", "circle", "pill", "arrow", "bubble"];
  for (const design of DESIGNS) it(`${design}: every shape with text, every icon – valid nodes, the item's hit first`, async () => {
    const items: Record<string, ShapeItem> = {};
    SHAPES.forEach((s, i) => { items["s" + i] = { kind: "shape", shape: s, text: "Total {SLIDE_1!D6}", box: { x: 60 + (i % 3) * 500, y: 160 + Math.floor(i / 3) * 330, w: s === "circle" ? 220 : 420, h: s === "circle" ? 220 : 160 } }; });
    ICON_NAMES.forEach((n, i) => { items["i" + i] = { kind: "shape", shape: "icon", icon: n, box: { x: 40 + i * 90, y: 800, w: 60, h: 60 } }; });
    const { build } = await setup(design, items), dl = build();
    expect(validate(dl.nodes)).toEqual([]);
    for (const id of Object.keys(items)) expect(dl.items[id], id).toMatchObject({ issue: null });
    for (const [i] of SHAPES.entries()) {
      const p = part(dl.nodes, "s" + i);
      expect(p[0]).toMatchObject({ t: "hit", kind: "item", id: "s" + i });
      expect(flat(p).filter((n): n is TextNode => n.t === "text").map(t => t.src).join(" ")).toContain("1.234.568");
    }
    expect(summary(part(dl.nodes, "s0"))).toMatchSnapshot("rect");
    expect(summary(part(dl.nodes, "s5"))).toMatchSnapshot("bubble");
    expect(summary(part(dl.nodes, "i0"))).toMatchSnapshot("icon");
  });
  it("the design's material when no fill is set: glass in Liquid Glass, a framed white box in Excel, a card in Excel Refined, an accent outline for a consulting circle", async () => {
    const round: ShapeItem = { kind: "shape", shape: "round", text: "x", box };
    const g = await setup("glass"), gl = shapeNodes(round, "k", box, g.ctx, { V: g.env.V, wall: { blurId: "wb", blurSrc: "data:" } });
    const grp = gl.nodes.find(n => n.t === "group");
    expect(grp && grp.t === "group" && grp.children[0]).toMatchObject({ t: "image", id: "wb" });
    const x = await setup("excel"), xl = shapeNodes(round, "k", box, x.ctx, x.env).nodes.find(n => n.t === "rect")!;
    expect(xl).toMatchObject({ fill: { solid: [255, 255, 255] }, stroke: { w: 1, paint: { solid: [191, 191, 191] } } });
    const c = await setup("clean"), cl = shapeNodes(round, "k", box, c.ctx, c.env).nodes;
    expect(cl.filter(n => n.t === "shadow")).toHaveLength(2);
    const n = await setup("mckinsey"), circ = shapeNodes({ ...round, shape: "circle" }, "k", { ...box, w: 140 }, n.ctx, n.env).nodes.find(z => z.t === "rect")!;
    expect(circ).toMatchObject({ stroke: { w: 2, paint: { solid: [34, 81, 255] } } });
    expect("fill" in circ).toBe(false);
  });
  it("own fill, border and text: a dark fill takes white text; border dashed; none removes fill and border", async () => {
    const { ctx, env, build } = await setup("excel", { k: { kind: "shape", shape: "rect", text: "Note", fill: "#0A2A66", border: { color: "#CC0000", w: 2, dash: "dashed" }, box } });
    const out = shapeNodes(ctx.slides[0].cfg.items!.k as ShapeItem, "k", box, ctx, env), r = out.nodes.find(n => n.t === "rect")!;
    expect(r).toMatchObject({ fill: { solid: [10, 42, 102] }, stroke: { w: 2, dash: [6, 4] } });
    expect(out.ink).toBe("#FFFFFF");
    expect(flat(part(build().nodes, "k")).find(n => n.t === "text")).toMatchObject({ src: "Note", fill: { solid: [255, 255, 255] } });
    const bare = shapeNodes({ kind: "shape", shape: "rect", fill: "none", border: { color: "#000000", w: 0 }, box }, "b", box, ctx, env);
    expect(bare.nodes.filter(n => n.t !== "hit")).toEqual([]);
  });
  it("a bubble's tail leaves the edge facing its tip; a missing reference: #REF on the slide and the Issues line", async () => {
    const d = bubbleCmds(0, 0, 200, 100, 10, { x: 260, y: 50 });
    expect(d.some(c => c[0] === "L" && c[1] === 260 && c[2] === 50)).toBe(true);
    const { build } = await setup("clean", { k: { kind: "shape", shape: "bubble", text: "Peers {Nowhere!B2}", box } });
    const dl = build();
    expect(dl.items.k.issue).toBe("Nowhere!B2 not found");
    expect(flat(part(dl.nodes, "k")).filter((n): n is TextNode => n.t === "text").map(t => t.src).join(" ")).toContain("#REF");
  });
  it("icons: 17 built-in outlines of M, L, C, Z commands inside their 24-unit grid", () => {
    expect(ICON_NAMES).toHaveLength(17);
    for (const n of ICON_NAMES) {
      const d = iconCmds(n, 0, 0, 1), p: PathNode = { t: "path", d, fill: { solid: [0, 0, 0] }, rule: "evenodd" };
      expect(validate([p]), n).toEqual([]);
      for (const c of d) for (const v of c.slice(1) as number[]) { expect(v, n).toBeGreaterThanOrEqual(0); expect(v, n).toBeLessThanOrEqual(24); }
    }
  });
});

describe("callouts from a shared document and in their surroundings (review S9.4)", () => {
  it("an icon name that is not the set's own (toString, constructor) and a border colour that is not a string draw safely", async () => {
    for (const design of DESIGNS) {
      const { build } = await setup(design, {
        a: { kind: "shape", shape: "icon", icon: "toString", box },
        b: { kind: "shape", shape: "icon", icon: "constructor", box: { ...box, x: 100 } },
        c: { kind: "shape", shape: "rect", text: "x", border: { color: ["#FF0000"] as unknown as string, w: 2 }, box: { ...box, y: 500 } },
        d: { kind: "shape", shape: "round", text: "y", border: "red" as never, box: { ...box, x: 100, y: 500 } },
      });
      expect(validate(build().nodes), design).toEqual([]);
    }
  });
  it("on a dark fill every line is white, headings too", async () => {
    for (const design of ["excel", "mckinsey", "glass"] as Design[]) {
      const { build } = await setup(design, { k: { kind: "shape", shape: "rect", text: "# Heading\n## Sub\nBody **bold**", fill: "#0A2A66", box: { ...box, h: 220 } } });
      const texts = flat(part(build().nodes, "k")).filter((n): n is TextNode => n.t === "text");
      expect(texts.length, design).toBeGreaterThan(3);
      for (const t of texts) expect(t.fill, `${design} ${t.src}`).toEqual({ solid: [255, 255, 255] });
    }
  });
  it("Consulting Red's message panel: white icons, outlines and text, a shape as a white outline (no card); elsewhere the accent", async () => {
    const { build } = await setup("bain", {
      ic: { kind: "shape", shape: "icon", icon: "check", box: { x: 60, y: 700, w: 60, h: 60 } },
      ci: { kind: "shape", shape: "circle", text: "12%", box: { x: 120, y: 400, w: 200, h: 200 } },
      tx: { kind: "shape", shape: "round", text: "Note", box: { x: 60, y: 620, w: 300, h: 60 } },
      ic2: { kind: "shape", shape: "icon", icon: "check", box: { x: 800, y: 700, w: 60, h: 60 } },
    });
    const dl = build(), fills = (id: string) => flat(part(dl.nodes, id)).flatMap(n => n.t === "path" || n.t === "rect" ? [JSON.stringify(n.fill ?? null) + JSON.stringify(n.stroke?.paint ?? null)] : []);
    expect(fills("ic")).toEqual([JSON.stringify({ solid: [255, 255, 255] }) + "null"]);
    expect(fills("ic2")).toEqual([JSON.stringify({ solid: [204, 0, 0] }) + "null"]);
    expect(fills("ci")).toEqual(["null" + JSON.stringify({ solid: [255, 255, 255] })]);
    expect(fills("tx")).toEqual(["null" + JSON.stringify({ solid: [255, 255, 255] })]);
    for (const id of ["ci", "tx"]) for (const t of flat(part(dl.nodes, id)).filter((n): n is TextNode => n.t === "text")) expect(t.fill, id).toEqual({ solid: [255, 255, 255] });
  });
  it("a consulting callout on a dark fill: the bullet glyph and the heading bar follow the white ink too", async () => {
    const { build } = await setup("bain", { k: { kind: "shape", shape: "rect", text: "# Heading\n- item one", fill: "#1F1F1F", box: { x: 600, y: 300, w: 420, h: 220 } } });
    const p = flat(part(build().nodes, "k"));
    const bullet = p.find((n): n is TextNode => n.t === "text" && n.src.trim() === "►");
    expect(bullet && bullet.fill).toEqual({ solid: [255, 255, 255] });
    const bar = p.find(n => n.t === "rect" && n.w === 24 && n.h === 3);
    expect(bar).toMatchObject({ fill: { solid: [255, 255, 255] } });
  });
  it("a consulting arrow is filled with the accent and takes white text (08's callout hooks)", async () => {
    const { ctx, env } = await setup("mckinsey");
    const out = shapeNodes({ kind: "shape", shape: "arrow", text: "Next", box }, "a", box, ctx, env);
    expect(out.nodes.find(n => n.t === "path")).toMatchObject({ fill: { solid: [34, 81, 255] } });
    expect(out.ink).toBe("#FFFFFF");
  });
  it("a cell the version shown removes is quoted as empty", async () => {
    const { ctx } = await setup("excel");
    expect(calloutText("[{SLIDE_1!D6}]", { ...ctx, version: { id: "v", name: "V", hide: { SLIDE_1: ["D6:D7"] } } }).text).toBe("[]");
  });
  it("no two filled parts of an icon overlap (an overlap would be a hole under the even-odd rule): each pair is apart or one inside the other", () => {
    // each part flattened to a polygon; sampled on a 0.08-unit grid
    const polys = (name: string) => {
      const out: [number, number][][] = []; let cur: [number, number][] = [], at: [number, number] = [0, 0];
      for (const c of iconCmds(name, 0, 0, 1)) {
        if (c[0] === "M") { if (cur.length) out.push(cur); cur = [[c[1], c[2]]]; at = [c[1], c[2]]; }
        else if (c[0] === "L") { cur.push([c[1], c[2]]); at = [c[1], c[2]]; }
        else if (c[0] === "C") { for (let k = 1; k <= 12; k++) { const t = k / 12, u = 1 - t; cur.push([u ** 3 * at[0] + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5], u ** 3 * at[1] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6]]); } at = [c[5], c[6]]; }
        else { out.push(cur); cur = []; }
      }
      if (cur.length) out.push(cur);
      return out;
    };
    const inside = (p: [number, number][], x: number, y: number) => { let o = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) o = !o; } return o; };
    for (const name of ICON_NAMES) {
      const P = polys(name), pts: [number, number][] = [];
      for (let x = .04; x < 24; x += .08) for (let y = .04; y < 24; y += .08) pts.push([x, y]);
      const ins = P.map(p => pts.map(([x, y]) => inside(p, x, y)));
      for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
        const both = pts.filter((_, k) => ins[a][k] && ins[b][k]).length, na = ins[a].filter(Boolean).length, nb = ins[b].filter(Boolean).length;
        // apart, or one part wholly inside the other (a hole) – a few samples of tolerance along a shared edge
        expect(both <= 3 || both >= Math.min(na, nb) - 3, `${name}: parts ${a} and ${b} overlap (${both} samples)`).toBe(true);
      }
    }
  }, 60_000);
});
