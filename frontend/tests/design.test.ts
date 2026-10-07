import { describe, expect, it } from "vitest";
import { palette, resolveStyle } from "../src/model/style";
import { renderClean } from "../src/render/clean";
import { renderExcel } from "../src/render/excel";
import { rolesOf } from "../src/render/roles";
import { themeVars } from "../src/render/slide";
import type { RenderCtx } from "../src/render/context";
import type { StylePatch } from "../src/model/types";

/* header (2 rows) · spacer · total · spacer · 3 body rows; Δ column with green/red cells */
const ROWS = [["", "Week39", "Δ vs. Budget"], ["", "25/09/26", "Abs."], ["", "", ""], ["TOTAL LOANS", "300", "12"], ["", "", ""], ["VUB", "100", "5"], ["PBZ", "120", "-3"], ["BIB", "80", "10"]];
function table() {
  const cells = new Map<string, any>(), items: any[] = [], rows: number[] = [], cols = [2, 3, 4];
  const colX = new Map<number, number>(), colW = new Map<number, number>(), rowY = new Map<number, number>(), rowH = new Map<number, number>();
  cols.forEach((c, j) => { colX.set(c, j * 80); colW.set(c, 80); });
  ROWS.forEach((row, i) => {
    const r = i + 2; rows.push(r); rowY.set(r, i * 20); rowH.set(r, 20);
    row.forEach((t, j) => {
      const c = cols[j], num = /^-?\d+$/.test(t);
      if (num) cells.set(r + "," + c, { r, c, v: +t, t: "n" });
      const fill = i < 2 && j > 0 ? "#1F4E79" : i >= 5 && j === 2 ? (+t > 0 ? "#00B050" : "#FF0000") : null;
      items.push({ b: { r, c, r2: r, c2: c, src: { r, c } }, bx: j * 80, by: i * 20, bw: 80, bh: 20, text: t, isText: !num, fill, baseFill: fill, color: "#000000",
        font: { sz: 11, b: i === 3 }, align: num ? "right" : "left", valign: "bottom", wrap: false, indent: 0, rot: 0, ctype: num ? "n" : "s" });
    });
  });
  const L: any = { id: "t", def: { id: "t" }, rows, cols, items, colX, colW, rowY, rowH, W: 240, H: 160, g: { r1: 1, c1: 1, r2: 10, c2: 5 }, pics: [], rects: [], texts: [],
    sheet: { name: "S", get: (r: number, c: number) => cells.get(r + "," + c) || null } };
  items.forEach(it => it.L = L);
  return L;
}
const ctx = (st: StylePatch = {}): RenderCtx => ({ style: resolveStyle(st), edits: {}, slides: [], preset: null, workbook: "w", logoSrc: "" });

describe("designs and colours", () => {
  it("three designs; the palette comes from the theme, overrides win, bad values are dropped", () => {
    expect(resolveStyle({ design: "clean" }).design).toBe("clean");
    expect(resolveStyle({ design: "nope" as any }).design).toBe("glass");
    const intesa = palette(resolveStyle({ theme: { id: "intesa" } }));
    expect(intesa.accent).toBe("#006A35");
    expect(intesa.head).toBe("#006A35");
    const P = palette(resolveStyle({ theme: { id: "intesa" }, colors: { head: "#5b2c83", pos: "blue" as any } }));
    expect(P.head).toBe("#5B2C83");
    expect(P.pos).toBe("#1E8E3E");
  });
  it("finds header, total, body and spacer rows", () => {
    const k = rolesOf(table(), ctx()).kind;
    expect([...k.values()]).toEqual(["header", "header", "spacer", "total", "spacer", "body", "body", "body"]);
  });
  it("Excel Refined: palette header band, tinted total, striped body, soft green/red tiles", () => {
    const P = palette(resolveStyle({ design: "clean" }));
    const h = renderClean(table(), ctx({ design: "clean" }));
    expect(h).toContain(`background:${P.head}`);
    expect(h).toContain(`background:${P.total};border-top:2px solid ${P.accent}`);
    expect(h).toContain(`background:${P.stripe}`);
    expect(h).toContain("background:rgba(30,142,62,0.13)");          // +5 on green
    expect(h).toContain("background:rgba(217,48,37,0.13)");          // -3 on red
    const o = renderClean(table(), ctx({ design: "clean", colors: { head: "#5B2C83", pos: "#0077B6" } }));
    expect(o).toContain("background:#5B2C83");
    expect(o).toContain("background:rgba(0,119,182,0.13)");
  });
  it("Excel is raw: the workbook's colours, whatever the deck's colours say; no text boxes", async () => {
    const pure = renderExcel(table(), ctx({ design: "excel" }));
    expect(pure).toContain("background:#1F4E79"); expect(pure).toContain("background:#00B050");
    expect(renderExcel(table(), ctx({ design: "excel", colors: { head: "#5B2C83", pos: "#0077B6" } }))).toBe(pure);
    const { notesOf } = await import("../src/render/slide");
    const R: any = { tables: [{ id: "t" }], cfg: { notes: { "t:right": { text: "x" } } } };
    expect(notesOf(R, 0, ctx({ design: "excel" }))).toEqual({});
    expect(notesOf(R, 0, ctx({ design: "clean" })).right?.text).toBe("x");
  });
  it("each design can have its own colours, text styles and theme over the shared ones", () => {
    const st = { colors: { accent: "#111111", pos: "#00AA00" }, designs: { clean: { colors: { accent: "#222222" }, text: { title: { font: "Lato" } }, theme: { id: "intesa" } } } } as any;
    expect(palette(resolveStyle({ ...st, design: "clean" })).accent).toBe("#222222");
    expect(palette(resolveStyle({ ...st, design: "clean" })).pos).toBe("#00AA00");                 // shared value still applies
    expect(resolveStyle({ ...st, design: "clean" }).text.title).toEqual({ font: "Lato" });
    expect(resolveStyle({ ...st, design: "clean" }).theme.id).toBe("intesa");
    expect(palette(resolveStyle({ ...st, design: "glass" })).accent).toBe("#111111");
    expect(resolveStyle({ ...st, design: "glass" }).text.title).toBeUndefined();
  });
  it("accent, green/red and background overrides reach every design as CSS variables", () => {
    const v = themeVars(ctx({ design: "glass", colors: { accent: "#AA0000", pos: "#0077B6", bg: "#F5F5F0" } }));
    expect(v["--a1"]).toBe("#AA0000"); expect(v["--x1"]).toBe("#AA0000"); expect(v["--posrgb"]).toBe("0,119,182");
    expect(v["--slidebg"]).toBeUndefined();                                            // Liquid Glass: background from the theme
    expect(themeVars(ctx({ design: "clean", colors: { bg: "#F5F5F0" } }))["--slidebg"]).toBe("#F5F5F0");
    expect(themeVars(ctx({ design: "excel" }))).toEqual({});
  });
});

describe("versions", () => {
  it("cells removed in a version are drawn empty and leave the comments' numbers", async () => {
    const { effItems } = await import("../src/render/edits");
    const { gridOf } = await import("../src/render/comment");
    const L = table(), v = { id: "v1", name: "All", hide: { S: ["D7:D8"] } };       // Δ column of VUB and PBZ
    const full = effItems(L, ctx({ design: "clean" })), cut = effItems(L, { ...ctx({ design: "clean" }), version: v });
    const at = (its: any[], r: number, c: number) => its.find(x => x.b.src.r === r && x.b.src.c === c);
    expect(at(full, 7, 4).text).toBe("5"); expect(at(full, 7, 4).fill).toBe("#00B050");
    expect(at(cut, 7, 4)).toMatchObject({ text: "", fill: null, removed: true });
    expect(at(cut, 9, 4).text).toBe("10");                                                 // outside the range: kept
    const g = gridOf(L, { ...ctx({ design: "clean" }), version: v });
    expect(g[5][2].v).toBeNull();                                                          // no number for the comment either
    expect(renderClean(L, { ...ctx({ design: "clean" }), version: v })).not.toContain(">5<");
  });
});
