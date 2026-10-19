/* Run for each value… (M8, B15, docs/next/07 §2.4): the dialog's actions. The scenario lives in the core worker only
   (ADR-014): the page asks it to show one value on the stage (scenarioPreview) and to clear it; nothing here writes the
   document, the deck or the workbook. The dialog's fields are UI state (store ui.scenario). */
import { get, hideBusy, patch, setDialogs, showBusy, toast, useStore } from "../state/store";
import { core, forgetWorkbookTexts, style } from "../state/app";
import { activeItem } from "./edit";
import { keyOf } from "@slide-builder/core/render/edits";
import { esc } from "@slide-builder/core/xlsx/util";
import { parseSheetId } from "@slide-builder/core/calc/refs";
import { inputCellText, parseInputCell, typedValue, type InputCell } from "@slide-builder/core/export/scenario";
import type { CellInfo } from "@slide-builder/core/xlsx/sheetview";
import type { GateCell, ScenarioEvent } from "@slide-builder/core/rpc/messages";
import type { Design } from "@slide-builder/core/model/types";
import type { CatalogFont } from "@slide-builder/core/text/resolve";
import { scenarioValues } from "@slide-builder/core/export/scenario";
import { todayLabel } from "@slide-builder/core/render/cover";
import { backend } from "../sync/api";
import { catalog } from "../state/fontfiles";
import { lastExport, scenarioPdf, scenarioPptx } from "./export";
import type { ScenarioForm } from "../state/store";

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
  const book = parseSheetId(c.sheet).book;
  if (!sheet) return { ok: false, why: book && !wb.meta.some(m => m.linked?.toLowerCase() === book.toLowerCase())
    ? `No sheet “${c.sheet}”: a linked workbook's sheets are known once the deck links it (✦ Wizard › 1 · + Add a linked workbook).`
    : `No sheet “${c.sheet}” in this workbook${wb.meta.some(m => m.linked) ? " or its linked workbooks" : ""}.` };
  // a large workbook reads only the slides' sheets at first: the input's sheet is read now (its cell's type decides how
  // a value goes in – an unread sheet would look empty and send numbers in as text)
  await core().call("getSheetMeta", { book: wb.book, names: [sheet], load: true }).catch(() => null);
  const now = await core().call("getCell", { book: wb.book, sheet, ref: c.ref }).catch(() => null);
  return { ok: true, cell: { sheet, ref: c.ref }, now: now && now.t !== "blank" ? now : null };
}

let previewSeq = 0, busyBy = 0;
/** one value on the stage (SC-07): the engine sets the input cell and every slide is drawn from the recomputed values;
    the banner names the value. Editing stays allowed (07 §2.4: edits are ordinary ops on the deck) */
export async function previewValue(input: string, value: string, asText: boolean): Promise<boolean> {
  // the number is taken first: a workbook opened, another preview or a clear meanwhile makes this one stale
  const seq = ++previewSeq;
  const r = await resolveInput(input);
  if (seq !== previewSeq) return false;
  if (!r.ok) { toast("⚠ " + esc(r.why), [], true); return false; }
  showBusy(`Previewing ${value}…`, null); busyBy = seq;
  try {
    const a = await core().call("scenarioPreview", { sheet: r.cell.sheet, ref: r.cell.ref, value: typedValue(value, r.now?.t ?? null, asText) });
    if (seq !== previewSeq) return false;                                    // a newer preview or a clear came meanwhile
    if (!a) { patch("ui", { preview: null }); toast(`⚠ ${esc(inputCellText(r.cell))} could not be set to “${esc(value)}”: the formula engine could not take it.`, [], true); return false; }
    patch("ui", { preview: { value, input: inputCellText(r.cell), changed: a.changed, ...(a.textUnknown ? { textUnknown: a.textUnknown } : {}), ...(a.still ? { still: true } : {}) } });
    return true;
  } catch (e) {
    console.error(e);
    if (seq === previewSeq) toast("⚠ Preview failed: " + esc((e as Error).message || e), [], true);
    return false;
  } finally { if (busyBy === seq) { busyBy = 0; hideBusy(); } }          // the busy box is this call's to hide
}
/** back to the workbook's own values */
export async function clearPreview() {
  ++previewSeq;
  patch("ui", { preview: null });
  forgetWorkbookTexts();
  try { await core().call("scenarioPreview", null); }
  catch (e) { console.error(e); toast("⚠ Clearing the preview failed: " + esc((e as Error).message || e), [], true); }
}
// another workbook (or the same one read again) has no scenario in the worker: the banner goes with it
useStore.subscribe(s => s.deck.wb, () => {
  ++previewSeq; busyBy = 0; if (get().ui.preview) patch("ui", { preview: null });
  // another workbook: its own gate (a "run anyway" ticked for the last one does not carry over)
  if (get().ui.scenario.runAnyway) patch("ui", { scenario: { ...get().ui.scenario, runAnyway: false } });
});

/* ---------------------------------------------------------------- the run (S8.3, 07 §2.4) */
/** the fonts the run's PDFs may embed: asked once when Run is pressed (from disk the browser asks while the click counts) */
let runCatalog: Promise<CatalogFont[]> | null = null;
/** starts a run with the dialog's fields: the gate's cells when it refused (nothing was made), else null (the run
    goes on in the core worker; its progress arrives as events) */
export async function startRun(f: ScenarioForm, t0 = performance.now()): Promise<{ blocked: GateCell[] } | null> {
  if (runGoing()) { toast("A run for each value is going on: wait for it, or cancel it.", [], true); return null; }
  runCatalog = catalog();
  runCatalog.catch(() => undefined);
  const values = scenarioValues(f.values), r = await resolveInput(f.input);
  if (!r.ok) { toast("⚠ " + esc(r.why), [], true); return null; }
  if (get().ui.preview) await clearPreview();                         // the run takes the formula engine
  // the names must fit the export folder: its length from the helper (07 §2.5)
  let folder: number | undefined;
  if (backend.served) {
    const h = get().ui.health?.export ? get().ui.health : await backend.health();
    if (!h?.export) { toast("⚠ The helper did not say where the export folder is – try again in a moment.", [], true); return null; }
    folder = h.export.length;
  }
  const vers = get().doc.view?.preset?.versions || [];
  const versions = f.versions.filter(v => v === "" || vers.some(x => x.id === v));
  const a = await core().call("scenarioRun", { input: r.cell, values: values.map(v => typedValue(v, r.now?.t ?? null, f.asText)), designs: f.designs, versions, kinds: f.kinds?.length ? f.kinds : ["pdf"], runAnyway: f.runAnyway, folder, today: todayLabel() });
  if (a.id === null) return { blocked: a.blocked };
  // timed from the click on Run (the engine's first use, the gate and the folder included: the bench's figure)
  patch("ui", { run: { id: a.id, total: a.total, done: 0, shown: a.shown, results: [], status: "running", marked: a.marked, kept: a.kept, t0 } });
  // "run anyway" is for this run only: the next one stops at the gate again (RC-06)
  patch("ui", { scenario: { ...get().ui.scenario, runAnyway: false } });
  setDialogs({ scenario: false });
  return null;
}
/** a file of the run (the core worker asks for each value × design × version) */
export async function scenarioFile(a: { id: string; design: Design; version: string; name: string; title: string; today?: string; kind?: "pdf" | "pptx" }): Promise<{ file: string }> {
  const cat = runCatalog || catalog();
  return { file: (a.kind === "pptx" ? await scenarioPptx(a, cat) : await scenarioPdf(a, cat)).file };
}
/** a run is going on (its panel shows progress) */
export const runGoing = () => { const R = get().ui.run; return !!R && (R.status === "running" || R.status === "cancelling"); };
export function cancelRun() {
  const R = get().ui.run; if (!R || R.status !== "running") return;
  patch("ui", { run: { ...R, status: "cancelling" } });
  void core().call("scenarioCancel", { id: R.id }).catch(() => undefined);
}
export const closeRun = () => { const R = get().ui.run; if (R && R.status !== "running" && R.status !== "cancelling") patch("ui", { run: null }); };
/** the run's progress: a value made (or failed), then its end – the toast names what was saved */
export function onScenarioEvent(e: ScenarioEvent) {
  const R = get().ui.run; if (!R || R.id !== e.id) return;
  if (e.value !== null) {
    patch("ui", { run: { ...R, done: e.done, results: [...R.results, { value: e.value, status: e.status === "failed" ? "failed" : "ok", files: e.files, ...(e.error ? { error: e.error } : {}), ...(e.warning ? { warning: e.warning } : {}) }] } });
    return;
  }
  const seconds = +((performance.now() - R.t0) / 1000).toFixed(1), files = R.results.flatMap(x => x.files);
  patch("ui", { run: { ...R, done: e.done, status: e.status === "cancelled" ? "cancelled" : "end", seconds, ...(e.error ? { error: e.error } : {}) } });
  lastExport.files = files; lastExport.ms = performance.now() - R.t0;
  const failed = R.results.filter(x => x.status === "failed").length;
  toast(`Saved <b>${files.length}</b> file${files.length === 1 ? "" : "s"}${backend.served ? " in the export folder" : " (downloaded)"} · ${e.status === "cancelled" ? `cancelled after ${e.done} of ${e.total} values` : `${e.done} value${e.done === 1 ? "" : "s"}`} · ${seconds} s`
    + (failed ? ` · ⚠ ${failed} failed` : "") + (e.error ? ` · ⚠ ${esc(e.error)}` : ""),
    backend.served ? [{ label: "Show folder", fn: () => { void backend.open({ folder: true }); } }] : [], !!failed || !!e.error);
}
