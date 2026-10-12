/* Display list → SVG markup (the stage from M4, thumbnails at zoom). Text is <text x y textLength lengthAdjust=
   "spacing">: the browser shapes the run with the same font, and textLength pins its width to the measured one
   (03 §2.6). Gradients are mapped onto the shape's box with gradientTransform, as the PDF maps its shadings with
   cm, so both draw the same pixels. Clips and transforms of a group apply in that order to its children (the
   clip is in the group's transformed space). */
import { charPositions, decorations, imagePlacement, paintOf, lineBand, needsClip, pathBox, radialMatrix, boxMatrix, mul, rrectOf, shadowLayers, strokeRing } from "./geom";
import { weightOf, type DisplayList, type Matrix, type Node, type Paint, type PathCmd, type Stroke, type TextNode } from "./types";

export interface SvgOptions {
  /** the picture of an image id (data: or blob: URL); a missing one is left out */
  imageHref: (id: string) => string | undefined;
  /** CSS font-family of a text node's font (default: the key, quoted) */
  fontFamily?: (n: TextNode) => string;
  /** a prefix for the ids of gradients and clips, unique within the page */
  idPrefix?: string;
  /** emit hit nodes as transparent rects with data-hit / data-id (the editor's hit testing) */
  hits?: boolean;
}

const f = (v: number) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? "0" : String(r); };
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");
export function pathData(d: PathCmd[]): string {
  return d.map(c => c[0] + (c.length > 1 ? c.slice(1).map(v => f(v as number)).join(" ") : "")).join("");
}
const rgb = (c: [number, number, number]) => `rgb(${c.map(v => Math.round(v)).join(",")})`;
const mat = (m: Matrix) => `matrix(${m.map(f).join(" ")})`;

/** the markup of a display list (gradients and clips as <defs> next to their use) */
export function svgNodes(list: DisplayList, opts: SvgOptions): string {
  const pre = opts.idPrefix ?? "d", st = { k: 0 };
  const id = () => `${pre}${st.k++}`;
  let out = "";
  const defs: string[] = [];
  /** fill / stroke attributes of a paint on a box; gradients become a def */
  const paintAttr = (paint: Paint, what: "fill" | "stroke", box: { x: number; y: number; w: number; h: number }): string => {
    const p = paintOf(paint);
    if ("solid" in p) return ` ${what}="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` ${what}-opacity="${f(p.a!)}"` : ""}`;
    const g = id(), stops = ("linear" in p ? p.stops : p.radial.stops)
      .map(s => `<stop offset="${f(s.o)}" stop-color="${rgb(s.c)}"${s.a < 1 ? ` stop-opacity="${f(s.a)}"` : ""}/>`).join("");
    const bm = boxMatrix(box.x, box.y, Math.max(box.w, 1e-3), Math.max(box.h, 1e-3));
    if ("linear" in p) {
      const [x1, y1, x2, y2] = p.linear;
      defs.push(`<linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" gradientTransform="${mat(bm)}">${stops}</linearGradient>`);
    } else {
      defs.push(`<radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="${mat(mul(bm, radialMatrix(p.radial)))}">${stops}</radialGradient>`);
    }
    return ` ${what}="url(#${g})"`;
  };
  const strokeAttr = (s: Stroke, box: { x: number; y: number; w: number; h: number }) =>
    paintAttr(s.paint, "stroke", box) + ` stroke-width="${f(s.w)}" stroke-miterlimit="10"` + (s.dash ? ` stroke-dasharray="${s.dash.map(f).join(" ")}"` : "") + (s.cap && s.cap !== "butt" ? ` stroke-linecap="${s.cap}"` : "");
  const clipDef = (d: PathCmd[], evenodd = false) => {
    const c = id(); defs.push(`<clipPath id="${c}"><path d="${pathData(d)}"${evenodd ? ` clip-rule="evenodd"` : ""}/></clipPath>`); return c;
  };
  const draw = (n: Node): string => {
    switch (n.t) {
      case "rect": {
        let s = "";
        const d = pathData(rrectOf(n));
        if (n.fill) s += `<path d="${d}"${paintAttr(n.fill, "fill", n)}/>`;
        if (n.stroke) {
          if ("solid" in n.stroke.paint) s += `<path d="${d}" fill="none"${strokeAttr(n.stroke, n)}/>`;
          else s += `<path d="${pathData(strokeRing(n, n.stroke.w))}" fill-rule="evenodd"${paintAttr(n.stroke.paint, "fill", n)}/>`;
        }
        return s;
      }
      case "path": {
        const box = pathBox(n.d), d = pathData(n.d), rule = n.rule === "evenodd" ? ` fill-rule="evenodd"` : "";
        return (n.fill ? `<path d="${d}"${rule}${paintAttr(n.fill, "fill", box)}/>` : "") + (n.stroke ? `<path d="${d}" fill="none"${strokeAttr(n.stroke, box)}/>` : "");
      }
      case "line": {
        if (!("solid" in n.stroke.paint)) {
          const band = lineBand(n.x1, n.y1, n.x2, n.y2, n.stroke);
          return `<path d="${pathData(band)}"${paintAttr(n.stroke.paint, "fill", pathBox(band))}/>`;
        }
        return `<line x1="${f(n.x1)}" y1="${f(n.y1)}" x2="${f(n.x2)}" y2="${f(n.y2)}"${strokeAttr(n.stroke, { x: 0, y: 0, w: 0, h: 0 })}/>`;
      }
      case "image": {
        const href = opts.imageHref(n.id);
        if (!href) return "";
        const { m, full } = imagePlacement(n);
        let s = "";
        if (n.shadow) { const sh = opts.imageHref(n.shadow.id); if (sh) s += `<image href="${escAttr(sh)}" x="${f(n.shadow.x)}" y="${f(n.shadow.y)}" width="${f(n.shadow.w)}" height="${f(n.shadow.h)}" preserveAspectRatio="none"/>`; }
        let img = `<image href="${escAttr(href)}" x="${f(full.x)}" y="${f(full.y)}" width="${f(full.w)}" height="${f(full.h)}" preserveAspectRatio="none"${(n.alpha ?? 1) < 1 ? ` opacity="${f(n.alpha!)}"` : ""}/>`;
        if (needsClip(n)) img = `<g clip-path="url(#${clipDef(rrectOf(n))})">${img}</g>`;
        s += img;
        return m ? `<g transform="${mat(m)}">${s}</g>` : s;
      }
      case "shadow":
        return shadowLayers(n).map(l => `<g clip-path="url(#${clipDef(l.clip, true)})"><path d="${pathData(l.fill)}" fill-rule="evenodd" fill="${rgb(n.c)}" fill-opacity="${f(l.a)}"/></g>`).join("");
      case "text": {
        const fam = opts.fontFamily ? opts.fontFamily(n) : n.css || `'${n.font.replace(/'/g, "")}'`;
        const p = n.fill as { solid: [number, number, number]; a?: number };
        const at = charPositions(n);
        let s = `<text x="${at ? at.map(f).join(" ") : f(n.x)}" y="${f(n.y)}" font-family="${escAttr(fam)}" font-size="${f(n.size)}"${weightOf(n) !== 400 ? ` font-weight="${weightOf(n)}"` : ""}${n.i ? ` font-style="italic"` : ""}`
          + ` fill="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` fill-opacity="${f(p.a!)}"` : ""}`
          + (!at && n.w !== undefined && [...n.src].length > 1 ? ` textLength="${f(n.w)}" lengthAdjust="spacing"` : "")
          + ` xml:space="preserve">${escText(n.src)}</text>`;
        if (n.decoration && n.w !== undefined) for (const [x, y, w, h] of decorations(n, n.w)) s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` fill-opacity="${f(p.a!)}"` : ""}/>`;
        return s;
      }
      case "group": {
        const attrs: string[] = [];
        if (n.transform) attrs.push(`transform="${mat(n.transform)}"`);
        if (n.alpha !== undefined && n.alpha < 1) attrs.push(`opacity="${f(n.alpha)}"`);
        if (n.blend) attrs.push(`style="mix-blend-mode:${n.blend};isolation:isolate"`);
        const inner = n.children.map(draw).join("");
        let body = inner;
        if (n.clip) body = `<g clip-path="url(#${clipDef("d" in n.clip ? n.clip.d : rrectOf(n.clip))})">${inner}</g>`;
        return attrs.length ? `<g ${attrs.join(" ")}>${body}</g>` : body;
      }
      case "hit":
        return opts.hits ? `<rect x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}" fill="transparent" data-hit="${escAttr(n.kind)}" data-id="${escAttr(n.id)}"/>` : "";
    }
  };
  for (const n of list) {
    const s = draw(n);
    if (defs.length) { out += `<defs>${defs.join("")}</defs>`; defs.length = 0; }
    out += s;
  }
  return out;
}

/** a whole slide as an SVG document, w × h slide px */
export function toSvg(list: DisplayList, opts: SvgOptions & { width?: number; height?: number }): string {
  const w = opts.width ?? 1600, h = opts.height ?? 900;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${svgNodes(list, opts)}</svg>`;
}
