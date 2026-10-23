/* ⏱ Browser benchmarks (PLAN S2.6, Part F; from spikes/baseline/measure.mjs): the built page with a real helper in
   Chromium, each scenario twice; the worse run counts and CI fails above a limit + 10 % – a timing gate only when a
   repeat in a fresh page is over too (tools/benchgate.mjs, decision 2026-10-20). Times are taken in the page:
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
     PowerPoint      ⏱ S11.3 (07 §4.4 / §6.4, PX-04), when the build has it: Export ▾ › PowerPoint · all slides of
                     deck20 after each PDF (Liquid Glass, Excel): click → the .pptx saved                 < 3 s · < 1.5 s
                     its size (PLAN Part F): Liquid Glass < 3 MB, Excel < 300 KB; the tasks as above
     combo charts    ⏱ S14.6 (09 §7.4, PX-05): deck20 with 6 combo charts (columns + a line on a second axis, an
                     arrow mark) on slides 2–7, Liquid Glass, Export ▾ › PowerPoint: click → the .pptx saved     < 3 s
                     (warm: after the change's save). Reported, not gated: the same export at once after the change
                     (combo_cold_ms; deck20 is already format 5 by then, so without the format guard's one-time wait)
     keypress        ⏱ S4.1: a cell of deck20 typed into and committed with Enter, 2 untimed times (the first
                     rasters of the editor and of the table's layer: reported as "cold") then 20 timed: from the Enter
                     key to the first frame after the stage's table shows the new text (keypress → pixels, p95) < 50 ms
                     no task on the page's thread over 50 ms while editing
     drag frames     ⏱ S4.2: on the same slide, a column border, the corner, a table border, the grip, and a text box
                     moved and stretched: the page's work in each frame of a drag (its main thread between two
                     animation frames, from a trace), the frame after the drop not counted (its redraw is reported) < 16 ms
     free drags      ⏱ S10.2 (07 §6.4, FL-02), when the build has it: the same slide in a free layout – a table moved by
                     its grip, scaled by its corner and by an edge, the notes section moved – traced as above    < 16 ms
     thumbnails      ⏱ S4.3 (B14): deck20's content slides five times (100 slides), the thumbnail list scrolled to the
                     end and back with the wheel, traced: 60 fps – the longest time between two animation frames
                     (one frame missed is 33 ms)                                                        < 20 ms
                     The frames per second, the page's most work in a frame and the pictures drawn are reported
     consulting      ⏱ M7b (08 §4.3), when the build has them: deck20 exported in Consulting Navy and Red (< 1.5 s,
                     < 40 KB per slide + 150 KB), keypress → pixels and the drags in Navy (as above), deck20 opened
                     again in Navy (index → the preset box, Continue → the new deck's first slide drawn; < 400 ms), no
                     task over 50 ms (the open's after-work included) – the tasks until its first slide is drawn have
                     the first-draw limit, as deck20's open (< 250 ms); this build's page must measure them
     scenario        ⏱ M8 S8.3 (07 §6.4, SC-08 / SC-09), when the build has it: Run for each value on BanksBig
                     (tests/corpus/workbooks/recalc, 20 chained slide sheets; the input Control!B4, the week) in
                     Liquid Glass – one value recalculated and its 20 slides exported (< 3 s), 20 values (< 40 s), from
                     the click on Run to the run's end; no main-thread task over 50 ms during the runs; before them
                     (S8.4) a preview's switch on deck20 – a cell of its slide the input, the engine warm – from the
                     click on Preview until the stage shows the value (< 400 ms)
     icon picker   ⏱ S15.2 (09 §7.4), when the build has it: Shapes & icons… (4.12; before it Insert shape ▾ › More icons…) on deck20 – the icon set's first
                     use in the core worker (inflate + index, cold; the worker's own time)                 < 150 ms
                     2 untimed then 20 timed keystrokes, the key → the first frame with that query's hits, p95 < 50 ms
     heap          after the big sheet was read: the page (performance.memory) plus the core worker, which
                     holds the workbook since S2.4 (Runtime.getHeapUsage over the DevTools protocol)    < 150 MB
   The two time limits are scaled by how much slower this machine is than the reference PC (tools/calibrate.mjs,
   decision 2026-10-12: GitHub's runners are 1.3–1.6× slower and passed or failed by chance; at most 2×, so a
   slow runner cannot hide a doubling); long tasks and heap are not. On CI the big30 read's limit takes the larger of
   that factor and the engine calibration's (core/bench/wasmcalib.ts, as the engine's limits and the CI task limits do):
   the JS workload under-rates the slower runners for this read – see BIG30_CI below.

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
import { SLACK, annotation, describe, judge, onCI } from "./benchgate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BACKEND = path.resolve(arg("--page", path.join(REPO, "helper")));
const GATE = !process.argv.includes("--no-gate");
const BUDGET = { open_deck20_ms: 400, read_big30_ms: 1000, longest_task_ms: 50, first_draw_task_ms: 250, heap_mb: 150,
  export_glass_ms: 2000, export_excel_ms: 1000, export_glass_kb: 80 * 20 + 190, export_excel_kb: 40 * 20, keypress_p95_ms: 50, drag_frame_ms: 16, free_drag_frame_ms: 16, thumbs_gap_ms: 20,
  // S11.3 (PLAN Part F, 07 §4.4): the PowerPoint file of deck20 – Liquid Glass 3 s and 3 MB, Excel 1.5 s and 300 KB
  pptx_glass_ms: 3000, pptx_excel_ms: 1500, pptx_glass_kb: 3 * 1024, pptx_excel_kb: 300,
  // M7b (08 §4.3): the consulting designs – export 1.5 s and 40 KB per slide + 150 KB; keypress, drags, open as the others
  export_navy_ms: 1500, export_red_ms: 1500, export_navy_kb: 40 * 20 + 150, export_red_kb: 40 * 20 + 150, keypress_navy_p95_ms: 50, drag_navy_frame_ms: 16,
  open_navy_ms: 400, longest_navy_task_ms: 50, first_draw_navy_task_ms: 250,
  // M8 S8.3 (07 §6.4, SC-08 / SC-09): Run for each value on BanksBig (20 chained slide sheets), Liquid Glass – one value
  // recalculated + its 20 slides exported, 20 values; no main-thread task over 50 ms during the runs
  scenario_one_ms: 3000, scenario_20_ms: 40000, scenario_task_ms: 50,
  // M8 S8.4 (07 §6.4): a preview's switch – the click on Preview to the stage showing the value – on deck20, warm engine
  preview_switch_ms: 400,
  // 09 §7.4 (S14.P): the page's budgets of M14 and M15, skipped until the step that introduces each measures it – judge()
  // gates only what a run measured (tools/benchgate.mjs). Each milestone fills in its own side of the line below
  // S14.6: Export ▾ › PowerPoint of deck20 with 6 combo charts (Liquid Glass) < 3 s
  pptx_combo_ms: 3000,
  /* ---- M14 above this line, M15 below it ---- */
  // S15.2: the icon set's first use (in the worker, cold) < 150 ms; the icon picker, keystroke → results drawn, p95 < 50 ms
  // S15.4: a drag frame with snapping on, 60 objects on the slide < 16 ms (the drag-frame budget, unchanged)
  icon_first_use_ms: 150, icon_picker_p95_ms: 50, snap_drag_frame_ms: 16,
};
/** 09 §7.4's times scaled by this machine's speed (the picker's keystroke and the drag frame are not, as keypress and drags) */
const TIMED_09 = ["pptx_combo_ms", "icon_first_use_ms"];
const speed = speedFactor(), TIMED = [...TIMED_09, "open_deck20_ms", "read_big30_ms", "export_glass_ms", "export_excel_ms", "pptx_glass_ms", "pptx_excel_ms", "export_navy_ms", "export_red_ms", "open_navy_ms", "scenario_one_ms", "scenario_20_ms", "preview_switch_ms"];   // keypress: not scaled (decision 2026-10-12 names the others)
// on CI only (decision 2026-10-18): the main-thread task and frame-gap limits follow the runner's speed too – the factor
// the engine bench measured before this one (core/bench/wasmcalib.ts); keypress and drag frames stay as they are
const UNTIMED_CI = ["longest_task_ms", "first_draw_task_ms", "longest_navy_task_ms", "first_draw_navy_task_ms", "thumbs_gap_ms", "scenario_task_ms"];
const ciFactor = (() => { if (!process.env.GITHUB_ACTIONS) return 1; try { return Math.max(1, JSON.parse(fs.readFileSync(path.join(REPO, "bench-calibration.json"), "utf8")).factor || 1); } catch { return 1; } })();
/* On CI only, the big30 read's time limit is scaled by the larger of the JS factor and the engine factor above (both
   ≤ MAX_FACTOR, so a doubling is still caught) – v4/big30-gauge, 2026-10-23. The read failed on CI run after run
   (PR #42: 1126 / 1147 / 1138 ms against 1018; PR #43: 1139 / 1258 / 1270 against 1143, 1174 / 1184 against 1044) and
   was taken for a slow regression of 4.8–4.13. It is not one. The bench logs of 110 CI runs (2026-10-18 → 10-23,
   4.2 → 4.13.1), grouped by the runner's speed, read the same on each kind of runner across the span (first-pass
   median, 4.5–4.6 → 4.13: fast runners 650–750 ms, slow ones 1170–1190), and the read divided by the core's big30
   parse on the same runner (core/bench/parse.bench.test.ts) stays 2.16–2.19 in every period from 4.5 to 4.13
   (nothing grew around the reader in the page); interleaved runs of the 4.3 → 4.13.1 pages on one machine show no
   trend either. The calibration is what is off: tools/calibrate.mjs times a 12 MB in-cache JS loop, and GitHub's
   slower runners are slower than that on a 30 MB inflate + 75 MB scan in Chromium's worker – as on the engine's WASM
   (decision 2026-10-18). The failing runs were all on runners the JS loop rates 1.00–1.10× (engine 1.24–1.29×) that
   read like the slow ones (1065–1184 ms). With the JS factor alone a run's worse read sat at a median 1.02× its limit
   on the slow runners (0.71× on the fast ones, where both factors are 1); 14 of 110 runs were over + 10 %. With
   max(JS, engine) the median is 0.71–0.77× on every kind of runner and the largest 0.97× (the runners above:
   0.86–0.93×). Off CI ciFactor is 1 and nothing changes; the budget stays 1 s. */
const BIG30_CI = ["read_big30_ms"];
const timeFactor = k => BIG30_CI.includes(k) ? Math.max(speed.factor, ciFactor) : speed.factor;
const LIMITS = Object.fromEntries(Object.entries(BUDGET).map(([k, v]) => [k, TIMED.includes(k) ? Math.round(v * timeFactor(k)) : UNTIMED_CI.includes(k) ? Math.round(v * ciFactor) : v]));
const CHROME = process.env.CHROME || chromium.executablePath();
const PY = process.platform === "win32" ? "python" : "python3";
const BOOKS = path.join(REPO, "tests/corpus/workbooks");
for (const f of ["deck20.xlsx", "big30.xlsx"]) if (!fs.existsSync(path.join(BOOKS, f))) { console.error(`${f} is missing (python tools/make_corpus.py big30 tests/corpus/workbooks)`); process.exit(2); }
/** the scenario deck (S8.3): Control!B4 is the week, 20 slide sheets follow it (tests/corpus/workbooks/recalc) */
const BANKSBIG = path.join(BOOKS, "recalc", "BanksBig.xlsx");

/** S14.6 (09 §7.4 pptx_combo_ms): deck20 in Liquid Glass with a combo chart on each of slides 2–7 (its table's banks:
    Week37 and Week38 as columns, Δ vs. Budget as a line on a second axis, an arrow mark onto the line's last point) –
    one change, as the page makes it –, exported as PowerPoint (click → file, the page's clock); then the deck as it was
    (the change undone). `exportOnce` is run()'s */
async function comboPptx(page, exportOnce) {
  await page.click('[data-design="glass"]'); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
  const h0 = await page.evaluate(() => window.__sbTest.history().undo);
  const n = await page.evaluate(() => {
    const t = window.__sbTest, P = t.preset(), ops = [];
    for (const s of P.slides.slice(1, 7)) {
      const tid = (s.tables || [])[0], sheet = (P.tables || []).find(x => x.id === tid)?.sheet;
      if (!sheet) continue;
      const ref = c => [{ sheet, range: `${c}10:${c}17` }];
      ops.push({ op: "item.patch", slide: s.id, id: "benchcombo", patch: { kind: "chart", type: "combo", title: "Loans – combo", values: ref("D")[0], labels: { sheet, range: "C10:C17" },
        box: { x: 900, y: 220, w: 640, h: 420 }, legendAt: "bottom",
        sers: { a: { n: 1, type: "column", vals: ref("D") }, b: { n: 2, type: "column", vals: ref("E") }, c: { n: 3, type: "line", axis: "y2", vals: ref("H"), marker: { shape: "circle" }, labels: { show: ["value"] } } },
        marks: { m1: { kind: "arrow", a: { s: "c", i: 7 }, b: "floor" } } } });
    }
    t.change("Bench: 6 combo charts", ops);
    return ops.length;
  });
  await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60000 });
  // (S14.6 review 4) cold: exported at once after the change, before its save – the export waits for the save it
  // follows: reported as combo_cold_ms, not gated. In this run deck20 is already format 5 here (the free-layout drags
  // before it, slide.patch `free`, raised it), so this does not include the format guard's one-time wait (ADR-019,
  // ~23 s): a fresh deck's first chart exported at once waits ~25 s (PROGRESS M14, an open exception for the owner)
  const cold = await exportOnce(true);
  // warm (gated, pptx_combo_ms): the same deck again, the save done – the export's own time
  await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 90000 });
  const x = await exportOnce(true);
  const steps = await page.evaluate(h => window.__sbTest.history().undo - h, h0);
  await page.locator("#stage .stagewrap").click({ position: { x: 4, y: 4 } });
  for (let k = 0; k < steps; k++) { await page.keyboard.press("Control+z"); await sleep(200); }
  await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
  return { charts: n, ms: x.ms, kb: x.kb, phases: x.phases, cold_ms: cold.ms, cold_phases: cold.phases };
}
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
  fs.copyFileSync(BANKSBIG, path.join(root, "BanksBig.xlsx"));
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
      // stageIdle() alone raced (seen once, 2026-10-20): it reads the stage's state, and the cell's box was then taken in a
      // later round trip, from a document that could still hold the previous slide's tables (no box). Wait until the
      // second slide is current and shown (stageIdle, the stage's slide 1, its thumbnail on) and the cells in the
      // document are that slide's own (the labels of its table layers' markup, as drawn), and take the cell's box in
      // the same check – nothing can redraw between the two
      const cell = await (await page.waitForFunction(() => {
        const T = window.__sbTest, s = T.stage();
        if (!T.stageIdle() || !s || s.slide !== 1 || !document.querySelector('.thumb.on[data-i="1"]')) return null;
        // the labels (<desc>) its table layers' markup holds (core/dl/svg.ts escapes & < > only), and those in the document
        const want = s.layers.filter(l => l.table !== null).flatMap(l => [...l.svg.join("").matchAll(/<desc>([^<]*)<\/desc>/g)]
          .map(m => m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))).join("\n");
        const sl = document.querySelector("#stage .slide");
        if (!sl || want !== [...sl.querySelectorAll(":scope > .tw desc")].map(d => d.textContent).join("\n")) return null;
        const c = sl.querySelectorAll(":scope > .tw .t")[8], r = c && c.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      }, null, { timeout: 30000 }).catch(e => {
        // say what never came (the check is null on every poll when the second slide has fewer than 9 cells)
        throw new Error("keypress: slide 2's table never showed a 9th cell (" + e.message + ")");
      })).jsonValue();
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
    const drags = await dragFrames(browser, page, true);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 });
    await longTasks();                                                                       // (the drops' redraws: in drags)
    // ---- export deck20 (S3.7): Liquid Glass (the default design), then Excel
    const exportOnce = async (pptx = false) => {
      await page.evaluate(() => { window.__sbTest.lastExport.files = []; });
      if (pptx) { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); }
      else await page.click("#exportBtn");
      await page.waitForFunction(() => window.__sbTest.lastExport.files.length > 0 && !window.__sbTest.exporting(), null, { timeout: 120000 });
      const { files, ms, phases } = await page.evaluate(() => ({ files: [...window.__sbTest.lastExport.files], ms: window.__sbTest.lastExport.ms, phases: window.__sbTest.exportPhases() }));
      return { ms: Math.round(ms), phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Math.round(v)])), kb: Math.round(fs.statSync(path.join(h.root, "export", files[0])).size / 102.4) / 10 };
    };
    const glass = await exportOnce();                                                        // cold: starts the export workers
    // the PowerPoint file (S11.3), when the build has it: after the PDF, from the same workers
    const hasPptx = await page.evaluate(async () => { const b = document.querySelector("#exportMenuBtn"); b.click(); await new Promise(r => setTimeout(r, 50)); const has = !!document.querySelector('[data-x="pptx"]'); b.click(); return has; });
    const glassPptx = hasPptx ? await exportOnce(true) : null;
    const ltGlass = (await longTasks()).map(x => x.d);
    await page.click('[data-design="excel"]'); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300);
    await longTasks();                                                                       // switching the design: not the export's
    const excel = await exportOnce();
    const excelPptx = hasPptx ? await exportOnce(true) : null;
    const ltExport = [...ltGlass, ...(await longTasks()).map(x => x.d)];
    const combo = hasPptx ? await comboPptx(page, exportOnce) : null;                 // S14.6: deck20 with 6 combo charts
    await longTasks();
    await page.click('[data-design="glass"]'); await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300); await longTasks();
    const thumbs = await thumbScroll(browser, page);
    await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(300);
    const ltThumbs = (await longTasks()).map(x => x.d);
    // ---- the icon picker (S15.2, 09 §7.4), when the build has it: Shapes & icons… (4.12; before it Insert shape ▾ ›
    // More icons…) on deck20's second slide.
    // The set's first use in the core worker, cold (inflate + index: the worker's own time for the first answer, the
    // grid's data-ms), then 2 untimed and 20 timed keystrokes – from the key to the first frame after the grid shows that
    // query's hits (its data-q) – p95; closed without inserting anything
    let icons = null;
    if (/moreIcons|iconShapes/.test(await page.content())) {
      await page.locator(".thumb").nth(1).click(); await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60000 });
      await page.click("#shapeBtn");
      // (a build before 4.12: its dropdown's More icons… first)
      await page.locator("#moreIcons, #iconPicker").first().waitFor({ timeout: 10000 });
      if (await page.locator("#moreIcons").count()) await page.click("#moreIcons");
      await page.locator('#iconGrid[data-first="1"]').waitFor({ timeout: 60000 });
      // a cold first use only if nothing inflated the set before (a Tabler icon on deck20 would): else not measured
      const { firstUse, coldSet } = await page.evaluate(() => { const g = document.querySelector("#iconGrid").dataset; return { firstUse: +g.ms, coldSet: g.cold === "1" }; });
      if (!coldSet) console.log("bench · icon picker: the set was inflated before the picker's first search – icon_first_use_ms is not a cold first use (counted as not measured)");
      await page.evaluate(() => {
        window.__ic = { t0: null, done: null, want: null };
        addEventListener("keydown", () => { if (window.__ic.want !== null && window.__ic.t0 === null) window.__ic.t0 = performance.now(); }, true);
        const g = document.querySelector("#iconGrid");
        new MutationObserver(() => { const k = window.__ic; if (k.t0 === null || k.done !== null || g.dataset.q !== k.want) return; requestAnimationFrame(() => { if (k.done === null) k.done = performance.now(); }); })
          .observe(g, { attributes: true, subtree: true, childList: true });
      });
      const keyMs = [];
      // (each key after the previous one's hits are drawn; "|" starts a new query: the field emptied first, untimed)
      for (const word of ["building bank", "|arrow up", "|chart pie"]) {
        if (word.startsWith("|")) { await page.evaluate(() => { window.__ic = { t0: null, done: null, want: null }; }); await page.fill("#iconSearch", ""); await page.locator('#iconGrid[data-q=""]').waitFor({ timeout: 10000 }); }
        const w = word.replace(/^\|/, "");
        for (let k = 1; k <= w.length; k++) {
          await page.evaluate(q => { window.__ic = { t0: null, done: null, want: q }; }, w.slice(0, k));
          await page.keyboard.press(w[k - 1] === " " ? "Space" : w[k - 1]);
          await page.waitForFunction(() => window.__ic.done !== null, null, { timeout: 10000 });
          keyMs.push(await page.evaluate(() => window.__ic.done - window.__ic.t0));
        }
      }
      await page.evaluate(() => { window.__ic = { t0: null, done: null, want: null }; });
      await page.keyboard.press("Escape"); await page.locator("#iconPicker").waitFor({ state: "detached" });
      const cold = keyMs.splice(0, 2), sorted = keyMs.slice(0, 20).sort((a, b) => a - b);
      icons = { first_use_ms: coldSet ? Math.round(firstUse * 10) / 10 : Infinity, cold_set: coldSet, cold_ms: cold.map(Math.round), p50_ms: Math.round(sorted[Math.floor(sorted.length * .5)]), p95_ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), max_ms: Math.round(sorted[sorted.length - 1]), longtasks: (await longTasks()).map(x => x.d) };
    }
    // ---- snapping (S15.4, 09 §7.4), when the build has it (stage/guides.tsx): a drag with snapping on among 60 objects
    let snap = null;
    if ((await page.content()).includes("snapgap")) { snap = await snapFrames(browser, page); await longTasks(); }
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
    // ---- Run for each value (S8.3, SC-08 / SC-09; a build without it – --page of an older one – skips this): BanksBig as a
    // new deck (the wizard's defaults: its 20 slide sheets), then one value and 20 values (weeks) in Liquid Glass, timed by
    // the page from the click on Run to the run's end; the long tasks of the runs gated at 50 ms
    let scen = null, previewSwitch = null;
    {
      // (the page is one file: its script names the run's panel when this build has it)
      if ((await page.content()).includes("scRunDialog")) {
        // ---- a preview's switch (S8.4) on deck20, still open: a cell of its slide is the input; the first preview starts
        // the engine (its first use, gated apart), the second is timed from the click until the stage shows the value
        { const b = (await page.locator("#stage .slide .t").filter({ hasText: /^[0-9][0-9.,]*$/ }).first().boundingBox()); await page.mouse.click(b.x + 6, b.y + b.height / 2); }   // (as a person clicks: the hit layer takes it)
        await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]'); await page.click("#scPick");
        await page.fill("#scValues", "Bench one\nBench two"); await page.locator("#scInputNote", { hasText: "today" }).waitFor({ timeout: 60000 });
        await page.selectOption("#scValue", "Bench one"); await page.click("#scPreview");
        await page.locator("#scBanner", { hasText: "Bench one" }).waitFor({ timeout: 60000 });
        await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60000 }); await sleep(500); await longTasks();
        await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]'); await page.selectOption("#scValue", "Bench two");
        await watch(["#stage .slide .t", "Bench two"]); await page.click("#scPreview");
        const previewMs = await took(page.locator("#stage .slide .t", { hasText: "Bench two" }).first());
        const ltPreview = (await longTasks()).map(x => x.d);
        await page.click("#scClear"); await page.locator("#scBanner").waitFor({ state: "detached" });
        await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60000 }); await sleep(500); await longTasks();
        previewSwitch = { ms: Math.round(previewMs), longtasks: ltPreview };
        await page.click("#openBtn"); await page.locator('[data-f="BanksBig.xlsx"]').waitFor(); await page.click('[data-f="BanksBig.xlsx"]');
        await page.locator(".wiz .sheetrow").first().waitFor({ timeout: 60000 });          // the sheets read (as deck20's open)
        // its slide sheets have no closing "x": one table per sheet, typed as a range on each sheet's tab
        await page.click('[data-a="next"]');
        const tabs = page.locator(".wtab"); await tabs.first().waitFor();
        for (let i = 0, n = await tabs.count(); i < n; i++) { await tabs.nth(i).click(); await page.fill("#wRange", "C3:K14"); await page.click("#wAdd"); }
        await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
        await page.waitForFunction(() => document.querySelectorAll(".thumb").length >= 20 && window.__sbTest.stageIdle(), null, { timeout: 120000 });
        await page.locator("#sbSave").filter({ hasText: "✓ Saved" }).waitFor({ timeout: 20000 }); await sleep(2000); await longTasks();
        const runOnce = async values => {
          const modal = await page.evaluate(() => document.querySelector(".modal")?.textContent || null);
          if (modal) throw new Error("a dialog is open before the run: " + modal.slice(0, 300));
          await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
          await page.fill("#scInput", "Control!B4"); await page.locator("#scInputNote", { hasText: "today" }).waitFor({ timeout: 60000 });
          await page.fill("#scValues", values.join("\n"));
          for (const box of await page.locator("#scDesigns input").all()) await box.setChecked((await box.getAttribute("data-design")) === "glass");
          await page.evaluate(() => { window.__sbTest.lastExport.files = []; });
          await page.click("#scRun");
          await page.locator("#scRunClose").waitFor({ timeout: 600000 });
          const { files, ms } = await page.evaluate(() => ({ files: window.__sbTest.lastExport.files.length, ms: window.__sbTest.lastExport.ms }));
          const status = await page.locator("#scRunStatus").textContent();
          if (files !== values.length) throw new Error(`the run made ${files} of ${values.length} files: ${status}`);
          // each file is the whole deck: its page tree counts the 20 slides
          const first = await page.evaluate(() => window.__sbTest.lastExport.files[0]);
          const count = /\/Type\/Pages\/Kids\[[^\]]*\]\/Count (\d+)/.exec(fs.readFileSync(path.join(h.root, "export", first), "latin1"));
          if (!count || +count[1] !== 20) throw new Error(`${first} has ${count ? count[1] : "no"} pages, not 20`);
          await page.click("#scRunClose");
          return Math.round(ms);
        };
        await longTasks();
        const one = await runOnce([30]), ltOne = (await longTasks()).map(x => x.d);
        const twenty = await runOnce(Array.from({ length: 20 }, (_, i) => 20 + i)), ltTwenty = (await longTasks()).map(x => x.d);
        scen = { one_ms: one, twenty_ms: twenty, longtasks: [...ltOne, ...ltTwenty, ...previewSwitch.longtasks], phases: { one: ltOne, twenty: ltTwenty, preview: previewSwitch.longtasks }, preview_ms: previewSwitch.ms };
      }
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
      consult, scen, icons, snap,
      export: { glass_ms: glass.ms, glass_kb: glass.kb, glass_phases: glass.phases, excel_ms: excel.ms, excel_kb: excel.kb, excel_phases: excel.phases, longtasks: ltExport,
        pptx: glassPptx && excelPptx ? { glass_ms: glassPptx.ms, glass_kb: glassPptx.kb, glass_phases: glassPptx.phases, excel_ms: excelPptx.ms, excel_kb: excelPptx.kb, excel_phases: excelPptx.phases, ...(combo ? { combo } : {}) } : null },
      big30: { index_to_wizard_ms: Math.round(index), read_sheet_ms: Math.round(read), read_to_grid_ms: Math.round(grid), longtasks: ltBig, heap_mb: heap,
        page_heap_mb: pageHeap == null ? null : Math.round(pageHeap), worker_heap_mb: workerHeap == null ? null : Math.round(workerHeap),
        export_workers: workers ? workers.exportWorkers : null, export_heap_mb: workers ? Math.round(workers.export) : null } };
  } finally { await page.close(); h.stop(); }
}

/** the drags of S4.2 on the slide shown, traced: per drag the most work the page's main thread did between two animation
    frames while the pointer moved (Part F: 16 ms), and the longest task after the drop (the slide drawn again) */
async function dragFrames(browser, page, withFree = false) {
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
    // S10.2: the same slide in a free layout (a build without it – --page of an older one – skips this), then automatic again
    if (withFree && await page.locator("#freeLayout").count()) {
      const idle = async () => { await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 20000 }); await page.waitForTimeout(300); };
      await idle(); await page.click("#freeLayout"); await idle();
      await page.locator("#stage .stagewrap").hover();
      await drag("free move", await at('#stage .hbox[data-i="1"] .grip'), -60, 40);
      await drag("free corner", await at('#stage .hbox[data-i="0"] .size'), -60, -30);
      const fe = await at('#stage .hbox[data-i="0"] .edge.r');
      await drag("free edge", { x: fe.x, y: fe.b.y + fe.b.height / 4 }, 50, 0);
      await drag("free notes section", await at("#stage .tnote.memo"), -40, -30);
      // a table's text box (its body, then its right edge) and a callout (its body, then its right edge)
      await page.locator('#stage .hbox[data-i="0"] .addnote.bottom').click();
      await page.locator("textarea.note-edit").fill("Source: monthly figures"); await page.keyboard.press("Control+Enter");
      await page.locator("#stage .tnote", { hasText: "Source: monthly figures" }).waitFor(); await idle();
      await drag("free text box move", await at('#stage .tnote:has-text("Source: monthly figures")'), 40, 20);
      const tb = await at('#stage .tnote:has-text("Source: monthly figures")');
      await drag("free text box edge", { x: tb.b.x + tb.b.width - 2, y: tb.y }, 60, 0);
      // the callout put in as the ribbon's pill is (one item.patch, the same item), not through the ribbon: since 4.12 the
      // ribbon's Shapes & icons… is the icon window, whose first search would inflate the icon set before the picker's
      // own measurement below (icon_first_use_ms is the first use, cold)
      await page.evaluate(() => { const T = window.__sbTest, R = T.stage();
        T.change("Insert shape", [{ op: "item.patch", slide: R.id, id: "ibench", patch: { kind: "shape", shape: "pill", box: { x: 640, y: 390, w: 320, h: 120 } } }]); });
      await page.locator(".itembox[data-kind=shape]").waitFor(); await idle();
      await drag("free callout move", await at(".itembox[data-kind=shape]"), -50, -30);
      const cb = await at(".itembox[data-kind=shape]");
      await drag("free callout edge", { x: cb.b.x + cb.b.width - 2, y: cb.y }, 50, 0);
      // both removed again (the exports after this measure deck20 as it was)
      await idle(); await page.locator(".itembox[data-kind=shape]").click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Delete");
      await page.locator(".itembox[data-kind=shape]").waitFor({ state: "detached" });
      await page.locator("#stage .tnote", { hasText: "Source: monthly figures" }).click(); await page.click("#noteDelete");
      await page.locator("#stage .tnote", { hasText: "Source: monthly figures" }).waitFor({ state: "detached" });
      await idle(); await page.click("#freeLayout"); await idle();
    }
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

/** S15.4 (09 §7.4 snap_drag_frame_ms): deck20's second slide with 56 shapes added in one change (60 objects with its
    tables and text boxes: rows and columns of boxes, so equal gaps and every kind of guide come up), one of them dragged
    across the others with snapping on, then resized by its corner handle `.size` (equal sizes; the handle is drawn
    while the item is selected – a click selects it when the move left it unselected), traced as the drags of S4.2 –
    the most work between two frames; then the deck as it was (undo) */
async function snapFrames(browser, page) {
  const idle = async () => { await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 30000 }); await page.waitForTimeout(300); };
  await page.locator(".thumb").nth(1).click(); await idle();
  const h0 = await page.evaluate(() => window.__sbTest.history().undo);
  await page.evaluate(() => {
    const t = window.__sbTest, id = t.stage().id, ops = [];
    for (let i = 0; i < 56; i++) ops.push({ op: "item.patch", slide: id, id: "snapbench" + i, patch: { kind: "shape", shape: "rect", box: { x: 40 + (i % 14) * 110, y: 60 + Math.floor(i / 14) * 200, w: 70 + (i % 3) * 6, h: 50 + (i % 4) * 8 } } });
    t.change("Bench: 56 shapes", ops);
  });
  await page.locator('.itembox[data-item="snapbench55"]').waitFor({ timeout: 30000 }); await idle();
  await page.locator("#stage .stagewrap").hover();
  const trace = path.join(os.tmpdir(), "sb-bench-snap-" + process.pid + ".json"), out = {}, sleep2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const drag = async (name, from, dx, dy) => {
    await page.mouse.move(from.x, from.y); await sleep2();
    await page.evaluate(n => { window.__drag = { name: n, frames: [] }; const tick = t => { if (!window.__drag) return; window.__drag.frames.push(t); requestAnimationFrame(tick); }; requestAnimationFrame(tick); performance.mark("snap:" + n); }, name);
    await page.mouse.down();
    for (let k = 1; k <= 24; k++) await page.mouse.move(from.x + dx * k / 24, from.y + dy * k / 24);
    await page.evaluate(n => { performance.mark("up:" + n); window.__dragUp = performance.now(); }, name);
    await page.mouse.up();
    await page.waitForTimeout(700);
    out[name] = await page.evaluate(() => { const d = window.__drag; window.__drag = null; return { frames: d.frames, up: window.__dragUp }; });
  };
  await browser.startTracing(page, { path: trace, categories: ["devtools.timeline", "blink.user_timing", "toplevel"] });
  try {
    const b = await page.locator('.itembox[data-item="snapbench15"]').boundingBox();
    await drag("move", { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 420, 230);
    await idle();
    const size = page.locator('.itembox[data-item="snapbench15"] .size');
    if (!(await size.count())) { await page.locator('.itembox[data-item="snapbench15"]').click({ position: { x: 4, y: 4 } }); await idle(); }
    await size.waitFor({ timeout: 10000 });
    const c = await size.boundingBox();
    await drag("corner", { x: c.x + c.width / 2, y: c.y + c.height / 2 }, 90, 40);
  } finally { await browser.stopTracing(); }
  const { tasks, frames } = traced(trace, "snap"), res = {};
  for (const [name, d] of Object.entries(out)) { const w = frames(name, d); if (!w) continue; res[name] = { frames: w.frames, frame_ms: w.frame_ms, gap_ms: w.gap_ms, drop_task_ms: Math.round(tasks.filter(e => e.ts >= w.end && e.ts <= w.end + 700000).reduce((x, e) => Math.max(x, e.dur / 1000), 0)) }; }
  // back as it was: the drags and the shapes (the undo steps they made)
  await idle(); await page.locator("#stage .stagewrap").click({ position: { x: 4, y: 4 } });
  const steps = await page.evaluate(h => window.__sbTest.history().undo - h, h0);
  for (let k = 0; k < steps; k++) { await page.keyboard.press("Control+z"); await page.waitForTimeout(200); }
  await page.locator('.itembox[data-item="snapbench0"]').waitFor({ state: "detached", timeout: 30000 }); await idle();
  return { objects: 60, drags: res, frame_ms: Math.max(0, ...Object.values(res).map(d => d.frame_ms)), measured: Object.keys(res).length === 2 };
}

/** the gated values of some runs: the worse run counts */
const worstOf = runs => ({
  open_deck20_ms: Math.max(...runs.map(r => r.deck20.open_ms)),
  read_big30_ms: Math.max(...runs.map(r => r.big30.read_sheet_ms)),
  longest_task_ms: Math.max(0, ...runs.flatMap(r => [...r.deck20.longtasks, ...r.edit.longtasks, ...r.thumbs.longtasks, ...r.export.longtasks, ...r.big30.longtasks, ...(r.icons?.longtasks ?? [])])),
  keypress_p95_ms: Math.max(...runs.map(r => r.edit.keypress.p95_ms)),
  drag_frame_ms: Math.max(...runs.flatMap(r => Object.entries(r.drags).filter(([k]) => !k.startsWith("free ")).map(([, d]) => d.frame_ms))),
  // the free layout's drags (S10.2): this build's page must measure them (not measured counts as over the limit)
  ...(runs.every(r => Object.keys(r.drags).some(k => k.startsWith("free "))) ? { free_drag_frame_ms: Math.max(...runs.flatMap(r => Object.entries(r.drags).filter(([k]) => k.startsWith("free ")).map(([, d]) => d.frame_ms))) }
    : arg("--page") ? {} : { free_drag_frame_ms: Infinity }),
  thumbs_gap_ms: Math.max(...runs.map(r => r.thumbs.gap_ms)),
  first_draw_task_ms: Math.max(0, ...runs.flatMap(r => r.deck20.first_draw_longtasks)),
  // no performance.memory or no worker heap (another browser): not measured counts as over the limit, never as 0
  heap_mb: runs.some(r => r.big30.heap_mb == null) ? Infinity : Math.max(...runs.map(r => r.big30.heap_mb)),
  export_glass_ms: Math.max(...runs.map(r => r.export.glass_ms)), export_excel_ms: Math.max(...runs.map(r => r.export.excel_ms)),
  export_glass_kb: Math.max(...runs.map(r => r.export.glass_kb)), export_excel_kb: Math.max(...runs.map(r => r.export.excel_kb)),
  // the PowerPoint file (S11.3): an older build (--page) has none and is not gated on it; this build must measure it
  ...(runs.every(r => r.export.pptx) ? { pptx_glass_ms: Math.max(...runs.map(r => r.export.pptx.glass_ms)), pptx_excel_ms: Math.max(...runs.map(r => r.export.pptx.excel_ms)),
    pptx_glass_kb: Math.max(...runs.map(r => r.export.pptx.glass_kb)), pptx_excel_kb: Math.max(...runs.map(r => r.export.pptx.excel_kb)) }
    : arg("--page") ? {} : Object.fromEntries(["pptx_glass_ms", "pptx_excel_ms", "pptx_glass_kb", "pptx_excel_kb"].map(k => [k, Infinity]))),
  // deck20 with 6 combo charts as PowerPoint (S14.6): this build's page must measure it (not measured counts as over the limit)
  ...(runs.every(r => r.export.pptx?.combo?.charts === 6) ? { pptx_combo_ms: Math.max(...runs.map(r => r.export.pptx.combo.ms)) } : arg("--page") ? {} : { pptx_combo_ms: Infinity }),
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
  // the icon picker (S15.2): this build's page must measure it (not measured counts as over the limit)
  ...(runs.every(r => r.icons) ? { icon_first_use_ms: Math.max(...runs.map(r => r.icons.first_use_ms)), icon_picker_p95_ms: Math.max(...runs.map(r => r.icons.p95_ms)) }
    : arg("--page") ? {} : { icon_first_use_ms: Infinity, icon_picker_p95_ms: Infinity }),
  // snapping (S15.4): this build's page must measure it (not measured counts as over the limit)
  ...(runs.every(r => r.snap?.measured) ? { snap_drag_frame_ms: Math.max(...runs.map(r => r.snap.frame_ms)) } : arg("--page") ? {} : { snap_drag_frame_ms: Infinity }),
  // Run for each value (S8.3): this build's page must measure it (not measured counts as over the limit)
  ...(runs.every(r => r.scen) ? {
    scenario_one_ms: Math.max(...runs.map(r => r.scen.one_ms)), scenario_20_ms: Math.max(...runs.map(r => r.scen.twenty_ms)),
    scenario_task_ms: Math.max(0, ...runs.flatMap(r => r.scen.longtasks)), preview_switch_ms: Math.max(...runs.map(r => r.scen.preview_ms)) }
    : arg("--page") ? {} : { scenario_one_ms: Infinity, scenario_20_ms: Infinity, scenario_task_ms: Infinity, preview_switch_ms: Infinity }),
});

const browser = await chromium.launch({ executablePath: CHROME });
const runs = [];
try { for (let i = 0; i < 2; i++) runs.push(await run(browser, 8981 + i)); }
finally { await browser.close(); }
const worst = worstOf(runs);
const info = { longest_startup_task_ms: Math.max(0, ...runs.flatMap(r => r.boot.longtasks)), thumbs_frame_ms: Math.max(...runs.map(r => r.thumbs.frame_ms)),
  // S14.6 review 4: the combo export right after the change, before its save (not gated)
  ...(runs.every(r => r.export.pptx?.combo) ? { combo_cold_ms: Math.max(...runs.map(r => r.export.pptx.combo.cold_ms)) } : {}) };
// on CI (decision 2026-10-20): the timing gates over their limit are measured again – every scenario run once more in a
// fresh browser, helper and page (they build on each other's state), only those gates judged on it – and fail only if
// the repeat is over too
let repeat = null;
const { gates, bad } = await judge({ limits: LIMITS, first: worst, ci: GATE && onCI(), again: async keys => {
  console.log(`bench · over the limit in the first pass: ${keys.join(", ")} – measured again in a fresh page (CI)`);
  // a repeat that fails (the helper or Chromium) measured nothing: those gates fail, the report and the JSON still come
  try {
    const b = await chromium.launch({ executablePath: CHROME });
    try { const r = await run(b, 8983), w = worstOf([r]); repeat = { keys, values: Object.fromEntries(keys.map(k => [k, w[k]])), run: r }; }
    finally { await b.close(); }
  } catch (e) { console.error("bench · the repeat failed: " + (e?.stack || e)); repeat = { keys, values: {}, error: String(e?.message || e) }; }
  return repeat.values;
} });
const out = { page: path.relative(REPO, BACKEND) || BACKEND, chrome: CHROME, machine: `${os.cpus().length} × ${os.cpus()[0].model.trim()}, ${process.platform}`, calibration: { ms: +speed.ms.toFixed(1), factor: +speed.factor.toFixed(2), ci_factor: +ciFactor.toFixed(2) }, budget: BUDGET, limits: LIMITS, worst, info, runs, gates, repeat };
if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
const all = [...runs.map((r, i) => ["run " + (i + 1), r]), ...(repeat?.run ? [["repeat", repeat.run]] : [])];
for (const [i, r] of all) console.log(`bench · ${i}: deck20 open ${r.deck20.open_ms} ms (wizard ${r.deck20.wizard_ms} + slides ${r.deck20.finish_to_slide_ms}) · keypress → pixels (cold ${r.edit.keypress.cold_ms.join(" / ")}) p50 ${r.edit.keypress.p50_ms} / p95 ${r.edit.keypress.p95_ms} / max ${r.edit.keypress.max_ms} ms (tasks ${JSON.stringify(r.edit.longtasks)}) · thumbnails, 100 slides scrolled: ${r.thumbs.fps} fps, ${r.thumbs.frame_ms} ms/frame (longest gap ${r.thumbs.gap_ms} ms, ${r.thumbs.pictures} pictures, tasks ${JSON.stringify(r.thumbs.longtasks)}) · drags ${Object.entries(r.drags).map(([k, d]) => `${k} ${d.frame_ms} ms/frame (${d.frames} frames, longest gap ${d.gap_ms} ms, drop ${d.drop_task_ms} ms)`).join(", ")} · export deck20 Liquid Glass ${r.export.glass_ms} ms ${JSON.stringify(r.export.glass_phases)} ${r.export.glass_kb} KB, Excel ${r.export.excel_ms} ms ${JSON.stringify(r.export.excel_phases)} ${r.export.excel_kb} KB (tasks ${JSON.stringify(r.export.longtasks)}) · big30 index ${r.big30.index_to_wizard_ms} ms, sheet read ${r.big30.read_sheet_ms} ms (grid ${r.big30.read_to_grid_ms} ms) · long tasks ${JSON.stringify([...r.deck20.longtasks, ...r.big30.longtasks])} (first draw ${JSON.stringify(r.deck20.first_draw_longtasks)}) · heap ${r.big30.heap_mb} MB (page ${r.big30.page_heap_mb} + worker ${r.big30.worker_heap_mb}; ${r.big30.export_workers} export workers ${r.big30.export_heap_mb} MB, not gated) · start-up tasks ${JSON.stringify(r.boot.longtasks)}`);
console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limits × ${speed.factor.toFixed(2)}${ciFactor > 1 ? `; CI: task and gap limits × ${ciFactor.toFixed(2)} (engine calibration), big30 read × ${timeFactor("read_big30_ms").toFixed(2)}` : ""}`);
for (const [i, r] of all) if (r.consult) console.log(`bench · ${i}: Consulting Navy long tasks by phase ${JSON.stringify(r.consult.phases)}`);
for (const [i, r] of all) if (r.icons) console.log(`bench · ${i}: icon picker: the set's first use in the worker ${r.icons.first_use_ms} ms; keystroke → hits drawn (cold ${r.icons.cold_ms.join(" / ")}) p50 ${r.icons.p50_ms} / p95 ${r.icons.p95_ms} / max ${r.icons.max_ms} ms (tasks ${JSON.stringify(r.icons.longtasks)})`);
for (const [i, r] of all) if (r.scen) console.log(`bench · ${i}: Run for each value on BanksBig (20 slides, Liquid Glass): 1 value ${r.scen.one_ms} ms, 20 values ${r.scen.twenty_ms} ms; preview switch on deck20 ${r.scen.preview_ms} ms; long tasks ${JSON.stringify(r.scen.phases)}`);
for (const g of gates) console.log(`bench · ${g.key}: ${describe(g, SLACK)}`);
console.log(`bench · not gated: longest start-up task ${info.longest_startup_task_ms} ms; most page work in a frame of the thumbnail scroll ${info.thumbs_frame_ms} ms (a garbage collection can fall into one)${info.combo_cold_ms != null ? `; 6 combo charts exported at once after adding them, before the save (deck20 already format 5) ${info.combo_cold_ms} ms` : ""}`);
for (const [i, r] of all) if (r.export.pptx?.combo) console.log(`bench · ${i}: 6 combo charts as PowerPoint: warm ${r.export.pptx.combo.ms} ms ${JSON.stringify(r.export.pptx.combo.phases)} ${r.export.pptx.combo.kb} KB · cold ${r.export.pptx.combo.cold_ms} ms ${JSON.stringify(r.export.pptx.combo.cold_phases)}`);
// on GitHub Actions each gate over its limit is also an annotation of the run (readable without the log's admin rights)
if (process.env.GITHUB_ACTIONS) for (const g of gates) if (!g.pass) console.log(annotation("bench " + g.key, g));
if (GATE && bad.length) { console.error("bench: over the limit: " + bad.join(", ")); process.exit(1); }
