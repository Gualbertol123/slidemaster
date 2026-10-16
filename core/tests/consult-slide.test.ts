/* The consulting designs' slide furniture (08 §2.0–§2.2, S7b.2): the title band, the rules, text boxes and cards,
   bullets, the notes section, cover and contents – every value from the spec (consult-spec.ts). The tables are drawn
   by excel-dl here: the furniture does not depend on them. Same corpus loader and measurer as slide-dl.test.ts. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_TYPES, validate, type DisplayList, type HitNode, type LineNode, type Node, type RectNode, type TextNode } from "../src/dl/types";
import { parseColor } from "../src/dl/color";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { memoPart, noteParts } from "../src/render/slide";
import { areaFor, computeLayout, MEMO_KEY } from "../src/render/layout";
import { titleGeom } from "../src/render/text";
import { specOf, type DesignSpec } from "../src/render/consult-spec";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Note, Op } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
/** advances of 0.5 em per character, ascent .8 em, descent .2 em */
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const hits = (l: DisplayList) => flat(l).filter((n): n is HitNode => n.t === "hit" && n.kind === "f");
const textsAfter = (l: DisplayList, cls: string) => { const all = flat(l), k = all.findIndex(n => n.t === "hit" && n.kind === "f" && n.id === cls); const out: TextNode[] = []; if (k < 0) return out; for (const n of all.slice(k + 1)) { if (n.t === "hit") break; if (n.t === "text" && !n.decorative) out.push(n); } return out; };
const rgb = (hex: string) => parseColor(hex).c;
const isFill = (n: Node, hex: string) => (n.t === "rect" || n.t === "text") && !!n.fill && "solid" in n.fill && n.fill.solid.join() === rgb(hex).join();

async function deck(file: string, design: Design) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = resolveStyle({}, view.style, { design });             // the design resolved with the deck (its own palette)
  const slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
  const build = (i: number, c: RenderCtx = ctx) => {
    const R = slides[i], boxes = computeLayout(R, c).boxes;
    const tables = R.tables.map(L => excelToDisplayList(L, c, M));
    return slideToDisplayList(R, i, c, tables, boxes, { wall: null, logo: { id: "logo", src: "logo.png", w: 400, h: 100 } }, M, "1 October 2026");
  };
  return { ctx, slides, build };
}
const CONSULT = ["mckinsey", "bain"] as const;
/** Excel Refined hits that mark decoration the consulting designs do not have (its cover panel and bands, the cover's
    rule, the contents separators; a leader only where the spec has one) – nothing the stage edits or drags */
const DECOR = (S: DesignSpec) => new Set(["cvx-panel", "cvx-band b2", "cvx-rule", "ix-sep", ...(S.cover.band ? [] : ["cvx-band"]), ...(S.index.leader ? [] : ["ix-lead"])]);

describe("consulting designs: the slide furniture", () => {
  for (const design of CONSULT) for (const file of ["weekly-options.json", "weekly-comments.json", "report.json"]) it(`${design} · ${file}: every slide validates, eight node types, the band, the rules, Excel Refined's hits`, async () => {
    const { ctx, slides, build } = await deck(file, design), S = specOf(ctx);
    const clean = await deck(file, "clean");
    for (let i = 0; i < slides.length; i++) {
      const R = slides[i], dl = build(i).nodes, all = flat(dl);
      expect(validate(dl), `${design} slide ${i + 1}`).toEqual([]);
      expect(all.every(n => (NODE_TYPES as readonly string[]).includes(n.t))).toBe(true);
      // the stage works as in Excel Refined: every hit it has (but decoration this design does not draw) is here too
      const want = new Set(hits(clean.build(i).nodes).map(h => h.id)), got = new Set(hits(dl).map(h => h.id)), decor = DECOR(S);
      for (const id of want) if (!decor.has(id)) expect(got.has(id), `${design} slide ${i + 1}: ${id}`).toBe(true);
      if (R.type !== "content") continue;
      // the title: at most two lines inside the band, bottom-anchored
      const B = S.band, H = Math.ceil(S.title.lh! * S.title.size), ts = textsAfter(dl, "title"), ys = [...new Set(ts.map(t => t.y))];
      expect(ys.length).toBeLessThanOrEqual(B.lines);
      for (const t of ts) { expect(t.y).toBeGreaterThan(B.titleTop); expect(t.y).toBeLessThan(B.titleTop + B.lines * H); }
      // the rule 12 px above the content area, the spec's width and colour, x 50–1550; the bottom rule where the spec has one
      const lines = all.filter((n): n is LineNode => n.t === "line" && n.x1 === B.x && n.x2 === B.x + B.w);
      const rule = lines.find(l => l.y1 === areaFor(R, ctx).y - 12)!;
      expect(rule, `${design} slide ${i + 1}: rule`).toBeTruthy();
      expect(rule.stroke.w).toBe(S.rule.w);
      expect("solid" in rule.stroke.paint && rule.stroke.paint.solid).toEqual(rgb(S.rule.color));
      expect(rule.y1).toBe(R.subtitle ? 158 : 126);
      if (S.bottomRule) expect(lines.some(l => l.y1 === 828 && l.stroke.w === S.bottomRule!.w)).toBe(true);
      else expect(lines.length).toBe(1);
      // the page number plain in the spec's colour
      const pn = textsAfter(dl, "pageno plain");
      if (pn.length) expect(isFill(pn[0], S.pageno.color)).toBe(true);
    }
  });

  for (const design of CONSULT) it(`${design}: a long title wraps to two lines, the third cut with an ellipsis; a short one sits on the second line`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = slides.findIndex(s => s.type === "content");
    const short = textsAfter(build(i).nodes, "title");
    expect(short.length).toBe(1);
    slides[i].title = "A very long title that goes on ".repeat(8).trim();
    const long = textsAfter(build(i).nodes, "title");
    expect(long.length).toBe(2);
    expect(long[1].src.endsWith("…")).toBe(true);
    for (const t of long) expect(t.w!).toBeLessThanOrEqual(S.band.w + .01);
    expect(short[0].y).toBe(long[1].y);                                          // bottom-anchored
    expect(hits(build(i).nodes).find(h => h.id === "title")!.label).toBe(slides[i].title);
    // the title font, size and weight of the spec
    expect(long[0].css).toBe(S.title.family); expect(long[0].size).toBe(S.title.size); expect(long[0].weight).toBe(S.title.weight);
  });

  for (const design of CONSULT) it(`${design}: a larger title moves the band's foot, the subtitle and the rule as areaFor moves the tables`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    R.cfg.fmt = { title: { size: 50 } };
    const dl = build(i).nodes, rule = flat(dl).find((n): n is LineNode => n.t === "line" && n.x1 === 50 && n.y1 !== 828)!;
    expect(rule.y1).toBeCloseTo(areaFor(R, ctx).y - 12, 6);
    expect(rule.y1).toBeGreaterThan(158);
    const title = hits(dl).find(h => h.id === "title")!, sub = hits(dl).find(h => h.id === "subtitle")!;
    expect(sub.y).toBeCloseTo(titleGeom(R, ctx).subTop, 6);
    expect(title.y + title.h).toBeLessThanOrEqual(sub.y + 1);
    expect(sub.y + sub.h).toBeLessThanOrEqual(rule.y1);
    expect(textsAfter(dl, "title")[0].size).toBe(50);
  });

  for (const design of CONSULT) it(`${design}: a text box's card is the spec's fill with the bar; without one, plain text in the note style`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = 2, R = slides[i];
    const dl = build(i).nodes, all = flat(dl), card = hits(dl).find(h => h.id === "notebub x")!;
    expect(card).toBeTruthy();
    const fill = all.find((n): n is RectNode => n.t === "rect" && isFill(n, S.card.fill))!, bar = all.find((n): n is RectNode => n.t === "rect" && isFill(n, S.card.bar.color) && n.w === S.card.bar.w)!;
    expect(fill.x).toBe(Math.round(card.x)); expect(fill.r).toBeUndefined();
    expect(bar.x).toBe(fill.x); expect(bar.h).toBe(fill.h);
    expect(all.some(n => n.t === "shadow")).toBe(false);
    // the card's text inside its padding
    const part = noteParts(R, 0, ctx).find(p => p.bubble)!, ts = textsAfter(dl, part.cls);
    expect(Math.min(...ts.map(t => t.x))).toBeGreaterThanOrEqual(card.x + S.card.padX - .01);
    // a plain box: the note family and ink
    const plain = noteParts(R, 0, ctx).find(p => !p.bubble && !p.n.auto && !p.n.color)!;
    const pt = textsAfter(dl, plain.cls)[0];
    expect(pt.css).toBe(S.note.family); expect(isFill(pt, S.note.ink)).toBe(true);
  });

  for (const design of CONSULT) it(`${design}: bullets in the spec's glyph and colour with a 0.9 em hanging indent; headings and signed numbers`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = 2, R = slides[i];
    const notes = R.cfg.notes as Record<string, Note>, key = Object.keys(notes).find(k => notes[k].bubble)!;
    notes[key] = { ...notes[key], text: "# Head\n## Sub head\n- first point\n• second **bold** [[+12]] [[-3]]\nplain", size: 18, h: 400 };
    const part = noteParts(R, 0, ctx).find(p => p.key === key)!, dl = build(i).nodes, ts = textsAfter(dl, part.cls);
    const glyphs = ts.filter(t => t.src === S.note.bullet);
    expect(glyphs.length).toBe(2);
    for (const g of glyphs) expect(isFill(g, S.note.bulletColor)).toBe(true);
    expect(ts.some(t => /^[-•] /.test(t.src))).toBe(false);
    const first = ts.find(t => t.src.startsWith("first"))!, size = first.size;
    expect(first.x).toBeCloseTo(glyphs[0].x + .9 * size, 6);
    expect(ts.find(t => t.src.startsWith("plain"))!.x).toBeCloseTo(glyphs[0].x, 6);
    const h1 = ts.find(t => t.src === "Head")!, h2 = ts.find(t => /sub head/i.test(t.src))!;
    expect(h1.css).toBe(S.note.h1.family); expect(isFill(h1, S.note.h1.color)).toBe(true); expect(h1.size).toBeCloseTo(S.note.h1.size * size / S.note.size, 1);
    expect(isFill(h2, S.note.h2.color)).toBe(true);
    expect(h2.src).toBe(S.note.h2.caps ? "SUB HEAD" : "Sub head");
    if (S.note.h2.ls) expect(h2.ls).toBeGreaterThan(0);
    expect(isFill(ts.find(t => t.src === "+12")!, S.pos)).toBe(true);
    expect(isFill(ts.find(t => t.src === "-3")!, S.neg)).toBe(true);
    expect(ts.find(t => t.src === "bold")!.weight).toBe(700);
  });

  for (const design of CONSULT) it(`${design}: the notes section in the footnote style; with its card, the kicker bar`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = 2, R = slides[i];
    const notes = R.cfg.notes as Record<string, Note>;
    notes[MEMO_KEY] = { text: "Source: internal data" };
    let mp = memoPart(R, ctx)!, ts = textsAfter(build(i).nodes, mp.cls);
    expect(ts[0].size).toBe(S.memo.size); expect(ts[0].css).toBe(S.memo.family); expect(isFill(ts[0], S.memo.color)).toBe(true);
    expect(flat(build(i).nodes).some(n => n.t === "rect" && isFill(n, S.memo.kicker.fill) && n.y >= mp.box.y - 1)).toBe(false);
    notes[MEMO_KEY] = { text: "The takeaway", bubble: true };
    mp = memoPart(R, ctx)!;
    const dl = build(i).nodes, bar = flat(dl).find((n): n is RectNode => n.t === "rect" && isFill(n, S.memo.kicker.fill) && Math.abs(n.y - mp.box.y) <= 1)!;
    expect(bar).toBeTruthy(); expect(bar.w).toBeCloseTo(mp.box.w, 0); expect(bar.h).toBeCloseTo(mp.box.h, 0);
    ts = textsAfter(dl, mp.cls);
    expect(ts[0].size).toBe(S.memo.kicker.size); expect(ts[0].weight).toBe(S.memo.kicker.weight); expect(isFill(ts[0], S.memo.kicker.ink)).toBe(true);
  });

  for (const design of CONSULT) it(`${design}: the cover and the contents slide in the spec's colours`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx);
    const ci = slides.findIndex(s => s.type === "cover"), cover = build(ci).nodes, ca = flat(cover);
    expect(ca[0].t === "rect" && isFill(ca[0], S.cover.bg) && ca[0].w === 1600 && ca[0].h === 900).toBe(true);
    if (S.cover.band) expect(ca.some(n => n.t === "rect" && isFill(n, S.cover.band!.fill) && n.y === S.cover.band!.y && n.h === S.cover.band!.h)).toBe(true);
    const bar = ca.find((n): n is RectNode => n.t === "rect" && n.x === S.cover.bar.x && n.y === S.cover.bar.y)!;
    expect(isFill(bar, S.cover.bar.fill)).toBe(true); expect([bar.w, bar.h]).toEqual([S.cover.bar.w, S.cover.bar.h]);
    const ct = textsAfter(cover, "cv-title");
    expect(ct[0].x).toBe(S.cover.title.x); expect(ct[0].size).toBe(S.cover.title.size); expect(isFill(ct[0], S.cover.title.color)).toBe(true);
    expect(hits(cover).find(h => h.id === "cv-title")!.y).toBe(S.cover.title.top);
    const date = textsAfter(cover, "cvx-date")[0];
    expect(date.y).toBe(S.cover.date.y); expect(date.src).toBe(S.cover.date.caps ? "1 OCTOBER 2026" : "1 October 2026"); expect(isFill(date, S.cover.date.color)).toBe(true);
    const sub = textsAfter(cover, "cv-sub")[0];
    expect(sub.size).toBe(S.cover.subtitle.size);
    if (S.cover.subtitle.a !== undefined) expect("solid" in sub.fill && sub.fill.a).toBe(S.cover.subtitle.a);
    // the contents slide
    const xi = slides.findIndex(s => s.type === "index"), ix = build(xi).nodes, xa = flat(ix);
    expect(xa[0].t === "rect" && isFill(xa[0], S.index.bg)).toBe(true);
    const head = textsAfter(ix, "title")[0];
    expect(head.size).toBe(S.index.heading.size); expect(isFill(head, S.index.heading.color)).toBe(true); expect(head.x).toBe(S.index.heading.x);
    if (S.index.headingRule) expect(xa.some(n => n.t === "line" && n.stroke.w === S.index.headingRule!.w)).toBe(true);
    const num = textsAfter(ix, "ix-n")[0], ent = textsAfter(ix, "ix-t")[0], pg = textsAfter(ix, "ix-p")[0];
    expect(isFill(num, S.index.number.color)).toBe(true); expect(num.src).toBe("1");
    expect(isFill(ent, S.index.entry.color)).toBe(true); expect(ent.size).toBe(S.index.entry.size);
    expect(isFill(pg, S.index.page.color)).toBe(true); expect(pg.x + pg.w!).toBeCloseTo(1600 - S.index.heading.x, 6);
    const circle = xa.find((n): n is RectNode => n.t === "rect" && !!S.index.number.circle && isFill(n, S.index.number.circle));
    if (S.index.number.circle) { expect(circle!.w).toBe(S.index.number.d); expect(circle!.r).toBe(S.index.number.d / 2); }
    const leader = xa.find((n): n is LineNode => n.t === "line" && !!n.stroke.dash);
    expect(!!leader).toBe(!!S.index.leader);
    // rows at the spec's pitch from its top
    const rows = hits(ix).filter(h => h.id === "ix-row x");
    expect(rows[0].y).toBeGreaterThanOrEqual(S.index.top); expect(rows[0].h).toBe(S.index.pitch);
    // the page number and footer stay readable on a contents slide of its own background
    for (const id of ["pageno plain", "pageno plain footer"]) expect(isFill(textsAfter(ix, id)[0], S.index.bg !== S.bg ? S.index.page.color : S.pageno.color), id).toBe(true);
  });

  for (const design of CONSULT) it(`${design}: in a right- or centre-aligned box the bullet goes inline before its text, no hanging indent`, async () => {
    for (const align of ["right", "center"] as const) {
      const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), R = slides[2];
      const notes = R.cfg.notes as Record<string, Note>, key = Object.keys(notes).find(k => notes[k].bubble)!;
      notes[key] = { ...notes[key], text: "- one\nplain", size: 18, h: 400, align };
      const part = noteParts(R, 0, ctx).find(p => p.key === key)!, ts = textsAfter(build(2).nodes, part.cls);
      const g = ts.find(t => t.src.startsWith(S.note.bullet))!, one = ts.find(t => t.src === "one")!;
      expect(g.src).toBe(S.note.bullet + " "); expect(isFill(g, S.note.bulletColor)).toBe(true);
      expect(g.y).toBe(one.y);
      expect(one.x).toBeCloseTo(g.x + g.w!, 6);                                       // the glyph and its space right before the text
      expect(one.x - g.x).toBeLessThan(2 * 18);
    }
  });

  for (const design of CONSULT) it(`${design}: the cover's logo sits bottom right (right edge 1504, bottom 836)`, async () => {
    const { slides, build } = await deck("weekly-options.json", design), ci = slides.findIndex(s => s.type === "cover");
    const h = hits(build(ci).nodes).find(x => x.id === "logowrap big")!;
    expect(h.x + h.w).toBeCloseTo(1600 - 96, 6); expect(h.y + h.h).toBeCloseTo(900 - 64, 6);
  });

  for (const design of CONSULT) it(`${design}: a larger title line height is capped to the band; the lines never rise above its top`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), R = slides[2];
    R.title = "A very long title that goes on ".repeat(8).trim();
    R.cfg.fmt = { title: { lh: 2.4 } };
    const dl = build(2).nodes, h = hits(dl).find(x => x.id === "title")!, ts = textsAfter(dl, "title");
    expect(ts.length).toBe(2);
    expect(h.y).toBe(S.band.titleTop);
    expect(h.y + h.h).toBeLessThanOrEqual(titleGeom(R, ctx).subTop - 6 + .01);
    expect(Math.min(...ts.map(t => t.y)) - ts[0].size * .8).toBeGreaterThanOrEqual(S.band.titleTop - .01);
  });

  it("the deck's colours: an accent of the user's colours the rule, the bar of the card and the bullets", async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", "bain");
    ctx.style = { ...ctx.style, colors: { ...(ctx.style.colors || {}), accent: "#0A7B83" } };
    const S = specOf(ctx), dl = build(2).nodes;
    expect(S.rule.color).toBe("#0A7B83");
    expect(flat(dl).some(n => n.t === "line" && "solid" in n.stroke.paint && n.stroke.paint.solid.join() === rgb("#0A7B83").join())).toBe(true);
    expect(flat(dl).some(n => n.t === "rect" && isFill(n, "#0A7B83") && n.w === S.card.bar.w)).toBe(true);
    void slides;
  });
  for (const design of CONSULT) it(`${design}: a three-line cover title with a two-line subtitle stays inside the band (above the date)`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), ci = slides.findIndex(s => s.type === "cover");
    slides[ci].title = "A very long cover title that goes on and on ".repeat(6).trim();
    slides[ci].subtitle = "A long subtitle that needs two lines on the cover ".repeat(4).trim();
    const dl = build(ci).nodes, tt = textsAfter(dl, "cv-title"), st = textsAfter(dl, "cv-sub"), date = hits(dl).find(h => h.id === "cvx-date")!;
    expect(new Set(tt.map(t => t.y)).size).toBe(S.cover.title.maxLines);
    expect(new Set(st.map(t => t.y)).size).toBe(2);
    const foot = S.cover.band ? S.cover.band.y + S.cover.band.h - 48 : date.y - 24;
    for (const t of [...tt, ...st]) expect(t.y + t.size * .2, t.src).toBeLessThanOrEqual(foot + .01);
    const sub = hits(dl).find(h => h.id === "cv-sub")!, bar = hits(dl).find(h => h.id === "cv-bar")!;
    expect(sub.y + sub.h).toBeLessThanOrEqual(foot + .01);
    expect(bar.y).toBeGreaterThanOrEqual((S.cover.band?.y ?? 0) + 48);
  });

  for (const design of CONSULT) it(`${design}: an empty cover title keeps a clickable hit of one line`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), ci = slides.findIndex(s => s.type === "cover");
    slides[ci].title = "";
    const h = hits(build(ci).nodes).find(x => x.id === "cv-title")!;
    expect(h.h).toBeGreaterThanOrEqual(S.cover.title.size * (S.cover.title.lh || 1) - 1);
  });

  it("snapshot: every corpus deck × version × slide in both designs (sha1 of the slide's nodes; tables left empty – consult-dl.test.ts pins them)", async () => {
    const out: Record<string, string> = {};
    for (const file of fs.readdirSync(DECKS).filter(f => f.endsWith(".json")).sort()) {
      const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
      const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
      const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
      for (const design of CONSULT) for (const v of [null, ...(view.preset?.versions || [])]) {
        const style = resolveStyle({}, view.style, { design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
        const ctx: RenderCtx = { style, edits: view.edits || {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "logo.png", sheet: n => wb.sheets.find(s => s.name === n) || null, version: v };
        slides.forEach((R, i) => {
          const dl = slideToDisplayList(R, i, ctx, R.tables.map(() => ({ nodes: [], images: {} })), computeLayout(R, ctx).boxes, { wall: null, logo: { id: "logo", src: "logo.png", w: 400, h: 100 } }, M, "1 October 2026");
          out[`${file.replace(/\.json$/, "")}/${v ? v.id : "-"}/${i + 1}/${design}`] = crypto.createHash("sha1").update(JSON.stringify(dl.nodes)).digest("hex");
        });
      }
    }
    expect(out).toMatchSnapshot();
  });
});
