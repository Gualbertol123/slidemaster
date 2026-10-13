/* The stage's data (PLAN S4.1): it asks the core worker for the slide on the stage – one request at a time, the
   newest wins, a slide that is no longer the current one is not shown; while an editor is open nothing is redrawn
   under it (E8: the newest slide waits until it closes); a drag's last preview stays until a slide asked for after
   the drag arrives. "Fit" pressed while the zoom is already "fit" re-fits. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StageSlide } from "@slide-builder/core/rpc/messages";

const calls = vi.hoisted(() => [] as { a: { slide: number; known: string[]; fresh?: boolean }; resolve: (s: StageSlide | null) => void }[]);
vi.mock("../src/state/app", async orig => ({ ...(await orig() as object), core: () => ({ call: (m: string, a: never) => m === "stage" ? new Promise(resolve => calls.push({ a, resolve })) : Promise.resolve(null) }) }));

import { get, initialState, patch, STAGE, useStore } from "../src/state/store";
import { setZoom } from "../src/state/app";
import { editorClosed, requestsIssued, requestStage, setStage, stage, useStage } from "../src/stage/data";

const slide = (n: number, id = "s" + n, layers = 1): StageSlide => ({ slide: n, id, design: "glass", images: {}, layers: Array.from({ length: layers }, (_, k) => ({ key: "f" + k, table: null, box: null, nodes: [], svg: [] })) });
const settle = () => new Promise(r => setTimeout(r, 0));
function open(cur = 0) {
  useStore.setState(initialState());
  patch("doc", { open: true });
  patch("deck", { slides: [{ id: "s0" }, { id: "s1" }, { id: "s2" }] as never, cur });
}

describe("the stage asks the worker for its slide", () => {
  beforeEach(() => { calls.length = 0; open(); useStage.setState({ shown: null, editor: null, drag: null }); });
  afterEach(async () => { while (calls.length) { calls.shift()!.resolve(null); await settle(); } });

  it("one request at a time; changes meanwhile ask once more, for the newest state", async () => {
    requestStage(); requestStage(); requestStage(true);
    expect(calls.length).toBe(1);
    calls.shift()!.resolve(slide(0)); await settle();
    expect(stage().shown?.id).toBe("s0");
    expect(calls.length).toBe(1);                              // the three became one more request…
    expect(calls[0].a.fresh).toBe(true);                       // …which measures again, as one of them asked
  });
  it("a slide that is no longer the current one is not shown, and the current one is asked for", async () => {
    requestStage();
    patch("deck", { cur: 2 });
    calls.shift()!.resolve(slide(0)); await settle();
    expect(stage().shown).toBe(null);
    expect(calls.map(c => c.a.slide)).toEqual([2]);
    calls.shift()!.resolve(slide(2)); await settle();
    expect(stage().shown?.id).toBe("s2");
  });
  it("E8: nothing is redrawn under an open editor; the newest slide is shown when it closes", async () => {
    requestStage(); calls.shift()!.resolve(slide(0, "s0", 1)); await settle();
    setStage({ editor: { kind: "cell" } });
    requestStage(); calls.shift()!.resolve(slide(0, "s0", 2)); await settle();
    requestStage(); calls.shift()!.resolve(slide(0, "s0", 3)); await settle();
    expect(stage().shown?.layers.length).toBe(1);
    editorClosed();
    expect(stage().editor).toBe(null);
    expect(stage().shown?.layers.length).toBe(3);
  });
  it("a drag's last preview stays until a slide asked for after the drag arrives", async () => {
    requestStage();                                            // asked before the drag ended
    const done = { kind: "grip", i: 0, mark: null, done: true, after: requestsIssued() } as const;
    setStage({ drag: done });
    calls.shift()!.resolve(slide(0)); await settle();
    expect(stage().drag).toBe(done);
    requestStage(); calls.shift()!.resolve(slide(0)); await settle();
    expect(stage().drag).toBe(null);
  });
  it("pictures already sent are named, not sent again", async () => {
    requestStage(); calls.shift()!.resolve({ ...slide(0), images: { "pic-1": "data:image/png;base64,iVBORw0KGgo=" } }); await settle();
    requestStage();
    expect(calls[0].a.known).toContain("pic-1");
  });
  it("a slide the worker sends unasked: shown at once when it is the current one; before the page has the new slides, when they come", async () => {
    STAGE.pushed(slide(0)); expect(stage().shown?.id).toBe("s0");
    const shown = stage().shown;
    requestStage(); calls.shift()!.resolve(slide(0)); await settle();
    expect(stage().shown).toBe(shown);                                 // the same slide drawn the same: nothing redrawn
    // a workbook starting: its slide arrives before the page takes its slides
    STAGE.pushed(slide(1, "n1"));
    expect(stage().shown?.id).toBe("s0");
    patch("deck", { slides: [{ id: "n0" }, { id: "n1" }] as never, cur: 1 });
    requestStage();
    expect(stage().shown?.id).toBe("n1");                              // before the answer
    calls.shift()!.resolve(slide(1, "n1")); await settle();
    expect(stage().shown?.id).toBe("n1");
  });
  it("STAGE.render and STAGE.refresh ask for the slide; without a document the stage is empty", async () => {
    STAGE.render(true); expect(calls[0].a.fresh).toBe(true); calls.shift()!.resolve(slide(0)); await settle();
    STAGE.refresh(); expect(calls[0].a.fresh).toBe(false); calls.shift()!.resolve(slide(0)); await settle();
    patch("doc", { open: false }); STAGE.refresh();
    expect(calls.length).toBe(0); expect(stage().shown).toBe(null);
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
      setZoom(1.25);                        // a change: the stage follows ui.zoom, setZoom does not re-fit
      expect(fit).toHaveBeenCalledTimes(1);
      expect(get().ui.zoom).toBe(1.25);
    } finally { fit.mockRestore(); }
  });
});
