/* The export workers' pool (app/src/rpc/export.ts, PLAN S3.7): at most three workers, each linked to the core worker
   once, jobs queued while all are busy, a worker that stops replaced for the next job. The workers here are fakes that
   speak the RPC messages (core/src/rpc/port.ts). */
import { afterEach, beforeEach, expect, test } from "vitest";
import { ExportPool, MAX_EXPORT_WORKERS } from "../src/rpc/export";
import type { CorePort } from "../src/rpc/client";
import type { ExportJob } from "@slide-builder/core/rpc/messages";

type Msg = { k: string; id: number; m: string; a: unknown };
class FakeWorker {
  static all: FakeWorker[] = [];
  static running = 0; static most = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  listeners: Record<string, ((e: { message?: string; preventDefault(): void }) => void)[]> = {};
  terminated = false; linked = false; jobs = 0;
  constructor(_url: string, readonly opts: { name?: string }) { FakeWorker.all.push(this); }
  addEventListener(t: string, f: (e: { message?: string; preventDefault(): void }) => void) { (this.listeners[t] ||= []).push(f); }
  terminate() { this.terminated = true; }
  crash() { for (const f of this.listeners.error || []) f({ message: "out of memory", preventDefault() { /* */ } }); }
  postMessage(msg: Msg) {
    const reply = (v: unknown) => setTimeout(() => this.onmessage?.({ data: { k: "ok", id: msg.id, v } }), 0);
    if (msg.m === "linkCore") { this.linked = true; reply(null); return; }
    if (msg.m === "run") {
      this.jobs++; FakeWorker.running++; FakeWorker.most = Math.max(FakeWorker.most, FakeWorker.running);
      const job = msg.a as ExportJob;
      setTimeout(() => { FakeWorker.running--; if (!this.terminated) reply({ files: [], missing: [job.title], ms: { lists: 0, fonts: 0, write: 0 } }); }, 20);
    }
  }
}
const g = globalThis as unknown as { Worker?: unknown };
let saved: unknown;
beforeEach(() => { saved = g.Worker; g.Worker = FakeWorker; FakeWorker.all = []; FakeWorker.running = 0; FakeWorker.most = 0; });
afterEach(() => { g.Worker = saved; });

const links: unknown[] = [];
const fakeCore = { closed: null, onClose: () => () => undefined, call: async (m: string, a: unknown) => { links.push([m, a]); } };
const core = (() => fakeCore) as unknown as () => CorePort;
const page = { fontFile: () => null, pictureBytes: () => null };
const job = (title: string): ExportJob => ({ kind: "pdf", design: "glass", version: "", forExport: true, thumb: false, scale: 2, title, catalog: [] });

test("at most three export workers, named sb-export and each linked to the core worker once; more jobs wait their turn", async () => {
  links.length = 0;
  const pool = new ExportPool(core, page, "/* worker */");
  const out = await Promise.all(["a", "b", "c", "d", "e", "f"].map(t => pool.run(job(t))));
  expect(out.map(r => r.missing[0])).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(MAX_EXPORT_WORKERS).toBe(3);
  expect(FakeWorker.all).toHaveLength(3);
  expect(FakeWorker.most).toBe(3);
  expect(FakeWorker.all.every(w => w.opts.name === "sb-export" && w.linked && w.jobs === 2)).toBe(true);
  expect(links.map(l => (l as [string])[0])).toEqual(["linkExport", "linkExport", "linkExport"]);
  expect(links.map(l => (l as [string, { value: { id: number } }])[1].value.id)).toEqual([1, 2, 3]);   // (a Transfer: the port moves)
  // later jobs reuse the running workers
  await pool.run(job("g"));
  expect(FakeWorker.all).toHaveLength(3);
  links.length = 0;
  pool.stopAll();
  expect(FakeWorker.all.every(w => w.terminated)).toBe(true);
  expect(pool.size).toBe(0);
  expect(links).toEqual([["unlinkExport", { id: 1 }], ["unlinkExport", { id: 2 }], ["unlinkExport", { id: 3 }]]);   // the core closes their channels
});

test("a worker that stops fails its job; the next job gets a new worker", async () => {
  const pool = new ExportPool(core, page, "/* worker */");
  const first = pool.run(job("a"));
  await new Promise(r => setTimeout(r, 5));
  FakeWorker.all[0].crash();
  await expect(first).rejects.toThrow(/The export stopped \(out of memory\)/);
  expect((await pool.run(job("b"))).missing).toEqual(["b"]);
  expect(FakeWorker.all).toHaveLength(2);
  expect(FakeWorker.all[0].terminated).toBe(true);
  pool.stopAll();
});
