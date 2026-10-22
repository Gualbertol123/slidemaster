/* What the stage shows (PLAN S4.1, Part B §2–§3): the current slide's display list in layers, as the core worker
   built it (the worker owns display lists; the page caches them by id), the pictures they draw, and the editor
   open on the slide. The stage asks for the slide after every change of the document, the slide, the design or
   the version (state/app.ts calls STAGE.render / STAGE.refresh); one request is on its way at a time and the
   newest wins. While an editor is open nothing is redrawn under it (v3's rule, E8): the newest slide waits and is
   shown when the editor closes. */
import { create } from "zustand";
import { get, patch, STAGE, useStore } from "../state/store";
import { core, ctx } from "../state/app";
import type { StageSlide } from "@slide-builder/core/rpc/messages";
import { todayLabel } from "@slide-builder/core/render/cover";

/** an editor open on the slide: a cell (with what typing started it), a slide text (title, subtitle, cover
    note or date) or a text box */
export type Editor = { kind: "cell"; initial?: string } | { kind: "text"; key: import("@slide-builder/core/model/types").SlideTextKey } | { kind: "note"; key: string }
  /** a callout's text (4.3) */ | { kind: "item"; id: string };
export interface StageState {
  /** the slide drawn (null: none yet, or no slide) */
  shown: StageSlide | null;
  editor: Editor | null;
  /** zoom factor of the slide on screen (fit or the chosen zoom) */
  scale: number;
  /** a drag in progress draws its preview */
  drag: import("./drags").DragPreview | null;
  /** counts "Fit" pressed again: the stage measures its space again (the panels around it may have changed) */
  fitTick: number;
  /** the tables are ready to be resized (the pointer is on a corner handle): their layers move in the compositor */
  armed: boolean;
}
export const useStage = create<StageState>()(() => ({ shown: null, editor: null, scale: 1, drag: null, fitTick: 0, armed: false }));
export const stage = useStage.getState;
export const setStage = (p: Partial<StageState>) => useStage.setState(p);

/* ---- pictures: data: URLs from the worker become blob: URLs once (an SVG image keeps a short URL, and a picture
   used by many glass cards – the frosted wallpaper – is decoded once) */
const images = new Map<string, string>();
export const imageHref = (id: string) => images.get(id);
function addImages(list: Record<string, string>) {
  for (const [id, src] of Object.entries(list)) {
    if (images.has(id)) continue;
    const m = /^data:([^;,]*)(;base64)?,/.exec(src);
    if (!m) { images.set(id, src); continue; }
    try {
      const body = src.slice(m[0].length), bin = m[2] ? atob(body) : decodeURIComponent(body), b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      images.set(id, URL.createObjectURL(new Blob([b], { type: m[1] || "application/octet-stream" })));
    } catch { images.set(id, src); }
  }
}

/** the deck's logo file: the issues panel says when it is missing (the slide then draws no logo). Checked by the page,
    once per workbook and logo – again when either changes: a failure before the file was copied does not stick */
let logoChecked = "";
function watchLogo() {
  const src = ctx().logoSrc, k = src + "|" + (get().deck.file?.name || "");
  if (!src || k === logoChecked) return;
  logoChecked = k;
  const im = new Image();
  im.onerror = () => { if (!get().ui.logoMissing) patch("ui", { logoMissing: true }); };
  im.onload = () => { if (get().ui.logoMissing) patch("ui", { logoMissing: false }); };
  im.src = src;
}

/* ---- requests */
let inflight = false, again: { fresh: boolean } | null = null, held: StageSlide | null = null;
/** a newer slide arrived while an editor was open: shown when it closes */
export function editorClosed() {
  setStage({ editor: null });
  if (held) { const h = held; held = null; show(h); }
}
/** requests sent so far: a drag's last preview waits for a slide asked for after it ended */
let issued = 0;
export const requestsIssued = () => issued;
function show(s: StageSlide | null, n = issued) {
  if (s) watchLogo();
  if (stage().editor && s) { held = s; return; }
  // a drag's last preview stays until a slide asked for after the drag (drawn with its change) replaces it
  const d = stage().drag, clear = !!d?.done && n > (d.after ?? 0);
  // the same slide drawn the same (an answer after the worker sent it unasked): nothing to redraw
  if (!clear && sameSlide(stage().shown, s)) return;
  setStage(clear ? { shown: s, drag: null } : { shown: s });
}
const sameSlide = (a: StageSlide | null, b: StageSlide | null) => a === b || (!!a && !!b && a.id === b.id && a.slide === b.slide && a.layers.length === b.layers.length
  && a.layers.every((l, i) => l.key === b.layers[i].key && JSON.stringify(l.box) === JSON.stringify(b.layers[i].box))
  // (B51: the contents slide's parts – a free layout switched on draws the same pixels, and shows their handles)
  && JSON.stringify(a.parts ?? null) === JSON.stringify(b.parts ?? null));
/** the worker sent the slide on the stage after a change, or after a workbook started (it draws the stage's last request
    at once); one that is not the current slide yet – the page has not taken the new workbook's slides – waits for it */
let early: StageSlide | null = null;
export function stagePushed(s: StageSlide) {
  addImages(s.images);
  const now = get().deck;
  if (!get().doc.open || now.cur !== s.slide || now.slides[now.cur]?.id !== s.id) { early = s; return; }
  early = null;
  show(s, issued + 1);                                    // drawn after every request so far
}
/** what the stage asks for slide `slide` */
export const stageRequest = (slide: number) => ({ slide, today: todayLabel(), known: [...images.keys()], soft: !!get().prefs.prefs.softShadows, ...(outlinesAll() ? { outlines: "all" as const } : {}) });
/** every font's text as outlines on the stage (S4.4's SP switch, until decided: localStorage sbOutlines = "all") */
const outlinesAll = () => { try { return localStorage.getItem("sbOutlines") === "all"; } catch { return false; } };
/** the next request names no layers (a layer named last time was gone when the answer came) */
let whole = false;
/** an answer whose layers the page had come without markup: they are the page's own again (null: one is not there) */
function fill(s: StageSlide, base: StageSlide | null): StageSlide | null {
  if (!s.layers.some(l => !l.svg.length)) return s;
  const mine = new Map((base?.layers || []).map(l => [l.key, l]));
  const layers = s.layers.map(l => l.svg.length ? l : mine.get(l.key) ?? (l.nodes.length || l.table !== null ? null : l));
  return layers.every(Boolean) ? { ...s, layers: layers as StageSlide["layers"] } : null;
}
/** asks the worker for the current slide; `fresh`: measure all text again (fonts arrived) */
export function requestStage(fresh = false) {
  if (inflight) { again = { fresh: !!(again?.fresh || fresh) }; return; }
  const { deck: { cur, slides }, doc: { open } } = get();
  if (!open || !slides[cur]) { held = null; setStage({ shown: null }); return; }
  // the worker drew this slide unasked (a workbook started): shown now; the answer below is the same, or newer
  if (early && !fresh && early.slide === cur && slides[cur].id === early.id) { const e = early; early = null; show(e, issued + 1); }
  inflight = true;
  const t0 = performance.now(), n = ++issued;
  // the layers the page has of this slide come back without their markup
  const base = held ?? stage().shown, have = !whole && base && base.id === slides[cur].id ? base.layers.map(l => l.key) : [];
  whole = false;
  core().call("stage", { ...stageRequest(cur), fresh, have }).then(s => {
    if (!s) { show(null, n); return; }                     // the worker has no such slide (no document)
    addImages(s.images);
    const now = get().deck;
    // the slide changed meanwhile (another slide, or a new list of slides): asked again below
    if (now.cur !== s.slide || now.slides[now.cur]?.id !== s.id) { if (!again) again = { fresh: false }; return; }
    const filled = have.length ? fill(s, base) : s;
    if (!filled) { whole = true; if (!again) again = { fresh: false }; return; }   // (the page no longer has one of them)
    show(filled, n);
    stats.requests++; stats.last = performance.now() - t0;
  }).catch(e => console.error("stage:", e)).finally(() => {
    inflight = false;
    if (again) { const a = again; again = null; requestStage(a.fresh); }
  });
}
/** a request is on its way (tests, parity: the stage has settled when none is) */
export const stageBusy = () => inflight || !!again;
/** for tests and the bench: how many slides the stage received, and how long the last one took (ms) */
export const stats = { requests: 0, last: 0 };

STAGE.render = (fresh?: boolean) => requestStage(!!fresh);
STAGE.refresh = () => requestStage(false);
// the soft-shadows option (B3) draws the slide's shadows again
useStore.subscribe(s => !!s.prefs.prefs.softShadows, () => requestStage(false));

/** the slide on the stage with every layer's nodes (tests and the parity tools: the stage's markup carries no nodes) */
export async function stageNodes(): Promise<StageSlide | null> {
  const { deck: { cur } } = get();
  const s = await core().call("stage", { ...stageRequest(cur), nodes: true });
  return s && s.id === stage().shown?.id ? s : null;
}
STAGE.request = stageRequest;
STAGE.pushed = stagePushed;
