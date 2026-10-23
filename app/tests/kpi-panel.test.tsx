/* B54: KPI cards from table (header names, else the column order; N cards across the slide in ONE undo step) and the KPI
   card panel – title, value cell, rows added / removed / reordered, source, label, direction, format – each ONE
   item.patch; usable at a 280 px side panel. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { gotoSlide, openLocalFile, undo } from "../src/state/app";
import { itemOf, selectItem } from "../src/editor/charts";
import { insertKpiCards, kpiCardsFromTable, kpiColumns, kpiRefPatch, moveRow, sourcePatch } from "../src/editor/kpi";
import { paintItem, startPainter, stopPainter } from "../src/editor/painter";
import type { KpiItem, Op } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf } from "@slide-builder/core/model/ops";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
const IMG16 = ["Product", "Current", "Budget_reference", "Previous_week", "EoM_reference", "Delta_vs_Budget", "Delta_vs_prev_Week", "Delta_vs_EoM"];

describe("KPI cards from table (editor/kpi.ts)", () => {
  it("image 16's headers: product, current, three computed rows labelled vs Bdg / vs prev. Week / vs EoM; 4 cards evenly across", () => {
    const cards = kpiCardsFromTable("KPI", "A1:H5", IMG16);
    expect(cards).toHaveLength(4);
    expect(cards[1]).toMatchObject({ kind: "kpi", head: { sheet: "KPI", range: "A3" }, cur: { sheet: "KPI", range: "B3" } });
    expect(cards[1].rows).toEqual([
      { src: { ref: { sheet: "KPI", range: "C3" }, mode: "pct" }, label: "vs Bdg", good: "up" },
      { src: { ref: { sheet: "KPI", range: "D3" }, mode: "pct" }, label: "vs prev. Week", good: "up" },
      { src: { ref: { sheet: "KPI", range: "E3" }, mode: "pct" }, label: "vs EoM", good: "up" }]);
    const xs = cards.map(c => c.box.x), w = cards[0].box.w;
    expect(xs[0]).toBe(56); expect(xs[3] + w).toBeGreaterThan(1540); expect(xs[3] + w).toBeLessThanOrEqual(1545);
    expect(new Set(cards.map(c => c.box.w)).size).toBe(1);
  });
  it("delta columns alone become cell rows; other orders map by name; no known names: the column order", () => {
    const c = kpiCardsFromTable("S", "B2:E3", ["Delta_vs_EoM", "Current", "Product", "Delta_vs_Budget"])[0];
    expect(c.head).toEqual({ sheet: "S", range: "D3" }); expect(c.cur).toEqual({ sheet: "S", range: "C3" });
    expect(c.rows!.map(r => [r.label, r.src])).toEqual([["vs EoM", { cell: { sheet: "S", range: "B3" } }], ["vs Bdg", { cell: { sheet: "S", range: "E3" } }]]);
    expect(kpiColumns(["a", "b", "c"], 1)).toBeNull();
    const f = kpiCardsFromTable("S", "A1:E2", ["Loans", "x", "y", "z", "w"])[0];
    expect([f.head, f.cur, f.rows!.map(r => r.label)]).toEqual([{ sheet: "S", range: "A2" }, { sheet: "S", range: "B2" }, ["vs Bdg", "vs prev. Week", "vs EoM"]]);
    expect(kpiCardsFromTable("S", "A1:E1", IMG16)).toEqual([]);
  });
  it("more than 4 rows wrap into a grid of at most 4 a row, every card the same usable size (10 rows, 63 rows)", () => {
    const ten = kpiCardsFromTable("KPI", "A1:H11", IMG16);
    expect(ten).toHaveLength(10);
    expect(new Set(ten.map(c => c.box.y)).size).toBe(3);
    expect(ten.slice(0, 4).map(c => c.box.y)).toEqual([170, 170, 170, 170]);
    expect(ten[4].box.y).toBe(170 + ten[0].box.h + 24); expect(ten[4].box.x).toBe(56);
    expect(ten.every(c => c.box.w === ten[0].box.w && c.box.w > 300)).toBe(true);
    const many = kpiCardsFromTable("KPI", "A1:H64", IMG16);
    expect(many).toHaveLength(63); expect(many.every(c => c.box.w > 300 && c.box.h > 0)).toBe(true);
  });
  it("a first row of numbers is data, not headers; Current is not Currency; a second column of the same kind is reported", () => {
    const d = kpiCardsFromTable("S", "A1:C2", ["10", "9,9", ""]);
    expect(d).toHaveLength(2); expect(d[0].cur).toEqual({ sheet: "S", range: "B1" });
    expect(kpiColumns(["Product", "Currency", "Current"], 1)).toMatchObject({ current: 3 });
    const out: { dups?: string[] } = {};
    const c = kpiCardsFromTable("S", "A1:E2", ["Product", "Current", "Budget_reference", "EoM_reference", "EoM_budget"], out)[0];
    expect(out.dups).toEqual(["EoM_budget"]);
    expect(c.rows!.map(r => r.label)).toEqual(["vs Bdg", "vs EoM"]);
  });
  it("a row's cell asked for, then the rows reordered: the cell goes to that row, wherever it is now; a row gone gets nothing", () => {
    const k = kpiCardsFromTable("KPI", "A1:H2", IMG16)[0], src = JSON.stringify(k.rows![0].src);
    const moved = { ...k, rows: [k.rows![1], k.rows![0], k.rows![2]] };
    const p = kpiRefPatch(moved, "row:0", { sheet: "KPI", range: "Z9" }, src) as { rows: KpiItem["rows"] };
    expect(p.rows![1].src).toEqual({ ref: { sheet: "KPI", range: "Z9" }, mode: "pct" }); expect(p.rows![0]).toEqual(k.rows![1]);
    expect(kpiRefPatch({ ...k, rows: [k.rows![2]] }, "row:0", { sheet: "KPI", range: "Z9" }, src)).toBeNull();
  });
  it("the builders are plain patches undone by their inverse", () => {
    const k = kpiCardsFromTable("KPI", "A1:H2", IMG16)[0];
    const doc = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "k", patch: k }] as Op[]).doc;
    for (const p of [moveRow(k, 0, 1), sourcePatch(k, 1, "cell"), kpiRefPatch(k, "row:2", { sheet: "KPI", range: "H2:H3" }), kpiRefPatch(k, "head", { sheet: "T", range: "A9" })]) {
      const o = { op: "item.patch", slide: "s", id: "k", patch: p } as Op, inv = inverseOf(doc, o)!;
      expect(applyOps(applyOps(doc, [o]).doc, [inv]).doc.preset!.slides[0].items!.k).toEqual(k);
    }
    expect(moveRow(k, 0, 1).rows.map(r => r.label)).toEqual(["vs prev. Week", "vs Bdg", "vs EoM"]);
    expect(sourcePatch(k, 1, "cell")!.rows[1].src).toEqual({ cell: { sheet: "KPI", range: "D2" } });
    expect((kpiRefPatch(k, "row:2", { sheet: "KPI", range: "H2:H3" }) as { rows: KpiItem["rows"] }).rows![2].src).toEqual({ ref: { sheet: "KPI", range: "H2" }, mode: "pct" });
  });
});

async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const panel = () => document.getElementById("kpiPanel")!;
const q = (sel: string) => panel().querySelector(sel) as HTMLElement;
async function type(el: HTMLElement, v: string) { await act(async () => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); }); }

describe("KPI cards on the page", () => {
  let ids: string[] = [];
  const k = (i = 0) => itemOf(ids[i]) as KpiItem;
  async function step(fn: () => Promise<void>, label?: string) { const h = history(); await fn(); await confirmed(h + 1); if (label) expect(get().deck.history.undoLabel).toBe(label); }
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
    const si = get().deck.slides.findIndex(R => R.tables.some(T => T.def?.sheet === "SLIDE_1"));
    await act(async () => gotoSlide(si)); await settle();
  });
  afterAll(() => cleanup());

  it("Insert: N cards in one undo step, each its own item; the panel opens on the first", async () => {
    const h0 = history();
    await act(async () => { ids = await insertKpiCards("SLIDE_1", "C5:F8"); });
    await confirmed(h0 + 1);
    expect(ids).toHaveLength(3);
    expect(get().deck.history.undoLabel).toBe("Insert 3 KPI cards");
    expect(new Set(ids.map(id => JSON.stringify(k(ids.indexOf(id)).cur))).size).toBe(3);
    await vi.waitFor(() => expect(panel()).toBeTruthy());
    expect(panel().dataset.item).toBe(ids[0]);
  });
  it("the panel: title, value format, direction, rows added / moved / removed, source, label, row format – one step each", async () => {
    await step(() => type(q("#kpiTitle"), "Deposits"), "KPI card title");
    expect(k().head).toBe("Deposits");
    await step(async () => { fireEvent.click(q('[data-good="cur"] [data-g="down"]')); }, "KPI value direction");
    expect(k().good).toBe("down");
    await step(() => type(q("#kpiNum"), "#,##0.0"), "KPI value format");
    expect(k().num).toBe("#,##0.0");
    const n0 = k().rows!.length;
    await step(async () => { fireEvent.click(q("#kpiAddRow")); }, "Add KPI row");
    expect(k().rows).toHaveLength(n0 + 1);
    const row = (i: number) => q(`[data-row="${i}"]`);
    await step(() => type(row(n0).querySelector('[data-a="label"]') as HTMLElement, "vs Plan"), "KPI row label");
    await step(async () => { fireEvent.click(row(n0).querySelector('[data-a="up"]')!); }, "Move KPI row");
    expect(k().rows![n0 - 1].label).toBe("vs Plan");
    await step(async () => { fireEvent.click(row(n0 - 1).querySelector('[data-src="both"]')!); }, "KPI row source");
    expect(k().rows![n0 - 1].src).toMatchObject({ mode: "both" });
    await step(async () => { fireEvent.click(row(n0 - 1).querySelector('[data-good] [data-g="neutral"]')!); }, "KPI row direction");
    expect(k().rows![n0 - 1].good).toBe("neutral");
    await step(() => type(row(n0 - 1).querySelector('[data-a="num"]') as HTMLElement, "0%"), "KPI row format");
    expect(k().rows![n0 - 1].num).toBe("0%");
    await step(async () => { fireEvent.click(row(n0 - 1).querySelector('[data-a="remove"]')!); }, "Remove KPI row");
    expect(k().rows!.map(r => r.label)).not.toContain("vs Plan");
    const h = history(); await act(async () => undo(false)); await confirmed(h - 1);
    expect(k().rows!.map(r => r.label)).toContain("vs Plan");
    // the cells are picked in the sheet view: one cell
    await act(async () => { fireEvent.click(q("#kpiCur")); });
    expect(get().ui.dialogs.pick).toEqual({ kind: "kpi-ref", id: ids[0], what: "cur" });
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    // the other cards are untouched
    expect(k(1).head).toEqual({ sheet: "SLIDE_1", range: "C7" });
  });
  it("the format painter copies a card's direction to another card; its toast names KPI cards", async () => {
    await act(async () => { selectItem(ids[0]); startPainter(false); }); await settle();
    expect(get().selection.painter?.obj?.kind).toBe("kpi");
    expect(get().ui.toast?.html).toContain("another KPI card"); expect(get().ui.toast?.html).toContain("several KPI cards");
    const h = history();
    await act(async () => { expect(paintItem(ids[2], false)).toBe(true); }); await confirmed(h + 1);
    expect(k(2).good).toBe("down"); expect(k(2).rows).toEqual(k(2).rows);
    await act(async () => stopPainter());
    await act(async () => { selectItem(ids[0]); }); await settle();
  });
  it("the picker opens on the card's own sheet", async () => {
    await act(async () => { fireEvent.click(q("#kpiTitleCell")); }); await settle();
    await vi.waitFor(() => expect(document.getElementById("pkSheet")).toBeTruthy());
    expect((document.getElementById("pkSheet") as HTMLSelectElement).value).toBe("SLIDE_1");
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
  });
  it("clearing the title removes it (not an empty text)", async () => {
    await step(() => type(q("#kpiTitle"), ""), "KPI card title");
    expect(k()).not.toHaveProperty("head");
  });
  it("fits a 280 px side panel: no fixed widths, rows wrap", () => {
    const html = panel().outerHTML;
    expect(html).not.toMatch(/width:\s*[3-9]\d\dpx/);
    for (const el of panel().querySelectorAll<HTMLElement>(".kpirow > div")) expect(el.style.flexWrap).toBe("wrap");
  });
});
