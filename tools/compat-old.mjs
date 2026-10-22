#!/usr/bin/env node
/* CP-01 / CP-02 (M13, ADR-019): the per-deck format guard against the REAL older versions.

   For each old version (git worktrees of v4.0.0, 4.1 = 061a5b3, 4.4 = a1d3aba, 4.5 = 637f7b4: their own helper and
   their own committed page) and this checkout's 4.6 helper + page, sharing one workbook folder and one data folder
   (two users, as two PCs on the share):
     CP-02  a deck with no 4.6 object stays format 4: the old page opens it, edits a cell, compacts it;
            style.designs.*.consult survives
     a      an old page opens a format-5 deck holding every 4.6 object -> refused / read-only; the deck's files
            (snapshot sha256 first) unchanged
     b      an old page has the deck open before the bump (format 4); the 4.6 page adds every 4.6 object (slide.add,
            table.add, hide, items, free, looks, cellGrid / borders) and so raises it; the old page edits a cell and
            runs the wizard's Finish (a whole preset.set) in the gap and after the raise, then is left alone past the
            compaction margin -> it ends read-only, none of its records after the marker folds after the 4.6 records,
            no snapshot from it, every 4.6 object still there. Run in journal and in lean-lock storage mode
     c      the old user's helper restarted as 4.6 while the old page stays open -> its calls get 403 (the token);
            the same calls with a valid token but without X-SB-Deck-Formats -> 409; nothing written
     d      the decks' journals aged 25 h (utime); the old helper's clean-up paths (compact -> _drop_dead, rotate, the
            idle-handle loop) -> every journal survives, byte for byte
     m14    (4.7, M14 milestone review 3) the 4.7 page makes every M14 chart object – series (`sers`, with per-point
            colours and labels, targets, the right axis, a combo series, a waterfall's `points[i].total`, scatter `xs`),
            `groups`, `axes`, `marks`, `legendHide`, `titleFmt`, `legendAt`, `stack`, `frame` / `titleRule`, the new types
            (combo, area, scatter, waterfall) – plus one per-entry patch (a series added by its own record); then the
            old page opens the deck (format 5), edits a cell and is left alone past the compaction margin -> every M14
            item is byte-equal (JSON) in the folded deck and in every snapshot written after them; the old page's edit
            kept when it compacted. The 4.6 pages read format 5: 4.6 (e6c1c4f, the M13 merge) does not know the 4.7 keys
            in knownOp, 4.6p (v4.6.0 = 6392856, main with S14.P, + the dated CHANGELOG) knows them and stores a whole series entry – `total` inside a
            series survives only because of that. For 4.0–4.5 (format 5 refused) the case checks the same with the open
            refused. Cases a–d also make the M14 objects (missing46 checks them)
   The old pages are driven through Playwright (open, Continue, a cell typed, ✦ Wizard -> Finish); the 4.6 page's
   objects are made with the page's own change() (window.__sbTest.change: the op path of its buttons). Direct API
   probes are sent from inside the old page with its own headers (X-SB-Token from its meta tag, X-SB-Formats, no
   X-SB-Deck-Formats) - every one is listed in the report.

   No network: the helpers run with SLIDEBUILDER_NO_NET=1 and the browser aborts every request that is not to
   127.0.0.1. Prints one RESULT line per version x case and writes a JSON report.

   node tools/compat-old.mjs [--versions 4.0,4.1,4.4,4.5] [--pythons "python3.12,py38/bin/python"] [--new-python python3]
        [--cases cp02,a,b,c,d] [--modes journal,lean-lock] [--port 8961] [--out compat-old.json]
        [--worktrees <dir>] [--keep-worktrees] [--keep-data] [--bump-wait-s N]
   --pythons: the interpreters for the OLD helpers (each version runs once per interpreter; "py -3.8" works on
   Windows). --bump-wait-s sets SLIDEBUILDER_TEST_BUMP_WAIT_S on the 4.6 helper only (default: unset = the real
   23 s; 0..23 s, honoured only with SLIDEBUILDER_NO_NET=1, which every helper here has); the old helpers never get it. Exit code 1 when a case fails. */
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(k);
const REFS = { "4.0": "v4.0.0", "4.1": "061a5b3", "4.4": "a1d3aba", "4.5": "637f7b4", "4.6": "e6c1c4f", "4.6p": "v4.6.0", "4.7": "v4.7.0" };   // (4.6p: the released 4.6.0 – 6392856, main with S14.P, + the dated CHANGELOG; 4.7: the released 4.7.0, M14)
/** a release tag not yet made in this clone (4.8.0's merge was prepared before the 4.7.0 tag): the commit it will name –
    M14's head d327882, "M14 · 4.7.0: dated, runs recorded" (logged when used) */
const REF_FALLBACK = { "v4.7.0": "d327882" };
/** the versions that read format 5 (4.6.0, M13's format guard): cases a–d expect a refusal, so only cp02 and m14 run */
const READS_V5 = new Set(["4.6", "4.6p", "4.7"]);
const VERSIONS = arg("--versions", "4.0,4.1,4.4,4.5,4.6,4.6p,4.7").split(",").filter(Boolean);
const DEFAULT_PY = process.platform === "win32" ? "python" : "python3";
const PYTHONS = arg("--pythons", DEFAULT_PY).split(",").filter(Boolean);
const NEW_PY = arg("--new-python", DEFAULT_PY);
const CASES = arg("--cases", "cp02,a,b,c,d,m14").split(",").filter(Boolean);
const MODES = arg("--modes", "journal,lean-lock").split(",").filter(Boolean);
const OUT = path.resolve(arg("--out", path.join(os.tmpdir(), "sb-compat-old", "compat-old.json")));
const WT = path.resolve(arg("--worktrees", path.join(os.tmpdir(), "sb-compat-old", "worktrees")));
const BUMP_WAIT = arg("--bump-wait-s", "");
let port = +arg("--port", "8961");
if (port === 8951 || port === 8952) throw new Error("ports 8951/8952 belong to the e2e helpers");
const nextPort = () => { const p = port; port += 3; if (port > 9300) port = +arg("--port", "8961"); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sha = b => createHash("sha256").update(b).digest("hex");
const MARKER5 = "incident-format-5.json";

// ---- the core's fold and guard (bundled from this checkout: the same code the 4.6 page runs)
const { build } = require(require.resolve("esbuild", { paths: [path.join(ROOT, "app")] }));
const coreJs = path.join(os.tmpdir(), "sb-compat-old", "core-" + process.pid + ".mjs");
fs.mkdirSync(path.dirname(coreJs), { recursive: true });
fs.writeFileSync(coreJs, (await build({
  stdin: { contents: `export { fold, recordOrder } from "./core/src/model/fold"; export { needsV5, docNeedsV5 } from "./core/src/model/ops";`, resolveDir: ROOT, loader: "ts" },
  bundle: true, write: false, platform: "node", format: "esm", target: "es2022", logLevel: "error",
})).outputFiles[0].text);
const core = await import(pathToFileURL(coreJs).href);
fs.rmSync(coreJs, { force: true });
const { chromium } = require("playwright");

// ---- worktrees of the old versions (each with its committed page)
const madeTrees = [];
function worktree(v) {
  const dir = path.join(WT, "old-" + v);
  if (fs.existsSync(path.join(dir, "helper", "slide_builder.py"))) return dir;
  fs.mkdirSync(WT, { recursive: true });
  let ref = REFS[v];
  if (REF_FALLBACK[ref] && spawnSync("git", ["rev-parse", "--verify", "--quiet", ref + "^{commit}"], { cwd: ROOT }).status !== 0) {
    log(`(tag ${ref} not in this clone: using ${REF_FALLBACK[ref]})`);
    ref = REF_FALLBACK[ref];
  }
  const r = spawnSync("git", ["worktree", "add", "--detach", dir, ref], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git worktree add " + ref + ": " + r.stderr);
  madeTrees.push(dir);
  return dir;
}
function removeTrees() {
  if (flag("--keep-worktrees")) return;
  for (const d of madeTrees) spawnSync("git", ["worktree", "remove", "--force", d], { cwd: ROOT });
}

// ---- helpers (python, stdlib): one process per user, like one per PC
const helpers = new Set();
async function startHelper({ dir, py, port: p, user, env, extra = {}, samePort = false }) {
  // the helper takes the first free port of p..p+19 (no SO_REUSEADDR: a port whose connections are in TIME_WAIT is
  // skipped); `samePort` (case c: the old page's origin) tries again until it gets p
  for (let tries = 0; ; tries++) {
    const h = await startOnce({ dir, py, port: p, user, env, extra });
    if (!samePort || h.port === p) return h;
    await stopHelper(h);
    if (tries > 24) throw new Error("port " + p + " did not become free");
    await sleep(5000);
  }
}
async function startOnce({ dir, py, port: p, user, env, extra }) {
  const [cmd, ...pre] = py.split(" ");
  const e = { ...process.env, SLIDEBUILDER_ROOT: env.root, SLIDEBUILDER_DATA: env.data, SLIDEBUILDER_USER: user,
    SLIDEBUILDER_HOST: "pc-" + user, SLIDEBUILDER_NO_NET: "1", NO_PROXY: "*", ...extra };
  for (const k of ["SLIDEBUILDER_STORAGE", "SLIDEBUILDER_TEST_BUMP_WAIT_S"]) if (!(k in extra)) delete e[k];
  const proc = spawn(cmd, [...pre, path.join(dir, "helper", "slide_builder.py"), "--no-browser", "--port", String(p)], { cwd: dir, env: e, stdio: ["ignore", "pipe", "pipe"] });
  const h = { proc, port: null, url: null, out: [], user, dir, py };
  const keep = b => { for (const l of b.toString().split(/\r?\n/)) if (l.trim()) h.out.push(l); };
  proc.stdout.on("data", keep); proc.stderr.on("data", keep);
  h.exited = new Promise(r => proc.on("exit", r));
  helpers.add(h);
  for (let i = 0; i < 150 && !h.version; i++) {
    const m = h.out.map(l => /Open\s*:\s*http:\/\/127\.0\.0\.1:(\d+)\//.exec(l)).find(Boolean);
    if (m) { h.port = +m[1]; h.url = `http://127.0.0.1:${h.port}/`;
      try { const r = await fetch(h.url + "api/ping"); if (r.ok) h.version = (await r.json()).version; } catch { /* starting */ } }
    if (!h.version && proc.exitCode !== null) throw new Error(`helper ${dir} exited: ${h.out.slice(-5).join(" | ")}`);
    if (!h.version) await sleep(200);
  }
  if (!h.version) { proc.kill(); throw new Error("helper asked for port " + p + " did not answer: " + h.out.slice(-6).join(" | ")); }
  const v = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8" });
  h.pyVersion = (v.stdout || v.stderr).trim();
  return h;
}
async function stopHelper(h) {
  if (!h || h.proc.exitCode !== null) { helpers.delete(h); return; }
  // (Windows: "py -3.8" is a launcher whose child python.exe is the helper - the whole tree is stopped)
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(h.proc.pid)]); else h.proc.kill();
  await Promise.race([h.exited, sleep(5000)]);
  if (h.proc.exitCode === null) { h.proc.kill("SIGKILL"); await h.exited; }
  helpers.delete(h);
}
async function tokenOf(h) { const html = await (await fetch(h.url)).text(); return /name="sb-token" content="([^"]+)"/.exec(html)?.[1]; }

// ---- the shared folders of one scenario
const envs = [];
function scenarioEnv(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sb-compat-" + tag.replace(/[^a-z0-9.-]/gi, "_") + "-"));
  const env = { base, root: path.join(base, "root"), data: path.join(base, "data") };
  envs.push(env);
  fs.mkdirSync(env.root, { recursive: true }); fs.mkdirSync(env.data, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "app", "tests", "fixtures", "report.xlsx"), path.join(env.root, "report.xlsx"));
  return env;
}
const deckDir = (env, name = "report.xlsx") => {
  const d = path.join(env.data, "v4", "decks");
  let f; try { f = fs.readdirSync(d).find(n => n.startsWith(name + "-") && /-[0-9a-f]{10}$/.test(n)); } catch { /* none */ }
  return f ? path.join(d, f) : null;
};
function frames(buf) {
  const out = [];
  for (let p = 0; ;) {
    const m = /^(\d+):([0-9a-f]{8}):/.exec(buf.subarray(p, p + 21).toString("latin1"));
    if (!m) return out;
    const start = p + m[0].length, end = start + +m[1];
    if (buf.length < end + 1 || buf[end] !== 10) return out;
    out.push({ rec: JSON.parse(buf.subarray(start, end).toString("utf8")), start: p, end: end + 1 }); p = end + 1;
  }
}
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
const journals = dir => { try { return fs.readdirSync(path.join(dir, "j")).filter(n => n.endsWith(".log")); } catch { return []; } };
/** the deck as everybody reads it: its snapshot and the records past the frontier, folded by the core */
function deckDoc(dir) {
  const snap = readJson(path.join(dir, "snapshot.json"));
  const recs = journals(dir).flatMap(n => frames(fs.readFileSync(path.join(dir, "j", n))).filter(f => f.start >= (snap.frontier[n.slice(0, -4)] || 0)).map(f => f.rec));
  return { snap, doc: core.fold(snap, recs).doc };
}
/** every file of the deck (presence/ left out: heartbeats) and the deck's backups, with sha256 */
function deckFiles(env, dir) {
  const out = {};
  const walk = (d, rel, top) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const r = rel + e.name; if (e.isDirectory()) { if (!(top && e.name === "presence")) walk(path.join(d, e.name), r + "/", false); } else out[r] = sha(fs.readFileSync(path.join(d, e.name))); } };
  walk(dir, "", true);
  walk(path.join(env.data, "backups", "v4", path.basename(dir)), "backups/", false);
  return out;
}
const diffFiles = (a, b) => { const d = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) d.push(k + (a[k] ? b[k] ? " changed" : " removed" : " added")); return d; };

/** watches a deck folder: every snapshot version written and every record ever in a journal (journals may be deleted
    later by a rotate: the union is kept) */
function watchDeck(env) {
  const w = { snaps: [], recs: new Map(), journalsSeen: new Set(), marker: null, stop: null };
  const tick = () => {
    const dir = deckDir(env); if (!dir) return;
    try {
      const raw = fs.readFileSync(path.join(dir, "snapshot.json")); const h = sha(raw);
      if (!w.snaps.length || w.snaps[w.snaps.length - 1].sha !== h) { const s = JSON.parse(raw.toString("utf8")); w.snaps.push({ seenAt: Date.now(), sha: h, gen: s.gen, format: s.format, by: s.by, at: s.at }); }
    } catch { /* being replaced */ }
    if (!w.marker && fs.existsSync(path.join(dir, MARKER5))) { try { const m = readJson(path.join(dir, MARKER5)); w.marker = { at: m.at, by: m.by, seenAt: Date.now() }; } catch { /* being written */ } }
    for (const n of journals(dir)) {
      w.journalsSeen.add(n);
      try { for (const f of frames(fs.readFileSync(path.join(dir, "j", n)))) { const k = f.rec.w + "|" + f.rec.s + "|" + n; if (!w.recs.has(k)) w.recs.set(k, { ...f.rec, journal: n }); } } catch { /* gone */ }
    }
  };
  const id = setInterval(tick, 200); tick();
  w.stop = () => { clearInterval(id); tick(); };
  return w;
}

// ---- pages
let browser;
async function openPage(h, label) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.route(u => !/^https?:\/\/127\.0\.0\.1[:/]/.test(u.toString()) && !u.toString().startsWith("data:") && !u.toString().startsWith("blob:"), r => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  const p = { page, ctx, h, label, calls: [], errors: [], writer: null, key: null };
  page.on("pageerror", e => p.errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") p.errors.push("console.error: " + m.text()); });
  page.on("response", async r => {
    const u = r.url(); if (!u.startsWith(h.url.replace(/\/$/, "")) || !/\/api\/decks/.test(u)) return;
    const pth = u.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
    const c = { at: Date.now(), m: r.request().method(), path: pth, status: r.status(), probe: p.probing };
    p.calls.push(c);
    if (pth === "/api/decks/open" && r.status() === 200) { try { const j = await r.json(); p.writer = j.writer; p.key = j.key; p.storage = j.storage; } catch { /* closed */ } }
    if (r.status() >= 400) { try { c.error = (await r.json()).error; } catch { /* not JSON */ } }
  });
  await page.goto(h.url);
  await page.locator("#openBtn").waitFor({ timeout: 30_000 });
  return p;
}
const closePage = async p => { if (p) { await p.page.close({ runBeforeUnload: true }).catch(() => {}); await sleep(500); await p.ctx.close().catch(() => {}); } };
const saveText = p => p.page.locator("#sbSave").innerText({ timeout: 2000 }).catch(() => "");
const saveClass = p => p.page.locator("#sbSave").getAttribute("class", { timeout: 2000 }).catch(() => "");
const toastText = p => p.page.locator("#toast").innerText({ timeout: 1000 }).catch(() => "");
async function waitSaved(p, ms = 60_000) {
  for (const e = Date.now() + ms; Date.now() < e; await sleep(250)) if ((await saveText(p)).includes("Saved")) return true;
  return false;
}
async function waitFor(f, ms, step = 250) { for (const e = Date.now() + ms; Date.now() < e; await sleep(step)) { const v = await f(); if (v) return v; } return null; }
const fileNameRe = n => new RegExp("^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?");
async function openWorkbook(p, name = "report.xlsx") {
  await p.page.click("#openBtn");
  await p.page.click(`[data-f="${name}"]`);
}
/** a new deck made with the wizard (cover + index + the content slides) */
async function wizardNew(p) {
  await openWorkbook(p);
  await p.page.locator(".wiz").waitFor({ timeout: 30_000 });
  await p.page.click('[data-a="next"]'); await p.page.click('[data-a="next"]');
  await p.page.check("#cvOn"); await p.page.fill("#cvTitle", "CP deck"); await p.page.check("#ixOn");
  await p.page.click('[data-a="finish"]');
  await p.page.locator(".thumb").first().waitFor({ timeout: 30_000 });
  if (!await waitSaved(p)) throw new Error(p.label + ": the new deck was not saved");
}
/** an existing deck: Open, Continue with preset */
async function continueOpen(p, name = "report.xlsx") {
  await openWorkbook(p, name);
  await p.page.click('[data-a="continue"]', { timeout: 30_000 });
  await p.page.locator("#fileName").filter({ hasText: fileNameRe(name) }).waitFor({ timeout: 30_000 });
}
/** a cell typed on the first content slide (the UI path; the page's change() when the cell is not found) */
async function editCell(p, from, to, ref) {
  try {
    await p.page.locator('.thumb[data-i="2"]').click({ timeout: 5000 });
    const cell = p.page.locator("#stage .slide .t", { hasText: new RegExp("^" + from + "$") }).first();
    await cell.waitFor({ timeout: 8000 });
    const b = await cell.boundingBox();
    await p.page.mouse.click(b.x + 8, b.y + b.height / 2);
    await p.page.keyboard.type(to); await p.page.keyboard.press("Enter");
    return "ui";
  } catch {
    const ok = await p.page.evaluate(([ref, to]) => window.__sbTest.change("Typing", [{ op: "cell.patch", sheet: "SLIDE_1", ref, patch: { text: to } }]), [ref, to]);
    return "change() " + ok;
  }
}
/** ✦ Wizard -> Next … -> Finish (a preset.set of the page's whole preset); "Save mine anyway" when asked */
async function wizardFinish(p) {
  try { return await wizardSteps(p); }
  catch (e) {
    const f = path.join(path.dirname(OUT), `wizard-${p.label}-${Date.now()}.png`);
    await p.page.screenshot({ path: f }).catch(() => {});
    await closeWizard(p);
    throw new Error(e.message.split("\n")[0] + " (screenshot " + f + ")");
  }
}
/** a wizard left open is closed (Cancel / Escape): the next step needs the slides */
async function closeWizard(p) {
  for (let i = 0; i < 3 && await p.page.locator(".wiz").isVisible().catch(() => false); i++) {
    await p.page.locator('.wiz [data-a="cancel"], .wiz .x, .wiz button[title="Close"]').first().evaluate(el => el.click()).catch(() => {});
    await p.page.keyboard.press("Escape").catch(() => {});
    await sleep(500);
  }
}
/** a button pressed as soon as it is there and enabled: the steps re-render while the wizard reads the workbook, and a
    toast of the page may lie over the buttons (then the button's own click() is called) */
async function press(pg, sel) {
  const l = pg.locator(sel).first();
  try { await l.click({ timeout: 2000 }); } catch { await l.evaluate(el => el.click(), undefined, { timeout: 2000 }); }
}
async function wizardSteps(p) {
  const pg = p.page;
  await closeWizard(p);
  await press(pg, "#wizardBtn");
  await pg.locator(".wiz").waitFor({ timeout: 15_000 });
  let done = false;
  for (const end = Date.now() + 40_000; !done && Date.now() < end; ) {
    const fin = pg.locator('.wiz [data-a="finish"]').first(), next = pg.locator('.wiz [data-a="next"]').first();
    try {
      if (await fin.isVisible() && await fin.isEnabled()) { await press(pg, '.wiz [data-a="finish"]'); done = true; }
      else if (await next.isVisible() && await next.isEnabled()) { await press(pg, '.wiz [data-a="next"]'); await sleep(300); }
      else await sleep(300);
    } catch { await sleep(300); }                   // (the button was replaced meanwhile: look again)
  }
  if (!done) throw new Error("the wizard's Finish was not reached in 40 s");
  await sleep(1500);
  if (await pg.locator('[data-a="ok"]').isVisible().catch(() => false)) { await press(pg, '[data-a="ok"]'); await sleep(500); return "finish + save mine anyway"; }
  if (await pg.locator(".wiz").isVisible().catch(() => false)) { const t = (await toastText(p)).slice(0, 90); await closeWizard(p); return "finish (the wizard stayed open: " + t + ")"; }
  return "finish";
}
const change = (p, label, ops) => p.page.evaluate(([l, o]) => window.__sbTest.change(l, o), [label, ops]);

/** every 4.6 object, made by the 4.6 page's own change() (one record each, as its buttons): returns what to look for */
async function addEvery46Object(p) {
  const pre = await p.page.evaluate(() => window.__sbTest.preset());
  const content = pre.slides.filter(s => s.type === "content");
  const s1 = content[0], s2 = content[1] || pre.slides[pre.slides.length - 1], t0 = s1.tables[0];
  const sheet = pre.tables.find(t => t.id === t0).sheet, last = pre.slides[pre.slides.length - 1].id;
  const ids = { s1: s1.id, s2: s2.id, t0, newSlide: "cpS" + Date.now().toString(36), newTable: "cpT" + Date.now().toString(36) };
  const steps = [
    ["New slide", [{ op: "slide.add", after: last, slide: { id: ids.newSlide, type: "content", tables: [], title: "CP-01 added slide" } }]],
    ["Add table", [{ op: "table.add", slide: ids.newSlide, table: { id: ids.newTable, sheet, kind: "range", range: "B2:D6" } }]],
    ["Chart", [{ op: "item.patch", slide: ids.s1, id: "cpChart", patch: { kind: "chart", type: "pie", values: { table: t0, range: "D6:D8" }, labels: { table: t0, range: "C6:C8" }, box: { x: 900, y: 200, w: 500, h: 400 } } }]],
    ["Shape", [{ op: "item.patch", slide: ids.s1, id: "cpShape", patch: { kind: "shape", shape: "round", text: "CP-01 shape", box: { x: 100, y: 700, w: 300, h: 120 } } }]],
    ["Free layout", [{ op: "slide.patch", id: ids.s1, patch: { free: { glass: { on: true, items: { ["t:" + t0]: { x: 80, y: 180, w: 700, h: 400 } } } } } }]],
    ["Look", [{ op: "slide.patch", id: ids.s1, patch: { looks: { mckinsey: { tables: "cards", headline: "none" } } } }]],
    ["Gridlines", [{ op: "table.patch", id: t0, patch: { cellGrid: { C6: { h: "on", v: "on", c: "#336699", w: 1 } } } }]],
    ["Borders", [{ op: "table.patch", id: t0, patch: { borders: { C6: { top: { style: "thick", color: "#C00000" }, bottom: "none" } } } }]],
    ["Hide slide", [{ op: "slide.patch", id: ids.s2, patch: { hide: { glass: true } } }]],
    ...m14Steps(ids.s2, t0),                     // (on the second content slide: the old page types into the first one's cells)
  ];
  for (const [l, ops] of steps) { const ok = await change(p, l, ops); if (!ok) throw new Error("the new page refused " + l); await sleep(150); }
  return ids;
}
/** every M14 (4.7) chart object (09 §2.2), as the chart panel's item.patch records: four charts and one per-entry
    patch of a series map (a series added on its own) */
function m14Steps(slide, t0) {
  const r = range => ({ table: t0, range }), box = { x: 60, y: 60, w: 480, h: 300 };
  return [
    ["Combo chart", [{ op: "item.patch", slide, id: "cpCombo", patch: { kind: "chart", type: "combo", values: r("D6:D8"), labels: r("C6:C8"), box,
      sers: {
        s1: { n: 1, name: "Actual", vals: [r("D6:D8")], type: "column", target: [r("E6:E8")], color: "#1F4E79",
          points: { 0: { color: "#C00000", label: "first" }, 2: { label: null } }, labels: { show: ["value", "ofTarget"], pos: "inEnd", num: "0.0" } },
        s2: { n: 2, name: { table: t0, range: "E5" }, vals: [r("E6:E8")], type: "line", axis: "y2", smooth: true,
          marker: { shape: "diamond", size: 7, color: "#FFC000" }, line: { color: "#ED7D31", w: 2, dash: "dashed" }, labels: { show: ["name"], pos: "above" } } },
      groups: { g1: { n: 1, cats: r("C6:C7"), label: "Weeks", divider: { color: "#7F7F7F", w: 1, dash: "dotted" } }, g2: { n: 2, cats: ["Target"], label: "Month", divider: "none" } },
      axes: { y: { min: 0, max: 100, step: 20, num: "0", grid: true, title: "Left" }, y2: { show: true, num: "0.0%" }, x: { line: "none" } },
      marks: { m1: { kind: "arrow", a: { s: "s1", i: 1 }, b: "floor", style: { color: "#333333", w: 1.5, heads: { b: "triangle", size: "m" } } },
        m2: { kind: "text", a: { s: "s1", i: 0 }, text: "CP-01 {SLIDE_1!C6}", dy: -12 },
        m3: { kind: "band", a: { x: 0, y: 10 }, b: { x: 1, y: 30 }, style: { color: "#DDEBF7" } },
        m4: { kind: "icon", a: { g: "g1", edge: "end" }, icon: "star", size: 18 } },
      legendAt: "top", legendHide: { s2: true }, titleFmt: { bold: true, size: 18, color: "#1F4E79" }, title: "CP-01 combo",
      stack: "stacked", gap: 60, overlap: -10, frame: "none", titleRule: { color: "#000000", w: 1 }, plot: { x: 40, y: 50, w: 400, h: 220 } } }]],
    ["Waterfall chart", [{ op: "item.patch", slide, id: "cpWaterfall", patch: { kind: "chart", type: "waterfall", values: r("D6:D8"), labels: r("C6:C8"), box: { ...box, y: 380 },
      sers: { w1: { n: 1, vals: [r("D6:D8")], points: { 2: { total: true, color: "#00B050" } }, line: { color: "#8A93A3", dash: "dashed" } } },
      legendHide: { up: true, total: true } } }]],
    ["Scatter chart", [{ op: "item.patch", slide, id: "cpScatter", patch: { kind: "chart", type: "scatter", values: r("D6:D8"), box: { ...box, x: 560 },
      sers: { p1: { n: 1, xs: [r("E6:E8")], vals: [r("D6:D8")], smooth: true, marker: { shape: "square" }, hide: false } },
      axes: { x: { min: 0, grid: true }, y: { max: 1000 } } } }]],
    ["Area chart", [{ op: "item.patch", slide, id: "cpArea", patch: { kind: "chart", type: "area", values: r("D6:D8"), labels: r("C6:C8"), box: { ...box, x: 560, y: 380 },
      sers: { a1: { n: 1, vals: [r("D6:D8")], fill: "solid", stack: "k" }, a2: { n: 2, vals: [r("E6:E8")], hide: true } }, stack: "percent" } }]],
    ["Add series", [{ op: "item.patch", slide, id: "cpCombo", patch: { sers: { s3: { n: 3, vals: [r("F6:F8")], type: "area", points: { 1: { marker: "#00FF00" } } } } } }]],
  ];
}
const M14_IDS = ["cpCombo", "cpWaterfall", "cpScatter", "cpArea"];
/** the M14 items of a document, each as its JSON (byte-equal comparison) */
const m14Items = (doc, slide) => Object.fromEntries(M14_IDS.map(k => [k, JSON.stringify(doc.preset?.slides.find(s => s.id === slide)?.items?.[k] ?? null)]));
/** what of the 4.6 objects a document is missing */
function missing46(doc, ids) {
  const miss = [], sl = id => doc.preset?.slides.find(s => s.id === id), tb = id => doc.preset?.tables.find(t => t.id === id);
  const ns = sl(ids.newSlide), s1 = sl(ids.s1), s2 = sl(ids.s2), t0 = tb(ids.t0);
  if (!ns || ns.title !== "CP-01 added slide") miss.push("slide.add");
  if (!tb(ids.newTable) || !ns?.tables?.includes(ids.newTable)) miss.push("table.add");
  if (s1?.items?.cpChart?.kind !== "chart") miss.push("items.chart");
  if (s1?.items?.cpShape?.kind !== "shape") miss.push("items.shape");
  if (s1?.free?.glass?.on !== true) miss.push("free");
  if (s1?.looks?.mckinsey?.tables !== "cards") miss.push("looks");
  if (t0?.cellGrid?.C6?.h !== "on") miss.push("cellGrid");
  if (t0?.borders?.C6?.top?.color !== "#C00000") miss.push("borders");
  if (s2?.hide?.glass !== true) miss.push("hide");
  if (doc.style?.designs?.mckinsey?.consult?.tables !== "rules") miss.push("style.designs.mckinsey.consult");
  const it = s2?.items || {};
  if (!it.cpCombo?.sers?.s1 || !it.cpCombo?.sers?.s3 || it.cpCombo?.sers?.s2?.axis !== "y2") miss.push("m14.sers");
  if (it.cpCombo?.groups?.g2?.cats?.[0] !== "Target") miss.push("m14.groups");
  if (it.cpCombo?.axes?.y?.max !== 100) miss.push("m14.axes");
  if (it.cpCombo?.marks?.m1?.style?.heads?.b !== "triangle" || !it.cpCombo?.marks?.m4) miss.push("m14.marks");
  if (it.cpCombo?.legendHide?.s2 !== true || it.cpWaterfall?.legendHide?.total !== true) miss.push("m14.legendHide");
  if (it.cpCombo?.titleFmt?.bold !== true) miss.push("m14.titleFmt");
  if (it.cpWaterfall?.sers?.w1?.points?.[2]?.total !== true) miss.push("m14.points.total");
  if (it.cpScatter?.type !== "scatter" || it.cpArea?.type !== "area" || it.cpWaterfall?.type !== "waterfall" || it.cpCombo?.type !== "combo") miss.push("m14.types");
  return miss;
}
const CONSULT = { op: "style.patch", patch: { designs: { mckinsey: { consult: { tables: "rules", bars: "off" } } } } };

/** direct API calls as the old page makes them (its token, X-SB-Formats, no X-SB-Deck-Formats), from inside the page.
    The writes are harmless if they got through (and then show): a cell Z99 = "PROBE", the current document as a
    format-4 snapshot, a rotate of the page's own writer */
async function probeFromPage(p, key, writer, snap) {
  p.probing = true;
  try { return await probeIn(p, key, writer, snap); } finally { await sleep(300); p.probing = false; }
}
function probeIn(p, key, writer, snap) {
  return p.page.evaluate(async ({ key, writer, snap }) => {
    const tok = document.querySelector('meta[name="sb-token"]').content;
    const H = { "X-SB-Token": tok, "X-SB-Formats": "workbook=3;config=3;prefs=1", "Content-Type": "application/json" };
    const d = "/api/decks/" + encodeURIComponent(key), out = {};
    const call = async (name, method, url, body) => {
      try { const r = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
        let e = ""; try { const j = await r.json(); e = j.error || ""; } catch { /* */ } out[name] = r.status + (e ? " " + e.slice(0, 90) : ""); }
      catch (x) { out[name] = "failed " + x.message; }
    };
    await call("open", "POST", "/api/decks/open", { workbook: snap.workbook || "report.xlsx" });
    await call("snapshot", "GET", d + "/snapshot");
    await call("tail", "GET", d + "/tail?since=" + encodeURIComponent("{}"));
    await call("prepare", "POST", d + "/prepare", { writer });
    await call("append", "POST", d + "/append", { writer, record: { l: 2 ** 40, w: writer, s: 900001, by: "probe", ops: [{ op: "cell.patch", sheet: "SLIDE_1", ref: "Z99", patch: { text: "PROBE" } }] } });
    await call("compact", "POST", d + "/compact", { baseGen: snap.gen, snapshot: { ...snap, format: 4, gen: snap.gen + 1 } });
    await call("rotate", "POST", d + "/rotate", { writer });
    return out;
  }, { key, writer, snap });
}
/** the same calls from outside a page with a given token and deck-formats header (case c: a valid token, no header) */
async function probeDirect(h, key, writer, snap, token, deckFormats) {
  const H = { "X-SB-Token": token, "X-SB-Formats": "workbook=3;config=3;prefs=1", "Content-Type": "application/json", ...(deckFormats ? { "X-SB-Deck-Formats": deckFormats } : {}) };
  const d = h.url + "api/decks/" + encodeURIComponent(key), out = {};
  const call = async (name, method, url, body) => {
    const r = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
    let e = ""; try { e = (await r.json()).error || ""; } catch { /* */ } out[name] = r.status + (e ? " " + e.slice(0, 90) : "");
  };
  await call("open", "POST", h.url + "api/decks/open", { workbook: "report.xlsx" });
  await call("snapshot", "GET", d + "/snapshot");
  await call("tail", "GET", d + "/tail?since=" + encodeURIComponent("{}"));
  if (deckFormats) return out;                                    // (the positive control reads only)
  await call("prepare", "POST", d + "/prepare", { writer });
  await call("append", "POST", d + "/append", { writer, record: { l: 2 ** 40, w: writer, s: 900002, by: "probe", ops: [{ op: "cell.patch", sheet: "SLIDE_1", ref: "Z99", patch: { text: "PROBE" } }] } });
  await call("compact", "POST", d + "/compact", { baseGen: snap.gen, snapshot: { ...snap, format: 4, gen: snap.gen + 1 } });
  await call("rotate", "POST", d + "/rotate", { writer });
  return out;
}
const statusCounts = (calls, since = 0) => { const o = {}; for (const c of calls) if (c.at >= since && !c.probe) { const k = c.m + " " + c.path.replace(/\/api\/decks\/[^/]+\//, "") + " " + c.status; o[k] = (o[k] || 0) + 1; } return o; };
const noProbeWritten = doc => doc.edits?.SLIDE_1?.Z99 === undefined;

// ================================================================ the cases
const report = { tool: "tools/compat-old.mjs", started: new Date().toISOString(), host: os.hostname(), platform: process.platform,
  bumpWait46: BUMP_WAIT ? BUMP_WAIT + " s (SLIDEBUILDER_TEST_BUMP_WAIT_S on the 4.6 helper only)" : "23 s (real; no test setting)", runs: [] };
const results = [];
function result(run, kase, pass, observed) {
  const r = { version: run.version, python: run.python, case: kase, pass, observed };
  results.push(r); run.cases.push(r);
  console.log(`RESULT ${run.version} py${run.pyShort} ${kase}: ${pass ? "PASS" : "FAIL"} - ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
}
const ext46 = BUMP_WAIT ? { SLIDEBUILDER_TEST_BUMP_WAIT_S: BUMP_WAIT } : {};

/** CP-02: a deck without 4.6 objects stays format 4 and opens, edits and compacts in the old version */
async function caseCP02(run, oldDir, py) {
  const env = scenarioEnv(run.version + "-cp02");
  const anna = await startHelper({ dir: ROOT, py: NEW_PY, port: nextPort(), user: "anna", env, extra: ext46 });
  const bob = await startHelper({ dir: oldDir, py, port: nextPort(), user: "bob", env });
  let a, b;
  try {
    a = await openPage(anna, "4.6");
    await wizardNew(a);
    await editCell(a, "Alpha", "Anna46", "C6");
    if (!await change(a, "Look", [CONSULT])) throw new Error("style.patch refused");
    await waitSaved(a); await closePage(a); a = null;
    const dir = deckDir(env), before = deckDoc(dir);
    const fmt46 = before.snap.format, marker = fs.existsSync(path.join(dir, MARKER5));
    b = await openPage(bob, run.version);
    await continueOpen(b);
    const how = await editCell(b, "Gamma", "Bob" + run.version.replace(".", ""), "C8");
    const saved = await waitSaved(b, 20_000);
    // left alone: the old page compacts (records older than the 30 s margin, nobody else present)
    const gen0 = readJson(path.join(dir, "snapshot.json")).gen;
    const comp = await waitFor(() => { const s = readJson(path.join(dir, "snapshot.json")); return s.gen > gen0 && s.by === "bob" ? s : null; }, 90_000, 1000);
    const after = deckDoc(dir);
    const consult = after.doc.style?.designs?.mckinsey?.consult;
    const obs = { formatAfter46: fmt46, marker, oldOpen: "ok", edit: how, saved, oldCompacted: comp ? { gen: comp.gen, format: comp.format } : null,
      formatNow: after.snap.format, consult, annaEdit: after.doc.edits?.SLIDE_1?.C6?.text, bobEdit: after.doc.edits?.SLIDE_1?.C8?.text, pageErrors: b.errors.slice(0, 4).map(e => e.slice(0, 140)) };
    const pass = fmt46 === 4 && !marker && saved && !!comp && comp.format === 4 && after.snap.format === 4 && consult?.tables === "rules" && consult?.bars === "off"
      && obs.annaEdit === "Anna46" && obs.bobEdit === "Bob" + run.version.replace(".", "");
    result(run, "CP-02", pass, obs);
  } finally { await closePage(a); await closePage(b); await stopHelper(anna); await stopHelper(bob); }
  return env;
}

/** a: the old page opens a format-5 deck; d (on this deck and on b's): its journals aged, the old helper's clean-up */
async function caseA(run, oldDir, py) {
  const env = scenarioEnv(run.version + "-a");
  const anna = await startHelper({ dir: ROOT, py: NEW_PY, port: nextPort(), user: "anna", env, extra: ext46 });
  let a, b, bob;
  try {
    a = await openPage(anna, "4.6");
    await wizardNew(a);
    if (!await change(a, "Look", [CONSULT])) throw new Error("style.patch refused");
    const ids = await addEvery46Object(a);
    const dir = deckDir(env);
    if (!await waitFor(() => readJson(path.join(dir, "snapshot.json")).format === 5, 90_000, 500)) throw new Error("the 4.6 page did not raise the deck");
    await waitSaved(a, 30_000);
    await closePage(a); a = null;
    await sleep(3000);
    const files0 = deckFiles(env, dir), snapSha = sha(fs.readFileSync(path.join(dir, "snapshot.json")));
    const doc0 = deckDoc(dir);
    bob = await startHelper({ dir: oldDir, py, port: nextPort(), user: "bob", env });
    b = await openPage(bob, run.version);
    const resp = b.page.waitForResponse(r => r.url().endsWith("/api/decks/open"), { timeout: 30_000 });
    await openWorkbook(b);
    const r = await resp, status = r.status(); let err = ""; try { err = (await r.json()).error || ""; } catch { /* */ }
    await sleep(2000);
    const continued = await b.page.locator('[data-a="continue"]').isVisible().catch(() => false);
    let editTry = "not offered";
    if (continued) { await b.page.click('[data-a="continue"]'); await sleep(3000); editTry = await editCell(b, "Alpha", "OldA", "C6"); await sleep(3000); }
    const shown = { fileName: await b.page.locator("#fileName").innerText().catch(() => ""), toast: (await toastText(b)).slice(0, 160), save: await saveText(b) };
    const probe = await probeFromPage(b, path.basename(dir), "bob@pc-bob#aaaaaaaa", doc0.snap);
    await sleep(2000);
    const files1 = deckFiles(env, dir), snapSha1 = sha(fs.readFileSync(path.join(dir, "snapshot.json")));
    const doc1 = deckDoc(dir), miss = missing46(doc1.doc, ids);
    const changed = diffFiles(files0, files1);
    const pass = status >= 400 && snapSha === snapSha1 && !changed.length && !miss.length && noProbeWritten(doc1.doc) && doc1.snap.format === 5;
    result(run, "a", pass, { openStatus: status + " " + err.slice(0, 110), continueOffered: continued, editTry, page: shown, probes: probe,
      snapshotSha256: snapSha === snapSha1 ? "unchanged " + snapSha.slice(0, 16) : "CHANGED " + snapSha.slice(0, 16) + " -> " + snapSha1.slice(0, 16),
      filesChanged: changed, missing46: miss, pageErrors: b.errors.slice(0, 4).map(e => e.slice(0, 140)) });
    return { env, ids };
  } finally { await closePage(a); await closePage(b); await stopHelper(anna); await stopHelper(bob); }
}

/** b (and c after it): the old page has the deck open before the bump */
async function caseB(run, oldDir, py, mode, withC) {
  const env = scenarioEnv(run.version + "-b-" + mode);
  const anna = await startHelper({ dir: ROOT, py: NEW_PY, port: nextPort(), user: "anna", env, extra: ext46 });
  let bob = await startHelper({ dir: oldDir, py, port: nextPort(), user: "bob", env, extra: mode === "lean-lock" ? { SLIDEBUILDER_STORAGE: "lean-lock" } : {} });
  let a, b, w, ids;
  const steps = [];
  try {
    a = await openPage(anna, "4.6");
    await wizardNew(a);
    if (!await change(a, "Look", [CONSULT])) throw new Error("style.patch refused");
    await waitSaved(a);
    const dir = deckDir(env), key = path.basename(dir);
    w = watchDeck(env);
    b = await openPage(bob, run.version);
    await continueOpen(b);
    steps.push("old page open (storage " + b.storage + ", writer " + b.writer + ")");
    steps.push("edit before: " + await editCell(b, "Alpha", "OldBefore", "C6") + ", saved " + await waitSaved(b, 15_000));
    if (readJson(path.join(dir, "snapshot.json")).format !== 4) throw new Error("the deck is not format 4 before the bump");
    // the 4.6 page adds every 4.6 object: marker, wait, raise, then its records
    const t46 = Date.now();
    ids = await addEvery46Object(a);
    const mk = await waitFor(() => w.marker, 20_000, 100);
    if (!mk) throw new Error("no marker after the 4.6 change");
    steps.push(`marker after ${mk.seenAt - t46} ms`);
    // in the gap: a cell, then the wizard's Finish (whole preset)
    const gapStart = Date.now();
    steps.push("gap edit: " + await editCell(b, "Gamma", "OldGap", "C8") + " -> " + (await waitSaved(b, 6000) ? "saved" : (await saveText(b)).slice(0, 80)));
    try { steps.push("gap wizard: " + await wizardFinish(b) + " -> " + (await waitSaved(b, 6000) ? "saved" : (await saveText(b)).slice(0, 80))); }
    catch (e) { steps.push("gap wizard: not run (" + e.message.slice(0, 220) + ")"); }
    steps.push(`gap actions took ${Date.now() - gapStart} ms after the marker was seen`);
    const raised = await waitFor(() => w.snaps.find(s => s.format === 5), 90_000, 250);
    if (!raised) throw new Error("the deck was not raised to format 5");
    steps.push(`raised to 5 (gen ${raised.gen}) ${raised.seenAt - mk.seenAt} ms after the marker`);
    await waitSaved(a, 30_000);
    // after the raise: the old page edits and runs the wizard again
    await sleep(1500);
    steps.push("edit after raise: " + await editCell(b, "OldBefore", "OldAfter", "C6") + " -> " + (await saveText(b)).slice(0, 100));
    try { steps.push("wizard after raise: " + await wizardFinish(b) + " -> " + (await saveText(b)).slice(0, 100)); }
    catch (e) { steps.push("wizard after raise: not run (" + e.message.slice(0, 220) + ")"); }
    const probesOld = await probeFromPage(b, key, b.writer, readJson(path.join(dir, "snapshot.json")));
    // the 4.6 page leaves (its pagehide compaction); the old page stays alone past the compaction margin
    await closePage(a); a = null;
    const aloneFrom = Date.now();
    await sleep(70_000);
    const sv = { text: (await saveText(b)).slice(0, 160), cls: await saveClass(b) };
    w.stop();
    const doc = deckDoc(dir), miss = missing46(doc.doc, ids);
    const recs = [...w.recs.values()];
    const bobW = new Set(recs.filter(r => r.by === "bob" || (b.writer && r.w === b.writer)).map(r => r.w));
    const markerAt = mk.at;
    const recs46 = recs.filter(r => r.ops.some(o => core.needsV5(o)) && !bobW.has(r.w));
    const first46 = recs46.slice().sort(core.recordOrder)[0];
    const bobAfter = recs.filter(r => bobW.has(r.w) && (r.at ?? 0) >= markerAt);
    const late = bobAfter.filter(r => first46 && core.recordOrder(r, first46) > 0);
    const bobSnaps = w.snaps.filter(s => s.by === "bob" && (s.at ?? 0) >= markerAt);
    let backupsByBob = [];
    try { const bd = path.join(env.data, "backups", "v4", key); backupsByBob = fs.readdirSync(bd).map(n => readJson(path.join(bd, n))).filter(s => s.by === "bob" && (s.at ?? 0) >= markerAt).map(s => s.gen); } catch { /* none */ }
    const bobCompacts = b.calls.filter(c => c.path.endsWith("/compact") && c.at >= mk.seenAt && !c.probe);
    const ro = /read-only|damaged|newer|reload/i.test(sv.text) || /err/.test(sv.cls || "");
    const obs = { storage: b.storage, steps, probesFromOldPage: probesOld, oldPageState: sv,
      oldRecordsAfterMarker: bobAfter.map(r => ({ s: r.s, l: r.l, at: r.at - markerAt, ops: r.ops.map(o => o.op).join("+"), journal: r.journal })),
      first46: first46 ? { l: first46.l, w: first46.w.split("#")[0], at: first46.at - markerAt } : null,
      oldRecordsFoldingAfter46: late.length, oldSnapshotsAfterMarker: bobSnaps.map(s => s.gen), oldBackupsAfterMarker: backupsByBob,
      oldCompactCallsAfterMarker: bobCompacts.map(c => c.status), snapshots: w.snaps.map(s => `gen ${s.gen} f${s.format} ${s.by}`),
      missing46: miss, probeWritten: !noProbeWritten(doc.doc), aloneSeconds: Math.round((Date.now() - aloneFrom) / 1000),
      pageCalls: statusCounts(b.calls, mk.seenAt), pageErrors: b.errors.slice(0, 4).map(e => e.slice(0, 140)) };
    // the whole-preset write must have been tried (in the gap or after the raise), else the case proves less
    const wizardTried = steps.some(x => /^(gap wizard|wizard after raise): finish/.test(x));
    obs.wizardTried = wizardTried;
    const pass = wizardTried && ro && !late.length && !bobSnaps.length && !backupsByBob.length && !bobCompacts.some(c => c.status < 400) && !miss.length && noProbeWritten(doc.doc) && doc.snap.format === 5 && !!first46;
    result(run, "b-" + mode, pass, obs);

    if (withC) {
      // c: the old user's PC restarts its helper on 4.6, the old page stays open
      const files0 = deckFiles(env, dir), snap0 = readJson(path.join(dir, "snapshot.json"));
      await stopHelper(bob);
      bob = await startHelper({ dir: ROOT, py: NEW_PY, port: bob.port, user: "bob", env, extra: ext46, samePort: true });
      const since = Date.now();
      await sleep(8000);                                                       // its tails (every 1.5 s)
      let editC = "refused by the page (read-only)";
      try { editC = await editCell(b, "OldBefore", "OldC", "C6"); } catch (e) { editC = "failed " + e.message.slice(0, 60); }
      await sleep(4000);
      const pageProbe = await probeFromPage(b, key, b.writer, snap0);          // the page's own (old) token
      const tok = await tokenOf(bob);
      const validNoHeader = await probeDirect(bob, key, b.writer, snap0, tok, null);
      const control = await probeDirect(bob, key, b.writer, snap0, tok, "4,5");
      await sleep(1000);
      const files1 = deckFiles(env, dir), changed = diffFiles(files0, files1);
      const calls = statusCounts(b.calls, since);
      const pageStatuses = new Set(b.calls.filter(c => c.at >= since && !c.probe).map(c => c.status));
      const doc2 = deckDoc(dir);
      const all = s => Object.values(s).every(v => /^409/.test(v));
      const passC = !changed.length && [...pageStatuses].every(s => s === 403) && Object.values(pageProbe).every(v => /^403/.test(v)) && all(validNoHeader)
        && /^200/.test(control.tail) && /^200/.test(control.snapshot) && noProbeWritten(doc2.doc) && !missing46(doc2.doc, ids).length;
      result(run, "c-" + mode, passC, { pageCallsAfterRestart: calls, editInOldPage: editC, oldPageState: (await saveText(b)).slice(0, 120),
        probesOldToken: pageProbe, probesValidTokenNoDeckFormats: validNoHeader, controlWithHeader45: control, filesChanged: changed,
        helperLog: bob.out.filter(l => /409|403|format|4\.6/i.test(l)).slice(-6) });
    }
    return { env, ids, writer: b.writer };
  } finally { if (w) w.stop(); await closePage(a); await closePage(b); await stopHelper(anna); await stopHelper(bob); }
}

/** m14 (4.7, M14 milestone review 3): the new page makes every M14 object; the old page opens the deck (format 5),
    edits a cell and is left alone past the compaction margin -> every M14 item byte-equal (JSON), in the folded deck
    and in every snapshot written after them */
async function caseM14(run, oldDir, py) {
  const env = scenarioEnv(run.version + "-m14");
  const anna = await startHelper({ dir: ROOT, py: NEW_PY, port: nextPort(), user: "anna", env, extra: ext46 });
  let a, b, bob, w;
  try {
    a = await openPage(anna, "4.7");
    await wizardNew(a);
    const pre = await a.page.evaluate(() => window.__sbTest.preset());
    // the charts on the second content slide (the old page types into the first one's cells, which charts would cover)
    const content = pre.slides.filter(s => s.type === "content"), t0 = content[0].tables[0];
    const s1 = content[1] || pre.slides[pre.slides.length - 1];
    for (const [l, ops] of m14Steps(s1.id, t0)) { if (!await change(a, l, ops)) throw new Error("the 4.7 page refused " + l); await sleep(150); }
    const dir = deckDir(env);
    if (!await waitFor(() => readJson(path.join(dir, "snapshot.json")).format === 5, 90_000, 500)) throw new Error("the 4.7 page did not raise the deck");
    if (!await waitSaved(a, 60_000)) throw new Error("the 4.7 page did not save its charts");
    await closePage(a); a = null;
    await sleep(3000);
    const before = deckDoc(dir), want = m14Items(before.doc, s1.id), snapSha0 = sha(fs.readFileSync(path.join(dir, "snapshot.json")));
    const missing = Object.entries(want).filter(([, v]) => v === "null").map(([k]) => k);
    if (missing.length) throw new Error("the 4.7 deck lacks " + missing.join(", "));
    const wantSerKeys = JSON.parse(want.cpCombo).sers ? Object.keys(JSON.parse(want.cpCombo).sers).sort().join(",") : "";
    w = watchDeck(env);
    bob = await startHelper({ dir: oldDir, py, port: nextPort(), user: "bob", env });
    b = await openPage(bob, run.version);
    const resp = b.page.waitForResponse(r => r.url().endsWith("/api/decks/open"), { timeout: 30_000 });
    await openWorkbook(b);
    const r = await resp, openStatus = r.status();
    await sleep(2000);
    let editHow = "not offered", saved = false, comp = null;
    const continued = await b.page.locator('[data-a="continue"]').isVisible().catch(() => false);
    if (openStatus < 400 && continued) {
      await b.page.click('[data-a="continue"]');
      await b.page.locator("#fileName").filter({ hasText: fileNameRe("report.xlsx") }).waitFor({ timeout: 30_000 }).catch(() => {});
      editHow = await editCell(b, "Gamma", "Old" + run.version.replace(/\W/g, ""), "C8");
      saved = await waitSaved(b, 20_000);
      // left alone: the old page compacts (records older than the 30 s margin, nobody else present) – waited for until
      // one of its snapshots folds the whole 4.7 journal (every M14 record), not only the records older than the margin
      const gen0 = readJson(path.join(dir, "snapshot.json")).gen;
      const newJ = journals(dir).filter(n => n.startsWith("anna@")).map(n => [n.slice(0, -4), fs.statSync(path.join(dir, "j", n)).size]);
      comp = await waitFor(() => { const s = readJson(path.join(dir, "snapshot.json"));
        return s.gen > gen0 && s.by === "bob" && newJ.every(([w, size]) => (s.frontier?.[w] || 0) >= size) ? s : null; }, 150_000, 1000);
    }
    w.stop();
    const after = deckDoc(dir), got = m14Items(after.doc, s1.id);
    const changed = M14_IDS.filter(k => got[k] !== want[k]);
    // every snapshot file the old page wrote (the deck's own and its backups) holds the M14 items byte-equal – or not yet
    // (an item whose records are still past that snapshot's frontier: "null"); the one that folds them all, equal
    const snapFiles = [path.join(dir, "snapshot.json")];
    try { const bd = path.join(env.data, "backups", "v4", path.basename(dir)); for (const n of fs.readdirSync(bd)) snapFiles.push(path.join(bd, n)); } catch { /* none */ }
    const snapsBad = snapFiles.map(f => { try { const sn = readJson(f); return sn.by === "bob" ? { f: path.basename(f), bad: M14_IDS.filter(k => { const v = m14Items(sn.doc, s1.id)[k]; return v !== want[k] && !(v === "null" && sn.gen !== comp?.gen); }) } : null; } catch { return null; } })
      .filter(x => x && x.bad.length);
    const oldEdit = after.doc.edits?.SLIDE_1?.C8?.text, wantEdit = "Old" + run.version.replace(/\W/g, "");
    const sv = { text: (await saveText(b)).slice(0, 160), cls: await saveClass(b) };
    const obs = { openStatus, continueOffered: continued, edit: editHow, saved, oldCompacted: comp ? { gen: comp.gen, format: comp.format } : null,
      formatNow: after.snap.format, m14ItemsChanged: changed, comboSeries: wantSerKeys, snapshotsByOldPageLosingM14: snapsBad,
      oldEdit: oldEdit ?? null, oldPageState: sv, snapshotUnchanged: openStatus >= 400 ? sha(fs.readFileSync(path.join(dir, "snapshot.json"))) === snapSha0 : undefined,
      bytes: Object.fromEntries(M14_IDS.map(k => [k, want[k].length])), pageErrors: b.errors.slice(0, 4).map(e => e.slice(0, 140)) };
    // refused (4.0–4.5): nothing changed; opened (4.6 pages): the M14 items equal, and the old edit kept wherever the
    // old page compacted (a page that turned read-only on the 4.7 keys compacts nothing and keeps nothing of its own)
    // (4.6p and 4.7 must compact – they know every 4.7 key –, so its snapshot holding the M14 items is the point of the case)
    const pass = !changed.length && !snapsBad.length && after.snap.format === 5
      && (openStatus >= 400 ? obs.snapshotUnchanged === true : (!comp || oldEdit === wantEdit)) && (!["4.6p", "4.7"].includes(run.version) || !!comp);
    result(run, "m14", pass, obs);
  } finally { if (w) w.stop(); await closePage(a); await closePage(b); await stopHelper(anna); await stopHelper(bob); }
}

/** d: the journals aged 25 h; the old helper's paths that delete journals (compact -> _drop_dead, rotate) and its
    idle-handle loop (every 60 s) */
async function caseD(run, oldDir, py, decksToAge) {
  const out = [];
  let allPass = true;
  for (const { env, ids, label } of decksToAge) {
    const dir = deckDir(env), key = path.basename(dir);
    const old = Date.now() / 1000 - 25 * 3600;
    const js = journals(dir);
    for (const n of js) fs.utimesSync(path.join(dir, "j", n), old, old);
    try { for (const n of fs.readdirSync(path.join(dir, "presence"))) fs.utimesSync(path.join(dir, "presence", n), old, old); } catch { /* none */ }
    const snap = readJson(path.join(dir, "snapshot.json"));
    const uncovered = js.filter(n => fs.statSync(path.join(dir, "j", n)).size > (snap.frontier[n.slice(0, -4)] || 0)).length;
    const files0 = deckFiles(env, dir);
    const bob = await startHelper({ dir: oldDir, py, port: nextPort(), user: "bob", env });
    let b;
    try {
      b = await openPage(bob, run.version);
      const resp = b.page.waitForResponse(r => r.url().endsWith("/api/decks/open"), { timeout: 30_000 });
      await openWorkbook(b);
      const openStatus = (await resp).status();
      const writers = [...new Set(js.map(n => n.replace(/(~\d+)?\.log$/, "")))];
      const probes = {};
      for (const wr of writers.length ? writers : ["bob@pc-bob#aaaaaaaa"]) {
        const p = await probeFromPage(b, key, wr === "shared" ? "bob@pc-bob#aaaaaaaa" : wr, snap);
        probes[wr.split("#")[0] + (wr.includes("#") ? "#…" : "")] = { compact: p.compact, rotate: p.rotate, append: p.append };
      }
      await sleep(65_000);                                                   // one round of the idle-handle loop
      const files1 = deckFiles(env, dir), changed = diffFiles(files0, files1);
      const left = journals(dir);
      const doc = deckDoc(dir), miss = missing46(doc.doc, ids);
      const pass = js.length > 0 && js.every(n => left.includes(n)) && !changed.length && !miss.length && noProbeWritten(doc.doc);
      allPass &&= pass;
      out.push({ deck: label, journals: js.length, uncovered, survived: js.filter(n => left.includes(n)).length, openStatus, probes, filesChanged: changed, missing46: miss });
    } finally { await closePage(b); await stopHelper(bob); }
  }
  result(run, "d", allPass && out.length > 0, out.length ? out : "no deck to age (a and b failed)");
}

// ================================================================ main
let failed = false;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
  for (const py of PYTHONS) {
    for (const v of VERSIONS) {
      if (!REFS[v]) throw new Error("unknown version " + v);
      const oldDir = worktree(v);
      const pv = spawnSync(py.split(" ")[0], [...py.split(" ").slice(1), "--version"], { encoding: "utf8" });
      const run = { version: v, ref: REFS[v], python: (pv.stdout || pv.stderr).trim(), cases: [] };
      run.pyShort = run.python.replace(/^Python /, "");
      report.runs.push(run);
      log(`== ${v} (${REFS[v]}) on ${run.python}; 4.6 helper on ${NEW_PY}`);
      const step = async (name, f) => { try { return await f(); } catch (e) { result(run, name, false, "ERROR " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); return null; } };
      if (CASES.includes("cp02")) await step("CP-02", () => caseCP02(run, oldDir, py));
      if (CASES.includes("m14")) await step("m14", () => caseM14(run, oldDir, py));
      if (READS_V5.has(v)) { if (!flag("--keep-data")) for (const e of envs.splice(0)) fs.rmSync(e.base, { recursive: true, force: true }); continue; }
      const aged = [];
      if (CASES.includes("a") || CASES.includes("d")) { const r = await step("a", () => caseA(run, oldDir, py)); if (r) aged.push({ ...r, label: "a (made by 4.6)" }); }
      if (CASES.includes("b") || CASES.includes("c"))
        for (const [i, m] of MODES.entries()) { const r = await step("b-" + m, () => caseB(run, oldDir, py, m, CASES.includes("c"))); if (r && i === 0) aged.push({ ...r, label: "b-" + m + " (old page's journals)" }); }
      if (CASES.includes("d")) await step("d", () => caseD(run, oldDir, py, aged));
      if (!flag("--keep-data")) for (const e of envs.splice(0)) fs.rmSync(e.base, { recursive: true, force: true });
    }
  }
} catch (e) {
  console.error(e); failed = true;
} finally {
  for (const h of [...helpers]) await stopHelper(h);
  await browser?.close();
  removeTrees();
}
report.finished = new Date().toISOString();
report.results = results;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed; report: ${OUT}`);
process.exit(failed || bad.length ? 1 : 0);
