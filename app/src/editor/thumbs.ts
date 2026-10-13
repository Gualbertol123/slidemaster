/* Slide thumbnails, filled lazily when they scroll into view. */
import { get, THUMBS } from "../state/store";
import { ctx, htmlArrived, thumbHtmlReady } from "../state/app";
import { buildSlide } from "../render/slidedom";
import { useStage } from "../stage/data";

let box: HTMLElement | null = null, io: IntersectionObserver | null = null;
export function mountThumbs(el: HTMLElement) {
  box = el;
  THUMBS.render = renderThumbs; THUMBS.refresh = refreshThumb; THUMBS.html = htmlCame;
  renderThumbs();
}
/** frames whose slide waits for the worker's HTML of its tables (filled when it arrives) */
const notYet = new Set<HTMLElement>();
function fill(fr: HTMLElement, i: number) {
  const R = get().deck.slides[i], c = ctx(); if (!R) return;
  if (!thumbHtmlReady(R, c)) { notYet.add(fr); return; }
  notYet.delete(fr);
  fr.innerHTML = ""; fr.appendChild(buildSlide(R, i, c, { thumb: true })); fr.dataset.done = "1";
}
function htmlCame() { for (const fr of [...notYet]) if (fr.isConnected) later(fr); else notYet.delete(fr); }
/** thumbnails come into view several at a time: each is filled in a frame of its own (laying out and painting a few
    HTML slides at once is a long task; S4.3 makes them pictures) */
const queue: HTMLElement[] = [];
let queued = false;
const nextFrame = (f: () => void) => requestAnimationFrame(() => setTimeout(f, 0));
function later(fr: HTMLElement) {
  queue.push(fr);
  if (queued) return;
  queued = true;
  const next = () => {
    const f = queue.shift();
    if (f && f.isConnected) fill(f, +f.dataset.i!);
    if (queue.length) nextFrame(next); else queued = false;
  };
  nextFrame(next);
}
/** frames are created by the React list (ui/Thumbs.tsx); this fills them – after the stage has drawn the slide (it asks
    the page to measure text: the stage first, S4.1) and the worker's HTML of the tables has arrived (else the page
    would draw them itself) */
let waiting: (() => void) | null = null;
export function renderThumbs(force = false) {
  if (!box) return;
  if (!force && (!useStage.getState().shown || !htmlArrived()) && get().doc.open) {
    // drawn when the stage shows a slide, or by the next call (the HTML's arrival calls THUMBS.render) – and after 3 s
    // whatever happened (a slide the stage could not draw must not leave the list blank)
    if (!waiting) {
      const stop = useStage.subscribe(s => { if (s.shown) renderThumbs(); }), t = setTimeout(() => renderThumbs(true), 3000);
      waiting = () => { stop(); clearTimeout(t); };
    }
    return;
  }
  if (waiting) {
    // they were waiting: filled once the stage's first frame is painted (not in the same frame)
    waiting(); waiting = null;
    const go = () => renderThumbs(true);
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 500 }); else setTimeout(go, 50);
    return;
  }
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io!.unobserve(en.target); later(en.target as HTMLElement); } }), { root: box, rootMargin: "300px" });
  box.querySelectorAll<HTMLElement>(".frame").forEach(fr => { fr.dataset.done = ""; fr.innerHTML = ""; io!.observe(fr); });
}
let timer: ReturnType<typeof setTimeout> | null = null;
export function refreshThumb(only?: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!box) return;
    const redo = (i: number) => { const fr = box!.querySelector<HTMLElement>(`.frame[data-i="${i}"]`); if (fr && fr.dataset.done) fill(fr, i); };
    if (only === undefined) { get().deck.slides.forEach((_, i) => redo(i)); return; }
    redo(only);
    get().deck.slides.forEach((R, i) => { if (R.type === "index" && i !== only) redo(i); });     // the index lists titles
  }, 350);
}
