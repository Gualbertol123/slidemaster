/* Excel and Excel Refined follow the Intesa Sanpaolo 16:9 template (product owner 2026-10-21, B48; colours in
   model/isp.ts). Every measure of the template the slide furniture uses lives here; slide-dl.ts draws with them
   (cover, contents, titles, text boxes and their bullets), pagenumbers.ts places the page number, layout.ts the
   content area, chart-dl.ts and shape-dl.ts take the chart and box rules.

   One scale (B48 review, 4): the template's slide is 10 × 5.625 in (9 144 000 × 5 145 088 EMU); ours is 1600 × 900 px,
   13.33 × 7.5 in in the PowerPoint export. Everything of the template – positions, type sizes and line widths – is
   scaled by the same factor, 13.33 / 10 = 4/3: one template inch is 160 px (template EMU ÷ 5 715), one template point
   is 4/3 × 5/3 = 20/9 px (the export writes 0.6 pt per px, so 26 pt on the template is 34.67 pt in the export). A PDF
   or PNG of a slide therefore matches the template's own page at the same page size. Liquid Glass and the consulting
   designs never read this file. */
import type { PathCmd } from "../dl/types";

/** slide px per export point (the PowerPoint export: 1 px = 0.6 pt) */
export const PT = 5 / 3;
/** the template's slide (10 in) onto the export's (13.33 in) */
export const K = 4 / 3;
/** slide px per template inch */
const IN = 160;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** a template size in points as slide px (to 1/1000 px) */
export const tpt = (pt: number) => Math.round(pt * K * PT * 1000) / 1000;
/** Century Gothic's ascent and descent (em): PowerPoint puts a line's first baseline one ascent under its frame's top
    inset (lnSpc 100 %); the slide's line box of `lh` em puts it half the leading lower – the line box's top that puts the
    baseline where PowerPoint does */
const CG = { asc: 1.006, desc: .203 };
const lineTop = (frameTop: number, size: number, lh = 1.4) => r2(frameTop - (lh - CG.asc - CG.desc) / 2 * size);
/** the default text inset of the template's text boxes (lIns 0.1 in, tIns 0.05 in) */
const INS = { l: 90000 / 914400 * IN, t: 46800 / 914400 * IN };

const TITLE = tpt(26), SUB = tpt(16);
/** the contents' rows: 16 pt in frames every 0.4 in from 1.866 in (their text at the frame's top inset) */
const ROW = { size: SUB, pitch: r2(.4 * IN), frame: 1.866 * IN + INS.t };

export const ISP = {
  /** "Titolo: 26pt C.Gothic bold, colore Blu" at (0.436 in, 0.307 in), no insets: the line box's top (1.4 em) whose
      baseline sits where PowerPoint draws the template's */
  title: { x: r2(.436 * IN), top: lineTop(.307 * IN, TITLE), size: TITLE, min: tpt(20) },
  /** "Sottotitolo: 16pt C.Gothic, colore nero 50%" at 0.787 in */
  sub: { top: lineTop(.787 * IN, SUB), size: SUB, min: tpt(12) },
  /* (B48 fix) a title or subtitle runs to the content area's right edge – clear of a page number at the top right – and
     one too long for it shrinks to fit, down to `min` (20 pt / 12 pt on the template: v3's 44 px title fits what it
     fitted), before it is cut with "…": the template's 26 pt type no longer cuts titles v3 showed whole */
  /** the content area: left at the title's x, as wide on the right; below the title's descent (and the subtitle's) */
  area: { x: 70, w: 1460, y: 130, ySub: 178, bottom: 822 },
  /** the page number (master: "Segnaposto numero diapositiva", 9.254 in, 0.148 in, 0.453 in wide, right-aligned, 10 pt
      bold blue): the text's right edge (the box less its 0.1 in inset) and its line box's top; its size is the deck's
      page-number setting */
  pageno: { right: 1537, top: 31 },
  /** the logo at the bottom right (master: 8.068 in, 5.177 in, 0.191 in high): its right edge, top and height */
  logo: { right: r2((8.068 + 1.703) * IN), top: r2(5.177 * IN), h: r2(.191 * IN), maxW: 280 },
  /** (B48 fix) the template's bottom area is one row, the logo's (5.177–5.368 in, under the content area): a page number
      or footer at the bottom sits on it, centred on the logo's middle, a bottom-left one at the content's left margin;
      the notes section (sources, footnotes) by default on the same row beside them – the first stretch of the row left
      free between the content area's edges (`gap` clear of the footer, the page number and the logo), as wide as the
      box asks or at least `minW`; the template has no room above the row without taking it from the content area */
  row: { mid: r2((5.177 + .191 / 2) * IN), gap: 24, minW: 320 },
  cover: {
    /** the blue diagonal band at the top left ("Figura a mano libera 5": a freeform turned −15.24°, Blu at 75 %
        opacity), as the triangle it shows on the slide */
    band: [[0, 0], [821.17, 0], [22.85, 140.35]] as [number, number][], bandAlpha: .75,
    /** the deck's logo above the title (1.771 in, 2.111 in, 0.424 in high, at most 3.776 in wide), left-aligned */
    logo: { x: r2(1.771 * IN), top: r2(2.111 * IN), h: r2(.424 * IN), maxW: r2(3.776 * IN) },
    /** "Titolo Presentazione: 26pt C.Gothic bold, colore Blu" (1.771 in, 2.851 in, 7.024 in wide, no insets),
        left-aligned; lines 1.15 em apart */
    title: { x: r2(1.771 * IN), top: lineTop(2.851 * IN, TITLE, 1.15), w: r2(7.024 * IN), size: TITLE, lh: 1.15 },
    /** "Sottotitolo: 16pt C.Gothic, colore Nero 50%" at 3.880 in (B48 review, 5) – lower only when a long title reaches
        down to it (then `gap` under the title) */
    sub: { top: lineTop(3.88 * IN, SUB, 1.3), size: SUB, gap: 24, lh: 1.3 },
    /** the cover's own note (over the title) and date (under the subtitle): the template has neither, they stay small */
    note: { size: tpt(11), ls: 1.6, gap: 12 }, date: { size: tpt(12), gap: 18 },
  },
  /** the contents ("INDICE", page 2): the heading's frame at (3.086 in, 1.248 in), 26 pt bold blue, the text at its
      insets; the rows' text at 3.866 in (+ inset), every 0.4 in from 1.866 in, 16 pt – "XX" (the page) bold blue, then
      the entry; the marks' column at 3.42 in. `rowTop`: a row's line box (the pitch high) whose baseline is the frame's */
  index: { x: r2(3.086 * IN + INS.l), top: lineTop(1.248 * IN + INS.t, TITLE), rowX: r2(3.866 * IN + INS.l), markX: r2(3.42 * IN),
    rowTop: r2(ROW.frame - (ROW.pitch - (CG.asc + CG.desc) * ROW.size) / 2), pitch: ROW.pitch, size: ROW.size, minPitch: 40 },
  /** first-level bullets: the square tilted 10° filled at 25 % transparency; second level the same square in outline
      (page 12); its side and the hanging indent in em, the outline's width in em. The PowerPoint export writes them as
      the paragraphs' own bullets (pptx/scene.ts: a square character, not tilted) */
  bullet: { side: .5, indent: 1, turn: -10, alpha: .75, outline: .075 },
  /** text boxes in a box: white with the template's outline (Nero 50 %, 1 pt on the template; page 4), square corners */
  box: { border: "#7F7F7F", w: tpt(1) },
  /** charts (page 10): doughnuts thinner (the hole's share of the radius); trend charts as a line only – a line
      series' default width, and area series drawn as lines (chart-dl.ts chartLook → chart-series.ts, the M14 merge) */
  chart: { hole: .75, lineW: 1.5 * K * PT, areaAsLine: true },   // (lineW unrounded: exactly 2 pt in the PowerPoint export)
};

/** a tilted square centred on (cx, cy) of side s, as path commands */
export function tiltedSquare(cx: number, cy: number, s: number, deg = ISP.bullet.turn): PathCmd[] {
  const a = deg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a), h = s / 2;
  const pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [r2(cx + x * c - y * n), r2(cy + x * n + y * c)] as [number, number]);
  return [...pts.map((p, i): PathCmd => [i ? "L" : "M", p[0], p[1]]), ["Z"]];
}
