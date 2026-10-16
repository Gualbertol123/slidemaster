/* A corpus deck (tests/corpus/decks) opened in a design: its runtime slides and a drawing context per version (the
   design resolved with the deck, as the app does). Shared by the exhibit and consulting-table tests. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import type { RenderCtx } from "../src/render/context";
import type { DeckVersion, Design, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
export async function deckOf(file: string, design: Design = "mckinsey", extra: Op[] = []) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), [...d.ops, ...extra]).doc;
  const style = resolveStyle({}, view.style, { design });                 // the design resolved with the deck (its own palette)
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx = (version: DeckVersion | null = null): RenderCtx => ({ style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version });
  return { ctx, slides, versions: view.preset?.versions || [] };
}
