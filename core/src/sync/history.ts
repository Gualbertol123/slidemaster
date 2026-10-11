/* Undo/redo of my own changes (v3's semantics, moved from app/src/state/app.ts into the core worker, PLAN S2.4):
   every change keeps its inverse operations; undo applies them as new operations, so it never reverts another
   person's later change to other fields. Slider drags within 1.5 s with the same `coalesce` key are one step;
   at most 200 steps; entries remember their workbook (undo after opening another one drops them). */
import type { Op } from "../model/types";

export interface UndoEntry { file: string; label: string; undo: Op[]; redo: Op[]; coalesce?: string; at?: number }
/** what the page shows of the history (Undo/Redo buttons, the toast) */
export interface HistorySummary { undo: number; redo: number; undoLabel: string; redoLabel: string }

export const COALESCE_MS = 1500, MAX_STEPS = 200;

export class History {
  undo: UndoEntry[] = [];
  redo: UndoEntry[] = [];
  /** a change was applied (`inverse` from DocSync.apply); a new change clears redo */
  record(file: string, label: string, ops: Op[], inverse: Op[], coalesce: string | undefined, now: number) {
    const last = this.undo[this.undo.length - 1];
    if (coalesce && last && last.coalesce === coalesce && now - (last.at || 0) < COALESCE_MS) { last.redo = ops; last.at = now; }
    else this.undo = [...this.undo, { file, label, undo: inverse, redo: ops, coalesce, at: now }].slice(-MAX_STEPS);
    this.redo = [];
  }
  /** the step to undo (or redo), taken off its stack */
  take(redo: boolean): UndoEntry | undefined {
    const st = redo ? this.redo : this.undo;
    const a = st[st.length - 1]; if (!a) return undefined;
    if (redo) this.redo = st.slice(0, -1); else this.undo = st.slice(0, -1);
    return a;
  }
  /** after applying a taken step: it moves to the other stack if it changed something */
  done(a: UndoEntry, redo: boolean, changed: boolean) {
    if (!changed) return;
    if (redo) this.undo = [...this.undo, a]; else this.redo = [...this.redo, a];
  }
  summary(): HistorySummary {
    const u = this.undo[this.undo.length - 1], r = this.redo[this.redo.length - 1];
    return { undo: this.undo.length, redo: this.redo.length, undoLabel: u?.label || "", redoLabel: r?.label || "" };
  }
}
