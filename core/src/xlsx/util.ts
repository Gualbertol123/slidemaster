/* Small helpers shared by the workbook reader and the renderers. */
import type JSZip from "jszip";
import { platform, type XmlDocument, type XmlElement } from "../platform";
import { coreXml } from "./xml";

export interface Range { r1: number; c1: number; r2: number; c2: number }

export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** styles, theme, rels, workbook and drawings: the core's own tokenizer (xml.ts), unless the host installed
    another parser (the equivalence test runs DOMParser through the same readers) */
export const parseXml = (s: string): XmlDocument => (platform().xml || coreXml).parse(s);
export const kids = (el: XmlElement | XmlDocument | null | undefined, n: string): XmlElement[] =>
  Array.from(el ? el.children : []).filter(x => x.localName === n);
export const kid = (el: XmlElement | XmlDocument | null | undefined, n: string): XmlElement | null => kids(el, n)[0] || null;
export const all = (el: XmlElement | XmlDocument | null | undefined, n: string): XmlElement[] =>
  el ? Array.from(el.getElementsByTagNameNS("*", n)) : [];

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, c => ESC[c]);

export const colToNum = (s: string): number => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
export const numToCol = (n: number): string => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const splitRef = (ref: string): { r: number; c: number } | null => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  return m ? { c: colToNum(m[1]), r: +m[2] } : null;
};
export const parseRange = (rg: string): Range => {
  const [a, b] = rg.split(":");
  const s = splitRef(a), e = splitRef(b || a);
  if (!s || !e) return { r1: 0, c1: 0, r2: -1, c2: -1 };
  return { r1: s.r, c1: s.c, r2: e.r, c2: e.c };
};
export const inRange = (g: Range, r: number, c: number) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
export const A1 = (r: number, c: number) => numToCol(c) + r;

export function resolvePath(base: string, target: string): string {
  target = String(target || "").replace(/\\/g, "/");
  if (/^[a-z]+:/i.test(target)) return target;
  if (target.startsWith("/")) return target.slice(1);
  const p = base.split("/"); p.pop();
  for (const x of target.split("/")) { if (x === "..") p.pop(); else if (x !== "." && x !== "") p.push(x); }
  return p.join("/");
}
export function relsPath(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "_rels/" + p + ".rels" : p.slice(0, i) + "/_rels/" + p.slice(i + 1) + ".rels";
}

type ZipWithIndex = JSZip & { __idx?: Map<string, JSZip.JSZipObject> };
/** zip lookups tolerate different letter case and %-encoded names (some tools write them that way) */
export function zget(zip: JSZip, path: string | null | undefined): JSZip.JSZipObject | null {
  if (!path) return null;
  const f = zip.file(path); if (f) return f;
  const z = zip as ZipWithIndex;
  if (!z.__idx) { const m = new Map<string, JSZip.JSZipObject>(); zip.forEach((p, e) => { if (!e.dir) m.set(p.toLowerCase(), e); }); z.__idx = m; }
  let dec = path; try { dec = decodeURIComponent(path); } catch { /* keep */ }
  return zip.file(dec) || z.__idx.get(dec.toLowerCase()) || z.__idx.get(path.toLowerCase()) || null;
}

export interface Rel { target: string; type: string; external: boolean }
export async function readRels(zip: JSZip, part: string): Promise<Record<string, Rel>> {
  const f = zget(zip, relsPath(part)); const map: Record<string, Rel> = {};
  if (!f) return map;
  const x = parseXml(await f.async("string"));
  for (const r of all(x, "Relationship"))
    map[r.getAttribute("Id") || ""] = { target: resolvePath(part, r.getAttribute("Target") || ""), type: r.getAttribute("Type") || "", external: r.getAttribute("TargetMode") === "External" };
  return map;
}

export class WorkbookError extends Error {
  constructor(public code: "CFB" | "XLSB" | "NOTZIP" | "NOTXLSX", msg: string) { super(msg); }
}

export const fmtMB = (b: number) => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
export const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));
export const median = (a: number[]) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
/** FNV-1a over a string – used as a content key (not for security) */
export function hashStr(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}
export const uid = () => Math.random().toString(36).slice(2, 9);
