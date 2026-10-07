/* Font menu used everywhere a font is chosen (toolbar, text styles): the shared library first, then the
   fonts every Windows PC has, then popular Google fonts (picking one adds it to the library). */
import { useEffect, useRef, useState } from "preact/hooks";
import { emit } from "../state/store";
import { DLG } from "../state/dialogs";
import { FONTS, addGoogleFont, inLibrary, loadFonts, uploadFontFiles } from "../state/fonts";
import { GOOGLE_POPULAR, SYSTEM_FONTS, fontStack } from "../model/fonts";
import { backend } from "../sync/api";
import { Dropdown } from "./Dropdown";

/** small preview stylesheets for Google fonts not in the library yet (only the letters of their names) */
const previewed = new Set<string>();
function preview(families: string[]) {
  const todo = families.filter(f => !previewed.has(f) && !inLibrary(f)); if (!todo.length) return;
  todo.forEach(f => previewed.add(f));
  const link = document.createElement("link"); link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + todo.map(f => "family=" + encodeURIComponent(f).replace(/%20/g, "+")).join("&") + "&text=" + encodeURIComponent(todo.join("") + " ") + "&display=swap";
  document.head.appendChild(link);
}

export function openFontManager(tab: "colors" | "styles" | "fonts" = "fonts") { DLG.textStyles = tab; emit(); void loadFonts(); }   // fonts colleagues just added

export function FontPicker(p: { value: string | null; onPick: (font: string | null) => void; disabled?: boolean; id?: string; placeholder?: string; title?: string }) {
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const lib = FONTS.lib.map(f => f.family);
  const match = (f: string) => !q.trim() || f.toLowerCase().includes(q.trim().toLowerCase());
  const google = GOOGLE_POPULAR.filter(f => !inLibrary(f));
  const item = (f: string, close: () => void, onPick = () => p.onPick(f)) =>
    <button key={f} data-font={f} class={"fontitem" + (p.value === f ? " picked" : "")} style={{ fontFamily: fontStack(f) }} onClick={() => { close(); onPick(); }}>{f}</button>;
  const exact = q.trim() && ![...lib, ...SYSTEM_FONTS, ...GOOGLE_POPULAR].some(f => f.toLowerCase() === q.trim().toLowerCase()) ? q.trim() : "";
  return (
    <Dropdown menuClass="fontmenu" onOpen={() => { setQ(""); preview(google); void loadFonts(); }} button={(_o, toggle) =>
      <button class="tb fontbtn" id={p.id} disabled={p.disabled} title={p.title || "Font"} onClick={toggle} style={{ fontFamily: p.value ? fontStack(p.value) : undefined }}>
        <span>{p.value || p.placeholder || "Default font"}</span><i class="caret">▾</i></button>}>
      {close => <>
        <SearchBox value={q} onInput={setQ} />
        <div class="fontlist">
          {match("Default") && <button class={"fontitem" + (p.value === null ? " picked" : "")} data-font="" onClick={() => { close(); p.onPick(null); }}><i>{p.placeholder || "Default font"}</i></button>}
          {lib.some(match) && <><div class="hd">Font library <small>shared · saved in the Slide Builder folder</small></div>{lib.filter(match).map(f => item(f, close))}</>}
          {SYSTEM_FONTS.some(match) && <><div class="hd">On every Windows PC</div>{SYSTEM_FONTS.filter(match).map(f => item(f, close))}</>}
          {google.some(match) && <><div class="hd">Google Fonts <small>added to the library when picked</small></div>
            {google.filter(match).map(f => item(f, close, () => void addGoogleFont(f).then(ok => ok && p.onPick(f))))}</>}
          {exact && <button class="fontitem add" onClick={() => { close(); void addGoogleFont(exact).then(ok => ok && p.onPick(exact)); }}>+ Add “{exact}” from Google Fonts</button>}
        </div>
        <div class="sep" />
        <div class="fontacts">
          <button disabled={!backend.served} title={backend.served ? "TrueType, OpenType or web fonts (.ttf .otf .woff .woff2)" : "Needs the helper (Start Slide Builder.bat)"} onClick={() => fileRef.current?.click()}>⤒ Upload font files…</button>
          <button onClick={() => { close(); openFontManager("fonts"); }}>Manage fonts…</button>
        </div>
        <input type="file" ref={fileRef} hidden multiple accept=".ttf,.otf,.woff,.woff2" onChange={e => {
          const t = e.target as HTMLInputElement, files = Array.from(t.files || []); t.value = "";
          if (files.length) { close(); void uploadFontFiles(files).then(fams => { if (fams.length === 1) p.onPick(fams[0]); }); }
        }} />
      </>}
    </Dropdown>
  );
}

function SearchBox({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 20); }, []);
  return <input ref={ref} class="fontsearch" placeholder="Search or type a Google font name…" value={value}
    onInput={e => onInput((e.target as HTMLInputElement).value)} onKeyDown={e => { if (e.key !== "Escape") e.stopPropagation(); }} />;
}
