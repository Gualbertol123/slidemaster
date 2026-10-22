/* Property test of storage v4 (PLAN S5.2): 2–5 writers on one deck, every helper call delivered in a random order,
   appends that fail before, during (torn) or after the write (flush failed, answer lost), compactions at random
   moments that race each other. For 1 000 seeds: once the network is quiet every replica has the same document
   (invariant 2) and every edit is in it – nothing acknowledged is lost (invariant 1), nothing applied twice
   (rev counts each record once, invariant 4), and the snapshot's gen only goes up (invariant 3). Since 4.3 the writers
   also patch fields of one chart (`item.patch`, 07 §2.2): each writer's own slice colour ends as it last set it. Since
   4.6 they also add slides after any slide and tables to one slide, and remove their own (09 §2.8, S13.3): each is
   there once, or gone. They also remove another writer's slide while others edit it (the edit may be lost) and some
   undo that Delete slide by appending its inverse (review of S13.3, 8): such a slide is there at most once. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocSync, type DeckApi } from "../src/sync/docsync";
import type { Op } from "../src/model/types";
import { emptyDoc } from "../src/model/ops";
import { FakeDeck, type AppendFailure } from "./fakedeck";

afterEach(() => { vi.useRealTimers(); });

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

/** a network that holds every call until the test delivers it */
class Net {
  queue: (() => void)[] = [];
  constructor(private rand: () => number, private deck: FakeDeck, public failRate: number, public unreadableRate = 0.1) {}
  private hold<T>(exec: () => T): Promise<T> {
    return new Promise<T>((ok, bad) => this.queue.push(() => { try { ok(exec()); } catch (e) { bad(e); } }));
  }
  api(): DeckApi {
    const d = this.deck, failures: AppendFailure[] = ["before", "torn", "flush", "lost"];
    return {
      served: true,
      snapshot: () => this.hold(() => JSON.parse(JSON.stringify(d.snap))),
      tail: (_k, since) => this.hold(() => {
        const t = d.doTail({ ...since }), names = Object.keys(t.journals);
        if (names.length && this.rand() < this.unreadableRate) {          // a journal unreadable this time (04 §2.4)
          const j = names[Math.floor(this.rand() * names.length)]; delete t.journals[j]; (t.skipped ||= []).push(j);
        }
        return t;
      }),
      append: (_k, w, r) => this.hold(() => d.doAppend(w, JSON.parse(JSON.stringify(r)), this.rand() < this.failRate ? failures[Math.floor(this.rand() * 4)] : undefined)),
      compact: (_k, g, s) => this.hold(() => d.doCompact(g, JSON.parse(JSON.stringify(s)))),
      rotate: (_k, w) => this.hold(() => d.doRotate(w)),
      format5: (_k, f) => this.hold(() => d.doFormat5(f)),
    };
  }
  deliverOne() {
    if (!this.queue.length) return false;
    const i = Math.floor(this.rand() * this.queue.length);
    this.queue.splice(i, 1)[0]();
    return true;
  }
}

export async function run(seed: number) {
  const doc0 = { ...emptyDoc("W.xlsx"), preset: { sheets: ["S"], tables: [], slides: [{ id: "s1", type: "content" as const, tables: [],
    items: { c1: { kind: "chart" as const, type: "pie" as const, values: { sheet: "S", range: "B2:B6" }, box: { x: 10, y: 10, w: 300, h: 200 } } } }] } };
  const rand = rng(seed), deck = new FakeDeck(undefined, undefined, doc0), net = new Net(rand, deck, 0.15);
  deck.listingLag = 3000;                         // a new journal is missing from listings for 3 s of the server's clock
  const writers = 2 + Math.floor(rand() * 4);
  const reps = Array.from({ length: writers }, (_, i) => new DocSync(net.api(), "W.xlsx", deck.open(`u${i}@pc#${"abcdefgh".slice(i) + "a".repeat(i)}`), "u" + i, { autoTail: false, compactMargin: 5000, bumpWaitMs: 0 }));
  const made: [string, string][] = [];
  /** the slice colour each writer last gave the chart (field-level merge: nobody else writes that slice) */
  const colours = new Map<number, string>();
  /** contended cells: the value each edit replaced, as its author saw it (that value must never win afterwards) */
  const overwrote: [string, string][] = [];
  const gens: number[] = [deck.snap.gen];
  /** slides (n…) and tables on s1 (t…) each writer added (true) or removed again (false); "undone": a slide whose
      removal by another writer was undone – back or gone, as the Lamport order of the removes and the undo has it */
  const added = new Map<string, boolean | "undone">();
  /** per writer: the inverse of its last Delete of another writer's slide, not yet undone */
  const undo = new Map<DocSync, { id: string; inv: Op[] }>();
  let crossRemoves = 0, undos = 0;
  const mark = (id: string, on: boolean) => { if (added.get(id) !== "undone") added.set(id, on); };
  let n = 0;
  const steps = 60 + Math.floor(rand() * 80);
  for (let k = 0; k < steps; k++) {
    const r = reps[Math.floor(rand() * writers)], x = rand();
    if (x < 0.35) {
      const ref = String.fromCharCode(65 + reps.indexOf(r)) + (++n), text = `u${reps.indexOf(r)}-${n}`;
      const ops: Op[] = [{ op: "cell.patch", sheet: "S", ref, patch: { text } } as Op];
      if (rand() < 0.3) {                                                // a contended cell
        const z = "Z" + (1 + Math.floor(rand() * 3)), seen = (r.view.edits.S?.[z] as { text?: string } | undefined)?.text;
        if (seen) overwrote.push([z, seen]);
        ops.push({ op: "cell.patch", sheet: "S", ref: z, patch: { text } } as Op);
      }
      if (rand() < 0.25) {                                               // a field of the shared chart
        const w = reps.indexOf(r), c = "#" + (n % 0xffffff).toString(16).padStart(6, "0");
        ops.push({ op: "item.patch", slide: "s1", id: "c1", patch: { colors: { [w]: c } } } as Op); colours.set(w, c);
      }
      if (rand() < 0.2) {                                                // a slide or a table added or removed (09 §2.8, S13.3)
        const w = reps.indexOf(r), slides = r.view.preset!.slides, y = rand();
        const mine = slides.filter(s => s.id.startsWith(`n${w}x`)), tabs = slides.find(s => s.id === "s1")!.tables.filter(t => t.startsWith(`t${w}x`));
        if (y < 0.4 || (y < 0.55 && !mine.length)) {                     // after any slide (another writer's too), or first
          const id = `n${w}x${n}`, after = rand() < 0.2 ? null : slides[Math.floor(rand() * slides.length)].id;
          ops.push({ op: "slide.add", slide: { id, type: "content", title: text, tables: [] }, after } as Op); added.set(id, true);
        } else if (y < 0.55) {                                           // only the writer's own (so its add came first)
          const id = mine[Math.floor(rand() * mine.length)].id;
          ops.push({ op: "slide.remove", id } as Op); mark(id, false);
        } else if (y < 0.85 || !tabs.length) {
          const id = `t${w}x${n}`;
          ops.push({ op: "table.add", table: { id, sheet: "S", kind: "range", range: "A1:B" + n }, slide: "s1", at: Math.floor(rand() * 3) } as Op); added.set(id, true);
        } else {
          const id = tabs[Math.floor(rand() * tabs.length)];
          ops.push({ op: "table.remove", id, slide: "s1" } as Op); added.set(id, false);
        }
      }
      if (rand() < 0.25) {                                               // another writer's slide: edited, or removed (its own undo step)
        const w = reps.indexOf(r), theirs = r.view.preset!.slides.filter(s => /^n\d+x/.test(s.id) && !s.id.startsWith(`n${w}x`));
        const pick = theirs[Math.floor(rand() * theirs.length)];
        if (pick && rand() < 0.5) ops.push({ op: "slide.patch", id: pick.id, patch: { subtitle: text } } as Op);
        else if (pick) { const inv = r.apply([{ op: "slide.remove", id: pick.id } as Op]); if (inv?.length) { undo.set(r, { id: pick.id, inv }); mark(pick.id, false); crossRemoves++; } }
      }
      const u = undo.get(r);
      if (u && rand() < 0.2) { undo.delete(r); r.apply(u.inv); added.set(u.id, "undone"); undos++; }   // Undo of that Delete slide
      r.apply(ops); made.push([ref, text]);
    } else if (x < 0.5) void r.flush();
    else if (x < 0.65) void r.poll();
    else if (x < 0.7) void r.compact().catch(() => undefined);
    else net.deliverOne();
    await settle();
    if (deck.snap.gen !== gens[gens.length - 1]) gens.push(deck.snap.gen);
  }
  // the network calms down: nothing fails any more, everything queued is saved and read
  net.failRate = 0; net.unreadableRate = 0;
  for (let round = 0; round < 400; round++) {
    while (net.deliverOne()) await settle();
    (deck as unknown as { clock: number }).clock += 1000;                // time passes: new journals reach every listing
    if (round % 3 === 0) for (const r of reps) void r.flush();
    for (const r of reps) void r.poll();
    await settle();
    if (deck.snap.gen !== gens[gens.length - 1]) gens.push(deck.snap.gen);
    if (round > 4 && !net.queue.length && reps.every(r => !r.busy)) break;
  }
  for (let i = 0; i < 3; i++) { for (const r of reps) void r.poll(); await settle(); while (net.deliverOne()) await settle(); }
  return { reps, made, gens, deck, overwrote, colours, added, crossRemoves, undos };
}

describe("storage v4 converges (property test, 1 000 seeds)", () => {
  it("every replica ends with the same document, every edit in it, each record once, gen only going up", async () => {
    vi.useFakeTimers();                          // retries and debounces wait for the test (it delivers and flushes)
    let compactions = 0, duplicates = 0, structure = 0, crossRemoved = 0, undone = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const { reps, made, gens, deck, overwrote, colours, added, crossRemoves, undos } = await run(seed);
      crossRemoved += crossRemoves; undone += undos;
      const ctx = `seed ${seed}`;
      for (const r of reps) expect(r.busy, ctx).toBe(false);
      const docs = reps.map(r => JSON.stringify(r.server));
      expect(new Set(docs).size, ctx).toBe(1);
      const doc = reps[0].server;
      for (const [ref, text] of made) expect(doc.edits.S?.[ref]?.text, `${ctx} ${ref}`).toBe(text);
      // B4: a value somebody knowingly replaced never comes back over the replacement (Lamport order across a compaction)
      const chart = doc.preset!.slides.find(s => s.id === "s1")!.items!.c1 as { colors?: Record<string, string>; box: unknown };
      for (const [w, c] of colours) expect(chart.colors?.[w], `${ctx} colour ${w}`).toBe(c);
      expect(chart.box, ctx).toEqual({ x: 10, y: 10, w: 300, h: 200 });
      // S13.3: each slide or table added is there once, each removed by its writer is gone; a removed table's def stays
      const s1 = doc.preset!.slides.find(s => s.id === "s1")!;
      for (const [id, on] of added) {
        const count = id.startsWith("n") ? doc.preset!.slides.filter(s => s.id === id).length : s1.tables.filter(t => t === id).length;
        if (on === "undone") expect(count, `${ctx} ${id}`).toBeLessThanOrEqual(1); else expect(count, `${ctx} ${id}`).toBe(on ? 1 : 0);
        if (id.startsWith("t")) expect(doc.preset!.tables.some(t => t.id === id), `${ctx} def ${id}`).toBe(true);
        structure++;
      }
      for (const [z, old] of overwrote) expect(doc.edits.S?.[z]?.text, `${ctx} ${z}`).not.toBe(old);
      const records = deck.written.filter(r => r.ops.length);      // (also those in journals deleted since)
      const distinct = new Set(records.map(r => r.w + ":" + r.s));
      expect(doc.rev, ctx).toBe(distinct.size);
      duplicates += records.length - distinct.size;
      expect(gens, ctx).toEqual([...gens].sort((a, b) => a - b));
      compactions += gens.length - 1;
      for (const r of reps) r.dispose();
    }
    // the runs did exercise what they are about
    expect(compactions).toBeGreaterThan(500);
    expect(duplicates).toBeGreaterThan(100);
    expect(structure).toBeGreaterThan(1000);
    expect(crossRemoved, `${crossRemoved} cross removes, ${undone} undone`).toBeGreaterThan(200);
    expect(undone, `${crossRemoved} cross removes, ${undone} undone`).toBeGreaterThan(50);
  }, 600_000);
});
