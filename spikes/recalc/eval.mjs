/* Recalculation spike (docs/next/07 §1): every formula cell of the given workbooks computed by two candidate engines and
   compared with Excel's cached values; the scenario check sets Control!B2 to each bank and compares with the copies
   Excel saved for that bank (tests/corpus/workbooks/recalc/truth/<bank>/). Node 22. Usage: node eval.mjs */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
const require = createRequire(import.meta.url);
const FormulaParser = require("fast-formula-parser");
const { FormulaError } = FormulaParser;
const here = dirname(fileURLToPath(import.meta.url));
const WB = join(here, "..", "..", "tests", "corpus", "workbooks", "recalc");
const now = () => performance.now();

/* ------------------------------------------------------------------ xlsx reading: cells, cached values, formulas */
const xdec = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const attrs = s => { const o = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = xdec(m[2]); return o; };
export const colNum = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
export const colName = n => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; } return s; };
const splitRef = r => { const m = /^([A-Z]+)(\d+)$/.exec(r); return { col: colNum(m[1]), row: +m[2] }; };

/** shifts the relative references of a shared formula by (dr, dc); strings and sheet names are left alone */
export function shiftFormula(f, dr, dc) {
  let out = "", i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') { const j = f.indexOf('"', i + 1); const end = j < 0 ? f.length : j + 1; out += f.slice(i, end); i = end; continue; }
    if (ch === "'") { const j = f.indexOf("'", i + 1); const end = j < 0 ? f.length : j + 1; out += f.slice(i, end); i = end; continue; }
    const m = /^(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![\w(])/.exec(f.slice(i));
    if (m && !/[\w.]/.test(f[i - 1] || "")) {
      const c = m[1] ? colNum(m[2]) : colNum(m[2]) + dc, r = m[3] ? +m[4] : +m[4] + dr;
      out += m[1] + colName(c) + m[3] + r; i += m[0].length; continue;
    }
    out += ch; i++;
  }
  return out;
}

export function readWorkbook(path) {
  const z = unzipSync(new Uint8Array(readFileSync(path)));
  const part = n => z[n] ? strFromU8(z[n]) : "";
  const wbx = part("xl/workbook.xml"), rels = part("xl/_rels/workbook.xml.rels");
  const relMap = {}; for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) { const a = attrs(m[1]); relMap[a.Id] = a.Target.startsWith("/") ? a.Target.slice(1) : "xl/" + a.Target; }
  const sst = []; for (const m of part("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => xdec(t[1])).join(""));
  // external workbooks, in the order [1], [2] … of the formulas
  const ext = []; for (const m of wbx.matchAll(/<externalReference\b([^>]*)\/>/g)) {
    const t = relMap[attrs(m[1])["r:id"]]; const r = part("xl/externalLinks/_rels/" + basename(t) + ".rels");
    const tm = /Target="([^"]*)"/.exec(r); ext.push(tm ? decodeURIComponent(basename(tm[1].replace(/\\/g, "/"))) : "?");
  }
  const sheets = [];
  for (const m of wbx.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const a = attrs(m[1]); const xml = part(relMap[a["r:id"]]);
    const cells = new Map(); const shared = new Map(); let maxRow = 0, maxCol = 0;
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(c[1]), body = c[2] || ""; if (!ca.r) continue;
      const { row, col } = splitRef(ca.r); maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
      const cell = { row, col, t: ca.t || "n", s: ca.s, v: null, f: null };
      const fm = /<f\b([^>]*)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
      if (fm) {
        const fa = attrs(fm[1]); let text = fm[2] != null ? xdec(fm[2]) : "";
        if (fa.t === "shared") {
          if (text) shared.set(fa.si, { text, row, col });
          else { const s = shared.get(fa.si); text = s ? shiftFormula(s.text, row - s.row, col - s.col) : ""; }
        }
        if (text) cell.f = text; if (fa.t === "array") cell.array = fa.ref;
      }
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (vm) {
        const raw = xdec(vm[1]);
        cell.v = cell.t === "s" ? sst[+raw] : cell.t === "b" ? raw === "1" : cell.t === "e" || cell.t === "str" ? raw : cell.t === "d" ? raw : +raw;
      } else if (cell.t === "inlineStr") cell.v = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => xdec(t[1])).join("");
      if (cell.v !== null || cell.f) cells.set(row + "," + col, cell);
    }
    sheets.push({ name: a.name, cells, maxRow, maxCol });
  }
  return { name: basename(path), sheets, ext };
}

/* ------------------------------------------------------------------ engine A: fast-formula-parser over a dependency-driven evaluator */
export class FfpEngine {
  constructor(books) {
    this.books = new Map(books.map(b => [b.name.toLowerCase(), b]));
    this.memo = new Map(); this.stack = new Set(); this.errors = new Map();
    this.parser = new FormulaParser({
      onCell: ref => this.cellValue(this.sheetOf(ref.sheet), ref.row, ref.col),
      onRange: ref => {
        const sh = this.sheetOf(ref.sheet); if (!sh) return [[FormulaError.REF]];
        const r1 = Math.min(ref.to.row, sh.sheet.maxRow), c1 = Math.min(ref.to.col, sh.sheet.maxCol), out = [];
        for (let r = ref.from.row; r <= r1; r++) { const row = []; for (let c = ref.from.col; c <= c1; c++) row.push(this.cellValue(sh, r, c)); out.push(row); }
        return out.length ? out : [[null]];
      },
    });
  }
  /** "@n@Sheet" names a sheet of external workbook n of the current book */
  sheetOf(name) {
    if (name == null) return null;
    let book = this.cur;
    const m = /^@(\d+)@(.*)$/.exec(name);
    if (m) { book = this.books.get((this.cur.ext[+m[1] - 1] || "").toLowerCase()); name = m[2]; if (!book) return null; }
    const sheet = book.sheets.find(s => s.name === name); return sheet ? { book, sheet } : null;
  }
  /** external references rewritten for the parser (it reads no `[n]`) */
  static prep(f) { return f.replace(/'\[(\d+)\]([^']*)'!/g, "'@$1@$2'!").replace(/(?<![\w'])\[(\d+)\]([A-Za-z0-9_]+)!/g, "'@$1@$2'!"); }
  cellValue(sh, row, col) {
    if (!sh) return FormulaError.REF;
    const cell = sh.sheet.cells.get(row + "," + col); if (!cell) return null;
    if (!cell.f) return cell.t === "e" ? new FormulaError(cell.v) : cell.v;
    const key = sh.book.name + "!" + sh.sheet.name + "!" + row + "," + col;
    if (this.memo.has(key)) return this.memo.get(key);
    if (this.stack.has(key)) return FormulaError.ERROR("#CYCLE!");
    this.stack.add(key); const saved = this.cur; this.cur = sh.book;
    let v;
    try { v = this.parser.parse(FfpEngine.prep(cell.f), { sheet: sh.sheet.name, row, col }, !!cell.array); if (Array.isArray(v)) v = v[0]?.[0] ?? null; }
    catch (e) { v = e instanceof FormulaError ? e : FormulaError.ERROR(String(e.message || e)); this.errors.set(key, e.message || String(e)); }
    this.cur = saved; this.stack.delete(key); this.memo.set(key, v); return v;
  }
  /** sets a constant cell (a scenario value) and forgets every computed value (the spike recomputes all; the product keeps a dependency graph) */
  set(bookName, sheetName, ref, value) {
    const b = this.books.get(bookName.toLowerCase()), s = b.sheets.find(x => x.name === sheetName), { row, col } = splitRef(ref);
    s.cells.set(row + "," + col, { row, col, t: typeof value === "number" ? "n" : "str", v: value, f: null }); this.memo.clear();
  }
  valueOf(book, sheet, row, col) { this.cur = book; const v = this.cellValue({ book, sheet }, row, col); return v instanceof FormulaError ? { err: v.error } : v; }
}

/* ------------------------------------------------------------------ engine B: IronCalc (Rust → WASM) */
async function ironcalc() {
  const mod = await import("@ironcalc/wasm");
  mod.initSync(readFileSync(join(here, "node_modules/@ironcalc/wasm/wasm_bg.wasm")));
  return mod;
}

/** an IronCalc model with the workbook's sheets and cells (constants as they are, formulas as "=…"); external
    references stay as text the engine must refuse or resolve */
export function buildIron(mod, book) {
  const m = new mod.Model(book.name, "en", "UTC", "en"); m.pauseEvaluation();
  book.sheets.forEach((s, i) => { if (i > 0) m.newSheet(); m.renameSheet(i, s.name); });
  book.sheets.forEach((s, i) => { for (const c of s.cells.values()) {
    if (c.f) m.setUserInput(i, c.row, c.col, "=" + c.f);
    else if (c.v === null) continue;
    else if (typeof c.v === "boolean") m.setUserInput(i, c.row, c.col, c.v ? "TRUE" : "FALSE");
    else if (typeof c.v === "number") m.setUserInput(i, c.row, c.col, String(c.v));
    else m.setUserInput(i, c.row, c.col, /^[=+\-@']/.test(c.v) || /^\d/.test(c.v) ? "'" + c.v : c.v);
  } });
  m.resumeEvaluation(); return m;
}
/* ------------------------------------------------------------------ comparison */
const num = v => typeof v === "number" && Number.isFinite(v);
function same(a, b) {
  if (a && typeof a === "object" && "err" in a) return typeof b === "string" && b === a.err;
  if (num(a) && num(b)) return Math.abs(a - b) <= 1e-6 + 1e-9 * Math.abs(b);
  if (typeof a === "boolean" || typeof b === "boolean") return a === b || (num(a) && (a !== 0) === b) || (num(b) && (b !== 0) === a);
  if (a == null && (b === "" || b == null)) return true;
  return String(a) === String(b);
}
const funcsOf = f => [...f.matchAll(/([A-Z][A-Z0-9.]*)\(/g)].map(m => m[1]);

function runFfp(books, label, opts = {}) {
  const eng = new FfpEngine(books), t0 = now();
  const per = { total: 0, equal: 0, volatile: 0, byFunc: {}, mism: [] };
  const formulaCells = []; for (const b of books) for (const s of b.sheets) for (const c of s.cells.values()) if (c.f) formulaCells.push({ b, s, c });
  for (const { b, s, c } of formulaCells) {
    const got = eng.valueOf(b, s, c.row, c.col), exp = c.t === "e" ? { err: c.v } : c.v;
    const ok = (got && got.err && exp && exp.err) ? got.err === exp.err : (got && got.err) ? false : same(got, exp);
    const fs = funcsOf(c.f); per.total++;
    if (/\bTODAY\(|\bNOW\(|\bRAND/.test(c.f)) { per.volatile++; continue; }
    if (ok) per.equal++; else { if (per.mism.length < 40) per.mism.push({ at: b.name + "!" + s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got: got && got.err ? got.err : got }); for (const fn of new Set(fs)) per.byFunc[fn] = (per.byFunc[fn] || 0) + 1; }
  }
  per.ms = Math.round(now() - t0); per.engine = "fast-formula-parser"; per.label = label; per.parseErrors = [...eng.errors.values()].slice(0, 10);
  return { per, eng };
}

async function runIron(mod, path, label) {
  const bytes = new Uint8Array(readFileSync(path)), t0 = now();
  const book = readWorkbook(path);
  let model; try { model = buildIron(mod, book); } catch (e) { return { engine: "ironcalc", label, loadError: String(e.message || e) }; }
  const tLoad = now() - t0; model.evaluate(); const tEval = now() - t0 - tLoad;
  const per = { engine: "ironcalc", label, total: 0, equal: 0, volatile: 0, byFunc: {}, mism: [], loadMs: Math.round(tLoad), evalMs: Math.round(tEval) };
  const props = model.getWorksheetsProperties();
  for (const s of book.sheets) {
    const si = props.findIndex(p => p.name === s.name); if (si < 0) continue;
    model.rangeClearFormatting(si, 1, 1, Math.max(1, s.maxRow), Math.max(1, s.maxCol));      // General, so values read back as numbers
    for (const c of s.cells.values()) {
      if (!c.f) continue; per.total++;
      if (/\bTODAY\(|\bNOW\(|\bRAND/.test(c.f)) { per.volatile++; continue; }
      const txt = model.getFormattedCellValue(si, c.row, c.col);
      const exp = c.t === "e" ? { err: c.v } : c.v;
      let got = txt; if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(txt)) got = +txt; else if (txt === "TRUE" || txt === "FALSE") got = txt === "TRUE";
      const ok = exp && exp.err ? txt === exp.err : typeof exp === "number" ? (num(got) && Math.abs(got - exp) <= 1e-6 + 1e-7 * Math.abs(exp)) : same(exp, got);
      if (ok) per.equal++; else { if (per.mism.length < 40) per.mism.push({ at: s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got: txt }); for (const fn of new Set(funcsOf(c.f))) per.byFunc[fn] = (per.byFunc[fn] || 0) + 1; }
    }
  }
  return { per, model, props, book };
}

/* ------------------------------------------------------------------ main */
const out = { ffp: [], iron: [], scenario: {}, excelCells: {} };
const banksPath = join(WB, "Banks.xlsx"), peersPath = join(WB, "Peers.xlsx"), bigPath = join(WB, "BanksBig.xlsx");
const corpus = join(here, "..", "..", "..", "..", "..", "..", "..", "Downloads", "claude", "slidemaster-lf", "tests", "corpus", "workbooks");
const corpusDir = existsSync(corpus) ? corpus : "C:/Users/U508169/Downloads/claude/slidemaster-lf/tests/corpus/workbooks";

// function census
const census = {}; for (const p of [banksPath, peersPath, bigPath]) { const b = readWorkbook(p); let n = 0; for (const s of b.sheets) for (const c of s.cells.values()) if (c.f) { n++; for (const fn of new Set(funcsOf(c.f))) census[fn] = (census[fn] || 0) + 1; } out.excelCells[b.name] = n; }
out.census = census;

// A · fast-formula-parser: linked pair, big, corpus
{
  const pair = [readWorkbook(banksPath), readWorkbook(peersPath)];
  const r = runFfp(pair, "Banks+Peers (linked)"); out.ffp.push(r.per);
  // scenario: each bank against Excel's own saved copy
  const truth = readdirSync(join(WB, "truth")).filter(d => d.startsWith("Bank_"));
  const sc = { engine: "fast-formula-parser", values: truth.length, total: 0, equal: 0, volatile: 0, msPerValue: [], mism: [] };
  for (const d of truth) {
    const bank = d.replace("_", " "); const t0 = now(); r.eng.set("Banks.xlsx", "Control", "B2", bank);
    const tb = [readWorkbook(join(WB, "truth", d, "Banks.xlsx")), readWorkbook(join(WB, "truth", d, "Peers.xlsx"))];
    let cnt = 0;
    for (const [i, b] of tb.entries()) for (const s of b.sheets) for (const c of s.cells.values()) if (c.f) {
      if (/\bTODAY\(/.test(c.f)) { sc.volatile++; continue; }
      const live = pair[i], ls = live.sheets.find(x => x.name === s.name); const got = r.eng.valueOf(live, ls, c.row, c.col); cnt++;
      const exp = c.t === "e" ? { err: c.v } : c.v; sc.total++;
      const ok = got && got.err ? exp && exp.err === got.err : same(got, exp);
      if (ok) sc.equal++; else if (sc.mism.length < 30) sc.mism.push({ bank, at: b.name + "!" + s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got });
    }
    sc.msPerValue.push(Math.round((now() - t0) * 10) / 10);
  }
  out.scenario.ffp = sc;
  const big = [readWorkbook(bigPath)];
  const rb = runFfp(big, "BanksBig (20 slide sheets)"); out.ffp.push(rb.per);
  // the speed of one scenario value on the big deck: set, recompute every formula cell
  const times = [];
  for (const bank of ["Bank B", "Bank C", "Bank D", "Bank E", "Bank F"]) { const t0 = now(); rb.eng.set("BanksBig.xlsx", "Control", "B2", bank); for (const s of big[0].sheets) for (const c of s.cells.values()) if (c.f) rb.eng.valueOf(big[0], s, c.row, c.col); times.push(Math.round(now() - t0)); }
  out.scenario.ffpBigMs = times;
  // the big truth copy (Bank G)
  const tg = readWorkbook(join(WB, "truth", "big_Bank_G", "BanksBig.xlsx")); rb.eng.set("BanksBig.xlsx", "Control", "B2", "Bank G");
  let tot = 0, eq = 0; const mm = [];
  for (const s of tg.sheets) for (const c of s.cells.values()) if (c.f && !/\bTODAY\(/.test(c.f)) { const ls = big[0].sheets.find(x => x.name === s.name); const got = rb.eng.valueOf(big[0], ls, c.row, c.col); const exp = c.t === "e" ? { err: c.v } : c.v; tot++; if (got && got.err ? exp && exp.err === got.err : same(got, exp)) eq++; else if (mm.length < 10) mm.push({ at: s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got }); }
  out.scenario.ffpBigG = { total: tot, equal: eq, mism: mm };
  for (const f of ["edge-formats.xlsx", "report.xlsx"]) if (existsSync(join(corpusDir, f))) out.ffp.push(runFfp([readWorkbook(join(corpusDir, f))], "corpus " + f).per);
}

// B · IronCalc
try {
  const mod = await ironcalc();
  for (const [p, l] of [[banksPath, "Banks (linked, alone)"], [peersPath, "Peers (linked, alone)"], [bigPath, "BanksBig (20 slide sheets)"]]) {
    const r = await runIron(mod, p, l); out.iron.push(r.per || r);
    if (r.model && l.startsWith("BanksBig")) {
      const ci = r.props.findIndex(x => x.name === "Control"); const times = [];
      for (const bank of ["Bank B", "Bank C", "Bank D", "Bank E", "Bank F"]) { const t0 = now(); r.model.setUserInput(ci, 2, 2, bank); r.model.evaluate(); times.push(Math.round((now() - t0) * 10) / 10); }
      out.scenario.ironBigMs = times;
      // Bank G against Excel's copy
      r.model.setUserInput(ci, 2, 2, "Bank G"); r.model.evaluate();
      const tg = readWorkbook(join(WB, "truth", "big_Bank_G", "BanksBig.xlsx")); let tot = 0, eq = 0; const mm = [];
      for (const s of tg.sheets) { const si = r.props.findIndex(x => x.name === s.name); for (const c of s.cells.values()) if (c.f && !/\bTODAY\(/.test(c.f)) { const txt = r.model.getFormattedCellValue(si, c.row, c.col); const exp = c.t === "e" ? { err: c.v } : c.v; tot++; const got = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(txt) ? +txt : txt === "TRUE" ? true : txt === "FALSE" ? false : txt; const ok = exp && exp.err ? txt === exp.err : typeof exp === "number" ? (num(got) && Math.abs(got - exp) <= 1e-6 + 1e-7 * Math.abs(exp)) : same(exp, got); if (ok) eq++; else if (mm.length < 10) mm.push({ at: s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got: txt }); } }
      out.scenario.ironBigG = { total: tot, equal: eq, mism: mm };
    }
    if (r.model && l.startsWith("Banks (")) {
      // scenario on the single file: every bank, the Banks.xlsx cells only (its FromB cells need Peers.xlsx)
      const ci = r.props.findIndex(x => x.name === "Control"); const sc = { engine: "ironcalc", values: 0, total: 0, equal: 0, msPerValue: [], mism: [] };
      for (const d of readdirSync(join(WB, "truth")).filter(d => d.startsWith("Bank_"))) {
        const t0 = now(); r.model.setUserInput(ci, 2, 2, d.replace("_", " ")); r.model.evaluate(); sc.msPerValue.push(Math.round((now() - t0) * 10) / 10); sc.values++;
        const tb = readWorkbook(join(WB, "truth", d, "Banks.xlsx"));
        for (const s of tb.sheets) { const si = r.props.findIndex(x => x.name === s.name); for (const c of s.cells.values()) if (c.f && !/\bTODAY\(/.test(c.f)) { const txt = r.model.getFormattedCellValue(si, c.row, c.col); const exp = c.t === "e" ? { err: c.v } : c.v; sc.total++; const got = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(txt) ? +txt : txt === "TRUE" ? true : txt === "FALSE" ? false : txt; const ok = exp && exp.err ? txt === exp.err : typeof exp === "number" ? (num(got) && Math.abs(got - exp) <= 1e-6 + 1e-7 * Math.abs(exp)) : same(exp, got); if (ok) sc.equal++; else if (sc.mism.length < 30) sc.mism.push({ bank: d, at: s.name + "!" + colName(c.col) + c.row, f: c.f, exp, got: txt }); } }
      }
      out.scenario.iron = sc;
    }
  }
  for (const f of ["edge-formats.xlsx", "report.xlsx"]) if (existsSync(join(corpusDir, f))) { const r = await runIron(mod, join(corpusDir, f), "corpus " + f); out.iron.push(r.per || r); }
} catch (e) { out.ironError = String(e.stack || e); }

writeFileSync(join(here, "results.json"), JSON.stringify(out, null, 1));
// summary
console.log("formula cells:", out.excelCells, "\nfunctions used:", Object.keys(census).sort().join(" "));
for (const p of out.ffp) console.log(`[ffp] ${p.label}: ${p.equal}/${p.total - p.volatile} equal (${p.volatile} volatile skipped) in ${p.ms} ms; mismatching functions`, p.byFunc);
for (const p of out.iron) console.log(`[iron] ${p.label}: ${p.loadError ? "LOAD ERROR " + p.loadError : `${p.equal}/${p.total - p.volatile} equal (${p.volatile} volatile) load ${p.loadMs} ms eval ${p.evalMs} ms; mismatching functions ${JSON.stringify(p.byFunc)}`}`);
console.log("scenario ffp (10 banks, both files vs Excel's copies):", out.scenario.ffp && `${out.scenario.ffp.equal}/${out.scenario.ffp.total} equal, ms per value ${out.scenario.ffp.msPerValue.join(" ")}`);
console.log("scenario iron (10 banks, Banks.xlsx only):", out.scenario.iron && `${out.scenario.iron.equal}/${out.scenario.iron.total} equal, ms per value ${out.scenario.iron.msPerValue.join(" ")}`);
console.log("big deck, one value: ffp ms", out.scenario.ffpBigMs, "iron ms", out.scenario.ironBigMs, "\nbig Bank G vs Excel: ffp", out.scenario.ffpBigG && `${out.scenario.ffpBigG.equal}/${out.scenario.ffpBigG.total}`, "iron", out.scenario.ironBigG && `${out.scenario.ironBigG.equal}/${out.scenario.ironBigG.total}`);
if (out.ironError) console.log("iron error:", out.ironError.split("\n")[0]);
console.log("\nfirst mismatches (ffp linked):", JSON.stringify(out.ffp[0].mism.slice(0, 12), null, 0));
console.log("first mismatches (iron Banks):", JSON.stringify((out.iron[0].mism || []).slice(0, 12), null, 0));
console.log("first mismatches (ffp scenario):", JSON.stringify(out.scenario.ffp.mism.slice(0, 8), null, 0));
console.log("first mismatches (ffp big G):", JSON.stringify(out.scenario.ffpBigG.mism.slice(0, 6), null, 0));
console.log("first mismatches (iron big G):", JSON.stringify((out.scenario.ironBigG || {}).mism || [], null, 0));
