/* Display list → Canvas2D (thumbnails, PNG, clipboard; an OffscreenCanvas in a worker or a page canvas). The
   caller sets the scale (slide px → canvas px) on the context. Gradients: the path is added under the current
   transform, then the shape's box matrix is applied before fill(), so the gradient lives in the unit box as in
   the PDF and the SVG. A group with alpha or a blend mode is drawn into a layer and composited once, so its
   children do not show through each other (a transparency group, as in the PDF); without a layer factory it
   falls back to the alpha per child. A horizontal run (no rotation or skew in the transform) is drawn as Chromium
   draws page text: its baseline floored and its start rounded to whole device pixels (measured against the page by
   tools/dlparity.mjs; otherwise text at a fractional table scale sits a pixel off). */
import { boxMatrix, charPositions, decorations, paintOf, imagePlacement, lineBand, mul, needsClip, pathBox, radialMatrix, rrectOf, shadowLayers, strokeRing } from "./geom";
import { weightOf, type DisplayList, type Matrix, type Node, type Paint, type PathCmd, type Stroke, type TextNode } from "./types";

/** the subset of CanvasRenderingContext2D / OffscreenCanvasRenderingContext2D the backend uses */
export type Ctx = OffscreenCanvasRenderingContext2D;
export interface CanvasOptions {
  /** a decoded picture by image id; a missing one is left out */
  image: (id: string) => CanvasImageSource | undefined;
  /** CSS font-family of a text node (default: the key, quoted) */
  fontFamily?: (n: TextNode) => string;
  /** a transparent layer of the target's size for groups with alpha or blend (same pixel size as ctx.canvas) */
  layer?: () => { ctx: Ctx; image: CanvasImageSource } | null;
}

const css = (c: [number, number, number], a = 1) => `rgba(${c.map(v => Math.round(v)).join(",")},${a})`;
function trace(ctx: Ctx, d: PathCmd[]) {
  for (const c of d) {
    if (c[0] === "M") ctx.moveTo(c[1], c[2]);
    else if (c[0] === "L") ctx.lineTo(c[1], c[2]);
    else if (c[0] === "C") ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else ctx.closePath();
  }
}
const apply = (ctx: Ctx, m: Matrix) => ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);

/** draw a display list onto a context (its current transform maps slide px to canvas px) */
export function drawDl(ctx: Ctx, list: DisplayList, opts: CanvasOptions) {
  for (const n of list) drawNode(ctx, n, opts);
}

/** fill the current path with a paint on a box */
function fillPaint(ctx: Ctx, paint: Paint, box: { x: number; y: number; w: number; h: number }, rule: CanvasFillRule = "nonzero") {
  const p = paintOf(paint);
  ctx.save();
  if ("solid" in p) { ctx.fillStyle = css(p.solid, p.a ?? 1); ctx.fill(rule); ctx.restore(); return; }
  let m = boxMatrix(box.x, box.y, Math.max(box.w, 1e-3), Math.max(box.h, 1e-3));
  let g: CanvasGradient;
  if ("linear" in p) g = ctx.createLinearGradient(p.linear[0], p.linear[1], p.linear[2], p.linear[3]);
  else { m = mul(m, radialMatrix(p.radial)); g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); }
  for (const s of "linear" in p ? p.stops : p.radial.stops) g.addColorStop(s.o, css(s.c, s.a));
  apply(ctx, m);                       // the path stays where it was added; the gradient follows the box
  ctx.fillStyle = g;
  ctx.fill(rule);
  ctx.restore();
}
function strokeSolid(ctx: Ctx, s: Stroke) {
  const p = s.paint as { solid: [number, number, number]; a?: number };
  ctx.save();
  ctx.strokeStyle = css(p.solid, p.a ?? 1); ctx.lineWidth = s.w; ctx.lineCap = s.cap || "butt";
  ctx.lineJoin = "miter"; ctx.miterLimit = 10;                    // as the PDF (0 j 10 M) and the SVG
  ctx.setLineDash(s.dash || []);
  ctx.stroke();
  ctx.restore();
}

function drawNode(ctx: Ctx, n: Node, opts: CanvasOptions) {
  switch (n.t) {
    case "rect": {
      const d = rrectOf(n);
      if (n.fill) { ctx.beginPath(); trace(ctx, d); fillPaint(ctx, n.fill, n); }
      if (n.stroke) {
        ctx.beginPath();
        if ("solid" in n.stroke.paint) { trace(ctx, d); strokeSolid(ctx, n.stroke); }
        else { trace(ctx, strokeRing(n, n.stroke.w)); fillPaint(ctx, n.stroke.paint, n, "evenodd"); }
      }
      return;
    }
    case "path":
      if (n.fill) { ctx.beginPath(); trace(ctx, n.d); fillPaint(ctx, n.fill, pathBox(n.d), n.rule === "evenodd" ? "evenodd" : "nonzero"); }
      if (n.stroke) { ctx.beginPath(); trace(ctx, n.d); strokeSolid(ctx, n.stroke); }
      return;
    case "line":
      ctx.beginPath();
      if ("solid" in n.stroke.paint) { ctx.moveTo(n.x1, n.y1); ctx.lineTo(n.x2, n.y2); strokeSolid(ctx, n.stroke); }
      else { const band = lineBand(n.x1, n.y1, n.x2, n.y2, n.stroke); trace(ctx, band); fillPaint(ctx, n.stroke.paint, pathBox(band)); }
      return;
    case "image": {
      const img = opts.image(n.id);
      if (!img) return;
      const { m, full } = imagePlacement(n);
      ctx.save();
      if (m) apply(ctx, m);
      if (n.shadow) { const sh = opts.image(n.shadow.id); if (sh) ctx.drawImage(sh, n.shadow.x, n.shadow.y, n.shadow.w, n.shadow.h); }
      if (needsClip(n)) { ctx.beginPath(); trace(ctx, rrectOf(n)); ctx.clip(); }
      if (n.alpha !== undefined) ctx.globalAlpha *= n.alpha;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, full.x, full.y, full.w, full.h);
      ctx.restore();
      return;
    }
    case "shadow":
      for (const l of shadowLayers(n)) {
        ctx.save();
        ctx.beginPath(); trace(ctx, l.clip); ctx.clip("evenodd");
        ctx.beginPath(); trace(ctx, l.fill);
        ctx.fillStyle = css(n.c, l.a); ctx.fill("evenodd");
        ctx.restore();
      }
      return;
    case "text": {
      const p = n.fill as { solid: [number, number, number]; a?: number };
      ctx.save();
      ctx.font = `${n.i ? "italic " : ""}${weightOf(n)} ${n.size}px ${opts.fontFamily ? opts.fontFamily(n) : n.css || `'${n.font.replace(/'/g, "")}'`}`;
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      ctx.fillStyle = css(p.solid, p.a ?? 1);
      // a horizontal run's baseline on a whole device pixel, as Chromium draws page text (no rotation or skew only)
      const T = ctx.getTransform();
      let y = n.y, x0 = n.x;
      if (Math.abs(T.b) < 1e-9 && Math.abs(T.c) < 1e-9 && T.d > 0 && T.a > 0) {     // (not under a flip)
        y = (Math.floor(T.d * n.y + T.f + 1e-6) - T.f) / T.d;
        x0 = (Math.round(T.a * n.x + T.e) - T.e) / T.a;
      }
      const c = ctx as Ctx & { letterSpacing?: string }, at = charPositions(n);
      if (at) {
        // a shaped run with one glyph per character: each character where the display list puts it (as the PDF)
        const tab = n.tnum && !n.gids;
        [...n.src].forEach((ch, k) => { if (ch !== " ") ctx.fillText(ch, at[k] + x0 - n.x + (tab ? (n.adv![k] - ctx.measureText(ch).width) / 2 : 0), y); });
      } else {
        if (n.w !== undefined && "letterSpacing" in c) {
          c.letterSpacing = "0px";
          const chars = [...n.src].length, natural = ctx.measureText(n.src).width;
          // over the gaps between characters, so the last one ends at x + w (as SVG textLength and the PDF's Tc)
          if (chars > 1 && Math.abs(n.w - natural) > 1e-3) c.letterSpacing = `${(n.w - natural) / (chars - 1)}px`;
        }
        ctx.fillText(n.src, x0, y);
      }
      // decorations move with the snapped glyphs
      if (n.decoration && n.w !== undefined) for (const [dx, dy, w, h] of decorations(n, n.w)) ctx.fillRect(dx + x0 - n.x, dy + y - n.y, w, h);
      ctx.restore();
      return;
    }
    case "group": {
      const composite = (n.alpha !== undefined && n.alpha < 1) || !!n.blend;
      const layer = composite && opts.layer ? opts.layer() : null;
      const target = layer ? layer.ctx : ctx;
      target.save();
      if (layer) target.setTransform(ctx.getTransform());
      if (n.transform) apply(target, n.transform);
      if (n.clip) { target.beginPath(); trace(target, "d" in n.clip ? n.clip.d : rrectOf(n.clip)); target.clip(); }
      if (composite && !layer && n.alpha !== undefined) target.globalAlpha *= n.alpha;
      for (const ch of n.children) drawNode(target, ch, opts);
      target.restore();
      if (layer) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (n.alpha !== undefined) ctx.globalAlpha *= n.alpha;
        if (n.blend) ctx.globalCompositeOperation = n.blend;
        ctx.drawImage(layer.image, 0, 0);
        ctx.restore();
      }
      return;
    }
    case "hit":
      return;
  }
}
