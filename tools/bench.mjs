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
     export deck20   ⏱ S3.7: the Export button → the PDF saved (the page's clock), Liquid Glass then Excel; the
                     first export starts the export workers (cold, as for a user)                         < 2 s · < 1 s
                     its size (PLAN Part F): Glass < 80 KB per slide + 190 KB, Excel < 40 KB per slide;
                     no task on the page's thread over 50 ms while exporting
     keypress        ⏱ S4.1: a cell of deck20 typed into and committed with Enter, 2 untimed times (the first
                     rasters of the editor and of the table's layer: reported as "cold") then 20 timed: from the Enter
                     key to the first frame after the stage's table shows the new text (keypress → pixels, p95) < 50 ms
                     no task on the page's thread over 50 ms while editing
     drag frames     ⏱ S4.2: on the same slide, a column border, the corner, a table border, the grip, and a text box
                     moved and stretched: the page's work in each frame of a drag (its main thread between two
                     animation frames, from a trace), the frame after the drop not counted (its redraw is reported) < 16 ms
     thumbnails      ⏱ S4.3 (B14): deck20's content slides five times (100 slides), the thumbnail list scrolled to the
                     end and back with the wheel, traced: 60 fps – the longest time between two animation frames
                     (one frame missed is 33 ms)                                                        < 20 ms
                     The frames per second, the page's most work in a frame and the pictures drawn are reported
     consulting      ⏱ M7b (08 §4.3), when the build has them: deck20 exported in Consulting Navy and Red (< 1.5 s,
                     < 40 KB per slide + 150 KB), keypress → pixels and the drags in Navy (as above), deck20 opened
                     again in Navy (index → the preset box, Continue → the new deck's first slide drawn; < 400 ms), no
                     task over 50 ms (the open's after-work included) – the tasks until its first slide is drawn have
                     the first-draw limit, as deck20's open (< 250 ms); this build's page must measure them
     heap            after the big sheet was read: the page (performance.memory) plus the core worker, which
                     holds the workbook since S2.4 (Runtime.getHeapUsage over the DevTools protocol)    < 150 MB
   The two time limits are scaled by how much slower this machine is than the reference PC (tools/calibrate.mjs,
   decision 2026-10-12: GitHub's runners are 1.3–1.6× slower and passed or failed by chance; at most 2×, so a
   slow runner cannot hide a doubling); long tasks and heap are not.

     node tools/bench.mjs [--page DIR] [--json OUT] [--no-gate]
   --page DIR  another build's program folder (e.g. a v3 worktree's backend/, or helper/ from 4.0) – to record its numbers
   Needs: npm ci (Playwright), Python (the helper: python3, on Windows python), Chromium (CHROME, or Playwright's), and
   tests/corpus/workbooks/big30.xlsx (python tools/make_corpus.py big30 tests/corpus/workbooks). */
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { speedFactor } from "./calibrate.mjs";
import { sysFontDirs } from "./sysfonts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BACKEND = path.resolve(arg("--page", path.join(REPO, "helper")));
const GATE = !process.argv.includes("--no-gate");
const BUDGET = { open_deck20_ms: 400, read_big30_ms: 1000, longest_task_ms: 50, first_draw_task_ms: 250, heap_mb: 150,
  export_glass_ms: 2000, export_excel_ms: 1000, export_glass_kb: 80 * 20 + 190, export_excel_kb: 40 * 20, keypress_p95_ms: 50, drag_frame_ms: 16, thumbs_gap_ms: 20,
  // M7b (08 §4.3): the consulting designs – export 1.5 s and 40 KB per slide + 150 KB; keypress, drags, open as the others
  export_navy_ms: 1500, export_red_ms: 1500, export_navy_kb: 40 * 20 + 150, export_red_kb: 40 * 20 + 150, keypress_navy_p95_ms: 50, drag_navy_frame_ms: 16,
  open_navy_ms: 400, longest_navy_task_ms: 50, first_draw_navy_task_ms: 250 }, SLACK = 1.1;
const speed = speedFactor(), TIMED = ["open_deck20_ms", "read_big30_ms", "export_glass_ms", "export_excel_ms", "export_navy_ms", "export_red_ms", "open_navy_ms"];   // keypress: not scaled (decision 2026-10-12 names the others)
const LIMITS = Object.fromEntries(Object.entries(BUDGET).map(([k, v]) => [k, TIMED.includes(k) ? Math.round(v * speed.factor) : v]));
const CHROME = process.env.CHROME || chromium.executablePath();
const PY = process.platform === "win32" ? "python" : "python3";
const BOOKS = path.join(REPO, "tests/corpus/workbooks");
for (const f of ["deck20.xlsx", "big30.xlsx"]) if (!fs.existsSync(path.join(BOOKS, f))) { console.error(`${f} is missing (python tools/make_corpus.py big30 tests/corpus/workbooks)`); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** the JS heap of every dedicated worker in the browser (the core worker), MB; null if the protocol refused */
/** the heap of the core worker (gated with the page's) and of the export workers (S3.7: named "sb-export"; started by
    an export and stopped a minute later – reported, not gated) */
async function workersHeapMB(browser) {
  const s = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = await s.send("Target.getTargets");
    let mb = 0, exp = 0, id = 0;
    const workers = targetInfos.filter(x => x.type === "worker");
    if (!workers.some(t => t.title !== "sb-export")) return null;      // no core worker: not measured, counts as over
    for (const t of workers) {
      const { sessionId } = await s.send("Target.attachToTarget", { targetId: t.targetId, flatten: false });
      const ask = ++id, got = new Promise((ok, err) => { s.on("Target.receivedMessageFromTarget", e => { const m = JSON.parse(e.message); if (m.id === ask) m.result ? ok(m.result) : err(new Error(JSON.stringify(m.error))); }); setTimeout(() => err(new Error("no answer")), 10000); });
      await s.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: ask, method: "Runtime.getHeapUsage" }) });
      const used = (await got).usedSize / 1048576;
      if (t.title === "sb-export") exp += used; else mb += used;
      await s.send("Target.detachFromTarget", { sessionId }).catch(() => { /* gone */ });
    }
    return { core: mb, export: exp, exportWorkers: workers.filter(t => t.title === "sb-export").length };
  } catch { return null; } finally { await s.detach().catch(() => { /* closed */ }); }
}
/** one helper on a fresh folder with deck20 and big30 */
async function helper(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-bench-")), root = path.join(tmp, "root"), data = path.join(tmp, "data");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  for (const f of ["deck20.xlsx", "big30.xlsx"]) fs.copyFileSync(path.join(BOOKS, f), path.join(root, f));
  const p = spawn(PY, [path.join(BACKEND, "slide_builder.py"), "--no-browser", "--port", String(port)], {
    env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "bench", SLIDEBUILDER_HOST: "pc-bench", NO_PROXY: "*",
      ...(sysFontDirs() ? { SLIDEBUILDER_SYSFONTS: sysFontDirs() } : {}) },
    stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; p.stdout.on("data", d => log += d); p.stderr.on("data", d => log += d);
  const url = `http://127.0.0.1:${port}/`;
  // the helper starts its export browser: on Windows killing the helper alone would leave that browser running
  const stop = () => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill(); };
  for (let i = 0; i < 300; i++) { try { if ((await fetch(url + "api/ping")).ok) return { url, root, stop }; } catch { /* starting */ } await sleep(200); }
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
    const check = () => { if (click === null) return; for (const x of want) if (x.seen === null && [...document.querySelectorAll(x.sel)].some(e => !x.text || e.textContent.includes(x.text))) { x.seen = performance.now(); requestAnimationFrame(() => setTimeout(() => { x.painted = performance.now(); }, 0)); } };
    window.__watch = list => { click = null; want = list.map(([sel, text]) => ({ sel, text, seen: null })); };
    window.__took = i => want[i] && want[i].seen !== null ? want[i].seen - click : null;
    // until the element is drawn: the end of the frame after it came into the document (S4.1: the stage inserts its SVG,
    // then the frame lays it out and paints it – both are "drawing the first slide", decision 2026-10-12, 2)
    window.__span = i => [click, want[i] ? want[i].painted ?? want[i].seen : null];
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
    await page.waitForFunction(() => window.__span(0)[1] !== null && window.__took(0) !== null && window.__span(0)[1] - window.__span(0)[0] > window.__took(0), null, { timeout: 5000 }).catch(() => { /* the frame did not come: the insertion ends the window */ });
    const [fin, drawn] = await page.evaluate(() => window.__span(0));
    await page.locator(".thumb").nth(19).waitFor({ timeout: 60000 });
    const ltAll = await longTasks(), isFirstDraw = x => x.t >= fin && x.t <= drawn;
    const ltDeck = ltAll.filter(x => !isFirstDraw(x)).map(x => x.d), ltFirstDraw = ltAll.filter(isFirstDraw).map(x => x.d);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
    await sleep(500); await longTasks();
    // ---- keypress → pixels (S4.1): a cell of the second slide typed into and committed, 20 times
    /** keypress → pixels on the second slide: 2 untimed edits ("cold"), then 20 timed (p50 / p95 / max) */
    const keypressRun = async () => {
      await page.locator(".thumb").nth(1).click();
      await page.waitForFunction(() => window.__sbTest.stageIdle());
      const cell = (await page.locator("#stage .slide > .tw .t").nth(8).boundingBox());
      await page.evaluate(() => {
        // from the Enter that commits to the first frame after the stage's tables show the text (a <desc> of a cell);
        // installed once (a second run – Consulting Navy – reuses them)
        window.__kp = { t0: null, done: null, want: "" };
        if (window.__kpOn) return; window.__kpOn = true;
        addEventListener("keydown", e => { if (e.key === "Enter" && window.__kp.want && window.__kp.t0 === null) window.__kp.t0 = performance.now(); }, true);
        new MutationObserver(() => {
          const k = window.__kp; if (k.t0 === null || k.done !== null) return;
          if ([...document.querySelectorAll("#stage .slide > .tw desc")].some(d => d.textContent === k.want)) requestAnimationFrame(() => { if (k.done === null) k.done = performance.now(); });
        }).observe(document.querySelector("#stage"), { subtree: true, childList: true });
      });
      const keys = [], cold = [];
      for (let k = 0; k < 22; k++) {
        const want = String(4100 + k);
        await page.mouse.click(cell.x + 6, cell.y + cell.height / 2);
        await page.keyboard.type(want);
        await page.evaluate(w => { window.__kp = { t0: null, done: null, want: w }; }, want);
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => window.__kp.done !== null, null, { timeout: 10000 });
        keys.push(await page.evaluate(() => window.__kp.done - window.__kp.t0));
        if (k === 1) cold.push(...keys.splice(0));                              // the two warm-up edits
      }
      keys.sort((a, b) => a - b);
      const keypress = { cold_ms: cold.map(Math.round), p50_ms: Math.round(keys[Math.floor(keys.length * .5)]), p95_ms: Math.round(keys[Math.ceil(keys.length * .95) - 1]), max_ms: Math.round(keys[keys.length - 1]) };
      return keypress;
    };
    const keypress = await keypressRun();
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
    const ltEdit = (await longTasks()).map(x => x.d);
    const drags = await dragFrames(browser, page);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
    await longTasks();                                                                       // (the drops' redraws: in drags)
    // ---- export deck20 (S3.7): Liquid Glass (the default design), then Excel
    const exportOnce = async () => {
      await page.evaluate(() => { window.__sbTest.lastExport.files = []; });
      await page.click("#exportBtn");
      await page.waitForFunction(() => window.__sbTest.lastExport.files.length > 0 && !window.__sbTest.exporting(), null, { timeout: 120000 });
      const { files, ms, phases } = await page.evaluate(() => ({ files: [...window.__sbTest.lastExport.files], ms: window.__sbTest.lastExport.ms, phases: window.__sbTest.exportPhases() }));
      return { ms: Math.round(ms), phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Math.round(v)])), kb: Math.round(fs.statSync(path.join(h.root, "export", files[0])).size / 102.4) / 10 };
    };
    const glass = await exportOnce();                                                        // cold: starts the export workers
    const ltGlass = (await longTasks()).map(x => x.d);
    await page.click('[data-design="excel"]'); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300);
    await longTasks();                                                                       // switching the design: not the export's
    const excel = await exportOnce();
    const ltExport = [...ltGlass, ...(await longTasks()).map(x => x.d)];
    await page.click('[data-design="glass"]'); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300); await longTasks();
    const thumbs = await thumbScroll(browser, page);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300);
    const ltThumbs = (await longTasks()).map(x => x.d);
    // ---- the consulting designs (M7b, 08 §4.3; after the thumbnails, so their scroll is measured as before; a build without them – --page of an older one – skips this): deck20
    // exported in Consulting Navy and Red, keypress → pixels and the drags in Navy, deck20 opened again in Navy
    let consult = null;
    if (await page.locator('[data-design="mckinsey"]').count()) {
      const design = async d => { await page.click(`[data-design="${d}"]`); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300); await longTasks(); };
      await design("mckinsey");
      const navy = await exportOnce(), ltNavy = (await longTasks()).map(x => x.d);
      await design("bain");
      const red = await exportOnce(), ltRed = (await longTasks()).map(x => x.d);
      await design("mckinsey");
      const kp = await keypressRun();
      await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
      const ltKp = (await longTasks()).map(x => x.d);
      const dr = await dragFrames(browser, page);
      await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300); await longTasks();
      // deck20 opened again (it is a deck now): index → the preset box, "Continue with preset" → first slide in Navy
      await page.click("#openBtn"); await page.locator('[data-f="deck20.xlsx"]').waitFor();
      await watch('[data-a="continue"]'); await page.click('[data-f="deck20.xlsx"]');
      const box = await took(page.locator('[data-a="continue"]').first());
      // the old deck stays on the stage until the new one starts: from the click on Continue (the page's clock) until
      // the open is over (#fileName no longer "Opening …"), the stage shows the new deck's slide and a frame has passed
      const { t0: open0, ms: first } = await page.evaluate(() => new Promise((ok, no) => {
        const t0 = performance.now(), T = window.__sbTest, name = () => document.querySelector("#fileName")?.textContent || "";
        const tick = () => {
          if (performance.now() - t0 > 30000) return no(new Error("deck20 did not open in Consulting Navy"));
          if (!name().startsWith("Opening") && T.stageIdle() && document.querySelector("#stage .slide.consult .t")) return requestAnimationFrame(() => ok({ t0, ms: performance.now() - t0 }));
          requestAnimationFrame(tick);
        };
        document.querySelector('[data-a="continue"]').click(); requestAnimationFrame(tick);
      }));
      // its after-work (the thumbnails drawn again, the save) counted here, not in big30's window: until the stage is
      // idle, then 2 s
      await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60000 }); await sleep(2000);
      await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
      // as deck20's open (decision 2026-10-12): the tasks from Continue until the first slide is drawn – Chromium's first use
      // of each font instance – have the first-draw limit; the rest the 50 ms one
      const ltAllOpen = await longTasks(), drawing = x => x.t >= open0 && x.t <= open0 + first;
      const ltOpen = ltAllOpen.filter(x => !drawing(x)).map(x => x.d), ltOpenDraw = ltAllOpen.filter(drawing).map(x => x.d);
      consult = { navy_ms: navy.ms, navy_kb: navy.kb, red_ms: red.ms, red_kb: red.kb, keypress: kp, drags: dr, open_ms: Math.round(box + first),
        longtasks: [...ltNavy, ...ltRed, ...ltKp, ...ltOpen], phases: { export_navy: ltNavy, export_red: ltRed, keypress: ltKp, open: ltOpen, open_first_draw: ltOpenDraw }, first_draw: ltOpenDraw };
      await design("glass"); await sleep(1500);
      consult.phases.back = (await longTasks()).map(x => x.d); consult.longtasks.push(...consult.phases.back);   // the switch back's redraws
    }
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
    const workers = await workersHeapMB(browser), workerHeap = workers ? workers.core : null;
    const heap = pageHeap == null || workerHeap == null ? null : Math.round(pageHeap + workerHeap);
    if (errors.length) throw new Error("page errors: " + errors.join("; "));
    return { boot: { longtasks: ltBoot }, deck20: { wizard_ms: Math.round(wizard), finish_to_slide_ms: Math.round(slides), open_ms: Math.round(wizard + slides), longtasks: ltDeck, first_draw_longtasks: ltFirstDraw },
      edit: { keypress, longtasks: ltEdit }, drags, thumbs: { ...thumbs, longtasks: ltThumbs },
      consult,
      export: { glass_ms: glass.ms, glass_kb: glass.kb, glass_phases: glass.phases, excel_ms: excel.ms, excel_kb: excel.kb, excel_phases: excel.phases, longtasks: ltExport },
      big30: { index_to_wizard_ms: Math.round(index), read_sheet_ms: Math.round(read), read_to_grid_ms: Math.round(grid), longtasks: ltBig, heap_mb: heap,
        page_heap_mb: pageHeap == null ? null : Math.round(pageHeap), worker_heap_mb: workerHeap == null ? null : Math.round(workerHeap),
        export_workers: workers ? workers.exportWorkers : null, export_heap_mb: workers ? Math.round(workers.export) : null } };
  } finally { await page.close(); h.stop(); }
}

/** the drags of S4.2 on the slide shown, traced: per drag the most work the page's main thread did between two animation
    frames while the pointer moved (Part F: 16 ms), and the longest task after the drop (the slide drawn again) */
async function dragFrames(browser, page) {
  const out = {}, sleep2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const at = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const drag = async (name, from, dx, dy) => {
    await page.mouse.move(from.x, from.y); await sleep2();
    await page.evaluate(n => { window.__drag = { name: n, frames: [] }; const tick = t => { if (!window.__drag) return; window.__drag.frames.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick); performance.mark("drag:" + n); }, name);
    await page.mouse.down();
    for (let k = 1; k <= 24; k++) await page.mouse.move(from.x + dx * k / 24, from.y + dy * k / 24);
    await page.evaluate(n => { performance.mark("up:" + n); window.__dragUp = performance.now(); }, name);
    await page.mouse.up();
    await page.waitForTimeout(700);
    out[name] = await page.evaluate(() => { const d = window.__drag; window.__drag = null; return { frames: d.frames, up: window.__dragUp }; });
  };
  await page.locator("#stage .stagewrap").hover();
  const trace = path.join(os.tmpdir(), "sb-bench-drags-" + process.pid + ".json");
  await browser.startTracing(page, { path: trace, categories: ["devtools.timeline", "blink.user_timing", "toplevel"] });
  try {
    const cell = (await page.locator("#stage .slide > .tw[data-i=\"0\"] .t").nth(3).boundingBox());
    await drag("border", { x: cell.x + cell.width, y: cell.y + cell.height / 2 }, 40, 0);
    await drag("corner", await at('#stage .hbox[data-i="0"] .size'), -80, -40);
    await drag("corner again", await at('#stage .hbox[data-i="0"] .size'), 60, 30);
    const edge = await at('#stage .hbox[data-i="0"] .edge.r');
    await drag("stretch", { x: edge.x, y: edge.b.y + edge.b.height / 4 }, -60, 0);
    const t0 = await at('#stage .slide > .tw[data-i="0"]');
    await drag("grip", await at('#stage .hbox[data-i="1"] .grip'), t0.x - (await at('#stage .hbox[data-i="1"] .grip')).x, t0.b.y + 4 - (await at('#stage .hbox[data-i="1"] .grip')).y);
    // the slide's notes (a second pass – the consulting designs – finds them made by the first)
    if (!(await page.locator("#stage .tnote.memo").count())) { await page.click("#slideNotes"); await page.locator("textarea.note-edit").fill("Source: ECB, monthly figures; the totals include the subsidiaries"); await page.keyboard.press("Control+Enter"); }
    await page.locator("#stage .tnote.memo").waitFor(); await page.waitForTimeout(500);
    const note = await at("#stage .tnote.memo");
    await drag("note move", { x: note.x, y: note.y }, 60, -40);
    const moved = (await page.locator("#stage .tnote.memo").boundingBox());
    await drag("note stretch", { x: moved.x + moved.width - 2, y: moved.y + moved.height / 2 }, -200, 0);
  } finally { await browser.stopTracing(); }
  const { tasks, frames } = traced(trace, "drag");
  const res = {};
  for (const [name, d] of Object.entries(out)) {
    const w = frames(name, d); if (!w) continue;
    const after = tasks.filter(e => e.ts >= w.end && e.ts <= w.end + 700000).reduce((x, e) => Math.max(x, e.dur / 1000), 0);
    res[name] = { frames: w.frames, frame_ms: w.frame_ms, gap_ms: w.gap_ms, drop_task_ms: Math.round(after) };
  }
  return res;
}
/** a trace's main-thread tasks (the outermost only: a ThreadControllerImpl::RunTask runs inside a RunTask, counted once)
    and, for a window the page marked "<kind>:<name>" … "up:<name>" with its animation frames' times, the most work
    between two frames and the longest time between two frames (the page's work, or the compositor's and the GPU's) */
function traced(trace, kind) {
  const ev = JSON.parse(fs.readFileSync(trace, "utf8")).traceEvents;
  if (process.env.SB_KEEP_TRACES) console.log("bench · trace kept: " + trace); else fs.rmSync(trace, { force: true });
  const marks = ev.filter(e => e.cat?.includes("user_timing") && new RegExp("^(" + kind + "|up):").test(e.name));
  const main = marks[0] ? marks[0].pid + ":" + marks[0].tid : null;
  const all = ev.filter(e => e.ph === "X" && e.pid + ":" + e.tid === main && ["RunTask", "ThreadControllerImpl::RunTask"].includes(e.name)).sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const tasks = []; for (const e of all) { const o = tasks.at(-1); if (!o || e.ts >= o.ts + o.dur) tasks.push(e); }
  const frames = (name, d) => {
    const m = marks.find(e => e.name === kind + ":" + name), u = marks.find(e => e.name === "up:" + name); if (!m || !u) return null;
    // trace time of the page's clock: the mark's time minus its performance.now()
    const off = u.ts - d.up * 1000, f = d.frames.map(t => t * 1000 + off).filter(t => t >= m.ts && t <= u.ts);
    let worst = 0;
    for (let k = 0; k + 1 < f.length; k++) {
      let busy = 0;
      for (const e of tasks) { const a = Math.max(e.ts, f[k]), b = Math.min(e.ts + e.dur, f[k + 1]); if (b > a) busy += b - a; }
      worst = Math.max(worst, busy / 1000);
    }
    const gap = f.slice(1).reduce((x, t, k) => Math.max(x, t - f[k]), 0) / 1000;
    return { frames: f.length, frame_ms: Math.round(worst * 10) / 10, gap_ms: Math.round(gap * 10) / 10, fps: f.length > 1 ? Math.round((f.length - 1) / ((f.at(-1) - f[0]) / 1e6)) : 0, end: u.ts };
  };
  return { tasks, frames };
}

/** S4.3 (B14): a 100-slide deck (deck20's content slides five times, one change: one undo step), its thumbnail list
    scrolled to the end and back with the wheel, traced as the drags are; then the deck as it was (undo) */
async function thumbScroll(browser, page) {
  await page.evaluate(() => {
    const p = window.__sbTest.preset(), base = p.slides.filter(x => x.type === "content");
    p.slides = Array.from({ length: 100 }, (_, k) => ({ ...structuredClone(base[k % base.length]), id: base[k % base.length].id + "-b" + k }));
    window.__sbTest.change("Bench: 100 slides", [{ op: "preset.set", preset: p }]);
  });
  await page.locator(".thumb").nth(99).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const box = await page.locator("#thumbs").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const asked0 = await page.evaluate(() => window.__sbTest.thumbStats());
  const trace = path.join(os.tmpdir(), "sb-bench-thumbs-" + process.pid + ".json");
  await browser.startTracing(page, { path: trace, categories: ["devtools.timeline", "blink.user_timing", "toplevel"] });
  const d = {};
  try {
    await page.evaluate(() => { window.__drag = { frames: [] }; const tick = t => { if (!window.__drag) return; window.__drag.frames.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick); performance.mark("scroll:thumbs"); });
    // about 1.6 screens a second: 100 slides down and up in about 8 s
    for (const dir of [1, -1]) for (let k = 0; k < 120; k++) { await page.mouse.wheel(0, dir * 130); await page.waitForTimeout(16); }
    await page.evaluate(() => { performance.mark("up:thumbs"); window.__dragUp = performance.now(); });
    Object.assign(d, await page.evaluate(() => { const x = window.__drag; window.__drag = null; return { frames: x.frames, up: window.__dragUp }; }));
  } finally { await browser.stopTracing(); }
  if (process.env.SB_KEEP_TRACES) fs.writeFileSync(trace + ".frames.json", JSON.stringify(d));
  const w = traced(trace, "scroll").frames("thumbs", d);
  const asked = await page.evaluate(() => window.__sbTest.thumbStats());
  await page.locator("#stage .stagewrap").click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Control+z");
  await page.locator(".thumb").nth(20).waitFor({ state: "detached", timeout: 60000 });
  return { slides: 100, frames: w.frames, fps: w.fps, frame_ms: w.frame_ms, gap_ms: w.gap_ms, pictures: asked.drawn - asked0.drawn };
}

const browser = await chromium.launch({ executablePath: CHROME });
const runs = [];
try { for (let i = 0; i < 2; i++) runs.push(await run(browser, 8981 + i)); }
finally { await browser.close(); }
const worst = {
  open_deck20_ms: Math.max(...runs.map(r => r.deck20.open_ms)),
  read_big30_ms: Math.max(...runs.map(r => r.big30.read_sheet_ms)),
  longest_task_ms: Math.max(0, ...runs.flatMap(r => [...r.deck20.longtasks, ...r.edit.longtasks, ...r.thumbs.longtasks, ...r.export.longtasks, ...r.big30.longtasks])),
  keypress_p95_ms: Math.max(...runs.map(r => r.edit.keypress.p95_ms)),
  drag_frame_ms: Math.max(...runs.flatMap(r => Object.values(r.drags).map(d => d.frame_ms))),
  thumbs_gap_ms: Math.max(...runs.map(r => r.thumbs.gap_ms)),
  first_draw_task_ms: Math.max(0, ...runs.flatMap(r => r.deck20.first_draw_longtasks)),
  // no performance.memory or no worker heap (another browser): not measured counts as over the limit, never as 0
  heap_mb: runs.some(r => r.big30.heap_mb == null) ? Infinity : Math.max(...runs.map(r => r.big30.heap_mb)),
  export_glass_ms: Math.max(...runs.map(r => r.export.glass_ms)), export_excel_ms: Math.max(...runs.map(r => r.export.excel_ms)),
  export_glass_kb: Math.max(...runs.map(r => r.export.glass_kb)), export_excel_kb: Math.max(...runs.map(r => r.export.excel_kb)),
  // the consulting designs (M7b): an older build (--page) has none and is not gated on them; this build's own page must
  // measure them – not measured counts as over the limit, never as passing
  ...(runs.every(r => r.consult) ? {
    export_navy_ms: Math.max(...runs.map(r => r.consult.navy_ms)), export_red_ms: Math.max(...runs.map(r => r.consult.red_ms)),
    export_navy_kb: Math.max(...runs.map(r => r.consult.navy_kb)), export_red_kb: Math.max(...runs.map(r => r.consult.red_kb)),
    keypress_navy_p95_ms: Math.max(...runs.map(r => r.consult.keypress.p95_ms)),
    drag_navy_frame_ms: Math.max(...runs.flatMap(r => Object.values(r.consult.drags).map(d => d.frame_ms))),
    open_navy_ms: Math.max(...runs.map(r => r.consult.open_ms)),
    longest_navy_task_ms: Math.max(0, ...runs.flatMap(r => r.consult.longtasks)),
    first_draw_navy_task_ms: Math.max(0, ...runs.flatMap(r => r.consult.first_draw)) }
    : arg("--page") ? {} : Object.fromEntries(["export_navy_ms", "export_red_ms", "export_navy_kb", "export_red_kb", "keypress_navy_p95_ms", "drag_navy_frame_ms", "open_navy_ms", "longest_navy_task_ms", "first_draw_navy_task_ms"].map(k => [k, Infinity]))),
};
const info = { longest_startup_task_ms: Math.max(0, ...runs.flatMap(r => r.boot.longtasks)), thumbs_frame_ms: Math.max(...runs.map(r => r.thumbs.frame_ms)) };
const out = { page: path.relative(REPO, BACKEND) || BACKEND, chrome: CHROME, machine: `${os.cpus().length} × ${os.cpus()[0].model.trim()}, ${process.platform}`, calibration: { ms: +speed.ms.toFixed(1), factor: +speed.factor.toFixed(2) }, budget: BUDGET, limits: LIMITS, worst, info, runs };
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
for (const [i, r] of runs.entries()) console.log(`bench · run ${i + 1}: deck20 open ${r.deck20.open_ms} ms (wizard ${r.deck20.wizard_ms} + slides ${r.deck20.finish_to_slide_ms}) · keypress → pixels (cold ${r.edit.keypress.cold_ms.join(" / ")}) p50 ${r.edit.keypress.p50_ms} / p95 ${r.edit.keypress.p95_ms} / max ${r.edit.keypress.max_ms} ms (tasks ${JSON.stringify(r.edit.longtasks)}) · thumbnails, 100 slides scrolled: ${r.thumbs.fps} fps, ${r.thumbs.frame_ms} ms/frame (longest gap ${r.thumbs.gap_ms} ms, ${r.thumbs.pictures} pictures, tasks ${JSON.stringify(r.thumbs.longtasks)}) · drags ${Object.entries(r.drags).map(([k, d]) => `${k} ${d.frame_ms} ms/frame (${d.frames} frames, longest gap ${d.gap_ms} ms, drop ${d.drop_task_ms} ms)`).join(", ")} · export deck20 Liquid Glass ${r.export.glass_ms} ms ${JSON.stringify(r.export.glass_phases)} ${r.export.glass_kb} KB, Excel ${r.export.excel_ms} ms ${JSON.stringify(r.export.excel_phases)} ${r.export.excel_kb} KB (tasks ${JSON.stringify(r.export.longtasks)}) · big30 index ${r.big30.index_to_wizard_ms} ms, sheet read ${r.big30.read_sheet_ms} ms (grid ${r.big30.read_to_grid_ms} ms) · long tasks ${JSON.stringify([...r.deck20.longtasks, ...r.big30.longtasks])} (first draw ${JSON.stringify(r.deck20.first_draw_longtasks)}) · heap ${r.big30.heap_mb} MB (page ${r.big30.page_heap_mb} + worker ${r.big30.worker_heap_mb}; ${r.big30.export_workers} export workers ${r.big30.export_heap_mb} MB, not gated) · start-up tasks ${JSON.stringify(r.boot.longtasks)}`);
console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limits × ${speed.factor.toFixed(2)}`);
for (const [i, r] of runs.entries()) if (r.consult) console.log(`bench · run ${i + 1}: Consulting Navy long tasks by phase ${JSON.stringify(r.consult.phases)}`);
const bad = Object.entries(LIMITS).filter(([k, lim]) => k in worst && worst[k] > lim * SLACK);
for (const [k, lim] of Object.entries(LIMITS)) if (k in worst) console.log(`bench · ${k}: ${worst[k]} (limit ${lim}${worst[k] > lim ? (worst[k] > lim * SLACK ? " – OVER +10 %" : " – over, within +10 %") : ""})`);
console.log(`bench · not gated: longest start-up task ${info.longest_startup_task_ms} ms; most page work in a frame of the thumbnail scroll ${info.thumbs_frame_ms} ms (a garbage collection can fall into one)`);
// on GitHub Actions each gate over its limit is also an annotation of the run (readable without the log's admin rights)
if (process.env.GITHUB_ACTIONS) for (const [k, lim] of bad) console.log(`::error title=bench ${k}::${worst[k]} (limit ${lim}, + 10 % allowed)`);
if (GATE && bad.length) { console.error("bench: over the limit: " + bad.map(([k]) => k).join(", ")); process.exit(1); }
