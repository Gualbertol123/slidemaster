/* Duplicate slide and Delete slide (S13.7, owner Q12): the copy model/slidecopy.ts makes (the page adds it with one
   slide.add after the slide), and the exports of a duplicated slide through the export's own path – the core worker's
   lists (worker/host.ts slideLists: the display list PNG and the stage draw too), the export worker (worker/export-host.ts)
   and the writers (pdf/writer.ts, pptx/writer.ts): in every design the copy is the original but for its page number –
   the same display list, the same PowerPoint slide (real tables, the same shapes), the same PDF page; the contents slide
   lists both. Deleting it (one slide.remove) gives the deck as it was; undo of either is one step. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync, unzlibSync } from "fflate";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { applyOps, inverseOf, needsV5 } from "../src/model/ops";
import { copySlide } from "../src/model/slidecopy";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { CatalogFont } from "../src/text/resolve";
import type { Design, Op, Preset, SlideDef } from "../src/model/types";
import type { Node } from "../src/dl/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks"), FONTS = path.join(here, "fixtures", "fonts");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const TODAY = "1 October 2026";
/** SB_PPTX_OUT=<folder>: the files made here are written there too (for tools/pptxcheck.py and for opening in PowerPoint) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };
let seq = 0;
const ids = (taken: (x: string) => boolean) => { let x; do x = "n" + ++seq; while (taken(x)); return x; };

describe("copySlide (S13.7)", () => {
  const s: SlideDef = {
    id: "s1", type: "content", title: "Loans", tables: ["t1", "t2"], hide: { bain: true }, looks: { mckinsey: { bars: "off" } } as never,
    notes: { "t1:right": { text: "Up" } } as never,
    items: {
      a: { kind: "shape", shape: "rect", text: "Note", box: { x: 10, y: 10, w: 100, h: 40 } },
      b: { kind: "line", route: "straight", a: { x: 0, y: 0 }, b: { x: 50, y: 50 }, ends: { a: { to: "i:a", at: "r" }, b: { to: "t:t1", at: "l" } }, box: { x: 0, y: 0, w: 50, h: 50 } },
    },
    free: { glass: { on: true, items: { "t:t1": { x: 1, y: 2, w: 3, h: 4, scale: 1 }, "i:a": { x: 5, y: 6, w: 7, h: 8 }, "n:t1:right": { x: 9, y: 9, w: 9, h: 9 } } } },
  };
  it("everything under the new id; the items under new ids, the free boxes and attached ends renamed alike; the original untouched", () => {
    const before = JSON.stringify(s);
    let n = 0;
    const c = copySlide(s, "s9", taken => { let x; do x = "a" + ++n; while (taken(x)); return x; });      // "a1", "a2" (not "a" itself)
    expect(JSON.stringify(s)).toBe(before);
    expect(c.id).toBe("s9");
    expect(c.tables).toEqual(["t1", "t2"]); expect(c.tables).not.toBe(s.tables);
    expect(c.hide).toEqual({ bain: true }); expect(c.looks).toEqual(s.looks); expect(c.notes).toEqual(s.notes); expect(c.title).toBe("Loans");
    expect(Object.keys(c.items!)).toEqual(["a1", "a2"]);
    expect(c.items!.a1).toEqual(s.items!.a);
    expect((c.items!.a2 as { ends: unknown }).ends).toEqual({ a: { to: "i:a1", at: "r" }, b: { to: "t:t1", at: "l" } });
    expect(c.free!.glass!.items).toEqual({ "t:t1": { x: 1, y: 2, w: 3, h: 4, scale: 1 }, "i:a1": { x: 5, y: 6, w: 7, h: 8 }, "n:t1:right": { x: 9, y: 9, w: 9, h: 9 } });
    // an id the generator gives twice is not taken twice
    const twice = copySlide(s, "s8", taken => taken("z") ? "z2" : "z");
    expect(Object.keys(twice.items!)).toEqual(["z", "z2"]);
    // a slide without items: just the copy
    expect(copySlide({ id: "x", type: "content", tables: [] }, "y", ids)).toEqual({ id: "y", type: "content", tables: [] });
  });
  it("its slide.add lands right after the original; the inverse (undo) and a slide.remove of it give the deck as it was; format 5", () => {
    const p: Preset = { sheets: [], tables: [], slides: [{ id: "c", type: "cover", tables: [] }, structuredClone(s), { id: "z", type: "content", tables: [] }] };
    const d0 = { preset: p, style: {}, edits: {} }, add: Op = { op: "slide.add", slide: copySlide(s, "s9", ids), after: "s1" } as Op;
    const d1 = applyOps(d0, [add]).doc;
    expect(d1.preset!.slides.map(x => x.id)).toEqual(["c", "s1", "s9", "z"]);
    expect(applyOps(d1, [inverseOf(d0 as never, add)!]).doc.preset).toEqual(p);
    const del: Op = { op: "slide.remove", id: "s9" } as Op;
    expect(applyOps(d1, [del]).doc.preset).toEqual(p);
    expect(applyOps(applyOps(d1, [del]).doc, [inverseOf(d1 as never, del)!]).doc.preset).toEqual(d1.preset);
    expect(needsV5(add)).toBe(true); expect(needsV5(del)).toBe(true);
  });
});

/* ---- the export's path: the core worker (a deck in memory) and an export worker linked to it (as pptx-m13.test.ts) ---- */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
async function open(deck: FakeDeck, preset: Preset) {
  const api = deck.api(), [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: ab(path.join(BOOKS, deck.snap.workbook)) }, []));
  await port.call("start", { name: deck.snap.workbook, deck: deck.open("anna@pc#aaaaaaaa"), preset, inputs: { defaults: {}, logoSrc: "", version: "", workbook: deck.snap.workbook }, stage: { slide: 0, known: [] } });
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  // (every face of the catalog below is a Carlito file under the family's own name)
  page.handle("fontFile", x => new Uint8Array(fs.readFileSync(path.join(FONTS, x.file.endsWith("-Bold.ttf") ? "Carlito-Bold.ttf" : "Carlito-Regular.ttf"))).buffer as ArrayBuffer);
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const lists = (design: Design, extra: object = {}) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: TODAY, ...extra });
  // (the designs' own text needs faces of this PC: Carlito stands in for each of them)
  const catalog: CatalogFont[] = ["Carlito", "Arial", "Georgia"].flatMap(family => [
    { source: "system", file: family + "-Regular.ttf", family, weight: 400, italic: false }, { source: "system", file: family + "-Bold.ttf", family, weight: 700, italic: false }] as CatalogFont[]);
  const run = (kind: "pdf" | "pptx", design: Design, extra: Partial<ExportJob> = {}) =>
    page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report", catalog, ...extra });
  return { port, apply, lists, run };
}
function unzip(b: ArrayBuffer) {
  const z = unzipSync(new Uint8Array(b)), s = (n: string) => strFromU8(z[n]);
  return { n: (s("ppt/presentation.xml").match(/<p:sldId /g) || []).length, slide: (i: number) => s(`ppt/slides/slide${i + 1}.xml`), s };
}
const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
function phText(xml: string, type: string): string | null {
  for (const sp of xml.split("<p:sp>").slice(1)) if (sp.includes(`<p:ph type="${type}"`)) return textOf(sp.split("</p:sp>")[0]).join("");
  return null;
}
const words = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? words(n.children) : []);
const hits = (ns: Node[]): Extract<Node, { t: "hit" }>[] => ns.flatMap(n => n.t === "hit" ? [n] : n.t === "group" ? hits(n.children) : []);
/** the pages of a PDF: each page's content stream, inflated */
function pdfPages(b: ArrayBuffer): string[] {
  const u = new Uint8Array(b), s = Buffer.from(u).toString("latin1"), objAt = new Map<number, number>();
  for (const m of s.matchAll(/(?:^|\n)(\d+) 0 obj\n/g)) objAt.set(+m[1], m.index! + m[0].length);
  const stream = (id: number) => {
    const at = objAt.get(id)!, head = s.slice(at, s.indexOf("stream\n", at)), len = +/\/Length (\d+)/.exec(head)![1], from = s.indexOf("stream\n", at) + 7;
    const body = u.slice(from, from + len);
    return Buffer.from(head.includes("/FlateDecode") ? unzlibSync(body) : body).toString("latin1");
  };
  return [...s.matchAll(/<<\/Type\/Page\/[^]*?\/Contents (\d+) 0 R>>/g)].map(m => stream(+m[1]));
}

/* ---- the deck: report.xlsx's tables, a cover and a contents slide; Loans gets an item, a look and a free layout ---- */
const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const BASE = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
const LOANS = BASE.slides[0].id;
const preset = (): Preset => ({ ...structuredClone(BASE), slides: [
  { id: "c", type: "cover", title: "Review", tables: [] }, { id: "x", type: "index", title: "Contents", tables: [] },
  ...structuredClone(BASE.slides).map((s, i) => ({ ...s, title: ["Loans", "Pair"][i] }))] });
const PN = (on: boolean): Op => ({ op: "style.patch", patch: { pn: { on, format: "nN", cover: true } } } as Op);
const SETUP: Op[] = [
  PN(true),
  { op: "item.patch", slide: LOANS, id: "k1", patch: { kind: "shape", shape: "bubble", text: "Loans up", box: { x: 600, y: 120, w: 300, h: 120 }, tail: { x: 640, y: 300 } } },
  { op: "slide.patch", id: LOANS, patch: { looks: { mckinsey: { bars: "off" } }, free: { excel: { on: true, items: { "i:k1": { x: 1100, y: 600, w: 300, h: 120 } } } } } },
] as Op[];

describe("a duplicated slide in the exports (S13.7): the original but for its page number", () => {
  it("every design: the same display list, the same PowerPoint slide, the same PDF page; the contents lists both; delete and undo", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, preset());
    expect(await h.apply("Setup", SETUP)).toBe(true);
    const p0 = (await h.lists("excel")).length;
    expect(p0).toBe(4);
    // Duplicate slide, as the page sends it: one slide.add of the copy after the slide
    const orig = applyOps({ preset: preset(), style: {}, edits: {} }, SETUP).doc.preset!.slides.find(s => s.id === LOANS)!;
    const copy = copySlide(orig, "dup1", ids), nk = Object.keys(copy.items!)[0];
    expect(await h.apply("Duplicate slide", [{ op: "slide.add", slide: copy, after: LOANS } as Op])).toBe(true);
    /** the copy's text as the original's: its item id and its page number "4 / 5" read as the original's */
    const same = (x: string, a: string, b: string) => x.split(nk).join("k1").split(b).join(a);
    for (const design of DESIGNS) {
      const ls = await h.lists(design, { pptx: true });
      expect(ls.map(l => l.slide), design).toEqual([0, 1, 2, 3, 4]);
      // the display list (the stage, PNG and the PDF draw it): the same nodes, the page number aside
      const A = JSON.stringify(ls[2].dl.nodes), B = JSON.stringify(ls[3].dl.nodes);
      expect(A, design).toContain("3 / 5"); expect(B, design).toContain("4 / 5");
      expect(same(B, "3 / 5", "4 / 5"), design).toBe(A);
      expect(ls[2].dl.images, design).toEqual(ls[3].dl.images);
      // the contents slide lists both, pages 3 and 4
      expect(hits(ls[1].dl.nodes).filter(x => x.id === "ix-t").map(x => x.label), design).toEqual(["Loans", "Loans", "Pair"]);
      expect(words(ls[1].dl.nodes), design).toEqual(expect.arrayContaining(["3", "4", "5"]));
      // PowerPoint: five slides; the copy's XML is the original's but for its number (real tables, the same shapes)
      const r = await h.run("pptx", design), f = unzip(r.files[0]);
      keep(`s13-7-dup-${design}.pptx`, r.files[0]);
      expect(f.n, design).toBe(5);
      expect(phText(f.slide(3), "sldNum"), design).toBe("4 / 5");
      expect(phText(f.slide(2), "title"), design).toBe("Loans"); expect(phText(f.slide(3), "title"), design).toBe("Loans");
      expect(f.slide(3), design).toContain("<a:tbl>");
      expect(f.slide(3), design).not.toContain("p:cxnSp");
      expect(same(f.slide(3), "3 / 5", "4 / 5"), design).toBe(f.slide(2));
      expect(textOf(f.slide(3)).join(" "), design).toContain("Loans up");
    }
    // the PDF: five pages; without page numbers the copy's page is the original's, byte for byte
    let pdf = await h.run("pdf", "excel");
    keep("s13-7-dup-excel.pdf", pdf.files[0]);
    expect(pdfPages(pdf.files[0])).toHaveLength(5);
    expect(pdf.unreadable ?? []).toEqual([]);
    expect(await h.apply("Page numbers off", [PN(false)])).toBe(true);
    for (const design of DESIGNS) {
      pdf = await h.run("pdf", design);
      const pages = pdfPages(pdf.files[0]);
      expect(pages, design).toHaveLength(5);
      expect(pages[3], design).toBe(pages[2]);
      expect(pages[4], design).not.toBe(pages[2]);
    }
    // Delete slide (one slide.remove): the deck as it was; undo brings the copy back, undo again takes it away
    expect(await h.apply("Delete slide", [{ op: "slide.remove", id: "dup1" } as Op])).toBe(true);
    expect((await h.lists("excel")).map(l => l.slide)).toEqual([0, 1, 2, 3]);
    await h.port.call("undo", { redo: false });
    expect((await h.lists("excel")).map(l => l.slide)).toEqual([0, 1, 2, 3, 4]);
    await h.port.call("undo", { redo: false });                                        // page numbers on again
    await h.port.call("undo", { redo: false });                                        // the duplicate undone
    expect((await h.lists("excel")).map(l => l.slide)).toEqual([0, 1, 2, 3]);
  }, 180_000);
});
