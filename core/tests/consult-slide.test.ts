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
import { areaFor, computeLayout, KPI_LINE, MEMO_KEY, NAVY_BAND, SIGNAL_AREA, slideFacts } from "../src/render/layout";
import { titleGeom } from "../src/render/text";
import { specOf, type DesignSpec } from "../src/render/consult-spec";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Note, Op, StylePatch } from "../src/model/types";

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

async function deck(file: string, design: Design, over: StylePatch = {}) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, file), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const style = resolveStyle({}, view.style, { design, ...over });             // the design resolved with the deck (its own palette)
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
/** the body tints of the consulting designs (round 4) */
const TINT = { mckinsey: "#F2F5F9", bain: "#F5F3F0" } as const;
/** Excel Refined hits that mark decoration the consulting designs do not have (its cover panel and bands, the cover's
    rule, the contents separators; a leader only where the spec has one) – nothing the stage edits or drags */
const DECOR = (S: DesignSpec) => new Set(["cvx-panel", "cvx-band b2", "cvx-rule", "ix-sep", ...(S.cover.band ? [] : ["cvx-band"]), ...(S.index.leader ? [] : ["ix-lead"])]);

describe("consulting designs: the slide furniture", () => {
  for (const design of CONSULT) for (const file of ["weekly-options.json", "weekly-comments.json", "report.json"]) it(`${design} · ${file}: every slide validates, eight node types, the band, the rules, Excel Refined's hits`, async () => {
    const { ctx, slides, build } = await deck(file, design), S = specOf(ctx);
    // Excel Refined with the page number as the consulting design has it (B48: on by default in Excel Refined only, so
    // its "pageno plain" hit is compared only where the deck turned the page number on)
    const clean = await deck(file, "clean", { pn: { on: ctx.style.pn.on } });
    for (let i = 0; i < slides.length; i++) {
      const R = slides[i], dl = build(i).nodes, all = flat(dl);
      expect(validate(dl), `${design} slide ${i + 1}`).toEqual([]);
      expect(all.every(n => (NODE_TYPES as readonly string[]).includes(n.t))).toBe(true);
      // the stage works as in Excel Refined: every hit it has (but decoration this design does not draw) is here too
      const want = new Set(hits(clean.build(i).nodes).map(h => h.id)), got = new Set(hits(dl).map(h => h.id)), decor = DECOR(S);
      for (const id of want) if (!decor.has(id)) expect(got.has(id), `${design} slide ${i + 1}: ${id}`).toBe(true);
      if (R.type !== "content") continue;
      // the title: at most two lines inside the band, bottom-anchored (Red without facts: in the message panel instead)
      const B = S.band, H = Math.ceil(S.title.lh! * S.title.size), ts = textsAfter(dl, "title"), ys = [...new Set(ts.map(t => t.y))];
      const inPanel = design === "bain" && !slideFacts(R, ctx)?.facts.lead;
      expect(ys.length).toBeLessThanOrEqual(inPanel ? 5 : B.lines);
      if (!inPanel) for (const t of ts) { expect(t.y).toBeGreaterThan(B.titleTop); expect(t.y).toBeLessThan(B.titleTop + B.lines * H); }
      // white and square: the slide's colour, no rounded corner anywhere outside the tables and the number discs
      // the body tint behind everything (the defaults: Navy's header band over it, Red's tinted slide)
      expect(all[0].t === "rect" && isFill(all[0], TINT[design])).toBe(true);
      const facts = slideFacts(R, ctx)?.facts ?? null, base = R.subtitle ? 170 : 138, A = areaFor(R, ctx);
      if (design === "mckinsey") {
        // Insight board: no rule; the title at x 64; the KPI line (and the content area under it) when there is a headline
        expect(all.some(n => n.t === "line" && n.x1 === B.x && n.x2 === B.x + B.w)).toBe(false);
        expect(hits(dl).find(h => h.id === "title")!.x).toBe(64);
        expect(hits(dl).some(h => h.id === "kpi")).toBe(!!facts?.headline);
        expect([A.x, A.y]).toEqual([50, base + (facts?.headline ? KPI_LINE.push : NAVY_BAND.push)]);
        // the deep-navy header band down to 16 px above the content area, the title white on it
        const band = all[1] as RectNode;
        expect([band.x, band.y, band.w, band.h]).toEqual([0, 0, 1600, A.y - NAVY_BAND.gap]); expect(isFill(band, "#051C2C")).toBe(true);
        expect(A.y - band.h).toBeGreaterThanOrEqual(14);
        for (const t of textsAfter(dl, "title")) expect(isFill(t, "#FFFFFF")).toBe(true);
      } else {
        // Signal: the message panel; the content column right of it; the short red bar where the rule was
        const panel = all[1] as RectNode;
        expect([panel.x, panel.y, panel.w, panel.h]).toEqual([0, 0, SIGNAL_AREA.panel, 900]); expect(isFill(panel, S.accent)).toBe(true);
        expect([A.x, A.w, A.y]).toEqual([SIGNAL_AREA.x, SIGNAL_AREA.w, base]);
        const bar = all.find((n): n is RectNode => n.t === "rect" && n.x === SIGNAL_AREA.x && n.w === 120 && n.h === 4);
        expect(!!bar).toBe(!!facts?.lead);
        if (bar) expect(bar.y + 2).toBe(base - 12);
        expect(hits(dl).find(h => h.id === "title")!.x).toBe(facts?.lead ? SIGNAL_AREA.x : 56);
      }
      // the page number: Navy a navy pill (36 × 22 at least) with a white number, Red plain and bold in the accent
      const pnHit = hits(dl).find(h => h.id === "pageno plain");
      if (pnHit) {
        const pn = textsAfter(dl, "pageno plain")[0];
        if (design === "mckinsey") {
          const pill = all.find((n): n is RectNode => n.t === "rect" && n.x === pnHit.x && n.y === pnHit.y)!;
          expect(isFill(pill, S.look.flat.head.fill)).toBe(true); expect([pill.h, pill.r]).toEqual([22, 11]); expect(pill.w).toBeGreaterThanOrEqual(36);
          expect(isFill(pn, "#FFFFFF")).toBe(true);
        } else { expect(isFill(pn, S.accent)).toBe(true); expect(pn.weight).toBe(700); }
      }
      // the footer plain in the page number style (white on Red's panel)
      const fh = hits(dl).find(h => h.id === "pageno plain footer"), ft = textsAfter(dl, "pageno plain footer");
      if (fh && ft.length) expect(isFill(ft[0], design === "bain" && fh.x < SIGNAL_AREA.panel ? "#FFFFFF" : S.pageno.color)).toBe(true);
      expect(all.some(n => n.t === "shadow")).toBe(false);
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
    // the title font and weight of the spec; Navy 40 px, Red 38 px (the concepts)
    expect(long[0].css).toBe(S.title.family); expect(long[0].size).toBe(design === "mckinsey" ? S.title.size : 38); expect(long[0].weight).toBe(S.title.weight);
  });

  for (const design of CONSULT) it(`${design}: a larger title moves the band's foot, the subtitle and what follows as areaFor moves the tables`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    R.cfg.fmt = { title: { size: 50 } };
    const dl = build(i).nodes, push = Math.min(200, titleGeom(R, ctx).push), ry = 158 + push, A = areaFor(R, ctx);
    expect(push).toBeGreaterThan(0);
    const title = hits(dl).find(h => h.id === "title")!, sub = hits(dl).find(h => h.id === "subtitle")!;
    expect(sub.y).toBeCloseTo(titleGeom(R, ctx).subTop, 6);
    expect(title.y + title.h).toBeLessThanOrEqual(sub.y + 1);
    expect(sub.y + sub.h).toBeLessThanOrEqual(ry);
    if (design === "mckinsey") {
      const k = hits(dl).find(h => h.id === "kpi")!;
      expect(k.y).toBeCloseTo(ry + 12 + KPI_LINE.dy, 6); expect(A.y).toBeCloseTo(ry + 12 + KPI_LINE.push, 6);
    } else {
      expect(flat(dl).some(n => n.t === "rect" && n.w === 120 && n.h === 4 && Math.abs(n.y + 2 - ry) < 1e-6)).toBe(true); expect(A.y).toBeCloseTo(ry + 12, 6);
    }
    expect(textsAfter(dl, "title")[0].size).toBe(50);
  });

  for (const design of CONSULT) it(`${design}: a text box's card is square – a tint and the accent bar, no shadow; without one, plain text in the note style`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = 2, R = slides[i];
    const dl = build(i).nodes, all = flat(dl), card = hits(dl).find(h => h.id === "notebub x")!;
    expect(card).toBeTruthy();
    const k = all.indexOf(card), fill = all[k + 1] as RectNode, bar = all[k + 2] as RectNode;
    expect(isFill(fill, "#FFFFFF")).toBe(true);                                      // white on the tinted body
    expect(fill.x).toBe(Math.round(card.x)); expect(fill.r).toBeUndefined();
    expect(isFill(bar, S.card.bar.color)).toBe(true); expect(bar.w).toBe(S.card.bar.w); expect(bar.x).toBe(fill.x); expect(bar.h).toBe(fill.h); expect(bar.r).toBeUndefined();
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
    // the "# " heading: in a Consulting Navy card its kicker (small capitals in the accent), else the spec's h1
    const h1 = ts.find(t => /^head$/i.test(t.src))!, h2 = ts.find(t => /sub head/i.test(t.src))!;
    if (design === "mckinsey") { expect(h1.src).toBe("HEAD"); expect(isFill(h1, S.accent)).toBe(true); expect(h1.weight).toBe(700); }
    else { expect(h1.css).toBe(S.note.h1.family); expect(isFill(h1, S.note.h1.color)).toBe(true); expect(h1.size).toBeCloseTo(S.note.h1.size * size / S.note.size, 1); }
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
    // the footnote style; on Consulting Red's message panel (the default box sits at x 56) white
    expect(ts[0].size).toBe(S.memo.size); expect(ts[0].css).toBe(S.memo.family);
    expect(isFill(ts[0], design === "bain" && mp.box.x < SIGNAL_AREA.panel ? "#FFFFFF" : S.memo.color)).toBe(true);
    const barOf = (dl: DisplayList) => flat(dl).find((n): n is RectNode => n.t === "rect" && isFill(n, S.memo.kicker.fill) && Math.abs(n.y - mp.box.y) <= 1 && Math.abs(n.w - mp.box.w) <= 1);
    expect(barOf(build(i).nodes)).toBeUndefined();
    notes[MEMO_KEY] = { text: "The takeaway", bubble: true };
    mp = memoPart(R, ctx)!;
    // with its card: the kicker / takeaway bar, solid and square, its text bold in the kicker ink
    const dl = build(i).nodes, bar = barOf(dl)!;
    expect(bar).toBeTruthy(); expect(bar.h).toBeCloseTo(mp.box.h, 0); expect(bar.r).toBeUndefined();
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
    // the contents slide: white as the content slides (the dark navy stays for the cover), the heading in the title ink
    expect(xa[0].t === "rect" && isFill(xa[0], TINT[design])).toBe(true);
    if (design === "mckinsey") expect(xa.some(n => n.t === "rect" && n.y === 0 && n.w === 1600 && isFill(n, "#051C2C"))).toBe(true);
    const head = textsAfter(ix, "title")[0];
    expect(head.size).toBe(S.index.heading.size); expect(isFill(head, design === "mckinsey" ? "#FFFFFF" : "#1A1A1A")).toBe(true); expect(head.x).toBe(S.index.heading.x);
    if (S.index.headingRule) expect(xa.some(n => n.t === "line" && n.stroke.w === S.index.headingRule!.w)).toBe(true);
    // each entry a plain row over a hairline: the number white in an accent disc, the entry in the ink, the page in the accent
    const row = hits(ix).filter(h => h.id === "ix-row x")[0], k = xa.indexOf(row);
    const hair = xa.slice(k).find((n): n is LineNode => n.t === "line" && !n.stroke.dash)!;
    expect([hair.x1, hair.y1, hair.x2]).toEqual([row.x, row.y + row.h, row.x + row.w]); expect(hair.stroke.w).toBe(1);
    expect(xa.some(n => n.t === "shadow" || (n.t === "rect" && isFill(n, "#FFFFFF") && n.w === row.w))).toBe(false);
    const n = hits(ix).find(h => h.id === "ix-n")!, dsc = xa.find((x): x is RectNode => x.t === "rect" && x.x === n.x && x.y === n.y && x.w === n.w)!;
    expect(isFill(dsc, S.index.number.circle || S.accent)).toBe(true); expect(dsc.r).toBe(dsc.w / 2);
    if (S.index.number.d) expect(dsc.w).toBe(S.index.number.d);
    const num = textsAfter(ix, "ix-n")[0], ent = textsAfter(ix, "ix-t")[0], pg = textsAfter(ix, "ix-p")[0];
    expect(isFill(num, "#FFFFFF")).toBe(true); expect(num.src).toBe("1"); expect(num.x + num.w! / 2).toBeCloseTo(dsc.x + dsc.w / 2, 6);
    expect(isFill(ent, S.look.flat.ink)).toBe(true); expect(ent.size).toBe(S.index.entry.size);
    expect(isFill(pg, S.accent)).toBe(true); expect(pg.x + pg.w!).toBeCloseTo(row.x + row.w, 6);
    const leader = xa.find((n): n is LineNode => n.t === "line" && !!n.stroke.dash);
    expect(!!leader).toBe(!!S.index.leader);
    // rows from the spec's top at its pitch
    expect(row.y).toBeGreaterThanOrEqual(S.index.top); expect(row.h).toBe(S.index.pitch);
    // the page number (Navy's pill, Red's accent), the footer plain
    expect(isFill(textsAfter(ix, "pageno plain")[0], design === "mckinsey" ? "#FFFFFF" : S.accent)).toBe(true);
    expect(isFill(textsAfter(ix, "pageno plain footer")[0], S.pageno.color)).toBe(true);
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

  it("the deck's colours: an accent of the user's colours the message panel, the title's bar and the card's bar", async () => {
    const { ctx, build } = await deck("weekly-options.json", "bain");
    ctx.style = { ...ctx.style, colors: { ...(ctx.style.colors || {}), accent: "#0A7B83" } };
    const S = specOf(ctx), all = flat(build(2).nodes);
    expect(S.accent).toBe("#0A7B83");
    expect(all.some(n => n.t === "rect" && isFill(n, "#0A7B83") && n.w === SIGNAL_AREA.panel && n.h === 900)).toBe(true);
    expect(all.some(n => n.t === "rect" && isFill(n, "#0A7B83") && n.w === 120 && n.h === 4)).toBe(true);
    expect(all.some(n => n.t === "rect" && isFill(n, "#0A7B83") && n.w === S.card.bar.w)).toBe(true);
  });

  it("Insight board: the KPI line quotes the table – the headline and its variances are the cells of deck20's total row", async () => {
    const { ctx, slides, build } = await deck("deck20.json", "mckinsey"), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    const F = slideFacts(R, ctx)!.facts, dl = build(i).nodes, kh = hits(dl).filter(h => h.id === "kpi");
    const fig = (c: { text: string; v: number | null }, signed: boolean) => { const t = c.text.trim().replace(/^-/, "−"); return signed && c.v !== null && c.v > 0 && !t.startsWith("+") ? "+" + t : t; };
    expect(kh.length).toBe(1 + Math.min(3, F.kpis.length));
    const values = kh.map(h => h.label!.split("\n")[0]);
    expect(values).toEqual([fig(F.headline!.value, false), ...F.kpis.slice(0, 3).map(k => fig(k.value, true))]);
    expect(values).toEqual(["77.407", "+192", "−43", "+3.245"]);
    // each value drawn in Georgia 54 bold (red when negative), its label in small capitals, its % under it
    const big = flat(dl).filter((n): n is TextNode => n.t === "text" && values.includes(n.src) && n.size >= 28);
    expect(big.length).toBe(4);
    for (const t of big) { expect(t.css).toContain("Georgia"); expect(t.weight).toBe(700); }
    expect(isFill(big.find(t => t.src === "−43")!, "#FF7A7A")).toBe(true);                // on the dark band
    expect(isFill(big.find(t => t.src === "77.407")!, "#FFFFFF")).toBe(true); expect(isFill(big.find(t => t.src === "+192")!, "#5CD0FF")).toBe(true);
    expect(flat(dl).some(n => n.t === "text" && n.src === F.kpis[0].label.toUpperCase())).toBe(true);
    // hairline separators between the blocks; the content area starts under the line
    expect(flat(dl).filter(n => n.t === "line" && n.x1 === n.x2 && n.y2 - n.y1 === KPI_LINE.h).length).toBe(kh.length - 1);
    expect(areaFor(R, ctx).y).toBe((R.subtitle ? 170 : 138) + KPI_LINE.push);
    expect(Math.min(...computeLayout(R, ctx).boxes.map(b => b.y))).toBeGreaterThanOrEqual(kh[0].y + KPI_LINE.h);
  });

  it("Signal: the message panel quotes the table – the lead variance, how many rows are short, the largest gap, the previous period", async () => {
    const { ctx, slides, build } = await deck("deck20.json", "bain"), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    const sf = slideFacts(R, ctx)!, F = sf.facts, dl = build(i).nodes, H = hits(dl);
    expect(H.find(h => h.id === "sig-lead")!.label).toBe("−43");
    expect(H.find(h => h.id === "sig-kicker")!.label).toBe(`${F.lead!.label} · ${sf.ex.series!.labels[sf.ex.series!.labels.length - 1]}`.toUpperCase());
    const facts = H.filter(h => h.id === "sig-fact").map(h => h.label!);
    expect(facts[0]).toBe(`${F.short!.n} of ${F.short!.of}\nrows short of Budget`);
    // the unit line: the subtitle (without its parentheses) only while it is short, else the lead's label alone
    const unit = (R.subtitle || "").trim().replace(/^\((.*)\)$/, "$1");
    expect(H.find(h => h.id === "sig-line")!.label).toBe(unit && unit.length <= 28 ? `${unit} · ${F.lead!.label}` : F.lead!.label);
    R.subtitle = "(mln €)";
    expect(hits(build(i).nodes).find(h => h.id === "sig-line")!.label).toBe(`mln € · ${F.lead!.label}`);
    expect(facts[0].startsWith("5 of 9")).toBe(true);
    expect(facts[1].startsWith("ISP ALB\nlargest gap: −78")).toBe(true);
    expect(facts[2].startsWith("+192\n")).toBe(true);
    // all white on the panel; the lead figure huge
    const lead = flat(dl).find((n): n is TextNode => n.t === "text" && n.src === "−43" && n.x < SIGNAL_AREA.panel)!;
    expect(lead.size).toBeGreaterThan(100); expect(isFill(lead, "#FFFFFF")).toBe(true);
    // the content column right of the panel
    for (const b of computeLayout(R, ctx).boxes) { expect(b.x).toBeGreaterThanOrEqual(SIGNAL_AREA.x - .01); expect(b.x + b.w).toBeLessThanOrEqual(SIGNAL_AREA.x + SIGNAL_AREA.w + .01); }
  });

  for (const design of CONSULT) it(`${design}: a slide whose table gives no facts – no KPI line (Navy), the title in the panel (Red)`, async () => {
    const { ctx, slides, build } = await deck("report.json", design), i = slides.findIndex(s => s.type === "content" && !slideFacts(s, ctx)?.facts.lead);
    expect(i).toBeGreaterThanOrEqual(0);
    const R = slides[i], dl = build(i).nodes, H = hits(dl);
    expect(validate(dl)).toEqual([]);
    expect(H.some(h => /^kpi$|^sig-/.test(h.id))).toBe(false);
    const title = H.find(h => h.id === "title")!;
    if (design === "mckinsey") { expect(title.x).toBe(64); expect(areaFor(R, ctx).y).toBe((R.subtitle ? 170 : 138) + NAVY_BAND.push); }
    else {
      expect(title.x).toBe(56); expect(title.x + title.w).toBeLessThanOrEqual(SIGNAL_AREA.panel);
      for (const t of textsAfter(dl, "title")) { expect(isFill(t, "#FFFFFF")).toBe(true); expect(t.size).toBeGreaterThan(40); }
      expect(areaFor(R, ctx).x).toBe(SIGNAL_AREA.x);
    }
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

  for (const design of CONSULT) it(`${design}: a card's "# " heading – Navy's small-capitals kicker in the accent, Red's heading with its 24 × 3 bar`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    const notes = R.cfg.notes as Record<string, Note>, key = Object.keys(notes).find(k => notes[k].bubble)!;
    notes[key] = { ...notes[key], text: "# What it means\nbody", size: 15, h: 400 };
    const part = noteParts(R, 0, ctx).find(p => p.key === key)!, d2 = build(i).nodes, all = flat(d2), k = all.findIndex(n => n.t === "hit" && n.id === part.cls);
    const ts = textsAfter(d2, part.cls), bar = all.slice(k).find((n): n is RectNode => n.t === "rect" && n.w === 24 && n.h === 3);
    if (design === "mckinsey") {
      const kick = ts.find(t => t.src === "WHAT IT MEANS")!;
      expect(kick.size).toBeCloseTo(11, 1); expect(kick.weight).toBe(700); expect(isFill(kick, S.accent)).toBe(true); expect(kick.ls).toBeGreaterThan(1);
      expect(bar).toBeUndefined();
    } else {
      const head = ts.find(t => t.src === "What it means")!;
      expect(isFill(bar!, S.accent)).toBe(true); expect(bar!.y + 3 + 6).toBeLessThan(head.y); expect(bar!.x).toBeCloseTo(head.x, 6);
    }
    // nothing of the flat pass: no band across the top, no shadow, no gradient, on any slide
    slides.forEach((_R, j) => { const a = flat(build(j).nodes); expect(a.some(n => n.t === "shadow" || (n.t === "rect" && !!n.fill && "linear" in n.fill) || (n.t === "rect" && n.y === 0 && n.w === 1600 && n.h < 20))).toBe(false); });
  });

  for (const design of CONSULT) it(`${design}: the cover ornament (arcs or stripes) under the text, clipped`, async () => {
    const { ctx, slides, build } = await deck("weekly-options.json", design), S = specOf(ctx), L = S.look;
    const cover = build(slides.findIndex(s => s.type === "cover")).nodes;
    const groups = cover.filter((n): n is Extract<Node, { t: "group" }> => n.t === "group" && !!n.clip);
    const title = cover.findIndex(n => n.t === "hit" && n.id === "cv-title");
    if (L.cover.arcs) {
      const g = groups.find(x => x.children.filter(c => c.t === "rect" && !!c.stroke).length === L.cover.arcs!.r.length)!;
      expect(g.clip).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
      const rs = g.children.filter((c): c is RectNode => c.t === "rect" && !!c.stroke).map(c => c.r);
      expect(rs).toEqual(L.cover.arcs.r);
      if (L.cover.arcs.disc) expect(g.children.some(c => c.t === "rect" && !!c.fill && c.r === L.cover.arcs!.disc!.r)).toBe(true);
      expect(cover.indexOf(g)).toBeLessThan(title);
    }
    if (L.cover.stripes) {
      const st = L.cover.stripes, g = groups.find(x => x.children.length && x.children.every(c => c.t === "line"))!;
      expect(g.clip).toEqual({ x: st.x0, y: st.y0, w: st.x1 - st.x0, h: st.y1 - st.y0 });
      const ys = g.children.map(c => (c as LineNode).y1);
      expect(ys[1] - ys[0]).toBe(st.gap); expect(Math.max(...ys)).toBeLessThan(st.y1);
      for (const c of g.children as LineNode[]) { expect(c.stroke.w).toBe(st.w); expect("solid" in c.stroke.paint && c.stroke.paint.a).toBe(st.a); }
      expect(cover.indexOf(g)).toBeLessThan(title);
    }
    expect(!!L.cover.arcs || !!L.cover.stripes).toBe(true);
  });

  for (const design of CONSULT) it(`${design}: every headline × background option on deck20 – the area, the grounds, the inks`, async () => {
    const { ctx, slides, build } = await deck("deck20.json", design), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    const S0 = specOf(ctx), facts = slideFacts(R, ctx)!.facts, base = R.subtitle ? 170 : 138;
    const BAND = { mckinsey: "#051C2C", bain: "#1F1F1F" }[design], PANEL = design === "mckinsey" ? "#051C2C" : S0.accent;
    for (const headline of ["kpi", "panel", "none"] as const) for (const background of ["band", "tinted", "white"] as const) {
      ctx.style = { ...ctx.style, consult: { headline, background } } as typeof ctx.style;
      const S = specOf(ctx), dl = build(i).nodes, all = flat(dl), H = hits(dl), A = areaFor(R, ctx), tag = `${headline}/${background}`;
      expect(validate(dl), tag).toEqual([]);
      // the area: a KPI line pushes it down, a band keeps its gap, a panel moves it to x 560
      const push = headline === "kpi" ? KPI_LINE.push : background === "band" ? NAVY_BAND.push : 0;
      expect([A.x, A.y, A.w], tag).toEqual(headline === "panel" ? [SIGNAL_AREA.x, base + push, SIGNAL_AREA.w] : [50, base + push, 1500]);
      for (const b of computeLayout(R, ctx).boxes) { expect(b.x, tag).toBeGreaterThanOrEqual(A.x - .01); expect(b.y, tag).toBeGreaterThanOrEqual(A.y - .01); }
      // the ground: white, or the tint (under a band too)
      expect(isFill(all[0], background === "white" ? S.bg : TINT[design]), tag).toBe(true);
      const band = all.find((n): n is RectNode => n.t === "rect" && n.y === 0 && n.h > 20 && n.h < 900 && isFill(n, BAND) && n.w >= 1100);
      expect(!!band, tag).toBe(background === "band");
      if (band) { expect(band.h, tag).toBe(A.y - NAVY_BAND.gap); expect(band.x, tag).toBe(headline === "panel" ? SIGNAL_AREA.panel : 0); }
      // the message panel in the design's colour, or none
      const panel = all.find((n): n is RectNode => n.t === "rect" && n.x === 0 && n.y === 0 && n.w === SIGNAL_AREA.panel && n.h === 900);
      expect(!!panel, tag).toBe(headline === "panel"); if (panel) expect(isFill(panel, PANEL), tag).toBe(true);
      expect(H.some(h => h.id === "sig-lead"), tag).toBe(headline === "panel");
      // the KPI line, its inks on the dark band light, on a light ground dark
      const kh = H.filter(h => h.id === "kpi");
      expect(kh.length, tag).toBe(headline === "kpi" ? 1 + Math.min(3, facts.kpis.length) : 0);
      if (kh.length) {
        const head = all.find((n): n is TextNode => n.t === "text" && n.src === kh[0].label!.split("\n")[0] && n.size >= 28)!;
        expect(isFill(head, background === "band" ? "#FFFFFF" : design === "mckinsey" ? "#051C2C" : "#1A1A1A"), tag).toBe(true);
      }
      // the title: white on a band, dark on a light ground
      const t = textsAfter(dl, "title")[0];
      expect(isFill(t, background === "band" ? "#FFFFFF" : design === "mckinsey" ? "#051C2C" : "#1A1A1A"), tag).toBe(true);
    }
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
