/* Text inside sheet XML as v3 read it (regular expressions over strings): entities and _xHHHH_ escapes,
   attributes, shared strings with their superscript / subscript runs. */
import type { Script } from "./types";

const XENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export function xdec(s: string): string {
  if (s.indexOf("&") < 0 && s.indexOf("_x") < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (XENT[e] ?? m))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}
export function xattrs(s: string): Record<string, string> {
  const o: Record<string, string> = {}; const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) o[m[1].replace(/^[A-Za-z0-9]+:(?=[A-Za-z])/, "")] = xdec(m[2]);
  return o;
}
export function parseSST(xml: string): string[] { return parseSSTRich(xml).sst; }
/** the text of a string item plus its superscript / subscript runs (rich text: <r><rPr><vertAlign …/></rPr><t>…</t></r>) */
export function richRuns(inner: string): { text: string; scr?: Script[] } {
  if (inner.indexOf("rPh") >= 0) inner = inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  const tr = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
  if (inner.indexOf("vertAlign") < 0) { let txt = "", t: RegExpExecArray | null; while ((t = tr.exec(inner))) txt += t[1]; return { text: xdec(txt) }; }
  let text = ""; const scr: Script[] = [], rr = /<(?:\w+:)?r(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?r>/g; let r: RegExpExecArray | null;
  while ((r = rr.exec(inner))) {
    let part = "", t: RegExpExecArray | null; tr.lastIndex = 0; while ((t = tr.exec(r[1]))) part += t[1];
    part = xdec(part);
    const va = /<(?:\w+:)?vertAlign\s+val="(superscript|subscript)"/.exec(r[1]);
    if (va && part) scr.push([text.length, text.length + part.length, va[1] === "superscript" ? "sup" : "sub"]);
    text += part;
  }
  if (!text) { let txt = "", t: RegExpExecArray | null; tr.lastIndex = 0; while ((t = tr.exec(inner))) txt += t[1]; text = xdec(txt); }
  return scr.length ? { text, scr } : { text };
}
export function parseSSTRich(xml: string): { sst: string[]; runs: (Script[] | undefined)[] } {
  const sst: string[] = [], runs: (Script[] | undefined)[] = [], re = /<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) { const x = richRuns(m[1] || ""); sst.push(x.text); runs.push(x.scr); }
  return { sst, runs };
}
