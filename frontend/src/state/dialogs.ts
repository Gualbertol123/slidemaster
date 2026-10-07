/* In-app dialogs (v2 used window.confirm/alert, which block the page and are disabled in some
   managed browsers). Rendered by ui/Dialogs.tsx. */
import { emit } from "./store";
import type { Workbook } from "../xlsx/types";
import type { Preset } from "../model/types";

export interface DialogButton { id: string; label: string; primary?: boolean; danger?: boolean }
export interface DialogReq { title: string; sub?: string; html: string; buttons: DialogButton[]; width?: number; resolve: (v: string | null) => void }
export interface WizardReq { wb: Workbook; name: string; preset: Preset; resolve: (p: Preset | null) => void }

export const DLG = { dialog: null as DialogReq | null, wizard: null as WizardReq | null, installer: false, tables: false,
  /** text styles & fonts dialog: which tab is open */ textStyles: null as "styles" | "fonts" | null };

export function ask(title: string, html: string, buttons: DialogButton[], opts: { sub?: string; width?: number } = {}): Promise<string | null> {
  return new Promise(resolve => {
    DLG.dialog = { title, html, buttons, ...opts, resolve: v => { DLG.dialog = null; emit(); resolve(v); } };
    emit();
  });
}
export const confirmBox = async (title: string, html: string, ok = "OK", danger = false) =>
  (await ask(title, html, [{ id: "cancel", label: "Cancel" }, { id: "ok", label: ok, primary: !danger, danger }])) === "ok";
export const alertBox = async (title: string, html: string) => { await ask(title, html, [{ id: "ok", label: "OK", primary: true }]); };

export function runWizard(wb: Workbook, name: string, preset: Preset): Promise<Preset | null> {
  return new Promise(resolve => {
    DLG.wizard = { wb, name, preset, resolve: p => { DLG.wizard = null; emit(); resolve(p); } };
    emit();
  });
}
export function openInstaller() { DLG.installer = true; emit(); }
export function closeInstaller() { DLG.installer = false; emit(); }
