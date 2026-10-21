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
   one there – the deck at rest); the helper takes it only if nobody compacted meanwhile (compare-and-set on gen).
   A deck that is about to receive, or already holds, what 4.0.0 does not know whole (model/ops.ts needsV5) is first
   raised to snapshot format 5 (upgrade: ADR-019 and its amendment), so that no 4.0–4.5 window can read, fold or
   overwrite it. */
import type { Op, WorkbookDoc } from "../model/types";
import { applyOps, inverseOf, applyOp, knownOp, needsV5, docNeedsV5 } from "../model/ops";
import { firstCopy, fold, nextSnapshot, recordId, validRecord, type DeckRecord, type DeckSnapshot, type Folded } from "../model/fold";

export interface TailJournal { offset: number; records: DeckRecord[]; /** each record's end offset */ ends?: number[] }
export interface TailResult { journals: Record<string, TailJournal>; gen: number | null; readonly?: string;
  /** the file server's time (ms) */ now?: number;
  /** journals that could not be read this time (left out; read again next time) */ skipped?: string[] }
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
  /** open this writer's journal ahead of its first append (the append then costs write + flush only) */
  prepare?(key: string, writer: string): Promise<unknown>;
  /** ADR-019: the deck's marker incident-format-5.json (every 4.0–4.5 helper then takes the deck for read-only);
      `at` when it was written and `now`, the file server's ms (an existing one is fine: created false) */
  format5(key: string): Promise<{ created?: boolean; at?: number | null; now?: number | null }>;
}

export type SaveState = "saved" | "pending" | "saving" | "error" | "local" | "outdated" | "readonly";
const OUTDATED = "Slide Builder was updated – reload the page (F5) to continue.";
/** `stateChanged`: the save state (`state`, `error`) changed, e.g. "saving" → "saved"; the status bar shows it at once */
/** `deckChanged`: the deck's snapshot or the records past it changed (the side panel's deck-health line) */
export interface Change { local: boolean; by?: string; presetChanged: boolean; styleChanged: boolean; editsChanged: boolean; stateChanged: boolean; deckChanged?: boolean }

export const DEBOUNCE_MS = 300, TAIL_MS = 1500;
/** compaction policy (04 §2.2) */
export const COMPACT_RECORDS = 2000, IDLE_WRITER_MS = 24 * 3600 * 1000, REST_MS = 5000;
/** a compaction folds only records appended at least this long ago (the file server's time): a journal created
    since may still be missing from a reader's listing (the helper caches it 3 s, the SMB client 10 s more), and
    a record in it could be one that a newer record already folded in overwrote (review of S5.2, finding 2) */
export const COMPACT_MARGIN_MS = 30_000;
/** the bump's wait after the marker (ADR-019 amendment; = decks.BUMP_WAIT_S): how long a 4.0–4.5 page may still append
    after it. Journal mode: its helper looks at the deck's folder again every REFRESH_S = 4 s, and the SMB client may
    answer that listing from its 10 s directory cache: 4 + 10 + 1 s. Lean-lock mode (no append handle, so no
    refresher): only its page's tail looks again, at most every CHECK_TTL = 10 s, tailing every TAIL_MS = 1.5 s:
    10 + 1.5 + 10 + 1 s. The mode may differ per PC (SLIDEBUILDER_STORAGE): the longer one, always */
export const BUMP_WAIT_MS = 23_000;
/** the first record after a bump is this far above every Lamport time seen: a record an old page appended in the gap
    without this page reading it (a slower share than the bound above, a journal not listed yet) still folds before
    it – an old page cannot have seen the 4.6 record, so it cannot count past it (review of S13.1, 1–2) */
export const BUMP_LAMPORT = 2 ** 20;
/** every 4.6 page takes the jump, not only the one that raised the deck: its helper may not list a journal an old page
    opened in the gap until 3 s (LISTING_TTL) + 10 s (SMB) after it (recheck of S13.1). So the first time a page sees
    the deck go 4 -> 5 (rebase), and when it opens a format-5 deck raised less than this long ago (the snapshot's `at`,
    the file server's ms, is the raise or a later compaction: the raise came BUMP_WAIT_MS after the marker at least) */
export const BUMP_FRESH_MS = BUMP_WAIT_MS + 13_000;

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
  /** the file server's time at the last tail, and this PC's time then (to estimate the server's time now) */
  private serverAt: [number, number] | null = null;
  /** when this page last asked the helper to have its journal open (prepare), this PC's ms; 0 = never / again */
  private prepared = 0;
  /** the last tail left a journal out (unreadable): no compaction on such a round */
  private skippedRound = false;
  /** the file server's time of the last tail that read every journal: a compaction folds only records older than it
      minus the margin, so every record it folds was appended before a complete read (re-review of S5.2, R2) */
  private lastFullTail: number | null = null;
  private readonly margin: number;
  private readonly bumpWait: number;
  /** the bump in progress (one at a time) */
  private bump: Promise<boolean> | null = null;
  /** raise the deck as soon as it holds 4.6 content (a page with the deck open; the tests and Prepare rollback's
      own DocSyncs raise it only before a record or a compaction needs it) */
  private readonly autoBump: boolean;
  state: SaveState;
  error = "";
  private listeners = new Set<(c: Change) => void>();
  private emittedHealth = "";

  constructor(private api: DeckApi, readonly name: string, open: DeckOpen, private me: string, opts: { autoTail?: boolean; /** COMPACT_MARGIN_MS (tests) */ compactMargin?: number;
    /** BUMP_WAIT_MS (tests) */ bumpWaitMs?: number; /** default: autoTail */ bumpOnOpen?: boolean } = {}) {
    this.margin = opts.compactMargin ?? COMPACT_MARGIN_MS;
    this.bumpWait = opts.bumpWaitMs ?? DocSync.bumpWaitMs;
    this.autoBump = opts.bumpOnOpen ?? opts.autoTail !== false;
    this.key = open.key; this.writer = open.writer; this.snap = open.snapshot;
    this.offsets = { ...open.snapshot.frontier };
    if (open.tail) this.merge(open.tail);
    this.folded = this.refold();
    this.server = this.folded.doc; this.view = this.server;
    this.lamport = Math.max(this.lamport, this.folded.lamport);
    // a deck raised moments ago: a gap record this page's open tail did not list may be above everything seen
    // (without the file server's time, or the snapshot's: as if moments ago)
    if (api.served && this.snap.format >= 5) {
      const now = open.tail?.now, at = this.snap.at;
      if (typeof now !== "number" || typeof at !== "number" || now - at < BUMP_FRESH_MS) this.lamport += BUMP_LAMPORT;
    }
    this.state = api.served ? (open.tail?.readonly ? "readonly" : "saved") : "local";
    if (open.tail?.readonly) this.error = open.tail.readonly;
    // a deck a 4.3–4.5 page gave such content to, still at format 4: raised before anything else (09 §1)
    this.bumpIfDue();
    if (api.served && opts.autoTail !== false) this.scheduleTail();
  }
  /** BUMP_WAIT_MS for DocSyncs made without the option (the core worker's; tests set 0) */
  static bumpWaitMs = BUMP_WAIT_MS;
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
    // a compaction changes no content, but the deck's snapshot (gen) and backlog: the page shows them
    const hh = this.health, h = hh.gen + "/" + hh.backlog + "/" + hh.journals;
    if (h !== this.emittedHealth) { c.deckChanged = true; this.emittedHealth = h; }
    if (c.presetChanged || c.styleChanged || c.editsChanged || c.stateChanged || c.deckChanged || local) this.listeners.forEach(f => f(c));
  }
  get busy() { return !!this.inflight || this.pending.length > 0; }
  /** records folded past the snapshot (what a compaction would fold in) */
  get backlog() { return this.entries.size; }
  get gen() { return this.snap.gen; }
  /** for the side panel: the snapshot's gen, the records past it, and the journals those records are in */
  get health() {
    const js = new Set<string>();
    for (const e of this.entries.values()) js.add(e.at[0][0]);
    return { gen: this.snap.gen, backlog: this.entries.size, journals: js.size };
  }

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
    if (typeof t.now === "number") this.serverAt = [t.now, Date.now()];
    // a journal unread, or the helper unsure of the file server's clock (no `now`): not a complete round
    this.skippedRound = !!(t.skipped && t.skipped.length) || typeof t.now !== "number";
    if (typeof t.now === "number" && !this.skippedRound) this.lastFullTail = t.now;
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
    // a read-only deck (a damaged journal, 423) is read, never changed: an edit shown now would never be saved (audit DATA-4)
    if (this.state === "readonly") return null;
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
    // the journal opened during the debounce (its first append, after a rotation, or after the helper closed the idle
    // handle): the append itself then costs the share two round trips
    if (this.api.served && this.api.prepare && Date.now() - this.prepared > 5 * 60_000) {
      this.prepared = Date.now(); void this.api.prepare(this.key, this.writer).catch(() => { this.prepared = 0; });
    }
    if (this.state !== "outdated") this.state = this.api.served ? "pending" : "local";
    this.quietSince = Date.now();
    this.emit(prev, true);
    this.schedule(this.api.served ? DEBOUNCE_MS : 0);
    return inverse;
  }
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms); }

  /** append what is queued as one record (or the record a failed append left) */
  async flush(): Promise<void> {
    if (this.state === "outdated" || this.state === "readonly" || this.disposed) return;
    if (!this.inflight) {
      if (!this.pending.length || this.sending) return;          // (sending: a bump before this record is under way)
      if (this.bump || this.dueV5(this.pending)) {
        // ADR-019: the deck raised to format 5 first; the record waits in the queue meanwhile (more ops may join it)
        this.sending = true;
        const prev = this.view, before: [SaveState, string] = [this.state, this.error];
        if (this.api.served) { this.state = "saving"; this.emit(prev, false, undefined, before); }
        let ok = false;
        try { ok = await this.upgrade(); if (!ok) throw new Error("The deck could not be prepared for Slide Builder 4.6 objects – trying again."); }
        catch (e) { this.sending = false; this.failed(e, prev, before); return; }
        this.sending = false;
        if (this.disposed || this.inflight || !this.pending.length) return;
      }
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
      if (typeof r.at === "number") this.serverAt = [r.at, Date.now()];   // the file server's clock, as a tail's `now`
      const e = this.entries.get(recordId(acked));
      if (e) { e.at.push([r.journal, r.offset]); e.rec = firstCopy(e.rec, acked); } else this.entries.set(recordId(acked), { rec: acked, at: [[r.journal, r.offset]] });
      this.mine = [r.journal, r.offset];
      this.prepared = Date.now();
      this.inflight = null; this.retry = 0; this.error = "";
      this.recompute();
      this.state = this.pending.length ? "pending" : (this.api.served ? "saved" : "local");
      this.quietSince = Date.now();
      this.emit(prev, false, undefined, before);
      if (this.pending.length) this.schedule(50);
      else if (this.retired && this.onRetiredSaved) { const f = this.onRetiredSaved; this.onRetiredSaved = null; f(); }
    } catch (e) {
      this.sending = false;
      this.failed(e, prev, before);
    }
  }
  /** a failed append (or the bump before one) */
  private failed(e: unknown, prev: WorkbookDoc, before: [SaveState, string]) {
    const status = (e as { status?: number }).status;
    // the helper speaks a newer data format than this page: retrying cannot help, reloading does
    if (status === 409) { this.state = "outdated"; this.error = (e as Error).message || OUTDATED; this.emit(prev, false, undefined, before); return; }
    if (status === 423) { this.state = "readonly"; this.error = (e as Error).message; this.emit(prev, false, undefined, before); return; }
    this.state = "error"; this.error = (e as Error).message || String(e);
    this.retry = Math.min(this.retry + 1, 5);
    this.emit(prev, false, undefined, before);
    this.schedule(1000 * Math.pow(2, this.retry));        // 2 s … 32 s; the record stays as it is (same w, s)
  }
  private sending = false;

  /* ---------------------------------------------------------------- the format guard (ADR-019) */
  /** the deck is still format 4 but `ops` (or, without them, its snapshot or a record past it) hold what 4.0.0 does
      not apply whole */
  private dueV5(ops?: Op[]): boolean {
    if (!this.api.served || this.snap.format >= 5) return false;
    if (ops) return ops.some(needsV5);
    if (docNeedsV5(this.snap.doc)) return true;
    for (const e of this.entries.values()) if (e.rec.ops.some(needsV5)) return true;
    return false;
  }
  /** the bump in progress (tests), or null */
  get upgrading(): Promise<boolean> | null { return this.bump; }
  /** raise the deck to format 5 (one bump at a time; true when it is format 5 now). ADR-019, amended 2026-10-21:
      1. the helper writes incident-format-5.json: every 4.0–4.5 helper takes the deck for read-only from its next look
         at the deck's folder;
      2. wait BUMP_WAIT_MS from the marker's time (an old page may still append until then: a wizard preset.set too),
         then ask for the marker again (the helper lists the journals afresh; a marker removed meanwhile is written
         again, and waited for);
      3. tail until no journal was skipped: the records of that gap are read;
      4. compare-and-set: the snapshot as it is, gen + 1, format 5 (it folds nothing; on 409 – compacted meanwhile, or
         the helper finds the marker too young – reload and from 1 again: the marker's wait is then what is left);
      5. only then the record is appended (flush), with a Lamport time BUMP_LAMPORT above everything seen (rebase:
         every page that sees the deck go 4 -> 5 jumps, and one that opens a deck raised moments ago: BUMP_FRESH_MS). */
  upgrade(): Promise<boolean> {
    if (this.snap.format >= 5) return Promise.resolve(true);
    return this.bump ||= this.raise().finally(() => { this.bump = null; });
  }
  private async raise(): Promise<boolean> {
    const prev = this.view;
    for (let round = 0; round < 10 && !this.disposed; round++) {
      for (let i = 0, waited = false; i < 4; i++) {
        const m = await this.api.format5(this.key);
        const left = typeof m?.at === "number" && typeof m.now === "number" ? Math.min(this.bumpWait, m.at + this.bumpWait - m.now) : waited ? 0 : this.bumpWait;
        if (left <= 0) break;
        await this.sleep(left); waited = true;
      }
      let t: TailResult | null = null;
      for (let i = 0; i < 5 && !this.disposed; i++) {
        if (i && this.bumpWait) await this.sleep(Math.min(1000, this.bumpWait));   // a journal unread (a hiccup): again
        t = await this.api.tail(this.key, { ...this.offsets });
        this.merge(t);
        if (t.readonly) throw Object.assign(new Error(t.readonly), { status: 423 });
        if (!t.skipped?.length) break;
      }
      if (!t || t.skipped?.length) return false;          // (the record waits; flush tries again later)
      if (t.gen != null && t.gen > this.snap.gen) await this.loadSnapshot();
      if (this.snap.format < 5) {
        const next: DeckSnapshot = { ...this.snap, gen: this.snap.gen + 1, format: 5 };
        try { await this.api.compact(this.key, this.snap.gen, next); }
        catch (e) {
          if ((e as { status?: number }).status !== 409) throw e;
          const gen = this.snap.gen;
          await this.loadSnapshot();                      // compacted meanwhile – or the marker too young for the helper:
          if (this.snap.gen === gen && this.bumpWait) await this.sleep(Math.min(1000, this.bumpWait));   // a second later
          continue;
        }
        this.rebase(next);
      }
      this.recompute();                                   // (the Lamport jump: rebase, as the deck went 4 -> 5)
      this.emit(prev, false);                             // (records of others read meanwhile)
      return true;
    }
    return false;
  }
  private sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
  /** a page with the deck open raises it as soon as it holds 4.6 content (at open, or a 4.3–4.5 page's record read) */
  private bumpIfDue() {
    if (!this.autoBump || this.bump || this.state === "readonly" || this.state === "outdated" || this.retired || this.disposed || !this.dueV5()) return;
    void this.upgrade().catch(e => {
      const prev = this.view, before: [SaveState, string] = [this.state, this.error], status = (e as { status?: number }).status;
      if (status === 409) { this.state = "outdated"; this.error = (e as Error).message || OUTDATED; }
      else if (status === 423) { this.state = "readonly"; this.error = (e as Error).message; }
      else return;                                    // the next record, compaction or poll tries again
      this.emit(prev, false, undefined, before);
    });
  }

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
    this.bumpIfDue();
    void this.maybeCompact();
  }
  private async loadSnapshot() {
    const s = await this.api.snapshot(this.key);
    this.rebase(s);
  }
  /** a newer snapshot: records it holds leave; journals are read on from its frontier at least. Never an older one (a
      compaction's answer may arrive after a newer snapshot was loaded). */
  private rebase(s: DeckSnapshot) {
    if (s.gen <= this.snap.gen) return;
    const raised = s.format >= 5 && this.snap.format < 5;
    this.snap = s;
    for (const [j, off] of Object.entries(s.frontier)) this.offsets[j] = Math.max(this.offsets[j] || 0, off);
    for (const [id, e] of this.entries) if (e.at.some(p => this.covered(p)) || e.rec.s <= (s.seen?.[e.rec.w] || 0)) this.entries.delete(id);
    this.lamport = Math.max(this.lamport, s.lamport);
    // the deck went 4 -> 5 (raised here or by another page): every record of mine from now on folds after any record an
    // old page appended in the gap, read or not (BUMP_LAMPORT, BUMP_FRESH_MS)
    if (raised) this.lamport = Math.max(this.lamport, this.folded.lamport) + BUMP_LAMPORT;
    // my journal is all in the snapshot: a new one (the helper deletes the covered file)
    if (this.mine && this.covered(this.mine) && !this.inflight) { this.mine = null; this.prepared = 0; void this.api.rotate(this.key, this.writer).catch(() => undefined); }
  }

  /* ---------------------------------------------------------------- compaction */
  /** this page is (not) the only one with the deck open; at rest it compacts the deck itself (04 §4.4) */
  setAlone(alone: boolean) { this.alone = alone; if (alone) void this.maybeCompact(); }
  /** the file server's time now, as far as the last tail tells (else this PC's) */
  private serverNow() { return this.serverAt ? this.serverAt[0] + (Date.now() - this.serverAt[1]) : Date.now(); }
  private dueForCompaction(): boolean {
    const n = this.entries.size; if (!n) return false;
    if (n > COMPACT_RECORDS) return true;
    let oldest = Infinity; for (const e of this.entries.values()) if (e.rec.at != null) oldest = Math.min(oldest, e.rec.at);
    if (this.serverNow() - oldest > IDLE_WRITER_MS) return true;
    return this.alone && !this.busy && Date.now() - this.quietSince >= REST_MS;
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
      if (this.skippedRound) { if (by.size) this.recompute(); return null; }     // a journal unread: maybe records missing
      let next = this.candidate();
      if (!next) { if (by.size) this.recompute(); return null; }
      if (next.format > this.snap.format) {
        // the fold holds 4.6 content: the deck is raised first (marker, wait, CAS), then folded on the new snapshot
        if (!await this.upgrade()) return null;
        next = this.candidate();
        if (!next) return null;
      }
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
  /** the next snapshot: what this page knows the place of - the records read up to the offsets, and my own
      acknowledged ones (my current journal holds only those: a failed append always ends a journal) - cut so that
      every journal's frontier is a prefix of records all in the snapshot, every writer's records in it are
      1..n without a gap (so `seen` says exactly what it holds), and no record is younger than the margin.
      null when there is nothing to fold. */
  private candidate(): DeckSnapshot | null {
    const F: Record<string, number> = { ...this.offsets };
    // my journal holds only my records (a failed append always ends one): a shared one (lean-lock) never counts as mine
    if (this.mine && (this.mine[0] === this.writer || this.mine[0].startsWith(this.writer + "~")))
      F[this.mine[0]] = Math.max(F[this.mine[0]] || 0, this.mine[1]);
    if (this.lastFullTail == null) return null;
    // a record of a newer page (an op, key or item kind this page does not know) would be folded as nothing and lost
    // for every page: nothing is compacted while one is past the snapshot – a newer page compacts it (AUDIT-2 DATA-7).
    // Not just that record: the records after it in Lamport order must not be folded before it either
    for (const e of this.entries.values()) if (!e.rec.ops.every(knownOp)) return null;
    const cutoff = this.lastFullTail - this.margin, seen = this.snap.seen || {};
    // each journal's records past the snapshot, in file order
    const byJ = new Map<string, { end: number; id: string }[]>();
    for (const [id, e] of this.entries) for (const [j, end] of e.at) { const l = byJ.get(j); if (l) l.push({ end, id }); else byJ.set(j, [{ end, id }]); }
    for (const l of byJ.values()) l.sort((a, b) => a.end - b.end);
    let inside = new Set<string>();
    for (let round = 0; round < 1000; round++) {
      // records with a copy inside the frontier, old enough; per writer only 1..n without a gap
      const avail = new Map<string, DeckRecord[]>();
      for (const [id, e] of this.entries) {
        if (e.rec.at != null && e.rec.at > cutoff) continue;
        if (!e.at.some(([j, end]) => end <= (F[j] ?? 0))) continue;
        const a = avail.get(e.rec.w); if (a) a.push(e.rec); else avail.set(e.rec.w, [e.rec]); void id;
      }
      inside = new Set<string>();
      for (const [w, recs] of avail) {
        recs.sort((a, b) => a.s - b.s);
        let n = seen[w] || 0;
        for (const r of recs) { if (r.s === n + 1) { n = r.s; inside.add(recordId(r)); } else if (r.s > n + 1) break; }
      }
      // each journal's frontier: up to the first record that is not inside
      let changed = false;
      for (const [j, list] of byJ) {
        let f = this.snap.frontier[j] ?? 0;
        for (const x of list) { if (x.end > (F[j] ?? 0)) break; if (!inside.has(x.id)) break; f = x.end; }
        if (f < (F[j] ?? 0)) { F[j] = f; changed = true; }
      }
      if (!changed) break;
    }
    if (!inside.size) return null;
    const recs = [...inside].map(id => this.entries.get(id)!.rec);
    // journals the snapshot does not reach yet keep the frontier they had (or none)
    const frontier: Record<string, number> = {};
    for (const [j, f] of Object.entries(F)) if (f > (this.snap.frontier[j] ?? 0) || j in this.snap.frontier) frontier[j] = Math.max(f, this.snap.frontier[j] ?? 0);
    return nextSnapshot(this.snap, fold(this.snap, recs), frontier);
  }
  /** for the page's pagehide (04 §4.4: the last one present compacts the deck it closes): the snapshot of the deck
      as it is now, when this page is the only one there and everything is saved; else null */
  restSnapshot(): { baseGen: number; snapshot: DeckSnapshot } | null {
    if (!this.alone || this.busy || !this.api.served || this.state !== "saved" || this.skippedRound) return null;
    const s = this.candidate();
    // (raising the deck needs the marker and the wait first: never in a request sent as the page goes)
    return s && s.format <= this.snap.format ? { baseGen: this.snap.gen, snapshot: s } : null;
  }
  /** Prepare rollback (04 §4.4): everything saved, then compacted until no record lies past the frontier (records
      younger than the margin wait for it: up to `waitMs`) */
  async compactAll(waitMs = this.margin + 15_000): Promise<boolean> {
    await this.flush();
    const end = Date.now() + waitMs;
    for (let i = 0; i < 50; i++) {
      if (this.busy) return false;
      await this.compact();
      const t = await this.api.tail(this.key, { ...this.offsets });
      this.merge(t);
      if (t.gen != null && t.gen > this.snap.gen) await this.loadSnapshot();
      if (!this.entries.size) return true;
      if (Date.now() >= end) return false;
      await new Promise(r => setTimeout(r, Math.min(5000, Math.max(200, this.margin / 6))));
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
