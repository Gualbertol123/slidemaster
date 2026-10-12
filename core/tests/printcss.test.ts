import { describe, expect, it } from "vitest";
import { printReady, vectorShadow } from "../src/render/printcss";

describe("slides made light for vector PDFs", () => {
  it("blurred shadows become sharp layers of fading strength; sharp ones and none stay", () => {
    const v = vectorShadow("0 22px 48px -24px rgba(28,40,100,calc(.14 + .22*var(--gi))),inset 0 1px 0 rgba(255,255,255,.9)");
    const parts = v.split(/,(?![^(]*\))/);
    expect(v).not.toMatch(/\b4[0-9]px\b/);                                         // no blur left
    expect(v.match(/color-mix\(in srgb, rgba\(28,40,100,calc\(\.14 \+ \.22\*var\(--gi\)\)\) 20%, transparent\)/g)).toHaveLength(5);
    expect(v).toContain("0px 22px 0 -32.64px");                                     // innermost layer
    expect(v).toContain("0px 22px 0 -9.6px");                                       // outermost: own spread + REACH·blur/2
    expect(v.endsWith("inset 0 1px 0 rgba(255,255,255,.9)")).toBe(true);
    expect(parts.length).toBeGreaterThan(5);
    expect(vectorShadow("none")).toBe("none");
    expect(vectorShadow("0 4px 10px rgba(0,0,0,.2) !important")).toMatch(/ !important$/);
    expect(vectorShadow("inset 0 2px 6px rgba(0,0,0,.2)")).toMatch(/^inset /);
  });
  it("in CSS and in style attributes; variable fonts give way to the classic ones", () => {
    const css = `.a{box-shadow:0 2px 8px rgba(0,0,0,.2);font-family:-apple-system,"SF Pro Display","Segoe UI Variable Display","Segoe UI",Arial}`;
    const out = printReady(css);
    expect(out).toContain("color-mix");
    expect(out).toContain(`font-family:-apple-system,"Segoe UI",Arial`);
    expect(printReady(`<div style="left:0;box-shadow:0 2px 6px -3px rgba(28,40,100,.25);top:1px">`)).toMatch(/style="left:0;box-shadow:[^"]*color-mix[^"]*;top:1px"/);
  });
});
