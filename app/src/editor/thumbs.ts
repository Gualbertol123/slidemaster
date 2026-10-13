/* Slide thumbnails, filled lazily when they scroll into view. */
import { get, THUMBS } from "../state/store";
import { ctx, htmlArrived } from "../state/app";
import { buildSlide } from "../render/slidedom";
import { useStage } from "../stage/data";

let box: HTMLElement | null = null, io: IntersectionObserver | null = null;
export function mountThumbs(el: HTMLElement) {
  box = el;
  THUMBS.render = renderThumbs; THUMBS.refresh = refreshThumb;
  renderThumbs();
}
function fill(fr: HTMLElement, i: number) {
  if (!get().deck.slides[i]) return;
  fr.innerHTML = ""; fr.appendChild(buildSlide(get().deck.slides[i], i, ctx(), { thumb: true })); fr.dataset.done = "1";
}
/** frames are created by the React list (ui/Thumbs.tsx); this fills them – after the stage has drawn the slide (it asks
    the page to measure text: the stage first, S4.1) and the worker's HTML of the tables has arrived (else the page
    would draw them itself) */
let waiting: (() => void) | null = null;
export function renderThumbs() {
  if (!box) return;
  if ((!useStage.getState().shown || !htmlArrived()) && get().doc.open) {
    // drawn when the stage shows a slide, or by the next call (the HTML's arrival calls THUMBS.render)
    if (!waiting) waiting = useStage.subscribe(s => { if (s.shown) renderThumbs(); });
    return;
  }
  if (waiting) { waiting(); waiting = null; }
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io!.unobserve(en.target); fill(en.target as HTMLElement, +(en.target as HTMLElement).dataset.i!); } }), { root: box, rootMargin: "300px" });
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
