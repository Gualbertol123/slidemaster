/* Parity of the display list with the goldens (PLAN S3.3–S3.5; 05 §1 GG, GP; 05 §3.2), for the three designs, drawn
   on a canvas – the backend of the PNG export and, from S4.3, the thumbnails (the stage's SVG is tools/parity.mjs's,
   with SP). The app is captured as tools/capture-v3.mjs does (same decks, designs, versions, slides, clock), but for
   each slide what the goldens hold is taken from the whole slide's display list the core worker builds (slideLists):
   - geometry and texts (GG, GT): the goldens' elements paired with the display list's hits (tools/stage-capture.mjs
     pairWithGolden: table items by table, kind and order, the slide's own by their classes and order; hits the goldens
     do not have are elements too many); editing aids (handles, the empty-slide hint) take the stage's own boxes. From
     M4 the page has no HTML slide on its stage, so the elements come from the goldens, not from the page (until S4.1
     the page's HTML, and the text origins against its layout: SP checks origins from M4, screen against PDF);
   - pixels (GP): the whole slide drawn from the display list on a canvas as the page paints it – opaque (subpixel
     text), each table on a layer of its own (grey anti-aliasing, start on a whole pixel), as the stage composites it;
   - for Liquid Glass, the GP summary per theme × glass level × contrast of the corpus (report-dl/gp-glass.json).
   tools/parity.mjs's compare() then judges geometry and pixels with the usual tolerances; differences listed in
   tests/parity/accepted.json with "tool": "dlparity" are accepted.

     node tools/dlparity.mjs [--designs excel,clean,glass] [--decks a,b] [--keep] [--actual DIR] [--control [text]]   (npm run dlparity)

   Pixels: a pixel passes when within CIEDE2000 2 of the other image's at it or at a neighbour, or when its colour lies
   within the range of the other image's 3 × 3 neighbourhood (parity.mjs comparePixels opts.range: decision G1-4); the
   figures under the whole-pixel rule alone are printed for information. A deck that differs is captured once more
   (a page caught mid-redraw) and only what differs again counts.

   Report: tests/parity/report-dl/index.html. Exit 1 on any difference not accepted. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capture, DECKS } from "./capture-v3.mjs";
import { compare, writeReport } from "./parity.mjs";
import { pairWithGolden, settleStage, stageSlide } from "./stage-capture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESIGNS = arg("--designs", "excel,clean,glass").split(",");
/** --control [text]: a negative control – every display-list table moved 3 px right (or, with "text", every text run
    1.5 px down); the run must then report differences, or the comparison is too loose */
const CONTROL = process.argv.includes("--control") ? (arg("--control", "") === "text" ? "text" : "tables") : null;
const SHIFT = CONTROL === "tables" ? 3 : 0, TEXT_SHIFT = CONTROL === "text" ? 1.5 : 0;
const GOLDEN = path.join(REPO, "golden");

/** the current slide's elements from the whole slide's display list (S3.5: furniture and tables); the slide drawn from
    it when pixels are asked */
async function slideHook(page, { deck, dir, design, version, slide, geometry, pixels }) {
  await settleStage(page);
  const nodes = await page.evaluate(async ({ design, version, slide, SHIFT, TEXT_SHIFT }) => {
    const [one] = await window.__sbTest.slideLists({ design, version, forExport: false, thumb: false, slides: [slide] });
    const nodes = one ? one.dl.nodes : [];
    if (TEXT_SHIFT) { const mv = ns => ns.forEach(n => { if (n.t === "text") n.y += TEXT_SHIFT; else if (n.t === "group") mv(n.children); }); mv(nodes); }
    if (SHIFT) nodes.forEach((n, i) => { if (n.t === "group" && n.transform && nodes[i - 1]?.t === "hit" && nodes[i - 1].id === "tw") n.transform = [...n.transform.slice(0, 4), n.transform[4] + SHIFT, n.transform[5]]; });
    return nodes;
  }, { design, version, slide, SHIFT, TEXT_SHIFT });
  const shown = await stageSlide(page);
  const gf = path.join(GOLDEN, deck, design, path.basename(dir), `slide-${slide + 1}.json`);
  const golden = fs.existsSync(gf) ? JSON.parse(fs.readFileSync(gf, "utf8")) : { items: [] };
  const { items, ...head } = pairWithGolden(golden, { ...shown, nodes });
  const g = { ...head, slide: geometry.slide, label: geometry.label, items };
  let png = null;
  if (pixels) {
    // the whole slide drawn from its display list
    const data = await page.evaluate(async ({ design, version, slide, SHIFT, TEXT_SHIFT }) => {
      const T = window.__sbTest;
      const [one] = await T.slideLists({ design, version, forExport: false, thumb: false, slides: [slide] });
      const nodes = one ? one.dl.nodes : [];
      if (TEXT_SHIFT) { const mv = ns => ns.forEach(n => { if (n.t === "text") n.y += TEXT_SHIFT; else if (n.t === "group") mv(n.children); }); mv(nodes); }
      if (SHIFT) nodes.forEach((n, i) => { if (n.t === "group" && n.transform && nodes[i - 1]?.t === "hit" && nodes[i - 1].id === "tw") n.transform = [...n.transform.slice(0, 4), n.transform[4] + SHIFT, n.transform[5]]; });
      const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
      // as the page paints: the slide opaque (its text with subpixel anti-aliasing), each table – transformed by CSS
      // (scale(), never exactly 1 in the corpus), so composited apart and anti-aliased in grey – on a layer of its own.
      // This compositing is the tool's, not drawDl's: the screen (M4) and the PNG export must do the same (named for G1)
      const c = document.createElement("canvas"); c.width = 1600; c.height = 900;
      const ctx = c.getContext("2d", { alpha: false }), imgs = new Map();
      for (const [id, src] of Object.entries(one ? one.dl.images : {})) { try { imgs.set(id, await load(src)); } catch { /* left out, as a broken picture */ } }
      const opts = { image: id => imgs.get(id), layer: () => { const o = new OffscreenCanvas(1600, 900); return { ctx: o.getContext("2d"), image: o }; } };
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1600, 900);
      nodes.forEach((n, i) => {
        if (n.t === "group" && nodes[i - 1]?.t === "hit" && nodes[i - 1].id === "tw") {
          const o = new OffscreenCanvas(1600, 900);
          T.drawDl(o.getContext("2d"), [n], opts);
          ctx.drawImage(o, 0, 0);
        } else T.drawDl(ctx, [n], opts);
      });
      return c.toDataURL("image/png").split(",")[1];
    }, { design, version, slide, SHIFT, TEXT_SHIFT });
    png = Buffer.from(data, "base64");
  }
  return { geometry: g, png };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const golden = path.join(REPO, "golden"), report = path.join(REPO, "tests", "parity", "report-dl");
  const acceptedFile = path.join(REPO, "tests", "parity", "accepted.json");
  const decks = arg("--decks", null)?.split(",") || null;
  const given = arg("--actual", null), actual = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), "sb-dlparity-"));
  if (!given) {
    console.log(`display list of ${DESIGNS.join(", ")}: capturing…`);
    await capture(actual, { decks: decks || undefined, designs: DESIGNS, pdf: false, quiet: !process.argv.includes("--verbose"), noGeometry: true, slideHook });
  }
  const accepted = fs.existsSync(acceptedFile) ? JSON.parse(fs.readFileSync(acceptedFile, "utf8")) : [];
  const evaluate = () => {
    const res = compare(golden, actual, { accepted, decks, designs: DESIGNS, pdf: false, tool: "dlparity", pixelRange: true });
    res.unaccepted = res.diffs.filter(d => !d.accepted).length;
    return res;
  };
  let res = evaluate();
  // a deck that differs is captured once more (the page can be caught while it redraws a slide); what differs again counts
  const flaky = [...new Set(res.diffs.filter(d => !d.accepted).map(d => d.deck))];
  if (flaky.length && !given && !CONTROL) {
    console.log(`re-capturing ${flaky.join(", ")} once; first capture: ${res.diffs.filter(d => !d.accepted).slice(0, 6).map(d => `${d.deck}/${d.design}/${d.file} ${d.kind}: ${String(d.detail).slice(0, 80)}`).join(" | ")}`);
    const again = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dlparity-again-"));
    await capture(again, { decks: flaky, designs: DESIGNS, pdf: false, quiet: true, noGeometry: true, slideHook });
    for (const deck of flaky) { fs.rmSync(path.join(actual, deck), { recursive: true, force: true }); fs.cpSync(path.join(again, deck), path.join(actual, deck), { recursive: true }); }
    fs.rmSync(again, { recursive: true, force: true });
    res = evaluate();
    res.recaptured = flaky;
  }
  // for information: the pixels under the stricter whole-pixel dilation (parity.mjs's default rule)
  const strict = compare(golden, actual, { accepted: [], decks, designs: DESIGNS, pdf: false, tool: "dlparity" }).diffs.filter(d => d.kind === "pixels");
  console.log(`pixels under the whole-pixel dilation alone (information): ${strict.length} slide(s) beyond the limit${strict.length ? ": " + strict.slice(0, 6).map(d => `${d.deck}/${d.design}/${d.file}`).join(", ") : ""}`);
  writeReport(res, report);
  if (DESIGNS.includes("glass")) {
    // GP for Liquid Glass per theme × glass level × contrast of the corpus (PLAN S3.4): each look's decks and slides,
    // the screenshots within the pixel limit and those beyond it with their share
    const looks = {};
    for (const m of res.pixels.filter(m => m.design === "glass")) {
      const deck = JSON.parse(fs.readFileSync(path.join(DECKS, m.deck + ".json"), "utf8")), st = {};
      for (const o of deck.ops) if (o.op === "style.patch") Object.assign(st, o.patch);
      const key = `${st.theme?.id || "aurora"} × ${st.glass || "subtle"} × contrast ${st.contrast ?? 50}`;
      const d = res.diffs.find(x => x.kind === "pixels" && x.deck === m.deck && x.design === "glass" && x.version === m.version && x.file === m.file);
      (looks[key] ||= []).push({ deck: m.deck, version: m.version, file: m.file, differing: +(m.fraction * 100).toFixed(2), maxDE: m.maxDE, within: !d, accepted: d?.accepted?.reason || null });
    }
    fs.writeFileSync(path.join(report, "gp-glass.json"), JSON.stringify(looks, null, 1));
    for (const [k, v] of Object.entries(looks)) console.log(`GP glass · ${k}: ${v.length} screenshot(s), ${v.filter(x => x.within).length} within the limit, at most ${Math.max(...v.map(x => x.differing))} % of the pixels differing (${[...new Set(v.map(x => x.deck))].join(", ")})`);
  }
  const kinds = {};
  for (const d of res.diffs) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
  for (const d of res.diffs.filter(d => !d.accepted).slice(0, 40)) console.log(`DIFF  ${d.deck} · ${d.design} · ${d.version} · ${d.file} · ${d.kind}: ${d.detail}`);
  // every difference as data (as parity.mjs --diffs)
  if (arg("--diffs", null)) fs.writeFileSync(path.resolve(arg("--diffs", null)), JSON.stringify(res.diffs.map(({ accepted, ...d }) => ({ ...d, accepted: !!accepted })), null, 1));
  console.log(`dlparity (${DESIGNS.join(", ")}): ${res.diffs.length} difference(s) ${JSON.stringify(kinds)}, ${res.unaccepted} not accepted (${res.full ? "full" : "text-only"} comparison)${res.recaptured ? ` (re-captured once: ${res.recaptured.join(", ")})` : ""} - report: ${path.relative(process.cwd(), path.join(report, "index.html"))}`);
  if (!given && !process.argv.includes("--keep")) fs.rmSync(actual, { recursive: true, force: true }); else console.log("capture kept in " + actual);
  if (CONTROL) {
    // the negative control passes when the moved tables (geometry and pixels) or text runs (pixels) were caught
    const caught = CONTROL === "tables" ? res.diffs.some(d => d.kind === "geometry") && (!res.full || res.diffs.some(d => d.kind === "pixels")) : res.diffs.some(d => d.kind === "pixels");
    console.log(caught ? `negative control (${CONTROL}): detected (${res.diffs.length} differences)` : `negative control FAILED (${CONTROL}): went unnoticed`);
    process.exitCode = caught ? 0 : 1;
  } else process.exitCode = res.unaccepted ? 1 : 0;
}
export { slideHook };
