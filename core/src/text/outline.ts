/* Glyph outlines from HarfBuzz (S4.4, 03 §2.6 step 3): the screen draws a font's text as outlines where the browser's
   own text would not match the PDF (the per-font check, 05 §3.4). hb_font_draw_glyph calls back into JavaScript
   through function pointers: each callback becomes a tiny WebAssembly function (a module that imports it and exports
   it with the C signature) placed in hb.wasm's function table – what emscripten's addFunction does, without its glue. */
import type { Hb } from "./hb";

const TYPE: Record<string, number> = { i: 0x7f, j: 0x7e, f: 0x7d, d: 0x7c };
/** a JavaScript function as a WebAssembly function of signature `sig` ("v" or a result type, then the parameters) */
function wasmFunction(fn: (...a: number[]) => void, sig: string): WebAssembly.ExportValue {
  const params = sig.slice(1).split("").map(c => TYPE[c]), result = sig[0] === "v" ? [0] : [1, TYPE[sig[0]]];
  const type = [0x01, 0x60, params.length, ...params, ...result];
  const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, type.length, ...type,                                    // the type section
    0x02, 0x07, 0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,          // import "e" "f": a function of type 0
    0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00]);                    // export it as "f"
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: fn } }).exports.f;
}

/** draws glyphs into SVG path data (font units, y up) */
export class Outliner {
  private funcs = 0;
  private d: string[] = [];
  constructor(private readonly hb: Hb) {}
  private setup() {
    if (this.funcs) return this.funcs;
    const hb = this.hb, table = hb.e.__indirect_function_table as WebAssembly.Table;
    const add = (fn: (...a: number[]) => void, sig: string) => { const i = table.length; table.grow(1); table.set(i, wasmFunction(fn, sig) as never); return i; };
    const n = (v: number) => Math.round(v * 100) / 100;
    const f = hb.fn("hb_draw_funcs_create")();
    // (funcs, draw data, state, coordinates…, user data)
    hb.fn("hb_draw_funcs_set_move_to_func")(f, add((_f, _d, _s, x, y) => { this.d.push(`M${n(x)} ${n(y)}`); }, "viiiffi"), 0, 0);
    hb.fn("hb_draw_funcs_set_line_to_func")(f, add((_f, _d, _s, x, y) => { this.d.push(`L${n(x)} ${n(y)}`); }, "viiiffi"), 0, 0);
    hb.fn("hb_draw_funcs_set_quadratic_to_func")(f, add((_f, _d, _s, cx, cy, x, y) => { this.d.push(`Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`); }, "viiiffffi"), 0, 0);
    hb.fn("hb_draw_funcs_set_cubic_to_func")(f, add((_f, _d, _s, c1x, c1y, c2x, c2y, x, y) => { this.d.push(`C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`); }, "viiiffffffi"), 0, 0);
    hb.fn("hb_draw_funcs_set_close_path_func")(f, add(() => { this.d.push("Z"); }, "viiii"), 0, 0);
    return this.funcs = f;
  }
  /** a glyph's outline as SVG path data in font units (y up); "" for a glyph without one (a space) */
  glyph(font: number, gid: number): string {
    const f = this.setup();
    this.d = [];
    this.hb.fn("hb_font_draw_glyph")(font, gid, f, 0);
    return this.d.join("");
  }
}
