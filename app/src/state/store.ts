/* Application state: ONE Zustand store in slices (docs/next/PLAN.md Part B §2, ADR-012).
     doc        the open workbook's shared document: its DocSync, a read-only mirror of its view and save
                state (set by state/app.ts after every change), the shared config and the font library
     deck       the open workbook and its slides, the current slide and version, undo/redo
     selection  cells, text box, slide text, format painter
     ui         zoom, busy, toast, dialogs, banners, helper health, presence, exporting
     prefs      who I am and my personal preferences
   Components read what they render through selectors (`useStore(s => s.selection.sel)`) and re-render only
   when that changes. Everything else reads `get()` and writes with `patch()`: the actions are module
   functions (state/app.ts, state/dialogs.ts, state/fonts.ts, editor/*) - the store holds no copies of them.
   The slide stage and the thumbnails are imperative (performance); they register controllers below and
   subscribe to the slices they draw (editor/stage.ts, editor/thumbs.ts). */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Workbook } from "@slide-builder/core/xlsx/types";
import type { ConfigDoc, Op, Prefs, RuntimeSlide, SlideTextKey, WorkbookDoc } from "@slide-builder/core/model/types";
import type { LibraryFont } from "@slide-builder/core/model/fonts";
import type { Health, Other } from "../sync/api";
import type { DocSync, SaveState } from "../sync/docsync";
import type { Fmt } from "../editor/painter";
import type { DialogReq, WizardReq } from "./dialogs";

export interface Sel { t: number; anchor: { r: number; c: number }; ar: number; ac: number; r1: number; r2: number; c1: number; c2: number }
export interface OpenFile { name: string; src: "folder" | "upload" | "local"; id: string; mtime: number; size: number }
export interface UndoEntry { file: string; label: string; undo: Op[]; redo: Op[]; coalesce?: string; at?: number }
export interface ToastMsg { id: number; html: string; err?: boolean; actions?: { label: string; fn: () => void }[] }
export interface Painter { pattern: (Fmt | null)[][]; sticky: boolean }
export interface Dialogs {
  dialog: DialogReq | null; wizard: WizardReq | null; installer: boolean; tables: boolean;
  /** text styles & fonts dialog: which tab is open */ textStyles: "colors" | "styles" | "fonts" | null;
  /** automated comment dialog for table `table` of the current slide */ comment: { table: number } | null;
}

export interface AppState {
  doc: {
    sync: DocSync | null;
    /** mirror of sync.view, read-only: it changes through ops (state/app.ts change()) */
    view: WorkbookDoc | null;
    save: SaveState | null; error: string;
    config: ConfigDoc;
    fonts: LibraryFont[];
  };
  deck: {
    file: OpenFile | null; wb: Workbook | null; slides: RuntimeSlide[]; cur: number;
    /** id of the deck version shown ("" = full deck) */ version: string;
    undo: UndoEntry[]; redo: UndoEntry[];
    /** the last change by somebody else */ remote: { by: string; at: number } | null;
    /** workbook being opened (top bar) */ opening: string;
  };
  selection: {
    sel: Sel | null;
    /** selected text box ("<tableId>:<side>") */ noteSel: string | null;
    /** selected slide text: title, subtitle, cover note or date */ textSel: SlideTextKey | null;
    /** format painter: copied formats (rows × cols), sticky = keep painting */ painter: Painter | null;
  };
  ui: {
    zoom: "fit" | number; busy: { text: string; frac: number | null } | null; exporting: boolean;
    toast: ToastMsg | null; dialogs: Dialogs;
    /** Design… edits the current design only, or all designs */ lookScope: "design" | "all";
    /** a font being added (its name or "<n> files") */ fontBusy: string;
    changedOnDisk: boolean; logoMissing: boolean;
    health: Health | null; others: Other[];
  };
  prefs: { user: string; host: string; client: string; prefs: Prefs };
}
type Slice = keyof AppState;

export const initialState = (): AppState => ({
  doc: { sync: null, view: null, save: null, error: "", config: { schema: 3, rev: 0, defaults: { style: {} } } as ConfigDoc, fonts: [] },
  deck: { file: null, wb: null, slides: [], cur: 0, version: "", undo: [], redo: [], remote: null, opening: "" },
  selection: { sel: null, noteSel: null, textSel: null, painter: null },
  ui: {
    zoom: "fit", busy: null, exporting: false, toast: null, lookScope: "design", fontBusy: "", changedOnDisk: false, logoMissing: false, health: null, others: [],
    dialogs: { dialog: null, wizard: null, installer: false, tables: false, textStyles: null, comment: null },
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
export const STAGE = { render() { /* full rebuild */ }, refresh() { /* changed tables only */ }, paintSel() { /* selection */ }, fit() { /* zoom */ } };
export const THUMBS = { render() { /* all */ }, refresh(_i?: number) { /* one (+ index slides) */ } };

let toastId = 0;
export function toast(html: string, actions: ToastMsg["actions"] = [], err = false) {
  const id = ++toastId; patch("ui", { toast: { id, html, actions, err } });
  setTimeout(() => { if (get().ui.toast?.id === id) patch("ui", { toast: null }); }, err ? 9000 : 6000);
}
export function showBusy(text: string, frac: number | null) { patch("ui", { busy: { text, frac } }); }
export function hideBusy() { if (get().ui.busy) patch("ui", { busy: null }); }
