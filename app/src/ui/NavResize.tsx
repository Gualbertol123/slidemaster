/* The side panel's width (4.10.2, the owner's report 2026-10-22: the chart panel "too squashed" at 250 px). The panel
   left of the stage (the slides, the selected item's panel, Issues) is NAV_DEFAULT px wide, and a grip on its edge by
   the stage drags it between NAV_MIN and half the window; the width is this browser's (localStorage, a convenience:
   nothing breaks without it) and a double-click on the grip goes back to the default. The stage fits again through
   its own ResizeObserver – the window resize's path, so a fit is deferred while the main button is held (Stage.tsx
   fitOrDefer): while the grip is dragged the slide keeps its size and fits once on the release. */
import { useEffect, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";

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

/** the panel's grid columns (App.tsx's .main) */
export const navColumns = (w: number) => w + "px minmax(0,1fr)";

/** the grip on the panel's edge: drag to resize, double-click for the default width; focusable – ←/→ 16 px, Home the
    narrowest, End half the window, Enter the usual width. While dragged the width is drawn straight into the page (the
    grid's columns and the grip, once a frame) and React hears of it once, on the release (4.10.2 review: no re-render
    of the app per pointer move); a plain click keeps the width as it was. */
export function NavGrip({ width, set }: { width: number; set: (w: number | null, commit?: boolean) => void }) {
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget, main = el.parentElement?.classList.contains("main") ? el.parentElement : null, x0 = e.clientX, w0 = width;
    let last = w0, frame = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    document.body.classList.add("navsizing");
    const draw = () => { frame = 0; el.style.left = last + "px"; el.setAttribute("aria-valuenow", String(last)); if (main) main.style.gridTemplateColumns = navColumns(last); };
    const move = (m: PointerEvent) => {
      last = clampNav(w0 + m.clientX - x0);
      if (typeof requestAnimationFrame !== "function") draw(); else if (!frame) frame = requestAnimationFrame(draw);
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("lostpointercapture", up);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      document.body.classList.remove("navsizing");
      if (last !== w0) { draw(); set(last, true); }
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === "ArrowLeft" ? width - 16 : e.key === "ArrowRight" ? width + 16 : e.key === "Home" ? NAV_MIN : e.key === "End" ? Math.floor(innerWidth / 2) : e.key === "Enter" ? null : undefined;
    if (to === undefined) return;
    e.preventDefault(); e.stopPropagation();
    set(to, true);
  };
  return <div className="navgrip" id="navGrip" style={{ left: width }} tabIndex={0} role="separator" aria-orientation="vertical" aria-label="Side panel width"
    aria-controls="sideNav" aria-valuenow={width} aria-valuemin={NAV_MIN} aria-valuemax={Math.max(NAV_MIN, Math.floor(innerWidth / 2))}
    title="Drag to widen the panel · double-click: the usual width · ←/→ with the keyboard" onPointerDown={down} onDoubleClick={() => set(null, true)} onKeyDown={key} />;
}
