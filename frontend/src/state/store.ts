/* Application state + a tiny subscription mechanism for the Preact chrome.
   The slide stage and thumbnails are imperative (performance); they register controllers below. */
import { useEffect, useState } from "preact/hooks";
import type { Workbook } from "../xlsx/types";
import type { ConfigDoc, Prefs, RuntimeSlide } from "../model/types";
import type { Health, Other } from "../sync/api";
import type { DocSync } from "../sync/docsync";
import type { Op } from "../model/types";

export interface Sel { t: number; anchor: { r: number; c: number }; ar: number; ac: number; r1: number; r2: number; c1: number; c2: number }
export interface OpenFile { name: string; src: "folder" | "upload" | "local"; id: string; mtime: number; size: number }
export interface UndoEntry { file: string; label: string; undo: Op[]; redo: Op[]; coalesce?: string; at?: number }
export interface ToastMsg { id: number; html: string; err?: boolean; actions?: { label: string; fn: () => void }[] }

export const S = {
  health: null as Health | null,
  user: "", host: "",
  client: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  prefs: {} as Prefs,
  config: { schema: 3, rev: 0, defaults: { style: {} } } as ConfigDoc,
  file: null as OpenFile | null,
  wb: null as Workbook | null,
  sync: null as DocSync | null,
  slides: [] as RuntimeSlide[],
  cur: 0,
  sel: null as Sel | null,
  zoom: "fit" as "fit" | number,
  busy: null as { text: string; frac: number | null } | null,
  exporting: false,
  changedOnDisk: false,
  others: [] as Other[],
  remote: null as { by: string; at: number } | null,
  logoMissing: false,
  undo: [] as UndoEntry[],
  redo: [] as UndoEntry[],
  toast: null as ToastMsg | null,
  opening: "",
};
export type AppState = typeof S;

const subs = new Set<() => void>();
let queued = false;
/** re-render the Preact chrome (batched) */
export function emit() {
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; subs.forEach(f => f()); });
}
export function useApp(): AppState {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return S;
}

/* imperative controllers (registered by the editor components) */
export const STAGE = { render() { /* full rebuild */ }, refresh() { /* changed tables only */ }, paintSel() { /* selection */ }, fit() { /* zoom */ } };
export const THUMBS = { render() { /* all */ }, refresh(_i?: number) { /* one (+ index slides) */ } };

let toastId = 0;
export function toast(html: string, actions: ToastMsg["actions"] = [], err = false) {
  const id = ++toastId; S.toast = { id, html, actions, err }; emit();
  setTimeout(() => { if (S.toast && S.toast.id === id) { S.toast = null; emit(); } }, err ? 9000 : 6000);
}
export function showBusy(text: string, frac: number | null) { S.busy = { text, frac }; emit(); }
export function hideBusy() { if (S.busy) { S.busy = null; emit(); } }
