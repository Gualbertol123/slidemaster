/* The page's end of the core worker (PLAN S2.4): a classic worker started from a Blob URL – its code is inlined
   into the one-file page at build time (vite.config.ts, "virtual:core-worker"), so it also runs from file://.
   Where no worker can start (tests in jsdom, a browser that refuses), the same host runs in this thread behind the
   same messages. */
import WORKER_SRC from "virtual:core-worker";
import { Port, pair, type Wire } from "@slide-builder/core/rpc/port";
import { serve } from "@slide-builder/core/worker/host";
import type { CoreEvents, CoreMethods, PageEvents, PageMethods } from "@slide-builder/core/rpc/messages";

export type CorePort = Port<PageMethods, CoreMethods, CoreEvents, PageEvents>;
export interface CoreConnection { port: CorePort; worker: Worker | null }

export function connectCore(src: string = WORKER_SRC): CoreConnection {
  if (src && typeof Worker !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const worker = new Worker(url);                       // classic (a module Blob worker fails from file://, PROGRESS S0.6)
      worker.addEventListener("error", e => console.error("core worker:", e.message));
      return { port: new Port(worker as unknown as Wire), worker };
    } catch (e) { console.warn("core worker unavailable, running in the page:", e); }
  }
  const [page, core] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(core));
  return { port: new Port(page), worker: null };
}
