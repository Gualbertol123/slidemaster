/* Parity of a build against the goldens (docs/next/05-test-and-parity.md §3.2, PLAN S0.5).

     node tools/parity.mjs                         capture the current build (tools/capture-v3.mjs) and compare with golden/
     node tools/parity.mjs --actual DIR            compare an existing capture instead
     node tools/parity.mjs --decks a,b --no-pdf    a subset (faster while working)
     npm run parity                                (from the root or app/) the same as the first line
     node tools/parity.mjs --no-sp                 without SP (screen = PDF)
     node tools/parity.mjs --dom                   a build before M4: its HTML stage read from the DOM, as v3 was captured

   From M4 the stage draws the display list: a slide's elements are the goldens' paired with what the stage shows, its
   pixels the stage's screenshot, and SP compares each screenshot with its page of the native PDF (tools/stage-capture.mjs).

   Compared, per deck × design × version:
     slide-<n>.json   the same elements in the same order; texts, font family, weight, style, colours and
                      visibility exact; boxes within ±2 px and the font size exact (these two need the same fonts)
     slide-<n>.png    (only where the golden has one – a chosen set, see golden/README.md) perceptual: a pixel
                      differs when CIEDE2000 > 2 and no pixel within 1 px of it in the other image is that close
                      (anti-aliasing); a slide differs when more than 1 % of its pixels differ
     pdf.json         the build's native PDF (S4.5; the goldens' is v3's old engine's): pages and page sizes; with
                      the same fonts also each page's text against the golden slide's texts (GT, decision 2026-10-12,
                      5: every text once, nothing else – where text is clipped depends on the fonts, so other
                      machines check pages and sizes only). No positions: see tools/pdftext.py
     comments.json, issues.json   exact
   Slide texts, styles, comments and issues are font-independent, so they are compared everywhere. Geometry, pixels
   and PDF text depend on the
   Chromium build and the installed fonts: they are compared only when the capture's environment fingerprint
   (golden/MANIFEST.json "environment") matches; otherwise the run says so and checks text only.
   Differences listed in tests/parity/accepted.json ({deck, design, version, file, kind, reason, signedOff, digest?}: kind,
   at least one of deck/design/version/file, a reason and a sign-off are required; a missing scope field matches
   anything) are reported but accepted. Exit code 1 when any difference is not accepted.
   HTML report: tests/parity/report/index.html (golden | actual | heat map for pixel differences). */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
export const BOX_TOL = 2, PDF_TOL = 2, DE_TOL = 2, PIXEL_FRACTION = 0.01;

// ------------------------------------------------------------------------------------------- PNG (8-bit RGB/RGBA)
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, type = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString("latin1", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error("PNG: 8-bit, non-interlaced only"); type = d[9]; }
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0; if (!bpp) throw new Error("PNG: RGB or RGBA only");
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 3), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, x = line[i];
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = cur[x * bpp + k];
    cur.copy(prev);
  }
  return { w, h, rgb: out };
}
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, "latin1"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------------------------------- CIEDE2000
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fxyz = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
export function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047, y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750, z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const fx = fxyz(x), fy = fxyz(y), fz = fxyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const v = Math.atan2(b, a) / rad; return v >= 0 ? v : v + 360; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p), dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2), Lmp = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hmp += h1p + h2p < 360 ? 360 : -360; hmp /= 2; }
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.20 * Math.cos((4 * hmp - 63) * rad);
  const SL = 1 + 0.015 * Math.pow(Lmp - 50, 2) / Math.sqrt(20 + Math.pow(Lmp - 50, 2)), SC = 1 + 0.045 * Cmp, SH = 1 + 0.015 * Cmp * T;
  const RT = -2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7))) * Math.sin(60 * Math.exp(-Math.pow((hmp - 275) / 25, 2)) * rad);
  return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
}

/** {differing pixels, fraction, max ΔE, heat map RGB}; a pixel differs when no pixel within 1 px of it in the
    other image is within DE_TOL (both directions: a 1 px shift of an edge is anti-aliasing, not a change).
    opts.range (two renderers, e.g. the display list's canvas against the page: tools/dlparity.mjs): a pixel also
    passes when its colour lies within the range of the other image's 3 × 3 neighbourhood (per L, a, b, ± DE_TOL),
    so an edge the two place or anti-alias a fraction of a pixel apart passes (as tools/dlcheck.mjs) */
export function comparePixels(A, B, opts = {}) {
  if (A.w !== B.w || A.h !== B.h) return { size: `${A.w}x${A.h} vs ${B.w}x${B.h}`, bad: A.w * A.h, fraction: 1, maxDE: Infinity, heat: null };
  const { w, h } = A, cache = new Map();
  const labOf = (img, i) => { const k = (img.rgb[i] << 16) | (img.rgb[i + 1] << 8) | img.rgb[i + 2]; let v = cache.get(k); if (!v) { v = lab(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]); cache.set(k, v); } return v; };
  const same = (P, Q, x, y) => {
    const i = (y * w + x) * 3, lp = labOf(P, i);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = (yy * w + xx) * 3;
      if (P.rgb[i] === Q.rgb[j] && P.rgb[i + 1] === Q.rgb[j + 1] && P.rgb[i + 2] === Q.rgb[j + 2]) return 0;
      const d = deltaE2000(lp, labOf(Q, j)); if (d <= DE_TOL) return d;
    }
    if (opts.range) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = labOf(Q, (yy * w + xx) * 3);
        for (let c = 0; c < 3; c++) { if (q[c] < lo[c]) lo[c] = q[c]; if (q[c] > hi[c]) hi[c] = q[c]; }
      }
      if ([0, 1, 2].every(c => lp[c] >= lo[c] - DE_TOL && lp[c] <= hi[c] + DE_TOL)) return 0;
    }
    return deltaE2000(lp, labOf(Q, i));
  };
  let bad = 0, maxDE = 0, heat = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (A.rgb[i] === B.rgb[i] && A.rgb[i + 1] === B.rgb[i + 1] && A.rgb[i + 2] === B.rgb[i + 2]) continue;
    const d = Math.max(same(A, B, x, y), same(B, A, x, y));
    maxDE = Math.max(maxDE, deltaE2000(labOf(A, i), labOf(B, i)));
    if (d > DE_TOL) {
      bad++;
      if (!heat) { heat = Buffer.alloc(w * h * 3); for (let k = 0; k < w * h; k++) { const g = Math.round(A.rgb[k * 3] * 0.1 + A.rgb[k * 3 + 1] * 0.2 + A.rgb[k * 3 + 2] * 0.05) + 180; heat[k * 3] = heat[k * 3 + 1] = heat[k * 3 + 2] = Math.min(255, g); } }
      heat[i] = 255; heat[i + 1] = Math.max(0, 200 - Math.round(d * 10)); heat[i + 2] = 0;
    }
  }
  return { bad, fraction: bad / (w * h), maxDE: Math.round(maxDE * 100) / 100, heat, w, h };
}

// ------------------------------------------------------------------------------------------- comparisons
const readJson = f => JSON.parse(fs.readFileSync(f, "utf8"));
function cmpSlide(g, a, full, diff) {
  if (full && (g.w !== a.w || g.h !== a.h)) diff("geometry", `slide size ${g.w}x${g.h} vs ${a.w}x${a.h}`);
  if (g.items.length !== a.items.length) diff("elements", `${g.items.length} elements vs ${a.items.length}`);
  const n = Math.min(g.items.length, a.items.length);
  for (let i = 0; i < n; i++) {
    const x = g.items[i], y = a.items[i], where = `#${i} .${String(x.cls).split(" ")[0]}${x.text ? ` "${String(x.text).slice(0, 40)}"` : ""}`;
    if (x.cls !== y.cls) { diff("elements", `${where}: class "${x.cls}" vs "${y.cls}"`); continue; }
    if ((x.text ?? null) !== (y.text ?? null)) diff("text", `${where}: text ${JSON.stringify(x.text)} vs ${JSON.stringify(y.text)}`);
    const st = ["font", "weight", "style", "color", "bg", "visible", ...(full ? ["size"] : [])].filter(k => x[k] !== y[k]);
    if (st.length) diff("style", `${where}: ${st.map(k => `${k} ${x[k]} vs ${y[k]}`).join(", ")}`);
    if (!full) continue;
    const off = ["x", "y", "w", "h"].filter(k => Math.abs(x[k] - y[k]) > BOX_TOL);
    if (off.length) diff("geometry", `${where}: ${off.map(k => `${k} ${x[k]} vs ${y[k]}`).join(", ")}`);
  }
}
/** the build's PDF (the native export, S4.5) against the goldens: v3's page count and page size, and each page's
    text against the golden slide's texts (GT, decision 2026-10-12, 5 – v3's own PDF text is not the reference: it is
    unreadable for Liquid Glass and part of Excel Refined, and its fonts and runs were the old engine's) */
function cmpPdf(g, a, full, diff, slideTexts) {
  if (g.pages !== a.pages) diff("pdf", `${g.pages} pages vs ${a.pages}`);
  if (JSON.stringify(g.sizes) !== JSON.stringify(a.sizes)) diff("pdf", `page sizes ${JSON.stringify(g.sizes[0])} vs ${JSON.stringify(a.sizes[0])}`);
  if (!full) return;                      // which text is clipped (an ellipsis) depends on the fonts
  (a.pageText || []).forEach((pageText, p) => {
    const want = slideTexts(p + 1); if (!want) return;
    const { missing, extra } = matchTexts(pageText, want);
    if (missing.length || extra) diff("pdf-text", `page ${p + 1}: ${missing.length ? `missing ${JSON.stringify(missing.slice(0, 3))}` : ""}${extra ? ` not in the goldens: ${JSON.stringify(extra.slice(0, 60))}` : ""}`);
  });
}
/** the golden texts of a slide: every text element that holds no other text element (a cell, a title, a text box…) */
export function goldenTexts(deck, design, version, n, goldenDir = path.join(REPO, "golden")) {
  const f = path.join(goldenDir, deck, design, version, `slide-${n}.json`);
  if (!fs.existsSync(f)) return null;
  const items = JSON.parse(fs.readFileSync(f, "utf8")).items.filter(i => i.text);
  const CONTAINERS = /^(cv-block|ix-row|ix-txt|tw|xt)\b/;
  return items.filter(i => !CONTAINERS.test(i.cls) && !/^(hbox|edge|grip|emptyslide)/.test(i.cls)).map(i => i.text);
}
const squash = s => s.normalize("NFKC").replace(/\s+/g, "");
/** the golden texts found in a page's text, each used up once; what is left on either side is a difference. The
    texts are taken in the goldens' (the page's) order, each from where the last one was found, so a short number is
    matched where it is drawn, not inside a neighbour */
export function matchTexts(pageText, want) {
  let rest = squash(pageText), at = 0;
  const missing = [];
  for (const t of want) {
    const q = squash(t); if (!q) continue;
    let k = rest.indexOf(q, at);
    if (k < 0) k = rest.indexOf(q);                                // drawn out of order (page numbers, z-index)
    if (k < 0) { missing.push(t); continue; }
    rest = rest.slice(0, k) + "\u0001".repeat(q.length) + rest.slice(k + q.length);
    at = k + q.length;
  }
  return { missing, extra: rest.replace(/\u0001/g, "") };
}

/** the digest of a set of differences (their details, sorted): what an accepted.json entry with a digest was signed for */
export const detailsDigest = list => crypto.createHash("sha256").update(list.map(d => String(d.detail)).sort().join("\n")).digest("hex").slice(0, 16);
/** accepted.json entries: each needs a kind, a scope, a reason and a sign-off (05 §3.2) */
export function checkAccepted(list) {
  if (!Array.isArray(list)) throw new Error("tests/parity/accepted.json must be a list");
  list.forEach((a, i) => {
    const bad = !a || typeof a !== "object" || !a.kind || !["deck", "design", "version", "file"].some(k => a[k]) || !a.reason || !a.signedOff;
    if (bad) throw new Error(`accepted.json entry ${i + 1} needs kind, one of deck/design/version/file, reason and signedOff`);
  });
  return list;
}

export function compare(goldenDir, actualDir, opts = {}) {
  const gm = readJson(path.join(goldenDir, "MANIFEST.json")), am = readJson(path.join(actualDir, "MANIFEST.json"));
  const ge = gm.environment || {}, ae = am.environment || {};
  const full = opts.full ?? (ge.chromium === ae.chromium && ge.fontsSha256 === ae.fontsSha256);
  const accepted = checkAccepted(opts.accepted || []);
  const diffs = [], images = [], pixels = [];        // pixels: every compared screenshot's share of differing pixels
  const decks = opts.decks || gm.decks;
  const files = d => fs.existsSync(d) ? fs.readdirSync(d) : [];
  const designs = opts.designs || null;                     // compare only these designs (the display list's, per step)
  for (const deck of decks) for (const design of files(path.join(goldenDir, deck)).filter(d => !designs || designs.includes(d))) for (const version of files(path.join(goldenDir, deck, design))) {
    const gd = path.join(goldenDir, deck, design, version), ad = path.join(actualDir, deck, design, version);
    const scope = { deck, design, version };
    for (const f of files(gd).sort((x, y) => x.localeCompare(y, "en", { numeric: true }))) {
      const diff = (kind, detail) => diffs.push({ ...scope, file: f, kind, detail });
      const gp = path.join(gd, f), ap = path.join(ad, f);
      if (f === "pdf.json" && opts.pdf === false) continue;
      if (!fs.existsSync(ap)) { diff("missing", "not produced by this build"); continue; }
      if (f.endsWith(".png")) {
        if (!full) continue;
        const r = comparePixels(decodePng(fs.readFileSync(gp)), decodePng(fs.readFileSync(ap)), { range: !!opts.pixelRange });
        pixels.push({ ...scope, file: f, fraction: r.size ? 1 : r.fraction, maxDE: r.maxDE ?? null });
        if (r.size || r.fraction > PIXEL_FRACTION) {
          diff("pixels", r.size || `${(r.fraction * 100).toFixed(2)} % of the pixels differ (max ΔE ${r.maxDE})`);
          images.push({ ...scope, file: f, golden: gp, actual: ap, heat: r.heat ? encodePng(r.w, r.h, r.heat) : null });
        }
      } else if (/^slide-\d+\.json$/.test(f)) cmpSlide(readJson(gp), readJson(ap), full, diff);
      else if (f === "pdf.json") { if (opts.pdf !== false) cmpPdf(readJson(gp), readJson(ap), full, diff, n => goldenTexts(deck, design, version, n, goldenDir)); }
      else if (f === "comments.json" || f === "issues.json") {
        const g = readJson(gp), a = readJson(ap);
        if (JSON.stringify(g) !== JSON.stringify(a)) diff("text", `${f} differs: ${firstDiff(g, a)}`);
      }
    }
    for (const f of files(ad)) if (!f.endsWith(".png") && f !== "sp" && !fs.existsSync(path.join(gd, f))) diffs.push({ ...scope, file: f, kind: "new", detail: "not in the goldens" });
  }
  // decks, designs and versions this build produces that the goldens do not have
  for (const deck of decks) for (const design of files(path.join(actualDir, deck))) {
    if (!fs.existsSync(path.join(goldenDir, deck, design))) { diffs.push({ deck, design, version: "*", file: "*", kind: "new", detail: "design not in the goldens" }); continue; }
    for (const version of files(path.join(actualDir, deck, design)))
      if (!fs.existsSync(path.join(goldenDir, deck, design, version))) diffs.push({ deck, design, version, file: "*", kind: "new", detail: "version not in the goldens" });
  }
  if (!opts.decks) for (const deck of files(actualDir)) if (fs.statSync(path.join(actualDir, deck)).isDirectory() && !decks.includes(deck))
    diffs.push({ deck, design: "*", version: "*", file: "*", kind: "new", detail: "deck not in the goldens" });
  // a pixel entry with upTo (%) accepts its slide only up to that share of differing pixels (S4.4); of several entries for
  // a slide (each decision signed on its own), the first that admits it accepts it
  const share = d => { const m = /([\d.]+) % of the pixels/.exec(String(d.detail)); return m ? +m[1] : Infinity; };
  const admits = (a, d) => a.upTo === undefined || d.kind !== "pixels" || share(d) <= a.upTo;
  for (const d of diffs) d.accepted = accepted.find(a => (!a.tool || a.tool === (opts.tool || "parity")) && ["deck", "design", "version", "file", "kind"].every(k => a[k] === undefined || a[k] === d[k]) && admits(a, d)) || null;
  // an entry with a digest accepts exactly the differences it was signed for (S4.4): if those of its scope changed, none is
  for (const e of new Set(diffs.map(d => d.accepted).filter(x => x && x.digest))) {
    const mine = diffs.filter(d => d.accepted === e);
    if (detailsDigest(mine) !== e.digest) for (const d of mine) { d.accepted = null; d.detail += " (the accepted entry's differences changed)"; }
  }
  return { full, environment: { golden: ge, actual: ae }, diffs, images, pixels, unaccepted: diffs.filter(d => !d.accepted).length };
}
function firstDiff(g, a) {
  const G = JSON.stringify(g, null, 1).split("\n"), A = JSON.stringify(a, null, 1).split("\n");
  for (let i = 0; i < Math.max(G.length, A.length); i++) if (G[i] !== A[i]) return `${(G[i] || "").trim().slice(0, 80)} vs ${(A[i] || "").trim().slice(0, 80)}`;
  return "";
}

// ------------------------------------------------------------------------------------------- report
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function writeReport(res, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "img"), { recursive: true });
  const rows = res.diffs.map(d => `<tr class="${d.accepted ? "acc" : "bad"}"><td>${esc(d.deck)}</td><td>${esc(d.design)}</td><td>${esc(d.version)}</td><td>${esc(d.file)}</td><td>${esc(d.kind)}</td><td>${esc(d.detail)}</td><td>${d.accepted ? "accepted: " + esc(d.accepted.reason || "") : "regression?"}</td></tr>`).join("\n");
  const imgs = res.images.map((m, k) => {
    const base = `img/${k}-`; fs.copyFileSync(m.golden, path.join(dir, base + "golden.png")); fs.copyFileSync(m.actual, path.join(dir, base + "actual.png"));
    if (m.heat) fs.writeFileSync(path.join(dir, base + "heat.png"), m.heat);
    return `<h3>${esc(m.deck)} · ${esc(m.design)} · ${esc(m.version)} · ${esc(m.file)}</h3><div class="row"><figure><img src="${base}golden.png"><figcaption>golden</figcaption></figure><figure><img src="${base}actual.png"><figcaption>this build</figcaption></figure>${m.heat ? `<figure><img src="${base}heat.png"><figcaption>heat map</figcaption></figure>` : ""}</div>`;
  }).join("\n");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Parity report</title>
<style>body{font:14px system-ui,sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}tr.bad td{background:#fde8e8}tr.acc td{background:#eef7ee}.row{display:flex;gap:8px}figure{margin:0}img{width:520px;border:1px solid #999}</style>
<h1>Parity: ${res.unaccepted ? `${res.unaccepted} unaccepted difference(s)` : "no unaccepted differences"}</h1>
<p>Mode: ${res.full ? "full (same Chromium and fonts as the goldens)" : "text only – the environment differs from the goldens', so geometry, pixels and PDF positions were not compared"}.</p>
<p>Golden: Chromium ${esc(res.environment.golden.chromium)}, fonts ${esc(res.environment.golden.fontsSha256 || "").slice(0, 12)} · this run: Chromium ${esc(res.environment.actual.chromium)}, fonts ${esc(res.environment.actual.fontsSha256 || "").slice(0, 12)}</p>
<table><tr><th>deck</th><th>design</th><th>version</th><th>file</th><th>kind</th><th>detail</th><th></th></tr>${rows || '<tr><td colspan="7">none</td></tr>'}</table>${imgs}`);
}

// ------------------------------------------------------------------------------------------- main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const golden = path.resolve(arg("--golden", path.join(REPO, "golden")));
  const report = path.resolve(arg("--report", path.join(REPO, "tests", "parity", "report")));
  const acceptedFile = path.resolve(arg("--accepted", path.join(REPO, "tests", "parity", "accepted.json")));
  const decks = arg("--decks", null)?.split(",") || null;
  // from M4 the stage draws the display list (tools/stage-capture.mjs): its hits paired with the goldens' elements, its
  // screenshots, SP against the native PDF; --dom captures a build before M4 (v3's HTML stage) from its DOM
  const dom = process.argv.includes("--dom");
  // SP needs the goldens' environment (as geometry and pixels do): elsewhere (CI's runner) its exports are not made
  let sp = !dom && !process.argv.includes("--no-sp") && !process.argv.includes("--text-only");
  if (sp && !arg("--actual", null)) {
    const { openBrowser, environment } = await import("./capture-v3.mjs"), probe = await openBrowser(), env = environment(probe.browser.version());
    await probe.browser.close();
    const ge = readJson(path.join(golden, "MANIFEST.json")).environment || {};
    if (ge.chromium !== env.chromium || ge.fontsSha256 !== env.fontsSha256) { sp = false; console.log("SP (screen = PDF) not run: this environment is not the goldens'"); }
  }
  const stage = dom ? null : await import("./stage-capture.mjs");
  let actual = arg("--actual", null), tmp = null;
  if (!actual) {
    const { capture } = await import("./capture-v3.mjs");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-parity-"));
    actual = tmp;
    console.log("capturing this build...");
    await capture(actual, { decks: decks || undefined, pdf: !process.argv.includes("--no-pdf"), quiet: !process.argv.includes("--verbose"),
      ...(stage ? { noGeometry: true, slideHook: stage.stageHook(golden), ...(sp ? { versionHook: (page, h, v) => stage.exportNative(page, h, v.dir) } : {}) } : {}) });
  }
  const accepted = fs.existsSync(acceptedFile) ? readJson(acceptedFile) : [];
  // GP's pixel rule is the 3 × 3 range rule (decision G1-4) for the display list's pixels
  const res = compare(golden, actual, { accepted, decks, pdf: !process.argv.includes("--no-pdf"), full: process.argv.includes("--text-only") ? false : undefined, pixelRange: !dom });
  if (sp && res.full) {
    const s = stage.compareSP(actual, { comparePixels, decodePng, encodePng, PIXEL_FRACTION }, { accepted });
    res.diffs.push(...s.diffs); res.images.push(...s.images); res.unaccepted += s.diffs.filter(d => !d.accepted).length;
    const worst = s.pixels.reduce((m, p) => p.fraction > m.fraction ? p : m, { fraction: 0 });
    console.log(`SP (screen = PDF): ${s.pixels.length} slides, ${s.diffs.filter(d => d.kind === "sp").length} beyond ${PIXEL_FRACTION * 100} % of the pixels, ${s.diffs.filter(d => d.kind !== "sp").length} with text differences; worst ${(worst.fraction * 100).toFixed(2)} %${worst.deck ? ` (${worst.deck} · ${worst.design} · ${worst.version} · ${worst.file})` : ""}`);
    fs.writeFileSync(path.join(actual, "sp.json"), JSON.stringify(s.pixels, null, 1));
  }
  writeReport(res, report);
  // every difference as data (S4.4: the review package of the measured layout lists each one)
  if (arg("--diffs", null)) fs.writeFileSync(path.resolve(arg("--diffs", null)), JSON.stringify(res.diffs.map(({ accepted, ...d }) => ({ ...d, accepted: !!accepted })), null, 1));
  if (!res.full) console.log("NOTE: this machine's Chromium or fonts differ from the goldens' - only texts were compared (geometry, pixels and PDF positions need the same environment).");
  for (const d of res.diffs.slice(0, 40)) console.log(`${d.accepted ? "accepted " : "DIFF     "} ${d.deck} · ${d.design} · ${d.version} · ${d.file} · ${d.kind}: ${d.detail}`);
  if (res.diffs.length > 40) console.log(`... and ${res.diffs.length - 40} more (see the report)`);
  console.log(`parity: ${res.diffs.length} difference(s), ${res.unaccepted} not accepted (${res.full ? "full" : "text-only"} comparison) - report: ${path.relative(process.cwd(), path.join(report, "index.html"))}`);
  if (tmp && !process.argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
  else if (tmp) console.log("capture kept in " + tmp);
  process.exitCode = res.unaccepted ? 1 : 0;
}
