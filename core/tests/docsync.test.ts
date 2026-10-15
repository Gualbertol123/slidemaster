/* DocSync v4 (storage v4, docs/next/04 §2): appends, tails, rebase, Lamport order (B4), copies folded once,
   compaction and rotation, undo by inverse records – against the in-memory deck of fakedeck.ts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocSync, type Change, type DeckApi } from "../src/sync/docsync";
import type { Op } from "../src/model/types";
import { FakeDeck, status } from "./fakedeck";

// a failing test must not leave fake timers to the next one
afterEach(() => { vi.useRealTimers(); });

const cell = (ref: string, patch: Record<string, unknown>): Op => ({ op: "cell.patch", sheet: "S", ref, patch } as Op);
let n = 0;
const writer = (who: string) => `${who}@pc#${String(++n).padStart(8, "a").replace(/[0-9]/g, "b")}`;
function user(deck: FakeDeck, who: string, api: DeckApi = deck.api()) {
  return new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false, compactMargin: 0 });
}

describe("DocSync v4", () => {
  it("two users editing different cells: both edits survive and both see them", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    a.apply([cell("A1", { b: true })]); b.apply([cell("B2", { fill: "#34C759" })]);
    await a.flush(); await b.flush(); await a.poll(); await b.poll();
    expect(a.view.edits.S).toEqual({ A1: { b: true }, B2: { fill: "#34C759" } });
    expect(b.view.edits).toEqual(a.view.edits);
    expect(a.server.rev).toBe(2); expect(b.server.rev).toBe(2);
    expect(deck.journals.size).toBe(2);                         // one journal per writer: no lock on the edit path
  });
  it("one record per batch: a 300 ms debounce, one append in flight, '✓ Saved' when flushed (B6)", async () => {
    vi.useFakeTimers();
    const deck = new FakeDeck(), a = user(deck, "anna");
    const seen: { state: string; c: Change }[] = [];
    a.on(c => seen.push({ state: a.state, c }));
    a.apply([cell("A1", { b: true })]); a.apply([cell("A2", { i: true })]);
    expect(seen.map(x => x.state)).toEqual(["pending", "pending"]);
    await vi.advanceTimersByTimeAsync(299); expect(deck.calls.append).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(deck.calls.append).toBe(1); expect(deck.records()[0].ops.length).toBe(2);
    expect(a.state).toBe("saved");
    expect(seen.map(x => x.state)).toEqual(["pending", "pending", "saving", "saved"]);
    for (const x of seen.slice(2)) expect([x.c.stateChanged, x.c.local, x.c.editsChanged]).toEqual([true, false, false]);
    // a failed append is announced at once, the record stays as it is and goes again (2 s, then 4 s …)
    deck.failures.push("before");
    a.apply([cell("A3", { sz: 9 })]);
    await vi.advanceTimersByTimeAsync(300);
    expect(a.state).toBe("error"); expect(a.view.edits.S.A3).toEqual({ sz: 9 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(a.state).toBe("saved"); expect(deck.records().length).toBe(2);
    // a tail that brings nothing new announces nothing
    const k = seen.length; await a.poll(); expect(seen.length).toBe(k);
    a.dispose();
  });
  it("local changes made while an append is in flight stay on top and go in the next record", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna");
    a.apply([cell("A1", { b: true })]);
    const p = a.flush();
    a.apply([cell("A2", { i: true })]);
    await p;
    expect(a.view.edits.S).toEqual({ A1: { b: true }, A2: { i: true } });
    await a.flush();
    expect(deck.records().map(r => r.s)).toEqual([1, 2]);
    expect(a.server.edits.S).toEqual({ A1: { b: true }, A2: { i: true } });
  });
  it("same field edited by two people: Lamport order decides, not arrival (B4), and both converge", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    a.apply([cell("C3", { text: "anna" })]); await a.flush();       // l = 1
    await b.poll();                                                  // bob has seen l = 1
    b.apply([cell("C3", { text: "bob" })]);
    a.apply([cell("C3", { text: "anna again" })]);                   // l = 2 (anna saw nothing new)
    await a.flush();                                                 // arrives first …
    await b.flush();                                                 // … bob's l = 2 too, "bob" > "anna" breaks the tie
    await a.poll(); await b.poll();
    expect(a.server.edits.S.C3.text).toBe(b.server.edits.S.C3.text);
    const recs = deck.records().filter(r => r.ops.length);
    const last = recs.sort((x, y) => x.l - y.l || (x.w < y.w ? -1 : 1)).at(-1)!;
    expect(a.server.edits.S.C3.text).toBe((last.ops[0] as { patch: { text: string } }).patch.text);
    expect(a.server.edits.S.C3.text).toBe("bob");
    // a writer's next record is newer than everything it has seen (invariant 6)
    b.apply([cell("C3", { text: "bob last" })]); await b.flush(); await a.poll();
    expect(deck.records().at(-1)!.l).toBeGreaterThan(Math.max(...recs.map(r => r.l)));
    expect(a.server.edits.S.C3.text).toBe("bob last");
  });
  it("a record appended twice (the answer was lost, or the flush failed into a sealed file) is folded once", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    deck.failures.push("lost", "flush");
    a.apply([{ op: "table.patch", id: "t", patch: {} } as Op, cell("A1", { text: "x", orig: "y" })]);
    await a.flush(); expect(a.state).toBe("error");                 // written, answer lost
    await a.flush(); expect(a.state).toBe("error");                 // written again, flush failed: the file is sealed
    await a.flush(); expect(a.state).toBe("saved");                 // a third copy, in a new file
    expect(deck.records().length).toBe(3); expect(deck.journals.size).toBe(2);
    expect(new Set(deck.records().map(r => r.l + ":" + r.s)).size).toBe(1);      // the same record each time
    await b.poll();
    expect(b.server.rev).toBe(1); expect(b.server.edits.S.A1).toEqual({ text: "x", orig: "y" });
    expect(b.server.log!.length).toBe(1);
  });
  it("a torn write seals the journal: the retry goes to a new one and nothing is lost", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    a.apply([cell("A1", { b: true })]); await a.flush();
    deck.failures.push("torn");
    a.apply([cell("A2", { b: true })]); await a.flush(); expect(a.state).toBe("error");
    await a.flush(); expect(a.state).toBe("saved");
    await b.poll();
    expect(b.server.edits.S).toEqual({ A1: { b: true }, A2: { b: true } });
  });
  it("remote changes are reported with their authors; mine are not", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    const seen: (string | undefined)[] = []; a.on(c => { if (!c.local && (c.editsChanged || c.styleChanged)) seen.push(c.by); });
    b.apply([{ op: "style.patch", patch: { design: "excel" } } as Op]); await b.flush();
    a.apply([cell("A1", { b: true })]); await a.flush();
    await a.poll();
    expect(seen).toEqual(["bob"]); expect(a.view.style.design).toBe("excel");
    // both at Lamport time 1 (neither had seen the other): the fold's order is (l, w, s), so bob's comes last
    expect(a.server.updatedBy).toBe("bob"); expect(a.server.log!.map(x => x.by)).toEqual(["anna", "bob"]);
  });
  it("undo (inverse ops appended) does not revert another user's later change", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    const inv = a.apply([cell("A1", { b: true })])!; await a.flush();
    await b.poll(); b.apply([cell("C3", { text: "x", orig: "y" })]); await b.flush();
    await a.poll(); a.apply(inv); await a.flush(); await b.poll();
    expect(b.server.edits.S).toEqual({ C3: { text: "x", orig: "y" } });
    expect(deck.records().length).toBe(3);                         // the undo is a record of its own
  });
  it("compaction: CAS on gen, records past the frontier stay, the loser loads the winner's snapshot", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    for (let i = 1; i <= 5; i++) { a.apply([cell("A" + i, { sz: i })]); await a.flush(); }
    await b.poll();
    const [ga, gb] = await Promise.all([a.compact(), b.compact()]);
    expect([ga, gb].filter(g => g === 2).length).toBe(1);          // one wins, the other drops its work
    expect(deck.snap.gen).toBe(2); expect(deck.snap.rev).toBe(5);
    a.apply([cell("A9", { b: true })]); await a.flush();
    await a.poll(); await b.poll();
    expect(a.gen).toBe(2); expect(b.gen).toBe(2);
    expect(b.server.edits.S).toEqual(a.server.edits.S);
    expect(b.server.rev).toBe(6); expect(b.backlog).toBe(1);
    // a new page opens on the snapshot and the record past it
    const c = user(deck, "carl");
    expect(c.server.edits.S).toEqual(a.server.edits.S); expect(c.server.rev).toBe(6);
  });
  it("the deck's health (side panel): snapshot, changes past it and their journals; reported on change only", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    const seen: Change[] = [];
    b.on(c => seen.push(c));
    expect(b.health).toEqual({ gen: 1, backlog: 0, journals: 0 });
    a.apply([cell("A1", { b: true })]); await a.flush(); a.apply([cell("A2", { b: true })]); await a.flush();
    b.apply([cell("B1", { b: true })]); await b.flush();
    await b.poll();
    expect(b.health).toEqual({ gen: 1, backlog: 3, journals: 2 });
    seen.length = 0;
    await b.poll();                                                  // nothing new: nobody is told
    expect(seen).toEqual([]);
    await a.poll(); await a.compact(); await b.poll();               // anna compacts: no content changes, the health does
    expect(b.health).toEqual({ gen: 2, backlog: 0, journals: 0 });
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ deckChanged: true, editsChanged: false, presetChanged: false, styleChanged: false });
  });
  it("rotation: once a snapshot covers my journal it is deleted and my next record starts a new one", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    a.apply([cell("A1", { b: true })]); await a.flush();
    await b.poll(); await b.compact();                             // bob's snapshot covers anna's journal
    await a.poll();                                                 // anna loads it and rotates
    await new Promise(r => setTimeout(r, 0));
    expect(deck.calls.rotate).toBe(1); expect(deck.journals.size).toBe(0);
    a.apply([cell("A2", { b: true })]); await a.flush(); await b.poll();
    expect([...deck.journals.keys()]).toEqual([a.writer + "~1"]);
    expect(b.server.edits.S).toEqual({ A1: { b: true }, A2: { b: true } });
  });
  it("the compaction policy: more than 2 000 records; alone and at rest; a writer idle for 24 h", async () => {
    vi.useFakeTimers();
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    for (let i = 0; i < 2001; i++) deck.doAppend(b.writer, { l: i + 1, w: b.writer, s: i + 1, by: "bob", ops: [cell("B" + (i + 1), { sz: 1 })] });
    await a.poll(); await vi.advanceTimersByTimeAsync(0);
    expect(deck.calls.compact).toBe(1); expect(deck.snap.rev).toBe(2001); expect(a.backlog).toBe(0);
    a.apply([cell("A1", { b: true })]); await vi.advanceTimersByTimeAsync(300);
    a.setAlone(true); await vi.advanceTimersByTimeAsync(0);
    expect(deck.calls.compact).toBe(1);                            // not yet: edited just now
    await vi.advanceTimersByTimeAsync(5000); await a.poll(); await vi.advanceTimersByTimeAsync(0);
    expect(deck.calls.compact).toBe(2); expect(a.backlog).toBe(0);
    a.setAlone(false);
    deck.doAppend(b.writer, { l: 9000, w: b.writer, s: 2002, by: "bob", ops: [] });
    await a.poll(); await vi.advanceTimersByTimeAsync(0); expect(deck.calls.compact).toBe(2);
    (deck as unknown as { clock: number }).clock += 25 * 3600 * 1000;      // the file server's clock: a day later,
    deck.journals.forEach(j => j.frames.forEach(f => { f.rec.at = 0; }));     // and nobody wrote for over 24 h
    deck.doAppend(b.writer, { l: 9001, w: b.writer, s: 2003, by: "bob", ops: [] });
    await a.poll(); await vi.advanceTimersByTimeAsync(0);
    expect(deck.calls.compact).toBe(3);
    a.dispose();
  });
  it("the deck at rest for pagehide: only when alone, saved and something to fold", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna");
    a.apply([cell("A1", { b: true })]);
    a.setAlone(true);
    expect(a.restSnapshot()).toBeNull();                           // not saved yet
    await a.flush();
    expect(a.restSnapshot()).toBeNull();                           // no complete tail since it was appended
    await a.poll();
    const r = a.restSnapshot()!;
    expect(r.baseGen).toBe(1); expect(r.snapshot.gen).toBe(2); expect(r.snapshot.doc.edits.S.A1).toEqual({ b: true });
    expect(r.snapshot.frontier[a.writer]).toBe(deck.journals.get(a.writer)!.size);  // my own record, never tailed: covered
    expect(deck.doCompact(r.baseGen, r.snapshot).gen).toBe(2);
    a.setAlone(false); expect(a.restSnapshot()).toBeNull();
  });
  it("Prepare rollback: compactAll leaves nothing past the frontier", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna"), b = user(deck, "bob");
    b.apply([cell("B1", { b: true })]); await b.flush();
    a.apply([cell("A1", { b: true })]);
    expect(await a.compactAll()).toBe(true);
    const fr = deck.snap.frontier;
    for (const [name, j] of deck.journals) expect(fr[name]).toBe(j.frames.at(-1)!.end);
    expect(deck.snap.doc.edits.S).toEqual({ A1: { b: true }, B1: { b: true } });
  });
  it("a corrupt journal (423 / tail.readonly): the deck turns read-only, nothing more is sent", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna");
    deck.readonly = "a journal of this deck is damaged";
    await a.poll();
    expect(a.state).toBe("readonly"); expect(a.error).toMatch(/damaged/);
    a.apply([cell("A1", { b: true })]); await a.flush();
    expect(deck.calls.append).toBe(0); expect(a.state).toBe("readonly");
    expect(await a.compact()).toBeNull();
  });
});

describe("DocSync v4 when a tail misses a journal (review of S5.2: the 10 s listing, an unreadable journal)", () => {
  /** an API whose tails leave journals out: `hidden` silently (not listed yet), `unreadable` named in `skipped` */
  function lossy(deck: FakeDeck, hidden: Set<string>, unreadable = new Set<string>()): DeckApi {
    const api = deck.api();
    return { ...api, tail: async (k, since) => {
      const t = await api.tail(k, since);
      for (const j of Object.keys(t.journals)) {
        if (hidden.has(j)) delete t.journals[j];
        else if (unreadable.has(j)) { delete t.journals[j]; (t.skipped ||= []).push(j); }
      }
      return t;
    } };
  }
  const clock = (deck: FakeDeck, ms: number) => { (deck as unknown as { clock: number }).clock += ms; };
  const text = (d: DocSync, ref: string) => (d.server.edits.S?.[ref] as { text?: string } | undefined)?.text;

  it("A: a correction is never folded in before the edit it corrected (records younger than the margin wait)", async () => {
    const deck = new FakeDeck();
    const x = new DocSync(deck.api(), "W.xlsx", deck.open("x@pc#xxxxxxxx"), "x", { autoTail: false });
    const y = new DocSync(deck.api(), "W.xlsx", deck.open("y@pc#yyyyyyyy"), "y", { autoTail: false });
    x.apply([cell("Z1", { text: "a" })]); await x.flush();
    await y.poll(); y.apply([cell("Z1", { text: "b" })]); await y.flush();      // y saw "a" and corrected it
    const hidden = new Set([x.writer]);                                         // x's new journal: not in p's listing yet
    const p = new DocSync(lossy(deck, hidden), "W.xlsx", deck.open("p@pc#pppppppp", false), "p", { autoTail: false });
    expect(await p.compact()).toBeNull();                                       // y's record is too young to fold in
    clock(deck, 60_000); hidden.clear();                                        // later every listing has x's journal
    expect(await p.compact()).toBe(2);
    for (const d of [x, y, p]) await d.poll();
    const fresh = new DocSync(deck.api(), "W.xlsx", deck.open("q@pc#qqqqqqqq"), "q", { autoTail: false });
    for (const d of [x, y, p, fresh]) expect(text(d, "Z1")).toBe("b");
  });
  it("B: a record copied into two journals, one unread: no compaction on that round; a gap in a writer's records is never snapshotted", async () => {
    const deck = new FakeDeck(), w = new DocSync(deck.api(), "W.xlsx", deck.open("w@pc#wwwwwwww"), "w", { autoTail: false, compactMargin: 0 });
    w.apply([cell("Z1", { text: "a" })]); await w.flush();
    deck.failures.push("flush");                                                // s=2 written into w, w sealed, not acked
    w.apply([cell("Z1", { text: "b" })]); await w.flush(); await w.flush();     // the retry: acked in w~1
    expect([...deck.journals.keys()]).toEqual([w.writer, w.writer + "~1"]);
    const unread = new DocSync(lossy(deck, new Set(), new Set([w.writer])), "W.xlsx", deck.open("p@pc#pppppppp", false), "p", { autoTail: false, compactMargin: 0 });
    expect(await unread.compact()).toBeNull();
    const unlisted = new DocSync(lossy(deck, new Set([w.writer])), "W.xlsx", deck.open("r@pc#rrrrrrrr", false), "r", { autoTail: false, compactMargin: 0 });
    expect(await unlisted.compact()).toBeNull();                                // it has s=2 but not s=1: nothing to fold
    expect(await w.compact()).toBe(2);                                          // w reads both: s=1, s=2 folded once
    const fresh = new DocSync(deck.api(), "W.xlsx", deck.open("q@pc#qqqqqqqq"), "q", { autoTail: false });
    await w.poll();
    for (const d of [w, fresh]) { expect(text(d, "Z1")).toBe("b"); expect(d.server.rev).toBe(2); }
  });
  it("C: a page never compacts its own journal on a round its tail could not read it", async () => {
    const deck = new FakeDeck(), unreadable = new Set<string>();
    const w = new DocSync(lossy(deck, new Set(), unreadable), "W.xlsx", deck.open("w@pc#wwwwwwww"), "w", { autoTail: false, compactMargin: 0 });
    w.apply([cell("Z1", { text: "a" })]); await w.flush();
    deck.failures.push("flush");
    w.apply([cell("Z1", { text: "b" })]); await w.flush(); await w.flush();
    unreadable.add(w.writer);
    expect(await w.compact()).toBeNull();
    unreadable.clear();
    expect(await w.compact()).toBe(2);
    expect(deck.snap.rev).toBe(2); expect(w.server.rev).toBe(2);
  });
  it("D: a compaction's answer that arrives after a newer snapshot never takes the page back", async () => {
    const deck = new FakeDeck(), base = deck.api();
    let release: (() => void) | null = null;
    const slow: DeckApi = { ...base, compact: (k, g, s) => new Promise((ok, bad) => { release = () => base.compact(k, g, s).then(ok, bad); }) };
    const a = new DocSync(slow, "W.xlsx", deck.open("a@pc#aaaaaaaa"), "a", { autoTail: false, compactMargin: 0 });
    const b = new DocSync(base, "W.xlsx", deck.open("b@pc#bbbbbbbb"), "b", { autoTail: false, compactMargin: 0 });
    a.apply([cell("A1", { text: "a" })]); await a.flush();
    const pending = a.compact();
    await new Promise(r => setTimeout(r, 0));
    release!(); await new Promise(r => setTimeout(r, 0));                       // gen 2 is written ...
    b.apply([cell("B1", { text: "b" })]); await b.flush(); await b.poll(); expect(await b.compact()).toBe(3);
    await a.poll();                                                             // ... a loads gen 3 first
    await pending;                                                              // then hears that its gen 2 succeeded
    expect(a.gen).toBe(3); expect(text(a, "B1")).toBe("b");
  });
});

describe("DocSync v4: re-review of S5.2", () => {
  const text = (d: DocSync, ref: string) => (d.server.edits.S?.[ref] as { text?: string } | undefined)?.text;
  it("R1: the snapshot for pagehide is never taken on a round that could not read a journal", async () => {
    const deck = new FakeDeck(), unreadable = new Set<string>(), base = deck.api();
    const lossy: DeckApi = { ...base, tail: async (k, s) => { const t = await base.tail(k, s); for (const j of unreadable) if (t.journals[j]) { delete t.journals[j]; (t.skipped ||= []).push(j); } return t; } };
    const x = new DocSync(base, "W.xlsx", deck.open("x@pc#xxxxxxxx"), "x", { autoTail: false, compactMargin: 0 });
    const y = new DocSync(base, "W.xlsx", deck.open("y@pc#yyyyyyyy"), "y", { autoTail: false, compactMargin: 0 });
    x.apply([cell("Z1", { text: "a" })]); await x.flush();
    await y.poll(); y.apply([cell("Z1", { text: "b" })]); await y.flush();
    const p = new DocSync(lossy, "W.xlsx", deck.open("p@pc#pppppppp", false), "p", { autoTail: false, compactMargin: 0 });
    p.setAlone(true);
    unreadable.add(x.writer);
    (deck as unknown as { clock: number }).clock += 120_000;
    await p.poll();
    expect(await p.compact()).toBeNull();
    expect(p.restSnapshot()).toBeNull();
  });
  it("R2: one shared journal (lean-lock): my last append never stretches the frontier over records I have not read", async () => {
    const deck = new FakeDeck();
    // every writer appends to one journal "shared"
    (deck as unknown as { journalOf: (w: string) => unknown }).journalOf = function (this: FakeDeck) {
      if (!this.journals.has("shared")) this.journals.set("shared", { size: 0, frames: [], sealed: false, created: 0 } as never);
      return Object.assign(this.journals.get("shared")!, { name: "shared" });
    };
    const a = new DocSync(deck.api(), "W.xlsx", deck.open("a@pc#aaaaaaaa"), "a", { autoTail: false, compactMargin: 0 });
    const b = new DocSync(deck.api(), "W.xlsx", deck.open("b@pc#bbbbbbbb"), "b", { autoTail: false, compactMargin: 0 });
    await b.poll();                                                // b's last complete read: nothing yet
    a.apply([cell("A1", { text: "a" })]); await a.flush();
    b.apply([cell("B1", { text: "b" })]); await b.flush();         // appended after a's record, which b has not read
    (deck as unknown as { clock: number }).clock += 120_000;
    b.setAlone(true);
    const r = b.restSnapshot();
    if (r) expect(deck.doCompact(r.baseGen, r.snapshot).gen).toBe(2);
    const fresh = new DocSync(deck.api(), "W.xlsx", deck.open("q@pc#qqqqqqqq"), "q", { autoTail: false });
    expect(text(fresh, "A1")).toBe("a"); expect(text(fresh, "B1")).toBe("b");
  });
});

describe("DocSync v4 after Slide Builder was updated", () => {
  it("409 on append: no retries, the page asks to reload, the record is kept", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const deck = new FakeDeck(), api = { ...deck.api(), append: async () => { calls++; throw status(409, "Slide Builder was updated - reload the page (F5)"); } };
    const a = user(deck, "anna", api);
    a.apply([cell("A1", { b: true })]); await a.flush();
    expect(a.state).toBe("outdated"); expect(a.error).toMatch(/reload/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1); expect(a.view.edits.S.A1).toEqual({ b: true });
    a.dispose();
  });
  it("a snapshot in a newer format (409 on read): outdated, the document is left as it was", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna");
    deck.snap = { ...deck.snap, gen: 7 };
    const api = a as unknown as { api: DeckApi };
    api.api.snapshot = async () => { throw status(409, "saved by a newer Slide Builder"); };
    await a.poll();
    expect(a.state).toBe("outdated"); expect(a.gen).toBe(1);
  });
  it("retire: what is not saved yet is still saved, then the callback", async () => {
    const deck = new FakeDeck(), a = user(deck, "anna");
    a.apply([cell("A1", { b: true })]);
    let saved = false; a.retire(() => { saved = true; });
    expect(saved).toBe(false);
    await a.flush();
    expect(saved).toBe(true); expect(deck.records().length).toBe(1);
  });
});
