/* Folding a deck (docs/next/04 §2, ADR-006): the snapshot plus the journal records past its frontier, in
   (lamport, writer, seq) order, one copy per (writer, seq) – the same document on every PC that has read the same
   records (invariant 2). The operations themselves are applied by ops.ts, the only implementation of their
   semantics; the helper never looks inside a record. */
import { applyOp } from "./ops";
import type { Op, WorkbookDoc } from "./types";

/** one journal record: `l` Lamport time, `w` writer (page session), `s` its sequence number (1, 2, …), `by` the
    author shown to people, `at` the file server's time (stamped by the helper on append), `ops` the operations */
export interface DeckRecord { l: number; w: string; s: number; by?: string | null; at?: number | null; ops: Op[] }
export interface LogEntry { rev: number; by: string | null; at: number | null }
/** data/v4/decks/<key>/snapshot.json */
export interface DeckSnapshot {
  format: 4; gen: number; workbook: string;
  /** the highest Lamport time folded in */ lamport: number;
  /** revisions so far: v3's rev at migration + one per record folded since */ rev: number;
  /** byte offsets per journal (file name without .log): the records before them are in `doc` */
  frontier: Record<string, number>;
  /** per writer, the highest seq s such that all of its records 1..s are in `doc`: a copy of one of them found
      past the frontier (a record appended again after a failed write, into another file) is not applied twice */
  seen?: Record<string, number>;
  by?: string | null; at?: number | null;
  updated?: number | null; updatedBy?: string | null; log?: LogEntry[];
  doc: WorkbookDoc;
}
export const LOG_KEEP = 20;

/** the order every PC folds in: Lamport time, then writer, then seq */
export function recordOrder(a: DeckRecord, b: DeckRecord): number {
  return a.l - b.l || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0) || a.s - b.s;
}
export const recordId = (r: Pick<DeckRecord, "w" | "s">) => r.w + "\u0000" + r.s;
/** of two copies of one record (the same page appended it twice: each copy got its own `at`), the one every PC
    keeps: the earlier one */
export function firstCopy(a: DeckRecord, b: DeckRecord): DeckRecord {
  const o = recordOrder(a, b); if (o) return o < 0 ? a : b;
  const ta = a.at ?? Infinity, tb = b.at ?? Infinity;
  return ta <= tb ? a : b;
}

/** a record a reader can use: integers where the fold needs them, operations as a list (anything else in it is
    passed to ops.ts, which skips what it does not know) */
export function validRecord(r: unknown): r is DeckRecord {
  const x = r as DeckRecord;
  return !!x && typeof x === "object" && Number.isSafeInteger(x.l) && x.l > 0 && typeof x.w === "string" && !!x.w
    && Number.isSafeInteger(x.s) && x.s > 0 && Array.isArray(x.ops);
}

export interface Folded {
  /** the document with rev, updated, updatedBy and log derived from the records */
  doc: WorkbookDoc;
  /** the highest Lamport time seen (the snapshot's or a record's) */
  lamport: number;
  /** the records applied, in order (copies and records already in the snapshot left out) */
  records: DeckRecord[];
  /** `seen` for a snapshot of this fold */
  seen: Record<string, number>;
}

/** snapshot + records → document. `records` may come in any order and with copies; records the snapshot already
    holds (seq ≤ snapshot.seen[w]) are skipped. Deterministic: the result depends only on the set of records. */
export function fold(snap: Pick<DeckSnapshot, "doc" | "lamport" | "rev" | "seen" | "updated" | "updatedBy" | "log">, records: Iterable<DeckRecord>): Folded {
  const seen0 = snap.seen || {};
  const byId = new Map<string, DeckRecord>();
  for (const r of records) {
    if (!validRecord(r) || r.s <= (seen0[r.w] || 0)) continue;
    const id = recordId(r), had = byId.get(id);
    // two copies are the same record (the same page sent it twice): every PC keeps the same one, whatever arrived first
    byId.set(id, had ? firstCopy(had, r) : r);
  }
  const list = [...byId.values()].sort(recordOrder);
  const doc = clone(snap.doc);
  let rev = snap.rev || 0, lamport = snap.lamport || 0;
  let updated = snap.updated ?? snap.doc.updated ?? null, updatedBy = snap.updatedBy ?? snap.doc.updatedBy ?? null;
  const log: LogEntry[] = [...(snap.log || snap.doc.log || [])].slice(-LOG_KEEP);
  for (const r of list) {
    for (const op of r.ops) applyOp(doc, op);
    rev++; lamport = Math.max(lamport, r.l);
    updated = r.at ?? updated; updatedBy = r.by ?? updatedBy;
    log.push({ rev, by: r.by ?? null, at: r.at ?? null });
  }
  // a writer's records 1..n all folded: `seen` moves on (a gap keeps it where it is: those records are applied again
  // only if a copy turns up past the frontier, which is harmless)
  const seen: Record<string, number> = { ...seen0 };
  const byWriter = new Map<string, number[]>();
  for (const r of list) { const a = byWriter.get(r.w); if (a) a.push(r.s); else byWriter.set(r.w, [r.s]); }
  for (const [w, ss] of byWriter) {
    ss.sort((a, b) => a - b);
    let n = seen[w] || 0;
    for (const s of ss) { if (s === n + 1) n = s; else if (s > n + 1) break; }
    if (n) seen[w] = n;
  }
  doc.rev = rev;
  if (updated != null) doc.updated = updated; else delete doc.updated;
  if (updatedBy != null) doc.updatedBy = updatedBy; else delete doc.updatedBy;
  const tail = log.slice(-LOG_KEEP);
  if (tail.length) doc.log = tail as WorkbookDoc["log"]; else delete doc.log;
  delete (doc as { backupAt?: unknown }).backupAt;
  return { doc, lamport, records: list, seen };
}

/** the snapshot that holds a fold: gen + 1, the frontier the reader reached */
export function nextSnapshot(cur: DeckSnapshot, f: Folded, frontier: Record<string, number>): DeckSnapshot {
  const { rev, updated, updatedBy, log, ...rest } = f.doc;
  const doc = { ...rest, rev } as WorkbookDoc;
  const out: DeckSnapshot = { format: 4, gen: cur.gen + 1, workbook: cur.workbook, lamport: f.lamport, rev, frontier: { ...cur.frontier, ...frontier }, seen: f.seen, doc };
  if (updated != null) out.updated = updated;
  if (updatedBy != null) out.updatedBy = updatedBy;
  if (log && log.length) out.log = log;
  return out;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
