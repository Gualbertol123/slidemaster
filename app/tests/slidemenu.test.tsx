/* Delete slide and Duplicate slide (S13.7, owner Q12; docs/next/09 §2.8, §3.9): the slide list's right-click menu next to
   New slide and Hide slide. Duplicate puts a copy of a content slide right after it – its tables (the same tables of the
   deck), text, hide, looks, free layout, its items under new ids – under a new id unique per writer, one slide.add, one
   undo step; the cover and the contents are not duplicated (the wizard keeps one of each). Delete asks first, then one
   slide.remove, one undo step; its tables stay in the deck; Delete in the slide list asks the same about the slide
   shown; the last slide is kept. (The exports of a copy: core/tests/slidemenu.test.ts; e2e: app.spec.ts "Delete slide and Duplicate slide".) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get, patch } from "../src/state/store";
import { change, gotoSlide, openLocalFile, style, undo } from "../src/state/app";
import { installKeys } from "../src/editor/keys";
import { deleteSlide, duplicateSlide } from "../src/editor/slides";
import type { Op, SlideDef } from "@slide-builder/core/model/types";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const preset = () => get().doc.view!.preset!;
const ids = () => preset().slides.map(s => s.id);
const thumb = (i: number) => document.querySelector(`.thumb[data-i="${i}"]`)!;
async function menu(i: number) {
  await act(async () => { fireEvent.contextMenu(thumb(i), { clientX: 40, clientY: 40 }); });
  return { dup: document.getElementById("ctxDupSlide") as HTMLButtonElement, del: document.getElementById("ctxDelSlide") as HTMLButtonElement };
}
/** the open question's answer ("ok" deletes, "cancel" keeps) */
async function answer(v: "ok" | "cancel") {
  await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
  await act(async () => { get().ui.dialogs.dialog!.resolve(v); }); await settle();
}

describe("Delete slide, Duplicate slide (S13.7)", () => {
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    const p = defaultPreset(wb);
    if (!p.slides.some(x => x.type === "cover")) p.slides.unshift({ id: "cv", type: "cover", title: null, subtitle: null, tables: [] });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: p, style: {}, edits: {} }));
    render(<App />);
    installKeys();
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    expect(get().deck.slides.filter(R => R.type === "content").length).toBeGreaterThan(1);
  });
  afterAll(() => cleanup());

  it("Duplicate slide: a copy right after it with a new id, shown; its items under new ids; one undo step", async () => {
    const k = preset().slides.findIndex(x => x.type === "content"), id = ids()[k], d = style().design, h0 = history();
    // the slide gets an item, a hidden design and a free layout first
    await act(async () => { change("Setup", [
      { op: "item.patch", slide: id, id: "ix1", patch: { kind: "shape", shape: "rect", text: "Watch", box: { x: 100, y: 100, w: 200, h: 80 } } },
      { op: "slide.patch", id, patch: { hide: { bain: true }, free: { [d]: { on: true, items: { "i:ix1": { x: 300, y: 300, w: 200, h: 80 } } } } } },
    ] as Op[]); });
    await confirmed(h0 + 1);
    const n0 = ids().length, orig = JSON.parse(JSON.stringify(preset().slides[k])) as SlideDef;
    await act(async () => gotoSlide(0)); await settle();
    const m = await menu(k);
    expect(m.dup.disabled).toBe(false);
    expect(m.dup.textContent).toBe("Duplicate slide");
    await act(async () => { fireEvent.click(m.dup); });
    await confirmed(h0 + 2);
    expect(document.getElementById("slideMenu")).toBeNull();
    expect(get().deck.history.undoLabel).toBe("Duplicate slide");
    expect(ids()).toHaveLength(n0 + 1);
    expect(new Set(ids()).size).toBe(n0 + 1);
    const copy = preset().slides[k + 1];
    expect(copy.id).not.toBe(id);
    expect(get().deck.cur).toBe(k + 1);                                         // the copy is shown
    const [nid] = Object.keys(copy.items!);
    expect(nid).not.toBe("ix1");
    expect(copy.items![nid]).toEqual(orig.items!.ix1);
    expect(copy.free![d]!.items).toEqual({ ["i:" + nid]: orig.free![d]!.items["i:ix1"] });
    const { id: _a, items: _b, free: _c, ...rest } = copy, { id: _d, items: _e, free: _f, ...rest0 } = orig;
    expect(rest).toEqual(rest0);                                                // tables, title, hide, … the same
    expect(preset().slides[k]).toEqual(orig);                                   // the original is as it was
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(ids()).toHaveLength(n0);
    await act(async () => undo(false)); await confirmed(h0);
    expect(preset().slides[k].items).toBeUndefined();
  });

  it("the cover is not duplicated (the menu's entry is off, the call refuses)", async () => {
    const c = preset().slides.findIndex(x => x.type === "cover"), h0 = history(), n0 = ids().length;
    const m = await menu(c);
    expect(m.dup.disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(duplicateSlide(ids()[c])).toBeNull();
    expect(get().ui.toast?.html).toMatch(/^Only content slides are duplicated/);
    expect(duplicateSlide("no-such-slide")).toBeNull();
    await settle();
    expect(history()).toBe(h0); expect(ids()).toHaveLength(n0);
  });

  it("Delete slide asks first: Cancel keeps it; Delete removes it (its tables stay in the deck), shows the next; one undo step", async () => {
    const k = preset().slides.findIndex(x => x.type === "content" && x.tables.length), id = ids()[k], ids0 = ids(), h0 = history();
    const tables0 = preset().tables.map(t => t.id), def0 = JSON.parse(JSON.stringify(preset().slides[k]));
    let m = await menu(k);
    await act(async () => { fireEvent.click(m.del); });
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    const q = get().ui.dialogs.dialog!;
    expect(q.title).toBe("Delete slide");
    expect(q.html).toContain(`Delete slide “${get().deck.slides[k].label}”?`);
    expect(q.html).toMatch(/stays? in the deck/);
    expect(q.buttons.find(b => b.id === "ok")).toMatchObject({ label: "Delete", danger: true });
    await answer("cancel");
    expect(ids()).toEqual(ids0); expect(history()).toBe(h0);
    m = await menu(k);
    await act(async () => { fireEvent.click(m.del); });
    await answer("ok");
    await confirmed(h0 + 1);
    expect(get().deck.history.undoLabel).toBe("Delete slide");
    expect(ids()).toEqual(ids0.filter(x => x !== id));
    expect(preset().tables.map(t => t.id)).toEqual(tables0);                    // the tables stay in the deck
    expect(get().deck.slides[get().deck.cur].id).toBe(ids0[k + 1] ?? ids0[k - 1]);
    await act(async () => undo(false)); await confirmed(h0);
    expect(ids()).toEqual(ids0);
    expect(preset().slides[k]).toEqual(def0);                                   // back where it was, as it was
  });

  it("Delete on a selected thumbnail asks the same", async () => {
    const k = ids().length - 1, id = ids()[k], ids0 = ids(), h0 = history();
    await act(async () => { fireEvent.click(thumb(k)); }); await settle();
    expect(get().deck.cur).toBe(k);
    await act(async () => { fireEvent.keyDown(thumb(k), { key: "Delete" }); });
    await answer("ok");
    await confirmed(h0 + 1);
    expect(ids()).toEqual(ids0.slice(0, -1));
    expect(get().deck.cur).toBe(k - 1);                                         // the last one: the one before is shown
    expect(ids()).not.toContain(id);
    // another key on a thumbnail, or Delete elsewhere with no selection, deletes nothing
    await act(async () => { fireEvent.keyDown(thumb(0), { key: "Backspace" }); }); await settle();
    expect(get().ui.dialogs.dialog).toBeNull();
    await act(async () => undo(false)); await confirmed(h0);
    expect(ids()).toEqual(ids0);
  });

  it("Delete in the slide list acts on the slide shown, not the focused thumbnail (review of S13.7, 2)", async () => {
    const ids0 = ids(), h0 = history();
    await act(async () => { fireEvent.click(thumb(1)); }); await settle();
    expect(get().deck.cur).toBe(1);
    await act(async () => { fireEvent.keyDown(thumb(1), { key: "PageDown" }); }); await settle();   // the stage moves, the focus stays
    expect(get().deck.cur).toBe(2);
    await act(async () => { fireEvent.keyDown(thumb(1), { key: "Delete" }); });
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    expect(get().ui.dialogs.dialog!.html).toContain(`Delete slide “${get().deck.slides[2].label}”?`);
    await answer("ok"); await confirmed(h0 + 1);
    expect(ids()).toEqual([...ids0.slice(0, 2), ...ids0.slice(3)]);
    await act(async () => undo(false)); await confirmed(h0);
    expect(ids()).toEqual(ids0);
  });

  it("Duplicate slide with no deck open does nothing, as New slide and Delete slide (review of S13.7, 3)", async () => {
    const ids0 = ids(), h0 = history(), id = preset().slides.find(x => x.type === "content")!.id;
    await act(async () => { patch("doc", { open: false }); });
    expect(duplicateSlide(id)).toBeNull();
    expect(await deleteSlide(id)).toBe(false);
    await act(async () => { patch("doc", { open: true }); }); await settle();
    expect(history()).toBe(h0); expect(ids()).toEqual(ids0);
  });

  it("the last slide is kept; a slide removed meanwhile (another writer) is not removed twice", async () => {
    const ids0 = ids(), h0 = history();
    // another writer removes the slide while the question is open: Delete then does nothing
    const id = ids0[ids0.length - 1];
    const q = deleteSlide(id);
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { change("Other", [{ op: "slide.remove", id } as Op]); }); await confirmed(h0 + 1);
    await act(async () => { get().ui.dialogs.dialog!.resolve("ok"); });
    expect(await q).toBe(false);
    await settle(); expect(history()).toBe(h0 + 1);
    // every slide but one gone: the menu's Delete is off and the call refuses
    await act(async () => { change("Others", ids().slice(1).map(x => ({ op: "slide.remove", id: x } as Op))); }); await confirmed(h0 + 2);
    expect(ids()).toHaveLength(1);
    const m = await menu(0);
    expect(m.del.disabled).toBe(true);
    await act(async () => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    expect(await deleteSlide(ids()[0])).toBe(false);
    expect(get().ui.toast?.html).toMatch(/^A deck keeps at least one slide/);
    expect(get().ui.dialogs.dialog).toBeNull();
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(ids()).toEqual(ids0);
  });
});
