/* A whole slide → display list (PLAN S3.5): the background, the slide furniture – title, subtitle, cover, contents,
   page number, footer, logo –, the tables (their display lists, excel-dl.ts / glass-dl.ts, placed and scaled where
   computeLayout puts them), the text boxes and the notes section, as slideMarkup + slide.css draw them. Text is
   measured by the page (Metrics, decision 2026-10-12, 3), text boxes are fitted by the page (fitNotes, the same
   fitNoteSize the screen uses). Every element the page has a box for gets a hit node: kind "f", id = its classes,
   the label its text as a reader has it (innerText, whitespace normalised as the parity tools do).
   Painting order is the page's: the elements without z-index in tree order, then the z-index 3 ones (the cover's
   text block, the contents rows and separators of Liquid Glass), then the page numbers (z-index 5).
   Coordinates are slide px (1600 × 900). */
import { parseColor, solid } from "../dl/color";
import type { Node, Paint, TextNode } from "../dl/types";
import { fontStack } from "../model/fonts";
import type { RuntimeSlide, TextFmt } from "../model/types";
import type { RenderCtx } from "./context";
import { cssLinear, glassBox, glassVars, type Wallpaper } from "./glass-dl";
import { halfLeading, lu, primaryFamily, type Metrics, type TableDL } from "./excel-dl";
import { pageNoFor, pageNoGeom, footerGeom, pageNumber, pnFmt } from "./pagenumbers";
import { contrastVars, memoPart, noteParts, slideHasLogo, tableW, themeVars, type NotePart, type TBox } from "./slide";
import { deckFmt, hasMarkup, slideTextFmt, titleGeom } from "./text";
import { todayLabel } from "./cover";
import { breakRuns, collapse } from "../text/lines";

export const SLIDE_FONT = { glass: `-apple-system,"SF Pro Display","Segoe UI Variable Display","Segoe UI","Helvetica Neue",Inter,Arial,sans-serif`, excel: `"Century Gothic","CenturyGothic","URW Gothic","AppleGothic",Arial,sans-serif` };
const GLASS_ROW_FONT = `-apple-system,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Arial,sans-serif`;
const NOTE_FONT = { excel: `'Century Gothic','URW Gothic',Arial,sans-serif`, clean: `'Segoe UI Variable Text','Segoe UI',Calibri,Arial,sans-serif` };

/** what the slide needs besides its tables: the wallpaper (Liquid Glass) and the logo's picture with its size */
export interface SlideImages {
  wall: { sharp: { id: string; src: string }; blur: Wallpaper; base: string } | null;
  logo: { id: string; src: string; w: number; h: number } | null;
}

/* ---- text ---- */
/** the line height the slide's texts inherit where slide.css sets none: the page's body is font: 13px/1.4 (ui.css) */
const INHERITED = 1.4;
interface TStyle { family: string; size: number; weight: number; italic: boolean; color: Paint; ls: number; tnum?: boolean }
const fontOf = (s: TStyle) => `${s.italic ? "italic " : ""}${s.weight} ${s.size}px ${s.family}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** a text format (deck style, then the text's own) over a base style */
function withFmt(base: TStyle, f: TextFmt, opts: { size?: boolean } = {}): TStyle {
  return { ...base, ...(f.font ? { family: fontStack(f.font) } : {}), ...(opts.size !== false && f.size ? { size: +f.size } : {}),
    ...(f.b !== undefined ? { weight: f.b ? 700 : 400 } : {}), ...(f.i !== undefined ? { italic: !!f.i } : {}), ...(f.color ? { color: solid(f.color) } : {}) };
}
/** the reader's text of an element (innerText, as the parity tools normalise it) */
const label = (t: string) => t.replace(/\s+\n/g, "\n").trim();

class Typesetter {
  constructor(private m: Metrics) {}
  run(text: string, st: TStyle) { return this.m.run(text, fontOf(st), st.tnum); }
  /** a text's advance with its letter-spacing (after every character, as CSS) */
  adv(text: string, st: TStyle) { return this.run(text, st).w + [...text].length * st.ls; }
  strut(st: TStyle) { return this.m.run("", fontOf(st)); }
  /** a line's height: a factor of the size (INHERITED where the slide's CSS sets none) */
  lineH(st: TStyle, lh: number) { return lu(lh * st.size); }
  /** the baseline in a line box of height lineH that starts at top (CSS half-leading, floored as Chromium does) */
  baseline(st: TStyle, top: number, lineH: number) { const s = this.strut(st); return top + halfLeading(lineH, s) + s.asc; }
  node(text: string, x: number, y: number, st: TStyle, extra: Partial<TextNode> = {}): TextNode {
    const run = this.run(text, st), n = [...text].length;
    const tab = st.tnum && run.adv && run.adv.length === n ? { tnum: true, adv: run.adv.map(a => a + st.ls) } : st.tnum ? { tnum: true } : {};
    return { t: "text", font: primaryFamily(st.family) || "Arial", css: st.family, weight: st.weight, ...(st.italic ? { i: true } : {}), size: st.size, x: r2(x), y: r2(y), src: text,
      w: Math.max(0, run.w + (n - 1) * st.ls), fill: st.color, ...tab, ...extra };
  }
  /** a one-line text cut with an ellipsis to fit maxW (text-overflow: ellipsis); every prefix is measured in the same
      round, so the cut settles at once */
  ellipsis(text: string, st: TStyle, maxW: number): string {
    if (this.adv(text, st) <= maxW + .01) return text;
    const chars = [...text], ws = chars.map((_, k) => this.adv(chars.slice(0, k + 1).join(""), st)), ew = this.adv("…", st);
    let k = chars.length;
    while (k > 0 && ws[k - 1] + ew > maxW + .01) k--;
    return chars.slice(0, k).join("") + "…";
  }
  /** lines of styled runs at a width (white-space normal, or pre-wrap) */
  lines(runs: { text: string; st: TStyle }[], width: number, pre = false) {
    return breakRuns(runs, width, (t, r) => this.adv(t, r.st), { pre }).map(ps => ps.map(p => ({ text: p.text, st: p.run.st })));
  }
}

/* ---- the slide ---- */
/** `today`: the date the page shows ({date} in footers, a cover without its own date) – the page's clock */
export function slideToDisplayList(R: RuntimeSlide, idx: number, ctx: RenderCtx, tables: TableDL[], boxes: TBox[], img: SlideImages, m: Metrics, today = todayLabel()): TableDL {
  const T = new Typesetter(m), d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const V = glassVars(ctx), tv = themeVars(ctx), place = { x: 0, y: 0, scale: 1 }, wall = img.wall?.blur ?? null;
  const base = glassy ? SLIDE_FONT.glass : SLIDE_FONT.excel;
  const x1 = tv["--x1"] || "#1C4F8C";
  const images: Record<string, string> = {};
  const low: Node[] = [], z3: Node[] = [], z5: Node[] = [];
  const hit = (cls: string, x: number, y: number, w: number, h: number, text?: string): Node => ({ t: "hit", kind: "f", id: cls, x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...(text !== undefined ? { label: text } : {}) });
  const chrome = (cls: string, x: number, y: number, w: number, h: number, r: number, content: Node[] = [], text?: string) =>
    glassBox(cls.replace(/^gls wb /, ""), x, y, w, h, r, V, place, wall, { content, hit: { kind: "f", id: cls, ...(text !== undefined ? { label: text } : {}) } });

  // the background: Liquid Glass's wallpaper (with the contrast veil), the Excel designs' slide colour
  if (glassy) {
    low.push({ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: solid(img.wall?.base || "#E9EDF6") });
    if (img.wall) { images[img.wall.sharp.id] = img.wall.sharp.src; low.push({ t: "image", id: img.wall.sharp.id, x: 0, y: 0, w: 1600, h: 900 }); }
    const wf = +(contrastVars(ctx.style.contrast)["--wfade"] || 0);
    if (wf > 0) low.push({ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: { solid: [255, 255, 255], a: Math.min(1, wf) } });
    if (img.wall) images[img.wall.blur.blurId] = img.wall.blur.blurSrc;
  } else low.push({ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: solid(tv["--slidebg"] || "#FFFFFF") });

  const pageNo = pageNoFor(ctx, idx), logo = slideHasLogo(R) ? img.logo : null, cover = R.type === "cover";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo !== null && ctx.style.pn.pos === "tl" ? pageNoGeom(ctx, pageNo, glassy, !!logo, cover).w + 22 : 0;
  if (cover) coverNodes();
  else {
    oneLine("title", slideTextFmt(ctx, R, "title"), R.title, glassy ? 58 : 54, glassy ? 20 : 16, glassy ? 170 : 150,
      { family: base, size: glassy ? 48 : 44, weight: 700, italic: false, color: glassy ? solid("#0B0D17") : solid(x1), ls: glassy ? -1 : 0 }, glassy);
    if (R.subtitle) oneLine("subtitle", slideTextFmt(ctx, R, "subtitle"), R.subtitle, glassy ? 60 : 56, titleGeom(R, ctx).subTop, glassy ? 170 : 150,
      { family: base, size: glassy ? 19 : 18, weight: glassy ? 520 : 400, italic: false, color: glassy ? { solid: [18, 22, 44], a: .62 } : solid("#5B6B82"), ls: 0 }, false);
  }
  if (R.type === "index") indexNodes();
  if (pageNo !== null) pageNoNodes(pageNo, false);
  const fg = footerGeom(ctx, idx, glassy, !!logo, cover, pageNo, today);
  if (fg) pageNoNodes(fg.label, true);
  // the tables where the slide puts them, each followed by its text boxes
  R.tables.forEach((L, i) => {
    const b = boxes[i], dl = tables[i];
    if (b && dl) {
      Object.assign(images, dl.images);
      low.push(hit("tw", b.x, b.y, tableW(L, ctx) * b.scale, L.H * b.scale), { t: "group", transform: [b.scale, 0, 0, b.scale, b.x, b.y], children: dl.nodes });
    }
    for (const part of noteParts(R, i, ctx)) { const nb = b?.notes[part.side]; if (nb) noteNodes(part, nb); }
  });
  const memo = memoPart(R, ctx);
  if (memo) noteNodes(memo, memo.box);
  if (logo) logoNodes(logo);
  return { nodes: [...low, ...z3, ...z5], images };

  /* a nowrap line with an ellipsis in a box from left to 1600 − right (titles), the inherited line height unless set */
  function oneLine(cls: string, f: TextFmt, text: string, left: number, top: number, right: number, st0: TStyle, shadow: boolean) {
    // a page number in the top-left corner: both texts start at 56 + its width + 22 (slideMarkup's inline left)
    const st = withFmt(st0, f), x = shift ? 56 + shift : left, w = 1600 - right - x, lh = T.lineH(st, f.lh ? +f.lh : INHERITED);
    const plain = collapse(text).trim(), shown = T.ellipsis(plain, st, w), tw = T.adv(shown, st);
    const tx = f.align === "right" ? x + w - tw : f.align === "center" ? x + (w - tw) / 2 : x;
    const n = T.node(shown, tw > w ? x : tx, T.baseline(st, top, lh), st);
    low.push(hit(cls, x, top, w, lh, plain), { t: "group", clip: { x, y: top, w, h: lh }, children: shadow ? [{ ...n, y: n.y + 1, fill: { solid: [255, 255, 255], a: .6 }, decorative: true }, n] : [n] });
  }

  /* lines of text in a block of width w from top: returns the nodes and the block's height */
  function block(runs: { text: string; st: TStyle }[], x: number, top: number, w: number, lh: number, align: string, pre: boolean, shadow = false) {
    const st = runs[0]?.st, out: Node[] = [];
    // an element without text has no line (an empty cover subtitle is its min-height alone)
    if (!st || (!pre && !runs.some(r => r.text.trim()))) return { nodes: out, h: 0, text: "" };
    const ls = T.lines(runs, w, pre), H = T.lineH(st, lh), drawn: string[] = [];
    ls.forEach((line, k) => {
      // the line's width for its alignment: its spaces at the end count while they fit the box, beyond it they hang
      const all = line.reduce((s, p) => s + T.adv(p.text, p.st), 0);
      const ink = line.reduce((s, p, k) => s + T.adv(k === line.length - 1 ? p.text.replace(/ +$/, "") : p.text, p.st), 0);
      const lw = Math.max(ink, Math.min(all, w));
      drawn.push(line.map(p => p.text).join(""));
      let xx = align === "right" ? x + w - lw : align === "center" ? x + (w - lw) / 2 : x;
      const by = T.baseline(st, top + k * H, H);
      for (const p of line) {
        if (p.text.trim()) { const n = T.node(p.text, xx, by, p.st); out.push(...(shadow ? [{ ...n, y: n.y + 1, fill: { solid: [255, 255, 255], a: .6 } as Paint, decorative: true }, n] : [n])); }
        xx += T.adv(p.text, p.st);
      }
    });
    // the text as drawn, line by line (the reader's text: GT checks what is shown, not the source)
    return { nodes: out, h: ls.length * H, text: drawn.join(" ") };
  }

  function coverNodes() {
    const c = R.cfg, date = c.date || today, note = c.note || "", t = R.title || "";
    const tf: TextFmt = { ...slideTextFmt(ctx, R, "title"), size: c.fmt?.title?.size }, sf = slideTextFmt(ctx, R, "subtitle");
    const nf = c.fmt?.note || {}, df = c.fmt?.date || {}, n = String(t || "").length, fs = tf.size || (n > 52 ? 52 : n > 40 ? 60 : n > 28 ? 68 : 80);
    const g = glassy, BW = 760;
    if (g) {
      low.push(...chrome("gls wb chrome cv-orb", 1000, 96, 560, 560, 280), ...chrome("gls wb chrome cv-tile", 900, 470, 290, 290, Math.round(76 * rk)), ...chrome("gls wb chrome cv-orb small", 1300, 540, 220, 220, 110));
    } else {
      // the panel on the right with two faint bands turned −32° about their centres
      const P = { x: 1080, y: 0, w: 520, h: 900 }, a = -32 * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      const band = (y: number, h: number, al: number) => {
        const cx = 960 + 450, cy = y + h / 2, M: [number, number, number, number, number, number] = [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy];
        const pts = [[960, y], [1860, y], [960, y + h], [1860, y + h]].map(([px, py]) => [M[0] * px + M[2] * py + M[4], M[1] * px + M[3] * py + M[5]]);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        return { node: { t: "group", transform: M, children: [{ t: "rect", x: 960, y, w: 900, h, fill: { solid: [255, 255, 255], a: al } }] } as Node, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
      };
      const b1 = band(520, 120, .07), b2 = band(700, 60, .05), X1 = tv["--x1"] || "#1C4F8C", X2 = tv["--x2"] || "#0E3463";
      low.push(hit("cvx-panel", P.x, P.y, P.w, P.h), hit("cvx-band", b1.box[0], b1.box[1], b1.box[2], b1.box[3]), hit("cvx-band b2", b2.box[0], b2.box[1], b2.box[2], b2.box[3]),
        { t: "group", clip: P, children: [{ t: "rect", ...P, fill: { linear: cssLinear(160, P.w, P.h), stops: [{ o: 0, c: parseColor(X1).c, a: 1 }, { o: 1, c: parseColor(X2).c, a: 1 }] } }, b1.node, b2.node] });
    }
    // the text block: a flex column in (120, 0)–(880, 730), its content at the bottom
    const col = (glassy: TStyle, excel: TStyle) => g ? glassy : excel;
    const kSt = withFmt(col({ family: base, size: 19, weight: 700, italic: false, color: { solid: [18, 22, 44], a: .55 }, ls: 2.4 }, { family: base, size: 19, weight: 700, italic: false, color: solid(x1), ls: 2.4 }), nf);
    const tSt = withFmt(col({ family: base, size: fs, weight: 700, italic: false, color: solid("#0B0D17"), ls: -1.6 }, { family: base, size: fs, weight: 700, italic: false, color: solid("#14213D"), ls: -1.6 }), { ...tf, size: undefined });
    const sSt = withFmt(col({ family: base, size: 28, weight: 500, italic: false, color: { solid: [18, 22, 44], a: .66 }, ls: 0 }, { family: base, size: 28, weight: 400, italic: false, color: solid("#5B6B82"), ls: 0 }), sf);
    const al = (f: TextFmt) => f.align || "left";
    const kick = note.trim() ? block([{ text: collapse(note).trim().toUpperCase(), st: kSt }], 120, 0, BW, nf.lh ? +nf.lh : INHERITED, al(nf), false) : null;
    const tl = block([{ text: collapse(t).trim(), st: tSt }], 120, 0, BW, tf.lh ? +tf.lh : 1.04, al(tf), false, g);
    const sb = block([{ text: collapse(R.subtitle || "").trim(), st: sSt }], 120, 0, BW, sf.lh ? +sf.lh : 1.3, al(sf), false);
    const kH = kick ? kick.h + 18 : 0, sH = Math.max(36, sb.h), total = kH + tl.h + 30 + 6 + 24 + sH;     // (.cv-sub min-height 36)
    let y = 730 - total;
    const shiftY = (ns: Node[], dy: number) => ns.map(nd => nd.t === "text" ? { ...nd, y: r2(nd.y + dy) } : nd);
    const cls = g ? "cv-block g" : "cv-block x", inner: Node[] = [hit(cls, 120, 0, BW, 730, label([note ? note.toUpperCase() : "", t, R.subtitle || ""].filter(Boolean).join("\n")))];
    if (kick) { inner.push(hit("cv-kicker", 120, y, BW, kick.h, note.toUpperCase()), ...shiftY(kick.nodes, y)); y += kick.h + 18; }
    inner.push(hit("cv-title", 120, y, BW, tl.h, label(t)), ...shiftY(tl.nodes, y)); y += tl.h + 30;
    inner.push(hit("cv-bar", 120, y, 72, 6), { t: "rect", x: 120, y, w: 72, h: 6, r: 3, fill: g ? { linear: [0, .5, 1, .5], stops: [{ o: 0, c: V.a1, a: 1 }, { o: 1, c: V.a2, a: 1 }] } : solid(x1) }); y += 6 + 24;
    inner.push(hit("cv-sub", 120, y, BW, sH, label(R.subtitle || "")), ...shiftY(sb.nodes, y));
    z3.push(...inner);
    if (g) {
      // the date chip: a glass capsule with the date centred
      const dSt = withFmt({ family: base, size: 19, weight: 600, italic: false, color: solid("#0B0D17"), ls: 0 }, df), w = Math.round(56 + date.length * 11.5 * (df.size || 19) / 19);
      const lh = T.lineH(dSt, INHERITED), tw = T.adv(date, dSt);
      low.push(...chrome("gls wb chrome cv-chip", 120, 742, w, 52, Math.min(26, 26 * rk), [T.node(date, 120 + (w - tw) / 2, T.baseline(dSt, 742 + (52 - lh) / 2, lh), dSt)], date));
    } else {
      const dSt = withFmt({ family: base, size: 20, weight: 400, italic: false, color: solid("#5B6B82"), ls: 0 }, df), lh = T.lineH(dSt, df.lh ? +df.lh : INHERITED), tw = T.adv(date, dSt);
      low.push(hit("cvx-rule", 120, 752, 860, 1), { t: "rect", x: 120, y: 752, w: 860, h: 1, fill: solid("#D5DCE8") },
        hit("cvx-date", 120, 770, tw, lh, date), T.node(date, 120, T.baseline(dSt, 770, lh), dSt));
    }
  }

  function indexNodes() {
    const items: { n: number; title: string; sub: string; page: string }[] = [], subs = R.cfg.subs !== false;
    ctx.slides.forEach((S, i) => { if (S.type === "content") items.push({ n: items.length + 1, title: S.title, sub: subs ? S.subtitle || "" : "", page: String(pageNumber(ctx, i)) }); });
    if (!items.length) {
      const st: TStyle = { family: base, size: 22, weight: 400, italic: false, color: solid("#8A94A6"), ls: 0 }, lh = T.lineH(st, INHERITED), t = "No content slides yet";
      low.push(hit("ix-empty", 110, 200, T.adv(t, st), lh, t), T.node(t, 110, T.baseline(st, 200, lh), st));
      return;
    }
    const two = items.length > 7, per = two ? Math.ceil(items.length / 2) : items.length;
    const top0 = R.subtitle ? 150 : 132, avail = 812 - top0 - 28, xf = deckFmt(ctx, "index");
    const rowH = Math.min(per <= 4 ? 112 : 96, Math.floor(avail / per)), fs = xf.size || Math.max(16, Math.min(30, Math.round(rowH * .29))), badge = Math.min(50, rowH - 18);
    const colW = two ? 690 : 1060, x0 = two ? 90 : 270, top = top0 + Math.max(0, (avail - per * rowH - 28) * .42);
    const g = glassy, rowSt = withFmt({ family: g ? GLASS_ROW_FONT : base, size: fs, weight: 400, italic: false, color: g ? solid("#0B0D17") : solid("#14213D"), ls: 0 }, { ...xf, size: undefined, align: undefined });
    const a1rgb = tv["--a1rgb"] ? tv["--a1rgb"].split(",").map(Number) as [number, number, number] : [59, 130, 246] as [number, number, number];
    const a2rgb = tv["--a2rgb"] ? tv["--a2rgb"].split(",").map(Number) as [number, number, number] : [139, 92, 246] as [number, number, number];
    [items.slice(0, per), items.slice(per)].forEach((list, k) => {
      if (!list.length) return;
      const x = x0 + k * (colW + 40), H = list.length * rowH + 28;
      if (g) low.push(...chrome("gls wb chrome card ix-card", x, top, colW, H, Math.round(30 * rk)));
      list.forEach((it, j) => {
        const y = top + 14 + j * rowH, rx = x + 24, rw = colW - 48;
        const out: Node[] = [];
        // the badge: a circle with the number in the middle
        const nTxt = String(it.n).padStart(2, "0"), nSt: TStyle = { ...rowSt, size: Math.round(badge * .38), weight: 700, color: g ? solid(tv["--ixink"] || "#1E3A8A") : solid("#FFFFFF"), tnum: true };
        const by = y + (rowH - badge) / 2, ntw = T.adv(nTxt, nSt);
        out.push(hit("ix-n", rx, by, badge, badge, nTxt),
          { t: "rect", x: rx, y: by, w: badge, h: badge, r: badge / 2, fill: g ? { linear: [.5, 0, .5, 1], stops: [{ o: 0, c: a1rgb, a: .2 }, { o: 1, c: a2rgb, a: .16 }] } : solid(x1) },
          ...(g ? [{ t: "shadow", x: rx, y: by, w: badge, h: badge, r: badge / 2, dx: 0, dy: 1, blur: 1, spread: 0, c: [255, 255, 255], a: .8, inset: true } as Node] : []),
          T.node(nTxt, rx + (badge - ntw) / 2, T.baseline(nSt, by, badge), nSt));
        // the titles: a column at most 70 % of the row, each line cut with an ellipsis
        const tSt: TStyle = { ...rowSt, weight: 650 }, sSt: TStyle = { ...rowSt, size: r2(fs * .66), weight: rowSt.weight, color: g ? { solid: [18, 22, 44], a: .55 } : solid("#6B7A90") };
        const tx = rx + badge + 22, maxW = rw * .7, tTitle = collapse(it.title).trim(), tSub = collapse(it.sub).trim();
        const txtW = Math.min(maxW, Math.max(T.adv(tTitle, tSt), tSub ? T.adv(tSub, sSt) : 0));
        const tlh = T.lineH(tSt, INHERITED), slh = tSub ? T.lineH(sSt, INHERITED) : 0, txH = tlh + (tSub ? 3 + slh : 0), ty = y + (rowH - txH) / 2;
        out.push(hit("ix-txt", tx, ty, txtW, txH, label(tTitle + (tSub ? "\n" + tSub : ""))), hit("ix-t", tx, ty, txtW, tlh, tTitle));
        out.push({ t: "group", clip: { x: tx, y: ty, w: txtW, h: tlh }, children: [T.node(T.ellipsis(tTitle, tSt, txtW), tx, T.baseline(tSt, ty, tlh), tSt)] });
        if (tSub) {
          const sy = ty + tlh + 3;
          out.push(hit("ix-s", tx, sy, txtW, slh, tSub), { t: "group", clip: { x: tx, y: sy, w: txtW, h: slh }, children: [T.node(T.ellipsis(tSub, sSt, txtW), tx, T.baseline(sSt, sy, slh), sSt)] });
        }
        // the page: at the row's end, at least 40 px, right-aligned
        const pSt: TStyle = { ...rowSt, weight: 600, color: g ? { solid: [18, 22, 44], a: .7 } : solid(x1), tnum: true }, pw = T.adv(it.page, pSt), pW = Math.max(40, pw), px = rx + rw - pW, plh = T.lineH(pSt, INHERITED), py = y + (rowH - plh) / 2;
        // the dotted leader between them: the rest of the row less the gaps and its 4 px margins, .35em lower
        const lx = tx + txtW + 22 + 4, lw = Math.max(0, px - 22 - 4 - lx), ly = y + (rowH - 2) / 2 + .35 * fs;
        const leadC = g ? { c: [18, 22, 44] as [number, number, number], a: .6 } : { c: parseColor("#6B7A90").c, a: 1 };
        out.push(hit("ix-lead", lx, ly, lw, 2), { t: "line", x1: lx, y1: ly + 1, x2: lx + lw, y2: ly + 1, stroke: { w: 2, paint: { solid: leadC.c, a: leadC.a * .35 }, dash: [2, 2] } });
        out.push(hit("ix-p", px, py, pW, plh, it.page), T.node(it.page, px + pW - pw, T.baseline(pSt, py, plh), pSt));
        (g ? z3 : low).push(hit(g ? "ix-row g" : "ix-row x", rx, y, rw, rowH, label([nTxt, tTitle, tSub, it.page].filter(Boolean).join("\n"))), ...out);
        if (j < list.length - 1) {
          const sx = x + 24 + badge + 22, sw = colW - 72 - badge - 22, sy = y + rowH;
          const sep: Node = { t: "rect", x: sx, y: sy, w: sw, h: 1, fill: g ? { linear: [0, .5, 1, .5], stops: [{ o: 0, c: [30, 40, 80], a: .12 }, { o: .94, c: [30, 40, 80], a: .12 }, { o: 1, c: [30, 40, 80], a: 0 }] } : solid("#E1E6EF") };
          (g ? z3 : low).push(hit(g ? "ix-sep g" : "ix-sep", sx, sy, sw, 1), sep);
        }
      });
    });
  }

  function pageNoNodes(text: string, footer: boolean) {
    const geom = footer ? fg! : { label: text, ...pageNoGeom(ctx, text, glassy, !!logo, cover) };
    const { left, top, w, h, size, capsule } = geom, pos = footer ? ctx.style.footer.pos : ctx.style.pn.pos;
    const { f, legacy } = pnFmt(ctx);
    const st = withFmt({ family: legacy && !f.font ? legacy.replace(/"/g, "'") : base, size, weight: capsule ? 650 : glassy ? 600 : 700, italic: false,
      color: capsule ? solid("#0B0D17") : glassy ? { solid: [18, 22, 44], a: .62 } : solid(x1), ls: 0, tnum: true }, { ...f, size: undefined, align: undefined });
    const tw = T.adv(text, st), cls = (capsule ? "gls wb chrome pageno" : "pageno plain") + (footer ? " footer" : "");
    if (capsule) {
      const lh = T.lineH(st, INHERITED);
      z5.push(...chrome(cls, left, top, w, h, Math.min(h / 2, h / 2 * rk), [T.node(text, left + (w - tw) / 2, T.baseline(st, top + (h - lh) / 2, lh), st)], text));
    } else {
      const al = pos[1] === "l" ? "left" : pos[1] === "c" ? "center" : "right", tx = al === "left" ? left : al === "center" ? left + (w - tw) / 2 : left + w - tw;
      z5.push(hit(cls, left, top, w, h, text), T.node(text, tx, T.baseline(st, top, h), st));
    }
  }

  function noteNodes(part: NotePart, nb: { x: number; y: number; w: number; h: number }) {
    const n = part.n, { x, y, w, h } = nb;
    if (part.bubble) {
      if (glassy) low.push(...glassBox("card notebub", x, y, w, h, part.bubble.r, V, place, wall, { hit: { kind: "f", id: part.bubble.cls } }));
      else {
        // the framed box as Chromium paints an unscaled box: its edges on whole pixels (the hit keeps the layout's box)
        const X = Math.round(x), Y = Math.round(y), W = Math.round(x + w) - X, H = Math.round(y + h) - Y, r = part.bubble.r, clean = d === "clean";
        const sh = (dy: number, blur: number, spread: number, c: [number, number, number], a: number): Node => ({ t: "shadow", x: X, y: Y, w: W, h: H, r, dx: 0, dy, blur, spread, c, a });
        low.push(hit(part.bubble.cls, x, y, w, h), ...(clean ? [sh(8, 24, -12, [20, 30, 60], .18), sh(1, 3, 0, [20, 30, 60], .06)] : [sh(1, 2, 0, [0, 0, 0], .08)]),
          { t: "rect", x: X + .5, y: Y + .5, w: Math.max(0, W - 1), h: Math.max(0, H - 1), r: Math.max(0, r - .5), fill: solid("#FFFFFF"), stroke: { w: 1, paint: solid(clean ? "#E1E5EC" : "#BFBFBF") } });
      }
    }
    // the box: padding 4 / 6 px (10 / 18 with a bubble), the font size the page fits, a flex column
    const bub = part.cls.includes(" bub"), padY = bub ? 10 : 4, padX = bub ? 18 : 6;
    const start = n.size || (part.memo ? 13 : 18);
    const size = m.noteSize({ design: d, className: part.cls, cssText: part.style, html: part.inner, w, h }, start);
    const st: TStyle = withFmt({ family: glassy ? base : d === "clean" ? NOTE_FONT.clean : NOTE_FONT.excel, size, weight: glassy ? 500 : 400, italic: false, color: solid(glassy ? "#0B0D17" : "#16181D"), ls: 0 },
      { font: n.font, b: n.b || undefined, i: n.i || undefined, color: n.color }, { size: false });
    const align = n.align || (part.memo ? "left" : part.side === "left" ? "right" : "left"), lh = n.lh || 1.28, auto = part.cls.includes(" auto"), pre = !auto;
    const cx = x + padX, cw = Math.max(0, w - 2 * padX), blocks: { nodes: Node[]; h: number; mt: number; mb: number; text?: string }[] = [];
    const txt = part.txt;
    let text = txt;
    if (hasMarkup(txt) || n.pgap != null) {
      const pgap = n.pgap != null ? n.pgap * size : null, a1 = glassy ? (tv["--a1"] || "#3B82F6") : "#2F75B5";
      let prevNp = false;
      const lines = txt.split("\n"), texts: string[] = [];
      for (const raw of lines) {
        const kind = raw.startsWith("## ") ? "nh" : raw.startsWith("# ") ? "nt" : raw.trim() ? "np" : "gap";
        if (kind === "gap") { blocks.push({ nodes: [], h: pgap ?? .5 * size, mt: 0, mb: 0 }); prevNp = false; continue; }
        const body = kind === "np" ? raw : raw.slice(kind === "nh" ? 3 : 2);
        const bst: TStyle = kind === "nt" ? { ...st, size: r2(size * 1.32), weight: 800, color: glassy ? solid("#0B0D17") : solid(x1) } : kind === "nh" ? { ...st, weight: 700, color: solid(a1) } : st;
        const runs = inlineRuns(body, bst), blh = kind === "nt" ? 1.15 : kind === "nh" ? 1.25 : lh;
        const b = block(runs, cx, 0, cw, blh, align, pre);
        blocks.push({ ...b, mt: kind === "np" && prevNp && !auto ? (pgap ?? 0) : 0, mb: kind === "nt" ? .1 * bst.size : 0 });
        texts.push(b.text);
        prevNp = kind === "np";
      }
      text = texts.join("\n");
    } else {
      const b = block([{ text: auto ? collapse(txt) : txt, st }], cx, 0, cw, lh, align, pre);
      blocks.push({ ...b, mt: 0, mb: 0 });
      text = b.text;
    }
    // flex column: justify-content from the side (top: at the end) or the box's vertical alignment
    const just = part.memo ? (n.valign === "top" ? "start" : n.valign === "bottom" ? "end" : "center")
      : n.valign ? (n.valign === "top" ? "start" : n.valign === "middle" ? "center" : "end") : part.side === "top" ? "end" : "start";
    const H = blocks.reduce((s, b) => s + b.mt + b.h + b.mb, 0), free = h - 2 * padY - H;
    let yy = y + padY + (just === "end" ? free : just === "center" ? free / 2 : 0);
    const kids: Node[] = [];
    for (const b of blocks) { yy += b.mt; kids.push(...b.nodes.map(nd => nd.t === "text" ? { ...nd, y: r2(nd.y + yy) } : nd)); yy += b.h + b.mb; }
    low.push(hit(part.cls, x, y, w, h, label(auto ? text.split("\n").map(l => collapse(l).trim()).join("\n") : text)), { t: "group", clip: { x, y, w, h }, children: kids });
  }

  /** a markup line's runs: **bold**, [[±number]] coloured by its sign */
  function inlineRuns(t: string, st: TStyle): { text: string; st: TStyle }[] {
    const out: { text: string; st: TStyle }[] = [], re = /\*\*(.+?)\*\*|\[\[([^\]]+)\]\]/g;
    let at = 0, mm: RegExpExecArray | null;
    while ((mm = re.exec(t))) {
      if (mm.index > at) out.push({ text: t.slice(at, mm.index), st });
      if (mm[1] !== undefined) out.push({ text: mm[1], st: { ...st, weight: 700 } });
      else { const v = mm[2]; out.push({ text: v, st: { ...st, weight: 700, ...(/^\+/.test(v) ? { color: solid("#1F9D55") } : /^-/.test(v) ? { color: solid("#D92D20") } : {}) } }); }
      at = mm.index + mm[0].length;
    }
    if (at < t.length) out.push({ text: t.slice(at), st });
    return out.length ? out : [{ text: "", st }];
  }

  function logoNodes(L: NonNullable<SlideImages["logo"]>) {
    images[L.id] = L.src;
    const aspect = L.w && L.h ? L.w / L.h : 1;
    // an <img> of a given height and at most a width, object-fit: contain
    const pic = (bx: number, by: number, maxW: number, ih: number) => {
      const iw = Math.min(aspect * ih, maxW), dw = Math.min(iw, aspect * ih), dh = dw / aspect;
      return { iw, nodes: [{ t: "image", id: L.id, x: r2(bx + (iw - dw) / 2), y: r2(by + (ih - dh) / 2), w: r2(dw), h: r2(dh) } as Node] };
    };
    if (glassy) {
      const lx = cover ? 1150 : 1256, ly = cover ? 800 : 832, lw = cover ? 400 : 314, lh = cover ? 68 : 52;
      const bubble = ctx.style.logoBubble, padX = bubble ? 18 : 0, padY = bubble ? 9 : 6;
      const ih = lh - 2 * padY, p = pic(0, 0, lw - 2 * padX, ih), ix = lx + padX + (lw - 2 * padX - p.iw) / 2, iy = ly + padY;
      const img = p.nodes.map(nd => ({ ...nd, x: r2((nd as { x: number }).x + ix), y: r2((nd as { y: number }).y + iy) })) as Node[];
      const logoHit = hit("logo", ix, iy, p.iw, ih);
      if (bubble) low.push(...chrome("gls wb chrome logowrap", lx, ly, lw, lh, Math.min(lh / 2, lh / 2 * rk), [logoHit, ...img]));
      else low.push(hit("logowrap plain", lx, ly, lw, lh), logoHit, ...img);
    } else {
      const big = cover, ih = big ? 48 : 32, maxW = big ? 300 : 280, right = big ? 580 : 38, bottom = big ? 72 : 14;
      const p = pic(0, 0, maxW, ih), x = 1600 - right - p.iw, y = 900 - bottom - ih;
      low.push(hit(big ? "logowrap big" : "logowrap", x, y, p.iw, ih), hit("logo", x, y, p.iw, ih), ...p.nodes.map(nd => ({ ...nd, x: r2((nd as { x: number }).x + x), y: r2((nd as { y: number }).y + y) })) as Node[]);
    }
  }
}
