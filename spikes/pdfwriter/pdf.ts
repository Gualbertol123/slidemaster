/* Display list → PDF, the core of the proposed export engine (spike).
   One display list per slide, in slide px (1600 × 900); each page is 1200 × 675 pt, the slide fills it exactly.
   Everything is vector except Image nodes. Shared resources (fonts, images, alpha states, gradients)
   are written once per document and referenced from every page. */
import { deflateSync } from "node:zlib";
import { type Font, glyphOf, subset } from "./ttf.ts";

export type RGB = [number, number, number];
export interface Stop { o: number; c: RGB; a: number }
export type Paint = { solid: RGB; a?: number } | { lin: [number, number, number, number]; stops: Stop[] };
export interface Stroke { c: RGB; a?: number; w: number; dash?: number[] }
export type Node =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: Paint; stroke?: Stroke }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  | { t: "image"; id: string; x: number; y: number; w: number; h: number }
  | { t: "shadow"; x: number; y: number; w: number; h: number; r: number; dx: number; dy: number; blur: number; spread: number; c: RGB; a: number }
  | { t: "text"; font: string; size: number; x: number; y: number; s: string; c: RGB; a?: number }
  | { t: "group"; clip?: { x: number; y: number; w: number; h: number; r: number }; alpha?: number; children: Node[] };
export interface Slide { nodes: Node[] }
export interface Doc { slides: Slide[]; fonts: Map<string, Font>; images: Map<string, Uint8Array> }

const enc = new TextEncoder();
const n2 = (v: number) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? "0" : String(r); };
const SHADOW_STEPS = 6;

export function writePdf(doc: Doc, opts: { compress?: boolean } = {}): Uint8Array {
  const compress = opts.compress !== false;
  const objs: (Uint8Array | null)[] = [null];                       // 1-based object numbers
  const alloc = () => { objs.push(null); return objs.length - 1; };
  const put = (id: number, s: string | Uint8Array) => { objs[id] = typeof s === "string" ? enc.encode(s) : s; };
  const stream = (id: number, dict: string, data: Uint8Array, flate = compress) => {
    const body = flate ? deflateSync(data, { level: 6 }) : data;
    const head = enc.encode(`<<${dict}${flate ? "/Filter/FlateDecode" : ""}/Length ${body.length}>>\nstream\n`);
    const out = new Uint8Array(head.length + body.length + 10); out.set(head); out.set(body, head.length); out.set(enc.encode("\nendstream"), head.length + body.length);
    put(id, out);
  };
  const catalog = alloc(), pagesId = alloc();

  // ---- shared resources (deduplicated per document)
  const gs = new Map<string, { name: string; id: number }>();         // alpha / soft masks
  const sh = new Map<string, { name: string; id: number }>();         // gradients
  const xo = new Map<string, { name: string; id: number }>();         // images
  const fontUse = new Map<string, Set<number>>();                     // font → glyph ids
  const fontRes = new Map<string, { name: string; id: number }>();
  const alphaGs = (ca: number, CA = ca) => {
    const k = `a${n2(ca)}/${n2(CA)}`; let g = gs.get(k);
    if (!g) { g = { name: "G" + gs.size, id: alloc() }; put(g.id, `<</Type/ExtGState/ca ${n2(ca)}/CA ${n2(CA)}>>`); gs.set(k, g); }
    return g.name;
  };
  const fn = (stops: { o: number; v: number[] }[]) => {
    const pair = (a: number[], b: number[]) => `<</FunctionType 2/Domain[0 1]/C0[${a.map(n2).join(" ")}]/C1[${b.map(n2).join(" ")}]/N 1>>`;
    if (stops.length === 2) return pair(stops[0].v, stops[1].v);
    const fs: string[] = [], bounds: string[] = [], e: string[] = [];
    for (let i = 0; i < stops.length - 1; i++) { fs.push(pair(stops[i].v, stops[i + 1].v)); e.push("0 1"); if (i) bounds.push(n2(stops[i].o)); }
    return `<</FunctionType 3/Domain[0 1]/Functions[${fs.join("")}]/Bounds[${bounds.join(" ")}]/Encode[${e.join(" ")}]>>`;
  };
  const shading = (p: { lin: number[]; stops: Stop[] }, gray: boolean) => {
    const st = p.stops.length > 1 ? p.stops : [p.stops[0], p.stops[0]];
    const k = (gray ? "g" : "c") + p.lin.map(n2).join(",") + st.map(s => gray ? `${n2(s.o)}:${n2(s.a)}` : `${n2(s.o)}:${s.c.join(",")}`).join(";");
    let s = sh.get(k);
    if (!s) {
      s = { name: "S" + sh.size, id: alloc() };
      put(s.id, `<</ShadingType 2/ColorSpace/${gray ? "DeviceGray" : "DeviceRGB"}/Coords[${p.lin.map(n2).join(" ")}]/Extend[true true]/Function ${fn(st.map(x => ({ o: x.o, v: gray ? [x.a] : x.c.map(c => c / 255) })))}>>`);
      sh.set(k, s);
    }
    return s;
  };
  /** an ExtGState whose soft mask is the gradient's alpha (luminosity of a grey shading) */
  const maskGs = (p: { lin: number[]; stops: Stop[] }, bbox: number[]) => {
    const g0 = shading(p, true), k = "m" + g0.name;
    let g = gs.get(k);
    if (!g) {
      const form = alloc();
      stream(form, `/Type/XObject/Subtype/Form/BBox[${bbox.map(n2).join(" ")}]/Group<</S/Transparency/CS/DeviceGray>>/Resources<</Shading<</${g0.name} ${g0.id} 0 R>>>>`, enc.encode(`/${g0.name} sh`));
      g = { name: "G" + gs.size, id: alloc() }; put(g.id, `<</Type/ExtGState/SMask<</S/Luminosity/G ${form} 0 R>>>>`); gs.set(k, g);
    }
    return g.name;
  };
  const image = (id: string) => {
    let x = xo.get(id);
    if (!x) {
      const jpg = doc.images.get(id)!; const [w, h] = jpegSize(jpg);
      x = { name: "I" + xo.size, id: alloc() };
      stream(x.id, `/Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode`, jpg, false);
      // (a DCT stream must not be deflated again: the writer passes the JPEG bytes through)
      xo.set(id, x);
    }
    return x.name;
  };
  const fontName = (f: string) => { let r = fontRes.get(f); if (!r) { r = { name: "F" + fontRes.size, id: alloc() }; fontRes.set(f, r); fontUse.set(f, new Set()); } return r.name; };

  // ---- pages
  const pageIds: number[] = [];
  for (const slide of doc.slides) {
    const used = { gs: new Set<string>(), sh: new Set<string>(), xo: new Set<string>(), f: new Set<string>() };
    const ops: string[] = ["0.75 0 0 -0.75 0 675 cm"];                  // slide px, y down; page = slide exactly
    const rrect = (x: number, y: number, w: number, h: number, r = 0) => {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      if (!r) return `${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re`;
      const k = r * 0.5523, X = x + w, Y = y + h;
      return `${n2(x + r)} ${n2(y)} m ${n2(X - r)} ${n2(y)} l ${n2(X - r + k)} ${n2(y)} ${n2(X)} ${n2(y + r - k)} ${n2(X)} ${n2(y + r)} c `
        + `${n2(X)} ${n2(Y - r)} l ${n2(X)} ${n2(Y - r + k)} ${n2(X - r + k)} ${n2(Y)} ${n2(X - r)} ${n2(Y)} c ${n2(x + r)} ${n2(Y)} l `
        + `${n2(x + r - k)} ${n2(Y)} ${n2(x)} ${n2(Y - r + k)} ${n2(x)} ${n2(Y - r)} c ${n2(x)} ${n2(y + r)} l ${n2(x)} ${n2(y + r - k)} ${n2(x + r - k)} ${n2(y)} ${n2(x + r)} ${n2(y)} c h`;
    };
    const rgb = (c: RGB) => c.map(v => n2(v / 255)).join(" ");
    const fill = (path: string, p: Paint, bbox: number[]) => {
      if ("solid" in p) {
        const a = p.a ?? 1; ops.push("q"); if (a < 1) { const g = alphaGs(a); used.gs.add(g); ops.push(`/${g} gs`); }
        ops.push(`${rgb(p.solid)} rg ${path} f Q`); return;
      }
      // gradients are defined on the unit square of the shape's box (like CSS): one shading object and one
      // soft mask per gradient STYLE, reused by every shape that has it, whatever its size
      const s = shading(p, false); used.sh.add(s.name);
      ops.push("q", path + " W n", `${n2(bbox[2] - bbox[0])} 0 0 ${n2(bbox[3] - bbox[1])} ${n2(bbox[0])} ${n2(bbox[1])} cm`);
      const as = p.stops.map(x => x.a), same = as.every(a => Math.abs(a - as[0]) < 1e-3);
      if (same && as[0] < 1) { const g = alphaGs(as[0]); used.gs.add(g); ops.push(`/${g} gs`); }
      else if (!same) { const g = maskGs(p, [0, 0, 1, 1]); used.gs.add(g); ops.push(`/${g} gs`); }
      ops.push(`/${s.name} sh Q`);
    };
    const strokeOps = (s: Stroke) => {
      const a = s.a ?? 1; let o = `${rgb(s.c)} RG ${n2(s.w)} w ${s.dash ? `[${s.dash.map(n2).join(" ")}] 0 d` : ""}`;
      if (a < 1) { const g = alphaGs(1, a); used.gs.add(g); o = `/${g} gs ` + o; }
      return o;
    };
    const draw = (n: Node) => {
      switch (n.t) {
        case "rect": {
          const p = rrect(n.x, n.y, n.w, n.h, n.r);
          if (n.fill) fill(p, n.fill, [n.x, n.y, n.x + n.w, n.y + n.h]);
          if (n.stroke) ops.push(`q ${strokeOps(n.stroke)} ${p} S Q`);
          break;
        }
        case "line": ops.push(`q ${strokeOps(n.stroke)} ${n2(n.x1)} ${n2(n.y1)} m ${n2(n.x2)} ${n2(n.y2)} l S Q`); break;
        case "image": { const nm = image(n.id); used.xo.add(nm); ops.push(`q ${n2(n.w)} 0 0 ${n2(-n.h)} ${n2(n.x)} ${n2(n.y + n.h)} cm /${nm} Do Q`); break; }
        case "shadow": {
          // soft shadow as SHADOW_STEPS sharp rounded rectangles of fading strength (vector; the same on screen)
          const g = alphaGs(n.a / SHADOW_STEPS); used.gs.add(g);
          ops.push(`q /${g} gs ${rgb(n.c)} rg`);
          for (let k = 0; k < SHADOW_STEPS; k++) {
            const s = n.spread + n.blur * 0.6 * ((k + 1) / SHADOW_STEPS - 0.5);
            ops.push(rrect(n.x + n.dx - s, n.y + n.dy - s, n.w + 2 * s, n.h + 2 * s, n.r + s) + " f");
          }
          ops.push("Q"); break;
        }
        case "text": {
          const f = doc.fonts.get(n.font)!, nm = fontName(n.font), set = fontUse.get(n.font)!; used.f.add(nm);
          let hex = ""; for (const ch of n.s) { const g = glyphOf(f, ch.codePointAt(0)!); set.add(g); hex += g.toString(16).padStart(4, "0"); }
          const a = n.a ?? 1; let pre = "";
          if (a < 1) { const g = alphaGs(a); used.gs.add(g); pre = `/${g} gs `; }
          ops.push(`q ${pre}BT /${nm} ${n2(n.size)} Tf ${rgb(n.c)} rg 1 0 0 -1 ${n2(n.x)} ${n2(n.y)} Tm <${hex}> Tj ET Q`);
          break;
        }
        case "group": {
          ops.push("q");
          if (n.clip) ops.push(rrect(n.clip.x, n.clip.y, n.clip.w, n.clip.h, n.clip.r) + " W n");
          if (n.alpha != null && n.alpha < 1) { const g = alphaGs(n.alpha); used.gs.add(g); ops.push(`/${g} gs`); }
          n.children.forEach(draw); ops.push("Q"); break;
        }
      }
    };
    slide.nodes.forEach(draw);
    const cont = alloc(); stream(cont, "", enc.encode(ops.join("\n")));
    const dict = (m: Map<string, { name: string; id: number }>, names: Set<string>) => [...m.values()].filter(v => names.has(v.name)).map(v => `/${v.name} ${v.id} 0 R`).join("");
    const res = `<</ExtGState<<${dict(gs, used.gs)}>>/Shading<<${dict(sh, used.sh)}>>/XObject<<${dict(xo, used.xo)}>>/Font<<${dict(fontRes, used.f)}>>>>`;
    const pid = alloc(); put(pid, `<</Type/Page/Parent ${pagesId} 0 R/MediaBox[0 0 1200 675]/Resources ${res}/Contents ${cont} 0 R>>`);
    pageIds.push(pid);
  }

  // ---- fonts: subset TrueType, CIDFontType2 / Identity-H, widths and ToUnicode (selectable, searchable text)
  for (const [key, r] of fontRes) {
    const f = doc.fonts.get(key)!, used = fontUse.get(key)!, file = alloc(), desc = alloc(), cid = alloc(), tu = alloc();
    const sub = subset(f, used); stream(file, `/Length1 ${sub.length}`, sub);
    const s = 1000 / f.unitsPerEm, tag = "SB" + String.fromCharCode(65 + (r.id % 26)).repeat(4) + "+";
    put(desc, `<</Type/FontDescriptor/FontName/${tag}${f.name}/Flags ${f.flags}/FontBBox[${f.bbox.map(v => Math.round(v * s)).join(" ")}]/ItalicAngle ${f.italicAngle}/Ascent ${Math.round(f.ascent * s)}/Descent ${Math.round(f.descent * s)}/CapHeight ${Math.round(f.capHeight * s)}/StemV 80/FontFile2 ${file} 0 R>>`);
    const gids = [...used].sort((a, b) => a - b);
    put(cid, `<</Type/Font/Subtype/CIDFontType2/BaseFont/${tag}${f.name}/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>/FontDescriptor ${desc} 0 R/CIDToGIDMap/Identity/W[${gids.map(g => `${g}[${Math.round(f.advances[g] * s)}]`).join(" ")}]>>`);
    const rev = new Map<number, number>(); for (const [cp, g] of f.cmap) if (used.has(g) && !rev.has(g)) rev.set(g, cp);
    const lines = [...rev].map(([g, cp]) => `<${g.toString(16).padStart(4, "0")}><${cp.toString(16).padStart(4, "0")}>`);
    let cm = "/CIDInit/ProcSet findresource begin 12 dict begin begincmap/CIDSystemInfo<</Registry(Adobe)/Ordering(UCS)/Supplement 0>>def/CMapName/Adobe-Identity-UCS def/CMapType 2 def 1 begincodespacerange<0000><FFFF>endcodespacerange\n";
    for (let i = 0; i < lines.length; i += 100) { const ch = lines.slice(i, i + 100); cm += `${ch.length} beginbfchar\n${ch.join("\n")}\nendbfchar\n`; }
    cm += "endcmap CMapName currentdict/CMap defineresource pop end end";
    stream(tu, "", enc.encode(cm));
    put(r.id, `<</Type/Font/Subtype/Type0/BaseFont/${tag}${f.name}/Encoding/Identity-H/DescendantFonts[${cid} 0 R]/ToUnicode ${tu} 0 R>>`);
  }
  put(pagesId, `<</Type/Pages/Kids[${pageIds.map(p => p + " 0 R").join(" ")}]/Count ${pageIds.length}>>`);
  put(catalog, `<</Type/Catalog/Pages ${pagesId} 0 R>>`);

  // ---- file
  const chunks: Uint8Array[] = [enc.encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")]; let pos = chunks[0].length; const xref: number[] = [0];
  for (let i = 1; i < objs.length; i++) {
    const head = enc.encode(`${i} 0 obj\n`), tail = enc.encode("\nendobj\n");
    xref.push(pos); chunks.push(head, objs[i]!, tail); pos += head.length + objs[i]!.length + tail.length;
  }
  let x = `xref\n0 ${objs.length}\n0000000000 65535 f \n`; for (let i = 1; i < objs.length; i++) x += String(xref[i]).padStart(10, "0") + " 00000 n \n";
  x += `trailer\n<</Size ${objs.length}/Root ${catalog} 0 R/Info<</Producer(Slide Builder spike)>>>>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(enc.encode(x));
  const total = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function jpegSize(d: Uint8Array): [number, number] {
  let p = 2;
  while (p < d.length) {
    if (d[p] !== 0xff) { p++; continue; }
    const m = d[p + 1], len = (d[p + 2] << 8) | d[p + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(d[p + 7] << 8) | d[p + 8], (d[p + 5] << 8) | d[p + 6]];
    p += 2 + len;
  }
  throw new Error("not a JPEG");
}
