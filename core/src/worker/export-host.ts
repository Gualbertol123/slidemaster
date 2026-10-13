/* An export worker's work (PLAN S3.7, Part B §4): one export job at a time – the slides of one design and version as
   a vector PDF, a PDF of pictures, or PNG files. The display lists come straight from the core worker on a channel of
   their own (never through the page's main thread); fonts and pictures the worker cannot read itself are asked of the
   page. Transport-free like CoreHost: workers/export.worker.ts connects it to postMessage and gives it a rasteriser
   (OffscreenCanvas); tests connect it in one thread. */
import { Port, transfer, type Wire } from "../rpc/port";
import type { ExportCoreMethods, ExportJob, ExportMethods, ExportPageMethods, ExportResult, SlideList } from "../rpc/messages";
import { validate, type DisplayList } from "../dl/types";
import { writePdf } from "../pdf/writer";
import { isJpeg, isPng } from "../pdf/png";
import { FontRegistry } from "../text/fonts";
import { FontResolver, type CatalogFont } from "../text/resolve";
import { prepareTextForPdf } from "../text/pdf";
import { pdfSubsetter } from "../text/subset";

export type ExportPort = Port<ExportMethods, ExportPageMethods, Record<string, never>, Record<string, never>>;
export type ExportCorePort = Port<Record<string, never>, ExportCoreMethods, Record<string, never>, Record<string, never>>;

/** draws pages as opaque PNGs (white under the slide) at `scale` pixels per slide px */
export interface Rasterizer {
  pages(pages: DisplayList[], images: Map<string, Uint8Array>, scale: number, fonts: { library: CatalogFont[]; bytes: (f: CatalogFont) => Promise<Uint8Array | null> }): Promise<Uint8Array[]>;
}
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
      p.catch(() => this.pictures.delete(src));
    }
    return p;
  }

  async run(job: ExportJob): Promise<ExportResult> {
    if (!this.core) throw new Error("the export worker is not connected to the workbook");
    const t0 = now();
    const { kind, scale, title, catalog, ...req } = job;
    const lists: SlideList[] = await this.core.call("slideLists", req);
    if (!lists.length) throw new Error("nothing to export");
    const pages = lists.map(l => l.dl.nodes);
    // the export path checks what the designs hand it (the writer itself does not validate, core/pdf/README.md)
    const bad = pages.flatMap((p, i) => validate(p, `slide ${lists[i].slide + 1}`));
    if (bad.length) throw new Error("the slides could not be drawn: " + bad.slice(0, 3).join("; "));
    const srcs = new Map<string, string>();
    for (const l of lists) for (const [id, src] of Object.entries(l.dl.images)) srcs.set(id, src);
    const images = new Map<string, Uint8Array>();
    await Promise.all([...srcs].map(async ([id, src]) => { const b = await this.picture(src); if (b) images.set(id, b); }));
    const t1 = now();

    if (kind === "pdf") {
      const { pages: resolved, missing, unreadable } = await this.resolverFor(catalog).resolve(pages);
      const shaped = await prepareTextForPdf(resolved, this.fonts);
      const t2 = now();
      const bytes = writePdf({ pages: shaped, image: id => images.get(id), font: this.fonts.pdfFace, subset: await pdfSubsetter(), title });
      return { files: [own(bytes)], missing, unreadable, ms: { lists: t1 - t0, fonts: t2 - t1, write: now() - t2 } };
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
