/* One deck, shared with everybody who has the same workbook open – storage v4 (docs/next/04 §2, ADR-006).

   On the share a deck is a snapshot plus one append-only journal per writer (this page session is one writer).
   Here:
     confirmed = fold(snapshot, the records past its frontier)    (model/fold.ts: Lamport order, one copy each)
     view      = confirmed + the record being appended + the operations not sent yet
   Local changes show at once; 300 ms after the last one they become ONE record, appended to this writer's journal
   (one append in flight; "✓ Saved" when the helper has flushed it to the share). Every 1.5 s the journals are read
   from where this page stopped (tail): other people's records are folded in and the local operations stay on top.
   A failed append keeps the record and sends it again, the same record (same writer and seq: the fold keeps one
   copy) – a failed read or write never resets the document. Now and then a page compacts the deck (folds the
   journals into a new snapshot: more than 2 000 records, a writer idle for over 24 h, or – when it is the only
   one there – the deck at rest); the helper takes it only if nobody compacted meanwhile (compare-and-set on gen). */
import type { Op, WorkbookDoc } from "../model/types";
import { applyOps, inverseOf, applyOp } from "../model/ops";
import { firstCopy, fold, nextSnapshot, recordId, validRecord, type DeckRecord, type DeckSnapshot, type Folded } from "../model/fold";

export interface TailJournal { offset: number; records: DeckRecord[]; /** each record's end offset */ ends?: number[] }
export interface TailResult { journals: Record<string, TailJournal>; gen: number | null; readonly?: string }
/** what the helper said when the deck was opened (POST /api/decks/open), and the first tail */
export interface DeckOpen { key: string; writer: string; snapshot: DeckSnapshot; tail?: TailResult }
/** what DocSync needs of the helper's API (the page's backend; in the core worker, a proxy to it) */
export interface DeckApi {
  served: boolean;
  snapshot(key: string): Promise<DeckSnapshot>;
  tail(key: string, since: Record<string, number>): Promise<TailResult>;
  append(key: string, writer: string, record: DeckRecord): Promise<{ journal: string; offset: number; at: number }>;
  compact(key: string, baseGen: number, snapshot: DeckSnapshot): Promise<{ gen: number }>;
  rotate(key: string, writer: string): Promise<{ deleted: string[] }>;
}

export type SaveState = "saved" | "pending" | "saving" | "error" | "local" | "outdated" | "readonly";
const OUTDATED = "Slide Builder was updated – reload the page (F5) to continue.";
/** `stateChanged`: the save state (`state`, `error`) changed, e.g. "saving" → "saved"; the status bar shows it at once */
export interface Change { local: boolean; by?: string; presetChanged: boolean; styleChanged: boolean; editsChanged: boolean; stateChanged: boolean }

export const DEBOUNCE_MS = 300, TAIL_MS = 1500;
/** compaction policy (04 §2.2) */
export const COMPACT_RECORDS = 2000, IDLE_WRITER_MS = 24 * 3600 * 1000, REST_MS = 5000;

/** a record and where it is on the share: (journal, end offset) of each copy known */
interface Entry { rec: DeckRecord; at: [string, number][] }

export class DocSync {
  /** the snapshot this page folds on */
  snap: DeckSnapshot;
  /** confirmed: the share's document as far as this page has read it */
  server: WorkbookDoc;
  view: WorkbookDoc;
  readonly key: string;
  readonly writer: string;
  /** bytes read per journal (the frontier at first) */
  private offsets: Record<string, number> = {};
  /** records past the snapshot's frontier, by (writer, seq) */
  private entries = new Map<string, Entry>();
  private folded: Folded;
  private lamport = 0;
  private seq = 0;
  private pending: Op[] = [];
  private inflight: DeckRecord | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private polling = false;
  private compacting = false;
  private retired = false;
  private disposed = false;
  private onRetiredSaved: (() => void) | null = null;
  /** my journal and the end of my last acknowledged record (rotation) */
  private mine: [string, number] | null = null;
  /** this page is the only one with the deck open (the page says so after each presence heartbeat) */
  private alone = false;
  private quietSince = Date.now();
  state: SaveState;
  error = "";
  private listeners = new Set<(c: Change) => void>();

  constructor(private api: DeckApi, readonly name: string, open: DeckOpen, private me: string, opts: { autoTail?: boolean } = {}) {
    this.key = open.key; this.writer = open.writer; this.snap = open.snapshot;
    this.offsets = { ...open.snapshot.frontier };
    if (open.tail) this.merge(open.tail);
    this.folded = this.refold();
    this.server = this.folded.doc; this.view = this.server;
    this.lamport = Math.max(this.lamport, this.folded.lamport);
    this.state = api.served ? (open.tail?.readonly ? "readonly" : "saved") : "local";
    if (open.tail?.readonly) this.error = open.tail.readonly;
    if (api.served && opts.autoTail !== false) this.scheduleTail();
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
  get busy() { return !!this.inflight || this.pending.length > 0; }
  /** records folded past the snapshot (what a compaction would fold in) */
  get backlog() { return this.entries.size; }
  get gen() { return this.snap.gen; }

  /* ---------------------------------------------------------------- the document */
  private refold(): Folded { return fold(this.snap, [...this.entries.values()].map(e => e.rec)); }
  private recompute() {
    this.folded = this.refold();
    this.server = this.folded.doc;
    this.lamport = Math.max(this.lamport, this.folded.lamport);
    const local = [...(this.inflight ? this.inflight.ops : []), ...this.pending];
    if (local.length) { this.view = applyOps(this.server, local).doc; this.view.rev = this.server.rev; }
    else this.view = this.server;
  }
  /** take a tail's records in; returns the authors (other people) of the new ones */
  private merge(t: TailResult): Set<string> {
    const by = new Set<string>();
    for (const [j, tj] of Object.entries(t.journals || {})) {
      const ends = tj.ends || [];
      tj.records.forEach((r, i) => {
        if (!validRecord(r)) return;
        this.lamport = Math.max(this.lamport, r.l);                  // invariant 6: never behind anything seen
        if (r.s <= (this.snap.seen?.[r.w] || 0)) return;
        const id = recordId(r), e = this.entries.get(id);
        const pos: [string, number] = [j, ends[i] ?? tj.offset];
        if (e) { if (!e.at.some(p => p[0] === pos[0] && p[1] === pos[1])) e.at.push(pos); e.rec = firstCopy(e.rec, r); return; }
        if (this.covered(pos)) return;
        this.entries.set(id, { rec: r, at: [pos] });
        if (r.w !== this.writer && r.by && r.by !== this.me) by.add(r.by);
      });
      this.offsets[j] = Math.max(this.offsets[j] || 0, tj.offset);
    }
    return by;
  }
  private covered(pos: [string, number]) { const f = this.snap.frontier[pos[0]]; return f !== undefined && pos[1] <= f; }

  /* ---------------------------------------------------------------- local changes */
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
    if (this.state !== "outdated" && this.state !== "readonly") this.state = this.api.served ? "pending" : "local";
    this.quietSince = Date.now();
    this.emit(prev, true);
    this.schedule(this.api.served ? DEBOUNCE_MS : 0);
    return inverse;
  }
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms); }

  /** append what is queued as one record (or the record a failed append left) */
  async flush(): Promise<void> {
    if (this.state === "outdated" || this.state === "readonly") return;
    if (!this.inflight) {
      if (!this.pending.length) return;
      this.inflight = { l: ++this.lamport, w: this.writer, s: ++this.seq, by: this.me || null, ops: this.pending };
      this.pending = [];
    } else if (this.sending) return;
    const rec = this.inflight;
    this.sending = true;
    // "Saving…" is a save state too (B6): the status bar shows it at once, not at its next re-render
    if (this.api.served) { const was: [SaveState, string] = [this.state, this.error]; this.state = "saving"; this.emit(this.view, false, undefined, was); }
    const prev = this.view, before: [SaveState, string] = [this.state, this.error];
    try {
      const r = await this.api.append(this.key, this.writer, rec);
      this.sending = false;
      if (this.inflight !== rec) return;
      const acked: DeckRecord = { ...rec, at: r.at };
      const e = this.entries.get(recordId(acked));
      if (e) { e.at.push([r.journal, r.offset]); e.rec = firstCopy(e.rec, acked); } else this.entries.set(recordId(acked), { rec: acked, at: [[r.journal, r.offset]] });
      this.mine = [r.journal, r.offset];
      this.inflight = null; this.retry = 0; this.error = "";
      this.recompute();
      this.state = this.pending.length ? "pending" : (this.api.served ? "saved" : "local");
      this.quietSince = Date.now();
      this.emit(prev, false, undefined, before);
      if (this.pending.length) this.schedule(50);
      else if (this.retired && this.onRetiredSaved) { const f = this.onRetiredSaved; this.onRetiredSaved = null; f(); }
    } catch (e) {
      this.sending = false;
      const status = (e as { status?: number }).status;
      // the helper speaks a newer data format than this page: retrying cannot help, reloading does
      if (status === 409) { this.state = "outdated"; this.error = (e as Error).message || OUTDATED; this.emit(prev, false, undefined, before); return; }
      if (status === 423) { this.state = "readonly"; this.error = (e as Error).message; this.emit(prev, false, undefined, before); return; }
      this.state = "error"; this.error = (e as Error).message || String(e);
      this.retry = Math.min(this.retry + 1, 5);
      this.emit(prev, false, undefined, before);
      this.schedule(1000 * Math.pow(2, this.retry));        // 2 s … 32 s; the record stays as it is (same w, s)
    }
  }
  private sending = false;

  /* ---------------------------------------------------------------- other people's changes */
  private scheduleTail() {
    if (this.disposed || this.retired) return;
    if (this.tailTimer) clearTimeout(this.tailTimer);
    this.tailTimer = setTimeout(() => { this.tailTimer = null; void this.poll().finally(() => this.scheduleTail()); }, TAIL_MS);
  }
  /** read the journals from where this page stopped: one tail at a time; a newer snapshot (another page compacted)
      is loaded and the records it holds are dropped. Then the compaction policy. */
  async poll(): Promise<void> {
    if (this.polling || this.retired || this.disposed || !this.api.served) return;
    this.polling = true;
    const prev = this.view, before: [SaveState, string] = [this.state, this.error];
    let by: Set<string>;
    try {
      const t = await this.api.tail(this.key, { ...this.offsets });
      by = this.merge(t);
      if (t.readonly && this.state !== "readonly") { this.state = "readonly"; this.error = t.readonly; }
      if (t.gen != null && t.gen > this.snap.gen) await this.loadSnapshot();
    } catch (e) {
      if ((e as { status?: number }).status === 409 && this.state !== "outdated") { this.state = "outdated"; this.error = (e as Error).message || OUTDATED; this.emit(prev, false, undefined, before); }
      return;
    } finally { this.polling = false; }
    this.recompute();
    this.emit(prev, false, by.size ? [...by].join(", ") : undefined, before);
    void this.maybeCompact();
  }
  private async loadSnapshot() {
    const s = await this.api.snapshot(this.key);
    if (s.gen > this.snap.gen) this.rebase(s);
  }
  /** a newer snapshot: records it holds leave; journals are read on from its frontier at least */
  private rebase(s: DeckSnapshot) {
    this.snap = s;
    for (const [j, off] of Object.entries(s.frontier)) this.offsets[j] = Math.max(this.offsets[j] || 0, off);
    for (const [id, e] of this.entries) if (e.at.some(p => this.covered(p)) || e.rec.s <= (s.seen?.[e.rec.w] || 0)) this.entries.delete(id);
    this.lamport = Math.max(this.lamport, s.lamport);
    // my journal is all in the snapshot: a new one (the helper deletes the covered file)
    if (this.mine && this.covered(this.mine) && !this.inflight) { this.mine = null; void this.api.rotate(this.key, this.writer).catch(() => undefined); }
  }

  /* ---------------------------------------------------------------- compaction */
  /** this page is (not) the only one with the deck open; at rest it compacts the deck itself (04 §4.4) */
  setAlone(alone: boolean) { this.alone = alone; if (alone) void this.maybeCompact(); }
  private dueForCompaction(now = Date.now()): boolean {
    const n = this.entries.size; if (!n) return false;
    if (n > COMPACT_RECORDS) return true;
    let oldest = Infinity; for (const e of this.entries.values()) if (e.rec.at != null) oldest = Math.min(oldest, e.rec.at);
    if (now - oldest > IDLE_WRITER_MS) return true;
    return this.alone && !this.busy && now - this.quietSince >= REST_MS;
  }
  private async maybeCompact() { if (!this.compacting && this.dueForCompaction()) await this.compact().catch(() => undefined); }
  /** fold what this page has read into a new snapshot (compare-and-set on gen). Returns the new gen, or null when
      someone else compacted first (their snapshot is loaded) or there was nothing to fold. `force`: also when the
      policy would wait (Prepare rollback). */
  async compact(): Promise<number | null> {
    if (this.compacting || !this.api.served || this.state === "readonly" || this.state === "outdated") return null;
    this.compacting = true;
    try {
      // first everything there is (the records are folded up to the offsets the frontier will say)
      const t = await this.api.tail(this.key, { ...this.offsets });
      const by = this.merge(t);
      if (t.gen != null && t.gen > this.snap.gen) { await this.loadSnapshot(); this.recompute(); }
      const next = this.candidate();
      if (!next) { if (by.size) this.recompute(); return null; }
      try { await this.api.compact(this.key, this.snap.gen, next); }
      catch (e) {
        if ((e as { status?: number }).status === 409) { await this.loadSnapshot().catch(() => undefined); this.recompute(); return null; }
        throw e;
      }
      const prev = this.view;
      this.rebase(next);
      this.recompute();
      this.emit(prev, false);
      return next.gen;
    } finally { this.compacting = false; }
  }
  /** the snapshot of everything this page knows the place of: the records read up to the offsets, and my own
      acknowledged ones (my current journal holds only those: a failed append always ends a journal). null when
      there is nothing to fold. */
  private candidate(): DeckSnapshot | null {
    const frontier = { ...this.offsets };
    if (this.mine) frontier[this.mine[0]] = Math.max(frontier[this.mine[0]] || 0, this.mine[1]);
    const inside = [...this.entries.values()].filter(e => e.at.some(([j, end]) => end <= (frontier[j] || 0))).map(e => e.rec);
    if (!inside.length) return null;
    return nextSnapshot(this.snap, fold(this.snap, inside), frontier);
  }
  /** for the page's pagehide (04 §4.4: the last one present compacts the deck it closes): the snapshot of the deck
      as it is now, when this page is the only one there and everything is saved; else null */
  restSnapshot(): { baseGen: number; snapshot: DeckSnapshot } | null {
    if (!this.alone || this.busy || !this.api.served || this.state !== "saved") return null;
    const s = this.candidate();
    return s ? { baseGen: this.snap.gen, snapshot: s } : null;
  }
  /** Prepare rollback (04 §4.4): everything saved, then compacted until no record lies past the frontier */
  async compactAll(): Promise<boolean> {
    await this.flush();
    for (let i = 0; i < 5; i++) {
      if (this.busy) return false;
      await this.compact();
      const t = await this.api.tail(this.key, { ...this.offsets });
      this.merge(t);
      if (t.gen != null && t.gen > this.snap.gen) await this.loadSnapshot();
      if (!this.entries.size) return true;
    }
    return false;
  }

  dispose() { this.disposed = true; if (this.timer) clearTimeout(this.timer); if (this.tailTimer) clearTimeout(this.tailTimer); this.listeners.clear(); }
  /** another workbook is opened: this document is no longer shown or read, but what it has not saved yet is still
      saved (a failed save keeps being retried) instead of being dropped */
  retire(onSaved?: () => void) {
    this.listeners.clear(); this.retired = true;
    if (this.tailTimer) { clearTimeout(this.tailTimer); this.tailTimer = null; }
    if (!this.busy) { if (this.timer) { clearTimeout(this.timer); this.timer = null; } onSaved?.(); }
    else this.onRetiredSaved = onSaved || null;                 // called once what was queued is on the share
  }
}
