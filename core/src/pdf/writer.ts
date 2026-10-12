/* Display list → PDF 1.7 (ADR-003; ported from spikes/pdfwriter/pdf.ts and completed, see README.md).
   One display list per page, in slide px (1600 × 900, y down); each page is MediaBox [0 0 1200 675] and one
   `cm` maps the slide onto it, so the slide fills the page by construction. Everything is vector except image
   nodes. Shared resources are written once per document and referenced from every page: fonts (subset per
   document), images (by content), gradients (one shading per style, in the unit box), soft masks and graphic
   states. No object streams (simpler to check with qpdf). Pictures are /Interpolate (viewers smooth a magnified
   picture, as the screen does). */
import { zlibSync } from "fflate";
import { decorations, imagePlacement, paintOf, radii, lineBand, mul, needsClip, pathBox, rrectOf, shadowLayers, strokeRing } from "../dl/geom";
import type { DisplayList, GroupNode, Matrix, Node, Paint, PathCmd, Stop, Stroke, TextNode } from "../dl/types";
import { decodePng, isJpeg, isPng, jpegInfo, type Raster } from "./png";
import { embeddable, noSubset, parseFont, subset as ttfSubset, variableTables, type Font } from "./ttf";

/** a font file for a text node's face */
export interface PdfFontFace { /** content hash (one embedded font per key) */ key: string; data: Uint8Array }
/** a subset font program: TrueType outlines → FontFile2, CFF in an OpenType wrapper → FontFile3 /OpenType.
    The glyph ids must stay those of the full font (retain gids) */
export interface SubsetFont { data: Uint8Array; outline: "truetype" | "cff" }
export interface PdfInput {
  pages: DisplayList[];
  /** a picture by image id: JPEG or PNG bytes, or a decoded raster */
  image: (id: string) => Uint8Array | Raster | undefined;
  /** the font file of a text node's face (font, b, i) */
  font: (n: TextNode) => PdfFontFace | undefined;
  /** a subsetter (S3.2: hb-subset); without one (or when it returns null) TrueType is subset by ttf.ts and CFF is
      embedded whole */
  subset?: (face: PdfFontFace, gids: number[]) => SubsetFont | null;
  title?: string;
  /** the slide's size in px (default 1600 × 900); the page is 0.75 pt per px */
  slide?: { w: number; h: number };
  /** Flate-compress streams (default true; false is for reading the content in tests) */
  compress?: boolean;
}

const enc = new TextEncoder();
const fmt = (v: number, d: number) => { const p = 10 ** d, r = Math.round(v * p) / p; return Object.is(r, -0) ? "0" : String(r); };
const n2 = (v: number) => fmt(v, 2), n4 = (v: number) => fmt(v, 4);
const rgbOps = (c: [number, number, number]) => c.map(v => fmt(v / 255, 4)).join(" ");
const PX_TO_PT = .75;

/** a 64-bit FNV-1a style hash of bytes (two lanes), to share identical pictures under different ids */
export function contentHash(d: Uint8Array): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ d.length;
  for (let i = 0; i < d.length; i++) { a = Math.imul(a ^ d[i], 0x01000193); b = Math.imul(b ^ d[i], 0x5bd1e995) ^ (b >>> 15); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0") + d.length.toString(16);
}
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return "(" + s.replace(/[\\()]/g, m => "\\" + m) + ")";
  let h = "<FEFF";
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, "0");
  return h + ">";
}
function pathOps(d: PathCmd[]): string {
  let s = "";
  for (const c of d) {
    if (c[0] === "M") s += `${n2(c[1])} ${n2(c[2])} m `;
    else if (c[0] === "L") s += `${n2(c[1])} ${n2(c[2])} l `;
    else if (c[0] === "C") s += `${n2(c[1])} ${n2(c[2])} ${n2(c[3])} ${n2(c[4])} ${n2(c[5])} ${n2(c[6])} c `;
    else s += "h ";
  }
  return s;
}
const cm = (m: Matrix) => `${m.map(n4).join(" ")} cm`;
const boxM = (b: { x: number; y: number; w: number; h: number }): Matrix => [Math.max(b.w, 1e-3), 0, 0, Math.max(b.h, 1e-3), b.x, b.y];

type Box = [number, number, number, number];
const unionBox = (a: Box | null, b: Box | null): Box | null => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
function transformBox(b: Box, m: Matrix): Box {
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}
/** a box that holds everything a node draws, in its parent's space (for a transparency group's BBox) */
function bounds(n: Node): Box | null {
  const pad = (b: { x: number; y: number; w: number; h: number }, p: number): Box => [b.x - p, b.y - p, b.x + b.w + p, b.y + b.h + p];
  switch (n.t) {
    case "rect": return pad(n, n.stroke ? n.stroke.w : 0);
    case "path": return pad(pathBox(n.d), n.stroke ? 5 * n.stroke.w : 0);         // a miter join reaches w/2 · limit 10
    case "line": return pad(pathBox([["M", n.x1, n.y1], ["L", n.x2, n.y2]]), n.stroke.w);
    case "image": {
      const { m, full } = imagePlacement(n);
      let b: Box | null = pad(full, 0);
      if (n.shadow) b = unionBox(b, pad(n.shadow, 0));
      return m ? transformBox(b!, m) : b;
    }
    case "shadow": return pad(n, Math.abs(n.dx) + Math.abs(n.dy) + Math.abs(n.spread) + n.blur);
    case "text": return [n.x - n.size, n.y - 1.5 * n.size, n.x + (n.w ?? n.size * [...n.src].length) + n.size, n.y + n.size];
    case "group": {
      let b: Box | null = null;
      for (const c of n.children) b = unionBox(b, bounds(c));
      if (b && n.clip) { const c = "d" in n.clip ? pad(pathBox(n.clip.d), 0) : pad(n.clip, 0); b = [Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.min(b[2], c[2]), Math.min(b[3], c[3])]; }
      if (b && (b[2] <= b[0] || b[3] <= b[1])) return null;
      return b && n.transform ? transformBox(b, n.transform) : b;
    }
    case "hit": return null;
  }
}

interface Res { name: string; id: number }
interface FontUse { res: Res; face: PdfFontFace; font: Font; gids: Set<number>; uni: Map<number, string>; /** glyph → first code point, built once */ rev: Map<number, number> | null; /** glyphs read through ActualText only */ done: Set<number> }

export function writePdf(doc: PdfInput): Uint8Array {
  const compress = doc.compress !== false;
  const slide = doc.slide ?? { w: 1600, h: 900 }, pageW = slide.w * PX_TO_PT, pageH = slide.h * PX_TO_PT;
  const objs: (Uint8Array | null)[] = [null];                       // 1-based object numbers
  const alloc = () => { objs.push(null); return objs.length - 1; };
  const put = (id: number, s: string | Uint8Array) => { objs[id] = typeof s === "string" ? enc.encode(s) : s; };
  const stream = (id: number, dict: string, data: Uint8Array, flate = compress) => {
    const body = flate ? zlibSync(data, { level: 6 }) : data;
    const head = enc.encode(`<<${dict}${flate ? "/Filter/FlateDecode" : ""}/Length ${body.length}>>\nstream\n`), tail = enc.encode("\nendstream");
    const out = new Uint8Array(head.length + body.length + tail.length);
    out.set(head); out.set(body, head.length); out.set(tail, head.length + body.length);
    put(id, out);
  };
  const catalog = alloc(), pagesId = alloc();

  // ---- shared resources, de-duplicated per document
  const gs = new Map<string, Res>(), sh = new Map<string, Res>(), xo = new Map<string, Res>(), forms: Res[] = [];
  const imgByContent = new Map<string, Res>();
  const fonts = new Map<string, FontUse>(), parsed = new Map<string, Font>();
  const graphicState = (key: string, dict: string): Res => {
    let g = gs.get(key);
    if (!g) { g = { name: "G" + gs.size, id: alloc() }; put(g.id, `<</Type/ExtGState${dict}>>`); gs.set(key, g); }
    return g;
  };
  const alphaGs = (ca: number, CA = ca, blend?: string) => graphicState(`a${n4(ca)}/${n4(CA)}/${blend || ""}`, `/ca ${n4(ca)}/CA ${n4(CA)}${blend ? `/BM/${blend}` : ""}`);
  const fn = (stops: { o: number; v: number[] }[]) => {
    const pair = (a: number[], b: number[]) => `<</FunctionType 2/Domain[0 1]/C0[${a.map(n4).join(" ")}]/C1[${b.map(n4).join(" ")}]/N 1>>`;
    if (stops.length === 2 && stops[0].o === 0 && stops[1].o === 1) return pair(stops[0].v, stops[1].v);
    // stops not at 0 / 1 extend their colour to the ends (as CSS and canvas do)
    const st = [...stops];
    if (st[0].o > 0) st.unshift({ o: 0, v: st[0].v });
    if (st[st.length - 1].o < 1) st.push({ o: 1, v: st[st.length - 1].v });
    const fs: string[] = [], bounds: string[] = [], e: string[] = [];
    for (let i = 0; i < st.length - 1; i++) { fs.push(pair(st[i].v, st[i + 1].v)); e.push("0 1"); if (i) bounds.push(n4(st[i].o)); }
    return `<</FunctionType 3/Domain[0 1]/Functions[${fs.join("")}]/Bounds[${bounds.join(" ")}]/Encode[${e.join(" ")}]>>`;
  };
  type Grad = { kind: "linear"; coords: number[]; stops: Stop[] } | { kind: "radial"; stops: Stop[] };
  const gradOf = (p: Paint): Grad => "linear" in p ? { kind: "linear", coords: p.linear, stops: p.stops } : { kind: "radial", stops: (p as { radial: { stops: Stop[] } }).radial.stops };
  /** one shading per gradient style: colour (DeviceRGB) or its alpha (DeviceGray, for the soft mask) */
  const shading = (g: Grad, gray: boolean): Res => {
    const st = g.stops.length > 1 ? g.stops : [g.stops[0], { ...g.stops[0], o: 1 }];
    const k = (gray ? "g" : "c") + g.kind + (g.kind === "linear" ? g.coords.map(n4).join(",") : "") + st.map(s => gray ? `${n4(s.o)}:${n4(s.a)}` : `${n4(s.o)}:${s.c.join(",")}`).join(";");
    let s = sh.get(k);
    if (!s) {
      s = { name: "S" + sh.size, id: alloc() };
      const coords = g.kind === "linear" ? g.coords.map(n4).join(" ") : "0 0 0 0 0 1";
      put(s.id, `<</ShadingType ${g.kind === "linear" ? 2 : 3}/ColorSpace/${gray ? "DeviceGray" : "DeviceRGB"}/Coords[${coords}]/Extend[true true]/Function ${fn(st.map(x => ({ o: x.o, v: gray ? [x.a] : x.c.map(c => c / 255) })))}>>`);
      sh.set(k, s);
    }
    return s;
  };
  /** an ExtGState whose soft mask is the gradient's alpha (the luminosity of its grey shading), in the unit box;
      shared by every shape with the same gradient style. `ext` = what the shape covers, in unit-box coordinates
      (a ring or a band reaches outside its box): the mask's BBox covers it, rounded out to quarters so that shapes
      of one style still share masks */
  const maskGs = (g: Grad, radial: Matrix | null, ext: Box): Res => {
    const q = (v: number, up: boolean) => (up ? Math.ceil(v * 4) : Math.floor(v * 4)) / 4;
    const bb: Box = [Math.min(-.25, q(ext[0], false)), Math.min(-.25, q(ext[1], false)), Math.max(1.25, q(ext[2], true)), Math.max(1.25, q(ext[3], true))];
    const g0 = shading(g, true), k = "m" + g0.name + (radial ? radial.map(n4).join(",") : "") + "@" + bb.join(",");
    let r = gs.get(k);
    if (!r) {
      const form = alloc();
      stream(form, `/Type/XObject/Subtype/Form/BBox[${bb.map(n4).join(" ")}]/Group<</S/Transparency/CS/DeviceGray>>/Resources<</Shading<</${g0.name} ${g0.id} 0 R>>>>`,
        enc.encode(`${radial ? cm(radial) + " " : ""}/${g0.name} sh`));
      r = graphicState(k, `/SMask<</S/Luminosity/G ${form} 0 R>>`);
    }
    return r;
  };
  const imageXObject = (id: string): Res | null => {
    let x = xo.get(id);
    if (x) return x;
    const src = doc.image(id);
    if (!src) return null;
    const ck = src instanceof Uint8Array ? contentHash(src) : `${src.w}x${src.h}:` + contentHash(src.rgb) + (src.alpha ? "+" + contentHash(src.alpha) : "");
    x = imgByContent.get(ck);
    if (!x) {
      x = { name: "I" + imgByContent.size, id: alloc() };
      if (src instanceof Uint8Array && isJpeg(src)) {
        const j = jpegInfo(src), cs = j.comps === 1 ? "DeviceGray" : j.comps === 4 ? "DeviceCMYK" : "DeviceRGB";
        // a DCT stream is passed through as it is (never deflated again)
        stream(x.id, `/Type/XObject/Subtype/Image/Width ${j.w}/Height ${j.h}/ColorSpace/${cs}/BitsPerComponent 8${j.comps === 4 && j.adobe ? "/Decode[1 0 1 0 1 0 1 0]" : ""}/Interpolate true/Filter/DCTDecode`, src, false);
      } else {
        const r: Raster = src instanceof Uint8Array ? (isPng(src) ? decodePng(src) : (() => { throw new Error(`image ${id}: not a JPEG or PNG`); })()) : src;
        let smask = "";
        if (r.alpha) { const m = alloc(); stream(m, `/Type/XObject/Subtype/Image/Width ${r.w}/Height ${r.h}/ColorSpace/DeviceGray/BitsPerComponent 8/Interpolate true`, r.alpha, true); smask = `/SMask ${m} 0 R`; }
        stream(x.id, `/Type/XObject/Subtype/Image/Width ${r.w}/Height ${r.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Interpolate true${smask}`, r.rgb, true);
      }
      imgByContent.set(ck, x);
    }
    xo.set(id, x);
    return x;
  };
  const fontOf = (n: TextNode): FontUse => {
    const face = doc.font(n);
    if (!face) throw new Error(`no font file for ${n.font}${n.b ? " bold" : ""}${n.i ? " italic" : ""}`);
    let u = fonts.get(face.key);
    if (!u) {
      let f = parsed.get(face.key);
      if (!f) { f = parseFont(face.data, face.key); parsed.set(face.key, f); }
      if (!embeddable(f)) throw new Error(`font ${psName(f)} does not allow embedding its outlines (OS/2.fsType)`);
      const v = variableTables(f);
      if (v.length) throw new Error(`font ${psName(f)} is a variable font (${v.join(", ")}): it is made static before it is used`);
      u = { res: { name: "F" + fonts.size, id: alloc() }, face, font: f, gids: new Set([0]), uni: new Map(), rev: null, done: new Set() };
      fonts.set(face.key, u);
    }
    return u;
  };

  /** a content stream (a page or a form) and the resources it uses */
  class Content {
    ops: string[] = [];
    used = { ExtGState: new Map<string, number>(), Shading: new Map<string, number>(), XObject: new Map<string, number>(), Font: new Map<string, number>() };
    use(kind: keyof Content["used"], r: Res) { this.used[kind].set(r.name, r.id); return r.name; }
    resources() {
      const d = (m: Map<string, number>) => [...m].map(([n, id]) => `/${n} ${id} 0 R`).join("");
      return `<<${(Object.keys(this.used) as (keyof Content["used"])[]).filter(k => this.used[k].size).map(k => `/${k}<<${d(this.used[k])}>>`).join("")}>>`;
    }
    /** fill a path with a paint on a box; `ext` = the path's own bounds when it reaches outside the box */
    fill(path: string, paint: Paint, box: { x: number; y: number; w: number; h: number }, evenodd = false, ext = box) {
      const o = this.ops, p = paintOf(paint);
      if ("solid" in p) {
        const a = p.a ?? 1;
        o.push(`q ${a < 1 ? `/${this.use("ExtGState", alphaGs(a))} gs ` : ""}${rgbOps(p.solid)} rg ${path}${evenodd ? "f*" : "f"} Q`);
        return;
      }
      // a gradient: clip to the shape, map the unit box (and a radial paint's ellipse), paint the shared shading
      const g = gradOf(p), radial: Matrix | null = "radial" in p ? [p.radial.rx, 0, 0, p.radial.ry, p.radial.cx, p.radial.cy] : null;
      const s = this.use("Shading", shading(g, false));
      let line = `q ${path}${evenodd ? "W*" : "W"} n ${cm(boxM(box))}`;
      const as = g.stops.map(x => x.a), same = as.every(a => Math.abs(a - as[0]) < 1e-4);
      if (same && as[0] < 1) line += ` /${this.use("ExtGState", alphaGs(as[0]))} gs`;
      else if (!same) {
        const bw = Math.max(box.w, 1e-3), bh = Math.max(box.h, 1e-3);
        line += ` /${this.use("ExtGState", maskGs(g, radial, [(ext.x - box.x) / bw, (ext.y - box.y) / bh, (ext.x + ext.w - box.x) / bw, (ext.y + ext.h - box.y) / bh]))} gs`;
      }
      o.push(`${line}${radial ? " " + cm(radial) : ""} /${s} sh Q`);
    }
    strokeSolid(path: string, s: Stroke) {
      const p = s.paint as { solid: [number, number, number]; a?: number }, a = p.a ?? 1;
      const cap = s.cap === "round" ? 1 : s.cap === "square" ? 2 : 0;
      this.ops.push(`q ${a < 1 ? `/${this.use("ExtGState", alphaGs(1, a))} gs ` : ""}${rgbOps(p.solid)} RG ${n2(s.w)} w ${cap} J 0 j 10 M ${s.dash ? `[${s.dash.map(n2).join(" ")}] 0 d ` : ""}${path}S Q`);
    }
    draw(n: Node) {
      const o = this.ops;
      switch (n.t) {
        case "rect": {
          const q = radii(n.r, n.w, n.h), p = q.some(v => v > 0) ? pathOps(rrectOf(n)) : `${n2(n.x)} ${n2(n.y)} ${n2(n.w)} ${n2(n.h)} re `;
          if (n.fill && n.w > 0 && n.h > 0) this.fill(p, n.fill, n);   // a zero-size box has nothing to fill (its stroke stays)
          if (n.stroke) {
            if ("solid" in n.stroke.paint) this.strokeSolid(p, n.stroke);
            else { const ring = strokeRing(n, n.stroke.w); this.fill(pathOps(ring), n.stroke.paint, n, true, pathBox(ring)); }
          }
          return;
        }
        case "path": {
          const p = pathOps(n.d);
          if (n.fill) this.fill(p, n.fill, pathBox(n.d), n.rule === "evenodd");
          if (n.stroke) this.strokeSolid(p, n.stroke);
          return;
        }
        case "line":
          if ("solid" in n.stroke.paint) this.strokeSolid(`${n2(n.x1)} ${n2(n.y1)} m ${n2(n.x2)} ${n2(n.y2)} l `, n.stroke);
          else { const band = lineBand(n.x1, n.y1, n.x2, n.y2, n.stroke); this.fill(pathOps(band), n.stroke.paint, pathBox(band)); }
          return;
        case "image": {
          if (n.w <= 0 || n.h <= 0) return;
          const x = imageXObject(n.id);
          if (!x) return;
          const { m, full } = imagePlacement(n);
          let s = "q " + (m ? cm(m) + " " : "");
          if (n.shadow) { const sx = imageXObject(n.shadow.id); if (sx) s += `q ${cm([n.shadow.w, 0, 0, -n.shadow.h, n.shadow.x, n.shadow.y + n.shadow.h])} /${this.use("XObject", sx)} Do Q `; }
          if (needsClip(n)) s += pathOps(rrectOf(n)) + "W n ";
          if (n.alpha !== undefined && n.alpha < 1) s += `/${this.use("ExtGState", alphaGs(n.alpha))} gs `;
          o.push(s + `${cm([full.w, 0, 0, -full.h, full.x, full.y + full.h])} /${this.use("XObject", x)} Do Q`);
          return;
        }
        case "shadow":
          // soft shadow as SHADOW_STEPS sharp layers of fading strength, each clipped to outside (inset: inside) its box
          for (const l of shadowLayers(n))
            o.push(`q ${pathOps(l.clip)}W* n /${this.use("ExtGState", alphaGs(l.a))} gs ${rgbOps(n.c)} rg ${pathOps(l.fill)}f* Q`);
          return;
        case "text": this.text(n); return;
        case "group": this.group(n); return;
        case "hit": return;
      }
    }
    text(n: TextNode) {
      if (!n.src) return;                                   // an empty run draws nothing (and needs no font)
      const u = fontOf(n), f = u.font, k = n.size / f.unitsPerEm, p = n.fill as { solid: [number, number, number]; a?: number }, a = p.a ?? 1;
      let gids: number[], adv: number[] | null = null;
      const chars = [...n.src];
      if (n.gids && n.adv) {
        gids = n.gids; adv = n.adv;
        if (n.cl && n.cl.length === gids.length) {
          // each cluster's text: one character per glyph when the counts agree (a letter and its marks), the whole text
          // on the first glyph when fewer glyphs (a ligature); a cluster with more glyphs than characters is read
          // through ActualText (above), so its extra glyphs are given no text of their own
          const ends = [...new Set(n.cl)].sort((x, y) => x - y);
          for (let i = 0; i < gids.length;) {
            let j = i + 1; while (j < gids.length && n.cl[j] === n.cl[i]) j++;
            const from = n.cl[i], to = ends.find(c => c > from) ?? n.src.length, cs = [...n.src.slice(from, to)];
            if (cs.length === j - i) for (let q = i; q < j; q++) { if (!u.uni.has(gids[q])) u.uni.set(gids[q], cs[q - i]); }
            else if (cs.length > j - i) { if (!u.uni.has(gids[i])) u.uni.set(gids[i], cs.join("")); }
            // more glyphs than characters (a decomposed letter, ȩ = e + cedilla): the cluster is read through ActualText;
            // the base keeps its own character (the same glyph stands for a plain "e" elsewhere), the others get none
            else for (let q = i + 1; q < j; q++) u.done.add(gids[q]);
            i = j;
          }
        }
        for (const g of gids) if (!u.uni.has(g) && !u.done.has(g)) {
          if (!u.rev) { u.rev = new Map(); for (const [cp, gg] of f.cmap) if (!u.rev.has(gg)) u.rev.set(gg, cp); }
          const cp = u.rev.get(g); if (cp !== undefined) u.uni.set(g, String.fromCodePoint(cp));
        }
      } else {
        gids = chars.map(ch => f.cmap.get(ch.codePointAt(0)!) || 0);
        gids.forEach((g, i) => { if (g && !u.uni.has(g)) u.uni.set(g, chars[i]); });
      }
      for (const g of gids) u.gids.add(g);
      u.uni.delete(0);                                       // .notdef stands for no character in particular
      const hex = (g: number) => g.toString(16).padStart(4, "0");
      /** the glyph's width as the viewer takes it: W (1/1000 em, written with 2 decimals) */
      const wOf = (g: number) => Math.round(f.advances[g] * 1000 / f.unitsPerEm * 100) / 100 * n.size / 1000;
      let show: string;
      if (adv && (n.dx || n.dy)) {
        // marks with offsets, kept on one text line: the pen moves by TJ adjustments, a mark is shifted by its x offset
        // (TJ before it, undone after) and raised by its y offset (Ts); a cluster of several glyphs carries its text as
        // ActualText (PDFium and Acrobat read it so; the glyphs' own ToUnicode entries serve the rest)
        const parts: string[] = [];
        const kern = (px: number) => { if (Math.abs(px) > 1e-4) parts.push(`[${n4(-px * 1000 / n.size)}] TJ`); };
        const runOf = (i: number) => { let j = i + 1; while (j < gids.length && n.cl && n.cl[j] === n.cl[i]) j++; return j; };
        let rise = 0;
        for (let i = 0; i < gids.length;) {
          const j = runOf(i), from = n.cl?.[i] ?? 0, to = j < gids.length && n.cl ? n.cl[j] : n.src.length, chars = [...n.src.slice(Math.min(from, to), Math.max(from, to))].length;
          // a cluster of several glyphs (a letter with its marks, a decomposed letter) is read as its text, once
          const span = n.cl && j - i > 1 && chars > 0;
          if (span) parts.push(`/Span<</ActualText${pdfString(n.src.slice(Math.min(from, to), Math.max(from, to)))}>>BDC`);
          for (let q = i; q < j; q++) {
            const g = gids[q], ox = n.dx?.[q] ?? 0, oy = n.dy?.[q] ?? 0;
            if (Math.abs(oy - rise) > 1e-4) { parts.push(`${n4(oy)} Ts`); rise = oy; }
            kern(ox);
            parts.push(`<${hex(g)}> Tj`);
            kern(adv![q] - ox - wOf(g));                    // to the next pen position
          }
          if (span) parts.push("EMC");
          i = j;
        }
        if (rise) parts.push("0 Ts");
        show = parts.join(" ");
            } else if (adv) {
        // glyph positions as shaped: a TJ adjustment wherever the advance differs from the glyph's W (kerning); a
        // cluster drawn with more glyphs than it has characters is its own TJ inside an ActualText span
        const out: string[] = []; let parts: string[] = [], run = "";
        const flush = () => { if (run) parts.push(`<${run}>`); run = ""; if (parts.length) out.push(`[${parts.join(" ")}] TJ`); parts = []; };
        for (let i = 0; i < gids.length;) {
          let j = i + 1; while (n.cl && j < gids.length && n.cl[j] === n.cl[i]) j++;
          const from = n.cl?.[i] ?? 0, to = n.cl && j < gids.length ? n.cl[j] : n.src.length;
          const text = n.src.slice(Math.min(from, to), Math.max(from, to)), span = !!n.cl && j - i > [...text].length && text.length > 0;
          if (span) { flush(); out.push(`/Span<</ActualText${pdfString(text)}>>BDC`); }
          for (let q = i; q < j; q++) {
            run += hex(gids[q]);
            const adj = (wOf(gids[q]) - adv![q]) * 1000 / n.size;
            if (Math.abs(adj) > .005 && q < gids.length - 1) { parts.push(`<${run}>`, n4(adj)); run = ""; }
          }
          if (span) { flush(); out.push("EMC"); }
          i = j;
        }
        flush();
        show = out.join(" ");
      } else {
        // the measured width spread over the gaps between the characters, as SVG textLength does (the last glyph ends
        // at x + w; canvas letterSpacing the same)
        const natural = gids.reduce((t, g) => t + wOf(g), 0);
        const tc = n.w !== undefined && chars.length > 1 ? (n.w - natural) / (chars.length - 1) : 0;
        show = `${Math.abs(tc) > 1e-4 ? n4(tc) + " Tc " : ""}<${gids.map(hex).join("")}> Tj`;
      }
      const g = a < 1 ? `/${this.use("ExtGState", alphaGs(a))} gs ` : "";
      // a decorative copy (a title's text shadow) is an artifact: drawn, not read as text a second time
      let s = `${n.decorative ? "/Artifact BMC " : ""}q ${g}${rgbOps(p.solid)} rg BT /${this.use("Font", u.res)} ${n2(n.size)} Tf 1 0 0 -1 ${n2(n.x)} ${n2(n.y)} Tm ${show} ET`;
      if (n.decoration && n.w !== undefined) for (const [x, y, w, h] of decorations(n, n.w)) s += ` ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f`;
      this.ops.push(s + " Q" + (n.decorative ? " EMC" : ""));
    }
    group(n: GroupNode) {
      const composite = (n.alpha !== undefined && n.alpha < 1) || !!n.blend;
      const clip = n.clip ? pathOps("d" in n.clip ? n.clip.d : rrectOf(n.clip)) + "W n" : "";
      if (!composite) {
        this.ops.push("q" + (n.transform ? " " + cm(n.transform) : "") + (clip ? " " + clip : ""));
        for (const c of n.children) this.draw(c);
        this.ops.push("Q");
        return;
      }
      // alpha or a blend mode: an isolated transparency group (a form XObject) composited once
      const inner = { ...n, transform: undefined };
      const b = bounds(inner);
      if (!b) return;
      const form = new Content();
      if (clip) form.ops.push(clip);
      for (const c of n.children) form.draw(c);
      const r: Res = { name: "X" + forms.length, id: alloc() };
      forms.push(r);
      stream(r.id, `/Type/XObject/Subtype/Form/BBox[${b.map(n2).join(" ")}]/Group<</S/Transparency/I true/CS/DeviceRGB>>/Resources ${form.resources()}`, enc.encode(form.ops.join("\n")));
      const g = alphaGs(n.alpha ?? 1, n.alpha ?? 1, n.blend === "multiply" ? "Multiply" : undefined);
      this.ops.push(`q ${n.transform ? cm(n.transform) + " " : ""}/${this.use("ExtGState", g)} gs /${this.use("XObject", r)} Do Q`);
    }
  }

  // ---- pages
  const pageIds: number[] = [];
  for (const list of doc.pages) {
    const c = new Content();
    c.ops.push(`${n4(PX_TO_PT)} 0 0 ${n4(-PX_TO_PT)} 0 ${n2(pageH)} cm`);          // slide px, y down; the page is the slide
    for (const n of list) c.draw(n);
    const cont = alloc(); stream(cont, "", enc.encode(c.ops.join("\n")));
    const pid = alloc();
    put(pid, `<</Type/Page/Parent ${pagesId} 0 R/MediaBox[0 0 ${n2(pageW)} ${n2(pageH)}]/Group<</S/Transparency/CS/DeviceRGB>>/Resources ${c.resources()}/Contents ${cont} 0 R>>`);
    pageIds.push(pid);
  }

  // ---- fonts: subset per document, Type0 / Identity-H, widths and ToUnicode (selectable, searchable text)
  for (const u of fonts.values()) {
    const f = u.font, gids = [...u.gids].sort((a, b) => a - b), s = 1000 / f.unitsPerEm;
    // a font whose licence forbids subsetting (OS/2.fsType 0x0100) is embedded whole
    let sub = doc.subset && !noSubset(f) ? doc.subset(u.face, gids) : null;
    if (!sub) sub = f.cff || noSubset(f) ? { data: f.data, outline: f.cff ? "cff" : "truetype" } : { data: ttfSubset(f, u.gids), outline: "truetype" };
    const file = alloc(), desc = alloc(), cid = alloc(), tu = alloc();
    if (sub.outline === "truetype") stream(file, `/Length1 ${sub.data.length}`, sub.data);
    else stream(file, `/Subtype/OpenType`, sub.data);
    const tag = subsetTag(u.face.key, gids) + "+" + psName(f);
    put(desc, `<</Type/FontDescriptor/FontName/${tag}/Flags ${f.flags}/FontBBox[${f.bbox.map(v => Math.round(v * s)).join(" ")}]/ItalicAngle ${f.italicAngle}/Ascent ${Math.round(f.ascent * s)}/Descent ${Math.round(f.descent * s)}/CapHeight ${Math.round(f.capHeight * s)}/StemV 80/${sub.outline === "truetype" ? "FontFile2" : "FontFile3"} ${file} 0 R>>`);
    // W: runs of consecutive glyph ids share one array
    const w: string[] = [];
    for (let i = 0; i < gids.length;) {
      // two decimals: the text operators place glyphs with these same widths (wOf)
      let j = i; const ws = [n2(f.advances[gids[i]] * s)];
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) { j++; ws.push(n2(f.advances[gids[j]] * s)); }
      w.push(`${gids[i]}[${ws.join(" ")}]`); i = j + 1;
    }
    put(cid, `<</Type/Font/Subtype/${sub.outline === "truetype" ? "CIDFontType2" : "CIDFontType0"}/BaseFont/${tag}/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>/FontDescriptor ${desc} 0 R${sub.outline === "truetype" ? "/CIDToGIDMap/Identity" : ""}/DW 0/W[${w.join(" ")}]>>`);
    const utf16 = (str: string) => { let h = ""; for (let i = 0; i < str.length; i++) h += str.charCodeAt(i).toString(16).padStart(4, "0"); return h; };
    const lines = [...u.uni].sort((a, b) => a[0] - b[0]).map(([g, t]) => `<${g.toString(16).padStart(4, "0")}><${utf16(t)}>`);
    let cmap = "/CIDInit/ProcSet findresource begin 12 dict begin begincmap/CIDSystemInfo<</Registry(Adobe)/Ordering(UCS)/Supplement 0>>def/CMapName/Adobe-Identity-UCS def/CMapType 2 def 1 begincodespacerange<0000><FFFF>endcodespacerange\n";
    for (let i = 0; i < lines.length; i += 100) { const ch = lines.slice(i, i + 100); cmap += `${ch.length} beginbfchar\n${ch.join("\n")}\nendbfchar\n`; }
    cmap += "endcmap CMapName currentdict/CMap defineresource pop end end";
    stream(tu, "", enc.encode(cmap));
    put(u.res.id, `<</Type/Font/Subtype/Type0/BaseFont/${tag}/Encoding/Identity-H/DescendantFonts[${cid} 0 R]/ToUnicode ${tu} 0 R>>`);
  }
  put(pagesId, `<</Type/Pages/Kids[${pageIds.map(p => p + " 0 R").join(" ")}]/Count ${pageIds.length}>>`);
  put(catalog, `<</Type/Catalog/Pages ${pagesId} 0 R>>`);
  const info = alloc();
  put(info, `<</Producer(Slide Builder)${doc.title ? `/Title${pdfString(doc.title)}` : ""}>>`);

  // ---- the file: header, objects, cross-reference table, trailer
  const chunks: Uint8Array[] = [new Uint8Array([...enc.encode("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let pos = chunks[0].length; const xref: number[] = [0];
  for (let i = 1; i < objs.length; i++) {
    const head = enc.encode(`${i} 0 obj\n`), tail = enc.encode("\nendobj\n");
    xref.push(pos); chunks.push(head, objs[i]!, tail); pos += head.length + objs[i]!.length + tail.length;
  }
  let x = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) x += String(xref[i]).padStart(10, "0") + " 00000 n \n";
  x += `trailer\n<</Size ${objs.length}/Root ${catalog} 0 R/Info ${info} 0 R>>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(enc.encode(x));
  const total = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** six capital letters naming a subset (PDF 32000 §9.6.4), stable for the same font and glyphs */
function subsetTag(key: string, gids: number[]): string {
  let h = 2166136261;
  for (const c of key + gids.join(",")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let t = ""; h >>>= 0;
  for (let i = 0; i < 6; i++) { t += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) + (i * 7919); }
  return t;
}
/** the font's PostScript name (name ID 6), or its key, as a PDF name */
function psName(f: Font): string {
  const t = f.tables.get("name");
  let name = "";
  if (t) {
    const d = f.data, o = t.off, count = (d[o + 2] << 8) | d[o + 3], strings = o + ((d[o + 4] << 8) | d[o + 5]);
    for (let i = 0; i < count && !name; i++) {
      const r = o + 6 + 12 * i, pid = (d[r] << 8) | d[r + 1], nid = (d[r + 6] << 8) | d[r + 7], len = (d[r + 8] << 8) | d[r + 9], off = (d[r + 10] << 8) | d[r + 11];
      if (nid !== 6) continue;
      const b = d.subarray(strings + off, strings + off + len);
      name = pid === 3 || pid === 0 ? String.fromCharCode(...Array.from({ length: b.length >> 1 }, (_, k) => (b[2 * k] << 8) | b[2 * k + 1])) : String.fromCharCode(...b);
    }
  }
  return (name || f.name).replace(/[^!-~]|[()<>[\]{}/%#]/g, "") || "Font";
}
