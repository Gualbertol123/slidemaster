/* Baseline of the CURRENT Slide Builder (v3): open, render, edit round trip, export per design.
   node measure.mjs <workbooks dir> [out.json]
   Needs: node_modules (Playwright; `npm ci` at the root), python3, Chromium (CHROME env or /opt/pw-browsers).
   Starts one real helper (backend/slide_builder.py) on a temp ROOT/DATA, like Start Slide Builder.bat. */
import { chromium } from "../../node_modules/playwright/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../..");
const WB = path.resolve(process.argv[2] || "."), OUT = process.argv[3] || path.join(HERE, "baseline.json");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 8971, URL = `http://127.0.0.1:${PORT}/`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-base-")), root = path.join(tmp, "root"), data = path.join(tmp, "data");
fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
for (const f of ["deck20.xlsx", "big30.xlsx"]) if (fs.existsSync(path.join(WB, f))) fs.copyFileSync(path.join(WB, f), path.join(root, f));
const helper = spawn("python3", [path.join(REPO, "backend/slide_builder.py"), "--no-browser", "--port", String(PORT)], {
  env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "bench", SLIDEBUILDER_HOST: "pc-bench", SLIDEBUILDER_BROWSER: CHROME, NO_PROXY: "*" },
  stdio: ["ignore", "pipe", "pipe"] });
process.on("exit", () => helper.kill());
let hlog = ""; helper.stdout.on("data", d => hlog += d); helper.stderr.on("data", d => hlog += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let up = false; for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(URL + "api/ping")).ok; } catch { /* starting */ } if (!up) await sleep(200); }
if (!up) { console.error("helper did not start:\n" + hlog); process.exit(1); }
const res = { machine: `${os.cpus().length} vCPU ${os.cpus()[0].model}, ${process.platform}`, chrome: CHROME, runs: {} };
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("pageerror", e => console.error("pageerror", e.message));
await page.addInitScript(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true }); });
const longTasks = async () => { const l = await page.evaluate(() => { const a = window.__long; window.__long = []; return a; }); return { count: l.length, maxMs: Math.round(Math.max(0, ...l)), totalMs: Math.round(l.reduce((s, x) => s + x, 0)) }; };
const api = (p, body) => page.evaluate(async ([p, body]) => {
  const tok = document.querySelector('meta[name="sb-token"]').content;
  const r = await fetch(p, { method: body ? "POST" : "GET", headers: { "X-SB-Token": tok, "X-SB-Formats": "workbook=3;config=3;prefs=1", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.status === 204 ? null : r.json();
}, [p, body]);
const t = () => performance.now();
async function waitExport(suffix) {          // the file is in export/ and the button is idle again
  for (let i = 0; i < 3000; i++) {
    const ok = fs.existsSync(path.join(root, "export")) && fs.readdirSync(path.join(root, "export")).some(n => n.endsWith(suffix) && !n.endsWith(".tmp"));
    if (ok && !(await page.locator("#exportBtn").innerText()).includes("Rendering")) return;
    if (i % 100 === 99) console.error("waiting", suffix, await page.locator("#toast").innerText().catch(() => ""), hlog.slice(-300));
    await sleep(100);
  }
  throw new Error("export timed out: " + hlog.slice(-2000));
}

await page.goto(URL);
await page.locator("#srv").filter({ hasText: /Export: / }).waitFor({ timeout: 120000 });
await longTasks();

// ---------- 1. open the 20-slide deck: parse + wizard, then build all slides
let t0 = t();
await page.click("#openBtn"); await page.click('[data-f="deck20.xlsx"]');
await page.locator(".wiz").waitFor();
const tWizard = t() - t0;
await page.click('[data-a="next"]'); await page.click('[data-a="next"]');
t0 = t(); await page.click('[data-a="finish"]');
await page.locator(".thumb").nth(19).waitFor({ timeout: 60000 });
await page.locator("#stage .slide .t").first().waitFor();
const tSlides = t() - t0;
res.runs.open_deck20 = { wizard_ms: Math.round(tWizard), finish_to_slides_ms: Math.round(tSlides), longtasks: await longTasks(),
  stageNodes: await page.evaluate(() => document.querySelectorAll("#stage *").length),
  pageHtmlKB: Math.round((await page.evaluate(() => document.documentElement.outerHTML.length)) / 1024) };
await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });

// ---------- 2. edit round trip (local render, then saved on the share)
const cell = page.locator("#stage .slide .t", { hasText: /^VUB$/ }).first();
const box = await cell.boundingBox();
await page.mouse.click(box.x + 8, box.y + box.height / 2);
const edits = [], reqlog = [];
page.on("requestfinished", async r => { const tm = r.timing(); reqlog.push({ url: r.url().replace(URL, "/").slice(0, 60), m: r.method(), start: Math.round(tm.startTime % 100000), wait: Math.round(tm.responseStart - tm.requestStart), total: Math.round(tm.responseEnd) }); });
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("Control+b");
  const a = t(); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
  edits.push(Math.round(t() - a));
  await sleep(400);
}
res.runs.edit_bold_to_saved_ms = edits; res.runs.edit_requests = reqlog.slice(0, 40);
if (process.env.ONLY_EDIT) { console.log(JSON.stringify(res.runs, null, 0)); process.exit(0); }
// render cost of one edit on the stage (bold toggle: refreshStage), measured in the page
res.runs.edit_render = await longTasks();

// ---------- 3. export per design
const pdfInfo = f => JSON.parse(execFileSync("python3", [path.join(HERE, "pdfinfo.py"), f]).toString());
for (const d of ["glass", "excel", "clean"]) {
  await page.click(`[data-design="${d}"]`);
  await page.locator(`[data-design="${d}"].on`).waitFor();
  await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
  await sleep(500); await longTasks();
  for (let rep = 0; rep < 2; rep++) {
    fs.rmSync(path.join(root, "export"), { recursive: true, force: true }); fs.mkdirSync(path.join(root, "export"));
    const a = t(); await page.click("#exportBtn");
    await waitExport(".pdf");
    const ms = Math.round(t() - a);
    const f = path.join(root, "export", fs.readdirSync(path.join(root, "export")).find(n => n.endsWith(".pdf")));
    res.runs[`export_${d}_${rep}`] = { ms, toast: (await page.locator("#toast").innerText()).slice(0, 160), ...pdfInfo(f), longtasks: await longTasks() };
    if (rep === 0) fs.copyFileSync(f, path.join(HERE, `out-current-${d}.pdf`));
  }
}
// pictures mode for Liquid Glass (as the users' "PDF as pictures")
await page.click(`[data-design="glass"]`); await sleep(800);
{
  fs.rmSync(path.join(root, "export"), { recursive: true, force: true }); fs.mkdirSync(path.join(root, "export"));
  await page.click("#exportMenuBtn"); const a = t(); await page.click('[data-x="pdf-exact"]');
  await waitExport("(images).pdf");
  const f = path.join(root, "export", fs.readdirSync(path.join(root, "export")).find(n => n.endsWith(".pdf")));
  res.runs.export_glass_pictures = { ms: Math.round(t() - a), ...pdfInfo(f) };
}

// ---------- 4. open the big workbook (index), then read one 130k-row data sheet
if (fs.existsSync(path.join(root, "big30.xlsx"))) {
  await longTasks();
  t0 = t(); await page.click("#openBtn"); await page.click('[data-f="big30.xlsx"]');
  await page.locator(".wiz").waitFor({ timeout: 120000 });
  const idx = t() - t0, ltIdx = await longTasks();
  // select only DATA_1 and go to the tables step: the sheet is parsed then
  await page.evaluate(() => { for (const b of document.querySelectorAll(".wiz button")) if (b.textContent.trim() === "None") b.click(); });
  await page.locator(".wiz label", { hasText: "DATA_1" }).first().click();
  t0 = t(); await page.click('[data-a="next"]');
  await page.locator(".wtab").first().waitFor({ timeout: 600000 });
  const parse = t() - t0;
  res.runs.open_big30 = { fileMB: +(fs.statSync(path.join(root, "big30.xlsx")).size / 1e6).toFixed(1), index_to_wizard_ms: Math.round(idx), longtasks_index: ltIdx,
    parse_one_sheet_ms: Math.round(parse), longtasks_parse: await longTasks(),
    heapMB: await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null) };
}
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close(); helper.kill();
