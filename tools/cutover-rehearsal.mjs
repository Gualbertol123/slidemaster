/* Dry run of the pilot and the cut-over on a TEMP copy of a share folder (docs/next/pilot-v4.md, docs/next/cutover.md,
   04 §4). Never touches a real share: everything happens in a new folder below the system's temp folder.

     node tools/cutover-rehearsal.mjs --v3-zip slidebuilder-3.8.0.zip --v4-zip dist/slidebuilder-4.0.0.zip [--pilot]
                                      [--out transcript.txt] [--keep]

   The folder is seeded with tests/corpus: every workbook of tests/corpus/decks/<id>.json copied as <id>.<ext>, its
   deck saved through Slide Builder 3's own API. Then, with real helpers (one per "PC") and real pages (Chromium):
     1. install the v3 release (tools/update.py --zip), start it, open a deck and edit a cell;
     2. (--pilot) install the v4 release as the pilot (--pilot --zip), start it as "Start Slide Builder (v4 pilot).bat"
        does, open the deck, edit, migrate-all, Prepare rollback, rollback --all, Slide Builder 3 on the copy edits:
        the real data and the real export folder must be byte for byte unchanged;
     3. install the v4 release with the folder's own updater (the v3 one), start v4, open the same deck (it moves
        to v4; the open v3 page turns outdated), edit a cell;
     4. Update --migrate-all; Options › Administration › Prepare rollback; close the page; stop the helpers;
     5. Update --rollback (every deck), --use <v3>; start v3 again, open the deck: v4's edit is there; edit a cell.
   Checks: every other deck is exactly what it was before v4, and the deck has exactly the edits that were saved.
   The transcript (stdout, and --out) holds no times, paths or ports, so two runs can be compared with `diff`.
   Exit 0 = every check passed. */
import { chromium } from "../node_modules/playwright/index.mjs";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const CORPUS = path.join(REPO, "tests", "corpus");
const PY = process.platform === "win32" ? "python" : "python3";
const CHROME = process.env.CHROME || chromium.executablePath();
const FORMATS3 = "workbook=3;config=3;prefs=1";
const arg = (name, dflt = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const V3ZIP = arg("--v3-zip"), V4ZIP = arg("--v4-zip"), OUT = arg("--out"), KEEP = process.argv.includes("--keep"), PILOT = process.argv.includes("--pilot");
if (!V3ZIP || !V4ZIP) { console.error("usage: node tools/cutover-rehearsal.mjs --v3-zip FILE --v4-zip FILE [--pilot] [--out FILE] [--keep]"); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-rehearsal-"));
const share = path.join(tmp, "Slide Builder"), data = path.join(share, "backend", "data");
const lines = [], failures = [];
const norm = s => String(s).split(share).join("<share>").split(share.replace(/\\/g, "/")).join("<share>")
  .replace(/\d{8}-\d{6}/g, "<time>").replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, "<hh:mm>").replace(/\.update-tmp\S*/g, "");
const say = s => { const t = norm(s); lines.push(t); console.log(t); };
const check = (ok, what) => { say((ok ? "  ✓ " : "  ✗ ") + what); if (!ok) failures.push(what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vOf = zip => /slidebuilder-(.+)\.zip$/.exec(path.basename(zip))[1];
/** a release ZIP's own tools/update.py, extracted to a folder of its own (what the runbook has the maintainer do) */
function zipUpdater(zip, dir) {
  fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
  const r = spawnSync(PY, ["-c", "import sys,zipfile; open(sys.argv[2],'wb').write(zipfile.ZipFile(sys.argv[1]).read('tools/update.py'))", zip, path.join(dir, "tools", "update.py")]);
  if (r.status !== 0) throw new Error("cannot extract tools/update.py from " + zip);
  return path.join(dir, "tools", "update.py");
}
const V3 = vOf(V3ZIP), V4 = vOf(V4ZIP);

function freePort() {
  return new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}
/** a command's output lines that matter (the updater's), normalised */
function run(title, cmd, args, env = {}) {
  say("$ " + title);
  const r = spawnSync(cmd, args, { cwd: tmp, env: { ...cleanEnv(), PYTHONIOENCODING: "utf-8", ...env }, encoding: "utf-8" });
  for (const l of (r.stdout + r.stderr).split(/\r?\n/)) if (l.trim()) say("    " + l.trimEnd());
  say("    (exit " + r.status + ")");
  return r;
}
/** the environment of a PC: nothing that points Slide Builder somewhere else */
function cleanEnv() {
  const env = { ...process.env, NO_PROXY: "*", no_proxy: "*", SLIDEBUILDER_APP_WINDOW: "0", SLIDEBUILDER_ROLLBACK_QUIET: "1" };
  for (const k of Object.keys(env)) if (/^SLIDEBUILDER_(ROOT|DATA|EXPORT|APP_FILE|USER|HOST)$/.test(k)) delete env[k];
  return env;
}
/** a helper as a start file runs it: the program's folder, the user's name, no path variables (unless the pilot's) */
async function startHelper(label, entry, user, extra = [], env = {}) {
  const port = await freePort(), url = `http://127.0.0.1:${port}/`;
  const proc = spawn(PY, [entry, "--no-browser", "--port", String(port), ...extra],
    { cwd: path.dirname(entry), env: { ...cleanEnv(), SLIDEBUILDER_USER: user, SLIDEBUILDER_HOST: "pc-" + user, PYTHONUNBUFFERED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; proc.stdout.on("data", d => log += d); proc.stderr.on("data", d => log += d);
  let ping = null;
  for (let i = 0; i < 300 && !ping; i++) { try { ping = await (await fetch(url + "api/ping")).json(); } catch { await sleep(200); } }
  if (!ping) throw new Error(label + " did not start:\n" + log);
  const token = /<meta\s+name="sb-token"\s+content="([^"]+)"/.exec(await (await fetch(url)).text())[1];
  const api = async (p, method = "GET", body, formats = FORMATS3) => {
    const r = await fetch(url + p.replace(/^\//, ""), { method, headers: { "X-SB-Token": token, "X-SB-Formats": formats, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  say(`  ${label} started: Slide Builder ${ping.version}, user ${user}`);
  for (const l of log.split(/\r?\n/)) if (/^ (PILOT|Exports|Data)/.test(l)) say("    " + l.trim());
  const stop = () => { try { process.platform === "win32" ? execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }) : proc.kill(); } catch { /* gone */ } };
  return { url, api, stop, version: ping.version, log: () => log };
}

const wbApi = name => "/api/workbooks/" + encodeURIComponent(name);
async function v3Doc(h, name) { const r = await h.api(wbApi(name) + "/doc"); if (r.status !== 200) throw new Error(`doc ${name}: HTTP ${r.status}`); return r.body.doc; }
/** what a deck holds, without its counters: the preset, the style and every cell edit */
const content = d => JSON.stringify({ preset: d.preset ?? null, style: d.style ?? null, edits: d.edits ?? {} });
/** the cell edits as "sheet!cell.prop=value" lines */
function flat(edits, pre = "", out = new Map()) {
  for (const [k, v] of Object.entries(edits || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, pre ? pre + "/" + k : k, out); else out.set(pre + "." + k, JSON.stringify(v));
  }
  return out;
}
const changes = (a, b) => { const A = flat(a.edits), B = flat(b.edits); return [...new Set([...A.keys(), ...B.keys()])].filter(k => A.get(k) !== B.get(k)).sort(); };
/** the snapshot files of every deck (the bytes Slide Builder 3 and the pilot read), for "nothing changed" */
function treeHashes(dir, skip = []) {
  const out = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name), r = path.relative(dir, p).replace(/\\/g, "/");
    if (skip.some(s => r === s || r.startsWith(s + "/"))) continue;
    if (e.isDirectory()) walk(p); else out[r] = fs.readFileSync(p).toString("base64").length + ":" + simpleHash(fs.readFileSync(p));
  } };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
function simpleHash(buf) { let h = 2166136261; for (const b of buf) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); }

// ------------------------------------------------------------------------------------------------ pages
let browser;
async function openPage(h, label) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(h.url);
  await page.waitForSelector("#openBtn:not([disabled])", { timeout: 60_000 }).catch(() => page.waitForSelector("#openBtn", { timeout: 60_000 }));
  return { page, ctx, label, errors };
}
async function openDeck(p, file) {
  const { page } = p;
  await page.click("#openBtn");
  await page.click(`[data-f="${file}"]`);
  const cont = page.locator('.modal [data-a="continue"], .dlg [data-a="continue"], [data-a="continue"]').first();
  await cont.waitFor({ timeout: 15_000 }).then(() => cont.click()).catch(() => { /* no preset question */ });
  await page.waitForSelector(".thumb", { timeout: 60_000 });
  say(`  ${p.label}: ${file} open, ${await page.locator(".thumb").count()} slides`);
}
/** bold (Ctrl+B) on the n-th cell of the first slide; returns the save status text once it settles */
async function boldCell(p, n) {
  const { page } = p;
  await page.locator('.thumb[data-i="0"]').click();
  const cells = page.locator("#stage .slide .t");
  await cells.nth(n).waitFor({ timeout: 30_000 });
  const box = await cells.nth(n).boundingBox();
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await page.keyboard.press("Control+b");
  const st = page.locator("#sbSave");
  const end = Date.now() + 20_000;
  let text = "";
  while (Date.now() < end) { text = (await st.innerText().catch(() => "")).trim(); if (/✓ Saved|⚠/.test(text)) break; await sleep(200); }
  return text;
}

// ------------------------------------------------------------------------------------------------ the run
const helpers = [];
try {
  say(`Rehearsal: Slide Builder ${V3} -> ${V4}${PILOT ? " (with the pilot)" : ""} on a temp copy of a share folder`);
  // the folder: the workbooks of the corpus decks, an empty backend\
  fs.mkdirSync(path.join(share, "backend"), { recursive: true });
  fs.copyFileSync(path.join(CORPUS, "assets", "logo.png"), path.join(share, "logo.png"));
  const decks = fs.readdirSync(path.join(CORPUS, "decks")).filter(f => f.endsWith(".json")).sort().map(f => {
    const d = JSON.parse(fs.readFileSync(path.join(CORPUS, "decks", f), "utf8"));
    const file = f.replace(/\.json$/, "") + path.extname(d.workbook);
    fs.copyFileSync(path.join(CORPUS, "workbooks", d.workbook), path.join(share, file));
    return { file, ops: d.ops };
  });
  const DECK = "report.xlsx";
  say(`  ${decks.length} workbooks with saved decks`);

  say("\n== 1. Slide Builder " + V3);
  // the folder has no updater yet: the v3 ZIP's own (it copies only the start file and the updater into the folder)
  const v3Run = zipUpdater(path.resolve(V3ZIP), path.join(tmp, "v3-zip"));
  run(`<${V3} ZIP>/tools/update.py --root <share> --zip slidebuilder-${V3}.zip`, PY, [v3Run, "--root", share, "--zip", path.resolve(V3ZIP), "--yes"]);
  check(JSON.parse(fs.readFileSync(path.join(share, "app", "current.json"), "utf8")).version === V3, `app\\current.json names ${V3}`);
  const v3entry = path.join(share, "app", V3, "backend", "slide_builder.py");
  let h3 = await startHelper("v3 helper (PC 1)", v3entry, "anna"); helpers.push(h3);
  for (const d of decks) { const r = await h3.api(wbApi(d.file) + "/ops", "POST", { ops: d.ops, client: "rehearsal" }); if (r.status !== 200) throw new Error(`seed ${d.file}: HTTP ${r.status}`); }
  say(`  ${decks.length} decks saved through Slide Builder ${V3}'s API`);
  browser = await chromium.launch({ executablePath: CHROME });
  let a = await openPage(h3, "anna (v3)");
  await openDeck(a, DECK);
  check((await boldCell(a, 0)) === "✓ Saved", "v3: anna's edit (cell 1 bold) saved");
  // her page also records the fonts it laid out (data\fonts\system\fingerprints.json) a moment later: closed before
  // the pilot, so that "the pilot wrote nothing in the real data" is about the pilot alone
  await sleep(3000); await a.ctx.close();
  const pageErrors = [...a.errors];
  say("  anna closes her page");
  const before = {};
  for (const d of decks) before[d.file] = await v3Doc(h3, d.file);

  if (PILOT) {
    say("\n== 2. The pilot on a copy (" + V4 + ")");
    // the real data minus what the open v3 page itself keeps writing (its presence heartbeat) and the updater's lock
    const real = () => ({ data: treeHashes(data, ["locks", "backups", "v4-pilot", "presence"]), export: treeHashes(path.join(share, "export"), ["v4-pilot"]),
      current: fs.readFileSync(path.join(share, "app", "current.json"), "utf8"), start: fs.readFileSync(path.join(share, "Start Slide Builder.bat"), "utf8"),
      updater: fs.readFileSync(path.join(share, "tools", "update.py"), "utf8") });
    const r0 = real();
    const pilotRun = zipUpdater(path.resolve(V4ZIP), path.join(tmp, "pilot-zip"));
    run(`<pilot ZIP>/tools/update.py --root <share> --pilot --zip slidebuilder-${V4}.zip`, PY, [pilotRun, "--root", share, "--pilot", "--zip", path.resolve(V4ZIP)]);
    check(fs.existsSync(path.join(share, "Start Slide Builder (v4 pilot).bat")), "\"Start Slide Builder (v4 pilot).bat\" is in the folder");
    check(JSON.parse(fs.readFileSync(path.join(share, "app", "current.json"), "utf8")).version === V3, `app\\current.json still names ${V3}`);
    const copy = path.join(data, "v4-pilot");
    const hp = await startHelper("pilot helper (PC 2, as the pilot's start file runs it)", path.join(share, "app", V4, "helper", "slide_builder.py"), "bob", ["--pilot"],
      { SLIDEBUILDER_DATA: copy, SLIDEBUILDER_EXPORT: path.join(share, "export", "v4-pilot") }); helpers.push(hp);
    const b = await openPage(hp, "bob (pilot)");
    await openDeck(b, DECK);
    check((await boldCell(b, 1)) === "✓ Saved", "pilot: bob's edit (cell 2 bold) saved");
    run("pilot's updater --pilot --migrate-all", PY, [path.join(share, "app", V4, "tools", "update.py"), "--pilot", "--migrate-all"]);
    await b.page.click("#optBtn"); await b.page.click("#prepRollback");
    await b.page.click('.dlg button:has-text("Prepare rollback")');
    await b.page.locator("#toast").filter({ hasText: /Prepare rollback: \d+ decks? ready/ }).waitFor({ timeout: 180_000 });
    say("  pilot: " + norm((await b.page.locator("#toast").innerText()).trim()));
    await b.ctx.close(); await sleep(1500); hp.stop();
    run("pilot's updater --pilot --rollback", PY, [path.join(share, "app", V4, "tools", "update.py"), "--pilot", "--rollback"]);
    const hv = await startHelper("v3 on the pilot's copy (rollback rehearsal, as the pilot's start file --v3 runs it)", v3entry, "bob", [],
      { SLIDEBUILDER_DATA: copy }); helpers.push(hv);
    const c = await openPage(hv, "bob (v3 on the copy)");
    await openDeck(c, DECK);
    const pd = await v3Doc(hv, DECK);
    check(changes(before[DECK], pd).length === 1, "the copy's deck, back in v3, has the pilot's edit: " + changes(before[DECK], pd).join(" "));
    check((await boldCell(c, 2)) === "✓ Saved", "v3 on the copy: an edit saved");
    await c.ctx.close(); hv.stop();
    const r1 = real();
    const diff = Object.keys(r0).flatMap(k => typeof r0[k] === "string" ? (r0[k] === r1[k] ? [] : [k])
      : [...new Set([...Object.keys(r0[k]), ...Object.keys(r1[k])])].filter(f => r0[k][f] !== r1[k][f]).map(f => k + "/" + f));
    check(diff.length === 0, "the real data, export folder, current.json, start file and updater are unchanged by the pilot" + (diff.length ? ": " + diff.join(", ") : ""));
    check(content(await v3Doc(h3, DECK)) === content(before[DECK]), "the real deck is what it was before the pilot");
  }

  say("\n== 3. Slide Builder " + V4 + " (cut-over)");
  a = await openPage(h3, "anna (v3)");                         // the v3 page that is open while the folder moves to v4
  await openDeck(a, DECK);
  const cur0 =fs.readFileSync(path.join(share, "app", "current.json"), "utf8");
  const own = run(`Update Slide Builder.bat --zip slidebuilder-${V4}.zip (the folder's own updater, ${V3}'s)`, PY, [path.join(share, "tools", "update.py"), "--zip", path.resolve(V4ZIP), "--yes"]);
  check(own.status !== 0 && fs.readFileSync(path.join(share, "app", "current.json"), "utf8") === cur0 && !fs.existsSync(path.join(share, "app", V4 + ".part")),
    `${V3}'s updater refuses a ${V4} release and changes nothing: the runbook uses ${V4}'s own updater for this one switch`);
  const newRun = zipUpdater(path.resolve(V4ZIP), path.join(tmp, "release-zip"));
  run(`<${V4} ZIP>/tools/update.py --root <share> --zip slidebuilder-${V4}.zip (the runbook: --release ${V4})`, PY, [newRun, "--root", share, "--zip", path.resolve(V4ZIP), "--yes"]);
  check(JSON.parse(fs.readFileSync(path.join(share, "app", "current.json"), "utf8")).version === V4, `app\\current.json names ${V4}`);
  check(fs.readFileSync(path.join(share, "tools", "update.py"), "utf8") === fs.readFileSync(path.join(REPO, "tools", "update.py"), "utf8"), "the folder's updater is now the new one");
  const starts = ["Update Slide Builder.bat", "Install Slide Builder.bat", "Start Slide Builder (v3).bat"];
  check(starts.every(n => fs.existsSync(path.join(share, n))), "the start files the folder lacked are added: " + starts.join(", "));
  const h4 = await startHelper("v4 helper (PC 2)", path.join(share, "app", V4, "helper", "slide_builder.py"), "bob"); helpers.push(h4);
  const b = await openPage(h4, "bob (v4)");
  await openDeck(b, DECK);
  const frozen = JSON.parse(fs.readFileSync(path.join(data, "workbooks", fs.readdirSync(path.join(data, "workbooks")).find(f => f.startsWith(DECK + "-"))), "utf8"));
  check(frozen.schema === 4 && frozen.movedTo === "v4", "the deck moved to v4 on its first open (v3 file frozen: schema 4, movedTo v4)");
  const lost = await boldCell(a, 3);
  check(/^⚠/.test(lost), "anna's open v3 page refuses to save and asks for a reload: " + lost.replace(/\s+/g, " ").slice(0, 90));
  check((await boldCell(b, 1)) === "✓ Saved", "v4: bob's edit (cell 2 bold) saved");
  run("Update Slide Builder.bat --migrate-all", PY, [path.join(share, "tools", "update.py"), "--migrate-all"]);
  await b.page.click("#optBtn"); await b.page.click("#prepRollback");
  await b.page.click('.dlg button:has-text("Prepare rollback")');
  await b.page.locator("#toast").filter({ hasText: /Prepare rollback: \d+ decks? ready/ }).waitFor({ timeout: 180_000 });
  say("  v4: " + norm((await b.page.locator("#toast").innerText()).trim()));
  await b.ctx.close(); await a.ctx.close(); await sleep(1500);
  h4.stop(); h3.stop();
  say("  every page closed, both helpers stopped");

  say("\n== 4. Rollback to " + V3);
  run("Update Slide Builder.bat --rollback", PY, [path.join(share, "tools", "update.py"), "--rollback"]);
  run(`Update Slide Builder.bat --use ${V3}`, PY, [path.join(share, "tools", "update.py"), "--use", V3]);
  check(JSON.parse(fs.readFileSync(path.join(share, "app", "current.json"), "utf8")).version === V3, `app\\current.json names ${V3} again`);
  const h3b = await startHelper("v3 helper (PC 1, started again)", v3entry, "anna"); helpers.push(h3b);
  const a2 = await openPage(h3b, "anna (v3 again)");
  await openDeck(a2, DECK);
  const back = await v3Doc(h3b, DECK);
  const v4edit = changes(before[DECK], back);
  check(v4edit.length === 1, "the deck is back in v3 with v4's edit and without the refused one: " + v4edit.join(" "));
  check((await boldCell(a2, 2)) === "✓ Saved", "v3: anna edits again (cell 3 bold), saved");
  const after = await v3Doc(h3b, DECK);
  check(changes(back, after).length === 1, "and that edit is in the deck: " + changes(back, after).join(" "));
  let same = 0;
  for (const d of decks) if (d.file !== DECK) { const x = await v3Doc(h3b, d.file); if (content(x) === content(before[d.file])) same++; else say("    differs: " + d.file); }
  check(same === decks.length - 1, `the other ${decks.length - 1} decks are exactly what they were before v4 (${same} equal)`);
  await a2.ctx.close();
  const errs = [...pageErrors, ...[a, b, a2].flatMap(p => p.errors)];
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
} catch (e) {
  failures.push(String(e && e.stack || e));
  say("FAILED: " + (e && e.message || e));
} finally {
  for (const h of helpers) h.stop();
  if (browser) await browser.close().catch(() => {});
  say("\n" + (failures.length ? `RESULT: ${failures.length} check(s) failed` : "RESULT: every check passed"));
  if (OUT) fs.writeFileSync(OUT, lines.join("\n") + "\n");
  if (!KEEP) { await sleep(500); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } else console.log("kept: " + tmp);
  process.exit(failures.length ? 1 : 0);
}
