/* In-app dialogs (v2 used window.confirm/alert, which block the page and are disabled in some
   managed browsers). Rendered by ui/Dialogs.tsx; which dialog is open lives in the store (ui.dialogs). */
import { setDialogs } from "./store";
import type { MirrorWorkbook as Workbook } from "@slide-builder/core/xlsx/mirror";
import type { Preset } from "@slide-builder/core/model/types";

export interface DialogButton { id: string; label: string; primary?: boolean; danger?: boolean }
export interface DialogReq { title: string; sub?: string; html: string; buttons: DialogButton[]; width?: number; resolve: (v: string | null) => void }
export interface WizardReq { wb: Workbook; name: string; preset: Preset; resolve: (p: Preset | null) => void }


/* one dialog and one wizard at a time: a newer one answers the one it replaces with "cancelled" (null), so the
   code waiting for it goes on instead of waiting for ever */
let openDialog: ((v: string | null) => void) | null = null, openWizard: ((p: Preset | null) => void) | null = null;
export function ask(title: string, html: string, buttons: DialogButton[], opts: { sub?: string; width?: number } = {}): Promise<string | null> {
  openDialog?.(null);
  return new Promise(resolve => {
    const done = (v: string | null) => { if (openDialog !== done) return; openDialog = null; setDialogs({ dialog: null }); resolve(v); };
    openDialog = done;
    setDialogs({ dialog: { title, html, buttons, ...opts, resolve: done } });
  });
}
export const confirmBox = async (title: string, html: string, ok = "OK", danger = false) =>
  (await ask(title, html, [{ id: "cancel", label: "Cancel" }, { id: "ok", label: ok, primary: !danger, danger }])) === "ok";
export const alertBox = async (title: string, html: string) => { await ask(title, html, [{ id: "ok", label: "OK", primary: true }]); };

export function runWizard(wb: Workbook, name: string, preset: Preset): Promise<Preset | null> {
  openWizard?.(null);
  return new Promise(resolve => {
    const done = (p: Preset | null) => { if (openWizard !== done) return; openWizard = null; setDialogs({ wizard: null }); resolve(p); };
    openWizard = done;
    setDialogs({ wizard: { wb, name, preset, resolve: done } });
  });
}
export function openInstaller() { setDialogs({ installer: true }); }
export function closeInstaller() { setDialogs({ installer: false }); }
