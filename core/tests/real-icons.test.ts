/* S15.2 review, 1: the PowerPoint gate's icon expectation (tools/real-icons.mjs) comes from the core's own PowerPoint
   lists, as the tables' and charts' (real-objects.test.ts): the corpus deck tests/corpus/charts/icons.json through the
   core worker's host, its Tabler icons counted per slide – a built-in icon and a name the set does not have are the
   built-in shape, not counted – and merged into realObjectsOf's entries for pptxcheck --expect. The PowerPoint file of
   those lists holds exactly that many shapes or groups named "Icon" per slide, and the unknown name is not one of them.
   PPTX_OUT=dir writes the file and its expectation there (python3 tools/pptxcheck.py check … --expect …). */
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
import { iconsOf, pageIcons, withIcons } from "../../tools/real-icons.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DECK = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/charts/icons.json"), "utf8")) as { workbook: string; ops: Op[] };

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
  expect((await port.call("apply", { label: "Icons", ops })).changed).toBe(true);
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: "1 October 2026", pptx: true });
  return { lists };
}

describe("the PowerPoint gate's icons (tools/real-icons.mjs, pptxcheck (6))", () => {
  it("the corpus deck: the core's Tabler icons per slide, merged into the real-objects entries; the file holds exactly those, the unknown name not among them", async () => {
    const { lists } = await host();
    const out = process.env.PPTX_OUT;
    for (const design of ["excel", "glass", "clean", "mckinsey", "bain"] as Design[]) {
      const L = await lists(design) as unknown as { dl: { nodes: Node[] }; sem: SlideSem }[];
      // slide 1: the table's slide, one icon; slide 2: seven Tabler icons (the built-in target / arrow-up and the
      // unknown name drawn as "info" are not)
      expect(iconsOf(L), design).toEqual([{ slide: 1, icons: 1 }, { slide: 2, icons: 7 }]);
      const expectation = withIcons(realObjectsOf(L), iconsOf(L));
      expect(expectation, design).toEqual([{ slide: 1, tables: 1, charts: 0, icons: 1 }, { slide: 2, tables: 0, charts: 0, icons: 7 }]);
      const bytes = writePptx({ slides: L.map(l => ({ nodes: l.dl.nodes, sem: l.sem })), image: () => undefined, face: css => pptxFamily(css), title: "Icons", design: "Excel" });
      const z = unzipSync(bytes);
      const s2 = strFromU8(z["ppt/slides/slide2.xml"]);
      // the outermost "Icon" shapes or groups: seven (brand-parsinta is a group of shapes also named "Icon")
      const top = (xml: string) => {
        // the stack of open groups' names (a group's own cNvPr comes right after its <p:grpSp>); an "Icon" inside an Icon group is part of it
        const stack: (string | null)[] = [];
        let n = 0;
        for (const m of xml.matchAll(/<p:grpSp>|<\/p:grpSp>|<p:cNvPr id="\d+" name="([^"]*)"/g)) {
          if (m[0] === "<p:grpSp>") { stack.push(null); continue; }
          if (m[0] === "</p:grpSp>") { stack.pop(); continue; }
          const icon = /^Icon \d+$/.test(m[1]), inIcon = stack.some(x => x === "Icon");
          if (stack.length && stack[stack.length - 1] === null) stack[stack.length - 1] = icon ? "Icon" : "other";
          if (icon && !inIcon) n++;
        }
        return n;
      };
      expect(top(s2), design).toBe(7);
      expect(top(strFromU8(z["ppt/slides/slide1.xml"])), design).toBe(1);
      expect(s2).not.toContain("<p:pic>");
      expect(s2).not.toContain("<p:cxnSp>");
      if (out) {
        fs.writeFileSync(path.join(out, `icons-${design}.pptx`), bytes);
        fs.writeFileSync(path.join(out, `icons-${design}.expect.json`), JSON.stringify({ [path.join(out, `icons-${design}.pptx`)]: expectation }));
      }
    }
  }, 120_000);

  it("an unknown icon in the PowerPoint export stays the built-in shape (the “info” outline), not named Icon (review, tests)", async () => {
    const { lists } = await host();
    const L = await lists("excel") as unknown as { dl: { nodes: Node[] }; sem: SlideSem }[];
    const x1 = L[1].sem.items.x1, b1 = L[1].sem.items.b1;
    expect(x1).toMatchObject({ kind: "shape", shape: "icon" });
    expect(x1).not.toHaveProperty("icon");
    expect(b1).not.toHaveProperty("icon");
    expect(L[1].sem.items.a1).toMatchObject({ icon: "tabler" });
    expect(L[1].sem.items.f1).toMatchObject({ icon: "tabler-filled" });
    // in the file: the unknown name's shape is the built-in "info" (one even-odd path, filled, no round line) named otherwise
    const z = unzipSync(writePptx({ slides: L.map(l => ({ nodes: l.dl.nodes, sem: l.sem })), image: () => undefined, face: css => pptxFamily(css) }));
    const s2 = strFromU8(z["ppt/slides/slide2.xml"]);
    const names = [...s2.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map(m => m[1].replace(/ \d+$/, ""));
    expect(names.filter(n => n === "Icon").length).toBeGreaterThanOrEqual(7);
    // three built-in-drawn icons (target, arrow-up, info) are shapes of another name
    const notIcon = [...s2.matchAll(/<p:sp>((?:(?!<\/p:sp>).)*)<\/p:sp>/gs)].map(m => m[1]).filter(x => !/name="Icon \d+"/.test(x) && /<a:custGeom>/.test(x) && !/<p:txBody>/.test(x) && !/cap="rnd"/.test(x));
    expect(notIcon.length).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("the page's script runs iconsOf's own code over the page's slideLists; withIcons adds slides with icons only", async () => {
    const lists: Parameters<typeof iconsOf>[0] = [{ dl: { nodes: [] }, sem: { items: { a: { kind: "shape", icon: "tabler" }, b: { kind: "shape" }, c: { kind: "chart" } } } }, { dl: { nodes: [] } },
      { dl: { nodes: [] }, sem: { items: { d: { kind: "shape", icon: "tabler-filled" }, e: { kind: "shape", icon: "tabler" } } } }];
    expect(iconsOf(lists)).toEqual([{ slide: 1, icons: 1 }, { slide: 3, icons: 2 }]);
    expect(withIcons([{ slide: 1, tables: 1, charts: 1 }, { slide: 2, tables: 2, charts: 0 }], iconsOf(lists)))
      .toEqual([{ slide: 1, tables: 1, charts: 1, icons: 1 }, { slide: 2, tables: 2, charts: 0 }, { slide: 3, tables: 0, charts: 0, icons: 2 }]);
    let asked: unknown = null;
    const g = globalThis as unknown as { window?: unknown };
    g.window = { __sbTest: { slideLists: async (a: unknown) => { asked = a; return lists; } } };
    try { expect(await (0, eval)(pageIcons("bain"))).toEqual([{ slide: 1, icons: 1 }, { slide: 3, icons: 2 }]); }
    finally { delete g.window; }
    expect(asked).toEqual({ design: "bain", version: "", forExport: true, thumb: false, pptx: true });
  });
});
