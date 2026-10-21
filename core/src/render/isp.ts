/* Excel and Excel Refined follow the Intesa Sanpaolo 16:9 template (product owner 2026-10-21, B48; colours in
   model/isp.ts). Every measure of the template the slide furniture uses lives here; slide-dl.ts draws with them
   (cover, contents, titles, text boxes and their bullets), pagenumbers.ts places the page number, layout.ts the
   content area, chart-dl.ts and shape-dl.ts take the chart and box rules.

   Units: the template's slide is 10 × 5.625 in (9 144 000 × 5 145 088 EMU); scaled onto the 1600 × 900 px slide, one
   template inch is 160 px (template EMU ÷ 5 715). Type sizes are the template's points at the PowerPoint export's
   0.6 pt per px (PT: 26 pt = 43.33 px), so the exported deck shows 26 pt / 16 pt / 10 pt as the template prescribes
   (the export's slide is 13.33 in wide: the same points read 75 % as large as on the template's 10 in slide – see the
   B48 report's open question). Liquid Glass and the consulting designs never read this file. */
import type { PathCmd } from "../dl/types";

/** slide px per point (the PowerPoint export: 1 px = 0.6 pt) */
export const PT = 5 / 3;
/** slide px per template inch */
const IN = 160;
const r2 = (v: number) => Math.round(v * 100) / 100;

export const ISP = {
  /** "Titolo: 26pt C.Gothic bold, colore Blu" at (0.436 in, 0.307 in); the line box's top so that the first baseline
      sits where PowerPoint puts it (lnSpc 100 %: ascent under the box's top; the slide's line height is 1.4 em) */
  title: { x: r2(.436 * IN), top: 45, size: r2(26 * PT) },
  /** "Sottotitolo: 16pt C.Gothic, colore nero 50%" at 0.787 in */
  sub: { top: 124, size: r2(16 * PT) },
  /** the content area: left at the title's x, as wide on the right; below the title (and subtitle) */
  area: { x: 70, w: 1460, y: 122, ySub: 176, bottom: 822 },
  /** the page number (master: "Segnaposto numero diapositiva", 9.254 in, 0.148 in, 0.453 in wide, right-aligned, 10 pt
      bold blue): the text's right edge (the box less its 0.1 in inset) and its line box's top */
  pageno: { right: 1537, top: 31 },
  /** the logo at the bottom right (master: 8.068 in, 5.177 in, 0.191 in high): its right edge, top and height */
  logo: { right: r2((8.068 + 1.703) * IN), top: r2(5.177 * IN), h: r2(.191 * IN), maxW: 280 },
  cover: {
    /** the blue diagonal band at the top left ("Figura a mano libera 5": a freeform turned −15.24°, Blu at 75 %
        opacity), as the triangle it shows on the slide */
    band: [[0, 0], [821.17, 0], [22.85, 140.35]] as [number, number][], bandAlpha: .75,
    /** the deck's logo above the title (1.771 in, 2.111 in, 0.424 in high, at most 3.776 in wide), left-aligned */
    logo: { x: r2(1.771 * IN), top: r2(2.111 * IN), h: r2(.424 * IN), maxW: r2(3.776 * IN) },
    /** "Titolo Presentazione: 26pt C.Gothic bold, colore Blu" (1.771 in, 2.851 in, 7.024 in wide), left-aligned */
    title: { x: r2(1.771 * IN), top: r2(2.851 * IN), w: r2(7.024 * IN), size: r2(26 * PT), lh: 1.15 },
    /** "Sottotitolo: 16pt C.Gothic, colore Nero 50%" under the title */
    sub: { size: r2(16 * PT), gap: 24, lh: 1.3 },
    /** the cover's own note (over the title) and date (under the subtitle): the template has neither, they stay small */
    note: { size: r2(11 * PT), ls: 1.6, gap: 12 }, date: { size: r2(12 * PT), gap: 18 },
  },
  /** the contents ("INDICE", page 2): the heading at (3.086 in, 1.248 in), 26 pt bold blue; the rows' text at 3.866 in,
      every 0.4 in from 1.866 in, 16 pt – "XX" (the page) bold blue, then the entry; the marks' column at 3.42 in */
  index: { x: r2(3.086 * IN), top: r2(1.248 * IN) - 4, rowX: r2(3.866 * IN), markX: r2(3.42 * IN), rowTop: r2(1.866 * IN), pitch: r2(.4 * IN), size: r2(16 * PT), minPitch: 40 },
  /** first-level bullets: the square tilted 10° filled at 25 % transparency; second level the same square in outline
      (page 12); its side and the hanging indent in em, the outline's width in em */
  bullet: { side: .5, indent: 1, turn: -10, alpha: .75, outline: .075 },
  /** text boxes in a box: white with the template's outline (Nero 50 %, 1 pt; page 4), square corners */
  box: { border: "#7F7F7F", w: PT },
  /** charts (page 10): doughnuts thinner (the hole's share of the radius); trend charts as a line only (M14's line and
      area charts take lineW and areaAsLine when they meet this branch) */
  chart: { hole: .75, lineW: r2(1.5 * PT), areaAsLine: true },
};

/** a tilted square centred on (cx, cy) of side s, as path commands */
export function tiltedSquare(cx: number, cy: number, s: number, deg = ISP.bullet.turn): PathCmd[] {
  const a = deg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a), h = s / 2;
  const pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [r2(cx + x * c - y * n), r2(cy + x * n + y * c)] as [number, number]);
  return [...pts.map((p, i): PathCmd => [i ? "L" : "M", p[0], p[1]]), ["Z"]];
}
