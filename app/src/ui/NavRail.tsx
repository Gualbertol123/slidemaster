/* The side panel folded to a rail (4.12; NavResize.tsx useNavRail decides when): the button that opens it again, New
   slide, the slides by number. */
import { useStore } from "../state/store";
import { gotoSlide } from "../state/app";
import { newSlide } from "../editor/slides";

/** the « button on the panel's head: folds it to the rail */
export function RailToggle({ rail, toggle }: { rail: boolean; toggle: () => void }) {
  return <button className="railbtn" id="navRailBtn" aria-controls="sideNav" aria-expanded={!rail}
    title={rail ? "Open the side panel (slides, the selected item's settings, issues)" : "Fold the side panel to a thin rail – more room for the slide"} onClick={toggle}>{rail ? "»" : "«"}</button>;
}
/** the folded panel: open it again, New slide, the slides by number (the current one marked; a click shows it) */
export function NavRail({ toggle }: { toggle: () => void }) {
  const n = useStore(s => s.deck.slides.length), cur = useStore(s => s.deck.cur), open = useStore(s => s.doc.open), item = useStore(s => !!s.selection.itemSel);
  return <div className="navrail" id="navRail">
    <RailToggle rail toggle={toggle} />
    <button className="railnew" id="railNewSlide" disabled={!open} title="A blank slide after the selected one (Ctrl+M)" onClick={() => newSlide()}>+</button>
    {item && <button className="railitem" title="An item is selected: its settings are in the side panel – open it" onClick={toggle}>⚙</button>}
    <div className="railslides">{Array.from({ length: n }, (_, i) =>
      <button key={i} className={"railslide" + (i === cur ? " on" : "")} data-i={i} aria-current={i === cur ? "true" : undefined} title={"Slide " + (i + 1)} onClick={() => gotoSlide(i)}>{i + 1}</button>)}</div>
  </div>;
}
