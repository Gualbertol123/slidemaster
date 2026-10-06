/* Liquid Glass wallpaper: a soft gradient with colour blobs and ribbons, plus a blurred copy that the
   glass surfaces sample (background-position is set per element by placeGlass). Cached per value. */
import { hexRgb } from "../xlsx/color";
import { glassLevel } from "../model/style";
import type { Style } from "../model/types";

interface Wall { sharp: string; blur: string; base: string }
const WALLS = new Map<string, Wall>();

export function wallCss(w: Wall) { return `.slide.glass{--wall:url(${w.sharp});--wallblur:url(${w.blur});--wallbase:${w.base}}`; }
function applyWallCss(w: Wall) {
  document.getElementById("wallcss")?.remove();
  const st = document.createElement("style"); st.id = "wallcss";
  st.textContent = wallCss(w);
  document.head.appendChild(st);
}
export function makeWall(style: Style) {
  const gi = glassLevel(style), amt = Math.max(0, Math.min(100, +style.color || 0)) / 100, key = gi + "|" + amt;
  const hit = WALLS.get(key); if (hit) return applyWallCss(hit);
  const W = 1600, H = 900, k = (.4 + .6 * gi) * amt;                // amount 0 = plain white, 1 = full colour
  const mix = (hex: string, t: number) => { const [r, g, b] = hexRgb(hex); const m = (v: number) => Math.round(255 + (v - 255) * t); return `rgb(${m(r)},${m(g)},${m(b)})`; };
  const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { willReadFrequently: true })!;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, mix("#D3E2FF", amt)); g.addColorStop(.48, mix("#ECE6FF", amt)); g.addColorStop(1, mix("#FFE8D8", amt));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const blob = (cx: number, cy: number, r: number, rgb: string, a: number) => { const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(.55, `rgba(${rgb},${a * .45})`); rg.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = rg; x.fillRect(0, 0, W, H); };
  blob(160, 110, 580, "58,136,255", .62 * k); blob(1460, 70, 580, "152,104,255", .52 * k); blob(1390, 870, 620, "255,136,92", .48 * k);
  blob(210, 890, 560, "52,200,176", .44 * k); blob(860, 440, 480, "255,255,255", .6); blob(1010, 900, 380, "255,90,166", .22 * k); blob(640, 30, 380, "84,196,255", .32 * k);
  x.save(); x.filter = "blur(48px)"; x.lineCap = "round";
  const ribbon = (p: number[], w: number, stops: [number, string][]) => { const lg = x.createLinearGradient(p[0], p[1], p[6], p[7]); stops.forEach(([o, cc]) => lg.addColorStop(o, cc)); x.strokeStyle = lg; x.lineWidth = w; x.beginPath(); x.moveTo(p[0], p[1]); x.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]); x.stroke(); };
  if (amt > 0) ribbon([-100, 650, 420, 380, 980, 870, 1700, 420], 160, [[0, "rgba(255,255,255,.8)"], [.5, `rgba(140,190,255,${.55 * k})`], [1, `rgba(255,200,170,${.6 * k})`]]);
  if (amt > 0) ribbon([-100, 220, 500, 520, 1100, 40, 1700, 260], 120, [[0, `rgba(190,160,255,${.5 * k})`], [.6, "rgba(255,255,255,.7)"], [1, `rgba(120,220,255,${.45 * k})`]]);
  x.restore();
  // fine grain: avoids gradient banding in exports
  if (amt > 0) {
    const id = x.getImageData(0, 0, W, H), d = id.data; let seed = 1234567;
    for (let i = 0; i < d.length; i += 4) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const n = (((seed >> 16) & 7) - 3.5) * Math.min(1, amt * 2); d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(id, 0, 0);
  }
  const sharp = c.toDataURL("image/jpeg", .94);
  const b = document.createElement("canvas"); b.width = W / 2; b.height = H / 2; const y = b.getContext("2d")!;
  y.filter = `blur(${12 + 8 * gi}px) saturate(${1 + .4 * gi * amt}) brightness(${1 + .08 * amt})`; y.drawImage(c, -50, -50, W / 2 + 100, H / 2 + 100);
  const blur = b.toDataURL("image/jpeg", .92);
  const w = { sharp, blur, base: mix("#E9EDF6", amt) };
  WALLS.set(key, w); applyWallCss(w);
}
