import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** a button with a menu; closes on outside click, Escape, or when an item calls close() */
export function Dropdown(props: {
  button: (open: boolean, toggle: () => void) => ComponentChildren;
  children: (close: () => void) => ComponentChildren;
  right?: boolean; menuClass?: string; style?: Record<string, string>; onOpen?: () => void;
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
  const toggle = () => { const o = !open; setOpen(o); if (o) props.onOpen?.(); };
  return (
    <div class="dd" ref={ref} style={props.style}>
      {props.button(open, toggle)}
      <div class={"menu" + (props.right ? " right" : "") + (props.menuClass ? " " + props.menuClass : "") + (open ? " open" : "")}>
        {open && props.children(() => setOpen(false))}
      </div>
    </div>
  );
}
