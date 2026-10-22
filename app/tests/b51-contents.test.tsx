/* B51 (4.9, product owner 2026-10-22): in a free layout the contents slide's title and list are moved and resized on
   the stage like a table of a free layout – a grip, a corner and four edges each (stage/Stage.tsx PartBox,
   stage/drags.ts freePart); a drop is ONE slide.patch of the design's free entry ("c:toc" / "c:title" with its scale):
   one undo step. The slide is then drawn where it was dropped (the parts' boxes come back from the drawn slide). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { ctx, gotoSlide, openLocalFile, undo } from "../src/state/app";
import { stage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
Element.prototype.setPointerCapture ??= function () { /* jsdom */ };

async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const part = (p: string) => document.querySelector(`#stage .hbox.cpart[data-part="${p}"]`) as HTMLElement | null;
const boxOf = (el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
const cur = () => get().deck.slides[get().deck.cur];
const entry = () => cur().cfg.free?.[ctx().style.design];

describe("B51: the contents slide's title and list dragged in a free layout", () => {
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    // (a contents slide after the cover)
    const preset = defaultPreset(wb), at0 = preset.slides[0]?.type === "cover" ? 1 : 0;
    preset.slides.splice(at0, 0, { id: "sIX", type: "index", tables: [], title: "Contents" });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset, style: {}, edits: {} }));
    render(<App />);
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    const ix = get().deck.slides.findIndex(R => R.type === "index");
    expect(ix).toBeGreaterThanOrEqual(0);
    await act(async () => gotoSlide(ix)); await settle();
  });
  afterAll(() => cleanup());

  it("Free layout on the contents slide: the parts get handles; a move and a resize are one undo step each, drawn where dropped", { timeout: 60_000 }, async () => {
    const h0 = history();
    expect(part("toc")).toBeNull();                                   // automatic layout: no handles
    const btn = document.getElementById("freeLayout") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => { fireEvent.click(btn); }); await confirmed(h0 + 1);
    expect(entry()?.on).toBe(true);
    await vi.waitFor(() => { expect(part("toc")).toBeTruthy(); expect(part("title")).toBeTruthy(); }, { timeout: 10_000 });
    const s = stage().scale, L0 = boxOf(part("toc")!), T0 = boxOf(part("title")!);

    // the list: its grip dragged 60 × 40 screen px (Alt: no snapping) – one slide.patch
    const grip = part("toc")!.querySelector(".grip") as HTMLElement, at = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, altKey: true });
    await act(async () => { fireEvent.pointerDown(grip, at(100, 100)); fireEvent.pointerMove(window, at(160, 140)); fireEvent.pointerUp(window, at(160, 140)); });
    await confirmed(h0 + 2);
    expect(get().deck.history.undoLabel).toBe("Move contents");
    const L = entry()!.items["c:toc"]!;
    expect(L.x).toBeCloseTo(L0.x + 60 / s, 6); expect(L.y).toBeCloseTo(L0.y + 40 / s, 6);
    expect(L.scale).toBe(1);
    // drawn there: the handles come back from the slide the worker drew with it
    await vi.waitFor(() => { const b = boxOf(part("toc")!); expect(b.x).toBeCloseTo(L.x, 3); expect(b.y).toBeCloseTo(L.y, 3); expect(b.w).toBeCloseTo(L0.w, 3); }, { timeout: 10_000 });

    // the title: its corner dragged – its proportions kept, its scale saved
    const corner = part("title")!.querySelector(".size") as HTMLElement;
    await act(async () => { fireEvent.pointerDown(corner, at(500, 500)); fireEvent.pointerMove(window, at(500 - T0.w * s * .25, 500 - T0.h * s * .25)); fireEvent.pointerUp(window, at(500 - T0.w * s * .25, 500 - T0.h * s * .25)); });
    await confirmed(h0 + 3);
    expect(get().deck.history.undoLabel).toBe("Resize title");
    const T = entry()!.items["c:title"]!;
    expect(T.scale).toBeCloseTo(.75, 6); expect(T.x).toBeCloseTo(T0.x, 6); expect(T.w).toBeCloseTo(T0.w * .75, 6); expect(T.h).toBeCloseTo(T0.h * .75, 6);
    expect(entry()!.items["c:toc"]).toEqual(L);                       // the list stays
    await vi.waitFor(() => { const b = boxOf(part("title")!); expect(b.w).toBeCloseTo(T0.w * .75, 3); expect(b.h).toBeCloseTo(T0.h * .75, 3); }, { timeout: 10_000 });

    // Free layout off, then on again (review): the parts keep their places – their boxes are carried through
    await act(async () => { fireEvent.click(btn); }); await confirmed(h0 + 4);
    expect(entry()!.on).toBe(false);
    await vi.waitFor(() => expect(part("toc")).toBeNull());
    await act(async () => { fireEvent.click(btn); }); await confirmed(h0 + 5);
    expect(entry()!.on).toBe(true);
    expect(entry()!.items["c:toc"]).toEqual(L); expect(entry()!.items["c:title"]).toEqual(T);
    await vi.waitFor(() => { const b = boxOf(part("toc")!); expect(b.x).toBeCloseTo(L.x, 3); expect(b.y).toBeCloseTo(L.y, 3); }, { timeout: 10_000 });
    await act(async () => undo(false)); await confirmed(h0 + 4);
    await act(async () => undo(false)); await confirmed(h0 + 3);
    expect(entry()!.on).toBe(true);

    // a click on a grip is not a drag: nothing written
    await act(async () => { fireEvent.pointerDown(grip, at(10, 10)); fireEvent.pointerUp(window, at(11, 10)); }); await settle();
    expect(history()).toBe(h0 + 3);

    // undo: one step each
    await act(async () => undo(false)); await confirmed(h0 + 2);
    expect(entry()!.items["c:title"]).toBeUndefined(); expect(entry()!.items["c:toc"]).toEqual(L);
    await act(async () => undo(false)); await confirmed(h0 + 1);
    expect(entry()!.items["c:toc"]).toBeUndefined();
    await vi.waitFor(() => { const b = boxOf(part("toc")!); expect(b.x).toBeCloseTo(L0.x, 3); expect(b.y).toBeCloseTo(L0.y, 3); }, { timeout: 10_000 });
    await act(async () => undo(false)); await confirmed(h0);
    await vi.waitFor(() => expect(part("toc")).toBeNull());
  });
});
