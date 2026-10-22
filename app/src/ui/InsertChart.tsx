/* Insert chart ▾ (4.3, B16): the ribbon's chart entry, one of the Insert slots (InsertSlots.tsx). Its own file since
   S14.P, so M14 (series charts) changes it without touching TableTools.tsx. */
import { setDialogs, useStore } from "../state/store";
import { insertChartFromSelection } from "../editor/charts";
import { Dropdown } from "./Dropdown";
import { useCurSlide } from "./hooks";
import { Ic } from "./Ic";

/** Insert chart ▾: from the selected cells (beside their table), or cells chosen in the sheet view – any sheet the wizard
    lists, a sheet on no slide too, never a hidden one (WB-18); no cell names typed (product owner 2026-10-19) */
function ChartMenu({ close }: { close: () => void }) {
  const sel = useStore(s => s.selection.sel);
  return <div className="chartmenu">
    <button data-a="chart-sel" disabled={!sel} title={sel ? "" : "Select the cells of a table first"} onClick={() => { close(); insertChartFromSelection(); }}>From the selected cells<small>the numbers, and their names in the first column; beside the table</small></button>
    <button data-a="chart-pick" onClick={() => { close(); setDialogs({ pick: { kind: "chart" } }); }}>Choose the cells…<small>of any sheet: drag across the numbers, then their names</small></button>
  </div>;
}
export function ChartInsert() {
  const R = useCurSlide();
  return <Dropdown menuClass="wide" button={(_o, t) => <button className="tb" id="chartBtn" disabled={!R} title="A pie or donut chart of cells of the workbook: it follows the workbook when it changes" onClick={t}>
    <Ic n="chart-pie" />Insert chart ▾</button>}>
    {close => <ChartMenu close={close} />}</Dropdown>;
}
