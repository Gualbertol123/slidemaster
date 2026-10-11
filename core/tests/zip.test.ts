/* The zip reader (src/xlsx/zip.ts): a deflated part is inflated whatever size the central directory claims for it,
   as JSZip did – too small (stored and Huffman blocks), too large, or absurd. */
import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import { Zip } from "../src/xlsx/zip";

/** one deflated entry; `claimed`: the uncompressed size the headers state */
function zipOf(body: Uint8Array, level: 0 | 6, claimed: number): ArrayBuffer {
  const name = new TextEncoder().encode("xl/part.xml"), raw = deflateSync(body, { level });
  const h = new DataView(new ArrayBuffer(30));
  h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true);
  h.setUint32(18, raw.length, true); h.setUint32(22, claimed >>> 0, true); h.setUint16(26, name.length, true);
  const c = new DataView(new ArrayBuffer(46));
  c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, 8, true);
  c.setUint32(20, raw.length, true); c.setUint32(24, claimed >>> 0, true); c.setUint16(28, name.length, true); c.setUint32(42, 0, true);
  const local = 30 + name.length + raw.length, e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, 46 + name.length, true); e.setUint32(16, local, true);
  const parts = [new Uint8Array(h.buffer), name, raw, new Uint8Array(c.buffer), name, new Uint8Array(e.buffer)];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; }
  return out.buffer;
}
const body = new TextEncoder().encode("<sheet>" + "<row><c>1234.5</c></row>".repeat(2000) + "</sheet>");
const read = (buf: ArrayBuffer) => { const z = new Zip(new Uint8Array(buf)); return new TextDecoder().decode(z.bytes(z.entries[0])); };
const text = new TextDecoder().decode(body);

describe("zip bytes", () => {
  for (const level of [0, 6] as const) {
    const kind = level ? "Huffman blocks" : "stored blocks";
    it(`the right size (${kind})`, () => expect(read(zipOf(body, level, body.length))).toBe(text));
    it(`a size smaller than the data (${kind})`, () => expect(read(zipOf(body, level, 100))).toBe(text));
    it(`a size larger than the data (${kind})`, () => expect(read(zipOf(body, level, body.length + 500))).toBe(text));
    it(`an absurd size, not allocated (${kind})`, () => expect(read(zipOf(body, level, 0xFFFFFFF0))).toBe(text));
  }
});
