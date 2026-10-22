/* The side panel of the selected slide item (S14.P): one panel per kind, each in its milestone's own file, so M14
   (ChartPanel: series, axes, marks, legend) and M15 (LinePanel, the icon picker) never edit the same lines. Each panel
   draws nothing unless the selected item is its kind. */
import { ChartPanel } from "./ChartPanel";
import { IconPickerHost } from "./IconPicker";

export function ItemPanel() {
  return <>
    <ChartPanel />{/* M14 */}
    {/* ---- M14 above this line, M15 below it ---- */}
    {/* M15: <LinePanel /> */}
    <IconPickerHost />{/* M15: the icon picker (a dialog over the page while open) */}
  </>;
}
