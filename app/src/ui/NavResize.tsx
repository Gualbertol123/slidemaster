/* The side panel's width (4.10.2, the owner's report 2026-10-22: the chart panel "too squashed" at 250 px). The panel
   left of the stage (the slides, the selected item's panel, Issues) is NAV_DEFAULT px wide, and a grip on its edge by
   the stage drags it between NAV_MIN and half the window; the width is this browser's (localStorage, a convenience:
   nothing breaks without it) and a double-click on the grip goes back to the default. The stage fits again through
   its own ResizeObserver – the window resize's path, so a fit is deferred while the main button is held (Stage.tsx
   fitOrDefer): while the grip is dragged the slide keeps its size and fits once on the release. */
import { useEffect, useState, type PointerEvent as RPointerEvent } from "react";

export const NAV_DEFAULT = 340, NAV_MIN = 280;
const KEY = "sbNavWidth";

/** the width the panel can have in a window `win` px wide: NAV_MIN … half the window (NAV_MIN when the window is narrower) */
export function clampNav(w: number, win: number = innerWidth): number {
  const max = Math.max(NAV_MIN, Math.floor(win / 2));
  return Math.round(Math.min(max, Math.max(NAV_MIN, Number.isFinite(w) ? w : NAV_DEFAULT)));
}
/** the width this browser keeps (the default when none, or storage is blocked) */
export function loadNav(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : NAV_DEFAULT; } catch { return NAV_DEFAULT; }
}
/** keep the width (null: forget it, the default again) */
export function saveNav(w: number | null) {
  try { if (w === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(Math.round(w))); } catch { /* blocked: this session only */ }
}

/** the panel's width (clamped to the window as it is now) and its setter (`commit`: kept for the next time) */
export function useNavWidth(): [number, (w: number | null, commit?: boolean) => void] {
  const [w, setW] = useState(loadNav);
  const [win, setWin] = useState(() => innerWidth);
  useEffect(() => { const f = () => setWin(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  const set = (v: number | null, commit = false) => {
    const n = v === null ? NAV_DEFAULT : clampNav(v);
    setW(n);
    if (commit) saveNav(v === null ? null : n);
  };
  return [clampNav(w, win), set];
}

/** the grip on the panel's edge: drag to resize, double-click for the default width */
export function NavGrip({ width, set }: { width: number; set: (w: number | null, commit?: boolean) => void }) {
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget, x0 = e.clientX, w0 = width;
    let last = w0;
    try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    document.body.classList.add("navsizing");
    const move = (m: PointerEvent) => { last = clampNav(w0 + m.clientX - x0); set(last); };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      document.body.classList.remove("navsizing");
      set(last, true);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  return <div className="navgrip" id="navGrip" style={{ left: width }} role="separator" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={NAV_MIN}
    title="Drag to widen the panel · double-click: the usual width" onPointerDown={down} onDoubleClick={() => set(null, true)} />;
}
