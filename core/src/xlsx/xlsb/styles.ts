/* styles.bin → the same number formats, fonts, fills, borders, cell formats and differential formats as
   workbook.ts reads from styles.xml (MS-XLSB 2.4.661 BrtFont, BrtFill, BrtBorder, BrtXF, BrtFmt, BrtDXF). Each value
   is mapped to what the .xlsx reader makes of the XML Excel writes for it, so a workbook saved both ways styles
   its cells identically (tests/xlsb.test.ts). */
import type { ColorFn } from "../color";
import type { XmlElement } from "../../platform";
import type { Border, Dxf, Font, Xf } from "../types";
import { Records, Rt, readColor, type ColorAttrs } from "./records";

export interface BinStyles { xfs: Xf[]; dxfs: Dxf[]; fonts: Font[]; /** per font: 0, or 1 superscript / 2 subscript (BrtFont.sss) */ sss: number[] }

const H_ALIGN = ["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"];
const V_ALIGN = ["top", "center", "bottom", "justify", "distributed"];
const BORDER = ["none", "thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"];
const GRADIENT = 40, GRAY125 = 17, GRAY0625 = 18;

export function readStylesBin(bytes: Uint8Array, color: ColorFn, numFmts: Record<string, string>): BinStyles {
  const c = (a: ColorAttrs | null, fb: string | null) => color(a as unknown as XmlElement | null, fb);
  const r = new Records(bytes);
  const fonts: Font[] = [], sss: number[] = [], fills: (string | null)[] = [], borders: Border[] = [], xfs: Xf[] = [], dxfs: Dxf[] = [];
  const rawXfs: number[][] = [];
  let inCellXfs = false;
  while (r.rec()) {
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
      case Rt.DXF: dxfs.push(readDxf(r, c, numFmts)); break;
    }
  }
  for (const [fmt, font, fill, border, rot, indent, al] of rawXfs) xfs.push({
    fmt: numFmts[String(fmt)] || "General",
    font: fonts[font] || {}, fill: fills[fill] || null, border: borders[border] || {},
    h: H_ALIGN[al & 7], v: V_ALIGN[(al >> 3) & 7] || "bottom", wrap: !!(al & 0x40), indent, rot,
  });
  return { xfs, dxfs, fonts, sss };
}

/** BrtDXF (2.4.353): properties (XFProp, 2.5.164) as the .xlsx reader takes a <dxf>: the fill (pattern, then the
    background colour or else the foreground one), the font colour, bold and italic */
function readDxf(r: Records, c: (a: ColorAttrs | null, fb: string | null) => string | null, numFmts: Record<string, string> = {}): Dxf {
  r.u16(); r.u16();
  const n = r.u16(), o: Dxf = {};
  let pattern = -1, fg: string | null = null, bg: string | null = null, fill = false;
  for (let k = 0; k < n && r.left >= 4; k++) {
    const type = r.u16(), cb = r.u16(), end = r.p - 4 + cb;
    if (cb < 4 || end > r.end) break;
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
      case 0x26: { const id = r.u16(); o.fmt = cb >= 10 ? r.wstr() : numFmts[String(id)] || "General"; break; }
      case 0x06: case 0x07: case 0x08: case 0x09: {
        const col = c(readColor(r), "#000000"), st = BORDER[r.u16()] || "none";
        if (st !== "none") (o.border ||= {})[(["top", "bottom", "left", "right"] as const)[type - 6]] = { style: st, color: col || "#000000" };
        break;
      }
    }
    r.p = end;
  }
  if (fill && pattern !== 0) { const f = bg || fg; if (f) o.fill = f; }
  // the key order of the .xlsx reader's object (fill first)
  return o.fill !== undefined ? { fill: o.fill, ...o } : o;
}
