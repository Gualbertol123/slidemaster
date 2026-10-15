/* The helper client (sync/api.ts): a read whose connection drops is asked again once; a write is not (it may have
   arrived). Seen on Windows: a loopback request failing with ERR_CONNECTION_TIMED_OUT left "No workbook" behind an open. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, helper, offline, patchStyleDefault, type Backend } from "../src/sync/api";
import type { ConfigDoc } from "@slide-builder/core/model/types";

const dropped = () => Promise.reject(new TypeError("Failed to fetch"));
const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("helper client", () => {
  it("a read is asked again once when the connection drops", async () => {
    const fetch = vi.fn().mockImplementationOnce(dropped).mockImplementationOnce(() => answer({ snapshot: { gen: 7 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await helper.deckSnapshot("report.xlsx-0123456789")).toEqual({ gen: 7 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("only once: a second drop is the read's error", async () => {
    const fetch = vi.fn().mockImplementation(dropped);
    vi.stubGlobal("fetch", fetch);
    await expect(helper.files()).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("a write is not sent again", async () => {
    const fetch = vi.fn().mockImplementation(dropped);
    vi.stubGlobal("fetch", fetch);
    await expect(helper.deckAppend("report.xlsx-0123456789", "w@pc#abcdefgh", { l: 1, w: "w@pc#abcdefgh", s: 1, ops: [] })).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("an answer with an error status is not asked again", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "busy" }), { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    await expect(helper.deckSnapshot("report.xlsx-0123456789")).rejects.toThrow("busy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("opening a deck is asked again (the same deck either way)", async () => {
    const fetch = vi.fn().mockImplementationOnce(dropped).mockImplementationOnce(() => answer({ key: "k", writer: "w", snapshot: {} }));
    vi.stubGlobal("fetch", fetch);
    expect((await helper.openDeck("report.xlsx")).key).toBe("k");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("the shared defaults: the style is sent with the rev read; never sent again on a drop", async () => {
    const fetch = vi.fn().mockImplementation(() => answer({ doc: { rev: 8 } }));
    vi.stubGlobal("fetch", fetch);
    await helper.configSet(7, { color: 35 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain("/api/config");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ baseRev: 7, style: { color: 35 } });
    fetch.mockImplementation(dropped);
    await expect(helper.configSet(7, { color: 35 })).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("the shared defaults by compare-and-set (patchStyleDefault)", () => {
  const conf = (rev: number, style: object) => ({ schema: 3, rev, updated: 0, updatedBy: "", defaults: { style } }) as unknown as ConfigDoc;
  it("patches the style read and sends it with its rev; somebody first (409): read again and redo", async () => {
    let stored = conf(4, { design: "glass", color: 10, logo: "a.png" });
    const sent: number[] = [];
    let raced = false;
    const b = {
      config: async () => stored,
      configSet: async (rev: number, style: object) => {
        sent.push(rev);
        if (!raced) { raced = true; stored = conf(5, { ...stored.defaults.style, logo: "b.png" }); }   // a colleague, meanwhile
        if (rev !== stored.rev) throw new ApiError(409, "changed meanwhile");
        stored = conf(rev + 1, style); return { doc: stored };
      },
    } as unknown as Backend;
    const doc = await patchStyleDefault(b, { color: 35 });
    expect(sent).toEqual([4, 5]);
    expect(doc.rev).toBe(6);
    expect(doc.defaults.style).toEqual({ design: "glass", color: 35, logo: "b.png" });   // the colleague's logo kept
  });
  it("gives up after 5 tries; other errors at once", async () => {
    let n = 0;
    const b = { config: async () => conf(1, {}), configSet: async () => { n++; throw new ApiError(409, "changed meanwhile"); } } as unknown as Backend;
    await expect(patchStyleDefault(b, { color: 1 })).rejects.toThrow("changed meanwhile");
    expect(n).toBe(5);
    n = 0;
    const c = { config: async () => conf(1, {}), configSet: async () => { n++; throw new ApiError(503, "busy"); } } as unknown as Backend;
    await expect(patchStyleDefault(c, { color: 1 })).rejects.toThrow("busy");
    expect(n).toBe(1);
  });
  it("offline (file://): a stale rev is refused", async () => {
    const c = await offline.config();
    await expect(offline.configSet(c.rev + 1, { color: 2 })).rejects.toMatchObject({ status: 409 });
    const r = await offline.configSet(c.rev, { color: 2 });
    expect(r.doc.rev).toBe(c.rev + 1);
    expect(r.doc.defaults.style).toEqual({ color: 2 });
  });
});
