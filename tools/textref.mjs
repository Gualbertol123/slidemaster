/* Reference widths for the core's text shaping (PLAN S3.2): the golden slide texts measured by Chromium's canvas
   (which shapes with HarfBuzz too: kern and liga on) with the test fonts loaded from their bytes. The unit test
   core/tests/shape.test.ts shapes the same strings with core/src/text and compares.
     node tools/textref.mjs      → core/tests/fixtures/text/chromium-widths.json
   Re-run only when the corpus or the test fonts change. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = require("playwright");

/** the distinct lines of the golden slides' texts (every deck, design, version), sorted */
export function corpus() {
  const out = new Set();
  const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) k === "text" && typeof v === "string" ? out.add(v) : walk(v); };
  const g = path.join(ROOT, "golden");
  for (const deck of fs.readdirSync(g)) {
    const dd = path.join(g, deck); if (!fs.statSync(dd).isDirectory()) continue;
    for (const design of fs.readdirSync(dd)) for (const ver of fs.readdirSync(path.join(dd, design)))
      for (const f of fs.readdirSync(path.join(dd, design, ver))) if (/^slide-\d+\.json$/.test(f)) walk(JSON.parse(fs.readFileSync(path.join(dd, design, ver, f), "utf8")));
  }
  // lines: a text box's line breaks are the layout's business (breakLines), a run never contains one
  return [...new Set([...out].flatMap(s => s.split("\n")).map(s => s.trim()).filter(Boolean))].sort();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("textref.mjs")) {
  const texts = corpus(), fonts = { regular: "Carlito-Regular.ttf", bold: "Carlito-Bold.ttf" }, sizes = [14.67, 40];
  const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
  const page = await browser.newPage();
  const widths = await page.evaluate(async ({ fonts, texts, sizes }) => {
    const out = {};
    const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    for (const [k, b64] of Object.entries(fonts)) {
      const f = new FontFace("Ref" + k, bytes(b64)); await f.load(); document.fonts.add(f);
      const ctx = new OffscreenCanvas(10, 10).getContext("2d");
      out[k] = {};
      for (const sz of sizes) { ctx.font = `${sz}px Ref${k}`; out[k][sz] = texts.map(t => +ctx.measureText(t).width.toFixed(4)); }
    }
    return out;
  }, { fonts: Object.fromEntries(Object.entries(fonts).map(([k, f]) => [k, fs.readFileSync(path.join(ROOT, "core/tests/fixtures/fonts", f)).toString("base64")])), texts, sizes });
  const version = browser.version();
  await browser.close();
  const outFile = path.join(ROOT, "core/tests/fixtures/text/chromium-widths.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ chromium: version, fonts, sizes, texts, widths }) + "\n");
  console.log(`${texts.length} texts × ${Object.keys(fonts).length} fonts × ${sizes.length} sizes, Chromium ${version} → ${path.relative(ROOT, outFile)}`);
}
