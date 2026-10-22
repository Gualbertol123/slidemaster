// Checks of the guide (docs/next/PROMPTS.md Prompt 16 and the G16 review), run by build.mjs and on their own:
//   node docs/guide/check.mjs [file.pdf]        (from the repository root; default: the committed guide PDF)
// 1. the placeholders for the parts merged after 4.6 stand in guide.md and guide.html alike, one for one;
// 2. every picture guide.html shows exists in img/;
// 3. the PDF has 14–20 A4 pages (Prompt 16 "LENGTH AND SHAPE");
// 4. the PDF's fonts are the product's: Segoe UI (regular, semibold, bold, italic), Segoe UI Symbol and Consolas only –
//    any other font (DejaVu, FreeSerif, Inter, a Type 3 bitmap font…) means a glyph fell back to a font the guide does
//    not use, e.g. a symbol (✦ ↶ ↷ ⤺ ◯ 🗑 ⚙ ✎) printed in a serif face. Chrome's PDFs name each embedded font in the
//    clear ("/BaseFont /AAAAAA+SegoeUI-Bold"), so the names are read from the file's bytes.
// Exit code 1 and one line per problem when a check fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GUIDE_PDF = path.join(here, "Slide Builder 4 – guide.pdf");
export const PAGES = [14, 20];
/** the fonts the guide may embed: guide.css --font (Segoe UI, Segoe UI Symbol) and code (Consolas) */
export const FONT_OK = /^(SegoeUI(-Bold|-Semibold|-Italic|-BoldItalic|-SemiboldItalic|-Light)?|SegoeUISymbol|Consolas(-Bold|-Italic)?)$/;

/** the placeholder comments ("4.7: …", "4.8: …", "4.9: …", "template, comments B48–B50") and how often each stands */
export function placeholders(text) {
  const n = {};
  for (const m of text.matchAll(/<!-- (4\.\d+: [^<>]*?|template, comments B48–B50) -->/g)) n[m[1]] = (n[m[1]] || 0) + 1;
  return n;
}

/** fonts and page count of a PDF written by Chrome */
export function pdfFacts(buf) {
  const s = buf.toString("latin1");
  const fonts = [...new Set([...s.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/<>\[\]()]+)/g)].map(m => m[1]))].sort();
  const type3 = (s.match(/\/Subtype\s*\/Type3/g) || []).length;
  const pages = (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
  return { fonts, type3, pages };
}

/** the problems of one PDF (empty: all good) */
export function checkPdf(buf, { pages = PAGES } = {}) {
  const f = pdfFacts(buf), out = [];
  if (f.pages < pages[0] || f.pages > pages[1]) out.push(`${f.pages} pages: the guide must have ${pages[0]}–${pages[1]}`);
  const bad = f.fonts.filter(x => !FONT_OK.test(x));
  if (bad.length) out.push(`fonts that are not the product's (Segoe UI, Segoe UI Symbol, Consolas): ${bad.join(", ")} – build where Segoe UI is installed`);
  if (f.type3) out.push(`${f.type3} Type 3 (bitmap) font(s): a glyph fell back to a font the guide does not use`);
  if (!f.fonts.some(x => /^SegoeUI(-|$)/.test(x))) out.push("Segoe UI is not embedded");
  return out;
}

/** the problems of the sources (empty: all good) */
export function checkSources() {
  const out = [];
  const md = fs.readFileSync(path.join(here, "guide.md"), "utf8"), html = fs.readFileSync(path.join(here, "guide.html"), "utf8");
  const a = placeholders(md), b = placeholders(html);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if ((a[k] || 0) !== (b[k] || 0)) out.push(`placeholder "${k}": ${a[k] || 0} in guide.md, ${b[k] || 0} in guide.html`);
  for (const m of html.matchAll(/src="(img\/[^"]+)"/g))
    if (!fs.existsSync(path.join(here, m[1]))) out.push("missing picture " + m[1]);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pdf = process.argv[2] || GUIDE_PDF;
  const problems = [...checkSources(), ...checkPdf(fs.readFileSync(pdf)).map(p => path.basename(pdf) + ": " + p)];
  const f = pdfFacts(fs.readFileSync(pdf));
  console.log(`${path.basename(pdf)}: ${f.pages} pages; fonts ${f.fonts.join(", ")}${f.type3 ? `; ${f.type3} Type 3` : ""}`);
  console.log(`placeholders: ${JSON.stringify(placeholders(fs.readFileSync(path.join(here, "guide.md"), "utf8")))}`);
  for (const p of problems) console.log("FAIL", p);
  if (problems.length) process.exit(1);
  console.log("OK");
}
