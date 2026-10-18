/* Application state: ONE Zustand store in slices (docs/next/PLAN.md Part B §2, ADR-012).
     doc        the open workbook's shared document: a read-only mirror of its view and save state (the core
                worker owns the document: state/app.ts mirrors its snapshots), the shared config, the font library
     deck       the open workbook (a read-only mirror of the worker's) and its slides, the current slide and
                version, what undo/redo would do
     selection  cells, text box, slide text, format painter
     ui         zoom, busy, toast, dialogs, banners, helper health, presence, exporting
     prefs      who I am and my personal preferences
   Components read what they render through selectors (`useStore(s => s.selection.sel)`) and re-render only
   when that changes. Everything else reads `get()` and writes with `patch()`: the actions are module
   functions (state/app.ts, state/dialogs.ts, state/fonts.ts, editor/*) - the store holds no copies of them.
   The stage (stage/) and the thumbnails register controllers below: the document changes (state/app.ts) tell them
   to draw again. */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { MirrorWorkbook } from "@slide-builder/core/xlsx/mirror";
import type { ConfigDoc, Op, Prefs, RuntimeSlide, SlideTextKey, WorkbookDoc } from "@slide-builder/core/model/types";
import type { LibraryFont } from "@slide-builder/core/model/fonts";
import type { Health, Other } from "../sync/api";
import type { SaveState } from "@slide-builder/core/sync/docsync";
import type { DeckHealth, KeptCell } from "@slide-builder/core/rpc/messages";
import type { HistorySummary } from "@slide-builder/core/sync/history";
import type { Fmt } from "../editor/painter";
import type { DialogReq, WizardReq } from "./dialogs";
import type { Design } from "@slide-builder/core/model/types";

export interface Sel { t: number; anchor: { r: number; c: number }; ar: number; ac: number; r1: number; r2: number; c1: number; c2: number }
export interface OpenFile { name: string; src: "folder" | "upload" | "local"; id: string; mtime: number; size: number }
export interface ToastMsg { id: number; html: string; err?: boolean; actions?: { label: string; fn: () => void }[] }
export interface Painter { pattern: (Fmt | null)[][]; sticky: boolean }
export interface Dialogs {
  dialog: DialogReq | null; wizard: WizardReq | null; tables: boolean;
  /** text styles & fonts dialog: which tab is open */ textStyles: "colors" | "styles" | "fonts" | "layout" | null;
  /** automated comment dialog for table `table` of the current slide */ comment: { table: number } | null;
  /** Export ▾ › Run for each value… (M8, B15) */ scenario: boolean;
}
/** the "Run for each value…" dialog's fields (M8, B15): UI state of this page, never the document; kept while the page
    is open so the dialog opens again as it was left */
export interface ScenarioForm {
  /** the input cell as typed (name box syntax) */ input: string; /** the values, one per line */ values: string;
  /** "Treat as text" (07 §8 Q7) */ asText: boolean; designs: Design[]; /** version ids, "" = the full deck */ versions: string[];
  /** the value the Preview button shows */ value: string;
  /** how many cells taken From a range… had line breaks (shown as spaces: not the cell's own text) */ broken: number;
  /** "run anyway, mark these cells" (the gate, RC-06) */ runAnyway: boolean;
}
/** a scenario on the stage (S8.1, 07 §2.4): the value shown and its input cell; nothing of it is saved */
export interface ScenarioPreview { value: string; input: string; changed: number; /** TEXT cells it could not format */ textUnknown?: number;
  /** no formula moved, the value not being the cell's own */ still?: boolean }
/** a run for each value (S8.3): its progress, then its report – UI state of this page */
export interface RunState {
  id: string; total: number; done: number; /** the values as the input cell shows them */ shown: string[];
  results: { value: string; status: "ok" | "failed"; files: string[]; error?: string; warning?: string }[];
  status: "running" | "cancelling" | "end" | "cancelled"; error?: string;
  /** cells drawn with the red corner (run anyway) */ marked: import("@slide-builder/core/rpc/messages").GateCell[];
  /** slide cells kept at Excel's value in every file (locale-dependent TEXT, a linked workbook or hidden sheet not read) */ kept: KeptCell[];
  t0: number; seconds?: number;
}

export interface AppState {
  doc: {
    /** a workbook's document is open (the core worker has it) */
    open: boolean;
    /** mirror of the worker's view, read-only: it changes through ops (state/app.ts change()) */
    view: WorkbookDoc | null;
    save: SaveState | null; error: string;
    /** the open deck on the share (the side panel's deck-health line) */
    health: DeckHealth | null;
    config: ConfigDoc;
    fonts: LibraryFont[];
  };
  deck: {
    file: OpenFile | null; /** the read-only mirror of the workbook the core worker owns */ wb: MirrorWorkbook | null; slides: RuntimeSlide[]; cur: number;
    /** id of the deck version shown ("" = full deck) */ version: string;
    /** what Undo/Redo would do (the history lives in the core worker) */ history: HistorySummary;
    /** the last change by somebody else */ remote: { by: string; at: number } | null;
    /** workbook being opened (top bar) */ opening: string;
  };
  selection: {
    sel: Sel | null;
    /** selected text box ("<tableId>:<side>") */ noteSel: string | null;
    /** selected slide item (4.3: a chart; `slice`: one of its slices) */ itemSel: { id: string; slice: number | null } | null;
    /** selected slide text: title, subtitle, cover note or date */ textSel: SlideTextKey | null;
    /** format painter: copied formats (rows × cols), sticky = keep painting */ painter: Painter | null;
  };
  ui: {
    zoom: "fit" | number; busy: { text: string; frac: number | null } | null; exporting: boolean;
    toast: ToastMsg | null; dialogs: Dialogs;
    /** Design… edits the current design only, or all designs */ lookScope: "design" | "all";
    /** a font being added (its name or "<n> files") */ fontBusy: string;
    changedOnDisk: boolean; logoMissing: boolean;
    /** Windows fonts whose file differs on other PCs (W13, fingerprint mode): the side panel names them */ fontBuilds: { family: string; hosts: string[] }[];
    health: Health | null; others: Other[];
    /** the formula engine's self-check of the open workbook (B24): not asked yet, running, or its result */
    calc: import("@slide-builder/core/rpc/messages").CalcCheck | "busy" | null;
    /** Run for each value: the dialog's fields, the scenario previewed on the stage */ scenario: ScenarioForm; preview: ScenarioPreview | null; run: RunState | null;
  };
  prefs: { user: string; host: string; client: string; prefs: Prefs };
}
type Slice = keyof AppState;

export const initialState = (): AppState => ({
  doc: { open: false, view: null, save: null, error: "", health: null, config: { schema: 3, rev: 0, defaults: { style: {} } } as ConfigDoc, fonts: [] },
  deck: { file: null, wb: null, slides: [], cur: 0, version: "", history: { undo: 0, redo: 0, undoLabel: "", redoLabel: "" }, remote: null, opening: "" },
  selection: { sel: null, noteSel: null, textSel: null, itemSel: null, painter: null },
  ui: {
    zoom: "fit", busy: null, exporting: false, toast: null, lookScope: "design", fontBusy: "", changedOnDisk: false, logoMissing: false, fontBuilds: [], health: null, others: [], calc: null,
    scenario: { input: "", values: "", asText: false, designs: [], versions: [""], value: "", broken: 0, runAnyway: false }, preview: null, run: null,
    dialogs: { dialog: null, wizard: null, tables: false, textStyles: null, comment: null, scenario: false },
  },
  prefs: { user: "", host: "", client: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), prefs: {} },
});

export const useStore = create<AppState>()(subscribeWithSelector(initialState));
/** the current state (outside components) */
export const get = useStore.getState;
/** changes fields of one slice, e.g. patch("deck", { cur: 2 }); subscribers are told at once */
export function patch<K extends Slice>(slice: K, p: Partial<AppState[K]>) {
  useStore.setState(s => ({ [slice]: { ...s[slice], ...p } }) as unknown as Partial<AppState>);
}
/** changes several slices in one update (one notification: nothing sees a half-changed state) */
export function patchAll(p: { [K in Slice]?: Partial<AppState[K]> }) {
  useStore.setState(s => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(p) as Slice[]) out[k] = { ...s[k], ...p[k] };
    return out as Partial<AppState>;
  });
}
export const setDialogs = (p: Partial<Dialogs>) => patch("ui", { dialogs: { ...get().ui.dialogs, ...p } });
/** the same JSON: a poll that brings nothing new keeps the old object, so nothing re-renders */
export const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/* imperative controllers (registered by the editor components) */
export const STAGE = { render(_fresh?: boolean) { /* the slide again (fresh: text measured again) */ }, refresh() { /* the slide after a change */ }, fit() { /* measure the space again */ },
  /** what the stage would ask for slide `slide` (a starting workbook draws it first) */ request(slide: number): import("@slide-builder/core/rpc/messages").StageReq { return { slide, known: [] }; },
  /** the worker drew the stage's slide unasked */ pushed(_s: import("@slide-builder/core/rpc/messages").StageSlide) { /* the stage takes it */ } };
export const THUMBS = { render() { /* all */ }, refresh(_i?: number) { /* one (+ index slides) */ } };

let toastId = 0;
export function toast(html: string, actions: ToastMsg["actions"] = [], err = false) {
  const id = ++toastId; patch("ui", { toast: { id, html, actions, err } });
  setTimeout(() => { if (get().ui.toast?.id === id) patch("ui", { toast: null }); }, err ? 9000 : 6000);
}
export function showBusy(text: string, frac: number | null) { patch("ui", { busy: { text, frac } }); }
export function hideBusy() { if (get().ui.busy) patch("ui", { busy: null }); }
