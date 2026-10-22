/* The side column of the icon and shape window (IconPicker.tsx, 4.12): the shapes that carry text – a text box, the six
   callout shapes of S9.4 – inserted from the same window as the icons. The old dropdown (Insert shape ▾: these shapes,
   the 17 built-in icons, More icons…) is gone: one button opens the window. A text box is a rectangle with no fill and
   no border, its text on the left – the same shape item the ribbon's No fill / No border make (no new key). */
import { memo } from "react";
import type { ShapeItem } from "@slide-builder/core/model/types";
import type { PathCmd } from "@slide-builder/core/dl/types";
import { arrowCmds, bubbleCmds, ellipseCmds } from "@slide-builder/core/render/shape-dl";
import { insertShape, insertTextBox } from "../editor/charts";

/** what the side column offers: [data-shape, label] */
export const SIDE_SHAPES: [string, string][] = [["text", "Text box"], ["rect", "Rectangle"], ["round", "Rounded rectangle"], ["pill", "Pill"],
  ["circle", "Circle"], ["arrow", "Arrow"], ["bubble", "Speech bubble"]];
const d = (cmds: PathCmd[]) => cmds.map(c => c[0] + c.slice(1).join(" ")).join(" ");
const PREVIEW: Record<string, string> = {
  rect: d([["M", 2, 6], ["L", 22, 6], ["L", 22, 18], ["L", 2, 18], ["Z"]]), round: "M6 6h12a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z",
  pill: "M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z", circle: d(ellipseCmds(3, 3, 18, 18)), arrow: d(arrowCmds(2, 5, 20, 14)), bubble: d(bubbleCmds(2, 3, 20, 13, 3, { x: 7, y: 21 })),
};
function Preview({ s }: { s: string }) {
  if (s === "text") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h20v12H2z" fill="none" stroke="#0A66D8" strokeWidth="1.1" strokeDasharray="2 1.6" />
    <path d="M5 10h11M5 14h8" stroke="#1F2430" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PREVIEW[s]} fill="#E8EEF8" stroke="#0A66D8" strokeWidth="1.3" /></svg>;
}
/** inserts the side column's entry `s` (a text box or a shape): one change, the new item selected */
export function insertSide(s: string) { return s === "text" ? insertTextBox() : insertShape(s as ShapeItem["shape"]); }
/** the column (memoised: the window's keystrokes do not draw it again) */
export const ShapeColumn = memo(function ShapeColumn({ onDone }: { onDone: () => void }) {
  return <div className="icside" id="iconShapes" role="group" aria-labelledby="iconShapesHd">
    <div className="ichd" id="iconShapesHd">Shapes &amp; text <small>{"{Sheet!C7}"} quotes a cell</small></div>
    <div className="icsidelist">{SIDE_SHAPES.map(([s, l]) => <button key={s} data-shape={s} title={s === "text" ? "A text box: no fill, no border – type into it, quote cells" : l + " with text"}
      onClick={() => { onDone(); insertSide(s); }}><Preview s={s} /><span>{l}</span></button>)}</div>
  </div>;
});
