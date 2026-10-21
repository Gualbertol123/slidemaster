/* S16.3 (4.9, B38; PT-01…PT-03; docs/next/09 §9 Q9, Q19): the ribbon's Number group (Decimals −/+, %, Thousands) and
   vertical alignment for table cells – saved as cell.patch num / valign, each click one undo step; the format painter
   copies them (and the font); Ctrl+click several ranges – of one table or of several – or several objects, then let go
   of Ctrl: one paste onto all of them, one undo step; an object's look onto others of its kind (item.patch each). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, gotoSlide, openLocalFile, undo } from "../src/state/app";
import { addSel, selItems, setSel } from "../src/editor/edit";
import { applyPainter, paintItem, startPainter, stopPainter } from "../src/editor/painter";
import { selectItem } from "../src/editor/charts";
import { keyOf } from "@slide-builder/core/render/edits";
import { formatValue, isDateFmt } from "@slide-builder/core/xlsx/numfmt";
import type { CellEdit, Op } from "@slide-builder/core/model/types";
import type { Item, TableLayout } from "@slide-builder/core/xlsx/types";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const editOf = (it: Item): CellEdit => (get().doc.view!.edits[it.L!.sheet.name] || {})[keyOf(it)] || {};
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
/** the current slide's table t and its number cells (one cell each, not merged) */
function numbers(t: number) {
  const T = get().deck.slides[get().deck.cur].tables[t] as TableLayout;
  return { T, nums: T.items.filter(it => it.ctype === "n" && it.text && !it.merged && it.b.r === it.b.r2 && it.b.c === it.b.c2) };
}
const sel1 = (t: number, it: Item) => setSel(t, { r: it.b.r, c: it.b.c }, { r: it.b.r, c: it.b.c });
let home = 0;
const key = (k: string) => { dispatchEvent(new KeyboardEvent("keyup", { key: k })); };

describe("number display, vertical alignment and the fuller painter (S16.3)", () => {
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: defaultPreset(wb), style: {}, edits: {} }));
    render(<App />);
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    const k = get().deck.slides.findIndex(s => s.tables.length >= 2 && s.tables.every(t => t.items.some(it => it.ctype === "n")));
    expect(k).toBeGreaterThanOrEqual(0);
    home = k; await act(async () => gotoSlide(k)); await settle();
  });
  afterAll(() => cleanup());

  it("PT-01 Number group: More / Fewer decimals, %, Thousands – on every selected number, one undo step each; the text shows it", async () => {
    const { nums } = numbers(0), [a, b] = nums, h0 = history();
    await act(async () => setSel(0, { r: a.b.r, c: a.b.c }, { r: b.b.r, c: b.b.c })); await settle();
    expect(btn("numDecUp").disabled).toBe(false);
    await act(async () => { fireEvent.click(btn("numDecUp")); });
    await confirmed(h0 + 1);
    const n1 = editOf(a).num!;
    expect(n1).toMatch(/0\.0*0/);
    expect(editOf(b).num).toBeTruthy();
    // drawn on the stage: the cell's number with the new code (Italian separators, as the PDF and PowerPoint)
    const x = a.L!.sheet.get(a.b.src.r, a.b.src.c)!, shown = formatValue({ v: x.v, t: x.t, fmt: n1 }).text;
    expect(shown).not.toBe(a.text);
    await vi.waitFor(() => expect(document.getElementById("stage")!.textContent).toContain(shown), { timeout: 10_000 });
    await act(async () => { fireEvent.click(btn("numPct")); });
    await confirmed(h0 + 2);
    expect(editOf(a).num).toBe(n1 + "%");
    expect(btn("numPct").className).toContain(" on");
    await act(async () => { fireEvent.click(btn("numPct")); });
    await confirmed(h0 + 3);
    expect(editOf(a).num).toBe(n1);
    await act(async () => { fireEvent.click(btn("numDecDown")); });
    await confirmed(h0 + 4);
    // back to the workbook's own code: nothing stored
    expect(editOf(a).num).toBeUndefined();
    // undo: one step back
    await act(async () => undo(false)); await settle(12);
    expect(editOf(a).num).toBe(n1);
  });

  it("PT-01 vertical alignment for cells: top / middle stored, Excel's own clears; Clear format clears both", async () => {
    const { nums } = numbers(0), a = nums[2], h0 = history();
    await act(async () => sel1(0, a)); await settle();
    const top = document.querySelector('[data-valign="top"]') as HTMLButtonElement;
    expect(top.disabled).toBe(false);
    await act(async () => { fireEvent.click(top); });
    await confirmed(h0 + 1);
    expect(editOf(a).valign).toBe("top");
    await act(async () => { fireEvent.click(document.querySelector('[data-valign="middle"]')!); });
    await confirmed(h0 + 2);
    expect(editOf(a).valign).toBe("middle");
    await act(async () => { fireEvent.click(btn("numDecUp")); });
    await confirmed(h0 + 3);
    await act(async () => { fireEvent.click(btn("clearFmt")); });
    await confirmed(h0 + 4);
    expect(editOf(a).valign).toBeUndefined(); expect(editOf(a).num).toBeUndefined();
  });

  it("PT-02 the painter copies the number display, the vertical position and the font", async () => {
    const { nums } = numbers(0), [src, , , dst] = nums, h0 = history();
    await act(async () => change("Set up", [{ op: "cell.patch", sheet: src.L!.sheet.name, ref: keyOf(src), patch: { num: "0.000", valign: "top", font: "Arial" } } as Op]));
    await confirmed(h0 + 1);
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    expect(get().selection.painter).toBeTruthy();
    await act(async () => { sel1(0, dst); applyPainter(); });
    await confirmed(h0 + 2);
    expect(editOf(dst)).toMatchObject({ num: "0.000", valign: "top", font: "Arial" });
    expect(get().selection.painter).toBeNull();
    // a date keeps its date format (a number's code is not pasted onto it), the rest of the look is
    const all = get().deck.slides.flatMap((s, si) => s.tables.map((T, t) => ({ si, t, T: T as TableLayout })));
    const date = all.flatMap(x => x.T.items.filter(it => { const c = x.T.sheet.get(it.b.src.r, it.b.src.c); return c && (c.t === "n" || c.t === "d") && isDateFmt(c.fmt); }).map(it => ({ ...x, it })))[0];
    expect(date).toBeTruthy();
    const h1 = history();
    await act(async () => gotoSlide(date.si)); await settle();
    const from = numbers(date.t).nums.find(it => !isDateFmt(it.L!.sheet.get(it.b.src.r, it.b.src.c)!.fmt))!;
    expect(from).toBeTruthy();
    await act(async () => change("Set up", [{ op: "cell.patch", sheet: from.L!.sheet.name, ref: keyOf(from), patch: { num: "0.000", valign: "top" } } as Op]));
    await confirmed(h1 + 1);
    await act(async () => { sel1(date.t, from); startPainter(false); }); await settle();
    await act(async () => { sel1(date.t, date.it); applyPainter(); });
    await confirmed(h1 + 2);
    expect(editOf(date.it).valign).toBe("top"); expect(editOf(date.it).num).toBeUndefined();
    await act(async () => undo(false)); await settle(8); await act(async () => undo(false)); await settle(8);
    await act(async () => gotoSlide(home)); await settle();
  });

  it("PT-03 Ctrl+click several ranges (two tables), let go of Ctrl: one paste on all of them, one undo step", async () => {
    const A = numbers(0).nums, B = numbers(1).nums, src = A[0], h0 = history();
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    // a range of table 1, a cell of table 2, another cell of table 1: noted, nothing pasted yet
    await act(async () => { setSel(0, { r: A[4].b.r, c: A[4].b.c }, { r: A[5].b.r, c: A[5].b.c }); applyPainter(true); });
    await act(async () => { sel1(1, B[0]); applyPainter(true); });
    await act(async () => { sel1(0, A[6]); applyPainter(true); }); await settle();
    expect(get().selection.painter?.pend?.cells.length).toBe(3);
    expect(history()).toBe(h0);
    expect(document.querySelectorAll(".paintpend").length).toBeGreaterThanOrEqual(1);
    await act(async () => key("Control"));
    await confirmed(h0 + 1);
    for (const it of [A[4], A[5], B[0], A[6]]) expect(editOf(it), keyOf(it)).toMatchObject({ num: "0.000", valign: "top", font: "Arial" });
    expect(get().selection.painter).toBeNull();
    // one Ctrl+Z takes all of it back
    await act(async () => undo(false)); await settle(12);
    for (const it of [A[4], A[5], B[0], A[6]]) expect(editOf(it).num, keyOf(it)).toBeUndefined();
  });

  it("Ctrl+click multi-selection: the ribbon acts on every range at once (one undo step); a plain click starts again", async () => {
    const { nums } = numbers(0), h0 = history();
    await act(async () => { sel1(0, nums[7]); addSel(0, { r: nums[9].b.r, c: nums[9].b.c }); }); await settle();
    expect(get().selection.sel?.more?.length).toBe(1);
    expect(selItems().map(keyOf).sort()).toEqual([keyOf(nums[7]), keyOf(nums[9])].sort());
    expect(document.querySelectorAll("#stage .selbox").length).toBeGreaterThanOrEqual(2);
    await act(async () => { fireEvent.click(btn("numThou")); });
    await confirmed(h0 + 1);
    expect(editOf(nums[7]).num ?? null).not.toBe(editOf(nums[8]).num ?? null);
    expect(editOf(nums[7]).num).toBe(editOf(nums[9]).num);
    await act(async () => sel1(0, nums[7])); await settle();
    expect(get().selection.sel?.more).toBeUndefined();
  });

  it("PT-03 objects: a callout's look onto others of its kind – one, or several with Ctrl (one undo step); another kind refuses", async () => {
    const R = get().deck.slides[get().deck.cur], h0 = history();
    const shape = (id: string, x: number, extra: object = {}): Op => ({ op: "item.patch", slide: R.id, id, patch: { kind: "shape", shape: "round", text: id, box: { x, y: 600, w: 120, h: 60 }, ...extra } } as Op);
    await act(async () => change("Callouts", [shape("pa", 100, { fill: "#C00000", border: { color: "#1F3864", w: 2 }, fmt: { b: true, color: "#FFFFFF" } }), shape("pb", 300, { fmt: { i: true } }), shape("pc", 500), shape("pd", 700),
      { op: "item.patch", slide: R.id, id: "ic", patch: { kind: "shape", shape: "icon", icon: "check", box: { x: 900, y: 600, w: 48, h: 48 } } } as Op]));
    await confirmed(h0 + 1);
    await act(async () => { selectItem("pa"); startPainter(false); }); await settle();
    expect(get().selection.painter?.obj?.kind).toBe("shape");
    // one target
    await act(async () => { expect(paintItem("pb", false)).toBe(true); });
    await confirmed(h0 + 2);
    const items = () => get().doc.view!.preset!.slides.find(s => s.id === R.id)!.items!;
    expect(items().pb).toMatchObject({ fill: "#C00000", border: { color: "#1F3864", w: 2 }, fmt: { b: true, color: "#FFFFFF" }, text: "pb", box: { x: 300 } });
    expect((items().pb as { fmt: object }).fmt).not.toHaveProperty("i");
    // several with Ctrl: one change
    await act(async () => { selectItem("pa"); startPainter(true); }); await settle();
    await act(async () => { paintItem("pc", true); paintItem("pd", true); paintItem("ic", true); }); await settle();
    expect(get().selection.painter?.pend?.items).toEqual(["pc", "pd"]);
    expect(history()).toBe(h0 + 2);
    await act(async () => key("Control"));
    await confirmed(h0 + 3);
    expect(items().pc).toMatchObject({ fill: "#C00000" }); expect(items().pd).toMatchObject({ fill: "#C00000" });
    expect(items().ic).not.toHaveProperty("border");
    // sticky: still on, the targets cleared
    expect(get().selection.painter?.pend).toBeUndefined();
    await act(async () => stopPainter());
    await act(async () => undo(false)); await settle(12);
    expect(items().pc).not.toHaveProperty("fill"); expect(items().pd).not.toHaveProperty("fill");
    await act(async () => gotoSlide(get().deck.cur));
  });
});
