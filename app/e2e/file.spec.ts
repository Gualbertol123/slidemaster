/* The single file still works when opened straight from disk (file://, no helper): PLAN S1.4. A workbook is
   chosen with the file input, the wizard makes the deck, a cell is edited, and the edit is kept in this
   browser (localStorage) across a reload. Since S2.4 the core runs in a worker started from a Blob URL – also
   from file:// – and draws the tables: the page draws none itself. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pdfPageTexts } from "./pdftext";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(here, "../../helper/slide_builder.html")).href;
const REPORT = path.join(here, "../tests/fixtures/report.xlsx");

/* the deck's default logo "logo.png" is not next to the page (the app shows "Logo not found") */
const EXPECTED = [/^console\.error: Failed to load resource: net::ERR_FILE_NOT_FOUND @ .*\/logo\.png/];

async function cell(page: Page, text: string) {
  const t = page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first();
  await t.waitFor();
  const box = (await t.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
}

test("opened from file://: choose a workbook, make the deck, edit a cell, keep it after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push("console." + m.type() + ": " + m.text() + " @ " + (m.location().url || "")); });

  await page.goto(PAGE);
  await expect(page.locator("#bannerOffline")).toBeVisible();
  await page.setInputFiles("#fileInput", REPORT);
  await expect(page.locator(".wiz")).toBeVisible();
  await page.click('[data-a="next"]:has-text("Tables")');                       // sheets → tables
  await page.click('[data-a="next"]:has-text("Slides")');                       // tables → slides
  await page.click('[data-a="finish"]');
  await expect(page.locator(".thumb")).toHaveCount(2);

  await cell(page, "Alpha");
  await page.keyboard.type("Alfa"); await page.keyboard.press("Enter");
  await expect(page.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("sb3:doc:report.xlsx") || "null"));
  await expect.poll(async () => (await stored())?.edits?.SLIDE_1?.C6).toEqual({ orig: "Alpha", text: "Alfa" });
  await expect(page.locator("#sbSave")).toHaveText(/^Saved in this browser only/);
  const core = () => page.evaluate(() => (window as unknown as { __sbTest: { coreStats: { worker: boolean } } }).__sbTest.coreStats);
  expect(await core()).toMatchObject({ worker: true });
  // undo and redo come from the worker too, and the page still draws no table itself
  await page.keyboard.press("Control+z");
  await expect(page.locator("#stage .slide .t", { hasText: /^Alpha$/ })).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1);
  await expect.poll(async () => (await stored())?.edits?.SLIDE_1?.C6).toEqual({ orig: "Alpha", text: "Alfa" });
  expect(await core()).toMatchObject({ worker: true });

  // a reload: the same file again finds the deck this browser kept
  await page.reload();
  await page.setInputFiles("#fileInput", REPORT);
  await page.click('[data-a="continue"]');                     // "Saved preset found"
  await expect(page.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1);

  expect(errors.filter(e => !EXPECTED.some(x => x.test(e)))).toEqual([]);
});

/* B10 (S6.1): an Excel Binary Workbook is read by the page itself – from disk too, where no helper (and so no Excel)
   is there to convert it, as 4.0 needed */
test("opened from file://: an .xlsb opens natively, without Excel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push("console." + m.type() + ": " + m.text() + " @ " + (m.location().url || "")); });
  await page.goto(PAGE);
  await expect(page.locator("#bannerOffline")).toBeVisible();
  await page.setInputFiles("#fileInput", path.join(here, "../../tests/corpus/workbooks/xlsb/report.xlsb"));
  await expect(page.locator(".wiz")).toBeVisible();
  await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
  await expect(page.locator(".thumb")).toHaveCount(2);
  await expect(page.locator("#stage .slide .t", { hasText: /^Alpha$/ })).toHaveCount(1);
  await expect(page.getByText(/converted by Excel/)).toHaveCount(0);
  expect(errors.filter(e => !EXPECTED.some(x => x.test(e)))).toEqual([]);
});

/* B1 (S3.7): from disk, exports work too – as downloads. A text & tables PDF needs the PC's fonts, which the browser
   gives with the user's permission (local fonts); without it the PDF is made of pictures and the toast says why. */
async function deck(page: Page) {
  await page.goto(PAGE);
  await page.setInputFiles("#fileInput", REPORT);
  await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
  await expect(page.locator(".thumb")).toHaveCount(2);
}
async function download(page: Page, click: () => Promise<unknown>) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), click()]);
  const file = await d.path();
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(file) };
}

test("opened from file://: exports are downloads (PDF with the PC's fonts, PNG)", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["local-fonts"], acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push("console." + m.type() + ": " + m.text() + " @ " + (m.location().url || "")); });
  await deck(page);
  await expect(page.locator("#exportBtn")).toBeEnabled();
  const pdf = await download(page, () => page.click("#exportBtn"));
  expect(pdf.name).toBe("report - slides.pdf");
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.bytes.toString("latin1")).toContain("/FontFile2");                       // real text: the PC's fonts embedded
  expect(pdfPageTexts(pdf.bytes).join(" ")).toContain("Alpha");
  await expect(page.locator("#toast")).toContainText("Downloaded report - slides.pdf");
  const png = await download(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="png-current"]'); });
  expect(png.name).toMatch(/^report - .+\.png$/);
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual([4800, 2700]);
  // "Report a problem with this export" (S3.8): without the helper, the report is downloaded
  await page.click("#exportMenuBtn"); await page.click('[data-x="report"]');
  await page.fill("#fbText", "logo missing");
  const rep = await download(page, () => page.click('[data-a="save"]'));
  expect(rep.name).toMatch(/^export-feedback-.+\.json$/);
  expect(JSON.parse(rep.bytes.toString("utf8"))).toMatchObject({ kind: "export-feedback", report: { form: { what: "P2", comment: "logo missing" }, lastExport: { kind: "png-current" }, servedByHelper: false } });
  await expect(page.locator("#toast")).toContainText("send it to the product owner");
  expect(errors.filter(e => !EXPECTED.some(x => x.test(e)))).toEqual([]);
  await context.close();
});

test("opened from file:// without access to the PC's fonts: the PDF is made of pictures, and the toast says so", async ({ browser }) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await deck(page);
  const pdf = await download(page, () => page.click("#exportBtn"));
  expect(pdf.name).toBe("report - slides (images).pdf");
  expect(pdf.bytes.toString("latin1")).toMatch(/\/Width 3200\/Height 1800/);
  await expect(page.locator("#toast")).toContainText("as pictures: this browser gave no access to the PC's fonts");
  await context.close();
});
