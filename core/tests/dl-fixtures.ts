/* One display list per node type (every variant the designs use), drawn by the unit tests in all three backends
   and by tools/dlcheck.mjs, which compares the PDF rendered by PDFium with the canvas rendered by Chromium (SP).
   Pure: the caller passes the font and picture bytes (tests/fixtures/). */
import { zlibSync } from "fflate";
import type { DisplayList, Node, RGB } from "../src/dl/types";
import { parseFont } from "../src/pdf/ttf";

export interface FixtureAssets { carlito: Uint8Array; carlitoBold: Uint8Array; jpeg: Uint8Array }
export interface Fixtures {
  lists: Record<string, DisplayList>;
  /** picture bytes by image id */
  images: Map<string, Uint8Array>;
  /** font bytes by "family|b" */
  fonts: Map<string, Uint8Array>;
}

/** a PNG of RGBA pixels (colour type 6, no filter), for pictures with alpha */
export function encodePng(w: number, h: number, rgba: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array(h * (1 + 4 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba(x, y), y * (1 + 4 * w) + 1 + 4 * x);
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const chunk = (tag: string, body: Uint8Array) => {
    const o = new Uint8Array(12 + body.length), dv = new DataView(o.buffer);
    dv.setUint32(0, body.length); for (let i = 0; i < 4; i++) o[4 + i] = tag.charCodeAt(i); o.set(body, 8);
    let c = 0xffffffff; for (let i = 4; i < 8 + body.length; i++) c = crcT[(c ^ o[i]) & 255] ^ (c >>> 8);
    dv.setUint32(8 + body.length, (c ^ 0xffffffff) >>> 0); return o;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const WHITE: RGB = [255, 255, 255], INK: RGB = [20, 32, 51], BLUE: RGB = [31, 78, 121], RED: RGB = [220, 38, 38], GREEN: RGB = [0, 176, 80], GOLD: RGB = [234, 179, 8];
const bg = (c: RGB = WHITE): Node => ({ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: { solid: c } });

export function nodeFixtures(a: FixtureAssets): Fixtures {
  // pictures: the JPEG, a PNG with an alpha ring (a keyed picture), its soft drop shadow, an opaque checker PNG
  const ring = encodePng(192, 192, (x, y) => { const d = Math.hypot(x - 95.5, y - 95.5); return d < 60 ? [255, 255, 255, 0] : d < 92 ? [37, 99, 235, 255] : [0, 0, 0, 0]; });
  const shadow = encodePng(208, 208, (x, y) => { const d = Math.hypot(x - 103.5, y - 103.5); return [0, 0, 0, Math.max(0, Math.min(140, Math.round((100 - d) * 6)))]; });
  const checker = encodePng(240, 180, (x, y) => ((x / 30 | 0) + (y / 30 | 0)) & 1 ? [234, 179, 8, 255] : [20, 32, 51, 255]);
  const images = new Map([["jpg", a.jpeg], ["ring", ring], ["ring-shadow", shadow], ["checker", checker], ["jpg-copy", a.jpeg.slice()]]);
  const fonts = new Map([["Carlito|", a.carlito], ["Carlito|b", a.carlitoBold]]);

  // a shaped run by hand: glyph ids from the font's cmap, advances from hmtx with a 2 px kern after "A"
  const f = parseFont(a.carlito, "Carlito"), size = 40, k = size / f.unitsPerEm;
  const word = "AVATAR 1.234,5";
  const gids = [...word].map(ch => f.cmap.get(ch.codePointAt(0)!) || 0), adv = gids.map((g, i) => f.advances[g] * k - (word[i] === "A" ? 2 : 0));
  const measured = (s: string, sz: number, kern = 0) => [...s].reduce((w, ch) => w + f.advances[f.cmap.get(ch.codePointAt(0)!) || 0] * sz / f.unitsPerEm, 0) + kern;
  /** a run shaped with the font's advances (what shaping gives without kerning), `extra` px wider in all */
  const fb = parseFont(a.carlitoBold, "Carlito-Bold");
  const shaped = (s: string, sz: number, font = f, extra = 0) => {
    const g = [...s].map(ch => font.cmap.get(ch.codePointAt(0)!) || 0), n = g.length;
    const ad = g.map(x => font.advances[x] * sz / font.unitsPerEm + extra / n);
    return { gids: g, adv: ad, w: ad.reduce((t, v) => t + v, 0) };
  };

  const lists: Record<string, DisplayList> = {
    rect: [bg(),
      { t: "rect", x: 60, y: 60, w: 300, h: 160, fill: { solid: BLUE } },
      { t: "rect", x: 420, y: 60, w: 300, h: 160, r: 24, fill: { solid: RED, a: .5 } },
      { t: "rect", x: 520, y: 120, w: 300, h: 160, r: [0, 40, 8, 80], fill: { solid: GREEN, a: .6 } },
      { t: "rect", x: 880, y: 60, w: 300, h: 160, r: 16, fill: { linear: [0, 0, 1, 1], stops: [{ o: 0, c: BLUE, a: 1 }, { o: .5, c: GOLD, a: 1 }, { o: 1, c: RED, a: 1 }] } },
      // glass tint: white with fading alpha (a soft mask), over a dark band
      { t: "rect", x: 60, y: 300, w: 1480, h: 220, fill: { solid: INK } },
      { t: "rect", x: 100, y: 330, w: 420, h: 160, r: 28, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: WHITE, a: .55 }, { o: 1, c: WHITE, a: .08 }] } },
      // a cover shape: elliptical radial with its centre above the box
      { t: "rect", x: 580, y: 330, w: 420, h: 160, r: 28, fill: { radial: { cx: .16, cy: -.2, rx: 1.3, ry: .85, stops: [{ o: 0, c: GOLD, a: .9 }, { o: .6, c: RED, a: .5 }, { o: 1, c: RED, a: 0 }] } } },
      { t: "rect", x: 1060, y: 330, w: 420, h: 160, r: 80, fill: { radial: { cx: .5, cy: .5, rx: .5, ry: .5, stops: [{ o: 0, c: GREEN, a: 1 }, { o: 1, c: BLUE, a: 1 }] } } },
      { t: "rect", x: 60, y: 600, w: 300, h: 200, stroke: { w: 4, paint: { solid: BLUE } } },
      { t: "rect", x: 420, y: 600, w: 300, h: 200, r: 20, stroke: { w: 3, paint: { solid: RED }, dash: [12, 6] } },
      { t: "rect", x: 780, y: 600, w: 300, h: 200, r: 30, fill: { solid: INK }, stroke: { w: 1.25, paint: { linear: [0, 0, 1, 1], stops: [{ o: 0, c: WHITE, a: 1 }, { o: 1, c: WHITE, a: .16 }] } } },
      { t: "rect", x: 1140, y: 600, w: 400, h: 200, r: 100, fill: { solid: GOLD, a: .35 }, stroke: { w: 6, paint: { solid: GREEN, a: .5 } } },
      // a thin pill with a wide fading rim: the ring reaches far outside the box (the soft mask must cover it)
      { t: "rect", x: 60, y: 860, w: 600, h: 2, fill: { solid: INK }, stroke: { w: 20, paint: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: BLUE, a: 1 }, { o: 1, c: BLUE, a: .1 }] } } },
      // a linear paint without a direction: its last stop, in every backend
      { t: "rect", x: 760, y: 840, w: 200, h: 40, fill: { linear: [.5, .5, .5, .5], stops: [{ o: 0, c: RED, a: 1 }, { o: 1, c: BLUE, a: 1 }] } },
      // a sharp miter join (limit 10 everywhere)
      { t: "rect", x: 1000, y: 840, w: 200, h: 40, stroke: { w: 1, paint: { solid: INK } } }],
    path: [bg(),
      { t: "path", d: [["M", 100, 400], ["L", 300, 80], ["L", 500, 400], ["Z"]], fill: { solid: BLUE } },
      { t: "path", d: [["M", 600, 400], ["C", 650, 50, 900, 50, 950, 400]], stroke: { w: 6, paint: { solid: RED }, cap: "round" } },
      { t: "path", d: [["M", 1050, 100], ["L", 1450, 100], ["L", 1450, 400], ["L", 1050, 400], ["Z"], ["M", 1150, 180], ["L", 1350, 180], ["L", 1350, 320], ["L", 1150, 320], ["Z"]], rule: "evenodd", fill: { solid: GREEN } },
      { t: "path", d: [["M", 100, 500], ["L", 700, 500], ["L", 600, 800], ["L", 200, 800], ["Z"]], fill: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: GOLD, a: 1 }, { o: 1, c: BLUE, a: .2 }] }, stroke: { w: 2, paint: { solid: INK }, dash: [4, 4] } },
      // a slanted border (slantDashDot)
      { t: "path", d: [["M", 800, 520], ["L", 1500, 520], ["L", 1500, 524], ["L", 800, 524], ["Z"]], fill: { solid: INK } },
      // a sharp joint: the miter reaches out (limit 10 in every backend)
      { t: "path", d: [["M", 900, 800], ["L", 1100, 620], ["L", 1300, 800]], stroke: { w: 10, paint: { solid: BLUE } } },
      // joins (ADR-004 amendment, ADR-020; 09 §3): round, bevel and an explicit miter – every backend draws all three
      { t: "path", d: [["M", 110, 885], ["L", 190, 830], ["L", 270, 885]], stroke: { w: 14, paint: { solid: RED }, join: "round" } },
      { t: "path", d: [["M", 330, 885], ["L", 410, 830], ["L", 490, 885]], stroke: { w: 14, paint: { solid: GREEN }, join: "bevel" } },
      { t: "path", d: [["M", 550, 885], ["L", 630, 830], ["L", 710, 885]], stroke: { w: 14, paint: { solid: BLUE }, join: "miter", cap: "round" } }],
    line: [bg(),
      { t: "line", x1: 100, y1: 100, x2: 1500, y2: 100, stroke: { w: .5, paint: { solid: INK } } },
      { t: "line", x1: 100, y1: 160, x2: 1500, y2: 160, stroke: { w: 1, paint: { solid: INK } } },
      { t: "line", x1: 100, y1: 220, x2: 1500, y2: 220, stroke: { w: 2, paint: { solid: BLUE } } },
      { t: "line", x1: 100, y1: 280, x2: 1500, y2: 280, stroke: { w: 3, paint: { solid: BLUE } } },
      { t: "line", x1: 100, y1: 340, x2: 1500, y2: 340, stroke: { w: 1, paint: { solid: RED }, dash: [3, 1] } },
      { t: "line", x1: 100, y1: 400, x2: 1500, y2: 400, stroke: { w: 2, paint: { solid: RED }, dash: [2, 2] } },
      { t: "line", x1: 100, y1: 460, x2: 1500, y2: 460, stroke: { w: 2, paint: { solid: GREEN }, dash: [9, 3, 3, 3] } },
      { t: "line", x1: 100, y1: 520, x2: 1500, y2: 520, stroke: { w: 1, paint: { solid: INK } } },
      { t: "line", x1: 100, y1: 523, x2: 1500, y2: 523, stroke: { w: 1, paint: { solid: INK } } },
      { t: "line", x1: 200, y1: 600, x2: 1400, y2: 820, stroke: { w: 8, paint: { solid: GOLD }, cap: "round" } },
      // an accent rule: a gradient that fades at both ends
      { t: "line", x1: 100, y1: 700, x2: 900, y2: 700, stroke: { w: 4, paint: { linear: [0, 0, 1, 0], stops: [{ o: 0, c: BLUE, a: 0 }, { o: .2, c: BLUE, a: 1 }, { o: .8, c: BLUE, a: 1 }, { o: 1, c: BLUE, a: 0 }] } } }],
    image: [bg([240, 242, 246]),
      { t: "image", id: "jpg", x: 60, y: 60, w: 480, h: 270 },
      { t: "image", id: "jpg-copy", x: 600, y: 60, w: 240, h: 135, alpha: .5 },
      { t: "image", id: "jpg", x: 900, y: 60, w: 300, h: 200, crop: { l: .25, t: .1, r: .25, b: .3 } },
      { t: "image", id: "checker", x: 1260, y: 60, w: 240, h: 180, rotation: 30 },
      { t: "image", id: "checker", x: 60, y: 420, w: 240, h: 180, flipH: true, flipV: true },
      { t: "image", id: "ring", x: 400, y: 420, w: 192, h: 192, shadow: { id: "ring-shadow", x: 392, y: 428, w: 208, h: 208 } },
      { t: "image", id: "ring", x: 700, y: 420, w: 192, h: 192, rotation: 45, crop: { l: 0, t: 0, r: .5, b: 0 } },
      { t: "image", id: "missing", x: 1000, y: 420, w: 100, h: 100 }],
    shadow: [bg([238, 241, 247]),
      { t: "shadow", x: 120, y: 120, w: 520, h: 280, r: 28, dx: 0, dy: 22, blur: 48, spread: -24, c: [8, 16, 40], a: .55 },
      { t: "rect", x: 120, y: 120, w: 520, h: 280, r: 28, fill: { solid: WHITE, a: .4 } },
      { t: "shadow", x: 800, y: 120, w: 520, h: 280, r: 28, dx: 0, dy: 0, blur: 0, spread: 6, c: BLUE, a: .5 },
      { t: "rect", x: 800, y: 120, w: 520, h: 280, r: 28, fill: { solid: WHITE } },
      { t: "rect", x: 120, y: 500, w: 520, h: 280, r: 28, fill: { solid: [210, 220, 236] } },
      { t: "shadow", x: 120, y: 500, w: 520, h: 280, r: 28, dx: 0, dy: 1, blur: 14, spread: 0, c: WHITE, a: .9, inset: true },
      { t: "shadow", x: 120, y: 500, w: 520, h: 280, r: 28, dx: 0, dy: -10, blur: 20, spread: -4, c: [8, 16, 40], a: .4, inset: true },
      { t: "shadow", x: 800, y: 500, w: 200, h: 60, r: 30, dx: 0, dy: 6, blur: 18, spread: -6, c: [8, 16, 40], a: .6 },
      { t: "rect", x: 800, y: 500, w: 200, h: 60, r: 30, fill: { solid: GREEN } }],
    text: [bg(),
      { t: "text", font: "Carlito", size: 32, x: 80, y: 120, src: "Loans to banks Δ vs. Budget", ...shaped("Loans to banks Δ vs. Budget", 32), fill: { solid: INK } },
      { t: "text", font: "Carlito", size: 32, x: 80, y: 190, src: "the same run pinned 40 px wider", ...shaped("the same run pinned 40 px wider", 32, f, 40), fill: { solid: BLUE } },
      { t: "text", font: "Carlito", b: true, size: 48, x: 80, y: 290, src: "TOTAL BANKS 12.345", ...shaped("TOTAL BANKS 12.345", 48, fb), fill: { solid: RED } },
      { t: "text", font: "Carlito", size: 28, x: 80, y: 360, src: "half transparent àèéìòù", ...shaped("half transparent àèéìòù", 28), fill: { solid: INK, a: .5 } },
      { t: "text", font: "Carlito", size: 28, x: 80, y: 430, src: "underlined and struck", ...shaped("underlined and struck", 28), fill: { solid: INK }, decoration: { underline: true, strike: true } },
      { t: "text", font: "Carlito", size, x: 80, y: 520, src: word, gids, adv, w: adv.reduce((s, v) => s + v, 0), fill: { solid: GREEN } },
      // a title text shadow: an offset copy first
      { t: "text", font: "Carlito", b: true, size: 56, x: 81, y: 641, src: "Liquid Glass title", ...shaped("Liquid Glass title", 56, fb), fill: { solid: [0, 0, 0], a: .2 }, decorative: true },
      { t: "text", font: "Carlito", b: true, size: 56, x: 80, y: 640, src: "Liquid Glass title", ...shaped("Liquid Glass title", 56, fb), fill: { solid: INK } },
      { t: "text", font: "Carlito", size: 12, x: 80, y: 720, src: "9 px is the smallest size fitText goes down to – 12 px here", ...shaped("9 px is the smallest size fitText goes down to – 12 px here", 12), fill: { solid: INK } },
      // a run with a measured width only (no glyphs): pinned with letterSpacing / textLength / Tc
      { t: "text", font: "Carlito", size: 32, x: 900, y: 120, src: "minimum 1100", w: measured("minimum 1100", 32) + 12, fill: { solid: INK } },
      { t: "text", font: "Carlito", size: 20, x: 80, y: 800, src: "", w: 0, fill: { solid: INK } }],
    group: [bg(),
      { t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: { linear: [0, 0, 1, 1], stops: [{ o: 0, c: [60, 90, 160], a: 1 }, { o: 1, c: [170, 70, 120], a: 1 }] } },
      // a glass card: clip + the blurred wallpaper at the lens transform, then a tint
      { t: "group", clip: { x: 80, y: 80, w: 560, h: 320, r: 32 }, children: [
        { t: "group", transform: [1.12, 0, 0, 1.12, -38.4, -24], children: [{ t: "image", id: "jpg", x: 0, y: 0, w: 1600, h: 900 }] },
        { t: "rect", x: 80, y: 80, w: 560, h: 320, fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: WHITE, a: .35 }, { o: 1, c: WHITE, a: .1 }] } }] },
      // group alpha: two overlapping rects at .5 as one layer (the overlap must not be darker)
      { t: "group", alpha: .5, children: [
        { t: "rect", x: 760, y: 80, w: 300, h: 200, fill: { solid: GOLD } },
        { t: "rect", x: 900, y: 180, w: 300, h: 200, fill: { solid: GOLD } }] },
      // a rotated text box
      { t: "group", transform: [0.9659, -0.2588, 0.2588, 0.9659, -100, 380], clip: { x: 80, y: 480, w: 520, h: 120 }, children: [
        { t: "rect", x: 80, y: 480, w: 520, h: 120, fill: { solid: WHITE, a: .85 } },
        { t: "text", font: "Carlito", size: 36, x: 100, y: 555, src: "rotated and clipped text box ...", ...shaped("rotated and clipped text box ...", 36), fill: { solid: INK } }] },
      // multiply: a picture with a white background drawn over a colour (.pic.gink)
      { t: "rect", x: 800, y: 480, w: 600, h: 300, fill: { solid: [120, 200, 255] } },
      { t: "group", blend: "multiply", children: [{ t: "image", id: "checker", x: 850, y: 520, w: 240, h: 180 }, { t: "rect", x: 1150, y: 520, w: 200, h: 200, fill: { solid: [255, 230, 120] } }] },
      // an icon: a circle clip (path)
      { t: "group", clip: { d: [["M", 1300, 150], ["C", 1300, 205.2, 1344.8, 250, 1400, 250], ["C", 1455.2, 250, 1500, 205.2, 1500, 150], ["C", 1500, 94.8, 1455.2, 50, 1400, 50], ["C", 1344.8, 50, 1300, 94.8, 1300, 150], ["Z"]] }, children: [{ t: "image", id: "jpg", x: 1200, y: 40, w: 400, h: 225 }] }],
    hit: [bg(),
      { t: "rect", x: 100, y: 100, w: 400, h: 200, fill: { solid: BLUE } },
      { t: "hit", kind: "cell", id: "Sheet1!B2", x: 100, y: 100, w: 400, h: 200 },
      { t: "hit", kind: "table", id: "t1", x: 0, y: 0, w: 1600, h: 900 }],
  };
  return { lists, images, fonts };
}
