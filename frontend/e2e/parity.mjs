// Renders every table of the fixture workbooks with the v2 app (git history) and with v3, compares the HTML.
// usage: node e2e/parity.mjs <old slide_builder.html> <new slide_builder.html> <xlsx>...
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [oldHtml, newHtml, ...books] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ranges = { "SLIDE_2 panel": "B3:D12", "Data": "A3:E11" };
async function run(file, mode) {
  const page = await browser.newPage();
  await page.goto("file://" + file);
  await page.waitForTimeout(500);
  const out = {};
  for (const b of books) {
    const b64 = fs.readFileSync(b).toString("base64"), name = b.split("/").pop();
    out[name] = await page.evaluate(async ([b64, name, mode, ranges]) => {
      const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
      const res = {};
      const g = r => { const [a, z] = r.split(":"); const p = x => { const m = /^([A-Z]+)(\d+)$/.exec(x); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { r: +m[2], c }; }; const s = p(a), e = p(z); return { r1: s.r - 1, c1: s.c - 1, r2: e.r + 1, c2: e.c + 1 }; };
      if (mode === "old") {
        DOC.name = name;
        const wb = await readWorkbook(buf);
        for (const S of wb.sheets) {
          const Ls = [...S.tables]; if (ranges[S.name]) Ls.push(buildLayout(S, g(ranges[S.name])));
          Ls.forEach((L, i) => { L.sheet = S; L.items.forEach(it => it.L = L);
            SETTINGS.app.design = "excel"; res[S.name + "#" + i + " excel"] = renderExcel(L);
            SETTINGS.app.design = "glass"; res[S.name + "#" + i + " glass"] = renderGlass(L); });
          res[S.name + " cells"] = [...S.cells.values()].map(x => x.r + "," + x.c + "=" + formatValue(x).text).join("|");
        }
      } else {
        const T = window.__sbTest, wb = await T.readWorkbook(buf);
        const ctx = { style: T.resolveStyle(), edits: {}, slides: [], preset: null, workbook: name, logoSrc: "" };
        for (const S of wb.sheets) {
          const Ls = [...S.tables]; if (ranges[S.name]) Ls.push(T.buildLayout(S, g(ranges[S.name])));
          Ls.forEach((L, i) => { L.sheet = S; L.items.forEach(it => it.L = L);
            res[S.name + "#" + i + " excel"] = T.renderExcel(L, { ...ctx, style: { ...ctx.style, design: "excel" } });
            res[S.name + "#" + i + " glass"] = T.renderGlass(L, ctx); });
          res[S.name + " cells"] = [...S.cells.values()].map(x => x.r + "," + x.c + "=" + T.formatValue(x).text).join("|");
        }
      }
      return res;
    }, [b64, name, mode, ranges]);
  }
  await page.close();
  return out;
}
const A = await run(oldHtml, "old"), B = await run(newHtml, "new");
let same = 0, diff = 0;
for (const book of Object.keys(A)) for (const k of Object.keys(A[book])) {
  const a = A[book][k], b = B[book][k];
  if (a === b) { same++; continue; }
  diff++;
  if (k.endsWith("cells")) {
    const am = a.split("|"), bm = (b || "").split("|");
    console.log(`DIFF ${book} ${k}:`); am.forEach((x, i) => { if (x !== bm[i]) console.log("   v2:", x, "\n   v3:", bm[i]); });
  } else {
    let i = 0; while (i < a.length && a[i] === (b || "")[i]) i++;
    console.log(`DIFF ${book} ${k} (len ${a.length} vs ${(b || "").length}) at ${i}:\n   v2: …${a.slice(Math.max(0, i - 120), i + 160)}\n   v3: …${(b || "").slice(Math.max(0, i - 120), i + 160)}`);
  }
}
console.log(`identical: ${same}, different: ${diff}`);
await browser.close();
