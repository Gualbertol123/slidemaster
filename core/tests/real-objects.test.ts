/* S14.P review, 1: what export-check's PowerPoint gate expects of each slide (tools/real-objects.mjs) comes from the
   core's own PowerPoint lists (host.ts slideLists with `pptx`), so a table whose sheet is gone (corpus
   missing-table.json), the design's hidden slides and slides / tables added by slide.add / table.add are counted as the
   export draws them – and the gate (pptxcheck (5)) then asks the file for exactly those real tables and native charts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "../src/rpc/messages";
import type { Design, Op, Preset } from "../src/model/types";
import { pageRealObjects, realObjectsOf } from "../../tools/real-objects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

async function host(preset: (def: Preset) => Preset) {
  const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), api = deck.api();
  const [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key, x.format));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: book("report.xlsx") }, []));
  const def = await port.call("defaultPreset", {});
  await port.call("start", { name: "report.xlsx", deck: deck.open("anna@pc#aaaaaaaa"), preset: preset(def), inputs: { defaults: {}, logoSrc: "", version: "", workbook: "report.xlsx" }, stage: { slide: 0, known: [] } });
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: "1 October 2026", pptx: true });
  return { port, lists };
}

describe("the PowerPoint gate's expectation (tools/real-objects.mjs)", () => {
  it("from the core's lists: a missing sheet's table, a hidden slide, slide.add / table.add and charts as the export draws them", async () => {
    let T = "";
    const { port, lists } = await host(def => (T = def.slides.find(s => s.type === "content")!.tables[0], { ...def,
      tables: [...def.tables, { id: "ghostT1", sheet: "Deleted sheet", kind: "range", range: "A1:C5" }],
      slides: [{ id: "c", type: "cover", title: "Review", tables: [] },
        { id: "a", type: "content", title: "Real and ghost", tables: [T, "ghostT1"],
          items: { c1: { kind: "chart", type: "pie", values: { table: T, range: "D6:D11" }, box: { x: 980, y: 250, w: 560, h: 420 } } } },
        { id: "g", type: "content", title: "Only a missing table", tables: ["ghostT1"] },
        { id: "h", type: "content", title: "Hidden in glass", tables: [T] }] }));
    // a slide and a table added by the 4.6 ops (not in any preset.set), a slide hidden in Liquid Glass only
    const ops: Op[] = [{ op: "slide.add", slide: { id: "n", type: "content", title: "Added", tables: [] }, after: "h" },
      { op: "table.add", slide: "n", table: { id: "addT", sheet: "SLIDE_1", kind: "markers", anchor: "B3", index: 0 } },
      { op: "slide.patch", id: "h", patch: { hide: { glass: true } } }];
    expect((await port.call("apply", { label: "Prepare", ops })).changed).toBe(true);
    // Excel: every slide; the cover nothing, slide 2 its one real table and the chart, slide 3 nothing (its only table's
    // sheet is gone), the hidden-in-glass slide and the added one a table each
    expect(realObjectsOf(await lists("excel"))).toEqual([{ slide: 2, tables: 1, charts: 1 }, { slide: 4, tables: 1, charts: 0 }, { slide: 5, tables: 1, charts: 0 }]);
    // Liquid Glass: the hidden slide is not in the file, so the added slide is the file's 4th
    expect(realObjectsOf(await lists("glass"))).toEqual([{ slide: 2, tables: 1, charts: 1 }, { slide: 4, tables: 1, charts: 0 }]);
  }, 60_000);

  it("the page's script runs realObjectsOf's own code over the page's slideLists", async () => {
    const lists = [{ dl: { nodes: [{ t: "hit", kind: "f", id: "tw" }, { t: "group", children: [{ t: "hit", kind: "f", id: "tw" }] }, { t: "group", children: [{ t: "hit", id: "tw" }, { t: "group", children: [] }] }] }, sem: { items: { a: { kind: "chart" }, b: { kind: "shape" } } } },
      { dl: { nodes: [] } }];
    expect(realObjectsOf(lists)).toEqual([{ slide: 1, tables: 2, charts: 1 }]);
    let asked: unknown = null;
    const g = globalThis as unknown as { window?: unknown };
    g.window = { __sbTest: { slideLists: async (a: unknown) => { asked = a; return lists; } } };
    try { expect(await (0, eval)(pageRealObjects("bain"))).toEqual([{ slide: 1, tables: 2, charts: 1 }]); }
    finally { delete g.window; }
    expect(asked).toEqual({ design: "bain", version: "", forExport: true, thumb: false, pptx: true });
  });
});
