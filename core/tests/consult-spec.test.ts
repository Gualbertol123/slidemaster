/* The consulting designs' specs hold the numbers of docs/next/08-consulting-designs.md §2 (S7b.2). */
import { describe, expect, it } from "vitest";
import { SPECS, specOf } from "../src/render/consult-spec";
import { resolveStyle } from "../src/model/style";
import type { RenderCtx } from "../src/render/context";

const ctx = (patch: object): RenderCtx => ({ style: resolveStyle(patch), edits: {}, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: () => null, version: null } as unknown as RenderCtx);

describe("consulting specs (08 §2)", () => {
  it("Consulting Navy: Georgia Bold 40 px titles, Arial, 0.8 px black rules, rule-only tables", () => {
    const S = SPECS.mckinsey;
    expect([S.title.family.split(",")[0], S.title.size, S.title.weight, S.title.color]).toEqual(["Georgia", 40, 700, "#051C2C"]);
    expect([S.subtitle.size, S.memo.size, S.pageno.size, S.note.size]).toEqual([24, 13, 15, 18]);
    expect([S.rule, S.bottomRule]).toEqual([{ w: .8, color: "#000000" }, { y: 828, w: .8, color: "#000000" }]);
    expect([S.table.head.kind, S.table.head.rule, S.table.rowRule.color, S.table.highlight]).toEqual(["rules", { w: 1.6, color: "#000000" }, "#7F7F7F", "#CAEFFF"]);
    expect([S.accent, S.card.fill, S.note.bullet, S.cover.bg]).toEqual(["#2251FF", "#F0F4F8", "▪", "#051C2C"]);
  });
  it("Consulting Red: Arial 40 px titles, a 2 px red rule, black table headers, takeaway card", () => {
    const S = SPECS.bain;
    expect([S.title.family.split(",")[0], S.title.size, S.title.weight, S.title.color]).toEqual(["Arial", 40, 400, "#000000"]);
    expect([S.rule, S.bottomRule, S.subtitle.color, S.memo.color, S.pageno.color]).toEqual([{ w: 2, color: "#CC0000" }, null, "#666666", "#666666", "#5C5C5C"]);
    expect([S.table.head.kind, S.table.head.fill, S.table.head.ink, S.table.rowRule.color, S.table.totalRule.w]).toEqual(["fill", "#000000", "#FFFFFF", "#D6D6D6", 1.6]);
    expect([S.accent, S.card.fill, S.note.bullet, S.cover.band]).toEqual(["#CC0000", "#F5F5F5", "►", { y: 0, h: 520, fill: "#CC0000" }]);
  });
  it("both share the title band of 08 §2.0", () => {
    for (const S of Object.values(SPECS)) expect(S.band).toEqual({ trackerTop: 10, trackerH: 16, titleTop: 30, lines: 2, subTop: 124, ruleY: { sub: 158, none: 126 }, x: 50, w: 1500 });
  });
  it("follow the deck's colours: the accent and what is drawn in it", () => {
    expect(specOf(ctx({ design: "bain" }))).toBe(SPECS.bain);                     // the design's own palette: the spec as is
    const S = specOf(ctx({ design: "bain", colors: { accent: "#006A35" } }));
    expect([S.accent, S.rule.color, S.card.bar.color, S.table.strong.fill, S.chart.palette[0]]).toEqual(["#006A35", "#006A35", "#006A35", "#006A35", "#006A35"]);
    expect(S.table.head.fill).toBe("#000000");                                       // black stays black
    const N = specOf(ctx({ design: "mckinsey", colors: { accent: "#AA0000", ink: "#222222" } }));
    expect([N.accent, N.table.ink, N.title.color, N.table.highlight]).toEqual(["#AA0000", "#222222", "#051C2C", "#F2D9D9"]);
  });
});
