/* ⏱ Browser benchmarks (PLAN S2.6, Part F; from spikes/baseline/measure.mjs): the built page with a real helper in
   Chromium, each scenario twice; the worse run counts and CI fails above a limit + 10 %. Times are taken in the page:
   from the click (a capture listener) to the moment the element is in the document (a MutationObserver) – Playwright's
   waits poll at up to 500 ms and added that much to some runs.
     open deck20     the wizard, then the 20 slides: index → wizard shown, Finish → first slide drawn   < 400 ms (sum)
     read big30      index → wizard, then one 130 000-row sheet read (Next → the sheet's tab)         < 1 s
     long tasks      on the page's thread while opening and reading (Long Tasks API)                  none > 50 ms
                     except the tasks from Finish until the first slide is drawn (decided 2026-10-11, PROGRESS
                     S2.6 – Chromium's first use of each font instance on Windows; v3 had the same task): those
                     have their own, looser limit (decision 2026-10-12)                                none > 250 ms
                     The start-up tasks are reported, not gated.
     heap            after the big sheet was read: the page (performance.memory) plus the core worker, which
                     holds the workbook since S2.4 (Runtime.getHeapUsage over the DevTools protocol)    < 150 MB
   The two time limits are scaled by how much slower this machine is than the reference PC (tools/calibrate.mjs,
   decision 2026-10-12: GitHub's runners are 1.3–1.6× slower and passed or failed by chance; at most 2×, so a
   slow runner cannot hide a doubling); long tasks and heap are not.

     node tools/bench.mjs [--page DIR] [--json OUT] [--no-gate]
   --page DIR  another build's backend folder (e.g. a v3 worktree's backend/) – to record its numbers
   Needs: npm ci (Playwright), Python (the helper: python3, on Windows python), Chromium (CHROME, or Playwright's), and
   tests/corpus/workbooks/big30.xlsx (python tools/make_corpus.py big30 tests/corpus/workbooks). */
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { speedFactor } from "./calibrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BACKEND = path.resolve(arg("--page", path.join(REPO, "backend")));
const GATE = !process.argv.includes("--no-gate");
const BUDGET = { open_deck20_ms: 400, read_big30_ms: 1000, longest_task_ms: 50, first_draw_task_ms: 250, heap_mb: 150 }, SLACK = 1.1;
const speed = speedFactor(), TIMED = ["open_deck20_ms", "read_big30_ms"];
const LIMITS = Object.fromEntries(Object.entries(BUDGET).map(([k, v]) => [k, TIMED.includes(k) ? Math.round(v * speed.factor) : v]));
const CHROME = process.env.CHROME || chromium.executablePath();
const PY = process.platform === "win32" ? "python" : "python3";
const BOOKS = path.join(REPO, "tests/corpus/workbooks");
for (const f of ["deck20.xlsx", "big30.xlsx"]) if (!fs.existsSync(path.join(BOOKS, f))) { console.error(`${f} is missing (python tools/make_corpus.py big30 tests/corpus/workbooks)`); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** the JS heap of every dedicated worker in the browser (the core worker), MB; null if the protocol refused */
async function workersHeapMB(browser) {
  const s = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = await s.send("Target.getTargets");
    let mb = 0, id = 0;
    const workers = targetInfos.filter(x => x.type === "worker");
    if (!workers.length) return null;                                  // no core worker: not measured, counts as over
    for (const t of workers) {
      const { sessionId } = await s.send("Target.attachToTarget", { targetId: t.targetId, flatten: false });
      const ask = ++id, got = new Promise((ok, err) => { s.on("Target.receivedMessageFromTarget", e => { const m = JSON.parse(e.message); if (m.id === ask) m.result ? ok(m.result) : err(new Error(JSON.stringify(m.error))); }); setTimeout(() => err(new Error("no answer")), 10000); });
      await s.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: ask, method: "Runtime.getHeapUsage" }) });
      mb += (await got).usedSize / 1048576;
      await s.send("Target.detachFromTarget", { sessionId }).catch(() => { /* gone */ });
    }
    return mb;
  } catch { return null; } finally { await s.detach().catch(() => { /* closed */ }); }
}
/** one helper on a fresh folder with deck20 and big30 */
async function helper(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bench-")), root = path.join(tmp, "root"), data = path.join(tmp, "data");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  for (const f of ["deck20.xlsx", "big30.xlsx"]) fs.copyFileSync(path.join(BOOKS, f), path.join(root, f));
  const p = spawn(PY, [path.join(BACKEND, "slide_builder.py"), "--no-browser", "--port", String(port)], {
    env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "bench", SLIDEBUILDER_HOST: "pc-bench", SLIDEBUILDER_BROWSER: CHROME, NO_PROXY: "*" },
    stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; p.stdout.on("data", d => log += d); p.stderr.on("data", d => log += d);
  const url = `http://127.0.0.1:${port}/`;
  // the helper starts its export browser: on Windows killing the helper alone would leave that browser running
  const stop = () => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill(); };
  for (let i = 0; i < 300; i++) { try { if ((await fetch(url + "api/ping")).ok) return { url, stop }; } catch { /* starting */ } await sleep(200); }
  stop(); throw new Error("the helper did not start:\n" + log);
}

async function run(browser, port) {
  const h = await helper(port);
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ t: e.startTime, d: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true });
    // __watch([[sel, text], …]): from the next click until each element (sel, containing text) is in the document
    let click = null, want = [];
    const check = () => { if (click === null) return; for (const x of want) if (x.seen === null && [...document.querySelectorAll(x.sel)].some(e => !x.text || e.textContent.includes(x.text))) x.seen = performance.now(); };
    window.__watch = list => { click = null; want = list.map(([sel, text]) => ({ sel, text, seen: null })); };
    window.__took = i => want[i] && want[i].seen !== null ? want[i].seen - click : null;
    window.__span = i => [click, want[i] ? want[i].seen : null];
    addEventListener("click", () => { if (want.length && click === null) { click = performance.now(); check(); } }, true);
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const longTasks = async () => page.evaluate(() => { const a = window.__long; window.__long = []; return a; });
  const watch = (...list) => page.evaluate(l => window.__watch(l), list.map(x => typeof x === "string" ? [x, ""] : x));
  /** ms from the click after watch() to its i-th element; waits for that element (Playwright) first */
  const took = async (loc, i = 0) => { await loc.waitFor({ timeout: 600000, state: "attached" }); const ms = await page.evaluate(k => window.__took(k), i); if (ms === null) throw new Error("not timed: " + loc); return ms; };
  try {
    await page.goto(h.url);
    await page.locator("#openBtn").waitFor(); await sleep(1500);
    const ltBoot = (await longTasks()).map(x => x.d);                         // start-up: reported, not gated (it is not opening)
    // ---- deck20: the wizard, then the slides (as the v3 baseline); from the click on the file in the index
    await page.click("#openBtn"); await page.locator('[data-f="deck20.xlsx"]').waitFor();
    await watch(".wiz .sheetrow"); await page.click('[data-f="deck20.xlsx"]');
    const wizard = await took(page.locator(".wiz .sheetrow").first());
    await page.click('[data-a="next"]'); await page.click('[data-a="next"]');
    await watch("#stage .slide .t"); await page.click('[data-a="finish"]');
    const slides = await took(page.locator("#stage .slide .t").first());
    const [fin, drawn] = await page.evaluate(() => window.__span(0));
    await page.locator(".thumb").nth(19).waitFor({ timeout: 60000 });
    const ltAll = await longTasks(), isFirstDraw = x => x.t >= fin && x.t <= drawn;
    const ltDeck = ltAll.filter(x => !isFirstDraw(x)).map(x => x.d), ltFirstDraw = ltAll.filter(isFirstDraw).map(x => x.d);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
    await sleep(500); await longTasks();
    // ---- big30: the index, then one 130 000-row sheet
    await page.click("#openBtn"); await page.locator('[data-f="big30.xlsx"]').waitFor();
    await watch([".wiz label", "DATA_1"]); await page.click('[data-f="big30.xlsx"]');
    const index = await took(page.locator(".wiz label", { hasText: "DATA_1" }).first());
    await page.evaluate(() => { for (const b of document.querySelectorAll(".wiz button")) if (b.textContent.trim() === "None") b.click(); });
    await page.locator(".wiz label", { hasText: "DATA_1" }).first().click();
    await watch(".wtab", ".wgrid-in td[data-r]"); await page.click('[data-a="next"]');
    const read = await took(page.locator(".wtab").first(), 0);
    const grid = await took(page.locator(".wgrid-in td[data-r]").first(), 1);
    await sleep(800);
    const ltBig = (await longTasks()).map(x => x.d);
    const pageHeap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);
    const workerHeap = await workersHeapMB(browser);
    const heap = pageHeap == null || workerHeap == null ? null : Math.round(pageHeap + workerHeap);
    if (errors.length) throw new Error("page errors: " + errors.join("; "));
    return { boot: { longtasks: ltBoot }, deck20: { wizard_ms: Math.round(wizard), finish_to_slide_ms: Math.round(slides), open_ms: Math.round(wizard + slides), longtasks: ltDeck, first_draw_longtasks: ltFirstDraw },
      big30: { index_to_wizard_ms: Math.round(index), read_sheet_ms: Math.round(read), read_to_grid_ms: Math.round(grid), longtasks: ltBig, heap_mb: heap,
        page_heap_mb: pageHeap == null ? null : Math.round(pageHeap), worker_heap_mb: workerHeap == null ? null : Math.round(workerHeap) } };
  } finally { await page.close(); h.stop(); }
}

const browser = await chromium.launch({ executablePath: CHROME });
const runs = [];
try { for (let i = 0; i < 2; i++) runs.push(await run(browser, 8981 + i)); }
finally { await browser.close(); }
const worst = {
  open_deck20_ms: Math.max(...runs.map(r => r.deck20.open_ms)),
  read_big30_ms: Math.max(...runs.map(r => r.big30.read_sheet_ms)),
  longest_task_ms: Math.max(0, ...runs.flatMap(r => [...r.deck20.longtasks, ...r.big30.longtasks])),
  first_draw_task_ms: Math.max(0, ...runs.flatMap(r => r.deck20.first_draw_longtasks)),
  // no performance.memory or no worker heap (another browser): not measured counts as over the limit, never as 0
  heap_mb: runs.some(r => r.big30.heap_mb == null) ? Infinity : Math.max(...runs.map(r => r.big30.heap_mb)),
};
const info = { longest_startup_task_ms: Math.max(0, ...runs.flatMap(r => r.boot.longtasks)) };
const out = { page: path.relative(REPO, BACKEND) || BACKEND, chrome: CHROME, machine: `${os.cpus().length} × ${os.cpus()[0].model.trim()}, ${process.platform}`, calibration: { ms: +speed.ms.toFixed(1), factor: +speed.factor.toFixed(2) }, budget: BUDGET, limits: LIMITS, worst, info, runs };
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
for (const [i, r] of runs.entries()) console.log(`bench · run ${i + 1}: deck20 open ${r.deck20.open_ms} ms (wizard ${r.deck20.wizard_ms} + slides ${r.deck20.finish_to_slide_ms}) · big30 index ${r.big30.index_to_wizard_ms} ms, sheet read ${r.big30.read_sheet_ms} ms (grid ${r.big30.read_to_grid_ms} ms) · long tasks ${JSON.stringify([...r.deck20.longtasks, ...r.big30.longtasks])} (first draw ${JSON.stringify(r.deck20.first_draw_longtasks)}) · heap ${r.big30.heap_mb} MB (page ${r.big30.page_heap_mb} + worker ${r.big30.worker_heap_mb}) · start-up tasks ${JSON.stringify(r.boot.longtasks)}`);
console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limits × ${speed.factor.toFixed(2)}`);
const bad = Object.entries(LIMITS).filter(([k, lim]) => worst[k] > lim * SLACK);
for (const [k, lim] of Object.entries(LIMITS)) console.log(`bench · ${k}: ${worst[k]} (limit ${lim}${worst[k] > lim ? (worst[k] > lim * SLACK ? " – OVER +10 %" : " – over, within +10 %") : ""})`);
console.log(`bench · not gated: longest start-up task ${info.longest_startup_task_ms} ms`);
if (GATE && bad.length) { console.error("bench: over the limit: " + bad.map(([k]) => k).join(", ")); process.exit(1); }
