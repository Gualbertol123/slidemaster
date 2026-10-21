/* B50 (product owner 2026-10-21): comments in the friend's macro's structure – the comment dialog's "Report – as the
   macro": a new comment starts in it with the plan and weekly sections; each section can be ticked off, moved, given a
   rule (always / last week of the month / first week / from day N), an alert threshold, a heading and its parts; saved
   with the comment in one slide.patch (one undo step). A comment made before keeps its settings and text until switched.
   (The text itself: core/tests/comment-macro.test.ts.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get, setDialogs } from "../src/state/store";
import { change, gotoSlide, openLocalFile, undo } from "../src/state/app";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import type { Op } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const autoNote = (i: number) => Object.values(get().doc.view!.preset!.slides[i].notes || {}).find(n => n.auto);
const autoKey = (i: number) => Object.entries(get().doc.view!.preset!.slides[i].notes || {}).find(([, n]) => n.auto)?.[0];

describe("the macro's structure in the comment dialog (B50)", () => {
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

  it("a new comment: the macro's structure, its sections with their rules; changed, saved in one step; reopened as saved; undo", async () => {
    const h0 = history();
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    expect($('#cmtMode [data-mode="macro"]').classList.contains("on")).toBe(true);
    const secs = () => $$("#cmtSections .cmtsec").map(e => e.dataset.sec);
    const first = secs();
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect($("#cmtPreview").textContent).toMatch(/ - (Budget Performance|Weekly Momentum)/);
    // the first section: only in the last week of the month, alert at -3 %, no concentration
    const sec0 = () => $(`#cmtSections .cmtsec[data-sec="${CSS.escape(first[0]!)}"]`);
    await act(async () => { fireEvent.change(sec0().querySelector("[data-when]")!, { target: { value: "monthEnd" } }); });
    await act(async () => { fireEvent.change(sec0().querySelector("[data-alert]")!, { target: { value: "-3" } }); });
    await act(async () => { fireEvent.click(sec0().querySelector('[data-part="share"]')!); });
    expect(sec0().querySelector(".cmtwhen")!.textContent).toMatch(/^(written on|left out on|no date found)/);
    // a second section moved first
    if (first.length > 1) { await act(async () => { fireEvent.click($(`#cmtSections .cmtsec[data-sec="${CSS.escape(first[1]!)}"] [data-move="up"]`)); }); expect(secs()).toEqual([first[1], first[0], ...first.slice(2)]); }
    await act(async () => { fireEvent.click($("#cmtInsert")); });
    await confirmed(h0 + 1);
    const auto = autoNote(si)!.auto!;
    expect(auto.mode).toBe("macro");
    const s0 = auto.sections!.find(s => s.g === first[0])!;
    expect(s0).toEqual({ g: first[0], when: "monthEnd", alert: -.03, share: false });
    expect(auto.sections!.map(s => s.g)).toEqual(first.length > 1 ? [first[1], first[0], ...first.slice(2)] : first);
    // reopened: as saved
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    expect($('#cmtMode [data-mode="macro"]').classList.contains("on")).toBe(true);
    expect((sec0().querySelector("[data-when]") as HTMLSelectElement).value).toBe("monthEnd");
    expect((sec0().querySelector("[data-alert]") as HTMLInputElement).value).toBe("-3");
    // ticked off: the section goes; one more step; undo brings it back
    await act(async () => { fireEvent.click(sec0().querySelector(".cmtsechd input")!); });
    expect(secs()).not.toContain(first[0]);
    await act(async () => { fireEvent.click($("#cmtInsert")); }); await confirmed(h0 + 2);
    expect(autoNote(si)!.auto!.sections!.map(s => s.g)).not.toContain(first[0]);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(autoNote(si)!.auto!.sections!.find(s => s.g === first[0])).toEqual(s0);
  }, 60_000);

  it("a comment made before keeps its structure and text; switched to the macro's, it is rewritten (one step)", async () => {
    const key = autoKey(si)!, slideId = get().deck.slides[si].id;
    const old = { text: "", auto: { groups: [], top: 2, noun: "country", detail: "full" as const, share: true, breadth: true, missing: true, mode: "summary" as const }, w: 440 };
    const h0 = history();
    await act(async () => { change("old comment", [{ op: "slide.patch", id: slideId, patch: { notes: { [key]: old } } } as Op]); }); await confirmed(h0 + 1);
    await act(async () => { setDialogs({ comment: { table: 0 } }); }); await settle();
    expect($$("#cmtMode .on").map(b => b.dataset.mode), JSON.stringify(autoNote(si))).toEqual(["summary"]);
    const before = $("#cmtPreview").textContent;
    expect(before).not.toMatch(/Budget Performance|Weekly Momentum/);
    await act(async () => { fireEvent.click($('#cmtMode [data-mode="macro"]')); });
    expect($("#cmtPreview").textContent).not.toBe(before);
    expect($$("#cmtSections .cmtsec").length).toBeGreaterThanOrEqual(1);
    await act(async () => { fireEvent.click($("#cmtInsert")); }); await confirmed(h0 + 2);
    expect(autoNote(si)!.auto!.mode).toBe("macro");
    expect(autoNote(si)!.auto!.sections!.length).toBeGreaterThanOrEqual(1);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(autoNote(si)!.auto).toEqual(old.auto);
  }, 60_000);
});
