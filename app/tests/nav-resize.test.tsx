/* The side panel's width (4.10.2, the owner's report 2026-10-22: the chart panel "too squashed" at 250 px): 340 px by
   default, its grip drags it between 280 and half the window, the width is kept in this browser (localStorage, any
   failure of it harmless) and a double-click on the grip goes back to the default and forgets it. (e2e: panel-width.spec.ts
   PW-01 – the layout of the chart panel at those widths, the stage fitting again.) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NAV_DEFAULT, NAV_MIN, NavGrip, clampNav, loadNav, saveNav, useNavWidth } from "../src/ui/NavResize";

function Host() {
  const [w, set] = useNavWidth();
  return <div><span id="w">{w}</span><NavGrip width={w} set={set} /></div>;
}
const width = (c: HTMLElement) => +c.querySelector("#w")!.textContent!;
const drag = (g: Element, from: number, to: number) => {
  fireEvent.pointerDown(g, { button: 0, clientX: from, pointerId: 1 });
  fireEvent.pointerMove(g, { clientX: (from + to) / 2, pointerId: 1 });
  fireEvent.pointerMove(g, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(g, { clientX: to, pointerId: 1 });
};

describe("the side panel's width", () => {
  beforeEach(() => { localStorage.clear(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

  it("clamps to 280 … half the window (280 in a window narrower than 560); nonsense is the default", () => {
    expect([NAV_DEFAULT, NAV_MIN]).toEqual([340, 280]);
    expect(clampNav(100, 1366)).toBe(280);
    expect(clampNav(500.4, 1366)).toBe(500);
    expect(clampNav(2000, 1366)).toBe(683);
    expect(clampNav(2000, 1920)).toBe(960);
    expect(clampNav(400, 500)).toBe(280);
    expect(clampNav(NaN, 1366)).toBe(340);
  });

  it("340 the first time; a drag of the grip resizes, clamped, and is kept; a double-click resets and forgets", () => {
    const { container: c } = render(<Host />);
    const g = c.querySelector("#navGrip")!;
    expect(width(c)).toBe(340);
    expect((g as HTMLElement).style.left).toBe("340px");
    act(() => drag(g, 340, 420));
    expect(width(c)).toBe(420);
    expect(localStorage.getItem("sbNavWidth")).toBe("420");
    act(() => drag(g, 420, 50));                                   // past the minimum: stops at 280
    expect(width(c)).toBe(280);
    expect(localStorage.getItem("sbNavWidth")).toBe("280");
    act(() => drag(g, 280, 1300));                                 // past half the window: 683
    expect(width(c)).toBe(683);
    expect(localStorage.getItem("sbNavWidth")).toBe("683");
    cleanup();
    const again = render(<Host />).container;                      // the next time: the kept width
    expect(width(again)).toBe(683);
    act(() => { fireEvent.doubleClick(again.querySelector("#navGrip")!); });
    expect(width(again)).toBe(340);
    expect(localStorage.getItem("sbNavWidth")).toBeNull();
  });

  it("a plain click on the grip (no move) does not overwrite a kept width", () => {
    localStorage.setItem("sbNavWidth", "500");
    const { container: c } = render(<Host />);
    const g = c.querySelector("#navGrip")!;
    act(() => { fireEvent.pointerDown(g, { button: 0, clientX: 500, pointerId: 1 }); fireEvent.pointerUp(g, { clientX: 500, pointerId: 1 }); });
    expect(width(c)).toBe(500);
    expect(localStorage.getItem("sbNavWidth")).toBe("500");
    expect(document.body.classList.contains("navsizing")).toBe(false);
  });

  it("a lost pointer capture ends the drag (no col-resize cursor left behind)", () => {
    const { container: c } = render(<Host />);
    const g = c.querySelector("#navGrip")!;
    act(() => { fireEvent.pointerDown(g, { button: 0, clientX: 340, pointerId: 1 }); fireEvent.pointerMove(g, { clientX: 360, pointerId: 1 }); });
    expect(document.body.classList.contains("navsizing")).toBe(true);
    act(() => { fireEvent(g, new Event("lostpointercapture")); });
    expect(document.body.classList.contains("navsizing")).toBe(false);
    expect(width(c)).toBe(360);
  });

  it("a drag that ends back where it started redraws (a frame had drawn another width)", async () => {
    localStorage.setItem("sbNavWidth", "280");
    const { container: c } = render(<Host />);
    const g = c.querySelector("#navGrip") as HTMLElement;
    act(() => { fireEvent.pointerDown(g, { button: 0, clientX: 280, pointerId: 1 }); fireEvent.pointerMove(g, { clientX: 330, pointerId: 1 }); });
    await act(() => new Promise((r) => setTimeout(r, 20)));       // the frame draws 330
    expect(g.style.left).toBe("330px");
    act(() => { fireEvent.pointerMove(g, { clientX: 80, pointerId: 1 }); fireEvent.pointerUp(g, { clientX: 80, pointerId: 1 }); });
    expect(width(c)).toBe(280);
    expect(g.style.left).toBe("280px");
    expect(g.getAttribute("aria-valuenow")).toBe("280");
  });

  it("the keyboard: focusable, ←/→ 16 px (kept), Home the narrowest, End half the window, Enter the usual width; ARIA", () => {
    const { container: c } = render(<Host />);
    const g = c.querySelector("#navGrip") as HTMLElement;
    expect(g.tabIndex).toBe(0);
    expect([g.getAttribute("role"), g.getAttribute("aria-label"), g.getAttribute("aria-valuemin"), g.getAttribute("aria-valuemax"), g.getAttribute("aria-valuenow"), g.getAttribute("aria-controls")])
      .toEqual(["separator", "Side panel width", "280", "683", "340", "sideNav"]);
    act(() => { fireEvent.keyDown(g, { key: "ArrowRight" }); });
    expect(width(c)).toBe(356);
    expect(localStorage.getItem("sbNavWidth")).toBe("356");
    act(() => { fireEvent.keyDown(g, { key: "ArrowLeft" }); });
    act(() => { fireEvent.keyDown(g, { key: "ArrowLeft" }); });
    expect(width(c)).toBe(324);
    act(() => { fireEvent.keyDown(g, { key: "Home" }); });
    expect(width(c)).toBe(280);
    act(() => { fireEvent.keyDown(g, { key: "ArrowLeft" }); });
    expect(width(c)).toBe(280);
    act(() => { fireEvent.keyDown(g, { key: "End" }); });
    expect([width(c), g.getAttribute("aria-valuenow"), localStorage.getItem("sbNavWidth")]).toEqual([683, "683", "683"]);
    act(() => { fireEvent.keyDown(g, { key: "Enter" }); });
    expect(width(c)).toBe(340);
    expect(localStorage.getItem("sbNavWidth")).toBeNull();
  });

  it("a kept width wider than this window shows as half of it (and is kept for a wider one)", () => {
    localStorage.setItem("sbNavWidth", "900");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    const { container: c } = render(<Host />);
    expect(width(c)).toBe(600);
    expect(localStorage.getItem("sbNavWidth")).toBe("900");
  });

  it("blocked storage: the default, and nothing throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadNav()).toBe(340);
    expect(() => { saveNav(400); saveNav(null); }).not.toThrow();
    const { container: c } = render(<Host />);
    act(() => drag(c.querySelector("#navGrip")!, 340, 400));
    expect(width(c)).toBe(400);                                    // this session only
  });
});
