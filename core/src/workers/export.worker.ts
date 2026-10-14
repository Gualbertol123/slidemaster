/* An export worker (PLAN S3.7): the same script as the core worker (workers/main.ts), started under the name
   "sb-export", so the page carries HarfBuzz once. It writes PDFs and PNGs from display lists (worker/export-host.ts);
   pages as pictures are drawn here on an OffscreenCanvas. */
import { Port, type Wire } from "../rpc/port";
import { ExportHost, type Rasterizer } from "../worker/export-host";
import { drawDl, type Ctx } from "../dl/canvas";
import { cssFamilies, type CatalogFont } from "../text/resolve";
import type { DisplayList, Node } from "../dl/types";
import type { ExportMethods, ExportPageMethods } from "../rpc/messages";

type Scope = Wire & { fonts?: { add(f: FontFace): unknown }; addEventListener(t: string, f: (e: { message?: string; reason?: unknown; error?: unknown; preventDefault(): void }) => void): void };

/** the library families the pages draw with, loaded into this worker's fonts once (system fonts are there already) */
function libraryFonts(scope: Scope) {
  const added = new Set<string>();
  /** true: every library face the pages use is loaded (a face that could not be read is tried again next time) */
  return async (pages: DisplayList[], library: CatalogFont[], bytes: (f: CatalogFont) => Promise<Uint8Array | null>): Promise<boolean> => {
    if (!library.length || !scope.fonts) return true;
    let complete = true;
    const used = new Set<string>();
    const scan = (n: Node) => { if (n.t === "group") n.children.forEach(scan); else if (n.t === "text") for (const f of cssFamilies(n.css || n.font)) used.add(f.toLowerCase()); };
    pages.forEach(p => p.forEach(scan));
    await Promise.all(library.filter(f => used.has(f.family.toLowerCase()) && !added.has(f.file)).map(async f => {
      added.add(f.file);
      const b = await bytes(f).catch(() => null);
      if (!b) { added.delete(f.file); complete = false; return; }
      try {
        const face = new FontFace(f.family, b as BufferSource, { weight: String(f.weight), style: f.italic ? "italic" : "normal" });
        scope.fonts!.add(await face.load());
      } catch { /* the page's fallback family draws it, as on screen when a font file is broken */ }
    }));
    return complete;
  };
}

/** pages drawn as the page paints them: the slide opaque, each table (a group after its "tw" hit area, scaled by CSS
    on screen, so composited apart) on a layer of its own, as tools/dlparity.mjs draws them. `done` takes each page
    from the canvas (a PNG, or a thumbnail's bitmap) */
async function drawPages<T>(pages: DisplayList[], images: Map<string, Uint8Array>, scale: number, done: (canvas: OffscreenCanvas) => Promise<T>): Promise<T[]> {
  const W = Math.round(1600 * scale), H = Math.round(900 * scale);
  const decoded = new Map<string, ImageBitmap>();
  await Promise.all([...images].map(async ([id, b]) => {
    try { decoded.set(id, await createImageBitmap(new Blob([b as BlobPart]))); } catch { /* left out, as a broken picture */ }
  }));
  const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d", { alpha: false }) as unknown as Ctx;
  const table = new OffscreenCanvas(W, H), tctx = table.getContext("2d") as unknown as Ctx;
  const opts = { image: (id: string) => decoded.get(id), layer: () => { const o = new OffscreenCanvas(W, H); return { ctx: o.getContext("2d") as unknown as Ctx, image: o }; } };
  const out: T[] = [];
  try {
    for (const nodes of pages) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      nodes.forEach((n, i) => {
        const prev = nodes[i - 1];
        if (n.t === "group" && prev?.t === "hit" && prev.id === "tw") {
          tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, W, H); tctx.setTransform(scale, 0, 0, scale, 0, 0);
          drawDl(tctx, [n], opts);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(table, 0, 0); ctx.setTransform(scale, 0, 0, scale, 0, 0);
        } else drawDl(ctx, [n], opts);
      });
      out.push(await done(canvas));
    }
  } finally { for (const b of decoded.values()) b.close(); }
  return out;
}
function offscreenRaster(scope: Scope): Rasterizer {
  const loadFonts = libraryFonts(scope);
  return {
    async pages(pages, images, scale, fonts) {
      await loadFonts(pages, fonts.library, fonts.bytes);
      return drawPages(pages, images, scale, async canvas => new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()));
    },
    async bitmaps(pages, images, width, fonts) {
      const complete = await loadFonts(pages, fonts.library, fonts.bytes);
      // a copy each (transferToImageBitmap would take the shared canvas's pixels away)
      return { bitmaps: await drawPages(pages, images, width / 1600, canvas => createImageBitmap(canvas)), complete };
    },
  };
}

export function startExport(scope: Scope) {
  const port = new Port<ExportMethods, ExportPageMethods, Record<string, never>, Record<string, never>>(scope);
  new ExportHost(port, { raster: typeof OffscreenCanvas !== "undefined" ? offscreenRaster(scope) : undefined });
  // an error outside a call is logged by the page (worker "error" event); calls answer with their own errors
}
