/* Application actions: start-up, opening workbooks, editing through operations, undo/redo,
   polling for other people's changes, presence. */
import { S, emit, STAGE, THUMBS, toast, showBusy, hideBusy } from "./store";
import { ask, runWizard } from "./dialogs";
import { backend } from "../sync/api";
import { DocSync, type Change } from "../sync/docsync";
import { indexWorkbook } from "../xlsx/workbook";
import { setPictureConverter } from "../xlsx/drawing";
import { esc, fmtMB, nextFrame, WorkbookError } from "../xlsx/util";
import type { Workbook } from "../xlsx/types";
import { defaultPreset, LCACHE, presetSheets, runtimeSlides } from "../model/preset";
import { resolveStyle } from "../model/style";
import type { Op, Preset, Prefs, StylePatch } from "../model/types";
import type { RenderCtx } from "../render/context";
import { makeWall } from "../render/wallpaper";
import { loadFonts, watchFontLoads } from "./fonts";

/* ---------------------------------------------------------------- render context */
let ctxCache: { key: unknown[]; ctx: RenderCtx } | null = null;
export function style() { return resolveStyle(S.config.defaults.style, S.sync?.view.style); }
export function ctx(): RenderCtx {
  const v = S.sync?.view;
  const key = [v, S.slides, S.config, S.file?.name, S.wb];
  if (ctxCache && ctxCache.key.every((k, i) => k === key[i])) return ctxCache.ctx;
  const st = style();
  const c: RenderCtx = { style: st, edits: v?.edits || {}, slides: S.slides, preset: v?.preset || null, workbook: S.file?.name || "",
    logoSrc: st.logo.trim() ? backend.assetUrl(st.logo.trim()) : "", sheet: n => S.wb?.sheets.find(x => x.name === n) || null };
  ctxCache = { key, ctx: c };
  return c;
}

/* ---------------------------------------------------------------- start-up */
export async function boot() {
  if (backend.served) setPictureConverter((bytes, ext) => backend.convertPicture(bytes, ext));
  S.health = await backend.health();
  try { const me = await backend.me(); S.user = me.user; S.host = me.host; S.prefs = me.prefs || {}; } catch { /* keep defaults */ }
  try { S.config = await backend.config(); } catch { /* defaults */ }
  watchFontLoads(); await loadFonts();
  if (S.prefs.zoom != null) S.zoom = S.prefs.zoom;
  makeWall(style());
  emit();
  if (backend.served) {
    const files = await backend.files().catch(() => []);
    const last = S.prefs.lastFile;
    if (last && files.some(f => f.name === last)) await guard(() => openFromFolder(last, false));
    setInterval(() => { void tick(); }, 3000);
    setInterval(() => { void heartbeat(); }, 10000);
    void heartbeat();
    addEventListener("pagehide", () => backend.leave(S.client));
  }
}
let tickN = 0;
async function tick() {
  tickN++;
  if (S.sync) await S.sync.poll();
  if (tickN % 2 === 0) {
    S.health = await backend.health(); emit();
    if (S.file && S.file.src === "folder") {
      const f = (await backend.files().catch(() => [])).find(x => x.name === S.file!.name);
      if (f && S.file.mtime && f.mtime > S.file.mtime + 0.5 && !S.changedOnDisk) { S.changedOnDisk = true; emit(); }
    }
  }
  if (tickN % 10 === 0) void loadFonts();               // fonts colleagues added
  if (tickN % 10 === 0) { try { const c = await backend.config(); if (c.rev !== S.config.rev) { S.config = c; onStyleChanged(); } } catch { /* later */ } }
}
async function heartbeat() {
  try { S.others = await backend.presence(S.client, S.file?.name || null); emit(); } catch { /* helper busy */ }
}

/* ---------------------------------------------------------------- prefs */
let prefsTimer: ReturnType<typeof setTimeout> | null = null;
export function setPrefs(p: Partial<Prefs>) {
  Object.assign(S.prefs, p);
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => { void backend.savePrefs(S.prefs).catch(() => { /* personal, retried next change */ }); }, 400);
}

/* ---------------------------------------------------------------- errors */
export async function guard(fn: () => Promise<unknown> | unknown) {
  try { await fn(); }
  catch (e) { console.error(e); hideBusy(); S.opening = ""; toast("⚠ " + esc((e as Error).message || e), [], true); }
}

/* ---------------------------------------------------------------- opening workbooks */
export async function openFromFolder(name: string, ask = true) {
  S.opening = name; emit();
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
export async function reloadWorkbook() { if (S.file && S.file.src === "folder") await openFromFolder(S.file.name, false); }

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
  S.opening = name; emit();
  let wb: Workbook;
  try { wb = await loadWorkbook(buf, name); } finally { hideBusy(); }
  LCACHE.clear();
  const doc = (await backend.getDoc(name))!;
  let preset = doc.preset, newPreset: Preset | null = null;
  try {
    if (preset && askUser) {
      const choice = await presetBox(name, preset);
      if (!choice) { S.opening = ""; emit(); return; }
      if (choice === "wizard") { const np = await runWizard(wb, name, preset); if (np) newPreset = np; }
    } else if (!preset) {
      const draft = defaultPreset(wb);
      if (!askUser && !wb.big && draft.slides.length) newPreset = draft;        // start-up / reload: "x" workbooks open as before
      else {
        const np = await runWizard(wb, name, draft);
        if (!np) { S.opening = ""; emit(); return; }
        newPreset = np;
      }
    }
    await wb.ensure(presetSheets(newPreset || preset), showBusy);                // only the sheets the slides use
  } finally { hideBusy(); }

  S.sync?.dispose();
  const sync = new DocSync(backend, name, doc, S.client, S.user);
  S.sync = sync; S.wb = wb;
  S.file = { name, src, id, mtime, size };
  S.undo = []; S.redo = [];
  if (newPreset) sync.apply([{ op: "preset.set", preset: newPreset }]);
  sync.on(onDocChange);
  S.slides = runtimeSlides(wb, sync.view.preset, name);
  presetSig = JSON.stringify(sync.view.preset);
  if (src === "folder") setPrefs({ lastFile: name });
  S.sel = null; S.cur = Math.min(S.cur, Math.max(0, S.slides.length - 1)); S.logoMissing = false;
  S.changedOnDisk = false; S.opening = ""; S.remote = null;
  makeWall(style());
  emit(); STAGE.render(); THUMBS.render();
  void heartbeat();
}

/* ---------------------------------------------------------------- document changes (mine and others') */
let presetSig = "";
async function onDocChange(c: Change) {
  const sync = S.sync, wb = S.wb; if (!sync || !wb || !S.file) return;
  if (c.by) { S.remote = { by: c.by, at: Date.now() }; }
  if (c.presetChanged) {
    const sig = JSON.stringify(sync.view.preset);
    if (sig !== presetSig) {
      presetSig = sig;
      await wb.ensure(presetSheets(sync.view.preset), showBusy); hideBusy();
      const keep = S.slides[S.cur]?.id;
      S.slides = runtimeSlides(wb, sync.view.preset, S.file.name);
      const i = S.slides.findIndex(R => R.id === keep);
      S.cur = i >= 0 ? i : Math.max(0, Math.min(S.cur, S.slides.length - 1));
      if (!c.local) S.sel = null;
      emit(); STAGE.render(); THUMBS.render();
      return;
    }
  }
  // same slides: point them at the new slide objects (layout, titles, logo live there)
  const byId = new Map((sync.view.preset?.slides || []).map(s => [s.id, s]));
  let titles = false;
  for (const R of S.slides) {
    const cfg = byId.get(R.id); if (!cfg) continue;
    if (cfg.title !== R.cfg.title || cfg.subtitle !== R.cfg.subtitle || cfg.logo !== R.cfg.logo || cfg.date !== R.cfg.date || cfg.note !== R.cfg.note) titles = true;
    R.cfg = cfg;
  }
  if (titles) { S.slides = runtimeSlides(wb, sync.view.preset, S.file.name); }
  if (c.styleChanged) return onStyleChanged();
  emit();
  if (titles) { STAGE.render(); THUMBS.render(); }
  else if (c.local) { STAGE.refresh(); THUMBS.refresh(S.cur); }
  else { STAGE.refresh(); THUMBS.render(); }
}
function onStyleChanged() { makeWall(style()); emit(); STAGE.render(); THUMBS.render(); }

/** every edit goes through here: ops are applied locally, queued for the helper, and undoable */
export function change(label: string, ops: Op[], coalesce?: string) {
  const sync = S.sync; if (!sync || !S.file) return;
  const inverse = sync.apply(ops);
  if (!inverse) return;
  const last = S.undo[S.undo.length - 1], now = Date.now();
  // slider drags: one undo step for the whole drag
  if (coalesce && last && last.coalesce === coalesce && now - (last.at || 0) < 1500) { last.redo = ops; last.at = now; }
  else { S.undo.push({ file: S.file.name, label, undo: inverse, redo: ops, coalesce, at: now }); if (S.undo.length > 200) S.undo.shift(); }
  S.redo.length = 0;
  emit();
}
export function undo(redo = false) {
  const st = redo ? S.redo : S.undo, other = redo ? S.undo : S.redo;
  const a = st.pop(); if (!a || !S.sync || a.file !== S.file?.name) return;
  const inv = S.sync.apply(redo ? a.redo : a.undo);
  if (inv) other.push(a);
  S.sel = null;
  toast((redo ? "Redo: " : "Undo: ") + esc(a.label));
  emit(); STAGE.paintSel();
}
export const styleChange = (label: string, patch: Extract<Op, { op: "style.patch" }>["patch"], coalesce?: string) => change(label, [{ op: "style.patch", patch } as Op], coalesce);
export async function saveStyleAsDefault() {
  const st = S.sync?.view.style; if (!st) return;
  try { const r = await backend.configOps([{ op: "style.patch", patch: JSON.parse(JSON.stringify(st)) } as Op]); S.config = r.doc; toast("This deck's style is now the default for new decks."); emit(); }
  catch (e) { toast("⚠ " + esc((e as Error).message), [], true); }
}

/* ---------------------------------------------------------------- wizard */
export async function openWizard() {
  const sync = S.sync, wb = S.wb; if (!sync || !wb || !S.file) return;
  const startSig = JSON.stringify(sync.view.preset), start = sync.view.preset || defaultPreset(wb);
  const np = await runWizard(wb, S.file.name, JSON.parse(JSON.stringify(start)));
  if (!np) return;
  if (JSON.stringify(sync.view.preset) !== startSig) {
    const who = S.remote && S.remote.by ? esc(S.remote.by) : "Someone else";
    const r = await ask("The slides were changed meanwhile", `${who} changed this workbook's slides while the wizard was open. Saving replaces their slide and table changes with yours (cell edits are not affected).`,
      [{ id: "cancel", label: "Discard my wizard changes" }, { id: "ok", label: "Save mine anyway", danger: true }]);
    if (r !== "ok") return;
  }
  await wb.ensure(presetSheets(np), showBusy); hideBusy();
  change("Wizard changes", [{ op: "preset.set", preset: np }]);
}

/* ---------------------------------------------------------------- navigation */
export function gotoSlide(i: number) {
  if (i < 0 || i >= S.slides.length || i === S.cur) return;
  S.cur = i; S.sel = null; emit(); STAGE.render();
}
export function setZoom(z: "fit" | number) { S.zoom = z; setPrefs({ zoom: z }); emit(); STAGE.fit(); }
