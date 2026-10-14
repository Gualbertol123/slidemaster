/* Parity of the stage (PLAN S4.1–S4.4; 05 §1 GG, GT, GP, SP): from M4 the stage draws the display list, so a slide's
   geometry and texts are those of the display list it shows, and its pixels are the stage's own screenshot.
   - GG / GT: the goldens' elements (v3's DOM: .t cells, .wb cards, .tw tables, text boxes, title, subtitle, cover,
     contents, page number, footer, logo…, in their order) are paired with the hits of the slide on the stage – table
     items by table, kind and order, the slide's own by their classes and order (as tools/dlparity.mjs did with the page's
     HTML, which is gone) – and get their box, text and, for texts, the style of their first run. Container styles that
     only v3's CSS cascade had (the inherited font of a card, a cell's background) are the golden's: pixels check them.
     Hits the goldens do not have are listed as elements of their own ("extra-in-display-list"), so an element too many
     is a difference. Editing aids (handles, the empty-slide hint) take the stage's own boxes.
   - GP: the stage, screenshotted at 100 % (1600 × 900).
   - SP (screen = PDF; decision 2026-10-14, S4.4: text as data, pixels everywhere but the glyphs): every slide against its
     page of the native PDF the Export button saves –
     · text: every run of the slide's display list starts in the PDF where it does in the list (its first character's
       origin, PDFium's, within 0.05 pt), and every run the stage draws as text has a natural width in the browser
       (without textLength) within 0.5 % of the list's width less its letter-spacing (the node's ls) – 2 % for a run drawn as
       glyph outlines, tabular runs by their advances;
     · pixels: the screenshot against the page rendered by PDFium at the same scale (tools/pdfcheck.py render), with
       GP's pixel rule (ΔE2000 2, the 3 × 3 range rule of decision G1-4, at most 1 % of the pixels), the glyphs left out
       (inside each run's box from the list, the pixels far from the box's background on either side, 1 px around: two
       rasterisers never draw glyph edges alike; what lies under the text is compared) – and each box's ink (the mean colour
       of its glyph pixels on both sides) within INK of the PDF's.
   Used by tools/parity.mjs (npm run parity). */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PY = process.platform === "win32" ? "python" : "python3";
const r1 = v => Math.round(v * 10) / 10;
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
// colours and family lists as getComputedStyle writes them (the goldens')
const rgb = (c, a = 1) => a < 1 ? `rgba(${c.map(Math.round).join(", ")}, ${+a.toFixed(2)})` : `rgb(${c.map(Math.round).join(", ")})`;
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/;
const cssFamilies = css => css.split(",").map(f => f.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean).map(f => GENERIC.test(f) || /^-?[A-Za-z_][\w-]*$/.test(f) ? f : `"${f}"`).join(", ");
/** texts whose style is compared: one-line elements whose first text node is all their text (dlparity's) */
const STYLED = /^(t|title|subtitle|cv-title|cv-kicker|cvx-date|ix-t|ix-s|ix-p|ix-n)$|pageno|cv-chip/;

/** the slide on the stage as ONE display list in slide px (the tables placed as the slide's list has them: a "tw" hit,
    then the table's group), and the editing aids' boxes, from the page */
export async function stageSlide(page) {
  return page.evaluate(async () => {
    // the shown slide with its tables' nodes (the stage draws markup): the same layers, key for key
    const shown = window.__sbTest.stage(), st = await window.__sbTest.stageNodes();
    if (!st || st.layers.map(l => l.key).join() !== shown.layers.map(l => l.key).join()) throw new Error("the stage changed while it was read");
    const root = document.querySelector("#stage .slide"), sr = root.getBoundingClientRect(), k = sr.width / 1600;
    const nodes = [];
    for (const l of st.layers) {
      if (l.table !== null) nodes.push({ t: "hit", kind: "f", id: "tw", x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h }, { t: "group", transform: [l.box.scale, 0, 0, l.box.scale, l.box.x, l.box.y], children: l.nodes });
      else nodes.push(...l.nodes);
    }
    const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round((r.left - sr.left) / k * 10) / 10, y: Math.round((r.top - sr.top) / k * 10) / 10, w: Math.round(r.width / k * 10) / 10, h: Math.round(r.height / k * 10) / 10 }; };
    const aids = {};
    for (const el of document.querySelectorAll("#stage .hbox .edge, #stage .emptyslide")) (aids[el.className] ||= []).push(box(el));
    return { nodes, aids, scale: Math.round(k * 1000) / 1000, w: Math.round(sr.width / k), h: Math.round(sr.height / k) };
  });
}

/** every hit in slide px (the bounding box of its corners after every transform) with the text nodes after it until the
    next hit; a table's hits know their table (each table's group follows its "tw" hit) */
export function hitsOf(nodes) {
  const hits = []; let cur = null, table = -1;
  const walk = (ns, M, inTable) => ns.forEach((n, i) => {
    if (n.t === "hit") {
      if (n.kind === "f" && n.id === "tw") table++;
      const pts = [[n.x, n.y], [n.x + n.w, n.y], [n.x, n.y + n.h], [n.x + n.w, n.y + n.h]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      cur = { n: { ...n, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, texts: [], table: inTable ? table : null }; hits.push(cur);
    } else if (n.t === "text" && cur && !n.decorative) cur.texts.push({ n, M });
    else if (n.t === "group") walk(n.children, n.transform ? mul(M, n.transform) : M, inTable || (n.transform && ns[i - 1]?.t === "hit" && ns[i - 1].id === "tw"));
  });
  walk(nodes, [1, 0, 0, 1, 0, 0], false);
  return hits;
}

/** the golden's elements, each with what the stage shows for it (see the head of this file) */
export function pairWithGolden(golden, shown) {
  const hits = hitsOf(shown.nodes).filter(h => h.n.kind !== "cap"), items = [], seen = {}, keyOfHit = new Map();
  let table = -1, inTable = false;
  for (const g of golden.items) {
    const cls = String(g.cls), c = cls.split(" ").filter(Boolean);
    if (c.includes("edge") || cls === "emptyslide") {                // editing aids: the stage's own
      const n = seen["aid|" + cls] = (seen["aid|" + cls] ?? -1) + 1, b = shown.aids[c.includes("edge") ? "edge " + c[c.length - 1] : cls]?.[n];
      items.push(b ? { ...g, ...b } : { ...g, cls: "missing-on-stage" });
      continue;
    }
    let kind, key, pick;
    if (cls === "tw") { table++; inTable = true; kind = "tw"; key = "f|tw"; pick = h => h.n.kind === "f" && h.n.id === "tw" && h.table === null; }
    else if (inTable && (c.includes("t") || c.includes("tbox") || c.includes("pic") || (c.includes("wb") && !c.includes("chrome") && !c.includes("notebub")))) {
      kind = c.includes("t") ? "t" : c.includes("tbox") ? "tbox" : c.includes("pic") ? "pic" : "wb"; key = table + "|" + kind;
      const t = table; pick = h => h.table === t && h.n.kind === kind;
    } else { inTable = false; kind = cls; key = "f|" + cls; pick = h => h.n.kind === "f" && h.n.id === cls && h.table === null; }
    const n = seen[key] = (seen[key] ?? -1) + 1, hit = hits.filter(pick)[n];
    if (!hit) { items.push({ ...g, cls: "missing-in-display-list" }); continue; }
    keyOfHit.set(hit, key);
    const h = hit.n, first = hit.texts[0], item = { ...g, x: r1(h.x), y: r1(h.y), w: r1(h.w), h: r1(h.h) };
    // a hit without a label is an element without text ("" in the goldens)
    if (g.text !== undefined) { if (kind !== "pic") item.text = h.label ?? ""; else delete item.text; }
    if (first && (kind === "t" || STYLED.test(kind))) {
      const t = first.n;
      item.color = rgb(t.fill.solid, t.fill.a); item.size = `${t.size}px`; item.weight = String(t.weight ?? (t.b ? 700 : 400));
      if (t.i) item.style = "italic"; else delete item.style;
      if (t.css) item.font = cssFamilies(t.css);
    }
    items.push(item);
  }
  // what the stage has and the goldens do not: an element too many is a difference
  for (const hit of hits) {
    if (keyOfHit.has(hit)) continue;
    const kind = hit.table === null ? (hit.n.kind === "f" ? hit.n.id : hit.n.kind) : hit.n.kind;
    items.push({ cls: "extra-in-display-list " + (hit.table === null ? "" : "table " + hit.table + " ") + kind, x: r1(hit.n.x), y: r1(hit.n.y), w: r1(hit.n.w), h: r1(hit.n.h), ...(hit.n.label !== undefined ? { text: hit.n.label } : {}) });
  }
  return { scale: shown.scale, w: shown.w, h: shown.h, items };
}

/** the stage settled: the slide it shows is the current one, nothing on its way, its pictures loaded */
export async function settleStage(page) {
  await page.waitForFunction(() => !window.__sbTest.stageIdle || window.__sbTest.stageIdle(), null, { timeout: 60_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const hrefs = [...new Set([...document.querySelectorAll("#stage svg image")].map(i => i.getAttribute("href")))];
    await Promise.all(hrefs.map(src => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = src; })));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** capture-v3's slideHook for the stage: the golden's elements paired with the stage, its screenshot (for GP where the
    golden has one, for SP always: sp/screen-<n>.png) */
export function stageHook(goldenDir) {
  return async (page, { deck, dir, design, slide, pixels, geometry }) => {
    const version = path.basename(dir);
    await settleStage(page);
    const shown = await stageSlide(page);
    const gf = path.join(goldenDir, deck, design, version, `slide-${slide + 1}.json`);
    const golden = fs.existsSync(gf) ? JSON.parse(fs.readFileSync(gf, "utf8")) : { items: [] };
    const { items, ...head } = pairWithGolden(golden, shown), g = { ...head, slide: geometry.slide, label: geometry.label, items };
    const b = await page.locator("#stage .slide").first().boundingBox();
    const png = await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" });
    fs.mkdirSync(path.join(dir, "sp"), { recursive: true });
    fs.writeFileSync(path.join(dir, "sp", `screen-${slide + 1}.png`), png);
    const { runs, measure, boxes } = listRuns(shown.nodes);
    fs.writeFileSync(path.join(dir, "sp", `text-${slide + 1}.json`), JSON.stringify({ runs, boxes, widths: await browserWidths(page, measure) }));
    return { geometry: g, png: pixels ? png : null };
  };
}
/** the list's text for SP, from the slide's nodes: each run's first visible character and its origin in slide px (with
    the origin of its decorative copy, if any), what the browser needs to measure each run (its font, size, width less
    its letter-spacing or its tabular advances – in the run's own units), and each run's box in slide px (the glyphs'
    area: 1 em above the baseline, .35 em below, the run's width; decorative copies too) */
function listRuns(nodes) {
  const runs = [], measure = [], boxes = [], decor = [];
  const at = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const walk = (ns, M) => { for (const n of ns) {
    if (n.t === "group") { walk(n.children, n.transform ? mul(M, n.transform) : M); continue; }
    if (n.t !== "text" || !n.src.trim()) continue;
    const n0 = [...n.src].length, w = n.w ?? (n.adv ? n.adv.reduce((a, b) => a + b, 0) : n.size * .6 * n0);
    const cs = [at(M, n.x, n.y - n.size), at(M, n.x + w, n.y - n.size), at(M, n.x, n.y + .35 * n.size), at(M, n.x + w, n.y + .35 * n.size)];
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map(v => Math.round(v * 10) / 10));
    if (n.decorative) { const [x, y] = at(M, n.x, n.y); decor.push([n.src, x, y]); continue; }
    // the first visible character: the run's origin moved by the advances before it (leading spaces)
    const lead = n.src.length - n.src.trimStart().length, ax = lead && n.adv ? n.adv.slice(0, lead).reduce((a, b) => a + b, 0) : 0;
    if (!lead || n.adv) { const [x, y] = at(M, n.x + ax, n.y); runs.push([n.src.trim()[0], r3(x), r3(y), n.src, ax]); }
    if (n0 > 1 && n.w !== undefined) {
      const ls = n.ls || 0, tab = n.tnum && n.adv && n.adv.length === n0;
      measure.push({ src: n.src, css: n.css || n.font, weight: n.weight ?? (n.b ? 700 : 400), italic: !!n.i, size: n.size, tnum: !!n.tnum,
        want: r3(tab ? n.adv.reduce((a, b) => a + b, 0) - n0 * ls : n.w - (n0 - 1) * ls) });
    }
  } };
  walk(nodes, [1, 0, 0, 1, 0, 0]);
  // a run with a decorative copy (a text shadow, a few px off): PDFium keeps one of two characters drawn on top of each
  // other (its fake-bold rule), so the run may start where its copy does
  for (const r of runs) { const d = decor.find(([src, x, y]) => src === r[3] && Math.abs(x + r[4] - r[1]) < 4 && Math.abs(y - r[2]) < 4); r[4] = d ? [r3(d[1] + r[4]), r3(d[2])] : null; }
  return { runs, measure, boxes };
}
const r3 = v => Math.round(v * 1000) / 1000;
/** the browser's own width of each run (a <text> without textLength, in the run's font and size, tabular figures where
    the run has them – without kerning: the list places a tabular run character by character), and whether the stage
    draws it as text (else as glyph outlines) */
function browserWidths(page, measure) {
  return page.evaluate(list => {
    const drawn = new Set([...document.querySelectorAll("#stage svg text")].map(t => t.textContent));
    const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.setAttribute("style", "position:absolute;left:-30000px;top:0;width:10px;height:10px");
    document.body.appendChild(host);
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); host.appendChild(t);
    const out = list.map(m => {
      t.setAttribute("font-family", m.css); t.setAttribute("font-size", String(m.size)); t.setAttribute("font-weight", String(m.weight));
      t.setAttribute("font-style", m.italic ? "italic" : "normal"); t.setAttribute("style", m.tnum ? "font-variant-numeric:tabular-nums;font-kerning:none" : "");
      t.textContent = m.src;
      return [m.src, m.want, Math.round(t.getComputedTextLength() * 1000) / 1000, drawn.has(m.src)];
    });
    host.remove();
    return out;
  }, measure);
}
/** capture-v3's versionHook for SP: the native PDF of this deck × design × version, as the Export button saves it */
export async function exportNative(page, h, dir) {
  const exp = path.join(h.root, "export");
  fs.rmSync(exp, { recursive: true, force: true }); fs.mkdirSync(exp);
  await page.evaluate(() => { window.__sbTest.lastExport.files = []; });
  await page.click("#exportBtn");
  await page.waitForFunction(() => window.__sbTest.lastExport.files.length > 0 && !window.__sbTest.exporting(), null, { timeout: 180_000 });
  const f = fs.readdirSync(exp).find(n => n.endsWith(".pdf"));
  fs.copyFileSync(path.join(exp, f), path.join(dir, "sp", "native.pdf"));
}

/** SP over a capture: each slide's screenshot against its PDF page (PDFium); one difference per slide beyond the rule.
    `px`: parity.mjs's pixel tools (comparePixels, decodePng, encodePng, PIXEL_FRACTION – passed in: parity.mjs imports this file) */
/** how far a text box's ink may be from the PDF's (RGB distance of the mean colours of the pixels that are glyph pixels on
    both sides: the two rasterisers' anti-aliasing moves it a little; a wrong colour is far beyond) */
const INK = +(process.env.SB_SP_INK || 140);
/** a pixel this far (RGB distance) from its text box's background is a glyph's */
const GLYPH = 40;
const median = v => { const a = [...v].sort((x, y) => x - y); return a[a.length >> 1]; };
export function compareSP(actualDir, px, opts = {}) {
  const { comparePixels, decodePng, encodePng, PIXEL_FRACTION } = px;
  const diffs = [], pixels = [], images = [];
  const dirs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isDirectory()) : [];
  for (const deck of dirs(actualDir)) for (const design of dirs(path.join(actualDir, deck))) for (const version of dirs(path.join(actualDir, deck, design))) {
    const sp = path.join(actualDir, deck, design, version, "sp"), pdf = path.join(sp, "native.pdf");
    if (!fs.existsSync(pdf)) continue;
    const out = path.join(sp, "pdf");
    const pages = JSON.parse(execFileSync(PY, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "pdfcheck.py"), "render", pdf, "--out", out, "--scale", String(4 / 3)], { encoding: "utf8", maxBuffer: 16 << 20 }));
    const screens = fs.readdirSync(sp).filter(f => /^screen-\d+\.png$/.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const scope = { deck, design, version };
    if (pages.length !== screens.length) diffs.push({ ...scope, file: "sp", kind: "sp", detail: `${screens.length} slides on screen, ${pages.length} PDF pages` });
    // the PDF's characters and their origins (PDFium)
    const chars = JSON.parse(execFileSync(PY, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "pdfcheck.py"), "chars", pdf], { encoding: "utf8", maxBuffer: 64 << 20 }));
    screens.forEach((s, i) => {
      if (!pages[i]) return;
      const file = `slide-${i + 1}`, tf = path.join(sp, `text-${i + 1}.json`);
      if (!fs.existsSync(tf)) { diffs.push({ ...scope, file, kind: "sp-text", detail: "no text data was captured for this slide" }); return; }
      const text = JSON.parse(fs.readFileSync(tf, "utf8"));
      // text as data: each run starts where the PDF has its first character (0.05 pt = 0.067 px)
      const pc = chars[i] || [], TOL = .05 * 4 / 3;
      const at = (ch, x, y) => pc.some(c => c[0] === ch && Math.abs(c[1] - x) <= TOL && Math.abs(c[2] - y) <= TOL);
      const missing = text.runs.filter(([ch, x, y, , alt]) => !at(ch, x, y) && !(alt && at(ch, alt[0], alt[1])));
      if (missing.length) diffs.push({ ...scope, file, kind: "sp-text", detail: `${missing.length} of ${text.runs.length} runs do not start where the PDF's text does: ${missing.slice(0, 3).map(m => JSON.stringify(m[3].slice(0, 30)) + " at " + m[1] + "," + m[2]).join("; ")}` });
      // the browser's own width of each run drawn as text, against the list's (Liquid Glass's letter-spacing allowed for)
      // (a run drawn as glyph outlines – its font failed the per-font check, by at most ~1.4 % on this PC – within 2 %)
      const off = text.widths.filter(([, want, nat, asText]) => Math.abs(nat - want) > (asText ? .005 : .02) * Math.max(want, 1));
      if (off.length) diffs.push({ ...scope, file, kind: "sp-width", detail: `${off.length} of ${text.widths.length} runs are not their measured width in the browser: ${off.slice(0, 3).map(([t, w, nat, asText]) => JSON.stringify(t.slice(0, 30)) + " " + w + " vs " + nat + (asText ? "" : " (outlines)")).join("; ")}` });
      // pixels everywhere but the glyphs: their boxes, 1 px around, take the PDF's pixels on the screen's side
      const A = decodePng(fs.readFileSync(path.join(sp, s))), B = decodePng(fs.readFileSync(pages[i]));
      // under the glyphs, each box's mean colour: the text's ink and what lies beneath it (a fill, a line) are the PDF's
      if (A.w === B.w && A.h === B.h) {
        const inkOff = [];
        for (const [bx, by, bw, bh] of text.boxes) {
          const x0 = Math.max(0, Math.floor(bx)), y0 = Math.max(0, Math.floor(by)), x1 = Math.min(A.w, Math.ceil(bx + bw)), y1 = Math.min(A.h, Math.ceil(by + bh));
          if (x1 <= x0 || y1 <= y0) continue;
          // the ink: the mean colour of the pixels that are glyph pixels on both sides (far from the box's background on each)
          // – a second fill in the box is the same on both sides, a seam or a bolder stroke is on one side only
          const bgOf = img => { const ch = [[], [], []]; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * A.w + x) * 3; for (let c = 0; c < 3; c++) ch[c].push(img.rgb[o + c]); } return ch.map(median); };
          const ga = bgOf(A), gb = bgOf(B), sa = [0, 0, 0], sb = [0, 0, 0];
          let n = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const o = (y * A.w + x) * 3;
            if (Math.hypot(A.rgb[o] - ga[0], A.rgb[o + 1] - ga[1], A.rgb[o + 2] - ga[2]) <= GLYPH || Math.hypot(B.rgb[o] - gb[0], B.rgb[o + 1] - gb[1], B.rgb[o + 2] - gb[2]) <= GLYPH) continue;
            n++; for (let c = 0; c < 3; c++) { sa[c] += A.rgb[o + c]; sb[c] += B.rgb[o + c]; }
          }
          const dInk = n >= 3 ? Math.hypot(...sa.map((v, c) => (v - sb[c]) / n)) : 0;
          if (dInk > INK) inkOff.push([bx, by, Math.round(dInk), n]);
        }
        if (inkOff.length) diffs.push({ ...scope, file, kind: "sp-ink", detail: `${inkOff.length} of ${text.boxes.length} text boxes differ in their ink (x, y, distance, glyph pixels): ${inkOff.slice(0, 3).map(b => b.join(",")).join("; ")}` });
      }
      // inside each run's box only the glyphs go: pixels far from the box's background (its median) on either side, 1 px
      // around – what lies under the text stays in the comparison, with the slide's rule
      if (A.w === B.w && A.h === B.h) {
        const glyph = new Uint8Array(A.w * A.h);
        for (const [bx, by, bw, bh] of text.boxes) {
          const x0 = Math.max(0, Math.floor(bx)), y0 = Math.max(0, Math.floor(by)), x1 = Math.min(A.w, Math.ceil(bx + bw)), y1 = Math.min(A.h, Math.ceil(by + bh));
          if (x1 <= x0 || y1 <= y0) continue;
          const bg = img => { const ch = [[], [], []]; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * A.w + x) * 3; for (let c = 0; c < 3; c++) ch[c].push(img.rgb[o + c]); } return ch.map(median); };
          const ga = bg(A), gb = bg(B), far = (img, g, o) => Math.hypot(img.rgb[o] - g[0], img.rgb[o + 1] - g[1], img.rgb[o + 2] - g[2]) > GLYPH;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * A.w + x) * 3; if (far(A, ga, o) || far(B, gb, o)) glyph[y * A.w + x] = 1; }
        }
        for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
          let g = 0; for (let dy = -1; dy <= 1 && !g; dy++) for (let dx = -1; dx <= 1 && !g; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < A.h && xx >= 0 && xx < A.w && glyph[yy * A.w + xx]) g = 1; }
          if (g) { const o = (y * A.w + x) * 3; A.rgb[o] = B.rgb[o]; A.rgb[o + 1] = B.rgb[o + 1]; A.rgb[o + 2] = B.rgb[o + 2]; }
        }
      }
      const r = comparePixels(A, B, { range: true });
      pixels.push({ ...scope, file, fraction: r.size ? 1 : r.fraction, maxDE: r.maxDE ?? null });
      if (r.size || r.fraction > PIXEL_FRACTION) {
        diffs.push({ ...scope, file, kind: "sp", detail: r.size || `screen vs PDF: ${(r.fraction * 100).toFixed(2)} % of the pixels differ (max ΔE ${r.maxDE})` });
        images.push({ ...scope, file: file + " (SP)", golden: pages[i], actual: path.join(sp, s), heat: r.heat ? encodePng(r.w, r.h, r.heat) : null });
      }
    });
  }
  for (const d of diffs) d.accepted = (opts.accepted || []).find(a => a.tool === "sp" && ["deck", "design", "version", "file", "kind"].every(k => a[k] === undefined || a[k] === d[k])) || null;
  // an entry with upTo (%) accepts its slide only up to that share of differing pixels
  for (const d of diffs) if (d.accepted?.upTo !== undefined) { const m = /([\d.]+) % of the pixels/.exec(String(d.detail)); if (!m || +m[1] > d.accepted.upTo) d.accepted = null; }
  return { diffs, pixels, images };
}
