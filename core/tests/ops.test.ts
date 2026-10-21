import { describe, expect, it } from "vitest";
import vectors from "../../shared/ops-vectors.json";
import { applyOps, inverseOf, applyOp, knownOp, needsV5, docNeedsV5 } from "../src/model/ops";
import { fold, nextSnapshot } from "../src/model/fold";
import type { Op } from "../src/model/types";

describe("operations follow shared/ops-vectors.json", () => {
  for (const v of (vectors as any[]).filter(x => !x.fold)) {
    it(v.name, () => {
      const { doc, applied, skipped } = applyOps(v.doc, v.ops);
      expect(doc.preset).toEqual(v.expect.preset);
      expect(doc.style).toEqual(v.expect.style);
      expect(doc.edits).toEqual(v.expect.edits);
      expect(applied).toBe(v.expect.applied);
      expect(skipped).toEqual(v.expect.skipped);
    });
  }
});

describe("folding records follows shared/ops-vectors.json (Lamport order, copies once, the snapshot's seen)", () => {
  for (const v of (vectors as any[]).filter(x => x.fold)) {
    it(v.name, () => {
      const f = fold(v.fold.snapshot, v.fold.records);
      expect(f.doc.edits).toEqual(v.expect.edits);
      expect(f.doc.rev).toBe(v.expect.rev);
      expect(f.lamport).toBe(v.expect.lamport);
      if ("updatedBy" in v.expect) expect(f.doc.updatedBy).toBe(v.expect.updatedBy);
      if ("updated" in v.expect) expect(f.doc.updated).toBe(v.expect.updated);
      if ("log" in v.expect) expect(f.doc.log).toEqual(v.expect.log);
      if ("preset" in v.expect) expect(f.doc.preset).toEqual(v.expect.preset);
      // the order the records arrive in never matters
      expect(fold(v.fold.snapshot, [...v.fold.records].reverse()).doc).toEqual(f.doc);
    });
  }
});

describe("inverse operations", () => {
  const base = () => ({ preset: { sheets: [], tables: [], slides: [{ id: "s1", type: "content" as const, title: "T", tables: [] }] }, style: { design: "glass" as const, pn: { on: true } }, edits: { S: { A1: { b: true } } } });
  const cases: Op[] = [
    { op: "cell.patch", sheet: "S", ref: "A1", patch: { b: false, text: "x", orig: "y" } },
    { op: "cell.patch", sheet: "S", ref: "B2", patch: { fill: "#fff" } },
    { op: "slide.patch", id: "s1", patch: { title: "New", logo: false } },
    { op: "style.patch", patch: { design: "excel", pn: { on: false, size: 20 } } },
    { op: "preset.set", preset: null },
  ];
  for (const op of cases) it(op.op + " round-trips", () => {
    const d = base(); const inv = inverseOf(d, op)!;
    applyOp(d, op); applyOp(d, inv);
    expect(d).toEqual(base());
  });
  it("undo of my edit keeps another user's later edit", () => {
    const d: any = base(); const mine: Op = { op: "cell.patch", sheet: "S", ref: "A1", patch: { sz: 20 } };
    const inv = inverseOf(d, mine)!; applyOp(d, mine);
    applyOp(d, { op: "cell.patch", sheet: "S", ref: "C3", patch: { b: true } });   // someone else
    applyOp(d, inv);
    expect(d.edits.S).toEqual({ A1: { b: true }, C3: { b: true } });
  });
});

describe("inverse of map merges", () => {
  const base = () => ({ preset: { sheets: [], tables: [{ id: "t", sheet: "S", kind: "range" as const, range: "A1:B2", cols: { "2": 80 } }], slides: [{ id: "s", type: "content" as const, tables: ["t"], notes: { "t:top": { text: "A" } } }] }, style: { radius: 100 }, edits: {} });
  const cases: Op[] = [
    { op: "table.patch", id: "t", patch: { cols: { "2": 120, "3": 50 }, name: "X" } },
    { op: "table.patch", id: "t", patch: { cols: null } },
    { op: "table.patch", id: "t", patch: { cellGrid: { C3: { h: "on", c: "#C00000", w: 2 }, C4: { o: true } } } },
    { op: "table.patch", id: "t", patch: { borders: { C3: { bottom: { style: "medium", color: "#C00000" }, top: "none" } } } },
    { op: "slide.patch", id: "s", patch: { notes: { "t:top": null, "t:left": { text: "L" } }, align: "left", scale: .7 } },
    { op: "style.patch", patch: { radius: 40, contrast: 80, logoBubble: false } },
  ];
  for (const op of cases) it(op.op + " " + JSON.stringify((op as any).patch).slice(0, 40) + " round-trips", () => {
    const d: any = base(); const inv = inverseOf(d, op)!;
    applyOp(d, op); applyOp(d, inv);
    expect(d).toEqual(base());
  });
});

describe("inverse of a free layout switch (07 §5.1, B18: one undo step each way)", () => {
  const boxes = { "t:t": { x: 50, y: 120, w: 600, h: 300, scale: 1.25 }, "n:t:top": { x: 50, y: 60, w: 600, h: 44 } };
  const base = (free?: object) => ({ preset: { sheets: [], tables: [], slides: [{ id: "s", type: "content" as const, tables: ["t"], ...(free ? { free } : {}) }] }, style: {}, edits: {} });
  const cases: [string, object | undefined, Op][] = [
    ["on (no free layout before)", undefined, { op: "slide.patch", id: "s", patch: { free: { glass: { on: true, items: boxes } } } } as Op],
    ["off (the boxes kept)", { glass: { on: true, items: boxes } }, { op: "slide.patch", id: "s", patch: { free: { glass: { on: false, items: boxes } } } } as Op],
    ["on again, beside another design's", { glass: { on: false, items: boxes }, excel: { on: true, items: {} } }, { op: "slide.patch", id: "s", patch: { free: { glass: { on: true, items: boxes } } } } as Op],
    ["a move (the design's whole entry)", { glass: { on: true, items: boxes } }, { op: "slide.patch", id: "s", patch: { free: { glass: { on: true, items: { ...boxes, "t:t": { ...boxes["t:t"], x: 90 } } } } } } as Op],
  ];
  for (const [name, free, op] of cases) it(name + " round-trips", () => {
    const d: any = base(free); const inv = inverseOf(d, op)!;
    expect(applyOp(d, op)).toBe(true); expect(applyOp(d, inv)).toBe(true);
    expect(d).toEqual(base(free));
  });
});

describe("map merges keep a \"__proto__\" entry of a shared document out (it would set the map's prototype)", () => {
  it("slide.patch free from JSON with a __proto__ key: no own key, the map's prototype untouched", () => {
    const d: any = { preset: { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [] }] }, style: {}, edits: {} };
    const op = JSON.parse('{"op":"slide.patch","id":"s","patch":{"free":{"__proto__":{"on":true,"items":{}},"glass":{"on":true,"items":{}}}}}');
    expect(applyOp(d, op)).toBe(true);
    const free = d.preset.slides[0].free;
    expect(Object.getPrototypeOf(free)).toBe(Object.prototype);
    expect(Object.keys(free)).toEqual(["glass"]);
    expect((free as { on?: unknown }).on).toBeUndefined();
  });
});

describe("inverse of item.patch (07 §2.2: undo of a chart or callout change)", () => {
  const pie = { kind: "chart", type: "pie", values: { sheet: "S", range: "C5:C9" }, box: { x: 1, y: 2, w: 300, h: 200 }, colors: { 0: "#111111" }, fmt: { size: 14 } };
  const base = () => ({ preset: { sheets: [], tables: [], slides: [{ id: "s", type: "content" as const, tables: [], items: { c1: pie } as any }] }, style: {}, edits: {} });
  const cases: Op[] = [
    { op: "item.patch", slide: "s", id: "k2", patch: { kind: "shape", shape: "round", box: { x: 0, y: 0, w: 10, h: 10 }, text: "{S!C7}" } },
    { op: "item.patch", slide: "s", id: "c1", patch: null },
    { op: "item.patch", slide: "s", id: "c1", patch: { type: "donut", title: "T", box: { x: 9, y: 9, w: 50, h: 50 } } },
    { op: "item.patch", slide: "s", id: "c1", patch: { colors: { 0: null, 3: "#333333" }, fmt: { b: true, size: null } } },
    { op: "item.patch", slide: "s", id: "c1", patch: { colors: null, fmt: null, legend: "none" } },
  ];
  for (const op of cases) it(JSON.stringify((op as any).patch).slice(0, 50) + " round-trips", () => {
    const d: any = base(); const inv = inverseOf(d, op)!;
    expect(applyOp(d, op)).toBe(true); expect(applyOp(d, inv)).toBe(true);
    expect(d).toEqual(base());
  });
  it("a skipped patch has no inverse; undo of my move keeps another user's recolour", () => {
    expect(inverseOf(base(), { op: "item.patch", slide: "s", id: "zz", patch: { title: "x" } } as Op)).toBeNull();
    expect(inverseOf(base(), { op: "item.patch", slide: "nope", id: "c1", patch: null } as Op)).toBeNull();
    const d: any = base(), mine: Op = { op: "item.patch", slide: "s", id: "c1", patch: { box: { x: 500, y: 2, w: 300, h: 200 } } };
    const inv = inverseOf(d, mine)!; applyOp(d, mine);
    applyOp(d, { op: "item.patch", slide: "s", id: "c1", patch: { colors: { 1: "#222222" } } });   // someone else
    applyOp(d, inv);
    expect(d.preset.slides[0].items.c1).toEqual({ ...pie, colors: { 0: "#111111", 1: "#222222" } });
  });
});

describe("inverse of slide.add / slide.remove, table.add / table.remove (S13.3, 09 §2.8: New slide, Add table, one undo step)", () => {
  const T1 = { id: "t1", sheet: "S", kind: "range" as const, range: "A1:C6" }, T2 = { id: "t2", sheet: "S", kind: "markers" as const, anchor: "E1", index: 0 };
  const base = () => ({ preset: { sheets: ["S"], tables: [T1, T2], slides: [
    { id: "s0", type: "cover" as const, title: "Review", tables: [] },
    { id: "s1", type: "content" as const, title: "Loans", tables: ["t1", "t2"], notes: { "t2:top": { text: "N" } }, items: { k1: { kind: "shape", shape: "rect", box: { x: 0, y: 0, w: 9, h: 9 } } } as any },
    { id: "s2", type: "content" as const, tables: [] }] }, style: {}, edits: {} });
  const T3 = { id: "t3", sheet: "S", kind: "range" as const, range: "H1:I4" };
  const cases: [string, Op][] = [
    ["slide.add after a slide", { op: "slide.add", slide: { id: "n1", type: "content", title: "New slide", tables: [] }, after: "s1" }],
    ["slide.add first", { op: "slide.add", slide: { id: "n1", type: "content", tables: [] }, after: null }],
    ["slide.remove of a slide with tables, notes and items", { op: "slide.remove", id: "s1" }],
    ["slide.remove of the first slide", { op: "slide.remove", id: "s0" }],
    ["slide.remove of the last slide", { op: "slide.remove", id: "s2" }],
    ["table.add of a mapped table", { op: "table.add", table: T1, slide: "s2" }],
    ["table.remove of the first table", { op: "table.remove", id: "t1", slide: "s1" }],
    ["table.remove of the last table", { op: "table.remove", id: "t2", slide: "s1" }],
  ];
  for (const [name, op] of cases) it(name + " round-trips", () => {
    const d: any = base(); const inv = inverseOf(d, op)!;
    expect(inv).not.toBeNull();
    expect(applyOp(d, op)).toBe(true); expect(applyOp(d, inv)).toBe(true);
    expect(d).toEqual(base());
  });
  it("the inverses: slide.remove ↔ slide.add with the slide's definition and its previous neighbour; table.remove ↔ table.add with its index", () => {
    expect(inverseOf(base(), { op: "slide.add", slide: { id: "n1", type: "content", tables: [] }, after: "s1" })).toEqual({ op: "slide.remove", id: "n1" });
    expect(inverseOf(base(), { op: "slide.remove", id: "s2" })).toEqual({ op: "slide.add", slide: base().preset.slides[2], after: "s1" });
    expect(inverseOf(base(), { op: "slide.remove", id: "s0" })).toEqual({ op: "slide.add", slide: base().preset.slides[0], after: null });
    expect(inverseOf(base(), { op: "table.add", table: T3, slide: "s1", at: 1 })).toEqual({ op: "table.remove", id: "t3", slide: "s1" });
    expect(inverseOf(base(), { op: "table.remove", id: "t2", slide: "s1" })).toEqual({ op: "table.add", table: T2, slide: "s1", at: 1 });
  });
  it("undo of table.add of a new table: off the slide, the definition stays in preset.tables (09 §2.8)", () => {
    const d: any = base(), op: Op = { op: "table.add", table: T3, slide: "s1", at: 0 }, inv = inverseOf(d, op)!;
    applyOp(d, op); expect(d.preset.slides[1].tables).toEqual(["t3", "t1", "t2"]);
    applyOp(d, inv);
    expect(d.preset.slides).toEqual(base().preset.slides);
    expect(d.preset.tables).toEqual([T1, T2, T3]);
  });
  // review of S13.3, 4: a table.remove of an id on the slide whose definition is missing from preset.tables applies (the
  // id comes off the slide) but has no inverse – there is no definition to add back – so it drops out of its undo step.
  // Nothing visible is lost: the slide only referenced a table that does not exist. Left as is (not in the list below,
  // which holds ops that are skipped too)
  it("table.remove of a table with no definition applies but has no inverse (nothing visible is lost)", () => {
    const d: any = base(); d.preset.slides[1].tables.push("t9");
    const op: Op = { op: "table.remove", id: "t9", slide: "s1" };
    expect(inverseOf(d, op)).toBeNull();
    expect(applyOp(d, op)).toBe(true); expect(d.preset.slides[1].tables).toEqual(["t1", "t2"]);
  });
  it("an op that would be skipped has no inverse", () => {
    const none: Op[] = [
      { op: "slide.add", slide: { id: "s1", type: "content", tables: [] }, after: null },          // the id exists
      { op: "slide.add", slide: { id: "n1", type: "section" as any, tables: [] }, after: null },    // a later page's type
      { op: "slide.remove", id: "nope" },
      { op: "table.add", table: T1, slide: "s1" },                                                 // on the slide already
      { op: "table.add", table: T3, slide: "nope" },
      { op: "table.remove", id: "t1", slide: "s2" }, { op: "table.remove", id: "t1", slide: "nope" },
      // review of S13.3, 5: a definition without the fields its kind needs; a table id twice on an added slide
      { op: "table.add", table: { id: "t4", sheet: "S", kind: "range" } as any, slide: "s2" },
      { op: "table.add", table: { id: "t4", sheet: "S", kind: "markers", anchor: "E1" } as any, slide: "s2" },
      { op: "slide.add", slide: { id: "n1", type: "content", tables: ["t1", "t1"] }, after: null },
    ];
    for (const op of none) { expect(inverseOf(base(), op), JSON.stringify(op)).toBeNull(); expect(applyOp(base(), op), JSON.stringify(op)).toBe(false); }
    expect(inverseOf({ preset: null, style: {}, edits: {} } as any, { op: "slide.remove", id: "s1" })).toBeNull();
  });
  it("undo of my New slide keeps another user's slide added after it; undo of my Delete slide puts it back after its neighbour", () => {
    const d: any = base(), mine: Op = { op: "slide.add", slide: { id: "n1", type: "content", tables: [] }, after: "s1" }, inv = inverseOf(d, mine)!;
    applyOp(d, mine);
    applyOp(d, { op: "slide.add", slide: { id: "o1", type: "content", tables: [] }, after: "n1" });   // someone else, after mine
    applyOp(d, inv);
    expect(d.preset.slides.map((s: any) => s.id)).toEqual(["s0", "s1", "o1", "s2"]);
    const e: any = base(), del: Op = { op: "slide.remove", id: "s1" }, back = inverseOf(e, del)!;
    applyOp(e, del); applyOp(e, back);
    expect(e.preset.slides.map((s: any) => s.id)).toEqual(["s0", "s1", "s2"]);
  });
  /* review of S13.3, 2 – pinned, not a bug to fix here (09 §2.8 "Undo of Delete slide"): the inverse of slide.remove is
     taken from this page's view when the op is applied (DocSync.apply). An edit of that slide by another writer with a
     LOWER Lamport time that reaches this page later is folded before the remove – and lost when Undo adds back the copy
     from before it. item.patch with patch null (Delete of a chart or shape) behaves the same. S13.4 may recompute the
     inverse against the server copy when Undo runs; until then this test holds the behaviour */
  it("undo of Delete slide puts back the slide as this page had it: another writer's earlier (Lamport) edit that arrived later is lost", () => {
    const snap = { format: 5, gen: 1, workbook: "W.xlsx", lamport: 0, rev: 0, frontier: {}, doc: { schema: 3, workbook: "W.xlsx", rev: 0, ...base() } } as any;
    const A = "anna@pc1#aaaaaaaa", B = "bob@pc2#bbbbbbbb";
    const del: Op = { op: "slide.remove", id: "s1" }, undo = inverseOf(base(), del)!;            // Anna's page: Bob's edit not seen yet
    expect((undo as any).slide.title).toBe("Loans");
    const recs = [
      { l: 1, w: B, s: 1, by: "bob", at: 1000, ops: [{ op: "slide.patch", id: "s1", patch: { title: "Bob's" } }] },
      { l: 2, w: A, s: 1, by: "anna", at: 2000, ops: [del] },
      { l: 3, w: A, s: 2, by: "anna", at: 3000, ops: [undo] },
    ] as any[];
    // before the undo the fold has applied Bob's edit and then removed the slide; the undo restores Anna's copy
    expect(fold(snap, recs.slice(0, 2)).doc.preset!.slides.map(s => s.id)).toEqual(["s0", "s2"]);
    const f = fold(snap, recs);
    expect(f.doc.preset!.slides.map(s => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(f.doc.preset!.slides[1].title).toBe("Loans");                                      // Bob's "Bob's" is lost
    expect(fold(snap, [...recs].reverse()).doc).toEqual(f.doc);                                // the same on every page
    // an item deleted the same way: the undo puts back this page's copy of the item
    const itemDel: Op = { op: "item.patch", slide: "s1", id: "k1", patch: null }, itemUndo = inverseOf(base(), itemDel)!;
    const g = fold(snap, [
      { l: 1, w: B, s: 1, by: "bob", at: 1000, ops: [{ op: "item.patch", slide: "s1", id: "k1", patch: { box: { x: 5, y: 5, w: 9, h: 9 } } }] },
      { l: 2, w: A, s: 1, by: "anna", at: 2000, ops: [itemDel] }, { l: 3, w: A, s: 2, by: "anna", at: 3000, ops: [itemUndo] },
    ] as any[]);
    expect((g.doc.preset!.slides[1].items as any).k1.box).toEqual({ x: 0, y: 0, w: 9, h: 9 });
  });
  it("knownOp: a 4.6 page knows the four ops whole (it compacts its own records); a later page's slide type or table kind it does not", () => {
    const known: object[] = [
      { op: "slide.add", slide: { id: "n1", type: "content", tables: [] }, after: null }, { op: "slide.add", slide: { id: "n1", type: "index", tables: [], later: 1 }, after: "s1" },
      { op: "slide.remove", id: "s1" }, { op: "table.add", table: T3, slide: "s1", at: 0 }, { op: "table.remove", id: "t1", slide: "s1" },
    ];
    for (const op of known) expect(knownOp(op as Op), JSON.stringify(op)).toBe(true);
    for (const op of [{ op: "slide.add", slide: { id: "n1", type: "section", tables: [] }, after: null }, { op: "table.add", table: { ...T3, kind: "picture" }, slide: "s1" }])
      expect(knownOp(op as Op), JSON.stringify(op)).toBe(false);
  });
});

describe("the saved 4.0 deck format (helper/tests/fixtures/saved: snapshot.v4.json + journal.v4.log, never edited)", () => {
  it("the snapshot and the records past its frontier fold into the deck; the torn tail is no record", async () => {
    const fs = await import("node:fs"), path = await import("node:path");
    const dir = path.join(__dirname, "..", "..", "helper", "tests", "fixtures", "saved");
    const snap = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.v4.json"), "utf8"));
    const buf = fs.readFileSync(path.join(dir, "journal.v4.log"));
    const writer = Object.keys(snap.frontier)[0], from = snap.frontier[writer];
    const recs: any[] = [];
    for (let p = from; p < buf.length;) {                   // <len>:<crc32>:<json>\n (the helper's framing)
      const a = buf.indexOf(58, p), b = buf.indexOf(58, a + 1), n = +buf.subarray(p, a).toString();
      if (a < 0 || b < 0 || b + 2 + n > buf.length) break;   // torn: incomplete
      recs.push(JSON.parse(buf.subarray(b + 1, b + 1 + n).toString("utf8"))); p = b + 2 + n;
    }
    expect([snap.format, snap.gen]).toEqual([4, 2]);
    expect(recs.map(r => r.s)).toEqual([3, 4]);
    const f = fold(snap, recs);
    expect(f.doc.rev).toBe(4); expect(f.lamport).toBe(9);
    expect(f.doc.style).toEqual({ design: "excel", color: 35 });
    expect(f.doc.edits).toEqual({ Overview: { C7: { orig: "TOTAL", text: "Totale", b: true }, D7: { fill: "#34C759", role: "header" } } });
    expect(f.doc.preset?.slides.map(s => s.id)).toEqual(["s1"]);
    expect(f.doc.updatedBy).toBe("rossim");
    // the records the snapshot covers are folded once only
    expect(fold(snap, [...recs, { ...recs[0], s: 1 }, { ...recs[0], s: 2 }]).doc).toEqual(f.doc);
  });
});

describe("the per-deck format guard: needsV5 / docNeedsV5 (ADR-019; 4.0.0's lists frozen)", () => {
  const S = (patch: object) => ({ op: "slide.patch", id: "s1", patch }), T = (patch: object) => ({ op: "table.patch", id: "t1", patch });
  const C = (patch: object) => ({ op: "cell.patch", sheet: "S", ref: "A1", patch }), ST = (patch: object) => ({ op: "style.patch", patch });
  const box = { x: 0, y: 0, w: 10, h: 10 };
  it("everything 4.0.0 applies whole needs no format 5 (git show v4.0.0:core/src/model/ops.ts:6-12)", () => {
    const v40: object[] = [
      { op: "preset.set", preset: null }, { op: "preset.set", preset: { sheets: [], tables: [], slides: [], versions: [{ id: "v", name: "V", hide: {} }] } },
      { op: "preset.set", preset: { sheets: [], tables: [], slides: [], links: ["Peers.xlsx"] } },               // 4.2: 4.0 keeps a preset whole
      ...["title", "subtitle", "date", "note", "logo", "layout", "align", "scale", "valign", "subs", "notes", "fmt", "sizes"].map(k => S({ [k]: null })),
      ...["name", "gridH", "gridV", "cols", "rows", "scales", "merges", "sizes"].map(k => T({ [k]: null })),
      ...["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role"].map(k => C({ [k]: null })),
      ...["design", "glass", "color", "logo", "radius", "contrast", "logoBubble", "pn", "footer", "theme", "text", "colors", "designs"].map(k => ST({ [k]: null })),
      ST({ designs: { mckinsey: { consult: { kpis: "2" } }, bain: { consult: {} } } }),                          // inside a known map (CP-01 checks it survives)
      S("not a patch" as unknown as object),                                                                      // skipped by 4.0 and 4.6 alike
    ];
    for (const op of v40) expect(needsV5(op as Op), JSON.stringify(op)).toBe(false);
  });
  it("the guard list: 4.3–4.5's additions, M13's ops and the keys pre-listed for M14–M16 (09 §2.10)", () => {
    const v5: object[] = [
      { op: "item.patch", slide: "s1", id: "c1", patch: { kind: "chart", type: "pie", values: { sheet: "S", range: "A1:A3" }, box } },   // 4.3
      { op: "item.patch", slide: "s1", id: "c1", patch: null }, { op: "item.patch", slide: "s1", id: "c1", patch: { colors: { 0: "#000" } } },
      { op: "item.patch", slide: "s1", id: "l1", patch: { kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, box } },                   // M14
      ...["stack", "gap", "overlap", "legendAt", "frame", "titleRule", "plot", "route", "a", "b", "mid", "bend", "ends", "style", "stroke",
        "sers", "groups", "axes", "marks", "legendHide", "titleFmt"].map(k => ({ op: "item.patch", slide: "s1", id: "c1", patch: { [k]: null } })),
      S({ free: { glass: { on: true, items: {} } } }), S({ title: "T", free: null }),                       // 4.4
      S({ looks: { mckinsey: { kpis: "2" } } }),                                                             // 4.5
      S({ hidden: { glass: true } }), S({ hide: { glass: true } }),                                          // M14–M16, S13.6
      T({ cellGrid: { A1: { o: true } } }), T({ borders: { A1: { top: "none" } } }),                      // 4.4
      C({ valign: "top" }), C({ num: "0.0%" }),                                                              // M16
      { op: "slide.add", slide: { id: "s2", type: "content", tables: [] }, after: "s1" }, { op: "slide.remove", id: "s2" },   // M13
      { op: "table.add", table: { id: "t2", sheet: "S", kind: "range", range: "A1:B2" }, slide: "s1", at: 0 }, { op: "table.remove", slide: "s1", id: "t2" },
      { op: "version.patch", id: "v", patch: { drop: [] } },                                                 // M15
      { op: "chart.patch" }, ST({ ribbon: 1 }),                                                              // anything later
      { op: "preset.set", preset: { sheets: [], tables: [], slides: [{ id: "s1", type: "content", tables: [], items: { c1: { kind: "shape", shape: "rect", box } } }] } },
    ];
    for (const op of v5) expect(needsV5(op as Op), JSON.stringify(op)).toBe(true);
  });
  it("docNeedsV5: non-empty items, free, looks, cellGrid, borders (and hidden, a version's drop, cell valign / num)", () => {
    const base = () => ({ preset: { sheets: ["S"], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:B2" }] as any[], slides: [{ id: "s1", type: "content", tables: ["t1"] }] as any[], versions: [{ id: "v", name: "V", hide: {} }] as any[] }, edits: { S: { A1: { b: true } } } as any });
    expect(docNeedsV5(base() as any)).toBe(false);
    expect(docNeedsV5({ preset: null, edits: {} } as any)).toBe(false);
    const empty = base(); empty.preset.slides[0].items = {}; expect(docNeedsV5(empty as any)).toBe(false);
    const cases: ((d: ReturnType<typeof base>) => void)[] = [
      d => { d.preset.slides[0].items = { c1: { kind: "shape", shape: "rect", box } }; },
      d => { d.preset.slides[0].free = { glass: { on: false, items: {} } }; },
      d => { d.preset.slides[0].looks = { mckinsey: { kpis: "2" } }; },
      d => { d.preset.slides[0].hidden = { glass: true }; },
      d => { d.preset.slides[0].hide = { glass: true }; },                // S13.6's name (review of S13.1, 4)
      d => { d.preset.tables[0].cellGrid = { A1: { h: "on" } }; },
      d => { d.preset.tables[0].borders = { A1: { top: "none" } }; },
      d => { d.preset.versions[0].drop = ["s1"]; },
      d => { d.edits.S.A1.valign = "top"; },
      d => { d.edits.S.A1.num = "0%"; },
    ];
    for (const f of cases) { const d = base(); f(d); expect(docNeedsV5(d as any), f.toString()).toBe(true); }
  });
  it("nextSnapshot: format 5 once the document holds such content, never lowered afterwards", () => {
    const snap = { format: 4 as const, gen: 1, workbook: "W", lamport: 0, rev: 0, frontier: {}, doc: { schema: 3, workbook: "W", rev: 0, preset: { sheets: [], tables: [], slides: [{ id: "s1", type: "content" as const, tables: [] }] }, style: {}, edits: {} } };
    const rec = (s: number, ops: object[]) => ({ l: s, w: "a@pc#aaaaaaaa", s, ops: ops as Op[] });
    expect(nextSnapshot(snap, fold(snap, [rec(1, [C({ b: true })])]), {}).format).toBe(4);
    const five = nextSnapshot(snap, fold(snap, [rec(1, [{ op: "item.patch", slide: "s1", id: "c1", patch: { kind: "shape", shape: "rect", box } }])]), {});
    expect(five.format).toBe(5);
    const gone = nextSnapshot(five, fold(five, [rec(2, [{ op: "item.patch", slide: "s1", id: "c1", patch: null }])]), {});
    expect(gone.doc.preset!.slides[0].items).toBeUndefined();
    expect(gone.format).toBe(5);
  });
});

describe("the saved 4.6 deck format (helper/tests/fixtures/saved: snapshot.v5.json + journal.v5.log, never edited)", () => {
  it("a format-5 snapshot and the records past its frontier fold into the deck; its next snapshot stays format 5", async () => {
    const fs = await import("node:fs"), path = await import("node:path");
    const dir = path.join(__dirname, "..", "..", "helper", "tests", "fixtures", "saved");
    const snap = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.v5.json"), "utf8"));
    const buf = fs.readFileSync(path.join(dir, "journal.v5.log"));
    const writer = Object.keys(snap.frontier)[0], from = snap.frontier[writer];
    const recs: any[] = [];
    for (let p = from; p < buf.length;) {
      const a = buf.indexOf(58, p), b = buf.indexOf(58, a + 1), n = +buf.subarray(p, a).toString();
      if (a < 0 || b < 0 || b + 2 + n > buf.length) break;
      recs.push(JSON.parse(buf.subarray(b + 1, b + 1 + n).toString("utf8"))); p = b + 2 + n;
    }
    expect([snap.format, snap.gen]).toEqual([5, 3]);
    expect(recs.map(r => r.s)).toEqual([3, 4]);
    expect(recs.every(r => r.ops.every(knownOp))).toBe(true);         // a 4.6 page compacts them
    expect(recs.every(r => r.ops.some(needsV5))).toBe(true);
    const f = fold(snap, recs), s = f.doc.preset!.slides[0];
    expect(Object.keys(s.items!).sort()).toEqual(["c1", "n1"]);
    expect(s.free!.excel!.on).toBe(true); expect(s.looks).toEqual({ mckinsey: { kpis: "2" } });
    expect(Object.keys(f.doc.preset!.tables[0])).toEqual(expect.arrayContaining(["cellGrid", "borders"]));
    expect(nextSnapshot(snap, f, {}).format).toBe(5);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "incident-format-5.json"), "utf8")).format).toBe(5);
  });
});

describe("a deck saved by 4.6 with New slide and Add table (fixtures/saved/slides-4.6.json, added, never edited)", () => {
  it("its records fold into the deck in Lamport order, in any order they arrive; a 4.6 page compacts them; it stays format 5", async () => {
    const fs = await import("node:fs"), path = await import("node:path");
    const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "saved", "slides-4.6.json"), "utf8"));
    const { snapshot: snap, records: recs } = saved as { snapshot: any; records: any[] };
    expect(recs.every(r => r.ops.every(knownOp))).toBe(true);
    expect(recs.every(r => r.ops.some(needsV5))).toBe(true);
    const f = fold(snap, recs), p = f.doc.preset!;
    expect([f.doc.rev, f.lamport, f.doc.updatedBy]).toEqual([10, 11, "bob"]);
    // two adds after s1 (anna's and bob's at the same Lamport time: the writer id orders them), bob's moved after anna's
    // by her remove and add again; n1 removed (bob's edit of it after the remove is lost)
    expect(p.slides.map(s => s.id)).toEqual(["cv", "ix", "s1", "n2", "n3", "s2"]);
    const n2 = p.slides[3];
    expect([n2.title, n2.subtitle, n2.tables, Object.keys(n2.items!)]).toEqual(["Outlook", "Next quarter", ["t4"], ["k1"]]);
    expect(p.slides[4]).toEqual({ id: "n3", type: "content", title: "New slide", tables: [] });
    expect(p.slides[5].tables).toEqual(["t2", "t3"]);                  // taken off and put back at its index
    // a table added again keeps its definition (the name given since); the new one joins preset.tables
    expect(p.tables.map(t => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(p.tables[2].name).toBe("Peers");
    expect(fold(snap, [...recs].reverse()).doc).toEqual(f.doc);
    const next = nextSnapshot(snap, f, {});
    expect(next.format).toBe(5);
    expect(next.doc.preset).toEqual(p);
  });
});
