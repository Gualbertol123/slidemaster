/* styles.bin → the same number formats, fonts, fills, borders, cell formats and differential formats as
   workbook.ts reads from styles.xml (MS-XLSB 2.4.661 BrtFont, BrtFill, BrtBorder, BrtXF, BrtFmt, BrtDXF). Each value
   is mapped to what the .xlsx reader makes of the XML Excel writes for it, so a workbook saved both ways styles
   its cells identically (tests/xlsb.test.ts). */
import type { ColorFn } from "../color";
import type { XmlElement } from "../../platform";
import type { Border, Dxf, Font, Xf } from "../types";
import { Records, Rt, XlsbError, readColor, recName, type ColorAttrs } from "./records";

export interface BinStyles {
  xfs: Xf[]; dxfs: Dxf[]; fonts: Font[]; /** per font: 0, or 1 superscript / 2 subscript (BrtFont.sss) */ sss: number[];
  /** (4.10.1) the differential formats read only in part (a property that could not be read: their rules name it) */
  badDxfs: Set<number>;
  /** (4.10.1) the formats that could not be read at all, as "2 fonts (BrtFont)": in their place a default one, so
      the others keep their numbers */
  notRead: string[];
}

const H_ALIGN = ["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"];
const V_ALIGN = ["top", "center", "bottom", "justify", "distributed"];
const BORDER = ["none", "thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"];
const GRADIENT = 40, GRAY125 = 17, GRAY0625 = 18;

export function readStylesBin(bytes: Uint8Array, color: ColorFn, numFmts: Record<string, string>): BinStyles {
  const c = (a: ColorAttrs | null, fb: string | null) => color(a as unknown as XmlElement | null, fb);
  const r = new Records(bytes);
  const fonts: Font[] = [], sss: number[] = [], fills: (string | null)[] = [], borders: Border[] = [], xfs: Xf[] = [], dxfs: Dxf[] = [];
  const rawXfs: number[][] = [];
  const badDxfs = new Set<number>(), lost = new Map<number, number>();
  let inCellXfs = false;
  while (r.rec()) {
    // (4.10.1) a format that cannot be read loses only itself: a default in its place keeps the indexes of the others
    try { record(); } catch (e) {
      if (!(e instanceof XlsbError)) throw e;
      lost.set(r.type, (lost.get(r.type) || 0) + 1);
      switch (r.type) {
        case Rt.Font: fonts.push({}); sss.push(0); break;
        case Rt.Fill: fills.push(null); break;
        case Rt.Border: borders.push({}); break;
        case Rt.XF: if (inCellXfs) rawXfs.push([0, 0, 0, 0, 0, 0, 0]); break;
        case Rt.DXF: badDxfs.add(dxfs.length); dxfs.push({}); break;
      }
    }
  }
  function record() {
    switch (r.type) {
      case Rt.Fmt: { const id = r.u16(); numFmts[String(id)] = r.wstr(); break; }
      case Rt.Font: {
        const dy = r.u16(), grbit = r.u16(), bls = r.u16(), s = r.u16(), uls = r.u8(); r.skip(3);
        const col = readColor(r); r.u8();
        const name = r.wstr();
        // styles.xml: <b/> for a bold weight, <u/> unless none, <strike/>; the colour element as written
        fonts.push({ name: name || undefined, sz: dy / 20, b: bls >= 700, i: !!(grbit & 2), u: uls !== 0, s: !!(grbit & 8), color: c(col, null) });
        sss.push(s === 1 || s === 2 ? s : 0);
        break;
      }
      case Rt.Fill: {
        const fls = r.u32(), fg = c(readColor(r), null), bg = c(readColor(r), null);
        if (fls === GRADIENT) {
          r.u32(); r.skip(5 * 8);
          const n = r.u32();
          fills.push(n > 0 ? c(readColor(r), null) : null);
        }
        else fills.push(fls === 0 ? null : fls === 1 ? fg || bg || null : fls === GRAY125 || fls === GRAY0625 ? (fg && fg !== "#000000" ? fg : null) : fg || null);
        break;
      }
      case Rt.Border: {
        r.u8();
        const o: Border = {};
        for (const side of ["top", "bottom", "left", "right"] as const) {
          const dg = r.u8(); r.u8(); const col = readColor(r);
          if (dg > 0 && dg < BORDER.length) o[side] = { style: BORDER[dg], color: c(col, "#000000")! };
        }
        borders.push(o);
        break;
      }
      case Rt.BeginCellXFs: inCellXfs = true; break;
      case Rt.EndCellXFs: inCellXfs = false; break;
      case Rt.XF: {
        if (!inCellXfs) break;                                         // cell style formats: not read (as cellStyleXfs)
        r.u16(); const fmt = r.u16(), font = r.u16(), fill = r.u16(), border = r.u16(), rot = r.u8(), indent = r.u8(), al = r.u16();
        rawXfs.push([fmt, font, fill, border, rot, indent, al]);
        break;
      }
      case Rt.DXF: { const d = readDxf(r, c, numFmts); if (d.partial) badDxfs.add(dxfs.length); dxfs.push(d.dxf); break; }
    }
  }
  for (const [fmt, font, fill, border, rot, indent, al] of rawXfs) xfs.push({
    fmt: numFmts[String(fmt)] || "General",
    font: fonts[font] || {}, fill: fills[fill] || null, border: borders[border] || {},
    h: H_ALIGN[al & 7], v: V_ALIGN[(al >> 3) & 7] || "bottom", wrap: !!(al & 0x40), indent, rot,
  });
  const WHAT: Record<number, [string, string]> = { [Rt.Font]: ["font", "fonts"], [Rt.Fill]: ["fill", "fills"], [Rt.Border]: ["border", "borders"], [Rt.XF]: ["cell format", "cell formats"], [Rt.Fmt]: ["number format", "number formats"], [Rt.DXF]: ["conditional format's look", "conditional formats' looks"] };
  const notRead = [...lost].map(([t, n]) => `${n} ${(WHAT[t] || ["format", "formats"])[n > 1 ? 1 : 0]} (${recName(t)})`);
  return { xfs, dxfs, fonts, sss, badDxfs, notRead };
}

/** XFProp 0x26 (xfPropNumFmt): the number format's code, an XLWideString filling the property (MS-XLSB 2.5.162;
    its id is the separate property 0x29). 4.9 read a 2-byte id before it, which put the string's length on its first
    character: every .xlsb with a rule (or table style) setting a number format failed with "a string is longer than
    its record" (4.10.1). The 4.9 layout is still accepted when the bytes say so. */
function numFmtCode(r: Records, end: number): string {
  const len = end - r.p, at = (k: number) => r.v.getUint32(r.p + k, true);
  if (len >= 4 && 4 + 2 * at(0) <= len) return r.wstr();
  if (len >= 6 && 6 + 2 * at(2) === len) { r.skip(2); return r.wstr(); }
  throw new XlsbError(`a number format is longer than its property (${recName(r.type)})`);
}

/** BrtDXF (2.4.353): properties (XFProp, 2.5.164) as the .xlsx reader takes a <dxf>: the fill (pattern, then the
    background colour or else the foreground one), the font colour, bold and italic */
function readDxf(r: Records, c: (a: ColorAttrs | null, fb: string | null) => string | null, numFmts: Record<string, string> = {}): { dxf: Dxf; partial: boolean } {
  r.u16(); r.u16();
  const n = r.u16(), o: Dxf = {};
  let pattern = -1, fg: string | null = null, bg: string | null = null, fill = false, partial = false;
  let fmtCode: string | null = null, fmtId = -1;
  for (let k = 0; k < n && r.left >= 4; k++) {
    const type = r.u16(), cb = r.u16(), end = r.p - 4 + cb;
    if (cb < 4 || end > r.end) { partial = true; break; }
    // (4.10.1) a property that cannot be read loses only itself (each one says its size)
    try { prop(type, cb, end); } catch (e) { if (!(e instanceof XlsbError)) throw e; partial = true; }
    r.p = end;
  }
  function prop(type: number, cb: number, end: number) {
    void cb;
    switch (type) {
      case 0x00: pattern = r.u8(); fill = true; break;
      case 0x01: fg = c(readColor(r), null); fill = true; break;
      case 0x02: bg = c(readColor(r), null); fill = true; break;
      case 0x05: { const col = c(readColor(r), null); if (col) o.color = col; break; }
      case 0x19: o.b = r.u16() >= 700; break;
      case 0x1c: o.i = r.u8() !== 0; break;
      // (S16.4) underline, strike, the number format, the border sides (XFPropBorder: colour, style)
      case 0x1a: o.u = r.u16() !== 0; break;
      case 0x1d: o.s = r.u8() !== 0; break;
      case 0x26: fmtCode = numFmtCode(r, end); break;
      case 0x29: fmtId = r.u16(); break;
      case 0x06: case 0x07: case 0x08: case 0x09: {
        const col = c(readColor(r), "#000000"), st = BORDER[r.u16()] || "none";
        if (st !== "none") (o.border ||= {})[(["top", "bottom", "left", "right"] as const)[type - 6]] = { style: st, color: col || "#000000" };
        break;
      }
    }
  }
  // as the .xlsx reader takes <numFmt numFmtId formatCode>: the code, else the id's format
  if (fmtCode !== null) o.fmt = fmtCode; else if (fmtId >= 0) o.fmt = numFmts[String(fmtId)] || "General";
  if (fill && pattern !== 0) { const f = bg || fg; if (f) o.fill = f; }
  // the key order of the .xlsx reader's object (fill first)
  return { dxf: o.fill !== undefined ? { fill: o.fill, ...o } : o, partial };
}
