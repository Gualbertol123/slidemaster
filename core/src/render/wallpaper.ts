/* Liquid Glass wallpaper: a soft gradient with colour blobs and ribbons, plus a blurred copy that the
   glass surfaces sample (background-position is set per element by placeGlass). Cached per value. Drawn on
   the host's canvas (platform.ts); the page puts the result into its CSS (wallCss). */
import { hexRgb } from "../xlsx/color";
import { glassLevel, themeOf } from "../model/style";
import type { Style } from "../model/types";
import { platform } from "../platform";

export interface Wall { sharp: string; blur: string; base: string }
const WALLS = new Map<string, Wall>();

export function wallCss(w: Wall) { return `.slide.glass{--wall:url(${w.sharp});--wallblur:url(${w.blur});--wallbase:${w.base}}`; }
/** the wallpaper for these settings, or null when the host has no canvas */
export async function makeWall(style: Style): Promise<Wall | null> {
  const gi = glassLevel(style), amt = Math.max(0, Math.min(100, +style.color || 0)) / 100, th = themeOf(style);
  // contrast above the middle deepens the wallpaper: baked into the picture (a CSS filter on it made Chrome
  // print every page's background as a 300 dpi picture – huge, slow PDFs)
  const u = Math.max(0, Math.min(100, style.contrast ?? 50) / 100 - .5);
  const key = gi + "|" + amt + "|" + u.toFixed(3) + "|" + [th.c1, th.c2, th.c3, th.c4].join();
  const hit = WALLS.get(key); if (hit) return hit;
  const cf = platform().canvas; if (!cf) return null;
  const W = 1600, H = 900, k = (.4 + .6 * gi) * amt;                // amount 0 = plain white, 1 = full colour
  const mix = (hex: string, t: number) => { const [r, g, b] = hexRgb(hex); const m = (v: number) => Math.round(255 + (v - 255) * t); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const c = cf.create(W, H, { willReadFrequently: true }); if (!c) return null; const x = c.ctx;
  // pastel versions of the theme colours (Aurora keeps its hand-tuned values)
  const pastel = (h: string, t: number) => { const [r, g, b] = hexRgb(h); const m = (v: number) => Math.round(255 + (v - 255) * t); return "#" + [m(r), m(g), m(b)].map(v => v.toString(16).padStart(2, "0")).join(""); };
  const grad = th.grad || [pastel(th.c1, .24), pastel(th.c2, .14), pastel(th.c3, .16)];
  const extra = th.extra || [th.c3, th.c2], rib = th.ribbons || [pastel(th.c1, .5), pastel(th.c3, .4), pastel(th.c2, .45), pastel(th.c4, .5)];
  const rgb = (h: string) => hexRgb(h).join(",");
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, mix(grad[0], amt)); g.addColorStop(.48, mix(grad[1], amt)); g.addColorStop(1, mix(grad[2], amt));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const blob = (cx: number, cy: number, r: number, rgb: string, a: number) => { const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(.55, `rgba(${rgb},${a * .45})`); rg.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = rg; x.fillRect(0, 0, W, H); };
  blob(160, 110, 580, rgb(th.c1), .62 * k); blob(1460, 70, 580, rgb(th.c2), .52 * k); blob(1390, 870, 620, rgb(th.c3), .48 * k);
  blob(210, 890, 560, rgb(th.c4), .44 * k); blob(860, 440, 480, "255,255,255", .6); blob(1010, 900, 380, rgb(extra[0]), .22 * k); blob(640, 30, 380, rgb(extra[1]), .32 * k);
  x.save(); x.filter = "blur(48px)"; x.lineCap = "round";
  const ribbon = (p: number[], w: number, stops: [number, string][]) => { const lg = x.createLinearGradient(p[0], p[1], p[6], p[7]); stops.forEach(([o, cc]) => lg.addColorStop(o, cc)); x.strokeStyle = lg; x.lineWidth = w; x.beginPath(); x.moveTo(p[0], p[1]); x.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); x.stroke(); };
  if (amt > 0) ribbon([-100, 650, 420, 380, 980, 870, 1700, 420], 160, [[0, "rgba(255,255,255,.8)"], [.5, `rgba(${rgb(rib[0])},${.55 * k})`], [1, `rgba(${rgb(rib[1])},${.6 * k})`]]);
  if (amt > 0) ribbon([-100, 220, 500, 520, 1100, 40, 1700, 260], 120, [[0, `rgba(${rgb(rib[2])},${.5 * k})`], [.6, "rgba(255,255,255,.7)"], [1, `rgba(${rgb(rib[3])},${.45 * k})`]]);
  x.restore();
  // fine grain: avoids gradient banding in exports
  if (amt > 0) {
    const id = x.getImageData(0, 0, W, H), d = id.data; let seed = 1234567;
    for (let i = 0; i < d.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = (((seed >> 16) & 7) - 3.5) * Math.min(1, amt * 2); d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(id, 0, 0);
  }
  let sharp = await c.toDataURL("image/jpeg", .94);
  if (u > .001) {
    const f = cf.create(W, H); if (!f) return null; const z = f.ctx;
    z.filter = `saturate(${(1 + u * 1.4).toFixed(3)}) brightness(${(1 - u * .36).toFixed(3)})`; z.drawImage(c.image, 0, 0);
    sharp = await f.toDataURL("image/jpeg", .94);
  }
  const b = cf.create(W / 2, H / 2); if (!b) return null; const y = b.ctx;
  y.filter = `blur(${12 + 8 * gi}px) saturate(${1 + .4 * gi * amt}) brightness(${1 + .08 * amt})`; y.drawImage(c.image, -50, -50, W / 2 + 100, H / 2 + 100);
  const blur = await b.toDataURL("image/jpeg", .92);
  const w = { sharp, blur, base: mix(th.grad ? "#E9EDF6" : pastel(th.c1, .1), amt) };
  WALLS.set(key, w); return w;
}
