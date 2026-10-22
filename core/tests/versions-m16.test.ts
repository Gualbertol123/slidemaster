/* Delete-versions (S16.2, B37, docs/next/09 §2.5 / §3.7; VD-01…VD-03): the op version.patch and a version's `drop` – whole
   rows / columns deleted for that version only, closed up through S16.1's one mechanism (runtimeSlides(…, {drop})):
   * the op: shared/ops-vectors.d/m16-versions.json (+ knownOp, needsV5 / docNeedsV5 per case, every inverse undoes),
     the saved deck fixtures/saved/versions-4.9.json (two writers, folded in any order, compacted at format 5);
   * the ribbon's and the wizard's lists (model/versions.ts): normalised drop lists, Restore selection splitting emptied
     ranges, one op per action;
   * VD-02: only that version changes – table, charts, the automated comment's grid, the exhibit (KPIs), callouts; the
     full deck and the other versions keep every row;
   * VD-03: the worker (the stage's version, an export of a version, every version × design) – the display list and the
     PowerPoint a:tbl hold the version's rows only, where the display list draws them; the PDF too. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { loadVectors } from "./vectors";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOp, applyOps, docNeedsV5, inverseOf, knownOp, needsV5 } from "../src/model/ops";
import { fold, nextSnapshot } from "../src/model/fold";
import { runtimeSlides } from "../src/model/preset";
import { dropBands, dropCount, dropEdit, dropEmpties, dropLabel, droppedCell, hideWithout, versionDrop, versionOp } from "../src/model/versions";
import { resolveStyle } from "../src/model/style";
import { tableKey, type RenderCtx } from "../src/render/context";
import { gridOf } from "../src/render/comment";
import { exhibitOf } from "../src/render/exhibit";
import { chartData } from "../src/render/chart-dl";
import { calloutText } from "../src/render/shape-dl";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { ChartItem, DeckVersion, Design, Op, Preset } from "../src/model/types";
import type { Workbook } from "../src/xlsx/types";
import type { Node } from "../src/dl/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const TODAY = "1 October 2026";
/** SB_PPTX_OUT=<folder>: the files made here are written there too (for tools/pptxcheck.py and for opening in PowerPoint) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };

/* ---- report.xlsx: SLIDE_1's table dhnms9c (rows 4-19 but 9, Excel-hidden; columns C-J but H) on two slides, the pair of
   SLIDE_3 on a third; versions Chief (everything) and All (rows 10–11 and column G deleted on SLIDE_1, D6 emptied) ---- */
const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const BASE = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
const T = "dhnms9c";
const CHIEF: DeckVersion = { id: "vc", name: "Chief", hide: {} };
const ALL: DeckVersion = { id: "va", name: "All", hide: { SLIDE_1: ["D6"] }, drop: { SLIDE_1: ["10:11", "G"] } };
const preset = (): Preset => {
  const p = structuredClone(BASE);
  p.slides = [{ ...p.slides[0], id: "s1", title: "Loans" }, { id: "s2", type: "content", title: "Loans, every bank", tables: [T] }, { ...p.slides[1], id: "s3", title: "Pair" }];
  p.versions = [structuredClone(CHIEF), structuredClone(ALL)];
  return p;
};
let WB: Workbook | null = null;
const book = async () => WB || (WB = await readWorkbook(ab(path.join(BOOKS, REPORT.workbook))));
/** the render context of the version shown (as the page and the worker build it: the slides with its drop) */
const ctxOf = (wb: Workbook, p: Preset, vid = "", design: Design = "excel"): RenderCtx => {
  const drop = versionDrop(p, vid);
  return { style: resolveStyle({}, { design }), edits: {}, slides: runtimeSlides(wb, p, "W.xlsx", design, drop ? { drop } : undefined), preset: p, workbook: "W.xlsx",
    logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: (p.versions || []).find(v => v.id === vid) || null };
};
const V = (id: string, patch: Record<string, unknown> | null): Op => ({ op: "version.patch", id, patch } as Op);

describe("the op: version.patch (shared/ops-vectors.d/m16-versions.json)", () => {
  const mine = loadVectors().filter(v => /^(version\.patch|versions with only|fold: .*(\(S16\.2\)|version))/.test(v.name));
  it("the file has its cases, and the runner reads them (ops.test.ts runs every case)", () => {
    expect(mine.length).toBe(21);
    expect(mine.filter(v => v.fold).length).toBe(5);
  });
  for (const v of mine.filter(x => !x.fold)) it(v.name + " – known, format 5 (needsV5 / docNeedsV5), undone by its inverses", () => {
    for (const op of v.ops) expect(knownOp(op), JSON.stringify(op)).toBe(true);
    expect(v.ops.map((op: Op) => needsV5(op))).toEqual(v.expect.needsV5);
    const { doc } = applyOps(v.doc, v.ops);
    expect(docNeedsV5(doc)).toBe(v.expect.docNeedsV5);
    const d = structuredClone(v.doc), inv: Op[] = [];
    for (const op of v.ops) { const i = inverseOf(d, op); if (i) inv.unshift(i); applyOp(d, op); }
    for (const i of inv) applyOp(d, i);
    // (an undone delete re-creates the version at the end: the same versions, by id)
    const byId = (p: Preset | null) => Object.fromEntries((p?.versions || []).map(x => [x.id, x]));
    expect(byId(d.preset)).toEqual(byId(v.doc.preset));
    expect({ ...d.preset, versions: undefined }).toEqual({ ...v.doc.preset, versions: undefined });
  });
  it("knownOp: a later key is not known whole (a page never compacts it away); needsV5 for every version.patch", () => {
    expect(knownOp(V("v", { name: "X", cells: {} }))).toBe(false);
    expect(knownOp(V("v", null))).toBe(true);
    expect(needsV5(V("v", { name: "X" }))).toBe(true);
    // a preset.set holding a version's drop (the wizard's Finish) is format 5 too; hide alone is 4.0's
    expect(needsV5({ op: "preset.set", preset: { ...preset(), versions: [CHIEF] } })).toBe(false);
    expect(needsV5({ op: "preset.set", preset: preset() })).toBe(true);
  });
});

describe("a deck saved by 4.9 with delete-versions (fixtures/saved/versions-4.9.json, added, never edited)", () => {
  it("two writers' records fold in any order; on two sheets both win, on one sheet the later list; a 4.9 page compacts them at format 5", async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "saved", "versions-4.9.json"), "utf8"));
    const { snapshot: snap, records: recs } = saved as { snapshot: any; records: any[] };
    expect(recs.every(r => r.ops.every(knownOp))).toBe(true);
    expect(recs.every(r => r.ops.some(needsV5))).toBe(true);
    const f = fold(snap, recs), p = f.doc.preset!;
    expect([f.doc.rev, f.lamport, f.doc.updatedBy]).toEqual([12, 13, "anna"]);
    expect(fold(snap, [...recs].reverse()).doc).toEqual(f.doc);
    expect(fold(snap, [...recs.slice(5), ...recs.slice(0, 5)]).doc).toEqual(f.doc);
    expect(p.versions).toEqual([
      { id: "vchief", name: "Chief (full)", hide: {} },
      { id: "vall", name: "All", hide: { SLIDE_1: ["D6"] }, drop: { SLIDE_1: ["10:12"], "SLIDE_3 pair": ["6"] } },
    ]);
    const next = nextSnapshot(snap, f, {});
    expect(next.format).toBe(5);
    expect(next.doc.preset).toEqual(p);
    expect(docNeedsV5(next.doc)).toBe(true);
    const wb = await book(), full = runtimeSlides(wb, p, "report.xlsx", "excel"), all = runtimeSlides(wb, p, "report.xlsx", "excel", { drop: versionDrop(p, "vall") });
    expect(full[0].tables[0].rows).toEqual([4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(all[0].tables[0].rows).toEqual([4, 5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19]);
    expect(all[1].tables.map(L => L.rows.length)).toEqual([full[1].tables[0].rows.length - 1, full[1].tables[1].rows.length - 1]);
    expect(versionDrop(p, "vchief")).toBeUndefined();
  });
});

describe("the lists (model/versions.ts): what Delete rows / columns, Empty cells and Restore write", () => {
  it("drop lists are normalised: runs of rows, then runs of columns; a restore splits a run", () => {
    expect(dropEdit(["10:11"], "r", [12, 14], true)).toEqual(["10:12", "14"]);
    expect(dropEdit(["10:12", "G"], "r", [11], false)).toEqual(["10", "12", "G"]);
    expect(dropEdit(["G"], "c", [5, 6], true)).toEqual(["E:G"]);
    expect(dropEdit(undefined, "c", [28], true)).toEqual(["AB"]);
    expect(["10:12", "9", "E:G", "F"].map(dropLabel)).toEqual(["rows 10–12", "row 9", "columns E:G", "column F"]);
    expect(dropCount(ALL)).toEqual({ rows: 2, cols: 1 });
    expect(dropBands(["10:11", "G", "x"])).toEqual([{ kind: "r", a: 10, b: 11, entry: "10:11" }, { kind: "c", a: 7, b: 7, entry: "G" }]);
    expect([droppedCell(ALL, "SLIDE_1", 10, 3), droppedCell(ALL, "SLIDE_1", 6, 7), droppedCell(ALL, "SLIDE_1", 6, 6), droppedCell(ALL, "Other", 10, 3)]).toEqual([true, true, false, false]);
  });
  it("a table keeps at least one row / column (S16.2 review 1): dropEmpties names the table a drop list would empty", () => {
    const R = ["C4:J19", "B30:D33"];
    expect(dropEmpties(["10:11", "G"], R)).toBeNull();
    expect(dropEmpties(["4:19"], R)).toBe("C4:J19");                                       // every row of the first
    expect(dropEmpties(["4:18"], R)).toBeNull();                                           // row 19 stays
    expect(dropEmpties(["B:D"], R)).toBe("B30:D33");                                       // every column of the second
    expect(dropEmpties(["C:I"], R)).toBeNull();                                            // J stays
    // Excel's own hidden rows count as gone (the wizard's preview window knows them): row 19 hidden, 4–18 deleted
    expect(dropEmpties(["4:18"], R, { row: r => r === 19, col: () => false })).toBe("C4:J19");
    expect(dropEmpties(["4:19"], [null, undefined, "nonsense", "B30:D33"])).toBeNull();     // unresolved tables skipped
  });
  it("Restore selection: an emptied range loses the selected cells (split in up to four), the others stay", () => {
    expect(hideWithout(["C5:F8", "J1"], { r1: 6, c1: 4, r2: 7, c2: 5 })).toEqual(["C5:F5", "C8:F8", "C6:C7", "F6:F7", "J1"]);
    expect(hideWithout(["C5:D6"], { r1: 1, c1: 1, r2: 20, c2: 20 })).toEqual([]);
    expect(hideWithout(["D6"], { r1: 7, c1: 4, r2: 8, c2: 4 })).toEqual(["D6"]);
  });
  it("one version.patch per action (one undo step), null when nothing changes", () => {
    const v = structuredClone(ALL), sel = { r1: 12, c1: 3, r2: 13, c2: 5 };
    expect(versionOp(v, "dropRows", "SLIDE_1", sel)).toEqual(V("va", { drop: { SLIDE_1: ["10:13", "G"] } }));
    expect(versionOp(v, "dropCols", "SLIDE_1", sel)).toEqual(V("va", { drop: { SLIDE_1: ["10:11", "C:E", "G"] } }));
    // the table's own rows / columns of the selection (a hidden one between them is not touched)
    expect(versionOp(v, "dropRows", "SLIDE_1", { r1: 8, c1: 3, r2: 10, c2: 3 }, { rows: [8, 10], cols: [3] })).toEqual(V("va", { drop: { SLIDE_1: ["8", "10:11", "G"] } }));
    expect(versionOp(v, "empty", "SLIDE_1", sel)).toEqual(V("va", { hide: { SLIDE_1: ["D6", "C12:E13"] } }));
    expect(versionOp(v, "empty", "SLIDE_1", { r1: 6, c1: 4, r2: 6, c2: 4 })).toEqual(V("va", { hide: { SLIDE_1: ["D6", "D6:D6"] } }));
    // Restore selection across the closed-up rows 10–11 and the emptied D6
    expect(versionOp(v, "restoreSel", "SLIDE_1", { r1: 6, c1: 3, r2: 12, c2: 4 })).toEqual(V("va", { drop: { SLIDE_1: ["G"] }, hide: { SLIDE_1: null } }));
    expect(versionOp(v, "restoreSel", "SLIDE_1", { r1: 13, c1: 3, r2: 14, c2: 4 })).toBeNull();
    expect(versionOp(v, "restoreAll", "SLIDE_1", null)).toEqual(V("va", { hide: null, drop: null }));
    expect(versionOp(CHIEF, "restoreAll", "SLIDE_1", null)).toBeNull();
    expect(versionOp(v, "dropRows", "SLIDE_1", { r1: 10, c1: 3, r2: 11, c2: 3 })).toBeNull();
  });
});

describe("VD-02: only that version changes – table, charts, comments, KPIs, callouts", () => {
  it("the version's tables close up its rows and columns on every slide; the full deck and Chief keep them", async () => {
    const wb = await book(), p = preset(), full = ctxOf(wb, p), chief = ctxOf(wb, p, "vc"), all = ctxOf(wb, p, "va");
    const rows = (c: RenderCtx, s: number) => c.slides[s].tables[0].rows, cols = (c: RenderCtx, s: number) => c.slides[s].tables[0].cols;
    expect(rows(full, 0)).toEqual([4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(rows(chief, 0)).toEqual(rows(full, 0));
    for (const s of [0, 1]) {
      expect(rows(all, s)).toEqual([4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 19]);
      expect(cols(all, s)).toEqual(cols(full, s).filter(c => c !== 7));
    }
    expect(all.slides[2].tables.map(L => L.rows)).toEqual(full.slides[2].tables.map(L => L.rows));     // another sheet
    const A = all.slides[0].tables[0], F = full.slides[0].tables[0];
    expect(A.H).toBeCloseTo(F.H - F.rowH.get(10)! - F.rowH.get(11)!, 5);
    expect(A.items.some(i => i.b.r === 10 || i.b.c === 7)).toBe(false);
    // its emptied cell D6 stays where it was (blanked in place, as before 4.9)
    expect(tableKey(all, A)).not.toBe(tableKey(full, F));
    expect(tableKey(chief, chief.slides[0].tables[0])).toBe(tableKey(full, F));
  });
  it("a table the version would leave with no row (two writers' merge; the menu and the wizard refuse it) keeps every row, counted for the Issues panel", async () => {
    const wb = await book(), p = preset();
    p.versions = [...p.versions!, { id: "vx", name: "Nothing", hide: {}, drop: { SLIDE_1: ["1:40"] } }];
    const full = ctxOf(wb, p), x = ctxOf(wb, p, "vx");
    for (const s of [0, 1]) {
      expect(x.slides[s].tables.map(L => L.rows)).toEqual(full.slides[s].tables.map(L => L.rows));   // never vanishes
      expect([x.slides[s].dropWhole, x.slides[s].missing]).toEqual([1, 0]);
      expect(full.slides[s].dropWhole).toBeUndefined();
    }
    expect(x.slides[2].dropWhole).toBeUndefined();                                         // another sheet
    // a version that deletes some rows (All) or none of this table's: not counted
    expect(ctxOf(wb, p, "va").slides[0].dropWhole).toBeUndefined();
    p.versions[2].drop = { SLIDE_1: ["40:50"] };
    expect(ctxOf(wb, p, "vx").slides[0].dropWhole).toBeUndefined();
    // every column deleted: the same
    p.versions[2].drop = { SLIDE_1: ["A:Z"] };
    expect(ctxOf(wb, p, "vx").slides[0].dropWhole).toBe(1);
  });
  it("the automated comment's grid and the exhibit (KPI line, panel) read the version's rows only", async () => {
    const wb = await book(), p = preset(), full = ctxOf(wb, p, "", "mckinsey"), all = ctxOf(wb, p, "va", "mckinsey");
    const gF = gridOf(full.slides[0].tables[0], full), gA = gridOf(all.slides[0].tables[0], all);
    expect(gA.length).toBe(gF.length - 2);
    expect(gA[0].length).toBe(gF[0].length - 1);
    expect(gA.map(r => r[0].text)).not.toContain("Epsilon");
    expect(gF.map(r => r[0].text)).toContain("Epsilon");
    // the exhibit of the pair's sheet (a consulting design's KPI line and panel read it): row 6 (R2) deleted in "All"
    p.versions![1].drop = { "SLIDE_3 pair": ["6"] };
    const f2 = ctxOf(wb, p, "", "mckinsey"), a2 = ctxOf(wb, p, "va", "mckinsey");
    const rowsOf = (c: RenderCtx) => c.slides[2].tables.map(L => exhibitOf(L, c)).map(e => [e.kind, e.rows.map(r => r.r)]);
    expect(rowsOf(f2)).toEqual([["exhibit", [5, 6, 7, 8, 9, 10]], ["exhibit", [5, 6, 7, 8, 9, 10, 11, 12, 13]]]);
    expect(rowsOf(a2)).toEqual([["exhibit", [5, 7, 8, 9, 10]], ["exhibit", [5, 7, 8, 9, 10, 11, 12, 13]]]);
  });
  it("a chart reading the sheet skips the deleted rows in that version only; a callout quoting a deleted cell shows it empty", async () => {
    const wb = await book(), p = preset();
    const pie: ChartItem = { kind: "chart", type: "pie", values: { sheet: "SLIDE_1", range: "D6:D12" }, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } };
    p.slides[1].items = { c1: pie };
    const labels = (c: RenderCtx) => { const d = chartData(pie, c); return d.ok ? d.slices.map(s => s.label) : []; };
    expect(labels(ctxOf(wb, p))).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta", "Eta"]);
    expect(labels(ctxOf(wb, p, "vc"))).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta", "Eta"]);
    expect(labels(ctxOf(wb, p, "va"))).toEqual(["Beta", "Gamma", "Eta"]);                             // D6 emptied, 10–11 deleted
    const q = "{SLIDE_1!C10} · {SLIDE_1!C12} · {SLIDE_1!G6}";
    expect(calloutText(q, ctxOf(wb, p)).text).toBe("Epsilon · Eta · " + calloutText("{SLIDE_1!G6}", ctxOf(wb, p)).text);
    expect(calloutText(q, ctxOf(wb, p, "va")).text).toBe(" · Eta · ");
  });
});

/* ---- VD-03: the worker (a deck in memory) and an export worker linked to it (as hidden-m16.test.ts) ---- */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const FONTS = path.join(here, "fixtures", "fonts");
const FONT_FILES: Record<string, Uint8Array> = Object.fromEntries(["Carlito-Regular.ttf", "Carlito-Bold.ttf"].map(f => [f, new Uint8Array(fs.readFileSync(path.join(FONTS, f)))]));
const CATALOG = [400, 700].map(weight => ({ source: "system" as const, file: weight === 400 ? "Carlito-Regular.ttf" : "Carlito-Bold.ttf", family: "Arial", weight, italic: false }));
async function open(deck: FakeDeck, p: Preset) {
  const api = deck.api(), [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: ab(path.join(BOOKS, deck.snap.workbook)) }, []));
  const inputs = (version: string) => ({ defaults: {}, logoSrc: "", version, workbook: deck.snap.workbook });
  await port.call("start", { name: deck.snap.workbook, deck: deck.open("anna@pc#aaaaaaaa"), preset: p, inputs: inputs(""), stage: { slide: 0, known: [] } });
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  page.handle("fontFile", x => { const g = FONT_FILES[x.file]; return g ? g.slice().buffer as ArrayBuffer : null; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const lists = (design: Design, version: string, scenario?: string) => port.call("slideLists", { design, version, forExport: !scenario, thumb: false, today: TODAY, pptx: !scenario, ...(scenario ? { scenario } : {}) } as never) as Promise<SlideList[]>;
  const run = (kind: ExportJob["kind"], design: Design, version: string) => page.call("run", { kind, design, version, forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report", catalog: kind === "pdf" ? CATALOG : [] });
  const show = (version: string) => port.call("inputs", inputs(version));
  /** the words of the stage's slide (the version shown: the page's inputs) */
  const stage = async (slide: number) => { const s = await port.call("stage", { slide, known: [], nodes: true, today: TODAY }); return (s?.layers || []).flatMap(l => words(l.nodes || [])); };
  return { apply, lists, run, show, stage };
}
const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
function tablesOf(xml: string) {
  return xml.split("<p:graphicFrame>").slice(1).map(g => g.split("</p:graphicFrame>")[0]).filter(g => g.includes("<a:tbl>")).map(g => {
    const off = /<p:xfrm><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(g)!;
    return { x: +off[1], y: +off[2], w: +off[3], h: +off[4], rows: (g.match(/<a:tr /g) || []).length, cols: (g.match(/<a:gridCol /g) || []).length, text: textOf(g) };
  });
}
const words = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? words(n.children) : []);

describe("VD-03: every export of that version (the worker)", () => {
  it("the version made by the ribbon's ops: its exports in every design hold its rows only, the full deck's every row; undo brings them back", async () => {
    const p = preset(); delete p.versions;
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, p);
    // VD-01 by ops: a version made, rows and a column deleted, a cell emptied – one op each (one undo step each)
    expect(await h.apply("New version", [V("va", { name: "All" })])).toBe(true);
    expect(await h.apply("Delete rows", [V("va", { drop: { SLIDE_1: ["10:11"] } })])).toBe(true);
    expect(await h.apply("Delete columns", [V("va", { drop: { SLIDE_1: ["10:11", "G"] } })])).toBe(true);
    expect(await h.apply("Delete rows", [V("va", { drop: { "SLIDE_3 pair": ["6"] } })])).toBe(true);
    for (const design of DESIGNS) {
      const lsA = await h.lists(design, "va"), lsF = await h.lists(design, "");
      const wA = words(lsA[0].dl.nodes), wF = words(lsF[0].dl.nodes);
      expect(wA, design).toContain("Alpha");
      expect(wA, design).not.toContain("Epsilon");
      expect(wA, design).not.toContain("Zeta");
      expect(wF, design).toContain("Epsilon");
      const r = await h.run("pptx", design, "va"), z = unzipSync(new Uint8Array(r.files[0]));
      keep(`m16-versions-All-${design}.pptx`, r.files[0]);
      const slide = (i: number) => strFromU8(z[`ppt/slides/slide${i + 1}.xml`]);
      const [tA] = tablesOf(slide(0));
      expect(tA.text.join(" "), design).not.toMatch(/\bEpsilon\b|\bZeta\b/);
      expect(tA.text.join(" "), design).toMatch(/\bEta\b/);
      for (let i = 0; i < 3; i++) { expect(slide(i)).not.toContain("p:cxnSp"); expect(slide(i)).not.toContain("<p:pic>"); }
      expect(tablesOf(slide(1))[0].text.join(" "), design).not.toMatch(/\bEpsilon\b/);         // the same table on s2
      const zF = unzipSync(new Uint8Array((await h.run("pptx", design, "")).files[0]));
      const [tF] = tablesOf(strFromU8(zF["ppt/slides/slide1.xml"]));
      expect(tF.text.join(" "), design).toMatch(/\bEpsilon\b/);
      if (design === "excel" || design === "glass" || design === "clean") {
        // the grid tables: 13 of the 15 rows, 6 of the 7 columns (Excel's own hidden row 9 and column H stay hidden)
        expect([tA.rows, tA.cols], design).toEqual([13, 6]);
        expect([tF.rows, tF.cols], design).toEqual([15, 7]);
        expect(tablesOf(slide(2)).map(t => t.rows), design).toEqual([6, 9]);                     // row 6 (R2) of the pair's sheet
        expect(tablesOf(slide(2)).flatMap(t => t.text), design).not.toContain("R2");
        expect(tablesOf(strFromU8(zF["ppt/slides/slide3.xml"])).map(t => t.rows), design).toEqual([7, 10]);
      } else expect(tA.rows, design).toBeLessThan(tF.rows);
    }
    const pdf = await h.run("pdf", "excel", "va"), s = Buffer.from(new Uint8Array(pdf.files[0])).toString("latin1");
    expect((s.match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(3);
    keep("m16-versions-All-excel.pdf", pdf.files[0]);
    // Restore all (one op): the version's next export has every row again
    expect(await h.apply("Restore all of “All”", [V("va", { hide: null, drop: null })])).toBe(true);
    const z = unzipSync(new Uint8Array((await h.run("pptx", "excel", "va")).files[0]));
    expect(tablesOf(strFromU8(z["ppt/slides/slide1.xml"]))[0].rows).toBe(15);
  }, 180_000);
  it("the stage's version (inputs): the worker's slides follow the version shown, and back", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, preset());
    expect(await h.stage(0)).toContain("Epsilon");
    await h.show("va");
    expect(await h.stage(0)).toContain("Alpha");
    expect(await h.stage(0)).not.toContain("Epsilon");
    expect(await h.stage(1)).not.toContain("Epsilon");
    // every version × design: each version draws its own lists, in one run after another
    for (const design of ["excel", "bain"] as Design[]) for (const [vid, has] of [["vc", true], ["va", false], ["", true]] as const) {
      const ls = await h.lists(design, vid);
      expect(words(ls[0].dl.nodes).includes("Epsilon"), `${design} ${vid}`).toBe(has);
    }
    // the other versions' slides are kept between calls (S16.2 review 4) – and start over when the deck changes: a row
    // deleted in Chief while All is shown reaches Chief's next export
    expect(words((await h.lists("excel", "vc"))[0].dl.nodes)).toContain("Beta");
    await h.apply("Delete rows", [V("vc", { drop: { SLIDE_1: ["7"] } })]);
    expect(words((await h.lists("excel", "vc"))[0].dl.nodes)).not.toContain("Beta");
    expect(words((await h.lists("bain", "vc"))[0].dl.nodes)).not.toContain("Beta");
    expect(words((await h.lists("excel", ""))[0].dl.nodes)).toContain("Beta");
    // a version's rows deleted by somebody while it is shown: the stage follows the document
    await h.apply("Delete rows", [V("va", { drop: { SLIDE_1: ["8"] } })]);
    expect(await h.stage(0)).toContain("Epsilon");
    expect(await h.stage(0)).not.toContain("Gamma");
    await h.show("");
    expect(await h.stage(0)).toContain("Gamma");
  }, 120_000);
});
