/* S15.3 (LN-03 through the gate): the PowerPoint gate's line expectation (tools/real-icons.mjs linesOf) comes from the
   core's own PowerPoint lists, as the icons' (real-icons.test.ts): the corpus deck tests/corpus/charts/lines.json through
   the core worker's host – an attached callout line on the table's slide, eleven lines on the second (every route,
   heads, a limiter, a divider, labels, an end that lost its object) – counted per slide and merged into the expectation
   for pptxcheck --expect. The file holds exactly that many shapes or groups named "Line" per slide, no connector, and the
   attached line is written at its resolved ends. PPTX_OUT=dir writes the files and expectations there. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { FakeDeck } from "./fakedeck";
import { writePptx } from "../src/pptx/writer";
import { pptxFamily } from "../src/text/resolve";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "../src/rpc/messages";
import type { Design, Op, Preset } from "../src/model/types";
import type { Node } from "../src/dl/types";
import type { SlideSem } from "../src/pptx/scene";
import { realObjectsOf } from "../../tools/real-objects.mjs";
import { iconsOf, linesOf, pageLines, withIcons, withLines } from "../../tools/real-icons.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DECK = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/charts/lines.json"), "utf8")) as { workbook: string; ops: Op[] };

async function host() {
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
  await port.call("index", transfer({ buf: book(DECK.workbook) }, []));
  const [set, ...ops] = DECK.ops as [Extract<Op, { op: "preset.set" }>, ...Op[]];
  await port.call("start", { name: "report.xlsx", deck: deck.open("anna@pc#aaaaaaaa"), preset: set.preset as Preset, inputs: { defaults: {}, logoSrc: "", version: "", workbook: "report.xlsx" }, stage: { slide: 0, known: [] } });
  expect((await port.call("apply", { label: "Lines", ops })).changed).toBe(true);
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: "1 October 2026", pptx: true });
  return { lists };
}

describe("the PowerPoint gate's lines (tools/real-icons.mjs linesOf, pptxcheck (7))", () => {
  it("the corpus deck: the core's lines per slide, merged into the expectation; the file holds exactly those, never a connector", async () => {
    const { lists } = await host();
    const out = process.env.PPTX_OUT;
    for (const design of ["excel", "glass", "clean", "mckinsey", "bain"] as Design[]) {
      const L = await lists(design) as unknown as { dl: { nodes: Node[] }; sem: SlideSem }[];
      // (S15.5) with their native ends – s1 1, s2 2, s3 2, e1 1, v1 1, m2 1 (a bar is a tick, not an end) – and the
      // dashed ones (s3, d1, x1)
      expect(linesOf(L), design).toEqual([{ slide: 1, lines: 1, heads: 1, dashed: 0 }, { slide: 2, lines: 11, heads: 8, dashed: 3 }]);
      const expectation = withLines(withIcons(realObjectsOf(L), iconsOf(L)), linesOf(L));
      expect(expectation, design).toEqual([{ slide: 1, tables: 1, charts: 0, icons: 1, lines: 1, heads: 1, dashed: 0 }, { slide: 2, tables: 0, charts: 0, lines: 11, heads: 8, dashed: 3 }]);
      // the callout line follows its icon and its table, as drawn in this design
      const c1 = L[0].sem.items.c1;
      if (c1.kind !== "line" || !c1.line) throw new Error("no line geometry");
      expect(c1.line.a).toEqual({ x: 1420, y: 792 });
      const bytes = writePptx({ slides: L.map(l => ({ nodes: l.dl.nodes, sem: l.sem })), image: () => undefined, face: css => pptxFamily(css), title: "Lines", design: "Excel" });
      const z = unzipSync(bytes);
      for (const [k, n] of [[1, 1], [2, 11]]) {
        const xml = strFromU8(z[`ppt/slides/slide${k}.xml`]);
        expect(xml, design).not.toContain("<p:cxnSp");
        expect(xml, design).not.toContain("<p:pic>");
        // the outermost "Line" shapes or groups (a labelled line is a group "Line" holding its shape "Line")
        const stack: (string | null)[] = []; let top = 0;
        for (const m of xml.matchAll(/<p:grpSp>|<\/p:grpSp>|<p:cNvPr id="\d+" name="([^"]*)"/g)) {
          if (m[0] === "<p:grpSp>") { stack.push(null); continue; }
          if (m[0] === "</p:grpSp>") { stack.pop(); continue; }
          const ln = /^Line \d+$/.test(m[1]), inLine = stack.some(x => x === "Line");
          if (stack.length && stack[stack.length - 1] === null) stack[stack.length - 1] = ln ? "Line" : "other";
          if (ln && !inLine) top++;
        }
        expect(top, `${design} slide ${k}`).toBe(n);
      }
      if (out) {
        fs.writeFileSync(path.join(out, `lines-${design}.pptx`), bytes);
        fs.writeFileSync(path.join(out, `lines-${design}.expect.json`), JSON.stringify({ [path.join(out, `lines-${design}.pptx`)]: expectation }));
      }
    }
  }, 120_000);
  it("the line that lost its object is still drawn and exported at its saved end; the page's script runs linesOf's own code", async () => {
    const { lists } = await host();
    const L = await lists("excel") as unknown as { dl: { nodes: Node[] }; sem: SlideSem }[];
    const x1 = L[1].sem.items.x1;
    if (x1.kind !== "line" || !x1.line) throw new Error("no line geometry");
    expect(x1.line.b).toEqual({ x: 1400, y: 760 });
    expect(pageLines("glass")).toContain("x.kind === \"line\" && x.line");
    expect(withLines([{ slide: 2, tables: 1, charts: 0 }], [{ slide: 1, lines: 2 }, { slide: 2, lines: 1 }])).toEqual([{ slide: 1, tables: 0, charts: 0, lines: 2 }, { slide: 2, tables: 1, charts: 0, lines: 1 }]);
  }, 120_000);
});
