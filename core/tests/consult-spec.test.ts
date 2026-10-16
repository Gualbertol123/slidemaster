/* The consulting designs' specs hold the numbers of docs/next/08-consulting-designs.md §2 (S7b.2). */
import { describe, expect, it } from "vitest";
import { SPECS, specOf } from "../src/render/consult-spec";
import { resolveStyle } from "../src/model/style";
import type { RenderCtx } from "../src/render/context";

const ctx = (patch: object): RenderCtx => ({ style: resolveStyle(patch), edits: {}, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: () => null, version: null } as unknown as RenderCtx);

describe("consulting specs (08 §2)", () => {
  it("Consulting Navy: Georgia Bold 40 px titles, Arial, navy rules, rule-only tables (08 §2.1, §2.5)", () => {
    const S = SPECS.mckinsey;
    expect([S.title.family.split(",")[0], S.title.size, S.title.weight, S.title.color]).toEqual(["Georgia", 40, 700, "#051C2C"]);
    expect([S.subtitle.size, S.memo.size, S.pageno.size, S.note.size]).toEqual([24, 13, 15, 18]);
    expect([S.rule, S.bottomRule, S.subtitle.color]).toEqual([{ w: 1, color: "#051C2C" }, { y: 828, w: 1, color: "#D6DEE6" }, "#4E5B66"]);
    expect([S.table.head.kind, S.table.head.rule, S.table.top, S.table.rowRule.color, S.table.highlight]).toEqual(["rules", { w: 2, color: "#051C2C" }, null, "#E3E8EE", "#CAEFFF"]);
    expect([S.accent, S.card.fill, S.note.bullet, S.cover.bg]).toEqual(["#2251FF", "#F4F7FB", "▪", "#051C2C"]);
    expect([S.look.topBand, S.look.ruleAccent, S.look.totalBand, S.look.chips.pos, S.look.chips.neg]).toEqual([{ h: 6, fill: "#051C2C" }, { w: 96, h: 4, color: "#2251FF" }, "#EEF3FF",
      { fill: "#E2F2E7", ink: "#1E8E3E" }, { fill: "#FBE4E1", ink: "#D93025" }]);
  });
  it("Consulting Red: Arial 40 px titles, a grey rule with a red segment, charcoal table headers, takeaway card (08 §2.2, §2.5)", () => {
    const S = SPECS.bain;
    expect([S.title.family.split(",")[0], S.title.size, S.title.weight, S.title.color]).toEqual(["Arial", 40, 400, "#000000"]);
    expect([S.rule, S.bottomRule, S.subtitle.color, S.memo.color, S.pageno.color]).toEqual([{ w: 1, color: "#D6D6D6" }, null, "#666666", "#666666", "#5C5C5C"]);
    expect([S.table.head.kind, S.table.head.fill, S.table.head.ink, S.table.rowRule.color, S.table.totalRule.w]).toEqual(["fill", "#1F1F1F", "#FFFFFF", "#E6E6E6", 2]);
    expect([S.accent, S.card.fill, S.note.bullet, S.cover.band]).toEqual(["#CC0000", "#F7F7F7", "►", { y: 0, h: 520, fill: "#CC0000" }]);
    expect([S.look.topBand, S.look.ruleAccent, S.table.totalRule, S.look.totalBand]).toEqual([null, { w: 120, h: 4, color: "#CC0000" }, { w: 2, color: "#CC0000" }, "#F3F3F3"]);
  });
  it("both share the title band of 08 §2.0", () => {
    for (const S of Object.values(SPECS)) expect(S.band).toEqual({ trackerTop: 10, trackerH: 16, titleTop: 30, lines: 2, subTop: 124, ruleY: { sub: 158, none: 126 }, x: 50, w: 1500 });
  });
  it("follow the deck's colours: the accent and what is drawn in it", () => {
    expect(specOf(ctx({ design: "bain" }))).toBe(SPECS.bain);                     // the design's own palette: the spec as is
    const S = specOf(ctx({ design: "bain", colors: { accent: "#006A35" } }));
    expect([S.accent, S.look.ruleAccent!.color, S.card.bar.color, S.table.strong.fill, S.table.totalRule.color, S.chart.palette[0]]).toEqual(["#006A35", "#006A35", "#006A35", "#006A35", "#006A35", "#006A35"]);
    expect([S.table.head.fill, S.rule.color]).toEqual(["#1F1F1F", "#D6D6D6"]);       // the greys stay grey
    const N = specOf(ctx({ design: "mckinsey", colors: { accent: "#AA0000", ink: "#222222" } }));
    expect([N.accent, N.table.ink, N.title.color, N.table.highlight]).toEqual(["#AA0000", "#222222", "#051C2C", "#F2D9D9"]);
  });
});
