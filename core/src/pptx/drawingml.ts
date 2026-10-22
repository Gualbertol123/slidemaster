/* The scene (scene.ts) → PresentationML / DrawingML markup (ECMA-376 1st edition; nothing PowerPoint 2016 cannot read:
   no p14 / p15 extensions, no SVG). Slide px → EMU: 1 px = 7 620 EMU (1600 px = 12 192 000, the 16:9 slide); font
   sizes px × 0.6 pt. Pure string building; the package (writer.ts) gives each slide its relationship ids. */
import type { Paint, PathCmd, RGB, Stop } from "../dl/types";
import type { Cell, El, Geom, Line, LineEnd, Para, Run, Shadow, ShapeEl, TableEl, TextBody } from "./scene";
import type { Head } from "../model/types";

export const EMU = 7620;
export const SLIDE = { cx: 1600 * EMU, cy: 900 * EMU };
export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
};
export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** a coordinate or length in EMU (whole numbers) */
export const E = (px: number) => Math.round(px * EMU);
/** characters XML 1.0 cannot carry (control characters but tab / newline) are dropped */
export const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = (c: RGB) => c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
/** a colour with its alpha (DrawingML percentages: 100 000 = 100 %) */
export function clr(c: RGB, a = 1): string {
  const al = Math.max(0, Math.min(1, a));
  return al < .9995 ? `<a:srgbClr val="${hex(c)}"><a:alpha val="${Math.round(al * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex(c)}"/>`;
}
const pct = (v: number) => Math.round(v * 100000);

/** what a slide's markup refers to outside itself: pictures and charts, by relationship id */
export interface Refs { image(id: string): string | null; chart(el: Extract<El, { k: "chart" }>): string; face(css: string): string }

/* ---- paints ---- */
/** a linear paint in the unit box (dl/types.ts) → DrawingML's angle and stops along the box's projection on it */
function linearFill(p: Extract<Paint, { linear: unknown }>, w: number, h: number): string {
  const [x1, y1, x2, y2] = p.linear, dx = (x2 - x1) * w, dy = (y2 - y1) * h, L = Math.hypot(dx, dy);
  const stops = p.stops;
  if (L < 1e-6) { const s = stops[stops.length - 1]; return `<a:solidFill>${clr(s.c, s.a)}</a:solidFill>`; }
  const ux = dx / L, uy = dy / L;
  // the box's corners projected on the direction: DrawingML's 0 % and 100 % (the gradient spans the whole box)
  const proj = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => x * ux + y * uy), pmin = Math.min(...proj), pmax = Math.max(...proj);
  const s1 = x1 * w * ux + y1 * h * uy, s2 = x2 * w * ux + y2 * h * uy, span = Math.max(1e-6, pmax - pmin);
  const at = (o: number) => (s1 + o * (s2 - s1) - pmin) / span;
  const gs = clampStops(stops.map(s => ({ ...s, o: at(s.o) })));
  const ang = ((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs.map(s => `<a:gs pos="${pct(s.o)}">${clr(s.c, s.a)}</a:gs>`).join("")}</a:gsLst><a:lin ang="${Math.round(ang * 60000)}" scaled="0"/></a:gradFill>`;
}
/** stops moved into 0–1 (the colour at an edge interpolated), at least two */
function clampStops(stops: Stop[]): Stop[] {
  const s = [...stops].sort((a, b) => a.o - b.o), at = (o: number): Stop => {
    if (o <= s[0].o) return { ...s[0], o }; if (o >= s[s.length - 1].o) return { ...s[s.length - 1], o };
    const k = s.findIndex(x => x.o >= o), a = s[k - 1], b = s[k], t = (o - a.o) / Math.max(1e-9, b.o - a.o);
    return { o, c: a.c.map((v, i) => v + (b.c[i] - v) * t) as RGB, a: a.a + (b.a - a.a) * t };
  };
  const inner = s.filter(x => x.o > 0 && x.o < 1);
  return [at(0), ...inner, at(1)];
}
function radialFill(p: Extract<Paint, { radial: unknown }>): string {
  const { cx, cy, rx, ry, stops } = p.radial;
  // DrawingML's circle path runs from the focus (0 %) to the box's farthest corner (100 %), in the box's own units
  const far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const r = (rx + ry) / 2, gs = clampStops(stops.map(s => ({ ...s, o: Math.min(1, s.o * r / Math.max(1e-6, far)) })));
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs.map(s => `<a:gs pos="${pct(s.o)}">${clr(s.c, s.a)}</a:gs>`).join("")}</a:gsLst><a:path path="circle"><a:fillToRect l="${pct(cx)}" t="${pct(cy)}" r="${pct(1 - cx)}" b="${pct(1 - cy)}"/></a:path></a:gradFill>`;
}
export function fill(p: Paint | null | undefined, w: number, h: number): string {
  if (!p) return "<a:noFill/>";
  if ("solid" in p) return `<a:solidFill>${clr(p.solid, p.a ?? 1)}</a:solidFill>`;
  if ("linear" in p) return linearFill(p, w, h);
  return radialFill(p);
}
const CAP = { butt: "flat", round: "rnd", square: "sq" } as const;
export function ln(l: Line | null | undefined, w: number, h: number, tag = "a:ln"): string {
  if (!l) return `<${tag}><a:noFill/></${tag}>`;
  const dash = l.dash && l.dash.length >= 2 && l.w > 0
    ? `<a:custDash>${pairs(l.dash).map(([d, s]) => `<a:ds d="${Math.max(1, Math.round(d / l.w * 100000))}" sp="${Math.max(1, Math.round(s / l.w * 100000))}"/>`).join("")}</a:custDash>` : "";
  return `<${tag} w="${Math.max(0, E(l.w))}"${l.cap ? ` cap="${CAP[l.cap]}"` : ""}>${fill(l.paint, w, h)}${dash}${l.join ? JOIN[l.join] : ""}${lineEnd("a:headEnd", l.head)}${lineEnd("a:tailEnd", l.tail)}</${tag}>`;
}
/* joins and native line ends (S14.P; ADR-004 amendment, 09 §4.3): a:ln's children in the schema's order – fill, dash,
   join, headEnd, tailEnd. Miter limit 10 (1 000 000 = 1000 %), as the display list's other backends */
const JOIN = { round: "<a:round/>", bevel: "<a:bevel/>", miter: '<a:miter lim="1000000"/>' } as const;
const END_SIZE = { s: "sm", m: "med", l: "lg" } as const;
/** a:headEnd sits on the path's first point, a:tailEnd on its last (a line item's end a / end b) */
export function lineEnd(tag: "a:headEnd" | "a:tailEnd", e: LineEnd | undefined): string {
  if (!e) return "";
  const z = END_SIZE[e.size || "m"];
  return `<${tag} type="${e.type}" w="${z}" len="${z}"/>`;
}
/** a line item's head (model Heads, 09 §2.3) as a native end; "bar" (the limiter) and "none" have none – the limiter's tick
    is a segment of the line's own geometry */
export function headEnd(h: Head | undefined, size?: "s" | "m" | "l"): LineEnd | undefined {
  return h && h !== "none" && h !== "bar" ? { type: h, ...(size ? { size } : {}) } : undefined;
}
const pairs = (d: number[]) => { const a = d.length % 2 ? [...d, ...d] : d, out: [number, number][] = []; for (let i = 0; i < a.length; i += 2) out.push([a[i], a[i + 1]]); return out; };
function shadow(tag: "a:outerShdw" | "a:innerShdw", s: Shadow): string {
  const dist = Math.hypot(s.dx, s.dy), dir = ((Math.atan2(s.dy, s.dx) * 180 / Math.PI) % 360 + 360) % 360;
  const scale = tag === "a:outerShdw" ? `${s.sx ? ` sx="${pct(s.sx)}"` : ""}${s.sy ? ` sy="${pct(s.sy)}"` : ""} algn="ctr" rotWithShape="0"` : "";
  return `<${tag} blurRad="${E(s.blur)}" dist="${E(dist)}" dir="${Math.round(dir * 60000)}"${scale}>${clr(s.c, s.a)}</${tag}>`;
}
/** the effect list: inner before outer (the schema's order) */
export function effects(outer?: Shadow, inner?: Shadow): string {
  if (!outer && !inner) return "";
  return `<a:effectLst>${inner ? shadow("a:innerShdw", inner) : ""}${outer ? shadow("a:outerShdw", outer) : ""}</a:effectLst>`;
}

/* ---- geometry ---- */
function geom(g: Geom, w: number, h: number): string {
  if ("parts" in g && g.parts?.length) return partsGeom(g, w, h);
  if ("prst" in g) return `<a:prstGeom prst="${g.prst}"><a:avLst>${Object.entries(g.adj || {}).map(([n, v]) => `<a:gd name="${n}" fmla="val ${Math.round(v)}"/>`).join("")}</a:avLst></a:prstGeom>`;
  const W = Math.max(1, E(w)), H = Math.max(1, E(h));
  const pt = (x: number, y: number) => `<a:pt x="${E(x)}" y="${E(y)}"/>`;
  const body = g.path.map((c: PathCmd) => c[0] === "M" ? `<a:moveTo>${pt(c[1], c[2])}</a:moveTo>` : c[0] === "L" ? `<a:lnTo>${pt(c[1], c[2])}</a:lnTo>`
    : c[0] === "C" ? `<a:cubicBezTo>${pt(c[1], c[2])}${pt(c[3], c[4])}${pt(c[5], c[6])}</a:cubicBezTo>` : "<a:close/>").join("");
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${W}" h="${H}"${g.open ? ' fill="none"' : ""}>${body}</a:path></a:pathLst></a:custGeom>`;
}
const xfrm = (b: { x: number; y: number; w: number; h: number }, o: { rot?: number; flipH?: boolean; flipV?: boolean } = {}, tag = "a:xfrm") =>
  `<${tag}${o.rot ? ` rot="${Math.round(o.rot * 60000)}"` : ""}${o.flipH ? ' flipH="1"' : ""}${o.flipV ? ' flipV="1"' : ""}><a:off x="${E(b.x)}" y="${E(b.y)}"/><a:ext cx="${Math.max(0, E(b.w))}" cy="${Math.max(0, E(b.h))}"/></${tag}>`;

/* ---- text ---- */
/** slide px → hundredths of a point: 1 px = 7 620 EMU = 0.6 pt (1600 px across the 960 pt of a 16:9 slide) */
export const PT = .6;
const sz = (px: number) => Math.max(100, Math.min(400000, Math.round(px * PT * 100)));
function runXml(r: Run, refs: Refs): string {
  const face = esc(refs.face(r.css));
  const attrs = `lang="en-GB" sz="${sz(r.size)}" b="${r.b ? 1 : 0}" i="${r.i ? 1 : 0}"${r.u ? ' u="sng"' : ""}${r.s ? ' strike="sngStrike"' : ""}${r.ls ? ` spc="${Math.round(r.ls * PT * 100)}"` : ""}${r.baseline ? ` baseline="${r.baseline * 1000}"` : ""} dirty="0"`;
  const fx = r.shadow ? `<a:effectLst>${shadow("a:outerShdw", r.shadow)}</a:effectLst>` : "";
  return `<a:r><a:rPr ${attrs}><a:solidFill>${clr(r.color, r.a)}</a:solidFill>${fx}<a:latin typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
}
function paraXml(p: Para, refs: Refs): string {
  const sp = `<a:lnSpc><a:spcPts val="${Math.max(0, Math.round(p.pitch * PT * 100))}"/></a:lnSpc>${p.before > .5 ? `<a:spcBef><a:spcPts val="${Math.round(p.before * PT * 100)}"/></a:spcBef>` : ""}`;
  const last = p.runs[p.runs.length - 1];
  const end = last ? `<a:endParaRPr lang="en-GB" sz="${sz(last.size)}" dirty="0"/>` : "";
  return `<a:p><a:pPr algn="${p.align}" marL="${p.bu ? E(p.marL ?? 0) : 0}" indent="${p.bu ? E(p.indent ?? 0) : 0}">${sp}${p.bu ? buXml(p.bu) : "<a:buNone/>"}</a:pPr>${p.runs.map(r => runXml(r, refs)).join("")}${end}</a:p>`;
}
/** a paragraph's own bullet (B48 review, 2): a square character in its colour – filled for the first level, outlined for
    the second – sized as the display list's square (half an em: Arial's squares are 0.457 em, so 110 %). PowerPoint
    does not turn a bullet: the template's 10° tilt stays in the PDF and PNG (an accepted difference, RENDERING.md) */
export const BULLET_CHAR = { 1: "\u25A0", 2: "\u25A1" } as const;
function buXml(b: NonNullable<Para["bu"]>): string {
  return `<a:buClr>${clr(b.c, b.a)}</a:buClr><a:buSzPct val="110000"/><a:buFont typeface="Arial"/><a:buChar char="${BULLET_CHAR[b.level]}"/>`;
}
export function bodyPr(t: TextBody, extra = ""): string {
  const [l, tp, r, b] = t.ins.map(E);
  return `<a:bodyPr wrap="${t.wrap ? "square" : "none"}" lIns="${l}" tIns="${tp}" rIns="${r}" bIns="${b}" anchor="${t.anchor}" rtlCol="0"${extra}><a:noAutofit/></a:bodyPr>`;
}
export function txBody(t: TextBody | undefined, refs: Refs, tag = "p:txBody"): string {
  if (!t || !t.paras.length) return `<${tag}>${bodyPr(t || { paras: [], anchor: "t", ins: [0, 0, 0, 0], wrap: true })}<a:lstStyle/><a:p><a:endParaRPr lang="en-GB" dirty="0"/></a:p></${tag}>`;
  return `<${tag}>${bodyPr(t)}<a:lstStyle/>${t.paras.map(p => paraXml(p, refs)).join("")}</${tag}>`;
}

/* ---- elements ---- */
const PH_ATTR: Record<string, string> = { title: 'type="title"', ctrTitle: 'type="ctrTitle"', subTitle: 'type="subTitle" idx="1"', body: 'type="body" idx="1"', ftr: 'type="ftr" sz="quarter" idx="11"', sldNum: 'type="sldNum" sz="quarter" idx="12"' };
export class Ids { private n = 1; next() { return ++this.n; } }

function sp(el: ShapeEl, ids: Ids, refs: Refs): string {
  const id = ids.next(), name = esc(el.name || "Shape") + " " + id, isText = !!el.text && !el.fill && !el.line;
  const nv = `<p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr${isText && !el.ph ? ' txBox="1"' : ""}>${el.ph ? '<a:spLocks noGrp="1"/>' : ""}</p:cNvSpPr><p:nvPr>${el.ph ? `<p:ph ${PH_ATTR[el.ph]}/>` : ""}</p:nvPr></p:nvSpPr>`;
  const { w, h } = el.box;
  const spPr = `<p:spPr>${xfrm(el.box, el)}${geom(el.geom, w, h)}${fill(el.fill, w, h)}${el.line !== undefined ? ln(el.line, w, h) : ""}${effects(el.outer, el.inner)}</p:spPr>`;
  return `<p:sp>${nv}${spPr}${el.text || el.ph ? txBody(el.text, refs) : ""}</p:sp>`;
}
function pic(el: Extract<El, { k: "pic" }>, ids: Ids, refs: Refs): string {
  const rid = refs.image(el.image);
  if (!rid) return "";
  const id = ids.next(), c = el.crop;
  const src = c ? `<a:srcRect l="${pct(c.l)}" t="${pct(c.t)}" r="${pct(c.r)}" b="${pct(c.b)}"/>` : "";
  const blip = `<a:blip r:embed="${rid}">${el.alpha !== undefined && el.alpha < 1 ? `<a:alphaModFix amt="${pct(el.alpha)}"/>` : ""}</a:blip>`;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(el.name || "Picture")} ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill>${blip}${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el.box, el)}${geom(el.geom || { prst: "rect" }, el.box.w, el.box.h)}${effects(el.outer)}</p:spPr></p:pic>`;
}
/** an empty cell's text: a 1 pt paragraph (PowerPoint's 18 pt default would make its row at least 30 px high) */
const EMPTY_CELL = '<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPts val="100"/></a:lnSpc><a:buNone/></a:pPr><a:endParaRPr lang="en-GB" sz="100" dirty="0"/></a:p></a:txBody>';
function cellXml(c: Cell, refs: Refs): string {
  const attrs = `${c.span && c.span[1] > 1 ? ` gridSpan="${c.span[1]}"` : ""}${c.span && c.span[0] > 1 ? ` rowSpan="${c.span[0]}"` : ""}`;
  const [l, t, r, b] = (c.mar || [0, 0, 0, 0]).map(E);
  const side = (tag: string, x: Line | null | undefined) => ln(x ?? null, 1, 1, tag);
  const tcPr = `<a:tcPr marL="${l}" marR="${r}" marT="${t}" marB="${b}" anchor="${c.anchor || "ctr"}">${side("a:lnL", c.l)}${side("a:lnR", c.r)}${side("a:lnT", c.t)}${side("a:lnB", c.b)}${fill(c.fill ?? null, 1, 1)}</a:tcPr>`;
  const body = c.text?.paras.length ? `<a:txBody><a:bodyPr/><a:lstStyle/>${c.text.paras.map(p => paraXml(p, refs)).join("")}</a:txBody>` : EMPTY_CELL;
  return `<a:tc${attrs}>${body}${tcPr}</a:tc>`;
}
/** a covered cell of a merged one: hMerge / vMerge as the cell that covers it spans */
function mergedXml(cells: Cell[][], r: number, c: number): string {
  // find the cell that covers (r, c)
  let h = false, v = false;
  for (let rr = r; rr >= 0 && !h && !v; rr--) for (let cc = c; cc >= 0; cc--) {
    const s = cells[rr][cc].span;
    if (!cells[rr][cc].merged && s && rr + s[0] > r && cc + s[1] > c) { h = cc < c; v = rr < r; break; }
  }
  return `<a:tc${h ? ' hMerge="1"' : ""}${v ? ' vMerge="1"' : ""}>${EMPTY_CELL}<a:tcPr/></a:tc>`;
}
/** "No Style, No Grid": the built-in table style that draws nothing of its own */
export const NO_STYLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}";
function tbl(el: TableEl, ids: Ids, refs: Refs): string {
  const id = ids.next();
  // PowerPoint keeps the grid's total equal to the frame: the last column takes the rounding
  const cols = el.cols.map(E), rows = el.rows.map(E);
  const grid = cols.map(w => `<a:gridCol w="${Math.max(1, w)}"/>`).join("");
  const trs = el.cells.map((row, r) => `<a:tr h="${Math.max(1, rows[r])}">${row.map((c, k) => c.merged ? mergedXml(el.cells, r, k) : cellXml(c, refs)).join("")}</a:tr>`).join("");
  const W = cols.reduce((s, v) => s + Math.max(1, v), 0), H = rows.reduce((s, v) => s + Math.max(1, v), 0);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(el.name || "Table")} ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${E(el.box.x)}" y="${E(el.box.y)}"/><a:ext cx="${W}" cy="${H}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="0" bandRow="0"><a:tableStyleId>${NO_STYLE}</a:tableStyleId></a:tblPr><a:tblGrid>${grid}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}
function chartFrame(el: Extract<El, { k: "chart" }>, ids: Ids, refs: Refs): string {
  const id = ids.next(), rid = refs.chart(el);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(el.name || "Chart")} ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(el.box, {}, "p:xfrm")}`
    + `<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}
/** the box around elements (a group's frame) */
export function bounds(els: El[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (b: { x: number; y: number; w: number; h: number }) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
  for (const e of els) { if (e.k === "grp") { const b = bounds(e.children); if (b.w >= 0) add(b); } else if (e.k === "tbl") add({ ...e.box, w: e.cols.reduce((s, v) => s + v, 0), h: e.rows.reduce((s, v) => s + v, 0) }); else add(e.box); }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function grp(el: Extract<El, { k: "grp" }>, ids: Ids, refs: Refs): string {
  const kids = el.children.filter(e => e.k !== "grp" || e.children.length);
  if (!kids.length) return "";
  if (kids.length === 1) return elXml(kids[0], ids, refs);
  const id = ids.next(), b = bounds(kids);
  const x = `<a:xfrm><a:off x="${E(b.x)}" y="${E(b.y)}"/><a:ext cx="${E(b.w)}" cy="${E(b.h)}"/><a:chOff x="${E(b.x)}" y="${E(b.y)}"/><a:chExt cx="${E(b.w)}" cy="${E(b.h)}"/></a:xfrm>`;
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${esc(el.name || "Group")} ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${x}</p:grpSpPr>${kids.map(k => elXml(k, ids, refs)).join("")}</p:grpSp>`;
}
export function elXml(el: El, ids: Ids, refs: Refs): string {
  switch (el.k) {
    case "sp": return sp(el, ids, refs);
    case "pic": return pic(el, ids, refs);
    case "tbl": return tbl(el, ids, refs);
    case "chart": return chartFrame(el, ids, refs);
    case "grp": return grp(el, ids, refs);
  }
}
/** a shape tree's opening (its own group, id 1) and its elements */
export function spTree(els: El[], refs: Refs, ids = new Ids()): string {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${els.map(e => elXml(e, ids, refs)).join("")}</p:spTree>`;
}

/* ---- M15 (S15.2; 09 §4.3): appended, the lines above stay S14.P's (M14-M15-split §2) ---- */
/** an icon's custom geometry: its parts, one a:path each, filled or not (fill="none"), stroked or not (stroke="0") – an
    outline icon's open strokes beside its filled dots in one shape. geom() hands a geometry with `parts` here */
function partsGeom(g: Extract<Geom, { path: PathCmd[] }>, w: number, h: number): string {
  const W = Math.max(1, E(w)), H = Math.max(1, E(h));
  const pt = (x: number, y: number) => `<a:pt x="${E(x)}" y="${E(y)}"/>`;
  const body = (d: PathCmd[]) => d.map((c: PathCmd) => c[0] === "M" ? `<a:moveTo>${pt(c[1], c[2])}</a:moveTo>` : c[0] === "L" ? `<a:lnTo>${pt(c[1], c[2])}</a:lnTo>`
    : c[0] === "C" ? `<a:cubicBezTo>${pt(c[1], c[2])}${pt(c[3], c[4])}${pt(c[5], c[6])}</a:cubicBezTo>` : "<a:close/>").join("");
  const paths = (g.parts || []).map(p => `<a:path w="${W}" h="${H}"${p.fill ? "" : ' fill="none"'}${p.stroke ? "" : ' stroke="0"'}>${body(p.d)}</a:path>`).join("");
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`;
}
