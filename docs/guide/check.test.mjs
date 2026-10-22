// Tests of check.mjs (the guide's page, font and placeholder checks):  node --test docs/guide/check.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkPdf, checkSources, pdfFacts, placeholders, GUIDE_PDF } from "./check.mjs";

/** a stand-in for a Chrome PDF: n page objects and the named embedded fonts */
const fakePdf = (n, fonts, type3 = 0) => Buffer.from(
  Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`).join("") +
  "2 0 obj << /Type /Pages /Count " + n + " >> endobj\n" +
  fonts.map((f, i) => `<< /Type /Font /BaseFont /ABCDE${String.fromCharCode(65 + i)}+${f} >>\n`).join("") +
  "<< /Subtype /Type3 >>\n".repeat(type3), "latin1");

test("pages are counted without the /Pages node", () => {
  assert.equal(pdfFacts(fakePdf(18, ["SegoeUI"])).pages, 18);
});

test("a guide in Segoe UI, Segoe UI Symbol and Consolas of 14–20 pages passes", () => {
  assert.deepEqual(checkPdf(fakePdf(20, ["SegoeUI", "SegoeUI-Bold", "SegoeUI-Semibold", "SegoeUI-Italic", "SegoeUISymbol", "Consolas"])), []);
  assert.deepEqual(checkPdf(fakePdf(14, ["SegoeUI"])), []);
});

test("the G16 build is refused: 28 pages, Linux fonts and Type 3 fallbacks", () => {
  const p = checkPdf(fakePdf(28, ["DejaVuSans", "DejaVuSansMono", "FreeSerif"], 29));
  assert.equal(p.length, 4);
  assert.match(p[0], /^28 pages/);
  assert.match(p[1], /FreeSerif/);
  assert.match(p[2], /Type 3/);
  assert.match(p[3], /Segoe UI is not embedded/);
});

test("one fallback font next to Segoe UI is refused (a symbol in another face)", () => {
  assert.equal(checkPdf(fakePdf(19, ["SegoeUI", "Inter"])).length, 1);
  assert.equal(checkPdf(fakePdf(21, ["SegoeUI"])).length, 1);
});

test("placeholders are counted per kind", () => {
  assert.deepEqual(placeholders("a <!-- 4.9: tables --> b <!-- 4.9: tables --> <!-- template, comments B48–B50 --> <!-- sources: x -->"),
    { "4.9: tables": 2, "template, comments B48–B50": 1 });
});

test("guide.md and guide.html have the same placeholders, and every picture exists", () => {
  assert.deepEqual(checkSources(), []);
});

test("the committed guide PDF is a Segoe UI build of 14–20 pages", () => {
  assert.deepEqual(checkPdf(fs.readFileSync(GUIDE_PDF)), []);
});
