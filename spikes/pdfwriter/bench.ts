/* Spike benchmark: a 20-slide deck like spikes/baseline/deck20.xlsx (two weekly-report tables per slide),
   drawn as display lists in the Excel design and the Liquid Glass design, written as vector PDF.
   node bench.ts [outdir]   → timings + out-native-excel.pdf, out-native-glass.pdf */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFont, measure, type Font } from "./ttf.ts";
import { writePdf, type Node, type RGB, type Stop } from "./pdf.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = process.argv[2] || HERE;
const FONTDIR = "/usr/share/fonts/truetype/crosextra";
const load = (f: string, n: string) => parseFont(new Uint8Array(fs.readFileSync(path.join(FONTDIR, f))), n);
const fonts = new Map<string, Font>([["r", load("Carlito-Regular.ttf", "Carlito")], ["b", load("Carlito-Bold.ttf", "Carlito-Bold")], ["bi", load("Carlito-BoldItalic.ttf", "Carlito-BoldItalic")]]);
const images = new Map<string, Uint8Array>([["wall", new Uint8Array(fs.readFileSync(path.join(HERE, "assets/wall-sharp.jpg")))], ["blur", new Uint8Array(fs.readFileSync(path.join(HERE, "assets/wall-blur.jpg")))]]);

// ---- the same made-up numbers as the workbook generator
const banks = ["VUB", "PBZ", "BIB", "Alex", "CIB", "ISP SLO", "ISP RO", "ISP ALB", "ISP BiH", "EximBank", "Pravex"];
const groups = ["Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. EoM Aug 2026", "Δ vs. Q2", "Δ vs. BoY"];
const it = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const sgn = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "") + it(Math.abs(n));
const pct = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n * 100).toFixed(1).replace(".", ",") + "%";
function rows(seed: number) {
  const out: { label: string; cells: (number | null)[]; bold: boolean }[] = [];
  for (let k = 0; k < banks.length; k++) {
    const base = 1000 * (k + 2) + seed * 37, wk = [base - 30 * ((k * 7 + seed) % 5), base - 12 * ((k * 3 + seed) % 4), base];
    const budget = k >= 9 ? null : base - ((k * 53 + seed * 11) % 190) + 80;
    const ref = [budget, wk[1], base - 140 + (k * 29 + seed) % 260, base - 220 + (k * 41) % 400, base - 600 + (k * 61) % 900];
    out.push({ label: banks[k], bold: false, cells: [...wk, budget, ...ref.flatMap(v => v == null ? [null, null] : [base - v, (base - v) / v])] });
  }
  const tot = { label: "TOTAL BANKS", bold: true, cells: out[0].cells.map((_, i) => i % 2 === 0 && i >= 4 ? out.reduce((s, r) => s + (r.cells[i] ?? 0), 0) : i >= 4 ? 0.0123 * ((i * 7) % 5 - 2) : out.reduce((s, r) => s + (r.cells[i] ?? 0), 0)) };
  return [tot, ...out];
}
const COLW = [150, 64, 64, 64, 70, 58, 50, 58, 50, 58, 50, 58, 50, 58, 50], ROWH = 21, X0 = 0;
const fmt = (i: number, v: number | null) => v == null ? "" : i < 4 ? it(v) : (i % 2 === 0 ? sgn(v) : pct(v));

/** text node, aligned in a box with the font's advance widths (the same measurement drives the screen) */
function text(s: string, font: string, size: number, x: number, w: number, y: number, h: number, align: "l" | "r" | "c", c: RGB): Node {
  const f = fonts.get(font)!, tw = measure(f, s) * size;
  const tx = align === "l" ? x + 6 : align === "r" ? x + w - 6 - tw : x + (w - tw) / 2;
  const base = y + h / 2 + (f.capHeight / f.unitsPerEm) * size / 2;
  return { t: "text", font, size, x: tx, y: base, s, c };
}

function excelTable(ox: number, oy: number, k: number, seed: number, name: string): Node[] {
  const n: Node[] = [], blue: RGB = [31, 78, 121], W = COLW.reduce((a, b) => a + b, 0);
  let x = ox; const xs = COLW.map(w => { const v = x; x += w * k; return v; });
  const hdr = (r: number, c0: number, c1: number, s: string) => {
    const xx = xs[c0], w = xs[c1] + COLW[c1] * k - xx, y = oy + r * ROWH * k;
    n.push({ t: "rect", x: xx, y, w, h: ROWH * k, fill: { solid: blue } }, text(s, "bi", 11 * 96 / 72 * k, xx, w, y, ROWH * k, "c", [255, 255, 255]));
  };
  ["Week37", "Week38", "Week39"].forEach((s, i) => { hdr(0, 1 + i, 1 + i, s); hdr(1, 1 + i, 1 + i, ["11/09/26", "18/09/26", "25/09/26"][i]); });
  hdr(0, 4, 4, "Eom Budget"); n.push({ t: "rect", x: xs[4], y: oy + ROWH * k, w: COLW[4] * k, h: ROWH * k, fill: { solid: blue } });
  groups.forEach((g, i) => { hdr(0, 5 + 2 * i, 6 + 2 * i, g); hdr(1, 5 + 2 * i, 5 + 2 * i, "Abs."); hdr(1, 6 + 2 * i, 6 + 2 * i, "%"); });
  rows(seed).forEach((r, ri) => {
    const y = oy + (3 + ri + (ri ? 1 : 0)) * ROWH * k, h = ROWH * k;
    n.push(text(ri === 0 ? name : r.label, r.bold ? "b" : "r", 11 * 96 / 72 * k, xs[0], COLW[0] * k, y, h, "l", [0, 0, 0]));
    r.cells.forEach((v, i) => {
      const c = i + 1, cf = i >= 4 && v != null && v !== 0;
      if (cf) n.push({ t: "rect", x: xs[c], y, w: COLW[c] * k, h, fill: { solid: v! > 0 ? [0, 176, 80] : [255, 0, 0] } });
      const s = fmt(i, v); if (s) n.push(text(s, r.bold ? "b" : "r", 11 * 96 / 72 * k, xs[c], COLW[c] * k, y, h, "r", cf ? [255, 255, 255] : [0, 0, 0]));
    });
    if (ri === 0) n.push({ t: "line", x1: ox, y1: y, x2: ox + W * k, y2: y, stroke: { c: [0, 0, 0], w: 1 } }, { t: "line", x1: ox, y1: y + h, x2: ox + W * k, y2: y + h, stroke: { c: [0, 0, 0], w: 1 } },
      { t: "line", x1: ox, y1: y, x2: ox, y2: y + h, stroke: { c: [0, 0, 0], w: 1 } }, { t: "line", x1: ox + W * k, y1: y, x2: ox + W * k, y2: y + h, stroke: { c: [0, 0, 0], w: 1 } });
  });
  return n;
}

const LENS = 1.06;
/** a glass card: soft shadow, blurred wallpaper seen through it (one shared picture), tint, rim */
function glassCard(x: number, y: number, w: number, h: number, r: number, tint: Stop[] | null): Node[] {
  const cx = x + w / 2, cy = y + h / 2;
  return [
    { t: "shadow", x, y, w, h, r, dx: 0, dy: 22, blur: 48, spread: -24, c: [28, 40, 100], a: 0.25 },
    { t: "group", clip: { x, y, w, h, r }, children: [
      { t: "image", id: "blur", x: -(LENS - 1) * cx, y: -(LENS - 1) * cy, w: 1600 * LENS, h: 900 * LENS },
      { t: "rect", x, y, w, h, fill: { lin: [0, 0, 0, 1], stops: tint || [{ o: 0, c: [255, 255, 255], a: 0.72 }, { o: 1, c: [255, 255, 255], a: 0.52 }] } },
    ] },
    { t: "rect", x: x + 0.6, y: y + 0.6, w: w - 1.2, h: h - 1.2, r, stroke: { c: [255, 255, 255], a: 0.8, w: 1.25 } },
  ];
}
function glassTable(ox: number, oy: number, k: number, seed: number, name: string): Node[] {
  const W = COLW.reduce((a, b) => a + b, 0) * k, H = 17 * ROWH * k, n: Node[] = [...glassCard(ox - 10, oy - 6, W + 20, H + 12, 24, null)];
  let x = ox; const xs = COLW.map(w => { const v = x; x += w * k; return v; });
  // header band: tinted glass of the Excel header colour, deep ink text
  n.push(...glassCard(xs[1], oy, W - (xs[1] - ox), 2 * ROWH * k, 12, [{ o: 0, c: [214, 226, 240], a: 0.86 }, { o: 1, c: [196, 212, 232], a: 0.78 }]).slice(1));
  const ink: RGB = [16, 46, 79];
  const hdr = (r: number, c0: number, c1: number, s: string) => { const xx = xs[c0], w = xs[c1] + COLW[c1] * k - xx; n.push(text(s, "b", 14.2 * k, xx, w, oy + r * ROWH * k, ROWH * k, "c", ink)); };
  ["Week37", "Week38", "Week39"].forEach((s, i) => { hdr(0, 1 + i, 1 + i, s); hdr(1, 1 + i, 1 + i, ["11/09/26", "18/09/26", "25/09/26"][i]); });
  hdr(0, 4, 4, "Eom Budget");
  groups.forEach((g, i) => { hdr(0, 5 + 2 * i, 6 + 2 * i, g); hdr(1, 5 + 2 * i, 5 + 2 * i, "Abs."); hdr(1, 6 + 2 * i, 6 + 2 * i, "%"); });
  rows(seed).forEach((r, ri) => {
    const y = oy + (3 + ri + (ri ? 1 : 0)) * ROWH * k, h = ROWH * k;
    if (ri === 0) n.push(...glassCard(ox, y - 1, W, h + 2, 10, [{ o: 0, c: [255, 255, 255], a: 0.9 }, { o: 1, c: [240, 244, 255], a: 0.7 }]).slice(1));
    else n.push({ t: "rect", x: ox + 12, y, w: W - 24, h: 1, fill: { lin: [0, 0, 1, 0], stops: [{ o: 0, c: [30, 40, 80], a: 0 }, { o: 0.05, c: [30, 40, 80], a: 0.14 }, { o: 0.95, c: [30, 40, 80], a: 0.14 }, { o: 1, c: [30, 40, 80], a: 0 }] } });
    n.push(text(ri === 0 ? name : r.label, r.bold || ri === 0 ? "b" : "r", 14.2 * k, xs[0], COLW[0] * k, y, h, "l", [11, 13, 23]));
    r.cells.forEach((v, i) => {
      const c = i + 1, cf = i >= 4 && v != null && v !== 0; let col: RGB = [11, 13, 23];
      if (cf) {   // signal → capsule (green/red glass gradient), deep ink
        const pos = v! > 0; col = pos ? [19, 107, 46] : [168, 16, 26];
        n.push({ t: "rect", x: xs[c] + 3, y: y + 3.5, w: COLW[c] * k - 6, h: h - 7, r: (h - 7) / 2, fill: { lin: [0, 0, 0, 1], stops: pos ? [{ o: 0, c: [64, 208, 102], a: 0.6 }, { o: 1, c: [46, 190, 84], a: 0.44 }] : [{ o: 0, c: [255, 82, 72], a: 0.54 }, { o: 1, c: [245, 52, 42], a: 0.38 }] } });
      }
      const s = fmt(i, v); if (s) n.push(text(s, ri === 0 ? "b" : "r", 14.2 * k, xs[c], COLW[c] * k, y, h, "r", col));
    });
  });
  return n;
}
function slide(design: "excel" | "glass", i: number): Node[] {
  const k = 1.0, title = `Total Banks Loans & Deposits ${i + 1}`;
  const n: Node[] = design === "glass" ? [{ t: "image", id: "wall", x: 0, y: 0, w: 1600, h: 900 }] : [{ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: { solid: [255, 255, 255] } }];
  n.push({ t: "text", font: "b", size: 34, x: 56, y: 70, s: title, c: [11, 13, 23] }, { t: "text", font: "r", size: 18, x: 56, y: 100, s: "(mln Euro at last fixed exchange rate)", c: [80, 86, 110] });
  const tw = COLW.reduce((a, b) => a + b, 0) * k, ox = (1600 - tw) / 2;
  const tab = design === "glass" ? glassTable : excelTable;
  n.push(...tab(ox, 140, k, i + 1, "TOTAL BANKS LOANS"), ...tab(ox, 140 + 17 * ROWH * k + 28 + 10, k, i + 2, "TOTAL BANKS DEPOSITS"));
  if (design === "glass") n.push({ t: "rect", x: 1500, y: 846, w: 56, h: 30, r: 15, fill: { lin: [0, 0, 0, 1], stops: [{ o: 0, c: [255, 255, 255], a: 0.78 }, { o: 1, c: [255, 255, 255], a: 0.42 }] } });
  n.push({ t: "text", font: "b", size: 16, x: 1518, y: 867, s: String(i + 1), c: [11, 13, 23] });
  return n;
}

const res: Record<string, unknown> = {};
for (const d of ["excel", "glass"] as const) {
  const times: number[] = []; let pdf: Uint8Array = new Uint8Array(); let nodes = 0;
  for (let rep = 0; rep < 5; rep++) {
    const t0 = performance.now();
    const slides = Array.from({ length: 20 }, (_, i) => ({ nodes: slide(d, i) }));
    nodes = slides.reduce((s, x) => s + x.nodes.length, 0);
    pdf = writePdf({ slides, fonts, images });
    times.push(Math.round(performance.now() - t0));
  }
  const f = path.join(OUT, `out-native-${d}.pdf`); fs.writeFileSync(f, pdf);
  res[d] = { ms_build_and_write_20_slides: times, bytes: pdf.length, kb_per_page: +(pdf.length / 1024 / 20).toFixed(1), display_list_nodes: nodes };
}
console.log(JSON.stringify(res, null, 1));
