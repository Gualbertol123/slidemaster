/* The slide's zoom (4.12, the owner's request of 2026-10-22: Ctrl + wheel zooms the slide, not the page): the maths
   (the steps, the clamp, a wheel's delta in any unit, the point under the pointer kept), the wheel (Ctrl / ⌘ / a pinch:
   the slide zooms and the page's own zoom is cancelled; a plain wheel scrolls as usual), the keys (Ctrl + = / + / − / 0,
   cancelled in a dialog too), and the zoom kept out of the prefs. (e2e: responsive.spec.ts RZ-02, RZ-03.) */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { get, initialState, patch, setDialogs, useStore } from "../src/state/store";
import { setStage, useStage } from "../src/stage/data";
import {
  anchorAt, clampZoom, installZoom, onWheel, scrollFor, slideOrigin, stageExtent, stepZoom, takePendingAnchor, wheelAction, wheelFactor, wheelPx,
  zoomKey, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS,
} from "../src/stage/zoom";

describe("zoom maths", () => {
  it("clamps to 25 % … 400 %", () => {
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([.25, 4]);
    expect(clampZoom(.1)).toBe(.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampZoom(NaN)).toBe(1);
  });
  it("steps along the ladder, from between two steps to the nearer one that way, never past the ends", () => {
    expect(ZOOM_STEPS[0]).toBe(.25); expect(ZOOM_STEPS.at(-1)).toBe(4);
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(.9);
    expect(stepZoom(.44, 1)).toBe(.5);                 // a fitted 44 %
    expect(stepZoom(.44, -1)).toBe(.33);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(.25, -1)).toBe(.25);
  });
  it("a wheel's delta in px whatever its unit; a notch ≈ ×1.2, smooth, multiplicative, bounded", () => {
    expect(wheelPx({ deltaY: 3, deltaMode: 1 })).toBe(48);
    expect(wheelPx({ deltaY: 1, deltaMode: 2 })).toBe(800);
    expect(wheelPx({ deltaY: 100, deltaMode: 0 })).toBe(100);
    const out = wheelFactor({ deltaY: 100, deltaMode: 0 }), inn = wheelFactor({ deltaY: -100, deltaMode: 0 });
    expect(out).toBeLessThan(1); expect(inn).toBeGreaterThan(1);
    expect(out * inn).toBeCloseTo(1, 10);              // in and out by the same notch: back where it was
    expect(inn).toBeGreaterThan(1.15); expect(inn).toBeLessThan(1.35);
    expect(wheelFactor({ deltaY: -2, deltaMode: 0 })).toBeLessThan(1.01);   // a pinch's small step
    expect(wheelFactor({ deltaY: -1, deltaMode: 2 })).toBeLessThanOrEqual(1.5);   // a page: bounded
    expect(wheelFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(wheelFactor({ deltaY: -48, deltaMode: 0 }), 10);
  });
  it("the slide centred, 16 px from the edges at least; its scrolled area is the slide and its margins", () => {
    expect(slideOrigin(1000, 600, .5)).toEqual({ left: 100, top: 75 });
    expect(slideOrigin(1000, 600, 2)).toEqual({ left: 16, top: 16 });
    expect(stageExtent(1000, 600, .5)).toEqual({ w: 1000, h: 600 });
    expect(stageExtent(1000, 600, 2)).toEqual({ w: 3232, h: 1832 });
  });
  it("the slide point under the pointer stays under it (in, out, scrolled); the scroll stays within the stage", () => {
    const keep = (px: number, py: number, sl: number, st: number, s0: number, s1: number) => {
      const a = anchorAt(px, py, sl, st, 1000, 600, s0), to = scrollFor(a, 1000, 600, s1), o = slideOrigin(1000, 600, s1);
      return { a, to, ux: (px + to.left - o.left) / s1, uy: (py + to.top - o.top) / s1 };
    };
    let k = keep(300, 200, 0, 0, .5, 2);                 // from a fitted 50 % to 200 %, the pointer on the slide
    expect(k.a.ux).toBeCloseTo(400); expect(k.a.uy).toBeCloseTo(250);
    expect(k.ux).toBeCloseTo(400, 0); expect(k.uy).toBeCloseTo(250, 0);
    k = keep(700, 450, 1200, 500, 2, 3);                 // scrolled at 200 %, to 300 %
    expect(k.ux).toBeCloseTo(k.a.ux, 0); expect(k.uy).toBeCloseTo(k.a.uy, 0);
    k = keep(500, 300, 1200, 500, 2, 1);                 // out again
    expect(k.ux).toBeCloseTo(k.a.ux, 0); expect(k.uy).toBeCloseTo(k.a.uy, 0);
    // the slide's top-left corner zoomed in about the stage's corner: nothing to scroll before 0
    const c = scrollFor(anchorAt(0, 0, 0, 0, 1000, 600, .5), 1000, 600, 2);
    expect(c).toEqual({ left: 0, top: 0 });
    // zoomed out to fit, nothing can scroll
    expect(scrollFor(anchorAt(900, 500, 2000, 1000, 1000, 600, 2), 1000, 600, .5)).toEqual({ left: 0, top: 0 });
  });
});

describe("the wheel and the keys", () => {
  const frames: FrameRequestCallback[] = [];
  const runFrames = () => { while (frames.length) frames.shift()!(0); };
  let stageEl: HTMLDivElement;
  beforeAll(() => installZoom());
  beforeEach(() => {
    useStore.setState(initialState());
    patch("doc", { open: true });
    patch("deck", { slides: [{ id: "s0" }] as never, cur: 0 });
    setStage({ scale: .5 });
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
    stageEl = document.createElement("div"); stageEl.id = "stage";
    stageEl.innerHTML = '<div class="slide"><i id="cell"></i></div>';
    document.body.append(stageEl, Object.assign(document.createElement("aside"), { id: "panel" }));
    Object.defineProperty(stageEl, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(stageEl, "clientHeight", { configurable: true, value: 600 });
    stageEl.getBoundingClientRect = () => ({ left: 300, top: 100, right: 1300, bottom: 700, width: 1000, height: 600, x: 300, y: 100, toJSON() {} });
  });
  afterEach(() => { runFrames(); takePendingAnchor(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
  const wheel = (target: Element, init: WheelEventInit) => { const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
  const key = (init: KeyboardEventInit, target: Element = document.body) => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };

  it("what a wheel does: Ctrl or ⌘ zooms (a pinch is Ctrl + wheel), a plain wheel is the browser's; no slide or a dialog: the page's zoom only cancelled", () => {
    const t = document.body;
    expect(wheelAction({ ctrlKey: true, metaKey: false, target: t }, true, false)).toBe("zoom");
    expect(wheelAction({ ctrlKey: false, metaKey: true, target: t }, true, false)).toBe("zoom");
    expect(wheelAction({ ctrlKey: false, metaKey: false, target: t }, true, false)).toBe(null);
    expect(wheelAction({ ctrlKey: true, metaKey: false, target: t }, false, false)).toBe("block");
    expect(wheelAction({ ctrlKey: true, metaKey: false, target: t }, true, true)).toBe("block");
  });
  it("Ctrl + wheel over the slide: cancelled (the page never zooms), the slide zoomed once a frame, anchored at the pointer", () => {
    const e1 = wheel(stageEl.querySelector("#cell")!, { ctrlKey: true, deltaY: -100, clientX: 600, clientY: 300 });
    const e2 = wheel(stageEl.querySelector("#cell")!, { ctrlKey: true, deltaY: -100, clientX: 600, clientY: 300 });
    expect(e1.defaultPrevented && e2.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe("fit");                     // not yet: once a frame
    runFrames();
    const z = get().ui.zoom as number;
    expect(z).toBeCloseTo(.5 * wheelFactor({ deltaY: -100, deltaMode: 0 }) ** 2, 6);   // the two events, one zoom
    const a = takePendingAnchor()!;
    expect(a.px).toBe(300); expect(a.py).toBe(200);        // the pointer, in the stage
    expect(a.ux).toBeCloseTo((300 - 100) / .5); expect(a.uy).toBeCloseTo((200 - 75) / .5);
  });
  it("a pinch zooms out too, never below 25 %; deltaMode lines counts as px", () => {
    for (let k = 0; k < 40; k++) wheel(stageEl, { ctrlKey: true, deltaY: 3, deltaMode: 1, clientX: 800, clientY: 400 });
    runFrames();
    expect(get().ui.zoom).toBe(.25);
  });
  it("a plain wheel and Shift + wheel are not taken: the stage scrolls as the browser scrolls it", () => {
    const e = wheel(stageEl, { deltaY: 100 }), s = wheel(stageEl, { deltaY: 100, shiftKey: true });
    runFrames();
    expect(e.defaultPrevented || s.defaultPrevented).toBe(false);
    expect(get().ui.zoom).toBe("fit");
  });
  it("Ctrl + wheel over a panel zooms the slide about the stage's middle; in a dialog only the page's zoom is cancelled", () => {
    const e = wheel(document.getElementById("panel")!, { ctrlKey: true, deltaY: -100, clientX: 50, clientY: 50 });
    runFrames();
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBeGreaterThan(.5);
    expect(takePendingAnchor()).toMatchObject({ px: 500, py: 300 });
    patch("ui", { zoom: "fit" });
    setDialogs({ textStyles: "styles" });
    const d = wheel(document.getElementById("panel")!, { ctrlKey: true, deltaY: -100 });
    runFrames();
    expect(d.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe("fit");
  });
  it("no deck: the page's zoom is cancelled, nothing else", () => {
    patch("deck", { slides: [] });
    const e = wheel(stageEl, { ctrlKey: true, deltaY: -100 });
    runFrames();
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe("fit");
  });

  it("the zoom keys: = and + in, − out, 0 Fit, the numeric pad's too – by the key typed (an Italian keyboard's + key); never with Alt (AltGr)", () => {
    const k = (key: string, code = "", mod: Partial<KeyboardEventInit> = { ctrlKey: true }) => zoomKey({ ctrlKey: false, metaKey: false, altKey: false, key, code, ...mod } as never);
    expect(k("=", "Equal")).toBe("in"); expect(k("+", "BracketRight")).toBe("in"); expect(k("+", "NumpadAdd")).toBe("in");
    expect(k("-", "Minus")).toBe("out"); expect(k("-", "Slash")).toBe("out"); expect(k("-", "NumpadSubtract")).toBe("out");
    expect(k("0", "Digit0")).toBe("fit"); expect(k("0", "Numpad0")).toBe("fit");
    expect(k("=", "Equal", { metaKey: true })).toBe("in");
    expect(k("=", "Equal", {})).toBe(null);                // no Ctrl
    expect(k("+", "BracketRight", { ctrlKey: true, altKey: true })).toBe(null);
    expect(k("z", "KeyZ")).toBe(null); expect(k("m", "KeyM")).toBe(null); expect(k("b", "KeyB")).toBe(null);
  });
  it("Ctrl + = steps in, Ctrl + − out, Ctrl + 0 fits – each cancelled, so the page never zooms; in a field too", () => {
    let e = key({ key: "=", code: "Equal", ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe(.67);                       // from 50 %: the next step
    useStage.setState({ scale: .67 }); takePendingAnchor();
    const field = document.body.appendChild(document.createElement("input"));
    field.addEventListener("keydown", ev => ev.stopPropagation());      // (the formula bar stops its keys)
    e = key({ key: "-", code: "Minus", ctrlKey: true }, field);
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe(.5);
    e = key({ key: "0", code: "Digit0", ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe("fit");
  });
  it("a dialog open: the keys are cancelled, the slide stays; other shortcuts are not taken", () => {
    setDialogs({ comment: { table: 0 } });
    const e = key({ key: "=", code: "Equal", ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(get().ui.zoom).toBe("fit");
    setDialogs({ comment: null });
    expect(key({ key: "z", code: "KeyZ", ctrlKey: true }).defaultPrevented).toBe(false);   // (editor/keys.ts is not installed here)
    expect(key({ key: "+", code: "BracketRight" }).defaultPrevented).toBe(false);          // + typed
  });
  it("the zoom is view state: not written to the prefs", async () => {
    const before = JSON.stringify(get().prefs.prefs);
    key({ key: "=", code: "Equal", ctrlKey: true });
    await new Promise(r => setTimeout(r, 450));
    expect(JSON.stringify(get().prefs.prefs)).toBe(before);
    expect(get().prefs.prefs).not.toHaveProperty("zoom");
  });
});
