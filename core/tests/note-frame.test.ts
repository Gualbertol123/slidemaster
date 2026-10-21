/* B49 (product owner 2026-10-21: "make the borders of the auto comments editable in thickness and colour"): Note.frame –
   the key (a notes entry's, kept whole by slide.patch; undo; format 5), how it reads (note-frame.ts), how every design
   draws it (slide-dl.ts noteNodes: a stroke inside the box's edges; an Excel bubble's own frame replaced or removed),
   and the PowerPoint export (a shape with that native outline, a:ln, grouped with the text box; no picture, no connector)
   and the PDF (the display list's stroke). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { applyOp, applyOps, docNeedsV5, emptyDoc, inverseOf, knownOp, needsV5 } from "../src/model/ops";
import { frameCss, frameStroke, noteFrame } from "../src/render/note-frame";
import { ISP } from "../src/render/isp";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { CatalogFont } from "../src/text/resolve";
import type { Design, Note, Op, Preset } from "../src/model/types";
import type { Node } from "../src/dl/types";
import type { CommentCfg } from "../src/model/comment";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks"), FONTS = path.join(here, "fixtures", "fonts");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const TODAY = "1 October 2026";
/** SB_PPTX_OUT=<folder>: the files made here are written there too (tools/pptxcheck.py, pdfcheck.py, PowerPoint) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };

const AUTO: CommentCfg = { groups: [], top: 2, noun: "country", detail: "full", share: true, breadth: true, missing: true, mode: "summary" };
const comment = (extra: Partial<Note> = {}): Note => ({ text: "", auto: AUTO, w: 440, ...extra });
const SP = (notes: Record<string, Note | null>, id = "s1"): Op => ({ op: "slide.patch", id, patch: { notes } } as Op);

describe("the key: a notes entry's frame (B49)", () => {
  const preset = (): Preset => ({ sheets: ["S"], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:C6" } as never], slides: [{ id: "s1", type: "content", tables: ["t1"], title: "Loans" } as never] });
  it("kept whole with its comment; each change one undo step (the inverse puts back the whole entry)", () => {
    const d = { preset: preset(), style: {}, edits: {} };
    const steps = [SP({ "t1:right": comment({ frame: { w: 2, color: "#C00000" } }) }), SP({ "t1:right": comment({ frame: { w: .5 } }) }),
      SP({ "t1:right": comment({ frame: "none" }) }), SP({ "t1:right": comment() }), SP({ "t1:right": null })];
    for (const op of steps) {
      const before = structuredClone(d), inv = inverseOf(d, op)!;
      expect(applyOp(d, op)).toBe(true);
      const after = structuredClone(d);
      expect(applyOp(d, inv)).toBe(true); expect(d).toEqual(before);
      applyOp(d, op); expect(d).toEqual(after);
    }
    applyOp(d, SP({ "t1:right": comment({ frame: { w: 3, color: "#2E7D32" } }) }));
    expect(d.preset.slides[0].notes!["t1:right"].frame).toEqual({ w: 3, color: "#2E7D32" });
  });
  it("this page knows it whole (compacts it); 4.0.0 would draw the box without it: the op and a deck holding one are format 5", () => {
    const set = SP({ "t1:right": comment({ frame: { w: 2, color: "#C00000" } }) }), none = SP({ "t1:right": comment({ frame: "none" }) });
    for (const op of [set, none]) { expect(knownOp(op)).toBe(true); expect(needsV5(op)).toBe(true); }
    // a comment without a border, an empty frame (drawn as unset), taking the comment off: 4.0 applies them as they are
    for (const op of [SP({ "t1:right": comment() }), SP({ "t1:right": comment({ frame: {} as never }) }), SP({ "t1:right": null }), SP({ "t1:right": { text: "x" } })]) expect(needsV5(op), JSON.stringify(op)).toBe(false);
    const d = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: preset() } as Op]).doc;
    expect(docNeedsV5(d)).toBe(false);
    expect(docNeedsV5(applyOps(d, [set]).doc)).toBe(true);
    expect(docNeedsV5(applyOps(d, [set, SP({ "t1:right": comment() })]).doc)).toBe(false);
    expect(docNeedsV5(applyOps(d, [none]).doc)).toBe(true);
    // the wizard's preset.set carrying a framed comment raises the deck too
    const p = preset(); (p.slides[0] as { notes?: object }).notes = { "t1:right": comment({ frame: { w: 1 } }) };
    expect(needsV5({ op: "preset.set", preset: p } as Op)).toBe(true);
  });
});

describe("how a frame reads (note-frame.ts)", () => {
  it("unset: the design's own; none (and a null in the entry); a weight and a colour, either defaulting; bad values", () => {
    expect(noteFrame(undefined, "excel")).toBeNull();
    expect(noteFrame("none", "excel")).toBe("none");
    expect(noteFrame(null, "excel")).toBe("none");
    expect(noteFrame({}, "excel")).toBeNull();
    expect(noteFrame({ w: 2, color: "#c00000" }, "excel")).toEqual({ w: 2, color: "#C00000" });
    expect(noteFrame({ w: 2 }, "excel")).toEqual({ w: 2, color: "#BFBFBF" });
    expect(noteFrame({ w: 2 }, "mckinsey")).toEqual({ w: 2, color: "#051C2C" });
    expect(noteFrame({ color: "#0A66D8" }, "clean")).toEqual({ w: 1, color: "#0A66D8" });
    expect(noteFrame({ w: 40, color: "red" }, "glass")).toEqual({ w: 12, color: "#A9B0BE" });
    expect(noteFrame({ w: 2, dash: "dashed" }, "bain")).toEqual({ w: 2, color: "#D6D6D6", dash: "dashed" });
    expect(frameStroke({ w: 2, color: "#C00000", dash: "dashed" })).toEqual({ w: 2, paint: { solid: [192, 0, 0] }, dash: [8, 6] });
    expect(frameCss(noteFrame({ w: 1.5, color: "#1F4E79" }, "excel"))).toBe("1.5px solid #1F4E79");
    expect(frameCss("none")).toBe("none");
    expect(frameCss(null)).toBeUndefined();
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
  const fonts: Record<string, Uint8Array> = { "Carlito-Regular.ttf": new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Regular.ttf"))), "Carlito-Bold.ttf": new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Bold.ttf"))) };
  page.handle("fontFile", x => { const g = fonts[x.file]; return g ? g.slice().buffer as ArrayBuffer : null; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: TODAY, pptx: true });
  const sys = (file: string, weight: number): CatalogFont => ({ source: "system", file, family: "Arial", weight, italic: false });
  const run = (kind: "pptx" | "pdf", design: Design, extra: Partial<ExportJob> = {}) =>
    page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report", catalog: [sys("Carlito-Regular.ttf", 400), sys("Carlito-Bold.ttf", 700)], ...extra });
  return { apply, lists, run };
}
const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const BASE = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
const KEY = "dhnms9c:right", BUB = "dhnms9c:bottom";

/** the display list's strokes of rect nodes (any depth), with the box they draw */
const strokes = (ns: Node[]): Extract<Node, { t: "rect" }>[] => ns.flatMap(n => n.t === "rect" && n.stroke ? [n] : n.t === "group" ? strokes(n.children) : []);
const noteHit = (ns: Node[], side: string): Extract<Node, { t: "hit" }> | undefined => ns.flatMap(n => n.t === "hit" ? [n] : n.t === "group" ? [] : []).find(h => h.kind === "f" && new RegExp(`^tnote ${side}\\b`).test(h.id));
const red = (n: Extract<Node, { t: "rect" }>) => "solid" in n.stroke!.paint && n.stroke!.paint.solid.join() === "192,0,0";
const blue = (n: Extract<Node, { t: "rect" }>) => "solid" in n.stroke!.paint && n.stroke!.paint.solid.join() === "31,78,121";

describe("drawn in every design and exported natively (B49)", () => {
  it("a 2 px red border round the comment, a 1 px blue one on a bubble comment, none on an Excel bubble: display list, PowerPoint, PDF", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx");
    const h = await open(deck, structuredClone(BASE));
    const before = Object.fromEntries(await Promise.all(DESIGNS.map(async d => [d, (await h.lists(d))[0].dl.nodes] as const)));
    // the comments: one with its own border, one in a bubble with a thin blue one; one undo step each
    expect(await h.apply("Automated comment", [SP({ [KEY]: comment({ text: "", frame: { w: 2, color: "#C00000" } }) }, "u9t3fqb")])).toBe(true);
    expect(await h.apply("Automated comment", [SP({ [BUB]: comment({ text: "", bubble: true, w: undefined, h: 160, frame: { w: 1, color: "#1F4E79" } }) }, "u9t3fqb")])).toBe(true);
    for (const design of DESIGNS) {
      const ls = await h.lists(design), dl = ls[0].dl.nodes, hit = noteHit(dl, "right")!, bh = noteHit(dl, "bottom")!;
      expect(hit, design).toBeTruthy(); expect(bh, design).toBeTruthy();
      // the display list: the stroke inside the box's edges (centred 1 px in for 2 px)
      const r = strokes(dl).filter(red);
      expect(r.length, design).toBe(1);
      expect([r[0].stroke!.w, r[0].x, r[0].y, r[0].w, r[0].h], design).toEqual([2, +(hit.x + 1).toFixed(2), +(hit.y + 1).toFixed(2), +(hit.w - 2).toFixed(2), +(hit.h - 2).toFixed(2)]);
      const b = strokes(dl).filter(blue);
      expect(b.length, design).toBe(1);
      // an Excel bubble's frame is the border (no second line): in Excel and Excel Refined (B48) the template's white box
      // with the border drawn on its own over it (an outline grouped with the text in PowerPoint), as in every design
      expect(b[0].fill, design).toBeUndefined();
      // PowerPoint: the border a shape with a native outline (a:ln) of 2 px = 15240 EMU (7620 per px), red, grouped with the text box
      const r1 = await h.run("pptx", design), z = unzipSync(new Uint8Array(r1.files[0])), xml = strFromU8(z["ppt/slides/slide1.xml"]);
      keep(`b49-border-${design}.pptx`, r1.files[0]);
      expect(xml, design).not.toContain("p:cxnSp");
      expect(xml, design).not.toContain("<p:pic>");
      expect(xml, design).toMatch(/<a:ln w="15240"[^>]*><a:solidFill><a:srgbClr val="C00000"\/>/);
      expect(xml, design).toMatch(/<a:ln w="7620"[^>]*><a:solidFill><a:srgbClr val="1F4E79"\/>/);
      const grp = xml.split("<p:grpSp>").slice(1).find(g => g.includes('<a:ln w="15240"><a:solidFill><a:srgbClr val="C00000"/>'));
      expect(grp, `${design}: the border and the text box in one group`).toBeTruthy();
      expect(grp!, design).toContain('name="Text box');
      expect(grp!.split("</p:grpSp>")[0], design).toContain("<p:txBody>");
      // the text box inside the border's line (its slack for PowerPoint's wrapping stops at the line)
      const sps = grp!.split("</p:grpSp>")[0].split("<p:sp>").slice(1).map(sp => { const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp)!; return { x: +m[1], w: +m[3], text: sp.includes("<p:txBody>") }; });
      const border = sps[0], tb = sps.find(s => s.text)!;
      expect(tb.x >= border.x && tb.x + tb.w <= border.x + border.w, `${design}: ${JSON.stringify(sps)}`).toBe(true);
      // the PDF: the same stroke
      const pdf = await h.run("pdf", design);
      keep(`b49-border-${design}.pdf`, pdf.files[0]);
      expect(pdf.unreadable ?? [], design).toEqual([]);
    }
    // "none": the Excel bubble without its frame; the other designs draw as without a border
    expect(await h.apply("Border", [SP({ [BUB]: comment({ bubble: true, w: undefined, h: 160, frame: "none" }) }, "u9t3fqb")])).toBe(true);
    const ex = (await h.lists("excel"))[0].dl.nodes, bh = noteHit(ex, "bottom")!;
    expect(strokes(ex).some(s => s.x >= bh.x && s.y >= bh.y && s.x + s.w <= bh.x + bh.w && s.y + s.h <= bh.y + bh.h)).toBe(false);
    // taken off (and the bubble comment removed): the slide draws as before – the default is unchanged
    expect(await h.apply("Border", [SP({ [KEY]: null, [BUB]: null }, "u9t3fqb")])).toBe(true);
    for (const design of DESIGNS) expect((await h.lists(design))[0].dl.nodes, design).toEqual(before[design]);
  }, 180_000);
  it("unset: a bubble comment draws exactly as before the key existed (Excel's template outline, B48)", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx");
    const h = await open(deck, structuredClone(BASE));
    expect(await h.apply("c", [SP({ [KEY]: comment({ bubble: true }) }, "u9t3fqb")])).toBe(true);
    const a = (await h.lists("excel"))[0].dl.nodes;
    const grey = strokes(a).filter(s => "solid" in s.stroke!.paint && s.stroke!.paint.solid.join() === "127,127,127" && s.stroke!.w === ISP.box.w);
    expect(grey.length).toBeGreaterThanOrEqual(1);
    expect(await h.apply("c", [SP({ [KEY]: comment({ bubble: true, frame: {} as never }) }, "u9t3fqb")])).toBe(true);
    expect((await h.lists("excel"))[0].dl.nodes).toEqual(a);
  }, 60_000);
  it("Excel and Excel Refined (B48 with B49): a comment box has the template outline; a user's border takes its place (one outline), grouped with its text in PowerPoint", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx");
    const h = await open(deck, structuredClone(BASE));
    const inBox = (ns: Node[], b: { x: number; y: number; w: number; h: number }) => strokes(ns).filter(s => s.x >= b.x - 1 && s.y >= b.y - 1 && s.x + s.w <= b.x + b.w + 1 && s.y + s.h <= b.y + b.h + 1);
    const tpl = (n: Extract<Node, { t: "rect" }>) => "solid" in n.stroke!.paint && n.stroke!.paint.solid.join() === "127,127,127" && n.stroke!.w === ISP.box.w;
    // without a border of its own: the template's outline, once
    expect(await h.apply("c", [SP({ [BUB]: comment({ bubble: true, w: undefined, h: 160 }) }, "u9t3fqb")])).toBe(true);
    for (const design of ["excel", "clean"] as const) {
      const dl = (await h.lists(design))[0].dl.nodes, bh = noteHit(dl, "bottom")!, s = inBox(dl, bh);
      expect(s.length, design).toBe(1);
      expect(tpl(s[0]), design).toBe(true);
      expect(s[0].r ?? 0, `${design}: square`).toBe(0);
    }
    // the user's border: its width and colour, one outline (no template frame under it)
    expect(await h.apply("c", [SP({ [BUB]: comment({ bubble: true, w: undefined, h: 160, frame: { w: 2, color: "#C00000" } }) }, "u9t3fqb")])).toBe(true);
    for (const design of ["excel", "clean"] as const) {
      const dl = (await h.lists(design))[0].dl.nodes, bh = noteHit(dl, "bottom")!, s = inBox(dl, bh);
      expect(s.length, `${design}: one outline`).toBe(1);
      expect(red(s[0]) && s[0].stroke!.w === 2, design).toBe(true);
      expect(strokes(dl).filter(tpl).filter(t => inBox([t], bh).length).length, design).toBe(0);
      // PowerPoint: one group, the outline (2 px red) and the text box
      const r1 = await h.run("pptx", design), xml = strFromU8(unzipSync(new Uint8Array(r1.files[0]))["ppt/slides/slide1.xml"]);
      keep(`b48-b49-border-${design}.pptx`, r1.files[0]);
      expect(xml.match(/<a:ln w="15240"[^>]*><a:solidFill><a:srgbClr val="C00000"\/>/g)?.length, `${design}: one red outline`).toBe(1);
      const grp = xml.split("<p:grpSp>").slice(1).find(g => g.split("</p:grpSp>")[0].includes('<a:ln w="15240"><a:solidFill><a:srgbClr val="C00000"/>'));
      expect(grp, `${design}: the border and the text box in one group`).toBeTruthy();
      const body = grp!.split("</p:grpSp>")[0];
      expect(body, design).toMatch(/^<p:nvGrpSpPr><p:cNvPr id="\d+" name="Text box/);
      expect(body, design).toContain("<p:txBody>");
      expect(body, `${design}: no template outline in the group`).not.toContain('<a:srgbClr val="7F7F7F"/>');
    }
  }, 120_000);
});
