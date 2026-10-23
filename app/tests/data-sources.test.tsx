/* B57: the Data sources panel on the page – the B54 workbook's chart card and KPI card (core/tests/b54-deck.ts) and a range
   table: each reference with its address and status; Remember headers; the workbook opened again as saved after the
   owner's move (2 rows inserted above, the Volume column moved from C to E: core/tests/b57-book.ts) – moved? in the panel
   and under Issues with Repoint…; Find the block's preview and ONE undo step; Change… (the sheet view on the reference's
   own cells: only that reference changes); Move all by… and Change sheet… previews; Follow header; the table's panel
   (its range and its settings moved); usable at 280 px. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, openLocalFile, undo } from "../src/state/app";
import { itemOf, selectItem } from "../src/editor/charts";
import { applySrcPick, tableTo, itemRows, planMove, planSheetChange, resetPrevious, slideSrcIssues, type SrcPick } from "../src/editor/datasources";
import { openTableSources } from "../src/ui/DataSources";
import type { ChartItem, KpiItem, Op } from "@slide-builder/core/model/types";
import { b54Ops } from "../../core/tests/b54-deck";
import { movedB54 } from "../../core/tests/b57-book";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
const BOOK = fs.readFileSync(path.join(here, "fixtures/B54.xlsx"));
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
async function step(fn: () => Promise<void> | void, label?: string) { const h = history(); await act(async () => { await fn(); }); await confirmed(h + 1); if (label) expect(get().deck.history.undoLabel).toBe(label); }
const panel = () => document.getElementById("dataSources")!;
const q = (sel: string) => panel().querySelector(sel) as HTMLElement;
const status = (path: string) => (panel().querySelector(`[data-path="${path}"]`) as HTMLElement | null)?.dataset.status;
async function open(bytes: Uint8Array) {
  const opening = openLocalFile(new File([bytes as Uint8Array<ArrayBuffer>], "B54.xlsx"));
  await vi.waitFor(() => expect(get().ui.dialogs.dialog || get().deck.opening === "").toBeTruthy(), { timeout: 20_000 });
  await act(async () => { get().ui.dialogs.dialog?.resolve("continue"); await opening; });
  await settle(12);
}
const chart = () => itemOf("cd") as ChartItem;
const kpi = () => itemOf("k2") as KpiItem;

describe("Data sources on the page (B57)", () => {
  beforeAll(async () => {
    resetPrevious();
    const { applyOps, emptyDoc } = await import("@slide-builder/core/model/ops");
    const ops: Op[] = [...b54Ops("s"), { op: "table.add", slide: "s", table: { id: "tv", sheet: "Volumes", kind: "range", range: "A1:D9", rows: { 3: 30 } } } as Op];
    const { doc } = applyOps(emptyDoc("B54.xlsx"), ops);
    localStorage.setItem("sb3:doc:B54.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: doc.preset, style: {}, edits: { Volumes: { C4: { b: true } } } }));
    render(<App />);
    await open(new Uint8Array(BOOK));
    expect(get().deck.slides[get().deck.cur].cfg.items?.cd).toBeTruthy();
  });
  afterAll(() => cleanup());

  it("the chart card's panel: every reference with its address and OK; folded when nothing is wrong, opened by a click", async () => {
    await act(async () => selectItem("cd")); await settle();
    expect(panel()).toBeTruthy();
    expect(panel().querySelector("#srcList")).toBeNull();                              // (folded: nothing to check)
    await act(async () => { fireEvent.click(q("#srcToggle")); });
    const rows = [...panel().querySelectorAll<HTMLElement>(".srcrow")];
    // (a line chart with series: its top-level values – drawn only as a pie – are not listed; the bulk repoints move them)
    expect(rows.map(r => r.querySelector("b")!.textContent)).toEqual(["Category names", "Series 1 “Deposits” values", "“Budget” line value", "Filter column"]);
    expect(rows.map(r => r.dataset.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(rows.map(r => r.querySelector("code")!.textContent)).toEqual(["Volumes!B2:B9", "Volumes!C2:C9", "Volumes!D6", "Volumes!A2:A9"]);
    expect(document.getElementById("srcIssues")).toBeNull();
  });
  it("(4.14 integration) the pie fallback: not in a line chart's own list or Issues lines, listed on a pie; the bulk repoints move it, as \"(pie fallback)\"", async () => {
    const c = chart();
    expect(itemRows(c).map(r => r.slot.path)).not.toContain("values");
    expect(itemRows(c, true).find(r => r.slot.path === "values")?.slot.label).toBe("Values (pie fallback)");
    expect(itemRows({ ...c, type: "pie" }).map(r => r.slot.path)).toContain("values");
    expect(itemRows({ ...c, type: "donut" }).map(r => r.slot.path)).toContain("values");
    const { sers: _s, ...plain } = c;
    expect(itemRows(plain as ChartItem).find(r => r.slot.path === "values")?.slot.label).toBe("Values");
    const p = planMove({ item: "cd" }, "item", "Volumes", { dr: 2, dc: 0 });
    expect(p.rows.map(r => r.what)).toContain("Values (pie fallback)");
    expect(p.rows.find(r => r.what === "Values (pie fallback)")).toMatchObject({ from: "Volumes!C2:C9", to: "Volumes!C4:C11" });
  });
  it("Remember headers: one step, the binds stored (format 10's `bind`), nothing else changed", async () => {
    const before = JSON.stringify({ ...chart(), bind: undefined });
    await step(() => { fireEvent.click(q("#srcRemember")); }, "Remember headers");
    expect(chart().bind!["sers.vol.vals.0"]).toEqual({ at: "Volumes!C2:C9", h: "Volume_EUR_m", hr: 1, l: "Q3", lc: 1 });
    expect(JSON.stringify({ ...chart(), bind: undefined })).toBe(before);
    await act(async () => selectItem("k2")); await settle();
    await act(async () => { fireEvent.click(q("#srcToggle")); });
    expect([...panel().querySelectorAll<HTMLElement>(".srcrow b")].map(b => b.textContent)).toEqual(["KPI title", "KPI value", "Row 1 “vs Bdg” reference", "Row 2 “vs prev. Week” reference", "Row 3 “vs EoM” reference"]);
    await step(() => { fireEvent.click(q("#srcRemember")); }, "Remember headers");
  });
  it("the workbook again, as saved after the move: moved? in the panel and under Issues, with Repoint…", async () => {
    await open(movedB54(new Uint8Array(BOOK)));
    await act(async () => selectItem("cd")); await settle();
    expect(status("sers.vol.vals.0")).toBe("moved");
    expect(status("filter.by")).toBe("moved");
    expect(q('[data-path="sers.vol.vals.0"] .srcwhy').textContent).toContain("“Volume_EUR_m” is no longer at C1");
    expect(q("#srcBad").textContent).toMatch(/\d+ to check/);
    const iss = document.getElementById("srcIssues")!;
    expect(iss.textContent).toContain("Chart 2"); expect(iss.textContent).toContain("moved?");
    expect(iss.textContent).toContain("KPI card 2");
    expect(slideSrcIssues().map(x => x.name)).toEqual(expect.arrayContaining(["Chart 1", "Chart 2", "KPI card 2"]));
    // the item's own line (the core's, from its binds)
    expect(document.getElementById("issues")!.textContent).toContain("the cells moved?");
    // Repoint… selects the object and opens its panel
    await act(async () => { fireEvent.click(iss.querySelector('[data-target="k2"] [data-a="repoint"]')!); }); await settle();
    expect(get().selection.itemSel?.id).toBe("k2");
    expect(status("cur")).toBe("moved");
  });
  it("Find the block: a preview of every old → new address, then ONE undo step; the right numbers; undo restores", async () => {
    await act(async () => selectItem("cd")); await settle();
    const was = JSON.stringify(chart());
    await act(async () => { fireEvent.click(q("#srcFind")); });
    const pv = q("#srcPreview");
    const lines = [...pv.querySelectorAll("li")].map(li => li.textContent);
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining("Volumes!C2:C9 → Volumes!E4:E11"), expect.stringContaining("Volumes!A2:A9 → Volumes!A4:A11"), expect.stringContaining("Volumes!D6 → Volumes!C8")]));
    await step(() => { fireEvent.click(q("#srcApply")); }, "Find the block");
    expect(chart().sers!.vol.vals).toEqual([{ sheet: "Volumes", range: "E4:E11" }]);
    expect(chart().marks!.r1.value).toEqual({ sheet: "Volumes", range: "C8" });
    expect(chart().title).toBe("DEPOSITS · WEEKLY VOLUME");                            // (the card kept)
    expect(itemRows(chart()).every(r => r.check.status === "ok")).toBe(true);
    const h = history(); await act(async () => undo(false)); await confirmed(h - 1);
    expect(JSON.stringify(chart())).toBe(was);
    await act(async () => undo(true)); await confirmed(h);
  });
  it("Change…: the sheet view on the reference's own sheet and cells; only that reference changes, one step", async () => {
    await act(async () => selectItem("k2")); await settle();
    await act(async () => { fireEvent.click(q('[data-path="cur"] [data-a="change"]')); }); await settle();
    const pick = get().ui.dialogs.pick as SrcPick;
    expect(pick).toEqual({ kind: "src", target: { item: "k2" }, path: "cur", label: "KPI value", sheet: "KPI", range: "B3", one: true });
    await vi.waitFor(() => expect((document.getElementById("pkSheet") as HTMLSelectElement | null)?.value).toBe("KPI"));
    expect(document.getElementById("pickCells")!.textContent).toContain("Data sources: KPI value");
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    const rows = JSON.stringify(kpi().rows), head = JSON.stringify(kpi().head);
    await step(() => applySrcPick(pick, "KPI", "B5"), "Data sources · KPI value");
    expect(kpi().cur).toEqual({ sheet: "KPI", range: "B5" });
    expect(JSON.stringify(kpi().rows)).toBe(rows); expect(JSON.stringify(kpi().head)).toBe(head);
    expect(kpi().bind!.cur).toMatchObject({ at: "KPI!B5", h: "Current", l: "Deposits" });
    expect(status("cur")).toBe("ok");
  });
  it("Move all by… 2 rows (the KPI card's rows) and Change sheet…: previews first, one step each", async () => {
    const p = planMove({ item: "k2" }, "item", "KPI", { dr: 2, dc: 0 });
    expect(p.rows.map(r => `${r.from} → ${r.to}`)).toEqual(["KPI!A3 → KPI!A5", "KPI!B5 → KPI!B7", "KPI!C3 → KPI!C5", "KPI!D3 → KPI!D5", "KPI!E3 → KPI!E5"]);
    // the panel's own: rows 2, preview, apply
    await act(async () => { fireEvent.click(q("#srcMove > summary")); });
    await act(async () => { fireEvent.change(q("#srcDr"), { target: { value: "2" } }); fireEvent.change(q("#srcSheet"), { target: { value: "KPI" } }); });
    await act(async () => { fireEvent.click(q("#srcMovePrev")); });
    expect(q("#srcPreview").textContent).toContain("KPI!C3 → KPI!C5");
    await step(() => { fireEvent.click(q("#srcApply")); }, "Move by 2 rows, 0 columns");
    expect(kpi().head).toEqual({ sheet: "KPI", range: "A5" });
    expect(kpi().rows!.map(r => "ref" in r.src ? r.src.ref.range : "")).toEqual(["C5", "D5", "E5"]);
    expect(itemRows(kpi()).every(r => r.check.status === "ok")).toBe(true);
    const sh = planSheetChange({ item: "k2" }, "slide", "KPI", "Volumes");
    expect(sh.ops.length).toBe(4);                                                    // (the four KPI cards, one patch each)
    expect(sh.rows.every(r => r.from.startsWith("KPI!") && r.to!.startsWith("Volumes!"))).toBe(true);
  });
  it("Follow header: the reference reads under its header wherever it moves – no repoint after another column move", async () => {
    await act(async () => selectItem("cl")); await settle();
    if (!panel().querySelector("#srcList")) await act(async () => { fireEvent.click(q("#srcToggle")); });
    await act(async () => { fireEvent.click(q("#srcFind")); });
    await step(() => { fireEvent.click(q("#srcApply")); }, "Find the block");
    await step(() => { fireEvent.click(q('[data-path="sers.vol.vals.0"] [data-a="follow"]')); }, "Follow header");
    expect((itemOf("cl") as ChartItem).bind!["sers.vol.vals.0"].f).toBe(true);
    // the Volume column back from E to C (the original workbook, 2 rows down)
    await open(movedB54(new Uint8Array(BOOK), { swap: false }));
    await act(async () => selectItem("cl")); await settle();
    expect(status("sers.vol.vals.0")).toBe("ok");
    expect(q('[data-path="sers.vol.vals.0"] [data-a="now"]').textContent).toContain("Volumes!C4:C11");
    expect((itemOf("cl") as ChartItem).sers!.vol.vals).toEqual([{ sheet: "Volumes", range: "E4:E11" }]);   // (the stored fallback)
  });
  it("the table's panel (the ribbon's Data sources…): its range moved with its settings and cell edits, one step", async () => {
    await act(async () => { selectItem(null); openTableSources("tv"); }); await settle();
    expect(panel().dataset.target).toBe("t:tv");
    if (!panel().querySelector("#srcList")) await act(async () => { fireEvent.click(q("#srcToggle")); });
    expect(q('[data-path="table"] code').textContent).toBe("Volumes!A1:D9");
    const p = planMove({ table: "tv" }, "item", null, { dr: 2, dc: 0 });
    expect(p.rows[0]).toMatchObject({ what: "Table cells", from: "Volumes!A1:D9", to: "Volumes!A3:D11" });
    await act(async () => { fireEvent.click(q("#srcMove > summary")); });
    await act(async () => { fireEvent.change(q("#srcDr"), { target: { value: "2" } }); });
    await act(async () => { fireEvent.click(q("#srcMovePrev")); });
    await step(() => { fireEvent.click(q("#srcApply")); });
    const def = get().doc.view!.preset!.tables.find(t => t.id === "tv")!;
    expect(def).toMatchObject({ range: "A3:D11", rows: { 5: 30 } });
    expect(get().doc.view!.edits.Volumes).toEqual({ C6: { b: true } });
    const L = get().deck.slides[get().deck.cur].tables.find(t => t.def?.id === "tv")!;
    expect(L.g.r1 + 1).toBe(3);
    const h = history(); await act(async () => undo(false)); await confirmed(h - 1);
    expect(get().doc.view!.preset!.tables.find(t => t.id === "tv")).toMatchObject({ range: "A1:D9", rows: { 3: 30 } });
    expect(get().doc.view!.edits.Volumes).toEqual({ C4: { b: true } });
  });
  it("re-review nits: the sheet choice follows the scope; Apply makes the plan again (a change meanwhile: a new preview, a second click); a table to other cells of another sheet says its settings keep their coordinates", async () => {
    await act(async () => selectItem("cd")); await settle();
    if (!panel().querySelector("#srcList")) await act(async () => { fireEvent.click(q("#srcToggle")); });
    await act(async () => { fireEvent.click(q("#srcMove > summary")); });
    await act(async () => { fireEvent.change(q("#srcSheet"), { target: { value: "*" } }); });
    await act(async () => { fireEvent.change(q("#srcScope"), { target: { value: "slide" } }); });
    expect((q("#srcSheet") as HTMLSelectElement).value).toBe("Volumes");               // (not a stale "every sheet")
    await act(async () => { fireEvent.change(q("#srcScope"), { target: { value: "item" } }); });
    // a preview, then the chart changed by somebody else before Apply: the preview is made again, nothing applied
    await act(async () => { fireEvent.change(q("#srcDr"), { target: { value: "1" } }); fireEvent.change(q("#srcSheet"), { target: { value: "Volumes" } }); });
    await act(async () => { fireEvent.click(q("#srcMovePrev")); });
    expect(q("#srcPreview").textContent).toContain("Volumes!A4:A11 → Volumes!A5:A12");
    await step(() => { change("Other writer", [{ op: "item.patch", slide: "s", id: "cd", patch: { filter: { by: { sheet: "Volumes", range: "A1:A9" }, eq: "Deposits" } } } as Op]); });
    const h = history();
    await act(async () => { fireEvent.click(q("#srcApply")); }); await settle();
    expect(history()).toBe(h);
    expect(q("#srcChanged")).toBeTruthy();
    expect(q("#srcPreview").textContent).toContain("Volumes!A1:A9 → Volumes!A2:A10");
    await step(() => { fireEvent.click(q("#srcApply")); });
    expect(chart().filter!.by).toEqual({ sheet: "Volumes", range: "A2:A10" });
    expect(document.getElementById("srcPreview")).toBeNull();
    // a table to other cells of another sheet
    const def = get().doc.view!.preset!.tables.find(t => t.id === "tv")!;
    const p = tableTo(def, "KPI", "B2:E9")!;
    expect(p.notes.join(" ")).toMatch(/To another sheet at other cells: its column widths, row heights, merges.*keep their old coordinates/);
    expect(tableTo(def, "KPI", "A1:D9")!.notes.join(" ")).not.toMatch(/To another sheet/);
  });
  it("fits a 280 px side panel: no fixed widths, every control may shrink", () => {
    const html = panel().outerHTML;
    expect(html).not.toMatch(/width:\s*[3-9]\d\dpx/);
    const css = fs.readFileSync(path.join(here, "../src/ui/datasources.css"), "utf8");
    expect(css).not.toMatch(/(^|[;{])\s*width:\s*[2-9]\d\dpx/m);
    expect(css).toMatch(/\.srca code\{[^}]*min-width:0/);
    expect(css).toMatch(/flex-wrap:wrap/);
  });
});
