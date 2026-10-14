/* An in-memory model of the helper's deck storage (helper/slidebuilder/decks.py, docs/next/04 §2.2) for the core's
   tests: per-writer journals with byte offsets, complete frames only, torn frames that seal a file, the compaction's
   compare-and-set on gen, rotation. Records are opaque here too: only w, s, l and the `at` it stamps. */
import type { DeckRecord, DeckSnapshot } from "../src/model/fold";
import type { DeckApi, TailResult } from "../src/sync/docsync";
import { emptyDoc } from "../src/model/ops";

interface Journal { size: number; frames: { end: number; rec: DeckRecord }[]; sealed: boolean }
export type AppendFailure = "before" | "torn" | "flush" | "lost";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const status = (code: number, msg: string) => Object.assign(new Error(msg), { status: code });

export class FakeDeck {
  journals = new Map<string, Journal>();
  snap: DeckSnapshot;
  /** the next appends fail this way (one entry per append) */
  failures: AppendFailure[] = [];
  readonly?: string;
  private current = new Map<string, string>();      // writer -> its open journal
  private next = new Map<string, number>();
  private clock = Date.now();          // the file server's ms, as `at` is
  calls = { append: 0, tail: 0, compact: 0, snapshot: 0, rotate: 0 };
  /** every complete record ever written (journals deleted since included) */
  written: DeckRecord[] = [];
  constructor(readonly key = "W.xlsx-0123456789", workbook = "W.xlsx", doc = emptyDoc(workbook)) {
    this.snap = { format: 4, gen: 1, workbook, lamport: 0, rev: doc.rev || 0, frontier: {}, doc };
  }
  now() { return this.clock += 1000; }
  private journalOf(writer: string): Journal & { name: string } {
    let name = this.current.get(writer);
    if (!name || !this.journals.has(name) || this.journals.get(name)!.sealed) {
      const n = this.next.get(writer) || 0; this.next.set(writer, n + 1);
      name = n ? `${writer}~${n}` : writer;
      this.journals.set(name, { size: 0, frames: [], sealed: false }); this.current.set(writer, name);
    }
    return Object.assign(this.journals.get(name)!, { name });
  }
  /** the server side of an append (what the helper does), `fail`: how it goes wrong */
  doAppend(writer: string, record: DeckRecord, fail?: AppendFailure) {
    this.calls.append++;
    if (this.readonly) throw status(423, this.readonly);
    if (record.w !== writer) throw status(400, "not the journal's writer");
    if (fail === "before") throw new Error("the share is unavailable");
    const j = this.journalOf(writer), rec = { ...clone(record), at: this.now() };
    const len = JSON.stringify(rec).length + 20;
    if (fail === "torn") { j.size += Math.ceil(len / 2); j.sealed = true; throw status(503, "torn write"); }
    j.size += len; j.frames.push({ end: j.size, rec }); this.written.push(rec);
    if (fail === "flush") { j.sealed = true; throw status(503, "flush failed"); }
    if (fail === "lost") throw new TypeError("Failed to fetch");      // written and flushed, the answer lost
    return { journal: j.name, offset: j.size, at: rec.at };
  }
  doTail(since: Record<string, number>): TailResult {
    this.calls.tail++;
    const out: TailResult = { journals: {}, gen: this.snap.gen };
    for (const [name, j] of this.journals) {
      const from = since[name] || 0, frames = j.frames.filter(f => f.end > from);
      if (frames.length) out.journals[name] = { offset: frames[frames.length - 1].end, records: frames.map(f => clone(f.rec)), ends: frames.map(f => f.end) };
    }
    if (this.readonly) out.readonly = this.readonly;
    return out;
  }
  doCompact(baseGen: number, s: DeckSnapshot) {
    this.calls.compact++;
    if (this.readonly) throw status(423, this.readonly);
    if (s.gen !== baseGen + 1) throw status(400, "gen");
    if (this.snap.gen !== baseGen) throw status(409, "compacted meanwhile");
    for (const [j, off] of Object.entries(this.snap.frontier)) {
      if (s.frontier[j] === undefined ? this.journals.has(j) : s.frontier[j] < off) throw status(409, "behind");
    }
    if (s.lamport < this.snap.lamport || s.rev < this.snap.rev) throw status(409, "behind");
    // a frontier past the complete records would hide records never folded: the helper's readers would skip them
    for (const [j, off] of Object.entries(s.frontier)) {
      const jj = this.journals.get(j);
      if (jj && off > (jj.frames.length ? jj.frames[jj.frames.length - 1].end : 0) && !jj.sealed) throw new Error(`frontier ${off} past the records of ${j}`);
    }
    this.snap = clone({ ...s, at: this.now() });
    return { gen: s.gen };
  }
  doRotate(writer: string) {
    this.calls.rotate++;
    const cur = this.current.get(writer); if (cur) this.journals.get(cur)!.sealed = true;
    const deleted: string[] = [];
    for (const [name, j] of this.journals) {
      if (name !== writer && !name.startsWith(writer + "~")) continue;
      const last = j.frames.length ? j.frames[j.frames.length - 1].end : 0, f = this.snap.frontier[name];
      if (f !== undefined && f >= last) { this.journals.delete(name); deleted.push(name); }
    }
    return { deleted: deleted.sort() };
  }
  /** an API that answers at once (async), with the failures queued in `failures` */
  api(): DeckApi {
    return {
      served: true,
      snapshot: async () => { this.calls.snapshot++; return clone(this.snap); },
      tail: async (_k, since) => this.doTail(since),
      append: async (_k, writer, record) => this.doAppend(writer, record, this.failures.shift()),
      compact: async (_k, baseGen, s) => this.doCompact(baseGen, s),
      rotate: async (_k, writer) => this.doRotate(writer),
    };
  }
  open(writer: string, withTail = true) {
    return { key: this.key, writer, snapshot: clone(this.snap), ...(withTail ? { tail: this.doTail({ ...this.snap.frontier }) } : {}) };
  }
  /** every record on the share, as one reader sees it (journal order) */
  records(): DeckRecord[] { return [...this.journals.values()].flatMap(j => j.frames.map(f => f.rec)); }
}
