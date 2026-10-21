/* S14.P review, 4 and 7: what the page calls an item comes from its kind's own file (editor/item-text.ts: chart-text.ts
   for M14, shape-text.ts and line-text.ts for M15), so the two milestones never edit the same lines – the status line,
   the stage's tooltip, the undo step of Del and the Issues lines; an item of a kind this page does not know (a newer
   page's) gets an Issues line instead of being left out silently. */
import { describe, expect, it } from "vitest";
import { ITEM_TEXT, kindText, knownKind } from "../src/editor/item-text";
import { CHART_TEXT } from "../src/editor/chart-text";
import { SHAPE_TEXT } from "../src/editor/shape-text";
import { LINE_TEXT } from "../src/editor/line-text";
import { slideIssues } from "../src/editor/issues";
import type { Item } from "@slide-builder/core/model/types";

const box = { x: 0, y: 0, w: 10, h: 10 };
const chart = { kind: "chart", type: "pie", values: { sheet: "S", range: "A1:A3" }, box } as Item;
const callout = { kind: "shape", shape: "pill", text: "x", box } as Item, icon = { kind: "shape", shape: "icon", icon: "target", box } as Item;
const line = { kind: "line", route: "straight", a: { x: 0, y: 1 }, b: { x: 9, y: 1 }, box } as Item;
const later = { kind: "sticker", box } as unknown as Item;

describe("item words per kind (S14.P)", () => {
  it("one entry per kind, chart (M14) before shape and line (M15)", () => {
    expect(ITEM_TEXT).toEqual({ chart: CHART_TEXT, shape: SHAPE_TEXT, line: LINE_TEXT });
    expect(Object.keys(ITEM_TEXT)).toEqual(["chart", "shape", "line"]);
    expect([knownKind("chart"), knownKind("line"), knownKind("sticker"), knownKind(undefined)]).toEqual([true, true, false, false]);
  });
  it("the words 4.6 showed for charts and callouts, unchanged; a line is a line, not a chart or a shape", () => {
    const sel = { id: "c1", slice: null };
    expect(kindText(chart).status(chart, sel)).toBe("Chart selected · drag to move, the corner to resize · Del removes it");
    expect(kindText(chart).status(chart, { id: "c1", slice: 2 })).toBe("Slice 3 of the chart selected · drag to move, the corner to resize · Del removes it");
    expect(kindText(callout).status(callout, sel)).toBe("Shape selected · double-click or Enter to write · drag to move, the corner to resize · Del removes it");
    expect(kindText(icon).status(icon, sel)).toBe("Icon selected · drag to move, the corner to resize · Del removes it");
    expect([chart, callout, line, later].map(x => kindText(x).remove(x))).toEqual(["Remove chart", "Remove shape", "Remove line", "Remove object"]);
    expect([chart, callout, line, later].map(x => kindText(x).name(x))).toEqual(["Chart", "Callout", "Line", "Object"]);
    expect(kindText(line).status(line, sel)).toBe("Line selected · Del removes it");
  });
  it("Issues: numbered per kind; a newer page's kinds in one line, not left out silently (plan-M15 P0.5)", () => {
    const R = { type: "cover", cfg: { items: { c1: chart, k1: callout, l1: line, c2: chart, z1: later, z2: { ...later, kind: "connector" } } } } as never;
    const items = { c1: { issue: null }, k1: { issue: "Nowhere!B2 not found" }, l1: { issue: "its end's table is gone <t1>" }, c2: { issue: "source Numbers!B9:B11 not found" } };
    const lines = slideIssues(R, { slides: [] } as never, items).slice(1);
    expect(lines).toEqual([
      { cls: "err", html: "Callout 1: Nowhere!B2 not found (shown as #REF)" },
      { cls: "warn", html: "Line 1: its end's table is gone &lt;t1&gt;" },
      { cls: "err", html: "Chart 2: source Numbers!B9:B11 not found" },
      { cls: "warn", html: "2 objects of a newer Slide Builder (“sticker”, “connector”) on this slide: not shown or exported by this version, kept in the deck" },
    ]);
  });
});
