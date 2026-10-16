/* Workbook reading: index first (sheet names and sizes), sheets parsed on demand: the zip with fflate
   (zip.ts), sheetData by a byte scanner into columns (sheetstore.ts), the rest of a sheet with v3's regular
   expressions, styles/theme/rels/drawings with the XML tokenizer (xml.ts). An Excel Binary Workbook (.xlsb) is the
   same package with BIFF12 parts for the workbook, styles, shared strings and sheets: those are read by xlsb/ into
   the same structures (rels, theme and drawings stay XML). */
import { BUILTIN, formatValue } from "./numfmt";
import { hex6, makeColor } from "./color";
import { readDrawing, analyzeImages } from "./drawing";
import { findRegions } from "./layout";
import { all, kid, kids, parseRange, parseXml, readRels, resolvePath, zget, fmtMB, nextFrame, pacer, WorkbookError, NS_R } from "./util";
import { Zip, type ZipEntry } from "./zip";
import { CellMap, RowMap, SheetScanner, cellAt, cellIndex, type SheetColumns } from "./sheetstore";
import { xattrs, xdec, parseSSTRich } from "./strings";
import type { Range } from "./util";
import { platform, type XmlElement } from "../platform";
import type { Border, CFRule, ColInfo, Dxf, Font, Progress, Script, Shared, Sheet, SheetMeta, Workbook, Xf } from "./types";
import type { RowColumns } from "./sheetstore";
import { readWorkbookBin, readWorkbookInfoBin, readSupTabsBin, type BinWorkbookInfo } from "./xlsb/workbook";
import { readStylesBin } from "./xlsb/styles";
import { readSstBin } from "./xlsb/strings";
import { BinSheetReader } from "./xlsb/sheet";

export { xdec, xattrs, parseSST, parseSSTRich, richRuns } from "./strings";
const entrySize = (f: ZipEntry | null) => f?.size || 0;
export const BIG_BYTES = 12 * 1048576;                       // above this (uncompressed sheet XML) sheets are read on demand

/** whether a compound file holds an "EncryptedPackage" stream (an encrypted Office Open XML file; MS-OFFCRYPTO).
    Only directory entries count: they are 128 bytes, aligned to 128 (sectors are 512 or 4096 bytes after a 512-byte
    header), with the name in UTF-16LE and its byte length, terminator included, at offset 64 – so the same text in a
    cell of a real .xls or in an embedded object is not taken for it */
export function isEncryptedPackage(bytes: Uint8Array): boolean {
  const name = "EncryptedPackage", n = name.length * 2, first = name.charCodeAt(0);
  for (let i = 512; i + 128 <= bytes.length; i += 128) {
    if (bytes[i] !== first || bytes[i + 1] !== 0 || (bytes[i + 64] | (bytes[i + 65] << 8)) !== n + 2) continue;
    let k = 1;
    while (k < name.length && bytes[i + 2 * k] === name.charCodeAt(k) && bytes[i + 2 * k + 1] === 0) k++;
    if (k === name.length) return true;
  }
  return false;
}

export async function indexWorkbook(buf: ArrayBuffer): Promise<Workbook> {
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) {
    // an encrypted .xlsx is a compound file with an "EncryptedPackage" stream: Excel cannot convert it without the
    // password (an invisible Excel would wait on its prompt), so it is refused here with its own code
    if (isEncryptedPackage(new Uint8Array(buf))) throw new WorkbookError("ENCRYPTED", "This workbook is protected (a password or a sensitivity label with encryption).");
    throw new WorkbookError("CFB", "This file is an old .xls workbook or is encrypted (password or sensitivity-label protection).");
  }
  if (!(head[0] === 0x50 && head[1] === 0x4B)) throw new WorkbookError("NOTZIP", "This file is not an Excel workbook.");
  let zip: Zip;
  try { zip = new Zip(new Uint8Array(buf)); } catch (e) { throw new WorkbookError("NOTZIP", "The workbook could not be unpacked (" + ((e as Error).message || e) + ")."); }
  let wbPath: string | null = null;
  try {
    const rr = zget(zip, "_rels/.rels");
    if (rr) { const x = parseXml(await rr.async("string")); const r = all(x, "Relationship").find(r => /\/officeDocument$/.test(r.getAttribute("Type") || "")); if (r) wbPath = resolvePath("", r.getAttribute("Target") || ""); }
  } catch { /* fall back below */ }
  if (!wbPath || !zget(zip, wbPath)) wbPath = zget(zip, "xl/workbook.xml") ? "xl/workbook.xml" : zget(zip, "xl/workbook.bin") ? "xl/workbook.bin" : wbPath;
  if (!wbPath || !zget(zip, wbPath)) throw new WorkbookError("NOTXLSX", "This file does not contain an Excel workbook.");
  // the sheets in tab order: <sheet name state r:id> of workbook.xml, or BrtBundleSh of workbook.bin
  let list: { name: string; state: string; rid: string }[];
  const wbRels = await readRels(zip, wbPath);
  if (/\.bin$/i.test(wbPath)) {
    const bytes = zip.bytes(zget(zip, wbPath)!);
    list = readWorkbookBin(bytes).map(s => ({ name: s.name, state: s.state, rid: s.relId }));
    // the names and the sheet table the binary sheets' formulas refer to (S7.1); an external link part's sheet names
    const info = readWorkbookInfoBin(bytes);
    for (const b of info.books) if (b.kind === "external") { const rel = wbRels[b.relId]; const e = rel && zget(zip, rel.target); if (e && /\.bin$/i.test(e.name)) { try { b.sheets = readSupTabsBin(zip.bytes(e)); } catch { /* no sheet names: 3D references to it are unreadable */ } } }
    BIN_INFO.set(zip, info);
  } else list = all(parseXml(await zget(zip, wbPath)!.async("string")), "sheet").map(s => ({ name: s.getAttribute("name") || "", state: s.getAttribute("state") || "visible", rid: s.getAttributeNS(NS_R, "id") || s.getAttribute("r:id") || "" }));
  const meta: SheetMeta[] = [], skipped: { name: string; why: string }[] = [];
  for (const { name, state, rid } of list) {
    const r = wbRels[rid];
    if (state !== "visible") { skipped.push({ name, why: "hidden" }); continue; }                 // hidden sheets stay hidden (never read)
    if (!r || !zget(zip, r.target)) { skipped.push({ name, why: "missing" }); continue; }
    if (!/\/worksheet$/.test(r.type)) { skipped.push({ name, why: /chartsheet/.test(r.type) ? "chart sheet" : "not a worksheet" }); continue; }
    const f = zget(zip, r.target)!;
    meta.push({ name, path: f.name, size: entrySize(f) });
  }
  const rel = (re: RegExp) => Object.values(wbRels).find(r => re.test(r.type));
  // the linked workbooks' file names, in the order the formulas' "[n]" count them: the <externalReference r:id> list
  // of workbook.xml (a binary workbook: its BrtSupBookSrc records), each part's own relationship naming the file
  const externals: string[] = [];
  const extIds: string[] = /\.bin$/i.test(wbPath) ? (BIN_INFO.get(zip)?.books.flatMap(b => b.kind === "external" ? [b.relId] : []) ?? [])
    : all(parseXml(await zget(zip, wbPath)!.async("string")), "externalReference").map(e => e.getAttributeNS(NS_R, "id") || e.getAttribute("r:id") || "");
  for (const id of extIds) {
    const part = wbRels[id]?.target; let name = "?";
    try { if (part) { const rels = await readRels(zip, part); const t = Object.values(rels).find(r => r.external)?.target || Object.values(rels)[0]?.target; if (t) name = decodeURIComponent(t.replace(/\\/g, "/").split("/").pop() || "?"); } } catch { /* unreadable link part: "?" */ }
    externals.push(name);
  }
  const ssRel = rel(/sharedStrings$/), ssSize = ssRel ? entrySize(zget(zip, ssRel.target)) : 0;
  const total = meta.reduce((s, m) => s + m.size, 0) + ssSize;
  const wb: Workbook = {
    zip, wbRels, meta, skipped, hiddenSheets: skipped.filter(s => s.why === "hidden").map(s => s.name),
    extLinks: Object.values(wbRels).filter(r => /externalLink/.test(r.type)).length, externals,
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
      const get = (n: string) => { const e = kid(cs, n); if (!e) return null; const s = kid(e, "srgbClr"), y = kid(e, "sysClr"); return hex6(s ? s.getAttribute("val") : y ? (y.getAttribute("lastClr") || (y.getAttribute("val") === "window" ? "FFFFFF" : "000000")) : null); };
      theme = ["lt1","dk1","lt2","dk2","accent1","accent2","accent3","accent4","accent5","accent6","hlink","folHlink"].map((n, i) => get(n) || theme[i]);
    }
  }
  const color = makeColor(theme);
  let sst: string[] = [], sstRuns: (Script[] | undefined)[] = [];
  const ss = rel(/sharedStrings$/), ssBin = !!ss && /\.bin$/i.test(ss.target);
  const sstMessage = async () => { if (progress) progress("Reading the shared text table" + (wb.ssSize > 2 * 1048576 ? " (" + fmtMB(wb.ssSize) + ")" : "") + "…", null); await nextFrame(); };
  if (ss && !ssBin && zget(zip, ss.target)) {
    await sstMessage();
    const rich = parseSSTRich(await zget(zip, ss.target)!.async("string")); sst = rich.sst; sstRuns = rich.runs;
  }
  const numFmts: Record<string, string> = Object.assign({}, BUILTIN);
  let fonts: Font[] = [], fills: (string | null)[] = [], borders: Border[] = [], xfs: Xf[] = [], dxfs: Dxf[] = [], sss: number[] = [];
  const st = rel(/styles$/);
  if (st && /\.bin$/i.test(st.target) && zget(zip, st.target)) ({ fonts, xfs, dxfs, sss } = readStylesBin(zip.bytes(zget(zip, st.target)!), color, numFmts));
  else if (st && zget(zip, st.target)) {
    const sx = parseXml(await zget(zip, st.target)!.async("string"));
    for (const nf of all(sx, "numFmt")) numFmts[nf.getAttribute("numFmtId") || ""] = nf.getAttribute("formatCode") || "General";
    const on = (e: XmlElement | null) => !!e && e.getAttribute("val") !== "0" && e.getAttribute("val") !== "false";
    const parseFont = (f: XmlElement | null): Font => f ? ({
      name: kid(f, "name")?.getAttribute("val") || undefined, sz: kid(f, "sz") ? +kid(f, "sz")!.getAttribute("val")! : undefined,
      b: on(kid(f, "b")), i: on(kid(f, "i")),
      u: !!kid(f, "u") && kid(f, "u")!.getAttribute("val") !== "none", s: on(kid(f, "strike")),
      color: color(kid(f, "color"), null),
    }) : {};
    const parseFill = (f: XmlElement | null, isDxf: boolean): string | null => {
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
    const parseBorder = (b: XmlElement | null): Border => {
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
  // a binary string table names its runs' fonts (their superscript flag), so it is read after the styles
  if (ss && ssBin && zget(zip, ss.target)) { await sstMessage(); const rich = readSstBin(zip.bytes(zget(zip, ss.target)!), sss); sst = rich.sst; sstRuns = rich.runs; }
  const defaultFont = fonts[0] || { name: "Calibri", sz: 11 };
  const mdw = await (async () => {
    try {
      const m = await platform().text.maxDigitWidth(`${(defaultFont.sz || 11) * 96 / 72}px "${defaultFont.name || "Calibri"}", Calibri, Arial`);
      return m > 3 ? Math.round(m) : 7;
    } catch { return 7; }
  })();
  wb.shared = { sst, sstRuns, xfs, dxfs, defaultFont, color, theme, mdw };
  FONT_SCRIPTS.set(wb.shared, sss);
  return wb.shared;
}
/** per workbook (its Shared): the superscript / subscript flag of each font of styles.bin, for the rich strings of
    binary sheets */
const FONT_SCRIPTS = new WeakMap<Shared, number[]>();
/** per binary workbook (its zip): the names and sheet table its formulas refer to (xlsb/formula.ts) */
const BIN_INFO = new WeakMap<Zip, BinWorkbookInfo>();

async function ensureSheets(wb: Workbook, names: string[], progress?: Progress): Promise<Sheet[]> {
  const todo = wb.meta.filter(m => names.includes(m.name) && !wb.isLoaded(m.name));
  if (!todo.length) return [];
  const ctx = await loadShared(wb, progress);
  const total = todo.reduce((s, m) => s + Math.max(m.size, 1), 0); let done = 0;
  const added: Sheet[] = [], pace = pacer();
  for (const [k, m] of todo.entries()) {
    const label = `Reading “${m.name}” (${k + 1} of ${todo.length}${m.size > 1048576 ? ", " + fmtMB(m.size) : ""})…`;
    if (progress) progress(label, done / total);
    { const w = pace(); if (w) await w; }                // not one timer per sheet: ~4 ms each in a worker (deck20: 20 sheets)
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

export type SheetInit = Pick<Sheet, "name" | "cells" | "rowInfo" | "colRanges" | "merges" | "cfRules" | "unsupportedCF" | "drawing" | "defColW" | "defRowH" | "zeroH" | "ctx"> & { error?: string };
export function makeSheet(init: SheetInit, store?: SheetColumns): Sheet {
  const { cells, rowInfo, colRanges, defColW, defRowH, zeroH, ctx } = init;
  const cs = [0, 0], rs = [0, 0];               // cumulative starts (1-based): cs[c] = x of column c
  const colInfo = (c: number): ColInfo | undefined => {
    let lo = 0, hi = colRanges.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, x = colRanges[m]; if (c < x.min) hi = m - 1; else if (c > x.max) lo = m + 1; else return x.info; }
    return undefined;
  };
  const S: Sheet = {
    ...init, hidden: false, unpaired: [], title: "", subtitle: "", tables: [],
    get(r, c) {
      if (!store) return cells.get(r + "," + c) || null;
      const i = cellIndex(store, r, c); return i < 0 ? null : cellAt(store, ctx, i, r);
    },
    formula(r, c) {
      if (!store || !store.fml.size) return null;
      const i = cellIndex(store, r, c); if (i < 0) return null;
      const k = store.fml.get(i); return k === undefined ? null : store.fmls[k];
    },
    arrayRef(r, c) {
      if (!store || !store.arr.size) return null;
      const i = cellIndex(store, r, c); return i < 0 ? null : store.arr.get(i) ?? null;
    },
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
      if (store) { const i = cellIndex(store, r, c); if (i >= 0) return ctx.xfs[store.xf[i]] || ctx.xfs[0] || ({} as Xf); }
      else { const x = cells.get(r + "," + c); if (x) return x.xf; }
      const ri = rowInfo.get(r); if (ri && ri.s !== null) return ctx.xfs[ri.s] || ({} as Xf);
      const ci = colInfo(c); if (ci && ci.s !== null) return ctx.xfs[ci.s] || ({} as Xf);
      return ctx.xfs[0] || ({} as Xf);
    },
  };
  return S;
}

/** where `<sheetData` starts (the first) and where `</sheetData>` starts (searched from the end: a valid sheet has one)
    in the sheet's bytes – v3: xml.search of both; -1 = none */
function sheetDataBounds(b: Uint8Array): [number, number] {
  const W = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  const name = [115, 104, 101, 101, 116, 68, 97, 116, 97];        // sheetData
  const at = (q: number) => { for (let k = 0; k < 9; k++) if (b[q + k] !== name[k]) return false; return true; };
  /** the position after "<" or "</" at which the name (with an optional w+: prefix) is sheetData, or -1 */
  const nameAt = (p: number) => { if (at(p)) return p; let q = p; while (q < b.length && W(b[q])) q++; return b[q] === 58 && q > p && at(q + 1) ? q + 1 : -1; };
  let open = -1, close = -1;
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 60 || b[i + 1] === 47) continue;
    const q = nameAt(i + 1); if (q >= 0 && !W(b[q + 9])) { open = i; break; }
  }
  if (open >= 0) for (let i = b.length - 12; i > open; i--) {
    if (b[i] !== 60 || b[i + 1] !== 47) continue;
    const q = nameAt(i + 2); if (q >= 0 && b[q + 9] === 62) { close = i; break; }
  }
  return [open, close];
}
const utf8 = new TextDecoder("utf-8");

export async function readSheet(zip: Zip, sh: SheetMeta, ctx: Shared, tick?: (f: number) => void): Promise<Sheet> {
  const entry = zget(zip, sh.path)!;
  // the inflate counts as the first 20 % of the progress; one call (in 1 MB slices with a yield between, as when the
  // page's thread read sheets, it took ~15 % longer in the worker)
  const bytes = zip.bytes(entry); if (tick) tick(.2);
  const rest = tick && ((f: number) => tick(.2 + .8 * f));
  return /\.bin$/i.test(sh.path) ? parseSheetBin(zip, sh, bytes, ctx, rest) : parseSheet(zip, sh, bytes, ctx, rest);
}
/** a sheet from its BIFF12 records (sheetN.bin of an .xlsb) */
export async function parseSheetBin(zip: Zip, sh: SheetMeta, bytes: Uint8Array, ctx: Shared, tick?: (f: number) => void): Promise<Sheet> {
  const rd = new BinSheetReader(bytes, ctx, FONT_SCRIPTS.get(ctx), BIN_INFO.get(zip), sh.name);
  if (!tick) rd.run();
  else { const pace = pacer(); while (!rd.run(20000)) { tick(Math.min(.95, rd.progress)); const w = pace(); if (w) await w; } }
  const b = rd.finish();
  const S = await finishSheet(zip, sh, ctx, b.store, b.rows, b);
  if (rd.unreadable) S.unreadableFormulas = rd.unreadable;
  return S;
}
/** a sheet from its inflated XML (readSheet without the inflate) */
export async function parseSheet(zip: Zip, sh: SheetMeta, bytes: Uint8Array, ctx: Shared, tick?: (f: number) => void): Promise<Sheet> {
  // sheetData is scanned as bytes; the rest of the sheet (before and after it) is read as text, as in v3
  const [sd0, sd1] = sheetDataBounds(bytes);
  const xml = sd0 < 0 ? utf8.decode(bytes) : sd1 < 0 ? utf8.decode(bytes) : utf8.decode(bytes.subarray(0, sd0)) + utf8.decode(bytes.subarray(sd1));
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
  const scan = new SheetScanner(bytes, sd0 < 0 ? 0 : sd0, sd0 < 0 ? 0 : sd1 < 0 ? bytes.length : sd1, ctx, defRowH);
  if (!tick) scan.run();
  else { const pace = pacer(); while (!scan.run(4000)) { tick(Math.min(.95, scan.progress)); const w = pace(); if (w) await w; } }
  const { cells: store, rows } = scan.finish();
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
  return finishSheet(zip, sh, ctx, store, rows, { colRanges, merges, cfRules, unsupportedCF, defColW, defRowH, zeroH });
}
/** the parts both formats share: drawings (XML in both), the Sheet facade, its title and table regions */
async function finishSheet(zip: Zip, sh: SheetMeta, ctx: Shared, store: SheetColumns, rows: RowColumns,
  p: Pick<Sheet, "colRanges" | "merges" | "cfRules" | "unsupportedCF" | "defColW" | "defRowH" | "zeroH">): Promise<Sheet> {
  const { colRanges, merges, cfRules, unsupportedCF, defColW, defRowH, zeroH } = p;
  const cells = new CellMap(store, ctx), rowInfo = new RowMap(rows);
  const drawing = await readDrawing(zip, sh.path, ctx);
  const S = makeSheet({ name: sh.name, cells, rowInfo, colRanges, merges, cfRules, unsupportedCF, drawing, defColW, defRowH, zeroH, ctx }, store);
  S.cols = { cells: store, rows };
  S.title = textOf(S, 1, 1);
  S.subtitle = textOf(S, 2, 1); if (S.subtitle.toLowerCase() === "x") S.subtitle = "";
  S.tables = findRegions(S);
  return S;
}
export function textOf(S: Sheet, r: number, c: number): string { const x = S.get(r, c); if (!x || x.t === "blank") return ""; return formatValue(x).text.trim(); }
