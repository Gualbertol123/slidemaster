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

  test("header colour, merge/unmerge, format painter, footer", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    await page.locator('.thumb[data-i="2"]').click();
    const drag = async (from: string, to: string) => {
      const cell = (t: string) => page.locator("#stage .slide .t", { hasText: new RegExp("^" + t + "$") }).first();
      const f = (await cell(from).boundingBox())!, l = (await cell(to).boundingBox())!;
      await page.mouse.move(f.x + 6, f.y + f.height / 2); await page.mouse.down();
      await page.mouse.move(l.x + 6, l.y + l.height / 2, { steps: 4 }); await page.mouse.up();
    };
    // header row: a cell colour that replaces the Excel colour
    await drag("Bank", "Note");
    await page.click("#fillBtn"); await page.click('[data-bg="#FF3B30"]'); await saved(page);
    let e = doc().edits.SLIDE_1;
    for (const r of ["C4", "D4", "J4"]) expect(e[r].bg).toBe("#FF3B30");
    // merge two header cells, split the workbook's merged "Domestic" row
    await page.keyboard.press("Escape"); await drag("Loans", "Deposits");
    await page.click("#mergeBtn"); await saved(page);
    await selectCell(page, "Domestic"); await page.click("#unmergeBtn"); await saved(page);
    expect(doc().preset.tables.find((t: any) => t.sheet === "SLIDE_1").merges).toEqual({ "D4:F4": "merge", "C5:J5": "split" });
    // format painter: copy the header format onto the bank names
    await selectCell(page, "Bank"); await page.click("#painterBtn");
    await expect(page.locator("body")).toHaveClass(/painting/);
    await drag("Alpha", "Gamma"); await saved(page);
    await expect(page.locator("body")).not.toHaveClass(/painting/);
    e = doc().edits.SLIDE_1;
    for (const r of ["C6", "C7", "C8"]) expect(e[r].bg).toBe("#FF3B30");
    // footer on every slide
    await page.click("#optBtn"); await page.check("#ftOn");
    await page.fill("#ftText", "Confidential · {workbook}"); await page.keyboard.press("Enter");
    await page.click('#ftPos [data-pos="bc"]'); await page.keyboard.press("Escape"); await saved(page);
    expect(doc().style.footer).toMatchObject({ on: true, text: "Confidential · {workbook}", pos: "bc" });
    await expect(page.locator("#stage .slide .footer")).toContainText("Confidential · report");
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "header.png") });
  });

  test("painter copies conditional formats; gridlines, vertical align, border drag, text box bubble, contents subtitles, themes", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    await page.locator('.thumb[data-i="2"]').click();
    const cell = (t: string) => page.locator("#stage .slide .t", { hasText: new RegExp("^" + t + "$") }).first();
    const drag = async (from: string, to: string) => {
      const f = (await cell(from).boundingBox())!, l = (await cell(to).boundingBox())!;
      await page.mouse.move(f.x + 6, f.y + f.height / 2); await page.mouse.down();
      await page.mouse.move(l.x + 6, l.y + l.height / 2, { steps: 4 }); await page.mouse.up();
    };
    const tdef = () => doc().preset.tables.find((t: any) => t.sheet === "SLIDE_1");
    const sdef = (i: number) => doc().preset.slides[i];

    // format painter: the conditional format of Δ w/w (green when > 0) travels to the dates
    const caps = await page.locator("#stage .slide > .tw").first().locator(".cap").count();
    await selectCell(page, "\\+2,5"); await page.click("#painterBtn");
    await drag("01/01/2024", "03/03/2024"); await saved(page);
    const e = doc().edits.SLIDE_1;
    for (const r of ["I6", "I7", "I8"]) expect(e[r].cf).toBe("SLIDE_1!E6");
    await expect.poll(() => page.locator("#stage .slide > .tw").first().locator(".cap").count()).toBeGreaterThanOrEqual(caps + 3);

    // gridlines: no horizontal lines, vertical lines everywhere
    await selectCell(page, "Zeta");
    await page.click("#gridBtn"); await page.click('[data-grid="gridH"] [data-v="off"]'); await saved(page);
    await page.click("#gridBtn"); await page.click('[data-grid="gridV"] [data-v="on"]'); await saved(page);
    expect(tdef()).toMatchObject({ gridH: "off", gridV: "on" });

    // tables at the top of the slide
    await page.click('[data-tvalign="top"]'); await saved(page);
    expect(sdef(2).valign).toBe("top");

    // drag the right border of the table: every column gets narrower
    const edge = (await page.locator('.hbox[data-i="0"] .edge.r').boundingBox())!;
    await page.mouse.move(edge.x + 4, edge.y + edge.height / 4); await page.mouse.down();       // (the + button sits in the middle)
    await page.mouse.move(edge.x - 150, edge.y + edge.height / 4, { steps: 5 }); await page.mouse.up();
    await expect.poll(() => Object.keys(tdef().cols || {}).length, { timeout: 10_000 }).toBe(7);      // C…J without the hidden column

    // text box below the table, in a bubble, centred both ways
    await selectCell(page, "Zeta"); await page.click('[data-addnote="bottom"]');
    await page.locator("textarea.note-edit").fill("Source: ECB"); await page.keyboard.press("Control+Enter"); await saved(page);
    await page.locator("#stage .tnote", { hasText: "Source: ECB" }).click();
    await page.click("#noteBubble"); await saved(page);
    await page.click('[data-nvalign="middle"]'); await saved(page);
    await page.click('[data-nalign="center"]'); await saved(page);
    expect(Object.values(sdef(2).notes)).toContainEqual(expect.objectContaining({ text: "Source: ECB", bubble: true, valign: "middle", align: "center" }));
    await expect(page.locator("#stage .notebub")).toHaveCount(1);
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "round4-slide.png") });

    // contents page without subtitles
    await page.locator('.thumb[data-i="1"]').click();
    await expect(page.locator("#stage .ix-s")).not.toHaveCount(0);
    await page.click("#ixSubs"); await saved(page);
    expect(sdef(1).subs).toBe(false);
    await expect(page.locator("#stage .ix-s")).toHaveCount(0);

    // colour themes: Intesa Sanpaolo, then a custom one
    await page.click("#optBtn"); await page.click('[data-theme="intesa"]'); await saved(page);
    expect(doc().style.theme.id).toBe("intesa");
    await expect.poll(() => page.locator("#stage .slide").evaluate(el => (el as HTMLElement).style.getPropertyValue("--a1"))).toBe("#00953B");
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "round4-intesa.png") });
    await page.click('[data-theme="custom"]'); await saved(page);
    await page.locator('[data-tk="c1"]').fill("#123456");
    await expect.poll(() => doc().style.theme, { timeout: 10_000 }).toMatchObject({ id: "custom", c1: "#123456", a1: "#00953B" });
    await page.click('[data-theme="aurora"]'); await page.keyboard.press("Escape"); await saved(page);
  });

  test("typing is never overwritten by autosave or other people's changes; logo bubble can be removed", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4); await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="2"]').click(); await b.locator('.thumb[data-i="2"]').click();
    // anna starts typing a footer, bob changes the deck meanwhile (a poll and re-render arrive at anna)
    await a.click("#optBtn"); await a.locator("#ftText").click(); await a.keyboard.press("Control+a"); await a.keyboard.type("Draft for");
    await selectCell(b, "Kappa"); await b.keyboard.press("Control+b"); await saved(b);
    await a.waitForTimeout(4500);
    await expect(a.locator("#ftText")).toHaveValue("Draft for");
    await a.keyboard.type(" review"); await a.keyboard.press("Enter"); await saved(a);
    expect(doc().style.footer.text).toBe("Draft for review");
    // the logo bubble switch is in the Logo section
    await a.click("#logoBubble"); await saved(a);
    expect(doc().style.logoBubble).toBe(false);
    await a.click("#logoBubble"); await a.keyboard.press("Escape"); await saved(a);
    // anna edits a cell while bob's change arrives: the editor and her text survive
    await selectCell(a, "Lambda"); await a.keyboard.type("Lamb");
    await selectCell(b, "Kappa"); await b.keyboard.press("Control+i"); await saved(b);
    await a.waitForTimeout(4500);
    await expect(a.locator("input.inline-edit")).toHaveValue("Lamb");
    await a.keyboard.type("da 2"); await a.keyboard.press("Enter"); await saved(a);
    expect(doc().edits.SLIDE_1.C16).toMatchObject({ orig: "Lambda", text: "Lambda 2" });
    await a.close(); await b.close();
  });

  test("no page errors", async () => { expect(errors).toEqual([]); });
});
