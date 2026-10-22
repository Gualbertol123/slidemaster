/* A toolbar that keeps its rows at any window width (4.12, the owner's request: "the toolbars at the top … should
   adapt responsively to the changes in screen sizes"): the top bar and the text ribbon on one row, the layout ribbon
   (its tools are some 2,300 px wide) on at most two. Its children – the groups – are measured as they are drawn (the
   browser's own widths, so fonts and Windows' display scaling are included):
   1. everything fits on one row: shown as written;
   2. else groups go compact, the least needed first (data-prio: a larger number goes earlier; the same number: the
      later group first) – a button with an icon shows the icon alone (its title still names it), a group's small
      label goes;
   3. else, for a bar that may take two rows, the same on two rows;
   4. else, all compact, groups go into "More ▾" in the same order (and back whatever still fits). More ▾ opens the bar
      over what is below it, the groups it holds on the rows under the first – the same elements, so their menus, their
      state and the tests' ids are those of the row.
   The plan is a pure function (planBar, tests/responsive.test.tsx); the bar measures again when the window's width
   changes, when its content changes (a selection brings a shape's tools, a design its own group) and when the fonts
   arrive. Nothing here is React state but the menu's open flag: the marks (data-compact, data-ovf on the groups,
   data-has-more and data-wrap on the bar) are attributes React does not own, so a render never drops them. */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface BarUnit { full: number; compact: number; prio: number; fixed?: boolean }
export interface BarPlan { compact: number[]; hidden: number[]; rows: number }

/** how many rows widths `ws` take, `gap` apart, laid out left to right in `room` px (the browser's flex-wrap) */
export function rowsOf(ws: number[], room: number, gap: number): number {
  let rows = ws.length ? 1 : 0, x = -gap;
  for (const w of ws) { if (x + gap + w > room && x >= 0) { rows++; x = w; } else x += gap + w; }
  return rows;
}

/** what the bar shows in `avail` px, on at most `maxRows` rows: which units are compact, which go into More (`moreW`:
    the More button's width, on the last row). Fewest rows first; the least needed unit first (the largest data-prio;
    the same: the later one): one row as written, then compact one unit at a time; then two rows (when the bar may
    take two) the same way; then, all compact, into More one at a time – and back from More whatever still fits */
export function planBar(units: BarUnit[], avail: number, gap: number, moreW: number, maxRows = 1): BarPlan {
  const room = avail - 1;                                       // sub-pixel widths rounded the other way
  const order = units.map((u, i) => ({ u, i })).filter(x => !x.u.fixed).sort((a, b) => b.u.prio - a.u.prio || b.i - a.i).map(x => x.i);
  const compact = new Set<number>(), hidden = new Set<number>();
  const rows = () => rowsOf([...units.flatMap((u, k) => hidden.has(k) ? [] : [compact.has(k) ? u.compact : u.full]), ...(hidden.size ? [moreW] : [])], room, gap);
  const plan = (): BarPlan => ({ compact: [...compact].sort((a, b) => a - b), hidden: [...hidden].sort((a, b) => a - b), rows: rows() });
  for (let r = 1; r <= Math.max(1, maxRows); r++) {
    compact.clear();
    if (rows() <= r) return plan();
    for (const i of order) { compact.add(i); if (rows() <= r) return plan(); }
  }
  for (const i of order) { hidden.add(i); if (rows() <= maxRows) break; }
  for (const i of [...hidden].reverse()) { hidden.delete(i); if (rows() > maxRows) hidden.add(i); }   // back what fits
  return plan();
}

/** measures bar `el` and marks it (see the head of this file); `close`: More is closed when nothing is left in it */
export function fitBar(el: HTMLElement, close?: () => void) {
  if (!el.isConnected || !el.clientWidth) return;                // not laid out (a test's DOM, a hidden page)
  const kids = [...el.children] as HTMLElement[], more = kids.find(k => k.hasAttribute("data-more-btn"));
  const items = kids.filter(k => k !== more);
  el.setAttribute("data-measure", "");                          // every group shown, the More button too
  for (const k of items) k.removeAttribute("data-ovf");         // (set again below; a group in More is drawn in full)
  const width = (k: HTMLElement) => {
    const cs = getComputedStyle(k);
    return cs.display === "none" ? 0 : k.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  };
  const mark = (k: Element, on: boolean) => { if (on) k.setAttribute("data-compact", ""); else k.removeAttribute("data-compact"); };
  const was = items.map(k => k.hasAttribute("data-compact"));
  items.forEach(k => mark(k, false)); const full = items.map(width);
  items.forEach(k => mark(k, true)); const compact = items.map(width);
  const moreW = more ? width(more) : 0;
  items.forEach((k, i) => mark(k, was[i]));
  el.removeAttribute("data-measure");
  const cs = getComputedStyle(el), avail = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const gap = parseFloat(cs.columnGap) || 0;
  // the units: what is drawn (a hidden input is not); a flexible part (the file name, the spacer) counts as its reserve
  const live = items.map((k, i) => ({ k, i })).filter(x => full[x.i] > 0 || x.k.hasAttribute("data-flex"));
  const units: BarUnit[] = live.map(({ k, i }) => {
    const flex = k.getAttribute("data-flex");
    return flex !== null ? { full: +flex || 0, compact: +flex || 0, prio: 0, fixed: true } : { full: full[i], compact: compact[i], prio: +(k.getAttribute("data-prio") || 0), fixed: false };
  });
  const plan = planBar(units, avail, gap, moreW, +(el.getAttribute("data-max-rows") || 1)), off = new Set(plan.hidden.map(h => live[h].k)), small = new Set(plan.compact.map(h => live[h].k));
  for (const k of items) { mark(k, small.has(k)); if (off.has(k)) k.setAttribute("data-ovf", ""); else k.removeAttribute("data-ovf"); }
  if (plan.rows > 1) el.setAttribute("data-wrap", ""); else el.removeAttribute("data-wrap");
  if (off.size) el.setAttribute("data-has-more", String(off.size)); else { el.removeAttribute("data-has-more"); close?.(); }
}

/** the bar: `tag` its element (nav, header), `className` its classes; `moreClass` the More button's look (tb, btn);
    `rows`: how many rows it may take */
export function OverflowBar({ tag = "nav", className, id, moreClass = "tb", rows = 1, children }: { tag?: "nav" | "header"; className: string; id?: string; moreClass?: string; rows?: number; children: ReactNode }) {
  const slot = useRef<HTMLDivElement>(null), bar = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const closeRef = useRef(() => setOpen(false));
  useLayoutEffect(() => {
    const el = bar.current!;
    const fit = () => fitBar(el, closeRef.current);
    fit();
    let lastW = innerWidth;
    const resize = () => { if (innerWidth !== lastW) { lastW = innerWidth; fit(); } };
    addEventListener("resize", resize);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(fit);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    void fonts?.ready?.then(fit);
    fonts?.addEventListener?.("loadingdone", fit);
    return () => { removeEventListener("resize", resize); mo?.disconnect(); fonts?.removeEventListener?.("loadingdone", fit); };
  }, []);
  // open: the bar lies over what is below it (its place kept at its one row's height); a press outside it or Esc closes it
  useLayoutEffect(() => {
    const s = slot.current!, el = bar.current!;
    if (!open) { s.style.height = ""; return; }
    const down = (e: PointerEvent) => { const t = e.target as Element | null; if (t && !el.contains(t) && !t.closest?.(".menu")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !el.querySelector(".menu.open")) setOpen(false); };
    document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [open]);
  const toggle = () => {
    if (!open) slot.current!.style.height = bar.current!.offsetHeight + "px";
    setOpen(!open);
  };
  const Tag = tag;
  return <div className="obslot" ref={slot}>
    <Tag className={className + " obar"} id={id} ref={bar as never} data-max-rows={rows} {...(open ? { "data-more": "" } : {})}>
      {children}
      <button type="button" className={moreClass + " obmore"} data-more-btn="" aria-expanded={open} aria-haspopup="true"
        title={open ? "Hide the tools that do not fit in this window" : "The tools that do not fit in this window"} onClick={toggle}>More<span className="obcaret">▾</span></button>
    </Tag>
  </div>;
}
