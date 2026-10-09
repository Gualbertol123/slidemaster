/* Parser spike: node parse_bench.mjs <big30.xlsx> [sheet path]
   1. unzip one sheet (JSZip, as today) vs fflate (proposed, sync, runs in a Worker)
   2. today's regex parser loop (app/src/xlsx/workbook.ts readSheet, cells → Map<string, Cell>)
   3. proposed: a single pass over the bytes into COLUMNAR typed arrays (no per-cell objects)
   4. the shared parsed-sheet cache: size on the share and load time (deflated columns) */
import fs from "node:fs";
import JSZip from "../../node_modules/jszip/lib/index.js";
import { unzipSync, inflateSync, deflateSync, strFromU8 } from "fflate";
const file = process.argv[2], part = process.argv[3] || "xl/worksheets/sheet3.xml";
const buf = fs.readFileSync(file), res = {};
const T = () => performance.now(), mem = () => Math.round(process.memoryUsage().heapUsed / 1e6);

// 1. unzip
let t = T(); const zip = await JSZip.loadAsync(buf); const xml = await zip.file(part).async("string"); res.jszip_inflate_ms = Math.round(T() - t);
t = T(); const files = unzipSync(new Uint8Array(buf), { filter: f => f.name === part }); const bytes = files[part]; res.fflate_inflate_ms = Math.round(T() - t);
res.sheet_xml_MB = +(bytes.length / 1e6).toFixed(1);

// 2. today's loop (same regexes; xf lookup and SST omitted = a lower bound of today's cost)
global.gc?.(); let m0 = mem(); t = T();
{
  const xattrs = s => { const o = {}, re = /([\w:]+)="([^"]*)"/g; let m; while ((m = re.exec(s))) o[m[1]] = m[2]; return o; };
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g, cRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, vRe = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/;
  const cells = new Map(); let m, lastRow = 0;
  const data = xml.slice(xml.search(/<sheetData\b/), xml.search(/<\/sheetData>/));
  while ((m = rowRe.exec(data))) {
    const ra = xattrs(m[1]), r = ra.r ? +ra.r : lastRow + 1; lastRow = r;
    if (m[2]) { let c, lastCol = 0; cRe.lastIndex = 0;
      while ((c = cRe.exec(m[2]))) { const a = xattrs(c[1]); const col = a.r ? a.r.replace(/\d+/g, "").split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) : lastCol + 1; lastCol = col;
        const vm = c[2] ? vRe.exec(c[2]) : null; cells.set(r + "," + col, { r, c: col, v: vm ? (a.t === "s" ? +vm[1] : +vm[1]) : null, t: a.t || "n", xf: null, fmt: null }); } }
  }
  res.today_regex_parse_ms = Math.round(T() - t); res.today_cells = cells.size; global.gc?.(); res.today_heap_MB_for_cells = mem() - m0;
  globalThis.__keep = cells;
}
globalThis.__keep = null; global.gc?.();

// 3. proposed: byte scanner → columnar arrays
m0 = mem(); t = T();
const cap = 2_000_000, R = new Int32Array(cap), C = new Int16Array(cap), K = new Uint8Array(cap), N = new Float64Array(cap), X = new Uint16Array(cap);
let n = 0;
{
  const b = bytes, L = b.length; let i = 0, row = 0;
  const num = (s, e) => { let str = ""; for (let k = s; k < e; k++) str += String.fromCharCode(b[k]); return +str; };
  while (i < L) {
    if (b[i] !== 60) { i++; continue; }                 // '<'
    if (b[i + 1] === 114 && b[i + 2] === 111 && b[i + 3] === 119 && (b[i + 4] === 32 || b[i + 4] === 62)) {  // <row
      let j = i + 4; while (b[j] !== 62) { if (b[j] === 32 && b[j + 1] === 114 && b[j + 2] === 61) { let k = j + 4, v = 0; while (b[k] !== 34) v = v * 10 + b[k++] - 48; row = v; } j++; } i = j; continue;
    }
    if (b[i + 1] === 99 && (b[i + 2] === 32 || b[i + 2] === 62)) {   // <c
      let j = i + 2, col = 0, kind = 0, xf = 0;
      while (b[j] !== 62) {
        if (b[j] === 32 && b[j + 2] === 61) {
          const a = b[j + 1]; let k = j + 4;
          if (a === 114) { while (b[k] >= 65) col = col * 26 + b[k++] - 64; }            // r="AB12"
          else if (a === 116) kind = b[k] === 115 ? 1 : b[k] === 98 ? 2 : b[k] === 101 ? 3 : 4;  // t="s|b|e|str"
          else if (a === 115) { let v = 0; while (b[k] !== 34) v = v * 10 + b[k++] - 48; xf = v; }
          while (b[k] !== 34) k++; j = k;
        }
        j++;
      }
      let v = NaN;
      if (b[j - 1] !== 47) {                                       // not <c/>: find <v>…</v>
        let k = j; while (!(b[k] === 60 && (b[k + 1] === 118 || b[k + 1] === 47))) k++;
        if (b[k + 1] === 118) { const s = k + 3; let e = s; while (b[e] !== 60) e++; v = num(s, e); j = e; }
      }
      R[n] = row; C[n] = col; K[n] = kind; N[n] = v; X[n] = xf; n++; i = j; continue;
    }
    i++;
  }
}
res.columnar_parse_ms = Math.round(T() - t); res.columnar_cells = n; res.columnar_MB = +((n * (4 + 2 + 1 + 8 + 2)) / 1e6).toFixed(1);

// 4. shared cache: deflated columns (written once by the first opener, read by everybody else)
t = T();
const cols = [R.subarray(0, n), C.subarray(0, n), K.subarray(0, n), N.subarray(0, n), X.subarray(0, n)].map(a => deflateSync(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), { level: 1 }));
res.cache_write_ms = Math.round(T() - t); res.cache_MB = +(cols.reduce((s, c) => s + c.length, 0) / 1e6).toFixed(1);
t = T(); for (const c of cols) inflateSync(c); res.cache_load_ms = Math.round(T() - t);
res.xlsx_file_MB = +(buf.length / 1e6).toFixed(1);
console.log(JSON.stringify(res, null, 1));
