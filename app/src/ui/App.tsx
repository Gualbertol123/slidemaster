import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { get, useStore } from "../state/store";
import { guard, reloadWorkbook } from "../state/app";
import { backend } from "../sync/api";
import { Topbar } from "./Topbar";
import { Ribbon, FxBar } from "./Ribbon";
import { Busy, Canvas, DeckHealth, Issues, Status, Thumbs, Toast } from "./Chrome";
import { ItemPanel } from "./ItemPanel";
import { NavGrip, navColumns, useNavRail, useNavWidth } from "./NavResize";
import { NavRail, RailToggle } from "./NavRail";
import { PickCellsDialog } from "./PickCells";
import { SetupsDialog } from "./Setups";
import { TableRibbon } from "./TableTools";
import { TablesDialog } from "./TablesDialog";
import { TextStylesDialog } from "./TextStylesDialog";
import { CommentDialog } from "./CommentDialog";
import { ScenarioDialog, ScenarioRun } from "./ScenarioDialog";
import { Dialogs } from "./Dialogs";
import { Wizard } from "../wizard/Wizard";
import { newSlide } from "../editor/slides";

export function App() {
  const changedOnDisk = useStore(s => s.ui.changedOnDisk), count = useStore(s => s.deck.slides.length), open = useStore(s => s.doc.open);
  const [navW, setNavW] = useNavWidth(), [rail, toggleRail] = useNavRail();
  const D = useStore(useShallow(s => ({ wizard: s.ui.dialogs.wizard, tables: s.ui.dialogs.tables, textStyles: !!s.ui.dialogs.textStyles, comment: !!s.ui.dialogs.comment, scenario: s.ui.dialogs.scenario, pick: !!s.ui.dialogs.pick, setups: !!s.ui.dialogs.setups, run: !!s.ui.run })));
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
        <div className="main" style={{ gridTemplateColumns: navColumns(navW, rail) }}>
          <aside className={"nav" + (rail ? " rail" : "")} id="sideNav">
            {/* folded (4.12): the rail; the panel's parts stay mounted underneath, hidden */}
            {rail && <NavRail toggle={toggleRail} />}
            <div className="navhd"><span>SLIDES <span id="slideCount" style={{ fontWeight: "500", marginLeft: "4px" }}>{count || ""}</span></span>
              <button className="newslide" id="newSlide" disabled={!open} title="A blank slide after the selected one (Ctrl+M)" onClick={() => newSlide()}>+ New slide</button>
              <RailToggle rail={false} toggle={toggleRail} /></div>
            <Thumbs />
            <ItemPanel />
            <Issues />
            <DeckHealth />
          </aside>
          <Canvas />
          {!rail && <NavGrip width={navW} set={setNavW} />}
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
      {D.pick && <PickCellsDialog />}
      {D.setups && <SetupsDialog />}
      {D.run && <ScenarioRun />}
      <Dialogs />{/* last: confirmations open above the wizard and the other dialogs */}
    </>
  );
}
