/* B49 (product owner 2026-10-21): the automated comment's border, thickness and colour – set in the comment dialog
   (Border: Design / None / 0.5 … 3 px; Auto, the Borders ▾ colours, any colour), saved in the comment's notes entry as
   `frame` with the rest of it: one slide.patch, one undo step; the dialog's preview shows it; reopened, the dialog
   shows what is set. (How it is drawn and exported: core/tests/note-frame.test.ts.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get, setDialogs } from "../src/state/store";
import { gotoSlide, openLocalFile, undo } from "../src/state/app";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
/** the automated comment of the slide (its notes entry with `auto`) */
const autoNote = (i: number) => Object.values(get().doc.view!.preset!.slides[i].notes || {}).find(n => n.auto);

describe("the comment's border in the comment dialog (B49)", () => {
  let si = 0;
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
    si = get().deck.slides.findIndex(s => s.tables.length > 0);
    expect(si).toBeGreaterThanOrEqual(0);
    await act(async () => gotoSlide(si)); await settle();
  });
  afterAll(() => cleanup());

  it("Design by default (no key); 2 px red: the preview, one slide.patch with frame, one undo step; reopened it shows them; None; Design again takes it off", async () => {
    const h0 = history();
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    expect($('#cmtFrame [data-fw="design"]').classList.contains("on")).toBe(true);
    expect($("#cmtPreview").style.border).toBe("");
    await act(async () => { fireEvent.click($('#cmtFrame [data-fw="2"]')); });
    await act(async () => { fireEvent.click($('#cmtFrame [data-fc="#C00000"]')); });
    expect($('#cmtFrame [data-fw="2"]').classList.contains("on")).toBe(true);
    expect($('#cmtFrame [data-fc="#C00000"]').classList.contains("on")).toBe(true);
    expect($("#cmtPreview").style.border).toMatch(/^2px solid (#C00000|rgb\(192, 0, 0\))$/i);
    await act(async () => { fireEvent.click($("#cmtInsert")); });
    await confirmed(h0 + 1);
    expect(autoNote(si)?.frame).toEqual({ w: 2, color: "#C00000" });
    // reopened: what is set
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    expect($('#cmtFrame [data-fw="2"]').classList.contains("on")).toBe(true);
    expect($('#cmtFrame [data-fc="#C00000"]').classList.contains("on")).toBe(true);
    // Auto colour keeps the weight; None; one step each
    await act(async () => { fireEvent.click($('#cmtFrame [data-fc=""]')); });
    await act(async () => { fireEvent.click($("#cmtInsert")); }); await confirmed(h0 + 2);
    expect(autoNote(si)?.frame).toEqual({ w: 2 });
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    await act(async () => { fireEvent.click($('#cmtFrame [data-fw="none"]')); });
    expect($("#cmtPreview").style.borderStyle).toBe("none");
    await act(async () => { fireEvent.click($("#cmtInsert")); }); await confirmed(h0 + 3);
    expect(autoNote(si)?.frame).toBe("none");
    // undo: back to the 2 px border of the design's colour, then the red one
    await act(async () => undo(false)); await confirmed(h0 + 2);
    expect(autoNote(si)?.frame).toEqual({ w: 2 });
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(autoNote(si)?.frame).toEqual({ w: 2, color: "#C00000" });
    // Design: the key goes
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    await act(async () => { fireEvent.click($('#cmtFrame [data-fw="design"]')); });
    await act(async () => { fireEvent.click($("#cmtInsert")); }); await confirmed(h0 + 2);
    expect(autoNote(si)).toBeTruthy();
    expect("frame" in autoNote(si)!).toBe(false);
  }, 60_000);
});
