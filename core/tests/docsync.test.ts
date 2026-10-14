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
  return new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false });
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
    vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
    deck.journals.forEach(j => j.frames.forEach(f => { f.rec.at = 0; }));     // nobody wrote for over 24 h
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
