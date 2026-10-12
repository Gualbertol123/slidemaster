/* SHA-1 of bytes, synchronous (font ids are content hashes, as the helper names library files: hashlib.sha1). */
export function sha1(d: Uint8Array): string {
  const len = d.length, words = ((len + 8) >> 6) + 1, w = new Uint32Array(words * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= d[i] << (24 - 8 * (i & 3));
  w[len >> 2] |= 0x80 << (24 - 8 * (len & 3));
  w[words * 16 - 1] = (len * 8) >>> 0;
  w[words * 16 - 2] = Math.floor(len / 0x20000000);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const x = new Uint32Array(80);
  for (let b = 0; b < words * 16; b += 16) {
    for (let t = 0; t < 16; t++) x[t] = w[b + t];
    for (let t = 16; t < 80; t++) { const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (v << 1) | (v >>> 31); }
    let a = h0, bb = h1, c = h2, dd = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & dd) : t < 40 ? bb ^ c ^ dd : t < 60 ? (bb & c) | (bb & dd) | (c & dd) : bb ^ c ^ dd;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + x[t]) >>> 0;
      e = dd; dd = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + dd) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(v => v.toString(16).padStart(8, "0")).join("");
}
