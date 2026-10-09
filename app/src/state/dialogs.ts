/* In-app dialogs (v2 used window.confirm/alert, which block the page and are disabled in some
   managed browsers). Rendered by ui/Dialogs.tsx; which dialog is open lives in the store (ui.dialogs). */
import { setDialogs } from "./store";
import type { Workbook } from "../xlsx/types";
import type { Preset } from "../model/types";

export interface DialogButton { id: string; label: string; primary?: boolean; danger?: boolean }
export interface DialogReq { title: string; sub?: string; html: string; buttons: DialogButton[]; width?: number; resolve: (v: string | null) => void }
export interface WizardReq { wb: Workbook; name: string; preset: Preset; resolve: (p: Preset | null) => void }


export function ask(title: string, html: string, buttons: DialogButton[], opts: { sub?: string; width?: number } = {}): Promise<string | null> {
  return new Promise(resolve => {
    setDialogs({ dialog: { title, html, buttons, ...opts, resolve: v => { setDialogs({ dialog: null }); resolve(v); } } });
  });
}
export const confirmBox = async (title: string, html: string, ok = "OK", danger = false) =>
  (await ask(title, html, [{ id: "cancel", label: "Cancel" }, { id: "ok", label: ok, primary: !danger, danger }])) === "ok";
export const alertBox = async (title: string, html: string) => { await ask(title, html, [{ id: "ok", label: "OK", primary: true }]); };

export function runWizard(wb: Workbook, name: string, preset: Preset): Promise<Preset | null> {
  return new Promise(resolve => {
    setDialogs({ wizard: { wb, name, preset, resolve: p => { setDialogs({ wizard: null }); resolve(p); } } });
  });
}
export function openInstaller() { setDialogs({ installer: true }); }
export function closeInstaller() { setDialogs({ installer: false }); }
