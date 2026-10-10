/* One workbook document, shared with everybody who has the same workbook open.

   view = confirmed server document + operations in flight + operations not sent yet.
   Local changes show immediately; they are sent in small batches and the helper merges them into
   the latest version (field by field), so nobody's work is overwritten. Other people's changes
   arrive by polling (`?since=<rev>`). If saving fails the operations stay queued and are retried –
   a failed read or write never resets the document. */
import { FORMATS, type Op, type WorkbookDoc } from "@slide-builder/core/model/types";
import { applyOps, inverseOf, applyOp } from "@slide-builder/core/model/ops";
import type { Backend } from "./api";

export type SaveState = "saved" | "pending" | "saving" | "error" | "local" | "outdated";
const OUTDATED = "Slide Builder was updated – reload the page (F5) to continue.";
/** `stateChanged`: the save state (`state`, `error`) changed, e.g. "saving" → "saved"; the status bar shows it at once */
export interface Change { local: boolean; by?: string; presetChanged: boolean; styleChanged: boolean; editsChanged: boolean; stateChanged: boolean }

export class DocSync {
  server: WorkbookDoc;
  view: WorkbookDoc;
  private pending: Op[] = [];
  private inflight: Op[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  state: SaveState;
  error = "";
  private listeners = new Set<(c: Change) => void>();

  constructor(private api: Backend, readonly name: string, doc: WorkbookDoc, private client: string, private me: string) {
    this.server = doc; this.view = doc;
    this.state = api.served ? "saved" : "local";
  }
  on(fn: (c: Change) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(prev: WorkbookDoc, local: boolean, by?: string, prevState?: [SaveState, string]) {
    const v = this.view;
    const c: Change = {
      local, by,
      presetChanged: JSON.stringify(prev.preset) !== JSON.stringify(v.preset),
      styleChanged: JSON.stringify(prev.style) !== JSON.stringify(v.style),
      editsChanged: JSON.stringify(prev.edits) !== JSON.stringify(v.edits),
      stateChanged: !!prevState && (prevState[0] !== this.state || prevState[1] !== this.error),
    };
    if (c.presetChanged || c.styleChanged || c.editsChanged || c.stateChanged || local) this.listeners.forEach(f => f(c));
  }
  private recompute() { this.view = applyOps(this.server, [...(this.inflight || []), ...this.pending]).doc; this.view.rev = this.server.rev; }
  /** people other than me who made the revisions after `since` */
  private authors(doc: WorkbookDoc, since: number): string | undefined {
    const names = new Set<string>();
    if (doc.log && doc.log.length) { for (const x of doc.log) if (x.rev > since && x.by && x.by !== this.me) names.add(x.by); }
    else if (doc.rev > since && doc.updatedBy && doc.updatedBy !== this.me) names.add(doc.updatedBy);
    return names.size ? [...names].join(", ") : undefined;
  }
  get busy() { return !!this.inflight || this.pending.length > 0; }

  /** apply operations locally and queue them; returns their inverse (for undo), or null if nothing changed */
  apply(ops: Op[]): Op[] | null {
    const prev = this.view;
    const work = JSON.parse(JSON.stringify(prev)) as WorkbookDoc;
    const inverse: Op[] = [], applied: Op[] = [];
    for (const op of ops) {
      const inv = inverseOf(work, op);
      if (applyOp(work, op)) { applied.push(op); if (inv) inverse.unshift(inv); }
    }
    if (!applied.length) return null;
    this.pending.push(...applied);
    this.view = work;
    this.state = this.api.served ? "pending" : "local";
    this.emit(prev, true);
    this.schedule(this.api.served ? 300 : 0);
    return inverse;
  }
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms); }

  async flush(): Promise<void> {
    if (this.inflight || !this.pending.length || this.state === "outdated") return;
    this.inflight = this.pending; this.pending = [];
    // "Saving…" is a save state too (B6): the status bar shows it at once, not at its next re-render
    if (this.api.served) { const was: [SaveState, string] = [this.state, this.error]; this.state = "saving"; this.emit(this.view, false, undefined, was); }
    const prev = this.view, before: [SaveState, string] = [this.state, this.error];
    try {
      const r = await this.api.postOps(this.name, this.inflight, this.client);
      const by = this.authors(r.doc, this.server.rev);
      this.server = r.doc; this.inflight = null; this.retry = 0; this.error = "";
      this.recompute();
      this.state = this.pending.length ? "pending" : (this.api.served ? "saved" : "local");
      this.emit(prev, false, by, before);
      if (this.pending.length) this.schedule(50);
    } catch (e) {
      this.pending = [...this.inflight!, ...this.pending]; this.inflight = null;
      // the helper speaks a newer data format than this page: retrying cannot help, reloading does
      if ((e as { status?: number }).status === 409) { this.state = "outdated"; this.error = (e as Error).message || OUTDATED; this.emit(prev, false, undefined, before); return; }
      this.state = "error"; this.error = (e as Error).message || String(e);
      this.retry = Math.min(this.retry + 1, 5);
      this.emit(prev, false, undefined, before);
      this.schedule(1000 * Math.pow(2, this.retry));        // 2 s … 32 s, the changes stay queued
    }
  }
  /** fetch changes made by others */
  async poll(): Promise<void> {
    if (this.inflight) return;
    let doc: WorkbookDoc | null;
    try { doc = await this.api.getDoc(this.name, this.server.rev); } catch { return; }
    if (!doc || this.inflight || doc.rev === this.server.rev) return;
    if (typeof doc.schema === "number" && doc.schema > FORMATS.workbook) { const before: [SaveState, string] = [this.state, this.error]; this.state = "outdated"; this.error = OUTDATED; this.emit(this.view, false, undefined, before); return; }
    const prev = this.view, by = this.authors(doc, this.server.rev);
    this.server = doc; this.recompute();
    this.emit(prev, false, by);
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
