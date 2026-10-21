/* The icon picker (S15.2, B34; docs/next/09 §3.5, IC-01): Insert shape ▾ › More icons… (a new icon item) and, for a
   selected icon, Change icon…. A search box (words of the name and tags: whole, start or inside), the outline / filled
   switch, the set's 41 categories, the recent icons, and a grid of the hits drawn as inline SVG from the same path data
   the slide draws. The search runs in the core worker over the set's index (core/src/render/icon-search.ts): the page
   holds no copy of the set, and the grid is virtualised – only the rows in view (≈ 100 tiles) are drawn, their path
   data asked as they scroll in. A new icon takes the picker's colour, size and outline width (remembered, as the
   recent icons, in this user's preferences); a changed icon keeps its own, and its tiles are drawn at its own line width.
   Mode "pick" hands the chosen id to its caller (09 §3.5: an icon for a chart mark, M14) and changes nothing itself. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { Prefs, ShapeItem } from "@slide-builder/core/model/types";
import { iconStroke } from "@slide-builder/core/render/shape-dl";
import type { IconSearchAnswer, IconTile } from "@slide-builder/core/render/icon-search";
import { core, setPrefs } from "../state/app";
import { get } from "../state/store";
import { insertShape, itemPatch } from "../editor/charts";
import CSS from "./icon-picker.css?raw";

/** insert: a new icon item; replace: item `id`'s icon changed (Change icon…); pick: the id handed to `onPick` – a chart
    mark's icon (09 §3.5, M14), the caller makes the change (and its undo step) */
export type PickerReq = { mode: "insert" } | { mode: "replace"; id: string } | { mode: "pick"; onPick: (id: string) => void; title?: string };
const usePicker = create<{ req: PickerReq | null }>(() => ({ req: null }));
/** opens the picker: a new icon, or the icon of item `id` changed */
export const openIconPicker = (req: PickerReq) => usePicker.setState({ req });
export const closeIconPicker = () => usePicker.setState({ req: null });

/** the picker's choices this user keeps (in the preferences, beside the deck's own settings: never in the deck) */
interface IconPrefs { recentIcons?: string[] | null; iconOpts?: { style?: "outline" | "filled"; color?: string | null; size?: number; stroke?: number } | null }
const prefs = () => get().prefs.prefs as Prefs & IconPrefs;
const RECENT = 16;
/** an icon used: first of the recent ones */
export function rememberIcon(id: string) {
  const r = (prefs().recentIcons || []).filter(x => x !== id);
  setPrefs({ recentIcons: [id, ...r].slice(0, RECENT) } as Partial<Prefs>);
}

export const COLS = 10, TILE = 46, VIEW_ROWS = 8, DRAW = 120;
const INKS = ["#0B0D17", "#5B6274", "#1C4F8C", "#2251FF", "#1E8E3E", "#C42B1C", "#B25000", "#FFFFFF"];
const SIZES = [32, 48, 64, 96, 128], WIDTHS = [1, 1.5, 2, 2.5, 3];
/** the picker's own measurement (09 §7.4, keystroke → results drawn): the last search's times, ms */
export const pickerStats = { lastMs: 0, workerMs: 0, firstUse: 0 };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function IconPickerHost() {
  const req = usePicker(s => s.req);
  return req ? <IconPicker req={req} /> : null;
}

/** one tile's icon as inline SVG (the slide's paths on the 24 grid: strokes at the chosen width, round caps and joins) */
export function TileSvg({ tile, stroke }: { tile: IconTile | undefined; stroke: number }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{tile?.paths.map((p, k) => <path key={k} d={p.d} fill={p.fill ? "currentColor" : "none"} stroke={p.stroke ? "currentColor" : "none"}
    strokeWidth={p.stroke ? stroke : undefined} strokeLinecap="round" strokeLinejoin="round" fillRule={p.evenodd ? "evenodd" : undefined} opacity={p.alpha < 1 ? p.alpha : undefined} />)}</svg>;
}
const label = (id: string) => id.replace(/^tabler(-filled)?:/, "").replace(/-/g, " ");

function IconPicker({ req }: { req: PickerReq }) {
  const o = prefs().iconOpts || {};
  const [q, setQ] = useState("");
  const [style, setStyle] = useState<"outline" | "filled">(o.style === "filled" ? "filled" : "outline");
  const [category, setCategory] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(typeof o.color === "string" ? o.color : null);
  const [size, setSize] = useState(SIZES.includes(o.size as number) ? o.size as number : 64);
  // Change icon…: the tiles drawn at the item's own line width (what it will look like), not the picker's
  const item = req.mode === "replace" ? get().deck.slides[get().deck.cur]?.cfg.items?.[req.id] as ShapeItem | undefined : undefined;
  const [stroke, setStroke] = useState(item ? iconStroke(item.stroke) : WIDTHS.includes(o.stroke as number) ? o.stroke as number : 2);
  const [ans, setAns] = useState<{ names: string[]; categories: string[]; version: string; q: string; style: string; ms: number; first: boolean; cold: boolean } | null>(null);
  const [state, setState] = useState<"busy" | "ready" | "none">("busy");
  const [top, setTop] = useState(0);
  const [, bump] = useState(0);
  const tiles = useRef(new Map<string, IconTile>());
  const seq = useRef(0), typed = useRef(0), asked = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const recent = useMemo(() => (prefs().recentIcons || []).filter(x => typeof x === "string").slice(0, RECENT), []);
  const close = closeIconPicker;

  useEffect(() => { setTimeout(() => input.current?.focus(), 20); }, []);
  // a search per change of the words, the set or the category: the worker answers the hits and the first screen's tiles
  useEffect(() => {
    const n = ++seq.current;
    void core().call("iconSearch", { query: q, style, category, draw: DRAW, also: recent }).then((a: IconSearchAnswer | null) => {
      if (n !== seq.current) return;
      if (!a) { setState("none"); return; }
      for (const [id, t] of Object.entries(a.tiles)) tiles.current.set(id, t);
      pickerStats.workerMs = a.ms; if (a.first) pickerStats.firstUse = a.ms;
      setAns({ names: a.names, categories: a.categories, version: a.version, q, style, ms: a.ms, first: a.first, cold: a.cold }); setState("ready"); setTop(0);
      if (scroller.current) scroller.current.scrollTop = 0;
    }).catch(() => { if (n === seq.current) setState("none"); });
  }, [q, style, category, recent]);
  // keystroke → results drawn: measured after the frame that shows them
  useLayoutEffect(() => {
    if (!ans || !typed.current) return;
    const t0 = typed.current; typed.current = 0;
    requestAnimationFrame(() => { pickerStats.lastMs = now() - t0; });
  }, [ans]);

  const names = ans?.names ?? [];
  const rows = Math.ceil(names.length / COLS), first = Math.max(0, Math.floor(top / TILE) - 1), last = Math.min(rows, Math.ceil((top + VIEW_ROWS * TILE) / TILE) + 1);
  const ids = useMemo(() => names.slice(first * COLS, last * COLS).map(n => (style === "filled" ? "tabler-filled:" : "tabler:") + n), [names, first, last, style]);
  // the rows scrolled into view: their tiles asked once
  useEffect(() => {
    const miss = ids.filter(id => !tiles.current.has(id) && !asked.current.has(id));
    if (!miss.length) return;
    miss.forEach(id => asked.current.add(id));
    void core().call("iconTiles", { ids: miss }).then(t => { for (const [id, x] of Object.entries(t)) tiles.current.set(id, x); bump(v => v + 1); }).catch(() => undefined);
  }, [ids]);

  const pick = (id: string) => {
    rememberIcon(id);
    // the new icon's options are remembered from Insert only (the others show none: an item's own width is not the picker's)
    setPrefs({ iconOpts: req.mode === "insert" ? { style, color, size, stroke } : { ...o, style } } as Partial<Prefs>);
    close();
    if (req.mode === "pick") req.onPick(id);
    else if (req.mode === "replace") itemPatch("Change icon", req.id, { icon: id });
    else insertShape("icon", id, { size, ...(color ? { fill: color } : {}), ...(id.startsWith("tabler:") && stroke !== 2 ? { stroke } : {}) });
  };
  const tile = (id: string, name?: string) => <button key={id} className="ictile" data-icon={id} title={name ?? label(id)} onClick={() => pick(id)}>
    <TileSvg tile={tiles.current.get(id)} stroke={stroke} /></button>;
  const ink = color ?? "#1F2430";

  return <div className="modal" id="iconPicker" onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") close(); }}
    onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
    <style>{CSS}</style>
    <div className="dlg icdlg">
      <div className="dlghd"><b>{req.mode === "replace" ? "Change icon" : req.mode === "pick" ? req.title ?? "Choose icon" : "Insert icon"}</b>
        <span>Search by name or tag (English), or pick a category. Tabler Icons{ans ? " " + ans.version : ""} · MIT</span></div>
      <div className="ictools">
        <input ref={input} id="iconSearch" className="icsearch" placeholder="Search icons… (e.g. bank, arrow up, euro)" value={q}
          onChange={e => { typed.current = now(); setQ((e.target as HTMLInputElement).value); }}
          onKeyDown={e => { if (e.key === "Enter" && names.length) { e.preventDefault(); pick((style === "filled" ? "tabler-filled:" : "tabler:") + names[0]); } }} />
        <div className="seg small" id="iconStyle">{(["outline", "filled"] as const).map(s => <button key={s} data-style={s} className={style === s ? "on" : ""} onClick={() => { typed.current = now(); setStyle(s); }}>{s === "outline" ? "Outline" : "Filled"}</button>)}</div>
      </div>
      <div className="icbody">
        <div className="iccats" id="iconCats">
          <button className={category === null ? "on" : ""} data-cat="" onClick={() => setCategory(null)}>All icons</button>
          {(ans?.categories ?? []).map(c => <button key={c} className={category === c ? "on" : ""} data-cat={c} onClick={() => setCategory(category === c ? null : c)}>{c}</button>)}
        </div>
        <div className="icmain" style={{ color: ink === "#FFFFFF" ? "#1F2430" : ink }}>
          {recent.length > 0 && !q.trim() && category === null && <><div className="ichd">Recent</div><div className="icrecent" id="iconRecent">{recent.map(id => tile(id))}</div></>}
          <div className="ichd">{state === "none" ? "" : state === "busy" ? "Searching…" : `${names.length.toLocaleString("en")} icon${names.length === 1 ? "" : "s"}${category ? " in " + category : ""}`}</div>
          {state === "none" ? <div className="icnone" id="iconNone">The icon set is read by Slide Builder's background worker, which this browser did not start. Reload the page; if it stays, the built-in icons of Insert shape ▾ still work.</div>
            : <div className="icgrid" id="iconGrid" ref={scroller} data-q={ans?.q ?? ""} data-style={ans?.style ?? ""} data-n={names.length} data-ms={ans?.ms ?? ""} data-first={ans?.first ? "1" : "0"} data-cold={ans?.cold ? "1" : "0"} onScroll={e => setTop((e.target as HTMLDivElement).scrollTop)}>
              <div style={{ height: rows * TILE + "px", position: "relative" }}>
                <div className="icrows" style={{ top: first * TILE + "px" }}>{ids.map((id, k) => tile(id, names[first * COLS + k]))}</div>
              </div>
              {state === "ready" && !names.length && <div className="icnone">No icon matches “{q}”{category ? " in " + category : ""}.</div>}
            </div>}
        </div>
      </div>
      {req.mode === "insert" ? <div className="icopts">
        <span className="lbl">Colour</span>
        <button className={"icsw auto" + (color === null ? " on" : "")} data-iccolor="" title="The design's (the text colour)" onClick={() => setColor(null)}>A</button>
        {INKS.map(c => <button key={c} className={"icsw" + (color === c ? " on" : "")} data-iccolor={c} title={c} style={{ background: c }} onClick={() => setColor(c)} />)}
        <span className="lbl">Size</span>
        <div className="seg small" id="iconSize">{SIZES.map(s => <button key={s} data-size={s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s}</button>)}</div>
        <span className="lbl">Line</span>
        <div className="seg small" id="iconWidth">{WIDTHS.map(w => <button key={w} data-width={w} disabled={style === "filled"} className={stroke === w ? "on" : ""} title={style === "filled" ? "Filled icons have no outline" : `Outline ${w} px at 24 px`} onClick={() => setStroke(w)}>{w}</button>)}</div>
        <span style={{ flex: "1" }} /><button className="btn" onClick={close}>Cancel</button>
      </div> : <div className="icopts"><span className="lbl">{req.mode === "replace" ? "The icon keeps its colour, size and line (Icon tools on the ribbon)." : ""}</span><span style={{ flex: "1" }} /><button className="btn" onClick={close}>Cancel</button></div>}
    </div>
  </div>;
}
