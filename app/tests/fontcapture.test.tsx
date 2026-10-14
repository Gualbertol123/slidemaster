/* W13 in the page (state/fontfiles.ts): every Windows font file the workers read is captured once by the helper; another
   PC's build is named in the side panel (fingerprint mode); in copy mode the family the helper copied comes back with
   the library. The helper is a stubbed fetch; the page is "served" (a token in the page, as the helper injects it). */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const meta = document.createElement("meta");
meta.name = "sb-token"; meta.content = "test-token";
document.head.appendChild(meta);
type Mods = { files: typeof import("../src/state/fontfiles"); store: typeof import("../src/state/store"); chrome: typeof import("../src/ui/Chrome") };
let M: Mods;
beforeAll(async () => {
  M = { files: await import("../src/state/fontfiles"), store: await import("../src/state/store"), chrome: await import("../src/ui/Chrome") };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
/** a helper: font bytes for /sysfonts/<file>, the capture's answer, the library */
function helper(capture: (file: string) => unknown, library: unknown[] = []) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    calls.push(url);
    if (url.startsWith("/sysfonts/") || url.startsWith("/fonts/")) return Promise.resolve(new Response(new Uint8Array([0, 1, 0, 0]), { status: 200 }));
    if (url.startsWith("/api/fonts/capture")) return json(capture(decodeURIComponent(url.split("file=")[1])));
    if (url.startsWith("/api/fonts")) return json({ fonts: library });
    return Promise.reject(new Error("unexpected " + url));
  }));
  return calls;
}
/** past the quiet time the captures wait for (fake timers: the test sets them) */
const settle = () => vi.advanceTimersByTimeAsync(M.files.CAPTURE_QUIET_MS + 50);

describe("Windows fonts captured (W13)", () => {
  it("a capture waits until the workers have asked for no font for a while (a deck's first slide waits for its files)", async () => {
    const { files } = M;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = helper(() => ({ mode: "fingerprint", family: "Arial", sha1: "a", otherHosts: [] }));
    await files.fontFile({ source: "system", file: "arial.ttf" });
    await vi.advanceTimersByTimeAsync(files.CAPTURE_QUIET_MS - 500);
    await files.fontFile({ source: "system", file: "arialbd.ttf" });                   // another font file: the quiet time starts again
    await vi.advanceTimersByTimeAsync(files.CAPTURE_QUIET_MS - 500);
    expect(calls.filter(u => u.startsWith("/api/fonts/capture"))).toEqual([]);
    await settle();
    expect(calls.filter(u => u.startsWith("/api/fonts/capture"))).toEqual(["/api/fonts/capture?file=arial.ttf", "/api/fonts/capture?file=arialbd.ttf"]);
  });
  it("fingerprint mode: another PC's build is named in the side panel, once per file; this PC is not", async () => {
    const { files, store } = M;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    store.patch("prefs", { host: "pc-me" });
    const calls = helper(() => ({ mode: "fingerprint", family: "Calibri", sha1: "a", otherHosts: ["pc-bob", "pc-me"] }));
    expect(await files.fontFile({ source: "system", file: "calibri.ttf" })).not.toBeNull();
    await settle();
    expect(store.get().ui.fontBuilds).toEqual([{ family: "Calibri", hosts: ["pc-bob"] }]);
    await files.fontFile({ source: "system", file: "calibri.ttf" }); await settle();
    expect(calls.filter(u => u.startsWith("/api/fonts/capture"))).toHaveLength(1);       // once per file
    await files.fontFile({ source: "library", file: "x.ttf" }); await settle();
    expect(calls.filter(u => u.startsWith("/api/fonts/capture"))).toHaveLength(1);       // library files are not captured
    // the side panel (with a slide to show)
    store.patch("deck", { slides: [{ id: "s", type: "content", tables: [], missing: 0, title: "T", subtitle: "", label: "T", cfg: { id: "s", type: "content", tables: [] } }] as never, cur: 0 });
    const { container } = render(<M.chrome.Issues />);
    expect(container.querySelector('[data-font="Calibri"]')?.textContent).toBe("Calibri on this PC is another version than on pc-bob: slides may lay out a little differently there");
  });
  it("the same build everywhere: nothing to say", async () => {
    const { files, store } = M;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    helper(() => ({ mode: "fingerprint", family: "Cambria", sha1: "a", otherBuilds: [], otherHosts: [] }));
    await files.fontFile({ source: "system", file: "cambria.ttf" }); await settle();
    expect(store.get().ui.fontBuilds.map(f => f.family)).not.toContain("Cambria");
  });
  it("copy mode: the family the helper copied comes back with the library, and every PC draws it from there", async () => {
    const { files, store } = M;
    const carlito = { family: "Carlito", source: "system", faces: [{ file: "Carlito-400-a.ttf", weight: 400, style: "normal" }] };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = helper(() => ({ mode: "copy", copied: true, copiedFaces: 1, added: 1, family: "Carlito", sha1: "b", otherHosts: [] }), [carlito]);
    await files.fontFile({ source: "system", file: "carlito.ttf" });
    await settle(); await settle();
    expect(store.get().doc.fonts.map(f => [f.family, f.source])).toEqual([["Carlito", "system"]]);
    expect(calls).toContain("/api/fonts");
    // matched as Windows matches it (nearest weight), not by CSS: the copied flag (resolve.ts pickFace)
    expect(files.libraryCatalog()).toEqual([{ source: "library", file: "Carlito-400-a.ttf", family: "Carlito", weight: 400, italic: false, copied: true }]);
  });
});
