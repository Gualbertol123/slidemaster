/* Opening workbooks (05 §4.1 WB-04, WB-15, WB-25; PLAN Part E "new open/drop/reload e2e"): a dropped file opens,
   two drops at once open one workbook (the newer open wins quietly – review-pre-M3 finding 5), "Reload from disk"
   reopens without asking, and a workbook saved again in Excel shows the "Reload now" banner. Runs after app.spec.ts
   on the same two helpers and folder. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ANNA = "http://127.0.0.1:8951/";
const root = () => process.env.SB_E2E_ROOT!;
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 10_000 });

async function openApp(page: Page, errors: string[]) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(ANNA);
  await expect(page.locator("#srv")).toContainText(/Export|Testing/);
  // start-up reopens the last workbook (a drop is ignored while a workbook is being opened): wait until it is done
  await expect(page.locator("#fileName")).toHaveText(/No workbook|\d+ slides?$/, { timeout: 30_000 });
}
/** the wizard (no saved deck yet) or the saved-deck question, whichever comes: finished or continued */
async function finishOpening(page: Page) {
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]'); await page.click('[data-a="next"]'); await page.click('[data-a="finish"]'); }
}

test("a dropped workbook opens; two drops at once open it once; reload from disk; changed on disk", async ({ page }) => {
  const errors: string[] = [];
  await openApp(page, errors);
  // two drops of report.xlsx in the same moment (as a double drop, or a drop while Browse… opens another)
  const b64 = fs.readFileSync(path.join(root(), "report.xlsx")).toString("base64");
  await page.evaluate(({ b64 }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    for (let i = 0; i < 2; i++) {
      const dt = new DataTransfer(); dt.items.add(new File([bytes], "report.xlsx"));
      document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }, { b64 });
  await finishOpening(page);
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".wiz")).toHaveCount(0);
  await expect(page.locator('[data-a="continue"]')).toHaveCount(0);           // one open: no second question left behind
  await expect(page.locator("#toast.err, #toast .err")).toHaveCount(0);
  await expect(page.locator("#fileName")).toContainText("report.xlsx");
  await saved(page);
  const thumbs = await page.locator(".thumb").count();

  // Reload from disk (↻): the same workbook again, without asking
  await page.click("#reloadBtn");
  await expect(page.locator(".thumb")).toHaveCount(thumbs, { timeout: 20_000 });
  await expect(page.locator(".wiz")).toHaveCount(0);
  await expect(page.locator('[data-a="continue"]')).toHaveCount(0);

  // saved again in Excel (a newer file time): the banner offers to reload (the open file is checked every 6 s)
  const f = path.join(root(), "report.xlsx"), later = new Date(Date.now() + 60_000);
  fs.utimesSync(f, later, later);
  await expect(page.locator("#bannerChanged")).toBeVisible({ timeout: 15_000 });
  await page.locator("#bannerChanged button").click();
  await expect(page.locator("#bannerChanged")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".thumb")).toHaveCount(thumbs);
  expect(errors).toEqual([]);
});
