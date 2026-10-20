/* The benches' gate rule (tools/benchgate.mjs, decision 2026-10-20): on CI a timing gate over its limit + 10 % is
   measured again and fails only if the repeat is over too; sizes are never repeated; locally one pass decides. */
import { describe, expect, it } from "vitest";
import { annotation, describe as line, judge } from "../../tools/benchgate.mjs";

const limits = { drag_frame_ms: 16, export_glass_kb: 1790, heap_mb: 150 };
/** a repeat that records what it was asked for */
const fresh = (values: Record<string, number>) => { const asked: string[][] = []; return { asked, again: (keys: string[]) => { asked.push(keys); return values; } }; };

describe("bench gates", () => {
  it("on CI: over in the first pass, under on the repeat – passes, with the repeat in the report", async () => {
    const r = fresh({ drag_frame_ms: 7.5 });
    const { gates, bad } = await judge({ limits, first: { drag_frame_ms: 383.4, export_glass_kb: 1275.7, heap_mb: 73 }, again: r.again, ci: true });
    expect(bad).toEqual([]);
    expect(r.asked).toEqual([["drag_frame_ms"]]);                                // only the gate that was over
    const g = gates.find(x => x.key === "drag_frame_ms")!;
    expect(g).toMatchObject({ first: 383.4, repeat: 7.5, pass: true, repeated: true });
    expect(line(g)).toBe("383.4 (limit 16 – OVER +10 %); repeated after a stall: 7.5 – passes");
    expect(line(gates.find(x => x.key === "heap_mb")!)).toBe("73 (limit 150)");
  });
  it("on CI: over in both measurements – fails, and its annotation names both", async () => {
    const { gates, bad } = await judge({ limits, first: { drag_frame_ms: 383.4 }, again: () => ({ drag_frame_ms: 300 }), ci: true });
    expect(bad).toEqual(["drag_frame_ms"]);
    expect(gates[0]).toMatchObject({ first: 383.4, repeat: 300, pass: false, repeated: false });
    expect(line(gates[0])).toBe("383.4 (limit 16 – OVER +10 %); repeated after a stall: 300 – OVER +10 % – over in both measurements");
    expect(annotation("bench drag_frame_ms", gates[0])).toBe("::error title=bench drag_frame_ms::383.4 then 300 on the repeat (limit 16, + 10 % allowed)");
  });
  it("locally: never repeats – the first pass decides", async () => {
    const r = fresh({ drag_frame_ms: 7.5 });
    const { gates, bad } = await judge({ limits, first: { drag_frame_ms: 383.4 }, again: r.again, ci: false });
    expect(bad).toEqual(["drag_frame_ms"]); expect(r.asked).toEqual([]);
    expect("repeat" in gates[0]).toBe(false);
    expect(annotation("bench drag_frame_ms", gates[0])).toBe("::error title=bench drag_frame_ms::383.4 (limit 16, + 10 % allowed)");
  });
  it("sizes and memory are never repeated; a value not measured fails without a repeat; a repeat that measured nothing fails", async () => {
    const r = fresh({ export_glass_kb: 1, heap_mb: 1, drag_frame_ms: 1 });
    expect((await judge({ limits, first: { export_glass_kb: 2000, heap_mb: 200 }, again: r.again, ci: true })).bad).toEqual(["export_glass_kb", "heap_mb"]);
    expect((await judge({ limits, first: { drag_frame_ms: Infinity }, again: r.again, ci: true })).bad).toEqual(["drag_frame_ms"]);
    expect(r.asked).toEqual([]);
    const none = await judge({ limits, first: { drag_frame_ms: 40 }, again: () => ({}), ci: true });
    expect(none.bad).toEqual(["drag_frame_ms"]);
    expect(line(none.gates[0])).toBe("40 (limit 16 – OVER +10 %); repeated after a stall: not measured – OVER +10 % – over in both measurements");
  });
  it("the report follows the rule it was judged by (strict) and keeps small numbers readable", async () => {
    const at = await judge({ limits: { glass_ms: 2 }, first: { glass_ms: 2 * 1.1 }, ci: false, strict: true });
    expect(at.bad).toEqual(["glass_ms"]); expect(line(at.gates[0])).toBe("2.2 (limit 2 – OVER +10 %)");
    expect(line((await judge({ limits: { glass_ms: 2 }, first: { glass_ms: 0.347 }, ci: false })).gates[0])).toBe("0.35 (limit 2)");
  });
  it("the limit + 10 % as before: within it passes without a repeat; at it passes (the page bench) or fails (strict: the core's)", async () => {
    const never = () => { throw new Error("no repeat expected"); };
    const within = await judge({ limits, first: { drag_frame_ms: 17 }, again: never, ci: true });
    expect(within.bad).toEqual([]); expect(line(within.gates[0])).toBe("17 (limit 16 – over, within +10 %)");
    const at = 16 * 1.1;
    expect((await judge({ limits, first: { drag_frame_ms: at }, again: never, ci: false })).bad).toEqual([]);
    expect((await judge({ limits, first: { drag_frame_ms: at }, again: never, ci: false, strict: true })).bad).toEqual(["drag_frame_ms"]);
  });
  it("the repeat is asked for once, for every gate over at the same time", async () => {
    const r = fresh({ a_ms: 1, b_ms: 99 });
    const { bad } = await judge({ limits: { a_ms: 10, b_ms: 10, c_ms: 10 }, first: { a_ms: 50, b_ms: 50, c_ms: 5 }, again: r.again, ci: true });
    expect(r.asked).toEqual([["a_ms", "b_ms"]]); expect(bad).toEqual(["b_ms"]);
  });
});
