import { useEffect, useRef, useState } from "preact/hooks";
import { S, useApp } from "../state/store";
import { DLG, closeInstaller } from "../state/dialogs";
import { backend, type InstallState } from "../sync/api";

function Dialog() {
  const d = DLG.dialog!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); d.resolve(null); }
      if (e.key === "Enter" && !(e.target as HTMLElement).matches("button")) { const p = d.buttons.find(b => b.primary); if (p) { e.preventDefault(); d.resolve(p.id); } }
    };
    document.addEventListener("keydown", key, true);
    // default focus: the primary action, or the first (safe) button when the choice is destructive
    setTimeout(() => (ref.current?.querySelector<HTMLButtonElement>(".btn.primary") || ref.current?.querySelector<HTMLButtonElement>(".dlgft .btn"))?.focus(), 30);
    return () => document.removeEventListener("keydown", key, true);
  }, [d]);
  return (
    <div class="modal" ref={ref}>
      <div class="dlg" style={{ width: `min(${d.width || 560}px,92vw)` }}>
        <div class="dlghd"><b>{d.title}</b>{d.sub && <span>{d.sub}</span>}</div>
        <div class="dlgbody" dangerouslySetInnerHTML={{ __html: d.html }} />
        <div class="dlgft">{d.buttons.map((b, i) => <>{i === d.buttons.length - (d.buttons.length > 2 ? 2 : 1) && <span style="flex:1" />}
          <button key={b.id} data-a={b.id} class={"btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : "")} onClick={() => d.resolve(b.id)}>{b.label}</button></>)}</div>
      </div>
    </div>
  );
}

/* export engine installer, run by the helper (downloads Chrome for Testing into the engine folder) */
function Installer() {
  const e = S.health?.engine;
  const [st, setSt] = useState<InstallState | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!st || st.done) return;
    const t = setInterval(async () => { try { setSt(await backend.engineInstall(false)); } catch { /* helper busy */ } }, 1000);
    return () => clearInterval(t);
  }, [st && st.done, !!st]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [st]);
  useEffect(() => { if (st?.done) { setTimeout(async () => { S.health = await backend.health(); }, 2500); } }, [st?.done]);
  const go = async () => { try { setSt(await backend.engineInstall(true)); } catch (err) { setSt({ running: false, done: true, ok: false, lines: [String((err as Error).message)] }); } };
  return (
    <div class="modal">
      <div class="dlg" style="width:min(720px,94vw)">
        <div class="dlghd"><b>Export engine</b><span>{e?.state === "ready" ? "Working: " + (e.browser || "") : "No engine works yet – exports are rendered in the app window"}</span></div>
        <div style="padding:0 18px 8px;font-size:12.5px;line-height:1.5">
          <ul style="margin:4px 0 8px;padding-left:18px">{(e?.engines || []).map(x => <li key={x.name}><b>{x.label}</b> – {x.state === "ok" ? "works" : x.state === "blocked" ? "blocked: " + x.detail : x.state === "missing" ? "not installed" : "not tested yet"}</li>)}</ul>
          Installing downloads <b>Chrome for Testing</b> (about 100 MB) for this PC. It is not affected by the company settings that lock Edge, and makes exports exact and fast.
        </div>
        {st && <pre class="instlog" id="instLog" ref={logRef}>{st.lines.join("\n")}</pre>}
        <div class="dlgft">
          <span class="hint">{!st ? "" : !st.done ? "This can take a few minutes." : st.ok ? <span style="color:var(--ok)">Installed – testing the engine…</span> : <span style="color:var(--err)">The installer could not finish – see the messages above.</span>}</span>
          <button class="btn" data-a="close" onClick={closeInstaller}>Close</button>
          <button class="btn primary" data-a="go" disabled={!!st && !st.done} onClick={() => void go()}>{!st ? "Install export engine" : !st.done ? "Installing…" : "Run again"}</button>
        </div>
      </div>
    </div>
  );
}

export function Dialogs() {
  useApp();
  return <>{DLG.dialog && <Dialog />}{DLG.installer && <Installer />}</>;
}
