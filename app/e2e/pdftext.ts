/* The text of a PDF the native export wrote (core/src/pdf/writer.ts: numbered objects, no object streams, Flate
   streams, Type0 fonts with a ToUnicode map), page by page – enough for the e2e tests to see what an export holds
   (EX-15: an edit made just before the export is in it). Not a general PDF reader: tools/pdfcheck.py is. */
import { inflateSync } from "node:zlib";

interface Obj { dict: string; stream: Buffer | null }

function objects(pdf: Buffer): Map<number, Obj> {
  const s = pdf.toString("latin1"), out = new Map<number, Obj>();
  const re = /(\d+) 0 obj\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const at = m.index + m[0].length, end = s.indexOf("endobj", at), body = s.slice(at, end);
    const k = body.indexOf("stream");
    if (k >= 0 && /^<<[\s\S]*>>\s*$/.test(body.slice(0, k))) {
      const dict = body.slice(0, k), len = +(/\/Length (\d+)/.exec(dict)?.[1] || 0);
      const from = at + k + "stream".length + (s[at + k + 6] === "\r" ? 2 : 1);
      const raw = pdf.subarray(from, from + len);
      out.set(+m[1], { dict, stream: /\/FlateDecode/.test(dict) && !/\/DecodeParms/.test(dict) && !/\/Subtype\s*\/Image/.test(dict) ? inflateSync(raw) : raw });
    } else out.set(+m[1], { dict: body, stream: null });
    re.lastIndex = end;
  }
  return out;
}
/** glyph id (hex) → text, from a ToUnicode CMap */
function cmap(src: string): Map<string, string> {
  const map = new Map<string, string>(), u = (h: string) => String.fromCharCode(...(h.match(/.{4}/g) || []).map(x => parseInt(x, 16)));
  for (const b of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(p[1].toLowerCase().padStart(4, "0"), u(p[2]));
  for (const b of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), first = parseInt(p[3], 16);
      for (let g = lo; g <= hi; g++) map.set(g.toString(16).padStart(4, "0"), String.fromCharCode(first + g - lo));
    }
  return map;
}

/** each page's text (runs in drawing order, a space between runs); decorative copies (/Artifact) left out */
export function pdfPageTexts(pdf: Buffer): string[] {
  const objs = objects(pdf), ref = (d: string, key: string) => +(new RegExp("/" + key + "\\s*(\\d+) 0 R").exec(d)?.[1] || 0);
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const maps = new Map<number, Map<string, string>>();
  const fontMap = (id: number) => {
    let m = maps.get(id);
    if (!m) { const tu = ref(objs.get(id)!.dict, "ToUnicode"); m = tu ? cmap(objs.get(tu)!.stream!.toString("latin1")) : new Map(); maps.set(id, m); }
    return m;
  };
  const dictOf = (d: string, key: string) => {
    const at = d.search(new RegExp("/" + key + "\\s*<<")); if (at < 0) return new Map<string, number>();
    const body = /<<([^>]*)>>/.exec(d.slice(at))?.[1] || "";
    return new Map([...body.matchAll(/\/(\w+)\s*(\d+) 0 R/g)].map(m => [m[1], +m[2]]));
  };
  const resourcesOf = (d: string) => { const r = /\/Resources\s*(\d+) 0 R/.exec(d); return r ? objs.get(+r[1])!.dict : d; };
  /** the runs of a content stream and of the forms it draws (transparency groups), in drawing order */
  const walk = (content: string, res: string, runs: string[], marks: string[]) => {
    const fonts = dictOf(res, "Font"), xobjects = dictOf(res, "XObject");
    let font = new Map<string, string>();
    const show = (hex: string) => (hex.match(/.{4}/g) || []).map(g => font.get(g.toLowerCase()) ?? "").join("");
    for (const t of content.matchAll(/\/Artifact BMC|BDC|EMC|\/(\w+) [\d.]+ Tf|\/(\w+) Do|<([0-9a-fA-F]*)> Tj|\[((?:\s*(?:<[0-9a-fA-F]*>|-?[\d.]+))*)\s*\] TJ/g)) {
      if (t[0] === "/Artifact BMC") { marks.push("artifact"); continue; }
      if (t[0] === "BDC") { marks.push("span"); continue; }
      if (t[0] === "EMC") { marks.pop(); continue; }
      if (t[1]) { font = fontMap(fonts.get(t[1]) || 0); continue; }
      if (t[2]) {
        const x = objs.get(xobjects.get(t[2]) || 0);
        if (x && /\/Subtype\s*\/Form/.test(x.dict) && x.stream) walk(x.stream.toString("latin1"), resourcesOf(x.dict), runs, marks);
        continue;
      }
      if (marks.includes("artifact")) continue;
      const text = t[3] !== undefined ? show(t[3]) : [...t[4].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => show(x[1])).join("");
      if (text) runs.push(text);
    }
  };
  return pages.map(([, p]) => {
    const runs: string[] = [];
    walk(objs.get(ref(p.dict, "Contents"))!.stream!.toString("latin1"), resourcesOf(p.dict), runs, []);
    return runs.join(" ");
  });
}

/** each page's text runs with where they start (slide px: the run's origin on its baseline), decorative copies left
    out – the page's own content stream (q / Q, cm, Tm; forms are not entered). B51: where the moved parts are drawn */
export function pdfPageRuns(pdf: Buffer): { text: string; x: number; y: number }[][] {
  const objs = objects(pdf), ref = (d: string, key: string) => +(new RegExp("/" + key + "\\s*(\\d+) 0 R").exec(d)?.[1] || 0);
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const resourcesOf = (d: string) => { const r = /\/Resources\s*(\d+) 0 R/.exec(d); return r ? objs.get(+r[1])!.dict : d; };
  const fontsOf = (res: string) => { const at = res.search(/\/Font\s*<</); const body = at < 0 ? "" : /<<([^>]*)>>/.exec(res.slice(at))?.[1] || ""; return new Map([...body.matchAll(/\/(\w+)\s*(\d+) 0 R/g)].map(m => [m[1], +m[2]])); };
  const maps = new Map<number, Map<string, string>>();
  const fontMap = (id: number) => { let m = maps.get(id); if (!m) { const tu = ref(objs.get(id)!.dict, "ToUnicode"); m = tu ? cmap(objs.get(tu)!.stream!.toString("latin1")) : new Map(); maps.set(id, m); } return m; };
  type M6 = [number, number, number, number, number, number];
  const mul = (m: M6, c: M6): M6 => [m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3], m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3], m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5]];
  return pages.map(([, p]) => {
    const media = /\/MediaBox\s*\[\s*([\d.\s-]+)\]/.exec(p.dict)![1].trim().split(/\s+/).map(Number), k = media[2] / 1600, H = media[3];
    const fonts = fontsOf(resourcesOf(p.dict)), out: { text: string; x: number; y: number }[] = [], stack: M6[] = [];
    let ctm: M6 = [1, 0, 0, 1, 0, 0], at: [number, number] = [0, 0], font = new Map<string, string>(), art = 0;
    const show = (hex: string) => (hex.match(/.{4}/g) || []).map(g => font.get(g.toLowerCase()) ?? "").join("");
    const content = objs.get(ref(p.dict, "Contents"))!.stream!.toString("latin1");
    const re = /\/Artifact BMC|BDC|EMC|\/(\w+) [\d.]+ Tf|<([0-9a-fA-F]*)> Tj|\[((?:\s*(?:<[0-9a-fA-F]*>|-?[\d.]+))*)\s*\] TJ|((?:-?[\d.]+\s+){6})(cm|Tm)\b|(?<![\w/.])(q|Q)(?![\w])/g;
    for (const t of content.matchAll(re)) {
      if (t[0] === "/Artifact BMC") { art++; continue; }
      if (t[0] === "BDC") { continue; }
      if (t[0] === "EMC") { if (art) art--; continue; }
      if (t[1]) { font = fontMap(fonts.get(t[1]) || 0); continue; }
      if (t[6] === "q") { stack.push(ctm); continue; }
      if (t[6] === "Q") { ctm = stack.pop() ?? ctm; continue; }
      if (t[4]) {
        const m = t[4].trim().split(/\s+/).map(Number) as M6;
        if (t[5] === "cm") ctm = mul(m, ctm);
        else at = [m[4] * ctm[0] + m[5] * ctm[2] + ctm[4], m[4] * ctm[1] + m[5] * ctm[3] + ctm[5]];
        continue;
      }
      if (art) continue;
      const text = t[2] !== undefined ? show(t[2]) : [...(t[3] || "").matchAll(/<([0-9a-fA-F]*)>/g)].map(x => show(x[1])).join("");
      if (text) out.push({ text, x: at[0] / k, y: (H - at[1]) / k });
    }
    return out;
  });
}
