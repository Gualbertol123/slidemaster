/* Sample PDFs from the display list (PLAN S3.6, the G1 review): decks of the corpus opened in the app as the
   parity tools do (tools/capture-v3.mjs), each slide's display list asked of the core worker (slideLists, for
   export), and the PDF written in Node by core's writer (core/src/pdf) with the text shaped and the fonts subset by
   HarfBuzz (core/src/text) – the S3.7 export path, before it moves into the export worker. Fonts are this PC's
   (C:\Windows\Fonts and the per-user folder, listed by the helper's /sysfonts); each text node takes the first family
   of its CSS list that is installed, as the browser does.
   Each PDF is then checked: qpdf --check, no Type 3 or variable fonts, images only for pictures and wallpapers
   (tools/pdfcheck.py), and its selectable text against the goldens (GT): every golden text of the slide is in the
   page's text and nothing else is (whitespace ignored).

     node tools/export-dl.mjs [--out review/G1/pdf] [--designs glass,excel,clean] [--decks weekly-options,report-looks,deck20]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { BOOKS, DECKS, load, openBrowser, startHelper, wbPath } from "./capture-v3.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("--out", path.join(REPO, "review", "G1", "pdf")));
const DESIGNS = arg("--designs", "glass,excel,clean").split(",");
const SAMPLE = arg("--decks", "weekly-options,report-looks,deck20").split(",");
const PY = process.platform === "win32" ? "python" : "python3";

/** core's writer and text modules, bundled for Node (TypeScript sources; esbuild is a dev dependency) */
async function coreModules() {
  const r = await esbuild.build({
    stdin: { contents: `export { writePdf } from "./core/src/pdf/writer"; export { FontRegistry } from "./core/src/text/fonts"; export { prepareTextForPdf } from "./core/src/text/pdf"; export { pdfSubsetter } from "./core/src/text/subset";`,
      resolveDir: REPO, loader: "ts", sourcefile: "export-dl-entry.ts" },
    bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-export-dl-")), file = path.join(dir, "core.mjs");
  fs.writeFileSync(file, r.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** this PC's fonts, as the helper lists them, read from their folders */
function systemFonts(core, listing) {
  const dirs = [path.join(process.env.WINDIR || "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Windows", "Fonts")];
  const fonts = new core.FontRegistry(), seen = new Set();
  for (const f of listing) {
    if (seen.has(f.file)) continue; seen.add(f.file);
    const p = dirs.map(d => path.join(d, f.file)).find(x => fs.existsSync(x));
    if (!p) continue;
    try { fonts.add(new Uint8Array(fs.readFileSync(p)), { source: "system", file: f.file }); } catch { /* not a font this registry reads */ }
  }
  return fonts;
}
const GENERIC = { "sans-serif": "Arial", serif: "Times New Roman", monospace: "Consolas", "system-ui": "Segoe UI" };
/** each text node's face: the first family of its CSS list that is installed (what the browser draws) */
function resolveFonts(nodes, fonts, missing) {
  const families = n => (n.css || n.font).split(",").map(f => f.trim().replace(/^['"]|['"]$/g, "")).map(f => GENERIC[f] || f);
  const weight = n => n.weight ?? (n.b ? 700 : 400);
  const visit = ns => ns.map(n => {
    if (n.t === "group") return { ...n, children: visit(n.children) };
    if (n.t !== "text") return n;
    const fam = families(n).find(f => fonts.match(f, weight(n), !!n.i));
    if (!fam) { missing.add(n.css || n.font); return n; }
    return { ...n, font: fam };
  });
  return visit(nodes);
}
const dataUrlBytes = src => { const i = src.indexOf(","), b64 = src.slice(i + 1); return new Uint8Array(Buffer.from(src.slice(0, i).includes(";base64") ? b64 : decodeURIComponent(b64), src.slice(0, i).includes(";base64") ? "base64" : "latin1")); };

/** the golden texts of a slide: every text element that holds no other text element (a cell, a title, a text box…) */
export function goldenTexts(deck, design, version, n) {
  const f = path.join(REPO, "golden", deck, design, version, `slide-${n}.json`);
  if (!fs.existsSync(f)) return null;
  const items = JSON.parse(fs.readFileSync(f, "utf8")).items.filter(i => i.text);
  const CONTAINERS = /^(cv-block|ix-row|ix-txt|tw|xt)\b/;
  return items.filter(i => !CONTAINERS.test(i.cls) && !/^(hbox|edge|grip|emptyslide)/.test(i.cls)).map(i => i.text);
}
const squash = s => s.normalize("NFKC").replace(/\s+/g, "");
/** the golden texts found in a page's text, each used up once; what is left on either side is a difference. The
    texts are taken in the goldens' (the page's) order, each from where the last one was found, so a short number is
    matched where it is drawn, not inside a neighbour */
export function matchTexts(pageText, want) {
  let rest = squash(pageText), at = 0;
  const missing = [];
  for (const t of want) {
    const q = squash(t); if (!q) continue;
    let k = rest.indexOf(q, at);
    if (k < 0) k = rest.indexOf(q);                                // drawn out of order (page numbers, z-index)
    if (k < 0) { missing.push(t); continue; }
    rest = rest.slice(0, k) + "\u0001".repeat(q.length) + rest.slice(k + q.length);
    at = k + q.length;
  }
  return { missing, extra: rest.replace(/\u0001/g, "") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  const core = await coreModules();
  const h = await startHelper(), results = [];
  let browser = null;
  try {
    const b = await openBrowser(), page = b.page;
    browser = b.browser;
    const fonts = systemFonts(core, (await h.api("/sysfonts")).fonts);
    const subset = await core.pdfSubsetter();
    await page.goto(h.url);
    for (const id of SAMPLE) {
      const deck = JSON.parse(fs.readFileSync(path.join(DECKS, id + ".json"), "utf8"));
      const file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await h.api(wbPath(file) + "/ops", "POST", { ops: deck.ops, client: "golden" });
      for (const design of DESIGNS) {
        await h.api(wbPath(file) + "/ops", "POST", { ops: [{ op: "style.patch", patch: { design } }], client: "golden" });
        await load(page, h, file, "");
        const lists = await page.evaluate(async design => {
          const T = window.__sbTest, ls = await T.slideLists({ design, version: "", forExport: true, thumb: false });
          // pictures the page knows by URL (the logo) as data URLs, so Node can read them
          for (const l of ls) for (const [k, src] of Object.entries(l.dl.images)) if (!src.startsWith("data:")) {
            const b = await (await fetch(src)).blob();
            l.dl.images[k] = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
          }
          return ls;
        }, design);
        const missing = new Set(), images = Object.assign({}, ...lists.map(l => l.dl.images));
        const t0 = performance.now();
        const pages = await core.prepareTextForPdf(lists.map(l => resolveFonts(l.dl.nodes, fonts, missing)), fonts);
        const bytes = core.writePdf({ pages, image: id => images[id] ? dataUrlBytes(images[id]) : undefined, font: n => fonts.pdfFace(n), subset, title: `${id} · ${design}` });
        const ms = performance.now() - t0, out = path.join(OUT, `${id}-${design}.pdf`);
        fs.writeFileSync(out, bytes);
        results.push({ deck: id, design, file: out, slides: lists.length, bytes: bytes.length, ms: Math.round(ms), missing: [...missing] });
        console.log(`${id} · ${design}: ${lists.length} slide(s), ${(bytes.length / 1024).toFixed(1)} KB, ${Math.round(ms)} ms${missing.size ? ` – no installed font for: ${[...missing].join(" | ")}` : ""}`);
      }
    }
  } finally { await browser?.close(); h.stop(); }

  // the checks: pdfcheck (qpdf, Type 3, variable fonts) and the text against the goldens (GT)
  let ok = true;
  const info = JSON.parse(execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "info", ...results.map(r => r.file)], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
  let checked = "";
  try { checked = execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "check", ...results.map(r => r.file)], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }); }
  catch (e) { checked = String(e.stdout || ""); ok = false; }
  process.stdout.write(checked);
  const lines = checked.split(/\r?\n/);
  results.forEach((r, k) => {
    const d = info[k], bad = [];
    const goldens = fs.readdirSync(path.join(REPO, "golden", r.deck, r.design, "full")).filter(f => /^slide-\d+\.json$/.test(f)).length;
    if (goldens !== d.text.length) bad.push(`${d.text.length} page(s), the goldens have ${goldens} slide(s)`);
    d.text.forEach((pageText, p) => {
      const want = goldenTexts(r.deck, r.design, "full", p + 1);
      if (!want) { bad.push(`slide ${p + 1}: no golden`); return; }
      const { missing, extra } = matchTexts(pageText, want);
      if (missing.length || extra) bad.push(`slide ${p + 1}: ${missing.length ? `missing ${JSON.stringify(missing.slice(0, 3))}` : ""}${extra ? ` not in the goldens: ${JSON.stringify(extra.slice(0, 60))}` : ""}`);
    });
    r.images = d.images; r.fonts = d.fonts; r.gt = bad.length ? bad : "equal";
    // qpdf --check, no Type 3, no variable fonts (tools/pdfcheck.py check)
    r.check = (lines.find(l => l.endsWith(path.basename(r.file)) || l.includes(path.basename(r.file) + ":")) || "not checked").trim();
    if (bad.length) { ok = false; console.log(`GT FAIL ${path.basename(r.file)}: ${bad.slice(0, 4).join("; ")}`); }
    else console.log(`GT PASS ${path.basename(r.file)}: the selectable text is the golden texts`);
  });
  fs.writeFileSync(path.join(OUT, "pdfs.json"), JSON.stringify(results.map(r => ({ ...r, file: path.relative(OUT, r.file) })), null, 1));
  process.exitCode = ok ? 0 : 1;
}
