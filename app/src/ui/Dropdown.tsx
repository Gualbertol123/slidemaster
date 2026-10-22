import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** a button with a menu; closes on outside click, Escape, or when an item calls close() */
export function Dropdown(props: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  right?: boolean; menuClass?: string; style?: Record<string, string>; onOpen?: () => void;
  /** in a toolbar that folds (OverflowBar): how soon it goes into More ▾ (a larger number: sooner) */
  prio?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  // a menu never runs off the window's side (4.12: a narrow window, a button near its edge or in More ▾): moved back in
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const m = menu.current; if (!m) return;
    m.style.translate = "";
    if (!open) return;
    const r = m.getBoundingClientRect(), W = document.documentElement.clientWidth || innerWidth;
    const dx = r.right > W - 8 ? W - 8 - r.right : r.left < 8 ? 8 - r.left : 0;
    if (dx && r.width) m.style.translate = Math.round(Math.max(dx, 8 - r.left)) + "px 0";
  }, [open]);
  const toggle = () => { const o = !open; setOpen(o); if (o) props.onOpen?.(); };
  return (
    <div className="dd" ref={ref} style={props.style} data-prio={props.prio}>
      {props.button(open, toggle)}
      <div ref={menu} className={"menu" + (props.right ? " right" : "") + (props.menuClass ? " " + props.menuClass : "") + (open ? " open" : "")}>
        {open && props.children(() => setOpen(false))}
      </div>
    </div>
  );
}
