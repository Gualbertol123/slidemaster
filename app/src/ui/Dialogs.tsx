import { Fragment, useEffect, useRef } from "react";
import { useStore } from "../state/store";

function Dialog() {
  const d = useStore(s => s.ui.dialogs.dialog)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); d.resolve(null); }
      if (e.key === "Enter" && !(e.target as HTMLElement).matches("button, textarea")) { const p = d.buttons.find(b => b.primary); if (p) { e.preventDefault(); d.resolve(p.id); } }
    };
    document.addEventListener("keydown", key, true);
    // default focus: the primary action, or the first (safe) button when the choice is destructive
    setTimeout(() => (ref.current?.querySelector<HTMLButtonElement>(".btn.primary") || ref.current?.querySelector<HTMLButtonElement>(".dlgft .btn"))?.focus(), 30);
    return () => document.removeEventListener("keydown", key, true);
  }, [d]);
  return (
    <div className="modal" ref={ref}>
      <div className="dlg" style={{ width: `min(${d.width || 560}px,92vw)` }}>
        <div className="dlghd"><b>{d.title}</b>{d.sub && <span>{d.sub}</span>}</div>
        <div className="dlgbody" dangerouslySetInnerHTML={{ __html: d.html }} />
        <div className="dlgft">{d.buttons.map((b, i) => <Fragment key={b.id}>{i === d.buttons.length - (d.buttons.length > 2 ? 2 : 1) && <span style={{ flex: "1" }} />}
          <button data-a={b.id} className={"btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "")} onClick={() => d.resolve(b.id)}>{b.label}</button></Fragment>)}</div>
      </div>
    </div>
  );
}

export function Dialogs() {
  const dialog = useStore(s => !!s.ui.dialogs.dialog);
  return <>{dialog && <Dialog />}</>;
}
