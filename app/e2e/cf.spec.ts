/* S16.4 · Excel's conditional formats on the slides (B39; XC-01, XC-02), from the page opened straight from disk
   (file://, as file.spec.ts): the corpus workbook tests/corpus/workbooks/cf/cf-rules.xlsx (tools/make_cf_corpus.py) –
   a table with a colour scale, data bars, an icon set, top / average, text and unique-value rules, and a table of every
   icon set. The wizard makes the deck; the stage draws the bars and icons (display-list rects and paths, no pictures);
   the PDF and the PowerPoint file carry them (PowerPoint: the icons as custom shapes over the table, the bars as shapes
   under it, the table a real a:tbl); a rule naming another sheet is listed in Issues as not reproduced. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { pdfPageTexts } from "./pdftext";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(here, "../../helper/slide_builder.html")).href;
const CF = path.join(here, "../../tests/corpus/workbooks/cf/cf-rules.xlsx");
const EXPECTED = [/^console\.error: Failed to load resource: net::ERR_FILE_NOT_FOUND @ .*\/logo\.png/];

async function deck(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto(PAGE);
  await page.setInputFiles("#fileInput", file);
  await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
  await expect(page.locator(".thumb")).toHaveCount(2);
}
async function download(page: Page, click: () => Promise<unknown>) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), click()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
}
/** the stage's table layer of the current slide, as SVG markup */
const stageSvg = (page: Page) => page.locator("#stage .slide").first().evaluate(el => el.innerHTML);

test("XC-01: colour scales, data bars and icon sets on the stage, in the PDF and in PowerPoint", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["local-fonts"], acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push("console." + m.type() + ": " + m.text() + " @ " + (m.location().url || "")); });
  await deck(page, CF);

  // slide 1: the values drawn (the cells' texts), the formats on them: bars (a gradient), arrows (paths)
  await expect(page.locator("#stage .slide .t", { hasText: /^Late$/ }).first()).toBeVisible();
  await expect.poll(async () => (await stageSvg(page)).includes("linearGradient")).toBe(true);
  expect((await stageSvg(page)).match(/<path /g)?.length ?? 0).toBeGreaterThan(10);
  // the values of "icons only" (slide 2, last row) are not drawn: the row shows its name and three icons
  await page.locator('.thumb[data-i="1"]').click();
  await expect(page.locator("#stage .slide .t", { hasText: /^3Symbols icons only$/ })).toHaveCount(1);
  expect((await stageSvg(page)).match(/<path /g)?.length ?? 0).toBeGreaterThan(80);

  // PDF: both slides, the texts but the hidden values; vector (no pictures of tables)
  const pdf = await download(page, () => page.click("#exportBtn"));
  const pages = pdfPageTexts(pdf.bytes);
  expect(pages).toHaveLength(2);
  expect(pages[0]).toContain("Late");
  expect(pages[1]).toContain("5Quarters");
  // PowerPoint: real tables; icons as custom geometry after (over) the table; bars as shapes before (under) it
  const ppt = await download(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); });
  const z = unzipSync(new Uint8Array(ppt.bytes)), slide = (i: number) => strFromU8(z[`ppt/slides/slide${i}.xml`]);
  for (const i of [1, 2]) {
    const x = slide(i), tbl = x.indexOf("<a:tbl>");
    expect(tbl).toBeGreaterThan(0);
    expect([...x.matchAll(/<a:custGeom>/g)].filter(m => m.index! > tbl).length).toBeGreaterThan(i === 2 ? 40 : 5);
    expect(x).not.toContain("<p:cxnSp");
  }
  expect((slide(1).slice(0, slide(1).indexOf("<a:tbl>")).match(/<p:sp>/g) || []).length).toBeGreaterThanOrEqual(19);
  expect(errors.filter(e => !EXPECTED.some(x => x.test(e)))).toEqual([]);
  await context.close();
});

test("XC-02: rules on the cells' values; a rule naming another sheet is listed in Issues as not reproduced", async ({ page }) => {
  // the corpus workbook with one more rule on C5:C14 that reads another sheet (Excel 2010 writes those in the extension)
  const z = unzipSync(new Uint8Array(fs.readFileSync(CF))), part = "xl/worksheets/sheet1.xml";
  z[part] = strToU8(strFromU8(z[part]).replace('<conditionalFormatting sqref="C5:C14">',
    '<conditionalFormatting sqref="B5:B14"><cfRule type="expression" dxfId="0" priority="99"><formula>B5&gt;\'Icon sets\'!$D$5</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="C5:C14">'));
  await deck(page, { name: "cf-other.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(zipSync(z)) });
  await expect(page.locator("#issues")).toContainText("Conditional formats not reproduced on CF rules: formulas naming another sheet");
  // the rules that are reproduced: top 3 / below average, text rules, unique values with their number format
  await expect(page.locator("#stage .slide .t", { hasText: /^\[n\/a\]$/ })).toHaveCount(1);
  await expect(page.locator("#stage .slide .t", { hasText: /^KO$/ })).toHaveCount(2);
});
