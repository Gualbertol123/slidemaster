/* Display list → SVG markup (the stage from M4, thumbnails at zoom). Text is <text x y textLength lengthAdjust=
   "spacing">: the browser shapes the run with the same font, and textLength pins its width to the measured one
   (03 §2.6). Gradients are mapped onto the shape's box with gradientTransform, as the PDF maps its shadings with
   cm, so both draw the same pixels. Clips and transforms of a group apply in that order to its children (the
   clip is in the group's transformed space). */
import { charPositions, premulStops, decorations, imagePlacement, paintOf, lineBand, needsClip, pathBox, radialMatrix, boxMatrix, mul, rrectOf, shadowLayers, shadowShape, strokeRing } from "./geom";
import { weightOf, type Clip, type DisplayList, type HitNode, type Matrix, type Node, type Paint, type PathCmd, type Stroke, type TextNode } from "./types";

export interface SvgOptions {
  /** the picture of an image id (data: or blob: URL); a missing one is left out */
  imageHref: (id: string) => string | undefined;
  /** CSS font-family of a text node's font (default: the key, quoted) */
  fontFamily?: (n: TextNode) => string;
  /** a prefix for the ids of gradients and clips, unique within the page */
  idPrefix?: string;
  /** emit hit nodes as transparent rects with data-hit / data-id (the editor's hit testing); a function chooses per
      hit: null leaves it out, `cls` gives the rect a class, `label` puts the hit's label in a <desc> (the stage: tests
      and readers find a cell by its text) */
  hits?: boolean | ((n: HitNode) => { cls?: string; label?: boolean } | null);
  /** soft shadows: each shadow one shape under a Gaussian blur (B3: Options › Soft shadows, the screen only) instead
      of the 5 sharp layers the PDF and the PNG draw */
  softShadows?: boolean;
  /** text drawn as glyph outlines (S4.4, 03 §2.6 step 3: a font whose browser text would not match the PDF): the run's
      glyphs – each one's outline (SVG path data, font units, y up, defined once per list by its key) and its pen
      position from the run's start, px – or null: drawn as <text> */
  outline?: (n: TextNode) => OutlineRun | null;
}
export interface OutlineRun { upem: number; glyphs: { key: string; d: string; x: number; dx?: number; dy?: number }[] }

const f = (v: number) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? "0" : String(r); };
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");
export function pathData(d: PathCmd[]): string {
  return d.map(c => c[0] + (c.length > 1 ? c.slice(1).map(v => f(v as number)).join(" ") : "")).join("");
}
const rgb = (c: [number, number, number]) => `rgb(${c.map(v => Math.round(v)).join(",")})`;
const mat = (m: Matrix) => `matrix(${m.map(f).join(" ")})`;

/** a clip that cannot cut anything: only text runs whose ink – bounded with room for accents and italics: 1 em above
    the baseline (accented capitals reach ~0.95 em), 0.3 em below, 0.2 em to the sides – lies inside a square-cornered clip rectangle (a cell's text that
    fits it). The SVG leaves such clips out (fewer nodes on the stage, the same pixels) */
function inkInside(children: Node[], clip: Clip): boolean {
  if ("d" in clip || (clip.r !== undefined && clip.r !== 0)) return false;
  return children.every(c => {
    if (c.t !== "text" || c.w === undefined || c.decoration) return false;
    const m = .2 * c.size;
    return c.x - m >= clip.x && c.x + c.w + m <= clip.x + clip.w && c.y - c.size >= clip.y && c.y + .3 * c.size <= clip.y + clip.h;
  });
}

/** the markup of a display list (gradients and clips as <defs> next to their use) */
export const svgNodes = (list: DisplayList, opts: SvgOptions): string => svgChunks(list, opts).join("");
/** the same markup in one piece per node of the list, each with the defs it introduces: the stage replaces only the pieces
    that changed (S4.1) */
export function svgChunks(list: DisplayList, opts: SvgOptions): string[] {
  const pre = opts.idPrefix ?? "d", st = { k: 0 };
  const id = () => `${pre}${st.k++}`;
  const out: string[] = [];
  const defs: string[] = [];
  /** fill / stroke attributes of a paint on a box; gradients become a def. `own`: the element's bounding box is that box
      (a rect's outline): the gradient is in its objectBoundingBox units – the same mapping – and is defined once for
      every element with the same paint (a table's capsules share theirs) */
  const grads = new Map<string, string>();
  const paintAttr = (paint: Paint, what: "fill" | "stroke", box: { x: number; y: number; w: number; h: number }, own = false): string => {
    const p = paintOf(paint);
    if ("solid" in p) return ` ${what}="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` ${what}-opacity="${f(p.a!)}"` : ""}`;
    const stops = premulStops("linear" in p ? p.stops : p.radial.stops)
      .map(s => `<stop offset="${f(s.o)}" stop-color="${rgb(s.c)}"${s.a < 1 ? ` stop-opacity="${f(s.a)}"` : ""}/>`).join("");
    own = own && box.w >= 1e-3 && box.h >= 1e-3;
    const bm = boxMatrix(box.x, box.y, Math.max(box.w, 1e-3), Math.max(box.h, 1e-3)), units = own ? "objectBoundingBox" : "userSpaceOnUse";
    const def = "linear" in p
      ? `<linearGradient id="#" gradientUnits="${units}" x1="${f(p.linear[0])}" y1="${f(p.linear[1])}" x2="${f(p.linear[2])}" y2="${f(p.linear[3])}"${own ? "" : ` gradientTransform="${mat(bm)}"`}>${stops}</linearGradient>`
      : `<radialGradient id="#" gradientUnits="${units}" cx="0" cy="0" r="1" fx="0" fy="0" gradientTransform="${mat(own ? radialMatrix(p.radial) : mul(bm, radialMatrix(p.radial)))}">${stops}</radialGradient>`;
    let g = grads.get(def);
    if (!g) { g = id(); grads.set(def, g); defs.push(def.replace(`id="#"`, `id="${g}"`)); }
    return ` ${what}="url(#${g})"`;
  };
  const strokeAttr = (s: Stroke, box: { x: number; y: number; w: number; h: number }) =>
    paintAttr(s.paint, "stroke", box) + ` stroke-width="${f(s.w)}" stroke-miterlimit="10"` + (s.dash ? ` stroke-dasharray="${s.dash.map(f).join(" ")}"` : "") + (s.cap && s.cap !== "butt" ? ` stroke-linecap="${s.cap}"` : "") + (s.join && s.join !== "miter" ? ` stroke-linejoin="${s.join}"` : "");
  /** a clip, defined once per list however often it is used (a shadow's layers, a card's shadows share their outline) */
  const clips = new Map<string, string>();
  const clipDef = (d: PathCmd[], evenodd = false) => {
    const pd = pathData(d), k = (evenodd ? "e" : "n") + pd, known = clips.get(k); if (known) return known;
    const c = id(); defs.push(`<clipPath id="${c}"><path d="${pd}"${evenodd ? ` clip-rule="evenodd"` : ""}/></clipPath>`); clips.set(k, c); return c;
  };
  /** glyph outlines, defined once per list */
  const glyphs = new Map<string, string>();
  const glyphDef = (key: string, d: string) => { let g = glyphs.get(key); if (!g) { g = id(); glyphs.set(key, g); defs.push(`<path id="${g}" d="${d}"/>`); } return g; };
  const draw = (n: Node): string => {
    switch (n.t) {
      case "rect": {
        let s = "";
        const d = pathData(rrectOf(n));
        if (n.fill) s += `<path d="${d}"${paintAttr(n.fill, "fill", n, true)}/>`;
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
        if (opts.softShadows && n.blur > .5) {
          const sh = shadowShape(n); if (!sh.fill.length) return "";
          const fid = id();
          defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" x="${f(sh.box.x)}" y="${f(sh.box.y)}" width="${f(sh.box.w)}" height="${f(sh.box.h)}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${f(n.blur / 2)}"/></filter>`);
          return `<g clip-path="url(#${clipDef(sh.clip, true)})"><path d="${pathData(sh.fill)}"${sh.evenodd ? ` fill-rule="evenodd"` : ""} fill="${rgb(n.c)}" fill-opacity="${f(n.a)}" filter="url(#${fid})"/></g>`;
        }
      {
        // the layers share one clip (the frame around the box, or the box for an inset shadow)
        const ls = shadowLayers(n); if (!ls.length) return "";
        return `<g clip-path="url(#${clipDef(ls[0].clip, true)})">${ls.map(l => `<path d="${pathData(l.fill)}" fill-rule="evenodd" fill="${rgb(n.c)}" fill-opacity="${f(l.a)}"/>`).join("")}</g>`;
      }
      case "text": {
        const fam = opts.fontFamily ? opts.fontFamily(n) : n.css || `'${n.font.replace(/'/g, "")}'`;
        const p = n.fill as { solid: [number, number, number]; a?: number };
        const at = charPositions(n), o = opts.outline?.(n);
        if (o) {
          // the run in font units: one group scaled to the size (y up; the scale to 8 digits – 3 decimals of 12 / 2048 would be
          // 2.4 % off), each glyph used where its pen is
          const k = n.size / o.upem;
          let s = `<g transform="translate(${f(n.x)} ${f(n.y)}) scale(${+k.toPrecision(8)} ${-k.toPrecision(8)})" fill="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` fill-opacity="${f(p.a!)}"` : ""}>`;
          for (const g of o.glyphs) if (g.d) s += `<use href="#${glyphDef(g.key, g.d)}" x="${f((g.x + (g.dx ?? 0)) / k)}"${g.dy ? ` y="${f(g.dy / k)}"` : ""}/>`;
          s += "</g>";
          if (n.decoration && n.w !== undefined) for (const [x, y, w, h] of decorations(n, n.w)) s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` fill-opacity="${f(p.a!)}"` : ""}/>`;
          return s;
        }
        let s = `<text x="${at ? at.map(f).join(" ") : f(n.x)}" y="${f(n.y)}" font-family="${escAttr(fam)}" font-size="${f(n.size)}"${weightOf(n) !== 400 ? ` font-weight="${weightOf(n)}"` : ""}${n.i ? ` font-style="italic"` : ""}${n.tnum ? ` style="font-variant-numeric:tabular-nums"` : ""}`
          + ` fill="${rgb(p.solid)}"${(p.a ?? 1) < 1 ? ` fill-opacity="${f(p.a!)}"` : ""}`
          + (!at && n.w !== undefined && [...n.src].length > 1 ? ` textLength="${f(n.w)}" lengthAdjust="spacing"${n.ls ? ` data-ls="${f(n.ls)}"` : ""}` : "")
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
        if (n.clip && !inkInside(n.children, n.clip)) body = `<g clip-path="url(#${clipDef("d" in n.clip ? n.clip.d : rrectOf(n.clip))})">${inner}</g>`;
        return attrs.length ? `<g ${attrs.join(" ")}>${body}</g>` : body;
      }
      case "hit": {
        if (!opts.hits) return "";
        const h = typeof opts.hits === "function" ? opts.hits(n) : {};
        if (!h) return "";
        const head = `<rect x="${f(n.x)}" y="${f(n.y)}" width="${f(n.w)}" height="${f(n.h)}" fill="transparent"${h.cls ? ` class="${escAttr(h.cls)}"` : ""} data-hit="${escAttr(n.kind)}" data-id="${escAttr(n.id)}"`;
        return h.label && n.label ? `${head}><desc>${escText(n.label)}</desc></rect>` : head + "/>";
      }
    }
  };
  for (const n of list) {
    const s = draw(n);
    if (defs.length) { out.push(`<defs>${defs.join("")}</defs>` + s); defs.length = 0; }
    else out.push(s);
  }
  return out;
}

/** the hits a table's layer on the stage carries (S4.1): cells and text boxes their class and label (tests and readers
    find a cell by its text, as v3's .t), Liquid Glass's materials and capsules their classes (v3's .wb, .cap) */
export const stageHits = (n: HitNode): { cls?: string; label?: boolean } | null =>
  n.kind === "t" ? { cls: "t", label: true } : n.kind === "tbox" ? { cls: "tbox", label: true } : n.kind === "pic" ? { cls: "pic" }
    : n.kind === "wb" || n.kind === "cap" ? { cls: n.id } : null;

/** a whole slide as an SVG document, w × h slide px */
export function toSvg(list: DisplayList, opts: SvgOptions & { width?: number; height?: number }): string {
  const w = opts.width ?? 1600, h = opts.height ?? 900;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${svgNodes(list, opts)}</svg>`;
}
