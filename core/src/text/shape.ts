/* Text shaping, line breaking and fitting from font files (03 §2.6, ADR-005). HarfBuzz shapes with its default
   features (kern and liga on for horizontal text, as Chromium and Excel), at the font's units per em; advances are
   scaled to the size in slide px. Until S4.4 the designs still measure with the page's browser layout (decision
   2026-10-12, 3); the PDF writer places glyphs from shape() (advances, mark offsets), and these functions are what
   S4.4 switches to. */
import type { TextNode } from "../dl/types";
import type { FaceInfo } from "./fonts";
import { decode64, Hb, instantiate } from "./hb";

/** a shaped run: glyph ids, their x advances in px, the UTF-16 index of each glyph's cluster, the glyphs' offsets
    from their pen position (px, y up as HarfBuzz gives them: marks placed on their base), the total width */
export interface Shaped { gids: number[]; adv: number[]; cl: number[]; dx: number[]; dy: number[]; w: number }
export interface Line {
  text: string;
  /** UTF-16 offsets in the paragraph text (white-space "normal": in the collapsed text) */
  start: number; end: number;
  /** width without the trailing spaces, px */
  w: number;
}

export class Shaper {
  private fonts = new Map<string, { font: number; upem: number }>();
  constructor(private hb: Hb) {}

  private hbFont(face: FaceInfo) {
    let f = this.fonts.get(face.id);
    if (!f) {
      const hb = this.hb, blob = hb.blob(face.data), hface = hb.fn("hb_face_create")(blob.ptr, 0);
      const upem = hb.fn("hb_face_get_upem")(hface), font = hb.fn("hb_font_create")(hface);
      hb.fn("hb_font_set_scale")(font, upem, upem);
      hb.fn("hb_face_destroy")(hface);                 // the font keeps its face, the face keeps its blob
      hb.fn("hb_blob_destroy")(blob.ptr);
      f = { font, upem };
      this.fonts.set(face.id, f);
    }
    return f;
  }

  /** glyphs and advances of a string in a face at a size (px) */
  shape(face: FaceInfo, text: string, size: number): Shaped {
    const hb = this.hb, { font, upem } = this.hbFont(face);
    if (!text) return { gids: [], adv: [], cl: [], dx: [], dy: [], w: 0 };
    const buf = hb.fn("hb_buffer_create")(), n = text.length, p = hb.e.malloc(2 * n);
    const u16 = new Uint16Array(hb.e.memory.buffer, p, n);
    for (let i = 0; i < n; i++) u16[i] = text.charCodeAt(i);
    hb.fn("hb_buffer_add_utf16")(buf, p, n, 0, n);
    hb.e.free(p);
    hb.fn("hb_buffer_guess_segment_properties")(buf);
    hb.fn("hb_shape")(font, buf, 0, 0);
    const len = hb.fn("hb_buffer_get_length")(buf), infos = hb.fn("hb_buffer_get_glyph_infos")(buf, 0) >> 2, pos = hb.fn("hb_buffer_get_glyph_positions")(buf, 0) >> 2;
    const u32 = hb.u32, i32 = hb.i32, k = size / upem, gids: number[] = [], adv: number[] = [], cl: number[] = [], dx: number[] = [], dy: number[] = [];
    let w = 0;
    for (let i = 0; i < len; i++) {
      gids.push(u32[infos + 5 * i]); cl.push(u32[infos + 5 * i + 2]);
      const a = i32[pos + 5 * i] * k; adv.push(a); w += a;
      dx.push(i32[pos + 5 * i + 2] * k); dy.push(i32[pos + 5 * i + 3] * k);
    }
    hb.fn("hb_buffer_destroy")(buf);
    return { gids, adv, cl, dx, dy, w };
  }
  /** a text node's glyph run from its face: gids, advances, clusters and mark offsets. When the node has a measured
      width (the screen measured it) the difference is spread over the gaps between clusters – after each cluster but
      the last, as SVG textLength does – so marks stay on their bases and kerning is kept */
  shapeNode(face: FaceInfo, n: TextNode): TextNode {
    const s = this.shape(face, n.src, n.size);
    if (!s.gids.length) return n;
    let adv = s.adv;
    if (n.w !== undefined && Math.abs(n.w - s.w) > 1e-3) {
      // the last glyph of each cluster but the final one takes an equal share
      const ends = s.cl.map((c, i) => i + 1 < s.cl.length && s.cl[i + 1] !== c);
      const gaps = ends.filter(Boolean).length;
      if (gaps) { const d = (n.w - s.w) / gaps; adv = adv.map((a, i) => ends[i] ? a + d : a); }
    }
    const offs = s.dx.some(v => Math.abs(v) > 1e-6) || s.dy.some(v => Math.abs(v) > 1e-6);
    return { ...n, gids: s.gids, adv, cl: s.cl, ...(offs ? { dx: s.dx, dy: s.dy } : {}), w: n.w ?? s.w };
  }
  width(face: FaceInfo, text: string, size: number) { return this.shape(face, text, size).w; }

  /** lines of a paragraph text ("\n" ends a line) wrapped greedily at `width`: breaks after spaces and hyphens, and
      inside a word that is longer than a line (as Excel and CSS overflow-wrap do). Widths come from one shaping of
      each paragraph, so kerning across a break is kept as on screen */
  breakLines(face: FaceInfo, text: string, size: number, width: number, space: "pre-wrap" | "normal" = "pre-wrap"): Line[] {
    const out: Line[] = [];
    let base = 0;
    // white-space: pre-wrap (text boxes, .tnote) keeps the text as typed; normal (automated comments, wrapping cells)
    // makes every run of white space one space, line breaks included
    for (const para of space === "normal" ? [text.replace(/[ \t\n\r\f]+/g, " ")] : text.split("\n")) {
      this.breakPara(face, para, size, width, base, out, space);
      base += para.length + 1;
    }
    return out;
  }
  private breakPara(face: FaceInfo, para: string, size: number, width: number, base: number, out: Line[], space: "pre-wrap" | "normal") {
    if (!para) { out.push({ text: "", start: base, end: base, w: 0 }); return; }
    const s = this.shape(face, para, size);
    // advance of each UTF-16 unit: a cluster's advance goes to its first unit; a line may only break where a cluster
    // starts (never between a letter and its accent)
    const unit = new Float64Array(para.length), starts = new Uint8Array(para.length + 1);
    s.cl.forEach((c, i) => { unit[c] += s.adv[i]; starts[c] = 1; });
    starts[para.length] = 1;
    const widthOf = (a: number, b: number) => { let w = 0; for (let i = a; i < b; i++) w += unit[i]; return w; };
    const trimmed = (a: number, b: number) => { while (b > a && para[b - 1] === " ") b--; return widthOf(a, b); };
    // break opportunities: after a run of spaces, after a hyphen
    const opps: number[] = [];
    for (let i = 1; i < para.length; i++) if ((para[i - 1] === " " && para[i] !== " ") || (para[i - 1] === "-" && para[i] !== " " && i > 1 && para[i - 2] !== " ")) opps.push(i);
    opps.push(para.length);
    let start = 0;
    while (start < para.length) {
      // spaces at the start of a line go after a soft wrap (pre-wrap keeps a paragraph's own indent; normal drops it too)
      if (start > 0 || space === "normal") while (start < para.length && para[start] === " ") start++;
      if (start >= para.length) break;
      // the furthest break opportunity whose line (without its trailing spaces) fits
      let best = -1;
      for (const end of opps) { if (end <= start) continue; if (trimmed(start, end) <= width + 1e-6) best = end; else break; }
      if (best < 0) {
        // the next word alone is wider than the line: break it between characters (at least one per line)
        const end = opps.find(o => o > start)!;
        let i = start, w = 0;
        while (i < end && para[i] !== " ") {
          let j = i + 1; while (j < end && !starts[j]) j++;      // the whole cluster
          let cw = 0; for (let q = i; q < j; q++) cw += unit[q];
          if (w + cw > width + 1e-6 && i > start) break;
          w += cw; i = j;
        }
        while (i < end && para[i] === " ") i++;          // spaces stay at the end of the line they follow
        best = i;
      }
      out.push(this.line(para, start, best, trimmed(start, best), base));
      start = best;
    }
  }
  private line(para: string, a: number, b: number, w: number, base: number): Line {
    return { text: para.slice(a, b).replace(/ +$/, ""), start: base + a, end: base + b, w };
  }

  /** text boxes' rule (v3's fitNoteSize): from `size` down in 1 px steps while above 9 px, the first size at which the
      lines fit the box (line height = size · lh); a start of 9 px or less is kept as it is */
  fitText(face: FaceInfo, text: string, size: number, box: { w: number; h: number }, lh = 1.2, space: "pre-wrap" | "normal" = "pre-wrap"): { size: number; lines: Line[]; fits: boolean } {
    const at = (s: number) => { const lines = this.breakLines(face, text, s, box.w, space); return { lines, fits: lines.length * s * lh <= box.h + 1e-6 && lines.every(l => l.w <= box.w + 1e-6) }; };
    let s = size, r = at(s);
    while (s > 9 && !r.fits) { s -= 1; r = at(s); }
    return { size: s, lines: r.lines, fits: r.fits };
  }
}

let current: Promise<Shaper> | null = null;
/** the core's shaper (loads hb.wasm once) */
export function shaper(): Promise<Shaper> {
  return current ||= import("./wasm/hb-wasm").then(m => instantiate(decode64(m.HB_WASM))).then(e => new Shaper(new Hb(e)));
}
