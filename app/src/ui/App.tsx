import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { get, useStore } from "../state/store";
import { guard, reloadWorkbook } from "../state/app";
import { backend } from "../sync/api";
import { Topbar } from "./Topbar";
import { Ribbon, FxBar } from "./Ribbon";
import { Busy, Canvas, DeckHealth, Issues, Status, Thumbs, Toast } from "./Chrome";
import { TableRibbon } from "./TableTools";
import { TablesDialog } from "./TablesDialog";
import { TextStylesDialog } from "./TextStylesDialog";
import { CommentDialog } from "./CommentDialog";
import { ScenarioDialog, ScenarioRun } from "./ScenarioDialog";
import { Dialogs } from "./Dialogs";
import { Wizard } from "../wizard/Wizard";

export function App() {
  const changedOnDisk = useStore(s => s.ui.changedOnDisk), count = useStore(s => s.deck.slides.length);
  const D = useStore(useShallow(s => ({ wizard: s.ui.dialogs.wizard, tables: s.ui.dialogs.tables, textStyles: !!s.ui.dialogs.textStyles, comment: !!s.ui.dialogs.comment, scenario: s.ui.dialogs.scenario, run: !!s.ui.run })));
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); document.body.classList.add("dragover"); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) document.body.classList.remove("dragover"); };
    const drop = (e: DragEvent) => { e.preventDefault(); document.body.classList.remove("dragover"); const f = e.dataTransfer?.files?.[0];
      // not while a workbook is being opened or the wizard is open (the Open button is covered then too)
      if (f && !get().deck.opening && !get().ui.dialogs.wizard) void guard(() => import("../state/app").then(m => m.openLocalFile(f))); };
    document.addEventListener("dragover", over); document.addEventListener("dragleave", leave); document.addEventListener("drop", drop);
    return () => { document.removeEventListener("dragover", over); document.removeEventListener("dragleave", leave); document.removeEventListener("drop", drop); };
  }, []);
  return (
    <>
      <div className="app">
        <Topbar />
        <div>
          {!backend.served && <div className="banner show" id="bannerOffline">Opened directly from disk: work is kept in this browser only and exports are downloaded. Start <b>Start Slide Builder.bat</b> to share presets with colleagues and save exports in the export folder.</div>}
          {changedOnDisk && <div className="banner info show" id="bannerChanged">The workbook was saved again in Excel. <button className="btn" onClick={() => void guard(reloadWorkbook)}>Reload now</button></div>}
          <Ribbon />
          <TableRibbon />
          <FxBar />
        </div>
        <div className="main">
          <aside className="nav">
            <div className="navhd"><span>SLIDES <span id="slideCount" style={{ fontWeight: "500", marginLeft: "4px" }}>{count || ""}</span></span></div>
            <Thumbs />
            <Issues />
            <DeckHealth />
          </aside>
          <Canvas />
        </div>
        <Status />
      </div>
      <Toast />
      <Busy />
      {D.wizard && <Wizard req={D.wizard} />}
      {D.tables && <TablesDialog />}
      {D.textStyles && <TextStylesDialog />}
      {D.comment && <CommentDialog />}
      {D.scenario && <ScenarioDialog />}
      {D.run && <ScenarioRun />}
      <Dialogs />{/* last: confirmations open above the wizard and the other dialogs */}
    </>
  );
}
