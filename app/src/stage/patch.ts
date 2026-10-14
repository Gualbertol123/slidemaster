/* A layer's markup on the page (S4.1): the worker sends it in pieces, one per node of the layer's display list, each
   with the defs it introduces (core/dl/svg.ts svgChunks). When a layer changes, the pieces before and after the
   change are the same strings: only the elements of the pieces in between are replaced (an edit of a cell rebuilds
   that cell's elements, not the table's thousands). The result is the DOM the whole markup would give. */

/** what a layer element shows: its pieces and how many top-level elements each made */
export interface Drawn { chunks: string[]; counts: number[] }

/** the top-level elements of a piece of the core's own markup (well formed, escaped: no "<" or ">" in text or values) */
export function topLevel(s: string): number {
  let n = 0, depth = 0, i = 0;
  while ((i = s.indexOf("<", i)) >= 0) {
    const end = s.indexOf(">", i);
    if (end < 0) break;
    if (s[i + 1] === "/") depth--;
    else if (s[end - 1] === "/") { if (depth === 0) n++; }
    else { if (depth === 0) n++; depth++; }
    i = end + 1;
  }
  return n;
}

const SVG = "http://www.w3.org/2000/svg";
/** shows `next` in `el`, which shows `prev` (null: nothing yet, or not to be trusted); `fix` turns a piece into the markup
    to parse (the page's picture URLs) */
export function drawChunks(el: Element, prev: Drawn | null, next: string[], fix: (s: string) => string): Drawn | null {
  const sum = (a: number[], i: number, j: number) => { let t = 0; for (let k = i; k < j; k++) t += a[k]; return t; };
  // the element still holds what was drawn last (nothing else put or took an element), or it is drawn whole
  if (prev && el.children.length === sum(prev.counts, 0, prev.counts.length)) {
    const P = prev.chunks.length, N = next.length;
    let p = 0; while (p < P && p < N && prev.chunks[p] === next[p]) p++;
    let s = 0; while (s < P - p && s < N - p && prev.chunks[P - 1 - s] === next[N - 1 - s]) s++;
    if (p === P && p === N) return prev;
    // most of it the same: the pieces in between replaced (when most changed – another design, a new layout – the
    // whole is parsed again below)
    if ((p + s) * 2 >= N) {
      const start = sum(prev.counts, 0, p), drop = sum(prev.counts, p, P - s), ref = el.children[start + drop] ?? null;
      for (let k = 0; k < drop; k++) el.children[start].remove();
      const tmp = document.createElementNS(SVG, "svg"), mid = next.slice(p, N - s);
      tmp.innerHTML = fix(mid.join(""));
      const counts = mid.map(topLevel);
      if (tmp.children.length !== sum(counts, 0, counts.length)) return whole(el, next, fix);
      const frag = document.createDocumentFragment(); while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      el.insertBefore(frag, ref);
      return { chunks: next, counts: [...prev.counts.slice(0, p), ...counts, ...prev.counts.slice(P - s)] };
    }
  }
  return whole(el, next, fix);
}
function whole(el: Element, next: string[], fix: (s: string) => string): Drawn | null {
  el.innerHTML = fix(next.join(""));
  const counts = next.map(topLevel);
  // the counting must agree with the parser, or nothing is patched in this element again
  return el.children.length === counts.reduce((a, b) => a + b, 0) ? { chunks: next, counts } : null;
}
