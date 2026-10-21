/* Hidden slides per design (S13.6, B47; 09 §2.8, rows HS-01 … HS-03): SlideDef.hide = {design: true}, set by slide.patch
   (merged per design); the design's exports leave the slide out, the page numbers and the contents slide count only the
   slides shown in that design; the stage and the thumbnails still draw it (with no page number). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOp, applyOps, docNeedsV5, emptyDoc, inverseOf, knownOp, needsV5 } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { computeLayout } from "../src/render/layout";
import { slideToDisplayList } from "../src/render/slide-dl";
import { hiddenIn, isHidden, pageNoFor, pageNumber } from "../src/render/pagenumbers";
import type { Design, Op, Preset } from "../src/model/types";
import type { Node } from "../src/dl/types";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "../src/rpc/messages";

const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const preset = (): Preset => ({ sheets: [], tables: [], slides: [
  { id: "c", type: "cover", title: "Review", tables: [] }, { id: "x", type: "index", title: "Contents", tables: [] },
  { id: "a", type: "content", title: "Alpha", tables: [] }, { id: "b", type: "content", title: "Beta", tables: [] },
  { id: "g", type: "content", title: "Gamma", tables: [] }] });
const hide = (id: string, h: Record<string, true | null> | null): Op => ({ op: "slide.patch", id, patch: { hide: h } } as Op);
const m = { run: (t: string, f: string) => { const size = parseFloat(/([\d.]+)px/.exec(f)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; }, lines: (t: string) => [t] };
const texts = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? texts(n.children) : []);
function ctxOf(p: Preset, design: Design, pn = { on: true, format: "nN" }) {
  const slides = runtimeSlides({ sheets: [], meta: [] } as never, p, "W.xlsx", design);
  return { style: { ...resolveStyle({}, { pn } as never), design }, edits: {}, slides, preset: p, workbook: "W.xlsx", logoSrc: "", sheet: () => null, version: null } as never as Parameters<typeof pageNoFor>[0];
}
const draw = (ctx: ReturnType<typeof ctxOf>, i: number) => texts(slideToDisplayList(ctx.slides[i], i, ctx, [], computeLayout(ctx.slides[i], ctx).boxes, { wall: null, logo: null }, m as never, "1 October 2026").nodes);

describe("the key: slide.patch hide (HS-01, HS-03)", () => {
  it("merged per design; undo (the inverse) round-trips each change, one step each", () => {
    const base = () => ({ preset: preset(), style: {}, edits: {} });
    const cases: Op[] = [hide("a", { glass: true }), hide("a", { glass: true, excel: true, clean: true, mckinsey: true, bain: true }), hide("a", null)];
    let d = base() as ReturnType<typeof base>;
    applyOp(d, hide("a", { excel: true }));
    for (const op of cases) {
      const before = JSON.parse(JSON.stringify(d)), inv = inverseOf(d, op)!;
      expect(applyOp(d, op)).toBe(true); expect(applyOp(d, inv)).toBe(true);
      expect(d).toEqual(before);
      applyOp(d, op);
    }
    expect(d.preset.slides[2].hide).toBeUndefined();
    d = base(); applyOp(d, hide("a", { glass: true })); applyOp(d, hide("a", { glass: null }));
    expect("hide" in d.preset.slides[2]).toBe(false);                 // an empty map is removed
  });
  it("a 4.6 page knows it whole (compacts it); 4.0.0 does not: the op and a deck holding a non-empty map are format 5", () => {
    expect(knownOp(hide("a", { glass: true }))).toBe(true);
    expect(knownOp(hide("a", null))).toBe(true);
    expect(needsV5(hide("a", { glass: true }))).toBe(true);
    expect(needsV5(hide("a", null))).toBe(true);
    const d = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: preset() }]).doc;
    expect(docNeedsV5(d)).toBe(false);
    expect(docNeedsV5(applyOps(d, [hide("a", { glass: true })]).doc)).toBe(true);
    expect(docNeedsV5(applyOps(d, [hide("a", { glass: true }), hide("a", { glass: null })]).doc)).toBe(false);
    // a preset.set (the wizard) carrying a hidden slide raises the deck too
    expect(needsV5({ op: "preset.set", preset: { ...preset(), slides: [{ id: "a", type: "content", tables: [], hide: { bain: true } }] } } as Op)).toBe(true);
  });
  it("hiddenIn reads only `true` of that design", () => {
    expect(hiddenIn({ hide: { glass: true } }, "glass")).toBe(true);
    expect(hiddenIn({ hide: { glass: true } }, "excel")).toBe(false);
    expect(hiddenIn({ hide: { glass: "yes" as never } }, "glass")).toBe(false);
    expect(hiddenIn(undefined, "glass")).toBe(false);
  });
});

describe("numbers and contents count the slides shown in the design (HS-02)", () => {
  const p = applyOps({ preset: preset(), style: {}, edits: {} }, [hide("b", { glass: true })]).doc.preset!;
  it("page numbers skip the hidden slide in its design only; the hidden slide has none; N counts the shown", () => {
    const g = ctxOf(p, "glass"), e = ctxOf(p, "excel");
    expect([0, 1, 2, 3, 4].map(i => pageNumber(g, i))).toEqual([1, 2, 3, 4, 4]);
    expect([1, 2, 3, 4].map(i => pageNoFor(g, i))).toEqual(["2 / 4", "3 / 4", null, "4 / 4"]);
    expect([1, 2, 3, 4].map(i => pageNoFor(e, i))).toEqual(["2 / 5", "3 / 5", "4 / 5", "5 / 5"]);
    expect(isHidden(g, 3)).toBe(true); expect(isHidden(e, 3)).toBe(false);
    // the last slide hidden: N is the last shown page
    const last = applyOps({ preset: p, style: {}, edits: {} }, [hide("g", { glass: true })]).doc.preset!;
    expect(pageNoFor(ctxOf(last, "glass"), 2)).toBe("3 / 3");
  });
  for (const design of DESIGNS) it(`the contents slide leaves the hidden slide out and renumbers the pages after it (${design})`, () => {
    const q = applyOps({ preset: preset(), style: {}, edits: {} }, [hide("b", { [design]: true })]).doc.preset!;
    const shown = draw(ctxOf(q, design), 1), other = draw(ctxOf(q, design === "glass" ? "excel" : "glass", { on: true, format: "n" }), 1);
    expect(shown).toContain("Alpha"); expect(shown).toContain("Gamma"); expect(shown).not.toContain("Beta");
    // Gamma is page 4 in this design (cover 1, contents 2, Alpha 3); 5 in the other, where Beta shows
    const gi = shown.indexOf("Gamma");
    expect(shown.slice(gi, gi + 4)).toContain("4");
    expect(other).toContain("Beta");
    // the hidden slide draws (the stage), with no page number
    const hs = draw(ctxOf(q, design), 3);
    expect(hs).toContain("Beta"); expect(hs.some(t => /\d \/ \d/.test(t))).toBe(false);
  });
});

/* ---- the exports leave hidden slides out (host.ts slideLists): the deck, PNG all, PowerPoint, every version × design,
   Run for each value – all ask without `slides`; the current slide (named) still exports; thumbnails draw them ---- */
const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
describe("the exports leave the design's hidden slides out (HS-02)", () => {
  it("lists for an export skip them in that design only; a named slide and the thumbnails' lists draw them", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), api = deck.api();
    const [a, b] = pair();
    serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
    const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
    port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
    port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
    port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
    port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
    port.handle("linkedWorkbook", () => null);
    for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
    await port.call("init", { served: true, client: "c1", me: "anna" });
    await port.call("index", transfer({ buf: book("report.xlsx") }, []));
    const def = await port.call("defaultPreset", {});
    const p: Preset = { ...def, slides: [{ id: "c", type: "cover", title: "Review", tables: [] }, { id: "x", type: "index", title: "Contents", tables: [] },
      ...def.slides.filter(s => s.type === "content").slice(0, 1), { id: "h", type: "content", title: "Secret", tables: [] }, { id: "z", type: "content", title: "Zeta", tables: [] }] };
    await port.call("start", { name: "report.xlsx", deck: deck.open("anna@pc#aaaaaaaa"), preset: p, inputs: { defaults: {}, logoSrc: "", version: "", workbook: "report.xlsx" }, stage: { slide: 0, known: [] } });
    expect((await port.call("apply", { label: "Hide slide", ops: [hide("h", { glass: true })] })).changed).toBe(true);
    const lists = (design: Design, extra: object = {}) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: "1 October 2026", ...extra });
    const g = await lists("glass");
    expect(g.map(l => l.slide)).toEqual([0, 1, 2, 4]);
    const words = (l: typeof g) => l.flatMap(x => texts(x.dl.nodes));
    expect(words(g)).not.toContain("Secret");
    expect(words(g.filter(l => l.slide === 1))).toContain("Zeta");
    expect((await lists("glass", { pptx: true })).map(l => l.slide)).toEqual([0, 1, 2, 4]);
    expect((await lists("excel")).map(l => l.slide)).toEqual([0, 1, 2, 3, 4]);
    // the current slide, named: exported although hidden
    expect(words(await lists("glass", { slides: [3] }))).toContain("Secret");
    // thumbnails (not an export): every slide
    expect((await lists("glass", { forExport: false })).map(l => l.slide)).toEqual([0, 1, 2, 3, 4]);
    // undo shows it again: one step
    await port.call("undo", { redo: false });
    expect((await lists("glass")).map(l => l.slide)).toEqual([0, 1, 2, 3, 4]);
  }, 60_000);
});
