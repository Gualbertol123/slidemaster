/* The toolbars' icons (B35, 09 §3.5; S15.6): Tabler outline icons from the small subset compiled into the page
   (./ui-icons.ts, tools/vendor-ui-icons.mjs), not the packed set the core worker holds. One look everywhere: 16 px,
   Tabler's 24 × 24 box, stroked in the button's text colour (currentColor) with round caps and joins. Decorative only:
   the button keeps its text label or its title, which is what assistive technology reads. Centred on the text's middle
   (vertical-align: middle), not sat on its baseline: an icon-only button (zoom ±) then has it in the middle. */
import { UI_ICONS, type UiIconName } from "./ui-icons";

export type { UiIconName };
const D = new Map<string, string>(Object.entries(UI_ICONS).map(([n, ds]) => [n, ds.join("")]));

const MID = { verticalAlign: "middle" } as const;

export function Ic({ n }: { n: UiIconName }) {
  return <svg className="ic" data-ic={n} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    style={MID}><path d={D.get(n)} /></svg>;
}
