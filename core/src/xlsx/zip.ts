/* Reading .xlsx containers with fflate (PLAN S2.3; JSZip before): the central directory is read once, parts
   are inflated on demand, in one call (the core worker reads them since S2.4; the sliced inflate that kept the
   page's thread responsive was removed in S2.6). Stored and deflated entries; Zip64 sizes and offsets. */
import { inflateSync } from "fflate";

export class ZipEntry {
  constructor(private readonly zip: Zip,
    /** the name as stored (UTF-8, or CP437 without the UTF-8 flag) */
    readonly name: string, readonly dir: boolean,
    /** uncompressed size */
    readonly size: number, readonly csize: number, readonly method: number, readonly offset: number) {}
  /** the content, as JSZip's file.async gave it (inflated synchronously) */
  async(kind: "string"): Promise<string>;
  async(kind: "base64"): Promise<string>;
  async(kind: "uint8array"): Promise<Uint8Array>;
  async(kind: "string" | "base64" | "uint8array"): Promise<string | Uint8Array> {
    return Promise.resolve(kind === "string" ? this.zip.text(this) : kind === "base64" ? this.zip.base64(this) : this.zip.bytes(this));
  }
}
export class ZipError extends Error {}

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000;
const u64 = (b: Uint8Array, p: number) => u32(b, p) + u32(b, p + 4) * 0x100000000;
/* names without the UTF-8 flag are read as UTF-8 too, and a Unicode Path field (0x7075) wins – as JSZip did */
const CP437_UNUSED = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const utf8 = new TextDecoder("utf-8");
void CP437_UNUSED;

export class Zip {
  readonly entries: ZipEntry[] = [];
  private readonly byName = new Map<string, ZipEntry>();
  /** lower-case name → entry (zget: other letter case, %-encoded names) */
  lower: Map<string, ZipEntry> | null = null;
  constructor(private readonly buf: Uint8Array) {
    const b = buf;
    let e = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 65535); p--)
      if (b[p] === 0x50 && b[p + 1] === 0x4B && b[p + 2] === 5 && b[p + 3] === 6) { e = p; break; }
    if (e < 0) throw new ZipError("End of central directory not found: is this a zip file?");
    let count = u16(b, e + 10), cdOff = u32(b, e + 16);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) {                       // Zip64 end of central directory
      const loc = e - 20;
      if (loc >= 0 && u32(b, loc) === 0x07064B50) {
        const z = u64(b, loc + 8);
        if (u32(b, z) === 0x06064B50) { count = u64(b, z + 32); cdOff = u64(b, z + 48); }
      }
    }
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014B50) throw new ZipError("Corrupted zip: the central directory is damaged.");
      const flags = u16(b, p + 8), method = u16(b, p + 10);
      let csize = u32(b, p + 20), size = u32(b, p + 24);
      const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
      let offset = u32(b, p + 42);
      const nb = b.subarray(p + 46, p + 46 + nlen);
      let name = utf8.decode(nb); void flags;
      for (let x = p + 46 + nlen, xe = x + xlen; x + 4 <= xe;) {          // Zip64 extra field: the 0xFFFFFFFF fields, in order
        const id = u16(b, x), len = u16(b, x + 2);
        if (id === 0x7075 && len > 5) name = utf8.decode(b.subarray(x + 9, x + 4 + len));
        if (id === 1) {
          let q = x + 4;
          if (size === 0xFFFFFFFF) { size = u64(b, q); q += 8; }
          if (csize === 0xFFFFFFFF) { csize = u64(b, q); q += 8; }
          if (offset === 0xFFFFFFFF) offset = u64(b, q);
        }
        x += 4 + len;
      }
      const ent = new ZipEntry(this, name, name.endsWith("/"), size, csize, method, offset);
      this.entries.push(ent);
      this.byName.set(name, ent);                                  // a duplicated name: the last entry (as JSZip)
      p += 46 + nlen + xlen + clen;
    }
  }
  file(name: string): ZipEntry | null { const f = this.byName.get(name); return f && !f.dir ? f : null; }
  forEach(fn: (name: string, e: ZipEntry) => void) { for (const e of this.entries) fn(e.name, e); }
  private raw(e: ZipEntry): Uint8Array {
    const b = this.buf, p = e.offset;
    if (u32(b, p) !== 0x04034B50) throw new ZipError(`Corrupted zip: "${e.name}" cannot be read.`);
    const start = p + 30 + u16(b, p + 26) + u16(b, p + 28);
    return b.subarray(start, start + e.csize);
  }
  /** the entry's bytes (a copy for stored entries); a wrong size in the directory is tolerated (as JSZip did) */
  bytes(e: ZipEntry): Uint8Array {
    const raw = this.raw(e);
    if (e.method === 0) return raw.slice();
    if (e.method !== 8) throw new ZipError(`"${e.name}" uses an unsupported compression (${e.method}).`);
    // straight into a buffer one byte larger than the directory's size (the streaming inflater's chunks cost a
    // big30 sheet 150–300 ms more in the worker, PLAN S2.6): a filled extra byte means more data than the directory says
    // stored blocks throw when the buffer is too small, and a size far beyond deflate's ratio is not believed (JSZip
    // ignored the directory's sizes): both inflate without a size
    if (e.size > raw.length * 1100 + 1024) return inflateSync(raw);
    try {
      const out = inflateSync(raw, { out: new Uint8Array(e.size + 1) });
      return out.length <= e.size ? out : inflateSync(raw);
    } catch (err) { if (err instanceof RangeError) return inflateSync(raw); throw err; }
  }
  text(e: ZipEntry): string { return utf8.decode(this.bytes(e)); }
  base64(e: ZipEntry): string { return base64(this.bytes(e)); }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64(b: Uint8Array): string {
  const parts: string[] = []; let s = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    if (s.length >= 8192) { parts.push(s); s = ""; }
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  parts.push(s);
  return parts.join("");
}
