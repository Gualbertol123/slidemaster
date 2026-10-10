/* Talking to the helper (docs/ARCHITECTURE.md §5). When the page is opened from disk (file://)
   an in-browser backend keeps documents in localStorage and exports are disabled. */
import { FORMATS, type ConfigDoc, type Op, type Prefs, type WorkbookDoc } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc } from "@slide-builder/core/model/ops";
import type { LibraryFont } from "@slide-builder/core/model/fonts";

export interface EngineRow { name: string; label: string; state: "ok" | "blocked" | "missing" | "untested"; detail: string }
export interface Engine { state: "ready" | "starting" | "idle" | "unavailable"; browser: string | null; local: boolean; error: string | null; engines: EngineRow[] }
export interface Health { app: string; version: string; user: string; host: string; folder: string; export: string; engine: Engine }
export interface FileInfo { name: string; mtime: number; size: number; rev?: number | null; updated?: number | null; updatedBy?: string | null }
export interface Other { user: string; host: string; client: string; workbook: string | null; at: number }
export interface OpsResult<D> { doc: D; applied: number; skipped: number[] }
export interface ExportReq { name: string; format: "pdf" | "png"; mode?: "exact" | "vector"; css: string; slides: string[]; names: string[]; scale: number; inline?: boolean; all?: boolean }
export interface ExportRes { ok: boolean; files?: string[]; images?: string[]; engine?: string; seconds?: number; error?: string }
export interface InstallState { running: boolean; done: boolean; ok: boolean | null; lines: string[] }

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
  presence(client: string, workbook: string | null): Promise<Other[]>;
  leave(client: string): void;
  upload(name: string, buf: ArrayBuffer): Promise<string>;
  convertWorkbook(name: string, buf: ArrayBuffer): Promise<ArrayBuffer>;
  convertPicture(bytes: Uint8Array, ext: string): Promise<string | null>;
  exportSlides(req: ExportReq): Promise<ExportRes>;
  assemble(name: string, images: string[]): Promise<ExportRes>;
  open(target: { name: string } | { folder: true }): Promise<void>;
  engineRestart(): Promise<void>;
  engineInstall(start: boolean): Promise<InstallState>;
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

async function req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("X-SB-Token", TOKEN);
  headers.set("X-SB-Formats", Object.entries(FORMATS).map(([k, v]) => k + "=" + v).join(";"));
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const r = await fetch(path, { ...init, headers, body, cache: "no-store" });
  if (!r.ok && r.status !== 204) {
    let msg = r.statusText || ("HTTP " + r.status);
    try { const j = await r.clone().json(); if (j && j.error) msg = j.error; } catch { /* not JSON */ }
    throw new ApiError(r.status, msg);
  }
  return r;
}
const json = async <T>(p: Promise<Response>): Promise<T> => (await p).json() as Promise<T>;
const blobToDataUrl = (b: Blob) => new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(b); });
const wbPath = (name: string) => "/api/workbooks/" + encodeURIComponent(name);

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
    const r = await req("/files/" + encodeURIComponent(name));
    return { buf: await r.arrayBuffer(), mtime: +(r.headers.get("X-SB-Mtime") || 0), size: +(r.headers.get("X-SB-Size") || 0) };
  },
  async getDoc(name, since) {
    const r = await req(wbPath(name) + "/doc" + (since !== undefined ? "?since=" + since : ""));
    if (r.status === 204) return null;
    return (await r.json()).doc as WorkbookDoc;
  },
  postOps: (name, ops, client) => json(req(wbPath(name) + "/ops", { method: "POST", json: { ops, client } })),
  async presence(client, workbook) { return (await json<{ others: Other[] }>(req("/api/presence", { method: "POST", json: { client, workbook } }))).others || []; },
  leave(client) {
    try { fetch("/api/presence/leave", { method: "POST", keepalive: true, headers: { "X-SB-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ client }) }); } catch { /* page closing */ }
  },
  async upload(name, buf) { return (await json<{ id: string }>(req("/api/upload?name=" + encodeURIComponent(name), { method: "POST", body: buf }))).id; },
  async convertWorkbook(name, buf) { return (await req("/api/convert-workbook?name=" + encodeURIComponent(name), { method: "POST", body: buf })).arrayBuffer(); },
  async convertPicture(bytes, ext) {
    try { const r = await req("/api/convert?ext=" + encodeURIComponent(ext), { method: "POST", body: bytes as unknown as BodyInit }); return await blobToDataUrl(await r.blob()); } catch { return null; }
  },
  async exportSlides(r) {
    const res = await fetch("/api/export", { method: "POST", cache: "no-store", headers: { "X-SB-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(r) });
    const j = await res.json().catch(() => ({ ok: false, error: "HTTP " + res.status }));
    if (!res.ok) throw new ApiError(res.status, j.error || "export failed");
    return j;
  },
  assemble: (name, images) => json(req("/api/assemble", { method: "POST", json: { name, images } })),
  async open(target) { await req("/api/open", { method: "POST", json: target }); },
  async engineRestart() { await req("/api/engine/restart", { method: "POST" }); },
  engineInstall: start => json(req("/api/engine/install", { method: start ? "POST" : "GET" })),
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
  set(k: string, v: unknown) { try { localStorage.setItem("sb3:" + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
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
    LS.set("doc:" + name, r.doc);
    return r;
  },
  async presence() { return []; },
  leave() { /* nothing */ },
  upload: offlineOnly, convertWorkbook: offlineOnly,
  async convertPicture() { return null; },
  exportSlides: offlineOnly, assemble: offlineOnly, open: offlineOnly,
  async engineRestart() { /* nothing */ },
  engineInstall: offlineOnly,
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
