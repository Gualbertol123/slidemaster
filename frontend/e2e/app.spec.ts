/* End-to-end: the built app (backend/slide_builder.html) served by two real helpers that share one
   folder – user "anna" on :8951 and user "bob" on :8952. Run: npm run build && npm run test:e2e */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ANNA = "http://127.0.0.1:8951/", BOB = "http://127.0.0.1:8952/";
const root = () => process.env.SB_E2E_ROOT!, data = () => process.env.SB_E2E_DATA!;
const docFile = () => { const d = path.join(data(), "workbooks"); const f = fs.readdirSync(d).find(n => n.startsWith("report.xlsx")); return f ? path.join(d, f) : null; };
const doc = () => JSON.parse(fs.readFileSync(docFile()!, "utf8"));
const errors: string[] = [];

async function openApp(page: Page, url: string) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#srv")).toContainText(/Export|Testing/);
}
async function openWorkbook(page: Page, name: string) {
  await page.click("#openBtn");
  await page.click(`[data-f="${name}"]`);
}
async function selectCell(page: Page, text: string) {
  await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().waitFor();
  const box = (await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
}
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 10_000 });

test.describe.serial("two people, one shared folder", () => {
  test("anna creates the deck with the wizard", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx");
    await expect(page.locator(".wiz")).toBeVisible();
    await page.click('[data-a="next"]');                         // sheets → tables
    await expect(page.locator(".wtab")).toHaveCount(2);
    await page.click('[data-a="next"]');                         // tables → slides
    await page.check("#cvOn");                                   // add a cover…
    await page.fill("#cvTitle", "IBD Weekly");
    await page.check("#ixOn");                                   // …and an index
    await page.click('[data-a="finish"]');
    await expect(page.locator(".thumb")).toHaveCount(3);
    await saved(page);
    const d = doc();
    expect(d.preset.slides.map((s: { type: string }) => s.type)).toEqual(["cover", "index", "content"]);
    expect(d.preset.slides[0].title).toBe("IBD Weekly");
    expect(d.updatedBy).toBe("anna");
  });

  test("edits by anna and bob on the same workbook are merged, and each sees the other", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    // anna re-opens automatically (last file); bob opens it and continues with the preset
    await expect(a.locator(".thumb")).toHaveCount(3);
    await openWorkbook(b, "report.xlsx");
    await b.click('[data-a="continue"]');
    await expect(b.locator(".thumb")).toHaveCount(3);
    await a.locator('.thumb[data-i="2"]').click(); await b.locator('.thumb[data-i="2"]').click();
    // presence
    await expect(a.locator("#presence")).toContainText("bob", { timeout: 15_000 });
    await expect(b.locator("#presence")).toContainText("anna", { timeout: 15_000 });

    // at the same time: anna renames a bank, bob makes another cell bold
    await selectCell(a, "Alpha"); await a.keyboard.type("Alfa"); await a.keyboard.press("Enter");
    await selectCell(b, "Gamma"); await b.keyboard.press("Control+b");
    await saved(a); await saved(b);
    const d = doc();
    expect(d.edits.SLIDE_1.C6).toEqual({ orig: "Alpha", text: "Alfa" });
    expect(d.edits.SLIDE_1.C8).toEqual({ b: true });
    // each sees the other's change after the next poll (≤ 3 s)
    await expect(b.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1, { timeout: 10_000 });
    await expect(b.locator("#sbRemote")).toContainText("anna");
    await a.waitForTimeout(3500);
    await selectCell(a, "Gamma");
    await expect(a.locator("#boldBtn")).toHaveClass(/on/);

    // anna undoes HER rename: bob's bold stays
    await a.keyboard.press("Escape");
    await a.keyboard.press("Control+z");
    await saved(a);
    const d2 = doc();
    expect(d2.edits.SLIDE_1.C6).toBeUndefined();
    expect(d2.edits.SLIDE_1.C8).toEqual({ b: true });

    // deck style is shared: bob switches the design, anna follows
    await b.click('[data-design="excel"]');
    await saved(b);
    await expect(a.locator("#stage .slide.excel")).toHaveCount(1, { timeout: 10_000 });
    await b.click('[data-design="glass"]'); await saved(b);
    await a.close(); await b.close();
  });

  test("export writes a PDF into the shared export folder", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(3);
    await expect(page.locator("#srv")).toContainText("Export: Chrome", { timeout: 30_000 });
    await page.click("#exportBtn");
    await expect(page.locator("#toast")).toContainText("report - slides.pdf", { timeout: 60_000 });
    const pdf = fs.readFileSync(path.join(root(), "export", "report - slides.pdf"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(3);
  });

  test("no page errors", async () => { expect(errors).toEqual([]); });
});
