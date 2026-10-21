/* The core worker's state and its answers to the page (PLAN S2.4, Part B §2): the ONE owner of the open
   workbook, its shared document (DocSync) and the undo/redo history. The page sends operations; after every
   change the host recomputes the slides, draws the tables of the current design and version, and sends the
   page the new sheet slices (when they change) and the document snapshot – in that order, so the page can redraw from
   what it received – then the slide on the stage. Transport-free: core.worker.ts connects it to
   postMessage; tests (and a page without workers) connect it in the same thread. */
import { attachLinked, indexWorkbook, readHiddenSheets, sheetsOf } from "../xlsx/workbook";
import { overlayHash, overlayWorkbook } from "../calc/overlay";
import { parseSheetId } from "../calc/refs";
import { A1, numToCol, splitRef } from "../xlsx/util";
import { formatValue } from "../xlsx/numfmt";
import { ASSUMED_FOLDER, runFileName, scenarioRunNames } from "../export/names";
import { markCells } from "../render/marks";
import type { CalcModel, SelfCheck } from "../calc/engine";
import { setPictureConverter } from "../xlsx/drawing";
import { sliceBoxes, sliceShared, sliceSheet, sliceTransfer, type SharedSlice, type SheetSlice } from "../xlsx/slice";
import { cellInfo, sheetInfo, sheetWindow, tableSize } from "../xlsx/sheetview";
import { detectTables } from "../xlsx/detect";
import { defaultPreset, LCACHE, presetSheets, rangeToG, runtimeSlides } from "../model/preset";
import { resolveStyle } from "../model/style";
import { tableDrawKey } from "../render/slide";
import { slideCtx } from "../render/look";
import { computeLayout, geomOf } from "../render/layout";
import { excelTableDL, forgetMeasurements, measuredBuild, type TableDL } from "../render/excel-dl";
import { glassTableDL } from "../render/glass-dl";
import { consultTableDL } from "../render/consult-dl";
import { isConsult } from "../model/designs";
import { slideToDisplayList, type SlideImages } from "../render/slide-dl";
import { hiddenIn, isHidden } from "../render/pagenumbers";
import { chartLook } from "../render/chart-dl";
import type { SlideSem } from "../pptx/scene";
import { keyOf } from "../render/edits";
import { analyzeImages, IMGMETA } from "../xlsx/drawing";
import { sha1 } from "../text/sha1";
import { wallpaperIds } from "../render/wallpaper";
import { DocSync, type Change, type DeckApi, type DeckOpen } from "../sync/docsync";
import { fold } from "../model/fold";
import { History } from "../sync/history";
import type { RenderCtx } from "../render/context";
import type { Design, Preset, RuntimeSlide, Style, WorkbookDoc } from "../model/types";
import type { Workbook } from "../xlsx/types";
import { Port, transfer, type Wire } from "../rpc/port";
import type { CalcCheck, GateCell, KeptCell, ScenarioAnswer, ScenarioInput, ScenarioRunReq, ScenarioRunStart, CoreEvents, CoreMethods, DocState, ExportCoreMethods, FileKind, PageEvents, PageMethods, SlideList, SlideListsReq, StageLayer, StageReq, StageSlide, ViewInputs, WorkbookInfo } from "../rpc/messages";
import { weightOf, type DisplayList, type Node } from "../dl/types";
import { stageHits, svgChunks } from "../dl/svg";
import { contentKey } from "../dl/key";
import { platform } from "../platform";
import { sceneFont } from "../render/glass";
import { fontStack } from "../model/fonts";

type HostPort = Port<CoreMethods, PageMethods, PageEvents, CoreEvents>;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export class CoreHost {
  private served = false; private client = ""; private me = "";
  private candidate: Workbook | null = null;
  private wb: Workbook | null = null;
  /** workbooks are numbered per index call; slices say which one they are of */
  private books = 0; private candidateBook = 0; private wbBook = 0;
  private name = "";
  private sync: DocSync | null = null;
  private readonly history = new History();
  private inputs: ViewInputs = { defaults: {}, logoSrc: "", version: "", workbook: "" };
  private slides: RuntimeSlide[] = []; private slidesDesign: Design | null = null; private presetSig = "";
  /** per workbook (the open one and the one being opened): the slice rectangles sent, by sheet */
  private sentBoxes = new Map<number, Map<string, string>>();
  private sentSharedFor = new Set<number>();
  private ack = 0;
  /** changes are processed one after the other (reading sheets is asynchronous) */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly port: HostPort, private readonly opts: HostOptions = {}) {
    const h: HostPort["handle"] = (m, fn) => port.handle(m, fn);
    h("init", a => {
      this.served = a.served; this.client = a.client; this.me = a.me; setPictureConverter(a.served ? (bytes, ext) => this.port.call("convertPicture", { bytes, ext }) : null);
      // the default wallpaper drawn while nothing is open: a new deck's first Liquid Glass slide finds it ready, and the
      // canvas's first blur and JPEG encoding are not paid between Finish and the first slide
      setTimeout(() => { void wallpaperIds(resolveStyle({})).catch(() => undefined); }, 0);
    });
    h("index", a => this.index(a.buf));
    h("ensure", a => this.ensure(a.book, a.names));
    h("getSheetMeta", async a => {
      const wb = this.bookOf(a.book);
      if (a.load) await this.ensure(a.book, a.names);
      return { sheets: wb.sheets.filter(S => a.names.includes(S.name)).map(sheetInfo), sizes: (a.tables || []).map(t => [t.id, tableSize(wb, t)] as [string, [number, number] | null]) };
    });
    h("getSheetWindow", a => { const S = this.sheetOf(a.book, a.sheet); return S ? sheetWindow(S, a.r0, a.r1, a.c0, a.c1) : null; });
    h("detectTables", a => { const S = this.sheetOf(a.book, a.sheet); return S ? detectTables(S) : []; });
    h("getCell", a => { const S = this.sheetOf(a.book, a.sheet); return S ? cellInfo(S, a.ref) : null; });
    h("staticFont", async a => {
      // only the worker carries hb-subset (opts.staticFace); the page's in-thread fallback stores fonts as they are
      if (!this.opts.staticFace) return { buf: a.buf, variable: false };
      const out = await this.opts.staticFace(new Uint8Array(a.buf), a.weight);
      return transfer({ buf: out.data.buffer as ArrayBuffer, variable: out.variable }, [out.data.buffer as ArrayBuffer]);
    });
    h("defaultPreset", a => { const wb = a.book !== undefined ? this.bookOf(a.book) : this.candidate; if (!wb) throw new Error("no workbook"); return defaultPreset(wb); });
    h("start", a => { if (a.stage) this.stageReq = { ...a.stage, fresh: false }; return this.start(a.book, a.name, a.deck, a.preset, a.inputs); });
    // the page waits for the redraw (the slices and snapshot of the new version or default style arrive before the answer)
    h("inputs", a => { this.inputs = a; return this.later(() => this.refresh(null)); });
    h("apply", a => {
      this.ack++;
      try {
        const sync = this.sync; if (!sync || !this.wb) { this.later(() => this.sendDoc(null)); return { changed: false }; }
        const inverse = sync.apply(a.ops);                      // the listener queues the redraw
        if (!inverse) { this.later(() => this.sendDoc(null)); return { changed: false }; }
        this.history.record(this.name, a.label, a.ops, inverse, a.coalesce, Date.now());
        return { changed: true };
      } catch (e) { this.later(() => this.sendDoc(null)); throw e; }   // the page drops its prediction
    });
    h("undo", a => {
      this.ack++;
      try {
        const st = this.history.take(a.redo);
        if (!st || !this.sync || st.file !== this.name) { this.later(() => this.sendDoc(null)); return { label: null, changed: false }; }
        const inv = this.sync.apply(a.redo ? st.redo : st.undo);
        this.history.done(st, a.redo, !!inv);
        if (!inv) this.later(() => this.sendDoc(null));
        return { label: st.label, changed: !!inv };
      } catch (e) { this.later(() => this.sendDoc(null)); throw e; }
    });
    h("flush", async () => { await this.sync?.flush(); });
    h("poll", async () => { await this.sync?.poll(); });
    h("alone", a => { this.alone = a.alone; this.sync?.setAlone(a.alone); this.scheduleRest(); });
    h("compactAll", async a => !this.sync || await this.sync.compactAll(a.waitMs));
    h("slideLists", a => this.lists(a));
    h("fontsSettling", () => !!(platform().text as { settling?: boolean }).settling || this.lateRedraws > 0);
    h("stage", a => { if (!a.nodes) this.stageReq = { ...a, fresh: false, have: undefined }; return this.queueStage(a); });
    // an export worker's own channel (S3.7): display lists go to it directly, never through the page's main thread
    h("linkExport", a => {
      const p = new Port<ExportCoreMethods, Record<string, never>, Record<string, never>, Record<string, never>>(a.port as unknown as Wire);
      p.handle("slideLists", x => this.lists(x));
      this.exportLinks.set(a.id, a.port);
    });
    h("unlinkExport", a => { const mp = this.exportLinks.get(a.id); this.exportLinks.delete(a.id); if (mp) { mp.onmessage = null; mp.close(); } });
    h("calcCheck", () => this.calcCheck());
    h("scenarioPreview", a => this.scenarioPreview(a));
    h("scenarioRun", a => this.scenarioRun(a));
    // the run stops after the value being made; a file of it that does not come within the grace period is given up
    // (a stuck export worker cannot hold the run for ever)
    h("scenarioCancel", a => { const r = this.runs.get(a.id); if (r && !r.cancel) { r.cancel = true; setTimeout(() => r.abort(new Error("cancelled: the file did not come")), this.opts.cancelGraceMs ?? 30_000); } });
    h("link", async a => {
      const wb = this.bookOf(a.book);
      if (!(await this.attachLinks(wb, [a.name]))) return null;
      // a small linked workbook is read at once (the wizard shows its titles and suggestions), as the main one
      const lwb = wb.linked.get(a.name)!;
      if (!lwb.big) { try { await wb.ensure(wb.meta.filter(m => m.linked === a.name).map(m => m.name), this.progress); } finally { this.port.emit("progress", null); } }
      if (wb === this.wb) await this.sendSlices(); else this.sendCandidateSlices();
      return this.info(wb, a.book);
    });
  }
  private info(wb: Workbook, book: number): WorkbookInfo {
    return { meta: wb.meta, skipped: wb.skipped, hiddenSheets: wb.hiddenSheets, extLinks: wb.extLinks, total: wb.total, ssSize: wb.ssSize, big: wb.big, book };
  }
  /** the linked workbooks `names` (file names of the same folder) join `wb` (S7.3): the page gives their bytes; a
      name already attached or not available changes nothing. True when every name is attached */
  private async attachLinks(wb: Workbook, names: string[]): Promise<boolean> {
    let all = true;
    for (const name of names) {
      if (wb.linked.has(name)) continue;
      let buf: ArrayBuffer | null = null;
      try { buf = await this.port.call("linkedWorkbook", { name }); } catch { buf = null; }
      if (!buf) { all = false; continue; }
      try { attachLinked(wb, name, await indexWorkbook(buf)); } catch (e) { console.error("linked workbook " + name, e); all = false; }
    }
    return all;
  }
  /* ---------------------------------------------------------------- the formula engine (S7.2, S7.4) */
  /** the engine's model of the open workbook and its linked workbooks, built on first use and kept while the workbook
      is open (a scenario sets one cell and evaluates: ≈ 65 ms on the 20-sheet deck); with its self-check */
  private calc: Promise<{ model: CalcModel; check: SelfCheck; checkOut: CalcCheck; sig: string }> | null = null;
  private calcSig(wb: Workbook) { return wb.sheets.map(S => S.name).join("\n") + "|" + [...wb.linked.keys()].join(","); }
  private async ensureCalc(wb: Workbook) {
    const sig = this.calcSig(wb);
    if (this.calc) { const c = await this.calc.catch(() => null); if (c && c.sig === sig && this.wb === wb) return c; if (c) c.model.dispose(); this.calc = null; }
    const run = (async () => {
      const t0 = now();
      // the workbooks the formulas link to, when they are in the folder (ADR-014), then every sheet
      const [{ CalcModel, loadEngine }] = await Promise.all([import("../calc/engine"), this.attachLinks(wb, wb.externals.filter(n => n !== "?"))]);
      // and the linked workbooks' own links (A → B → C), at most five files deep
      for (let depth = 0; depth < 5; depth++) {
        const names = [...wb.linked.values()].flatMap(l => l.externals).filter(n => n !== "?" && n !== this.name && !wb.linked.has(n));
        if (!names.length) break;
        const before = wb.linked.size; await this.attachLinks(wb, [...new Set(names)]);
        if (wb.linked.size === before) break;
      }
      try { await wb.ensure(wb.meta.map(m => m.name), this.progress); } finally { this.port.emit("progress", null); }
      const g = await loadEngine(); const t1 = now();
      if (this.wb !== wb) throw new Error("the workbook changed while the engine loaded");
      // the hidden sheets too, for the engine only (Decisions 2026-10-18: their data feeds the slides' formulas); one that
      // cannot be read stays "hidden" for the self-check
      const hiddenOf = async (w: Workbook, file: string | null) => {
        const read = await readHiddenSheets(w, file), got = new Set(read.map(S => parseSheetId(S.name).sheet));
        return { read, unread: w.hiddenSheets.filter(n => !got.has(n)) };
      };
      let own: Awaited<ReturnType<typeof hiddenOf>>, links: { file: string; lwb: Workbook; h: Awaited<ReturnType<typeof hiddenOf>> }[];
      if (wb.hiddenMeta?.length || [...wb.linked.values()].some(l => l.hiddenMeta?.length)) this.port.emit("progress", { text: "Reading the hidden data sheets…", frac: null });
      try { own = await hiddenOf(wb, null); links = await Promise.all([...wb.linked].map(async ([file, lwb]) => ({ file, lwb, h: await hiddenOf(lwb, file) }))); }
      finally { this.port.emit("progress", null); }
      const hiddenIds = new Set([...own.read, ...links.flatMap(l => l.h.read)].map(S => S.name));
      if (this.wb !== wb) throw new Error("the workbook changed while the engine loaded");
      const model = new CalcModel(g, [{ name: null, file: this.name, sheets: [...sheetsOf(wb, null), ...own.read], hidden: own.unread, externals: wb.externals, names: wb.names },
        ...links.map(({ file, lwb, h }) => ({ name: file, sheets: [...sheetsOf(wb, file), ...h.read], hidden: h.unread, externals: lwb.externals, names: lwb.names }))]);
      try {
        const t2 = now(); const check = model.selfCheck(); const t3 = now();
        // (the page gets no cell of a hidden sheet: it is counted, never listed)
        const shown = check.different.filter(d => !hiddenIds.has(d.book === null ? d.sheet : "[" + d.book + "]" + d.sheet));
        const checkOut: CalcCheck = { counts: check.counts, different: shown.slice(0, 20), formulas: model.formulas.length, styleError: model.styleError,
          ...(model.namesSkipped.length ? { namesSkipped: model.namesSkipped.slice(0, 20) } : {}), ...(check.textFormatted ? { textFormatted: check.textFormatted } : {}), ms: { load: t1 - t0, build: model.ms.build, evaluate: model.ms.evaluate, check: t3 - t2 } };
        return { model, check, checkOut, sig: this.calcSig(wb) };
      } catch (e) { model.dispose(); throw e; }
    })();
    this.calc = run; run.catch(() => { if (this.calc === run) this.calc = null; });
    return run;
  }
  /** the formula engine's self-check of the open workbook (S7.2) */
  private async calcCheck(): Promise<CalcCheck | null> {
    const wb = this.wb; if (!wb) return null;
    return (await this.ensureCalc(wb)).checkOut;
  }
  /** the scenario on the stage: the engine's input and what that cell held before (the engine's own content, put
      back when the scenario ends or moves), the view the renderers read, its digest (ctx.scenario) */
  private scen: { input: ScenarioInput; was: string; view: Workbook; hash: string; /** the sheets it changed */ sheets: Set<string> } | null = null;
  /** the page's copy of the cells follows the stage (S8.4, Decisions 2026-10-17: "Mirror the cells"): the sheets a
      preview changed (or changed back) sent again as slices of the same rectangles, cut from the stage's view */
  private sendViewSlices(names: Set<string>) {
    const wb = this.wb; if (!wb || !names.size) return;
    const sent = this.boxesFor(this.wbBook), view = this.viewWb!, sheets: SheetSlice[] = [];
    for (const n of names) {
      const box = sent.get(n), S = view.sheets.find(x => x.name === n);
      if (box === undefined || !S) continue;                         // a sheet the page has no slice of (not on a slide)
      sheets.push(sliceSheet(S, JSON.parse(box), wb.shared));
    }
    if (sheets.length) this.port.emit("slices", transfer({ book: this.wbBook, shared: null, sheets, rebuild: true as const, scenario: !!this.scen }, sheets.flatMap(sliceTransfer)));
  }
  /** `forRun`: a run starting clears the preview (it may while it is starting) */
  private async scenarioPreview(a: ScenarioInput | null, forRun = false): Promise<ScenarioAnswer | null> {
    const wb = this.wb; if (!wb) return null;
    // the engine holds the run's values meanwhile (one model): a preview waits until the run ends
    const busy = () => !forRun && this.running;
    if (busy()) throw new Error("a run for each value is going on: preview once it has ended");
    const c = await this.ensureCalc(wb);
    if (this.wb !== wb) return null;
    const at = (inp: ScenarioInput) => { const { book, sheet } = parseSheetId(inp.sheet), rc = splitRef(inp.ref); return rc ? { book, sheet, r: rc.r, c: rc.c } : null; };
    let answer: ScenarioAnswer | null = null, refused = false;
    // in the change queue, like every other redraw of the slides (an apply or undo arriving meanwhile waits its turn)
    await this.later(async () => {
      // the model may have been rebuilt (sheets or links changed) and freed while this call waited its turn; a run may
      // have started meanwhile (it owns the engine)
      if (this.wb !== wb || this.calcSig(wb) !== c.sig) return;
      if (busy()) { refused = true; return; }
      // the previous input cell back to what it held (a constant, a formula, or nothing at all)
      if (this.scen) { const p = at(this.scen.input); if (p) c.model.restore(p.book, p.sheet, p.r, p.c, this.scen.was); }
      const before = this.scen?.sheets ?? new Set<string>();
      this.scen = null;
      // whatever happens below (an input that is not a cell, an engine error), the page and the stage are told: the
      // sheets the last preview changed are sent back as they are now, and the slides drawn again
      try {
      if (a) {
        const p = at(a); if (!p) return;
        const was = c.model.contentOf(p.book, p.sheet, p.r, p.c);
        if (!c.model.set(p.book, p.sheet, p.r, p.c, a.value)) return;
        c.model.evaluate();
        const changes = c.model.changes();
        let changed = 0, different = 0;
        const diff = new Set(c.check.allDifferent.map(d => (d.book === null ? d.sheet : "[" + d.book + "]" + d.sheet) + "!" + d.ref));
        for (const [sheet, m] of changes) for (const k of m.keys()) { changed++; const [r, col] = k.split(",").map(Number); if (diff.has(sheet + "!" + numToCol(col) + r)) different++; }
        withInput(changes, a.sheet, p.r, p.c, a.value);                // (counted above: the formulas that moved)
        const hash = overlayHash(changes);
        this.scen = { input: a, was, view: overlayWorkbook(wb, changes), hash, sheets: new Set(changes.keys()) };
        const unsure = c.model.textUnknown + c.model.textUnsettled;
        answer = { changed, different, check: c.checkOut, ...(unsure ? { textUnknown: unsure } : {}), ...(!changed && !sameInput(was, a.value) ? { still: true } : {}) };
      } else {
        c.model.evaluate();
        // nothing may be left behind: the engine is back at its baseline
        let left = 0; for (const m of c.model.changes().values()) left += m.size;
        answer = { changed: left, different: 0, check: c.checkOut };
      }
      } finally {
        // the slides are built again from the view (or the workbook): every view is a new object, so the layout cache
        // would miss anyway – clearing it keeps it from growing by one set of layouts per preview
        LCACHE.clear(); this.slidesDesign = null;
        this.sendViewSlices(new Set([...before, ...(this.scen?.sheets ?? [])]));
        await this.refresh(null, true);
      }
    });
    if (refused) throw new Error("a run for each value is going on: preview once it has ended");
    return answer;
  }
  /** what the renderers read: the scenario's view while one shows, else the workbook */
  private get viewWb(): Workbook | null { return this.scen?.view ?? this.wb; }

  /* ---------------------------------------------------------------- Run for each value (S8.3, 07 §2.4) */
  /** the runs going on (one at a time): the view of the value being made, its digest, its slides by design, the
      cells marked (run anyway), the names its files were saved under */
  private runs = new Map<string, Run>(); private runSeq = 0;
  /** a run being started (from its first check until it is registered): another run or a preview is refused meanwhile */
  private runStarting = false;
  private get running() { return this.runs.size > 0 || this.runStarting; }
  /** the gate (RC-06): the cells the run will draw – the tables of the slides not hidden in each of its designs (S13.6),
      unless every chosen version removes the cell – that the self-check classes different (all of them, not only its first 200), and the
      cells kept at Excel's value – locale-dependent TEXT, or reading a linked workbook / hidden sheet not in the model –
      (named in the report) */
  private gateCells(check: SelfCheck, designs: Design[], versions: string[]): { cells: GateCell[]; kept: KeptCell[] } {
    const id = (d: { book: string | null; sheet: string; ref: string }) => (d.book === null ? d.sheet : "[" + d.book + "]" + d.sheet) + "!" + d.ref;
    const diff = new Map(check.allDifferent.map(d => [id(d), d]));
    const pinned = new Map<string, { ref: string; text: string; why: KeptCell["why"] }>([
      ...check.frozen.map(d => [id(d), d] as const), ...check.pinned.map(d => [id(d), { ...d, why: "text" as const }] as const)]);
    const out = new Map<string, GateCell>(), kept = new Map<string, KeptCell>();
    const vers = (this.sync?.view.preset?.versions || []).filter(v => versions.includes(v.id)), full = versions.includes("");
    const removed = (sheet: string, r: number, c: number) => !full && vers.length > 0 && vers.every(v => (v.hide?.[sheet] || []).some(rg => {
      const g = rangeToG(rg); return r > g.r1 && r < g.r2 && c > g.c1 && c < g.c2;           // (rangeToG's bounds are outside the range)
    }));
    if (diff.size || pinned.size) for (const d of designs) for (const R of this.slidesFor(d, "own")) if (!hiddenIn(R.cfg, d)) for (const L of R.tables) for (const it of L.items) {
      const k = L.sheet.name + "!" + A1(it.b.src.r, it.b.src.c), dd = diff.get(k), p = pinned.get(k);
      if (!dd && !p || removed(L.sheet.name, it.b.src.r, it.b.src.c)) continue;
      if (dd && !out.has(k)) out.set(k, { sheet: L.sheet.name, ref: dd.ref, text: dd.text, cached: dd.cached, computed: dd.computed });
      if (p && !kept.has(k)) kept.set(k, { sheet: L.sheet.name, ref: p.ref, text: p.text, why: p.why });
    }
    return { cells: [...out.values()], kept: [...kept.values()] };
  }
  private async scenarioRun(a: ScenarioRunReq): Promise<ScenarioRunStart> {
    const wb = this.wb; if (!wb || !this.sync) throw new Error("no workbook is open");
    if (this.running) throw new Error("a run for each value is going on already");
    if (!a.values.length || !a.designs.length || !a.versions.length) throw new Error("nothing to run: no value, design or version");
    const rc = splitRef(a.input.ref), S = wb.sheets.find(x => x.name === a.input.sheet);
    if (!rc || !S) throw new Error(`no cell ${a.input.sheet}!${a.input.ref} in this workbook`);
    this.runStarting = true;                                         // (before the first await: one run at a time)
    try {
      const c = await this.ensureCalc(wb);
      if (this.wb !== wb) throw new Error("the workbook changed");
      if (this.scen) await this.scenarioPreview(null, true);         // the run takes the engine: a preview ends first
      const gate = this.gateCells(c.check, a.designs, a.versions);
      if (gate.cells.length && !a.runAnyway) return { id: null, blocked: gate.cells };
      // the values as the input cell shows them (its number format): the files' names
      const cell = S.get(rc.r, rc.c), fmt = cell?.fmt || "General";
      const shown = a.values.map(v => typeof v === "number" ? formatValue({ v, t: cell?.t === "d" ? "d" : "n", fmt }).text : typeof v === "boolean" ? formatValue({ v, t: "b", fmt }).text : v);
      const vers = this.sync.view.preset?.versions || [];
      // (a run of PowerPoint files names them as its PDFs, cut to fit the longer extension)
      const kinds: FileKind[] = a.kinds?.length ? [...new Set(a.kinds.filter(k => k === "pdf" || k === "pptx"))] : ["pdf"];
      a = { ...a, kinds };
      const { stems, labels, bump } = scenarioRunNames(shown, a.designs, a.versions.map(id => id ? (vers.find(x => x.id === id)?.name ?? id) : null), kinds.includes("pptx") ? "pptx" : "pdf", a.folder ?? ASSUMED_FOLDER);
      const id = "run" + ++this.runSeq;
      let abort: (e: Error) => void = () => undefined;
      const stop = new Promise<never>((_, no) => { abort = no; }); stop.catch(() => undefined);
      const run: Run = { id, wb, cancel: false, stop, abort, view: null, hash: "", slides: new Map(), taken: new Set(), marked: new Set(a.runAnyway ? gate.cells.map(g => g.sheet + "!" + g.ref) : []) };
      this.runs.set(id, run);
      void this.runLoop(run, a, wb, c, { book: parseSheetId(a.input.sheet).book, sheet: parseSheetId(a.input.sheet).sheet, r: rc.r, c: rc.c }, shown, stems, labels, bump);
      return { id, total: a.values.length, shown, marked: a.runAnyway ? gate.cells : [], kept: gate.kept };
    } finally { this.runStarting = false; }
  }
  /** one value at a time; between values the stage and every other request are served (the change queue) */
  private async runLoop(run: Run, a: ScenarioRunReq, wb: Workbook, c: { model: CalcModel; sig: string }, p: { book: string | null; sheet: string; r: number; c: number },
    shown: string[], stems: string[], labels: (string | null)[], bump: (i: number, k: number) => string) {
    const total = a.values.length, live = () => this.wb === wb && this.calcSig(wb) === c.sig;
    let done = 0, was: string | null = null, error = "";
    /** a name a file of this run was saved under already (the helper's own " (2)" for a file open elsewhere can take a
        name the run planned for a later value): the next free " (k)" after the value */
    const free = (i: number, d: Design, j: number, ext: FileKind) => {
      let name = runFileName(stems[i], d, labels[j], ext);
      for (let k = 2; run.taken.has(name.toUpperCase()); k++) name = runFileName(bump(i, k), d, labels[j], ext);
      return name;
    };
    try {
      for (let i = 0; i < total && !run.cancel; i++) {
        let ok = false, unsure = 0, moves = 0;
        await this.later(() => {
          if (!live()) return;
          if (was === null) was = c.model.contentOf(p.book, p.sheet, p.r, p.c);
          if (!c.model.set(p.book, p.sheet, p.r, p.c, a.values[i])) return;
          c.model.evaluate();
          const moved = c.model.changes();
          moves = 0; for (const m of moved.values()) moves += m.size;
          const changes = withInput(moved, a.input.sheet, p.r, p.c, a.values[i]);
          run.view = overlayWorkbook(wb, changes); run.hash = run.id + "." + i + overlayHash(changes); run.slides.clear();
          unsure = c.model.textUnknown + c.model.textUnsettled;
          ok = true;
        });
        if (!ok) throw new Error(live() ? "the input cell could not be set" : "the workbook changed during the run");
        // one file per (design, version): the export workers, three at a time, through the page; a cancel also ends a
        // file that does not come (a stuck worker), so the run always ends
        const jobs = a.designs.flatMap(d => a.versions.flatMap((v, j) => a.kinds.map(kind => ({ d, v, kind, name: free(i, d, j, kind) }))));
        const res = await Promise.allSettled(jobs.map(j => Promise.race([run.stop,
          this.port.call("scenarioFile", { id: run.id, design: j.d, version: j.v, name: j.name, title: j.name.replace(/\.(pdf|pptx)$/, ""), today: a.today, kind: j.kind })])));
        const files = res.flatMap(r => r.status === "fulfilled" ? [r.value.file] : []);
        // nothing moved although the value is not the cell's own: the slides cannot follow it
        const still = !moves && !sameInput(was, a.values[i]);
        for (const f of files) run.taken.add(f.toUpperCase());
        const failed = res.flatMap((r, k) => r.status === "rejected" ? [jobs[k].name + ": " + String((r.reason as Error)?.message || r.reason)] : []);
        run.view = null; run.slides.clear();                       // the value's view is dropped
        done++;
        this.port.emit("scenario", { id: run.id, done, total, value: shown[i], status: failed.length ? "failed" : "ok", files, ...(failed.length ? { error: failed.join(" · ") } : {}),
          ...(unsure || still ? { warning: [
            // no formula moved (a real run made identical files without a word, 2026-10-18): said, so nobody takes them for results
            ...(still ? [`no formula of the workbook changed with this value: its files show the workbook's own numbers (does ${a.input.sheet}!${a.input.ref} feed the slides' cells?)`] : []),
            ...(unsure ? [`${unsure} TEXT cell${unsure === 1 ? "" : "s"} could not be formatted for this value: they show the previous value's text`] : [])].join(" · ") } : {}) });
        if (!live()) throw new Error("the workbook changed during the run");
        await new Promise(r => setTimeout(r, 0));                  // yield: requests waiting are served
      }
    } catch (e) { error = String((e as Error)?.message || e); }
    finally {
      run.view = null;
      // the input cell back to what it held, in the engine only (the workbook file is never written)
      await this.later(() => { if (was !== null && live()) { c.model.restore(p.book, p.sheet, p.r, p.c, was); c.model.evaluate(); } });
      this.runs.delete(run.id);
      // the run's layouts (built from its views) leave the layout cache
      for (const [k, v] of LCACHE) if (v.wb !== this.wb) LCACHE.delete(k);
      this.port.emit("scenario", { id: run.id, done, total, value: null, status: run.cancel && done < total ? "cancelled" : "end", files: [], ...(error ? { error } : {}) });
    }
  }
  /** the export workers' channels, by the page's number for each (closed when the worker stops) */
  private exportLinks = new Map<number, MessagePort>();
  /** display lists are built one request at a time (export workers ask in parallel; each build asks the page to measure) */
  private listQueue: Promise<unknown> = Promise.resolve();
  private lists(a: SlideListsReq) {
    const run = this.listQueue.then(() => this.slideLists(a));
    this.listQueue = run.catch(() => undefined);
    return run;
  }

  /* ---------------------------------------------------------------- opening */
  private async index(buf: ArrayBuffer): Promise<WorkbookInfo> {
    // the number is taken before reading, so the newest open always wins whichever read finishes first: an older
    // call still reading, or one that finishes later, fails (SUPERSEDED) instead of answering with another's number
    // the previous candidate's records go – not the open workbook's (after start the two numbers are the same)
    if (this.candidateBook && this.candidateBook !== this.wbBook) { this.sentBoxes.delete(this.candidateBook); this.sentSharedFor.delete(this.candidateBook); }
    const book = this.candidateBook = ++this.books;
    this.candidate = null;
    const superseded = () => { if (this.candidateBook !== book) throw Object.assign(new Error("another workbook is being opened"), { code: "SUPERSEDED" }); };
    const wb = await indexWorkbook(buf);
    superseded();
    this.candidate = wb;
    // small workbooks are read completely (the wizard shows titles and table suggestions for every sheet)
    try { if (!wb.big) await wb.ensure(wb.meta.map(m => m.name), this.progress); }
    finally { this.port.emit("progress", null); }
    superseded();
    this.sendCandidateSlices();
    return this.info(wb, book);
  }
  private progress = (text: string, frac: number | null) => this.port.emit("progress", { text, frac });
  /** the workbook a call is about: the one being opened, or the open one (by the number index gave it) */
  private bookOf(book: number): Workbook {
    if (this.candidate && book === this.candidateBook) return this.candidate;
    if (this.wb && book === this.wbBook) return this.wb;
    throw new Error("this workbook is no longer open");
  }
  /** for calls without a number (defaultPreset): the one being opened, else the open one */
  private get book() { const wb = this.candidate || this.wb; if (!wb) throw new Error("no workbook"); return wb; }
  private async ensure(book: number, names: string[]) {
    const wb = this.bookOf(book);
    try { await wb.ensure(names, this.progress); } finally { this.port.emit("progress", null); }
    if (wb === this.wb) await this.sendSlices(); else this.sendCandidateSlices();
  }
  /** a loaded sheet of workbook `book` */
  private sheetOf(book: number, name: string) { return this.bookOf(book).sheets.find(S => S.name === name) || null; }

  /** before start: the candidate's loaded sheets (whole when small), for the wizard and the first preset */
  private sendCandidateSlices() {
    const wb = this.candidate; if (!wb) return;
    const boxes = sliceBoxes(wb, [], {}), sheets: SheetSlice[] = [], sent = this.boxesFor(this.candidateBook);
    for (const [name, box] of boxes) {
      const k = JSON.stringify(box); if (sent.get(name) === k) continue;
      sent.set(name, k); sheets.push(sliceSheet(wb.sheets.find(s => s.name === name)!, box, wb.shared));
    }
    // the shared parts (styles, strings – large for a big workbook) travel once, with the first sheet that needs them:
    // the mirror needs them only to read sheets, and sending them alone would copy them onto the page for nothing
    if (!sheets.length) return;
    const shared: SharedSlice | null = wb.shared && !this.sentSharedFor.has(this.candidateBook) ? sliceShared(wb.shared) : null;
    if (shared) this.sentSharedFor.add(this.candidateBook);
    this.port.emit("slices", transfer({ book: this.candidateBook, shared, sheets }, sheets.flatMap(sliceTransfer)));
  }
  private async start(book: number | undefined, name: string, deck: DeckOpen, preset: Preset | null, inputs: ViewInputs): Promise<DocState> {
    const doc = fold(deck.snapshot, Object.values(deck.tail?.journals || {}).flatMap(j => j.records)).doc;
    const cand = this.candidate, gone = () => !cand || cand !== this.candidate || (book !== undefined && book !== this.candidateBook);
    // failures before the switch carry NOT_STARTED: the open document stays open here and on the page
    const notStarted = (e: unknown) => Object.assign(e instanceof Error ? e : new Error(String(e)), { code: "NOT_STARTED" });
    if (gone()) throw notStarted(new Error(cand ? "this workbook is no longer being opened" : "no workbook"));
    // the slides' sheets are read before the document changes owner: a sheet that fails leaves the open one as it was;
    // the deck's linked workbooks first (a missing one leaves its sheets broken, the deck opens)
    try { await this.attachLinks(cand!, (preset || doc.preset)?.links || []); await cand!.ensure(presetSheets(preset || doc.preset), this.progress); }
    catch (e) { throw notStarted(e); }
    finally { this.port.emit("progress", null); }
    if (gone()) throw notStarted(new Error("this workbook is no longer being opened"));
    // the previous document stops showing, but what it has not saved yet is still saved (and retried)
    const left = this.name;
    this.sync?.retire(() => this.port.emit("retiredSaved", { name: left }));
    if (this.wbBook && this.wbBook !== this.candidateBook) { this.sentBoxes.delete(this.wbBook); this.sentSharedFor.delete(this.wbBook); }
    this.wb = this.candidate; this.wbBook = this.candidateBook; this.candidate = null; this.name = name; this.inputs = inputs;
    // another workbook: its own engine model, no scenario
    if (this.calc) { void this.calc.then(c => c.model.dispose(), () => undefined); this.calc = null; } this.scen = null;
    this.stageCache.clear();                                    // another workbook (or the same file read again): its own tables
    LCACHE.clear(); this.slidesDesign = null; this.presetSig = ""; this.boxSig = "";
    this.history.undo = []; this.history.redo = [];         // a newly opened workbook starts without history (as v3)
    this.sentView = { obj: null, json: "" };
    const sync = this.sync = new DocSync(this.api, name, deck, this.me, { autoTail: this.opts.autoTail });
    sync.setAlone(this.alone);
    if (preset) sync.apply([{ op: "preset.set", preset }]);
    sync.on(c => this.later(() => this.onChange(sync, c)));
    try {
      try { await cand!.ensure(presetSheets(sync.view.preset), this.progress); } finally { this.port.emit("progress", null); }
      await this.refresh(null, true);
    } catch (e) {                                            // no document is open here now (the page closes its own)
      sync.dispose(); this.sync = null; this.wb = null; this.wbBook = 0; this.name = "";
      throw e;
    }
    const st = this.state(); this.sentView = { obj: st.view, json: viewJson(st.view) };
    return st;
  }
  /** the deck storage of the helper, through the page */
  private readonly api: DeckApi = (() => {
    const self = this;
    return {
      get served() { return self.served; },
      snapshot: key => self.port.call("deckSnapshot", { key }),
      tail: (key, since) => self.port.call("deckTail", { key, since }),
      append: (key, writer, record) => self.port.call("deckAppend", { key, writer, record }),
      compact: (key, baseGen, snapshot) => self.port.call("deckCompact", { key, baseGen, snapshot }),
      rotate: (key, writer) => self.port.call("deckRotate", { key, writer }),
      prepare: (key, writer) => self.port.call("deckPrepare", { key, writer }),
      format5: key => self.port.call("deckFormat5", { key }),
    };
  })();
  /** the page's last presence heartbeat said this page is the only one with the deck open */
  private alone = false;

  /* ---------------------------------------------------------------- changes */
  private later(fn: () => Promise<void> | void): Promise<void> { return this.queue = this.queue.then(fn).catch(e => this.port.emit("error", { message: String((e as Error)?.message || e), stack: (e as Error)?.stack })); }
  private async onChange(sync: DocSync, c: Change) {
    if (sync !== this.sync) return;
    // a preset change (also another person's) may add linked workbooks: attached before their sheets are read
    if (c.presetChanged) { try { await this.attachLinks(this.wb!, sync.view.preset?.links || []); await this.wb!.ensure(presetSheets(sync.view.preset), this.progress); } finally { this.port.emit("progress", null); } }
    await this.refresh(c);
  }
  private style(): Style { return resolveStyle(this.inputs.defaults as never, this.sync?.view.style) as Style; }
  /** `src`: whose values – the stage's ("stage": the preview's view while one shows), the workbook's own ("own"), or a
      run's view */
  private ctx(design?: Design, version?: string, forExport = false, src: Source = "stage"): RenderCtx {
    // another design: resolved as the page does (that design's own looks apply)
    const v = this.sync!.view, st = this.style(), s = design && design !== st.design ? resolveStyle(this.inputs.defaults as never, { ...(v.style || {}), design }) as Style : st;
    const vid = version ?? this.inputs.version, wb = typeof src === "object" ? src.view : src === "own" ? this.wb : this.viewWb;
    const scenario = typeof src === "object" ? src.hash : src === "stage" && this.scen ? this.scen.hash : "";
    return { style: s, edits: v.edits || {}, slides: this.slidesFor(s.design, src), preset: v.preset || null, workbook: this.inputs.workbook || this.name,
      logoSrc: this.inputs.logoSrc, sheet: n => wb?.sheets.find(x => x.name === n) || null,
      version: (v.preset?.versions || []).find(x => x.id === vid) || null, ...(forExport ? { forExport: true } : {}), ...(scenario ? { scenario } : {}) };
  }
  private slidesFor(design: Design, src: Source = "stage"): RuntimeSlide[] {
    if (!this.wb || !this.sync) return [];
    if (typeof src === "object") {
      if (!src.view) return [];
      const key = design + "|" + this.presetSig;
      let R = src.slides.get(key); if (!R) src.slides.set(key, R = runtimeSlides(src.view, this.sync.view.preset, this.name, design));
      return R;
    }
    // the workbook's own values while a preview shows: its own slides (the stage's are the preview's)
    if (src === "own" && this.scen) return runtimeSlides(this.wb, this.sync.view.preset, this.name, design);
    if (design === this.slidesDesign) return this.slides;
    return runtimeSlides(this.viewWb!, this.sync.view.preset, this.name, design);
  }
  /** the slides of the current design (re-resolved when the preset or the design changed), then send */
  private async refresh(c: Change | null, force = false) {
    if (!this.wb || !this.sync) return;
    const design = this.style().design, sig = JSON.stringify(this.sync.view.preset);
    if (force || sig !== this.presetSig || design !== this.slidesDesign) {
      this.presetSig = sig; this.slidesDesign = design;
      this.slides = runtimeSlides(this.viewWb!, this.sync.view.preset, this.name, design);
    } else {
      // same preset: the slide definitions (layout, titles, text boxes) live in the runtime slides
      const byId = new Map((this.sync.view.preset?.slides || []).map(s => [s.id, s]));
      for (const R of this.slides) { const cfg = byId.get(R.id); if (cfg && cfg !== R.cfg) R.cfg = cfg; }
    }
    await this.sendSlices();
    this.sendDoc(c);
    // a change (or the start): the slide on the stage drawn at once and sent unasked (keypress → pixels, S4.1) – never
    // waited for (a picture the page is slow to read must not hold the snapshot, a save, or a workbook's start)
    // (a compaction that changed only the deck's health redraws nothing)
    const drawn = force || (!!c && (c.local || c.presetChanged || c.styleChanged || c.editsChanged || c.stateChanged));
    if (drawn && this.stageReq) void this.queueStage(this.stageReq).then(s => { if (s) this.port.emit("stage", s); }, () => undefined);
  }
  /** slices of every loaded sheet whose rectangle changed (or that is new) */
  private boxSig = "";
  private boxesFor(book: number) { let m = this.sentBoxes.get(book); if (!m) this.sentBoxes.set(book, m = new Map()); return m; }
  private async sendSlices() {
    const wb = this.wb; if (!wb || !this.sync) return;
    // what the rectangles depend on: the loaded sheets, the tables, the painted formats' sources
    const edits = (this.sync.view.edits || {}) as Record<string, Record<string, { cf?: string }>>;
    const cfs = Object.values(edits).flatMap(e => Object.values(e || {}).flatMap(x => x && x.cf ? [x.cf] : []));
    const sig = wb.sheets.map(S => S.name).join("\n") + "|" + this.presetSig + "|" + JSON.stringify(cfs);
    if (sig === this.boxSig) return;
    this.boxSig = sig;
    const layouts = this.slides.flatMap(R => R.tables.map(L => ({ sheet: L.sheet, g: L.g })));
    const boxes = sliceBoxes(wb, layouts, edits), sheets: SheetSlice[] = [], sent = this.boxesFor(this.wbBook);
    for (const [name, box] of boxes) {
      const k = JSON.stringify(box); if (sent.get(name) === k) continue;
      sent.set(name, k);
      // (while a preview shows, the page's copy follows the stage: the slice is cut from the scenario's view, S8.4)
      sheets.push(sliceSheet((this.viewWb ?? wb).sheets.find(s => s.name === name) ?? wb.sheets.find(s => s.name === name)!, box, wb.shared));
    }
    if (sheets.length) {                                         // the shared parts once, with the first sheets (as above)
      const shared: SharedSlice | null = wb.shared && !this.sentSharedFor.has(this.wbBook) ? sliceShared(wb.shared) : null;
      if (shared) this.sentSharedFor.add(this.wbBook);
      this.port.emit("slices", transfer({ book: this.wbBook, shared, sheets, ...(this.scen ? { rebuild: true as const, scenario: true } : {}) }, sheets.flatMap(sliceTransfer)));
    }
  }
  /** what a slide needs besides its tables: the wallpaper (Liquid Glass) and the logo with its size. `stage`: the logo is
    not waited for longer than 1.5 s (the page reads it: a slow answer must not hold the stage) – the stage gets its
    slide again once it is known; exports wait for it */
  private async slideImages(ctx: RenderCtx, stage = false): Promise<SlideImages> {
    const wall = ctx.style.design === "glass" ? await wallpaperIds(ctx.style) : null;
    let logo: SlideImages["logo"] = null;
    if (ctx.logoSrc) {
      const read = analyzeImages([ctx.logoSrc]);
      if (!stage) await read;
      else if (!IMGMETA.has(ctx.logoSrc) && !await Promise.race([read.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 1500))]))
        void read.then(() => { if (this.stageReq) void this.queueStage(this.stageReq).then(s => { if (s) this.port.emit("stage", s); }, () => undefined); });
      const mm = IMGMETA.get(ctx.logoSrc);
      logo = { id: "logo-" + sha1(new TextEncoder().encode(ctx.logoSrc)).slice(0, 16), src: ctx.logoSrc, w: mm?.w || 0, h: mm?.h || 0 };
    }
    return { wall, logo };
  }
  /** whole slides as display lists (S3.5): background, furniture, the tables placed and scaled, text boxes */
  private async slideLists(a: SlideListsReq) {
    if (!this.wb || !this.sync) return [];
    let src: Source = "own";
    if (a.scenario === "preview") src = "stage";
    else if (a.scenario) { const r = this.runs.get(a.scenario); if (!r || !r.view || r.wb !== this.wb) throw new Error("this run has ended"); src = r; }
    const run = typeof src === "object" ? src : null;
    const ctx = this.ctx(a.design, a.version, a.forExport, src), glass = ctx.style.design === "glass", out: SlideList[] = [];
    // the PowerPoint export: the design's chart colours as the theme's accents
    const palette = a.pptx ? chartLook(ctx, "").colors.slice(0, 6) : [];
    await glassFonts(ctx);
    const { wall, logo } = await this.slideImages(ctx);
    for (const [s, R] of ctx.slides.entries()) {
      // an export of the deck leaves out the design's hidden slides (S13.6, B47); slides named are drawn (the current one)
      if (a.slides ? !a.slides.includes(s) : a.forExport && isHidden(ctx, s)) continue;
      const boxes = computeLayout(R, ctx).boxes, tables: TableDL[] = [], sc = slideCtx(ctx, R);     // the slide's own look (B29)
      for (const [i, L] of R.tables.entries()) {
        const b = boxes[i], noText = a.thumb && L.items.length > 1200;
        const dl = glass ? await glassTableDL(L, sc, { x: b?.x ?? 0, y: b?.y ?? 0, scale: b?.scale ?? 1 }, wall?.blur ?? null, { noText }) : await flatTableDL(L, sc, { noText });
        // a run started anyway: the cells the self-check classes different get their red corner (RC-06)
        tables.push(run?.marked.size ? { ...dl, nodes: markCells(dl.nodes, L, run.marked) } : dl);
      }
      const dl = await measuredBuild(m => slideToDisplayList(R, s, ctx, tables, boxes, { wall, logo }, m, a.today, { sem: !!a.pptx }));
      if (!a.pptx) { out.push({ slide: s, dl }); continue; }
      const items: SlideSem["items"] = {};
      for (const [id, it] of Object.entries(dl.items)) if (it.pptx) items[id] = it.pptx;
      out.push({ slide: s, dl: { nodes: dl.nodes, images: dl.images }, sem: { type: R.type === "cover" || R.type === "index" ? R.type : "content", items, palette } });
    }
    return out;
  }
  /* ---------------------------------------------------------------- the stage (S4.1) */
  /** the stage's table display lists by what they are drawn from (content, sizes, design, style; for Liquid Glass also
      the placement, which the frosted wallpaper behind the glass depends on), most recently used last; with their
      SVG markup per way of drawing it (the layer's id prefix, soft shadows) */
  private stageCache = new Map<string, { id: string; dl: TableDL; svg: Map<string, string[]> }>();
  private stageSeq = 0;
  private stageQueue: Promise<unknown> = Promise.resolve();
  /** the stage's last request (which slide it shows, how): after a change the worker sends that slide without being
      asked, a page round trip sooner */
  private stageReq: StageReq | null = null;
  /** redraws a late font started that have not reached the page yet (fontsSettling: the capture tools wait for them) */
  private lateRedraws = 0;
  /** the pictures the page has (named in its requests, or sent to it) */
  private pageImages = new Set<string>();
  private queueStage(a: StageReq): Promise<StageSlide | null> {
    const run = this.stageQueue.then(() => this.stage({ ...a, known: [...new Set([...a.known, ...this.pageImages])] }));
    this.stageQueue = run.catch(() => undefined);
    return run.then(s => { if (s) for (const id of Object.keys(s.images)) this.pageImages.add(id); return s; });
  }
  /** the slide on the stage in layers, each as SVG markup: each table its own (built only when what it is drawn from
      changed), each text box its own, the furniture between them. One request at a time, apart from the exports'
      lists (an export never delays the stage) */
  private async stage(a: StageReq): Promise<StageSlide | null> {
    if (!this.wb || !this.sync) return null;
    if (a.fresh) { this.stageCache.clear(); forgetMeasurements(); platform().text.reset?.(); }
    const ctx = this.ctx(), R = ctx.slides[a.slide]; if (!R) return null;
    await glassFonts(ctx);
    const glass = ctx.style.design === "glass", img = await this.slideImages(ctx, true), soft = !!a.soft;
    const sc = slideCtx(ctx, R);                                       // the slide's own look (B29)
    const boxes = computeLayout(R, ctx).boxes, tables: TableDL[] = [], hits: { id: string; dl: TableDL; svg: Map<string, string[]> }[] = [], styleSig = JSON.stringify(sc.style);
    for (const [i, L] of R.tables.entries()) {
      const b = boxes[i], place = { x: b?.x ?? 0, y: b?.y ?? 0, scale: b?.scale ?? 1 };
      // which table (tableDrawKey does not name it), then what it is
      // drawn from – with the edits of its own cells only (tableKey has the whole sheet's: an edit in one table must not
      // draw the others of its sheet again)
      const who = L.sheet.name + "|" + (L.id || "") + "|" + ctx.style.design + "|" + soft + "|" + (ctx.scenario || "");
      const own = { ...sc, _keys: new Map([[L.sheet.name, ownEdits(L, sc)]]) };
      const key = who + "|" + tableDrawKey(R, i, own) + "|" + styleSig + (glass ? "|" + place.x + "," + place.y + "," + place.scale : "");
      let hit = this.stageCache.get(key);
      if (hit) this.stageCache.delete(key);
      else {
        hit = { id: "t" + (++this.stageSeq), dl: glass ? await glassTableDL(L, sc, place, img.wall?.blur ?? null) : await flatTableDL(L, sc), svg: new Map() };
        // a table keeps its last few drawings (undo, redo); older ones of the same table go
        const mine = [...this.stageCache.keys()].filter(k => k.startsWith(who + "|"));
        for (const k of mine.slice(0, Math.max(0, mine.length - 2))) this.stageCache.delete(k);
      }
      this.stageCache.set(key, hit);
      tables.push(hit.dl); hits.push(hit);
    }
    while (this.stageCache.size > STAGE_CACHE) this.stageCache.delete(this.stageCache.keys().next().value!);
    const dl = await measuredBuild(m => slideToDisplayList(R, a.slide, ctx, tables, boxes, img, m, a.today));
    // the screen draws a font's text as outlines where the browser's own would not match the PDF (S4.4: the per-font
    // check, once per face), or every font's when asked (the SP switch)
    const tm = platform().text;
    // a font whose file came after the measuring budget (the page measured its text meanwhile): measured and drawn again
    if (tm.onLate === null) tm.onLate = () => {
      this.stageCache.clear(); forgetMeasurements();
      if (!this.stageReq) return;
      this.lateRedraws++;
      void this.queueStage(this.stageReq).then(s => { if (s) this.port.emit("stage", s); }, () => undefined).finally(() => { this.lateRedraws--; });
    };
    if (tm.check) {
      tm.outlineAll = a.outlines === "all";
      const fonts = new Set<string>(), walk = (ns: Node[]) => { for (const n of ns) if (n.t === "group") walk(n.children); else if (n.t === "text") fonts.add(`${n.i ? "italic " : ""}${weightOf(n)} 11px ${n.css || n.font}`); };
      walk(dl.nodes);
      // a font not checked yet is drawn as text now; if its check turns it to outlines, the slide is sent again
      const list = [...fonts];
      // (half a second later: the page measures the probes, which must not hold the slide's first frame)
      if (!tm.checked?.(list)) setTimeout(() => void tm.check!(list).then(changed => { if (changed && this.stageReq) void this.queueStage(this.stageReq).then(s => { if (s) this.port.emit("stage", s); }, () => undefined); }, () => undefined), 500);
    }
    const mode = (soft ? "s" : "") + (a.outlines === "all" ? "o" : "") + (tm.outlineSig?.() || "");
    // pictures by placeholder (the page puts its own URL for each: stage/data.ts); ids of gradients and clips per layer
    const markup = (nodes: DisplayList, prefix: string, table: boolean) => svgChunks(nodes, { imageHref: id => "sbimg:" + id, idPrefix: prefix, softShadows: soft, outline: n => tm.outlineRun?.(n) ?? null, ...(table ? { hits: stageHits } : {}) });
    // the layers: a "tw" hit followed by its group is a table (in the order of the tables that have a box); the
    // nodes between tables are furniture layers, named by their content
    const drawn = R.tables.flatMap((_, i) => boxes[i] && tables[i] ? [i] : []), layers: StageLayer[] = [];
    let run: DisplayList = [], k = 0, nf = 0, nn = 0, ni = 0;
    // the items' nodes by where each starts (slide-dl.ts: one contiguous run per item)
    const itemAt = new Map(Object.entries(dl.items).filter(([, it]) => it.at[1] > it.at[0]).map(([id, it]) => [it.at[0], { id, it }]));
    const flush = () => { if (run.length) { const pre = `f${nf++}-`; layers.push({ key: "f" + contentKey(run) + pre + mode, table: null, box: null, nodes: run, svg: markup(run, pre, false) }); } run = []; };
    for (let j = 0; j < dl.nodes.length; j++) {
      const n = dl.nodes[j], g = dl.nodes[j + 1];
      if (n.t === "hit" && n.kind === "f" && n.id === "tw" && g?.t === "group" && g.transform) {
        flush();
        const i = drawn[k++], s = g.transform[0], pre = `t${i}-`, how = pre + mode, h = hits[i];
        let svg = h.svg.get(how);
        if (svg === undefined) h.svg.set(how, svg = markup(g.children, pre, true));
        layers.push({ key: h.id + "|" + how, table: i, box: { x: g.transform[4], y: g.transform[5], w: n.w, h: n.h, scale: s }, nodes: a.nodes ? g.children : [], svg });
        j++;
      } else if (itemAt.has(j)) {
        // a slide item: a layer of its own (a drag moves it, a click selects it)
        flush();
        const { id, it } = itemAt.get(j)!, seg = dl.nodes.slice(it.at[0], it.at[1]), pre = `i${ni++}-`;
        layers.push({ key: "i" + contentKey(seg) + pre + mode, table: null, item: id, box: { ...it.box, scale: 1 }, nodes: seg, svg: markup(seg, pre, false) });
        j = it.at[1] - 1;
      } else if (n.t === "hit" && n.kind === "f" && NOTE_HIT.test(n.id)) {
        // a text box: its bubble (if any), then its own hit and the group of its text – a layer of its own, so a
        // drag can move it
        flush();
        const seg: DisplayList = []; let box: StageLayer["box"] = null;
        for (; j < dl.nodes.length; j++) {
          const x = dl.nodes[j];
          if (seg.length && x.t === "hit" && x.kind === "f" && (x.id === "tw" || /notebub/.test(x.id))) { j--; break; }
          seg.push(x);
          if (x.t === "hit" && x.kind === "f" && x.id.startsWith("tnote ")) { box = { x: x.x, y: x.y, w: x.w, h: x.h, scale: 1 }; if (dl.nodes[j + 1]?.t === "group") seg.push(dl.nodes[++j]); break; }
        }
        const pre = `n${nn++}-`;
        layers.push({ key: "n" + contentKey(seg) + pre + mode, table: null, note: true, box, nodes: seg, svg: markup(seg, pre, false) });
      } else run.push(n);
    }
    flush();
    // layers the page shows already (the same key, the same markup): sent without their markup
    const have = new Set(a.have || []);
    for (const l of layers) if (have.has(l.key)) l.svg = [];
    const known = new Set(a.known), images: Record<string, string> = {};
    for (const [id, src] of Object.entries(dl.images)) if (!known.has(id)) images[id] = src;
    return { slide: a.slide, id: R.id, design: ctx.style.design, layers, images, items: dl.items };
  }
  private state(): DocState {
    const s = this.sync!;
    return { view: s.view, save: s.state, error: s.error, history: this.history.summary(), deck: s.health };
  }
  /** the view the page has: a snapshot whose document did not change (only the save state, the history or the
      revision number) is sent without it, so the page neither receives nor compares a copy of the document */
  private sentView: { obj: WorkbookDoc | null; json: string } = { obj: null, json: "" };
  private sendDoc(c: Change | null) {
    if (!this.sync) return;
    const { view, ...st } = this.state();
    let send: WorkbookDoc | undefined = view;
    if (view === this.sentView.obj) send = undefined;
    else { const json = viewJson(view); if (json === this.sentView.json) send = undefined; this.sentView = { obj: view, json }; }
    this.port.emit("doc", { ...st, ...(send ? { view: send } : {}), change: c, ack: this.ack });
    this.scheduleRest();
  }
  /** a second after the last change: the deck at rest for the page's pagehide, while this page is alone there */
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private restSent = false;
  private scheduleRest() {
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      const s = this.sync, r = s?.restSnapshot();
      if (s && r) { this.port.emit("rest", { key: s.key, baseGen: r.baseGen, json: JSON.stringify(r.snapshot) }); this.restSent = true; }
      else if (this.restSent) { this.port.emit("rest", null); this.restSent = false; }
    }, 1000);
  }
}
/** a document's content without the helper's bookkeeping: a save rewrites the revision, time, author, log, backup
    time and format number (store.py) – none of which the page shows – so a save alone gives the same JSON */
const viewJson = (v: WorkbookDoc) => { const { rev, updated, updatedBy, log, schema, backupAt, ...content } = v as WorkbookDoc & Record<string, unknown>; void rev; void updated; void updatedBy; void log; void schema; void backupAt; return JSON.stringify(content); };
/** the scene's tables (Liquid Glass; the consulting designs' "cards") measure their columns with the scene font (glass.ts
    glassWidth, sceneFont): its files loaded before such a slide is
    laid out, so the widths are the measured ones from the first build */
/** every weight glassPlan draws a cell with (its roles, bold, the user's bold and not-bold) */
const GLASS_WEIGHTS = [470, 500, 520, 640, 650, 680, 720, 740];
async function glassFonts(ctx: RenderCtx) {
  // any slide drawn as a scene (Liquid Glass, or a consulting slide whose tables are Cards – B29: maybe this slide only)
  const tm = platform().text; if (!tm.prepare || !(geomOf(ctx) === "scene" || ctx.slides.some(R => geomOf(slideCtx(ctx, R)) === "scene"))) return;
  const fams = [sceneFont(ctx), ...new Set(ctx.slides.flatMap(R => R.tables.flatMap(L => L.items.flatMap(it => it.userFont ? [fontStack(it.userFont)] : [])))), ...(ctx.style.text?.table?.font ? [fontStack(ctx.style.text.table.font)] : [])];
  await tm.prepare(fams.flatMap(f => GLASS_WEIGHTS.map(w => `${w} 11px ${f}`)));
}
/** a table of the flat designs: Excel / Excel Refined (excel-dl.ts) or the consulting designs (consult-dl.ts) */
const flatTableDL = (L: RuntimeSlide["tables"][number], ctx: RenderCtx, opts: { noText?: boolean } = {}) =>
  isConsult(ctx.style.design) ? consultTableDL(L, ctx, opts) : excelTableDL(L, ctx, opts);
/** how many table display lists the stage keeps (a deck's worth of the most recently shown) */
const STAGE_CACHE = 200;
/** the hit a text box's nodes start with: its bubble's, or its own */
const NOTE_HIT = /^tnote\b|notebub/;
/** the edits of a table's own cells, as sheetKey writes a sheet's (the renderers read a cell's edit by its key) */
function ownEdits(L: RuntimeSlide["tables"][number], ctx: RenderCtx): string {
  const all = (ctx.edits[L.sheet.name] || {}) as Record<string, unknown>, cache = (L._cache || (L._cache = {})) as Record<string, unknown>;
  const keys = (cache.ownKeys || (cache.ownKeys = new Set(L.items.map(keyOf)))) as Set<string>, out: Record<string, unknown> = {};
  for (const k of Object.keys(all)) if (keys.has(k)) out[k] = all[k];
  return JSON.stringify(out);
}
/** the changes with the input cell's own value: a slide that shows the input cell shows the scenario's value too */
function withInput(changes: Map<string, Map<string, import("../calc/engine").CellValue>>, sheet: string, r: number, c: number, value: number | string | boolean) {
  let m = changes.get(sheet); if (!m) changes.set(sheet, m = new Map());
  m.set(r + "," + c, value);
  return changes;
}
/** the engine's content of the input cell ("'Bank A", "12", "TRUE", "=…") is the value set: nothing could move */
function sameInput(was: string | null, value: number | string | boolean): boolean {
  if (was === null) return false;
  const w = was.replace(/^'/, "");
  return typeof value === "boolean" ? w.toUpperCase() === (value ? "TRUE" : "FALSE") : typeof value === "number" ? w !== "" && +w === value : w === value;
}
/** a run for each value (S8.3) */
interface Run { id: string; /** the workbook it runs on (another one opened: the run ends) */ wb: Workbook; cancel: boolean;
  /** rejects on cancel (a file that does not come cannot hold the run) */ stop: Promise<never>; abort: (e: Error) => void;
  view: Workbook | null; hash: string; slides: Map<string, RuntimeSlide[]>; marked: Set<string>; /** files saved, upper-cased */ taken: Set<string> }
/** whose values a slide is drawn from: the stage's, the workbook's own, a run's */
type Source = "stage" | "own" | Run;
/** the host behind a port (one per worker) */
/** what a host can do beyond the core's pure code (the worker passes these; the page's in-thread fallback does not,
    so the page does not carry them) */
export interface HostOptions {
  /** a static face of a variable font (text/static.ts: hb-subset) */
  staticFace?: (file: Uint8Array, weight: number) => Promise<{ data: Uint8Array; variable: boolean }>;
  /** false: the deck's journals are read only when the page asks ("poll"; tests) – else every 1.5 s */
  autoTail?: boolean;
  /** how long a cancelled run waits for the files of the value being made (ms; 30 s) */
  cancelGraceMs?: number;
}
export const serve = (port: HostPort, opts: HostOptions = {}) => new CoreHost(port, opts);
