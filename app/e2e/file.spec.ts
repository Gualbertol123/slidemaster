/* The single file still works when opened straight from disk (file://, no helper): PLAN S1.4. A workbook is
   chosen with the file input, the wizard makes the deck, a cell is edited, and the edit is kept in this
   browser (localStorage) across a reload. */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(here, "../../backend/slide_builder.html")).href;
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
  await page.click('[data-a="next"]');                         // sheets → tables
  await page.click('[data-a="next"]');                         // tables → slides
  await page.click('[data-a="finish"]');
  await expect(page.locator(".thumb")).toHaveCount(2);

  await cell(page, "Alpha");
  await page.keyboard.type("Alfa"); await page.keyboard.press("Enter");
  await expect(page.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("sb3:doc:report.xlsx") || "null"));
  await expect.poll(async () => (await stored())?.edits?.SLIDE_1?.C6).toEqual({ orig: "Alpha", text: "Alfa" });

  // a reload: the same file again finds the deck this browser kept
  await page.reload();
  await page.setInputFiles("#fileInput", REPORT);
  await page.click('[data-a="continue"]');                     // "Saved preset found"
  await expect(page.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1);

  expect(errors.filter(e => !EXPECTED.some(x => x.test(e)))).toEqual([]);
});
