import { describe, expect, it, vi } from "vitest";
import { DocSync } from "../src/sync/docsync";
import { applyOps, emptyDoc } from "../src/model/ops";
import type { Backend } from "../src/sync/api";
import type { Op, WorkbookDoc } from "../src/model/types";

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
    const seen: (string | undefined)[] = []; b.on(c => { if (!c.local) seen.push(c.by); });
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
