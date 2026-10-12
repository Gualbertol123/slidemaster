/* Application actions: start-up, opening workbooks, editing through operations, undo/redo,
   polling for other people's changes, presence.
   The core worker (PLAN S2.4, app/src/rpc/client.ts) OWNS the open workbook, its shared document and undo/redo.
   The page keeps read-only mirrors: the workbook's sheets as slices (deck.wb), the document's view (doc.view) and
   what undo/redo would do (deck.history). A change is sent to the worker as operations; so that code reading the
   document right after a change sees it, the view mirror shows the operations at once (predicted with the core's
   ops) until the worker's snapshot that includes them arrives. */
import { get, patch, patchAll, same, STAGE, THUMBS, toast, showBusy, hideBusy } from "./store";
import { ask, runWizard } from "./dialogs";
import { backend } from "../sync/api";
import { connectCore, type CorePort } from "../rpc/client";
import { browserText } from "../platform";
import { analyzeImages, IMGMETA, type ImgMeta } from "@slide-builder/core/xlsx/drawing";
import { esc, fmtMB, nextFrame } from "@slide-builder/core/xlsx/util";
import { MirrorWorkbook } from "@slide-builder/core/xlsx/mirror";
import type { SharedSlice, SheetSlice } from "@slide-builder/core/xlsx/slice";
import { transfer } from "@slide-builder/core/rpc/port";
import type { DocEvent, ViewInputs } from "@slide-builder/core/rpc/messages";
import type { Change } from "@slide-builder/core/sync/docsync";
import { applyOps } from "@slide-builder/core/model/ops";
import { defaultPreset, LCACHE, presetSheets, runtimeSlides } from "@slide-builder/core/model/preset";
import { resolveStyle } from "@slide-builder/core/model/style";
import type { Design, Op, Preset, Prefs, RuntimeSlide, StylePatch } from "@slide-builder/core/model/types";
import type { AppState } from "./store";
import { initialState } from "./store";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { applyWall } from "../render/wall";
import { loadFonts, watchFontLoads } from "./fonts";

/* ---------------------------------------------------------------- the core worker */
let port: CorePort | null = null;
/** the latest table HTML the worker drew, by table id and kind ("html" | "thtml") */
const tableHtmls = new Map<string, { key: string; html: string }>();
/** tables the page drew itself (no HTML from the worker for that key yet), for tests */
export const coreStats = { localHtml: 0, worker: false };
/** the workbook being opened (its slices can arrive before its index; they wait) and the open one */
let openingWb: MirrorWorkbook | null = null, earlySlices: { book: number; shared: SharedSlice | null; sheets: SheetSlice[] }[] = [];
export function core(): CorePort {
  if (port) return port;
  const c = connectCore(); port = c.port; coreStats.worker = !!c.worker;
  port.handle("getDoc", a => backend.getDoc(a.name, a.since));
  port.handle("postOps", a => backend.postOps(a.name, a.ops, a.client));
  port.handle("digitWidth", a => browserText.maxDigitWidth(a.font));
  port.handle("convertPicture", a => backend.convertPicture(a.bytes, a.ext));
  port.handle("analyzeImages", async a => { await analyzeImages(a.srcs); return a.srcs.flatMap(s => IMGMETA.has(s) ? [[s, IMGMETA.get(s)!] as [string, ImgMeta]] : []); });
  port.on("slices", e => {
    const wb = [openingWb, get().deck.wb as MirrorWorkbook | null].find(w => w && w.book === e.book);
    if (wb) receiveSlices(wb, e); else if (!openingWb) earlySlices.push(e);        // the index of that workbook is on its way
  });
  port.on("html", list => { for (const [id, kind, key, h] of list) tableHtmls.set(id + "|" + kind, { key, html: h }); });
  port.on("doc", ev => onWorkerDoc(ev));
  port.on("progress", p => { if (p) showBusy(p.text, p.frac); else hideBusy(); });
  port.on("retiredSaved", () => { unsavedElsewhere = false; });
  // an error in the worker's own work (e.g. a sheet read after a colleague's change): shown, never a busy screen left up
  port.on("error", e => { console.error("core worker: " + e.message + (e.stack ? "\n" + e.stack : "")); hideBusy(); toast("⚠ " + esc(e.message), [], true); });
  // the worker stopped: nothing can be read or saved any more – say so, and stop taking edits
  port.onClose(e => {
    hideBusy(); patch("deck", { opening: "" });
    if (get().doc.open) patch("doc", { save: "error", error: e.message });
    toast("⚠ " + esc(e.message) + " <b>Reload the page (F5).</b>", [], true);
  });
  return port;
}
function receiveSlices(wb: MirrorWorkbook, e: { shared: SharedSlice | null; sheets: SheetSlice[] }) {
  wb.receive(e.shared, e.sheets);
  LCACHE.clear();                                            // layouts of the replaced sheets
}
const htmlOf = (id: string, kind: "html" | "thtml", key: string) => {
  const h = tableHtmls.get(id + "|" + kind);
  if (h && h.key === key) return h.html;
  coreStats.localHtml++; return undefined;
};
/** the worker's table HTML for another design, version or an export (one request per design and version until
    the document changes: an export asks for every slide) */
const htmlForCache = new Map<string, { view: unknown; of: Promise<RenderCtx["htmlOf"]> }>();
export function htmlFor(design: Design, version: string, forExport: boolean): Promise<RenderCtx["htmlOf"]> {
  const k = design + "|" + version + "|" + forExport, view = get().doc.view, hit = htmlForCache.get(k);
  if (hit && hit.view === view) return hit.of;
  const of = core().call("html", { design, version, forExport, thumb: false }).then(list => {
    const m = new Map(list.map(([id, kind, key, h]) => [id + "|" + kind + "|" + key, h]));
    return (id: string, kind: "html" | "thtml", key: string) => m.get(id + "|" + kind + "|" + key);
  });
  htmlForCache.clear(); htmlForCache.set(k, { view, of });
  return of;
}
/** what the worker's renderers need from the page */
function viewInputs(name = get().deck.file?.name || ""): ViewInputs {
  const st = style();
  return { defaults: get().doc.config.defaults.style || {}, logoSrc: st.logo.trim() ? backend.assetUrl(st.logo.trim()) : "", version: get().deck.version, workbook: name };
}
export async function flushDoc() { if (get().doc.open) await core().call("flush", {}); }

/* ---------------------------------------------------------------- render context */
let ctxCache: { key: unknown[]; ctx: RenderCtx } | null = null;
export function style() { const { doc } = get(); return resolveStyle(doc.config.defaults.style, doc.view?.style); }
/** what ctx() and style() are computed from: components select these to re-render when they change (ui/hooks.ts) */
export const ctxInputs = (s: AppState) => [s.doc.view, s.deck.slides, s.doc.config, s.deck.file?.name, s.deck.wb, s.deck.version] as const;
export function ctx(): RenderCtx {
  const st0 = get(), { view: v } = st0.doc, { slides, file, wb, version } = st0.deck;
  const key: unknown[] = [...ctxInputs(st0)];
  if (ctxCache && ctxCache.key.every((k, i) => k === key[i])) return ctxCache.ctx;
  const st = style();
  const c: RenderCtx = { style: st, edits: v?.edits || {}, slides, preset: v?.preset || null, workbook: file?.name || "",
    logoSrc: st.logo.trim() ? backend.assetUrl(st.logo.trim()) : "", sheet: n => wb?.sheets.find(x => x.name === n) || null,
    version: (v?.preset?.versions || []).find(x => x.id === version) || null, htmlOf };
  ctxCache = { key, ctx: c };
  return c;
}

/* ---------------------------------------------------------------- start-up */
export async function boot() {
  patch("ui", { health: await backend.health() });
  try { const me = await backend.me(); patch("prefs", { user: me.user, host: me.host, prefs: me.prefs || {} }); } catch { /* keep defaults */ }
  try { patch("doc", { config: await backend.config() }); } catch { /* defaults */ }
  await core().call("init", { served: backend.served, client: get().prefs.client, me: get().prefs.user });
  watchFontLoads(); await loadFonts();
  const zoom = get().prefs.prefs.zoom; if (zoom != null) patch("ui", { zoom });
  applyWall(style());
  if (backend.served) {
    const files = await backend.files().catch(() => []);
    const last = get().prefs.prefs.lastFile;
    if (last && files.some(f => f.name === last)) await guard(() => openFromFolder(last, false));
    setInterval(() => { void tick(); }, 3000);
    setInterval(() => { void heartbeat(); }, 10000);
    void heartbeat();
    addEventListener("pagehide", () => backend.leave(get().prefs.client));
  }
  // closing the window while changes are not on the share (or in this browser's storage) yet: the browser asks first
  addEventListener("beforeunload", e => {
    const s = get().doc.save;
    if (unsavedElsewhere || (get().doc.open && (pending.length || s === "pending" || s === "saving" || s === "error"))) { e.preventDefault(); e.returnValue = ""; }
  });
}
let tickN = 0;
/** one poll: other people's changes, helper health, the file on disk, fonts, shared config (every 3 s) */
export async function tick() {
  tickN++;
  if (get().doc.open) await core().call("poll", {}).catch(() => { /* next tick */ });
  if (tickN % 2 === 0) {
    setHealth(await backend.health());
    const { file } = get().deck;
    if (file && file.src === "folder" && !get().ui.changedOnDisk) {      // one stat; the list is read when the Open menu opens (B13)
      const f = await backend.fileStat(file.name).catch(() => null);
      if (f && get().deck.file === file && file.mtime && f.mtime > file.mtime + 0.5) patch("ui", { changedOnDisk: true });
    }
  }
  if (tickN % 10 === 0) void loadFonts();               // fonts colleagues added
  if (tickN % 10 === 0) { try { const c = await backend.config(); if (c.rev !== get().doc.config.rev) { patch("doc", { config: c }); onStyleChanged(true); } } catch { /* later */ } }
}
/** the helper's health; an answer equal to the last one changes nothing (nothing re-renders) */
export function setHealth(h: AppState["ui"]["health"]) { if (!same(h, get().ui.health)) patch("ui", { health: h }); }
/** presence: who else has this workbook open (every 10 s) */
export async function heartbeat() {
  try {
    const others = await backend.presence(get().prefs.client, get().deck.file?.name || null);
    // who is here: the seen-at times change every time, the list shown only when somebody comes or goes
    const who = (l: typeof others) => l.map(o => [o.user, o.host, o.client, o.workbook]);
    if (!same(who(others), who(get().ui.others))) patch("ui", { others });
  } catch { /* helper busy */ }
}

/* ---------------------------------------------------------------- prefs */
let prefsTimer: ReturnType<typeof setTimeout> | null = null;
export function setPrefs(p: Partial<Prefs>) {
  patch("prefs", { prefs: { ...get().prefs.prefs, ...p } });
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => { void backend.savePrefs(get().prefs.prefs).catch(() => { /* personal, retried next change */ }); }, 400);
}

/* ---------------------------------------------------------------- errors */
export async function guard(fn: () => Promise<unknown> | unknown) {
  try { await fn(); }
  catch (e) {
    if ((e as { code?: string }).code === "SUPERSEDED") return;     // a newer open took over: it shows its own progress
    console.error(e); hideBusy(); patch("deck", { opening: "" }); toast("⚠ " + esc((e as Error).message || e), [], true);
  }
}

/* ---------------------------------------------------------------- opening workbooks */
export async function openFromFolder(name: string, ask = true) {
  patch("deck", { opening: name });
  const gen = ++openGen;
  showBusy(`Opening “${name}”…`, null);
  let file;
  try { file = await backend.readFile(name); } finally { hideBusy(); }
  if (gen !== openGen) return;
  await openBuffer(file.buf, name, "folder", "", file.mtime, file.size, ask, async () => (await backend.readFile(name)).buf, gen);
}
/** opens are numbered: a newer open (a second drop, Browse… during an upload) makes an older one give up quietly */
let openGen = 0;
/** a workbook left while its changes were failing to save (the worker keeps retrying them): closing the window asks */
let unsavedElsewhere = false;
const superseded = () => Object.assign(new Error("superseded"), { code: "SUPERSEDED" });
export async function openLocalFile(f: File) {
  patch("deck", { opening: f.name });                       // from the start: the drop guard and Open… see it at once
  const gen = ++openGen;
  const buf = await f.arrayBuffer();
  const inFolder = (await backend.files().catch(() => [])).find(x => x.name === f.name && x.size === f.size);
  if (gen !== openGen) return;
  if (inFolder) return openBuffer(buf, f.name, "folder", "", inFolder.mtime, inFolder.size, true, () => f.arrayBuffer(), gen);
  let id = "";
  if (backend.served) { try { id = await backend.upload(f.name, buf); } catch { /* preview only */ } }
  if (gen !== openGen) return;
  await openBuffer(buf, f.name, id ? "upload" : "local", id, 0, f.size, true, () => f.arrayBuffer(), gen);
}
export async function reloadWorkbook() { const { file } = get().deck; if (file && file.src === "folder") await openFromFolder(file.name, false); }

/** the worker reads the workbook (the bytes move to it: no copy on this thread); the page gets its mirror */
async function indexInWorker(buf: ArrayBuffer): Promise<MirrorWorkbook> {
  openingWb = null; earlySlices = [];
  const info = await core().call("index", transfer({ buf }, [buf]));
  const wb = openingWb = new MirrorWorkbook(info, async (book, names) => { await core().call("ensure", { book, names }); });
  for (const e of earlySlices) if (e.book === wb.book) receiveSlices(wb, e);
  earlySlices = [];
  return wb;
}
/** `again`: the file's bytes once more (the first ones moved to the worker), for Excel's conversion */
async function loadWorkbook(buf: ArrayBuffer, name: string, again: () => Promise<ArrayBuffer>): Promise<MirrorWorkbook> {
  let wb: MirrorWorkbook;
  showBusy(`Opening “${name}” (${fmtMB(buf.byteLength)})…`, null); await nextFrame();
  try { wb = await indexInWorker(buf); }                     // small workbooks are read completely (the wizard can then show
  catch (e) {                                                // titles and table suggestions for every sheet); large ones sheet by sheet
    const code = (e as { code?: string }).code;
    if (code === "ENCRYPTED") throw new Error(`“${name}” is protected (password or sensitivity label with encryption). Remove the protection or save an unprotected .xlsx copy.`);
    if (code !== "XLSB" && code !== "CFB") throw e;
    const what = code === "XLSB" ? "an Excel Binary Workbook (.xlsb)" : "an old .xls workbook or a protected file";
    if (!backend.served) throw new Error(`“${name}” is ${what}. Start the app with Start Slide Builder.bat so Excel can convert it, or save it in Excel as .xlsx.`);
    showBusy(`Converting “${name}” with Excel…`, null);
    let out: ArrayBuffer;
    try { out = await backend.convertWorkbook(name, await again()); }
    catch (e2) { throw new Error(`“${name}” is ${what} and Excel could not convert it: ${(e2 as Error).message}. Save it in Excel as .xlsx (File › Save As › Excel Workbook) and open that copy.`); }
    try { wb = await indexInWorker(out); toast(`“${esc(name)}” was converted by Excel for reading – the original file is unchanged.`); }
    catch (e3) {
      if ((e3 as { code?: string }).code === "SUPERSEDED") throw e3;    // another open came meanwhile (openBuffer decides)
      throw new Error((e3 as { code?: string }).code === "CFB" ? `“${name}” is protected (password or sensitivity label with encryption). Remove the protection or save an unprotected .xlsx copy.` : (e3 as Error).message);
    }
  }
  return wb;
}

async function presetBox(name: string, p: Preset): Promise<"continue" | "wizard" | null> {
  const content = p.slides.filter(s => (s.type || "content") === "content").length;
  const extras = [p.slides.some(s => s.type === "cover") ? "cover" : "", p.slides.some(s => s.type === "index") ? "index" : ""].filter(Boolean);
  const r = await ask("Saved preset found", `${content} content slide${content === 1 ? "" : "s"}${extras.length ? " + " + extras.join(" and ") + " slide" : ""} · ${p.tables.length} table${p.tables.length === 1 ? "" : "s"} from ${new Set(p.tables.map(t => t.sheet)).size} sheet(s).`,
    [{ id: "cancel", label: "Cancel" }, { id: "wizard", label: "Open editing wizard" }, { id: "continue", label: "Continue with preset", primary: true }], { sub: name, width: 520 });
  return r === "continue" || r === "wizard" ? r : null;
}

/** the mirror's marker tables are laid out on first use (core/src/xlsx/slice.ts): here one sheet per idle moment
    while the wizard or the preset question is open, so neither the wizard nor the first slide waits for them */
function layOutWhileIdle(wb: MirrorWorkbook) {
  const todo = wb.sheets.slice();
  const later = (f: () => void) => { if (typeof requestIdleCallback === "function") requestIdleCallback(f, { timeout: 500 }); else setTimeout(f, 0); };
  const next = () => { const S = todo.shift(); if (!S || (openingWb !== wb && get().deck.wb !== wb)) return; void S.tables; later(next); };
  later(next);
}

/** while the worker starts a document, its snapshots are for the next workbook, not the one shown */
let starting = false;
async function openBuffer(buf: ArrayBuffer, name: string, src: "folder" | "upload" | "local", id: string, mtime: number, size: number, askUser: boolean, again: () => Promise<ArrayBuffer>, gen: number) {
  patch("deck", { opening: name });
  const stale = () => { if (gen !== openGen) throw superseded(); };
  let wb: MirrorWorkbook;
  try { wb = await loadWorkbook(buf, name, again); }
  catch (e) {
    // the worker refused it because another index came after it: quiet only if this page started a newer open
    if ((e as { code?: string }).code === "SUPERSEDED") { if (gen !== openGen) throw superseded(); throw new Error(`Opening “${name}” was interrupted – open it again.`); }
    throw e;
  }
  finally { hideBusy(); }
  stale();
  layOutWhileIdle(wb);
  LCACHE.clear();
  const doc = (await backend.getDoc(name))!;
  stale();
  // the open workbook has changes the helper does not have yet: switching keeps saving them (the worker retries),
  // but say so when saving is failing, so nobody closes the window thinking they are safe
  if (get().doc.open && get().doc.save === "error") unsavedElsewhere = true;
  if (get().doc.open && get().doc.save === "error") toast("⚠ The changes to “" + esc(get().deck.file?.name || "") + "” are not saved yet – they keep being retried. Keep this window open until they are saved.", [], true);
  let preset = doc.preset, newPreset: Preset | null = null;
  try {
    if (preset && askUser) {
      const choice = await presetBox(name, preset);
      if (!choice) { if (gen === openGen) patch("deck", { opening: "" }); return; }
      if (choice === "wizard") { const np = await runWizard(wb, name, preset); if (np) newPreset = np; }
    } else if (!preset) {
      const draft = await core().call("defaultPreset", { book: wb.book });  // the worker has the tables laid out (PLAN S2.6)
      if (!askUser && !wb.big && draft.slides.length) newPreset = draft;        // start-up / reload: "x" workbooks open as before
      else {
        const np = await runWizard(wb, name, draft);
        if (!np) { if (gen === openGen) patch("deck", { opening: "" }); return; }
        newPreset = np;
      }
    }
    stale();
    await core().call("ensure", { book: wb.book, names: presetSheets(newPreset || preset) });   // only the sheets the slides use
  } finally { hideBusy(); }
  stale();

  const vid = get().prefs.prefs.versions?.[name] || "";         // the version this person looked at last
  const version = ((newPreset || preset)?.versions || []).some(x => x.id === vid) ? vid : "";
  starting = true; pending.length = 0;
  let st;
  try { st = await core().call("start", { book: wb.book, name, doc, preset: newPreset, inputs: { ...viewInputs(name), version } }); }
  catch (e) {
    // refused before the switch (another open came first): the worker still has the open document, and so does the page
    if ((e as { code?: string }).code === "NOT_STARTED") { patch("deck", { opening: "" }); throw gen !== openGen ? superseded() : e; }
    // the worker no longer holds the document shown: close it here too, so no edit can reach another file's document
    if (get().doc.open) { const s0 = initialState(); patchAll({ doc: { ...s0.doc, config: get().doc.config, fonts: get().doc.fonts }, deck: s0.deck, selection: s0.selection }); STAGE.render(); THUMBS.render(); }
    else patch("deck", { opening: "" });
    throw e;
  }
  finally { starting = false; }
  base = st.view; predicted = { base, key: "" };
  openingWb = null;                                          // now the open one (deck.wb)
  // the HTML of tables this document does not have (the previous workbook's) is dropped; the new HTML came with start
  const ids = new Set((st.view.preset?.tables || []).map(t => t.id));
  for (const k of [...tableHtmls.keys()]) if (!ids.has(k.slice(0, k.lastIndexOf("|")))) tableHtmls.delete(k);
  const design = resolveStyle(get().doc.config.defaults.style, st.view.style).design;
  const slides = runtimeSlides(wb, st.view.preset, name, design); slidesDesign = design;
  presetSig = JSON.stringify(st.view.preset);
  if (src === "folder") setPrefs({ lastFile: name });
  patchAll({
    doc: { open: true, view: st.view, save: st.save, error: st.error },
    deck: { wb, file: { name, src, id, mtime, size }, history: st.history, slides, cur: Math.min(get().deck.cur, Math.max(0, slides.length - 1)),
      version, opening: "", remote: null },
    selection: { sel: null },
    ui: { logoMissing: false, changedOnDisk: false },
  });
  applyWall(style());
  STAGE.render(); THUMBS.render();
  void heartbeat();
}

/* ---------------------------------------------------------------- document changes (mine and others') */
let presetSig = "";
/** my apply/undo calls the worker has not confirmed yet (their ops are shown on the mirror meanwhile) */
let seq = 0;
const pending: { seq: number; ops: Op[]; undo?: boolean }[] = [];
/** the worker's last document (snapshots whose document did not change do not carry it), and what the mirror's
    prediction was computed from (that document and my unconfirmed calls) */
let base: AppState["doc"]["view"] = null, predicted: { base: AppState["doc"]["view"]; key: string } = { base: null, key: "" };
/** a snapshot from the worker: the document mirror, the save state, the history; then redraw what changed */
function onWorkerDoc(ev: DocEvent) {
  if (starting || !get().doc.open) return;
  while (pending.length && pending[0].seq <= ev.ack) pending.shift();
  const d = get().doc, h = get().deck.history;
  if (ev.view) base = ev.view;
  const key = pending.map(p => p.seq).join(",");
  let view = d.view;
  if (predicted.base !== base || predicted.key !== key) {
    if (pending.length) view = applyOps(base!, pending.flatMap(p => p.ops)).doc;
    // all of mine confirmed: the worker's document – unless it equals what the mirror predicted, then the mirror's
    // object stays (nothing re-renders); compared once per confirmed change, never per snapshot
    else if (!(predicted.key && same(d.view, base))) view = base;
  }
  predicted = { base, key };
  // while calls are on their way, the snapshot does not know them yet: still "pending", not "✓ Saved"
  const save = pending.length && (ev.save === "saved" || ev.save === "local") ? unsaved() : ev.save;
  const docPatch: Partial<AppState["doc"]> = {};
  if (view !== d.view) docPatch.view = view;               // the same document: the same object (nothing re-renders)
  if (d.save !== save) docPatch.save = save;
  if (d.error !== ev.error) docPatch.error = ev.error;
  patchAll({ ...(Object.keys(docPatch).length ? { doc: docPatch } : {}), ...(same(h, ev.history) ? {} : { deck: { history: ev.history } }) });
  if (ev.change) void onDocChange(ev.change);
}
async function onDocChange(c: Change) {
  const { doc: { view }, deck: { wb, file } } = get(); if (!view || !wb || !file) return;
  // only the save state changed ("Saving…" → "✓ Saved", an error): the status bar (mirrored above), not the slides
  if (!c.local && !c.presetChanged && !c.styleChanged && !c.editsChanged) return;
  if (c.by) patch("deck", { remote: { by: c.by, at: Date.now() } });
  if (c.presetChanged) {
    const sig = JSON.stringify(view.preset);
    if (sig !== presetSig) {
      presetSig = sig;                                       // the worker read the sheets and sent their slices
      const { slides: old, cur } = get().deck, keep = old[cur]?.id;
      const slides = runtimeSlides(wb, view.preset, file.name, style().design); slidesDesign = style().design;
      const i = slides.findIndex(R => R.id === keep);
      patchAll({ deck: { slides, cur: i >= 0 ? i : Math.max(0, Math.min(cur, slides.length - 1)) }, ...(c.local ? {} : { selection: { sel: null } }) });
      STAGE.render(); THUMBS.render();
      return;
    }
  }
  // same slides: point them at the new slide objects (layout, titles, logo live there)
  const byId = new Map((view.preset?.slides || []).map(s => [s.id, s]));
  let titles = false, moved = false;
  for (const R of get().deck.slides) {
    const cfg = byId.get(R.id); if (!cfg) continue;
    if (cfg.title !== R.cfg.title || cfg.subtitle !== R.cfg.subtitle || cfg.logo !== R.cfg.logo || cfg.date !== R.cfg.date || cfg.note !== R.cfg.note) titles = true;
    if (R.cfg !== cfg) { R.cfg = cfg; moved = true; }
  }
  if (titles) { patch("deck", { slides: runtimeSlides(wb, view.preset, file.name, style().design) }); slidesDesign = style().design; }
  else if (moved) patch("deck", { slides: [...get().deck.slides] });     // the same slide objects, so the list's readers see the change
  if (c.styleChanged) return onStyleChanged();
  if (titles) { STAGE.render(); THUMBS.render(); }
  else if (c.local) { STAGE.refresh(); THUMBS.refresh(get().deck.cur); }
  else { STAGE.refresh(); THUMBS.render(); }
}
function onStyleChanged(configChanged = false) {
  // column widths and row heights are per design: another design needs its own table layouts
  const d = style().design, { wb, file, slides: old, cur } = get().deck;
  if (d !== slidesDesign && wb && file) {
    const keep = old[cur]?.id;
    const slides = runtimeSlides(wb, get().doc.view?.preset || null, file.name, d); slidesDesign = d;
    const i = slides.findIndex(R => R.id === keep);
    patchAll({ deck: { slides, ...(i >= 0 ? { cur: i } : {}) }, selection: { sel: null } });
  }
  applyWall(style());
  // a new shared default style: the worker draws with it first, then the slides are redrawn with its HTML
  if (get().doc.open && configChanged) void core().call("inputs", viewInputs()).then(() => { STAGE.render(); THUMBS.render(); });
  else { STAGE.render(); THUMBS.render(); }
}
let slidesDesign: Design | null = null;
/** the slides as `design` shows them (the current ones, or resolved again for another design – exports) */
export function slidesFor(design: Design): RuntimeSlide[] {
  const { wb, file, slides } = get().deck;
  if (design === slidesDesign || !wb || !file) return slides;
  const other = runtimeSlides(wb, get().doc.view?.preset || null, file.name, design);
  return slides.map(R => other.find(x => x.id === R.id) || R);
}
/** every edit goes through here: ops go to the worker (which applies them, saves them and keeps them undoable);
    the mirror shows them at once */
export function change(label: string, ops: Op[], coalesce?: string) {
  const { doc: { open, view }, deck: { file } } = get(); if (!open || !file || !view || starting) return;
  if (port?.closed) { toast("⚠ " + esc(port.closed.message), [], true); return; }
  const r = applyOps(view, ops);
  if (!r.applied) return;
  pending.push({ seq: ++seq, ops });
  predicted = { base, key: pending.map(p => p.seq).join(",") };
  patch("doc", { view: r.doc, save: unsaved() });             // as DocSync did: "✓ Saved" only once the helper has it
  void core().call("apply", { label, ops, coalesce }).catch(e => console.error(e));
}
/** the save state right after a change: waiting for the helper, or kept in this browser (file://) */
const unsaved = () => get().doc.save === "outdated" ? "outdated" as const : backend.served ? "pending" as const : "local" as const;
export function undo(redo = false) {
  // nothing to undo (as v3, which returned on an empty stack); not while another workbook is starting
  // an edit (or undo) the worker has not confirmed yet counts too: the history mirror comes with its snapshot
  const h = get().deck.history, canUndo = h.undo > 0 || pending.some(p => p.ops.length), canRedo = h.redo > 0 || pending.some(p => p.undo);
  if (!get().doc.open || starting || !(redo ? canRedo : canUndo)) return;
  if (port?.closed) { toast("⚠ " + esc(port.closed.message), [], true); return; }
  pending.push({ seq: ++seq, ops: [], undo: !redo });
  if (get().doc.save !== "outdated") patch("doc", { save: unsaved() });      // as DocSync did: "pending" until the helper has it
  void core().call("undo", { redo }).then(r => {
    if (r.label === null) return;
    patchAll({ selection: { sel: null } });
    toast((redo ? "Redo: " : "Undo: ") + esc(r.label));
  }).catch(e => console.error(e));
}
export const styleChange = (label: string, patch: Extract<Op, { op: "style.patch" }>["patch"], coalesce?: string) => change(label, [{ op: "style.patch", patch } as Op], coalesce);
export async function saveStyleAsDefault() {
  const st = get().doc.view?.style; if (!st) return;
  try { const r = await backend.configOps([{ op: "style.patch", patch: JSON.parse(JSON.stringify(st)) } as Op]); patch("doc", { config: r.doc }); toast("This deck's style is now the default for new decks."); }
  catch (e) { toast("⚠ " + esc((e as Error).message), [], true); }
}

/* ---------------------------------------------------------------- wizard */
export async function openWizard() {
  const { doc: { open, view }, deck: { wb, file } } = get(); if (!open || !view || !wb || !file) return;
  const startSig = JSON.stringify(view.preset), start = view.preset || defaultPreset(wb);
  const np = await runWizard(wb, file.name, JSON.parse(JSON.stringify(start)));
  if (!np) return;
  if (JSON.stringify(get().doc.view?.preset) !== startSig) {
    const remote = get().deck.remote, who = remote && remote.by ? esc(remote.by) : "Someone else";
    const r = await ask("The slides were changed meanwhile", `${who} changed this workbook's slides while the wizard was open. Saving replaces their slide and table changes with yours (cell edits are not affected).`,
      [{ id: "cancel", label: "Discard my wizard changes" }, { id: "ok", label: "Save mine anyway", danger: true }]);
    if (r !== "ok") return;
  }
  change("Wizard changes", [{ op: "preset.set", preset: np }]);   // the worker reads the sheets the new slides use
}

/* ---------------------------------------------------------------- navigation */
export function gotoSlide(i: number) {
  const { slides, cur } = get().deck;
  if (i < 0 || i >= slides.length || i === cur) return;
  patchAll({ deck: { cur: i }, selection: { sel: null } }); STAGE.render();
}
/** the stage follows ui.zoom (editor/stage.ts) */
/** the stage re-fits when the zoom changes (editor/stage.ts follows ui.zoom); "Fit" pressed again re-fits too
    (the panels above the stage may have changed its size since) */
export function setZoom(z: "fit" | number) { const unchanged = get().ui.zoom === z; patch("ui", { zoom: z }); setPrefs({ zoom: z }); if (unchanged) STAGE.fit(); }

/* ---------------------------------------------------------------- look: theme, colours, text styles
   Design… edits either the current design only ("design") or all designs ("all"). Writing for all designs
   also removes that setting from each design's own settings, so it really applies everywhere. */
type LookPart = { theme?: Record<string, unknown> | null; colors?: Record<string, unknown> | null; text?: Record<string, unknown> | null };
const mergeMap = (cur: Record<string, unknown> | undefined, patch: Record<string, unknown> | null) => {
  if (patch === null) return null;
  const out: Record<string, unknown> = { ...(cur || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete out[k]; else out[k] = v; }
  return Object.keys(out).length ? out : null;
};
export function lookChange(label: string, part: LookPart, coalesce?: string) {
  const st = get().doc.view?.style || {}, d = style().design, designs = (st.designs || {}) as Record<string, Record<string, Record<string, unknown> | undefined>>;
  if (get().ui.lookScope === "design") {
    const cur = designs[d] || {}, next: Record<string, unknown> = { ...cur };
    for (const k of ["theme", "colors", "text"] as const) if (k in part) { const m = mergeMap(cur[k], part[k]!); if (m) next[k] = m; else delete next[k]; }
    styleChange(label, { designs: { [d]: Object.keys(next).length ? next : null } } as never, coalesce);
    return;
  }
  // all designs: the shared setting, and the same keys taken out of every design's own settings
  const dpatch: Record<string, unknown> = {};
  for (const [dn, entry] of Object.entries(designs)) {
    if (!entry) continue;
    const next: Record<string, unknown> = { ...entry };
    for (const k of ["theme", "colors", "text"] as const) if (k in part && entry[k]) {
      const keys = part[k] === null ? Object.keys(entry[k]!) : Object.keys(part[k]!);
      const m = { ...entry[k] }; keys.forEach(x => delete (m as Record<string, unknown>)[x]);
      if (Object.keys(m).length) next[k] = m; else delete next[k];
    }
    if (JSON.stringify(next) !== JSON.stringify(entry)) dpatch[dn] = Object.keys(next).length ? next : null;
  }
  styleChange(label, { ...part, ...(Object.keys(dpatch).length ? { designs: dpatch } : {}) } as never, coalesce);
}
/** the look set at the current scope (to show what can be reset there) */
export function lookAt(): { theme?: Record<string, unknown>; colors?: Record<string, string>; text?: Record<string, unknown> } {
  const st = (get().doc.view?.style || {}) as Record<string, unknown>;
  if (get().ui.lookScope === "all") return st as never;
  return ((st.designs as Record<string, unknown> | undefined)?.[style().design] || {}) as never;
}

/* ---------------------------------------------------------------- versions (wizard › Versions) */
/** shows the deck as one of its versions ("" = full); remembered per workbook in the personal preferences */
export function showVersion(id: string) {
  patch("deck", { version: id });
  const { file } = get().deck; if (file) setPrefs({ versions: { ...(get().prefs.prefs.versions || {}), [file.name]: id } });
  // the worker draws this version first; the slides are then redrawn with its HTML
  if (get().doc.open) void core().call("inputs", viewInputs()).then(() => { STAGE.render(); THUMBS.render(); });
  else { STAGE.render(); THUMBS.render(); }
}
