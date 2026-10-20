/* Opening workbooks (05 §4.1 WB-04, WB-15, WB-25; PLAN Part E "new open/drop/reload e2e"): a dropped file opens,
   two drops at once open one workbook (the newer open wins quietly – review-pre-M3 finding 5), "Reload from disk"
   reopens without asking, and a workbook saved again in Excel shows the "Reload now" banner. Runs after app.spec.ts
   on the same two helpers and folder. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { makeZip } from "../../core/tests/zipbuild";

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
  else { await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]'); }
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
  // open, not "Opening report.xlsx…" (on GitHub's slower runners the test went on while it was, and counted the
  // thumbnails of the workbook start-up had reopened: 1 of Banks.xlsx instead of report.xlsx's 4)
  await expect(page.locator("#fileName")).toHaveText(/^report\.xlsx · \d+ slides?/, { timeout: 30_000 });
  await saved(page);
  const thumbs = +/· (\d+) slides?/.exec((await page.locator("#fileName").textContent())!)![1];
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

/** a large workbook (16 MB of sheet XML, over BIG_BYTES = 12 MiB: its sheets are read only when selected): SLIDE_1 with one "x" table, Sales
    with two, Filler with numbers only */
function largeWorkbook(): ArrayBuffer {
  const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", names = ["SLIDE_1", "Sales", "Filler"];
  const x = (ref: string) => `<c r="${ref}" t="s"><v>0</v></c>`, n = (ref: string, v: number) => `<c r="${ref}"><v>${v}</v></c>`;
  /** an "x" table: markers at its top-left and bottom-right corners, a 2 × 3 block of numbers between them */
  const table = (r: number) => [`<row r="${r}">${x("A" + r)}</row>`, ...[1, 2].map(k => `<row r="${r + k}">${n("B" + (r + k), k)}${n("C" + (r + k), k * 10)}${n("D" + (r + k), k * 100)}</row>`), `<row r="${r + 3}">${x("E" + (r + 3))}</row>`].join("");
  const sheet = (rows: string) => `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
  const filler: string[] = []; for (let r = 1; r <= 150_000; r++) filler.push(`<row r="${r}">${n("A" + r, r)}${n("B" + r, r * 7 % 1000)}${n("C" + r, r % 97)}</row>`);
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId9" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>x</t></si></sst>`,
    "xl/worksheets/sheet1.xml": sheet(table(2)),
    "xl/worksheets/sheet2.xml": sheet(table(2) + table(10)),
    "xl/worksheets/sheet3.xml": sheet(filler.join("")),
  });
}

test("a large workbook: Scan reads the selected sheets and shows their “x” tables before Next (B43)", async ({ page }) => {
  const file = path.join(root(), "large-scan.xlsx");
  fs.writeFileSync(file, Buffer.from(largeWorkbook()));
  try {
    const errors: string[] = [];
    await openApp(page, errors);
    await page.click("#openBtn"); await page.click('[data-f="large-scan.xlsx"]');
    await expect(page.locator(".wiz")).toBeVisible({ timeout: 30_000 });
    const row = (s: string) => page.locator(".wiz .sheetrow", { has: page.locator(`input[value="${s}"]`) });
    // nothing is read yet: SLIDE_1 is pre-selected; Sales is selected by hand, Filler is not
    for (const s of ["SLIDE_1", "Sales", "Filler"]) await expect(row(s)).toContainText("not read yet");
    await row("Sales").locator("input").check();
    const scan = page.locator('[data-a="scan"]');
    await expect(scan).toHaveText("Scan for “x” tables (2)");
    await scan.click();
    await expect(row("SLIDE_1")).toContainText("1 × table", { timeout: 30_000 });
    await expect(row("Sales")).toContainText("2 × table");
    await expect(row("Sales")).toContainText("2 table(s) defined");               // defined now, as Next would
    await expect(row("Filler")).toContainText("not read yet");                    // not selected: still not read
    await expect(scan).toBeDisabled(); await expect(scan).toHaveText("Scan for “x” tables");
    // Next: the tables step has a tab per selected sheet; Sales has its two "x" tables
    await page.click('[data-a="next"]');
    await expect(page.locator(".wtab")).toHaveCount(2);
    await page.locator(".wtab", { hasText: "Sales" }).click();
    await expect(page.locator(".wiz #wMarkers")).toHaveText("Use “x” tables (2)");
    await page.locator('[data-x="close"]').click(); await page.locator(".modal button", { hasText: "Close without saving" }).click();
    await expect(page.locator(".wiz")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { fs.rmSync(file, { force: true }); }
});

test("a saved setup is deleted from the preset question, kept as a backup and restored in Saved setups (B44)", async ({ page }) => {
  const file = path.join(root(), "setup-del.xlsx");
  fs.copyFileSync(path.join(root(), "report.xlsx"), file);
  try {
    const errors: string[] = [];
    await openApp(page, errors);
    const open = async () => { await page.click("#openBtn"); await page.click('[data-f="setup-del.xlsx"]'); };
    // a setup: the wizard's defaults saved
    await open(); await finishOpening(page);
    await expect(page.locator("#fileName")).toHaveText(/^setup-del\.xlsx · \d+ slides?/, { timeout: 30_000 }); await saved(page);
    // opened again – from another workbook's window, so the deck is not open here – the question offers Delete setup…
    await page.click("#openBtn"); await page.click('[data-f="report.xlsx"]'); await finishOpening(page);
    await expect(page.locator("#fileName")).toHaveText(/^report\.xlsx · /, { timeout: 30_000 });
    await open();
    await page.locator('.modal [data-a="delete"]').click();
    await expect(page.locator(".modal")).toContainText("for everybody");
    await page.locator('.modal [data-a="ok"]').click();
    // deleted: the wizard of a new file
    await expect(page.locator(".wiz")).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-x="close"]').click(); await page.locator(".modal button", { hasText: "Close without saving" }).click();
    await expect(page.locator(".wiz")).toHaveCount(0);
    // Saved setups: the backup is listed and restored
    await page.click("#optBtn"); await page.click("#savedSetups");
    const row = page.locator("#deletedSetups tr", { hasText: "setup-del.xlsx" });
    await expect(row).toHaveCount(1);
    await expect(page.locator("#setupsDialog table.setups").first()).not.toContainText("setup-del.xlsx");   // (the wizard was closed: no new setup)
    await expect(page.locator('#setupsDialog tr', { hasText: "report.xlsx" })).toContainText("open here");
    await row.locator('[data-a="restore"]').click(); await page.locator('.modal [data-a="ok"]').last().click();
    await expect(page.locator("#deletedSetups tr", { hasText: "setup-del.xlsx" })).toHaveCount(0);
    await page.locator('#setupsDialog [data-a="close"]').click();
    // opened again: its setup is back
    await open();
    await expect(page.locator('.modal [data-a="continue"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('.modal [data-a="cancel"]').click();
    expect(errors).toEqual([]);
  } finally { fs.rmSync(file, { force: true }); }
});
