/* The icon and shape window and icon items (S15.2, IC-01; docs/next/09 §3.5; one window since 4.12): the page with the
   core in-thread and the deck in this browser (offline). The page's in-thread core has no icon set (only the workers
   carry it): the window says so. With the set registered as the workers do (installTabler), the ribbon's one button,
   Shapes & icons… (4.12; before it Insert shape ▾ › More icons…), opens the window: a search by name
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
import { gotoSlide, openLocalFile, setPrefs } from "../src/state/app";
import { itemPatch, selectItem } from "../src/editor/charts";
import { TILE } from "../src/ui/IconPicker";
import { useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { ICON_NAMES, setIconCatalog, setVendoredIcons } from "@slide-builder/core/render/icons";
import { installTabler, tabler } from "@slide-builder/core/icons/index";
import { LEGACY_ICONS } from "../src/ui/icon-legacy";
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
async function openPicker() { await click("#shapeBtn"); expect($("#iconPicker")).toBeTruthy(); }
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

  it("Change icon…: tiles at the item's own line width; Escape closes the picker and keeps the icon selected (review 5, 7)", async () => {
    const id = Object.keys(items()).find(k => (items()[k] as ShapeItem).stroke === 3)!;
    await act(async () => selectItem(id)); await settle();
    expect((get().prefs.prefs as Prefs & { iconOpts?: { stroke?: number } }).iconOpts?.stroke).toBe(1.5);   // the picker's own width
    await click("#iconChange");
    await type("bank");
    const strokes = [...tiles()[0].querySelectorAll("path")].map(p => p.getAttribute("stroke-width")).filter(Boolean);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.every(w => w === "3")).toBe(true);                             // the item's 3, not the picker's 1.5
    await act(async () => { fireEvent.keyDown($("#iconSearch")!, { key: "Escape" }); }); await settle();
    expect($("#iconPicker")).toBeNull();
    expect(get().selection.itemSel?.id).toBe(id);                                 // Escape did not reach the page's keys
    // the picker's own width is not overwritten by an item's
    expect((get().prefs.prefs as Prefs & { iconOpts?: { stroke?: number } }).iconOpts?.stroke).toBe(1.5);
  });

  it("pick (09 §3.5: a chart mark's icon, M14): the id goes to the caller, nothing changes in the deck", async () => {
    const { openIconPicker } = await import("../src/ui/IconPicker");
    const h = history(), before = JSON.stringify(items());
    const got: string[] = [];
    await act(async () => openIconPicker({ mode: "pick", title: "Icon of the mark", onPick: id => got.push(id) })); await settle();
    expect($(".icdlg .dlghd b")!.textContent).toBe("Icon of the mark");
    expect($("#iconSize")).toBeNull();
    await type("bank");
    await click('#iconGrid [data-icon="tabler:building-bank"]');
    expect(got).toEqual(["tabler:building-bank"]);
    expect($("#iconPicker")).toBeNull();
    await settle();
    expect(history()).toBe(h);
    expect(JSON.stringify(items())).toBe(before);
  });

  it("an icon the set does not have: drawn as “info”, with its Issues line", async () => {
    const h = history();
    await act(async () => itemPatch("Insert icon", "ibad", { kind: "shape", shape: "icon", icon: "tabler:no-such-icon", box: { x: 100, y: 100, w: 64, h: 64 } }));
    await confirmed(h + 1);
    await vi.waitFor(() => expect($("#issues")!.textContent).toContain("the icon “tabler:no-such-icon” is not in the icon set (shown as “info”)"), { timeout: 10_000 });
  });

  /* ---- 4.12: one window (the owner's request of 2026-10-22) ---- */
  const offered = () => [...document.querySelectorAll<HTMLElement>("#iconPicker [data-icon]")].map(e => e.dataset.icon!);
  const key = async (k: string, o: Record<string, unknown> = {}) => { await act(async () => { fireEvent.keyDown(document.activeElement!, { key: k, ...o }); }); await settle(); };
  const focused = () => document.activeElement as HTMLElement;

  it("4.12 · one entry point: Shapes & icons… opens the one window – no dropdown, no More icons…, the shapes in its side column", async () => {
    installTabler();
    expect(document.querySelectorAll("#shapeBtn").length).toBe(1);
    expect($("#shapeBtn")!.textContent!.trim()).toBe("Shapes & icons…");
    expect($("#shapeBtn")!.getAttribute("aria-haspopup")).toBe("dialog");
    await click("#shapeBtn");
    // the window at once (no menu first): one dialog, modal, named by its title
    expect(document.querySelectorAll("#iconPicker").length).toBe(1);
    const dlg = $('#iconPicker [role="dialog"]')!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect($("#" + dlg.getAttribute("aria-labelledby"))!.textContent).toBe("Insert an icon or a shape");
    expect($(".shapemenu")).toBeNull();
    expect($("#moreIcons")).toBeNull();
    expect([...document.querySelectorAll<HTMLElement>("#iconShapes [data-shape]")].map(b => b.dataset.shape)).toEqual(["text", "rect", "round", "pill", "circle", "arrow", "bubble"]);
    // the search box has the focus
    expect(document.activeElement).toBe($("#iconSearch"));
    await key("Escape");
    expect($("#iconPicker")).toBeNull();
  });

  it("4.12 · the Tabler icons only: none of the 17 built-in icons is offered (each has its counterpart in the set)", async () => {
    // a built-in name among the recent icons (kept by an older page) is not offered either
    await act(async () => setPrefs({ recentIcons: ["warning", "tabler:building-bank", "bank"] } as Partial<Prefs>)); await settle();
    await openPicker();
    await vi.waitFor(() => expect(+grid().dataset.n!).toBeGreaterThan(5000), { timeout: 10_000 }); await settle();
    await vi.waitFor(() => expect($('#iconRecent [data-icon="tabler:building-bank"]')).toBeTruthy());
    expect([...document.querySelectorAll<HTMLElement>("#iconRecent [data-icon]")].map(e => e.dataset.icon)).toEqual(["tabler:building-bank"]);
    for (const w of ["", "warning", "bank", "pin", "chart"]) {
      await type(w);
      expect(offered().length, w).toBeGreaterThan(0);
      expect(offered().every(id => /^tabler(-filled)?:[a-z0-9-]+$/.test(id)), w).toBe(true);
      for (const n of ICON_NAMES) expect(offered(), w).not.toContain(n);
    }
    // the built-ins are true duplicates: each has its counterpart, in the set
    expect(Object.keys(LEGACY_ICONS).sort()).toEqual([...ICON_NAMES].sort());
    for (const id of Object.values(LEGACY_ICONS)) {
      const [set, name] = id.split(":");
      expect(tabler().has(set === "tabler-filled" ? "filled" : "outline", name), id).toBe(true);
    }
    await key("Escape");
  });

  it("4.12 · the side column inserts a shape and a text box: one undo step each, the window closed, the new item selected and drawn", async () => {
    let h = history(), before = Object.keys(items());
    await openPicker(); await click('#iconShapes [data-shape="pill"]');
    await confirmed(h + 1);
    expect($("#iconPicker")).toBeNull();
    let id = Object.keys(items()).find(k => !before.includes(k))!;
    expect(items()[id]).toEqual({ kind: "shape", shape: "pill", box: { x: 640, y: 390, w: 320, h: 120 } });
    expect(get().selection.itemSel?.id).toBe(id);
    h = history(); before = Object.keys(items());
    await openPicker(); await click('#iconShapes [data-shape="text"]');
    await confirmed(h + 1);
    expect($("#iconPicker")).toBeNull();
    id = Object.keys(items()).find(k => !before.includes(k))!;
    // a text box: the rectangle with the ribbon's No fill and No border, its text on the left (no new key)
    expect(items()[id]).toEqual({ kind: "shape", shape: "rect", box: { x: 640, y: 390, w: 320, h: 120 }, fill: "none", border: { color: "#000000", w: 0 }, fmt: { align: "left" } });
    expect(get().selection.itemSel?.id).toBe(id);
    await vi.waitFor(() => expect(useStage.getState().shown?.items?.[id]).toBeTruthy(), { timeout: 10_000 });
    expect(useStage.getState().shown!.items![id].issue).toBeNull();
    expect($("#shapeTools")).toBeTruthy();                                         // its text tools on the ribbon
  });

  it("4.12 · a deck with a built-in icon: drawn as before, no Issues line; its colour on the ribbon; Change icon… opens the new window at its counterpart; undo", async () => {
    let h = history();
    await act(async () => itemPatch("Insert icon", "iold", { kind: "shape", shape: "icon", icon: "warning", fill: "#C42B1C", box: { x: 200, y: 200, w: 64, h: 64 } }));
    await confirmed(h + 1);
    await vi.waitFor(() => expect(useStage.getState().shown?.items?.iold).toBeTruthy(), { timeout: 10_000 });
    expect(useStage.getState().shown!.items!.iold.issue).toBeNull();
    await act(async () => selectItem("iold")); await settle();
    h = history();
    await click("#shapeFill"); await click('[data-fill="#1E8E3E"]');
    await confirmed(h + 1);
    expect(items().iold).toEqual({ kind: "shape", shape: "icon", icon: "warning", fill: "#1E8E3E", box: { x: 200, y: 200, w: 64, h: 64 } });
    h = history();
    const opts0 = JSON.stringify((get().prefs.prefs as Prefs & { iconOpts?: unknown }).iconOpts);
    await click("#iconChange");
    expect($(".icdlg .dlghd b")!.textContent).toBe("Change icon");
    expect($("#iconShapes")).toBeNull();                                           // icons only when changing one
    expect(($("#iconSearch") as HTMLInputElement).value).toBe("alert triangle");
    expect($('#iconStyle [data-style="filled"]')!.className).toContain("on");
    await vi.waitFor(() => expect(grid().dataset.q).toBe("alert triangle"), { timeout: 10_000 }); await settle();
    expect(tiles()[0].dataset.icon).toBe("tabler-filled:alert-triangle");
    await click('#iconGrid [data-icon="tabler-filled:alert-triangle"]');
    await confirmed(h + 1);
    // (review) Change icon… leaves the Insert defaults (its filled counterpart is not the next new icon's style)
    expect(JSON.stringify((get().prefs.prefs as Prefs & { iconOpts?: unknown }).iconOpts)).toBe(opts0);
    expect(items().iold).toEqual({ kind: "shape", shape: "icon", icon: "tabler-filled:alert-triangle", fill: "#1E8E3E", box: { x: 200, y: 200, w: 64, h: 64 } });
    await click("#undoBtn");
    await vi.waitFor(() => expect((items().iold as ShapeItem).icon).toBe("warning"));
  });

  it("4.12 · the keyboard: the search focused, ↓ into the grid, the arrows move, ↑ back, Tab stays in the window, Enter inserts, Escape closes", async () => {
    await openPicker();
    await vi.waitFor(() => expect(grid().dataset.q).toBe(""), { timeout: 10_000 }); await settle();
    expect(document.activeElement).toBe($("#iconSearch"));
    const cols = +grid().dataset.cols!;
    expect(cols).toBeGreaterThanOrEqual(4);
    await key("ArrowDown"); expect(focused().dataset.idx).toBe("0");
    await key("ArrowRight"); expect(focused().dataset.idx).toBe("1");
    await key("ArrowDown"); expect(focused().dataset.idx).toBe(String(1 + cols));
    await key("ArrowLeft"); expect(focused().dataset.idx).toBe(String(cols));
    await key("ArrowUp"); expect(focused().dataset.idx).toBe("0");
    expect(document.querySelectorAll('#iconGrid [tabindex="0"]').length).toBe(1);   // the grid is one Tab stop
    // a row out of view: the grid scrolls to it and draws it
    await key("PageDown"); await key("PageDown"); await key("PageDown");
    expect(+focused().dataset.idx!).toBeGreaterThan(cols * 8);
    await key("Home"); expect(focused().dataset.idx).toBe("0");
    await key("ArrowUp"); expect(document.activeElement).toBe($("#iconSearch"));
    // Tab from the last control goes round to the first; Shift+Tab from the first to the last
    const all = [...$(".icdlg")!.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]')];
    expect(all[0]).toBe($("#iconSearch"));
    expect(all[all.length - 1]).toBe($("#iconCancel"));
    act(() => all[all.length - 1].focus());
    await key("Tab"); expect(document.activeElement).toBe(all[0]);
    await key("Tab", { shiftKey: true }); expect(document.activeElement).toBe(all[all.length - 1]);
    // Enter in the search box inserts the first hit
    act(() => $("#iconSearch")!.focus());
    await type("bank");
    const h = history(), before = Object.keys(items()), first = tiles()[0].dataset.icon!;
    expect(first).toMatch(/^tabler(-filled)?:/);
    await key("Enter");
    await confirmed(h + 1);
    expect($("#iconPicker")).toBeNull();
    const id = Object.keys(items()).find(k => !before.includes(k))!;
    expect((items()[id] as ShapeItem).icon).toBe(first);
    // Escape closes, nothing changed
    // (review) Enter typed before the answer to the last key: that answer's first hit, not the previous search's
    await openPicker();
    await vi.waitFor(() => expect(grid().dataset.q).toBe(""), { timeout: 10_000 }); await settle();
    const h1 = history(), before1 = Object.keys(items());
    await act(async () => { fireEvent.change($("#iconSearch")!, { target: { value: "euro" } }); fireEvent.keyDown($("#iconSearch")!, { key: "Enter" }); });
    await confirmed(h1 + 1);
    const id1 = Object.keys(items()).find(k => !before1.includes(k))!;
    expect((items()[id1] as ShapeItem).icon).toMatch(/^tabler(-filled)?:currency-euro$/);
    // (review) a second open while one is open starts afresh (its own search, its own mode)
    await openPicker();
    await type("bank");
    const { openIconPicker } = await import("../src/ui/IconPicker");
    await act(async () => openIconPicker({ mode: "pick", title: "Icon of the mark", onPick: () => undefined })); await settle();
    expect($(".icdlg .dlghd b")!.textContent).toBe("Icon of the mark");
    expect(($("#iconSearch") as HTMLInputElement).value).toBe("");
    expect($("#iconShapes")).toBeNull();
    await key("Escape");
    await openPicker();
    const h2 = history();
    await key("Escape");
    expect($("#iconPicker")).toBeNull();
    await settle();
    expect(history()).toBe(h2);
  });
});
