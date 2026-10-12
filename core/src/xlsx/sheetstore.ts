/* Sheets as columns of typed arrays (PLAN S2.3, 03-architecture §2.3): a single pass over the sheet XML's
   bytes, no object per cell. The scanner reads exactly what v3's regex parser read (the reference is kept in
   tests/sheet-v3.ts and compared cell by cell): namespace prefixes, rows and cells without r, the types
   s / inlineStr / str / b / e / d and numbers (dates by number format), rich text and phonetic runs,
   entities and _xHHHH_ escapes, <v xml:space=…>; and, like it, only double-quoted attributes and the first
   <v>/<is> of a cell. The Sheet facade (workbook.ts makeSheet) materialises a v3 Cell object on request.

   Per cell: col (Uint16) · kind (Uint8) · xf (Uint16) · num (Float64: the number, the date serial, 0/1, or
   the index of a string) – 13 bytes, against ~150 for a Cell object and its Map key. Cells are kept sorted
   by row, then column (row offsets for lookups); a duplicated cell keeps its last value, and iteration
   follows v3's Map order (first occurrence) also when the file is not sorted. Row information is kept sorted by
   row (nothing iterates it). Only invalid input reads differently from v3: a column past 65 535 is dropped, and a
   row number is an integer (v3 kept "2.5" or NaN as keys no lookup could find). */
import { isDateFmt } from "./numfmt";
import { richRuns, xdec } from "./strings";
import type { Cell, CellType, RowInfo, Script, Shared, Xf } from "./types";

export const enum Kind { Blank = 0, Num = 1, Date = 2, Shared = 3, Str = 4, Bool = 5, Err = 6 }

export interface SheetColumns {
  n: number;
  col: Uint16Array; kind: Uint8Array; xf: Uint16Array; num: Float64Array;
  /** distinct row numbers, ascending, and where each row's cells start (length rows.length + 1) */
  rows: Int32Array; rowOff: Int32Array;
  /** iteration order (v3's Map order) when it differs from the sorted order */
  order: Int32Array | null;
  /** strings of this sheet (str, inline strings, errors), shared by equal values */
  strs: string[];
  /** superscript / subscript runs of inline strings, by cell index */
  runs: Map<number, Script[]>;
}
export interface RowColumns {
  rows: Int32Array; h: Float64Array; hidden: Uint8Array;
  /** row style (customFormat="1"): hasS[i] = 1 and s[i] the index (may be NaN, as +"…" in v3) */
  hasS: Uint8Array; s: Float64Array;
}

/* ------------------------------------------------------------------------------------------- the scanner */
const LT = 60, GT = 62, SL = 47, QU = 34, EQ = 61, COLON = 58;
/* character classes, one table lookup each: 1 white space, 2 \w, 4 [\w:.-], 8 [A-Za-z0-9], 16 [A-Za-z] */
const CC = new Uint8Array(256);
for (let c = 0; c < 256; c++) {
  const al = (c >= 65 && c <= 90) || (c >= 97 && c <= 122), dg = c >= 48 && c <= 57, w = al || dg || c === 95;
  CC[c] = (c === 32 || (c >= 9 && c <= 13) ? 1 : 0) | (w ? 2 : 0) | (w || c === 58 || c === 46 || c === 45 ? 4 : 0) | (al || dg ? 8 : 0) | (al ? 16 : 0);
}
const isWs = (c: number) => (CC[c] & 1) !== 0;
/** \w of a regex */
const isW = (c: number) => (CC[c] & 2) !== 0;
/** [\w:.-] (v3's attribute names) */
const isAttrName = (c: number) => (CC[c] & 4) !== 0;
const isAlnum = (c: number) => (CC[c] & 8) !== 0;
const isAlpha = (c: number) => (CC[c] & 16) !== 0;
const utf8 = new TextDecoder("utf-8");
/** FNV-1a of the bytes, mixed with the length and spread over the low bits (the table's index) */
const mix = (h: number, L: number) => { h ^= L; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); return h ^ (h >>> 12); };
const POW10 = Array.from({ length: 23 }, (_, i) => 10 ** i);

/** a growable typed array */
class Grow<T extends Int32Array | Float64Array | Uint8Array> {
  n = 0;
  constructor(public a: T, private readonly A: new (n: number) => T) {}
  push(v: number) { if (this.n === this.a.length) { const b = new this.A(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  get(i: number) { return this.a[i]; }
  set(i: number, v: number) { this.a[i] = v; }
  /** exactly the used part (a copy) */
  done(): T { return this.a.slice(0, this.n) as T; }
}
const i32 = (n = 1024) => new Grow(new Int32Array(n), Int32Array), f64 = (n = 1024) => new Grow(new Float64Array(n), Float64Array), u8 = (n = 1024) => new Grow(new Uint8Array(n), Uint8Array);

/** grow-as-you-go columns while scanning */
class Cols {
  n = 0; cap: number;
  row: Int32Array; col: Uint16Array; kind: Uint8Array; xf: Uint16Array; num: Float64Array;
  constructor(cap = 1 << 14) { this.cap = cap; this.row = new Int32Array(cap); this.col = new Uint16Array(cap); this.kind = new Uint8Array(cap); this.xf = new Uint16Array(cap); this.num = new Float64Array(cap); }
  push(r: number, c: number, k: number, x: number, v: number) {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.row[i] = r; this.col[i] = c; this.kind[i] = k; this.xf[i] = x; this.num[i] = v;
    return i;
  }
  private grow() {
    const cap = this.cap * 2, g = <T extends Int32Array | Uint16Array | Uint8Array | Float64Array>(a: T, A: new (n: number) => T) => { const b = new A(cap); b.set(a); return b; };
    this.row = g(this.row, Int32Array); this.col = g(this.col, Uint16Array); this.kind = g(this.kind, Uint8Array); this.xf = g(this.xf, Uint16Array); this.num = g(this.num, Float64Array);
    this.cap = cap;
  }
}

/** one pass over <sheetData>…</sheetData>, resumable: run(budget) reads up to `budget` rows */
export class SheetScanner {
  private i: number;
  private readonly start: number;
  private lastRow = 0;
  readonly cells = new Cols();
  private readonly runs = new Map<number, Script[]>();
  private readonly strs: string[] = [];
  private readonly strIx = new Map<string, number>();
  /* byte interning (no string is made for a value seen before): an open-addressing table of string indices,
     keyed by a hash of the bytes; where each string's bytes are (in this sheet's XML) for the comparison */
  /** slots of 4: string index (-1 = free), hash, offset and length of its bytes – one cache line per probe */
  private hTab = new Int32Array(4 << 14).fill(-1);
  private hUsed = 0;
  private readonly rowR = i32(); private readonly rowH = f64(); private readonly rowHid = u8();
  private readonly rowHasS = u8(); private readonly rowS = f64();
  /** isDateFmt per xf index (0 = unknown, 1 = no, 2 = yes) */
  private readonly dateXf: Uint8Array;
  // the attributes of the tag being read
  private aR = -1; private aR1 = -1; private aT = -1; private aT1 = -1; private aS = -1; private aS1 = -1;
  private aHt = -1; private aHt1 = -1; private aHid = -1; private aHid1 = -1; private aCf = -1; private aCf1 = -1;

  constructor(private readonly b: Uint8Array, start: number, private readonly end: number, private readonly ctx: Shared, private readonly defRowH: number) {
    this.i = this.start = start;
    this.dateXf = new Uint8Array(Math.max(1, ctx.xfs.length));
  }
  /** how far the scan got (0…1), for progress */
  get progress() { return (this.i - this.start) / Math.max(1, this.end - this.start); }

  run(budget = Infinity): boolean {
    const b = this.b, end = this.end; let rows = 0;
    for (;;) {
      let i = this.i;
      while (i < end && b[i] !== LT) i++;
      if (i >= end) { this.i = end; return true; }
      this.name(i + 1);
      if (this.nl === 3 && b[this.na] === 114 && b[this.na + 1] === 111 && b[this.na + 2] === 119) {   // <row (and a non-word character)
        this.i = this.readRow(i, this.na + 3);
        if (++rows >= budget) return this.i >= end;
      } else this.i = i + 1;
    }
  }

  // the tag name read last by name(): its local part starts at na and has nl word characters
  private na = 0; private nl = 0;
  /** the local name of a tag at p (just after "<" or "</"): v3's (?:\w+:)? prefix, then word characters */
  private name(p: number) {
    const b = this.b, end = this.end; let q = p;
    while (q < end && isW(b[q])) q++;
    if (b[q] === COLON && q > p) { const at = q + 1; let e = at; while (e < end && isW(b[e])) e++; this.na = at; this.nl = e - at; }
    else { this.na = p; this.nl = q - p; }
  }
  /** after name(): the name is s, followed by a character that is not a word character (v3: name\b) */
  private named(s: string): boolean {
    const b = this.b, L = s.length;
    if (this.nl !== L) return false;
    for (let k = 0; k < L; k++) if (b[this.na + k] !== s.charCodeAt(k)) return false;
    return true;
  }
  /** at k ("</"): read the end tag's name; true when ">" follows it right away (v3: <\/(?:\w+:)?name>) */
  private endName(k: number): boolean { this.name(k + 2); return this.b[this.na + this.nl] === GT; }
  /** at k: an end tag </s> or </x:s> with ">" right after the name (v3: <\/(?:\w+:)?s>); returns the position after it, or -1 */
  private endTag(k: number, s: string): number {
    const b = this.b;
    if (b[k] !== LT || b[k + 1] !== SL) return -1;
    this.name(k + 2);
    if (!this.named(s) || b[this.na + this.nl] !== GT) return -1;
    return this.na + this.nl + 1;
  }

  /** <row …> at i (its attributes from a); returns where reading continues */
  private readRow(i: number, a: number): number {
    const b = this.b, end = this.end;
    let gt = a; while (gt < end && b[gt] !== GT) gt++;
    if (gt >= end) return end;
    const self = b[gt - 1] === SL;
    this.attrs(a, self ? gt - 1 : gt, true);
    const saved = this.lastRow, savedN = this.cells.n;
    let r: number;
    if (this.aR < 0) r = this.lastRow + 1;
    else if (this.plain(this.aR, this.aR1)) r = this.aR1 > this.aR ? this.num(this.aR, this.aR1, false) : this.lastRow + 1;   // r="" is falsy
    else { const s = this.val(this.aR, this.aR1); r = s ? +s : this.lastRow + 1; }
    const htS = this.aHt >= 0 ? this.val(this.aHt, this.aHt1) : "", hidS = this.aHid >= 0 ? this.val(this.aHid, this.aHid1) : "";
    const cfS = this.aCf >= 0 ? this.val(this.aCf, this.aCf1) : "", sS = this.aS >= 0 ? this.val(this.aS, this.aS1) : "";
    const commit = () => {
      this.lastRow = r;
      this.rowR.push(r); this.rowH.push(htS ? +htS : this.defRowH); this.rowHid.push(hidS === "1" || hidS === "true" ? 1 : 0);
      if (cfS === "1") { this.rowHasS.push(1); this.rowS.push(+(sS || 0)); } else { this.rowHasS.push(0); this.rowS.push(0); }
    };
    if (self) { commit(); return gt + 1; }
    // cells up to the first </row>; v3 skipped a row without one (then everything read from it is undone)
    let p = gt + 1, lastCol = 0;
    for (;;) {
      while (p < end && b[p] !== LT) p++;
      if (p >= end) { this.cells.n = savedN; for (const k of this.runs.keys()) if (k >= savedN) this.runs.delete(k); this.lastRow = saved; return i + 1; }
      if (b[p + 1] === SL) { const after = this.endTag(p, "row"); if (after >= 0) { commit(); return after; } p++; continue; }
      this.name(p + 1);
      if (this.named("c") && !isW(b[this.na + 1])) {
        const next = this.readCell(this.na + 1, r, lastCol);
        if (next < 0) { p++; continue; }                            // unclosed: v3's regex found no cell here
        if (this.lastC >= 0) lastCol = this.lastC;
        p = next; continue;
      }
      p++;
    }
  }

  private lastC = -1;
  // what commonBody found
  private f0 = -1; private f1 = -1; private i0 = -1; private i1 = -1;
  /** a body that is exactly <v>TEXT</v></c> or <is><t>TEXT</t></is></c> (TEXT without "<"): sets f0/f1 or i0/i1 (and,
      for a plain inline text, ta/tb/th) and returns the position after </c>; -1 = any other body (read in general) */
  private commonBody(p: number): number {
    const b = this.b, end = this.end;
    this.f0 = this.f1 = this.i0 = this.i1 = -1;
    if (b[p] !== LT) return -1;
    if (b[p + 1] === 118 && b[p + 2] === GT) {                      // <v>
      const t0 = p + 3; let t1 = t0; while (t1 < end && b[t1] !== LT) t1++;
      if (b[t1 + 1] !== SL || b[t1 + 2] !== 118 || b[t1 + 3] !== GT || b[t1 + 4] !== LT || b[t1 + 5] !== SL || b[t1 + 6] !== 99 || b[t1 + 7] !== GT) return -1;
      this.f0 = t0; this.f1 = t1; return t1 + 8;
    }
    if (b[p + 1] === 105 && b[p + 2] === 115 && b[p + 3] === GT && b[p + 4] === LT && b[p + 5] === 116 && b[p + 6] === GT) {   // <is><t>
      const t0 = p + 7; let t1 = t0, h = 0x811c9dc5, plain = true;
      for (; t1 < end; t1++) { const ch = b[t1]; if (ch === LT) break; if (ch === 38 || ch === 95) plain = false; h = Math.imul(h ^ ch, 16777619); }
      if (b[t1 + 1] !== SL || b[t1 + 2] !== 116 || b[t1 + 3] !== GT || b[t1 + 4] !== LT || b[t1 + 5] !== SL || b[t1 + 6] !== 105 || b[t1 + 7] !== 115 || b[t1 + 8] !== GT
        || b[t1 + 9] !== LT || b[t1 + 10] !== SL || b[t1 + 11] !== 99 || b[t1 + 12] !== GT) return -1;
      this.i0 = p + 4; this.i1 = t1 + 5;
      if (plain) { this.ta = t0; this.tb = t1; this.th = h; }
      return t1 + 13;
    }
    return -1;
  }
  /** a cell whose attributes start at a; returns where reading continues, -1 when it is not closed before </row> */
  private readCell(a: number, r: number, lastCol: number): number {
    const b = this.b, end = this.end;
    let gt = this.cellAttrs(a), fast = gt >= 0;
    if (!fast) { gt = a; while (gt < end && b[gt] !== GT) gt++; }
    if (gt >= end) return -1;
    const self = b[gt - 1] === SL;
    // one pass over the body: the first <v>text</v>, the first <is>…</is>, up to </c>
    let v0 = -1, v1 = -1, is0 = -1, is1 = -1, next = gt + 1;
    this.th = -1; this.f0 = this.f1 = this.i0 = this.i1 = -1;
    if (!self) next = this.commonBody(gt + 1);
    if (next >= 0) { v0 = this.f0; v1 = this.f1; is0 = this.i0; is1 = this.i1; }
    else if (!self) {
      next = gt + 1;
      let k = gt + 1, closed = false;
      for (;;) {
        while (k < end && b[k] !== LT) k++;
        if (k >= end) return -1;
        if (b[k + 1] === SL) {
          if (this.endName(k)) {
            if (this.named("c")) { next = this.na + 2; closed = true; break; }
            if (this.named("row")) return -1;
          }
          k++; continue;
        }
        this.name(k + 1);
        if (v0 < 0 && this.named("v")) {
          let q = this.na + 1;
          if (b[q] !== GT && isWs(b[q])) { while (q < end && b[q] !== GT) q++; }
          if (b[q] === GT) {
            const t0 = q + 1; let t1 = t0; while (t1 < end && b[t1] !== LT) t1++;
            if (this.endTag(t1, "v") >= 0) { v0 = t0; v1 = t1; }
          }
        } else if (is0 < 0 && this.named("is")) {
          let q = this.na + 2;
          if (b[q] !== GT && isWs(b[q])) { while (q < end && b[q] !== GT) q++; }
          if (b[q] === GT) {
            for (let m = q + 1; m < end; m++) {                      // its </is> (none before </c>: no match)
              if (b[m] !== LT || b[m + 1] !== SL || !this.endName(m)) continue;
              if (this.named("is")) { is0 = q + 1; is1 = m; break; }
              if (this.named("c") || this.named("row")) break;
            }
          }
        }
        k++;
      }
      if (!closed) return -1;
    }
    if (!fast) this.attrs(a, self ? gt - 1 : gt, false);
    // column: from r (^\$?([A-Z]+)\$?(\d+)$, else the cell is skipped), or the previous one + 1
    let c: number;
    if (this.aR >= 0 && (this.plain(this.aR, this.aR1) ? this.aR1 > this.aR : this.val(this.aR, this.aR1) !== "")) { c = this.colOf(this.aR, this.aR1); if (c < 0) { this.lastC = -1; return next; } }
    else c = lastCol + 1;
    this.lastC = c;
    this.cell(r, c, v0, v1, is0, is1);
    return next;
  }
  private colOf(v0: number, v1: number): number {
    const b = this.b;
    if (!this.plain(v0, v1)) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(this.val(v0, v1)); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
    let k = v0; if (b[k] === 36) k++;
    let n = 0; const l0 = k;
    while (k < v1 && b[k] >= 65 && b[k] <= 90) { n = n * 26 + b[k] - 64; k++; }
    if (k === l0) return -1;
    if (b[k] === 36) k++;
    const d0 = k; while (k < v1 && b[k] >= 48 && b[k] <= 57) k++;
    return k === d0 || k !== v1 ? -1 : n;
  }
  /** the index of the string whose UTF-8 bytes are b[v0, v1) (the text as is: no entity or escape in it) */
  private internBytes(v0: number, v1: number, raw = -1): number {
    const b = this.b, L = v1 - v0;
    const h = raw === -1 ? this.hashAt(v0, L) : mix(raw, L);
    const tab = this.hTab, mask = (tab.length >> 2) - 1;
    for (let slot = h & mask; ; slot = (slot + 1) & mask) {
      const q = slot << 2, i = tab[q];
      if (i < 0) break;
      if (tab[q + 1] !== h || tab[q + 3] !== L) continue;
      const o = tab[q + 2]; let k = 0;
      while (k < L && b[o + k] === b[v0 + k]) k++;
      if (k === L) return i;
    }
    const i = this.strs.length;
    this.strs.push(this.str(v0, v1));
    this.hPut(i, h, v0, L);
    return i;
  }
  private hPut(i: number, h: number, o: number, L: number) {
    if ((this.hUsed + 1) * 2 > this.hTab.length >> 2) {             // grow at half full
      const old = this.hTab; this.hTab = new Int32Array(old.length * 2).fill(-1); this.hUsed = 0;
      for (let q = 0; q < old.length; q += 4) if (old[q] >= 0) this.hPut(old[q], old[q + 1], old[q + 2], old[q + 3]);
    }
    const tab = this.hTab, mask = (tab.length >> 2) - 1;
    let slot = h & mask; while (tab[slot << 2] >= 0) slot = (slot + 1) & mask;
    const q = slot << 2; tab[q] = i; tab[q + 1] = h; tab[q + 2] = o; tab[q + 3] = L; this.hUsed++;
  }
  private hashAt(o: number, L: number) {
    const b = this.b; let h = 0x811c9dc5;
    for (let k = o; k < o + L; k++) h = Math.imul(h ^ b[k], 16777619);
    return mix(h, L);
  }
  private intern(s: string): number {
    let i = this.strIx.get(s);
    if (i === undefined) { i = this.strs.length; this.strs.push(s); this.strIx.set(s, i); }
    return i;
  }
  private isDate(x: number): boolean {
    let d = this.dateXf[x];
    if (!d) { const xf = this.ctx.xfs[x] || this.ctx.xfs[0]; d = this.dateXf[x] = xf && isDateFmt(xf.fmt) ? 2 : 1; }
    return d === 2;
  }

  private cell(r: number, c: number, v0: number, v1: number, is0: number, is1: number) {
    const b = this.b;
    // the style: v3 used ctx.xfs[+(s || 0)] || ctx.xfs[0] – an invalid index means 0
    let x = 0;
    if (this.aS >= 0) {
      const n = this.plain(this.aS, this.aS1) ? (this.aS1 > this.aS ? this.num(this.aS, this.aS1, false) : 0) : +(this.val(this.aS, this.aS1) || 0);
      x = Number.isInteger(n) && n >= 0 && n < 65536 && this.ctx.xfs[n] ? n : 0;
    }
    // the type: t (default "n")
    let t = "n";
    if (this.aT >= 0) {
      const t0 = this.aT, t1 = this.aT1, L = t1 - t0, c0 = b[t0];
      t = L === 1 && c0 === 115 ? "s" : L === 1 && c0 === 110 ? "n" : L === 9 && this.eq(t0, t1, "inlineStr") ? "inlineStr" : L === 3 && this.eq(t0, t1, "str") ? "str"
        : L === 1 && c0 === 98 ? "b" : L === 1 && c0 === 101 ? "e" : L === 1 && c0 === 100 ? "d" : (this.val(t0, t1) || "n");
    }
    const vt = v0 >= 0;
    let kind = Kind.Blank, num = 0;
    if (t === "s" && vt) { kind = Kind.Shared; num = v1 > v0 ? this.num(v0, v1, false) : 0; }
    else if (t === "inlineStr") {
      if (is0 >= 0) {
        const fast = this.th !== -1 || this.plainT(is0, is1);
        let text: string, scr: Script[] | undefined; void text!;
        kind = Kind.Str;
        if (fast) num = this.internBytes(this.ta, this.tb, this.th);
        else { const rr = richRuns(utf8.decode(b.subarray(is0, is1))); text = rr.text; scr = rr.scr; num = this.intern(text); }
        if (scr) { if (c > 65535) return; const i = this.cells.push(r, c, kind, x, num); this.runs.set(i, scr); return; }
      }
    }
    else if (t === "str" && vt) { kind = Kind.Str; num = this.plain(v0, v1) ? this.internBytes(v0, v1) : this.intern(xdec(this.str(v0, v1))); }
    else if (t === "b" && vt) { kind = Kind.Bool; num = this.eq(v0, v1, "1") ? 1 : 0; }
    else if (t === "e" && vt) { kind = Kind.Err; num = this.internBytes(v0, v1); }
    else if (t === "d" && vt) { kind = Kind.Date; num = (Date.parse(this.str(v0, v1)) / 86400000) + 25569; }
    else if (vt && v1 > v0) { num = this.num(v0, v1, false); kind = this.isDate(x) ? Kind.Date : Kind.Num; }
    if (c > 65535) return;                                          // far past Excel's last column (16 384): invalid, not kept
    this.cells.push(r, c, kind, x, num);
  }
  // the text range found by plainT
  private ta = 0; private tb = 0;
  /** the FNV hash of [ta, tb) when commonBody computed it, else -1 */
  private th = -1;
  /** an inline string that is one plain <t>…</t> (no markup, entity or escape in it): sets ta/tb */
  private plainT(p: number, z: number): boolean {
    const b = this.b;
    if (b[p] !== LT || b[p + 1] !== 116) return false;              // <t
    let q = p + 2;
    if (b[q] !== GT) { if (!isWs(b[q])) return false; while (q < z && b[q] !== GT) q++; if (q >= z || b[q - 1] === SL) return false; }
    const t0 = q + 1; let t1 = t0;
    while (t1 < z) { const ch = b[t1]; if (ch === LT) break; if (ch === 38 || ch === 95) return false; t1++; }
    if (t1 + 4 !== z || b[t1 + 1] !== SL || b[t1 + 2] !== 116 || b[t1 + 3] !== GT) return false;   // exactly </t> then the end
    this.ta = t0; this.tb = t1;
    return true;
  }

  /** v3 xattrs over [a, z): only double-quoted values; a prefix like x: is dropped; a later duplicate wins */
  private attrs(a: number, z: number, row: boolean) {
    const b = this.b;
    this.aR = this.aT = this.aS = this.aHt = this.aHid = this.aCf = -1;
    let p = a;
    while (p < z) {
      if (!isAttrName(b[p])) { p++; continue; }
      const n0 = p; while (p < z && isAttrName(b[p])) p++;
      const n1 = p; let q = p; while (q < z && isWs(b[q])) q++;
      if (b[q] !== EQ) continue;
      q++; while (q < z && isWs(b[q])) q++;
      if (b[q] !== QU) continue;
      const v0 = q + 1; let v1 = v0; while (v1 < z && b[v1] !== QU) v1++;
      if (v1 >= z) continue;                                       // no closing quote: no match here
      p = v1 + 1;
      // the name without its prefix (^[A-Za-z0-9]+:(?=[A-Za-z]))
      let s0 = n0; { let k = n0; while (k < n1 && isAlnum(b[k])) k++; if (k > n0 && k + 1 < n1 && b[k] === COLON && isAlpha(b[k + 1])) s0 = k + 1; }
      const L = n1 - s0, c0 = b[s0];
      if (L === 1 && c0 === 114) { this.aR = v0; this.aR1 = v1; }                       // r
      else if (L === 1 && c0 === 115) { this.aS = v0; this.aS1 = v1; }                  // s
      else if (!row && L === 1 && c0 === 116) { this.aT = v0; this.aT1 = v1; }          // t
      else if (row && L === 2 && c0 === 104 && b[s0 + 1] === 116) { this.aHt = v0; this.aHt1 = v1; }   // ht
      else if (row && L === 6 && this.is(s0, "hidden")) { this.aHid = v0; this.aHid1 = v1; }
      else if (row && L === 12 && this.is(s0, "customFormat")) { this.aCf = v0; this.aCf1 = v1; }
    }
  }
  /** the common case of a cell's attributes, read in one pass: only r, s and t, each as ` x="value"` (no ">" in a
      value), then ">" or "/>"; sets them like attrs() and returns the position of ">", or -1 for anything else */
  private cellAttrs(a: number): number {
    const b = this.b, end = this.end;
    this.aR = this.aT = this.aS = -1;
    let p = a;
    for (;;) {
      const c = b[p];
      if (c === GT) return p;
      if (c === SL && b[p + 1] === GT) return p + 1;
      if (c !== 32) return -1;
      const n = b[p + 1];
      if ((n !== 114 && n !== 115 && n !== 116) || b[p + 2] !== EQ || b[p + 3] !== QU) return -1;
      const v0 = p + 4; let v1 = v0;
      while (v1 < end) { const x = b[v1]; if (x === QU) break; if (x === GT) return -1; v1++; }
      if (v1 >= end) return -1;
      if (n === 114) { this.aR = v0; this.aR1 = v1; } else if (n === 115) { this.aS = v0; this.aS1 = v1; } else { this.aT = v0; this.aT1 = v1; }
      p = v1 + 1;
    }
  }
  private is(p: number, s: string) { for (let k = 0; k < s.length; k++) if (this.b[p + k] !== s.charCodeAt(k)) return false; return true; }
  /** an attribute value as v3 saw it: decoded, entities and _xHHHH_ resolved */
  private val(v0: number, v1: number): string { return xdec(this.str(v0, v1)); }
  private str(v0: number, v1: number): string {
    const b = this.b;
    if (v1 - v0 <= 24) { let s = ""; for (let k = v0; k < v1; k++) { const c = b[k]; if (c >= 128) return utf8.decode(b.subarray(v0, v1)); s += String.fromCharCode(c); } return s; }
    return utf8.decode(b.subarray(v0, v1));
  }
  /** the value equals s (no entity or escape in it) */
  private eq(v0: number, v1: number, s: string) { return v1 - v0 === s.length && this.is(v0, s); }
  private plain(v0: number, v1: number) { for (let k = v0; k < v1; k++) { const c = this.b[k]; if (c === 38 || c === 95) return false; } return true; }
  /** +value: a plain integer fast, anything else as JavaScript reads it */
  private num(v0: number, v1: number, decode: boolean): number {
    const b = this.b; let k = v0, neg = false;
    if (b[k] === 45) { neg = true; k++; }
    if (k < v1 && v1 - k <= 16) {
      // up to 15 digits with an optional point: the integer mantissa and 10^decimals are exact, so one division
      // rounds exactly as JavaScript's own reading does (Clinger's fast path)
      let x = 0, ok = true, digits = 0, dec = -1;
      for (let j = k; j < v1; j++) {
        const c = b[j];
        if (c === 46 && dec < 0) { dec = 0; continue; }
        const d = c - 48; if (d < 0 || d > 9) { ok = false; break; }
        x = x * 10 + d; digits++; if (dec >= 0) dec++;
      }
      if (ok && digits > 0 && digits <= 15) { const v = dec > 0 ? x / POW10[dec] : x; return neg ? -v : v; }
    }
    return +(decode ? this.val(v0, v1) : this.str(v0, v1));
  }

  /** the columns, sorted, after the last run() */
  finish(): { cells: SheetColumns; rows: RowColumns } {
    return { cells: sortCells(this.cells, this.runs, this.strs), rows: sortRows(this.rowR.done(), this.rowH.done(), this.rowHid.done(), this.rowHasS.done(), this.rowS.done()) };
  }
}

function sortCells(C: Cols, runs: Map<number, Script[]>, strs: string[]): SheetColumns {
  const n0 = C.n, row = C.row;
  let sorted = true;
  for (let i = 1; i < n0; i++) if (row[i] < row[i - 1] || (row[i] === row[i - 1] && C.col[i] <= C.col[i - 1])) { sorted = false; break; }
  if (sorted) {
    const rowsL: number[] = [], off: number[] = [];
    for (let i = 0; i < n0; i++) if (i === 0 || row[i] !== row[i - 1]) { rowsL.push(row[i]); off.push(i); }
    off.push(n0);
    return { n: n0, col: C.col.slice(0, n0), kind: C.kind.slice(0, n0), xf: C.xf.slice(0, n0), num: C.num.slice(0, n0), rows: Int32Array.from(rowsL), rowOff: Int32Array.from(off), order: null, strs, runs };
  }
  // not sorted, or duplicates: v3's Map kept the first position and the last value of each "r,c"
  const byKey = new Map<number, number>();
  for (let i = 0; i < n0; i++) byKey.set(row[i] * 65536 + C.col[i], i);
  const iter = Array.from(byKey.values());
  const srt = iter.slice().sort((p, q) => row[p] - row[q] || C.col[p] - C.col[q]);
  const n = srt.length, col = new Uint16Array(n), kind = new Uint8Array(n), xf = new Uint16Array(n), num = new Float64Array(n);
  const pos = new Map<number, number>(), runs2 = new Map<number, Script[]>(), rowsL: number[] = [], off: number[] = [];
  srt.forEach((src, k) => {
    col[k] = C.col[src]; kind[k] = C.kind[src]; xf[k] = C.xf[src]; num[k] = C.num[src]; pos.set(src, k);
    const sc = runs.get(src); if (sc) runs2.set(k, sc);
    if (k === 0 || row[src] !== row[srt[k - 1]]) { rowsL.push(row[src]); off.push(k); }
  });
  off.push(n);
  const order = Int32Array.from(iter, src => pos.get(src)!);
  return { n, col, kind, xf, num, rows: Int32Array.from(rowsL), rowOff: Int32Array.from(off), order, strs, runs: runs2 };
}
function sortRows(r: Int32Array, h: Float64Array, hid: Uint8Array, hasS: Uint8Array, sv: Float64Array): RowColumns {
  let sorted = true;
  for (let i = 1; i < r.length; i++) if (!(r[i] > r[i - 1])) { sorted = false; break; }
  if (sorted) return { rows: r, h, hidden: hid, hasS, s: sv };
  // v3's Map: the last row element of a number wins
  const last = new Map<number, number>(); r.forEach((x, i) => last.set(x, i));
  const idx = [...last.values()].sort((p, q) => r[p] - r[q]);
  return { rows: Int32Array.from(idx, i => r[i]), h: Float64Array.from(idx, i => h[i]), hidden: Uint8Array.from(idx, i => hid[i]), hasS: Uint8Array.from(idx, i => hasS[i]), s: Float64Array.from(idx, i => sv[i]) };
}

/* ------------------------------------------------------------------------------------------- lookups */
/** index of v in a (ascending) between lo and hi (exclusive), -1 = absent */
export function bsearch(a: ArrayLike<number>, v: number, lo = 0, hi = a.length): number {
  while (lo < hi) { const m = (lo + hi) >> 1, x = a[m]; if (x < v) lo = m + 1; else if (x > v) hi = m; else return m; }
  return -1;
}
/** the cell index at (r, c), -1 = none */
export function cellIndex(S: SheetColumns, r: number, c: number): number {
  const k = bsearch(S.rows, r); if (k < 0) return -1;
  return bsearch(S.col, c, S.rowOff[k], S.rowOff[k + 1]);
}
/** the row of cell index i */
export function rowOfIndex(S: SheetColumns, i: number): number {
  let lo = 0, hi = S.rows.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.rowOff[m] <= i) lo = m; else hi = m - 1; }
  return S.rows[lo];
}
export function rowIndex(R: RowColumns, r: number): number { return bsearch(R.rows, r); }

/** a v3 Cell for cell index i (a new object each time; nothing in the app keeps or changes them) */
export function cellAt(S: SheetColumns, ctx: Shared, i: number, r: number): Cell {
  const c = S.col[i], x = S.xf[i], k = S.kind[i], n = S.num[i];
  const xf: Xf = ctx.xfs[x] || ctx.xfs[0] || ({} as Xf);
  let v: Cell["v"] = null, t: CellType = "blank", scr: Script[] | undefined;
  switch (k) {
    case Kind.Num: v = n; t = "n"; break;
    case Kind.Date: v = n; t = "d"; break;
    case Kind.Shared: v = ctx.sst[n] ?? ""; t = "s"; scr = ctx.sstRuns?.[n]; break;
    case Kind.Str: v = S.strs[n]; t = "s"; scr = S.runs.get(i); break;
    case Kind.Bool: v = n === 1; t = "b"; break;
    case Kind.Err: v = S.strs[n]; t = "e"; break;
  }
  if (t === "s" && v === "") t = "blank";
  return scr ? { r, c, v, t, xf, fmt: xf.fmt, scr } : { r, c, v, t, xf, fmt: xf.fmt };
}
export function rowInfoAt(R: RowColumns, ri: number): RowInfo { return { h: R.h[ri], hidden: R.hidden[ri] === 1, s: R.hasS[ri] ? R.s[ri] : null }; }

/** the cells as v3's Map<"r,c", Cell> (read only): lookups by key, iteration in v3's order */
export class CellMap implements ReadonlyMap<string, Cell> {
  constructor(private readonly S: SheetColumns, private readonly ctx: Shared) {}
  get size() { return this.S.n; }
  private key(k: string): [number, number] | null { const i = k.indexOf(","); if (i < 0) return null; const r = +k.slice(0, i), c = +k.slice(i + 1); return Number.isInteger(r) && Number.isInteger(c) && String(r) === k.slice(0, i) && String(c) === k.slice(i + 1) ? [r, c] : null; }
  get(k: string): Cell | undefined { const rc = this.key(k); if (!rc) return undefined; const i = cellIndex(this.S, rc[0], rc[1]); return i < 0 ? undefined : cellAt(this.S, this.ctx, i, rc[0]); }
  has(k: string): boolean { const rc = this.key(k); return !!rc && cellIndex(this.S, rc[0], rc[1]) >= 0; }
  *entries(): MapIterator<[string, Cell]> { for (const x of this.values()) yield [x.r + "," + x.c, x]; }
  *keys(): MapIterator<string> { for (const x of this.values()) yield x.r + "," + x.c; }
  values(): MapIterator<Cell> {
    const S = this.S, ctx = this.ctx, o = S.order; let j = 0, k = 0;
    const it = {
      next(): IteratorResult<Cell, undefined> {
        if (j >= S.n) return { done: true, value: undefined };
        if (o) { const i = o[j++]; return { done: false, value: cellAt(S, ctx, i, rowOfIndex(S, i)) }; }
        const i = j++; while (S.rowOff[k + 1] <= i) k++;
        return { done: false, value: cellAt(S, ctx, i, S.rows[k]) };
      },
      [Symbol.iterator]() { return it; },
    };
    return it as unknown as MapIterator<Cell>;
  }
  [Symbol.iterator]() { return this.entries(); }
  forEach(fn: (v: Cell, k: string, m: ReadonlyMap<string, Cell>) => void, self?: unknown) { for (const [k, v] of this.entries()) fn.call(self, v, k, this); }
}
/** the rows as v3's Map<number, RowInfo> (read only) */
export class RowMap implements ReadonlyMap<number, RowInfo> {
  constructor(private readonly R: RowColumns) {}
  get size() { return this.R.rows.length; }
  get(r: number) { const i = rowIndex(this.R, r); return i < 0 ? undefined : rowInfoAt(this.R, i); }
  has(r: number) { return rowIndex(this.R, r) >= 0; }
  *entries(): MapIterator<[number, RowInfo]> { for (let i = 0; i < this.R.rows.length; i++) yield [this.R.rows[i], rowInfoAt(this.R, i)]; }
  *keys(): MapIterator<number> { yield* this.R.rows; }
  *values(): MapIterator<RowInfo> { for (let i = 0; i < this.R.rows.length; i++) yield rowInfoAt(this.R, i); }
  [Symbol.iterator]() { return this.entries(); }
  forEach(fn: (v: RowInfo, k: number, m: ReadonlyMap<number, RowInfo>) => void, self?: unknown) { for (const [k, v] of this.entries()) fn.call(self, v, k, this); }
}
