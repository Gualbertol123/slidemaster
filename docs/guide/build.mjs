// Prints the two documents of docs/guide with Playwright's Chromium (README §11.1):
//   guide.html  → "Slide Builder 4 – guide.pdf"   (A4, the full guide)
//   launch.html → "Slide Builder 4 – launch.pdf"  (16:9 slides, the launch presentation)
// Usage, from the repository root:  node docs/guide/build.mjs [guide|launch] [--draft <folder>]
// Then check them:                  python tools/pdfcheck.py info "docs/guide/Slide Builder 4 – guide.pdf"
// Page size, margins, running header and page numbers come from each file's CSS (@page), so pdf() is told to use them.
//
// The PDFs use the product's fonts – Segoe UI, Segoe UI Symbol and Consolas – which only Windows has. Before printing,
// the page is asked whether each of them is installed (only a hint: on Linux, fontconfig may stand another font in for
// "Segoe UI"); after printing, check.mjs reads the fonts the PDF really embeds, which decides (and,
// for the guide, its page count: 14–20). If any check fails, the PDF is NOT written into docs/guide (the committed one
// stays as it is) and the build exits with 1. --draft <folder> prints anyway into that folder, for a look at the
// layout on a PC without the fonts (Linux, CI); a draft is never committed.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPdf, checkSources, pdfFacts } from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = {
  guide: { html: "guide.html", pdf: "Slide Builder 4 – guide.pdf", pages: [14, 20] },
  launch: { html: "launch.html", pdf: "Slide Builder 4 – launch.pdf", pages: [1, 99] },
};
const args = process.argv.slice(2);
const di = args.indexOf("--draft");
const draft = di >= 0 ? path.resolve(args[di + 1] || "") : "";
if (di >= 0) { if (!args[di + 1]) throw new Error("--draft needs a folder"); args.splice(di, 2); }
if (draft && path.resolve(draft) === here) throw new Error("--draft must name a folder outside docs/guide");
const which = args[0] ? [args[0]] : Object.keys(DOCS);
/** the fonts the guide's CSS names, each with a text it must draw itself (the symbols the guide prints: Segoe UI Symbol) */
const FONTS = [['"Segoe UI"', "Slide Builder 4 – mmmwwwiiil 0123456789"], ['"Segoe UI Symbol"', "✦↶↷⤺⚙✎⇔↻"], ["Consolas", "backend\\data\\ C4:T56"]];
let failed = false;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  for (const name of which) {
    const doc = DOCS[name];
    if (!doc) throw new Error("unknown document: " + name);
    const page = await browser.newPage();
    const problems = [];
    page.on("pageerror", e => problems.push("page error: " + e.message));
    page.on("requestfailed", r => problems.push("missing: " + r.url()));
    await page.goto(pathToFileURL(path.join(here, doc.html)).href, { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    if (problems.length) throw new Error(problems.join("\n"));
    // is each font installed? A text measured in "<font>, monospace" and in "<font>, serif" has the same width only
    // when <font> itself draws it (both fallbacks differ from each other)
    const missing = await page.evaluate(fonts => {
      const c = document.createElement("canvas").getContext("2d");
      const w = (f, t) => { c.font = "40px " + f; return c.measureText(t).width; };
      return fonts.filter(([f, t]) => Math.abs(w(f + ", monospace", t) - w(f + ", serif", t)) > .01).map(([f]) => f);
    }, FONTS);
    const out = path.join(draft || here, doc.pdf), tmp = out + ".part";
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.pdf({ path: tmp, printBackground: true, preferCSSPageSize: true });
    await page.close();
    const buf = fs.readFileSync(tmp), facts = pdfFacts(buf);
    // the fonts the PDF really embeds decide (check.mjs); a font that seems missing here is only a hint of why
    if (missing.length) console.log(`note: ${missing.join(", ")} seem(s) not to be installed here, or not to draw every test glyph`);
    const fails = [...checkPdf(buf, { pages: doc.pages }),
      ...(name === "guide" ? checkSources() : [])];
    console.log(`${doc.pdf}: ${facts.pages} pages, ${Math.round(buf.length / 1024)} KB, fonts ${facts.fonts.join(", ")}`);
    for (const f of fails) console.log((draft ? "DRAFT " : "FAIL ") + f);
    if (fails.length && !draft) { fs.rmSync(tmp); failed = true; console.log("not written: the committed PDF is kept"); continue; }
    fs.renameSync(tmp, out);
    console.log("wrote", path.relative(process.cwd(), out) + (draft ? "  (a draft: do not commit)" : ""));
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
