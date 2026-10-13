/* Text measured from font files (S4.4, text/measure.ts): the face the browser would draw with, HarfBuzz widths,
   ascent / descent as Chromium rounds them, and the page for what has no readable file. */
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FontMeasurer, parseFont } from "../src/text/measure";
import { shaper } from "../src/text/shape";
import { FontRegistry } from "../src/text/fonts";
import { legacyKern } from "../src/text/kern";
import type { CatalogFont } from "../src/text/resolve";
import type { RunReq, TextMeasurer } from "../src/platform";

const FONTS = path.join(__dirname, "fixtures", "fonts");
const font = (f: string) => new Uint8Array(fs.readFileSync(path.join(FONTS, f)));
const sys = (file: string, family: string, weight = 400, italic = false): CatalogFont => ({ source: "system", file, family, weight, italic });
const CAT = [sys("Carlito-Regular.ttf", "Carlito"), sys("Carlito-Bold.ttf", "Carlito", 700), { source: "library", file: "lib.otf", family: "Brand", weight: 400, italic: false } as CatalogFont, sys("broken.ttf", "Broken")];
const FILES: Record<string, Uint8Array> = { "Carlito-Regular.ttf": font("Carlito-Regular.ttf"), "Carlito-Bold.ttf": font("Carlito-Bold.ttf"), "lib.otf": font("SourceSans3-Regular.otf"), "broken.ttf": new TextEncoder().encode("not a font") };

function measurer() {
  const asked: RunReq[] = [], read: string[] = [];
  const page: TextMeasurer = { maxDigitWidth: () => 99, noteFits: () => true, measureRuns: runs => { asked.push(...runs); return runs.map(() => ({ w: -1, asc: -1, desc: -1 })); }, breakLines: reqs => reqs.map(() => ["page"]) };
  const m = new FontMeasurer(shaper(), { catalog: async () => CAT, bytes: async f => { read.push(f.file); return FILES[f.file] ?? null; } }, page);
  return { m, asked, read };
}

describe("text measured from font files (S4.4)", () => {
  test("a CSS font shorthand: style, weight, size, families", () => {
    expect(parseFont("italic 700 14.67px Calibri, 'Segoe UI', sans-serif")).toEqual({ italic: true, weight: 700, size: 14.67, families: ["Calibri", "Segoe UI", "sans-serif"] });
    expect(parseFont("bold 11px Arial")).toMatchObject({ weight: 700, size: 11 });
    expect(parseFont("13px/1.2 \"Century Gothic\", Arial")).toMatchObject({ weight: 400, size: 13, families: ["Century Gothic", "Arial"] });
  });
  test("the first family of the list that has a file draws it: widths from HarfBuzz, ascent and descent rounded as Chromium's", async () => {
    const { m, asked, read } = measurer(), sh = await shaper(), reg = new FontRegistry(), carlito = reg.add(font("Carlito-Regular.ttf"))[0], bold = reg.add(font("Carlito-Bold.ttf"))[0];
    const [a, b] = await m.measureRuns([{ text: "Totale crediti 1.234,5", font: "14.67px Calibri, Carlito, sans-serif" }, { text: "Δ €", font: "bold 20px Carlito" }]);
    expect(a.w).toBeCloseTo(sh.shape(carlito, "Totale crediti 1.234,5", 14.67).w, 6);
    expect(b.w).toBeCloseTo(sh.shape(bold, "Δ €", 20).w, 6);
    for (const r of [a, b]) { expect(Number.isInteger(r.asc)).toBe(true); expect(Number.isInteger(r.desc)).toBe(true); }
    expect(asked).toEqual([]);
    expect(read.sort()).toEqual(["Carlito-Bold.ttf", "Carlito-Regular.ttf"]);         // only the faces used
  });
  test("the page measures what has no readable file: a family not here, a broken file, a character the face lacks", async () => {
    const { m, asked } = measurer();
    const r = await m.measureRuns([{ text: "x", font: "12px Missing" }, { text: "y", font: "12px Broken" }, { text: "中文", font: "12px Carlito" }, { text: "ok", font: "12px Brand" }]);
    expect(r.map(x => x.w > 0)).toEqual([false, false, false, true]);
    expect(asked.map(x => x.text)).toEqual(["x", "y", "中文"]);
    expect(m.stats).toEqual({ font: 1, page: 3 });
    expect(await m.breakLines([{ text: "a b c", font: "12px Missing", width: 5 }, { text: "aaa bbb", font: "12px Carlito", width: 20 }])).toEqual([["page"], ["aaa", "bbb"]]);
    expect(await m.maxDigitWidth("12px Missing")).toBe(99);
    expect(await m.maxDigitWidth("15px Carlito")).toBeGreaterThan(5);
  });
  test("tabular figures: shaped with tnum, each character's advance", async () => {
    const { m } = measurer();
    const [r] = await m.measureRuns([{ text: "1.10", font: "12px Carlito", tnum: true }]);
    expect(r.adv).toHaveLength(4);
    expect(r.adv![0]).toBeCloseTo(r.adv![2], 6);                                  // "1" and "1" (tabular: equal)
  });
  test("width() answers at once after prepare(), null before (and for fonts without a file)", async () => {
    const { m } = measurer();
    expect(m.width("Total", "500 11px Carlito")).toBeNull();
    await m.prepare(["500 11px Carlito", "12px Missing"]);
    expect(m.width("Total", "500 13px Carlito")).toBeGreaterThan(20);              // any size of a prepared font
    expect(m.width("Total", "12px Missing")).toBeNull();
    m.reset();
    expect(m.width("Total", "500 13px Carlito")).toBeNull();
  });
  test("the legacy kern table is used only when GPOS has no kern feature", () => {
    const reg = new FontRegistry(), carlito = reg.add(font("Carlito-Regular.ttf"))[0];
    // Carlito kerns in GPOS: its kern table, if any, is not applied again
    expect(legacyKern(carlito.font)).toBeNull();
  });
});

describe("outlines on screen where the browser's text would differ (S4.4, 05 §3.4)", () => {
  test("the per-font check flags a face whose page widths differ by more than 0.5 %; only its runs come as outlines", async () => {
    const sh = await shaper();
    let factor = 1;
    const page: TextMeasurer = { maxDigitWidth: () => 0, noteFits: () => true, breakLines: r => r.map(x => [x.text]),
      measureRuns: runs => runs.map(r => ({ w: sh.width(new FontRegistry().add(font(/bold/.test(r.font) ? "Carlito-Bold.ttf" : "Carlito-Regular.ttf"))[0], r.text, parseFloat(/([\d.]+)px/.exec(r.font)![1])) * factor, asc: 0, desc: 0 })) };
    const m = new FontMeasurer(shaper(), { catalog: async () => CAT, bytes: async f => FILES[f.file] ?? null }, page);
    await m.prepare(["400 11px Carlito", "700 11px Carlito"]);
    await m.check(["400 11px Carlito"]);                                              // the page agrees: drawn as text
    const n = { t: "text" as const, font: "Carlito", css: "Carlito", size: 14.67, x: 10, y: 20, src: "Totale 1.234", w: 80, fill: { solid: [0, 0, 0] as [number, number, number] } };
    expect(m.outlineRun(n)).toBeNull();
    factor = 1.01;                                                                     // the page's bold is 1 % wider: outlines
    await m.check(["700 11px Carlito"]);
    const o = m.outlineRun({ ...n, b: true })!;
    expect(o.glyphs.map(g => g.key.split("-")[1]).length).toBe([..."Totale 1.234"].length);
    expect(o.glyphs.filter(g => g.d).length).toBe(11);                                 // the space has no outline
    expect(o.glyphs.at(-1)!.x).toBeGreaterThan(70);                                   // pinned to the run's width (80)
    m.outlineAll = true;
    expect(m.outlineRun(n)).not.toBeNull();                                            // the switch: every font
    expect(m.outlineRun({ ...n, i: true })).toBeNull();                                // a synthetic italic stays text
  });
});

describe("review fixes (S4.4)", () => {
  test("a family the catalog has but cannot read (a WOFF2 upload) is measured by the page, never by the next family", async () => {
    const { m, asked } = measurer();
    const [r] = await m.measureRuns([{ text: "Brand text", font: "12px Broken, Carlito" }]);
    expect(r.w).toBe(-1);
    expect(asked.map(a => a.font)).toEqual(["12px Broken, Carlito"]);
    expect(m.width("x", "12px Broken, Carlito")).toBeNull();
  });
  test("a font file slower than the budget: the page measures meanwhile, and its arrival asks for one redraw", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const asked: string[] = [];
    const page: TextMeasurer = { maxDigitWidth: () => 0, noteFits: () => true, measureRuns: runs => { asked.push(...runs.map(r => r.text)); return runs.map(() => ({ w: -1, asc: 0, desc: 0 })); }, breakLines: r => r.map(x => [x.text]) };
    const m = new FontMeasurer(shaper(), { catalog: async () => CAT, bytes: async f => { await gate; return FILES[f.file] ?? null; } }, page);
    m.budget = 30;
    let late = 0; m.onLate = () => { late++; };
    const [a] = await m.measureRuns([{ text: "slow", font: "12px Carlito" }, { text: "slow bold", font: "bold 12px Carlito" }]);
    expect(a.w).toBe(-1); expect(asked).toEqual(["slow", "slow bold"]);
    release(); await new Promise(r => setTimeout(r, 200));
    expect(late).toBe(1);                                                              // both faces came: one redraw
    const [b] = await m.measureRuns([{ text: "slow", font: "12px Carlito" }]);
    expect(b.w).toBeGreaterThan(0);
  });
  test("the faces drawn as outlines are part of the stage's keys (outlineSig)", async () => {
    const sh = await shaper();
    const page: TextMeasurer = { maxDigitWidth: () => 0, noteFits: () => true, breakLines: r => r.map(x => [x.text]), measureRuns: runs => runs.map(r => ({ w: sh.width(new FontRegistry().add(font("Carlito-Regular.ttf"))[0], r.text, parseFloat(/([\d.]+)px/.exec(r.font)![1])) * 1.02, asc: 0, desc: 0 })) };
    const m = new FontMeasurer(shaper(), { catalog: async () => CAT, bytes: async f => FILES[f.file] ?? null }, page);
    expect(m.outlineSig()).toBe("");
    await m.prepare(["400 11px Carlito"]);
    expect(await m.check(["400 11px Carlito"])).toBe(true);
    expect(m.outlineSig()).not.toBe("");
  });
  test("a Windows font's face is DirectWrite's nearest weight: ties heavier from 400 up, lighter below; library faces by CSS", async () => {
    const { pickFace } = await import("../src/text/resolve");
    const sysf = [300, 350, 400, 600, 700, 900].map(w => ({ weight: w, italic: false, source: "system" }));
    expect([325, 375, 500, 640, 650, 720, 800].map(w => pickFace(sysf, w, false)!.weight)).toEqual([300, 350, 600, 600, 700, 700, 900]);
    const lib = sysf.map(f => ({ ...f, source: "library" }));
    expect(pickFace(lib, 500, false)!.weight).toBe(400);                               // CSS: 500 looks lighter first
  });
});
