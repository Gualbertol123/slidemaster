/* The slide's zoom (4.12, the owner's request of 2026-10-22: "Control plus scroll wheel should zoom into the slide and
   not the entire page"). The zoom is view state only – ui.zoom, "fit" or a factor – never in the deck, never in the
   person's prefs, never sent to anybody: every window starts at Fit.
   - Ctrl (⌘) + wheel – and a trackpad pinch, which the browser reports as Ctrl + wheel – zooms the slide in smooth
     multiplicative steps, the point under the pointer staying where it is; over the panels and toolbars it zooms the
     slide about the stage's middle; over a deck the page itself never zooms (the event is cancelled wherever it
     happens, a dialog included – there nothing else happens; so too while a button is held: a drag keeps the scale it
     started with); with no deck on screen (the start page) Ctrl + wheel and the keys are the browser's own page zoom;
   - Ctrl + = / + and Ctrl + − step along ZOOM_STEPS about the stage's middle, Ctrl + 0 is Fit (by the key typed: an
     Italian keyboard's + key too; and the numeric pad's);
   - zoomed in, the stage scrolls: a plain wheel pans it up and down, Shift + wheel sideways (the browser's own
     scrolling of #stage, overflow: auto).
   The maths are pure functions (tests/zoom.test.ts); the stage (Stage.tsx) applies a pending anchor once it is drawn
   at the new scale. */
import { get } from "../state/store";
import { setZoom } from "../state/app";
import { stage } from "./data";
import { isHeld } from "./Stage";

export const ZOOM_MIN = .25, ZOOM_MAX = 4;
/** the steps of the − / + buttons and keys (Chrome's own ladder, 25 % … 400 %) */
export const ZOOM_STEPS = [.25, .33, .5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));

/** the next step above (dir 1) or below (dir −1) zoom `z` (a zoom between two steps goes to the nearer one that way) */
export function stepZoom(z: number, dir: 1 | -1): number {
  const e = 1e-3;
  if (dir > 0) return ZOOM_STEPS.find(s => s > z + e) ?? ZOOM_MAX;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z - e) return ZOOM_STEPS[i];
  return ZOOM_MIN;
}

/** a wheel's vertical delta in CSS px, whatever its unit (deltaMode 1: lines of about 16 px, 2: pages of about 800 px) */
export function wheelPx(e: { deltaY: number; deltaMode: number }): number {
  return e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);
}
/** the zoom factor of one wheel event: a mouse notch (100 px) ≈ ×1.2, a trackpad pinch's small deltas a little each –
    smooth and multiplicative; one event never more than ×1.5 */
export function wheelFactor(e: { deltaY: number; deltaMode: number }): number {
  const d = Math.max(-160, Math.min(160, wheelPx(e)));
  return Math.exp(-d * .0025);
}

/** where the slide sits in the stage at scale `s` (Stage.tsx draws it there): centred, at least 16 px from the edges */
export function slideOrigin(cw: number, ch: number, s: number): { left: number; top: number } {
  return { left: Math.max(16, (cw - 1600 * s) / 2), top: Math.max(16, (ch - 900 * s) / 2) };
}
/** the slide's whole scrolled area at scale `s`: the slide and its margins (the stage scrolls over it when it is larger) */
export function stageExtent(cw: number, ch: number, s: number): { w: number; h: number } {
  const o = slideOrigin(cw, ch, s);
  return { w: Math.max(cw, 2 * o.left + 1600 * s), h: Math.max(ch, 2 * o.top + 900 * s) };
}

/** a zoom anchored at a point of the stage: the slide point under (px, py) – px, py from the stage's top-left corner,
    in screen px – and the zoom it was at */
export interface Anchor { px: number; py: number; ux: number; uy: number }
/** the slide point under stage point (px, py), the stage scrolled to (sl, st) and the slide drawn at scale s0 */
export function anchorAt(px: number, py: number, sl: number, st: number, cw: number, ch: number, s0: number): Anchor {
  const o = slideOrigin(cw, ch, s0);
  return { px, py, ux: (px + sl - o.left) / s0, uy: (py + st - o.top) / s0 };
}
/** the scroll that keeps the anchor's slide point under its stage point at scale s1, within what the stage can scroll */
export function scrollFor(a: Anchor, cw: number, ch: number, s1: number): { left: number; top: number } {
  const o = slideOrigin(cw, ch, s1), ext = stageExtent(cw, ch, s1);
  const clamp = (v: number, max: number) => Math.round(Math.max(0, Math.min(max, v)));
  return { left: clamp(o.left + a.ux * s1 - a.px, ext.w - cw), top: clamp(o.top + a.uy * s1 - a.py, ext.h - ch) };
}

/* ---- applying a zoom: the anchor waits for the stage to draw the new scale (Stage.tsx takePendingAnchor) */
let pending: Anchor | null = null, pendingS: number | null = null;
export const takePendingAnchor = () => { const a = pending; pending = null; pendingS = null; return a; };
/** the scale the stage is drawn at – or is about to be (a zoom not drawn yet: the next one builds on it) */
const curScale = () => pendingS ?? stage().scale;

/** the stage element (null: no deck on screen) */
const stageEl = () => document.getElementById("stage");
/** zoom the slide to `z` (clamped), keeping stage point (px, py) – the stage's middle when not given – where it is */
export function zoomTo(z: number, at?: { x: number; y: number }) {
  const el = stageEl(), s0 = stage().scale, s1 = clampZoom(z);
  if (el && !pending) {                                        // (a zoom not drawn yet keeps its anchor)
    const r = el.getBoundingClientRect(), cw = el.clientWidth, ch = el.clientHeight;
    const px = at ? Math.max(0, Math.min(cw, at.x - r.left)) : cw / 2, py = at ? Math.max(0, Math.min(ch, at.y - r.top)) : ch / 2;
    pending = anchorAt(px, py, el.scrollLeft, el.scrollTop, cw, ch, s0);
  }
  if (Math.abs(s1 - curScale()) < 1e-4 && get().ui.zoom !== "fit") { if (pendingS === null) pending = null; return; }   // (at a limit)
  // the scale drawn already (100 % pressed when Fit is 100 %, or back where a zoom not drawn yet started): the stage draws
  // nothing new and takes no anchor – none is left waiting for the next zoom
  if (Math.abs(s1 - s0) < 1e-4) { pending = null; pendingS = null; setZoom(s1); return; }
  pendingS = s1;
  setZoom(s1);
}
/** − / + : the next step of ZOOM_STEPS about the stage's middle */
export const zoomStep = (dir: 1 | -1) => zoomTo(stepZoom(curScale(), dir));
export const zoomFit = () => { pending = null; pendingS = null; setZoom("fit"); };

/* ---- the wheel: a pinch or Ctrl + wheel arrives as many small events – they are summed and applied once a frame */
let acc = 1, accAt: { x: number; y: number } | null = null, frame = 0;
const flush = () => { frame = 0; const f = acc, at = accAt; acc = 1; accAt = null; if (!isHeld()) zoomTo(curScale() * f, at ?? undefined); };

/** a deck on screen (none: the start page – the browser's own zoom works there) */
const hasSlide = () => get().deck.slides.length > 0 && !!stageEl();
/** a modal (a dialog, the wizard) is open: the slide is not zoomed under it */
const modalOpen = () => { const D = get().ui.dialogs; return !!(D.dialog || D.wizard || D.tables || D.textStyles || D.comment || D.scenario || D.pick || D.setups); };

/** what a wheel event does: "zoom" the slide (at the pointer when it is over the stage), "block" the page's zoom only,
    or nothing (null: the browser's own – a plain wheel scrolls; with no slide on screen, the start page, Ctrl + wheel
    is the browser's page zoom, for those who need it larger). A dialog over a deck, or a button held (a drag measured
    its scale when it started: a zoom now would drop the shape off the pointer): blocked */
export function wheelAction(e: { ctrlKey: boolean; metaKey: boolean; target: EventTarget | null }, hasSlide: boolean, modal: boolean, held = false): "zoom" | "block" | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  if (!hasSlide) return null;
  if (modal || held) return "block";
  return "zoom";
}
export function onWheel(e: WheelEvent) {
  const what = wheelAction(e, hasSlide(), modalOpen(), isHeld());
  if (!what) return;
  e.preventDefault();                                          // the page never zooms
  if (what === "block") return;
  const t = e.target as Element | null, over = !!t?.closest?.("#stage");
  acc *= wheelFactor(e);
  accAt = over ? { x: e.clientX, y: e.clientY } : null;       // over the panels: about the stage's middle
  if (typeof requestAnimationFrame !== "function") flush(); else if (!frame) frame = requestAnimationFrame(flush);
}

/** Ctrl + = / + / − / 0 (and the numeric pad's): which zoom key `e` is (null: none) */
export function zoomKey(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string; code?: string }): "in" | "out" | "fit" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key, c = e.code || "";
  if (k === "+" || k === "=" || c === "NumpadAdd") return "in";
  if (k === "-" || k === "_" || c === "NumpadSubtract") return "out";
  if (k === "0" || c === "Digit0" || c === "Numpad0") return "fit";
  return null;
}
/** the keys' handler: true when it took the key */
export function onZoomKey(e: KeyboardEvent): boolean {
  const z = zoomKey(e); if (!z || !hasSlide()) return false;   // the start page: the browser's own zoom
  e.preventDefault();                                          // over a deck the page never zooms – in a field or a dialog too
  if (modalOpen() || isHeld()) return true;
  if (z === "fit") zoomFit(); else zoomStep(z === "in" ? 1 : -1);
  return true;
}

let installed = false;
/** Ctrl + wheel anywhere in the page – not passive, so that it can be cancelled (the page's own zoom) – and the zoom keys,
    caught first (capture on the window: a field that stops its keys' propagation, the formula bar's, still has them;
    editor/keys.ts's shortcuts are not these) */
export function installZoom() {
  if (installed || typeof addEventListener !== "function") return;
  installed = true;
  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("keydown", e => { onZoomKey(e); }, true);
}
