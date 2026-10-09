/* The stage follows the store (PLAN S1.3): each change of the selection slice or the zoom calls exactly the
   repaint it needs, and nothing else does. "Fit" pressed while the zoom is already "fit" still re-fits. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followStore } from "../src/editor/stage";
import { get, initialState, patch, STAGE, useStore } from "../src/state/store";
import { setZoom } from "../src/state/app";

const sel = (r: number, c: number) => ({ t: 0, anchor: { r, c }, ar: r, ac: c, r1: r, r2: r, c1: c, c2: c });

describe("the stage follows the store", () => {
  const on = { sel: vi.fn(), note: vi.fn(), painting: vi.fn(), zoom: vi.fn() };
  let stop: () => void;
  beforeEach(() => { useStore.setState(initialState()); Object.values(on).forEach(f => f.mockClear()); stop = followStore(on); });
  afterEach(() => stop());
  const calls = () => Object.fromEntries(Object.entries(on).map(([k, f]) => [k, f.mock.calls.length]));

  it("a cell selection repaints the selection only", () => {
    patch("selection", { sel: sel(2, 3) });
    expect(calls()).toEqual({ sel: 1, note: 0, painting: 0, zoom: 0 });
  });
  it("slide text repaints the selection; a text box repaints the text-box selection", () => {
    patch("selection", { textSel: "title" });
    patch("selection", { noteSel: "t1:right" });
    expect(calls()).toEqual({ sel: 1, note: 1, painting: 0, zoom: 0 });
  });
  it("the format painter toggles the painting cursor once on and once off", () => {
    patch("selection", { painter: { pattern: [[null]], sticky: false } });
    patch("selection", { painter: { pattern: [[null]], sticky: true } });       // still painting: no toggle
    patch("selection", { painter: null });
    expect(on.painting.mock.calls).toEqual([[true], [false]]);
  });
  it("the zoom re-fits; other slices repaint nothing", () => {
    patch("ui", { zoom: 1.5 });
    patch("ui", { toast: { id: 1, html: "x" } });
    patch("deck", { cur: 1 });
    expect(calls()).toEqual({ sel: 0, note: 0, painting: 0, zoom: 1 });
  });
  it("after unsubscribing nothing is called", () => {
    stop();
    patch("selection", { sel: sel(1, 1) }); patch("ui", { zoom: 2 });
    expect(calls()).toEqual({ sel: 0, note: 0, painting: 0, zoom: 0 });
  });
});

describe("setZoom", () => {
  beforeEach(() => useStore.setState(initialState()));
  it("Fit pressed while the zoom is already fit re-fits the stage", () => {
    const fit = vi.spyOn(STAGE, "fit");
    try {
      expect(get().ui.zoom).toBe("fit");
      setZoom("fit");
      expect(fit).toHaveBeenCalledTimes(1);
      setZoom(1.25);                        // a change: the stage's subscription re-fits, not setZoom
      expect(fit).toHaveBeenCalledTimes(1);
      expect(get().ui.zoom).toBe(1.25);
    } finally { fit.mockRestore(); }
  });
});
