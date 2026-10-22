// Takes the guide's screenshots of the 4.3–4.6 functions (docs/next/PROMPTS.md Prompt 16: real screenshots of the program,
// with Playwright, at 1500 × 900, on the corpus workbooks) and writes them to docs/guide/img/ as JPEG.
//   node docs/guide/shots.mjs [name …]     (from the repository root; the page is the committed helper/slide_builder.html)
// It starts its own helper on port 8971 on a temp copy of tests/corpus/workbooks/weekly.xlsx and recalc/Banks.xlsx +
// Peers.xlsx (never the e2e ports 8951/8952), as user "anna", and stops it at the end. The pictures are taken at device
// scale 4/3, so their pixels are the 2000 × 1200 coordinates guide.html's data-crop / data-at callouts use; the crop of
// each picture is printed, to copy into data-crop. The older pictures of img/ (4.0–4.2) were taken the same way and are kept.
// Every crop and every pointer position comes from an element's box (box() / around()), never from fixed pixels, so a
// ribbon or stage that moves in a later version still gives the right pictures; check the printed crops against guide.html.
// Each picture is then stored at about 190 dpi of its printed width in guide.html (PRINT_MM), JPEG quality 74.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { sysFontDirs } from "../../tools/sysfonts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "../..");
const IMG = path.join(here, "img"), PORT = 8971;
const only = process.argv.slice(2);                       // names of pictures to write (default: all)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-guide-"));
const root = path.join(tmp, "root"), data = path.join(tmp, "data");
fs.mkdirSync(root); fs.mkdirSync(data);
for (const f of ["weekly.xlsx", "recalc/Banks.xlsx", "recalc/Peers.xlsx"]) fs.copyFileSync(path.join(repo, "tests/corpus/workbooks", f), path.join(root, path.basename(f)));

const SYSFONTS = sysFontDirs();
const log = fs.openSync(path.join(tmp, "helper.log"), "w");
const helper = spawn(process.platform === "win32" ? "python" : "python3", [path.join(repo, "helper/slide_builder.py"), "--no-browser", "--port", String(PORT)], {
  env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "anna", SLIDEBUILDER_HOST: "pc-anna",
    NO_PROXY: "*", SLIDEBUILDER_NO_NET: "1", SLIDEBUILDER_TEST_BUMP_WAIT_S: "2", ...(SYSFONTS ? { SLIDEBUILDER_SYSFONTS: SYSFONTS } : {}) },
  stdio: ["ignore", log, log] });
const K = 4 / 3;                                          // CSS px → the 2000 × 1200 picture coordinates
/** the printed width in guide.html (mm) of each picture this script takes: the JPEG is stored at about 190 dpi of it */
const PRINT_MM = { window: 140, "layout-ribbon": 180, "borders-menu": 74, "grid-menu": 60, "add-table": 62, "shape-menu": 120, "slide-menu": 50,
  "hidden-thumb": 36, "export-menu": 38, "d-navy": 58, "d-red": 58, looks: 110, chart: 120, "shape-ribbon": 180, "d-glass-items": 92,
  scenario: 78, "scenario-banner": 78 };
const DPI = 190;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let URL = "";
for (let i = 0; ; i++) {                                  // wait for the helper (it takes the next port when 8971 is busy)
  URL = (/Open\s*:\s*(http:\/\/127\.0\.0\.1:\d+\/)/.exec(fs.readFileSync(path.join(tmp, "helper.log"), "utf8")) || [])[1] || "";
  try { if (URL && (await fetch(URL + "api/ping", { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* not yet */ }
  if (i > 100) { helper.kill(); throw new Error("the helper did not start:\n" + fs.readFileSync(path.join(tmp, "helper.log"), "utf8")); }
  await sleep(200);
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: K });
page.on("pageerror", e => console.log("page error:", e.message));
page.setDefaultTimeout(10_000);
const scaler = await browser.newPage();                    // a blank page whose canvas scales the pictures down
const boxes = {};
/** a screenshot of the window, cropped to [x0 y0 x1 y1] in picture coordinates (as data-crop) */
async function shot(name, crop = [0, 0, 2000, 1200]) {
  if (only.length && !only.includes(name)) return;
  const [x0, y0, x1, y1] = crop;
  const png = await page.screenshot({ type: "png", clip: { x: x0 / K, y: y0 / K, width: (x1 - x0) / K, height: (y1 - y0) / K } });
  await save(name, png);
  console.log("img/" + name + ".jpg", crop.join(" "));
}
/** stores a picture as JPEG (quality 74) at about DPI of its printed width PRINT_MM[name] – never larger than taken */
async function save(name, png) {
  const mm = PRINT_MM[name];
  if (!mm) throw new Error("no printed width for " + name + " in PRINT_MM");
  const jpg = await scaler.evaluate(async ([b64, w]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const sw = Math.min(img.naturalWidth, w), sh = Math.round(img.naturalHeight * sw / img.naturalWidth);
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, sw, sh);
    return c.toDataURL("image/jpeg", .74).split(",")[1];
  }, [png.toString("base64"), Math.round(mm / 25.4 * DPI)]);
  fs.writeFileSync(path.join(IMG, name + ".jpg"), Buffer.from(jpg, "base64"));
}
/** an element's box in picture coordinates (to place the callouts) */
async function box(label, sel) {
  const b = await page.locator(sel).first().boundingBox().catch(() => null);
  if (b) boxes[label] = [b.x, b.y, b.x + b.width, b.y + b.height].map(v => Math.round(v * K));
  return boxes[label];
}
/** the box around several elements, padded, in picture coordinates */
async function around(sels, pad = 12) {
  let r = [1e9, 1e9, -1e9, -1e9];
  for (const s of sels) {
    const b = await page.locator(s).first().boundingBox(); if (!b) continue;
    r = [Math.min(r[0], b.x), Math.min(r[1], b.y), Math.max(r[2], b.x + b.width), Math.max(r[3], b.y + b.height)];
  }
  return [Math.max(0, r[0] * K - pad), Math.max(0, r[1] * K - pad), Math.min(2000, r[2] * K + pad), Math.min(1200, r[3] * K + pad)].map(Math.round);
}
const fileName = name => page.locator("#fileName").filter({ hasText: new RegExp("^" + name.replace(/[.]/g, "\\.") + " · \\d+ slides?") });
async function settle(ms = 1200) { const v = page.viewportSize(); await page.mouse.move(v.width - 10, v.height - 10); await sleep(ms); }  // pointer off the window's parts
async function escape() { await page.keyboard.press("Escape"); await sleep(250); }
/** a click on a cell of the slide by its text (the stage's hit layer lies over the cells) */
async function clickCell(text) {
  const l = page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first();
  await l.waitFor(); const b = await l.boundingBox();
  await page.mouse.click(b.x + 8, b.y + b.height / 2);
}
/** one group of pictures: a failure is reported and the next group runs */
async function step(name, f) {
  try { await f(); } catch (e) { console.log("FAILED", name + ":", String(e.message || e).split("\n")[0]); await escape().catch(() => {}); await escape().catch(() => {}); }
}
/** the wizard's defaults for a new deck: Next, Next, (cover and index), Save preset & show slides */
async function wizard(cover) {
  await page.locator('[data-a="next"]').first().click();                       // 1 · Sheets → 2 · Tables
  await page.locator('[data-a="next"]:has-text("Slides")').click();             // 2 · Tables → 3 · Slides
  if (cover) { await page.check("#cvOn"); await page.check("#ixOn"); }
  await page.click('[data-a="finish"]');
}

try {
  await page.goto(URL);
  await page.locator("#openBtn").waitFor();
  await sleep(1500);

  // ---- weekly.xlsx: a new deck through the wizard (its two "x" tables on one slide, a cover and an index) ----
  await page.click("#openBtn"); await page.click('[data-f="weekly.xlsx"]');
  await wizard(true);
  await fileName("weekly.xlsx").waitFor({ timeout: 30_000 });
  await page.locator('.thumb[data-i="2"]').click();
  await settle(2500);
  await shot("window");
  for (const [k, s] of Object.entries({ open: "#openBtn", reload: "#reloadBtn", wizard: "#wizardBtn", file: "#fileName", glass: '[data-design="glass"]',
    red: '[data-design="bain"]', theme: "#themeBtn", subtle: 'button:has-text("Subtle")', colour: 'text=Colour', opt: "#optBtn", exp: "#exportBtn",
    undo: "#undoBtn", textstyles: "#textStylesBtn", cellsrow: "#roleBtn", addtable: 'button:has-text("Add table")', fx: ".fx, .formula, input[placeholder*='Click a cell']",
    thumbs: "#thumbs", newslide: 'button:has-text("+ New slide")', issues: "#issues", calc: "#calcLine", stage: "#stage .slide", zoom: 'button:has-text("Fit")',
    saved: 'text=Saved' })) await box(k, s);
  console.log("window boxes", JSON.stringify(boxes));

  // ribbon 2 (the layout toolbar) with a cell selected
  await step("layout-ribbon", async () => {
    await clickCell("VUB"); await settle(600);
    for (const [k, s] of Object.entries({ W: 'text=W >> nth=0', excelsize: 'button:has-text("Excel size")', role: "#roleBtn", merge: "#mergeBtn", borders: "#bordersBtn",
      scale: "#scaleBtn", same: 'button:has-text("Same size")', pos: "#posBtn", grid: "#gridBtn", sizes: 'button:has-text("Sizes")', free: "#freeLayout",
      reset: 'button:has-text("Reset layout")', addtable: 'button:has-text("Add table")', chart: "#chartBtn", shape: "#shapeBtn", tb: 'text=Text box',
      comment: "#commentBtn", attach: 'button:has-text("Attach")', notes: 'button:has-text("Notes")', logo: 'button:has-text("Logo")' })) await box("r2-" + k, s);
    await shot("layout-ribbon", await around([".ribbon2"], 0));
  });

  // Borders ▾, Gridlines ▾, Add table ▾ (a cell selected first)
  const menu = (name, btn, list) => step(name, async () => {
    await clickCell("VUB"); await sleep(300);
    await page.click(btn); await sleep(500);
    await shot(name, await around([btn, list]));
    await escape();
  });
  await menu("borders-menu", "#bordersBtn", "#borderMenu");
  await menu("grid-menu", "#gridBtn", ".menu:visible");
  await menu("add-table", 'button:has-text("Add table")', "#addTableMenu");
  // Shapes & icons… (4.12): one window – the icons, the shapes and a text box at its side; taken once its grid is drawn
  await step("shape-menu", async () => {
    await clickCell("VUB"); await sleep(300);
    await page.click("#shapeBtn");
    await page.waitForFunction(() => /^[1-9]\d{3}$/.test(document.querySelector("#iconGrid")?.dataset.n || ""), null, { timeout: 30_000 });
    await sleep(1200);                                                            // its rows past the first drawn too
    await page.mouse.move(2, 2);                                                  // no tile under the pointer
    await shot("shape-menu", await around([".icdlg"], 0));
    await escape();
  });

  // the slide list's right-click menu, then slide 2 (the index) hidden in Liquid Glass
  await step("slide-menu", async () => {
    await page.locator('.thumb[data-i="1"]').click({ button: "right" }); await sleep(400);
    await shot("slide-menu", await around(['.thumb[data-i="1"]', "#slideMenu"], 16));
    await page.click("#ctxHideSlide"); await sleep(1500);
    await page.locator('.thumb[data-i="2"]').click(); await settle(1500);
    await page.locator("#thumbs").evaluate(e => { e.scrollTop = 0; }); await sleep(300);
    await page.locator('.thumb[data-i="1"]').scrollIntoViewIfNeeded(); await sleep(300);
    await shot("hidden-thumb", await around(["#thumbs"], 0));
  });

  // Export ▾
  await step("export-menu", async () => {
    await page.setViewportSize({ width: 1500, height: 1500 }); await sleep(800);
    await page.click("#exportMenuBtn"); await sleep(600);
    if (!only.length || only.includes("export-menu")) await save("export-menu", await page.locator(".menu:visible").first().screenshot({ type: "png" }));
    if (!only.length || only.includes("export-menu")) console.log("img/export-menu.jpg (the menu alone)");
    await escape();
    await page.setViewportSize({ width: 1500, height: 900 }); await sleep(800);
  });

  // the consulting designs (before the chart: the tables alone)
  await step("consulting", async () => {
    await page.click('[data-design="mckinsey"]'); await settle(2500);
    await box("slide", "#stage .slide");
    await shot("d-navy", boxes.slide);
    await clickCell("VUB"); await sleep(600);
    { const st = await page.locator("#stage").boundingBox();                       // an empty spot of the stage, right of the slide: the table selected,
      await page.mouse.click(st.x + st.width - 12, st.y + st.height / 2); }        // no cell (the look of the table, not the headline)
    await sleep(600);
    await shot("looks", await around(["#lookGroup"], 10));
    await page.click('[data-design="bain"]'); await settle(2500);
    await shot("d-red", boxes.slide);
    await page.click('[data-design="glass"]'); await settle(1000);
  });

  // a pie of the first table's first rows (from the selected cells) and a callout, in Liquid Glass
  await step("chart", async () => {
    await clickCell("VUB");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");
    await page.click("#chartBtn"); await page.click('[data-a="chart-sel"]');
    await page.locator("#chartPanel").waitFor();
    await settle(1500);
    await box("chartPanel", "#chartPanel"); await box("item", "#stage svg.layer.item");
    await shot("chart", await around(["#stage .slide", "#chartPanel"], 10));       // the slide and the chart's side panel
    await page.click("#shapeBtn"); await page.click('#iconShapes [data-shape="pill"]');
    await page.locator(".itembox[data-kind=shape]").waitFor();
    await page.locator(".itembox[data-kind=shape]").dblclick();
    await page.locator("#itemEdit").fill("Total loans: {LOANS_DEPOSITS!F8}");      // a quoted cell (Quote a cell…), no claim of our own
    await page.keyboard.press("Control+Enter");
    await page.locator(".itembox[data-kind=shape]").click(); await sleep(800);
    await shot("shape-ribbon", await around([".ribbon2"], 0));
    { const b = await page.locator(".itembox[data-kind=shape]").boundingBox();       // the callout to the free space below the pie
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
      const pie = await page.locator(".itembox[data-kind=chart]").first().boundingBox();  // below the pie, centred on it
      await page.mouse.move(pie.x + pie.width / 2, pie.y + pie.height + b.height / 2 + 12, { steps: 12 }); await page.mouse.up(); await sleep(800); }
    await escape(); await escape(); await settle(1500);
    await box("slide", "#stage .slide");
    await shot("d-glass-items", boxes.slide);
  });

  // ---- Banks.xlsx (with the linked Peers.xlsx): Run for each value…, then a preview of Bank C ----
  await step("scenario", async () => {
    await page.click("#openBtn"); await page.click('[data-f="Banks.xlsx"]'); await sleep(2500);
    // no deck yet: the wizard, with the linked Peers.xlsx and its table C4:G8 (as the e2e test "linked workbooks")
    await page.click('[data-a="link"]'); await page.click('.dlg [data-a="Peers.xlsx"]');
    await page.locator('.sheetrow input[value="[Peers.xlsx]Peer"]').check();
    await page.click('[data-a="next"]');
    await page.locator(".wtab", { hasText: "Peers.xlsx" }).click();
    await page.fill("#wRange", "C4:G8"); await page.click("#wAdd");
    await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
    await fileName("Banks.xlsx").waitFor({ timeout: 30_000 });
    await settle(2000);
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.locator("#scenarioDialog").waitFor();
    await page.fill("#scInput", "Control!B2");
    await page.fill("#scValues", "Bank A\nBank B\nBank C");
    await sleep(800);
    await shot("scenario", await around(["#scenarioDialog"], 8));
    await page.selectOption("#scValue", "Bank C");
    await page.click("#scPreview");
    await page.locator("#scBanner").waitFor({ timeout: 20_000 });
    await settle(2500);
    await shot("scenario-banner", await around(["#scBanner"], 10));
  });
  console.log(JSON.stringify(boxes));
} finally {
  await browser.close();
  helper.kill();
  await sleep(500);
  fs.rmSync(tmp, { recursive: true, force: true });
}
