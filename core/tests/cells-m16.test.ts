/* S16.3 (4.9, B38; PT-01…PT-03; docs/next/09 §9 Q9, Q19): a cell's number display (CellEdit.num – Decimals −/+, %,
   Thousands) and vertical alignment (CellEdit.valign), set on the slide over the workbook's: the ops and their vectors
   (shared/ops-vectors.d/m16-cells.json) with the guard, the steps of render/numdisplay.ts, what effItems makes of them,
   the display lists of every design (PDF and PNG draw these), PowerPoint's native table cells (a:tcPr anchor, the
   text), and a deck saved with them (fixtures/saved/cells-4.9.json, added, never edited). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { loadVectors } from "./vectors";
import { deckOf } from "./corpus-deck";
import { applyOps, docNeedsV5, knownOp, needsV5 } from "../src/model/ops";
import { fold, nextSnapshot } from "../src/model/fold";
import { effFmt, effItems, keyOf } from "../src/render/edits";
import { MAX_DEC, numHas, stepNum } from "../src/render/numdisplay";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { glassPlan } from "../src/render/glass";
import { glassText } from "../src/render/glass-dl";
import { wrapLines } from "../src/text/lines";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { DisplayList, Node, TextNode } from "../src/dl/types";
import type { Design, Op, Preset } from "../src/model/types";
import type { Item, TableLayout } from "../src/xlsx/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const C = (ref: string, patch: object, sheet = "LOANS_DEPOSITS"): Op => ({ op: "cell.patch", sheet, ref, patch } as Op);

describe("the ops: cell.patch valign / num (m16-cells.json; the guard)", () => {
  const mine = loadVectors().filter(v => /^(fold: )?M16 /.test(v.name));
  it("the vectors are there: set, change, clear, the multi-selection paste, two writers (per key, Lamport)", () => {
    expect(mine.filter(v => !v.fold).length).toBeGreaterThanOrEqual(5);
    expect(mine.filter(v => v.fold).length).toBeGreaterThanOrEqual(2);
  });
  for (const v of mine.filter(x => !x.fold)) it(v.name + ": knownOp, needsV5 and the document's docNeedsV5", () => {
    for (const op of v.ops) expect(knownOp(op)).toBe(true);
    expect(v.ops.map((op: Op) => needsV5(op))).toEqual(v.expect.needsV5);
    expect(docNeedsV5(applyOps(v.doc, v.ops).doc)).toBe(v.expect.docNeedsV5);
  });
  it("4.0.0 does not know the keys: needsV5 by themselves, with a 4.0 key beside them too", () => {
    expect(needsV5(C("A1", { valign: "top" }))).toBe(true);
    expect(needsV5(C("A1", { num: "0%", b: true }))).toBe(true);
    expect(needsV5(C("A1", { b: true }))).toBe(false);
  });
});

describe("number display steps (render/numdisplay.ts: Excel's Decimals −/+, %, Thousands)", () => {
  it("decimals: one more, one fewer, the point gone with the last; every numeric section; at most MAX_DEC", () => {
    expect(stepNum("#,##0", "dec+")).toBe("#,##0.0");
    expect(stepNum("#,##0.0", "dec+")).toBe("#,##0.00");
    expect(stepNum("#,##0.00", "dec-")).toBe("#,##0.0");
    expect(stepNum("#,##0.0", "dec-")).toBe("#,##0");
    expect(stepNum("#,##0", "dec-")).toBeNull();
    expect(stepNum("0.0%", "dec+")).toBe("0.00%");
    expect(stepNum("#,##0;[Red](#,##0)", "dec+")).toBe("#,##0.0;[Red](#,##0.0)");
    expect(stepNum('#,##0 "€";-#,##0 "€";"–"', "dec+")).toBe('#,##0.0 "€";-#,##0.0 "€";"–"');
    expect(stepNum("0.00E+00", "dec-")).toBe("0.0E+00");
    expect(stepNum("0" + "." + "0".repeat(MAX_DEC), "dec+")).toBeNull();
  });
  it("General: from the decimals the value shows now", () => {
    expect(stepNum("General", "dec+", 3.25)).toBe("0.000");
    expect(stepNum("General", "dec-", 3.25)).toBe("0.0");
    expect(stepNum("General", "dec-", 12)).toBeNull();
    expect(stepNum(null, "pct", .5)).toBe("0%");
    expect(stepNum("General", "thou", 1234.5)).toBe("#,##0.0");
  });
  it("% and thousands toggle; literal text, colours and conditions are never changed; dates and text do not step", () => {
    expect(stepNum("0.0", "pct")).toBe("0.0%");
    expect(stepNum("0.0%", "pct")).toBe("0.0");
    expect(stepNum("0", "thou")).toBe("#,##0");
    expect(stepNum("0.00", "thou")).toBe("#,##0.00");
    expect(stepNum("#,##0.00", "thou")).toBe("0.00");
    expect(stepNum("#,###", "thou")).toBe("#");
    expect(stepNum('[Blue]0" pts"', "dec+")).toBe('[Blue]0.0" pts"');
    expect(stepNum('0" 0.0%"', "pct")).toBe('0%" 0.0%"');
    expect(stepNum("dd/mm/yyyy", "dec+")).toBeNull();
    expect(stepNum("@", "dec+")).toBeNull();
    expect(numHas("#,##0.0%", "pct")).toBe(true); expect(numHas("#,##0.0", "thou")).toBe(true);
    expect(numHas("0.0", "thou")).toBe(false); expect(numHas('0" %"', "pct")).toBe(false);
  });
});

/* ---- on the slide: the weekly deck's loans table (D8 = 76.777 as "#,##0", rows 20 px) ---- */
const TABLE = "l4tsxhl";
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const texts = (l: DisplayList) => flat(l).filter((n): n is TextNode => n.t === "text");
async function table(design: Design, ops: Op[] = []) {
  const { ctx, slides } = await deckOf("weekly.json", design, ops);
  const L = slides.flatMap(s => s.tables).find(t => t.def?.id === TABLE)! as TableLayout;
  return { L, c: ctx(), items: effItems(L, ctx()) };
}
const at = (items: Item[], ref: string) => items.find(it => keyOf(it) === ref)!;

describe("effItems: the number display and the vertical position (PT-01)", () => {
  it("num reformats the number from the workbook's value (Italian separators); a text edit wins; text cells keep theirs", async () => {
    const base = await table("excel");
    expect(at(base.items, "D8").text).toBe("76.777");
    const t = await table("excel", [C("D8", { num: "#,##0.0" }), C("E8", { num: "0.00%" }), C("F8", { num: "#,##0;[Red]-#,##0" })]);
    const raw = base.L.sheet.get(at(base.items, "D8").b.src.r, at(base.items, "D8").b.src.c)!.v as number;
    expect(at(t.items, "D8").text).toBe((Math.round(raw * 10) / 10).toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ".").replace(/\.(\d)$/, ",$1"));
    expect(at(t.items, "E8").text).toMatch(/^\d[\d.]*,\d\d%$/);
    expect(at(t.items, "F8").text).toBe(at(base.items, "F8").text);
    // a text the user wrote stays as written
    const w = await table("excel", [C("D8", { text: "n/a", orig: "76.777", num: "0.0" })]);
    expect(at(w.items, "D8").text).toBe("n/a");
    // a text cell: no change
    const label = base.items.find(it => it.ctype === "s" && it.text)!;
    const l2 = await table("excel", [C(keyOf(label), { num: "0.0" })]);
    expect(at(l2.items, keyOf(label)).text).toBe(label.text);
    // a [Red] negative section: its colour, unless the user set one
    const neg = await table("excel", [C("D8", { num: "[Red]0;0" })]);
    expect(at(neg.items, "D8").color.toUpperCase()).toBe("#FF0000");
    const negInk = await table("excel", [C("D8", { num: "[Red]0;0", color: "#123456" })]);
    expect(at(negInk.items, "D8").color).toBe("#123456");
    // a stored code that is not a string (a later page's, hand-edited) is ignored
    const bad = await table("excel", [C("D8", { num: 7 })]);
    expect(at(bad.items, "D8").text).toBe("76.777");
  });
  it("valign: Excel's words on the item (middle → center), marked as set on the slide; effFmt reports both keys", async () => {
    const t = await table("excel", [C("D8", { valign: "top" }), C("E8", { valign: "middle" }), C("F8", { valign: "bottom", num: "0.0" }), C("G8", { valign: "sideways" })]);
    expect([at(t.items, "D8").valign, at(t.items, "E8").valign, at(t.items, "F8").valign, at(t.items, "G8").valign]).toEqual(["top", "center", "bottom", "bottom"]);
    expect(at(t.items, "D8").userVAlign).toBe("top"); expect(at(t.items, "G8").userVAlign).toBeUndefined();
    const f = effFmt(t.c, { ...at(t.items, "F8"), L: t.L });
    expect([f.valign, f.num]).toEqual(["bottom", "0.0"]);
  });
});

describe("drawn: every design puts the text where its cell says (PDF and PNG draw these lists)", () => {
  const baseline = (l: DisplayList, src: string) => texts(l).find(n => n.src === src)!.y;
  it("Excel / Excel Refined / the consulting designs (excel-dl's cellText): top < middle < bottom, the number as displayed", async () => {
    for (const d of ["excel", "clean"] as Design[]) {
      const ys = [];
      for (const v of ["top", "middle", "bottom"]) {
        const t = await table(d, [C("D8", { valign: v, num: "#,##0.00" }), C("D8", { sz: 8 })]);
        const l = excelToDisplayList(t.L, t.c, M).nodes, src = at(t.items, "D8").text;
        expect(src).toMatch(/,\d\d$/);
        ys.push(baseline(l, src));
      }
      expect(ys[0], d).toBeLessThan(ys[1]); expect(ys[1], d).toBeLessThan(ys[2]);
    }
  });
  it("Liquid Glass: centred as designed; top and bottom when set on the slide (a workbook's bottom stays centred)", async () => {
    const y = async (ops: Op[]) => {
      const t = await table("glass", [C("D8", { sz: 8 }), ...ops]), p = glassPlan(t.L, t.c, {});
      const g = p.texts.find(x => keyOf(x.it) === "D8")!;
      return texts(glassText(g, M)).find(n => n.src === g.it.text)!.y;
    };
    const own = await y([]), top = await y([C("D8", { valign: "top" })]), mid = await y([C("D8", { valign: "middle" })]), bot = await y([C("D8", { valign: "bottom" })]);
    expect(top).toBeLessThan(own); expect(bot).toBeGreaterThan(own); expect(mid).toBeCloseTo(own, 1);
  });
});

/* ---- PowerPoint: the export's own path (as pptx-m13.test.ts) ---- */
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const OUT = process.env.SB_PPTX_OUT || "";
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), ch => ch.charCodeAt(0));
async function exporter(deck: FakeDeck, preset: Preset) {
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
  page.handle("fontFile", () => null); page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f).handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const run = (kind: "pptx", design: Design) => page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: "1 October 2026", scale: 1, title: "Report", catalog: [] });
  return { apply, run };
}
/** the a:tc cells of a slide's tables: their text and tcPr anchor */
function cellsOf(xml: string) {
  return [...xml.matchAll(/<a:tc(?: [^>]*)?>([\s\S]*?)<\/a:tc>/g)].map(m => ({ text: [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(x => x[1]).join(""), anchor: /<a:tcPr [^>]*anchor="(\w+)"/.exec(m[1])?.[1] ?? null }));
}
describe("PowerPoint: native table cells take the number display and the vertical position (a:tcPr anchor)", () => {
  it("report.xlsx's first table: a number with one more decimal and as %, top / bottom anchors (the PDF draws the display lists tested above)", async () => {
    const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { ops: Op[] };
    const preset = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await exporter(deck, preset);
    const { slides, ctx } = await deckOf("report.json", "excel");
    const L = slides[0].tables[0] as TableLayout, nums = effItems(L, ctx()).filter(it => it.ctype === "n" && it.text && !it.merged).slice(0, 3);
    expect(nums.length).toBe(3);
    const sheet = L.sheet.name, [a, b, c] = nums;
    // a big font in a tall row, so PowerPoint's anchor is unambiguous
    const rows = { [String(a.b.r)]: 60, [String(b.b.r)]: 60, [String(c.b.r)]: 60 };
    const cellA = L.sheet.get(a.b.src.r, a.b.src.c)!, fmtA = stepNum(cellA.fmt, "dec+", cellA.v as number)!;
    expect(await h.apply("Row height", [{ op: "table.patch", id: L.def!.id, patch: { rows } } as Op])).toBe(true);
    expect(await h.apply("Number display", [C(keyOf(a), { num: fmtA, valign: "top" }, sheet), C(keyOf(b), { num: "0.0%", valign: "bottom" }, sheet), C(keyOf(c), { valign: "middle" }, sheet)])).toBe(true);
    for (const design of ["excel", "clean", "glass", "mckinsey", "bain"] as Design[]) {
      const r = await h.run("pptx", design), file = r.files[0];
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `m16-cells-${design}.pptx`), new Uint8Array(file)); }
      const z = unzipSync(new Uint8Array(file)), xml = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).join("");
      expect(xml, design).toContain("<a:tbl>");
      const cells = cellsOf(xml);
      const want = (await deckOf("report.json", design, [{ op: "table.patch", id: L.def!.id, patch: { rows } } as Op,
        C(keyOf(a), { num: fmtA, valign: "top" }, sheet), C(keyOf(b), { num: "0.0%", valign: "bottom" }, sheet), C(keyOf(c), { valign: "middle" }, sheet)]));
      const eff = effItems(want.slides[0].tables[0] as TableLayout, want.ctx());
      const ta = at(eff, keyOf(a)).text, tb = at(eff, keyOf(b)).text;
      expect(ta, design).toMatch(/,\d$/); expect(tb, design).toMatch(/%$/);
      const ca = cells.find(x => x.text === ta), cb = cells.find(x => x.text === tb);
      expect(ca, `${design}: ${ta}`).toBeTruthy(); expect(cb, `${design}: ${tb}`).toBeTruthy();
      expect(ca!.anchor, design).toBe("t"); expect(cb!.anchor, design).toBe("b");
    }
  }, 180_000);
});

describe("a deck saved with cell number displays and vertical positions (fixtures/saved/cells-4.9.json, added, never edited)", () => {
  it("its records fold in any order, are known whole, need format 5; the next snapshot stays format 5 and keeps the keys", () => {
    const saved = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "saved", "cells-4.9.json"), "utf8"));
    const { snapshot: snap, records: recs } = saved as { snapshot: any; records: any[] };
    expect(recs.every(r => r.ops.every(knownOp))).toBe(true);
    expect(recs.every(r => r.ops.some(needsV5))).toBe(true);
    const f = fold(snap, recs);
    expect(fold(snap, [...recs].reverse()).doc).toEqual(f.doc);
    expect(fold(snap, [...recs.slice(2), ...recs.slice(0, 2)]).doc).toEqual(f.doc);
    expect(docNeedsV5(f.doc)).toBe(true);
    const next = nextSnapshot(snap, f, {});
    expect(next.format).toBe(5);
    expect(next.doc.edits).toEqual(f.doc.edits);
    // two writers on one cell: bob's valign and anna's later num both kept; their same key: the later Lamport time
    expect(f.doc.edits.LOANS_DEPOSITS.D8).toEqual({ b: true, valign: "top", num: "#,##0.0" });
    expect(f.doc.edits.LOANS_DEPOSITS.E8).toEqual({ num: "0.0%", valign: "middle", font: "Arial" });
    expect(f.doc.edits.LOANS_DEPOSITS.F8).toEqual({ num: "0.0%", valign: "middle", font: "Arial" });
  });
});
