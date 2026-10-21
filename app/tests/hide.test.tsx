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
import { get } from "../src/state/store";
import { gotoSlide, openLocalFile, style, styleChange, undo } from "../src/state/app";
import { hideSlide } from "../src/editor/slides";
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
    expect(hideSlide(99)).toBe(false);                                   // no such slide
  });
});
