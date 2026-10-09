/* Golden capture of the CURRENT Slide Builder (docs/next/05-test-and-parity.md §2, PLAN S0.5).

     node tools/capture-v3.mjs [--out golden] [--decks id,id] [--no-pdf]     capture every deck of tests/corpus/decks/
     node tools/capture-v3.mjs --make-decks [--rewrite]                       add missing tests/corpus/decks/*.json

   One real helper (backend/slide_builder.py, the committed page) on a temp folder, one Chromium (CHROME or
   /opt/pw-browsers), a frozen clock (page.clock.setFixedTime), locale en-GB, time zone Europe/Rome, zoom 100 %.
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
   Needs node_modules (Playwright; `npm ci` at the root), python3 with pypdf (dev only) for pdf.json. */
import { chromium } from "../node_modules/playwright/index.mjs";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const CORPUS = path.join(REPO, "tests", "corpus"), DECKS = path.join(CORPUS, "decks"), BOOKS = path.join(CORPUS, "workbooks");
export const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export const CLOCK = "2026-10-01T10:00:00+02:00";
export const DESIGNS = ["glass", "excel", "clean"];
const FORMATS = "workbook=3;config=3;prefs=1";
// v3's names for the parts 05 §2 lists: cells .t, cards .wb, tables .tw, text boxes .tnote (the "note" of the plan)
// with their frames .notebub, workbook text boxes and shapes .tbox, pictures .pic, the notes section .memo, title,
// subtitle, logo, page number, footer, cover (cv-/cvx-) and contents (ix-) parts, empty/missing markers
const SEL = [".t", ".wb", ".tw", ".tnote", ".notebub", ".tbox", ".title", ".subtitle", ".logo", ".logowrap", ".pageno", ".footer", ".pic", ".memo",
  "[class*='cv-']", "[class*='cvx-']", "[class*='ix-']", ".emptyslide", ".missing"].join(",");
const TEXT_SEL = ".t, .title, .subtitle, .pageno, .footer, .tnote, .memo, .tbox, [class*='ix-'], [class*='cv-'], [class*='cvx-']";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
export const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const freePort = () => new Promise(ok => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
function sh(cmd, args) { try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } }

/** the environment a capture depends on: same fingerprint = geometry and pixels are comparable */
export function environment(browserVersion) {
  const fonts = (sh("fc-list", ["--format", "%{family}|%{style}|%{fontversion}\n"]) || "").split("\n").filter(Boolean).sort();
  return { chromium: browserVersion, chrome: CHROME, platform: `${process.platform} ${os.release()}`, fonts: fonts.length, fontsSha256: sha256(fonts.join("\n")) };
}

// ------------------------------------------------------------------------------------------- helper process
export async function startHelper() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capture-")), root = path.join(tmp, "root"), data = path.join(tmp, "data");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  fs.copyFileSync(path.join(CORPUS, "assets", "logo.png"), path.join(root, "logo.png"));
  const port = await freePort(), url = `http://127.0.0.1:${port}/`;
  const proc = spawn("python3", [path.join(REPO, "backend/slide_builder.py"), "--no-browser", "--port", String(port)], {
    env: { ...process.env, SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: "golden", SLIDEBUILDER_HOST: "pc-golden",
      SLIDEBUILDER_BROWSER: CHROME, SLIDEBUILDER_APP_WINDOW: "0", NO_PROXY: "*", no_proxy: "*" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; proc.stdout.on("data", d => log += d); proc.stderr.on("data", d => log += d);
  let up = false;
  for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(url + "api/ping")).ok; } catch { /* starting */ } if (!up) await sleep(200); }
  if (!up) throw new Error("helper did not start:\n" + log);
  const token = /<meta\s+name="sb-token"\s+content="([^"]+)"/.exec(await (await fetch(url)).text())[1];
  const api = async (p, method = "GET", body) => {
    const r = await fetch(url + p.replace(/^\//, ""), { method, headers: { "X-SB-Token": token, "X-SB-Formats": FORMATS, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok && r.status !== 204) throw new Error(`${method} ${p}: HTTP ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  return { tmp, root, data, url, api, log: () => log, stop: () => { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
const wbPath = name => "/api/workbooks/" + encodeURIComponent(name);

// ------------------------------------------------------------------------------------------- the page
export async function openBrowser() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1900, height: 1250 }, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "Europe/Rome" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(CLOCK));
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  return { browser, page, errors };
}

/** the app with this deck open, settled: slides built, fonts and pictures loaded, nothing selected or hovered */
async function load(page, h, file, version) {
  const prefs = (await h.api("/api/me")).prefs || {};
  await h.api("/api/me", "PUT", { prefs: { ...prefs, lastFile: file, zoom: 1, versions: { [file]: version || "" } } });
  await page.goto(h.url);
  await page.locator("#stage .slide").first().waitFor({ timeout: 120_000 });
  let n = -1;
  for (let i = 0; i < 100; i++) { const m = await page.locator(".thumb").count(); if (m === n && m > 0) break; n = m; await sleep(150); }
  await settle(page);
  return n;
}
async function settle(page) {
  await page.mouse.move(1, 1);
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

async function waitEngine(page) {
  await page.locator("#srv").filter({ hasText: /Export: / }).waitFor({ timeout: 180_000 });
}
async function exportPdf(page, h, dir) {
  const exp = path.join(h.root, "export");
  fs.rmSync(exp, { recursive: true, force: true }); fs.mkdirSync(exp);
  await page.click("#exportBtn");
  for (let i = 0; i < 1800; i++) {
    const f = fs.readdirSync(exp).find(n => n.endsWith(".pdf"));
    if (f && !(await page.locator("#exportBtn").innerText()).includes("Rendering")) {
      await sleep(200);
      const out = execFileSync("python3", [path.join(HERE, "pdftext.py"), path.join(exp, f)], { encoding: "utf8", maxBuffer: 64 << 20 });
      fs.writeFileSync(path.join(dir, "pdf.json"), out);
      return f;
    }
    await sleep(100);
  }
  throw new Error("export timed out:\n" + h.log().slice(-2000));
}

// ------------------------------------------------------------------------------------------- capture
export async function capture(out, opts = {}) {
  const decks = deckList(opts.decks);
  const h = await startHelper();
  const { browser, page, errors } = await openBrowser();
  const env = environment(browser.version());
  let total = 0;
  try {
    await page.goto(h.url);
    if (opts.pdf !== false) await waitEngine(page);
    for (const id of decks) {
      const deck = JSON.parse(fs.readFileSync(path.join(DECKS, id + ".json"), "utf8"));
      const file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await h.api(wbPath(file) + "/ops", "POST", { ops: deck.ops, client: "golden" });
      const versions = [["full", ""], ...(deck.ops.find(o => o.op === "preset.set")?.preset?.versions || []).map(v => [v.name, v.id])];
      for (const design of DESIGNS) {
        await h.api(wbPath(file) + "/ops", "POST", { ops: [{ op: "style.patch", patch: { design } }], client: "golden" });
        for (const [vname, vid] of versions) {
          const dir = path.join(out, id, design, vname);
          fs.mkdirSync(dir, { recursive: true });
          const n = await load(page, h, file, vid);
          const doc = (await h.api(wbPath(file) + "/doc")).doc;
          const issues = [], comments = [];
          const autoCfg = Object.fromEntries((doc.preset?.slides || []).flatMap(s => Object.entries(s.notes || {})).filter(([, v]) => v.auto).map(([k, v]) => [k, v.auto]));
          for (let i = 0; i < n; i++) {
            await page.locator(".thumb").nth(i).click();
            await page.locator(`.thumb.on[data-i="${i}"]`).waitFor();
            await page.keyboard.press("Escape");
            await settle(page);
            const g = await geometry(page);
            g.slide = i + 1; g.label = await page.locator(".thumb").nth(i).locator(".cap b").innerText();
            fs.writeFileSync(path.join(dir, `slide-${i + 1}.json`), linesJson(g, "items"));
            if (wantPixels(opts, id, vname, i + 1)) {               // exactly 1600 × 900 (the slide box can be at a sub-pixel offset)
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
          if (opts.pdf !== false) await exportPdf(page, h, dir);
          total += n;
          if (!opts.quiet) console.log(`  ${id} · ${design} · ${vname}: ${n} slide(s)`);
        }
      }
    }
    if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
    const manifest = { git: sh("git", ["-C", REPO, "rev-parse", "HEAD"]), page: sha256(fs.readFileSync(path.join(REPO, "backend/slide_builder.html"))),
      clock: CLOCK, locale: "en-GB", timezone: "Europe/Rome", viewport: "1900x1250@1", designs: DESIGNS, decks, slides: total, environment: env,
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
export function deckList(only) {
  const all = fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();
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
  for (let i = 0; i < 100; i++) { const d = (await h.api(wbPath(book) + "/doc")).doc; if (d.preset) return d.preset; await sleep(200); }
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
