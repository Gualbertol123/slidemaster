/* The icon and shape window (S15.2, B34; docs/next/09 §3.5, IC-01; one window since 4.12): the ribbon's Shapes & icons…
   (a new icon, shape or text box) and, for a selected icon, Change icon…. The main area is the Tabler set: a search box
   (words of the name and tags: whole, start or inside), the outline / filled switch, the set's 41 categories, the recent
   icons, and a grid of the hits drawn as inline SVG from the same path data the slide draws. Its side column
   (ShapeColumn.tsx) holds the shapes that carry text – a text box and the six callout shapes – and, when the window is
   narrow, sits above the grid. The 17 built-in icons of 4.3 are not offered any more (icon-legacy.ts: each has its
   Tabler counterpart); decks that have them draw, export and edit them as before, and Change icon… on one opens here at
   its counterpart. The search runs in the core worker over the set's index (core/src/render/icon-search.ts): the page
   holds no copy of the set, and the grid is virtualised – only the rows in view are drawn, as many columns as fit, their
   path data asked as they scroll in. A dialog for the keyboard: the focus stays in it (Tab, Shift+Tab), the search box
   has it on open, the arrow keys move through the grid (↓ from the search box, ↑ from its first row back), Enter
   inserts, Escape closes. A new icon takes the window's colour, size and outline width (remembered, as the recent icons,
   in this user's preferences); a changed icon keeps its own, and its tiles are drawn at its own line width. No backdrop
   blur (icon-picker.css). Mode "pick" hands the chosen id to its caller (09 §3.5: an icon for a chart mark, M14) and
   changes nothing itself. */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { create } from "zustand";
import type { Prefs, ShapeItem } from "@slide-builder/core/model/types";
import { iconStroke } from "@slide-builder/core/render/shape-dl";
import type { IconSearchAnswer, IconTile } from "@slide-builder/core/render/icon-search";
import { core, setPrefs } from "../state/app";
import { get } from "../state/store";
import { insertShape, itemPatch } from "../editor/charts";
import { ShapeColumn } from "./ShapeColumn";
import { legacyCounterpart } from "./icon-legacy";
import CSS from "./icon-picker.css?raw";

/** insert: a new icon item; replace: item `id`'s icon changed (Change icon…); pick: the id handed to `onPick` – a chart
    mark's icon (09 §3.5, M14), the caller makes the change (and its undo step) */
export type PickerReq = { mode: "insert" } | { mode: "replace"; id: string } | { mode: "pick"; onPick: (id: string) => void; title?: string };
/** the open request, and how many were made (the window's key: a second openIconPicker starts afresh) */
const usePicker = create<{ req: PickerReq | null; n: number }>(() => ({ req: null, n: 0 }));
/** opens the window: a new icon, shape or text box, or the icon of item `id` changed */
export const openIconPicker = (req: PickerReq) => usePicker.setState(s => ({ req, n: s.n + 1 }));
export const closeIconPicker = () => usePicker.setState({ req: null });
/** whether the window is open: the page's own keys (editor/keys.ts) stay off the deck behind it */
export const pickerOpen = () => usePicker.getState().req !== null;

/** the picker's choices this user keeps (in the preferences, beside the deck's own settings: never in the deck) */
interface IconPrefs { recentIcons?: string[] | null; iconOpts?: { style?: "outline" | "filled"; color?: string | null; size?: number; stroke?: number } | null }
const prefs = () => get().prefs.prefs as Prefs & IconPrefs;
const RECENT = 16;
/** an icon used: first of the recent ones */
export function rememberIcon(id: string) {
  const r = (prefs().recentIcons || []).filter(x => x !== id);
  setPrefs({ recentIcons: [id, ...r].slice(0, RECENT) } as Partial<Prefs>);
}

/** the grid's tile (px); without a measured grid (jsdom) COLS × VIEW_ROWS. A new search's hits are drawn first in the
    rows that hold about FIRST tiles (asked with the hits; 4.8's grid drew 90), the rest of the rows in view when no key came
    for REST_MS, once their tiles have come: a bigger window costs the keystroke nothing (09 §7.4, icon_picker_p95_ms) */
export const COLS = 10, TILE = 46, VIEW_ROWS = 8, FIRST = 90, REST_MS = 400;
/** the first part of a new search's grid: whole rows, about FIRST tiles */
const firstPart = (cols: number) => cols * Math.ceil(FIRST / cols);
const INKS = ["#0B0D17", "#5B6274", "#1C4F8C", "#2251FF", "#1E8E3E", "#C42B1C", "#B25000", "#FFFFFF"];
const SIZES = [32, 48, 64, 96, 128], WIDTHS = [1, 1.5, 2, 2.5, 3];
/** the picker's own measurement (09 §7.4, keystroke → results drawn): the last search's times, ms */
export const pickerStats = { lastMs: 0, workerMs: 0, firstUse: 0 };
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function IconPickerHost() {
  const req = usePicker(s => s.req), n = usePicker(s => s.n);
  return req ? <IconPicker key={n + ":" + req.mode + ":" + (req.mode === "replace" ? req.id : "")} req={req} /> : null;
}

/** one tile's icon as inline SVG (the slide's paths on the 24 grid: strokes at the chosen width, round caps and joins) */
export function TileSvg({ tile, stroke }: { tile: IconTile | undefined; stroke: number }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{tile?.paths.map((p, k) => <path key={k} d={p.d} fill={p.fill ? "currentColor" : "none"} stroke={p.stroke ? "currentColor" : "none"}
    strokeWidth={p.stroke ? stroke : undefined} strokeLinecap="round" strokeLinejoin="round" fillRule={p.evenodd ? "evenodd" : undefined} opacity={p.alpha < 1 ? p.alpha : undefined} />)}</svg>;
}
/** one tile of the grid: drawn again only when its icon's paths, its line width or its title change (a keystroke
    re-renders the picker; the tiles that stay in view are not built again) */
const Tile = memo(function Tile({ id, title, tile, stroke, onPick, idx, tab, onFocusIdx }: { id: string; title: string; tile: IconTile | undefined; stroke: number;
  onPick: (id: string) => void; idx?: number; tab: boolean; onFocusIdx?: (i: number) => void }) {
  return <button className="ictile" data-icon={id} data-idx={idx} tabIndex={tab ? 0 : -1} title={title} aria-label={title} onClick={() => onPick(id)}
    onFocus={idx === undefined || !onFocusIdx ? undefined : () => onFocusIdx(idx)}><TileSvg tile={tile} stroke={stroke} /></button>;
});
const isTabler = (id: unknown): id is string => typeof id === "string" && /^tabler(-filled)?:/.test(id);
/** what Tab and Shift+Tab go round in the window */
const FOCUSABLE = 'input:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';
const label = (id: string) => id.replace(/^tabler(-filled)?:/, "").replace(/-/g, " ");

function IconPicker({ req }: { req: PickerReq }) {
  const o = prefs().iconOpts || {};
  // Change icon… on a built-in icon (4.3): the window opens at its Tabler counterpart (icon-legacy.ts)
  const item = req.mode === "replace" ? get().deck.slides[get().deck.cur]?.cfg.items?.[req.id] as ShapeItem | undefined : undefined;
  const legacy = legacyCounterpart(item?.icon);
  const [q, setQ] = useState(legacy ? legacy.replace(/^tabler(-filled)?:/, "").replace(/-/g, " ") : "");
  const [style, setStyle] = useState<"outline" | "filled">(legacy ? (legacy.startsWith("tabler-filled:") ? "filled" : "outline") : o.style === "filled" ? "filled" : "outline");
  const [category, setCategory] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(typeof o.color === "string" ? o.color : null);
  const [size, setSize] = useState(SIZES.includes(o.size as number) ? o.size as number : 64);
  // Change icon…: the tiles drawn at the item's own line width (what it will look like), not the picker's
  const [stroke, setStroke] = useState(item ? iconStroke(item.stroke) : WIDTHS.includes(o.stroke as number) ? o.stroke as number : 2);
  const [ans, setAns] = useState<{ names: string[]; categories: string[]; version: string; q: string; style: string; cat: string | null; ms: number; first: boolean; cold: boolean } | null>(null);
  const [state, setState] = useState<"busy" | "ready" | "none">("busy");
  const [top, setTop] = useState(0);
  const [active, setActive] = useState(0);
  const [dims, setDims] = useState({ cols: COLS, rows: VIEW_ROWS });
  const [limit, setLimit] = useState(Infinity);
  const [, bump] = useState(0);
  const tiles = useRef(new Map<string, IconTile>());
  const seq = useRef(0), typed = useRef(0), asked = useRef(new Set<string>()), dimsRef = useRef(dims), focusIdx = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), dlg = useRef<HTMLDivElement>(null);
  // the recent icons: Tabler ones only (a built-in name is never offered again)
  const recent = useMemo(() => (prefs().recentIcons || []).filter(isTabler).slice(0, RECENT), []);
  const side = req.mode === "insert";
  // Escape and Cancel give the focus back to the button that opened the window; a choice leaves it to the slide
  const [opener] = useState<HTMLElement | null>(() => typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null);
  const close = () => { closeIconPicker(); const b = opener; if (b && b !== document.body && b.isConnected) setTimeout(() => b.focus?.(), 0); };
  // whether the focus was in the grid: a focused tile scrolled out of the drawn rows is unmounted, and the focus then
  // goes to the grid itself (not to the page, whose keys would act on the deck behind the window)
  // (a blur without a new focus – the tile removed – keeps it)
  const inGrid = useRef(false), pendingEnter = useRef(false);

  // the grid's columns and rows from its size (as many 46 px tiles as fit), again when the window is resized
  useLayoutEffect(() => {
    const g = scroller.current; if (!g) return;
    const measure = () => {
      if (!g.clientWidth) return;
      const cols = Math.max(4, Math.floor(g.clientWidth / TILE)), rows = Math.max(2, Math.ceil(g.clientHeight / TILE));
      if (cols !== dimsRef.current.cols || rows !== dimsRef.current.rows) { dimsRef.current = { cols, rows }; setDims(dimsRef.current); }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(g);
    return () => ro.disconnect();
  }, [state === "none"]);
  useEffect(() => { input.current?.focus(); if (legacy) input.current?.select(); }, []);
  // a search per change of the words, the set or the category: the worker answers the hits and the first screen's tiles.
  // Asked in the commit of the keystroke's own render (a layout effect), not after its frame: the worker starts at once
  useLayoutEffect(() => {
    const n = ++seq.current, draw = firstPart(dimsRef.current.cols);
    void core().call("iconSearch", { query: q, style, category, draw, also: recent.filter(id => !tiles.current.has(id)) }).then((a: IconSearchAnswer | null) => {
      if (n !== seq.current) return;
      if (!a) { setState("none"); return; }
      // a tile already held is kept (the same icon's same paths): its memoised tile is not drawn again
      for (const [id, t] of Object.entries(a.tiles)) if (!tiles.current.has(id)) tiles.current.set(id, t);
      pickerStats.workerMs = a.ms; if (a.first) pickerStats.firstUse = a.ms;
      setAns({ names: a.names, categories: a.categories, version: a.version, q, style, cat: category, ms: a.ms, first: a.first, cold: a.cold }); setState("ready"); setTop(0); setActive(0); setLimit(draw);
      if (scroller.current) scroller.current.scrollTop = 0;
    }).catch(() => { if (n === seq.current) setState("none"); });
  }, [q, style, category, recent]);
  // an Enter typed before the answer: its first hit, once the answer for what was typed has come
  useEffect(() => {
    if (!pendingEnter.current || !ans || ans.q !== q || ans.style !== style || ans.cat !== category) return;
    pendingEnter.current = false;
    if (ans.names.length) pickRef.current((ans.style === "filled" ? "tabler-filled:" : "tabler:") + ans.names[0]);
  }, [ans]);
  // keystroke → results drawn: measured after the frame that shows them
  useLayoutEffect(() => {
    if (!ans || !typed.current) return;
    const t0 = typed.current; typed.current = 0;
    requestAnimationFrame(() => { pickerStats.lastMs = now() - t0; });
  }, [ans]);

  const names = ans?.names ?? [], { cols, rows: viewRows } = dims;
  // the hits' own set (the style they were asked in: the switch may be ahead of the answer)
  const prefix = ans?.style === "filled" ? "tabler-filled:" : "tabler:";
  /** whether the hits answer what the window asks now (words, set, category) */
  const current = !!ans && ans.q === q && ans.style === style && ans.cat === category;
  const rows = Math.ceil(names.length / cols), first = Math.max(0, Math.floor(top / TILE) - 1), last = Math.min(rows, Math.ceil((top + viewRows * TILE) / TILE) + 1);
  const inView = useMemo(() => names.slice(first * cols, last * cols).map(n => prefix + n), [names, first, last, cols, prefix]);
  // a new search draws its first rows first (limit), the others once their tiles are here
  const ids = limit < inView.length ? inView.slice(0, limit) : inView;
  // the rows scrolled into view: their tiles asked once. After a new search, the rows past its first part are asked
  // (and drawn) once the typing pauses (REST_MS): each keystroke draws no more than 4.8's grid did
  useEffect(() => {
    const more = () => {
      // (a late answer never lifts the limit of a newer search: tied to the search it was asked for)
      const n = seq.current, mine = () => n === seq.current;
      const miss = inView.filter(id => !tiles.current.has(id) && !asked.current.has(id));
      if (!miss.length) { setLimit(Infinity); return; }
      miss.forEach(id => asked.current.add(id));
      void core().call("iconTiles", { ids: miss }).then(t => {
        for (const [id, x] of Object.entries(t)) tiles.current.set(id, x);
        bump(v => v + 1); if (mine()) setLimit(Infinity);
      }).catch(() => { miss.forEach(id => asked.current.delete(id)); if (mine()) setLimit(Infinity); });    // asked again when in view again
    };
    if (limit === Infinity) { more(); return; }
    const t = setTimeout(more, REST_MS);
    return () => clearTimeout(t);
  }, [inView, limit]);
  // the arrow keys: the tile they moved to takes the focus once its row is drawn; a focused tile scrolled away: the grid
  useLayoutEffect(() => {
    if (focusIdx.current !== null) {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-idx="${focusIdx.current}"]`);
      if (el) { el.focus({ preventScroll: true }); focusIdx.current = null; return; }
    }
    const a = document.activeElement;
    if (inGrid.current && (!a || a === document.body || !a.isConnected)) scroller.current?.focus({ preventScroll: true });
  });

  const pick = (id: string) => {
    rememberIcon(id);
    // the new icon's options are remembered from Insert only: Change icon… (a built-in filled icon's counterpart, an
    // item's own width) and a chart mark's pick leave the Insert defaults as they are
    if (req.mode === "insert") setPrefs({ iconOpts: { style, color, size, stroke } } as Partial<Prefs>);
    closeIconPicker();
    if (req.mode === "pick") req.onPick(id);
    else if (req.mode === "replace") itemPatch("Change icon", req.id, { icon: id });
    else insertShape("icon", id, { size, ...(color ? { fill: color } : {}), ...(id.startsWith("tabler:") && stroke !== 2 ? { stroke } : {}) });
  };
  const pickRef = useRef(pick); pickRef.current = pick;
  const onTile = useMemo(() => (id: string) => pickRef.current(id), []);
  const onFocusIdx = useMemo(() => (i: number) => setActive(i), []);
  const cur = Math.min(active, Math.max(0, names.length - 1));
  /** tile `i` of the hits active and in view (the grid scrolled to its row), focused after the render */
  const moveTo = (i: number) => {
    if (!names.length) return;
    const j = Math.max(0, Math.min(names.length - 1, i)), g = scroller.current;
    setActive(j); focusIdx.current = j; setLimit(Infinity);
    if (g) {
      const y = Math.floor(j / cols) * TILE;
      if (y < g.scrollTop) g.scrollTop = y; else if (y + TILE > g.scrollTop + g.clientHeight) g.scrollTop = y + TILE - g.clientHeight;
      setTop(g.scrollTop);
      // a tile drawn already takes the focus now (no render may follow: the same tile, the same rows)
      const el = g.querySelector<HTMLElement>(`[data-idx="${j}"]`);
      if (el) { el.focus({ preventScroll: true }); focusIdx.current = null; }
    }
  };
  const onGridKey = (e: KeyboardEvent) => {
    const page = cols * Math.max(1, viewRows - 1);
    const to: Record<string, number> = { ArrowRight: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur + cols, ArrowUp: cur - cols, Home: 0, End: names.length - 1, PageDown: cur + page, PageUp: cur - page };
    if (!(e.key in to)) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && cur < cols) { input.current?.focus(); return; }
    moveTo(to[e.key]);
  };
  const onRecentKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const bs = [...e.currentTarget.querySelectorAll<HTMLElement>("button")], k = bs.indexOf(document.activeElement as HTMLElement);
    if (k < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); bs[Math.max(0, Math.min(bs.length - 1, k + (e.key === "ArrowRight" ? 1 : -1)))].focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveTo(cur); }
    else if (e.key === "ArrowUp") { e.preventDefault(); input.current?.focus(); }
  };
  // Tab and Shift+Tab stay in the window (from anywhere: a click on the window's text leaves the focus on it, or on the page)
  const trap = (e: { shiftKey: boolean; preventDefault: () => void }) => {
    const all = dlg.current ? [...dlg.current.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
    else if (!e.shiftKey && (at < 0 || at === all.length - 1)) { e.preventDefault(); all[0].focus(); }
  };
  const tile = (id: string, name?: string, idx?: number, tab = true) => <Tile key={id} id={id} title={name ?? label(id)} tile={tiles.current.get(id)} stroke={stroke} onPick={onTile}
    idx={idx} tab={tab} onFocusIdx={onFocusIdx} />;
  const ink = color ?? "#1F2430";
  // the categories: drawn again only when they or the chosen one change (not on each keystroke)
  const catList = ans?.categories;
  const cats = useMemo(() => <div className="iccats" id="iconCats" role="group" aria-label="Categories">
    <button className={category === null ? "on" : ""} data-cat="" aria-pressed={category === null} onClick={() => setCategory(null)}>All icons</button>
    {(catList ?? []).map(c => <button key={c} className={category === c ? "on" : ""} data-cat={c} aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</button>)}
  </div>, [catList, category]);
  // Escape and Tab while the window is open, wherever the focus is (as Dialogs.tsx): before the page's own keys
  const keysRef = useRef({ close, trap }); keysRef.current = { close, trap };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); keysRef.current.close(); }
      else if (e.key === "Tab") { e.stopPropagation(); keysRef.current.trap(e); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, []);
  const title = req.mode === "replace" ? "Change icon" : req.mode === "pick" ? req.title ?? "Choose icon" : "Insert an icon or a shape";

  return <div className="modal" id="iconPicker" onKeyDown={e => e.stopPropagation()}
    onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
    <style>{CSS}</style>
    <div className="dlg icdlg" ref={dlg} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="iconPickerTitle">
      <div className="dlghd"><b id="iconPickerTitle">{title}</b>
        <span>Search by name or tag (English or Italian), or pick a category{side ? "; the shapes and a text box are on the side" : ""}. Tabler Icons{ans ? " " + ans.version : ""} · MIT</span></div>
      <div className="ictools">
        <input ref={input} id="iconSearch" className="icsearch" placeholder="Search icons… (e.g. bank, freccia su, euro)" value={q} aria-label="Search icons" autoComplete="off"
          onChange={e => { typed.current = now(); setQ((e.target as HTMLInputElement).value); }}
          onKeyDown={e => {
            // Enter: the active hit of what is typed now – the answer to the last key is waited for
            if (e.key === "Enter") { e.preventDefault(); if (current) { if (names.length) pick(prefix + names[cur]); } else pendingEnter.current = true; }
            else if (e.key === "ArrowDown" && names.length) { e.preventDefault(); moveTo(cur); }
          }} />
        <div className="seg small" id="iconStyle">{(["outline", "filled"] as const).map(s => <button key={s} data-style={s} className={style === s ? "on" : ""} aria-pressed={style === s} onClick={() => { typed.current = now(); setStyle(s); }}>{s === "outline" ? "Outline" : "Filled"}</button>)}</div>
      </div>
      <div className={"icbody" + (side ? "" : " noside")}>
        {cats}
        <div className="icmain" style={{ color: ink === "#FFFFFF" ? "#1F2430" : ink }}>
          {recent.length > 0 && !q.trim() && category === null && <><div className="ichd">Recent</div>
            <div className="icrecent" id="iconRecent" role="group" aria-label="Recent icons" onKeyDown={onRecentKey}>{recent.map((id, k) => tile(id, undefined, undefined, k === 0))}</div></>}
          <div className="ichd" id="iconCount" aria-live="polite">{state === "none" ? "" : state === "busy" ? "Searching…" : `${names.length.toLocaleString("en")} icon${names.length === 1 ? "" : "s"}${category ? " in " + category : ""}`}</div>
          {state === "none" ? <div className="icnone" id="iconNone">The icon set is read by Slide Builder's background worker, which this browser did not start. Reload the page{side ? "; the shapes and the text box on the side still work" : ""}.</div>
            : <div className="icgrid" id="iconGrid" ref={scroller} tabIndex={-1} role="group" aria-label="Icons" data-q={ans?.q ?? ""} data-style={ans?.style ?? ""} data-n={names.length} data-cols={cols} data-ms={ans?.ms ?? ""} data-first={ans?.first ? "1" : "0"} data-cold={ans?.cold ? "1" : "0"}
              onScroll={e => { setTop((e.target as HTMLDivElement).scrollTop); setLimit(Infinity); }} onKeyDown={onGridKey}
              onFocus={() => { inGrid.current = true; }} onBlur={e => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to)) inGrid.current = false; }}>
              <div style={{ height: rows * TILE + "px", position: "relative" }}>
                <div className="icrows" style={{ top: first * TILE + "px", gridTemplateColumns: `repeat(${cols}, ${TILE}px)` }}>{ids.map((id, k) => { const i = first * cols + k; return tile(id, names[i], i, i === cur); })}</div>
              </div>
              {state === "ready" && !names.length && <div className="icnone">No icon matches “{q}”{category ? " in " + category : ""}.</div>}
            </div>}
        </div>
        {side && <ShapeColumn onDone={closeIconPicker} />}
      </div>
      {req.mode === "insert" ? <div className="icopts">
        <span className="lbl">Icon colour</span>
        <button className={"icsw auto" + (color === null ? " on" : "")} data-iccolor="" title="The design's (the text colour)" aria-pressed={color === null} onClick={() => setColor(null)}>A</button>
        {INKS.map(c => <button key={c} className={"icsw" + (color === c ? " on" : "")} data-iccolor={c} title={c} aria-label={"Colour " + c} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />)}
        <span className="lbl">Size</span>
        <div className="seg small" id="iconSize">{SIZES.map(s => <button key={s} data-size={s} className={size === s ? "on" : ""} aria-pressed={size === s} onClick={() => setSize(s)}>{s}</button>)}</div>
        <span className="lbl">Line</span>
        <div className="seg small" id="iconWidth">{WIDTHS.map(w => <button key={w} data-width={w} disabled={style === "filled"} className={stroke === w ? "on" : ""} aria-pressed={stroke === w} title={style === "filled" ? "Filled icons have no outline" : `Outline ${w} px at 24 px`} onClick={() => setStroke(w)}>{w}</button>)}</div>
        <span style={{ flex: "1" }} /><button className="btn" id="iconCancel" onClick={close}>Cancel</button>
      </div> : <div className="icopts"><span className="lbl">{req.mode === "replace" ? "The icon keeps its colour, size and line (Icon tools on the ribbon)." : ""}</span><span style={{ flex: "1" }} /><button className="btn" id="iconCancel" onClick={close}>Cancel</button></div>}
    </div>
  </div>;
}
