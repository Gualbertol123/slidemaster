/* The core worker (PLAN S2.4): a classic worker, built into the page as a Blob URL (app/vite.config.ts). It owns the
   workbook, the shared document and undo/redo (worker/host.ts); what only the page has – the page's fonts for
   Excel's digit width, picture decoding (SVG), the helper's API – it asks the page for. */
import { Port, type Wire } from "../rpc/port";
import { serve } from "../worker/host";
import { staticFace } from "../text/static";
import { setPlatform } from "../platform";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "../rpc/messages";

const scope = self as unknown as Wire & { addEventListener(t: string, f: (e: { message?: string; reason?: unknown; error?: unknown; preventDefault(): void }) => void): void };
const port = new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(scope);
// noteFits stays "fits" here until the slide's notes join the display list (S3.5): Decision 3 has the worker ask the
// page then; today no note size is computed in the worker
setPlatform({
  text: {
    maxDigitWidth: font => port.call("digitWidth", { font }), noteFits: () => true,
    measureRuns: runs => port.call("measureRuns", { runs }), breakLines: reqs => port.call("breakLines", { reqs }),
  },
  canvas: null,
  images: srcs => port.call("analyzeImages", { srcs }),
});
const report = (e: unknown) => port.emit("error", { message: String((e as Error)?.message || e), stack: (e as Error)?.stack });
// reported to the page, which shows it; the worker keeps running (an error reaching the page means it stopped)
scope.addEventListener("error", e => { report(e.error || e.message); e.preventDefault(); });
scope.addEventListener("unhandledrejection", e => report(e.reason));
serve(port, { staticFace });
