/* ⚙ Options › Administration › Saved setups (B44, product owner 2026-10-20): every workbook's saved setup (deck) on the
   share – its slides and tables as of its last snapshot, its last change – each with Delete; and the deleted ones,
   kept as backups by the helper (helper/slidebuilder/deckbin.py), each with Restore. A setup open in a window is not
   deleted (the helper refuses and names who has it open); the one open in this window is not offered. */
import { useEffect, useState } from "react";
import { get, setDialogs, toast } from "../state/store";
import { alertBox, confirmBox } from "../state/dialogs";
import { deleteSetup, openDeckKey } from "../state/app";
import { backend } from "../sync/api";
import { esc } from "@slide-builder/core/xlsx/util";
import type { DeletedSetup, SetupInfo } from "../sync/api";

const close = () => setDialogs({ setups: false });
const when = (ms?: number | null) => ms ? new Date(ms).toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
const size = (d: { slides?: number; tables?: number }) => `${d.slides ?? 0} slide${d.slides === 1 ? "" : "s"} · ${d.tables ?? 0} table${d.tables === 1 ? "" : "s"}`;

export function SetupsDialog() {
  const [list, setList] = useState<SetupInfo[] | null>(null), [gone, setGone] = useState<DeletedSetup[]>([]);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [filter, setFilter] = useState("");
  const load = async () => {
    try { const [a, b] = await Promise.all([backend.decks(), backend.deletedDecks()]); setList(a.filter(d => d.preset !== false).sort((x, y) => x.workbook.localeCompare(y.workbook))); setGone(b); setErr(""); }
    catch (e) { setErr(String((e as Error)?.message || e)); setList([]); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); close(); } }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [busy]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { await load(); setBusy(false); } };
  const del = (d: SetupInfo) => act(() => deleteSetup(d.key, d.workbook, size(d)));
  const restore = (d: DeletedSetup) => act(async () => {
    if (!(await confirmBox("Restore the setup?", `The setup of <b>${esc(d.workbook || d.key)}</b> deleted on ${esc(when(d.at))} (${esc(size(d))}) becomes the workbook's setup again.`, "Restore"))) return;
    try { await backend.restoreDeck(d.id, get().prefs.client); toast(`The setup of “${esc(d.workbook || d.key)}” is back.`); }
    catch (e) { await alertBox("The setup was not restored", esc((e as Error).message || String(e))); }
  });
  const f = filter.trim().toLowerCase(), match = (w?: string) => !f || (w || "").toLowerCase().includes(f), open = openDeckKey();
  return (
    <div className="modal">
      <div className="dlg" id="setupsDialog" style={{ width: "min(760px,94vw)" }}>
        <div className="dlghd"><b>Saved setups</b><span>The setup saved for each workbook on the shared folder: its tables, slides, design, versions and comments. Deleting one deletes it for everybody (the workbook is not changed); a backup is kept and can be restored below.</span></div>
        <div className="dlgbody">
          <div className="row" style={{ marginBottom: "8px" }}><input id="setupsFilter" placeholder="Find a workbook…" value={filter} onChange={e => setFilter((e.target as HTMLInputElement).value)} style={{ flex: "1" }} /></div>
          {err && <p className="meta red">{err}</p>}
          {list === null ? <p className="meta">Reading the shared folder…</p> : !list.length ? <p className="meta">No setup is saved yet.</p> :
            <table className="setups"><thead><tr><th>Workbook</th><th>Holds</th><th>Last change</th><th /></tr></thead><tbody>
              {list.filter(d => match(d.workbook)).map(d => <tr key={d.key} data-k={d.key}>
                <td>{d.workbook}{d.rolledBack && <span className="chip">back with Slide Builder 3</span>}</td><td>{size(d)}</td>
                <td>{when(d.updated)}{d.updatedBy ? " · " + d.updatedBy : ""}</td>
                <td>{d.key === open ? <span className="meta">open here</span> : <button className="btn danger" data-a="delete" disabled={busy || d.rolledBack} onClick={() => void del(d)}>Delete…</button>}</td>
              </tr>)}
            </tbody></table>}
          {gone.length > 0 && <>
            <div className="opthd" style={{ marginTop: "14px" }}>Deleted setups (backups)</div>
            <table className="setups" id="deletedSetups"><thead><tr><th>Workbook</th><th>Held</th><th>Deleted</th><th /></tr></thead><tbody>
              {gone.filter(d => match(d.workbook)).map(d => <tr key={d.id} data-id={d.id}>
                <td>{d.workbook || d.key}</td><td>{size(d)}</td><td>{when(d.at)}{d.by ? " · " + d.by : ""}</td>
                <td>{d.key === open ? <span className="meta" title="Open another workbook first: this window has the workbook's new setup open">open here</span> : <button className="btn" data-a="restore" disabled={busy} onClick={() => void restore(d)}>Restore…</button>}</td>
              </tr>)}
            </tbody></table></>}
        </div>
        <div className="dlgft"><span style={{ flex: "1" }} /><button className="btn primary" data-a="close" disabled={busy} onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
