/* An export worker's work (PLAN S3.7, Part B §4): one export job at a time – the slides of one design and version as
   a vector PDF, a PDF of pictures, or PNG files. The display lists come straight from the core worker on a channel of
   their own (never through the page's main thread); fonts and pictures the worker cannot read itself are asked of the
   page. Transport-free like CoreHost: workers/export.worker.ts connects it to postMessage and gives it a rasteriser
   (OffscreenCanvas); tests connect it in one thread. */
import { Port, transfer, type Wire } from "../rpc/port";
import type { ExportCoreMethods, ExportJob, ExportMethods, ExportPageMethods, ExportResult, SlideList, Thumb, ThumbJob } from "../rpc/messages";
import { contentKey } from "../dl/key";
import { validate, type DisplayList } from "../dl/types";
import { writePdf } from "../pdf/writer";
import { isJpeg, isPng } from "../pdf/png";
import { FontRegistry } from "../text/fonts";
import { FontResolver, pptxFamily, type CatalogFont } from "../text/resolve";
import { writePptx } from "../pptx/writer";
import { DESIGN_LABEL } from "../model/designs";
import { prepareTextForPdf } from "../text/pdf";
import { pdfSubsetter } from "../text/subset";

export type ExportPort = Port<ExportMethods, ExportPageMethods, Record<string, never>, Record<string, never>>;
export type ExportCorePort = Port<Record<string, never>, ExportCoreMethods, Record<string, never>, Record<string, never>>;

/** draws pages as opaque PNGs (white under the slide) at `scale` pixels per slide px */
export interface Rasterizer {
  pages(pages: DisplayList[], images: Map<string, Uint8Array>, scale: number, fonts: RasterFonts): Promise<Uint8Array[]>;
  /** the same pages as pictures `width` px wide, kept in memory (thumbnails, S4.3) */
  bitmaps?(pages: DisplayList[], images: Map<string, Uint8Array>, width: number, fonts: RasterFonts): Promise<{ bitmaps: ImageBitmap[]; /** every library face loaded */ complete: boolean }>;
}
export interface RasterFonts { library: CatalogFont[]; bytes: (f: CatalogFont) => Promise<Uint8Array | null> }
export interface ExportHostOptions { raster?: Rasterizer }

/** the bytes of a data: URL (base64 or percent-encoded) */
export function dataUrlBytes(src: string): Uint8Array {
  const i = src.indexOf(","), head = src.slice(0, i), body = src.slice(i + 1);
  const bin = head.includes(";base64") ? atob(body) : unescape(body.replace(/%(?![0-9a-f]{2})/gi, "%25"));
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k) & 255;
  return out;
}
/** the bytes as an ArrayBuffer of their own (to transfer) */
const own = (b: Uint8Array) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer) as ArrayBuffer;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class ExportHost {
  private core: ExportCorePort | null = null;
  /** font files read so far (they do not change while the page is open), by source + file */
  private files = new Map<string, Promise<Uint8Array | null>>();
  /** faces and the resolver of the current catalog (a new library font starts both again) */
  private fonts = new FontRegistry(); private resolver: FontResolver | null = null; private catalogSig = "";
  /** pictures by source (wallpapers and logos repeat between jobs) */
  private pictures = new Map<string, Promise<Uint8Array | null>>();

  constructor(private readonly page: ExportPort, private readonly opts: ExportHostOptions = {}) {
    page.handle("linkCore", a => { this.link(new Port(a.port as unknown as Wire)); });
    page.handle("run", async a => { const r = await this.run(a); return transfer(r, r.files); });
    page.handle("thumbs", async a => { const r = await this.thumbs(a); return transfer(r, r.flatMap(t => t.bitmap ? [t.bitmap] : [])); });
  }
  /** the channel to the core worker (tests pass a port of their own) */
  link(core: ExportCorePort) { this.core = core; }

  private fontBytes = (f: CatalogFont) => {
    const k = f.source + "|" + f.file;
    let p = this.files.get(k);
    if (!p) {
      p = this.page.call("fontFile", { source: f.source, file: f.file }).then(b => b ? new Uint8Array(b) : null);
      this.files.set(k, p);
      p.catch(() => this.files.delete(k));
    }
    return p;
  };
  private resolverFor(catalog: CatalogFont[]) {
    const sig = JSON.stringify(catalog);
    if (!this.resolver || sig !== this.catalogSig) {
      this.fonts = new FontRegistry(); this.catalogSig = sig;
      this.resolver = new FontResolver(catalog, this.fonts, this.fontBytes);
    }
    return this.resolver;
  }
  /** a picture as JPEG or PNG bytes (the PDF and the canvas take those); others are converted by the page */
  private picture(src: string): Promise<Uint8Array | null> {
    let p = this.pictures.get(src);
    if (!p) {
      p = (async () => {
        if (/^data:image\/(png|jpeg|jpg)[;,]/i.test(src)) {
          const b = dataUrlBytes(src);
          if (isPng(b) || isJpeg(b)) return b;
        }
        const b = await this.page.call("pictureBytes", { src });
        return b ? new Uint8Array(b) : null;
      })();
      this.pictures.set(src, p);
      // a picture that could not be read is asked for again next time (the helper may have been busy)
      p.then(b => { if (!b) this.pictures.delete(src); }, () => this.pictures.delete(src));
    }
    return p;
  }

  /** the pictures a set of lists draws, as bytes by image id */
  private async images(lists: SlideList[]) {
    const srcs = new Map<string, string>();
    for (const l of lists) for (const [id, src] of Object.entries(l.dl.images)) srcs.set(id, src);
    const images = new Map<string, Uint8Array>();
    await Promise.all([...srcs].map(async ([id, src]) => { const b = await this.picture(src); if (b) images.set(id, b); }));
    return images;
  }

  /** thumbnails (S4.3): the slides' lists from the core worker, drawn as the PNG export draws them; a slide whose list
      is what the page shows already (the same key: the same nodes and pictures at the same width) is not drawn again.
      A slide that cannot be drawn comes with no picture and no key (asked again next time) */
  async thumbs(job: ThumbJob): Promise<Thumb[]> {
    if (!this.core) throw new Error("the export worker is not connected to the workbook");
    const { width, library, have, ...req } = job;
    const lists: SlideList[] = await this.core.call("slideLists", req);
    // the key: the nodes, the pictures, the width and the library's faces (a face added later draws the text again)
    const lib = library.map(f => f.file).join(",");
    const keyed = lists.map(l => ({ l, key: contentKey(l.dl.nodes, "|" + Object.keys(l.dl.images).join(",") + "|" + width + "|" + lib) }));
    const todo = keyed.filter(k => have[k.l.slide] !== k.key && !validate(k.l.dl.nodes, "").length);
    let drawn: { bitmaps: ImageBitmap[]; complete: boolean } = { bitmaps: [], complete: true }, images = new Map<string, Uint8Array>();
    if (todo.length && this.opts.raster?.bitmaps) {
      images = await this.images(todo.map(k => k.l));
      drawn = await this.opts.raster.bitmaps(todo.map(k => k.l.dl.nodes), images, width, { library, bytes: this.fontBytes });
    }
    return keyed.map(k => {
      if (have[k.l.slide] === k.key) return { slide: k.l.slide, key: k.key, bitmap: null };
      const b = drawn.bitmaps[todo.indexOf(k)] ?? null;
      // drawn without a picture or a face it needs: shown, but without a key, so it is drawn again next time
      const whole = drawn.complete && Object.keys(k.l.dl.images).every(id => images.has(id));
      return { slide: k.l.slide, key: b && whole ? k.key : "", bitmap: b };
    });
  }

  async run(job: ExportJob): Promise<ExportResult> {
    if (!this.core) throw new Error("the export worker is not connected to the workbook");
    const t0 = now();
    const { kind, scale, title, catalog, ...req } = job;
    const lists: SlideList[] = await this.core.call("slideLists", kind === "pptx" ? { ...req, pptx: true } : req);
    if (!lists.length) throw new Error("nothing to export");
    const pages = lists.map(l => l.dl.nodes);
    // the export path checks what the designs hand it (the writer itself does not validate, core/pdf/README.md)
    const bad = [...pages.flatMap((p, i) => validate(p, `slide ${lists[i].slide + 1}`)),
      // the PowerPoint export's chart cards and overlays (drawn alone for it) are checked as the lists are
      ...lists.flatMap(l => Object.entries(l.sem?.items || {}).flatMap(([id, it]) => it.kind === "chart" ? [...validate(it.card, `slide ${l.slide + 1} chart ${id}`), ...(it.overlay ? validate(it.overlay, `slide ${l.slide + 1} chart ${id} overlay`) : [])] : []))];
    if (bad.length) throw new Error("the slides could not be drawn: " + bad.slice(0, 3).join("; "));
    const images = await this.images(lists);
    const t1 = now();

    if (kind === "pdf") {
      const { pages: resolved, missing, unreadable } = await this.resolverFor(catalog).resolve(pages);
      const shaped = await prepareTextForPdf(resolved, this.fonts);
      const t2 = now();
      const bytes = writePdf({ pages: shaped, image: id => images.get(id), font: this.fonts.pdfFace, subset: await pdfSubsetter(), title });
      return { files: [own(bytes)], missing, unreadable, ms: { lists: t1 - t0, fonts: t2 - t1, write: now() - t2 } };
    }
    if (kind === "pptx") {
      // PowerPoint (07 §4, B21): native shapes, tables and charts; fonts named (the first family of each list this PC
      // has), not embedded – the deck's library fonts are reported, PowerPoint substitutes them where they are missing
      const resolver = this.resolverFor(catalog), lib = new Set(catalog.filter(f => f.source === "library" && !f.copied).map(f => f.family.toLowerCase()));
      const named = new Map<string, string>(), notEmbedded = new Set<string>();
      const face = (css: string) => {
        let f = named.get(css);
        if (f === undefined) { f = pptxFamily(css, fam => resolver.has(fam)); named.set(css, f); }
        if (lib.has(f.toLowerCase())) notEmbedded.add(f);
        return f;
      };
      const bytes = writePptx({ slides: lists.map(l => ({ nodes: l.dl.nodes, sem: l.sem ?? null })), image: id => images.get(id), face, title, design: DESIGN_LABEL[req.design] || req.design });
      return { files: [own(bytes)], missing: [], notEmbedded: [...notEmbedded], ms: { lists: t1 - t0, fonts: 0, write: now() - t1 } };
    }
    if (!this.opts.raster) throw new Error("pictures cannot be drawn here");
    const library = catalog.filter(f => f.source === "library");
    const pngs = await this.opts.raster.pages(pages, images, scale, { library, bytes: this.fontBytes });
    const t2 = now();
    if (kind === "png") return { files: pngs.map(own), missing: [], ms: { lists: t1 - t0, fonts: 0, write: t2 - t1 } };
    // "as pictures" (B9): one PNG page per slide, passed through as Flate with PNG predictors (pdf/png.ts pngFlate)
    const bytes = writePdf({ pages: pngs.map((_, i) => [{ t: "image", id: "page" + i, x: 0, y: 0, w: 1600, h: 900 }]), image: id => pngs[+id.slice(4)], font: () => undefined, title });
    return { files: [own(bytes)], missing: [], ms: { lists: t1 - t0, fonts: 0, write: now() - t1 } };
  }
}

export function serveExport(page: ExportPort, opts: ExportHostOptions = {}) { return new ExportHost(page, opts); }
