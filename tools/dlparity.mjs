/* Parity of the display list with the goldens (PLAN S3.3–S3.5; 05 §1 GG, GP; 05 §3.2), for the three designs. The app is captured as
   tools/capture-v3.mjs does (same decks, designs, versions, slides, clock), but for each slide what the goldens hold
   is taken from the display list the core worker builds (its text measured by the page, decision 2026-10-12, 3):
   - geometry (GG): the table items (.t cells, .tbox text boxes, .pic pictures, Liquid Glass's .wb materials) get the
     display list's boxes, texts, colours, sizes, weights, styles and font families, placed where the slide places the
     table; everything else is the page's;
   - pixels (GP): the page with its HTML tables hidden, the display lists drawn over it on a canvas;
   - text origins (05 GG "text origins 1 px"): every run of a cell (while the page's text nodes and the display
     list's runs are the same strings) and a text box's first run against the page's own layout (the text's Range for
     x, a zero-size inline-block on its baseline; this build, these fonts) within 1 px; text-shadow copies left out;
   - for Liquid Glass, the GP summary per theme × glass level × contrast of the corpus (report-dl/gp-glass.json).
   tools/parity.mjs's compare() then judges geometry and pixels with the usual tolerances; differences listed in
   tests/parity/accepted.json with "tool": "dlparity" are accepted.

     node tools/dlparity.mjs [--designs excel,clean,glass] [--decks a,b] [--keep] [--actual DIR] [--control [text]]   (npm run dlparity)

   Pixels: a pixel passes when within CIEDE2000 2 of the other image's at it or at a neighbour, or when its colour lies
   within the range of the other image's 3 × 3 neighbourhood (parity.mjs comparePixels opts.range: two renderers –
   the page's HTML and the display list's canvas – place and anti-alias edges a fraction of a pixel apart); the
   figures under the whole-pixel rule alone are printed for information. A deck that differs is captured once more
   (a page caught mid-redraw) and only what differs again counts.

   Report: tests/parity/report-dl/index.html. Exit 1 on any difference not accepted. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capture, DECKS, SEL } from "./capture-v3.mjs";
import { compare, writeReport } from "./parity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESIGNS = arg("--designs", "excel,clean,glass").split(",");
const ORIGIN_TOL = 1;
/** --control [text]: a negative control – every display-list table moved 3 px right (or, with "text", every text run
    1.5 px down); the run must then report differences, or the comparison is too loose */
const CONTROL = process.argv.includes("--control") ? (arg("--control", "") === "text" ? "text" : "tables") : null;
const SHIFT = CONTROL === "tables" ? 3 : 0, TEXT_SHIFT = CONTROL === "text" ? 1.5 : 0;

/** the table items of the current slide replaced by the display list's; the composite picture when asked */
async function slideHook(page, { design, version, slide, geometry, pixels }) {
  const r = await page.evaluate(async ({ design, version, slide, SEL, SHIFT, TEXT_SHIFT, ORIGIN_TOL }) => {
    const T = window.__sbTest, root = document.querySelector("#stage .slide"), sr = root.getBoundingClientRect(), k = sr.width / 1600;
    const lists = await T.displayLists({ design, version, forExport: false, thumb: false, slides: [slide] });
    if (TEXT_SHIFT) { const mv = ns => ns.forEach(n => { if (n.t === "text") n.y += TEXT_SHIFT; else if (n.t === "group") mv(n.children); }); lists.forEach(l => mv(l.dl.nodes)); }
    // where the slide puts each table: the .tw element's box, its scale from its own (untransformed) width
    const place = {};
    for (const el of root.querySelectorAll(".tw[data-i]")) {
      const b = el.getBoundingClientRect(), s = (b.width / k) / (el.offsetWidth || 1);
      place[el.dataset.i] = { x: (b.left - sr.left) / k + SHIFT, y: (b.top - sr.top) / k, s };
    }
    const r1 = v => Math.round(v * 10) / 10;
    // colours and family lists as getComputedStyle writes them
    const rgb = (c, a = 1) => a < 1 ? `rgba(${c.map(Math.round).join(", ")}, ${+a.toFixed(2)})` : `rgb(${c.map(Math.round).join(", ")})`;
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/;
    const cssFamilies = css => css.split(",").map(f => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean).map(f => GENERIC.test(f) || /^-?[A-Za-z_][\w-]*$/.test(f) ? f : `"${f}"`).join(", ");
    /** the hits of a list, each with the text nodes after it (until the next hit), in slide px */
    const hitsOf = (nodes, P) => {
      const out = []; let cur = null;
      const walk = (ns, M) => ns.forEach(n => {
        // a hit's box as the page reports an element's: the bounding box of its corners after every transform
        if (n.t === "hit") {
          const pts = [[n.x, n.y], [n.x + n.w, n.y], [n.x, n.y + n.h], [n.x + n.w, n.y + n.h]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          cur = { n: { ...n, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, texts: [] }; out.push(cur);
        }
        else if (n.t === "text" && cur && !n.decorative) cur.texts.push({ n, M });     // (a text-shadow copy is not the text)
        else if (n.t === "group") walk(n.children, n.transform ? mul(M, n.transform) : M);
      });
      const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
      walk(nodes, [P.s, 0, 0, P.s, P.x, P.y]);
      return out;
    };
    const byTable = {};
    for (const l of lists) byTable[l.table] = hitsOf(l.dl.nodes, place[l.table] || { x: 0, y: 0, s: 1 });
    // the page's items, in the goldens' order (capture-v3 geometry()): table items take the display list's values
    const els = [...root.querySelectorAll(SEL)], repl = [], origins = [], seen = {};
    els.forEach((el, idx) => {
      const tw = el.closest(".tw[data-i]"), kind = el.matches(".t") ? "t" : el.matches(".tbox") ? "tbox" : el.matches(".pic") ? "pic" : el.matches(".wb") ? "wb" : null;
      if (!tw || !kind || !byTable[tw.dataset.i]) return;
      const key = tw.dataset.i + kind, n = seen[key] = (seen[key] ?? -1) + 1;
      const hit = byTable[tw.dataset.i].filter(h => h.n.kind === kind)[n];
      if (!hit) { repl.push({ idx, missing: true }); return; }
      const h = hit.n, first = hit.texts[0];                        // (already in slide px: hitsOf applies the placement)
      const item = { idx, x: r1(h.x), y: r1(h.y), w: r1(h.w), h: r1(h.h) };
      if (h.label !== undefined && kind !== "pic") item.text = h.label;
      if (first && kind === "t") {
        const t = first.n;
        item.color = rgb(t.fill.solid, t.fill.a); item.size = `${t.size}px`; item.weight = String(t.weight ?? (t.b ? 700 : 400)); item.style = t.i ? "italic" : undefined;
        if (t.css) item.font = cssFamilies(t.css);                  // the family list the display list draws with, as Chrome serialises it
      }
      // the runs' origins against the page's own layout: every run of a cell while the page's text nodes and the
      // display list's runs are the same strings (a superscript is its own node and run), a text box's first run
      if ((kind === "t" || kind === "tbox") && hit.texts.length) {
        const nodes = [...el.querySelectorAll("*"), el].flatMap(e => [...e.childNodes]).filter(c => c.nodeType === 3 && c.textContent.trim());
        nodes.sort((x, y) => x.compareDocumentPosition(y) & 4 ? -1 : 1);
        const pairs = kind === "tbox" ? 1 : Math.min(nodes.length, hit.texts.length);
        for (let q = 0; q < pairs; q++) {
          const node = nodes[q], dl = hit.texts[q], t = dl.n;
          if (q > 0 && node.textContent.replace(/\s+/g, " ").trim() !== t.src.trim()) break;
          if (dl.M[1] || dl.M[2]) break;                              // rotated runs: not compared here
          const probe = document.createElement("span"); probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
          let wrap = null;
          if (node.parentNode === el) { wrap = document.createElement("span"); el.insertBefore(wrap, node); wrap.appendChild(probe); wrap.appendChild(node); }
          else node.parentNode.insertBefore(probe, node);
          const pr = probe.getBoundingClientRect();
          probe.remove(); if (wrap) { el.insertBefore(node, wrap); wrap.remove(); }
          // x from the text's own box (a probe would turn a leading space, which CSS collapses at the line start, into
          // a visible one and move the text); the baseline from the probe
          const range = document.createRange(); range.selectNodeContents(node);
          const rx = [...range.getClientRects()][0];
          const M = dl.M, dx = M[0] * t.x + M[4], base = M[3] * t.y + M[5];
          const domX = ((rx ? rx.left : pr.left) - sr.left) / k, domBase = (pr.top - sr.top) / k;
          if (Math.abs(domX - dx) > ORIGIN_TOL || Math.abs(domBase - base) > ORIGIN_TOL) origins.push({ idx, text: t.src.slice(0, 40), dl: [r1(dx), r1(base)], page: [r1(domX), r1(domBase)] });
        }
      }
      repl.push(item);
    });
    return { repl, origins, lists: lists.length };
  }, { design, version, slide, SEL, SHIFT, TEXT_SHIFT, ORIGIN_TOL });
  const g = structuredClone(geometry);
  for (const it of r.repl) {
    if (it.missing) { g.items[it.idx] = { ...g.items[it.idx], cls: "missing-in-display-list" }; continue; }
    const { idx, ...v } = it; g.items[idx] = { ...g.items[idx], ...v };
    if (v.style === undefined) delete g.items[idx].style;
  }
  g.origins = r.origins;
  let png = null;
  if (pixels) {
    // the page without its HTML tables, then the display lists drawn over it
    await page.evaluate(() => document.querySelectorAll("#stage .slide .tw .xt").forEach(e => { e.style.visibility = "hidden"; }));
    const b = await page.locator("#stage .slide").first().boundingBox();
    const shot = await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" });
    await page.evaluate(() => document.querySelectorAll("#stage .slide .tw .xt").forEach(e => { e.style.visibility = ""; }));
    const data = await page.evaluate(async ({ design, version, slide, shot, SHIFT, TEXT_SHIFT }) => {
      const T = window.__sbTest, root = document.querySelector("#stage .slide"), sr = root.getBoundingClientRect(), k = sr.width / 1600;
      const lists = await T.displayLists({ design, version, forExport: false, thumb: false, slides: [slide] });
      if (TEXT_SHIFT) { const mv = ns => ns.forEach(n => { if (n.t === "text") n.y += TEXT_SHIFT; else if (n.t === "group") mv(n.children); }); lists.forEach(l => mv(l.dl.nodes)); }
      const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
      const c = document.createElement("canvas"); c.width = 1600; c.height = 900;
      const ctx = c.getContext("2d");
      ctx.drawImage(await load("data:image/png;base64," + shot), 0, 0);
      for (const l of lists) {
        const el = root.querySelector(`.tw[data-i="${l.table}"]`); if (!el) continue;
        const bb = el.getBoundingClientRect(), s = (bb.width / k) / (el.offsetWidth || 1);
        const imgs = new Map();
        for (const [id, src] of Object.entries(l.dl.images)) { try { imgs.set(id, await load(src)); } catch { /* left out, as a broken picture */ } }
        ctx.setTransform(s, 0, 0, s, (bb.left - sr.left) / k + SHIFT, (bb.top - sr.top) / k);
        T.drawDl(ctx, l.dl.nodes, { image: id => imgs.get(id), layer: () => { const o = new OffscreenCanvas(1600, 900); return { ctx: o.getContext("2d"), image: o }; } });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      return c.toDataURL("image/png").split(",")[1];
    }, { design, version, slide, shot: shot.toString("base64"), SHIFT, TEXT_SHIFT });
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
    await capture(actual, { decks: decks || undefined, designs: DESIGNS, pdf: false, quiet: !process.argv.includes("--verbose"), slideHook });
  }
  const accepted = fs.existsSync(acceptedFile) ? JSON.parse(fs.readFileSync(acceptedFile, "utf8")) : [];
  const evaluate = () => {
    const res = compare(golden, actual, { accepted, decks, designs: DESIGNS, pdf: false, tool: "dlparity", pixelRange: true });
    // the text origins against the page's layout (this build): every one beyond 1 px is a difference
    const files = d => fs.existsSync(d) && fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isDirectory() || f.endsWith(".json")) : [];
    for (const deck of files(actual).filter(f => !f.endsWith(".json"))) for (const design of files(path.join(actual, deck))) for (const version of files(path.join(actual, deck, design)))
      for (const f of files(path.join(actual, deck, design, version)).filter(f => /^slide-\d+\.json$/.test(f))) {
        const g = JSON.parse(fs.readFileSync(path.join(actual, deck, design, version, f), "utf8"));
        for (const o of g.origins || []) {
          const d = { deck, design, version, file: f, kind: "origin", detail: `«${o.text}»: display list ${o.dl} vs page ${o.page}` };
          d.accepted = accepted.find(a => a.tool === "dlparity" && ["deck", "design", "version", "file", "kind"].every(k => a[k] === undefined || a[k] === d[k])) || null;
          res.diffs.push(d);
        }
      }
    res.unaccepted = res.diffs.filter(d => !d.accepted).length;
    return res;
  };
  let res = evaluate();
  // a deck that differs is captured once more (the page can be caught while it redraws a slide); what differs again counts
  const flaky = [...new Set(res.diffs.filter(d => !d.accepted).map(d => d.deck))];
  if (flaky.length && !given && !CONTROL) {
    console.log(`re-capturing ${flaky.join(", ")} once; first capture: ${res.diffs.filter(d => !d.accepted).slice(0, 6).map(d => `${d.deck}/${d.design}/${d.file} ${d.kind}: ${String(d.detail).slice(0, 80)}`).join(" | ")}`);
    const again = fs.mkdtempSync(path.join(os.tmpdir(), "sb-dlparity-again-"));
    await capture(again, { decks: flaky, designs: DESIGNS, pdf: false, quiet: true, slideHook });
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
  console.log(`dlparity (${DESIGNS.join(", ")}): ${res.diffs.length} difference(s) ${JSON.stringify(kinds)}, ${res.unaccepted} not accepted (${res.full ? "full" : "text-only"} comparison)${res.recaptured ? ` (re-captured once: ${res.recaptured.join(", ")})` : ""} - report: ${path.relative(process.cwd(), path.join(report, "index.html"))}`);
  if (!given && !process.argv.includes("--keep")) fs.rmSync(actual, { recursive: true, force: true }); else console.log("capture kept in " + actual);
  if (CONTROL) {
    // the negative control passes when the moved tables (geometry) or text runs (origins) were caught
    const caught = CONTROL === "tables" ? res.diffs.some(d => d.kind === "geometry") && (!res.full || res.diffs.some(d => d.kind === "pixels")) : res.diffs.some(d => d.kind === "origin");
    console.log(caught ? `negative control (${CONTROL}): detected (${res.diffs.length} differences)` : `negative control FAILED (${CONTROL}): went unnoticed`);
    process.exitCode = caught ? 0 : 1;
  } else process.exitCode = res.unaccepted ? 1 : 0;
}
export { slideHook };
