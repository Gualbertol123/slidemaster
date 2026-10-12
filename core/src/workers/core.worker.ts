/* The core worker (PLAN S2.4): a classic worker, built into the page as a Blob URL (app/vite.config.ts). It owns the
   workbook, the shared document and undo/redo (worker/host.ts); what only the page has – the page's fonts for
   Excel's digit width, picture decoding (SVG), the helper's API – it asks the page for. */
import { Port, type Wire } from "../rpc/port";
import { serve } from "../worker/host";
import { staticFace } from "../text/static";
import { setPlatform } from "../platform";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "../rpc/messages";
import type { CanvasFactory, Ctx2D } from "../platform";

/** canvases in the worker (the Liquid Glass wallpaper, PLAN S3.4), where OffscreenCanvas exists; else none, as before */
function offscreenCanvas(): CanvasFactory | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const dataUrl = async (blob: Blob) => {
    const b = new Uint8Array(await blob.arrayBuffer()); let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(s)}`;
  };
  return {
    create(w, h, opts) {
      const c = new OffscreenCanvas(w, h), ctx = c.getContext("2d", opts) as Ctx2D | null;
      if (!ctx) return null;
      return { ctx, image: c, toDataURL: (type, quality) => c.convertToBlob({ type, quality }).then(dataUrl) };
    },
    async decode(src) { const bmp = await createImageBitmap(await (await fetch(src)).blob()); return { image: bmp, width: bmp.width, height: bmp.height }; },
  };
}

const scope = self as unknown as Wire & { addEventListener(t: string, f: (e: { message?: string; reason?: unknown; error?: unknown; preventDefault(): void }) => void): void };
const port = new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(scope);
// text boxes are fitted by the page (Decision 3): the display list asks fitNotes in batches; noteFits itself (one size
// at a time, synchronous) is not used in the worker
setPlatform({
  text: {
    maxDigitWidth: font => port.call("digitWidth", { font }), noteFits: () => true,
    measureRuns: runs => port.call("measureRuns", { runs }), breakLines: reqs => port.call("breakLines", { reqs }), fitNotes: reqs => port.call("fitNotes", { reqs }),
  },
  canvas: offscreenCanvas(),
  images: srcs => port.call("analyzeImages", { srcs }),
});
const report = (e: unknown) => port.emit("error", { message: String((e as Error)?.message || e), stack: (e as Error)?.stack });
// reported to the page, which shows it; the worker keeps running (an error reaching the page means it stopped)
scope.addEventListener("error", e => { report(e.error || e.message); e.preventDefault(); });
scope.addEventListener("unhandledrejection", e => report(e.reason));
serve(port, { staticFace });
