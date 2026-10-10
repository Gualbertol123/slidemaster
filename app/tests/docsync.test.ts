import { describe, expect, it, vi } from "vitest";
import { DocSync, type Change } from "../src/sync/docsync";
import { applyOps, emptyDoc } from "@slide-builder/core/model/ops";
import type { Backend } from "../src/sync/api";
import type { Op, WorkbookDoc } from "@slide-builder/core/model/types";

/** an in-memory helper: applies ops to the latest document, like backend/slidebuilder/store.py */
function fakeServer() {
  let doc: WorkbookDoc = emptyDoc("W.xlsx"); let fail = 0;
  const api = (user: string) => ({
    served: true,
    async getDoc(_n: string, since?: number) { return since === doc.rev ? null : JSON.parse(JSON.stringify(doc)); },
    async postOps(_n: string, ops: Op[]) {
      if (fail > 0) { fail--; throw new Error("503 lock busy"); }
      const r = applyOps(doc, ops); if (r.applied) { r.doc.rev = doc.rev + 1; r.doc.updatedBy = user; r.doc.log = [...(doc.log || []), { rev: r.doc.rev, by: user, at: 0 }].slice(-20); } doc = r.doc;
      return { doc: JSON.parse(JSON.stringify(doc)), applied: r.applied, skipped: r.skipped };
    },
  }) as unknown as Backend;
  return { api, get doc() { return doc; }, failNext(n: number) { fail = n; } };
}
const cell = (ref: string, patch: Record<string, unknown>): Op => ({ op: "cell.patch", sheet: "S", ref, patch } as Op);

describe("DocSync", () => {
  it("two users editing different cells: both edits survive and both see them", async () => {
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    const b = new DocSync(srv.api("bob"), "W.xlsx", emptyDoc("W.xlsx"), "cb", "bob");
    a.apply([cell("A1", { b: true })]); b.apply([cell("B2", { fill: "#34C759" })]);
    await a.flush(); await b.flush(); await a.poll();
    expect(srv.doc.edits.S).toEqual({ A1: { b: true }, B2: { fill: "#34C759" } });
    expect(a.view.edits).toEqual(srv.doc.edits); expect(b.view.edits).toEqual(srv.doc.edits);
    expect(srv.doc.rev).toBe(2);
  });
  it("listeners hear about the save as soon as it is on the share, not at the next poll (B6)", async () => {
    vi.useFakeTimers();
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    const seen: { state: string; c: Change }[] = [];
    a.on(c => seen.push({ state: a.state, c }));
    a.apply([cell("A1", { b: true })]);
    expect(seen.map(x => x.state)).toEqual(["pending"]);
    await vi.advanceTimersByTimeAsync(300);                     // the debounced save runs and returns
    expect(a.state).toBe("saved");
    expect(seen.map(x => x.state)).toEqual(["pending", "saving", "saved"]);     // "Saving…" is announced too
    for (const x of seen.slice(1)) expect([x.c.stateChanged, x.c.local, x.c.editsChanged, x.c.presetChanged, x.c.styleChanged]).toEqual([true, false, false, false, false]);
    // a failed save is announced at once too, and so is the successful retry
    srv.failNext(1);
    a.apply([cell("A2", { i: true })]);
    await vi.advanceTimersByTimeAsync(300);
    expect(a.state).toBe("error"); expect(seen.at(-1)!.state).toBe("error"); expect(seen.at(-1)!.c.stateChanged).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(a.state).toBe("saved"); expect(seen.at(-1)!.state).toBe("saved");
    // a poll that brings nothing new announces nothing
    const n = seen.length; await a.poll(); expect(seen.length).toBe(n);
    vi.useRealTimers();
  });
  it("a failed save keeps the changes queued and retries", async () => {
    vi.useFakeTimers();
    const srv = fakeServer(); srv.failNext(1);
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    a.apply([cell("A1", { sz: 20 })]);
    await a.flush();
    expect(a.state).toBe("error"); expect(a.view.edits.S.A1.sz).toBe(20); expect(srv.doc.rev).toBe(0);
    await vi.advanceTimersByTimeAsync(2100);
    expect(a.state).toBe("saved"); expect(srv.doc.edits.S.A1.sz).toBe(20);
    vi.useRealTimers();
  });
  it("local changes made while a save is in flight are kept on top of the server version", async () => {
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    a.apply([cell("A1", { b: true })]);
    const p = a.flush();
    a.apply([cell("A2", { i: true })]);                      // typed while the first batch is on the way
    await p;
    expect(a.view.edits.S).toEqual({ A1: { b: true }, A2: { i: true } });
    await a.flush();
    expect(srv.doc.edits.S).toEqual({ A1: { b: true }, A2: { i: true } });
  });
  it("undo (inverse ops) does not revert another user's later change to the same document", async () => {
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    const b = new DocSync(srv.api("bob"), "W.xlsx", emptyDoc("W.xlsx"), "cb", "bob");
    const inv = a.apply([cell("A1", { b: true })])!; await a.flush();
    await b.poll(); b.apply([cell("C3", { text: "x", orig: "y" })]); await b.flush();
    a.apply(inv); await a.flush();
    expect(srv.doc.edits.S).toEqual({ C3: { text: "x", orig: "y" } });
  });
  it("a change by someone else that arrives with my own save is still attributed to them", async () => {
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    const b = new DocSync(srv.api("bob"), "W.xlsx", emptyDoc("W.xlsx"), "cb", "bob");
    // remote document changes (save-state notices, e.g. "Saving…", change no document and name nobody)
    const seen: (string | undefined)[] = []; b.on(c => { if (!c.local && (c.editsChanged || c.presetChanged || c.styleChanged)) seen.push(c.by); });
    a.apply([cell("A1", { b: true })]); await a.flush();
    b.apply([cell("B2", { b: true })]); await b.flush();          // bob never polled: anna's edit comes with his save
    expect(seen).toEqual(["anna"]); expect(b.view.edits.S.A1).toEqual({ b: true });
  });
  it("remote changes are reported with the author", async () => {
    const srv = fakeServer();
    const a = new DocSync(srv.api("anna"), "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    const b = new DocSync(srv.api("bob"), "W.xlsx", emptyDoc("W.xlsx"), "cb", "bob");
    const seen: (string | undefined)[] = []; a.on(c => seen.push(c.by));
    b.apply([{ op: "style.patch", patch: { design: "excel" } } as Op]); await b.flush();
    await a.poll();
    expect(seen).toEqual(["bob"]); expect(a.view.style.design).toBe("excel");
  });
});

describe("DocSync after Slide Builder was updated", () => {
  it("a helper with other data formats (409): no retries, the page asks to reload, the change is not written", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const api = { served: true, async getDoc() { return null; }, async postOps() { calls++; throw Object.assign(new Error("Slide Builder was updated - reload the page (F5)"), { status: 409 }); } } as unknown as Backend;
    const a = new DocSync(api, "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    a.apply([cell("A1", { b: true })]);
    await a.flush();
    expect(a.state).toBe("outdated"); expect(a.error).toMatch(/reload/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    vi.useRealTimers();
  });
  it("a document in a newer format is not applied", async () => {
    const newer = { ...emptyDoc("W.xlsx"), rev: 5, schema: 99 };
    const api = { served: true, async getDoc() { return newer; }, async postOps() { throw new Error("x"); } } as unknown as Backend;
    const a = new DocSync(api, "W.xlsx", emptyDoc("W.xlsx"), "ca", "anna");
    await a.poll();
    expect(a.state).toBe("outdated"); expect(a.server.rev).toBe(0);
  });
});
