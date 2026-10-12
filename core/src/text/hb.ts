/* HarfBuzz in the core (ADR-005): hb.wasm shapes text, hb-subset.wasm subsets fonts for the PDF and instances
   variable fonts. Both come from harfbuzzjs@0.4.12 (MIT), pinned and inlined (zlib + base64) (./wasm/*.ts, written by
   tools/vendor-harfbuzz.mjs and checked against node_modules by core/tests/shape.test.ts), so they work from
   file:// and in workers without fetching anything. The emscripten glue (hb.js) is not used: the modules are
   instantiated directly with the few imports they declare. Each loader lives next to its only user (shape.ts,
   subset.ts), so a bundle carries only the module it uses. */

import { unzlibSync } from "fflate";

export interface HbExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number; free(p: number): void;
  [fn: string]: unknown;
}
type Fn = (...a: number[]) => number;

/** the module bytes from their inlined form: base64 of a zlib stream */
export function decode64(s: string): Uint8Array {
  const bin = atob(s), z = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
  return unzlibSync(z);
}

/** instantiate an emscripten module with stub imports: memory growth, no timers, no files, abort = throw */
export async function instantiate(bytes: Uint8Array): Promise<HbExports> {
  const mod = await WebAssembly.compile(bytes as BufferSource);
  let exp: HbExports | null = null;
  const stubs: Record<string, Record<string, unknown>> = {};
  for (const imp of WebAssembly.Module.imports(mod)) {
    const ns = (stubs[imp.module] ||= {});
    if (imp.kind !== "function") continue;
    const name = imp.name;
    ns[name] =
      name === "emscripten_resize_heap" ? (size: number) => {
        const mem = exp!.memory, old = mem.buffer.byteLength, want = Math.max(size >>> 0, old * 1.25);
        try { mem.grow(Math.ceil((want - old) / 65536)); return 1; } catch { return 0; }
      }
      : name === "emscripten_notify_memory_growth" || name === "_emscripten_runtime_keepalive_clear" || name === "_setitimer_js" ? () => 0
      : name === "fd_write" || name === "fd_close" || name === "fd_seek" ? () => 0
      : () => { throw new Error(`HarfBuzz called ${imp.module}.${name}`); };
  }
  const inst = await WebAssembly.instantiate(mod, stubs as WebAssembly.Imports);
  exp = inst.exports as unknown as HbExports;
  // a reactor module (hb-subset.wasm) exports _initialize, a command one (hb.wasm) __wasm_call_ctors: run its
  // static initialisers once
  const x = exp as Record<string, unknown>, init = (x._initialize ?? x.__wasm_call_ctors) as (() => void) | undefined;
  if (init) init();
  return exp;
}

/** a loaded module with helpers over its memory */
export class Hb {
  constructor(readonly e: HbExports) {}
  fn(name: string): Fn { const f = this.e[name]; if (typeof f !== "function") throw new Error(`HarfBuzz has no ${name}`); return f as Fn; }
  get u8() { return new Uint8Array(this.e.memory.buffer); }
  get u32() { return new Uint32Array(this.e.memory.buffer); }
  get i32() { return new Int32Array(this.e.memory.buffer); }
  /** copy bytes into the module (freed by the blob that takes them) */
  copyIn(d: Uint8Array): number { const p = this.e.malloc(d.length); this.u8.set(d, p); return p; }
  /** a blob over a copy of the bytes, destroyed with free() of the copy */
  blob(d: Uint8Array): { ptr: number; done(): void } {
    const p = this.copyIn(d), b = this.fn("hb_blob_create")(p, d.length, 2 /* writable */, 0, 0);
    return { ptr: b, done: () => { this.fn("hb_blob_destroy")(b); this.e.free(p); } };
  }
  /** the bytes of a blob (copied out) */
  blobBytes(blob: number): Uint8Array {
    const lenP = this.e.malloc(4), data = this.fn("hb_blob_get_data")(blob, lenP), len = this.u32[lenP >> 2];
    this.e.free(lenP);
    return this.u8.slice(data, data + len);
  }
}

export const hbTag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
