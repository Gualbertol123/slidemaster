/* The icon picker and icon items (S15.2, IC-01; docs/next/09 §3.5): the page with the core in-thread and the deck in this
   browser (offline). The page's in-thread core has no icon set (only the workers carry it): the picker says so. With
   the set registered as the workers do (installTabler), Insert shape ▾ › More icons… opens the picker: a search by name
   and tag, the outline / filled switch, a category, a virtualised grid (only the rows in view drawn, their tiles asked as
   they scroll in), the colour, size and line width of the new icon, the recent icons; Change icon… swaps a selected
   icon, keeping its colour and size; the ribbon sets its size and line width; a name the set does not have gives the
   Issues line. Each change is one undo step. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { gotoSlide, openLocalFile } from "../src/state/app";
import { itemPatch, selectItem } from "../src/editor/charts";
import { TILE } from "../src/ui/IconPicker";
import { useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { setIconCatalog, setVendoredIcons } from "@slide-builder/core/render/icons";
import { installTabler } from "@slide-builder/core/icons/index";
import type { Prefs, ShapeItem } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = async (sel: string) => { const e = $(sel); expect(e, sel).toBeTruthy(); await act(async () => { fireEvent.click(e!); }); await settle(); };
const items = () => get().deck.slides[get().deck.cur].cfg.items || {};
const grid = () => $("#iconGrid")!;
const tiles = () => [...document.querySelectorAll<HTMLElement>("#iconGrid .ictile")];
async function openPicker() { await click("#shapeBtn"); await click("#moreIcons"); expect($("#iconPicker")).toBeTruthy(); }
async function type(q: string) {
  const input = $("#iconSearch") as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { value: q } }); });
  await vi.waitFor(() => expect(grid().dataset.q).toBe(q), { timeout: 10_000 }); await settle();
}

describe("the icon picker (S15.2, IC-01)", () => {
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
    await act(async () => gotoSlide(1)); await settle();
  });
  afterAll(() => { cleanup(); setIconCatalog(null); setVendoredIcons(null); });

  it("without the workers' icon set (the page's in-thread fallback) the picker says so", async () => {
    setIconCatalog(null); setVendoredIcons(null);
    await openPicker();
    await vi.waitFor(() => expect($("#iconNone")).toBeTruthy());
    await act(async () => { fireEvent.keyDown($("#iconSearch")!, { key: "Escape" }); }); await settle();
    expect($("#iconPicker")).toBeNull();
  });

  it("search by name and tag, outline / filled, a category; only the rows in view are drawn, tiles asked as they scroll in", async () => {
    installTabler();
    await openPicker();
    await vi.waitFor(() => expect(grid().dataset.n).toBe("5184"), { timeout: 10_000 }); await settle();
    // virtualised: the first screen's rows (and one more), never the 5,184
    expect(tiles().length).toBeGreaterThan(0);
    expect(tiles().length).toBeLessThanOrEqual(120);
    expect(tiles()[0].querySelectorAll("path").length).toBeGreaterThan(0);
    expect($("#iconCats")!.querySelectorAll("button").length).toBe(42);           // All + the set's 41 categories
    const first = tiles().map(t => t.dataset.icon!);
    // scrolled to row 40: rows 39… drawn, their path data asked from the worker
    await act(async () => { grid().scrollTop = 40 * TILE; fireEvent.scroll(grid()); }); await settle();
    await vi.waitFor(() => expect(tiles()[0].querySelectorAll("path").length).toBeGreaterThan(0));
    const ids = tiles().map(t => t.dataset.icon!);
    expect(ids.length).toBeLessThanOrEqual(120);
    expect(ids.some(x => first.includes(x))).toBe(false);                         // the first rows are not drawn now
    // words of the name or a tag
    await type("bank");
    expect(tiles()[0].dataset.icon).toBe("tabler:building-bank");
    await type("money");                                                          // a tag ("cash", "money"…)
    expect(+grid().dataset.n!).toBeGreaterThan(3);
    // the filled set
    await act(async () => { fireEvent.click($('#iconStyle [data-style="filled"]')!); });
    await vi.waitFor(() => expect(grid().dataset.style).toBe("filled")); await settle();
    expect(tiles().every(t => t.dataset.icon!.startsWith("tabler-filled:"))).toBe(true);
    await act(async () => { fireEvent.click($('#iconStyle [data-style="outline"]')!); });
    await vi.waitFor(() => expect(grid().dataset.style).toBe("outline")); await settle();
    // a category narrows the hits
    await type("");
    await act(async () => { fireEvent.click($('#iconCats [data-cat="Buildings"]')!); });
    await vi.waitFor(() => expect(+grid().dataset.n!).toBeLessThan(5184)); await settle();
    expect(tiles().map(t => t.dataset.icon)).toContain("tabler:building-bank");
    await act(async () => { fireEvent.keyDown($("#iconSearch")!, { key: "Escape" }); }); await settle();
  });

  it("insert: the chosen colour, size and line width; one undo step; drawn without an Issues line; then among the recent icons", async () => {
    await openPicker();
    await type("bank");
    await click('[data-iccolor="#C42B1C"]'); await click('#iconSize [data-size="96"]'); await click('#iconWidth [data-width="1.5"]');
    const h0 = history(), before = Object.keys(items());
    await click('#iconGrid [data-icon="tabler:building-bank"]');
    await confirmed(h0 + 1);
    expect($("#iconPicker")).toBeNull();
    const id = Object.keys(items()).find(k => !before.includes(k))!;
    const it = items()[id] as ShapeItem;
    expect(it).toMatchObject({ kind: "shape", shape: "icon", icon: "tabler:building-bank", fill: "#C42B1C", stroke: 1.5, box: { x: 752, y: 402, w: 96, h: 96 } });
    expect(get().selection.itemSel?.id).toBe(id);
    await vi.waitFor(() => expect(useStage.getState().shown?.items?.[id]).toBeTruthy(), { timeout: 10_000 });
    expect(useStage.getState().shown!.items![id].issue).toBeNull();
    expect((get().prefs.prefs as Prefs & { recentIcons?: string[] }).recentIcons?.[0]).toBe("tabler:building-bank");
    // the picker remembers its choices, and shows the recent icon
    await openPicker();
    await vi.waitFor(() => expect($('#iconRecent [data-icon="tabler:building-bank"] path')).toBeTruthy(), { timeout: 10_000 });
    expect($('[data-iccolor="#C42B1C"]')!.className).toContain("on");
    await act(async () => { fireEvent.keyDown($("#iconSearch")!, { key: "Escape" }); }); await settle();
  });

  it("a selected icon: Change icon… keeps its colour, size and place; its size and line width from the ribbon; each one undo step", async () => {
    const id = Object.keys(items()).find(k => (items()[k] as ShapeItem).icon === "tabler:building-bank")!;
    await act(async () => selectItem(id)); await settle();
    let h = history();
    await click("#iconChange");
    expect($(".icdlg .dlghd b")!.textContent).toBe("Change icon");
    expect($("#iconSize")).toBeNull();                                             // its own colour and size stay
    await type("euro");
    const pick = tiles()[0].dataset.icon!;
    await click(`#iconGrid [data-icon="${pick}"]`);
    await confirmed(h + 1);
    expect(items()[id]).toMatchObject({ icon: pick, fill: "#C42B1C", stroke: 1.5, box: { x: 752, y: 402, w: 96, h: 96 } });
    h = history();
    await click("#iconSizeBtn"); await click('[data-isize="128"]');
    await confirmed(h + 1);
    expect((items()[id] as ShapeItem).box).toEqual({ x: 736, y: 386, w: 128, h: 128 });  // round its centre
    h = history();
    await click("#iconWidthBtn"); await click('[data-iwidth="3"]');
    await confirmed(h + 1);
    expect((items()[id] as ShapeItem).stroke).toBe(3);
  });

  it("an icon the set does not have: drawn as “info”, with its Issues line", async () => {
    const h = history();
    await act(async () => itemPatch("Insert icon", "ibad", { kind: "shape", shape: "icon", icon: "tabler:no-such-icon", box: { x: 100, y: 100, w: 64, h: 64 } }));
    await confirmed(h + 1);
    await vi.waitFor(() => expect($("#issues")!.textContent).toContain("the icon “tabler:no-such-icon” is not in the icon set (shown as “info”)"), { timeout: 10_000 });
  });
});
