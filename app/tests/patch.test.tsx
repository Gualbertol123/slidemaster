/* A layer's markup patched piece by piece (stage/patch.ts, S4.1): the element shows what the whole markup would show,
   and the elements of unchanged pieces are kept (the same nodes). */
import { describe, expect, it } from "vitest";
import { drawChunks, topLevel } from "../src/stage/patch";
import { svgChunks } from "@slide-builder/core/dl/svg";
import type { DisplayList } from "@slide-builder/core/dl/types";

const svg = () => document.createElementNS("http://www.w3.org/2000/svg", "svg");
const same = (a: Element, b: Element) => expect(a.innerHTML).toBe(b.innerHTML);
const id = (s: string) => s;
/** a table-like list: per cell a hit, a fill and a clipped text */
const cells = (texts: string[]): DisplayList => texts.flatMap((t, i): DisplayList => [
  { t: "hit", kind: "t", id: `${i},1`, x: 0, y: i * 20, w: 80, h: 20, label: t },
  { t: "rect", x: 0, y: i * 20, w: 80, h: 20, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: [200, 220, 240], a: 1 }, { o: 1, c: [180, 200, 230], a: .5 }] } },
  { t: "group", clip: { x: 0, y: i * 20, w: 80, h: 20 }, children: [{ t: "text", font: "Arial", size: 12, x: 60, y: i * 20 + 15, src: t, w: 40, fill: { solid: [0, 0, 0] } }] },
]);
const chunks = (texts: string[]) => svgChunks(cells(texts), { imageHref: () => undefined, idPrefix: "t0-", hits: () => ({ cls: "t", label: true }) });

describe("patching a layer's markup", () => {
  it("counts the top-level elements of a piece", () => {
    expect(topLevel(`<defs><clipPath id="a"><path d="M0 0Z"/></clipPath></defs><g clip-path="url(#a)"><text x="1">a &lt; b</text></g>`)).toBe(2);
    expect(topLevel(`<rect x="1"/><rect x="2"><desc>x</desc></rect>`)).toBe(2);
    expect(topLevel("")).toBe(0);
  });
  it("one cell changed: only its pieces are replaced, and the element equals the whole markup's", () => {
    const before = chunks(["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]), after = chunks(["Alfa", "Beta", "Gamma!!", "Delta", "Epsilon", "Zeta"]);
    const el = svg(), drawn = drawChunks(el, null, before, id)!;
    expect(drawn).not.toBe(null);
    const kept = [...el.children], firstText = el.querySelector("text")!, lastRect = el.querySelectorAll("rect")[11];
    const next = drawChunks(el, drawn, after, id)!;
    const whole = svg(); whole.innerHTML = after.join("");
    same(el, whole);
    expect(el.querySelector("text")).toBe(firstText);                                 // kept: the same node
    expect(el.querySelectorAll("rect")[11]).toBe(lastRect);
    expect(kept.filter(k => el.contains(k)).length).toBeGreaterThan(kept.length - 6);  // a few elements replaced
    // and again, from the patched state
    const third = chunks(["Alfa", "Beta", "Gamma!!", "Delta", "Epsilon", "Zeta 2"]);
    drawChunks(el, next, third, id); whole.innerHTML = third.join(""); same(el, whole);
  });
  it("cells added or removed, most changed, nothing changed: the element always equals the whole markup's", () => {
    const el = svg(); let d = drawChunks(el, null, chunks(["a", "b", "c", "d"]), id);
    for (const t of [["a", "b", "x", "c", "d"], ["a", "d"], ["p", "q", "r", "s", "t", "u"], ["p", "q", "r", "s", "t", "u"], []]) {
      const c = chunks(t); d = drawChunks(el, d, c, id);
      const whole = svg(); whole.innerHTML = c.join(""); same(el, whole);
    }
  });
  it("pictures: the markup parsed is the fixed one; an element that disagrees with the counting is drawn whole from then on", () => {
    const el = svg(), d = drawChunks(el, null, [`<image href="sbimg:x"/>`], s => s.replace("sbimg:x", "blob:1"))!;
    expect(el.innerHTML).toContain("blob:1");
    el.appendChild(svg());                                                          // something else put an element there
    const r = drawChunks(el, d, [`<image href="sbimg:x"/>`, `<rect x="1"/>`], id);
    expect(el.querySelectorAll("rect").length).toBe(1);
    expect(r === null || el.children.length === 2).toBe(true);
  });
});
