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
      S("not a patch"),                                                                                           // skipped by 4.0 and 4.6 alike
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
      { op: "table.add", slide: "s1", id: "t2" }, { op: "table.remove", slide: "s1", id: "t2" },
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
