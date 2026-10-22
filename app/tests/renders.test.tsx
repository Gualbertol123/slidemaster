/* Render counts (PLAN S1.3, ADR-012): each component reads only what it shows from the store, so
   - moving the selection re-renders at most Ribbon, TableTools, FormulaBar, StatusBar and the stage's selection
     overlay (S4.1: the stage is React; its Profiler is Canvas's, which holds it);
   - a poll that brings nothing new re-renders nothing;
   - a toast re-renders only Toast.
   The chrome modules are wrapped in React Profilers; the thumbnails and the wallpaper draw on canvas/DOM that jsdom
   does not have, so they are left out (they are not React components). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const counts = vi.hoisted(() => new Map<string, number>());
/** wraps every component a module exports in a Profiler named after it; updates are counted */
async function profiled<M extends Record<string, unknown>>(load: () => Promise<M>, names: string[]): Promise<M> {
  const m = await load(), { Profiler, createElement } = await import("react");
  const out: Record<string, unknown> = { ...m };
  for (const n of names) {
    const C = m[n] as (p: object) => unknown;
    out[n] = (p: object) => createElement(Profiler, { id: n, onRender: (_id: string, phase: string) => { if (phase !== "mount") counts.set(n, (counts.get(n) || 0) + 1); } }, createElement(C as never, p));
  }
  return out as M;
}
vi.mock("../src/ui/Chrome", async orig => profiled(orig as never, ["Thumbs", "Issues", "Canvas", "Status", "Busy", "Toast"]));
vi.mock("../src/ui/Topbar", async orig => profiled(orig as never, ["Topbar"]));
vi.mock("../src/ui/Ribbon", async orig => profiled(orig as never, ["Ribbon", "FxBar"]));
vi.mock("../src/ui/TableTools", async orig => profiled(orig as never, ["TableRibbon"]));
vi.mock("../src/ui/Dialogs", async orig => profiled(orig as never, ["Dialogs"]));
vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { heartbeat, openLocalFile, tick } from "../src/state/app";
import { setSel } from "../src/editor/edit";
import { toast } from "../src/state/store";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { backend, type Health, type Other } from "../src/sync/api";

const here = path.dirname(fileURLToPath(import.meta.url));
const updated = () => [...counts.keys()].sort();
/** npm run bench prints the counts (PLAN Part F: a selection change re-renders ≤ 5 components) */
const report = (what: string) => console.log(`render counts · ${what}: ${counts.size} component(s) ${JSON.stringify(Object.fromEntries([...counts].sort()))}`);
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }

describe("render counts", () => {
  beforeAll(async () => {
    // the deck as a colleague saved it (this page is offline: the document lives in localStorage)
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: defaultPreset(wb), style: {}, edits: {} }));
    render(<App />);
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());       // "Saved preset found"
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    expect(get().deck.slides.length).toBeGreaterThan(0);
    expect(get().deck.slides[0].tables.length).toBeGreaterThan(0);
  });
  afterAll(() => cleanup());

  it("moving the selection re-renders only the toolbars, the formula bar and the status bar", async () => {
    const T = get().deck.slides[get().deck.cur].tables[0], [r, c] = [T.rows[0], T.cols[0]];
    counts.clear();
    await act(async () => { setSel(0, { r, c }, { r, c }); });
    await settle();
    report("select a cell");
    expect(get().selection.sel).toBeTruthy();
    expect(updated()).toEqual(["Canvas", "FxBar", "Ribbon", "Status", "TableRibbon"]);
    counts.clear();
    const r2 = T.rows[1] ?? r, c2 = T.cols[1] ?? c;
    await act(async () => { setSel(0, { r, c }, { r: r2, c: c2 }); });          // extend it (Shift+arrow)
    await settle();
    report("extend the selection");
    expect(updated().length).toBeLessThanOrEqual(5);
    expect(updated().every(n => ["Canvas", "FxBar", "Ribbon", "Status", "TableRibbon"].includes(n))).toBe(true);
  });

  it("a poll that brings nothing new re-renders nothing", async () => {
    // document, health, file, fonts and config are each polled within 10 ticks; presence has its own beat
    const poll = async () => { for (let i = 0; i < 10; i++) { await tick(); await heartbeat(); } };
    await act(poll);
    await settle();
    counts.clear();
    await act(poll);
    await settle();
    report("10 polls, nothing new");
    expect(updated()).toEqual([]);
  });

  it("a poll from the helper that brings equal answers (new objects, new seen-at times) re-renders nothing", async () => {
    // the offline backend answers null / []; the helper answers a new object on every poll
    const health = (): Health => ({ app: "Slide Builder", version: "3.4.0", user: "anna", host: "pc-anna", folder: "T:\\Slide Builder", export: "T:\\Slide Builder\\export" });
    let at = 1000;
    const bob = (): Other[] => [{ user: "bob", host: "pc-bob", client: "c-bob", workbook: "report.xlsx", at: at++ }];
    const h = vi.spyOn(backend, "health").mockImplementation(async () => health());
    const p = vi.spyOn(backend, "presence").mockImplementation(async () => bob());
    try {
      const poll = async () => { for (let i = 0; i < 10; i++) { await tick(); await heartbeat(); } };
      await act(poll);                                  // the first answers are news: the pill and "bob is here"
      await settle();
      expect(get().ui.health?.user).toBe("anna");
      expect(get().ui.others.map(o => o.user)).toEqual(["bob"]);
      counts.clear();
      await act(poll);
      await settle();
      report("10 helper polls, equal answers");
      expect(h).toHaveBeenCalled(); expect(p).toHaveBeenCalled();
      expect(updated()).toEqual([]);
    } finally { h.mockRestore(); p.mockRestore(); }
  });

  it("a toast re-renders only Toast", async () => {
    counts.clear();
    await act(async () => { toast("Saved"); });
    await settle();
    report("a toast");
    expect(updated()).toEqual(["Toast"]);
  });

  it("dragging the side panel's grip re-renders nothing until the release (4.10.2 review): one commit then", async () => {
    try { localStorage.removeItem("sbNavWidth"); } catch { /* none */ }
    const g = document.querySelector("#navGrip") as HTMLElement, main = document.querySelector(".main") as HTMLElement;
    const x0 = parseFloat(g.style.left);
    counts.clear();
    await act(async () => { fireEvent.pointerDown(g, { button: 0, clientX: x0, pointerId: 1 }); });
    for (let i = 1; i <= 8; i++) await act(async () => { fireEvent.pointerMove(g, { clientX: x0 + i * 5, pointerId: 1 }); await new Promise(r => setTimeout(r, 20)); });
    report("drag the grip, 8 moves");
    expect(updated()).toEqual([]);
    expect(main.style.gridTemplateColumns).toBe(`${x0 + 40}px minmax(0,1fr)`);    // drawn without React
    expect(g.style.left).toBe(`${x0 + 40}px`);
    await act(async () => { fireEvent.pointerUp(g, { clientX: x0 + 40, pointerId: 1 }); });
    await settle();
    expect(localStorage.getItem("sbNavWidth")).toBe(String(x0 + 40));
    expect(main.style.gridTemplateColumns).toBe(`${x0 + 40}px minmax(0,1fr)`);
    try { localStorage.removeItem("sbNavWidth"); } catch { /* none */ }
  });
});
