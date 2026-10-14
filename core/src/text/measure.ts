/* Text measured from font files (PLAN S4.4, 03 §2.6, B7): the display list's runs, line breaks and Excel's digit
   width come from HarfBuzz on the file the screen draws with – the deck's library face or this PC's font (the
   helper's /sysfonts, or the browser's local fonts when it has given them) – so every PC with the same files lays a
   slide out the same, and the PDF's glyphs sit exactly where the screen's do.

   The face is the one the browser draws a CSS font with: the first family of the list that the library or this PC
   has (no stand-ins: a browser on Windows takes the next family of the list), the nearest weight and style by CSS
   font matching. A run none of whose families has a readable file (from disk without the browser's fonts, a WOFF2
   upload) is measured by the page as before (`fallback`, decision 2026-10-12, 3). Ascent and descent are what
   Chromium's canvas reports on Windows (DirectWrite's metrics: OS/2 winAscent / winDescent, or the typographic
   ones when the font sets USE_TYPO_METRICS, rounded to whole pixels). A text with a character the face has no glyph for is
   measured by the page too (the browser draws that character with a fallback font). */
import type { LinesReq, RunMetrics, RunReq, TextMeasurer } from "../platform";
import { wrapLines } from "./lines";
import { pickFace, type CatalogFont } from "./resolve";
import { catalogFamily, parseFont } from "./family";
export { catalogFamily, parseFont } from "./family";
import { FontRegistry, type FaceInfo } from "./fonts";
import type { Shaper } from "./shape";
import { weightOf, type TextNode } from "../dl/types";
import type { OutlineRun } from "../dl/svg";

/** where the measurer gets fonts: the catalog (the deck's library faces and this PC's files) and a file's bytes */
export interface FontSource {
  catalog(): Promise<CatalogFont[]>;
  bytes(f: CatalogFont): Promise<Uint8Array | null>;
}
const u16 = (d: Uint8Array, o: number) => (d[o] << 8) | d[o + 1];
const i16 = (d: Uint8Array, o: number) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
/** ascent and descent per em as Chromium's canvas reports them on Windows (DirectWrite: winAscent / winDescent, or
    typoAscender / -typoDescender with USE_TYPO_METRICS; hhea when there is no OS/2) */
export function verticalMetrics(face: FaceInfo): { asc: number; desc: number } {
  const f = face.font, d = f.data, os2 = f.tables.get("OS/2"), hhea = f.tables.get("hhea")!.off, upem = f.unitsPerEm;
  if (!os2) return { asc: i16(d, hhea + 4) / upem, desc: -i16(d, hhea + 6) / upem };
  const typo = (u16(d, os2.off + 62) & 0x80) !== 0;
  if (typo) return { asc: i16(d, os2.off + 68) / upem, desc: -i16(d, os2.off + 70) / upem };
  return { asc: u16(d, os2.off + 74) / upem, desc: u16(d, os2.off + 76) / upem };
}

/** the per-font check's text (05 §3.4): digits, Italian accents, Δ, €, %, and words with kerning pairs */
const PROBE = "0123456789 àèéìòù ÀÈÉ Δ € % (+0,2%) Variazione annua YoY, Totale crediti: 1.234,56 – AVATAR Te Wo";
/** whether a face has a glyph for every character of a text (else the browser draws some with a fallback font, which
    the core does not have: the page measures that text) */
const covers = (face: FaceInfo, text: string) => { for (const ch of text) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0xa0 && !face.font.cmap.get(c)) return false; } return true; };

export class FontMeasurer implements TextMeasurer {
  private fonts = new FontRegistry();
  private byFamily: Promise<Map<string, CatalogFont[]>> | null = null;
  private files = new Map<string, Promise<FaceInfo | null>>();
  private faces = new Map<string, Promise<FaceInfo | null>>();
  /** the faces found so far (width() answers with these), by the font without its size */
  private found = new Map<string, FaceInfo | null>();
  private sh: Shaper | null = null;
  /** widths shaped so far, by face, size, tabular figures and text (a table's digits and wrapped words repeat) */
  private widths = new Map<string, number>();
  private w(sh: Shaper, face: FaceInfo, text: string, size: number, tnum = false): number {
    const k = face.id + "|" + size + (tnum ? "|t|" : "||") + text;
    let v = this.widths.get(k);
    if (v === undefined) {
      if (this.widths.size > 200_000) this.widths.clear();
      this.widths.set(k, v = sh.shape(face, text, size, tnum ? ["tnum"] : []).w);
    }
    return v;
  }
  /** runs measured by the page (no readable file), for tests and the bench */
  stats = { font: 0, page: 0 };
  constructor(private readonly shaper: Promise<Shaper>, private readonly src: FontSource, private readonly fallback: TextMeasurer) {
    void shaper.then(sh => { this.sh = sh; }, () => undefined);
  }

  /** the catalog changed (a library font added, the browser gave its fonts): faces are looked for again */
  reset() { this.byFamily = null; this.faces.clear(); this.found.clear(); this.widths.clear(); }

  private catalog() {
    return this.byFamily ||= this.src.catalog().then(list => {
      const lib = new Set(list.filter(f => f.source === "library").map(f => f.family.toLowerCase())), m = new Map<string, CatalogFont[]>();
      // a library family shadows a Windows font of the same name (its @font-face rule wins in the page)
      for (const f of list) { const k = f.family.toLowerCase(); if (f.source === "system" && lib.has(k)) continue; const l = m.get(k) || []; l.push(f); m.set(k, l); }
      this.catalogFailed = false;
      return m;
    }, () => { this.byFamily = null; this.catalogFailed = true; return new Map<string, CatalogFont[]>(); });
  }
  /** the last catalog could not be read: the faces looked for with it are forgotten */
  private catalogFailed = false;
  /** a catalog file's face (null: unreadable – WOFF2, a broken file) */
  private file(f: CatalogFont, family: string): Promise<FaceInfo | null> {
    const key = f.source + "|" + f.file;
    let p = this.files.get(key);
    if (!p) {
      p = this.src.bytes(f).then(data => {
        if (!data) return null;
        try {
          // (a copied Windows font is matched as Windows matches it: "system")
          const faces = f.source === "library" ? this.fonts.add(data, { family: f.family, weight: f.weight, italic: f.italic, source: f.copied ? "system" : "library", file: f.file })
            : this.fonts.add(data, { source: "system", file: f.file });
          // a collection holds several faces: the one of this family, weight and style
          return pickFace(faces.filter(x => x.family.toLowerCase() === family.toLowerCase()), f.weight, f.italic) ?? (faces.length === 1 ? faces[0] : null);
        } catch { return null; }
      }, () => null);
      this.files.set(key, p);
    }
    return p;
  }
  /** the face the browser draws a CSS font with, or null (the page measures it) */
  face(css: string): Promise<FaceInfo | null> {
    const fp0 = parseFont(css), key = fp0 ? `${fp0.italic ? "i" : ""}${fp0.weight} ${fp0.families.join(",")}` : css;
    let p = this.faces.get(key);
    if (!p) {
      p = (async () => {
        const fp = fp0; if (!fp) return null;
        const cat = await this.catalog(), fam = catalogFamily(fp.families, k => cat.has(k)), list = fam ? cat.get(fam.toLowerCase()) : null;
        if (fam && list) {
          // the face CSS picks; an unreadable one is dropped and the next nearest tried, as the PDF's resolver does – but
          // a family none of whose files is readable here (a WOFF2 upload) is still the one the browser draws: the page
          // measures it, never the next family of the list
          for (let pool = list; pool.length;) {
            const f = pickFace(pool, fp.weight, fp.italic)!, face = await this.file(f, fam);
            if (face) return face;
            pool = pool.filter(x => x !== f);
          }
          return null;
        }
        return null;
      })();
      this.faces.set(key, p);
      void p.then(face => {
        if (this.faces.get(key) !== p) return;
        if (this.catalogFailed) { this.faces.delete(key); return; }
        this.found.set(key, face);
      });
    }
    return p;
  }
  /** how long a measurement waits for a font's file before the page measures it instead (the helper may be busy) */
  budget = 1500;
  /** a face that came after the budget: the host draws again with it */
  onLate: (() => void) | null = null;
  /** faces that missed the budget (each reports its arrival once; arrivals close together, one redraw) */
  private late = new Set<Promise<FaceInfo | null>>();
  private lateTimer: ReturnType<typeof setTimeout> | null = null;
  /** each pending face's deadline: a measurement waits for a font only until then, however many ask */
  private deadlines = new Map<Promise<FaceInfo | null>, Promise<"late">>();
  /** the catalog missed a budget and is still coming: no measurement waits for it again */
  private catalogLate = false;
  /** a face or the catalog missed its budget and has not arrived, or its redraw is still to come: the slide on the
      stage may be drawn again (the capture tools wait for this to end before they read a slide) */
  get settling() { return this.late.size > 0 || this.lateTimer !== null || this.catalogLate; }
  private faceSoon(css: string): Promise<FaceInfo | null> {
    const p = this.face(css);
    if (this.late.has(p)) return Promise.resolve(null);                 // (it missed its budget: the page measures)
    if (this.catalogLate) { this.late.add(p); void p.then(face => { this.late.delete(p); if (face && !this.lateTimer) this.lateTimer = setTimeout(() => { this.lateTimer = null; this.onLate?.(); }, 100); }); return Promise.resolve(null); }
    let d = this.deadlines.get(p);
    if (!d) {
      let t: ReturnType<typeof setTimeout> | undefined;
      d = new Promise<"late">(r => { t = setTimeout(() => r("late"), this.budget); });
      this.deadlines.set(p, d);
      void p.then(() => { clearTimeout(t); this.deadlines.delete(p); }, () => undefined);
    }
    return Promise.race([p, d]).then(v => {
      if (v !== "late") return v;
      // (the catalog itself still coming: the next fonts do not wait for it either)
      if (this.byFamily) { const c = this.byFamily; let done = false; void c.then(() => { done = true; }); queueMicrotask(() => { if (!done) { this.catalogLate = true; void c.then(() => { this.catalogLate = false; }, () => { this.catalogLate = false; }); } }); }
      if (!this.late.has(p)) {
        this.late.add(p);
        void p.then(face => {
          this.late.delete(p);
          if (face && !this.lateTimer) this.lateTimer = setTimeout(() => { this.lateTimer = null; this.onLate?.(); }, 100);
        });
      }
      return null;
    });
  }
  /** a run's width now: from a face found before (prepare), else null – and the face is looked for */
  private parsed = new Map<string, { fp: ReturnType<typeof parseFont>; key: string }>();
  width(text: string, css: string): number | null {
    let p = this.parsed.get(css);
    if (!p) { const fp = parseFont(css); this.parsed.set(css, p = { fp, key: fp ? `${fp.italic ? "i" : ""}${fp.weight} ${fp.families.join(",")}` : "" }); }
    const { fp, key } = p; if (!fp) return null;
    if (!this.found.has(key) || !this.sh) { void this.face(css); return null; }
    const face = this.found.get(key);
    // a font without a file here (the page measures its runs): no width the page's own would match
    if (!face || !covers(face, text)) return null;
    return this.w(this.sh, face, text, fp.size);
  }
  /* ---- outlines on screen (03 §2.6 step 3, 05 §3.4) */
  /** every font as outlines (the screen's text then matches the PDF's pixels; a switch, S4.4) */
  outlineAll = false;
  /** the per-font check, by face: true = the browser's own text of that font is wider or narrower than HarfBuzz's by
      more than 0.5 % somewhere – its runs are drawn as outlines */
  private checks = new Map<string, Promise<boolean>>();
  private outlined = new Map<string, boolean>();
  /** checks the faces of these CSS fonts (once each): a probe text at 14.67 and 40 px measured by the page and by HarfBuzz.
      True when a face not checked before is to be drawn as outlines */
  async check(fonts: string[]): Promise<boolean> {
    const sh = await this.shaper;
    let flagged = false;
    await Promise.all(fonts.map(async css => {
      const face = await this.face(css), fp = parseFont(css); if (!face || !fp) return;
      let p = this.checks.get(face.id);
      if (!p) {
        const fam = fp.families.join(", "), style = `${fp.italic ? "italic " : ""}${fp.weight} `;
        const probe = [...PROBE].filter(ch => covers(face, ch)).join("");
        // two sizes (each new font and size costs the page a font set-up; the advances scale)
        const sizes = [14.67, 40], runs = sizes.map(z => ({ text: probe, font: `${style}${z}px ${fam}` }));
        p = Promise.resolve(this.fallback.measureRuns!(runs)).then(ans => runs.some((r, i) => {
          const ours = sh.shape(face, r.text, sizes[i]).w, theirs = ans[i].w;
          return theirs > 0 && Math.abs(ours - theirs) / theirs > .005;
        }), () => false);
        this.checks.set(face.id, p);
        void p.then(v => this.outlined.set(face.id, v));
        if (await p) flagged = true;
      } else await p;
    }));
    return flagged;
  }
  /** the faces drawn as outlines (a short name: the stage's layer keys carry it) */
  outlineSig(): string { return [...this.outlined].filter(([, v]) => v).map(([id]) => id.slice(0, 8)).sort().join("."); }
  /** whether these CSS fonts' faces have all been checked (the stage waits for no check) */
  checked(fonts: string[]): boolean {
    return fonts.every(css => { const fp = parseFont(css); if (!fp) return true; const face = this.found.get(`${fp.italic ? "i" : ""}${fp.weight} ${fp.families.join(",")}`); return !face || this.outlined.has(face.id); });
  }
  /** a text node's glyphs to draw as outlines, or null (drawn as text: its font passed the check, has no file here, or
      is drawn with a synthetic style – the browser's slant or bold, which outlines would not have) */
  outlineRun(n: TextNode): OutlineRun | null {
    const sh = this.sh; if (!sh || !n.src) return null;
    const fp = parseFont(`${n.i ? "italic " : ""}${weightOf(n)} ${n.size}px ${n.css || n.font}`); if (!fp) return null;
    const face = this.found.get(`${fp.italic ? "i" : ""}${fp.weight} ${fp.families.join(",")}`);
    if (!face || face.variable || !(this.outlineAll || this.outlined.get(face.id))) return null;
    if ((n.i && !face.italic) || (weightOf(n) >= 600 && face.weight < 600) || !covers(face, n.src)) return null;
    const run = sh.shapeNode(face, n), glyphs: OutlineRun["glyphs"] = [];
    const chars = n.adv && !n.gids && run.gids!.length === [...n.src].length ? n.adv : null;
    let pen = 0, upem = 1000;
    run.gids!.forEach((gid, i) => {
      const o = sh.outline(face, gid); upem = o.upem;
      glyphs.push({ key: face.id.slice(0, 10) + "-" + gid, d: o.d, x: pen, ...(run.dx?.[i] ? { dx: run.dx[i] } : {}), ...(run.dy?.[i] ? { dy: run.dy[i] } : {}) });
      pen += chars ? chars[i] : run.adv![i];
    });
    return { upem, glyphs };
  }
  /** the faces of these fonts at hand for width(), waiting at most the budget (a face that comes later: onLate) */
  async prepare(fonts: string[]) { this.sh = await this.shaper; await Promise.all(fonts.map(c => this.faceSoon(c))); }

  async maxDigitWidth(css: string): Promise<number> {
    const face = await this.faceSoon(css), fp = parseFont(css);
    if (!face || !fp) { this.stats.page++; return this.fallback.maxDigitWidth(css); }
    const sh = await this.shaper;
    this.stats.font++;
    let m = 0; for (const d of "0123456789") m = Math.max(m, this.w(sh, face, d, fp.size));
    return m;
  }
  async measureRuns(runs: RunReq[]): Promise<RunMetrics[]> {
    const sh = await this.shaper, faces = await Promise.all(runs.map(r => this.faceSoon(r.font)));
    const out: RunMetrics[] = new Array(runs.length), rest: number[] = [];
    runs.forEach((r, i) => {
      const face = faces[i], fp = parseFont(r.font);
      if (!face || !fp || !covers(face, r.text)) { rest.push(i); return; }
      const v = verticalMetrics(face), tnum = !!r.tnum;
      // ascent and descent rounded to whole pixels, as Chromium's font metrics are
      out[i] = { w: r.text ? this.w(sh, face, r.text, fp.size, tnum) : 0, asc: Math.round(v.asc * fp.size), desc: Math.round(v.desc * fp.size),
        ...(tnum && r.text ? { adv: [...r.text].map(ch => this.w(sh, face, ch, fp.size, true)) } : {}) };
    });
    this.stats.font += runs.length - rest.length; this.stats.page += rest.length;
    if (rest.length) {
      const ans = await this.fallback.measureRuns!(rest.map(i => runs[i]));
      rest.forEach((i, k) => { out[i] = ans[k]; });
    }
    return out;
  }
  async breakLines(reqs: LinesReq[]): Promise<string[][]> {
    const sh = await this.shaper, faces = await Promise.all(reqs.map(r => this.faceSoon(r.font)));
    const out: string[][] = new Array(reqs.length), rest: number[] = [];
    reqs.forEach((r, i) => {
      const face = faces[i], fp = parseFont(r.font);
      if (!face || !fp || !covers(face, r.text)) { rest.push(i); return; }
      out[i] = wrapLines(r.text, r.width, s => this.w(sh, face, s, fp.size));
    });
    if (rest.length) {
      const ans = await this.fallback.breakLines!(rest.map(i => reqs[i]));
      rest.forEach((i, k) => { out[i] = ans[k]; });
    }
    return out;
  }
}
