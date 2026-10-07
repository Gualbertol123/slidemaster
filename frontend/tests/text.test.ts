import { describe, expect, it } from "vitest";
import { cleanFamily, fontFaceCss, fontStack, guessFromName, parseGoogleCss, readFontInfo } from "../src/model/fonts";
import { cleanFmt, resolveStyle } from "../src/model/style";
import { coverHtml, indexHtml } from "../src/render/cover";
import { pageNoHtml } from "../src/render/pagenumbers";
import { areaFor, computeLayout } from "../src/render/slide";
import { effNote, fmtCss, slideTextFmt, titleGeom } from "../src/render/text";
import type { RenderCtx } from "../src/render/context";
import type { StylePatch } from "../src/model/types";

const ctx = (deck: StylePatch = {}, design: "glass" | "excel" = "glass"): RenderCtx =>
  ({ style: { ...resolveStyle(deck), design }, edits: {}, slides: [], preset: null, workbook: "w", logoSrc: "" });
const slide = (cfg: any = {}, extra: any = {}) => ({ id: "s", type: "content", tables: [], missing: 0, title: "Loans", subtitle: "", label: "Loans",
  cfg: { id: "s", type: "content", tables: [], ...cfg }, ...extra } as any);

describe("fonts", () => {
  it("family names are made safe for CSS and HTML", () => {
    expect(cleanFamily("Open Sans")).toBe("Open Sans");
    expect(cleanFamily(`Evil'; } body{x:url(y)}"<b>`)).toBe("Evil bodyxurlyb");
    expect(fontStack("Roboto")).toBe("'Roboto','Segoe UI',Arial,sans-serif");
    expect(fontStack("Playfair Display")).toContain("serif");
    expect(fontStack("Source Sans 3")).toContain("sans-serif");
    expect(fontStack("JetBrains Mono")).toContain("monospace");
    expect(fontStack("")).toBe("'Segoe UI',Arial,sans-serif");
  });
  it("@font-face rules for the library", () => {
    const css = fontFaceCss([{ family: "Brand", source: "upload", faces: [{ file: "Brand-700i.woff2", weight: 700, style: "italic", range: "U+0000-00FF" }] }], f => "/fonts/" + f);
    expect(css).toContain("font-family:'Brand'");
    expect(css).toContain(`url("/fonts/Brand-700i.woff2") format('woff2')`);
    expect(css).toContain("font-weight:700;font-style:italic;unicode-range:U+0000-00FF;");
  });
  it("Google stylesheets: latin subsets only", () => {
    const css = `/* cyrillic */\n@font-face {\n  font-family: 'Roboto';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/c.woff2) format('woff2');\n  unicode-range: U+0301, U+0400-045F;\n}\n` +
      `/* latin */\n@font-face {\n  font-family: 'Roboto';\n  font-style: italic;\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/l.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131;\n}\n`;
    expect(parseGoogleCss(css)).toEqual([{ weight: 700, style: "italic", url: "https://fonts.gstatic.com/l.woff2", range: "U+0000-00FF, U+0131" }]);
  });
  it("weight and style from a file name", () => {
    expect(guessFromName("OpenSans-SemiBoldItalic.ttf")).toEqual({ family: "Open Sans", weight: 600, style: "italic" });
    expect(guessFromName("Brand_Bold.otf")).toEqual({ family: "Brand", weight: 700, style: "normal" });
    expect(guessFromName("Brand.woff2")).toEqual({ family: "Brand", weight: 400, style: "normal" });
  });
  it("family, weight and italic are read from the font itself", async () => {
    expect(await readFontInfo(sfnt("Corporate Sans", 700, true), "whatever.ttf")).toEqual({ family: "Corporate Sans", weight: 700, style: "italic" });
    expect(await readFontInfo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, "Brand-Light.ttf")).toEqual({ family: "Brand", weight: 300, style: "normal" });
  });
});

describe("deck text styles", () => {
  it("resolve over the shared defaults, entry by entry; invalid values are dropped", () => {
    const s = resolveStyle({ text: { title: { font: "Lato", size: 60 }, note: { b: true } } }, { text: { title: { color: "#FF0000" } } });
    expect(s.text.title).toEqual({ color: "#FF0000" });             // the deck's entry replaces the default's
    expect(s.text.note).toEqual({ b: true });
    expect(cleanFmt({ font: " Inter ", size: -3, color: "red", align: "middle" as any, b: "yes" as any, i: false })).toEqual({ font: "Inter", i: false });
  });
  it("a slide's own formatting sits on top of the deck style", () => {
    const c = ctx({ text: { title: { font: "Lato", b: false, color: "#112233" } } });
    expect(slideTextFmt(c, slide({ fmt: { title: { size: 60, color: "#AA0000" } } }), "title")).toEqual({ font: "Lato", b: false, color: "#AA0000", size: 60 });
    expect(fmtCss({ font: "Lato", size: 60, b: false, i: true, color: "#AA0000", align: "center" }))
      .toBe("font-family:'Lato','Segoe UI',Arial,sans-serif;font-size:60px;font-weight:400;font-style:italic;color:#AA0000;text-align:center");
  });
  it("text boxes take the deck's text box style, their own settings win", () => {
    const c = ctx({ text: { note: { font: "Inter", size: 24, b: true } } });
    expect(effNote(c, { text: "x", b: false })).toEqual({ text: "x", font: "Inter", size: 24, b: false });
    // the larger deck size makes the box above a table taller
    const L = { id: "t1", def: { id: "t1" }, items: [], W: 300, H: 90, g: { r1: 1, c1: 1, r2: 5, c2: 5 }, rows: [], cols: [], sheet: { name: "S" } } as any;
    const R = slide({ tables: ["t1"], notes: { "t1:top": { text: "a\nb" } } }, { tables: [L] });
    const small = computeLayout(R, ctx({}, "excel")).boxes[0].notes.top!.h, big = computeLayout(R, ctx({ text: { note: { size: 36 } } }, "excel")).boxes[0].notes.top!.h;
    expect(big).toBeGreaterThan(small);
  });
  it("a larger title pushes the subtitle and the tables down", () => {
    const R = slide({ fmt: { title: { size: 72 } } }, { subtitle: "Weekly" });
    expect(titleGeom(R, ctx()).subTop).toBeGreaterThan(82);
    expect(areaFor(R, ctx()).y).toBeGreaterThan(areaFor(R).y);
    expect(areaFor(slide({}, { subtitle: "Weekly" }), ctx()).y).toBe(126);   // unchanged without formatting
  });
  it("cover, contents and page numbers use the text styles", () => {
    const c = ctx({ text: { title: { font: "Montserrat", size: 99 }, index: { font: "Lato", color: "#334455" }, pageno: { font: "Inter", b: true } }, pn: { on: true, font: "georgia" } });
    const cv = coverHtml(slide({ type: "cover", note: "Kick", fmt: { note: { color: "#FF0000" } } }, { type: "cover" }), true, 1, c);
    expect(cv).toContain("font-family:'Montserrat'");
    expect(cv).not.toContain("font-size:99px");                           // the cover title keeps its automatic size…
    expect(coverHtml(slide({ type: "cover", fmt: { title: { size: 90 } } }, { type: "cover" }), true, 1, c)).toContain("font-size:90px");   // …unless set on the cover
    expect(cv).toMatch(/cv-kicker" data-edit="note" style="color:#FF0000"/);
    c.slides = [slide()];
    expect(indexHtml(slide({ type: "index" }, { type: "index" }), c, true)).toContain("font-family:'Lato','Segoe UI',Arial,sans-serif;color:#334455");
    const pn = pageNoHtml(c, "3", true, false, false);
    expect(pn).toContain("font-family:'Inter'");
    expect(pn).toContain("font-weight:700");
    expect(pageNoHtml(ctx({ pn: { on: true, font: "georgia" } }), "3", true, false, false)).toContain("font-family:Georgia");   // older decks keep their page-number font
  });
});

/** a minimal TrueType file with a name table (family) and an OS/2 table (weight, italic bit) */
function sfnt(family: string, weight: number, italic: boolean): ArrayBuffer {
  const str = new Uint8Array(family.length * 2); family.split("").forEach((ch, i) => { str[i * 2] = 0; str[i * 2 + 1] = ch.charCodeAt(0); });
  const name = new Uint8Array(6 + 12 + str.length), nv = new DataView(name.buffer);
  nv.setUint16(0, 0); nv.setUint16(2, 1); nv.setUint16(4, 18);
  nv.setUint16(6, 3); nv.setUint16(8, 1); nv.setUint16(10, 0x409); nv.setUint16(12, 1); nv.setUint16(14, str.length); nv.setUint16(16, 0);
  name.set(str, 18);
  const os2 = new Uint8Array(78), ov = new DataView(os2.buffer); ov.setUint16(4, weight); ov.setUint16(62, italic ? 1 : 0);
  const head = 12 + 2 * 16, out = new Uint8Array(head + name.length + os2.length), v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000); v.setUint16(4, 2);
  const rec = (i: number, tag: string, off: number, len: number) => { const e = 12 + i * 16; for (let k = 0; k < 4; k++) v.setUint8(e + k, tag.charCodeAt(k)); v.setUint32(e + 8, off); v.setUint32(e + 12, len); };
  rec(0, "OS/2", head + name.length, os2.length); rec(1, "name", head, name.length);
  out.set(name, head); out.set(os2, head + name.length);
  return out.buffer;
}

describe("text boxes beside all tables", () => {
  it("a spanning box takes a column next to every table, as tall as all of them", () => {
    const L = (id: string) => ({ id, def: { id }, items: [], W: 600, H: 200, g: { r1: id === "a" ? 1 : 30, c1: 1, r2: id === "a" ? 20 : 50, c2: 5 }, rows: [], cols: [], sheet: { name: "S" } } as any);
    const R = slide({ tables: ["a", "b"], notes: { "a:right": { text: "x", span: true, w: 400 } } }, { tables: [L("a"), L("b")] });
    const { boxes } = computeLayout(R, ctx({}, "excel"));
    const n = boxes[0].notes.right!, right = Math.max(boxes[0].x + boxes[0].w, boxes[1].x + boxes[1].w);
    expect(n.w).toBe(400);
    expect(n.x).toBeGreaterThan(right);                                              // beside both tables, not over the second
    expect(n.y).toBe(boxes[0].y);
    expect(n.h).toBeCloseTo(boxes[1].y + boxes[1].h - boxes[0].y, 0);              // from the top of the first to the bottom of the last
    expect(n.x + n.w).toBeLessThanOrEqual(1550);
  });
});
