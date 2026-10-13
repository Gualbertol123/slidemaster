/* The native export (PLAN S3.7): which font draws each run (text/resolve.ts), synthetic bold and PNG pages passed
   through in the writer, and the export host's jobs over its two channels (worker/export-host.ts). */
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { zlibSync } from "fflate";
import { cssFamilies, FontResolver, pickFace, type CatalogFont } from "../src/text/resolve";
import { FontRegistry } from "../src/text/fonts";
import { writePdf, fakeBold } from "../src/pdf/writer";
import { pngFlate } from "../src/pdf/png";
import { ExportHost, dataUrlBytes, type ExportCorePort, type ExportPort, type Rasterizer } from "../src/worker/export-host";
import { Port, pair } from "../src/rpc/port";
import type { DisplayList, TextNode } from "../src/dl/types";
import type { ExportJob, ExportMethods, ExportPageMethods, SlideList, ThumbJob } from "../src/rpc/messages";

const FONTS = path.join(__dirname, "fixtures", "fonts");
const font = (f: string) => new Uint8Array(fs.readFileSync(path.join(FONTS, f)));
const sys = (file: string, family: string, weight = 400, italic = false): CatalogFont => ({ source: "system", file, family, weight, italic });
const text = (o: Partial<TextNode>): TextNode => ({ t: "text", font: "Carlito", size: 20, x: 10, y: 40, src: "Total 1.234", fill: { solid: [0, 0, 0] }, ...o });

/** a PNG from raw rows: 8-bit, colour type `type` (2 RGB, 6 RGBA), optionally interlaced (header only: never decoded) */
function png(w: number, h: number, type = 2, interlace = 0): Uint8Array {
  const ch = type === 6 ? 4 : 3, raw = new Uint8Array(h * (1 + w * ch));
  for (let y = 0; y < h; y++) for (let x = 0; x < w * ch; x++) raw[y * (1 + w * ch) + 1 + x] = (x * 40 + y * 9) & 255;
  const chunk = (tag: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length), v = new DataView(out.buffer);
    v.setUint32(0, body.length); for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i); out.set(body, 8);
    return out;                                                          // (the CRC is not checked by the readers here)
  };
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, w); new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, type, 0, 0, interlace], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
const latin = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("which font draws a run (text/resolve.ts)", () => {
  test("a CSS family list, quoted or not", () => {
    expect(cssFamilies(`-apple-system,"SF Pro Text", 'Segoe UI Variable Text',Segoe UI , Arial,sans-serif`))
      .toEqual(["-apple-system", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Arial", "sans-serif"]);
    expect(cssFamilies(`"Font, with comma", X`)).toEqual(["Font, with comma", "X"]);
  });
  test("CSS font matching on the catalog: the style first, then the weight", () => {
    const l = [{ weight: 300, italic: false }, { weight: 400, italic: false }, { weight: 600, italic: false }, { weight: 700, italic: true }];
    expect(pickFace(l, 400, false)).toBe(l[1]);
    expect(pickFace(l, 700, false)).toBe(l[2]);                          // bold: the heavier ones first, then lighter descending
    expect(pickFace(l, 500, false)).toBe(l[1]);                          // 500: up to 500 ascending, then lighter descending, then heavier
    expect(pickFace(l, 700, true)).toBe(l[3]);
    expect(pickFace(l, 300, true)).toBe(l[3]);                           // italic first
    expect(pickFace([], 400, false)).toBeNull();
  });
  test("the first family of the list it can embed; variable Segoe UI and Apple families skipped (as v3's PDF); a stand-in for Calibri", async () => {
    const loads: string[] = [];
    const cat = [sys("Carlito-Regular.ttf", "Carlito"), sys("Carlito-Bold.ttf", "Carlito", 700), sys("Quicksand[wght].ttf", "Segoe UI Variable")];
    const reg = new FontRegistry(), r = new FontResolver(cat, reg, async f => { loads.push(f.file); return font(f.file); });
    const { pages, missing } = await r.resolve([[
      text({ css: `-apple-system,"SF Pro Text","Segoe UI Variable Text",Calibri,sans-serif` }),
      text({ css: `Calibri, Arial`, b: true }),
      { t: "group", children: [text({ css: "Carlito" })] },
    ]]);
    expect(missing).toEqual([]);
    const fams = pages[0].map(n => n.t === "text" ? n.font : n.t === "group" ? (n.children[0] as TextNode).font : "");
    expect(fams).toEqual(["Carlito", "Carlito", "Carlito"]);
    expect(loads.sort()).toEqual(["Carlito-Bold.ttf", "Carlito-Regular.ttf"]);   // only the faces used; the variable font never read
    expect(reg.pdfFace(pages[0][1] as TextNode)?.key).toBe(reg.match("Carlito", 700)!.id);
  });
  test("the deck's library font wins over a Windows font of the same name; an unreadable face (WOFF2) falls back to the next family", async () => {
    const cat: CatalogFont[] = [
      { source: "library", file: "lib-regular.otf", family: "Carlito", weight: 400, italic: false },
      sys("Carlito-Regular.ttf", "Carlito"),
      { source: "library", file: "brand.woff2", family: "Brand", weight: 400, italic: false },
    ];
    const reg = new FontRegistry(), files: Record<string, Uint8Array> = { "lib-regular.otf": font("SourceSans3-Regular.otf"), "Carlito-Regular.ttf": font("Carlito-Regular.ttf"), "brand.woff2": new TextEncoder().encode("wOF2 not readable") };
    const r = new FontResolver(cat, reg, async f => files[f.file]);
    const { pages, unreadable, missing } = await r.resolve([[text({ css: "Carlito" }), text({ css: "Brand, Carlito" })]]);
    expect((pages[0] as TextNode[]).map(n => n.font)).toEqual(["Carlito", "Carlito"]);
    expect([unreadable, missing]).toEqual([["Brand"], []]);
    expect(reg.match("Carlito", 400)!.source).toBe("library");
    expect(reg.match("Carlito", 400)!.font.tables.has("CFF ")).toBe(true);        // Source Sans 3 (the library file), not Carlito
  });
  test("nothing in the list installed: a default face, and the list is reported; no default either: a clear error", async () => {
    const cat = [sys("Carlito-Regular.ttf", "Arial")];
    const r = new FontResolver(cat, new FontRegistry(), async f => font(f.file));
    const { pages, missing } = await r.resolve([[text({ css: "'Brand Sans', Helvetica Neue" }), text({ css: "Carlito" })]]);
    expect((pages[0] as TextNode[]).map(n => n.font)).toEqual(["Arial", "Arial"]);
    expect(missing.sort()).toEqual(["'Brand Sans', Helvetica Neue", "Carlito"]);
    await expect(new FontResolver([], new FontRegistry(), async () => null).resolve([[text({ src: "Hi" })]])).rejects.toThrow(/no font to draw “Hi”/);
  });
});

describe("the writer for the export", () => {
  test("synthetic bold: a bold run in a family without a bold face is stroked as Chrome emboldens it", () => {
    const reg = new FontRegistry(); reg.add(font("Carlito-Regular.ttf"));
    const n = text({ b: true }), face = reg.pdfFace(n)!;
    expect(face.bold).toBe(true);
    expect(reg.pdfFace(text({}))!.bold).toBeUndefined();
    const pdf = latin(writePdf({ pages: [[n]], image: () => undefined, font: reg.pdfFace, compress: false }));
    expect(pdf).toContain(`0 0 0 RG ${Math.round(20 * fakeBold(20) * 1e4) / 1e4} w 2 Tr BT`);
    expect(fakeBold(9)).toBeCloseTo(1 / 24); expect(fakeBold(36)).toBeCloseTo(1 / 32); expect(fakeBold(100)).toBeCloseTo(1 / 32);
    reg.add(font("Carlito-Bold.ttf"));
    expect(reg.pdfFace(n)!.bold).toBeUndefined();                       // a real bold face: drawn as it is
  });
  test("an opaque 8-bit PNG is passed through as Flate with PNG predictors; others are decoded", () => {
    const rgb = png(6, 3), p = pngFlate(rgb)!;
    expect([p.w, p.h, p.colors]).toEqual([6, 3, 3]);
    expect(pngFlate(png(6, 3, 6))).toBeNull();                          // alpha: an SMask is needed
    expect(pngFlate(png(6, 3, 2, 1))).toBeNull();                       // interlaced
    const pdf = latin(writePdf({ pages: [[{ t: "image", id: "a", x: 0, y: 0, w: 1600, h: 900 }]], image: () => rgb, font: () => undefined }));
    expect(pdf).toContain("/Width 6/Height 3/ColorSpace/DeviceRGB/BitsPerComponent 8/Interpolate true/Filter/FlateDecode/DecodeParms<</Predictor 15/Colors 3/BitsPerComponent 8/Columns 6>>");
    expect(pdf).toContain(latin(p.data));                                // the IDAT bytes as they were
  });
  test("data: URLs to bytes", () => {
    expect([...dataUrlBytes("data:image/png;base64,AAEC/w==")]).toEqual([0, 1, 2, 255]);
    expect([...dataUrlBytes("data:text/plain,a%20b")]).toEqual([97, 32, 98]);
  });
});

describe("the export host (worker/export-host.ts)", () => {
  const LISTS: SlideList[] = [
    { slide: 0, dl: { nodes: [{ t: "rect", x: 0, y: 0, w: 1600, h: 900, fill: { solid: [255, 255, 255] } }, text({ css: "Calibri", src: "Cover" }), { t: "image", id: "pic", x: 10, y: 10, w: 60, h: 30 }] as DisplayList, images: { pic: "data:image/png;base64," + Buffer.from(png(4, 2)).toString("base64") } } },
    { slide: 1, dl: { nodes: [text({ css: "Calibri", src: "Loans", b: true }), { t: "image", id: "logo", x: 10, y: 10, w: 60, h: 30 }] as DisplayList, images: { logo: "/assets/logo.gif?t=x" } } },
  ];
  function connect(raster?: Rasterizer) {
    const [a, b] = pair(), [c, d] = pair();
    const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(a);
    const asked = { fonts: [] as string[], pictures: [] as string[], lists: 0 };
    page.handle("fontFile", x => { asked.fonts.push(x.file); const f = font(x.file); return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer; });
    page.handle("pictureBytes", x => { asked.pictures.push(x.src); const p = png(2, 2); return p.buffer as ArrayBuffer; });
    const host = new ExportHost(new Port(b) as unknown as ExportPort, { raster });
    const core = new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(c);
    core.handle("slideLists", () => { asked.lists++; return structuredClone(LISTS); });
    host.link(new Port(d) as unknown as ExportCorePort);
    return { page, asked };
  }
  const job = (kind: ExportJob["kind"]): ExportJob => ({ kind, design: "excel", version: "", forExport: true, thumb: false, scale: 2, title: "Weekly", catalog: [sys("Carlito-Regular.ttf", "Carlito"), sys("Carlito-Bold.ttf", "Carlito", 700)] });

  test("a vector PDF: one page per slide, the fonts it needs asked once, pictures the worker cannot read asked of the page", async () => {
    const { page, asked } = connect();
    const r = await page.call("run", job("pdf"));
    const pdf = latin(new Uint8Array(r.files[0]));
    expect(pdf.startsWith("%PDF-1.7")).toBe(true);
    expect((pdf.match(/\/Type\/Page\//g) || []).length).toBe(2);
    expect((pdf.match(/\/FontFile2/g) || []).length).toBe(2);            // Carlito regular and bold (the stand-in for Calibri)
    expect((pdf.match(/\/Subtype\/Image/g) || []).length).toBe(2);
    expect(pdf).toContain("/Title(Weekly)");
    expect(r.missing).toEqual([]);
    expect(asked).toEqual({ fonts: ["Carlito-Regular.ttf", "Carlito-Bold.ttf"], pictures: ["/assets/logo.gif?t=x"], lists: 1 });
    // a second job: the fonts and pictures are kept
    await page.call("run", job("pdf"));
    expect(asked).toEqual({ fonts: ["Carlito-Regular.ttf", "Carlito-Bold.ttf"], pictures: ["/assets/logo.gif?t=x"], lists: 2 });
  });
  test("pictures and PNGs come from the rasteriser: a PDF of PNG pages passed through, or the PNG files", async () => {
    const seen: number[] = [];
    const { page } = connect({ async pages(pages, images, scale) { seen.push(pages.length, images.size, scale); return pages.map(() => png(32, 18)); } });
    const pics = latin(new Uint8Array((await page.call("run", job("pictures"))).files[0]));
    expect((pics.match(/\/Predictor 15/g) || []).length).toBe(1);        // the two equal pages share one image
    expect((pics.match(/\/Type\/Page\//g) || []).length).toBe(2);
    expect(pics).not.toContain("/Font");
    const pngs = (await page.call("run", { ...job("png"), scale: 3 })).files;
    expect(pngs.map(b => latin(new Uint8Array(b)).slice(1, 4))).toEqual(["PNG", "PNG"]);
    expect(seen).toEqual([2, 2, 2, 2, 2, 3]);
  });
  test("thumbnails (S4.3): pictures at the width asked; a slide whose picture the page shows (its key) is not drawn again", async () => {
    const seen: number[][] = [];
    const { page, asked } = connect({ async pages() { return []; }, async bitmaps(pages, images, width) { seen.push([pages.length, images.size, width]); return { bitmaps: pages.map((_, i) => ({ fake: i }) as unknown as ImageBitmap), complete: true }; } });
    const tj = (have: Record<number, string> = {}, width = 222): ThumbJob => ({ design: "excel", version: "", forExport: false, thumb: false, width, library: [], have });
    const a = await page.call("thumbs", tj());
    expect(a.map(t => [t.slide, !!t.bitmap])).toEqual([[0, true], [1, true]]);
    expect(a[0].key).toBeTruthy(); expect(a[0].key).not.toBe(a[1].key);
    // the page shows slide 0 as it is, and an older slide 1: only slide 1 is drawn
    const b = await page.call("thumbs", tj({ 0: a[0].key, 1: "older" }));
    expect(b.map(t => [t.slide, !!t.bitmap, t.key === a[t.slide].key])).toEqual([[0, false, true], [1, true, true]]);
    // another width is another picture
    const c = await page.call("thumbs", tj({ 0: a[0].key, 1: a[1].key }, 444));
    expect(c.every(t => !!t.bitmap && t.key !== a[t.slide].key)).toBe(true);
    expect(seen).toEqual([[2, 2, 222], [1, 1, 222], [2, 2, 444]]);
    expect(asked.lists).toBe(3);
  });
  test("thumbnails without a rasteriser, or of a list that does not validate: no picture and no key (asked again next time)", async () => {
    const { page } = connect();
    const tj: ThumbJob = { design: "excel", version: "", forExport: false, thumb: false, width: 222, library: [], have: {} };
    expect(await page.call("thumbs", tj)).toEqual([{ slide: 0, key: "", bitmap: null }, { slide: 1, key: "", bitmap: null }]);
    const drew = connect({ async pages() { return []; }, async bitmaps(pages) { return { bitmaps: pages.map(() => ({}) as ImageBitmap), complete: true }; } });
    LISTS.push({ slide: 2, dl: { nodes: [{ t: "rect", x: NaN, y: 0, w: 1, h: 1 }] as unknown as DisplayList, images: {} } });
    try { expect((await drew.page.call("thumbs", tj)).map(t => [t.slide, !!t.bitmap, !!t.key])).toEqual([[0, true, true], [1, true, true], [2, false, false]]); }
    finally { LISTS.pop(); }
  });
  test("thumbnails drawn without a picture or a library face they need get no key, and the picture is asked for again", async () => {
    let fail = true, complete = false;
    const [a, b] = pair(), [c, d] = pair();
    const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(a);
    const asked: string[] = [];
    page.handle("fontFile", () => null);
    page.handle("pictureBytes", x => { asked.push(x.src); return fail ? null : png(2, 2).buffer as ArrayBuffer; });
    new ExportHost(new Port(b) as unknown as ExportPort, { raster: { async pages() { return []; }, async bitmaps(pages) { return { bitmaps: pages.map(() => ({}) as ImageBitmap), complete }; } } })
      .link(new Port(d) as unknown as ExportCorePort);
    new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(c).handle("slideLists", () => structuredClone(LISTS));
    const tj: ThumbJob = { design: "excel", version: "", forExport: false, thumb: false, width: 222, library: [], have: {} };
    // the logo of slide 1 could not be read, the fonts are incomplete: drawn, no keys
    expect((await page.call("thumbs", tj)).map(t => [!!t.bitmap, !!t.key])).toEqual([[true, false], [true, false]]);
    complete = true;
    expect((await page.call("thumbs", tj)).map(t => [!!t.bitmap, !!t.key])).toEqual([[true, true], [true, false]]);
    fail = false;
    expect((await page.call("thumbs", tj)).map(t => [!!t.bitmap, !!t.key])).toEqual([[true, true], [true, true]]);
    expect(asked).toEqual(["/assets/logo.gif?t=x", "/assets/logo.gif?t=x", "/assets/logo.gif?t=x"]);
  });
  test("without a rasteriser, pictures are refused; a display list that does not validate is refused", async () => {
    const { page } = connect();
    await expect(page.call("run", job("png"))).rejects.toThrow(/pictures cannot be drawn here/);
    LISTS.push({ slide: 2, dl: { nodes: [{ t: "rect", x: NaN, y: 0, w: 1, h: 1 }] as unknown as DisplayList, images: {} } });
    try { await expect(page.call("run", job("pdf"))).rejects.toThrow(/could not be drawn: slide 3/); }
    finally { LISTS.pop(); }
  });
});
