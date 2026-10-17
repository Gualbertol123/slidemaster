// Prints the two documents of docs/guide with Playwright's Chromium (README §11.1):
//   guide.html  → "Slide Builder 4 – guide.pdf"   (A4, the full guide)
//   launch.html → "Slide Builder 4 – launch.pdf"  (16:9 slides, the launch presentation)
// Usage, from the repository root:  node docs/guide/build.mjs [guide|launch]
// Then check them:                  python tools/pdfcheck.py info "docs/guide/Slide Builder 4 – guide.pdf"
// Page size, margins, running header and page numbers come from each file's CSS (@page), so pdf() is told to use them.
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = {
  guide: { html: "guide.html", pdf: "Slide Builder 4 – guide.pdf" },
  launch: { html: "launch.html", pdf: "Slide Builder 4 – launch.pdf" },
};
const which = process.argv[2] ? [process.argv[2]] : Object.keys(DOCS);
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
    const out = path.join(here, doc.pdf);
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
    console.log("wrote", path.relative(process.cwd(), out), Math.round(fs.statSync(out).size / 1024), "KB");
    await page.close();
  }
} finally {
  await browser.close();
}
