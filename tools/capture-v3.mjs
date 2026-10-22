/* Golden capture of the CURRENT Slide Builder (docs/next/05-test-and-parity.md §2, PLAN S0.5).

     node tools/capture-v3.mjs [--out golden] [--decks id,id] [--no-pdf] [--backend DIR]
                                                                              capture every deck of tests/corpus/decks/
       --backend DIR  another build's program folder (its helper and committed page, e.g. a worktree of v3.4.0's
                      backend/) – how the goldens are re-captured on a new reference machine (decision 2026-10-12)
     node tools/capture-v3.mjs --make-decks [--rewrite]                       add missing tests/corpus/decks/*.json

   One real helper (helper/slide_builder.py, the committed page) on a temp folder, one Chromium (CHROME or
   Playwright's own), a frozen clock (page.clock.setFixedTime), locale en-GB, time zone Europe/Rome, zoom 100 %.
   For every deck × design (glass, excel, clean) × version ("full" + the deck's versions) it writes
     <out>/<deck>/<design>/<version>/slide-<n>.json   geometry, text, font and colour of every .t .wb .tw .tnote,
                                                     title, subtitle, logo, page number, footer, cover/contents parts
     <out>/<deck>/<design>/<version>/slide-<n>.png    the slide, 1600 × 900 (the set of tests/corpus/pixels.json; --all-pixels: all)
     <out>/<deck>/<design>/<version>/pdf.json         the exported PDF: pages, size, text runs with positions (pypdf)
     <out>/<deck>/<design>/<version>/comments.json    the automated comments: settings and text
     <out>/<deck>/<design>/<version>/issues.json      the issues panel of every slide
     <out>/MANIFEST.json                              git sha, page sha256, Chromium version, fonts, clock
   Decks are data: tests/corpus/decks/<id>.json = {workbook, ops} – the ops are applied through the helper's
   API to a copy of tests/corpus/workbooks/<workbook> named <id>.<ext>, exactly as the app saves them.
   Needs node_modules (Playwright; `npm ci` at the root), Python (python3; python on Windows) with pypdf (dev only) for pdf.json. */
import { chromium } from "../node_modules/playwright/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sysFontDirs } from "./sysfonts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
export const CORPUS = path.join(REPO, "tests", "corpus"), DECKS = path.join(CORPUS, "decks"), BOOKS = path.join(CORPUS, "workbooks");
// the browser: CHROME, else Playwright's own Chromium (pinned by the lockfile); Windows has "python", not python3
export const CHROME = process.env.CHROME || chromium.executablePath();
const PY = process.platform === "win32" ? "python" : "python3";
export const CLOCK = "2026-10-01T10:00:00+02:00";
export const DESIGNS = ["glass", "excel", "clean"];
const FORMATS = "workbook=3;config=3;prefs=1";
/** the deck snapshot formats the tools read (ADR-019): they fold with this checkout's core, so a deck that holds 4.6
    objects (format 5: the chart corpus's item.patch) or 4.9 objects (format 6, AUDIT-3 COMPAT-1) is theirs to change –
    without it the helper answers 409 "reload" */
const DECK_FORMATS = "4,5,6";
// v3's names for the parts 05 §2 lists: cells .t, cards .wb, tables .tw, text boxes .tnote (the "note" of the plan)
// with their frames .notebub, workbook text boxes and shapes .tbox, pictures .pic, the notes section .memo, title,
// subtitle, logo, page number, footer, cover (cv-/cvx-) and contents (ix-) parts, empty/missing markers
export const SEL = [".t", ".wb", ".tw", ".tnote", ".notebub", ".tbox", ".title", ".subtitle", ".logo", ".logowrap", ".pageno", ".footer", ".pic", ".memo",
  "[class*='cv-']", "[class*='cvx-']", "[class*='ix-']", ".emptyslide", ".missing"].join(",");
const TEXT_SEL = ".t, .title, .subtitle, .pageno, .footer, .tnote, .memo, .tbox, [class*='ix-'], [class*='cv-'], [class*='cvx-']";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
/** the build captured: this checkout's helper/ (helper + committed page), or --backend DIR */
const BACKEND = path.resolve(arg("--backend", path.join(REPO, "helper")));
/** another build's helper (the goldens are captured from v3.4.0, golden/README.md): before 3.8 its PDFs came from its
    export engine, given the browser's DevTools and command line (not a Python "playwright" package this PC may have) */
const V3_HELPER_ENV = process.argv.includes("--backend") ? { SLIDEBUILDER_BROWSER: CHROME, SLIDEBUILDER_ENGINES: "devtools,cli" } : {};
export const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const freePort = () => new Promise(ok => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } }

/** the environment a capture depends on: same fingerprint = geometry and pixels are comparable */
export function environment(browserVersion) {
  const fonts = (process.platform === "win32" ? windowsFonts() : (sh("fc-list", ["--format", "%{family}|%{style}|%{fontversion}\n"]) || "").split("\n")).filter(Boolean).sort();
  return { chromium: browserVersion, chrome: CHROME, platform: `${process.platform} ${os.release()}`, fonts: fonts.length, fontsSha256: sha256(fonts.join("\n")) };
}

/** Windows: the installed font files (the system's and this user's), by name and size – fc-list does not exist there */
function windowsFonts() {
  const dirs = [path.join(process.env.WINDIR || "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Windows", "Fonts")];
  const out = [];
  for (const d of dirs) {
    let names = []; try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) if (/\.(ttf|otf|ttc)$/i.test(n)) { try { out.push(n.toLowerCase() + "|" + fs.statSync(path.join(d, n)).size); } catch { /* unreadable */ } }
  }
  return out;
}

// ------------------------------------------------------------------------------------------- helper process
export async function startHelper() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capture-")), root = path.join(tmp, "root"), data = path.join(tmp, "data");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  fs.copyFileSync(path.join(CORPUS, "assets", "logo.png"), path.join(root, "logo.png"));
  const port = await freePort(), url = `http://127.0.0.1:${port}/`;
  const proc = spawn(PY, [path.join(BACKEND, "slide_builder.py"), "--no-browser", "--port", String(port)], {
    env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "golden", SLIDEBUILDER_HOST: "pc-golden",
      SLIDEBUILDER_APP_WINDOW: "0", NO_PROXY: "*", no_proxy: "*", ...V3_HELPER_ENV,
      ...(sysFontDirs() ? { SLIDEBUILDER_SYSFONTS: sysFontDirs() } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; proc.stdout.on("data", d => log += d); proc.stderr.on("data", d => log += d);
  let up = false;
  for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(url + "api/ping")).ok; } catch { /* starting */ } if (!up) await sleep(200); }
  if (!up) throw new Error("helper did not start:\n" + log);
  const token = /<meta\s+name="sb-token"\s+content="([^"]+)"/.exec(await (await fetch(url)).text())[1];
  const api = async (p, method = "GET", body) => {
    const r = await fetch(url + p.replace(/^\//, ""), { method, headers: { "X-SB-Token": token, "X-SB-Formats": FORMATS, "X-SB-Deck-Formats": DECK_FORMATS, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok && r.status !== 204) throw new Error(`${method} ${p}: HTTP ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  // the helper starts its export browser: on Windows killing the helper alone leaves that browser running (taskkill /T stops the tree)
  const kill = () => { if (process.platform !== "win32") return proc.kill(); try { execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone already */ } };
  return { tmp, root, data, url, api, log: () => log, stop: () => { kill(); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } };
}
export const wbPath = name => "/api/workbooks/" + encodeURIComponent(name);
/** the build's storage: decks (Slide Builder 4, helper/slidebuilder/decks.py) or v3's documents (a 3.x build, --backend) */
const DECKS_V4 = fs.existsSync(path.join(BACKEND, "slidebuilder", "decks.py"));
/** the core's fold (core/src/model/fold.ts), bundled once for Node: how every page reads a deck */
let foldFn = null;
async function coreFold() {
  if (foldFn) return foldFn;
  const { build } = await import("esbuild");
  const r = await build({ entryPoints: [path.join(REPO, "core", "src", "model", "fold.ts")], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
  foldFn = (await import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"))).fold;
  return foldFn;
}
const deckApi = key => "/api/decks/" + encodeURIComponent(key);
async function openDeck(h, file) {
  const o = await h.api("/api/decks/open", "POST", { workbook: file });
  const t = await h.api(deckApi(o.key) + "/tail?since=" + encodeURIComponent(JSON.stringify(o.snapshot.frontier)));
  return { ...o, records: Object.values(t.journals).flatMap(j => j.records) };
}
/** change a workbook's deck as a page would: v3's ops route, or (4.x) one record appended to the deck by a new writer */
export async function deckOps(h, file, ops) {
  if (!DECKS_V4) return h.api(wbPath(file) + "/ops", "POST", { ops, client: "golden" });
  const d = await openDeck(h, file);
  const l = Math.max(d.snapshot.lamport || 0, ...d.records.map(r => r.l)) + 1;
  return h.api(deckApi(d.key) + "/append", "POST", { writer: d.writer, record: { l, w: d.writer, s: 1, by: "golden", ops } });
}
/** a workbook's document as everybody reads it */
export async function deckDoc(h, file) {
  if (!DECKS_V4) return (await h.api(wbPath(file) + "/doc")).doc;
  const d = await openDeck(h, file);
  return (await coreFold())(d.snapshot, d.records).doc;
}

// ------------------------------------------------------------------------------------------- the page
export async function openBrowser() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1900, height: 1250 }, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "Europe/Rome" });
  // S4.4: SB_OUTLINES=all draws every font as outlines on the stage (the screen = PDF switch, until decided)
  if (process.env.SB_OUTLINES === "all") await context.addInitScript(() => { try { localStorage.setItem("sbOutlines", "all"); } catch { /* no storage */ } });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(CLOCK));
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") (page.__errors ||= []).push(m.text().slice(0, 300)); if (page.__errors?.length > 30) page.__errors.shift(); });
  return { browser, page, errors };
}

/** the app with this deck open, settled: slides built, fonts and pictures loaded, nothing selected or hovered */
export async function load(page, h, file, version) {
  // leave the page first: it saves its preferences (lastFile included) 400 ms after a change, which could land after
  // the PUT below and open the previous workbook again
  await page.goto("about:blank");
  const prefs = (await h.api("/api/me")).prefs || {};
  await h.api("/api/me", "PUT", { prefs: { ...prefs, lastFile: file, zoom: 1, versions: { [file]: version || "" } } });
  await page.goto(h.url);
  await page.locator("#stage .slide").first().waitFor({ timeout: 120_000 }).catch(async e => {
    // what the page shows instead (S4.4: a capture that waited for ever said nothing more)
    const state = await page.evaluate(() => {
      const t = window.__sbTest;
      return { top: document.querySelector("#fileName")?.textContent, toast: document.querySelector(".toast")?.textContent, busy: document.querySelector("#busy")?.textContent,
        thumbs: document.querySelectorAll(".thumb").length, stage: t?.stage?.() ? "shown" : "none", idle: t?.stageIdle?.(), core: t?.coreStats, empty: !!document.querySelector("#emptyState") };
    }).catch(x => ({ unreadable: String(x) }));
    throw new Error(`${file}: no slide on the stage after 120 s – ${JSON.stringify(state)}; page errors: ${JSON.stringify(page.__errors || [])}; helper log tail: ${h.log ? h.log().slice(-600) : ""} (${e.message.split("\n")[0]})`);
  });
  // the requested workbook open (the top bar names it and its slide count; until then the page may still show the
  // one before) and all its thumbnails drawn: a steady thumbnail count alone was met by the previous deck at times
  const want = await page.waitForFunction(f => {
    const el = document.querySelector("#fileName"), b = el?.querySelector("b");
    const m = b && b.textContent === f && !/^Opening/.test(el.textContent) && /· (\d+) slides?/.exec(el.textContent);
    return m ? +m[1] : false;
  }, file, { timeout: 120_000 }).then(r => r.jsonValue(), async e => {
    throw new Error(`${file} did not open: the top bar says «${await page.locator("#fileName").innerText().catch(() => "?")}» (${e.message.split("\n")[0]})`);
  });
  let n = -1;
  for (let i = 0; i < 400; i++) { n = await page.locator(".thumb").count(); if (n === want) break; await sleep(150); }
  if (n !== want) throw new Error(`${file}: ${n} thumbnails, the top bar says ${want} slides`);
  await settle(page);
  return n;
}
export async function settle(page) {
  await page.mouse.move(1, 1);
  // the stage from M4 draws what the core worker sends: the slide shown is the current one, nothing on its way
  await page.waitForFunction(() => !window.__sbTest?.stageIdle || window.__sbTest.stageIdle(), null, { timeout: 60_000 });
  // a font that missed its measuring budget redraws the slide when it comes (S4.4): read the slide after that
  if (await page.evaluate(async () => !!window.__sbTest?.fontsSettling && await window.__sbTest.fontsSettling())) {
    let i = 0;
    for (; i < 300 && await page.evaluate(() => window.__sbTest.fontsSettling()); i++) await sleep(100);
    if (i === 300) console.warn("capture: a late font was still coming after 30 s – the slide is read as it is");
    await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 60_000 });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll("#stage img")].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function geometry(page) {
  return page.evaluate(([sel, textSel]) => {
    const slide = document.querySelector("#stage .slide"), sr = slide.getBoundingClientRect(), k = sr.width / 1600;
    const r1 = v => Math.round(v * 10) / 10;
    const items = [...slide.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      return { cls: el.className && el.className.baseVal === undefined ? String(el.className) : el.tagName.toLowerCase(),
        x: r1((r.left - sr.left) / k), y: r1((r.top - sr.top) / k), w: r1(r.width / k), h: r1(r.height / k),
        text: (el.matches(textSel) || own) ? el.innerText.replace(/\s+\n/g, "\n").trim() : undefined,
        font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, color: cs.color,
        // left out when they have the usual value (smaller files): style normal, no background, visible
        style: cs.fontStyle === "normal" ? undefined : cs.fontStyle, bg: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? undefined : cs.backgroundColor,
        visible: cs.visibility !== "hidden" && cs.display !== "none" ? undefined : false };
    });
    return { scale: Math.round(k * 1000) / 1000, w: Math.round(sr.width / k), h: Math.round(sr.height / k), items };
  }, [SEL, TEXT_SEL]);
}

/** the version's PDF as pdf.json (tools/pdftext.py): the native export – the goldens' pdf.json is v3's old engine's,
    removed in S4.5, so tools/parity.mjs compares pages, sizes and the golden slide texts (decision 2026-10-12, 5).
    SP's export of the version (stage-capture.mjs, just before) is used when there is one */
async function exportPdf(page, h, dir) {
  let file = path.join(dir, "sp", "native.pdf");
  if (!fs.existsSync(file)) {
    const exp = path.join(h.root, "export");
    fs.rmSync(exp, { recursive: true, force: true }); fs.mkdirSync(exp);
    if (await page.evaluate(() => !!window.__sbTest.lastExport)) {
      await page.evaluate(() => { window.__sbTest.lastExport.files = []; });
      await page.click("#exportBtn");
      try { await page.waitForFunction(() => window.__sbTest.lastExport.files.length > 0 && !window.__sbTest.exporting(), null, { timeout: 180_000 }); }
      catch { throw new Error("export timed out:\n" + h.log().slice(-2000)); }
    } else {
      // a page before 3.7 (the goldens' v3.4.0): its helper's engine writes the PDF – once the engine is up, Export, then
      // the file in the export folder once the button stops "Rendering"
      await page.locator("#srv").filter({ hasText: /Export: / }).waitFor({ timeout: 180_000 });
      await page.click("#exportBtn");
      let done = false;
      for (let i = 0; i < 1800 && !done; i++) {
        done = fs.readdirSync(exp).some(n => n.endsWith(".pdf")) && !(await page.locator("#exportBtn").innerText()).includes("Rendering");
        await sleep(done ? 200 : 100);
      }
      if (!done) throw new Error("export timed out:\n" + h.log().slice(-2000));
    }
    file = path.join(exp, fs.readdirSync(exp).find(n => n.endsWith(".pdf")));
  }
  const out = execFileSync(PY, [path.join(HERE, "pdftext.py"), file], { encoding: "utf8", maxBuffer: 64 << 20 });
  fs.writeFileSync(path.join(dir, "pdf.json"), out.replace(/\r\n/g, "\n"));     // Python on Windows prints CRLF
  return path.basename(file);
}

// ------------------------------------------------------------------------------------------- capture
/* opts: decks, deckDir (another folder of {workbook, ops} decks, e.g. tests/corpus/charts), pdf (false: no export), quiet, allPixels; designs (default all three); slideHook(page, {deck, dir, design,
   version, slide, geometry, pixels}) → {geometry?, png?}: replaces what is written for a slide (tools/dlparity.mjs
   writes the display list's geometry and pixels there; with `noGeometry` the page's DOM is not read for it – the
   stage from M4, tools/stage-capture.mjs); versionHook(page, helper, {deck, dir, design, version}): after the slides of
   a version (the native PDF for SP) */
export async function capture(out, opts = {}) {
  const decks = deckList(opts.decks, opts.deckDir);
  const h = await startHelper();
  const { browser, page, errors } = await openBrowser();
  const env = environment(browser.version());
  let total = 0;
  try {
    await page.goto(h.url);
    for (const id of decks) {
      const deck = JSON.parse(fs.readFileSync(path.join(opts.deckDir || DECKS, id + ".json"), "utf8"));
      const file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await deckOps(h, file, deck.ops);
      const versions = [["full", ""], ...(deck.ops.find(o => o.op === "preset.set")?.preset?.versions || []).map(v => [v.name, v.id])];
      for (const spec of opts.designs || DESIGNS) {
        // "mckinsey@headline=panel+tables=cards": a consulting design with options (M7b; the folder keeps the whole name)
        const [design, opt] = spec.split("@"), consult = opt ? Object.fromEntries(opt.split("+").map(kv => kv.split("="))) : null;
        // only a consulting design's entry is touched (style.patch replaces a design's entry whole): the deck's own look for
        // it, with these options or none – the other designs keep what the deck set for them (report-looks: Excel's title)
        const own = deck.ops.filter(o => o.op === "style.patch" && o.patch?.designs && design in o.patch.designs).map(o => o.patch.designs[design]).pop() || null;
        const { consult: _c, ...base } = own || {}, entry = consult ? { ...base, consult } : Object.keys(base).length ? base : null;
        await deckOps(h, file, [{ op: "style.patch", patch: { design, ...(design === "mckinsey" || design === "bain" ? { designs: { [design]: entry } } : {}) } }]);
        for (const [vname, vid] of versions) {
          const dir = path.join(out, id, spec, vname);
          fs.mkdirSync(dir, { recursive: true });
          const n = await load(page, h, file, vid);
          const doc = await deckDoc(h, file);
          const issues = [], comments = [];
          const autoCfg = Object.fromEntries((doc.preset?.slides || []).flatMap(s => Object.entries(s.notes || {})).filter(([, v]) => v.auto).map(([k, v]) => [k, v.auto]));
          for (let i = 0; i < n; i++) {
            await page.locator(".thumb").nth(i).click();
            await page.locator(`.thumb.on[data-i="${i}"]`).waitFor();
            await page.keyboard.press("Escape");
            await settle(page);
            let g = opts.noGeometry ? { items: [] } : await geometry(page);
            g.slide = i + 1; g.label = await page.locator(".thumb").nth(i).locator(".cap b").innerText();
            const pixels = wantPixels(opts, id, vname, i + 1);
            const hooked = opts.slideHook ? await opts.slideHook(page, { deck: id, dir, design, version: vid, slide: i, geometry: g, pixels }) : null;
            if (hooked?.geometry) g = hooked.geometry;
            fs.writeFileSync(path.join(dir, `slide-${i + 1}.json`), linesJson(g, "items"));
            if (hooked?.png) fs.writeFileSync(path.join(dir, `slide-${i + 1}.png`), hooked.png);
            else if (pixels) {                                        // exactly 1600 × 900 (the slide box can be at a sub-pixel offset)
              const b = await page.locator("#stage .slide").first().boundingBox();
              await page.screenshot({ path: path.join(dir, `slide-${i + 1}.png`), clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" });
            }
            issues.push({ slide: i + 1, text: (await page.locator("#issues").innerText()).trim() });
            // automated comments: the text the app writes for each note with settings (`auto`)
            for (const c of await page.evaluate(() => [...document.querySelectorAll("#stage .slide .tnote.auto")].map(el => ({ key: el.dataset.note, text: el.innerText.trim() }))))
              comments.push({ slide: i + 1, key: c.key, cfg: autoCfg[c.key] || null, text: c.text });
          }
          fs.writeFileSync(path.join(dir, "comments.json"), JSON.stringify(comments, null, 1));
          fs.writeFileSync(path.join(dir, "issues.json"), JSON.stringify(issues, null, 1));
          if (opts.versionHook) await opts.versionHook(page, h, { deck: id, dir, design, version: vid });
          if (opts.pdf !== false) await exportPdf(page, h, dir);
          total += n;
          if (!opts.quiet) console.log(`  ${id} · ${design} · ${vname}: ${n} slide(s)`);
        }
      }
    }
    if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
    const manifest = { designs: opts.designs || DESIGNS, git: sh("git", ["-C", BACKEND, "rev-parse", "HEAD"]), page: sha256(fs.readFileSync(path.join(BACKEND, "slide_builder.html"))),
      clock: CLOCK, locale: "en-GB", timezone: "Europe/Rome", viewport: "1900x1250@1", decks, slides: total, environment: env,
      fontsUsed: [...new Set(walk(out).filter(f => f.endsWith(".json") && /slide-\d+\.json$/.test(f))
        .flatMap(f => JSON.parse(fs.readFileSync(f, "utf8")).items.map(x => x.font)))].sort() };
    fs.writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 1));
    return manifest;
  } finally {
    await browser.close(); h.stop();
  }
}

/** JSON with one element of `key` per line: small, and a diff shows which element changed */
export function linesJson(obj, key) {
  const head = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
  return JSON.stringify(head).slice(0, -1) + `,"${key}":[\n` + obj[key].map(x => JSON.stringify(x)).join(",\n") + "\n]}\n";
}
const PIXELS = JSON.parse(fs.readFileSync(path.join(CORPUS, "pixels.json"), "utf8"));
/** screenshots: every slide with --all-pixels, else the chosen set of tests/corpus/pixels.json (version "full") */
function wantPixels(opts, deck, version, n) {
  if (opts.allPixels) return true;
  const set = PIXELS[deck];
  return version === "full" && (set === "all" || (Array.isArray(set) && set.includes(n)));
}

export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
export function deckList(only, dir = DECKS) {
  const all = fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
  return only ? all.filter(d => only.includes(d)) : all;
}

// ------------------------------------------------------------------------------------------- --make-decks
/** the preset the wizard proposes for a workbook (Open › wizard › Next › Next › Finish), read back from the doc */
async function wizardPreset(page, h, book) {
  fs.copyFileSync(path.join(BOOKS, book), path.join(h.root, book));
  await page.goto(h.url);
  await page.click("#openBtn"); await page.click(`[data-f="${book}"]`);
  await page.locator(".wiz").waitFor({ timeout: 60_000 });
  await page.click('[data-a="next"]'); await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
  await page.locator(".thumb").first().waitFor({ timeout: 60_000 });
  for (let i = 0; i < 100; i++) { const d = await deckDoc(h, book); if (d.preset) return d.preset; await sleep(200); }
  throw new Error("no preset for " + book);
}

/** workbooks without "x" markers: the wizard proposes nothing, so the range is chosen here (as a user would) */
const rangePreset = (key, sheet, range) => ({ sheets: [sheet], tables: [{ id: key + "T1", sheet, kind: "range", range }],
  slides: [{ id: key + "S1", type: "content", title: null, subtitle: null, tables: [key + "T1"], layout: null }] });
const FIXED_PRESETS = { "plain.xlsx": rangePreset("plain", "Data", "A3:E11"), "big.xlsx": rangePreset("big", "WM_ALL_STOCK_new", "C3:G30") };

const DEF_COMMENT = { groups: [], top: 2, noun: "country", detail: "full", share: true, breadth: true, missing: true, mode: "summary" };
/** option families of 05 §4 on top of the wizard's presets (ids fixed once, then committed as data) */
function variants(P) {
  const decks = {};
  const base = (id, book) => { decks[id] = { workbook: book, ops: [{ op: "preset.set", preset: P[book] }] }; };
  for (const b of Object.keys(P)) base(b.replace(/\.(xlsx|xlsm)$/, ""), b);
  const W = P["weekly.xlsx"], S0 = W.slides[0], [T0, T1] = S0.tables, sheet = W.tables[0].sheet;
  decks["weekly-options"] = { workbook: "weekly.xlsx", ops: [
    { op: "preset.set", preset: { ...W,
      slides: [{ id: "cover1", type: "cover", title: "Weekly report", subtitle: "Loans and deposits", date: null, tables: [] },
        { id: "index1", type: "index", title: "Contents", tables: [], subs: true }, ...W.slides],
      versions: [{ id: "vChief", name: "Chief", hide: {} }, { id: "vAll", name: "All", hide: { [sheet]: ["H10:I11"] } }] } },
    { op: "slide.patch", id: S0.id, patch: { title: "Loans & deposits", subtitle: "(mln Euro at last fixed exchange rate)",
      notes: { [`${T0}:right`]: { text: "A text box to the right, as a card", bubble: true },
        [`${T0}:top`]: { text: "A text box moved anywhere", x: 1180, y: 96, w: 330, h: 70, b: true, align: "center" },
        [`${T1}:bottom`]: { text: "", auto: { ...DEF_COMMENT, noun: "bank" } },
        "slide:notes": { text: "Source: internal data; figures not audited", size: 13, color: "#5B6274" } } } },
    { op: "table.patch", id: T0, patch: { scales: { s1: { range: "D10:F20", dir: "col", mode: "minmax", fill: true, ink: false } },
      gridH: "on", gridV: "off", merges: { "C17:C18": "merge" }, sizes: { excel: { cols: { "3": 180 } } } } },
    { op: "table.patch", id: T1, patch: { name: "Deposits", rows: { "30": 34 } } },
    { op: "cell.patch", sheet, ref: "C10", patch: { b: true, fill: "#FFD60A" } },
    { op: "cell.patch", sheet, ref: "D12", patch: { bg: "#DDEBF7", color: "#C00000", i: true } },
    { op: "cell.patch", sheet, ref: "E14", patch: { sz: 15, align: "left" } },
    { op: "cell.patch", sheet, ref: "D16", patch: { cf: `${sheet}!H10` } },
    { op: "style.patch", patch: { logo: "logo.png", logoBubble: true,
      pn: { on: true, start: 1, pos: "br", font: "", size: 14, format: "nN", style: "capsule", cover: false },
      footer: { on: true, text: "Confidential - internal use only", pos: "bl", size: 12, style: "plain", cover: false } } },
  ] };
  const R = P["report.xlsx"], RS = R.slides[0];
  decks["report-looks"] = { workbook: "report.xlsx", ops: [
    { op: "preset.set", preset: R },
    { op: "style.patch", patch: { glass: "strong", color: 80, radius: 150, contrast: 70,
      theme: { id: "custom", c1: "#0B3D91", c2: "#1E6FD9", c3: "#7FB2F0", c4: "#E8F1FB", a1: "#C0392B", a2: "#F39C12" },
      colors: { accent: "#7030A0", head: "#203864", headInk: "#FFFFFF", pos: "#00B050", neg: "#C00000", stripe: "#F2F2F2" },
      text: { title: { font: "DejaVu Serif", size: 40, b: true, color: "#1F3864" }, subtitle: { i: true }, table: { size: 14 }, note: { i: true }, pageno: { size: 16 } },
      pn: { on: true, start: 3, pos: "tr", format: "page", style: "plain", cover: true },
      designs: { excel: { colors: { head: "#375623" }, text: { title: { font: "Liberation Sans" } } }, clean: { theme: { a1: "#2E7D32" } } } } },
    { op: "slide.patch", id: RS.id, patch: { fmt: { title: { i: true, align: "center" } }, sizes: { excel: { scale: 0.8, align: "left", valign: "top" } }, align: "right" } },
  ] };
  const notes = {
    [`${T0}:bottom`]: { text: "", auto: { ...DEF_COMMENT, noun: "bank" } },
    [`${T0}:right`]: { text: "", auto: { ...DEF_COMMENT, mode: "sections", detail: "short", top: 1 } },
    [`${T1}:bottom`]: { text: "", auto: { ...DEF_COMMENT, kinds: ["week"], unit: "", bullets: false } },
    [`${T1}:right`]: { text: "", auto: { ...DEF_COMMENT, mode: "sections", top: 3, names: false, showTitle: false, share: false, breadth: false, missing: false, exclude: ["VUB"] } },
    [`${T0}:left`]: { text: "", auto: { ...DEF_COMMENT, tables: [T1], minAbs: 50, kinds: ["target", "month"] } },
  };
  decks["weekly-comments"] = { workbook: "weekly.xlsx", ops: [{ op: "preset.set", preset: W }, { op: "slide.patch", id: S0.id, patch: { notes } }] };
  // a named theme, glass "medium", cell roles, text-box spacing / alignment / markup, a box beside all tables,
  // a slide without its logo, footer tokens in a capsule, a comment with its own title
  decks["weekly-looks"] = { workbook: "weekly.xlsx", ops: [
    { op: "preset.set", preset: W },
    { op: "style.patch", patch: { theme: { id: "intesa" }, glass: "medium", color: 60,
      footer: { on: true, text: "{workbook} · {title} · {date}", pos: "bc", size: 13, style: "capsule", cover: false } } },
    { op: "cell.patch", sheet, ref: "C12", patch: { role: "total" } },
    { op: "cell.patch", sheet, ref: "C14", patch: { role: "header" } },
    { op: "cell.patch", sheet, ref: "D15", patch: { role: "caption" } },
    { op: "slide.patch", id: S0.id, patch: { logo: false, notes: {
      [`${T0}:left`]: { text: "# Highlights\n**Loans** grew [[+476]] mln\nDeposits [[-12]] mln over the week", span: true, lh: 1.5, pgap: 1, valign: "middle" },
      [`${T1}:bottom`]: { text: "", auto: { ...DEF_COMMENT, title: "Deposits overview", detail: "short", noun: "bank" } },
      [`${T0}:top`]: { text: "Centred, at the bottom of its box", align: "center", valign: "bottom", h: 90 } } } },
  ] };
  // a slide whose table is gone (sheet renamed or deleted in Excel)
  const PL = P["plain.xlsx"];
  decks["missing-table"] = { workbook: "plain.xlsx", ops: [{ op: "preset.set", preset: { ...PL,
    tables: [...PL.tables, { id: "ghostT1", sheet: "Deleted sheet", kind: "range", range: "A1:C5" }],
    slides: [{ ...PL.slides[0], tables: [...PL.slides[0].tables, "ghostT1"] }, { id: "ghostS2", type: "content", title: "Only a missing table", subtitle: null, tables: ["ghostT1"], layout: null }] } }] };
  return decks;
}

async function makeDecks() {
  const h = await startHelper();
  const { browser, page } = await openBrowser();
  try {
    const books = fs.readdirSync(BOOKS).filter(f => /\.(xlsx|xlsm)$/.test(f) && f !== "big30.xlsx").sort();
    const P = {};
    for (const b of books) {
      // a committed base deck keeps its ids (the wizard makes new random ones): only new workbooks go through it
      const base = path.join(DECKS, b.replace(/\.(xlsx|xlsm)$/, "") + ".json");
      P[b] = fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, "utf8")).ops[0].preset : FIXED_PRESETS[b] || await wizardPreset(page, h, b);
      console.log("  preset", b, P[b].slides.length, "slide(s)");
    }
    fs.mkdirSync(DECKS, { recursive: true });
    for (const [id, d] of Object.entries(variants(P))) {
      const f = path.join(DECKS, id + ".json");
      if (fs.existsSync(f) && !process.argv.includes("--rewrite")) continue;       // committed decks are data
      fs.writeFileSync(f, JSON.stringify(d, null, 1) + "\n");
      console.log("  wrote", path.relative(REPO, f));
    }
  } finally { await browser.close(); h.stop(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--make-decks")) await makeDecks();
  else {
    const out = path.resolve(arg("--out", path.join(REPO, "golden")));
    const t0 = Date.now();
    const m = await capture(out, { decks: arg("--decks", null)?.split(","), pdf: !process.argv.includes("--no-pdf"), allPixels: process.argv.includes("--all-pixels") });
    console.log(`captured ${m.slides} slide(s) of ${m.decks.length} deck(s) into ${out} in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}
