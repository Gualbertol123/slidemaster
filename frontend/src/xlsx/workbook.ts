/* Workbook reading: index first (sheet names and sizes), sheets parsed on demand with a fast
   regex parser (no DOMParser for sheetData – far faster on 50k-row sheets). */
import JSZip from "jszip";
import { BUILTIN, formatValue, isDateFmt } from "./numfmt";
import { makeColor } from "./color";
import { readDrawing, analyzeImages } from "./drawing";
import { findRegions } from "./layout";
import { all, kid, kids, parseRange, parseXml, readRels, resolvePath, splitRef, zget, fmtMB, nextFrame, WorkbookError, NS_R } from "./util";
import type { Range } from "./util";
import type { Border, Cell, CellType, CFRule, ColInfo, Dxf, Font, Progress, RowInfo, Shared, Sheet, SheetMeta, Workbook, Xf } from "./types";

const XENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function xdec(s: string): string {
  if (s.indexOf("&") < 0 && s.indexOf("_x") < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (XENT[e] ?? m))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}
export function xattrs(s: string): Record<string, string> {
  const o: Record<string, string> = {}; const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) o[m[1].replace(/^[A-Za-z0-9]+:(?=[A-Za-z])/, "")] = xdec(m[2]);
  return o;
}
export function parseSST(xml: string): string[] {
  const out: string[] = [], re = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    let inner = m[1] || "";
    if (inner.indexOf("rPh") >= 0) inner = inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
    let txt = "", t: RegExpExecArray | null; const tr = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
    while ((t = tr.exec(inner))) txt += t[1];
    out.push(xdec(txt));
  }
  return out;
}
const entrySize = (f: JSZip.JSZipObject | null) => ((f as unknown as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize) || 0;
export const BIG_BYTES = 12 * 1048576;                       // above this (uncompressed sheet XML) sheets are read on demand

export async function indexWorkbook(buf: ArrayBuffer): Promise<Workbook> {
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0)
    throw new WorkbookError("CFB", "This file is an old .xls workbook or is encrypted (password or sensitivity-label protection).");
  if (!(head[0] === 0x50 && head[1] === 0x4B)) throw new WorkbookError("NOTZIP", "This file is not an Excel workbook.");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new WorkbookError("NOTZIP", "The workbook could not be unpacked (" + ((e as Error).message || e) + ")."); }
  let wbPath: string | null = null;
  try {
    const rr = zget(zip, "_rels/.rels");
    if (rr) { const x = parseXml(await rr.async("string")); const r = all(x, "Relationship").find(r => /\/officeDocument$/.test(r.getAttribute("Type") || "")); if (r) wbPath = resolvePath("", r.getAttribute("Target") || ""); }
  } catch { /* fall back below */ }
  if (!wbPath || !zget(zip, wbPath)) wbPath = zget(zip, "xl/workbook.xml") ? "xl/workbook.xml" : wbPath;
  if ((wbPath && /\.bin$/i.test(wbPath)) || (!zget(zip, wbPath) && zget(zip, "xl/workbook.bin")))
    throw new WorkbookError("XLSB", "This is an Excel Binary Workbook (.xlsb).");
  if (!wbPath || !zget(zip, wbPath)) throw new WorkbookError("NOTXLSX", "This file does not contain an Excel workbook.");
  const wbx = parseXml(await zget(zip, wbPath)!.async("string"));
  const wbRels = await readRels(zip, wbPath);
  const meta: SheetMeta[] = [], skipped: { name: string; why: string }[] = [];
  for (const s of all(wbx, "sheet")) {
    const name = s.getAttribute("name") || "", state = s.getAttribute("state") || "visible";
    const r = wbRels[s.getAttributeNS(NS_R, "id") || s.getAttribute("r:id") || ""];
    if (state !== "visible") { skipped.push({ name, why: "hidden" }); continue; }                 // hidden sheets stay hidden (never read)
    if (!r || !zget(zip, r.target)) { skipped.push({ name, why: "missing" }); continue; }
    if (!/\/worksheet$/.test(r.type)) { skipped.push({ name, why: /chartsheet/.test(r.type) ? "chart sheet" : "not a worksheet" }); continue; }
    const f = zget(zip, r.target)!;
    meta.push({ name, path: f.name, size: entrySize(f) });
  }
  const rel = (re: RegExp) => Object.values(wbRels).find(r => re.test(r.type));
  const ssRel = rel(/sharedStrings$/), ssSize = ssRel ? entrySize(zget(zip, ssRel.target)) : 0;
  const total = meta.reduce((s, m) => s + m.size, 0) + ssSize;
  const wb: Workbook = {
    zip, wbRels, meta, skipped, hiddenSheets: skipped.filter(s => s.why === "hidden").map(s => s.name),
    extLinks: Object.values(wbRels).filter(r => /externalLink/.test(r.type)).length,
    sheets: [], shared: null, total, ssSize, big: total > BIG_BYTES || buf.byteLength > 6 * 1048576,
    isLoaded: n => wb.sheets.some(S => S.name === n),
    ensure: (names, progress) => ensureSheets(wb, names, progress),
  };
  return wb;
}
export async function readWorkbook(buf: ArrayBuffer): Promise<Workbook> { const wb = await indexWorkbook(buf); await wb.ensure(wb.meta.map(m => m.name)); return wb; }

const DEFAULT_THEME = ["FFFFFF","000000","E7E6E6","44546A","4472C4","ED7D31","A5A5A5","FFC000","5B9BD5","70AD47","0563C1","954F72"];
async function loadShared(wb: Workbook, progress?: Progress): Promise<Shared> {
  if (wb.shared) return wb.shared;
  const zip = wb.zip, rel = (re: RegExp) => Object.values(wb.wbRels).find(r => re.test(r.type));
  let theme = DEFAULT_THEME.slice();
  const th = rel(/\/theme$/);
  if (th && zget(zip, th.target)) {
    const tx = parseXml(await zget(zip, th.target)!.async("string"));
    const cs = all(tx, "clrScheme")[0];
    if (cs) {
      const get = (n: string) => { const e = kid(cs, n); if (!e) return null; const s = kid(e, "srgbClr"), y = kid(e, "sysClr"); return s ? s.getAttribute("val") : y ? (y.getAttribute("lastClr") || (y.getAttribute("val") === "window" ? "FFFFFF" : "000000")) : null; };
      theme = ["lt1","dk1","lt2","dk2","accent1","accent2","accent3","accent4","accent5","accent6","hlink","folHlink"].map((n, i) => get(n) || theme[i]);
    }
  }
  const color = makeColor(theme);
  let sst: string[] = [];
  const ss = rel(/sharedStrings$/);
  if (ss && zget(zip, ss.target)) {
    if (progress) progress("Reading the shared text table" + (wb.ssSize > 2 * 1048576 ? " (" + fmtMB(wb.ssSize) + ")" : "") + "…", null);
    await nextFrame();
    sst = parseSST(await zget(zip, ss.target)!.async("string"));
  }
  const numFmts: Record<string, string> = Object.assign({}, BUILTIN);
  let fonts: Font[] = [], fills: (string | null)[] = [], borders: Border[] = [], xfs: Xf[] = [], dxfs: Dxf[] = [];
  const st = rel(/styles$/);
  if (st && zget(zip, st.target)) {
    const sx = parseXml(await zget(zip, st.target)!.async("string"));
    for (const nf of all(sx, "numFmt")) numFmts[nf.getAttribute("numFmtId") || ""] = nf.getAttribute("formatCode") || "General";
    const on = (e: Element | null) => !!e && e.getAttribute("val") !== "0" && e.getAttribute("val") !== "false";
    const parseFont = (f: Element | null): Font => f ? ({
      name: kid(f, "name")?.getAttribute("val") || undefined, sz: kid(f, "sz") ? +kid(f, "sz")!.getAttribute("val")! : undefined,
      b: on(kid(f, "b")), i: on(kid(f, "i")),
      u: !!kid(f, "u") && kid(f, "u")!.getAttribute("val") !== "none", s: on(kid(f, "strike")),
      color: color(kid(f, "color"), null),
    }) : {};
    const parseFill = (f: Element | null, isDxf: boolean): string | null => {
      if (!f) return null;
      const pf = kid(f, "patternFill");
      if (pf) {
        const pt = pf.getAttribute("patternType") || (isDxf ? "solid" : "none");
        if (pt === "none") return null;
        const fg = color(kid(pf, "fgColor"), null), bg = color(kid(pf, "bgColor"), null);
        if (isDxf) return bg || fg;
        if (pt === "solid") return fg || bg || null;
        if (pt === "gray125" || pt === "gray0625") return fg && fg !== "#000000" ? fg : null;
        return fg || null;
      }
      const gf = kid(f, "gradientFill");
      if (gf) { const stp = all(gf, "stop"); if (stp.length) return color(kid(stp[0], "color"), null); }
      return null;
    };
    const parseBorder = (b: Element | null): Border => {
      const o: Border = {}; if (!b) return o;
      for (const side of ["left", "right", "top", "bottom"] as const) {
        const e = kid(b, side);
        if (e && e.getAttribute("style") && e.getAttribute("style") !== "none") o[side] = { style: e.getAttribute("style")!, color: color(kid(e, "color"), "#000000")! };
      }
      return o;
    };
    fonts = kids(all(sx, "fonts")[0], "font").map(parseFont);
    fills = kids(all(sx, "fills")[0], "fill").map(f => parseFill(f, false));
    borders = kids(all(sx, "borders")[0], "border").map(parseBorder);
    xfs = kids(all(sx, "cellXfs")[0], "xf").map(x => {
      const al = kid(x, "alignment"); return {
        fmt: numFmts[x.getAttribute("numFmtId") || "0"] || "General",
        font: fonts[+(x.getAttribute("fontId") || 0)] || {}, fill: fills[+(x.getAttribute("fillId") || 0)] || null,
        border: borders[+(x.getAttribute("borderId") || 0)] || {},
        h: al?.getAttribute("horizontal") || "general", v: al?.getAttribute("vertical") || "bottom",
        wrap: al?.getAttribute("wrapText") === "1" || al?.getAttribute("wrapText") === "true", indent: +(al?.getAttribute("indent") || 0), rot: +(al?.getAttribute("textRotation") || 0),
      };
    });
    dxfs = kids(all(sx, "dxfs")[0], "dxf").map(d => {
      const f = kid(d, "font"); const o: Dxf = {};
      const fill = parseFill(kid(d, "fill"), true); if (fill) o.fill = fill;
      if (f) { const c = color(kid(f, "color"), null); if (c) o.color = c; if (kid(f, "b")) o.b = on(kid(f, "b")); if (kid(f, "i")) o.i = on(kid(f, "i")); }
      return o;
    });
  }
  const defaultFont = fonts[0] || { name: "Calibri", sz: 11 };
  const mdw = (() => {
    try {
      const c = document.createElement("canvas").getContext("2d"); if (!c) return 7;
      c.font = `${(defaultFont.sz || 11) * 96 / 72}px "${defaultFont.name || "Calibri"}", Calibri, Arial`;
      let m = 0; for (const d of "0123456789") m = Math.max(m, c.measureText(d).width);
      return m > 3 ? Math.round(m) : 7;
    } catch { return 7; }
  })();
  return wb.shared = { sst, xfs, dxfs, defaultFont, color, theme, mdw };
}

async function ensureSheets(wb: Workbook, names: string[], progress?: Progress): Promise<Sheet[]> {
  const todo = wb.meta.filter(m => names.includes(m.name) && !wb.isLoaded(m.name));
  if (!todo.length) return [];
  const ctx = await loadShared(wb, progress);
  const total = todo.reduce((s, m) => s + Math.max(m.size, 1), 0); let done = 0;
  const added: Sheet[] = [];
  for (const [k, m] of todo.entries()) {
    const label = `Reading “${m.name}” (${k + 1} of ${todo.length}${m.size > 1048576 ? ", " + fmtMB(m.size) : ""})…`;
    if (progress) progress(label, done / total);
    await nextFrame();
    let S: Sheet;
    try { S = await readSheet(wb.zip, m, ctx, f => progress && progress(label, (done + f * Math.max(m.size, 1)) / total)); S.hidden = false; }
    catch (e) { console.error("sheet " + m.name, e); S = brokenSheet(m.name, e, ctx); }
    S.size = m.size;
    wb.sheets.push(S); added.push(S);
    done += Math.max(m.size, 1);
  }
  const order = new Map(wb.meta.map((m, i) => [m.name, i]));
  wb.sheets.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  if (progress) progress("Preparing pictures…", 1);
  await analyzeImages(added.flatMap(S => S.drawing.anchors.flatMap(A => A.objects.map(o => o.kind === "pic" ? o.src : null))));
  return added;
}

export function brokenSheet(name: string, e: unknown, ctx: Shared): Sheet {
  return makeSheet({
    name, error: String((e as Error)?.message || e), cells: new Map(), rowInfo: new Map(), colRanges: [], merges: [], cfRules: [], unsupportedCF: new Set(),
    drawing: { anchors: [], charts: [], unsupported: [], skipped: 0 }, defColW: 8.43, defRowH: 15, zeroH: false, ctx,
  });
}

type SheetInit = Pick<Sheet, "name" | "cells" | "rowInfo" | "colRanges" | "merges" | "cfRules" | "unsupportedCF" | "drawing" | "defColW" | "defRowH" | "zeroH" | "ctx"> & { error?: string };
function makeSheet(init: SheetInit): Sheet {
  const { cells, rowInfo, colRanges, defColW, defRowH, zeroH, ctx } = init;
  const cs = [0, 0], rs = [0, 0];               // cumulative starts (1-based): cs[c] = x of column c
  const colInfo = (c: number): ColInfo | undefined => {
    let lo = 0, hi = colRanges.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, x = colRanges[m]; if (c < x.min) hi = m - 1; else if (c > x.max) lo = m + 1; else return x.info; }
    return undefined;
  };
  const S: Sheet = {
    ...init, hidden: false, unpaired: [], title: "", subtitle: "", tables: [],
    get(r, c) { return cells.get(r + "," + c) || null; },
    rowHidden(r) { const i = rowInfo.get(r); return i ? i.hidden : zeroH; },
    colHidden(c) { const i = colInfo(c); return i ? i.hidden : false; },
    colInfo,
    rowPx(r) { const i = rowInfo.get(r); return Math.round((i ? i.h : defRowH) * 96 / 72); },
    colPx(c) { const i = colInfo(c); const w = i ? i.w : defColW; const m = ctx.mdw || 7; return Math.max(0, Math.trunc(((256 * w + Math.trunc(128 / m)) / 256) * m)); },
    colStart(c) { while (cs.length <= c) { const k = cs.length; cs.push(cs[k - 1] + S.colPx(k - 1)); } return cs[c]; },
    rowStart(r) { while (rs.length <= r) { const k = rs.length; rs.push(rs[k - 1] + S.rowPx(k - 1)); } return rs[r]; },
    cellAt(px, py) {
      // grow the cumulative tables until they pass the point, then binary search (v2 walked cell by cell)
      let c = 1; while (c < 16384 && S.colStart(c + 1) <= px) c = Math.min(16384, c * 2);
      let lo = 1, hi = Math.min(16384, c); while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.colStart(m) <= px) lo = m; else hi = m - 1; }
      let r = 1; while (r < 1048576 && S.rowStart(r + 1) <= py) r = Math.min(1048576, r * 2);
      let lr = 1, hr = Math.min(1048576, r); while (lr < hr) { const m = (lr + hr + 1) >> 1; if (S.rowStart(m) <= py) lr = m; else hr = m - 1; }
      return { c: lo, r: lr, co: px - S.colStart(lo), ro: py - S.rowStart(lr) };
    },
    xfAt(r, c) {
      const x = cells.get(r + "," + c); if (x) return x.xf;
      const ri = rowInfo.get(r); if (ri && ri.s !== null) return ctx.xfs[ri.s] || ({} as Xf);
      const ci = colInfo(c); if (ci && ci.s !== null) return ctx.xfs[ci.s] || ({} as Xf);
      return ctx.xfs[0] || ({} as Xf);
    },
  };
  return S;
}

export async function readSheet(zip: JSZip, sh: SheetMeta, ctx: Shared, tick?: (f: number) => void): Promise<Sheet> {
  const xml = await zget(zip, sh.path)!.async("string");
  if (!/<(?:\w+:)?worksheet\b/.test(xml.slice(0, 2000))) throw new Error("the sheet XML could not be read");
  const fpM = /<(?:\w+:)?sheetFormatPr\b([^>]*)>/.exec(xml), fp = fpM ? xattrs(fpM[1]) : {};
  const defColW = fp.defaultColWidth ? +fp.defaultColWidth : (fp.baseColumnWidth ? +fp.baseColumnWidth + 0.71 : 8.43);
  const defRowH = fp.defaultRowHeight ? +fp.defaultRowHeight : 15;
  const zeroH = fp.zeroHeight === "1" || fp.zeroHeight === "true";
  const colRanges: { min: number; max: number; info: ColInfo }[] = [];
  const colsM = /<(?:\w+:)?cols>([\s\S]*?)<\/(?:\w+:)?cols>/.exec(xml);
  if (colsM) {
    const re = /<(?:\w+:)?col\b([^>]*?)\/?>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(colsM[1]))) {
      const a = xattrs(m[1]);
      const info: ColInfo = { w: a.width ? +a.width : defColW, hidden: a.hidden === "1" || a.hidden === "true", s: a.style != null ? +a.style : null };
      const min = Math.max(1, +a.min || 1), max = Math.min(16384, +a.max || min);
      colRanges.push({ min, max, info });
    }
    colRanges.sort((a, b) => a.min - b.min);
  }
  const rowInfo = new Map<number, RowInfo>(), cells = new Map<string, Cell>();
  const sd0 = xml.search(/<(?:\w+:)?sheetData\b/), sd1 = xml.search(/<\/(?:\w+:)?sheetData>/);
  const data = sd0 >= 0 ? xml.slice(sd0, sd1 >= 0 ? sd1 : undefined) : "";
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  const vRe = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/, isRe = /<(?:\w+:)?is(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?is>/, tRe = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null, lastRow = 0, n = 0;
  while ((m = rowRe.exec(data))) {
    const ra = xattrs(m[1]);
    const r = ra.r ? +ra.r : lastRow + 1; lastRow = r;
    rowInfo.set(r, { h: ra.ht ? +ra.ht : defRowH, hidden: ra.hidden === "1" || ra.hidden === "true", s: ra.customFormat === "1" ? +(ra.s || 0) : null });
    if (m[2]) {
      let c: RegExpExecArray | null, lastCol = 0; cRe.lastIndex = 0;
      while ((c = cRe.exec(m[2]))) {
        const a = xattrs(c[1]);
        const ref = a.r ? splitRef(a.r) : { r, c: lastCol + 1 }; if (!ref) continue; lastCol = ref.c;
        const t = a.t || "n", body = c[2] || "";
        const vm = body ? vRe.exec(body) : null, vt = vm ? vm[1] : null;
        const xf = ctx.xfs[+(a.s || 0)] || ctx.xfs[0] || ({} as Xf);
        let v: Cell["v"] = null, type: CellType = "blank";
        if (t === "s" && vt != null) { v = ctx.sst[+vt] ?? ""; type = "s"; }
        else if (t === "inlineStr") { const im = isRe.exec(body); if (im) { let s = "", q: RegExpExecArray | null; tRe.lastIndex = 0; while ((q = tRe.exec(im[1]))) s += q[1]; v = xdec(s); type = "s"; } }
        else if (t === "str" && vt != null) { v = xdec(vt); type = "s"; }
        else if (t === "b" && vt != null) { v = vt === "1"; type = "b"; }
        else if (t === "e" && vt != null) { v = vt; type = "e"; }
        else if (t === "d" && vt != null) { v = (Date.parse(vt) / 86400000) + 25569; type = "d"; }
        else if (vt != null && vt !== "") { v = +vt; type = isDateFmt(xf.fmt) ? "d" : "n"; }
        if (type === "s" && v === "") type = "blank";
        cells.set(r + "," + ref.c, { r, c: ref.c, v, t: type, xf, fmt: xf.fmt });
      }
    }
    if (++n % 4000 === 0 && tick) { tick(Math.min(.95, rowRe.lastIndex / Math.max(1, data.length))); await nextFrame(); }
  }
  const merges: Range[] = []; { const re = /<(?:\w+:)?mergeCell\b[^>]*?\bref="([^"]+)"/g; let q: RegExpExecArray | null; while ((q = re.exec(xml))) merges.push(parseRange(q[1])); }
  const cfRules: CFRule[] = [], unsupportedCF = new Set<string>();
  {
    const re = /<(?:\w+:)?conditionalFormatting\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?conditionalFormatting>/g; let q: RegExpExecArray | null;
    while ((q = re.exec(xml))) {
      const ranges = (xattrs(q[1]).sqref || "").split(/\s+/).filter(Boolean).map(parseRange);
      const rr = /<(?:\w+:)?cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?cfRule>)/g; let k: RegExpExecArray | null;
      while ((k = rr.exec(q[2]))) {
        const a = xattrs(k[1]), type = a.type;
        if (!["cellIs", "expression"].includes(type)) unsupportedCF.add(type);
        const formulas: string[] = []; const fr = /<(?:\w+:)?formula(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?formula>/g; let f: RegExpExecArray | null; while ((f = fr.exec(k[2] || ""))) formulas.push(xdec(f[1]));
        cfRules.push({ ranges, type, op: a.operator ?? null, priority: +(a.priority || 999), stop: a.stopIfTrue === "1", dxf: ctx.dxfs[+a.dxfId] || null, formulas });
      }
    }
  }
  cfRules.sort((a, b) => a.priority - b.priority);
  const drawing = await readDrawing(zip, sh.path, ctx);
  const S = makeSheet({ name: sh.name, cells, rowInfo, colRanges, merges, cfRules, unsupportedCF, drawing, defColW, defRowH, zeroH, ctx });
  S.title = textOf(S, 1, 1);
  S.subtitle = textOf(S, 2, 1); if (S.subtitle.toLowerCase() === "x") S.subtitle = "";
  S.tables = findRegions(S);
  return S;
}
export function textOf(S: Sheet, r: number, c: number): string { const x = S.get(r, c); if (!x || x.t === "blank") return ""; return formatValue(x).text.trim(); }
