import { describe, expect, it } from "vitest";
import vectors from "../../shared/ops-vectors.json";
import { applyOps, inverseOf, applyOp } from "../src/model/ops";
import { fold } from "../src/model/fold";
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
