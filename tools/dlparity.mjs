/* Parity of the display list with the goldens (PLAN S3.3–S3.5; 05 §1 GG, GP; 05 §3.2), for the three designs. The app is captured as
   tools/capture-v3.mjs does (same decks, designs, versions, slides, clock), but for each slide what the goldens hold
   is taken from the whole slide's display list the core worker builds (slideLists, S3.5; its text measured and its
   text boxes fitted by the page, decision 2026-10-12, 3):
   - geometry and texts (GG, GT): every element – table items (.t cells, .tbox text boxes, .pic pictures, Liquid
     Glass's .wb materials, paired by table, kind and order) and the slide's own (title, subtitle, cover, contents,
     page number, footer, logo, text boxes, notes section, the tables' boxes; paired by their classes and order) – gets
     the display list's box and text, one-line texts also its colour, size, weight, style and font family; editing
     aids (handles, the empty-slide hint) keep the page's;
   - pixels (GP): the whole slide drawn from the display list on a canvas as the page paints it – opaque (subpixel
     text), each table on a layer of its own (grey anti-aliasing, start on a whole pixel), a compositing the screen
     (M4) and the PNG export will have to do the same way;
   - text origins (05 GG "text origins 1 px"): every run of a cell (while the page's text nodes and the display
     list's runs are the same strings), the first run of other texts, against the page's own layout (the text's Range for
     x, a zero-size inline-block on its baseline; this build, these fonts) within 1 px, enforced in a full comparison (the
     goldens' environment) and printed for information elsewhere; text-shadow copies left out;
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

/** the current slide's items replaced by the whole slide's display list (S3.5: furniture and tables); the slide
    drawn from it when pixels are asked */
async function slideHook(page, { design, version, slide, geometry, pixels }) {
  const r = await page.evaluate(async ({ design, version, slide, SEL, SHIFT, TEXT_SHIFT, ORIGIN_TOL }) => {
    const T = window.__sbTest, root = document.querySelector("#stage .slide"), sr = root.getBoundingClientRect(), k = sr.width / 1600;
    const [one] = await T.slideLists({ design, version, forExport: false, thumb: false, slides: [slide] });
    const nodes = one ? one.dl.nodes : [];
    if (TEXT_SHIFT) { const mv = ns => ns.forEach(n => { if (n.t === "text") n.y += TEXT_SHIFT; else if (n.t === "group") mv(n.children); }); mv(nodes); }
    if (SHIFT) nodes.forEach((n, i) => { if (n.t === "group" && n.transform && nodes[i - 1]?.t === "hit" && nodes[i - 1].id === "tw") n.transform = [...n.transform.slice(0, 4), n.transform[4] + SHIFT, n.transform[5]]; });
    const r1 = v => Math.round(v * 10) / 10;
    // colours and family lists as getComputedStyle writes them
    const rgb = (c, a = 1) => a < 1 ? `rgba(${c.map(Math.round).join(", ")}, ${+a.toFixed(2)})` : `rgb(${c.map(Math.round).join(", ")})`;
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/;
    const cssFamilies = css => css.split(",").map(f => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean).map(f => GENERIC.test(f) || /^-?[A-Za-z_][\w-]*$/.test(f) ? f : `"${f}"`).join(", ");
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    // every hit with the text nodes after it (until the next hit), in slide px; table hits know their table (the
    // display list has each table's group right after its "tw" hit)
    const hits = []; let cur = null, table = -1;
    const walk = (ns, M, inTable) => ns.forEach(n => {
      // a hit's box as the page reports an element's: the bounding box of its corners after every transform
      if (n.t === "hit") {
        if (n.kind === "f" && n.id === "tw") table++;
        const pts = [[n.x, n.y], [n.x + n.w, n.y], [n.x, n.y + n.h], [n.x + n.w, n.y + n.h]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        cur = { n: { ...n, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, texts: [], table: inTable ? table : null }; hits.push(cur);
      }
      else if (n.t === "text" && cur && !n.decorative) cur.texts.push({ n, M });     // (a text-shadow copy is not the text)
      else if (n.t === "group") walk(n.children, n.transform ? mul(M, n.transform) : M, inTable || (n.transform && ns[ns.indexOf(n) - 1]?.t === "hit" && ns[ns.indexOf(n) - 1].id === "tw"));
    });
    walk(nodes, [1, 0, 0, 1, 0, 0], false);
    // the page's items, in the goldens' order (capture-v3 geometry()): table items by table, kind and order; the
    // other elements by their classes and order
    const els = [...root.querySelectorAll(SEL)], repl = [], origins = [], seen = {};
    // texts whose style is compared: one-line elements whose first text node is all their text
    const STYLED = /^(t|title|subtitle|cv-title|cv-kicker|cvx-date|ix-t|ix-s|ix-p|ix-n)$|pageno|cv-chip/;
    els.forEach((el, idx) => {
      const tw = el.closest(".tw[data-i]");
      const cls = el.className && el.className.baseVal === undefined ? String(el.className) : el.tagName.toLowerCase();
      let kind, key, pick;
      if (tw && !el.matches(".tw")) {
        kind = el.matches(".t") ? "t" : el.matches(".tbox") ? "tbox" : el.matches(".pic") ? "pic" : el.matches(".wb") ? "wb" : null;
        if (!kind) return;
        key = tw.dataset.i + "|" + kind; pick = h => h.table === +tw.dataset.i && h.n.kind === kind;
      } else {
        if (el.matches(".hbox *, .emptyslide")) return;            // editing aids: not part of the slide
        kind = cls; key = "f|" + cls; pick = h => h.n.kind === "f" && h.n.id === cls && h.table === null;
      }
      const n = seen[key] = (seen[key] ?? -1) + 1;
      const hit = hits.filter(pick)[n];
      if (!hit) { repl.push({ idx, missing: true }); return; }
      const h = hit.n, first = hit.texts[0];
      const item = { idx, x: r1(h.x), y: r1(h.y), w: r1(h.w), h: r1(h.h) };
      if (h.label !== undefined && kind !== "pic") item.text = h.label;
      if (first && (kind === "t" || STYLED.test(kind))) {
        const t = first.n;
        item.color = rgb(t.fill.solid, t.fill.a); item.size = `${t.size}px`; item.weight = String(t.weight ?? (t.b ? 700 : 400)); item.style = t.i ? "italic" : undefined;
        if (t.css) item.font = cssFamilies(t.css);
      }
      // the runs' origins against the page's own layout: every run of a cell while the page's text nodes and the
      // display list's runs are the same strings (a superscript is its own node and run); the first run of other texts
      const owns = kind === "t" || kind === "tbox" || (!tw && hit.texts.length && !el.querySelector(SEL));
      if (owns && hit.texts.length) {
        const tn = [...el.querySelectorAll("*"), el].flatMap(e => [...e.childNodes]).filter(c => c.nodeType === 3 && c.textContent.trim());
        tn.sort((x, y) => x.compareDocumentPosition(y) & 4 ? -1 : 1);
        const pairs = kind === "t" ? Math.min(tn.length, hit.texts.length) : Math.min(1, tn.length);
        for (let q = 0; q < pairs; q++) {
          const node = tn[q], dl = hit.texts[q], t = dl.n;
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
    return { repl, origins };
  }, { design, version, slide, SEL, SHIFT, TEXT_SHIFT, ORIGIN_TOL });
  const g = structuredClone(geometry);
  for (const it of r.repl) {
    if (it.missing) { g.items[it.idx] = { ...g.items[it.idx], cls: "missing-in-display-list" }; continue; }
    const { idx, ...v } = it;
    if (g.items[idx].text === undefined) delete v.text;            // (the goldens hold texts of text elements only)
    g.items[idx] = { ...g.items[idx], ...v };
    if (v.style === undefined && "style" in v) delete g.items[idx].style;
  }
  g.origins = r.origins;
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
    await capture(actual, { decks: decks || undefined, designs: DESIGNS, pdf: false, quiet: !process.argv.includes("--verbose"), slideHook });
  }
  const accepted = fs.existsSync(acceptedFile) ? JSON.parse(fs.readFileSync(acceptedFile, "utf8")) : [];
  const evaluate = () => {
    const res = compare(golden, actual, { accepted, decks, designs: DESIGNS, pdf: false, tool: "dlparity", pixelRange: true });
    // the text origins against the page's layout (this build): every one beyond 1 px is a difference – where the
    // environment is the goldens' (full comparison: their Chromium and fonts, the reference PC). Elsewhere (CI's Linux
    // runner, other fonts) they are printed for information, as geometry and pixels are not compared there: the
    // display list's measuring is checked against the reference platform's fonts
    const info = [];
    const files = d => fs.existsSync(d) && fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isDirectory() || f.endsWith(".json")) : [];
    for (const deck of files(actual).filter(f => !f.endsWith(".json"))) for (const design of files(path.join(actual, deck))) for (const version of files(path.join(actual, deck, design)))
      for (const f of files(path.join(actual, deck, design, version)).filter(f => /^slide-\d+\.json$/.test(f))) {
        const g = JSON.parse(fs.readFileSync(path.join(actual, deck, design, version, f), "utf8"));
        for (const o of g.origins || []) {
          const d = { deck, design, version, file: f, kind: "origin", detail: `«${o.text}»: display list ${o.dl} vs page ${o.page}` };
          d.accepted = accepted.find(a => a.tool === "dlparity" && ["deck", "design", "version", "file", "kind"].every(k => a[k] === undefined || a[k] === d[k])) || null;
          if (res.full) res.diffs.push(d); else info.push(d);
        }
      }
    if (info.length) console.log(`text origins beyond ${ORIGIN_TOL} px on this environment (information – not the goldens' fonts): ${info.length}; ${info.slice(0, 4).map(d => `${d.deck}/${d.design}/${d.file} ${d.detail}`).join(" | ")}`);
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
