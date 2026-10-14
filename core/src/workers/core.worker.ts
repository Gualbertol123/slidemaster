/* The core worker (PLAN S2.4): a classic worker, built into the page as a Blob URL (app/vite.config.ts, workers/main.ts). It owns the
   workbook, the shared document and undo/redo (worker/host.ts); what only the page has – the page's fonts for
   Excel's digit width, picture decoding (SVG), the helper's API – it asks the page for. */
import { Port, type Wire } from "../rpc/port";
import { serve } from "../worker/host";
import { staticFace } from "../text/static";
import { FontMeasurer } from "../text/measure";
import { shaper } from "../text/shape";
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

/** the faces read at start (text/measure.ts prepare) */
const WARM = ["400 11px Calibri", "700 11px Calibri", "400 11px 'Segoe UI'", "600 11px 'Segoe UI'", "700 11px 'Segoe UI'", "400 11px 'Century Gothic'", "700 11px 'Century Gothic'"];
type Scope = Wire & { addEventListener(t: string, f: (e: { message?: string; reason?: unknown; error?: unknown; preventDefault(): void }) => void): void };
export function startCore(scope: Scope) {
  const port = new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(scope);
  // text is measured from font files (S4.4, text/measure.ts): the library's and this PC's, which the page lists and
  // reads; a text none of whose fonts has a readable file is measured by the page, as before S4.4 (decision 2026-10-12, 3)
  const page = {
    maxDigitWidth: (font: string) => port.call("digitWidth", { font }),
    measureRuns: (runs: import("../platform").RunReq[]) => port.call("measureRuns", { runs }), breakLines: (reqs: import("../platform").LinesReq[]) => port.call("breakLines", { reqs }),
  };
  const fonts = { catalog: () => port.call("fontCatalog", {}), bytes: async (f: import("../text/resolve").CatalogFont) => { const b = await port.call("fontFile", { source: f.source, file: f.file }); return b ? new Uint8Array(b) : null; } };
  const text = new FontMeasurer(shaper(), fonts, page);
  // the fonts nearly every deck measures with – Excel's Calibri, the designs' Segoe UI and Century Gothic – read while
  // the page starts, not when the first workbook is opened (their files come from the helper, a few MB)
  setTimeout(() => { void text.prepare(WARM).catch(() => undefined); }, 0);
  setPlatform({
    text,
    canvas: offscreenCanvas(),
    images: srcs => port.call("analyzeImages", { srcs }),
  });
  const report = (e: unknown) => port.emit("error", { message: String((e as Error)?.message || e), stack: (e as Error)?.stack });
  // reported to the page, which shows it; the worker keeps running (an error reaching the page means it stopped)
  scope.addEventListener("error", e => { report(e.error || e.message); e.preventDefault(); });
  scope.addEventListener("unhandledrejection", e => report(e.reason));
  serve(port, { staticFace });
}
