/* Font spike: node subset_check.mjs <hb-subset.wasm> <font> [wght]
   Subsets a font to the glyphs of a sample text with HarfBuzz hb-subset (WASM); with [wght] a variable
   font is first pinned to that weight (static instance), so no viewer ever sees a variable font or Type 3. */
import fs from "node:fs";
const [wasmPath, fontPath, wght] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emscripten_notify_memory_growth() {} }, wasi_snapshot_preview1: { proc_exit() {}, fd_write() { return 0; }, fd_close() { return 0; }, fd_seek() { return 0; } } });
const e = instance.exports, heap = () => new Uint8Array(e.memory.buffer);
const font = fs.readFileSync(fontPath), t0 = performance.now();
const p = e.malloc(font.length); heap().set(font, p);
const blob = e.hb_blob_create(p, font.length, 2, 0, 0), face = e.hb_face_create(blob, 0);
const input = e.hb_subset_input_create_or_fail();
const uni = e.hb_subset_input_unicode_set(input);
for (const ch of "TOTAL BANKS LOANS 0123456789.,+-% Δ vs. Budget Week Abs. àèéìòù") e.hb_set_add(uni, ch.codePointAt(0));
const tag = s => (s.charCodeAt(0) << 24 | s.charCodeAt(1) << 16 | s.charCodeAt(2) << 8 | s.charCodeAt(3)) >>> 0;
if (wght) { e.hb_subset_input_pin_all_axes_to_default(input, face); const ok = e.hb_subset_input_pin_axis_location(input, face, tag("wght"), +wght); if (!ok) throw new Error("pin failed"); }
const sub = e.hb_subset_or_fail(face, input); if (!sub) throw new Error("subset failed");
const sb = e.hb_face_reference_blob(sub), lenP = e.malloc(4), dp = e.hb_blob_get_data(sb, lenP), len = new Uint32Array(e.memory.buffer, lenP, 1)[0];
const out = heap().slice(dp, dp + len);
const tables = []; const nt = (out[4] << 8) | out[5]; for (let i = 0; i < nt; i++) tables.push(String.fromCharCode(...out.slice(12 + 16 * i, 16 + 16 * i)));
console.log(JSON.stringify({ font: fontPath.split("/").pop(), in_KB: Math.round(font.length / 1024), out_KB: +(len / 1024).toFixed(1), ms: +(performance.now() - t0).toFixed(1),
  variable_tables_left: tables.filter(t => ["fvar", "gvar", "HVAR", "avar", "STAT"].includes(t)), outline: tables.includes("CFF ") ? "CFF" : tables.includes("glyf") ? "TrueType" : "?" }));
