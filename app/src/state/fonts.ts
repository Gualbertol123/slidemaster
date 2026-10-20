/* The shared font library in the page: loads it, declares its @font-face rules, adds Google fonts
   and uploaded files, and embeds the fonts a deck uses into exports. */
import { get, patch, STAGE, THUMBS, toast } from "./store";
import { ApiError, backend } from "../sync/api";
import { cleanFamily, fontFaceCss, googleCssUrl, parseGoogleCss, readFontInfo, type LibraryFont } from "@slide-builder/core/model/fonts";
import { esc } from "@slide-builder/core/xlsx/util";
import { transfer } from "@slide-builder/core/rpc/port";
import { core } from "./app";

/* the library is in the store (doc.fonts); a font being added: ui.fontBusy */
const lib = () => get().doc.fonts;

function styleEl(id: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
  return el;
}
/** declares the library's fonts in the page (from disk: Google stylesheets) */
function declare() {
  if (backend.served) styleEl("fontcss").textContent = fontFaceCss(lib(), f => backend.fontUrl(f));
  else styleEl("fontcss").textContent = lib().filter(f => f.source === "google").map(f => `@import url(${JSON.stringify(googleCssUrl(f.family))});`).join("\n");
}
let sig = "";
function setLib(fonts: LibraryFont[]) {
  const s = JSON.stringify(fonts);
  if (s === sig) return;
  sig = s; patch("doc", { fonts }); declare();
  // the core worker measures with the library's files (S4.4): it looks for faces again, and the slide is measured again
  if (get().deck.slides.length) STAGE.render(true);
}
export async function loadFonts() { try { setLib(await backend.fonts()); } catch { /* helper busy: next time */ } }

/* fonts arrive after the slide was drawn: draw again (once per burst), so measured text fits */
let redraw: ReturnType<typeof setTimeout> | null = null;
export function watchFontLoads() {
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (redraw) clearTimeout(redraw);
    redraw = setTimeout(() => { redraw = null; if (get().deck.slides.length) { STAGE.render(true); THUMBS.render(); } }, 150);
  });
}

export const inLibrary = (family: string) => lib().some(f => f.family.toLowerCase() === family.toLowerCase());

/** adds a Google font to the shared library: its files are saved in the Slide Builder folder, so slides
    and exports work even where Google cannot be reached later. With the helper, the helper fetches them (from the
    google/fonts repository on GitHub, else googleapis: helper gfonts.py) – at the office fonts.googleapis.com does not
    resolve for the page (2026-10); the page asks Google itself only when the helper cannot reach it (or from disk) */
export async function addGoogleFont(name: string): Promise<boolean> {
  const family = cleanFamily(name);
  if (!family) return false;
  if (inLibrary(family)) return true;
  patch("ui", { fontBusy: family });
  try {
    if (!backend.served) { await fromBrowser(family); return true; }
    let fonts: LibraryFont[];
    try { fonts = await fromHelper(family); }
    catch (e) {
      // 502: the helper cannot reach Google from this PC; the browser may (its PAC file names a proxy). Its message
      // says what to do; any other answer (not a Google font, too large) is the helper's last word
      if (!(e instanceof ApiError) || e.status !== 502) throw e;
      try { fonts = await fromBrowser(family); }
      catch (e2) { console.info("Google Fonts from the page:", e2); throw e; }
    }
    setLib(fonts);
    toast(`Font <b>${esc(family)}</b> added – it is saved in the Slide Builder folder for everybody.`);
    return true;
  } catch (e) { void loadFonts(); toast("⚠ " + esc((e as Error).message || e), [], true); return false; }
  finally { patch("ui", { fontBusy: "" }); }
}

type Face = { meta: Parameters<typeof backend.addFont>[0]; buf: ArrayBuffer };
/** stores the faces of a family once every file has arrived: a failure halfway (a timeout, a file too large) leaves
    nothing behind, so adding the family again fetches it whole (inLibrary would skip a half-stored one) */
async function store(faces: Face[]): Promise<LibraryFont[]> {
  let fonts: LibraryFont[] = lib();
  for (const f of faces) fonts = await backend.addFont(f.meta, f.buf);
  return fonts;
}

/** the faces the helper found, stored as uploads are: a variable file (most families on GitHub) is fetched once and
    becomes a static face at each weight (exports never embed a variable font) */
async function fromHelper(family: string): Promise<LibraryFont[]> {
  const g = await backend.googleFont(family), files = new Map<string, ArrayBuffer>(), faces: Face[] = [];
  for (const f of g.faces) {
    let raw = files.get(f.file);
    if (!raw) { raw = await backend.googleFontFile(f.file); files.set(f.file, raw); }
    const base = f.file.split("/").pop() || "font.ttf", { buf, name } = f.variable ? await staticFile(raw, f.weight, base) : { buf: raw, name: base };
    faces.push({ meta: { family, weight: f.weight, style: f.style, source: "google", name, range: f.range }, buf });
  }
  return store(faces);
}

/** the page asks Google itself (from disk: only the name is kept, the stylesheet is imported) */
async function fromBrowser(family: string): Promise<LibraryFont[]> {
  let css = "";
  // not every family has bold or italic: ask for less until Google answers
  for (const spec of [":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ""]) {
    const r = await fetch(googleCssUrl(family, spec)).catch(() => null);
    if (r === null) throw new Error("Google Fonts cannot be reached from this PC. Download the font files (fonts.google.com › Download family) and use “Upload font files”.");
    if (r.ok) { css = await r.text(); break; }
  }
  const faces = parseGoogleCss(css);
  if (!faces.length) throw new Error(`“${family}” is not a Google font – check the spelling on fonts.google.com`);
  if (!backend.served) { const fonts = await backend.addFont({ family, weight: 400, style: "normal", source: "google", name: "" }, new ArrayBuffer(0)); setLib(fonts); return fonts; }
  const got: Face[] = [];
  for (const f of faces) {
    const data = await (await fetch(f.url)).arrayBuffer();
    got.push({ meta: { family, weight: f.weight, style: f.style, source: "google", name: f.url.split("/").pop() || "font.woff2", range: f.range }, buf: data });
  }
  return store(got);
}

/** a variable font becomes a static face at its declared weight before it is stored (S3.2, by the core worker), so
    exports never embed a variable font; anything else, or a failure, is stored as it is */
async function staticFile(buf: ArrayBuffer, weight: number, name: string): Promise<{ buf: ArrayBuffer; name: string }> {
  try {
    const copy = buf.slice(0);                            // the original stays here for the fallback
    const r = await core().call("staticFont", transfer({ buf: copy, weight }, [copy]));
    return r.variable ? { buf: r.buf, name: name.replace(/\.[^.]+$/, "") + ".ttf" } : { buf, name };
  } catch (e) { console.warn("font kept as it is:", e); return { buf, name }; }
}

/** font files chosen by the user (TTF, OTF, WOFF, WOFF2): family, weight and style are read from each file */
export async function uploadFontFiles(files: File[]): Promise<string[]> {
  if (!backend.served) { toast("Uploading fonts needs the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return []; }
  const added = new Set<string>(), failed: string[] = [];
  let fonts: LibraryFont[] | null = null;
  patch("ui", { fontBusy: files.length === 1 ? files[0].name : files.length + " files" });
  try {
    for (const file of files) {
      try {
        const raw = await file.arrayBuffer(), info = await readFontInfo(raw, file.name), { buf, name } = await staticFile(raw, info.weight, file.name);
        fonts = await backend.addFont({ family: info.family, weight: info.weight, style: info.style, source: "upload", name }, buf);
        added.add(info.family);
      } catch (e) { failed.push(`${file.name}: ${(e as Error).message}`); }
    }
  } finally { patch("ui", { fontBusy: "" }); if (fonts) setLib(fonts); }
  if (added.size) toast(`Added <b>${esc([...added].join(", "))}</b> to the font library – saved for everybody.`);
  if (failed.length) toast("⚠ " + esc(failed.join(" · ")), [], true);
  return [...added];
}

export async function removeFont(family: string) {
  try { setLib(await backend.removeFont(family)); } catch (e) { toast("⚠ " + esc((e as Error).message || e), [], true); }
}

