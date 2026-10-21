/* Hide slides per design (S13.6, B47, HS-01; docs/next/09 §2.8): the slide list's right-click menu hides the slide in
   the current design (Hide slide / Show slide) or in every design; each is one slide.patch of `hide`, one undo step.
   The hidden slide is grayed in the list with a mark and its number struck, and the stage marks it; another design
   shows it as before. (The exports, numbers and contents: core/tests/hide.test.ts.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get, THUMBS } from "../src/state/store";
import { change, gotoSlide, openLocalFile, style, styleChange, undo } from "../src/state/app";
import { hideSlide } from "../src/editor/slides";
import { exportVersions, shownDesigns } from "../src/editor/export";
import { startRun } from "../src/editor/scenario";
import type { Op } from "@slide-builder/core/model/types";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const hideOf = (i: number) => get().doc.view!.preset!.slides[i].hide;
const thumb = (i: number) => document.querySelector(`.thumb[data-i="${i}"]`)!;
async function menu(i: number) {
  await act(async () => { fireEvent.contextMenu(thumb(i), { clientX: 40, clientY: 40 }); });
  return { hide: document.getElementById("ctxHideSlide")!, all: document.getElementById("ctxHideAll")! };
}

describe("Hide slide (S13.6, HS-01)", () => {
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
    expect(get().deck.slides.length).toBeGreaterThan(1);
  });
  afterAll(() => cleanup());

  it("Hide slide hides it in the current design only: grayed, marked, struck; the stage marks it; Show slide; undo", async () => {
    const d = style().design, other = d === "excel" ? "glass" : "excel", h0 = history();
    await act(async () => gotoSlide(0)); await settle();
    let m = await menu(1);
    expect(get().deck.cur).toBe(1);
    expect(m.hide.textContent).toMatch(/^Hide slide/);
    await act(async () => { fireEvent.click(m.hide); });
    await confirmed(h0 + 1);
    expect(document.getElementById("slideMenu")).toBeNull();
    expect(hideOf(1)).toEqual({ [d]: true });
    expect(thumb(1).classList.contains("hid")).toBe(true);
    expect(thumb(1).querySelector(".hidmark")?.textContent).toBe("hidden");
    expect(thumb(0).classList.contains("hid")).toBe(false);
    await vi.waitFor(() => expect(document.getElementById("stageHidden")?.textContent).toMatch(/^Hidden in .* – not exported$/), { timeout: 10_000 });
    // another design: shown there
    await act(async () => { styleChange("Design", { design: other }); }); await confirmed(h0 + 2);
    expect(thumb(1).classList.contains("hid")).toBe(false);
    await vi.waitFor(() => expect(document.getElementById("stageHidden")).toBeNull(), { timeout: 10_000 });
    expect((await menu(1)).hide.textContent).toMatch(/^Hide slide/);
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(thumb(1).classList.contains("hid")).toBe(true);
    // Show slide: the menu says it, and it clears the entry (the map goes)
    m = await menu(1);
    expect(m.hide.textContent).toMatch(/^Show slide/);
    await act(async () => { fireEvent.click(m.hide); }); await confirmed(h0 + 2);
    expect(hideOf(1)).toBeUndefined();
    expect(thumb(1).classList.contains("hid")).toBe(false);
    // undo, one step each
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(hideOf(1)).toEqual({ [d]: true });
    await act(async () => undo(false)); await confirmed(h0);
    expect(hideOf(1)).toBeUndefined();
  });

  it("Hide in every design, then Show in every design; one undo step each", async () => {
    const h0 = history();
    let m = await menu(1);
    expect(m.all.textContent).toBe("Hide in every design");
    await act(async () => { fireEvent.click(m.all); }); await confirmed(h0 + 1);
    expect(hideOf(1)).toEqual({ glass: true, excel: true, clean: true, mckinsey: true, bain: true });
    expect(get().deck.history.undoLabel).toBe("Hide in every design");
    m = await menu(1);
    expect(m.all.textContent).toBe("Show in every design");
    expect(m.hide.textContent).toMatch(/^Show slide/);
    await act(async () => { fireEvent.click(m.all); }); await confirmed(h0 + 2);
    expect(hideOf(1)).toBeUndefined();
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(Object.keys(hideOf(1)!)).toHaveLength(5);
    await act(async () => undo(false)); await confirmed(h0);
    expect(hideOf(1)).toBeUndefined();
    expect(hideSlide("no-such-slide")).toBe(false);                      // no such slide
  });

  // review of S13.6, 1: hiding slide k renumbers every other slide ("n / N"), so every thumbnail must be asked for again
  // (the worker redraws only those whose display list changed), after undo / redo too. A hide is a preset change: the
  // page makes its slides again and redraws every thumbnail (app.ts onDocChange, presetChanged) – this guards it
  it("a hide, its undo and its redo redraw every thumbnail (their page numbers moved)", async () => {
    const refresh = vi.spyOn(THUMBS, "refresh"), render = vi.spyOn(THUMBS, "render"), h0 = history();
    const all = () => render.mock.calls.length > 0 || refresh.mock.calls.some(c => c[0] === undefined);
    try {
      await act(async () => gotoSlide(1)); await settle();
      for (const step of [() => { hideSlide(get().deck.slides[1].id); }, () => undo(false), () => undo(true), () => undo(false)]) {
        refresh.mockClear(); render.mockClear();
        await act(async () => { step(); }); await settle();
        await vi.waitFor(() => expect(all()).toBe(true));
      }
      await confirmed(h0);
    } finally { refresh.mockRestore(); render.mockRestore(); }
  });

  // review of S13.6, 2: the menu keeps the slide by id – a slide added before it while the menu is open (another
  // writer's slide.add) does not make Hide slide hide another slide
  it("the menu hides the slide right-clicked even when a slide was added before it meanwhile", async () => {
    const h0 = history(), d = style().design, id = get().deck.slides[1].id;
    const m = await menu(1);
    await act(async () => { change("New slide", [{ op: "slide.add", slide: { id: "zz-other", type: "content", tables: [] }, after: null } as Op]); });
    await confirmed(h0 + 1);
    expect(get().deck.slides[1].id).not.toBe(id);                       // the positions moved under the open menu
    await act(async () => { fireEvent.click(document.getElementById("ctxHideSlide") ?? m.hide); }); await confirmed(h0 + 2);
    const byId = (x: string) => get().doc.view!.preset!.slides.find(s => s.id === x)!;
    expect(byId(id).hide).toEqual({ [d]: true });
    expect(get().doc.view!.preset!.slides.filter(s => s.hide).map(s => s.id)).toEqual([id]);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(get().deck.slides.some(R => R.id === "zz-other")).toBe(false);
  });

  // review of S13.6, 3: every version × design and Run for each value skip a design whose every slide is hidden (a
  // note says so); every chosen design: refused before any job starts (the export worker said "nothing to export"
  // part-way through)
  it("every version × design and Run for each value: a design with every slide hidden is skipped; all of them refused", async () => {
    const h0 = history(), ids = get().deck.slides.map(R => R.id);
    await act(async () => { change("Hide all", ids.map(id => ({ op: "slide.patch", id, patch: { hide: { bain: true, mckinsey: true } } } as Op))); });
    await confirmed(h0 + 1);
    const s = shownDesigns(["glass", "bain", "excel", "mckinsey"]);
    expect(s.list).toEqual(["glass", "excel"]);
    expect(s.skipped).toEqual(["bain", "mckinsey"]);
    expect(s.note).toMatch(/skipped: every slide is hidden there$/);
    expect(shownDesigns(["glass"]).note).toBe("");
    // all chosen designs empty: refused, nothing starts
    const versions = [{ id: "v1", name: "Chief" }];
    await act(async () => { change("Versions", [{ op: "preset.set", preset: { ...get().doc.view!.preset!, versions } } as Op]); });
    await confirmed(h0 + 2);
    await act(async () => { await exportVersions(["bain", "mckinsey"]); });
    expect(get().ui.exporting).toBe(false);
    expect(get().ui.toast?.html).toMatch(/^Every slide is hidden in .*: show one/);
    const form = { ...get().ui.scenario, input: "x!A1", values: "1", designs: ["bain"] as never, versions: [""] };
    await act(async () => { expect(await startRun(form)).toBeNull(); });
    expect(get().ui.run).toBeNull();
    expect(get().ui.toast?.html).toMatch(/^Every slide is hidden in .*to run for each value/);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(get().doc.view!.preset!.slides.some(x => x.hide)).toBe(false);
  });
});
