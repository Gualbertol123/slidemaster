/* W13 (05 §2): two PCs with different fonts lay a deck out the same – when its fonts come from the shared library.
   Each "PC" is a font catalog (the library's faces and the PC's own Windows fonts, as the page's measureCatalog gives
   the core worker) and its files; the same table of a corpus deck is measured with each (text measured from font
   files, S4.4) and the display lists compared. In fingerprint mode (R7, the default) every PC lays a Windows font out
   with its own file: a PC with another build lays out differently – what the side panel's font notice names, and what
   copy mode (helper sysfonts.py, once the licence owner said yes) puts right by sharing the file. */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontMeasurer } from "../src/text/measure";
import { shaper } from "../src/text/shape";
import type { CatalogFont } from "../src/text/resolve";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, forgetMeasurements, measuredBuild } from "../src/render/excel-dl";
import { resetPlatform, setPlatform, type TextMeasurer } from "../src/platform";
import type { RenderCtx } from "../src/render/context";
import type { Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(here, "fixtures", "fonts"), DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const font = (f: string) => new Uint8Array(fs.readFileSync(path.join(FONTS, f)));
const REGULAR = font("Carlito-Regular.ttf"), BOLD = font("Carlito-Bold.ttf"), OTHER = font("SourceSans3-Regular.otf");

/** another build of a font: every advance width 4 % wider (an older Calibri, say) */
function otherBuild(data: Uint8Array): Uint8Array {
  const d = new Uint8Array(data), v = new DataView(d.buffer), n = v.getUint16(4);
  const table = (tag: string) => { for (let i = 0; i < n; i++) { const o = 12 + 16 * i; if (String.fromCharCode(...d.subarray(o, o + 4)) === tag) return v.getUint32(o + 8); } throw new Error(tag); };
  const metrics = v.getUint16(table("hhea") + 34), hmtx = table("hmtx");
  for (let i = 0; i < metrics; i++) v.setUint16(hmtx + 4 * i, Math.round(v.getUint16(hmtx + 4 * i) * 1.04));
  return d;
}
type PC = { catalog: CatalogFont[]; files: Record<string, Uint8Array> };
const lib = (file: string, weight: number): CatalogFont => ({ source: "library", file, family: "Carlito", weight, italic: false });
const sys = (file: string, family: string, weight = 400): CatalogFont => ({ source: "system", file, family, weight, italic: false });
/** the page's measurer is never asked: every text here has a file */
const PAGE: TextMeasurer = { maxDigitWidth: () => { throw new Error("measured by the page"); }, measureRuns: () => { throw new Error("measured by the page"); } };

/** weekly-options' first table in Excel Refined, every cell in Carlito (the deck's table text style), measured on `pc` */
async function layOut(pc: PC) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "weekly-options.json"), "utf8")) as { workbook: string; ops: Op[] };
  const b = fs.readFileSync(path.join(BOOKS, d.workbook)), wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = { ...resolveStyle({}, view.style), design: "clean" as const };
  style.text = { ...style.text, table: { font: "Carlito" } };
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", "clean");
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const L = slides.flatMap(R => R.tables)[0];
  forgetMeasurements();
  setPlatform({ text: new FontMeasurer(shaper(), { catalog: async () => pc.catalog, bytes: async f => pc.files[f.file] ?? null }, PAGE) });
  return JSON.stringify((await measuredBuild(m => excelToDisplayList(L, ctx, m))).nodes);
}
afterEach(() => { resetPlatform(); forgetMeasurements(); });

describe("W13: two PCs with different fonts", () => {
  it("lay a deck out identically when its font comes from the library (copy mode: the PC's own build does not count)", async () => {
    const shared = { "Carlito-400-1.ttf": REGULAR, "Carlito-700-2.ttf": BOLD };
    const a = await layOut({ catalog: [lib("Carlito-400-1.ttf", 400), lib("Carlito-700-2.ttf", 700), sys("carlito.ttf", "Carlito")], files: { ...shared, "carlito.ttf": REGULAR } });
    // PC B: another build of the font on Windows, and other fonts besides
    const b = await layOut({ catalog: [lib("Carlito-400-1.ttf", 400), lib("Carlito-700-2.ttf", 700), sys("carlito.ttf", "Carlito"), sys("source.otf", "Source Sans 3")],
      files: { ...shared, "carlito.ttf": otherBuild(REGULAR), "source.otf": OTHER } });
    // PC C: no copy of the font of its own at all
    const c = await layOut({ catalog: [lib("Carlito-400-1.ttf", 400), lib("Carlito-700-2.ttf", 700)], files: shared });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
  it("lay it out differently in fingerprint mode when a PC has another build (the side panel names that PC)", async () => {
    const a = await layOut({ catalog: [sys("carlito.ttf", "Carlito"), sys("carlitob.ttf", "Carlito", 700)], files: { "carlito.ttf": REGULAR, "carlitob.ttf": BOLD } });
    const same = await layOut({ catalog: [sys("carlito.ttf", "Carlito"), sys("carlitob.ttf", "Carlito", 700)], files: { "carlito.ttf": REGULAR, "carlitob.ttf": BOLD } });
    const other = await layOut({ catalog: [sys("carlito.ttf", "Carlito"), sys("carlitob.ttf", "Carlito", 700)], files: { "carlito.ttf": otherBuild(REGULAR), "carlitob.ttf": BOLD } });
    expect(same).toBe(a);                                                              // the same build: the same layout
    expect(other).not.toBe(a);
  });
});
