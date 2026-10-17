/* Opening workbooks (05 §4.1 WB-04, WB-15, WB-25; PLAN Part E "new open/drop/reload e2e"): a dropped file opens,
   two drops at once open one workbook (the newer open wins quietly – review-pre-M3 finding 5), "Reload from disk"
   reopens without asking, and a workbook saved again in Excel shows the "Reload now" banner. Runs after app.spec.ts
   on the same two helpers and folder. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ANNA = "http://127.0.0.1:8951/";
const root = () => process.env.SB_E2E_ROOT!, data = () => process.env.SB_E2E_DATA!;
/** the workbook anna's start-up reopens by itself (her preferences), if any */
const lastFile = (): string | null => { try { return JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { return null; } };
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 10_000 });

async function openApp(page: Page, errors: string[]) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(ANNA);
  await page.locator("#openBtn").waitFor();                                       // the page has rendered…
  await expect(page.locator("#srv")).toHaveCount(0);                              // …and the helper answered
  // start-up reopens the last workbook (a drop is ignored while a workbook is being opened): wait until it is open
  const last = lastFile();
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  else await expect(page.locator("#fileName")).toHaveText("No workbook");
}
/** the wizard (no saved deck yet) or the saved-deck question, whichever comes: finished or continued */
async function finishOpening(page: Page) {
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]'); await page.click('[data-a="next"]'); await page.click('[data-a="finish"]'); }
}

test("a dropped workbook opens; of two drops at once the newer opens; reload from disk; changed on disk", async ({ page }) => {
  const errors: string[] = [];
  await openApp(page, errors);
  // two different workbooks dropped in the same moment (a double drop, or a drop while Browse… opens another): the
  // newer one (report.xlsx) opens, with its own slides, and nothing of the older one (weekly.xlsx) is left behind
  const files = ["weekly.xlsx", "report.xlsx"].map(n => ({ n, b64: fs.readFileSync(path.join(root(), n)).toString("base64") }));
  await page.evaluate(files => {
    for (const { n, b64 } of files) {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n));
      document.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }, files);
  await finishOpening(page);
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".wiz")).toHaveCount(0);
  await expect(page.locator('[data-a="continue"]')).toHaveCount(0);           // one open: no second question left behind
  await expect(page.locator("#toast.err, #toast .err")).toHaveCount(0);
  await expect(page.locator("#fileName")).toContainText("report.xlsx");
  await saved(page);
  // the deck's slide count from the file line ("report.xlsx · 4 slides"), and every thumbnail of it shown – counting
  // them as soon as the first one shows read 1 of 4 on GitHub's slower runners
  const thumbs = +(/· (\d+) slides?/.exec((await page.locator("#fileName").textContent()) || "") || [])[1];
  expect(thumbs).toBeGreaterThan(0);
  await expect(page.locator(".thumb")).toHaveCount(thumbs, { timeout: 20_000 });

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

test("a workbook picked while start-up still reopens the last one stays open (decided 2026-10-14, audit UX-1)", async ({ page }) => {
  // start-up reopens the last workbook (report.xlsx after the test above); a workbook the user picks before that
  // reopen ran was replaced by it. The start-up's file list is held back 3 s here, so the user's pick comes first.
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  expect(lastFile()).toBe("report.xlsx");
  // start-up's request for the file list (the first one, before any click) is held until the user has picked
  let release!: () => void, seen!: () => void, first = true;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { seen = r; });
  await page.route(/\/api\/files(\?|$)/, async route => {
    if (first) { first = false; seen(); await gate; }
    await route.continue();
  });
  await page.goto(ANNA);
  await started;
  await page.click("#openBtn");
  await page.click('[data-f="weekly.xlsx"]');
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });              // the user's workbook asks its question
  release();                                                                     // now start-up gets its list
  await page.waitForTimeout(5000);
  await expect(wizard.or(cont)).toBeVisible();
  await expect(page.locator("#fileName")).not.toContainText("report.xlsx");
  expect(errors).toEqual([]);
});
