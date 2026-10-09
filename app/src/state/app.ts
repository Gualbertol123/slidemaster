/* Application actions: start-up, opening workbooks, editing through operations, undo/redo,
   polling for other people's changes, presence. */
import { get, patch, patchAll, same, STAGE, THUMBS, toast, showBusy, hideBusy } from "./store";
import { ask, runWizard } from "./dialogs";
import { backend } from "../sync/api";
import { DocSync, type Change } from "../sync/docsync";
import { indexWorkbook } from "../xlsx/workbook";
import { setPictureConverter } from "../xlsx/drawing";
import { esc, fmtMB, nextFrame, WorkbookError } from "../xlsx/util";
import type { Workbook } from "../xlsx/types";
import { defaultPreset, LCACHE, presetSheets, runtimeSlides } from "../model/preset";
import { resolveStyle } from "../model/style";
import type { Design, Op, Preset, Prefs, RuntimeSlide, StylePatch } from "../model/types";
import type { AppState } from "./store";
import type { RenderCtx } from "../render/context";
import { makeWall } from "../render/wallpaper";
import { loadFonts, watchFontLoads } from "./fonts";

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
    version: (v?.preset?.versions || []).find(x => x.id === version) || null };
  ctxCache = { key, ctx: c };
  return c;
}

/* ---------------------------------------------------------------- start-up */
export async function boot() {
  if (backend.served) setPictureConverter((bytes, ext) => backend.convertPicture(bytes, ext));
  patch("ui", { health: await backend.health() });
  try { const me = await backend.me(); patch("prefs", { user: me.user, host: me.host, prefs: me.prefs || {} }); } catch { /* keep defaults */ }
  try { patch("doc", { config: await backend.config() }); } catch { /* defaults */ }
  watchFontLoads(); await loadFonts();
  const zoom = get().prefs.prefs.zoom; if (zoom != null) patch("ui", { zoom });
  makeWall(style());
  if (backend.served) {
    const files = await backend.files().catch(() => []);
    const last = get().prefs.prefs.lastFile;
    if (last && files.some(f => f.name === last)) await guard(() => openFromFolder(last, false));
    setInterval(() => { void tick(); }, 3000);
    setInterval(() => { void heartbeat(); }, 10000);
    void heartbeat();
    addEventListener("pagehide", () => backend.leave(get().prefs.client));
  }
}
let tickN = 0;
/** one poll: other people's changes, helper health, the file on disk, fonts, shared config (every 3 s) */
export async function tick() {
  tickN++;
  const sync = get().doc.sync;
  if (sync) await sync.poll();
  if (tickN % 2 === 0) {
    setHealth(await backend.health());
    const { file } = get().deck;
    if (file && file.src === "folder" && !get().ui.changedOnDisk) {      // one stat; the list is read when the Open menu opens (B13)
      const f = await backend.fileStat(file.name).catch(() => null);
      if (f && get().deck.file === file && file.mtime && f.mtime > file.mtime + 0.5) patch("ui", { changedOnDisk: true });
    }
  }
  if (tickN % 10 === 0) void loadFonts();               // fonts colleagues added
  if (tickN % 10 === 0) { try { const c = await backend.config(); if (c.rev !== get().doc.config.rev) { patch("doc", { config: c }); onStyleChanged(); } } catch { /* later */ } }
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
  catch (e) { console.error(e); hideBusy(); patch("deck", { opening: "" }); toast("⚠ " + esc((e as Error).message || e), [], true); }
}

/* ---------------------------------------------------------------- opening workbooks */
export async function openFromFolder(name: string, ask = true) {
  patch("deck", { opening: name });
  showBusy(`Opening “${name}”…`, null);
  let file;
  try { file = await backend.readFile(name); } finally { hideBusy(); }
  await openBuffer(file.buf, name, "folder", "", file.mtime, file.size, ask);
}
export async function openLocalFile(f: File) {
  const buf = await f.arrayBuffer();
  const inFolder = (await backend.files().catch(() => [])).find(x => x.name === f.name && x.size === f.size);
  if (inFolder) return openBuffer(buf, f.name, "folder", "", inFolder.mtime, inFolder.size, true);
  let id = "";
  if (backend.served) { try { id = await backend.upload(f.name, buf); } catch { /* preview only */ } }
  await openBuffer(buf, f.name, id ? "upload" : "local", id, 0, f.size, true);
}
export async function reloadWorkbook() { const { file } = get().deck; if (file && file.src === "folder") await openFromFolder(file.name, false); }

async function loadWorkbook(buf: ArrayBuffer, name: string): Promise<Workbook> {
  let wb: Workbook;
  showBusy(`Opening “${name}” (${fmtMB(buf.byteLength)})…`, null); await nextFrame();
  try { wb = await indexWorkbook(buf); }
  catch (e) {
    const code = (e as WorkbookError).code;
    if (code !== "XLSB" && code !== "CFB") throw e;
    const what = code === "XLSB" ? "an Excel Binary Workbook (.xlsb)" : "an old .xls workbook or a protected file";
    if (!backend.served) throw new Error(`“${name}” is ${what}. Start the app with Start Slide Builder.bat so Excel can convert it, or save it in Excel as .xlsx.`);
    showBusy(`Converting “${name}” with Excel…`, null);
    let out: ArrayBuffer;
    try { out = await backend.convertWorkbook(name, buf); }
    catch (e2) { throw new Error(`“${name}” is ${what} and Excel could not convert it: ${(e2 as Error).message}. Save it in Excel as .xlsx (File › Save As › Excel Workbook) and open that copy.`); }
    try { wb = await indexWorkbook(out); toast(`“${esc(name)}” was converted by Excel for reading – the original file is unchanged.`); }
    catch (e3) { throw new Error((e3 as WorkbookError).code === "CFB" ? `“${name}” is protected (password or sensitivity label with encryption). Remove the protection or save an unprotected .xlsx copy.` : (e3 as Error).message); }
  }
  // small workbooks are read completely (the wizard can then show titles and table suggestions for every sheet);
  // large ones are read sheet by sheet, only when a sheet is chosen or used by the preset
  if (!wb.big) await wb.ensure(wb.meta.map(m => m.name), showBusy);
  return wb;
}

async function presetBox(name: string, p: Preset): Promise<"continue" | "wizard" | null> {
  const content = p.slides.filter(s => (s.type || "content") === "content").length;
  const extras = [p.slides.some(s => s.type === "cover") ? "cover" : "", p.slides.some(s => s.type === "index") ? "index" : ""].filter(Boolean);
  const r = await ask("Saved preset found", `${content} content slide${content === 1 ? "" : "s"}${extras.length ? " + " + extras.join(" and ") + " slide" : ""} · ${p.tables.length} table${p.tables.length === 1 ? "" : "s"} from ${new Set(p.tables.map(t => t.sheet)).size} sheet(s).`,
    [{ id: "cancel", label: "Cancel" }, { id: "wizard", label: "Open editing wizard" }, { id: "continue", label: "Continue with preset", primary: true }], { sub: name, width: 520 });
  return r === "continue" || r === "wizard" ? r : null;
}

async function openBuffer(buf: ArrayBuffer, name: string, src: "folder" | "upload" | "local", id: string, mtime: number, size: number, askUser: boolean) {
  patch("deck", { opening: name });
  let wb: Workbook;
  try { wb = await loadWorkbook(buf, name); } finally { hideBusy(); }
  LCACHE.clear();
  const doc = (await backend.getDoc(name))!;
  let preset = doc.preset, newPreset: Preset | null = null;
  try {
    if (preset && askUser) {
      const choice = await presetBox(name, preset);
      if (!choice) { patch("deck", { opening: "" }); return; }
      if (choice === "wizard") { const np = await runWizard(wb, name, preset); if (np) newPreset = np; }
    } else if (!preset) {
      const draft = defaultPreset(wb);
      if (!askUser && !wb.big && draft.slides.length) newPreset = draft;        // start-up / reload: "x" workbooks open as before
      else {
        const np = await runWizard(wb, name, draft);
        if (!np) { patch("deck", { opening: "" }); return; }
        newPreset = np;
      }
    }
    await wb.ensure(presetSheets(newPreset || preset), showBusy);                // only the sheets the slides use
  } finally { hideBusy(); }

  get().doc.sync?.dispose();
  const sync = new DocSync(backend, name, doc, get().prefs.client, get().prefs.user);
  if (newPreset) sync.apply([{ op: "preset.set", preset: newPreset }]);
  sync.on(c => { mirror(sync); void onDocChange(c); });
  const design = resolveStyle(get().doc.config.defaults.style, sync.view.style).design;
  const slides = runtimeSlides(wb, sync.view.preset, name, design); slidesDesign = design;
  presetSig = JSON.stringify(sync.view.preset);
  if (src === "folder") setPrefs({ lastFile: name });
  const vid = get().prefs.prefs.versions?.[name] || "";         // the version this person looked at last
  patchAll({
    doc: { sync, view: sync.view, save: sync.state, error: sync.error },
    deck: { wb, file: { name, src, id, mtime, size }, undo: [], redo: [], slides, cur: Math.min(get().deck.cur, Math.max(0, slides.length - 1)),
      version: (sync.view.preset?.versions || []).some(x => x.id === vid) ? vid : "", opening: "", remote: null },
    selection: { sel: null },
    ui: { logoMissing: false, changedOnDisk: false },
  });
  makeWall(style());
  STAGE.render(); THUMBS.render();
  void heartbeat();
}

/* ---------------------------------------------------------------- document changes (mine and others') */
let presetSig = "";
/** the read-only mirror of the document and its save state (store slice "doc") */
function mirror(sync: DocSync) {
  const d = get().doc; if (d.sync !== sync) return;
  if (d.view !== sync.view || d.save !== sync.state || d.error !== sync.error) patch("doc", { view: sync.view, save: sync.state, error: sync.error });
}
async function onDocChange(c: Change) {
  const { doc: { sync }, deck: { wb, file } } = get(); if (!sync || !wb || !file) return;
  // only the save state changed ("Saving…" → "✓ Saved", an error): the status bar (mirrored above), not the slides
  if (!c.local && !c.presetChanged && !c.styleChanged && !c.editsChanged) return;
  if (c.by) patch("deck", { remote: { by: c.by, at: Date.now() } });
  if (c.presetChanged) {
    const sig = JSON.stringify(sync.view.preset);
    if (sig !== presetSig) {
      presetSig = sig;
      await wb.ensure(presetSheets(sync.view.preset), showBusy); hideBusy();
      const { slides: old, cur } = get().deck, keep = old[cur]?.id;
      const slides = runtimeSlides(wb, sync.view.preset, file.name, style().design); slidesDesign = style().design;
      const i = slides.findIndex(R => R.id === keep);
      patchAll({ deck: { slides, cur: i >= 0 ? i : Math.max(0, Math.min(cur, slides.length - 1)) }, ...(c.local ? {} : { selection: { sel: null } }) });
      STAGE.render(); THUMBS.render();
      return;
    }
  }
  // same slides: point them at the new slide objects (layout, titles, logo live there)
  const byId = new Map((sync.view.preset?.slides || []).map(s => [s.id, s]));
  let titles = false, moved = false;
  for (const R of get().deck.slides) {
    const cfg = byId.get(R.id); if (!cfg) continue;
    if (cfg.title !== R.cfg.title || cfg.subtitle !== R.cfg.subtitle || cfg.logo !== R.cfg.logo || cfg.date !== R.cfg.date || cfg.note !== R.cfg.note) titles = true;
    if (R.cfg !== cfg) { R.cfg = cfg; moved = true; }
  }
  if (titles) { patch("deck", { slides: runtimeSlides(wb, sync.view.preset, file.name, style().design) }); slidesDesign = style().design; }
  else if (moved) patch("deck", { slides: [...get().deck.slides] });     // the same slide objects, so the list's readers see the change
  if (c.styleChanged) return onStyleChanged();
  if (titles) { STAGE.render(); THUMBS.render(); }
  else if (c.local) { STAGE.refresh(); THUMBS.refresh(get().deck.cur); }
  else { STAGE.refresh(); THUMBS.render(); }
}
function onStyleChanged() {
  // column widths and row heights are per design: another design needs its own table layouts
  const d = style().design, { wb, file, slides: old, cur } = get().deck;
  if (d !== slidesDesign && wb && file) {
    const keep = old[cur]?.id;
    const slides = runtimeSlides(wb, get().doc.view?.preset || null, file.name, d); slidesDesign = d;
    const i = slides.findIndex(R => R.id === keep);
    patchAll({ deck: { slides, ...(i >= 0 ? { cur: i } : {}) }, selection: { sel: null } });
  }
  makeWall(style()); STAGE.render(); THUMBS.render();
}
let slidesDesign: Design | null = null;
/** the slides as `design` shows them (the current ones, or resolved again for another design – exports) */
export function slidesFor(design: Design): RuntimeSlide[] {
  const { wb, file, slides } = get().deck;
  if (design === slidesDesign || !wb || !file) return slides;
  const other = runtimeSlides(wb, get().doc.view?.preset || null, file.name, design);
  return slides.map(R => other.find(x => x.id === R.id) || R);
}

/** every edit goes through here: ops are applied locally, queued for the helper, and undoable */
export function change(label: string, ops: Op[], coalesce?: string) {
  const { doc: { sync }, deck: { file, undo: past } } = get(); if (!sync || !file) return;
  const inverse = sync.apply(ops);
  if (!inverse) return;
  const last = past[past.length - 1], now = Date.now();
  // slider drags: one undo step for the whole drag
  const noRedo = get().deck.redo.length ? { redo: [] } : {};
  if (coalesce && last && last.coalesce === coalesce && now - (last.at || 0) < 1500) { last.redo = ops; last.at = now; patch("deck", noRedo); }
  else patch("deck", { undo: [...past, { file: file.name, label, undo: inverse, redo: ops, coalesce, at: now }].slice(-200), ...noRedo });
}
export function undo(redo = false) {
  const { doc: { sync }, deck } = get();
  const st = redo ? deck.redo : deck.undo, other = redo ? deck.undo : deck.redo;
  const a = st[st.length - 1]; if (!a) return;
  const rest = st.slice(0, -1);
  if (!sync || a.file !== deck.file?.name) { patch("deck", redo ? { redo: rest } : { undo: rest }); return; }
  const inv = sync.apply(redo ? a.redo : a.undo);
  const others = inv ? [...other, a] : other;
  patchAll({ deck: redo ? { redo: rest, undo: others } : { undo: rest, redo: others }, selection: { sel: null } });
  toast((redo ? "Redo: " : "Undo: ") + esc(a.label));
}
export const styleChange = (label: string, patch: Extract<Op, { op: "style.patch" }>["patch"], coalesce?: string) => change(label, [{ op: "style.patch", patch } as Op], coalesce);
export async function saveStyleAsDefault() {
  const st = get().doc.view?.style; if (!st) return;
  try { const r = await backend.configOps([{ op: "style.patch", patch: JSON.parse(JSON.stringify(st)) } as Op]); patch("doc", { config: r.doc }); toast("This deck's style is now the default for new decks."); }
  catch (e) { toast("⚠ " + esc((e as Error).message), [], true); }
}

/* ---------------------------------------------------------------- wizard */
export async function openWizard() {
  const { doc: { sync }, deck: { wb, file } } = get(); if (!sync || !wb || !file) return;
  const startSig = JSON.stringify(sync.view.preset), start = sync.view.preset || defaultPreset(wb);
  const np = await runWizard(wb, file.name, JSON.parse(JSON.stringify(start)));
  if (!np) return;
  if (JSON.stringify(sync.view.preset) !== startSig) {
    const remote = get().deck.remote, who = remote && remote.by ? esc(remote.by) : "Someone else";
    const r = await ask("The slides were changed meanwhile", `${who} changed this workbook's slides while the wizard was open. Saving replaces their slide and table changes with yours (cell edits are not affected).`,
      [{ id: "cancel", label: "Discard my wizard changes" }, { id: "ok", label: "Save mine anyway", danger: true }]);
    if (r !== "ok") return;
  }
  await wb.ensure(presetSheets(np), showBusy); hideBusy();
  change("Wizard changes", [{ op: "preset.set", preset: np }]);
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
  STAGE.render(); THUMBS.render();
}
