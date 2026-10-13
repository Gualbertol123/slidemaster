/* The page's end of the export workers (PLAN S3.7, Part B §4): up to three, started on the first export from the
   same script as the core worker (name "sb-export"), each linked to the core worker by a channel of its own so the
   display lists go from one worker to the other without passing through this thread. A job waits for a free worker;
   the workers stop after a minute without exports (the fonts they hold are a few MB each). Exports need workers
   (every supported browser has them, also from file://): an export host in this thread would put the PDF writer and
   HarfBuzz into the page a second time. */
import WORKER_SRC from "virtual:core-worker";
import { Port, transfer, type Wire } from "@slide-builder/core/rpc/port";
import type { ExportJob, ExportMethods, ExportPageMethods, ExportResult } from "@slide-builder/core/rpc/messages";
import type { CorePort } from "./client";

export type ExportPort = Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>;
interface Slot { port: ExportPort; worker: Worker; ready: Promise<void>; busy: boolean; link: number }

export const MAX_EXPORT_WORKERS = 3;
const IDLE_MS = 60_000;

export class ExportPool {
  private slots: Slot[] = [];
  private waiting: { ok: (s: Slot) => void; no: (e: unknown) => void }[] = [];
  private idle: ReturnType<typeof setTimeout> | null = null;
  private links = 0; private watching: CorePort | null = null;
  constructor(private readonly core: () => CorePort, private readonly page: { [K in keyof ExportPageMethods]: (a: Parameters<ExportPageMethods[K]>[0]) => Promise<ReturnType<ExportPageMethods[K]>> | ReturnType<ExportPageMethods[K]> }, private readonly src: string = WORKER_SRC) {}

  /** how many workers are running (tests, the bench) */
  get size() { return this.slots.length; }

  private start(): Slot {
    if (!this.src || typeof Worker === "undefined" || typeof MessageChannel === "undefined") throw new Error("this browser cannot run the export (no workers)");
    // the core worker stopped: every export waiting for its display lists fails at once instead of waiting for ever
    const core = this.core();
    if (this.watching !== core) { this.watching = core; core.onClose(e => { for (const s of [...this.slots]) this.drop(s, e.message); }); }
    const url = URL.createObjectURL(new Blob([this.src], { type: "text/javascript" }));
    const worker = new Worker(url, { name: "sb-export" });            // classic, as the core worker (works from file://)
    URL.revokeObjectURL(url);
    const port: ExportPort = new Port(worker as unknown as Wire), ch = new MessageChannel();
    // an export worker that stops (out of memory on a huge deck) fails its job; the next export starts a new one
    worker.addEventListener("error", e => { e.preventDefault(); this.drop(slot, e.message || "error"); });
    worker.addEventListener("messageerror", () => this.drop(slot, "a message could not be read"));
    const link = ++this.links;
    const ready = Promise.all([
      core.call("linkExport", transfer({ id: link, port: ch.port1 }, [ch.port1])),
      port.call("linkCore", transfer({ port: ch.port2 }, [ch.port2])),
    ]).then(() => undefined);
    // a worker that could not be linked is dropped (its job fails; the next job starts another)
    ready.catch(e => this.drop(slot, (e as Error).message || "not linked"));
    port.handle("fontFile", a => this.page.fontFile(a));
    port.handle("pictureBytes", a => this.page.pictureBytes(a));
    const slot: Slot = { port, worker, ready, busy: false, link };
    this.slots.push(slot);
    return slot;
  }
  /** a worker stops (crashed, not linked, idle, or the core stopped): its job fails, the core forgets its channel */
  private drop(slot: Slot, why: string) {
    if (!this.slots.includes(slot)) return;
    this.slots = this.slots.filter(s => s !== slot);
    slot.port.close(new Error("The export stopped (" + why + ")"));
    slot.worker.terminate();
    const core = this.core();
    if (!core.closed) core.call("unlinkExport", { id: slot.link }).catch(() => undefined);
  }
  private acquire(): Promise<Slot> {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    const free = this.slots.find(s => !s.busy && !s.port.closed);
    const slot = free || (this.slots.length < MAX_EXPORT_WORKERS ? this.start() : null);
    if (slot) { slot.busy = true; return Promise.resolve(slot); }
    return new Promise((ok, no) => this.waiting.push({ ok, no }));
  }
  private release(slot: Slot) {
    slot.busy = false;
    const next = this.waiting.shift();
    if (next) {
      // the next job takes this worker – or, when it stopped meanwhile, a new one (busy at once, so no other job takes it)
      let s = slot;
      if (s.port.closed) {
        this.slots = this.slots.filter(x => x !== s);
        // a new worker that cannot start fails the waiting job instead of leaving it waiting for ever
        try { s = this.start(); } catch (e) { next.no(e); this.release(slot); return; }
      }
      s.busy = true; next.ok(s); return;
    }
    if (this.slots.every(s => !s.busy)) this.idle = setTimeout(() => this.stopAll(), IDLE_MS);
  }
  stopAll() {
    for (const s of [...this.slots]) if (!s.busy) this.drop(s, "idle");
  }
  /** one job on the next free worker */
  /** where the last job's time went, ms: waiting for a worker and its link, then the worker's own phases */
  last: { start: number } & Partial<ExportResult["ms"]> = { start: 0 };
  async run(job: ExportJob): Promise<ExportResult> {
    const t0 = performance.now(), slot = await this.acquire();
    try {
      await slot.ready;
      const start = performance.now() - t0, r = await slot.port.call("run", job);
      this.last = { start, ...r.ms };
      return r;
    } finally { this.release(slot); }
  }
}
