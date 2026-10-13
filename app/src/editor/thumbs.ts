/* Slide thumbnails (S4.3, B14): pictures of the slides, drawn by an export worker from their display lists as the PNG
   export draws them (OffscreenCanvas → ImageBitmap), never laid out on this thread. The list (ui/Chrome.tsx) keeps a
   light row for every slide – number, title, tag, badge, data-i –; only the frames near the view hold a picture: asked
   for as they come near, let go when far (a 100-slide deck holds a screenful and a margin). A slide is drawn again only
   when its display list changed: the worker answers with the key of what it drew, and without a picture when the frame
   shows that key already. */
import { get, THUMBS } from "../state/store";
import { useStage } from "../stage/data";
import { thumbPictures } from "./export";

let box: HTMLElement | null = null, near: IntersectionObserver | null = null, far: IntersectionObserver | null = null;
/** the key of the picture each frame shows */
const drawn = new WeakMap<HTMLElement, string>();
/** frames near the view, the frames to ask for (drawn when near), and every frame watched */
const inView = new Set<HTMLElement>(), dirty = new Set<HTMLElement>(), watched = new Set<HTMLElement>();
/** pictures drawn and slides asked for (tests, the bench) */
export const thumbStats = { drawn: 0, asked: 0 };

export function mountThumbs(el: HTMLElement) {
  box = el;
  THUMBS.render = renderThumbs; THUMBS.refresh = refreshThumb;
  near = new IntersectionObserver(es => {
    for (const en of es) { const fr = en.target as HTMLElement; if (en.isIntersecting) inView.add(fr); else inView.delete(fr); }
    void pump();
  }, { root: box, rootMargin: "300px 0px" });
  // far away: the picture goes (asked for again when it comes near)
  far = new IntersectionObserver(es => {
    for (const en of es) if (!en.isIntersecting) { const fr = en.target as HTMLElement; if (drawn.has(fr)) { drawn.delete(fr); release(fr); dirty.add(fr); } }
  }, { root: box, rootMargin: "1500px 0px" });
  watchRatio();
  renderThumbs();
}
/** the window moved to a screen with another pixel ratio: the pictures are drawn again at its size */
function watchRatio() {
  const q = typeof matchMedia === "function" ? matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`) : null;
  q?.addEventListener("change", () => { watchRatio(); renderThumbs(); }, { once: true });
}

/** a frame lets its picture go: the pixels at once (a canvas left to the garbage collector keeps them until a full
    collection, which then falls into a frame), the canvas stays for the next picture */
function release(fr: HTMLElement) {
  const cv = fr.querySelector("canvas");
  if (cv) { (cv.getContext("bitmaprenderer") as ImageBitmapRenderingContext).transferFromImageBitmap(null); cv.width = cv.height = 0; }
  fr.dataset.done = "";
}
/** the picture's width in device pixels (the frame is 222 CSS px wide) */
const width = () => Math.round(222 * (globalThis.devicePixelRatio || 1));
function show(fr: HTMLElement, bitmap: ImageBitmap) {
  let cv = fr.querySelector("canvas");
  if (!cv) { cv = document.createElement("canvas"); fr.replaceChildren(cv); }
  cv.width = bitmap.width; cv.height = bitmap.height;
  (cv.getContext("bitmaprenderer") as ImageBitmapRenderingContext).transferFromImageBitmap(bitmap);
  fr.dataset.done = "1";
}

/** asks for the dirty frames near the view, the current slide's neighbours first, a few at a time (each answer is drawn
    as it comes; an edit's slide is not held behind a long queue) */
let busy = false, retry: ReturnType<typeof setTimeout> | null = null;
async function pump() {
  if (busy || retry || !box || !get().doc.open) return;
  const cur = get().deck.cur, at = (fr: HTMLElement) => +fr.dataset.i!;
  const batch = [...dirty].filter(fr => fr.isConnected && inView.has(fr)).sort((a, b) => Math.abs(at(a) - cur) - Math.abs(at(b) - cur)).slice(0, 6);
  for (const fr of dirty) if (!fr.isConnected) dirty.delete(fr);
  if (!batch.length) return;
  batch.forEach(fr => dirty.delete(fr));
  busy = true;
  try {
    const have: Record<number, string> = {};
    for (const fr of batch) { const k = drawn.get(fr); if (k) have[at(fr)] = k; }
    thumbStats.asked += batch.length;
    const out = await thumbPictures(batch.map(at), width(), have);
    for (const t of out) {
      if (!t.bitmap) continue;
      // the frame of that slide now (the list may have changed meanwhile: a picture of another slide is replaced, its key differs)
      const fr = box?.querySelector<HTMLElement>(`.frame[data-i="${t.slide}"]`);
      if (!fr) { t.bitmap.close(); continue; }
      show(fr, t.bitmap); drawn.set(fr, t.key); thumbStats.drawn++;
    }
  } catch (e) {
    // (the export worker stopped, or the core): the frames are asked for again a moment later
    console.warn("thumbnails:", e);
    batch.forEach(fr => dirty.add(fr));
    retry = setTimeout(() => { retry = null; void pump(); }, 2000);
  } finally { busy = false; }
  void pump();
}

/** frames are created by the React list; every one may show something else now (another design, version, document):
    asked for again – after the stage has drawn its slide (the stage first, S4.1), at most 3 s later whatever happened */
let waiting: (() => void) | null = null;
export function renderThumbs(force = false) {
  if (!box) return;
  if (!force && !useStage.getState().shown && get().doc.open) {
    if (!waiting) {
      const stop = useStage.subscribe(s => { if (s.shown) renderThumbs(); }), t = setTimeout(() => renderThumbs(true), 3000);
      waiting = () => { stop(); clearTimeout(t); };
    }
    return;
  }
  if (waiting) {
    // they were waiting: asked for once the stage's first frame is painted (not in the same frame)
    waiting(); waiting = null;
    const go = () => renderThumbs(true);
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 500 }); else setTimeout(go, 50);
    return;
  }
  for (const fr of watched) if (!fr.isConnected) { near!.unobserve(fr); far!.unobserve(fr); watched.delete(fr); inView.delete(fr); dirty.delete(fr); }
  box.querySelectorAll<HTMLElement>(".frame").forEach(fr => { near!.observe(fr); far!.observe(fr); watched.add(fr); dirty.add(fr); });
  void pump();
}
/** a change of one slide (an edit): that slide and the index slides (they list the titles), a moment later */
let timer: ReturnType<typeof setTimeout> | null = null;
export function refreshThumb(only?: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!box) return;
    const redo = (i: number) => { const fr = box!.querySelector<HTMLElement>(`.frame[data-i="${i}"]`); if (fr) dirty.add(fr); };
    get().deck.slides.forEach((R, i) => { if (only === undefined || i === only || R.type === "index") redo(i); });
    void pump();
  }, 350);
}
