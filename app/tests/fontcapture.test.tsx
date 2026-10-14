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
afterEach(() => vi.unstubAllGlobals());

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
const settle = () => new Promise(r => setTimeout(r, 20));

describe("Windows fonts captured (W13)", () => {
  it("fingerprint mode: another PC's build is named in the side panel, once per file; this PC is not", async () => {
    const { files, store } = M;
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
    helper(() => ({ mode: "fingerprint", family: "Cambria", sha1: "a", otherBuilds: [], otherHosts: [] }));
    await files.fontFile({ source: "system", file: "cambria.ttf" }); await settle();
    expect(store.get().ui.fontBuilds.map(f => f.family)).not.toContain("Cambria");
  });
  it("copy mode: the family the helper copied comes back with the library, and every PC draws it from there", async () => {
    const { files, store } = M;
    const carlito = { family: "Carlito", source: "system", faces: [{ file: "Carlito-400-a.ttf", weight: 400, style: "normal" }] };
    const calls = helper(() => ({ mode: "copy", copied: true, faces: 1, family: "Carlito", sha1: "b", otherHosts: [] }), [carlito]);
    await files.fontFile({ source: "system", file: "carlito.ttf" });
    await vi.waitFor(() => expect(store.get().doc.fonts.map(f => [f.family, f.source])).toEqual([["Carlito", "system"]]));
    expect(calls).toContain("/api/fonts");
    expect(files.libraryCatalog()).toEqual([{ source: "library", file: "Carlito-400-a.ttf", family: "Carlito", weight: 400, italic: false }]);
  });
});
