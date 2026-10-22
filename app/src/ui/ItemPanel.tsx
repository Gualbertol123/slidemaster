/* The side panel of the selected slide item (S14.P): one panel per kind, each in its milestone's own file, so M14
   (ChartPanel: series, axes, marks, legend) and M15 (LinePanel, the icon picker) never edit the same lines. Each panel
   draws nothing unless the selected item is its kind. */
import { ChartPanel } from "./ChartPanel";

export function ItemPanel() {
  return <>
    <ChartPanel />{/* M14 */}
    {/* ---- M14 above this line, M15 below it ---- */}
    {/* M15: <LinePanel /> */}
    {/* M15's icon picker: since 4.12 in App.tsx beside the other dialogs (the panel folds to a rail, PR #39) */}
  </>;
}
