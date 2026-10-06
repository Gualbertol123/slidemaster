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
    await expect(page.locator(".wtab")).toHaveCount(3);
    await page.click('[data-a="next"]');                         // tables → slides
    await page.check("#cvOn");                                   // add a cover…
    await page.fill("#cvTitle", "IBD Weekly");
    await page.check("#ixOn");                                   // …and an index
    await page.click('[data-a="finish"]');
    await expect(page.locator(".thumb")).toHaveCount(4);
    await saved(page);
    const d = doc();
    expect(d.preset.slides.map((s: { type: string }) => s.type)).toEqual(["cover", "index", "content", "content"]);
    expect(d.preset.slides[0].title).toBe("IBD Weekly");
    expect(d.updatedBy).toBe("anna");
  });

  test("edits by anna and bob on the same workbook are merged, and each sees the other", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    // anna re-opens automatically (last file); bob opens it and continues with the preset
    await expect(a.locator(".thumb")).toHaveCount(4);
    await openWorkbook(b, "report.xlsx");
    await b.click('[data-a="continue"]');
    await expect(b.locator(".thumb")).toHaveCount(4);
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
    await expect(page.locator(".thumb")).toHaveCount(4);
    await expect(page.locator("#srv")).toContainText("Export: Chrome", { timeout: 30_000 });
    await page.click("#exportBtn");
    await expect(page.locator("#toast")).toContainText("report - slides.pdf", { timeout: 60_000 });
    const pdf = fs.readFileSync(path.join(root(), "export", "report - slides.pdf"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(4);
  });

  test("table tools: same size, alignment, widths, text boxes, colour scale, Shift+arrows", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4); await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="3"]').click(); await b.locator('.thumb[data-i="3"]').click();
    const rects = (p: Page) => p.$$eval("#stage .slide > .tw", els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.left, w: r.width, h: r.height }; }));
    const slideX = async (p: Page) => (await p.locator("#stage .slide").boundingBox())!.x;

    // same size + left alignment (one undo step each)
    await a.click("#sameSize"); await saved(a);
    let r = await rects(a); expect(Math.abs(r[0].w - r[1].w)).toBeLessThan(1.5); expect(Math.abs(r[0].h - r[1].h)).toBeLessThan(1.5);
    await a.click('[data-talign="left"]'); await saved(a);
    const k = (await a.locator("#stage .slide").boundingBox())!.width / 1600;
    r = await rects(a); expect(r[0].x - await slideX(a)).toBeCloseTo(50 * k, 0);

    // Shift+arrows on the slide, then a typed column width for the selected columns
    await selectCell(a, "R1"); await a.keyboard.press("Shift+ArrowDown"); await a.keyboard.press("Shift+ArrowRight");
    await expect(a.locator("#nameBox")).toHaveText("SLIDE_3 pair!C5:D6");
    await a.fill("[title^='Width of the selected']", "150"); await a.keyboard.press("Enter");
    // meanwhile bob adds a text box above the first table on the same slide
    await selectCell(b, "R2"); await b.click('[data-addnote="top"]');
    await b.locator("textarea.note-edit").fill("Loans grew everywhere"); await b.keyboard.press("Control+Enter");
    await saved(a); await saved(b);
    let d = doc(); const pair = d.preset.slides[3], t0 = d.preset.tables.find((t: any) => t.id === pair.tables[0]);
    expect(t0.cols).toMatchObject({ "3": 150, "4": 150 });                       // anna's widths…
    expect(Object.values(pair.notes).map((n: any) => n.text)).toEqual(["Loans grew everywhere"]);   // …and bob's text box
    await expect(a.locator("#stage .tnote", { hasText: "Loans grew everywhere" })).toHaveCount(1, { timeout: 10_000 });

    // colour scale on the second table
    const nums = a.locator("#stage .slide > .tw").nth(1).locator(".t", { hasText: /^-?[\d.]+,\d$/ });
    const f = (await nums.first().boundingBox())!, l = (await nums.last().boundingBox())!;
    await a.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await a.mouse.down(); await a.mouse.move(l.x + l.width / 2, l.y + l.height / 2, { steps: 4 }); await a.mouse.up();
    await a.click("#scaleBtn"); await a.click("#scaleApply"); await saved(a);
    d = doc(); const t1 = d.preset.tables.find((t: any) => t.id === d.preset.slides[3].tables[1]);
    expect(Object.values(t1.scales)).toEqual([{ range: "I5:K13", dir: "col", mode: "zero", fill: true, ink: false }]);
    await expect(a.locator("#stage .slide > .tw").nth(1).locator(".cap.scale")).not.toHaveCount(0);

    // corners and contrast are deck settings
    await a.click("#optBtn"); await a.locator("#radiusRange").fill("0"); await a.locator("#contrastRange").fill("80"); await a.keyboard.press("Escape");
    await expect.poll(() => doc().style, { timeout: 10_000 }).toMatchObject({ radius: 0, contrast: 80 });   // sliders apply after a short pause
    await a.close(); await b.close();
  });

  test("wizard table picker: Shift+arrows select, Enter adds the table", async ({ page }) => {
    await openApp(page, ANNA);
    await page.click("#wizardBtn"); await page.click('[data-a="next"]');
    await page.locator(".wtab", { hasText: "SLIDE_2 panel" }).click();
    await page.locator('.wgrid-in td[data-r="3"][data-c="2"]').click();
    for (const k of ["Shift+ArrowDown", "Shift+ArrowDown", "Shift+ArrowRight", "Shift+ArrowRight"]) await page.keyboard.press(k);
    await expect(page.locator("#wRange")).toHaveValue("B3:D5");
    await page.keyboard.press("Enter");
    await expect(page.locator(".wtrow")).toHaveCount(1);
    await page.locator(".wtrow .rgin").first().waitFor();
    await expect(page.locator(".wtrow .rgin")).toHaveValue("B3:D5");
    await page.click('[data-x="close"]'); await page.click('.modal [data-a="ok"]');
  });

  test("no page errors", async () => { expect(errors).toEqual([]); });
});
