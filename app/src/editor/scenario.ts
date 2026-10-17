/* Run for each value… (M8, B15, docs/next/07 §2.4): the dialog's actions. The scenario lives in the core worker only
   (ADR-014): the page asks it to show one value on the stage (scenarioPreview) and to clear it; nothing here writes the
   document, the deck or the workbook. The dialog's fields are UI state (store ui.scenario). */
import { get, hideBusy, patch, setDialogs, showBusy, toast, useStore } from "../state/store";
import { core, style } from "../state/app";
import { activeItem } from "./edit";
import { keyOf } from "@slide-builder/core/render/edits";
import { esc } from "@slide-builder/core/xlsx/util";
import { inputCellText, parseInputCell, typedValue, type InputCell } from "@slide-builder/core/export/scenario";
import type { CellInfo } from "@slide-builder/core/xlsx/sheetview";

export function openScenario() {
  if (!get().deck.slides.length || !get().deck.wb) return;
  const f = get().ui.scenario;
  // the first time: the current design, the full deck, and the cell selected on the stage as the input
  if (!f.designs.length) patch("ui", { scenario: { ...f, designs: [style().design], input: f.input || pickedCell() || "" } });
  setDialogs({ scenario: true });
}
export const closeScenario = () => setDialogs({ scenario: false });

/** the cell selected on the stage, as the name box shows it ("Control!B2"; a linked workbook's "[Peers.xlsx]Peer!C7") */
export function pickedCell(): string | null {
  const it = activeItem();
  return it?.L ? inputCellText({ sheet: it.L.sheet.name, ref: keyOf(it) }) : null;
}

/** the input cell checked against the open workbook: its sheet as the workbook names it (typed in any case), and what
    the cell holds today (null: empty) – its type decides how a value goes in (07 §8 Q7) */
export type Resolved = { ok: true; cell: InputCell; now: CellInfo | null } | { ok: false; why: string };
export async function resolveInput(text: string): Promise<Resolved> {
  const wb = get().deck.wb;
  if (!text.trim()) return { ok: false, why: "Type the input cell, e.g. Control!B2, or select it on the slide and press Pick a cell." };
  const c = parseInputCell(text);
  if (!c) return { ok: false, why: "Not one cell: write it as the name box does, e.g. Control!B2 or [Peers.xlsx]Peer!C7." };
  if (!wb) return { ok: false, why: "No workbook is open." };
  const names = wb.meta.map(m => m.name);
  const sheet = names.find(n => n === c.sheet) ?? names.find(n => n.toLowerCase() === c.sheet.toLowerCase());
  if (!sheet) return { ok: false, why: `No sheet “${c.sheet}” in this workbook${wb.meta.some(m => m.linked) ? " or its linked workbooks" : ""}.` };
  const now = await core().call("getCell", { book: wb.book, sheet, ref: c.ref }).catch(() => null);
  return { ok: true, cell: { sheet, ref: c.ref }, now: now && now.t !== "blank" ? now : null };
}

let previewSeq = 0;
/** one value on the stage (SC-07): the engine sets the input cell and every slide is drawn from the recomputed values;
    the banner names the value. Editing stays allowed (07 §2.4: edits are ordinary ops on the deck) */
export async function previewValue(input: string, value: string, asText: boolean): Promise<boolean> {
  const r = await resolveInput(input);
  if (!r.ok) { toast("⚠ " + esc(r.why), [], true); return false; }
  const seq = ++previewSeq;
  showBusy(`Previewing ${value}…`, null);
  try {
    const a = await core().call("scenarioPreview", { sheet: r.cell.sheet, ref: r.cell.ref, value: typedValue(value, r.now?.t ?? null, asText) });
    if (seq !== previewSeq) return false;                                    // a newer preview or a clear came meanwhile
    if (!a) { patch("ui", { preview: null }); toast(`⚠ ${esc(inputCellText(r.cell))} could not be set to “${esc(value)}”: the formula engine could not take it.`, [], true); return false; }
    patch("ui", { preview: { value, input: inputCellText(r.cell), changed: a.changed } });
    return true;
  } catch (e) {
    console.error(e);
    toast("⚠ Preview failed: " + esc((e as Error).message || e), [], true);
    return false;
  } finally { hideBusy(); }
}
/** back to the workbook's own values */
export async function clearPreview() {
  ++previewSeq;
  patch("ui", { preview: null });
  try { await core().call("scenarioPreview", null); }
  catch (e) { console.error(e); toast("⚠ Clearing the preview failed: " + esc((e as Error).message || e), [], true); }
}
// another workbook (or the same one read again) has no scenario in the worker: the banner goes with it
useStore.subscribe(s => s.deck.wb, () => { if (get().ui.preview) { ++previewSeq; patch("ui", { preview: null }); } });
