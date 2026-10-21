/* Adding a Google font (state/fonts.ts addGoogleFont) where the page cannot reach fonts.googleapis.com (the office,
   2026-10: the name does not resolve): the helper fetches the family (helper gfonts.py) and the page stores its
   files as uploads are stored. The helper is a stubbed fetch; the page is "served" (a token in the page). */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const meta = document.createElement("meta");
meta.name = "sb-token"; meta.content = "test-token";
document.head.appendChild(meta);
type Mods = { fonts: typeof import("../src/state/fonts"); store: typeof import("../src/state/store"); picker: typeof import("../src/ui/FontPicker") };
let M: Mods;
beforeAll(async () => {
  M = { fonts: await import("../src/state/fonts"), store: await import("../src/state/store"), picker: await import("../src/ui/FontPicker") };
});
afterEach(() => { vi.unstubAllGlobals(); M.store.patch("ui", { toast: null }); M.store.patch("doc", { fonts: [] }); });

const TTF = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const ROBOTO = { family: "Roboto", source: "github", license: "ofl", faces: [
  { weight: 400, style: "normal", file: "ofl/roboto/Roboto[wdth,wght].ttf", variable: true },
  { weight: 700, style: "normal", file: "ofl/roboto/Roboto[wdth,wght].ttf", variable: true },
  { weight: 400, style: "italic", file: "ofl/roboto/Roboto-Italic[wdth,wght].ttf", variable: true }] };
type Answer = (url: string) => Promise<Response> | undefined;
/** the helper (and Google, for the page itself): googleapis does not resolve unless `google` answers */
function net(answer: Answer, google?: Answer) {
  const calls: { url: string; method: string }[] = [], lib: { family: string; source: string; faces: unknown[] }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method || "GET" });
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return google?.(url) ?? Promise.reject(new TypeError("Failed to fetch"));
    const a = answer(url); if (a) return a;
    if (url.startsWith("/api/fonts?") && init?.method === "POST") {
      const q = new URLSearchParams(url.split("?")[1]), fam = q.get("family")!;
      let f = lib.find(x => x.family === fam); if (!f) lib.push(f = { family: fam, source: q.get("source")!, faces: [] });
      f.faces.push({ file: q.get("name"), weight: +q.get("weight")!, style: q.get("style") });
      return json({ fonts: lib });
    }
    if (url.startsWith("/api/fonts")) return json({ fonts: lib });
    return Promise.reject(new Error("unexpected " + url));
  }));
  return calls;
}
const toastText = () => M.store.get().ui.toast?.html || "";

describe("adding a Google font through the helper", () => {
  it("the page never asks googleapis: the helper lists the faces, each file is fetched once and stored", async () => {
    const calls = net(url =>
      url.startsWith("/api/fonts/google?") ? json(ROBOTO) : url.startsWith("/api/fonts/google/file?") ? Promise.resolve(new Response(TTF)) : undefined);
    expect(await M.fonts.addGoogleFont("Roboto")).toBe(true);
    expect(calls.filter(c => /googleapis|gstatic/.test(c.url))).toEqual([]);
    expect(calls.filter(c => c.url.startsWith("/api/fonts/google/file?")).map(c => decodeURIComponent(c.url.split("ref=")[1])))
      .toEqual(["ofl/roboto/Roboto[wdth,wght].ttf", "ofl/roboto/Roboto-Italic[wdth,wght].ttf"]);       // one variable file, two weights
    const adds = calls.filter(c => c.method === "POST").map(c => new URLSearchParams(c.url.split("?")[1]));
    expect(adds.map(q => [q.get("family"), q.get("weight"), q.get("style"), q.get("source")]))
      .toEqual([["Roboto", "400", "normal", "google"], ["Roboto", "700", "normal", "google"], ["Roboto", "400", "italic", "google"]]);
    expect(M.store.get().doc.fonts.map(f => f.family)).toEqual(["Roboto"]);
    expect(toastText()).toMatch(/Roboto.*added/);
  });

  it("the helper's message says what to do (an unknown family, a file too large)", async () => {
    net(url => url.startsWith("/api/fonts/google?") ? json({ error: "“Robotto” is not a Google font – check the spelling on fonts.google.com, or use “Upload font files”" }, 404) : undefined);
    expect(await M.fonts.addGoogleFont("Robotto")).toBe(false);
    expect(toastText()).toMatch(/check the spelling.*Upload font files/);
  });

  it("a file that fails halfway stores nothing, so adding the family again fetches it whole", async () => {
    const unreachable = "Google Fonts cannot be reached from the Slide Builder helper (…). To add the font, … “Upload font files”";
    let calls = net(url => url.startsWith("/api/fonts/google?") ? json(ROBOTO)
      : url.includes("Roboto-Italic") ? json({ error: unreachable }, 502)                           // the second file
      : url.startsWith("/api/fonts/google/file?") ? Promise.resolve(new Response(TTF)) : undefined);
    expect(await M.fonts.addGoogleFont("Roboto")).toBe(false);
    expect(calls.filter(c => c.url.startsWith("/api/fonts/google/file?")).length).toBe(2);
    expect(calls.filter(c => c.method === "POST")).toEqual([]);                  // the regular face was not stored alone
    expect(M.store.get().doc.fonts).toEqual([]);
    expect(M.fonts.inLibrary("Roboto")).toBe(false);
    expect(toastText()).toContain("Upload font files");
    calls = net(url => url.startsWith("/api/fonts/google?") ? json(ROBOTO) : url.startsWith("/api/fonts/google/file?") ? Promise.resolve(new Response(TTF)) : undefined);
    expect(await M.fonts.addGoogleFont("Roboto")).toBe(true);
    expect(calls.filter(c => c.method === "POST").length).toBe(3);
  });

  it("the helper cannot reach Google: the page tries googleapis itself (its PAC proxy may), then shows the helper's message", async () => {
    const unreachable = "Google Fonts cannot be reached from the Slide Builder helper (…). To add the font, download the family … and use “Upload font files”";
    let calls = net(url => url.startsWith("/api/fonts/google?") ? json({ error: unreachable }, 502) : undefined);
    expect(await M.fonts.addGoogleFont("Roboto")).toBe(false);
    expect(calls.some(c => c.url.startsWith("https://fonts.googleapis.com/css2?"))).toBe(true);
    expect(toastText()).toContain("Upload font files");
    expect(M.store.get().doc.fonts).toEqual([]);
    // where the browser does reach Google, the font is added from there as before
    const css = "/* latin */\n@font-face { font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/roboto/r.woff2) format('woff2'); unicode-range: U+0000-00FF; }";
    calls = net(url => url.startsWith("/api/fonts/google?") ? json({ error: unreachable }, 502) : undefined,
      url => Promise.resolve(url.includes("googleapis") ? new Response(css) : new Response(TTF)));
    expect(await M.fonts.addGoogleFont("Roboto")).toBe(true);
    expect(calls.filter(c => c.method === "POST").length).toBe(1);
  });
});

describe("font picker previews (B46)", () => {
  it("only the names on screen, through the helper with the token, 4 at a time; none after a failure; never a googleapis link", async () => {
    const asked: { family: string; token: string | null; done: (r: Response) => void }[] = [], faces: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/fonts/google/preview?")) {
        return new Promise<Response>(done => asked.push({ family: new URLSearchParams(url.split("?")[1]).get("family")!, token: new Headers(init?.headers).get("X-SB-Token"), done }));
      }
      if (url.startsWith("/api/fonts")) return json({ fonts: [] });
      return Promise.reject(new Error("unexpected " + url));
    }));
    vi.stubGlobal("FontFace", class { constructor(public family: string, public buf: ArrayBuffer) { faces.push(family); } load() { return Promise.resolve(this); } });
    const seen: Element[] = [];
    let onScreen: (els: Element[]) => void = () => undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: (e: { target: Element; isIntersecting: boolean }[]) => void) { onScreen = els => cb(els.map(target => ({ target, isIntersecting: true }))); }
      observe(el: Element) { seen.push(el); } unobserve() { /* */ } disconnect() { /* */ }
    });
    const { container } = render(<M.picker.FontPicker value={null} onPick={() => undefined} />);
    (container.querySelector("button.fontbtn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('[data-font="Roboto"]')).not.toBeNull());
    expect(document.querySelectorAll('link[href*="googleapis"]').length).toBe(0);
    expect(asked).toEqual([]);                                                   // nothing until a name is on screen
    const item = (f: string) => container.querySelector(`[data-font="${f}"]`)!;
    expect(seen).toContain(item("Roboto"));
    onScreen(["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins"].map(item));
    await vi.waitFor(() => expect(asked.length).toBe(4));                        // 4 at a time
    expect(asked.map(a => [a.family, a.token])).toEqual([["Inter", "test-token"], ["Roboto", "test-token"], ["Open Sans", "test-token"], ["Lato", "test-token"]]);
    asked[0].done(new Response(TTF));
    await vi.waitFor(() => expect(asked.length).toBe(5));
    await vi.waitFor(() => expect(faces).toEqual(["sbpv Inter"]));               // a name of its own: never the library's faces
    expect((item("Inter") as HTMLElement).style.fontFamily).toMatch(/^["']?sbpv Inter["']?, ?["']?Inter["']?,/);
    asked[1].done(new Response(JSON.stringify({ error: "cannot be reached" }), { status: 502 }));
    for (const a of asked.slice(2)) a.done(new Response(TTF));
    await new Promise(ok => setTimeout(ok, 20));
    expect(asked.length).toBe(5);                                                // Poppins is never asked after the failure
    onScreen(["Raleway", "Nunito"].map(item));
    await new Promise(ok => setTimeout(ok, 20));
    expect(asked.length).toBe(5);
    expect(item("Roboto").textContent).toBe("Roboto");                          // its fallback font
  });
});
