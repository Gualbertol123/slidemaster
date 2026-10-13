/* The core worker's state and its answers to the page (PLAN S2.4, Part B §2): the ONE owner of the open
   workbook, its shared document (DocSync) and the undo/redo history. The page sends operations; after every
   change the host recomputes the slides, draws the tables of the current design and version, and sends the
   page the new sheet slices (when they change), the table HTML (new keys only) and the document snapshot – in
   that order, so the page can redraw from what it received. Transport-free: core.worker.ts connects it to
   postMessage; tests (and a page without workers) connect it in the same thread. */
import { indexWorkbook } from "../xlsx/workbook";
import { setPictureConverter } from "../xlsx/drawing";
import { sliceBoxes, sliceShared, sliceSheet, sliceTransfer, type SharedSlice, type SheetSlice } from "../xlsx/slice";
import { cellInfo, sheetInfo, sheetWindow, tableSize } from "../xlsx/sheetview";
import { detectTables } from "../xlsx/detect";
import { defaultPreset, LCACHE, presetSheets, runtimeSlides } from "../model/preset";
import { resolveStyle } from "../model/style";
import { tableHtml, tableHtmlKey } from "../render/slide";
import { computeLayout } from "../render/layout";
import { excelTableDL, forgetMeasurements, measuredBuild, type TableDL } from "../render/excel-dl";
import { glassTableDL } from "../render/glass-dl";
import { slideToDisplayList, type SlideImages } from "../render/slide-dl";
import { keyOf } from "../render/edits";
import { analyzeImages, IMGMETA } from "../xlsx/drawing";
import { sha1 } from "../text/sha1";
import { wallpaperIds } from "../render/wallpaper";
import { DocSync, type Change, type DocApi } from "../sync/docsync";
import { History } from "../sync/history";
import type { RenderCtx } from "../render/context";
import type { Design, Preset, RuntimeSlide, Style, WorkbookDoc } from "../model/types";
import type { Workbook } from "../xlsx/types";
import { Port, transfer, type Wire } from "../rpc/port";
import type { CoreEvents, CoreMethods, DocState, ExportCoreMethods, HtmlReq, PageEvents, PageMethods, SlideListsReq, StageLayer, StageReq, StageSlide, ViewInputs, WorkbookInfo } from "../rpc/messages";
import type { DisplayList } from "../dl/types";
import { stageHits, svgChunks } from "../dl/svg";
import { contentKey } from "../dl/key";

type HostPort = Port<CoreMethods, PageMethods, PageEvents, CoreEvents>;
type Html = [string, string, string, string];

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
  /** the last HTML key sent per table and kind (the page keeps only that one) */
  private sentHtml = new Map<string, string>();
  private ack = 0;
  /** changes are processed one after the other (reading sheets is asynchronous) */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly port: HostPort, private readonly opts: HostOptions = {}) {
    const h: HostPort["handle"] = (m, fn) => port.handle(m, fn);
    h("init", a => { this.served = a.served; this.client = a.client; this.me = a.me; setPictureConverter(a.served ? (bytes, ext) => this.port.call("convertPicture", { bytes, ext }) : null); });
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
    h("start", a => { if (a.stage) this.stageReq = { ...a.stage, fresh: false }; return this.start(a.book, a.name, a.doc, a.preset, a.inputs); });
    // the page waits for the redraw (the HTML of the new version or default style arrives before the answer)
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
    h("html", a => this.htmlFor(a));
    h("slideLists", a => this.lists(a));
    h("stage", a => { if (!a.nodes) this.stageReq = { ...a, fresh: false, have: undefined }; return this.queueStage(a); });
    // an export worker's own channel (S3.7): display lists go to it directly, never through the page's main thread
    h("linkExport", a => {
      const p = new Port<ExportCoreMethods, Record<string, never>, Record<string, never>, Record<string, never>>(a.port as unknown as Wire);
      p.handle("slideLists", x => this.lists(x));
      this.exportLinks.set(a.id, a.port);
    });
    h("unlinkExport", a => { const mp = this.exportLinks.get(a.id); this.exportLinks.delete(a.id); if (mp) { mp.onmessage = null; mp.close(); } });
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
    return { meta: wb.meta, skipped: wb.skipped, hiddenSheets: wb.hiddenSheets, extLinks: wb.extLinks, total: wb.total, ssSize: wb.ssSize, big: wb.big, book };
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
      sent.set(name, k); sheets.push(sliceSheet(wb.sheets.find(s => s.name === name)!, box));
    }
    // the shared parts (styles, strings – large for a big workbook) travel once, with the first sheet that needs them:
    // the mirror needs them only to read sheets, and sending them alone would copy them onto the page for nothing
    if (!sheets.length) return;
    const shared: SharedSlice | null = wb.shared && !this.sentSharedFor.has(this.candidateBook) ? sliceShared(wb.shared) : null;
    if (shared) this.sentSharedFor.add(this.candidateBook);
    this.port.emit("slices", transfer({ book: this.candidateBook, shared, sheets }, sheets.flatMap(sliceTransfer)));
  }
  private async start(book: number | undefined, name: string, doc: WorkbookDoc, preset: Preset | null, inputs: ViewInputs): Promise<DocState> {
    const cand = this.candidate, gone = () => !cand || cand !== this.candidate || (book !== undefined && book !== this.candidateBook);
    // failures before the switch carry NOT_STARTED: the open document stays open here and on the page
    const notStarted = (e: unknown) => Object.assign(e instanceof Error ? e : new Error(String(e)), { code: "NOT_STARTED" });
    if (gone()) throw notStarted(new Error(cand ? "this workbook is no longer being opened" : "no workbook"));
    // the slides' sheets are read before the document changes owner: a sheet that fails leaves the open one as it was
    try { await cand!.ensure(presetSheets(preset || doc.preset), this.progress); }
    catch (e) { throw notStarted(e); }
    finally { this.port.emit("progress", null); }
    if (gone()) throw notStarted(new Error("this workbook is no longer being opened"));
    // the previous document stops showing, but what it has not saved yet is still saved (and retried)
    const left = this.name;
    this.sync?.retire(() => this.port.emit("retiredSaved", { name: left }));
    if (this.wbBook && this.wbBook !== this.candidateBook) { this.sentBoxes.delete(this.wbBook); this.sentSharedFor.delete(this.wbBook); }
    this.wb = this.candidate; this.wbBook = this.candidateBook; this.candidate = null; this.name = name; this.inputs = inputs;
    this.stageCache.clear();                                    // another workbook (or the same file read again): its own tables
    LCACHE.clear(); this.sentHtml.clear(); this.slidesDesign = null; this.presetSig = ""; this.boxSig = "";
    this.history.undo = []; this.history.redo = [];         // a newly opened workbook starts without history (as v3)
    this.sentView = { obj: null, json: "" };
    const sync = this.sync = new DocSync(this.api, name, doc, this.client, this.me);
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
  /** the helper's API, through the page */
  private readonly api: DocApi = (() => {
    const self = this;
    return {
      get served() { return self.served; },
      getDoc: (name: string, since?: number) => self.port.call("getDoc", since === undefined ? { name } : { name, since }),
      postOps: (name: string, ops: Parameters<DocApi["postOps"]>[1], client: string) => self.port.call("postOps", { name, ops, client }),
    };
  })();

  /* ---------------------------------------------------------------- changes */
  private later(fn: () => Promise<void> | void): Promise<void> { return this.queue = this.queue.then(fn).catch(e => this.port.emit("error", { message: String((e as Error)?.message || e), stack: (e as Error)?.stack })); }
  private async onChange(sync: DocSync, c: Change) {
    if (sync !== this.sync) return;
    if (c.presetChanged) { try { await this.wb!.ensure(presetSheets(sync.view.preset), this.progress); } finally { this.port.emit("progress", null); } }
    await this.refresh(c);
  }
  private style(): Style { return resolveStyle(this.inputs.defaults as never, this.sync?.view.style) as Style; }
  private ctx(design?: Design, version?: string, forExport = false): RenderCtx {
    // another design: resolved as the page does (that design's own looks apply)
    const v = this.sync!.view, st = this.style(), s = design && design !== st.design ? resolveStyle(this.inputs.defaults as never, { ...(v.style || {}), design }) as Style : st;
    const vid = version ?? this.inputs.version;
    return { style: s, edits: v.edits || {}, slides: this.slidesFor(s.design), preset: v.preset || null, workbook: this.inputs.workbook || this.name,
      logoSrc: this.inputs.logoSrc, sheet: n => this.wb?.sheets.find(x => x.name === n) || null,
      version: (v.preset?.versions || []).find(x => x.id === vid) || null, ...(forExport ? { forExport: true } : {}) };
  }
  private slidesFor(design: Design): RuntimeSlide[] {
    if (!this.wb || !this.sync) return [];
    if (design === this.slidesDesign) return this.slides;
    return runtimeSlides(this.wb, this.sync.view.preset, this.name, design);
  }
  /** the slides of the current design (re-resolved when the preset or the design changed), then send */
  private async refresh(c: Change | null, force = false) {
    if (!this.wb || !this.sync) return;
    const design = this.style().design, sig = JSON.stringify(this.sync.view.preset);
    if (force || sig !== this.presetSig || design !== this.slidesDesign) {
      this.presetSig = sig; this.slidesDesign = design;
      this.slides = runtimeSlides(this.wb, this.sync.view.preset, this.name, design);
    } else {
      // same preset: the slide definitions (layout, titles, text boxes) live in the runtime slides
      const byId = new Map((this.sync.view.preset?.slides || []).map(s => [s.id, s]));
      for (const R of this.slides) { const cfg = byId.get(R.id); if (cfg && cfg !== R.cfg) R.cfg = cfg; }
    }
    await this.sendSlices();
    this.sendDoc(c);
    // a change (or the start): the slide on the stage drawn at once and sent unasked (keypress → pixels, S4.1) – never
    // waited for (a picture the page is slow to read must not hold the snapshot, a save, or a workbook's start); the
    // thumbnails' HTML (v3's, until S4.3) after it, at a start even when there is none (the page knows it has it all)
    const push = (c || force) && this.stageReq ? this.queueStage(this.stageReq).then(s => { if (s) this.port.emit("stage", s); }, () => undefined) : null;
    if (force) void (push ?? Promise.resolve()).then(() => setTimeout(() => this.sendHtml(true), 0));
    else if (push) void push.then(() => this.sendHtml());
    else this.sendHtml();
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
      sheets.push(sliceSheet(wb.sheets.find(s => s.name === name)!, box));
    }
    if (sheets.length) {                                         // the shared parts once, with the first sheets (as above)
      const shared: SharedSlice | null = wb.shared && !this.sentSharedFor.has(this.wbBook) ? sliceShared(wb.shared) : null;
      if (shared) this.sentSharedFor.add(this.wbBook);
      this.port.emit("slices", transfer({ book: this.wbBook, shared, sheets }, sheets.flatMap(sliceTransfer)));
    }
  }
  /** the HTML of every table of the current design and version (full, and shapes only for big tables) */
  private sendHtml(always = false) {
    if (!this.wb || !this.sync) return;
    const out = this.render(this.ctx(), this.slides, false).filter(e => { const k = e[0] + "|" + e[1]; if (this.sentHtml.get(k) === e[2]) return false; this.sentHtml.set(k, e[2]); return true; });
    if (out.length || always) this.port.emit("html", out);
  }
  private render(ctx: RenderCtx, slides: RuntimeSlide[], thumbs: boolean): Html[] {
    const out: Html[] = [], seen = new Set<string>();
    for (const R of slides) R.tables.forEach((L, i) => {
      for (const thumb of thumbs ? [false, true] : [false]) {
        const { kind, key } = tableHtmlKey(R, i, ctx, thumb), id = L.id || "", k = id + "|" + kind + "|" + key;
        if (seen.has(k)) continue; seen.add(k);
        out.push([id, kind, key, tableHtml(R, i, ctx, thumb)]);
      }
    });
    return out;
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
    const ctx = this.ctx(a.design, a.version, a.forExport), glass = ctx.style.design === "glass", out: { slide: number; dl: TableDL }[] = [];
    const { wall, logo } = await this.slideImages(ctx);
    for (const [s, R] of ctx.slides.entries()) {
      if (a.slides && !a.slides.includes(s)) continue;
      const boxes = computeLayout(R, ctx).boxes, tables: TableDL[] = [];
      for (const [i, L] of R.tables.entries()) {
        const b = boxes[i], noText = a.thumb && L.items.length > 1200;
        tables.push(glass ? await glassTableDL(L, ctx, { x: b?.x ?? 0, y: b?.y ?? 0, scale: b?.scale ?? 1 }, wall?.blur ?? null, { noText }) : await excelTableDL(L, ctx, { noText }));
      }
      out.push({ slide: s, dl: await measuredBuild(m => slideToDisplayList(R, s, ctx, tables, boxes, { wall, logo }, m, a.today)) });
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
    if (a.fresh) { this.stageCache.clear(); forgetMeasurements(); }
    const ctx = this.ctx(), R = ctx.slides[a.slide]; if (!R) return null;
    const glass = ctx.style.design === "glass", img = await this.slideImages(ctx, true), soft = !!a.soft;
    const boxes = computeLayout(R, ctx).boxes, tables: TableDL[] = [], hits: { id: string; dl: TableDL; svg: Map<string, string[]> }[] = [], styleSig = JSON.stringify(ctx.style);
    for (const [i, L] of R.tables.entries()) {
      const b = boxes[i], place = { x: b?.x ?? 0, y: b?.y ?? 0, scale: b?.scale ?? 1 };
      // which table (tableHtmlKey was made for a cache on the layout itself: it does not name the table), then what it is
      // drawn from – with the edits of its own cells only (tableKey has the whole sheet's: an edit in one table must not
      // draw the others of its sheet again)
      const who = L.sheet.name + "|" + (L.id || "") + "|" + ctx.style.design + "|" + soft;
      const own = { ...ctx, _keys: new Map([[L.sheet.name, ownEdits(L, ctx)]]) };
      const key = who + "|" + tableHtmlKey(R, i, own).key + "|" + styleSig + (glass ? "|" + place.x + "," + place.y + "," + place.scale : "");
      let hit = this.stageCache.get(key);
      if (hit) this.stageCache.delete(key);
      else {
        hit = { id: "t" + (++this.stageSeq), dl: glass ? await glassTableDL(L, ctx, place, img.wall?.blur ?? null) : await excelTableDL(L, ctx), svg: new Map() };
        // a table keeps its last few drawings (undo, redo); older ones of the same table go
        const mine = [...this.stageCache.keys()].filter(k => k.startsWith(who + "|"));
        for (const k of mine.slice(0, Math.max(0, mine.length - 2))) this.stageCache.delete(k);
      }
      this.stageCache.set(key, hit);
      tables.push(hit.dl); hits.push(hit);
    }
    while (this.stageCache.size > STAGE_CACHE) this.stageCache.delete(this.stageCache.keys().next().value!);
    const dl = await measuredBuild(m => slideToDisplayList(R, a.slide, ctx, tables, boxes, img, m, a.today));
    // pictures by placeholder (the page puts its own URL for each: stage/data.ts); ids of gradients and clips per layer
    const markup = (nodes: DisplayList, prefix: string, table: boolean) => svgChunks(nodes, { imageHref: id => "sbimg:" + id, idPrefix: prefix, softShadows: soft, ...(table ? { hits: stageHits } : {}) });
    // the layers: a "tw" hit followed by its group is a table (in the order of the tables that have a box); the
    // nodes between tables are furniture layers, named by their content
    const drawn = R.tables.flatMap((_, i) => boxes[i] && tables[i] ? [i] : []), layers: StageLayer[] = [];
    let run: DisplayList = [], k = 0, nf = 0, nn = 0;
    const flush = () => { if (run.length) { const pre = `f${nf++}-`; layers.push({ key: "f" + contentKey(run) + pre + soft, table: null, box: null, nodes: run, svg: markup(run, pre, false) }); } run = []; };
    for (let j = 0; j < dl.nodes.length; j++) {
      const n = dl.nodes[j], g = dl.nodes[j + 1];
      if (n.t === "hit" && n.kind === "f" && n.id === "tw" && g?.t === "group" && g.transform) {
        flush();
        const i = drawn[k++], s = g.transform[0], pre = `t${i}-`, how = pre + soft, h = hits[i];
        let svg = h.svg.get(how);
        if (svg === undefined) h.svg.set(how, svg = markup(g.children, pre, true));
        layers.push({ key: h.id + "|" + how, table: i, box: { x: g.transform[4], y: g.transform[5], w: n.w, h: n.h, scale: s }, nodes: a.nodes ? g.children : [], svg });
        j++;
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
        layers.push({ key: "n" + contentKey(seg) + pre + soft, table: null, note: true, box, nodes: seg, svg: markup(seg, pre, false) });
      } else run.push(n);
    }
    flush();
    // layers the page shows already (the same key, the same markup): sent without their markup
    const have = new Set(a.have || []);
    for (const l of layers) if (have.has(l.key)) l.svg = [];
    const known = new Set(a.known), images: Record<string, string> = {};
    for (const [id, src] of Object.entries(dl.images)) if (!known.has(id)) images[id] = src;
    return { slide: a.slide, id: R.id, design: ctx.style.design, layers, images };
  }
  private htmlFor(a: HtmlReq): Html[] {
    if (!this.wb || !this.sync) return [];
    const ctx = this.ctx(a.design, a.version, a.forExport);
    return this.render(ctx, ctx.slides, a.thumb);
  }
  private state(): DocState {
    const s = this.sync!;
    return { view: s.view, save: s.state, error: s.error, history: this.history.summary() };
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
  }
}
/** a document's content without the helper's bookkeeping: a save rewrites the revision, time, author, log, backup
    time and format number (store.py) – none of which the page shows – so a save alone gives the same JSON */
const viewJson = (v: WorkbookDoc) => { const { rev, updated, updatedBy, log, schema, backupAt, ...content } = v as WorkbookDoc & Record<string, unknown>; void rev; void updated; void updatedBy; void log; void schema; void backupAt; return JSON.stringify(content); };
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
/** the host behind a port (one per worker) */
/** what a host can do beyond the core's pure code (the worker passes these; the page's in-thread fallback does not,
    so the page does not carry them) */
export interface HostOptions {
  /** a static face of a variable font (text/static.ts: hb-subset) */
  staticFace?: (file: Uint8Array, weight: number) => Promise<{ data: Uint8Array; variable: boolean }>;
}
export const serve = (port: HostPort, opts: HostOptions = {}) => new CoreHost(port, opts);
