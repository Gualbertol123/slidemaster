/* Delete-versions without the wizard (S16.2, B37, VD-01; docs/next/09 §3.7): ribbon 2 › Cells › For this version ▾ –
   Delete rows · Delete columns · Empty cells · Restore selection · Restore all – each one version.patch, one undo step,
   for the version chosen in the top bar only (the stage shows it; the full deck keeps every row); disabled with the full
   deck shown. (The op, layouts and exports: core/tests/versions-m16.test.ts.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, gotoSlide, openLocalFile, showVersion, undo } from "../src/state/app";
import { setSel } from "../src/editor/edit";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import type { Op } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const T0 = () => get().deck.slides[0].tables[0];
const version = () => get().doc.view!.preset!.versions?.find(v => v.id === "va");
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
async function pick(r1: number, c1: number, r2 = r1, c2 = c1) { await act(async () => { setSel(0, { r: r1, c: c1 }, { r: r2, c: c2 }); }); await settle(2); }
async function choose(id: string) {
  await act(async () => { fireEvent.click(btn("versionBtn")); });
  expect(btn(id)).toBeTruthy();
  expect(btn(id).disabled).toBe(false);
  await act(async () => { fireEvent.click(btn(id)); });
}

describe("For this version ▾ (S16.2, VD-01)", () => {
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
    expect(T0().rows).toContain(10);
  });
  afterAll(() => cleanup());

  it("disabled with the full deck shown; a version made by version.patch (one step) and chosen: the menu acts on it", async () => {
    expect(btn("versionBtn").disabled).toBe(true);
    expect(btn("versionBtn").title).toMatch(/Choose a version first/);
    const h0 = history();
    await act(async () => { change("New version", [{ op: "version.patch", id: "va", patch: { name: "All" } } as Op]); });
    await confirmed(h0 + 1);
    expect(version()).toEqual({ id: "va", name: "All", hide: {} });
    await act(async () => showVersion("va")); await settle();
    expect(btn("versionBtn").disabled).toBe(false);
  });

  it("Delete rows: the selected rows leave the version's table (the stage closes up) – one undo step; the full deck keeps them", async () => {
    const h0 = history(), rows0 = T0().rows.length;
    await pick(10, 3, 11, 4);                                         // Epsilon and Zeta
    await choose("vDropRows");
    await confirmed(h0 + 1);
    expect(version()!.drop).toEqual({ SLIDE_1: ["10:11"] });
    expect(get().deck.history.undoLabel).toBe("Delete rows");
    await vi.waitFor(() => expect(T0().rows.length).toBe(rows0 - 2));
    expect(T0().rows).not.toContain(10);
    expect(get().selection.sel).toBeNull();
    // the full deck: every row; back to the version: closed up again
    await act(async () => showVersion("")); await settle();
    expect(T0().rows.length).toBe(rows0);
    expect(btn("versionBtn").disabled).toBe(true);
    await act(async () => showVersion("va")); await settle();
    expect(T0().rows.length).toBe(rows0 - 2);
    // undo: one step, redo
    await act(async () => undo(false)); await confirmed(h0);
    expect(version()!.drop).toBeUndefined();
    await vi.waitFor(() => expect(T0().rows.length).toBe(rows0));
    await act(async () => undo(true)); await confirmed(h0 + 1);
    await vi.waitFor(() => expect(T0().rows.length).toBe(rows0 - 2));
  });

  it("Delete columns, Empty cells, Restore selection across the gap, Restore all – one step each", async () => {
    const h0 = history(), cols0 = T0().cols.length;
    await pick(6, 7);                                                 // column G (Deposits' Δ w/w)
    await choose("vDropCols");
    await confirmed(h0 + 1);
    expect(version()!.drop).toEqual({ SLIDE_1: ["10:11", "G"] });
    await vi.waitFor(() => expect(T0().cols.length).toBe(cols0 - 1));
    await pick(6, 4);
    await choose("vEmpty");
    await confirmed(h0 + 2);
    expect(version()!.hide).toEqual({ SLIDE_1: ["D6:D6"] });
    // across the closed-up rows 10–11 (from Gamma's row 8 to Eta's 12) and D6: those come back, G stays deleted
    await pick(6, 3, 12, 4);
    await choose("vRestoreSel");
    await confirmed(h0 + 3);
    expect(version()!.drop).toEqual({ SLIDE_1: ["G"] });
    expect(version()!.hide).toEqual({});
    expect(get().deck.history.undoLabel).toBe("Restore selection");
    await choose("vRestoreAll");
    await confirmed(h0 + 4);
    expect(version()).toEqual({ id: "va", name: "All", hide: {} });
    expect(get().deck.history.undoLabel).toBe("Restore all of “All”");
    await vi.waitFor(() => expect(T0().cols.length).toBe(cols0 + 0));
  });

  it("Delete columns names the SHEET column: “Since” is I (Excel's hidden H between it and G is not counted out)", async () => {
    // (VD-01's e2e expected G for Since: the fixture's header is C Bank … G Δ w/w, H Share (hidden), I Since, J Note)
    const h0 = history();
    const T = T0(), ci = T.cols.indexOf(9);
    expect(T.cols).not.toContain(8);                                  // H is hidden: not one of the table's columns
    expect(ci).toBeGreaterThan(0);
    await pick(6, 9);                                                 // Alpha's Since
    await choose("vDropCols");
    await confirmed(h0 + 1);
    expect(version()!.drop).toEqual({ SLIDE_1: ["I"] });
    await act(async () => undo(false)); await confirmed(h0);
    expect(version()!.drop).toBeUndefined();
  });

  it("a table keeps a row: the menu refuses to delete them all; a merge that does (two writers) keeps the table whole and the Issues panel says so", async () => {
    const h0 = history(), rows0 = T0().rows.length;
    await pick(4, 3, 19, 4);                                          // every row of the table
    await choose("vDropRows");
    await settle();
    expect(get().ui.toast?.html).toMatch(/A table keeps at least one row/);
    expect(history()).toBe(h0);
    expect(version()!.drop).toBeUndefined();
    // two writers on overlapping rows can still reach it: the table stays, every row of it, with a note
    await act(async () => { change("Delete rows", [{ op: "version.patch", id: "va", patch: { drop: { SLIDE_1: ["4:19"] } } } as Op]); });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(get().deck.slides[0].dropWhole).toBe(1));
    expect(T0().rows.length).toBe(rows0);
    await vi.waitFor(() => expect(document.getElementById("issues")!.innerHTML).toMatch(/<li class="warn">A table of this slide shown with every row and column in this version/));
    expect(document.getElementById("issues")!.innerHTML).not.toMatch(/could not be found/);
    await act(async () => undo(false)); await confirmed(h0);
    await vi.waitFor(() => expect(get().deck.slides[0].dropWhole).toBeUndefined());
  });

  it("the version shown is deleted (by anybody): the full deck is shown", async () => {
    const h0 = history();
    await act(async () => { change("Delete version", [{ op: "version.patch", id: "va", patch: null } as Op]); });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(get().deck.version).toBe(""));
    expect(btn("versionBtn").disabled).toBe(true);
  });
});
