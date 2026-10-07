/* The shared font library in the page: loads it, declares its @font-face rules, adds Google fonts
   and uploaded files, and embeds the fonts a deck uses into exports. */
import { S, emit, STAGE, THUMBS, toast } from "./store";
import { backend } from "../sync/api";
import { cleanFamily, fontFaceCss, googleCssUrl, parseGoogleCss, readFontInfo, type LibraryFont } from "../model/fonts";
import { esc } from "../xlsx/util";

export const FONTS = { lib: [] as LibraryFont[], loaded: false, busy: "" };

function styleEl(id: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
  return el;
}
/** declares the library's fonts in the page (from disk: Google stylesheets) */
function declare() {
  if (backend.served) styleEl("fontcss").textContent = fontFaceCss(FONTS.lib, f => backend.fontUrl(f));
  else styleEl("fontcss").textContent = FONTS.lib.filter(f => f.source === "google").map(f => `@import url(${JSON.stringify(googleCssUrl(f.family))});`).join("\n");
}
let sig = "";
function setLib(lib: LibraryFont[]) {
  const s = JSON.stringify(lib); FONTS.loaded = true;
  if (s === sig) return;
  sig = s; FONTS.lib = lib; declare(); emit();
}
export async function loadFonts() { try { setLib(await backend.fonts()); } catch { /* helper busy: next time */ } }

/* fonts arrive after the slide was drawn: draw again (once per burst), so measured text fits */
let redraw: ReturnType<typeof setTimeout> | null = null;
export function watchFontLoads() {
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (redraw) clearTimeout(redraw);
    redraw = setTimeout(() => { redraw = null; if (S.slides.length) { STAGE.render(); THUMBS.render(); } }, 150);
  });
}

export const inLibrary = (family: string) => FONTS.lib.some(f => f.family.toLowerCase() === family.toLowerCase());

/** adds a Google font to the shared library: its files are saved in the Slide Builder folder, so slides
    and exports work even where Google cannot be reached later */
export async function addGoogleFont(name: string): Promise<boolean> {
  const family = cleanFamily(name);
  if (!family) return false;
  if (inLibrary(family)) return true;
  FONTS.busy = family; emit();
  try {
    let css = "";
    // not every family has bold or italic: ask for less until Google answers
    for (const spec of [":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ""]) {
      const r = await fetch(googleCssUrl(family, spec)).catch(() => null);
      if (r === null) throw new Error("Google Fonts cannot be reached from this PC. Download the font files (fonts.google.com › Download family) and use “Upload font files”.");
      if (r.ok) { css = await r.text(); break; }
    }
    const faces = parseGoogleCss(css);
    if (!faces.length) throw new Error(`“${family}” is not a Google font – check the spelling on fonts.google.com`);
    if (!backend.served) { setLib(await backend.addFont({ family, weight: 400, style: "normal", source: "google", name: "" }, new ArrayBuffer(0))); return true; }
    let lib: LibraryFont[] = FONTS.lib;
    for (const f of faces) {
      const data = await (await fetch(f.url)).arrayBuffer();
      lib = await backend.addFont({ family, weight: f.weight, style: f.style, source: "google", name: f.url.split("/").pop() || "font.woff2", range: f.range }, data);
    }
    setLib(lib);
    toast(`Font <b>${esc(family)}</b> added – it is saved in the Slide Builder folder for everybody.`);
    return true;
  } catch (e) { toast("⚠ " + esc((e as Error).message || e), [], true); return false; }
  finally { FONTS.busy = ""; emit(); }
}

/** font files chosen by the user (TTF, OTF, WOFF, WOFF2): family, weight and style are read from each file */
export async function uploadFontFiles(files: File[]): Promise<string[]> {
  if (!backend.served) { toast("Uploading fonts needs the helper: start Slide Builder with Start Slide Builder.bat.", [], true); return []; }
  const added = new Set<string>(), failed: string[] = [];
  let lib: LibraryFont[] | null = null;
  FONTS.busy = files.length === 1 ? files[0].name : files.length + " files"; emit();
  try {
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer(), info = await readFontInfo(buf, file.name);
        lib = await backend.addFont({ family: info.family, weight: info.weight, style: info.style, source: "upload", name: file.name }, buf);
        added.add(info.family);
      } catch (e) { failed.push(`${file.name}: ${(e as Error).message}`); }
    }
  } finally { FONTS.busy = ""; if (lib) setLib(lib); else emit(); }
  if (added.size) toast(`Added <b>${esc([...added].join(", "))}</b> to the font library – saved for everybody.`);
  if (failed.length) toast("⚠ " + esc(failed.join(" · ")), [], true);
  return [...added];
}

export async function removeFont(family: string) {
  try { setLib(await backend.removeFont(family)); } catch (e) { toast("⚠ " + esc((e as Error).message || e), [], true); }
}

/* ---- export: the fonts a slide uses, as data URLs (the export browser may not reach Google or the helper) ---- */
const dataUrls = new Map<string, Promise<string>>();
function dataUrl(file: string): Promise<string> {
  let p = dataUrls.get(file);
  if (!p) {
    p = fetch(backend.fontUrl(file)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(b => new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.readAsDataURL(b); }));
    p.catch(() => dataUrls.delete(file));
    dataUrls.set(file, p);
  }
  return p;
}
/** @font-face rules with embedded files for the library fonts that appear in `html` */
export async function embeddedFontCss(html: string): Promise<string> {
  if (!backend.served) return "";
  const low = html.toLowerCase(), used = FONTS.lib.filter(f => low.includes(cleanFamily(f.family).toLowerCase()));   // quoted or not: the browser may re-serialise styles
  if (!used.length) return "";
  const urls = new Map<string, string>();
  for (const f of used) for (const x of f.faces) { try { urls.set(x.file, await dataUrl(x.file)); } catch { /* left out: the fallback font is used */ } }
  return fontFaceCss(used.map(f => ({ ...f, faces: f.faces.filter(x => urls.has(x.file)) })), file => urls.get(file)!);
}
