/* The PowerPoint export of the M13 (4.6.0) changes (S13.5; product owner, 2026-10-21: "ensure all of these new changes
   work with the powerpoint export as well"), through the export's own path – the core worker's lists asked with `pptx`
   (worker/host.ts slideLists), the export worker's job (worker/export-host.ts run) and the writer (pptx/writer.ts):
   * New slide / Add table (S13.3, S13.4, B40): a blank added slide, a slide whose last table was removed, a table added
     to a slide (normal and free layout: the first empty spot), a range table from "New table from cells" – each slide
     there, its title a placeholder, each table a real a:tbl where the display list draws its cells; page numbers and
     the contents slide after the adds and removes; in the five designs;
   * hidden slides (S13.6, B47): left out of the design's file (not PowerPoint-hidden), numbers and contents count the
     slides shown, another design keeps it, the current slide (named) still exports, every version × design;
   * a Google font of the library (B45/B46: static faces at 400 / 700, here instanced from a variable font as the page
     does): named in every run, bold and italic as run attributes, reported as not embedded (PowerPoint names fonts,
     07 §4.2); the PDF of the same deck embeds the two static faces;
   * format 5 (S13.1, B41): a deck raised to format 5 with the 4.6 objects gives the same file as the same document
     stored at format 4 (the format is storage only). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { applyOps, emptyDoc } from "../src/model/ops";
import { E } from "../src/pptx/drawingml";
import { DocSync } from "../src/sync/docsync";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { CatalogFont } from "../src/text/resolve";
import type { DeckVersion, Design, Op, Preset } from "../src/model/types";
import type { Node } from "../src/dl/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const TODAY = "1 October 2026";
/** SB_PPTX_OUT=<folder>: the files made here are written there too (for tools/pptxcheck.py and for opening in PowerPoint) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };

/* ---- the export's path: the core worker (a deck in memory) and an export worker linked to it ---- */
/** a 1 × 1 PNG: the pictures the export worker asks the page for (Liquid Glass's wallpaper, the logo) */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
async function open(deck: FakeDeck, preset: Preset | null, fonts: Record<string, Uint8Array> = {}) {
  const api = deck.api(), [a, b] = pair();
  const core = serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: ab(path.join(BOOKS, deck.snap.workbook)) }, []));
  const p = preset ?? null;
  await port.call("start", { name: deck.snap.workbook, deck: deck.open("anna@pc#aaaaaaaa"), preset: p, inputs: { defaults: {}, logoSrc: "", version: "", workbook: deck.snap.workbook }, stage: { slide: 0, known: [] } });
  // the export worker: its page answers fonts and pictures; its channel to the core asks the same lists the page would
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  const asked: string[] = [];
  page.handle("fontFile", x => { asked.push(x.file); const g = fonts[x.file]; return g ? g.slice().buffer as ArrayBuffer : null; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const lists = (design: Design, extra: object = {}) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: TODAY, pptx: true, ...extra });
  const pptx = (design: Design, extra: Partial<ExportJob> = {}, catalog: CatalogFont[] = []) =>
    page.call("run", { kind: "pptx", design, version: "", forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report", catalog, ...extra });
  return { port, core, apply, lists, pptx, page, asked };
}

/* ---- reading the file ---- */
function unzip(b: ArrayBuffer) {
  const z = unzipSync(new Uint8Array(b)), s = (n: string) => strFromU8(z[n]);
  const n = (s("ppt/presentation.xml").match(/<p:sldId /g) || []).length;
  const slide = (i: number) => s(`ppt/slides/slide${i + 1}.xml`);
  return { z, s, n, slide, names: Object.keys(z) };
}
const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
/** a placeholder's text: the sp holding <p:ph type="…"/> */
function phText(xml: string, type: string): string | null {
  for (const sp of xml.split("<p:sp>").slice(1)) if (sp.includes(`<p:ph type="${type}"`)) return textOf(sp.split("</p:sp>")[0]).join("");
  return null;
}
/** the tables of a slide: each graphicFrame holding a:tbl, its frame (EMU) and its grid */
function tablesOf(xml: string) {
  return xml.split("<p:graphicFrame>").slice(1).map(g => g.split("</p:graphicFrame>")[0]).filter(g => g.includes("<a:tbl>")).map(g => {
    const off = /<p:xfrm><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(g)!;
    return { x: +off[1], y: +off[2], w: +off[3], h: +off[4], rows: (g.match(/<a:tr /g) || []).length, cols: (g.match(/<a:gridCol /g) || []).length, text: textOf(g).join(" ") };
  });
}
/** what the display list draws of each table: the box of its cells ("t" hits inside the "tw" group), in slide px */
function dlTables(nodes: Node[]) {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  type M = [number, number, number, number, number, number];
  const mul = (A: M, B: M): M => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const cells = (ns: Node[], M: M, acc: { x0: number; y0: number; x1: number; y1: number }) => {
    for (const n of ns) {
      if (n.t === "group") cells(n.children, n.transform ? mul(M, n.transform as M) : M, acc);
      else if (n.t === "hit" && n.kind === "t" && n.w > 0 && n.h > 0) {
        const x = M[0] * n.x + M[4], y = M[3] * n.y + M[5], x2 = M[0] * (n.x + n.w) + M[4], y2 = M[3] * (n.y + n.h) + M[5];
        acc.x0 = Math.min(acc.x0, x); acc.y0 = Math.min(acc.y0, y); acc.x1 = Math.max(acc.x1, x2); acc.y1 = Math.max(acc.y1, y2);
      }
    }
  };
  const walk = (ns: Node[], M: M) => ns.forEach((n, i) => {
    if (n.t === "hit" && n.id === "tw" && ns[i + 1]?.t === "group") {
      const g = ns[i + 1] as Extract<Node, { t: "group" }>, acc = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      cells([g], M, acc);
      if (acc.x1 > acc.x0) out.push({ x: acc.x0, y: acc.y0, w: acc.x1 - acc.x0, h: acc.y1 - acc.y0 });
    } else if (n.t === "group" && !(i > 0 && ns[i - 1].t === "hit" && (ns[i - 1] as { id: string }).id === "tw")) walk(n.children, n.transform ? mul(M, n.transform as M) : M);
  });
  walk(nodes, [1, 0, 0, 1, 0, 0]);
  return out;
}
const words = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? words(n.children) : []);
const hits = (ns: Node[]): Extract<Node, { t: "hit" }>[] => ns.flatMap(n => n.t === "hit" ? [n] : n.t === "group" ? hits(n.children) : []);
/** the frame of a table in EMU is the display list's cells' box – within the 0.75 px the writer takes cell edges as one
    grid line by (scene.ts clusters: a cell edge 0.06 px from its neighbour's is the same line) */
function sameBox(t: { x: number; y: number; w: number; h: number }, d: { x: number; y: number; w: number; h: number }) {
  const e = E(.75);
  return Math.abs(t.x - E(d.x)) <= e && Math.abs(t.y - E(d.y)) <= e && Math.abs(t.x + t.w - E(d.x + d.w)) <= e && Math.abs(t.y + t.h - E(d.y + d.h)) <= e;
}

/* ---- the deck: report.xlsx's three tables, with a cover and a contents slide ---- */
const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const BASE = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
const preset = (): Preset => ({ ...structuredClone(BASE), slides: [
  { id: "c", type: "cover", title: "Review", tables: [] }, { id: "x", type: "index", title: "Contents", tables: [] },
  ...structuredClone(BASE.slides).map((s, i) => ({ ...s, title: ["Loans", "Pair"][i] }))] });
const PN: Op = { op: "style.patch", patch: { pn: { on: true, format: "nN", cover: true } } } as Op;
const RANGE = { id: "tcells1", sheet: "SLIDE_2 panel", kind: "range" as const, range: "B3:E8", grow: false };
const RANGE2 = { id: "tcells2", sheet: "SLIDE_1", kind: "range" as const, range: "B3:D7", grow: false };
/** a free layout in every design: the pair's first table small in the top left corner, the second one gone */
const free = (box: { x: number; y: number; w: number; h: number }): Op => ({ op: "slide.patch", id: "9lywu2f",
  patch: { free: Object.fromEntries(DESIGNS.map(d => [d, { on: true, items: { "t:ybyk4v2": box } }])) } } as Op);
/** New slide / Add table, as the page sends them (app/src/editor/slides.ts): one op each */
const M13_OPS: Op[] = [
  PN,
  { op: "slide.add", slide: { id: "nb", type: "content", title: "New slide", subtitle: null, tables: [] }, after: "9lywu2f" },     // blank (title only)
  { op: "slide.add", slide: { id: "nr", type: "content", title: "Emptied", subtitle: null, tables: [] }, after: "nb" },
  { op: "table.add", table: structuredClone(BASE.tables[0]), slide: "nr" }, { op: "table.remove", id: "dhnms9c", slide: "nr" },  // its last table removed
  { op: "table.add", table: structuredClone(BASE.tables[2]), slide: "u9t3fqb" },                                                  // added to a normal slide
  { op: "table.remove", id: "62de08x", slide: "9lywu2f" }, free({ x: 80, y: 200, w: 300, h: 120 }),
  { op: "table.add", table: RANGE, slide: "9lywu2f" },                                                                            // New table from cells, on a free layout
  { op: "slide.add", slide: { id: "nt", type: "content", title: "From cells", subtitle: null, tables: [] }, after: "nr" },
  { op: "table.add", table: RANGE2, slide: "nt" },                                                                                // New table from cells, normal layout
] as Op[];

describe("New slide and Add table in PowerPoint (S13.3, S13.4, B40)", () => {
  it("every design: each slide there, titles placeholders, each table a real a:tbl where the display list draws it; page numbers and contents follow", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, preset());
    for (const op of M13_OPS) expect(await h.apply("op", [op]), JSON.stringify(op)).toBe(true);
    const TITLES = ["Review", "Contents", "Loans", "Pair", "New slide", "Emptied", "From cells"];
    for (const design of DESIGNS) {
      const ls = await h.lists(design), r = await h.pptx(design), f = unzip(r.files[0]);
      keep(`m13-add-${design}.pptx`, r.files[0]);
      expect(r.notEmbedded, design).toEqual([]);
      expect(ls.map(l => l.slide), design).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(f.n, design).toBe(7);
      for (let i = 0; i < 7; i++) {
        const xml = f.slide(i), dl = ls[i].dl.nodes;
        // the title: a placeholder (ctrTitle on the cover, title elsewhere) holding the slide's title
        expect(phText(xml, i === 0 ? "ctrTitle" : "title"), `${design} slide ${i + 1} title`).toBe(TITLES[i]);
        // the page number: "n / N" as the display list draws it, in the slide-number placeholder
        expect(phText(xml, "sldNum"), `${design} slide ${i + 1} number`).toBe(`${i + 1} / 7`);
        expect(words(dl).join(" ")).toContain(`${i + 1} / 7`);
        // no picture of a table or a chart, no connector, nothing outside the file
        expect(xml, `${design} ${i + 1}`).not.toContain("p:cxnSp");
        const want = dlTables(dl), got = tablesOf(xml);
        expect(got.length, `${design} slide ${i + 1}: tables`).toBe(want.length);
        want.forEach((d, k) => expect(sameBox(got[k], d), `${design} slide ${i + 1} table ${k + 1}: ${JSON.stringify({ pptx: [got[k].x / 7620, got[k].y / 7620, got[k].w / 7620, got[k].h / 7620], dl: d })}`).toBe(true));
      }
      // how many tables each slide holds: Loans 2 (one added), Pair 2 (one removed, a range table added), the blank and
      // the emptied slide none, From cells 1
      expect([2, 3, 4, 5, 6].map(i => tablesOf(f.slide(i)).length), design).toEqual([2, 2, 0, 0, 1]);
      // the range tables hold their cells (B3:E8 of "SLIDE_2 panel" is 6 rows; B3:D7 of SLIDE_1 5 rows)
      expect(tablesOf(f.slide(6))[0].rows, design).toBe(5);
      // the contents slide: the content slides, in order, with their page numbers
      const ix = hits(ls[1].dl.nodes);
      expect(ix.filter(x => x.id === "ix-t").map(x => x.label), design).toEqual(["Loans", "Pair", "New slide", "Emptied", "From cells"]);
      // …and the PowerPoint slide says what the display list draws: every text of it, the pages 3 … 7 among them
      const ixText = textOf(f.slide(1)).join(" "), drawn = words(ls[1].dl.nodes).map(w => w.trim()).filter(Boolean);
      for (const t of drawn) expect(ixText, `${design}: contents "${t}"`).toContain(t);
      for (const t of ["Loans", "Pair", "New slide", "Emptied", "From cells", "3", "4", "5", "6", "7"]) expect(drawn, design).toContain(t);
    }
    // the free layout: the added range table at the first empty spot – not on the corner table
    const ls = await h.lists("excel"), [t1, t2] = dlTables(ls[3].dl.nodes);
    expect(t1.x + t1.w <= t2.x + .5 || t1.y + t1.h <= t2.y + .5).toBe(true);
    // a removal and an add later: numbers and contents follow at once
    expect(await h.apply("Delete slide", [{ op: "slide.remove", id: "nb" } as Op])).toBe(true);
    const f = unzip((await h.pptx("excel")).files[0]);
    expect(f.n).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map(i => phText(f.slide(i), "sldNum"))).toEqual(["1 / 6", "2 / 6", "3 / 6", "4 / 6", "5 / 6", "6 / 6"]);
    expect(textOf(f.slide(1)).join(" ")).not.toContain("New slide");
  }, 120_000);
});

/* ---- hidden slides (S13.6, B47; HS-02) ---- */
const hide = (id: string, h: Record<string, true | null> | null): Op => ({ op: "slide.patch", id, patch: { hide: h } } as Op);
const GAMMA: Op = { op: "slide.add", slide: { id: "g", type: "content", title: "Gamma", subtitle: null, tables: [] }, after: "9lywu2f" } as Op;
/** versions as the wizard makes them (DeckVersion: the cells removed per sheet) */
const VERSIONS: DeckVersion[] = [{ id: "vchief", name: "Chief", hide: {} }, { id: "vall", name: "All", hide: { SLIDE_1: ["D6:D7"] } }];
describe("hidden slides in PowerPoint (S13.6, B47, HS-02)", () => {
  it("left out of the design's file (not PowerPoint-hidden); numbers and contents count the slides shown; another design keeps it; the current slide still exports", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, { ...preset(), versions: VERSIONS });
    expect(await h.apply("Page numbers", [PN])).toBe(true);
    expect(await h.apply("New slide", [GAMMA])).toBe(true);
    // the deck: Review, Contents, Loans, Pair, Gamma; Pair hidden in Liquid Glass (the slide list's menu: one op)
    expect(await h.apply("Hide slide", [hide("9lywu2f", { glass: true })])).toBe(true);
    const gb = (await h.pptx("glass")).files[0], g = unzip(gb);
    keep("m13-hide-glass.pptx", gb);
    expect(g.n).toBe(4);
    expect(g.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(4);
    expect(g.s("docProps/app.xml")).toContain("<Slides>4</Slides>");
    // left out, not hidden: no slide carries show="0"
    for (let i = 0; i < 4; i++) expect(g.slide(i)).not.toMatch(/<p:sld [^>]*show=/);
    expect([0, 1, 2, 3].map(i => phText(g.slide(i), i ? "title" : "ctrTitle"))).toEqual(["Review", "Contents", "Loans", "Gamma"]);
    expect([0, 1, 2, 3].map(i => phText(g.slide(i), "sldNum"))).toEqual(["1 / 4", "2 / 4", "3 / 4", "4 / 4"]);
    expect([0, 1, 2, 3].flatMap(i => textOf(g.slide(i))).join(" ")).not.toContain("Pair");     // neither its slide nor a contents entry
    expect(textOf(g.slide(1))).toEqual(expect.arrayContaining(["Loans", "Gamma", "3", "4"]));
    expect(textOf(g.slide(1))).not.toContain("5");
    // another design keeps it: five slides, numbered of five, in the contents
    for (const d of DESIGNS.filter(d => d !== "glass")) {
      const f = unzip((await h.pptx(d)).files[0]);
      expect(f.n, d).toBe(5);
      expect(phText(f.slide(3), "title"), d).toBe("Pair");
      expect(phText(f.slide(4), "sldNum"), d).toBe("5 / 5");
      expect(textOf(f.slide(1)).join(" "), d).toContain("Pair");
    }
    // PowerPoint of the current slide, hidden: exported all the same (named), with no page number (as on the stage)
    const ob = (await h.pptx("glass", { slides: [3] })).files[0], one = unzip(ob);
    keep("m13-hide-current-glass.pptx", ob);
    expect(one.n).toBe(1);
    expect(phText(one.slide(0), "title")).toBe("Pair");
    expect(phText(one.slide(0), "sldNum")).toBeNull();
    // every version × design (the Versions items ask without slides, each design and version): the design hiding it
    // has 4 slides, the others 5; the version's removed cells do not change which slides are there
    for (const v of ["", ...VERSIONS.map(v => v.id)]) for (const d of DESIGNS) {
      const f = unzip((await h.pptx(d, { version: v })).files[0]), n = d === "glass" ? 4 : 5;
      expect(f.n, `${v} × ${d}`).toBe(n);
      expect(phText(f.slide(n - 1), "sldNum"), `${v} × ${d}`).toBe(`${n} / ${n}`);
      expect([...Array(n).keys()].some(i => phText(f.slide(i), "title") === "Pair"), `${v} × ${d}`).toBe(d !== "glass");
    }
    // hidden in every design: every file leaves it out; shown again (undo): back in every file
    expect(await h.apply("Hide in every design", [hide("9lywu2f", Object.fromEntries(DESIGNS.map(d => [d, true as const])))])).toBe(true);
    for (const d of DESIGNS) expect(unzip((await h.pptx(d)).files[0]).n, d).toBe(4);
    await h.port.call("undo", { redo: false });
    await h.port.call("undo", { redo: false });
    for (const d of DESIGNS) expect(unzip((await h.pptx(d)).files[0]).n, d).toBe(5);
  }, 120_000);
});

/* ---- a Google font of the library (B45, B46) ---- */
const FONTS = path.join(here, "fixtures", "fonts");
describe("a Google font added through the helper, in PowerPoint (B45, B46)", () => {
  it("static faces at 400 / 700 (instanced from a variable font as the page stores them): named in every run, bold and italic as the runs' attributes, said not embedded; the PDF embeds the static faces", async () => {
    const { staticFace } = await import("../src/text/static"), { isVariable } = await import("../src/text/subset");
    // Quicksand[wght] stands in for the family the helper fetched from google/fonts (a variable TTF): the page stores
    // a static face at each wanted weight (gfonts.py WANT = 400, 700; core text/static.ts)
    const vf = new Uint8Array(fs.readFileSync(path.join(FONTS, "Quicksand[wght].ttf")));
    const r400 = await staticFace(vf, 400), r700 = await staticFace(vf, 700);
    expect([r400.variable, r700.variable]).toEqual([true, true]);
    expect([isVariable(r400.data), isVariable(r700.data)]).toEqual([false, false]);
    const files = { "quicksand-400.ttf": r400.data, "quicksand-700.ttf": r700.data };
    for (const [n, b] of Object.entries(files)) keep(n, b);
    const catalog: CatalogFont[] = [{ source: "library", file: "quicksand-400.ttf", family: "Quicksand", weight: 400, italic: false },
      { source: "library", file: "quicksand-700.ttf", family: "Quicksand", weight: 700, italic: false }];
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, preset(), files);
    // the font used on the slides: the titles bold, the tables regular, a text box italic
    expect(await h.apply("Text styles", [{ op: "style.patch", patch: { text: { title: { font: "Quicksand", b: true }, table: { font: "Quicksand" } } } } as Op])).toBe(true);
    expect(await h.apply("Text box", [{ op: "slide.patch", id: "u9t3fqb", patch: { notes: { "dhnms9c:bottom": { text: "Italic note", font: "Quicksand", i: true } } } } as Op])).toBe(true);
    for (const design of DESIGNS) {
      const r = await h.pptx(design, {}, catalog), f = unzip(r.files[0]);
      keep(`m13-font-${design}.pptx`, r.files[0]);
      expect(r.notEmbedded, design).toEqual(["Quicksand"]);
      expect(f.names.some(n => /^ppt\/fonts\//.test(n)), design).toBe(false);            // named, not embedded (07 §4.2)
      const xml = f.slide(2), runs = [...xml.matchAll(/<a:r><a:rPr ([^>]*)>(?:(?!<\/a:rPr>).)*<a:latin typeface="([^"]*)"\/>(?:(?!<\/a:r>).)*<a:t>([^<]*)<\/a:t><\/a:r>/g)]
        .map(m => ({ b: /\bb="1"/.test(m[1]), i: /\bi="1"/.test(m[1]), face: m[2], text: m[3] }));
      // the title: Quicksand, bold
      const title = runs.filter(x => x.text === "Loans" && x.b);
      expect(title.length, design).toBeGreaterThan(0);
      expect(title.every(x => x.face === "Quicksand"), design).toBe(true);
      // the text box: Quicksand, italic, not bold
      const note = runs.find(x => x.text.includes("Italic note"));
      expect(note, design).toBeDefined();
      expect([note!.face, note!.i, note!.b], design).toEqual(["Quicksand", true, false]);
      // the table's cells: Quicksand (the regular face; the bold ones bold)
      const cells = tablesOf(xml)[0], tbl = xml.split("<a:tbl>")[1].split("</a:tbl>")[0];
      expect(cells, design).toBeDefined();
      const faces = new Set([...tbl.matchAll(/<a:latin typeface="([^"]*)"\/>/g)].map(m => m[1]));
      expect([...faces], design).toEqual(["Quicksand"]);
      expect(tbl, design).toMatch(/b="0" i="0"/);
      // the theme's fonts: the titles' and the body's
      expect(f.s("ppt/theme/theme1.xml"), design).toContain('<a:majorFont><a:latin typeface="Quicksand"/>');
    }
    // without the font on this PC (another PC, the library not loaded): still named Quicksand, nothing said
    const bare = await h.pptx("excel");
    expect(bare.notEmbedded).toEqual([]);
    expect(unzip(bare.files[0]).slide(2)).toContain('<a:latin typeface="Quicksand"/>');
    expect(h.asked).toEqual([]);                                                            // PowerPoint reads no font file
    // the PDF of the same deck embeds the library's static faces, regular and bold (the italic text: the regular face slanted)
    // (the design's own text – the date, the page number – needs a face of this PC: Carlito stands in for Arial)
    const sys = (file: string, weight: number): CatalogFont => ({ source: "system", file, family: "Arial", weight, italic: false });
    files["Carlito-Regular.ttf" as keyof typeof files] = new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Regular.ttf")));
    files["Carlito-Bold.ttf" as keyof typeof files] = new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Bold.ttf")));
    const pdf = await h.page.call("run", { kind: "pdf", design: "excel", version: "", forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report",
      catalog: [...catalog, sys("Carlito-Regular.ttf", 400), sys("Carlito-Bold.ttf", 700)] });
    const s = Buffer.from(new Uint8Array(pdf.files[0])).toString("latin1");
    expect(h.asked.filter(f => f.startsWith("quicksand")).sort()).toEqual(["quicksand-400.ttf", "quicksand-700.ttf"]);
    expect((s.match(/\/BaseFont\s*\/[A-Z]{6}\+Quicksand[^/\s]*/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(pdf.unreadable ?? []).toEqual([]);
  }, 120_000);
});

/* ---- format 5 (S13.1, B41, ADR-019): storage only ---- */
const ITEMS46: Op[] = [
  { op: "item.patch", slide: "u9t3fqb", id: "c1", patch: { kind: "chart", type: "pie", values: { table: "dhnms9c", range: "D6:D11" }, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } } },
  { op: "item.patch", slide: "nb", id: "k1", patch: { kind: "shape", shape: "bubble", text: "Loans up", box: { x: 600, y: 120, w: 300, h: 120 }, tail: { x: 640, y: 300 } } },
  { op: "slide.patch", id: "u9t3fqb", patch: { looks: { mckinsey: { bars: "off" } } } },
  { op: "table.patch", id: "dhnms9c", patch: { cellGrid: { C6: { h: "on", v: "on", c: "#FF0000", w: 2 } } } },
  { op: "table.patch", id: "dhnms9c", patch: { borders: { D7: { top: { style: "medium", color: "#0000FF" } } } } },
  hide("nr", { bain: true }),
] as Op[];
describe("format 5 (S13.1, B41): the format is storage only", () => {
  it("a deck raised to format 5 with every 4.6 object gives the same PowerPoint files as the same document stored at format 4 or 5", async () => {
    const ops = [...M13_OPS, ...ITEMS46];
    // A: the deck made here, op by op (the first 4.6 object raises it to format 5)
    const wait = DocSync.bumpWaitMs; DocSync.bumpWaitMs = 0;                                 // (the helper's 23 s wait: none here)
    const deckA = new FakeDeck("report.xlsx-0123456789", "report.xlsx");
    let a: Awaited<ReturnType<typeof open>>;
    try {
      a = await open(deckA, preset());
      for (const op of ops) expect(await a.apply("op", [op]), JSON.stringify(op)).toBe(true);
      for (let i = 0; i < 200 && deckA.snap.format !== 5; i++) await new Promise(r => setTimeout(r, 50));
    } finally { DocSync.bumpWaitMs = wait; }
    expect(deckA.snap.format, "raised to format 5").toBe(5);
    expect(deckA.calls.format5).toBeGreaterThan(0);
    // B and C: the same document read from a snapshot at format 5, and at format 4 (as an older deck would store it)
    const { doc, skipped } = applyOps(emptyDoc("report.xlsx"), [{ op: "preset.set", preset: preset() } as Op, ...ops]);
    expect(skipped).toEqual([]);
    const deckB = new FakeDeck("report.xlsx-0123456789", "report.xlsx", structuredClone(doc)); deckB.snap.format = 5;
    const deckC = new FakeDeck("report.xlsx-0123456789", "report.xlsx", structuredClone(doc));
    expect(deckC.snap.format).toBe(4);
    const b = await open(deckB, null), c = await open(deckC, null);
    for (const design of DESIGNS) {
      const [fa, fb, fc] = await Promise.all([a!, b, c].map(x => x.pptx(design)));
      keep(`m13-format5-${design}.pptx`, fa.files[0]);
      const A = Buffer.from(new Uint8Array(fa.files[0])), B = Buffer.from(new Uint8Array(fb.files[0])), C = Buffer.from(new Uint8Array(fc.files[0]));
      expect(A.equals(B), `${design}: format 5 deck vs format 5 snapshot`).toBe(true);
      expect(A.equals(C), `${design}: format 5 deck vs format 4 snapshot`).toBe(true);
      // and what the 4.6 objects are in the file: the chart native, the callout a preset shape, the tables real
      const f = unzip(fa.files[0]);
      expect(f.names.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)), design).toHaveLength(1);
      expect(f.slide(2), design).toContain("<c:chart ");
      expect(f.slide(4), design).toContain('prst="wedgeRoundRectCallout"');
      expect(f.n, design).toBe(design === "bain" ? 6 : 7);                                  // "Emptied" hidden in Consulting Red
    }
  }, 180_000);
});
