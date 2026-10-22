/* B48 changed Excel and Excel Refined only (the Intesa Sanpaolo template): Liquid Glass, Consulting Navy and Consulting
   Red must draw exactly as before. Every corpus deck (and the chart corpus) is drawn in those three designs – each
   slide's layout and display list (with what the PowerPoint export asks: `sem`), the theme's variables and chart look,
   the whole .pptx – and hashed; the hashes are those of v4/M14-M15-prep (cad8ec7), the base B48 started from
   (fixtures/dlhash-b48-base.json). A deliberate change of one of these designs re-records them:
     DLHASH_WRITE=1 npx vitest run tests/dlhash.test.ts      (in core/; say why in the commit)
   M14 and M15 change these designs' charts, lines and icons: their merge re-records the file (PROGRESS, B48). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { wrapLines } from "../src/text/lines";
import { writePptx } from "../src/pptx/writer";
import { chartLook } from "../src/render/chart-dl";
import { themeVars } from "../src/render/slide";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const FIXTURE = path.join(here, "fixtures/dlhash-b48-base.json");
const DESIGNS: Design[] = ["glass", "mckinsey", "bain"];
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const h = (o: unknown) => crypto.createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex").slice(0, 16);

async function hashes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const files = [...fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort().map(f => path.join(DECKS, f)), path.join(here, "../../tests/corpus/charts/charts.json")];
  for (const file of files) {
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as { workbook: string; ops: Op[] };
    if (!fs.existsSync(path.join(BOOKS, d.workbook))) continue;
    let wb; try { wb = await readWorkbook(ab(path.join(BOOKS, d.workbook))); } catch { continue; }        // (the corpus's unreadable book)
    const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
    for (const design of DESIGNS) {
      const style = resolveStyle({}, view.style, { design });
      const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
      const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
      const key = `${path.basename(file)}|${design}`;
      const lists = slides.map((R, i) => {
        const boxes = computeLayout(R, ctx).boxes;
        const dl = slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: { id: "logo", src: "logo.png", w: 400, h: 100 } }, M, "1 October 2026", { sem: true });
        out[`${key}|${i}`] = h([boxes, dl.nodes, dl.items]);
        return { nodes: dl.nodes, sem: { type: (R.type === "cover" || R.type === "index" ? R.type : "content") as "content", items: Object.fromEntries(Object.entries(dl.items).flatMap(([k, v]) => v.pptx ? [[k, v.pptx]] : [])), palette: chartLook(ctx, "").colors.slice(0, 6) } };
      });
      out[`${key}|vars`] = h([themeVars(ctx), chartLook(ctx, "x")]);
      try { out[`${key}|pptx`] = h(Buffer.from(writePptx({ slides: lists, image: () => PNG, face: c => c.split(",")[0].replace(/['"]/g, ""), title: "T", design }))); }
      catch (e) { out[`${key}|pptx`] = "ERR " + String(e).slice(0, 60); }
    }
  }
  return out;
}

describe("Liquid Glass and the consulting designs are untouched by the template of the Excel designs (B48 review, 1)", () => {
  it("every corpus slide's layout and display list, the theme's variables, the .pptx: the hashes of B48's base", async () => {
    const now = await hashes();
    if (process.env.DLHASH_WRITE) fs.writeFileSync(FIXTURE, JSON.stringify(now, null, 1) + "\n");
    const base = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(Object.keys(now).length).toBeGreaterThan(100);
    expect(Object.keys(now).filter(k => now[k] !== base[k])).toEqual([]);
    expect(Object.keys(base).filter(k => !(k in now))).toEqual([]);
  }, 600_000);
});
