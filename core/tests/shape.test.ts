/* Fonts and text shaping (S3.2): HarfBuzz from the inlined WASM, the font registry, shape / breakLines / fitText,
   hb-subset for the PDF, static instances of variable fonts. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// compiling the WASM modules takes seconds on a loaded machine (CI runners, parallel runs): more than the default 5 s
vi.setConfig({ testTimeout: 30_000 });
import { writePdf } from "../src/pdf/writer";
import { FontRegistry, buildSfnt, sfntFaces } from "../src/text/fonts";
import { sha1 } from "../src/text/sha1";
import { decode64 } from "../src/text/hb";
import { shaper } from "../src/text/shape";
import { hbSubsetter, instanceFont, isVariable, pdfSubsetter, sfntTables, subsetFont } from "../src/text/subset";
import { HB_WASM, HB_WASM_SHA256 } from "../src/text/wasm/hb-wasm";
import { HB_SUBSET_WASM_SHA256 } from "../src/text/wasm/hb-subset-wasm";
import { prepareTextForPdf } from "../src/text/pdf";
import { charPositions } from "../src/dl/geom";
import { validate, type TextNode } from "../src/dl/types";

const require = createRequire(import.meta.url);
const FIX = path.join(__dirname, "fixtures");
const read = (p: string) => new Uint8Array(fs.readFileSync(path.join(FIX, p)));
const REG = read("fonts/Carlito-Regular.ttf"), BOLD = read("fonts/Carlito-Bold.ttf"), VF = read("fonts/Quicksand[wght].ttf"), OTF = read("fonts/SourceSans3-Regular.otf");
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

describe("HarfBuzz, pinned and inlined", () => {
  it("is harfbuzzjs 0.4.12's hb.wasm and hb-subset.wasm, byte for byte", () => {
    const dir = path.dirname(require.resolve("harfbuzzjs/package.json"));
    expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version).toBe("0.4.12");
    const sha = (f: string) => createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
    expect(HB_WASM_SHA256).toBe(sha("hb.wasm"));
    expect(HB_SUBSET_WASM_SHA256).toBe(sha("hb-subset.wasm"));
    expect(createHash("sha256").update(decode64(HB_WASM)).digest("hex")).toBe(HB_WASM_SHA256);
  });
  it("SHA-1 is SHA-1 (font ids = the helper's hashlib.sha1)", () => {
    for (const d of [new Uint8Array(0), new TextEncoder().encode("abc"), new Uint8Array(1000).fill(7), REG])
      expect(sha1(d)).toBe(createHash("sha1").update(d).digest("hex"));
  });
  it("an upload is made static at the weight it declares; other fonts stay as they are", async () => {
    const { staticFace } = await import("../src/text/static");
    const out = await staticFace(VF, 400);
    expect(out.variable).toBe(true);
    expect(isVariable(out.data)).toBe(false);
    expect(await staticFace(REG, 400)).toEqual({ data: REG, variable: false });
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]);
    expect((await staticFace(woff2, 400)).data).toBe(woff2);      // unreadable here: kept for the screen as before
  });
});

describe("the font registry", () => {
  it("keeps faces by content hash and resolves family + bold + italic as CSS does", () => {
    const r = new FontRegistry();
    const [reg] = r.add(REG), [bold] = r.add(BOLD), again = r.add(REG.slice());
    expect(reg.id).toBe(createHash("sha1").update(REG).digest("hex"));
    expect(again[0].id).toBe(reg.id);
    expect([reg.family, reg.weight, reg.italic, bold.weight]).toEqual(["Carlito", 400, false, 700]);
    expect(r.match("carlito")!.id).toBe(reg.id);
    expect(r.match("Carlito", true)!.id).toBe(bold.id);
    expect(r.match("Carlito", true, true)!.id).toBe(bold.id);          // no italic face: the weight still decides
    expect(r.match("Calibri")).toBeNull();
    // library metadata wins over the file (the library may name a family differently)
    const [lib] = r.add(REG, { family: "Corporate Sans", source: "library", file: "CorporateSans-400-abc.ttf" });
    expect(r.match("Corporate Sans")!.id).toBe(reg.id);
    expect(lib.source).toBe("library");
    expect(r.families()).toEqual(["Carlito", "Corporate Sans"]);
    expect(r.pdfFace({ t: "text", font: "Carlito", b: true, size: 9, x: 0, y: 0, src: "a", fill: { solid: [0, 0, 0] } })).toEqual({ key: bold.id, data: bold.data });
  });
  it("matches weights in CSS order", () => {
    const r = new FontRegistry();
    for (const w of [300, 500, 600, 900]) r.add(REG, { family: "W", weight: w });
    expect(r.match("W")!.weight).toBe(500);                             // 400 wanted: up to 500 first
    expect(r.match("W", true)!.weight).toBe(900);                       // 700 wanted: heavier first
    const r2 = new FontRegistry(); for (const w of [300, 600]) r2.add(REG, { family: "W", weight: w });
    expect(r2.match("W")!.weight).toBe(300);                            // then lighter
    expect(r2.match("W", true)!.weight).toBe(600);
  });
  it("unpacks WOFF and splits a collection; refuses WOFF2 and non-fonts", () => {
    // a WOFF built from Carlito's tables (uncompressed entries are allowed by the spec)
    const n = (REG[4] << 8) | REG[5], tables: [string, Uint8Array][] = [];
    for (let i = 0; i < n; i++) {
      const r = 12 + 16 * i, tag = latin1(REG.subarray(r, r + 4)), off = new DataView(REG.buffer, REG.byteOffset).getUint32(r + 8), len = new DataView(REG.buffer, REG.byteOffset).getUint32(r + 12);
      tables.push([tag, REG.slice(off, off + len)]);
    }
    let size = 44 + 20 * n; for (const [, b] of tables) size += (b.length + 3) & ~3;
    const woff = new Uint8Array(size), dv = new DataView(woff.buffer);
    woff.set([0x77, 0x4f, 0x46, 0x46]); dv.setUint32(4, 0x00010000); dv.setUint32(8, size); dv.setUint16(12, n);
    let pos = 44 + 20 * n;
    tables.forEach(([tag, b], i) => { const e = 44 + 20 * i; for (let k = 0; k < 4; k++) woff[e + k] = tag.charCodeAt(k); dv.setUint32(e + 4, pos); dv.setUint32(e + 8, b.length); dv.setUint32(e + 12, b.length); woff.set(b, pos); pos += (b.length + 3) & ~3; });
    const [fromWoff] = sfntFaces(woff);
    expect(sfntTables(fromWoff).sort()).toEqual(tables.map(t => t[0]).sort());
    expect(new FontRegistry().add(woff)[0].family).toBe("Carlito");
    // a collection of the two faces
    const faces = [REG, BOLD], heads = faces.map(f => ({ n: (f[4] << 8) | f[5], f }));
    const ttcHead = 12 + 4 * faces.length; let at = ttcHead; const dirs: number[] = [];
    for (const h of heads) { dirs.push(at); at += 12 + 16 * h.n; }
    let total = at; const placed: { from: Uint8Array; off: number; len: number; to: number }[] = [];
    for (const h of heads) for (let i = 0; i < h.n; i++) { const r = 12 + 16 * i, v = new DataView(h.f.buffer, h.f.byteOffset); const len = v.getUint32(r + 12); placed.push({ from: h.f, off: v.getUint32(r + 8), len, to: total }); total += (len + 3) & ~3; }
    const ttc = new Uint8Array(total), tv = new DataView(ttc.buffer);
    ttc.set([0x74, 0x74, 0x63, 0x66]); tv.setUint32(4, 0x00010000); tv.setUint32(8, faces.length);
    let k = 0;
    heads.forEach((h, fi) => {
      tv.setUint32(12 + 4 * fi, dirs[fi]); ttc.set(h.f.subarray(0, 12), dirs[fi]);
      for (let i = 0; i < h.n; i++, k++) { const r = 12 + 16 * i, d = dirs[fi] + 12 + 16 * i; ttc.set(h.f.subarray(r, r + 8), d); tv.setUint32(d + 8, placed[k].to); tv.setUint32(d + 12, placed[k].len); ttc.set(placed[k].from.subarray(placed[k].off, placed[k].off + placed[k].len), placed[k].to); }
    });
    const split = new FontRegistry().add(ttc);
    expect(split.map(f => [f.family, f.weight])).toEqual([["Carlito", 400], ["Carlito", 700]]);
    expect(() => sfntFaces(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]))).toThrow(/WOFF2/);
    expect(() => sfntFaces(new Uint8Array(16))).toThrow(/not a font/);
    expect(buildSfnt(0x00010000, new Map([["head", new Uint8Array(54)]])).length).toBe(12 + 16 + 56);
  });
});

describe("shaping", () => {
  const ref = JSON.parse(fs.readFileSync(path.join(FIX, "text/chromium-widths.json"), "utf8")) as { chromium: string; texts: string[]; sizes: number[]; widths: Record<string, Record<string, number[]>> };
  it("the golden slide texts shape to Chromium's widths (both shape with HarfBuzz, kern and liga on)", async () => {
    const s = await shaper(), r = new FontRegistry(), faces = { regular: r.add(REG)[0], bold: r.add(BOLD)[0] };
    let worst = 0, n = 0;
    for (const [k, face] of Object.entries(faces)) for (const size of ref.sizes) {
      const want = ref.widths[k][String(size)];
      ref.texts.forEach((t, i) => { const d = Math.abs(s.width(face, t, size) - want[i]); worst = Math.max(worst, d); n++; expect(d, `${k} ${size}px «${t}»`).toBeLessThan(.005); });
    }
    expect(n).toBeGreaterThan(7000);
    console.log(`shaping: ${n} runs, largest difference from Chromium ${ref.chromium}: ${worst.toFixed(5)} px`);
  });
  it("equals harfbuzzjs's own wrapper (hbjs) glyph by glyph", async () => {
    const hbjs = await (require("harfbuzzjs") as Promise<{ createBlob(b: Uint8Array): { destroy(): void }; createFace(b: unknown, i: number): { upem: number; destroy(): void }; createFont(f: unknown): { setScale(x: number, y: number): void; destroy(): void }; createBuffer(): { addText(t: string): void; guessSegmentProperties(): void; json(): { g: number; ax: number; cl: number }[]; destroy(): void }; shape(f: unknown, b: unknown, feats?: string): void }>);
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const blob = hbjs.createBlob(REG), hf = hbjs.createFace(blob, 0), font = hbjs.createFont(hf);
    font.setScale(hf.upem, hf.upem);
    for (const t of ref.texts.slice(0, 300).concat(["office fi fl ffi", "AVATAR Te Yo", "Δ € ‰ – — “” àèéìòù"])) {
      const b = hbjs.createBuffer(); b.addText(t); b.guessSegmentProperties(); hbjs.shape(font, b); const want = b.json(); b.destroy();
      const got = s.shape(face, t, hf.upem);
      expect(got.gids).toEqual(want.map(g => g.g));
      expect(got.adv).toEqual(want.map(g => g.ax));
      expect(got.cl).toEqual(want.map(g => g.cl));
    }
    font.destroy(); hf.destroy(); blob.destroy();
  });
  it("kerns and makes ligatures; empty text is empty", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0], f = face.font, k = 40 / f.unitsPerEm;
    const av = s.shape(face, "AV", 40), plain = (f.advances[f.cmap.get(65)!] + f.advances[f.cmap.get(86)!]) * k;
    expect(av.w).toBeLessThan(plain);                                   // kerning
    const fi = s.shape(face, "fi", 40);
    expect(fi.gids).toHaveLength(1);                                    // the fi ligature
    expect(fi.cl).toEqual([0]);
    expect(s.shape(face, "", 40)).toEqual({ gids: [], adv: [], cl: [], dx: [], dy: [], w: 0 });
    // advances scale with the size
    expect(s.width(face, "Loans", 20) * 2).toBeCloseTo(s.width(face, "Loans", 40), 6);
  });
});

describe("OpenType features and tabular figures (S3.4)", () => {
  // (the fixture fonts have no tnum alternates – Carlito's and Source Sans 3's digits are tabular already,
  // Quicksand's proportional with no tnum feature – so "-kern" shows that features reach HarfBuzz; tnum itself was
  // checked on Segoe UI Variable in the S3.4 review)
  it("features reach HarfBuzz: kerning switched off changes the advance of a kerned pair", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const on = s.shape(face, "AV", 40).w, off = s.shape(face, "AV", 40, ["-kern"]).w;
    expect(off).toBeGreaterThan(on + .5);
  });
  it("a tnum node is shaped with the feature for the PDF; per-character advances validate", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const n: TextNode = { t: "text", font: "Carlito", size: 20, x: 0, y: 20, src: "1.1", w: 30, fill: { solid: [0, 0, 0] }, tnum: true, adv: [10, 5, 10] };
    expect(validate([n])).toEqual([]);
    expect(validate([{ ...n, adv: [10, 5] }])[0]).toMatch(/one advance per character/);
    const shaped = s.shapeNode(face, n);
    expect(shaped.gids!.length).toBe(3);
    expect(shaped.adv!.reduce((a, b) => a + b, 0)).toBeCloseTo(30, 6);
    expect(charPositions(n)).toEqual([0, 10, 15]);
  });
});

describe("line breaking and fitting", () => {
  it("wraps at spaces and hyphens, breaks a word longer than the line, keeps paragraphs", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const lines = s.breakLines(face, "Loans to banks Δ vs. Budget and a verylongwordthatdoesnotfit here", 20, 120);
    expect(lines.map(l => l.text)).toEqual(["Loans to", "banks Δ vs.", "Budget and a", "verylongwordt", "hatdoesnotfit", "here"]);
    expect(lines.every(l => l.w <= 120)).toBe(true);
    expect(s.breakLines(face, "one\n\ntwo", 20, 500).map(l => [l.text, l.start, l.end])).toEqual([["one", 0, 3], ["", 4, 4], ["two", 5, 8]]);
    expect(s.breakLines(face, "well-known words", 20, 60).map(l => l.text)).toEqual(["well-", "known", "words"]);
    expect(s.breakLines(face, "", 20, 100)).toEqual([{ text: "", start: 0, end: 0, w: 0 }]);
    expect(s.breakLines(face, "x", 20, 0).map(l => l.text)).toEqual(["x"]);  // at least one character per line
    // a line's width excludes its trailing spaces and equals the shaped width of its text
    for (const l of lines) expect(l.w).toBeCloseTo(s.width(face, l.text, 20), 6);
  });
  it("fitText shrinks 1 px at a time down to 9 px", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const r = s.fitText(face, "A text box with some words that must fit", 40, { w: 200, h: 60 });
    expect(r.fits).toBe(true);
    expect(Number.isInteger(r.size)).toBe(true);
    const next = s.breakLines(face, "A text box with some words that must fit", r.size + 1, 200);
    expect(next.length * (r.size + 1) * 1.2 > 60 || next.some(l => l.w > 200)).toBe(true);   // one px larger does not fit
    expect(s.fitText(face, "short", 20, { w: 500, h: 100 }).size).toBe(20);
    const tight = s.fitText(face, "far too much text for a tiny box ".repeat(20), 30, { w: 50, h: 20 });
    expect([tight.size, tight.fits]).toEqual([9, false]);
  });
});

describe("fonts in the PDF (hb-subset)", () => {
  it("subsets TrueType with glyph ids kept and the layout tables dropped", async () => {
    const hb = await hbSubsetter(), s = await shaper(), face = new FontRegistry().add(REG)[0];
    const g = s.shape(face, "Loans to banks Δ 1.234", 30).gids;
    const sub = subsetFont(hb, REG, g)!;
    expect(sub.outline).toBe("truetype");
    expect(sub.data.length).toBeLessThan(REG.length / 10);
    const t = sfntTables(sub.data);
    expect(t).toContain("glyf");
    for (const x of ["GSUB", "GPOS", "GDEF", "DSIG"]) expect(t).not.toContain(x);
    // retained gids: every used glyph keeps its id and its advance
    const sf = new FontRegistry().add(sub.data)[0].font, full = face.font;
    expect(sf.numGlyphs).toBeGreaterThan(Math.max(...g));
    for (const x of g) expect(sf.advances[x]).toBe(full.advances[x]);
  });
  it("the PDF of shaped text embeds subset fonts, kerning as TJ, ligatures mapped back to their letters", async () => {
    const r = new FontRegistry(); r.add(REG); r.add(BOLD);
    const list = [
      { t: "text" as const, font: "Carlito", size: 32, x: 80, y: 120, src: "office AVATAR 1.234", fill: { solid: [0, 0, 0] as [number, number, number] } },
      { t: "text" as const, font: "Carlito", b: true, size: 32, x: 80, y: 200, src: "Total fi", w: 150, fill: { solid: [0, 0, 0] as [number, number, number] } },
    ];
    const pages = await prepareTextForPdf([list], r);
    const t0 = pages[0][0] as typeof list[0] & { gids: number[]; adv: number[]; cl: number[] };
    expect(t0.gids.length).toBeLessThan(t0.src.length);                 // "ffi" in "office" is one glyph
    expect(t0.cl).toBeDefined();
    const t1 = pages[0][1] as typeof list[1] & { adv: number[] };
    expect(t1.adv.reduce((a, b) => a + b, 0)).toBeCloseTo(150, 6);       // stretched to the measured width
    const pdf = latin1(writePdf({ pages, image: () => undefined, font: r.pdfFace, subset: await pdfSubsetter(), compress: false }));
    expect(pdf).toMatch(/\] TJ ET/);
    expect(pdf.match(/\/FontFile2/g)).toHaveLength(2);
    expect(pdf).not.toContain("/Type3");
    expect(pdf).toMatch(/<[0-9a-f]{4}><006600660069>/);                 // the ffi glyph → "ffi" in ToUnicode
  });
});

describe("CFF fonts in the PDF", () => {
  it("subset as CFF and embedded as FontFile3 / CIDFontType0, selectable", async () => {
    const r = new FontRegistry(), [face] = r.add(OTF);
    expect(face.font.cff).toBe(true);
    const pages = await prepareTextForPdf([[{ t: "text", font: face.family, size: 30, x: 50, y: 100, src: "Source Sans 1.234 Δ", fill: { solid: [0, 0, 0] } }]], r);
    const bytes = writePdf({ pages, image: () => undefined, font: r.pdfFace, subset: await pdfSubsetter(), compress: false });
    const pdf = latin1(bytes);
    expect(pdf).toContain("/Subtype/CIDFontType0");
    expect(pdf).toContain("/FontFile3");
    expect(pdf).toContain("/Subtype/OpenType");
    expect(bytes.length).toBeLessThan(OTF.length / 4);
  });
});

describe("variable fonts", () => {
  it("are made static: every axis pinned, no fvar / gvar / HVAR / avar left", async () => {
    const hb = await hbSubsetter(), vf = VF;
    expect(isVariable(vf)).toBe(true);
    const r = new FontRegistry(), [f] = r.add(vf);
    expect(f.variable).toBe(true);
    const stat = instanceFont(hb, vf, { wght: 700 });
    expect(isVariable(stat)).toBe(false);
    expect(sfntTables(stat)).toEqual(expect.arrayContaining(["glyf", "cmap", "hmtx"]));
    expect(new FontRegistry().add(stat)[0].font.numGlyphs).toBe(f.font.numGlyphs);
    // pinned at 700 the outlines are the bold ones: wider than the default (300) instance
    const s = await shaper(), r2 = new FontRegistry(), bold = r2.add(stat, { family: "QB" })[0], light = r2.add(instanceFont(hb, vf, {}), { family: "QL" })[0];
    expect(s.width(bold, "Weekly report", 40)).toBeGreaterThan(s.width(light, "Weekly report", 40));
    expect(instanceFont(hb, REG)).toBe(REG);                             // a static font is returned as it is
    expect(() => instanceFont(hb, vf, { wdth: 100 })).toThrow(/no wdth axis/);
    expect(() => subsetFont(hb, vf, [1, 2])).toThrow(/instanced/);
  });
});

describe("the core worker makes uploads static (staticFont)", () => {
  it("answers through the RPC with a static face, or the same bytes", async () => {
    const { Port, pair, transfer } = await import("../src/rpc/port");
    const { serve } = await import("../src/worker/host");
    const [a, b] = pair();
    const { staticFace } = await import("../src/text/static");
    serve(new Port(b) as never, { staticFace });
    const page = new Port(a) as unknown as { call(m: string, x: unknown): Promise<{ buf: ArrayBuffer; variable: boolean }> };
    const vf = VF.slice().buffer, r = await page.call("staticFont", transfer({ buf: vf, weight: 600 }, [vf]));
    expect(r.variable).toBe(true);
    expect(isVariable(new Uint8Array(r.buf))).toBe(false);
    const st = await page.call("staticFont", { buf: REG.slice().buffer, weight: 400 });
    expect([st.variable, st.buf.byteLength]).toEqual([false, REG.length]);
    // a host without it (the page's in-thread fallback) stores the upload as it is
    const [c, d] = pair(); serve(new Port(d) as never);
    const bare = await (new Port(c) as unknown as typeof page).call("staticFont", { buf: VF.slice().buffer, weight: 400 });
    expect([bare.variable, bare.buf.byteLength]).toEqual([false, VF.length]);
  });
});

describe("review fixes (S3.2)", () => {
  const withFvar = (axes: [string, number, number, number][]) => {
    // Carlito with an fvar table of these axes (tag, min, default, max): enough for the axis rules (not instanced)
    const n = (REG[4] << 8) | REG[5], v = new DataView(REG.buffer, REG.byteOffset), tables = new Map<string, Uint8Array>();
    for (let i = 0; i < n; i++) { const r = 12 + 16 * i; tables.set(latin1(REG.subarray(r, r + 4)), REG.slice(v.getUint32(r + 8), v.getUint32(r + 8) + v.getUint32(r + 12))); }
    const fvar = new Uint8Array(16 + 20 * axes.length), fv = new DataView(fvar.buffer);
    fv.setUint16(0, 1); fv.setUint16(4, 16); fv.setUint16(6, 2); fv.setUint16(8, axes.length); fv.setUint16(10, 20); fv.setUint16(12, 0); fv.setUint16(14, 4 + 4 * axes.length);
    axes.forEach(([tag, lo, def, hi], k) => { const p = 16 + 20 * k; for (let c = 0; c < 4; c++) fvar[p + c] = tag.charCodeAt(c); fv.setInt32(p + 4, lo * 65536); fv.setInt32(p + 8, def * 65536); fv.setInt32(p + 12, hi * 65536); fv.setUint16(p + 18, 256 + k); });
    tables.set("fvar", fvar);
    return buildSfnt(0x00010000, tables);
  };
  it("a forced break never separates a letter from its accent", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    const lines = s.breakLines(face, "a\u0301b\u0301c\u0301d\u0301e\u0301f\u0301", 20, 20);
    for (const l of lines) expect(/^\p{M}/u.test(l.text), JSON.stringify(lines.map(x => x.text))).toBe(false);
    expect(lines.map(l => l.text).join("")).toBe("a\u0301b\u0301c\u0301d\u0301e\u0301f\u0301");
    // white-space: normal drops spaces at every line start; pre-wrap (text boxes) keeps a paragraph's own indent
    expect(s.breakLines(face, "   hello world", 20, 45, "normal").map(l => l.text)[0]).toBe("hello");
    expect(s.breakLines(face, "   indented text", 20, 500).map(l => l.text)).toEqual(["   indented text"]);
    expect(s.breakLines(face, "  two\n  three", 20, 500).map(l => l.text)).toEqual(["  two", "  three"]);
    expect(s.breakLines(face, "one two three four", 20, 60).every(l => !l.text.startsWith(" "))).toBe(true);   // no indent after a soft wrap
    expect(s.breakLines(face, "a\n\nb", 20, 500, "normal").map(l => l.text)).toEqual(["a b"]);
  });
  it("fitText follows v3's fitNoteSize: from the start size (fractional too), 1 px steps while above 9 px", async () => {
    const s = await shaper(), face = new FontRegistry().add(REG)[0];
    expect(s.fitText(face, "short", 14.67, { w: 500, h: 100 }).size).toBe(14.67);
    expect(s.fitText(face, "short", 8, { w: 500, h: 100 })).toMatchObject({ size: 8, fits: true });
    const r = s.fitText(face, "A text box with some words that must fit", 30.5, { w: 200, h: 60 });
    expect([r.fits, (30.5 - r.size) % 1]).toEqual([true, 0]);
  });
  it("marks keep HarfBuzz's offsets: the PDF places them on their bases, the screen draws the run whole", async () => {
    const s = await shaper(), r = new FontRegistry(), [face] = r.add(OTF);
    const sh = s.shape(face, "b\u0301", 40);
    expect(sh.dx.some(v => v !== 0) || sh.dy.some(v => v !== 0)).toBe(true);
    const [page] = await prepareTextForPdf([[{ t: "text", font: face.family, size: 40, x: 10, y: 50, src: "b\u0301 x", w: 60, fill: { solid: [0, 0, 0] } }]], r);
    const t = page[0] as TextNode;
    expect(t.dx).toBeDefined();
    expect(t.adv!.reduce((a, b) => a + b, 0)).toBeCloseTo(60, 6);
    expect(t.adv![0]).toBeCloseTo(sh.adv[0], 6);                     // the base keeps its advance: the stretch follows the whole cluster
    expect(charPositions(t)).toBeNull();
    const pdf = latin1(writePdf({ pages: [page], image: () => undefined, font: r.pdfFace, subset: await pdfSubsetter(), compress: false }));
    // one text line: the pen moves with TJ, the mark is raised with Ts (no Tm per glyph)
    expect(pdf.match(/ Tm /g)!.length).toBe(1);
    expect(pdf).toMatch(/-?[\d.]+ Ts <[0-9a-f]{4}> Tj/);
    expect(pdf).toContain("0 Ts");
    expect(pdf).toContain("/Span<</ActualText<FEFF00620301>>>BDC");          // "b" + acute read once, as its text
    // a decomposed letter without offsets (ȩ = e + cedilla in Source Sans 3): ActualText in the plain TJ path, and
    // the "e" glyph keeps meaning "e" everywhere else
    const [p2] = await prepareTextForPdf([[{ t: "text", font: face.family, size: 40, x: 10, y: 50, src: "\u0229 then e", fill: { solid: [0, 0, 0] } }]], r);
    const t2 = p2[0] as TextNode, eGid = face.font.cmap.get(0x65)!;
    const pdf2 = latin1(writePdf({ pages: [p2], image: () => undefined, font: r.pdfFace, subset: await pdfSubsetter(), compress: false }));
    if (t2.gids!.length > [..."\u0229 then e"].length) expect(pdf2).toContain("/Span<</ActualText<FEFF0229>>>BDC");
    expect(pdf2).toContain(`<${eGid.toString(16).padStart(4, "0")}><0065>`);
  });
  it("a font with an axis the browser sets itself (opsz) is stored as it is; wght alone is pinned", async () => {
    const { staticFace } = await import("../src/text/static");
    expect((await staticFace(withFvar([["opsz", 8, 14, 72], ["wght", 100, 400, 900]]), 400)).variable).toBe(false);
    expect((await staticFace(withFvar([["wdth", 75, 100, 125]]), 400)).variable).toBe(true);    // default = what the browser applies
    expect((await staticFace(withFvar([["wdth", 75, 87.5, 125]]), 400)).variable).toBe(false);
    expect((await staticFace(VF, 400)).variable).toBe(true);
  });
  it("a variable face reaching the PDF (a Windows font) is made static at the run's weight first", async () => {
    const r = new FontRegistry(); r.add(VF);
    const pages = await prepareTextForPdf([[{ t: "text", font: "Quicksand", b: true, size: 30, x: 10, y: 50, src: "Weekly", fill: { solid: [0, 0, 0] } }]], r);
    const t = pages[0][0] as TextNode;
    expect(t.font).toMatch(/^Quicksand#/);                            // the run's own static instance
    expect(r.match(t.font, 700)!.variable).toBe(false);
    const bytes = writePdf({ pages, image: () => undefined, font: r.pdfFace, subset: await pdfSubsetter() });
    expect(bytes.length).toBeGreaterThan(1000);
    // a library face is drawn at its declared weight (one @font-face value: Chrome pins wght to it, bold is synthetic)
    const lib = new FontRegistry(); lib.add(VF, { family: "QL", weight: 400, source: "library" });
    const [lp] = await prepareTextForPdf([[{ t: "text", font: "QL", b: true, size: 30, x: 10, y: 50, src: "Weekly", fill: { solid: [0, 0, 0] } }]], lib);
    const s = await shaper(), hb = await hbSubsetter(), at400 = new FontRegistry().add(instanceFont(hb, VF, { wght: 400 }))[0];
    expect((lp[0] as TextNode).adv).toEqual(s.shape(at400, "Weekly", 30).adv);
  });
  it("embedding follows OS/2.fsType: bitmap-only refused, no-subsetting embedded whole", async () => {
    const setFs = (v: number) => { const d = REG.slice(), dv = new DataView(d.buffer), n = dv.getUint16(4); for (let i = 0; i < n; i++) if (latin1(d.subarray(12 + 16 * i, 16 + 16 * i)) === "OS/2") dv.setUint16(dv.getUint32(12 + 16 * i + 8) + 8, v); return d; };
    const page = [{ t: "text" as const, font: "C", size: 20, x: 0, y: 20, src: "abc", fill: { solid: [0, 0, 0] as [number, number, number] } }];
    expect(() => writePdf({ pages: [page], image: () => undefined, font: () => ({ key: "b", data: setFs(0x0200) }) })).toThrow(/does not allow embedding/);
    const whole = writePdf({ pages: [page], image: () => undefined, font: () => ({ key: "w", data: setFs(0x0100) }), subset: await pdfSubsetter() });
    expect(whole.length).toBeGreaterThan(REG.length / 3);             // the whole font, compressed
  });
});
