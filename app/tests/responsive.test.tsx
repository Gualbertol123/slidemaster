/* The window's width (4.12, the owner's request of 2026-10-22: "the toolbars at the top and on the left should adapt
   responsively"): a toolbar keeps to one row – its least needed groups compact, then into More ▾ (ui/OverflowBar.tsx) –
   and the side panel folds to a rail, by itself below 1100 px until the person chooses, the choice kept in this browser
   (ui/NavResize.tsx useNavRail, ui/NavRail.tsx). (e2e: responsive.spec.ts RZ-01 at the owner's window sizes.) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { fitBar, OverflowBar, planBar, rowsOf, type BarUnit } from "../src/ui/OverflowBar";
import { isRail, loadRail, NAV_AUTO_RAIL, NAV_RAIL, navColumns, useNavRail } from "../src/ui/NavResize";
import { NavRail } from "../src/ui/NavRail";
import { get, initialState, patch, useStore } from "../src/state/store";

const u = (full: number, compact: number, prio = 0, fixed = false): BarUnit => ({ full, compact, prio, fixed });

describe("a toolbar's plan", () => {
  // five groups, 10 px apart: 100 + 200 + 150 + 120 + 80 = 650 in full (+ 40 of gaps), 60 + 120 + 100 + 80 + 50 = 410 compact;
  // the least needed first: 3 (prio 5), 2 (3), 4 (2), 1 (1), 0 (0)
  const G = [u(100, 60, 0), u(200, 120, 1), u(150, 100, 3), u(120, 80, 5), u(80, 50, 2)];
  it("rows as the browser wraps them", () => {
    expect(rowsOf([], 100, 10)).toBe(0);
    expect(rowsOf([40, 50], 100, 10)).toBe(1);
    expect(rowsOf([40, 51], 100, 10)).toBe(2);
    expect(rowsOf([150, 20], 100, 10)).toBe(2);                   // a unit wider than the row: a row of its own
  });
  it("all fits: as written", () => {
    expect(planBar(G, 691, 10, 70)).toEqual({ compact: [], hidden: [], rows: 1 });
  });
  it("too narrow: compact, the least needed first, one at a time", () => {
    expect(planBar(G, 660, 10, 70)).toEqual({ compact: [3], hidden: [], rows: 1 });             // −40
    expect(planBar(G, 600, 10, 70)).toEqual({ compact: [2, 3, 4], hidden: [], rows: 1 });       // then 2, then 4
    expect(planBar(G, 561, 10, 70)).toEqual({ compact: [1, 2, 3, 4], hidden: [], rows: 1 });
    expect(planBar(G, 480, 10, 70)).toEqual({ compact: [0, 1, 2, 3, 4], hidden: [], rows: 1 });
  });
  it("then, all compact, into More (with room for its button) – the least needed first, the later of two alike first", () => {
    expect(planBar(G, 400, 10, 70)).toEqual({ compact: [0, 1, 2, 3, 4], hidden: [2, 3], rows: 1 });
    expect(planBar(G, 300, 10, 70).hidden).toEqual([2, 3, 4]);
    expect(planBar([u(100, 100, 1), u(100, 100, 1), u(100, 100, 1)], 261, 10, 40).hidden).toEqual([2]);
  });
  it("back from More whatever still fits: a small, less needed group after a large one went", () => {
    expect(planBar([u(100, 100, 0), u(400, 400, 1), u(50, 50, 5)], 300, 10, 40).hidden).toEqual([1]);
  });
  it("a bar that may take two rows: two rows as written before compact ones; then compact; then More", () => {
    expect(planBar(G, 400, 10, 70, 2)).toEqual({ compact: [], hidden: [], rows: 2 });
    expect(planBar(G, 691, 10, 70, 2)).toEqual({ compact: [], hidden: [], rows: 1 });          // one row when it fits
    expect(planBar(G, 600, 10, 70, 2)).toEqual({ compact: [2, 3, 4], hidden: [], rows: 1 });   // one compact row first
    expect(planBar(G, 250, 10, 70, 2)).toEqual({ compact: [0, 1, 2, 3, 4], hidden: [3], rows: 2 });
  });
  it("a fixed part (the file name's room, the spacer) is never compacted or moved", () => {
    const p = planBar([u(100, 50, 9), u(90, 90, 0, true), u(300, 300, 0)], 300, 10, 60);
    expect(p.hidden).not.toContain(1); expect(p.compact).not.toContain(1);
    expect(p.hidden).toEqual([2]);                               // (0 came back: 50 + 90 + 60 fits)
  });
  it("nothing fits even so: everything that can go is in More", () => {
    expect(planBar([u(500, 400, 0), u(500, 400, 1)], 100, 10, 60).hidden).toEqual([0, 1]);
  });
});

describe("a toolbar measured in the page", () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ""; });
  /** a bar laid out by hand: each group's width full or compact (as the page's CSS would draw it) */
  function bar(widths: [number, number, number?][], avail: number) {
    const el = document.createElement("nav");
    el.style.columnGap = "10px";
    widths.forEach(([full, compact, prio], i) => {
      const g = document.createElement("div"); g.className = "grp"; g.id = "g" + i;
      if (prio !== undefined) g.setAttribute("data-prio", String(prio));
      g.getBoundingClientRect = () => { const w = g.hasAttribute("data-compact") ? compact : full; return { width: w, height: 30, left: 0, top: 0, right: w, bottom: 30, x: 0, y: 0, toJSON() {} }; };
      el.append(g);
    });
    const more = document.createElement("button"); more.setAttribute("data-more-btn", "");
    more.getBoundingClientRect = () => ({ width: 70, height: 30, left: 0, top: 0, right: 70, bottom: 30, x: 0, y: 0, toJSON() {} });
    el.append(more);
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => avail });
    document.body.append(el);
    return { el, set: (w: number) => { avail = w; } };
  }
  const marks = (el: HTMLElement, a: string) => [...el.querySelectorAll(".grp")].filter(g => g.hasAttribute(a)).map(g => g.id);

  it("marks the groups as planned, and again at another width (the marks are attributes React does not own)", () => {
    const { el, set } = bar([[100, 60, 0], [200, 120, 1], [150, 100, 3], [120, 80, 5], [80, 50, 2]], 1000);
    fitBar(el);
    expect(marks(el, "data-compact")).toEqual([]); expect(el.hasAttribute("data-has-more")).toBe(false);
    set(600); fitBar(el);
    expect(marks(el, "data-compact")).toEqual(["g2", "g3", "g4"]);
    expect(marks(el, "data-ovf")).toEqual([]);
    set(400); fitBar(el);
    expect(marks(el, "data-compact")).toEqual(["g0", "g1", "g2", "g3", "g4"]);   // (g2, g3 in More: the CSS draws them in full there)
    expect(marks(el, "data-ovf")).toEqual(["g2", "g3"]);
    expect(el.getAttribute("data-has-more")).toBe("2");
    expect(el.hasAttribute("data-wrap")).toBe(false);
    el.setAttribute("data-max-rows", "2"); fitBar(el);           // a bar that may take two rows: two, nothing in More
    expect(marks(el, "data-ovf")).toEqual([]); expect(el.hasAttribute("data-wrap")).toBe(true);
    el.removeAttribute("data-max-rows");
    expect(el.hasAttribute("data-measure")).toBe(false);
    const close = vi.fn();
    set(1000); fitBar(el, close);
    expect(marks(el, "data-ovf")).toEqual([]); expect(marks(el, "data-compact")).toEqual([]);
    expect(close).toHaveBeenCalled();                          // nothing left in More: it closes
  });
  it("a bar not laid out (no width) is left alone", () => {
    const { el, set } = bar([[100, 60]], 0);
    set(0); fitBar(el);
    expect(el.hasAttribute("data-has-more")).toBe(false);
    expect(marks(el, "data-compact")).toEqual([]);
  });

  it("More ▾ opens the bar over what is below it and keeps its row's place; Esc or a press outside closes it", () => {
    const { container: c } = render(<div><OverflowBar className="ribbon"><div className="grp">A</div></OverflowBar><p id="out">x</p></div>);
    const nav = c.querySelector("nav.ribbon.obar") as HTMLElement, more = c.querySelector(".obmore") as HTMLButtonElement;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    Object.defineProperty(nav, "offsetHeight", { configurable: true, value: 43 });
    act(() => { fireEvent.click(more); });
    expect(nav.hasAttribute("data-more")).toBe(true);
    expect((c.querySelector(".obslot") as HTMLElement).style.height).toBe("43px");
    act(() => { fireEvent.pointerDown(nav.querySelector(".grp")!); });   // inside: stays open
    expect(nav.hasAttribute("data-more")).toBe(true);
    act(() => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(nav.hasAttribute("data-more")).toBe(false);
    expect((c.querySelector(".obslot") as HTMLElement).style.height).toBe("");
    act(() => { fireEvent.click(more); });
    act(() => { fireEvent.pointerDown(c.querySelector("#out")!); });
    expect(nav.hasAttribute("data-more")).toBe(false);
  });
});

describe("the side panel's rail", () => {
  function Host() { const [rail, toggle] = useNavRail(); return <div><span id="r">{rail ? "rail" : "open"}</span><span id="cols">{navColumns(340, rail)}</span><button id="t" onClick={toggle} /></div>; }
  const state = (c: HTMLElement) => c.querySelector("#r")!.textContent;
  const resize = (w: number) => act(() => { Object.defineProperty(window, "innerWidth", { configurable: true, value: w }); window.dispatchEvent(new Event("resize")); });
  beforeEach(() => { localStorage.clear(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 }); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("follows the window until the person chooses: a rail below 1100 px", () => {
    expect([NAV_RAIL, NAV_AUTO_RAIL]).toEqual([48, 1100]);
    expect(isRail(null, 1099)).toBe(true); expect(isRail(null, 1100)).toBe(false);
    expect(isRail("open", 800)).toBe(false); expect(isRail("rail", 1920)).toBe(true);
    const { container: c } = render(<Host />);
    expect(state(c)).toBe("open");
    expect(c.querySelector("#cols")!.textContent).toBe("340px minmax(0,1fr)");
    resize(1024);
    expect(state(c)).toBe("rail");
    expect(c.querySelector("#cols")!.textContent).toBe("48px minmax(0,1fr)");
    resize(1440);
    expect(state(c)).toBe("open");
    expect(loadRail()).toBe(null);                              // nothing chosen, nothing kept
  });
  it("opened on a narrow window it stays open (kept); folded on a wide one it stays folded; the next time too", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    const { container: c } = render(<Host />);
    expect(state(c)).toBe("rail");
    act(() => { fireEvent.click(c.querySelector("#t")!); });
    expect(state(c)).toBe("open");
    expect(localStorage.getItem("sbNavRail")).toBe("open");
    resize(900);
    expect(state(c)).toBe("open");
    resize(1920);
    act(() => { fireEvent.click(c.querySelector("#t")!); });
    expect(state(c)).toBe("rail");
    expect(localStorage.getItem("sbNavRail")).toBe("rail");
    cleanup();
    expect(state(render(<Host />).container)).toBe("rail");     // kept for the next time
  });
  it("storage blocked: the window decides, nothing breaks", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(loadRail()).toBe(null);
      const { container: c } = render(<Host />);
      act(() => { fireEvent.click(c.querySelector("#t")!); });
      expect(state(c)).toBe("rail");
    } finally { vi.restoreAllMocks(); }
  });
  it("the rail: the slides by number (the current one marked; a click shows it), New slide, the button that opens the panel", () => {
    useStore.setState(initialState());
    patch("doc", { open: true });
    patch("deck", { slides: [{ id: "a" }, { id: "b" }, { id: "c" }] as never, cur: 1 });
    const toggle = vi.fn();
    const { container: c } = render(<NavRail toggle={toggle} />);
    const nums = [...c.querySelectorAll(".railslide")];
    expect(nums.map(b => b.textContent)).toEqual(["1", "2", "3"]);
    expect(nums[1].classList.contains("on")).toBe(true);
    act(() => { fireEvent.click(nums[2]); });
    expect(get().deck.cur).toBe(2);
    act(() => { fireEvent.click(c.querySelector("#navRailBtn")!); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect((c.querySelector("#railNewSlide") as HTMLButtonElement).disabled).toBe(false);
  });
});
