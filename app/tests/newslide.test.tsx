/* New slide and Add table (S13.4, B40–B42, NS-01, NS-02; docs/next/09 §2.8, §3.9): the page with the core in-thread
   and the deck in this browser (offline). New slide adds a blank content slide titled "New slide" after the selected
   one, shows it with its title open for typing, one undo step; #newSlide, the slide list's right-click menu and Ctrl+M
   do it. Add table lists the deck's tables (on no slide first) and adds one (table.add); New table from cells adds a
   range table – its definition and its place on the slide in one undo step. Ids are unique per writer. */
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
import { installKeys } from "../src/editor/keys";
import { addRangeTable, addTable, newId, newSlide, tableChoices } from "../src/editor/slides";
import { useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import type { Preset } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
// (jsdom lays out nothing: the slide list scrolls the current slide into view)
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const preset = () => get().doc.view!.preset!;
const history = () => get().deck.history.undo;
/** waits until the worker has confirmed my changes (the history mirror counts them) and the slides are made again */
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }

describe("New slide, Add table (S13.4)", () => {
  let tableIds: string[] = [];
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    const p = defaultPreset(wb);
    // a table of the deck on no slide (the wizard maps it, no slide shows it)
    p.slides[p.slides.length - 1].tables = p.slides[p.slides.length - 1].tables.slice(0, -1);
    tableIds = p.tables.map(t => t.id);
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: p, style: {}, edits: {} }));
    render(<App />);
    installKeys();
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());       // "Saved preset found"
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    expect(get().deck.slides.length).toBeGreaterThan(1);
  });
  afterAll(() => cleanup());

  it("NS-01: #newSlide adds a blank slide after the selected one, shows it with the title open; one undo step", async () => {
    await act(async () => gotoSlide(0)); await settle();
    const n = get().deck.slides.length, ids = get().deck.slides.map(R => R.id), h0 = history();
    await act(async () => { fireEvent.click(document.getElementById("newSlide")!); });
    await confirmed(h0 + 1);
    const slides = get().deck.slides;
    expect(slides.length).toBe(n + 1);
    expect(slides.map(R => R.id).filter(id => !ids.includes(id))).toHaveLength(1);
    const added = slides[1];
    expect(ids).not.toContain(added.id);
    expect(added.type).toBe("content");
    expect(added.tables).toEqual([]);
    expect(added.cfg.title).toBe("New slide");
    expect(slides.filter((_, i) => i !== 1).map(R => R.id)).toEqual(ids);          // after slide 1, the others in order
    expect(get().deck.cur).toBe(1);                                               // shown
    await vi.waitFor(() => expect(useStage.getState().editor).toEqual({ kind: "text", key: "title" }), { timeout: 10_000 });
    expect(get().selection.textSel).toBe("title");
    // the title typed at once
    const input = document.querySelector<HTMLInputElement>("#stage input.inline-edit")!;
    expect(input.value).toBe("New slide");
    await act(async () => { input.value = "Outlook"; fireEvent.keyDown(input, { key: "Enter" }); });
    await confirmed(h0 + 2);
    expect(preset().slides[1].title).toBe("Outlook");
    // undo: the title, then the slide (one step)
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(get().deck.slides.map(R => R.id)).toEqual(ids);
  });

  it("NS-01: Ctrl+M and the slide list's right-click menu do the same, after the slide chosen", async () => {
    const ids = get().deck.slides.map(R => R.id), h0 = history();
    const last = ids.length - 1;
    await act(async () => gotoSlide(last)); await settle();
    useStage.setState({ editor: null });
    await act(async () => { fireEvent.keyDown(document.body, { key: "m", ctrlKey: true }); });
    await confirmed(h0 + 1);
    expect(get().deck.slides.length).toBe(ids.length + 1);
    expect(get().deck.slides[last + 1].cfg.title).toBe("New slide");              // after the last one: at the end
    expect(get().deck.cur).toBe(last + 1);
    await vi.waitFor(() => expect(useStage.getState().editor).toEqual({ kind: "text", key: "title" }), { timeout: 10_000 });
    await act(async () => { fireEvent.keyDown(document.querySelector("#stage input.inline-edit")!, { key: "Escape" }); });
    await settle();
    // right-click on the first slide's row: the menu, New slide after it
    const thumb = document.querySelector('.thumb[data-i="0"]')!;
    await act(async () => { fireEvent.contextMenu(thumb, { clientX: 40, clientY: 40 }); });
    expect(get().deck.cur).toBe(0);
    expect(document.getElementById("slideMenu")).not.toBeNull();
    await act(async () => { fireEvent.click(document.getElementById("ctxNewSlide")!); });
    await confirmed(h0 + 2);
    expect(document.getElementById("slideMenu")).toBeNull();
    expect(get().deck.slides.length).toBe(ids.length + 2);
    expect(get().deck.slides[1].cfg.title).toBe("New slide");
    expect(get().deck.cur).toBe(1);
    // two new slides, two ids, none of the deck's
    const fresh = get().deck.slides.map(R => R.id).filter(id => !ids.includes(id));
    expect(new Set(fresh).size).toBe(2);
    useStage.setState({ editor: null });
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(get().deck.slides.map(R => R.id)).toEqual(ids);
  });

  it("NS-02: Add table lists the deck's tables, on no slide first; a click adds one to the current slide, one undo step", async () => {
    const h0 = history();
    const rows = tableChoices(preset());
    expect(rows.map(r => r.def.id).sort()).toEqual([...tableIds].sort());
    expect(rows[0].on).toEqual([]);                                               // the table on no slide
    expect(rows.slice(1).every(r => r.on.length > 0)).toBe(true);
    // on a new slide
    await act(async () => { newSlide(); }); await confirmed(h0 + 1);
    useStage.setState({ editor: null });
    const R = get().deck.slides[get().deck.cur];
    expect(R.tables).toEqual([]);
    await act(async () => { fireEvent.click(document.getElementById("addTable")!); });
    const menu = document.getElementById("addTableMenu")!;
    const listed = [...menu.querySelectorAll<HTMLButtonElement>("[data-table]")].map(b => b.dataset.table);
    expect(listed).toEqual(rows.map(r => r.def.id));
    expect(menu.querySelector(`[data-table="${rows[0].def.id}"]`)!.textContent).toContain("on no slide");
    expect(menu.querySelectorAll("svg.tprev").length).toBeGreaterThan(0);          // small previews
    await act(async () => { fireEvent.click(menu.querySelector(`[data-table="${rows[0].def.id}"]`)!); });
    await confirmed(h0 + 2);
    const S = preset().slides.find(s => s.id === R.id)!;
    expect(S.tables).toEqual([rows[0].def.id]);
    expect(get().deck.slides[get().deck.cur].tables).toHaveLength(1);
    expect(tableChoices(preset())[0].on.length).toBeGreaterThan(0);               // on a slide now
    // there already: not again
    expect(addTable(rows[0].def)).toBe(false);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(preset().slides.find(s => s.id === R.id)!.tables).toEqual([]);
    expect(preset().tables.map(t => t.id)).toEqual(tableIds);                      // the definition stays
    await act(async () => undo(false)); await confirmed(h0);
  });

  it("NS-02: New table from cells… opens the sheet view; the new range table joins the deck and the slide in one undo step", async () => {
    const h0 = history();
    await act(async () => { newSlide(); }); await confirmed(h0 + 1);
    useStage.setState({ editor: null });
    const R = get().deck.slides[get().deck.cur];
    await act(async () => { fireEvent.click(document.getElementById("addTable")!); });
    await act(async () => { fireEvent.click(document.querySelector('#addTableMenu [data-a="table-pick"]')!); });
    expect(get().ui.dialogs.pick).toEqual({ kind: "table" });
    expect(document.querySelector("#pickCells b")!.textContent).toBe("New table from cells");
    await act(async () => { setDialogs({ pick: null }); });
    const sheet = preset().tables[0].sheet;
    let id: string | null = null;
    await act(async () => { id = addRangeTable(sheet, "B2:D6"); });
    expect(id).toMatch(/^t[0-9a-z]{10}$/);
    await confirmed(h0 + 2);
    expect(preset().tables.find(t => t.id === id)).toMatchObject({ sheet, kind: "range", range: "B2:D6" });
    expect(preset().slides.find(s => s.id === R.id)!.tables).toEqual([id]);
    await act(async () => undo(false)); await confirmed(h0 + 1);                // one step: off the slide
    expect(preset().slides.find(s => s.id === R.id)!.tables).toEqual([]);
    await act(async () => undo(false)); await confirmed(h0);
  });
});

describe("ids of new slides and tables (09 §2.8: unique per writer)", () => {
  it("random, 10 characters after the prefix; one that exists is made again", () => {
    const seq = [0.123456789, 0.123456789, 0.987654321];
    const r = vi.spyOn(Math, "random").mockImplementation(() => seq.shift() ?? 0.5);
    try {
      const first = newId("s", () => false);
      expect(first).toMatch(/^s[0-9a-z]{10}$/);
      const next = newId("s", x => x === first);
      expect(next).not.toBe(first);
      expect(next).toMatch(/^s[0-9a-z]{10}$/);
    } finally { r.mockRestore(); }
  });
  it("tableChoices: none for no deck; the deck's order within each group", () => {
    expect(tableChoices(null)).toEqual([]);
    const p = { sheets: [], tables: [{ id: "a", sheet: "S", kind: "range", range: "A1:B2" }, { id: "b", sheet: "S", kind: "range", range: "A1:B2" }, { id: "c", sheet: "S", kind: "range", range: "A1:B2" }],
      slides: [{ id: "s1", type: "content", tables: ["c", "a"] }, { id: "s2", type: "content", tables: ["a"] }] } as Preset;
    expect(tableChoices(p).map(r => [r.def.id, r.on])).toEqual([["b", []], ["a", [1, 2]], ["c", [1]]]);
  });
});
