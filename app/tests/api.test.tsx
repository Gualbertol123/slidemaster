/* The helper client (sync/api.ts): a read whose connection drops is asked again once; a write is not (it may have
   arrived). Seen on Windows: a loopback request failing with ERR_CONNECTION_TIMED_OUT left "No workbook" behind an open. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { helper } from "../src/sync/api";

const dropped = () => Promise.reject(new TypeError("Failed to fetch"));
const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("helper client", () => {
  it("a read is asked again once when the connection drops", async () => {
    const fetch = vi.fn().mockImplementationOnce(dropped).mockImplementationOnce(() => answer({ doc: { rev: 7 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await helper.getDoc("report.xlsx")).toEqual({ rev: 7 });
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
    await expect(helper.postOps("report.xlsx", [], "c1")).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("an answer with an error status is not asked again", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "busy" }), { status: 503 })));
    vi.stubGlobal("fetch", fetch);
    await expect(helper.getDoc("report.xlsx")).rejects.toThrow("busy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
