/* Goldens of the designs v3 never had (M7b, 08 §3; ADR-011: goldens are evidence): the consulting designs' slides as
   this build draws them, captured AFTER the product owner's pixel sign-off (S7b.3), in the goldens' own formats, so
   tools/parity.mjs and tools/dlparity.mjs hold every later build to them.

   Each deck × design × version as capture-v3.mjs walks it; for each slide its elements are the display list's hits, named
   the way tools/stage-capture.mjs pairWithGolden pairs them (the slide's own by their hit id, a table's by kind in
   order after its "tw"), with their boxes, texts and first-run styles; the pixels of tests/corpus/pixels.json are the
   stage's own screenshot at 100 % (as GP's goldens, stage-capture.mjs stageHook); comments.json, issues.json and pdf.json as
   capture-v3 writes them. Written into golden/<deck>/<design>/<version>/ (only for the designs asked; nothing else in
   golden/ is touched) and golden/MANIFEST-v4.json (this environment: the comparison of these designs is full where
   Chromium and fonts are the same).

     node tools/capture-v4.mjs [--designs mckinsey,bain] [--decks a,b] [--out DIR]   (default DIR: golden/)
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capture } from "./capture-v3.mjs";
import { hitsOf, pairWithGolden, settleStage, stageSlide } from "./stage-capture.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
export const V4_DESIGNS = ["mckinsey", "bain"];

/** a golden's element list for a display list: what pairWithGolden pairs back to the same hits */
export function elementsOf(nodes) {
  const items = [];
  for (const h of hitsOf(nodes).filter(h => h.n.kind !== "cap")) {
    const cls = h.table === null ? (h.n.kind === "f" ? h.n.id : h.n.kind) : h.n.kind;
    items.push({ cls, ...(h.n.label !== undefined ? { text: "" } : {}) });
  }
  return { items };
}

/** capture-v3's slideHook: the slide's elements from its display list, its pixels the stage's screenshot */
async function hook(page, a) {
  await settleStage(page);
  const nodes = await page.evaluate(async ({ design, version, slide }) => {
    const [one] = await window.__sbTest.slideLists({ design, version, forExport: false, thumb: false, slides: [slide] });
    return one ? one.dl.nodes : [];
  }, { design: a.design, version: a.version, slide: a.slide });
  const shown = await stageSlide(page);
  const { items, ...head } = pairWithGolden(elementsOf(nodes), { ...shown, nodes });
  const bad = items.filter(i => /^(missing|extra)-/.test(i.cls));
  if (bad.length) throw new Error(`${a.deck} · ${a.design} · slide ${a.slide + 1}: elements that do not pair back: ${bad.map(i => i.cls).join(", ")}`);
  // the pixels as GP defines them for every golden (stage-capture.mjs): the stage's own screenshot at 100 % – parity
  // compares the stage with them, dlparity its canvas drawing under its own rule (as against v3's DOM screenshots)
  const b = a.pixels ? await page.locator("#stage .slide").first().boundingBox() : null;
  const png = b ? await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" }) : null;
  return { geometry: { ...head, slide: a.geometry.slide, label: a.geometry.label, items }, png };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const designs = arg("--designs", V4_DESIGNS.join(",")).split(",");
  if (designs.some(d => !V4_DESIGNS.includes(d))) throw new Error("capture-v4 writes the goldens of " + V4_DESIGNS.join(", ") + " only (the others are v3's: capture-v3.mjs)");
  const out = path.resolve(arg("--out", path.join(REPO, "golden"))), decks = arg("--decks", null)?.split(",");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-capture-v4-"));
  console.log(`capturing ${designs.join(", ")}…`);
  const manifest = await capture(tmp, { decks, designs, quiet: !process.argv.includes("--verbose"), noGeometry: true, slideHook: hook });
  for (const deck of manifest.decks) for (const d of designs) {
    const src = path.join(tmp, deck, d), dst = path.join(out, deck, d);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    // the native PDF kept for SP is not a golden (sp/): the PDF's facts are pdf.json
    fs.cpSync(src, dst, { recursive: true, filter: f => path.basename(f) !== "sp" });
  }
  fs.writeFileSync(path.join(out, "MANIFEST-v4.json"), JSON.stringify(manifest, null, 1) + "\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`capture-v4: ${manifest.slides} slide(s) of ${designs.join(", ")} in ${path.relative(process.cwd(), out)} (MANIFEST-v4.json)`);
}
