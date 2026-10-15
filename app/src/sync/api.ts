/* Talking to the helper (docs/ARCHITECTURE.md §5). When the page is opened from disk (file://)
   an in-browser backend keeps documents in localStorage, and exports are downloads (B1, editor/export.ts). */
import { FORMATS, type ConfigDoc, type Op, type Prefs, type WorkbookDoc } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc } from "@slide-builder/core/model/ops";
import type { LibraryFont } from "@slide-builder/core/model/fonts";
import type { DeckRecord, DeckSnapshot } from "@slide-builder/core/model/fold";
import type { DeckOpen, TailResult } from "@slide-builder/core/sync/docsync";

export interface Health { app: string; version: string; user: string; host: string; folder: string; export: string }
export interface FileInfo { name: string; mtime: number; size: number; rev?: number | null; updated?: number | null; updatedBy?: string | null }
export interface Other { user: string; host: string; client: string; workbook: string | null; at: number }
/** POST /api/decks/open: the deck's key, a writer id for this page session, its snapshot */
export type DeckOpenAnswer = Omit<DeckOpen, "tail"> & { created?: boolean; storage?: string };
export interface OpsResult<D> { doc: D; applied: number; skipped: number[] }
export interface ExportRes { ok: boolean; files?: string[]; error?: string }
/** a Windows font captured (W13): its build, the PCs that have another, and in copy mode whether the helper put the
    family into the shared library (helper sysfonts.py) */
export interface FontCapture { mode: "fingerprint" | "copy"; family: string; sha1: string; otherHosts?: string[]; copied?: boolean; reason?: string }
/** a font file of this PC (the helper's /sysfonts index) */
export interface SysFont { file: string; family: string; subfamily: string; weight: number; italic: boolean; faces: number; size: number }

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export interface Backend {
  served: boolean;
  health(): Promise<Health | null>;
  me(): Promise<{ user: string; host: string; prefs: Prefs }>;
  savePrefs(p: Prefs): Promise<void>;
  config(): Promise<ConfigDoc>;
  configOps(ops: Op[]): Promise<OpsResult<ConfigDoc>>;
  files(): Promise<FileInfo[]>;
  /** one stat of one workbook (the changed-on-disk banner); null when it is gone or there is no helper */
  fileStat(name: string): Promise<{ mtime: number; size: number } | null>;
  readFile(name: string): Promise<{ buf: ArrayBuffer; mtime: number; size: number }>;
  getDoc(name: string, since?: number): Promise<WorkbookDoc | null>;
  postOps(name: string, ops: Op[], client: string): Promise<OpsResult<WorkbookDoc>>;
  /* decks, storage v4 (docs/next/04 §2.2; helper/slidebuilder/decks.py) */
  openDeck(workbook: string): Promise<DeckOpenAnswer>;
  deckSnapshot(key: string): Promise<DeckSnapshot>;
  deckTail(key: string, since: Record<string, number>): Promise<TailResult>;
  deckAppend(key: string, writer: string, record: DeckRecord): Promise<{ journal: string; offset: number; at: number }>;
  deckCompact(key: string, baseGen: number, snapshot: DeckSnapshot): Promise<{ gen: number }>;
  /** the same, on pagehide: a request the browser still sends after the page is gone (false: too big for that) */
  deckCompactOnLeave(key: string, baseGen: number, snapshotJson: string): boolean;
  deckRotate(key: string, writer: string): Promise<{ deleted: string[] }>;
  deckPrepare(key: string, writer: string): Promise<unknown>;
  /** every deck on the share (Prepare rollback) */
  decks(): Promise<{ key: string; workbook: string; gen: number; rev: number; rolledBack: boolean }[]>;
  /** presence on a deck (v2): others there in the last 25 s */
  presence(client: string, deck: string | null, workbook: string | null): Promise<Other[]>;
  leave(client: string, deck: string | null): void;
  upload(name: string, buf: ArrayBuffer): Promise<string>;
  convertWorkbook(name: string, buf: ArrayBuffer): Promise<ArrayBuffer>;
  convertPicture(bytes: Uint8Array, ext: string): Promise<string | null>;
  /** the native export (S3.7): a PDF or PNG the page wrote, saved in the export folder under (about) this name */
  exportFile(name: string, data: ArrayBuffer): Promise<ExportRes>;
  /** "Report a problem with this export" (the export pilot, S3.8): one JSON file in export\feedback\; returns its name */
  exportFeedback(report: object): Promise<{ file: string }>;
  /** this PC's font files (the export embeds the ones a deck uses) and one file's bytes */
  sysFonts(): Promise<SysFont[]>;
  sysFontBytes(file: string): Promise<ArrayBuffer>;
  /** record this PC's file of a Windows font a deck uses (null from disk) */
  captureFont(file: string): Promise<FontCapture | null>;
  open(target: { name: string } | { folder: true }): Promise<void>;
  assetUrl(name: string): string;
  /** shared font library (helper: data/fonts; from disk: Google Fonts only, kept in this browser) */
  fonts(): Promise<LibraryFont[]>;
  addFont(f: { family: string; weight: number; style: "normal" | "italic"; source: "upload" | "google"; name: string; range?: string }, data: ArrayBuffer): Promise<LibraryFont[]>;
  removeFont(family: string): Promise<LibraryFont[]>;
  fontUrl(file: string): string;
  /** copies a picture into the shared folder (data/assets); returns the name to use */
  uploadLogo(name: string, data: ArrayBuffer): Promise<string>;
}

const TOKEN = (document.querySelector('meta[name="sb-token"]') as HTMLMetaElement | null)?.content || "";
// the helper replaces the placeholder in <meta name="sb-token">; never spell it out here (it would be replaced too)
const SERVED = location.protocol.startsWith("http") && !!TOKEN && !TOKEN.startsWith("__SB_");

/** how long a request may take before it counts as failed (a hung share must not leave "Saving…" or "Opening…" for
    ever: DocSync then retries, an open shows the error); reading, uploading and converting a workbook take longer */
const WAIT_MS = 60_000, WAIT_LONG_MS = 300_000, RETRY_MS = 500;
const FORMATS_HEADER = Object.entries(FORMATS).map(([k, v]) => k + "=" + v).join(";");
async function req(path: string, init: RequestInit & { json?: unknown; timeout?: number; /** a write that may be sent twice */ idempotent?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("X-SB-Token", TOKEN);
  headers.set("X-SB-Formats", FORMATS_HEADER);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const ms = init.timeout ?? WAIT_MS;
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
  // a read is asked again once when the connection to the helper drops (seen on Windows: a loopback request failing
  // with ERR_CONNECTION_TIMED_OUT left "No workbook" behind an open); a write is not – it may have arrived
  const read = !init.method || init.method === "GET" || init.method === "HEAD" || !!init.idempotent;
  let r: Response;
  for (let again = read; ; again = false) {
    try { r = await fetch(path, { ...init, headers, body, cache: "no-store", ...(signal ? { signal } : {}) }); break; }
    catch (e) {
      if (timedOut(e)) throw new ApiError(0, `The helper did not answer within ${Math.round(ms / 1000)} s (is the shared folder slow or unreachable?).`);
      if (!again || !(e instanceof TypeError)) throw e;
      console.info("helper: asking again after", e);                // (not a warning: the e2e check counts those)
      await new Promise(ok => setTimeout(ok, RETRY_MS));             // (within the same time limit: the signal is shared)
    }
  }
  if (!r.ok && r.status !== 204) {
    let msg = r.statusText || ("HTTP " + r.status);
    try { const j = await r.clone().json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
    throw new ApiError(r.status, msg);
  }
  return r;
}
/** the body of an answer; the request's time limit also covers reading it */
const timedOut = (e: unknown) => (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
const json = async <T>(p: Promise<Response>): Promise<T> => {
  const r = await p;
  try { return await r.json() as T; }
  catch (e) { if (timedOut(e)) throw new ApiError(0, "The helper's answer did not arrive in time (is the shared folder slow or unreachable?)."); throw e; }
};
const blobToDataUrl = (b: Blob) => new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(b); });
const wbPath = (name: string) => "/api/workbooks/" + encodeURIComponent(name);
const deckPath = (key: string) => "/api/decks/" + encodeURIComponent(key);
/** what a request kept alive after the page is gone may carry (the browsers' limit for all of them together) */
const KEEPALIVE_MAX = 60_000;

export const helper: Backend = {
  served: true,
  async health() { try { return await json<Health>(req("/api/health")); } catch { return null; } },
  me: () => json(req("/api/me")),
  async savePrefs(prefs) { await req("/api/me", { method: "PUT", json: { prefs } }); },
  config: () => json(req("/api/config")),
  configOps: ops => json(req("/api/config/ops", { method: "POST", json: { ops } })),
  async files() { return (await json<{ workbooks: FileInfo[] }>(req("/api/files"))).workbooks || []; },
  async fileStat(name) {
    try { return await json<{ mtime: number; size: number }>(req("/api/files/" + encodeURIComponent(name) + "/stat")); }
    catch (e) { if ((e as ApiError).status === 404) return null; throw e; }
  },
  async readFile(name) {
    const r = await req("/files/" + encodeURIComponent(name), { timeout: WAIT_LONG_MS });
    let buf: ArrayBuffer;
    try { buf = await r.arrayBuffer(); }
    catch (e) { if (timedOut(e)) throw new ApiError(0, "Reading the workbook from the shared folder took too long."); throw e; }
    return { buf, mtime: +(r.headers.get("X-SB-Mtime") || 0), size: +(r.headers.get("X-SB-Size") || 0) };
  },
  async getDoc(name, since) {
    const r = await req(wbPath(name) + "/doc" + (since !== undefined ? "?since=" + since : ""));
    if (r.status === 204) return null;
    return (await r.json()).doc as WorkbookDoc;
  },
  postOps: (name, ops, client) => json(req(wbPath(name) + "/ops", { method: "POST", json: { ops, client } })),
  // opening a deck twice gives the same deck (it is created once, under its lock): asked again like a read
  openDeck: workbook => json(req("/api/decks/open", { method: "POST", json: { workbook }, idempotent: true })),
  async deckSnapshot(key) { return (await json<{ snapshot: DeckSnapshot }>(req(deckPath(key) + "/snapshot"))).snapshot; },
  deckTail: (key, since) => json(req(deckPath(key) + "/tail?since=" + encodeURIComponent(JSON.stringify(since)))),
  deckAppend: (key, writer, record) => json(req(deckPath(key) + "/append", { method: "POST", json: { writer, record } })),
  deckCompact: (key, baseGen, snapshot) => json(req(deckPath(key) + "/compact", { method: "POST", json: { baseGen, snapshot }, timeout: WAIT_LONG_MS })),
  deckCompactOnLeave(key, baseGen, snapshotJson) {
    const body = '{"baseGen":' + baseGen + ',"snapshot":' + snapshotJson + "}";
    if (body.length > KEEPALIVE_MAX) return false;
    try { fetch(deckPath(key) + "/compact", { method: "POST", keepalive: true, headers: { "X-SB-Token": TOKEN, "Content-Type": "application/json", "X-SB-Formats": FORMATS_HEADER }, body }); return true; }
    catch { return false; }
  },
  deckRotate: (key, writer) => json(req(deckPath(key) + "/rotate", { method: "POST", json: { writer } })),
  // opening a journal twice is harmless (the helper keeps one handle per writer): asked again like a read
  deckPrepare: (key, writer) => json(req(deckPath(key) + "/prepare", { method: "POST", json: { writer }, idempotent: true })),
  async decks() { return (await json<{ decks: Awaited<ReturnType<Backend["decks"]>> }>(req("/api/decks"))).decks || []; },
  async presence(client, deck, workbook) {
    if (!deck) return [];
    const others = (await json<{ others: Other[] }>(req("/api/presence", { method: "POST", json: { client, deck } }))).others || [];
    return others.map(o => ({ ...o, workbook }));
  },
  leave(client, deck) {
    if (!deck) return;
    try { fetch("/api/presence/leave", { method: "POST", keepalive: true, headers: { "X-SB-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ client, deck }) }); } catch { /* page closing */ }
  },
  async upload(name, buf) { return (await json<{ id: string }>(req("/api/upload?name=" + encodeURIComponent(name), { method: "POST", body: buf, timeout: WAIT_LONG_MS }))).id; },
  async convertWorkbook(name, buf) { return (await req("/api/convert-workbook?name=" + encodeURIComponent(name), { method: "POST", body: buf, timeout: WAIT_LONG_MS })).arrayBuffer(); },
  async convertPicture(bytes, ext) {
    try { const r = await req("/api/convert?ext=" + encodeURIComponent(ext), { method: "POST", body: bytes as unknown as BodyInit }); return await blobToDataUrl(await r.blob()); } catch { return null; }
  },
  async exportFile(name, data) {
    // a connection dropped on the way (seen once in ~80 exports in a row on the reference PC) is tried again once: saving
    // the same file under the same name again is harmless
    const send = () => json<ExportRes>(req("/api/export-file?name=" + encodeURIComponent(name), { method: "POST", body: data, timeout: WAIT_LONG_MS }));
    try { return await send(); }
    catch (e) { if (!(e instanceof TypeError)) throw e; console.warn("export: saving again after", e); await new Promise(r => setTimeout(r, 500)); return send(); }
  },
  exportFeedback: report => json(req("/api/export-feedback", { method: "POST", json: report })),
  async sysFonts() { return (await json<{ fonts: SysFont[] }>(req("/sysfonts"))).fonts || []; },
  async sysFontBytes(file) { return (await req("/sysfonts/" + encodeURIComponent(file))).arrayBuffer(); },
  captureFont: file => json(req("/api/fonts/capture?file=" + encodeURIComponent(file), { method: "POST" })),
  async open(target) { await req("/api/open", { method: "POST", json: target }); },
  assetUrl: name => "/assets/" + encodeURIComponent(name) + "?t=" + encodeURIComponent(TOKEN),
  async fonts() { return (await json<{ fonts: LibraryFont[] }>(req("/api/fonts"))).fonts || []; },
  async addFont(f, data) {
    const q = new URLSearchParams({ family: f.family, weight: String(f.weight), style: f.style, source: f.source, name: f.name, ...(f.range ? { range: f.range } : {}) });
    return (await json<{ fonts: LibraryFont[] }>(req("/api/fonts?" + q, { method: "POST", body: data }))).fonts || [];
  },
  async removeFont(family) { return (await json<{ fonts: LibraryFont[] }>(req("/api/fonts?family=" + encodeURIComponent(family), { method: "DELETE" }))).fonts || []; },
  fontUrl: file => "/fonts/" + encodeURIComponent(file) + "?t=" + encodeURIComponent(TOKEN),
  async uploadLogo(name, data) { return (await json<{ name: string }>(req("/api/logo?name=" + encodeURIComponent(name), { method: "POST", body: data }))).name; },
};

/* ---- opened from disk: everything stays in this browser ---- */
const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem("sb3:" + k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  /** false when the browser refused (storage full or blocked) */
  set(k: string, v: unknown): boolean { try { localStorage.setItem("sb3:" + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const offlineOnly = () => { throw new ApiError(0, "Start the helper (Start Slide Builder.bat) for this."); };
export const offline: Backend = {
  served: false,
  async health() { return null; },
  async me() { return { user: "", host: "", prefs: LS.get<Prefs>("prefs", {}) }; },
  async savePrefs(p) { LS.set("prefs", p); },
  async config() { return LS.get<ConfigDoc>("config", { schema: 3, rev: 0, defaults: { style: {} } }); },
  async configOps(ops) {
    const c = await offline.config();
    const r = applyOps({ preset: null, style: c.defaults.style, edits: {} }, ops);
    const doc: ConfigDoc = { ...c, rev: c.rev + (r.applied ? 1 : 0), defaults: { style: r.doc.style } }; LS.set("config", doc);
    return { doc, applied: r.applied, skipped: r.skipped };
  },
  async files() { return []; },
  async fileStat() { return null; },
  readFile: offlineOnly,
  async getDoc(name, since) { const d = LS.get<WorkbookDoc>("doc:" + name, emptyDoc(name)); return since !== undefined && d.rev === since ? null : d; },
  async postOps(name, ops) {
    const cur = LS.get<WorkbookDoc>("doc:" + name, emptyDoc(name));
    const r = applyOps(cur, ops);
    if (r.applied) { r.doc.rev = cur.rev + 1; r.doc.updated = Date.now(); r.doc.updatedBy = ""; }
    // not stored: the save fails (the status bar shows it and the changes stay queued), never a false "saved"
    if (!LS.set("doc:" + name, r.doc)) throw new ApiError(507, "This browser's storage is full or blocked: the changes are not saved. Start the helper (Start Slide Builder.bat) to keep working.");
    return r;
  },
  /* opened from disk: one writer, this browser – the deck is the document in localStorage (as before), each record
     applied to it at once (the key is the workbook's name) */
  async openDeck(name) {
    const doc = LS.get<WorkbookDoc>("doc:" + name, emptyDoc(name));
    return { key: name, writer: "local@browser#" + Math.random().toString(32).slice(2, 10).padEnd(8, "a"),
      snapshot: { format: 4, gen: 1, workbook: name, lamport: 0, rev: doc.rev || 0, frontier: {}, doc } };
  },
  async deckSnapshot(key) { return (await offline.openDeck(key)).snapshot; },
  async deckTail() { return { journals: {}, gen: 1 }; },
  async deckAppend(key, writer, record) {
    const cur = LS.get<WorkbookDoc>("doc:" + key, emptyDoc(key));
    const r = applyOps(cur, record.ops), at = Date.now();
    r.doc.rev = (cur.rev || 0) + 1; r.doc.updated = at; r.doc.updatedBy = "";
    // not stored: the save fails (the status bar shows it and the changes stay queued), never a false "saved"
    if (!LS.set("doc:" + key, r.doc)) throw new ApiError(507, "This browser's storage is full or blocked: the changes are not saved. Start the helper (Start Slide Builder.bat) to keep working.");
    return { journal: writer, offset: r.doc.rev, at };
  },
  async deckCompact() { return { gen: 1 }; },
  deckCompactOnLeave() { return false; },
  async deckRotate() { return { deleted: [] }; },
  async deckPrepare() { return null; },
  async decks() { return []; },
  async presence() { return []; },
  leave() { /* nothing */ },
  upload: offlineOnly, convertWorkbook: offlineOnly,
  async convertPicture() { return null; },
  open: offlineOnly, exportFile: offlineOnly, exportFeedback: offlineOnly,
  async sysFonts() { return []; },
  sysFontBytes: offlineOnly,
  async captureFont() { return null; },
  assetUrl: name => encodeURI(name),
  /* from disk: Google fonts are remembered by name in this browser and loaded from Google */
  async fonts() { return LS.get<LibraryFont[]>("fonts", []); },
  async addFont(f) {
    if (f.source !== "google") offlineOnly();
    const lib = LS.get<LibraryFont[]>("fonts", []).filter(x => x.family.toLowerCase() !== f.family.toLowerCase());
    lib.push({ family: f.family, source: "google", faces: [] }); lib.sort((a, b) => a.family.localeCompare(b.family));
    LS.set("fonts", lib); return lib;
  },
  async removeFont(family) { const lib = LS.get<LibraryFont[]>("fonts", []).filter(x => x.family.toLowerCase() !== family.toLowerCase()); LS.set("fonts", lib); return lib; },
  fontUrl: file => file,
  uploadLogo: offlineOnly,
};
export const backend: Backend = SERVED ? helper : offline;
