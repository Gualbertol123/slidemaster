/* Excel and Excel Refined → display list (PLAN S3.3): the same table renderExcel draws as HTML (excel.ts), as
   display-list nodes in table px (0,0 = the table's top left, L.W × L.H; the slide places and scales it). Every
   rule of v3's markup and slide.css is followed so that the two coincide:
   - fills and borders: the `.b` boxes (border-box: a border lies inside its cell box, top / bottom across the
     whole width, left / right across the whole height), widths and dashes per Excel style;
   - text: the `.t` flex box (padding 0 3px, indent 3 + 9·indent px, 1 px at the bottom when bottom-aligned,
     line-height 1.15, justify-content = alignment, align-items = vertical alignment); white-space nowrap
     overflows past the box (to the left when right-aligned, both ways when centred) and is clipped unless the
     cell may overflow (`.ov`); wrapping cells break as CSS white-space normal + break-word; Excel's superscript
     and subscript parts are .62em, raised .55em / lowered .25em, outside the line height;
   - rotated text (rotBox / rotSpan): an inline box centred in the cell, line-height 1.1, rotated about its centre;
     255 = stacked letters;
   - shapes, text boxes (`.tbox`: padding 4px 8px, line-height 1.25, 14.67px Century Gothic stack, paragraphs of
     runs), pictures (crop, rotation, flips; the placeholder of a missing picture on screen).
   Text is measured by the page (TextMeasurer.measureRuns / breakLines, decision 2026-10-12, 3): the build runs
   first collecting what needs measuring, then again with the answers, one batch per round until nothing new is
   asked (measuredBuild).
   Where v3 is not followed, on purpose (PLAN S3.3's border widths; to be shown in G1): "hair" is a 0.5 px solid line
   (v3: CSS 1 px dotted) and dashDot / dashDotDot / slantDashDot have dash-dot patterns (v3: CSS dashed). */
import { platform, type LinesReq, type RunMetrics, type RunReq } from "../platform";
import { BW } from "../xlsx/layout";
import type { BorderSide, Item, Para, Pic, Rect, TableLayout } from "../xlsx/types";
import { fontStack } from "../model/fonts";
import { parseColor, solid } from "../dl/color";
import type { DisplayList, Matrix, Node, Paint, PathCmd, Stroke, TextNode } from "../dl/types";
import { effItems } from "./edits";
import type { RenderCtx } from "./context";
import { XLFONT } from "./excel";
import { breakRuns, collapse } from "../text/lines";

/** what text measurement the builder needs: sync lookups over the batch answered before */
export interface Metrics {
  /** `tnum`: tabular figures (font-variant-numeric), answered with each character's advance */
  run(text: string, font: string, tnum?: boolean): RunMetrics;
  lines(text: string, font: string, width: number): string[];
}
/** a table's display list and the pictures it refers to (image id → data: URL) */
export interface TableDL { nodes: DisplayList; images: Record<string, string> }

const r2 = (v: number) => Math.round(v * 100) / 100;
/** the CSS font shorthand of a text (what the page measures and the screen draws) */
export const cssFont = (size: number, family: string, b?: boolean, i?: boolean) => `${i ? "italic " : ""}${b ? "700 " : ""}${size}px ${family}`;
/** the first family of a CSS list, unquoted: the face key the PDF's font registry resolves */
export const primaryFamily = (stack: string) => (stack.split(",")[0] || "").trim().replace(/^['"]|['"]$/g, "");

function hashStr(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15); }
  return "p" + (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0") + s.length.toString(36);
}

/* ---- borders: v3's `.b` boxes. Widths per style as PLAN S3.3 lists them (hair 0.5, thin 1, medium 2, thick 3);
   the medium and dashed styles keep v3's widths (layout.ts BW) */
export const BORDER_W: Record<string, number> = { ...BW, hair: .5 };
/** the dash pattern of a style for a border of width w (null = solid; "double" is drawn as two lines) */
export function borderDash(style: string, w: number): number[] | null {
  switch (style) {
    case "dotted": return [w, w];
    case "dashed": case "mediumDashed": return [3 * w, 3 * w];
    case "dashDot": case "mediumDashDot": case "slantDashDot": return [3 * w, w, w, w];
    case "dashDotDot": case "mediumDashDotDot": return [3 * w, w, w, w, w, w];
    default: return null;
  }
}
/** one side's border inside the box (x, y, w, h): lines along the side's middle; double = two lines of w/3 */
function borderNodes(side: "top" | "bottom" | "left" | "right", b: BorderSide, x: number, y: number, w: number, h: number): Node[] {
  const bw = BORDER_W[b.style] ?? 1, { c, a } = parseColor(b.color);
  if (a === 0) return [];
  const paint: Paint = a < 1 ? { solid: c, a } : { solid: c };
  const horiz = side === "top" || side === "bottom";
  const line = (off: number, width: number, dash: number[] | null): Node => {
    const stroke: Stroke = dash ? { w: width, paint, dash } : { w: width, paint };
    if (horiz) { const yy = side === "top" ? y + off : y + h - off; return { t: "line", x1: x, y1: yy, x2: x + w, y2: yy, stroke }; }
    const xx = side === "left" ? x + off : x + w - off;
    return { t: "line", x1: xx, y1: y, x2: xx, y2: y + h, stroke };
  };
  if (b.style === "double") { const t = bw / 3; return [line(t / 2, t, null), line(bw - t / 2, t, null)]; }
  return [line(bw / 2, bw, borderDash(b.style, bw))];
}

/** the space above a line's text inside its line box, as Chromium lays it out: half of (line height − the font's
    ascent + descent), floored to a whole pixel (measured against the page: 0.42 px off otherwise, tools/dlparity.mjs) */
export const halfLeading = (lh: number, met: RunMetrics) => Math.floor((lh - (met.asc + met.desc)) / 2);

/* ---- text: runs with Excel's superscript / subscript parts */
/** a cell's text as runs: the plain parts and its <sup> / <sub> parts (cellHtml) */
export interface Run { text: string; size: number; dy: number }
export function runsOf(it: Item, size: number): Run[] {
  const t = String(it.text ?? "");
  if (!it.scripts?.length || it.edited) return trimRuns([{ text: t, size, dy: 0 }]);
  const out: Run[] = []; let at = 0;
  for (const [a, b, k] of [...it.scripts].sort((x, y) => x[0] - y[0])) {
    if (a < at || b > t.length) continue;
    if (a > at) out.push({ text: t.slice(at, a), size, dy: 0 });
    const small = r2(size * .62);                     // top: -.55em / .25em of the sup / sub element's own size
    out.push({ text: t.slice(a, b), size: small, dy: k === "sup" ? -.55 * small : .25 * small });
    at = b;
  }
  if (at < t.length) out.push({ text: t.slice(at), size, dy: 0 });
  return trimRuns(out);
}
/** white-space: nowrap / normal: spaces collapse, and the line's leading and trailing spaces go */
function trimRuns(runs: Run[]): Run[] {
  const out = runs.map(r => ({ ...r, text: collapse(r.text) }));
  if (out.length) { out[0].text = out[0].text.replace(/^ /, ""); out[out.length - 1].text = out[out.length - 1].text.replace(/ $/, ""); }
  return out.filter(r => r.text);
}

export function excelToDisplayList(L: TableLayout, ctx: RenderCtx, m: Metrics, opts: { noText?: boolean } = {}): TableDL {
  const items = effItems(L, ctx), rr = Math.round(8 * ctx.style.radius / 100);
  const nodes: DisplayList = [], images: Record<string, string> = {};
  // fills and borders, in item order (later cells paint over earlier ones, as the divs do)
  for (const it of items) {
    if (it.fill) { const p = solid(it.fill); if (!("solid" in p && p.a === 0)) nodes.push({ t: "rect", x: it.bx, y: it.by, w: it.bw, h: it.bh, fill: p }); }
    for (const side of ["top", "left", "right", "bottom"] as const) { const b = it[side]; if (b) nodes.push(...borderNodes(side, b, it.bx, it.by, it.bw, it.bh)); }
  }
  if (!opts.noText) for (const it of items) if (it.text) nodes.push(...cellText(it, ctx, m));
  for (const r of L.rects) nodes.push(...shapeNodes(r, rr));
  for (const tb of L.texts as Rect[]) nodes.push(...textBoxNodes(tb, rr, m));
  for (const p of L.pics) nodes.push(...picNodes(p, !!ctx.forExport, images, m));
  return { nodes, images };
}

/** the family list of a cell's text, as renderExcel writes it */
function cellFamily(it: Item, ctx: RenderCtx): string {
  const user = it.userFont || ctx.style.text?.table?.font;
  return user ? fontStack(user, XLFONT) : `'${(it.font.name || "").replace(/['"]/g, "")}',${XLFONT}`;
}
const text = (src: string, x: number, y: number, size: number, family: string, run: RunMetrics, color: Paint, b?: boolean, i?: boolean, deco?: TextNode["decoration"]): TextNode => ({
  t: "text", font: primaryFamily(family) || "Arial", css: family, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}), size, x: r2(x), y: r2(y), src, w: run.w, fill: color, ...(deco ? { decoration: deco } : {}),
});

function cellText(it: Item, ctx: RenderCtx, m: Metrics): Node[] {
  const f = it.font, size = +((f.sz || 11) * 96 / 72).toFixed(2), family = cellFamily(it, ctx), b = !!f.b, i = !!f.i;
  const font = cssFont(size, family, b, i), color = solid(it.color || "#000");
  const deco = f.u || f.s ? { ...(f.u ? { underline: true } : {}), ...(f.s ? { strike: true } : {}) } : undefined;
  const x = it.bx, y = it.by, w = it.tw || it.bw, h = it.bh;
  const out: Node[] = [{ t: "hit", kind: "t", id: `${it.b.r},${it.b.c}`, x, y, w, h, label: collapse(String(it.text)).trim() }];
  const ind = it.indent ? 3 + it.indent * 9 : 3;
  const pl = it.indent && it.align !== "right" ? ind : 3, pr = it.indent && it.align === "right" ? ind : 3;
  const pb = it.valign === "bottom" || !it.valign ? 1 : 0;
  if (it.rot) return [...out, ...rotatedText(it, size, family, font, color, b, i, m, { pl, pr, pb }, deco)];
  const cx = x + pl, cw = Math.max(0, w - pl - pr), ch = Math.max(0, h - pb), lh = 1.15 * size;
  const base = m.run("", font), lead = halfLeading(lh, base);
  const nodes: Node[] = [];
  let lines: { runs: Run[]; w: number[] }[];
  const runs = runsOf(it, size);
  const runW = (r: Run) => m.run(r.text, cssFont(r.size, family, b, i)).w;
  if (it.wrap) {
    // white-space: normal + break-word over the runs: a superscript stays small and raised on whichever line it lands
    lines = breakRuns(runs, cw, (t, r) => m.run(t, cssFont(r.size, family, b, i)).w)
      .map(ps => { const rs = ps.map(p => ({ ...p.run, text: p.text })); return { runs: rs, w: rs.map(runW) }; });
  } else lines = [{ runs, w: runs.map(runW) }];
  const widths = lines.map(l => l.w.reduce((s, v) => s + v, 0));
  // a cell with sup / sub is one <span> (display: block; max-width: 100%, none in an .ov cell): when it overflows a
  // cell that clips, the span is the content box and the text runs on to its right whatever the alignment (cellHtml)
  const spanned = !!it.scripts?.length && !it.edited && !it.ov;
  const multi = lines.length > 1, itemW = multi ? cw : spanned ? Math.min(widths[0], cw) : widths[0], itemH = lines.length * lh;
  // the flex item: justify-content places it horizontally (overflowing to the start when flex-end), align-items vertically
  const ix = it.align === "right" ? cx + cw - itemW : it.align === "center" ? cx + (cw - itemW) / 2 : cx;
  const iy = it.valign === "top" ? y : it.valign === "center" ? y + (ch - itemH) / 2 : y + ch - itemH;
  lines.forEach((ln, k) => {
    // text-align inside the item (wrapped lines)
    const lx = ix + (multi ? (it.align === "right" ? itemW - widths[k] : it.align === "center" ? (itemW - widths[k]) / 2 : 0) : 0);
    const by = iy + k * lh + lead + base.asc;
    let xx = lx;
    ln.runs.forEach((r, j) => {
      const rf = cssFont(r.size, family, b, i), met = m.run(r.text, rf);
      nodes.push(text(r.text, xx, by + r.dy, r.size, family, met, color, b, i, deco));
      xx += ln.w[j];
    });
  });
  // overflow: hidden clips at the cell's text box, unless the text may run into empty neighbours
  if (it.ov) out.push(...nodes); else out.push({ t: "group", clip: { x, y, w, h }, children: nodes });
  return out;
}

/** Excel text rotation: 1–90 counter-clockwise, 91–180 clockwise (an inline box centred in the cell, line-height
    1.1, rotated about its centre); 255 = letters stacked from the top, centred (without underline / strike: in
    vertical writing those run along the column; not drawn yet) */
function rotatedText(it: Item, size: number, family: string, font: string, color: Paint, b: boolean, i: boolean, m: Metrics, pad: { pl: number; pr: number; pb: number }, deco?: TextNode["decoration"]): Node[] {
  const x = it.bx, y = it.by, w = it.tw || it.bw, h = it.bh, lh = 1.1 * size, t = String(it.text);
  const base = m.run("", font), lead = halfLeading(lh, base);
  // the flex box centres the span in its content box (the .t padding)
  const cxm = x + pad.pl + (w - pad.pl - pad.pr) / 2, cym = y + (h - pad.pb) / 2;
  if (it.rot === 255) {
    // writing-mode vertical-rl, upright: each letter takes the font's line height (ascent + descent) down the column
    const chars = [...t], step = base.asc + base.desc, total = chars.length * step;
    return chars.map((ch, k) => {
      const met = m.run(ch, font);
      return text(ch, cxm - met.w / 2, cym - total / 2 + k * step + base.asc, size, family, met, color, b, i);
    });
  }
  const met = m.run(collapse(t).trim(), font), deg = it.rot <= 90 ? -it.rot : it.rot - 90, a = deg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // translate(centre) · rotate(deg): the run's box (met.w × lh) centred on the cell's centre
  const M: Matrix = [cos, sin, -sin, cos, cxm, cym];
  return [{ t: "group", transform: M, children: [text(collapse(t).trim(), -met.w / 2, -lh / 2 + lead + base.asc, size, family, met, color, b, i, deco)] }];
}

/* ---- shapes and text boxes */
const KAPPA = .5522847498;
function ellipse(x: number, y: number, w: number, h: number): PathCmd[] {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, kx = rx * KAPPA, ky = ry * KAPPA;
  return [["M", cx + rx, cy], ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ["Z"]];
}
/** rotation and flips about the box centre (shapeTransform) */
function boxTransform(o: { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }): Matrix | null {
  if (!o.rot && !o.flipH && !o.flipV) return null;
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = (o.rot || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), sx = o.flipH ? -1 : 1, sy = o.flipV ? -1 : 1;
  const A = cos * sx, B = sin * sx, C = -sin * sy, D = cos * sy;
  return [A, B, C, D, cx - A * cx - C * cy, cy - B * cx - D * cy];
}
const wrapT = (M: Matrix | null, nodes: Node[]): Node[] => M ? [{ t: "group", transform: M, children: nodes }] : nodes;

/** a box with a fill and a border inside it (box-sizing: border-box): the stroke runs w/2 inside the edge */
function boxNodes(x: number, y: number, w: number, h: number, fill: string | null, line: { w: number; color: string } | null, r: number, ellipseShape: boolean): Node[] {
  const out: Node[] = [];
  if (ellipseShape) {
    if (fill) out.push({ t: "path", d: ellipse(x, y, w, h), fill: solid(fill) });
    if (line && line.w > 0) out.push({ t: "path", d: ellipse(x + line.w / 2, y + line.w / 2, Math.max(0, w - line.w), Math.max(0, h - line.w)), stroke: { w: line.w, paint: solid(line.color) } });
    return out;
  }
  if (fill) out.push({ t: "rect", x, y, w, h, ...(r ? { r } : {}), fill: solid(fill) });
  if (line && line.w > 0) { const s = line.w / 2; out.push({ t: "rect", x: x + s, y: y + s, w: Math.max(0, w - line.w), h: Math.max(0, h - line.w), ...(r ? { r: Math.max(0, r - s) } : {}), stroke: { w: line.w, paint: solid(line.color) } }); }
  return out;
}
function shapeNodes(r: Rect, rr: number): Node[] {
  return wrapT(boxTransform(r), boxNodes(r.x, r.y, r.w, r.h, r.fill, r.line, r.round && !r.ellipse ? rr : 0, !!r.ellipse));
}

/** paragraphs of runs laid out as inline text: words wrap at the box width; each line's height and baseline come
    from the runs on it (line-height 1.25 per run, the box's own 14.67 px font as the strut) */
export function inlineLayout(paras: Para[], x: number, y: number, w: number, h: number, anchor: string, m: Metrics, opts: { family: string; size: number; color: string; lh: number }): Node[] {
  type R = { text: string; font: string; size: number; b: boolean; i: boolean; color: string };
  const strut = m.run("", cssFont(opts.size, opts.family));
  const box = (size: number, met: RunMetrics) => { const lh = opts.lh * size, lead = halfLeading(lh, met); return { a: lead + met.asc, d: lh - lead - met.asc }; };
  const st = box(opts.size, strut);
  const lines: { pieces: R[]; w: number; a: number; d: number; align: string }[] = [];
  for (const p of paras) {
    // a paragraph without runs is &nbsp; (one line); runs whose text is empty make no line box at all
    if (!p.runs.length) { lines.push({ pieces: [], w: 0, a: st.a, d: st.d, align: p.align }); continue; }
    const runs: R[] = p.runs.map(r => { const size = r.sz ? +(r.sz * 96 / 72).toFixed(1) : opts.size; return { text: r.text, font: cssFont(size, opts.family, r.b, r.i), size, b: r.b, i: r.i, color: r.color || opts.color }; });
    for (const ps of breakRuns(runs, w, (t, r) => m.run(t, r.font).w)) {
      if (!ps.length) continue;
      let a = st.a, d = st.d, lw = 0;
      const pieces = ps.map(pc => ({ ...pc.run, text: pc.text }));
      for (const pc of pieces) { const bx = box(pc.size, m.run("", pc.font)); a = Math.max(a, bx.a); d = Math.max(d, bx.d); lw += m.run(pc.text, pc.font).w; }
      lines.push({ pieces, w: lw, a, d, align: p.align });
    }
  }
  const total = lines.reduce((s, l) => s + l.a + l.d, 0);
  let yy = anchor === "ctr" ? y + (h - total) / 2 : anchor === "b" ? y + h - total : y;
  const out: Node[] = [];
  for (const l of lines) {
    let xx = x + (l.align === "right" ? w - l.w : l.align === "center" ? (w - l.w) / 2 : 0);
    const base = yy + l.a;
    for (const pc of l.pieces) {
      const met = m.run(pc.text, pc.font);
      if (pc.text.trim()) {
        const lead = pc.text.length - pc.text.replace(/^ +/, "").length, t = pc.text.trim(), off = lead ? m.run(pc.text.slice(0, lead), pc.font).w : 0;
        out.push(text(t, xx + off, base, pc.size, opts.family, m.run(t, pc.font), solid(pc.color), pc.b, pc.i));
      }
      xx += met.w;
    }
    yy += l.a + l.d;
  }
  return out;
}
function textBoxNodes(tb: Rect, rr: number, m: Metrics): Node[] {
  const r = tb.round ? rr : 0, lw = tb.line && tb.line.w > 0 ? tb.line.w : 0;
  // box-sizing: border-box: the text sits inside the border and the padding (4px 8px), clipped at the padding box
  const inner = inlineLayout(tb.paras || [], tb.x + lw + 8, tb.y + lw + 4, Math.max(0, tb.w - 16 - 2 * lw), Math.max(0, tb.h - 8 - 2 * lw), tb.anchorV || "t", m, { family: XLFONT, size: 14.67, color: "#000", lh: 1.25 });
  // innerText of the box: one line per paragraph (an empty one is &nbsp;), as the goldens record it
  const label = (tb.paras || []).map(p => collapse(p.runs.map(x => x.text).join("")).trim() || "\u00a0").join("\n").replace(/\s+\n/g, "\n").trim();
  const body: Node[] = [...boxNodes(tb.x, tb.y, tb.w, tb.h, tb.fill, tb.line, r, false), { t: "hit", kind: "tbox", id: tb.name || "", x: tb.x, y: tb.y, w: tb.w, h: tb.h, label },
    { t: "group", clip: { x: tb.x + lw, y: tb.y + lw, w: Math.max(0, tb.w - 2 * lw), h: Math.max(0, tb.h - 2 * lw), ...(r ? { r: Math.max(0, r - lw) } : {}) }, children: inner }];
  return wrapT(boxTransform(tb), body);
}

/* ---- pictures */
function picNodes(p: Pic, forExport: boolean, images: Record<string, string>, m: Metrics): Node[] {
  const M = boxTransform(p), hit: Node = { t: "hit", kind: "pic", id: p.name || "", x: p.x, y: p.y, w: p.w, h: p.h };
  return [...wrapT(M, [hit]), ...picBody(p, forExport, images, m, M)];       // the hit turns with the picture
}
function picBody(p: Pic, forExport: boolean, images: Record<string, string>, m: Metrics, M: Matrix | null): Node[] {
  if (p.unsupported || !p.src) {
    if (forExport) return [];
    // the placeholder of a missing picture (.pic.missing): dashed frame, its name centred
    const label = p.unsupported || "Picture", font = "600 11px 'Segoe UI',sans-serif";
    const lines = m.lines(label, font, Math.max(0, p.w - 3)), lh = 1.2 * 11, met0 = m.run("", font), lead = halfLeading(lh, met0);
    const top = p.y + (p.h - lines.length * lh) / 2;
    const txt: Node[] = lines.map((l, k) => { const met = m.run(l, font); return { t: "text", font: "Segoe UI", css: "'Segoe UI',sans-serif", weight: 600, size: 11, x: r2(p.x + (p.w - met.w) / 2), y: r2(top + k * lh + lead + met0.asc), src: l, w: met.w, fill: solid("#B42318") }; });
    return wrapT(M, [{ t: "rect", x: p.x + .75, y: p.y + .75, w: Math.max(0, p.w - 1.5), h: Math.max(0, p.h - 1.5), fill: solid("rgba(255,240,238,.7)"), stroke: { w: 1.5, paint: solid("rgba(196,43,28,.6)"), dash: [4.5, 4.5] } },
      { t: "group", clip: { x: p.x, y: p.y, w: p.w, h: p.h }, children: txt }]);
  }
  const id = hashStr(p.src);
  images[id] = p.src;
  const c = p.crop, crop = c && (c.l || c.t || c.r || c.b) ? { crop: { l: c.l, t: c.t, r: c.r, b: c.b } } : {};
  return [{ t: "image", id, x: p.x, y: p.y, w: p.w, h: p.h, ...crop, ...(p.rot ? { rotation: p.rot } : {}), ...(p.flipH ? { flipH: true } : {}), ...(p.flipV ? { flipV: true } : {}) }];
}

/* ---- measuring: the requests of a table, answered in one batch by the platform's TextMeasurer */
class Recorder implements Metrics {
  runs = new Map<string, RunReq>(); wraps = new Map<string, LinesReq>();
  run(text: string, font: string, tnum = false): RunMetrics {
    this.runs.set((tnum ? "tnum " : "") + font + "\n" + text, { text, font, ...(tnum ? { tnum } : {}) }); this.runs.set(font + "\n", { text: "", font });
    return { w: 0, asc: 0, desc: 0 };
  }
  lines(text: string, font: string, width: number): string[] { this.wraps.set(`${font}\n${width}\n${text}`, { text, font, width }); return [text]; }
}
class Answers implements Metrics {
  constructor(private runs: Map<string, RunMetrics>, private wraps: Map<string, string[]>, private fallback: Metrics) {}
  run(text: string, font: string, tnum = false) { return this.runs.get((tnum ? "tnum " : "") + font + "\n" + text) ?? this.fallback.run(text, font, tnum); }
  lines(text: string, font: string, width: number) { return this.wraps.get(`${font}\n${width}\n${text}`) ?? this.fallback.lines(text, font, width); }
}
/** measurement without a page (Node tools, tests without a measurer): a rough average advance */
export const roughMetrics: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)?.[1] || "14"); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t) => [t],
};
/** measure everything a build needs: one batch per round, rounds until nothing new is asked (the units of wrapped
    text first, then the runs of the lines they give; three or four rounds per table, however long the text) */
export async function measuredBuild<T>(build: (m: Metrics) => T): Promise<T> {
  const tm = platform().text;
  if (!tm.measureRuns || !tm.breakLines) return build(roughMetrics);
  const runs = new Map<string, RunMetrics>(), wraps = new Map<string, string[]>();
  for (let round = 0; ; round++) {
    if (round === 8) throw new Error("text measurement did not settle after 8 rounds");
    const rec = new Recorder(), probe = new Answers(runs, wraps, rec);
    build(probe);
    const needRuns = [...rec.runs].filter(([k]) => !runs.has(k)), needWraps = [...rec.wraps].filter(([k]) => !wraps.has(k));
    if (!needRuns.length && !needWraps.length) break;
    if (needWraps.length) { const ans = await tm.breakLines(needWraps.map(([, v]) => v)); needWraps.forEach(([k], i) => wraps.set(k, ans[i])); }
    if (needRuns.length) { const ans = await tm.measureRuns(needRuns.map(([, v]) => v)); needRuns.forEach(([k], i) => runs.set(k, ans[i])); }
  }
  return build(new Answers(runs, wraps, roughMetrics));
}
/** a table's display list with the page's measurements */
export const excelTableDL = (L: TableLayout, ctx: RenderCtx, opts: { noText?: boolean } = {}) => measuredBuild(m => excelToDisplayList(L, ctx, m, opts));
