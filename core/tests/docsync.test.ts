/* DocSync v4 (storage v4, docs/next/04 §2): appends, tails, rebase, Lamport order (B4), copies folded once,
   compaction and rotation, undo by inverse records – against the in-memory deck of fakedeck.ts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUMP_LAMPORT, BUMP_WAIT_MS, DocSync, type Change, type DeckApi } from "../src/sync/docsync";
import type { Op } from "../src/model/types";
import { FakeDeck, status } from "./fakedeck";

// a failing test must not leave fake timers to the next one
afterEach(() => { vi.useRealTimers(); });

const cell = (ref: string, patch: Record<string, unknown>): Op => ({ op: "cell.patch", sheet: "S", ref, patch } as Op);
let n = 0;
const writer = (who: string) => `${who}@pc#${String(++n).padStart(8, "a").replace(/[0-9]/g, "b")}`;
function user(deck: FakeDeck, who: string, api: DeckApi = deck.api()) {
  return new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false, compactMargin: 0, bumpWaitMs: 0 });
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
  it("a record of a newer page – an op or a key this page does not know – is never compacted away (AUDIT-2 DATA-7)", async () => {
    // a 4.1 page folded 4.3's item.patch and 4.4's free / cellGrid / borders / looks as nothing and compacted: the
    // snapshot said the records were in it, and the charts, callouts and layouts were gone for every page
    const newer = [
      { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "map", box: { x: 0, y: 0, w: 10, h: 10 } } },  // an item kind of a later version
      { op: "slide.patch", id: "s1", patch: { title: "T2", ribbon: { glass: "x" } } },                          // a key of a later version
      { op: "table.patch", id: "t1", patch: { stripes: { A1: "on" } } },
      { op: "chart.patch", slide: "s1", id: "c1", patch: {} },                                                   // an op of a later version
    ];
    for (const op of newer) {
      const deck = new FakeDeck(), a = user(deck, "anna"), nina = writer("nina");
      a.apply([{ op: "preset.set", preset: { slides: [{ id: "s1", title: "T" }], tables: [{ id: "t1", sheet: "S", range: "A1:B2" }] } } as unknown as Op]);
      await a.flush();
      deck.doAppend(nina, { l: 9, w: nina, s: 1, by: "nina", ops: [op] } as never);
      a.apply([cell("A1", { b: true })]); await a.flush(); await a.poll();
      a.setAlone(true);
      expect(await a.compact(), op.op).toBeNull();
      expect(a.restSnapshot()).toBeNull();
      expect(deck.snap.gen).toBe(1);
      expect(deck.records().some(r => r.w === nina)).toBe(true);
    }
    // what this page knows is compacted as before
    const deck = new FakeDeck(), a = user(deck, "anna");
    a.apply([{ op: "preset.set", preset: { slides: [{ id: "s1", title: "T" }], tables: [{ id: "t1", sheet: "S", range: "A1:B2" }] } } as unknown as Op,
      { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "shape", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } } } as Op,
      { op: "slide.patch", id: "s1", patch: { free: { glass: { on: true, items: {} } }, looks: { mckinsey: { kpis: "2" } } } } as Op,
      { op: "table.patch", id: "t1", patch: { cellGrid: { A1: { o: true } }, borders: { A1: { top: "none" } } } } as Op]);
    await a.flush(); await a.poll();
    expect(await a.compact()).toBe(3);                          // (gen 2: the deck raised to format 5 before the record, ADR-019)
    expect(deck.snap.format).toBe(5);
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
  it("a read-only deck takes no change: nothing is shown that would never be saved (audit DATA-4)", async () => {
    // CHANGELOG 4.0.0: "the deck can be read but not changed"; an edit was applied on screen, never saved, and closing
    // the window did not warn - the edit was lost without a word
    const deck = new FakeDeck(), a = user(deck, "anna");
    deck.readonly = "a journal of this deck is damaged";
    await a.poll();
    const before = JSON.stringify(a.view);
    expect(a.apply([cell("A1", { b: true })])).toBeNull();
    expect(JSON.stringify(a.view)).toBe(before);
    expect(a.state).toBe("readonly");
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
  it("E: a tail without the file server's time (the helper's clock probe failed) is no round to compact on", async () => {
    const deck = new FakeDeck(), base = deck.api();
    let unsure = true;
    const api: DeckApi = { ...base, tail: async (k, s) => { const t = await base.tail(k, s); if (unsure) delete t.now; return t; } };
    const w = new DocSync(api, "W.xlsx", deck.open("w@pc#wwwwwwww"), "w", { autoTail: false, compactMargin: 0 });
    w.apply([cell("Z1", { text: "a" })]); await w.flush();
    expect(await w.compact()).toBeNull();
    unsure = false;
    expect(await w.compact()).toBe(2);
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

describe("DocSync v4: the per-deck format guard (ADR-019 and its amendment)", () => {
  const preset = { op: "preset.set", preset: { sheets: ["S"], slides: [{ id: "s1", type: "content", title: "T", tables: ["t1"] }], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:B2" }] } } as unknown as Op;
  const chart = { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "shape", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } } } as Op;
  const v5user = (deck: FakeDeck, who: string, api: DeckApi = deck.api(), o: Record<string, unknown> = {}) =>
    new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false, compactMargin: 0, bumpWaitMs: 0, ...o });
  /** the bump's sleeps, recorded; the file server's clock moves on by as much */
  const waits = (s: DocSync, deck?: FakeDeck) => { const w: number[] = []; (s as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { w.push(ms); deck?.advance(ms); }; return w; };
  async function plainDeck() {
    const deck = new FakeDeck(), a = v5user(deck, "anna");
    a.apply([preset]); await a.flush();
    return { deck, a };
  }

  it("CP-02: a deck without 4.6 objects stays format 4 - its records, its compactions", async () => {
    const { deck, a } = await plainDeck();
    a.apply([cell("A1", { b: true }), { op: "slide.patch", id: "s1", patch: { title: "T2", notes: { "t1:top": { text: "x" } } } } as Op,
      { op: "style.patch", patch: { designs: { mckinsey: { consult: { kpis: "2" } } } } } as Op]);
    deck.log.length = 0;
    await a.flush();
    expect(deck.log).toEqual(["append"]);                                    // no marker, no bump: straight to the journal
    expect(await a.compact()).toBe(2);
    expect(deck.snap.format).toBe(4); expect(deck.calls.format5).toBe(0); expect(deck.marker).toBeNull();
  });
  it("the bump: marker -> wait -> tail -> the snapshot unchanged at format 5, gen + 1 -> the record, above every Lamport time seen", async () => {
    const { deck, a } = await plainDeck();
    const old = writer("old"), base = deck.api();
    // a 4.0 page appends in the gap (its helper has not seen the marker yet): a wizard preset.set without the chart
    const api: DeckApi = { ...base, format5: async k => { const r = await base.format5(k); if (r.created) deck.doAppend(old, { l: 50, w: old, s: 1, by: "old", ops: [preset] }); return r; } };
    const b = v5user(deck, "bea", api, { bumpWaitMs: 40 }), w = waits(b, deck);
    const before = JSON.stringify(deck.snap.doc);
    deck.log.length = 0;
    b.apply([chart]); await b.flush();
    expect(deck.log).toEqual(["format5", "append" /* the old page's */, "format5", "tail", "compact:5", "append"]);
    expect(w).toEqual([40]);                                                 // BUMP_WAIT_MS = 23 s in the product
    expect(BUMP_WAIT_MS).toBe(23_000);
    expect(deck.snap.format).toBe(5); expect(deck.snap.gen).toBe(2);
    expect(JSON.stringify(deck.snap.doc)).toBe(before);                      // folds nothing: the same document
    const mine = deck.records().find(r => r.w === b.writer)!;
    expect(mine.l).toBeGreaterThan(50);                                      // after the old page's preset.set in every fold
    await a.poll(); await b.poll();
    expect(Object.keys(a.view.preset!.slides[0].items || {})).toEqual(["c1"]);
    expect(b.state).toBe("saved"); expect(b.view).toEqual(a.view);
  });
  it("a helper that waits less (its test setting, SLIDEBUILDER_TEST_BUMP_WAIT_S) shortens the page's wait – never lengthens it", async () => {
    // review of M13, 3: a wait that is not a finite number ≥ 0 is ignored (the page's own wait)
    for (const [helperWait, expected] of [[10, [10]], [100, [40]], [0, []], [-5, [40]], [NaN, [40]], [Infinity, [40]], [-Infinity, [40]]] as const) {
      const { deck } = await plainDeck();
      const base = deck.api();
      const api: DeckApi = { ...base, format5: async k => ({ ...(await base.format5(k)), wait: helperWait }) };
      const b = v5user(deck, "bea", api, { bumpWaitMs: 40 }), w = waits(b, deck);
      b.apply([chart]); await b.flush();
      expect(w).toEqual(expected);
      expect(deck.snap.format).toBe(5);
    }
  });
  it("review of S13.1, 1: an old page's record appended after the final tail (its helper had not seen the marker) still folds before the 4.6 record", async () => {
    const { deck, a } = await plainDeck();
    const old = writer("old"), base = deck.api();
    let once = true;
    // the old page saw more than this page (l 1000): its wizard Finish, a preset.set without the chart, lands after the last tail
    const api: DeckApi = { ...base, compact: async (k, g, sn) => {
      if (once && sn.format === 5) { once = false; deck.doAppend(old, { l: 1000, w: old, s: 1, by: "old", ops: [preset] }); }
      return base.compact(k, g, sn);
    } };
    const b = v5user(deck, "bea", api);
    b.apply([chart]); await b.flush();
    expect(deck.snap.format).toBe(5);
    expect(deck.records().find(r => r.w === b.writer)!.l).toBeGreaterThan(1000 + 1);       // 2^20 above what it had seen
    await a.poll(); await b.poll();
    expect(Object.keys(a.view.preset!.slides[0].items || {})).toEqual(["c1"]);          // the chart survives in every fold
    expect(b.view).toEqual(a.view);
  });
  it("review of S13.1, 2: the tail after the wait is repeated while a journal was skipped, on a fresh listing", async () => {
    const { deck, a } = await plainDeck();
    const old = writer("old"), base = deck.api();
    let tails = 0;
    const api: DeckApi = { ...base,
      format5: async k => { const r = await base.format5(k);
        if (!deck.journals.has(old)) { deck.doAppend(old, { l: 70, w: old, s: 1, by: "old", ops: [preset] }); deck.unreadable.add(old); }
        return r; },
      tail: async (k, s) => { const t = await base.tail(k, s); if (++tails === 1) deck.unreadable.clear(); return t; } };
    const b = v5user(deck, "bea", api, { bumpWaitMs: 40 }), w = waits(b, deck);
    deck.log.length = 0;
    b.apply([chart]); await b.flush();
    expect(w).toEqual([40, 40]);                                             // the wait; then 1 s (here 40 ms) before the second tail
    // the marker, the wait, the marker again (the helper lists the journals afresh), a tail that skipped a journal, another
    expect(deck.log).toEqual(["format5", "append" /* the old page's */, "format5", "tail", "tail", "compact:5", "append"]);
    const mine = deck.records().find(r => r.w === b.writer)!;
    expect(mine.l).toBeGreaterThan(70);
    await a.poll();
    expect(Object.keys(a.view.preset!.slides[0].items || {})).toEqual(["c1"]);
  });
  it("review of S13.1, 5: a raise the helper refuses as too early (409, the marker too young) waits for the rest and goes on", async () => {
    const { deck } = await plainDeck();
    deck.bumpWaitMs = 31_000;                                 // (the helper's clock a second behind the page's wait)
    deck.marker = deck.now() - 10_000;                        // written by another 4.6 page 10 s ago (its bump under way)
    const b = v5user(deck, "bea", deck.api(), { bumpWaitMs: 30_000 }), w = waits(b, deck);
    deck.log.length = 0;
    b.apply([chart]); await b.flush();
    expect(w).toEqual([20_000, 1000]);                                       // what is left of the wait; after the 409, 1 s
    expect(deck.log).toEqual(["format5", "format5", "tail", "compact:5" /* 409 */, "format5", "tail", "compact:5", "append"]);
    expect(deck.snap.format).toBe(5); expect(b.state).toBe("saved");
  });
  it("recheck of S13.1: a second 4.6 page that sees the deck go 4 -> 5 jumps its Lamport time too (the gap journal not listed by its helper)", async () => {
    const { deck, a } = await plainDeck();
    const old = writer("old"), base = deck.api();
    const c = v5user(deck, "carl");                          // a second 4.6 page, the deck still format 4 when it opened
    // the old page opens a new journal in the gap: the raising page's fresh listing reads it, carl's helper does not list it yet
    const api: DeckApi = { ...base, format5: async k => { const r = await base.format5(k); if (r.created) deck.doAppend(old, { l: 1000, w: old, s: 1, by: "old", ops: [preset] }); return r; } };
    const b = v5user(deck, "bea", api);
    deck.listingLag = 13_000;                                // a new journal is missing from a listing for 13 s (3 s + SMB's 10 s)
    b.apply([chart]); await b.flush();
    expect(deck.snap.format).toBe(5);
    await c.poll();                                          // the format-5 snapshot loaded; the gap journal unseen
    expect(c.snap.format).toBe(5);
    c.apply([{ ...chart, id: "c2" } as Op]); await c.flush();
    expect(deck.records().find(r => r.w === c.writer)!.l).toBeGreaterThan(1000);
    deck.advance(20_000); await a.poll();
    expect(Object.keys(a.view.preset!.slides[0].items || {}).sort()).toEqual(["c1", "c2"]);   // the old preset.set folds first
  });
  it("recheck of S13.1: a page that opens a format-5 deck raised moments ago jumps its Lamport time; one raised long ago does not", async () => {
    const { deck, a } = await plainDeck();
    const old = writer("old"), base = deck.api();
    const api: DeckApi = { ...base, format5: async k => { const r = await base.format5(k); if (r.created) deck.doAppend(old, { l: 1000, w: old, s: 1, by: "old", ops: [preset] }); return r; } };
    const b = v5user(deck, "bea", api);
    deck.advance(60_000); deck.listingLag = 13_000;          // (anna's journal listed long since)
    b.apply([chart]); await b.flush();
    const d = v5user(deck, "dan");                           // opens now: format 5, its open tail does not list the gap journal
    expect(d.snap.format).toBe(5);
    d.apply([{ ...chart, id: "c3" } as Op]); await d.flush();
    expect(deck.records().find(r => r.w === d.writer)!.l).toBeGreaterThan(1000);
    deck.advance(20_000); await a.poll();
    expect(Object.keys(a.view.preset!.slides[0].items || {}).sort()).toEqual(["c1", "c3"]);
    // long after the raise (every journal listed by then): no jump
    deck.advance(BUMP_WAIT_MS + 13_000);
    const e = v5user(deck, "eva");
    e.apply([{ ...chart, id: "c4" } as Op]); await e.flush();
    const l = deck.records().find(r => r.w === e.writer)!.l;
    expect(l).toBeLessThan(2 * BUMP_LAMPORT); expect(l).toBeGreaterThan(BUMP_LAMPORT);   // above b's and d's, one jump in all
  });
  it("the wait counts from the marker: one written long ago is not waited for again", async () => {
    const { deck } = await plainDeck();
    deck.marker = deck.now() - 60_000;
    const b = v5user(deck, "bea", deck.api(), { bumpWaitMs: 5000 }), w = waits(b);
    b.apply([chart]); await b.flush();
    expect(w).toEqual([]); expect(deck.snap.format).toBe(5);
  });
  it("a bump that loses the compare-and-set reloads and tries again; a deck found at 5 is not bumped again", async () => {
    const { deck } = await plainDeck();
    const base = deck.api();
    let race = true;
    const api: DeckApi = { ...base, tail: async (k, s) => {
      const t = await base.tail(k, s);
      if (race && deck.marker != null) { race = false; deck.doCompact(deck.snap.gen, { ...deck.snap, gen: deck.snap.gen + 1 }); }   // somebody compacted meanwhile
      return t;
    } };
    const b = v5user(deck, "bea", api), c = v5user(deck, "carl");
    b.apply([chart]); await b.flush();
    expect(deck.snap.format).toBe(5); expect(deck.snap.gen).toBe(3);
    expect(deck.log.filter(x => x === "compact:5").length).toBe(2);           // the first lost (409), the second won
    expect(b.state).toBe("saved"); expect(deck.records().filter(r => r.w === b.writer).length).toBe(1);
    deck.log.length = 0;
    c.apply([{ ...chart, id: "c2" } as Op]); await c.flush();                  // c opened the deck at format 4
    expect(deck.log).toEqual(["format5", "tail", "append"]);                  // found at 5 on its tail: no second CAS
    expect(deck.snap.gen).toBe(3);
  });
  it("never lowered: a format-5 deck whose 4.6 objects were all deleted is compacted at format 5", async () => {
    const { deck, a } = await plainDeck();
    a.apply([chart]); await a.flush();
    a.apply([{ op: "item.patch", slide: "s1", id: "c1", patch: null } as Op]); await a.flush();
    expect(a.view.preset!.slides[0].items).toBeUndefined();
    expect(await a.compact()).toBe(3);
    expect(deck.snap.format).toBe(5);
  });
  it("opening a format-4 deck whose journal (a 4.5 page's record) or snapshot holds 4.6 content raises it at once", async () => {
    const { deck } = await plainDeck();
    const p = writer("p45");
    deck.doAppend(p, { l: 9, w: p, s: 1, by: "p45", ops: [{ op: "slide.patch", id: "s1", patch: { free: { glass: { on: true, items: {} } } } } as Op] });
    const b = v5user(deck, "bea", deck.api(), { bumpOnOpen: true });
    expect(await b.upgrading).toBe(true);
    expect(deck.snap.format).toBe(5); expect(deck.calls.format5).toBe(1); expect(b.state).toBe("saved");
    // a deck whose snapshot already holds it (a 4.5 page compacted it at format 4)
    const deck2 = new FakeDeck(), a2 = v5user(deck2, "anna");
    a2.apply([preset]); await a2.flush();
    const pr = JSON.parse(JSON.stringify((preset as unknown as { preset: object }).preset));
    pr.tables[0].borders = { A1: { top: "none" } };
    deck2.snap = { ...deck2.snap, doc: { ...deck2.snap.doc, preset: pr } };
    const c = v5user(deck2, "carl", deck2.api(), { bumpOnOpen: true });
    expect(await c.upgrading).toBe(true); expect(deck2.snap.format).toBe(5);
    // nothing of the kind: no bump
    const d = v5user(new FakeDeck(), "dan", undefined, { bumpOnOpen: true });
    expect(d.upgrading).toBeNull();
  });
  it("a compaction that would raise the deck bumps first; the pagehide snapshot never raises it", async () => {
    const { deck, a } = await plainDeck();
    const p = writer("p45");
    deck.doAppend(p, { l: 9, w: p, s: 1, by: "p45", ops: [{ op: "table.patch", id: "t1", patch: { cellGrid: { A1: { o: true } } } } as Op] });
    await a.poll();
    a.setAlone(false);
    a.setAlone(true);
    expect(a.restSnapshot()).toBeNull();                                     // a keepalive request cannot wait for the marker
    deck.log.length = 0;
    expect(await a.compact()).toBe(3);
    expect(deck.log).toEqual(["tail", "format5", "tail", "compact:5", "compact:5"]);
    expect(deck.snap.format).toBe(5); expect(deck.snap.doc.preset!.tables[0].cellGrid).toEqual({ A1: { o: true } });
  });
  it("a failed bump is retried as a failed append is; nothing is appended before it succeeds", async () => {
    vi.useFakeTimers();
    const { deck } = await plainDeck();
    const base = deck.api();
    let fail = 1;
    const api: DeckApi = { ...base, format5: async k => { if (fail-- > 0) throw new Error("the share is unavailable"); return base.format5(k); } };
    const b = v5user(deck, "bea", api);
    deck.log.length = 0;
    b.apply([chart]); await b.flush();
    expect(b.state).toBe("error"); expect(deck.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(b.state).toBe("saved"); expect(deck.log).toEqual(["format5", "tail", "compact:5", "append"]);
    b.dispose();
  });
});

describe("DocSync v4: format 6 for 4.9 objects (ADR-019 amendment of 2026-10-22, AUDIT-3 COMPAT-1)", () => {
  const preset = { op: "preset.set", preset: { sheets: ["S"], slides: [{ id: "s1", type: "content", title: "T", tables: ["t1"] }], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:B2" }],
    versions: [{ id: "v1", name: "All", hide: {} }] } } as unknown as Op;
  const chart = { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "shape", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } } } as Op;
  const drop = { op: "version.patch", id: "v1", patch: { drop: { S: ["2:2"] } } } as unknown as Op;
  const hidden = { op: "slide.patch", id: "s1", patch: { hidden: { "t1:r2": true } } } as Op;
  const u = (deck: FakeDeck, who: string, api: DeckApi = deck.api(), o: Record<string, unknown> = {}) =>
    new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false, compactMargin: 0, bumpWaitMs: 0, ...o });
  const waits = (s: DocSync, deck?: FakeDeck) => { const w: number[] = []; (s as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { w.push(ms); deck?.advance(ms); }; return w; };
  /** a format-5 deck (a 4.6 object in it), as 4.6–4.8 read it */
  async function deck5() {
    const deck = new FakeDeck(), a = u(deck, "anna");
    a.apply([preset]); await a.flush();
    a.apply([chart]); await a.flush();
    expect(deck.snap.format).toBe(5);
    return { deck, a };
  }
  it("COMPAT-1: a version's deleted rows raise a format-5 deck to 6 first – marker, wait, tail, CAS, then the record above a 4.6–4.8 page's gap preset.set", async () => {
    const { deck, a } = await deck5();
    const old = writer("old48"), base = deck.api();
    // a 4.8 page's wizard Finish in the gap (its helper has not seen incident-format-6.json yet): the preset without drop
    const api: DeckApi = { ...base, format5: async (k, f) => { const r = await base.format5(k, f); if (r.created) deck.doAppend(old, { l: 60, w: old, s: 1, by: "old", ops: [preset] }); return r; } };
    const b = u(deck, "bea", api, { bumpWaitMs: 40 }), w = waits(b, deck);
    deck.log.length = 0;
    b.apply([drop]); await b.flush();
    expect(deck.log).toEqual(["format6", "append" /* the old page's */, "format6", "tail", "compact:6", "append"]);
    expect(w).toEqual([40]);
    expect(deck.snap.format).toBe(6); expect(deck.marker6).not.toBeNull();
    expect(deck.records().find(r => r.w === b.writer)!.l).toBeGreaterThan(60);
    await a.poll(); await b.poll();
    expect(a.view.preset!.versions![0].drop).toEqual({ S: ["2:2"] });          // the old preset.set folds first: drop survives
    expect(b.view).toEqual(a.view);
    expect(await b.compact()).not.toBeNull(); expect(deck.snap.format).toBe(6);  // and stays 6
  });
  it("a slide's hidden rows and a cell's valign / num raise a format-4 deck straight to 6 (one bump, one marker)", async () => {
    for (const op of [hidden, cell("A1", { valign: "top" }), cell("A2", { num: "0.0%" })]) {
      const deck = new FakeDeck(), a = u(deck, "anna");
      a.apply([{ ...preset, preset: { ...(preset as unknown as { preset: object }).preset, versions: undefined } } as unknown as Op]); await a.flush();
      expect(deck.snap.format).toBe(4);
      deck.log.length = 0;
      a.apply([op]); await a.flush();
      expect(deck.log).toEqual(["format6", "tail", "compact:6", "append"]);
      expect(deck.snap.format).toBe(6); expect(deck.marker).toBeNull();
    }
  });
  it("4.6–4.8 objects alone stay format 5; an op 4.8 applies whole raises nothing more", async () => {
    const { deck, a } = await deck5();
    deck.log.length = 0;
    a.apply([cell("A1", { b: true }), { op: "slide.patch", id: "s1", patch: { title: "T2", hide: { glass: true } } } as Op]); await a.flush();
    expect(deck.log).toEqual(["append"]);
    expect(await a.compact()).not.toBeNull(); expect(deck.snap.format).toBe(5); expect(deck.calls.format6).toBe(0);
  });
  it("a format-5 deck whose journal (or snapshot) already holds 4.9 content is raised to 6 when a 4.9 page opens it", async () => {
    const { deck } = await deck5();
    const p = writer("p49");
    deck.doAppend(p, { l: 9, w: p, s: 1, by: "p49", ops: [hidden] });
    const b = u(deck, "bea", deck.api(), { bumpOnOpen: true });
    expect(await b.upgrading).toBe(true);
    expect(deck.snap.format).toBe(6); expect(deck.calls.format6).toBe(1);
  });
  it("review: a 4.9 op that joins the queue during a 4 -> 5 raise raises the deck on to 6 before the record is appended", async () => {
    const deck = new FakeDeck(), a = u(deck, "anna", deck.api(), { bumpWaitMs: 40 });
    a.apply([preset]); await a.flush();
    expect(deck.snap.format).toBe(4);
    let joined = false;
    (a as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { deck.advance(ms); if (!joined) { joined = true; a.apply([drop]); } };
    deck.log.length = 0;
    a.apply([chart]); await a.flush();
    const log = deck.log.join(" ");
    expect(log).toMatch(/^format5 .*compact:5 .*format6 .*compact:6 append$/);
    expect(deck.snap.format).toBe(6); expect(deck.marker6).not.toBeNull();
    const recs = deck.records().filter(r => r.w === a.writer);
    expect(recs.length).toBe(2);                                              // the preset, then chart + drop in one record
    // two raises, two Lamport jumps: 4 -> 5 and 5 -> 6 (a 4.6–4.8 page's gap record must fold before the 4.9 one)
    expect(recs[1].l).toBeGreaterThanOrEqual(recs[0].l + 2 * BUMP_LAMPORT);
    expect(a.state).toBe("saved");
  });
  it("review: two 4.9 writers raising the same deck at once – one compare-and-set loses (409), reloads and goes on; both save; format 6", async () => {
    const { deck } = await deck5();
    // both raises reach the compaction from the same snapshot generation: the second one gets the 409
    const base = deck.api(), gen0 = deck.snap.gen, codes: string[] = [];
    let arrived = 0, release: () => void = () => undefined;
    const both = new Promise<void>(r => { release = r; });
    const api: DeckApi = { ...base, compact: async (k, g, sn) => {
      if (sn.format === 6 && g === gen0) { if (++arrived === 2) release(); await both; }
      try { const r = await base.compact(k, g, sn); codes.push("ok:" + sn.format); return r; }
      catch (e) { codes.push((e as { status?: number }).status + ":" + sn.format); throw e; }
    } };
    const mk = (w: string) => u(deck, w, api, { bumpWaitMs: 40 });
    const a = mk("ann2"), b = mk("bea");
    for (const s of [a, b]) (s as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { await new Promise(r => setTimeout(r, 1)); deck.advance(ms); };
    a.apply([drop]); b.apply([hidden]);
    await Promise.all([a.flush(), b.flush()]);
    expect(deck.snap.format).toBe(6);
    expect([a.state, b.state]).toEqual(["saved", "saved"]);
    await a.poll(); await b.poll();
    expect(a.view.preset!.versions![0].drop).toEqual({ S: ["2:2"] });
    expect(a.view.preset!.slides[0].hidden).toEqual({ "t1:r2": true });
    expect(b.view).toEqual(a.view);
    expect(codes).toEqual(["ok:6", "409:6"]);                                 // a real collision, the loser carried on
  });
  it("never lowered: the helper refuses a format-5 snapshot on a format-6 deck", async () => {
    const { deck, a } = await deck5();
    a.apply([drop]); await a.flush();
    expect(() => deck.doCompact(deck.snap.gen, { ...deck.snap, gen: deck.snap.gen + 1, format: 5 })).toThrow(/4.6 objects/);
  });
});

describe("DocSync v4: format 7 for 4.10 chart marks (ADR-019 amendment for B52)", () => {
  const preset = { op: "preset.set", preset: { sheets: ["S"], slides: [{ id: "s1", type: "content", title: "T", tables: ["t1"] }], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:B2" }],
    versions: [{ id: "v1", name: "All", hide: {} }] } } as unknown as Op;
  const chart = { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "chart", type: "line", values: { sheet: "S", range: "B1:B2" }, box: { x: 0, y: 0, w: 10, h: 10 },
    sers: { s1: { n: 1, vals: [{ sheet: "S", range: "B1:B2" }] } } } } as unknown as Op;
  const ref = { op: "item.patch", slide: "s1", id: "c1", patch: { marks: { r1: { kind: "ref", value: { sheet: "S", range: "C1" }, name: "Budget" } } } } as unknown as Op;
  const pills = { op: "item.patch", slide: "s1", id: "c1", patch: { marks: { p1: { kind: "change", a: { s: "s1", i: -1 } } } } } as unknown as Op;
  const drop = { op: "version.patch", id: "v1", patch: { drop: { S: ["2:2"] } } } as unknown as Op;
  const u = (deck: FakeDeck, who: string, api: DeckApi = deck.api(), o: Record<string, unknown> = {}) =>
    new DocSync(api, "W.xlsx", deck.open(writer(who)), who, { autoTail: false, compactMargin: 0, bumpWaitMs: 0, ...o });
  const waits = (s: DocSync, deck?: FakeDeck) => { const w: number[] = []; (s as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { w.push(ms); deck?.advance(ms); }; return w; };
  /** a format-6 deck with a chart (as 4.9 reads it) */
  async function deck6() {
    const deck = new FakeDeck(), a = u(deck, "anna");
    a.apply([preset]); await a.flush();
    a.apply([chart, drop]); await a.flush();
    expect(deck.snap.format).toBe(6);
    return { deck, a };
  }
  it("B52: a reference line raises a format-6 deck to 7 first – marker, wait, tail, CAS, then the record above a 4.9 page's gap record", async () => {
    const { deck, a } = await deck6();
    const old = writer("old49"), base = deck.api(), L = Math.max(...deck.records().map(r => r.l)) + 1;
    // a 4.9 page's edit in the gap (its helper has not seen incident-format-7.json yet): the chart's title
    const api: DeckApi = { ...base, format5: async (k, f) => { const r = await base.format5(k, f); if (r.created) deck.doAppend(old, { l: L, w: old, s: 1, by: "old", ops: [{ op: "item.patch", slide: "s1", id: "c1", patch: { title: "Old" } } as unknown as Op] }); return r; } };
    const b = u(deck, "bea", api, { bumpWaitMs: 40 }), w = waits(b, deck), f6 = deck.calls.format6;
    deck.log.length = 0;
    b.apply([ref]); await b.flush();
    expect(deck.log).toEqual(["format7", "append" /* the old page's */, "format7", "tail", "compact:7", "append"]);
    expect(w).toEqual([40]);
    expect(deck.snap.format).toBe(7); expect(deck.marker7).not.toBeNull(); expect(deck.calls.format6).toBe(f6);
    // the Lamport jump: the 4.10 record folds after the old page's gap record
    expect(deck.records().find(r => r.w === b.writer)!.l).toBeGreaterThan(L + BUMP_LAMPORT - 1);
    await a.poll(); await b.poll();
    const c = a.view.preset!.slides[0].items!.c1 as { title?: string; marks?: Record<string, { kind: string }> };
    expect(c.title).toBe("Old"); expect(c.marks!.r1.kind).toBe("ref");
    expect(b.view).toEqual(a.view);
    expect(await b.compact()).not.toBeNull(); expect(deck.snap.format).toBe(7);  // and stays 7
  });
  it("a format-4 deck goes straight to 7 (one bump, one marker); a removed mark (null) raises nothing", async () => {
    const deck = new FakeDeck(), a = u(deck, "anna");
    a.apply([{ ...preset, preset: { ...(preset as unknown as { preset: object }).preset, versions: undefined } } as unknown as Op]); await a.flush();
    expect(deck.snap.format).toBe(4);
    deck.log.length = 0;
    a.apply([{ ...chart, patch: { ...(chart as unknown as { patch: object }).patch, marks: { p1: { kind: "change", a: { s: "s1", i: -1 } } } } } as unknown as Op]); await a.flush();
    expect(deck.log).toEqual(["format7", "tail", "compact:7", "append"]);
    expect(deck.snap.format).toBe(7); expect(deck.marker).toBeNull(); expect(deck.marker6).toBeNull();
    const d2 = (await deck6()).deck, b = u(d2, "bea");
    d2.log.length = 0;
    b.apply([{ op: "item.patch", slide: "s1", id: "c1", patch: { marks: { r1: null } } } as unknown as Op, { op: "item.patch", slide: "s1", id: "c1", patch: { marks: { m1: { kind: "arrow", a: { s: "s1", i: 0 } } } } } as unknown as Op]);
    await b.flush();
    expect(d2.log).toEqual(["append"]); expect(d2.snap.format).toBe(6);
  });
  it("re-check: a 4.10 op that joins the queue during a raise to 6 raises the deck on to 7 before the record is appended (two Lamport jumps)", async () => {
    const deck = new FakeDeck(), a = u(deck, "anna", deck.api(), { bumpWaitMs: 40 });
    a.apply([preset]); await a.flush();
    a.apply([chart]); await a.flush();
    expect(deck.snap.format).toBe(5);
    let joined = false;
    (a as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { deck.advance(ms); if (!joined) { joined = true; a.apply([pills]); } };
    deck.log.length = 0;
    a.apply([drop]); await a.flush();
    expect(deck.log.join(" ")).toMatch(/^format6 .*compact:6 .*format7 .*compact:7 append$/);
    expect(deck.snap.format).toBe(7); expect(deck.marker7).not.toBeNull();
    const recs = deck.records().filter(r => r.w === a.writer);
    expect(recs[recs.length - 1].ops.length).toBe(2);                         // drop + pills in one record
    expect(recs[recs.length - 1].l).toBeGreaterThanOrEqual(recs[recs.length - 2].l + 2 * BUMP_LAMPORT);
    expect(a.state).toBe("saved");
  });
  it("a page that sees the deck go 6 -> 7 jumps its Lamport time; one opening a format-6 deck whose journal holds a 4.10 mark raises it", async () => {
    const { deck, a } = await deck6();
    const p = writer("p410");
    deck.doAppend(p, { l: 9, w: p, s: 1, by: "p410", ops: [ref] });
    const b = u(deck, "bea", deck.api(), { bumpOnOpen: true });
    expect(await b.upgrading).toBe(true);
    expect(deck.snap.format).toBe(7); expect(deck.calls.format7).toBe(1);
    const before = (a as unknown as { lamport: number }).lamport;
    await a.poll();                                                           // a 4.10 page that did not raise it
    expect((a as unknown as { lamport: number }).lamport).toBeGreaterThanOrEqual(before + BUMP_LAMPORT);
  });
  it("two 4.10 writers raising the same deck at once – one compare-and-set loses (409), reloads and goes on; both save; format 7", async () => {
    const { deck } = await deck6();
    const base = deck.api(), gen0 = deck.snap.gen, codes: string[] = [];
    let arrived = 0, release: () => void = () => undefined;
    const both = new Promise<void>(r => { release = r; });
    const api: DeckApi = { ...base, compact: async (k, g, sn) => {
      if (sn.format === 7 && g === gen0) { if (++arrived === 2) release(); await both; }
      try { const r = await base.compact(k, g, sn); codes.push("ok:" + sn.format); return r; }
      catch (e) { codes.push((e as { status?: number }).status + ":" + sn.format); throw e; }
    } };
    const mk = (w: string) => u(deck, w, api, { bumpWaitMs: 40 });
    const a = mk("ann2"), b = mk("bea");
    for (const s of [a, b]) (s as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async ms => { await new Promise(r => setTimeout(r, 1)); deck.advance(ms); };
    a.apply([ref]); b.apply([pills]);
    await Promise.all([a.flush(), b.flush()]);
    expect(deck.snap.format).toBe(7);
    expect([a.state, b.state]).toEqual(["saved", "saved"]);
    await a.poll(); await b.poll();
    expect(Object.keys((a.view.preset!.slides[0].items!.c1 as { marks: object }).marks).sort()).toEqual(["p1", "r1"]);
    expect(b.view).toEqual(a.view);
    expect(codes).toEqual(["ok:7", "409:7"]);
  });
  it("never lowered: the helper refuses a format-6 snapshot on a format-7 deck", async () => {
    const { deck, a } = await deck6();
    a.apply([ref]); await a.flush();
    expect(deck.snap.format).toBe(7);
    expect(() => deck.doCompact(deck.snap.gen, { ...deck.snap, gen: deck.snap.gen + 1, format: 6 })).toThrow(/objects/);
  });
});
