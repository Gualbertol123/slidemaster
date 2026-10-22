/* Hidden rows and columns per slide (S16.1, B36, HR-01; docs/next/09 §3.6): ribbon 2 › Cells › Hide ▾ – Hide rows ·
   Hide columns · Unhide all on this table – each one slide.patch of `hidden`, one undo step; the table on the slide
   closes them up (this slide only); the stage's double marks (DOM, not exported) bring them back on a click; the
   "Σ incl. hidden rows" note (Q8). (Layout, charts, exports: core/tests/hidden-m16.test.ts.) */
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
import { setSel } from "../src/editor/edit";
import { hideSel } from "../src/editor/hidden";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import type { Op } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const slide = (i = 0) => get().deck.slides[i];
const hiddenOf = (i = 0) => get().doc.view!.preset!.slides[i].hidden;
const T0 = () => slide(0).tables[0];
async function pick(r1: number, c1: number, r2 = r1, c2 = c1) { await act(async () => { setSel(0, { r: r1, c: c1 }, { r: r2, c: c2 }); }); await settle(2); }
async function choose(id: string) {
  await act(async () => { fireEvent.click(document.getElementById("hideBtn")!); });
  const b = document.getElementById(id) as HTMLButtonElement;
  expect(b).toBeTruthy();
  await act(async () => { fireEvent.click(b); });
}

describe("Hide rows and columns on a slide (S16.1, HR-01)", () => {
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
    await act(async () => gotoSlide(0)); await settle();
    expect(T0().rows).toContain(7);
  });
  afterAll(() => cleanup());

  it("Hide ▾ is off without a selection; Hide rows closes the selected rows up on this slide – one undo step; the mark and the note show", async () => {
    const h0 = history(), id = T0().def!.id, rows0 = T0().rows.length;
    expect((document.getElementById("hideBtn") as HTMLButtonElement).disabled).toBe(true);
    await pick(7, 3, 8, 4);                                          // Beta and Gamma
    expect((document.getElementById("hideBtn") as HTMLButtonElement).disabled).toBe(false);
    await choose("hideRows");
    await confirmed(h0 + 1);
    expect(hiddenOf()).toEqual({ [id + ":r7"]: true, [id + ":r8"]: true });
    expect(get().deck.history.undoLabel).toBe("Hide 2 rows");
    expect(T0().rows.length).toBe(rows0 - 2);
    expect(get().selection.sel).toBeNull();
    // the stage: one double mark where the two rows were (the top of Epsilon's row, 10: row 9 is Excel's own hidden one),
    // and the Σ note; the menu counts them
    await vi.waitFor(() => expect(document.querySelectorAll(".hidrc.hrow")).toHaveLength(1), { timeout: 10_000 });
    const mark = document.querySelector(".hidrc.hrow") as HTMLElement;
    expect(mark.dataset.keys).toBe(`${id}:r7 ${id}:r8`);
    expect(parseFloat(mark.style.top) + parseFloat(mark.style.height) / 2).toBeCloseTo(T0().rowY.get(10)!, 3);
    expect(document.querySelector(".hidrcnote")?.textContent).toBe("Σ incl. hidden rows");
    expect(document.getElementById("hideBtn")!.textContent).toMatch(/^Hide \(2\)/);
    // the mark is clicked where it is drawn – over the table, whose hit area (.hits, ui.css) would take the click: the
    // marks' layer is above it (HR-01 on CI: "<div class=hits> intercepts pointer events")
    const hitsZ = +/\.slide \.hits\{[^}]*z-index:(\d+)/.exec(fs.readFileSync(path.join(here, "../src/styles/ui.css"), "utf8"))![1];
    expect(+(mark.closest(".hidrcs") as HTMLElement).style.zIndex).toBeGreaterThan(hitsZ);
    // undo: one step
    await act(async () => undo(false)); await confirmed(h0);
    expect(hiddenOf()).toBeUndefined();
    expect(T0().rows.length).toBe(rows0);
    await vi.waitFor(() => expect(document.querySelectorAll(".hidrc")).toHaveLength(0), { timeout: 10_000 });
    await act(async () => undo(true)); await confirmed(h0 + 1);
    expect(T0().rows.length).toBe(rows0 - 2);
    // a click on the double mark brings them back (one step)
    await vi.waitFor(() => expect(document.querySelector(".hidrc.hrow")).toBeTruthy(), { timeout: 10_000 });
    await act(async () => { fireEvent.click(document.querySelector(".hidrc.hrow")!); });
    await confirmed(h0 + 2);
    expect(hiddenOf()).toBeUndefined();
    expect(get().deck.history.undoLabel).toBe("Unhide rows");
    expect(document.querySelector(".hidrcnote")).toBeNull();
  });

  it("Hide columns, then Unhide all on this table; another table's entries stay; one step each", async () => {
    const h0 = history(), id = T0().def!.id, cols0 = T0().cols.length;
    await act(async () => { change("Hide", [{ op: "slide.patch", id: slide(0).id, patch: { hidden: { "other:r3": true } } } as Op]); }); await confirmed(h0 + 1);
    await pick(6, 5, 6, 6);                                          // the first Δ w/w and Deposits
    await choose("hideCols");
    await confirmed(h0 + 2);
    expect(hiddenOf()).toEqual({ "other:r3": true, [id + ":cE"]: true, [id + ":cF"]: true });
    expect(T0().cols.length).toBe(cols0 - 2);
    await vi.waitFor(() => expect(document.querySelectorAll(".hidrc.hcol")).toHaveLength(1), { timeout: 10_000 });
    expect(document.querySelector(".hidrcnote")).toBeNull();          // columns only: no Σ note
    await choose("unhideAll");
    await confirmed(h0 + 3);
    expect(hiddenOf()).toEqual({ "other:r3": true });
    expect(get().deck.history.undoLabel).toBe("Unhide all on this table");
    expect(T0().cols.length).toBe(cols0);
    for (let k = 0; k < 3; k++) { await act(async () => undo(false)); await confirmed(h0 + 2 - k); }
    expect(hiddenOf()).toBeUndefined();
  });

  it("a table keeps at least one row and one column: hiding every row is refused, nothing changes", async () => {
    const h0 = history(), L = T0();
    await pick(L.rows[0], L.cols[0], L.rows[L.rows.length - 1], L.cols[0]);
    let ok = true;
    await act(async () => { ok = hideSel("r"); });
    expect(ok).toBe(false);
    await settle();
    expect(history()).toBe(h0);
    expect(hiddenOf()).toBeUndefined();
  });
});
