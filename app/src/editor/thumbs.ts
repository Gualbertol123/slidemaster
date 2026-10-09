/* Slide thumbnails, filled lazily when they scroll into view. */
import { get, THUMBS } from "../state/store";
import { ctx } from "../state/app";
import { buildSlide } from "../render/slide";

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
/** frames are created by the React list (ui/Thumbs.tsx); this fills them */
export function renderThumbs() {
  if (!box) return;
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
