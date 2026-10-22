/* The snapping marks on the stage (4.8, S15.4; 09 §5.2): page markup over the slide, never exported (a DOM overlay in
   the slide's px, as the guides before 4.8). Every matched line across the slide (`.snapline`, #FF2D92; a centre or
   middle match dashed), an equal gap as a dimension marker with its size in px (`.snapgap`), an equal size as a marker
   along the matching object's side and the moving one's (`.snapsize`). Lines and labels keep their screen size at any
   zoom (`s`: the stage's scale). */
import type { SnapMarks } from "@slide-builder/core/render/snap";

const PINK = "#FF2D92";
export function SnapGuides({ marks, s }: { marks: SnapMarks | null | undefined; s: number }) {
  if (!marks) return null;
  const lw = 1.5 / Math.min(1, s), inv = 1 / Math.max(.2, s), dash = (dir: string) => `repeating-linear-gradient(${dir},${PINK} 0 ${6 * inv}px,transparent ${6 * inv}px ${10 * inv}px)`;
  /** a dimension marker from → to along x (at y = at) or y (at x = at), its ticks at both ends, its label */
  const dim = (cls: string, key: string, horiz: boolean, from: number, to: number, at: number, label: string) => {
    const t = 8 * inv, len = Math.max(0, to - from);
    return [
      <div key={key} className={cls} style={{ position: "absolute", pointerEvents: "none", zIndex: 60, boxSizing: "border-box",
        ...(horiz ? { left: from, top: at - t / 2, width: len, height: t, borderLeft: `${lw}px solid ${PINK}`, borderRight: `${lw}px solid ${PINK}`, background: `linear-gradient(${PINK},${PINK}) center / 100% ${lw}px no-repeat` }
          : { left: at - t / 2, top: from, width: t, height: len, borderTop: `${lw}px solid ${PINK}`, borderBottom: `${lw}px solid ${PINK}`, background: `linear-gradient(${PINK},${PINK}) center / ${lw}px 100% no-repeat` }) }} />,
      <div key={key + "t"} className="snaptip" style={{ position: "absolute", pointerEvents: "none", zIndex: 61, whiteSpace: "nowrap", color: "#fff", background: PINK, fontSize: 11 * inv, lineHeight: 1.3, padding: `${inv}px ${4 * inv}px`, borderRadius: 3 * inv,
        ...(horiz ? { left: (from + to) / 2, top: at + 6 * inv, transform: "translateX(-50%)" } : { left: at + 6 * inv, top: (from + to) / 2, transform: "translateY(-50%)" }) }}>{label}</div>,
    ];
  };
  return <>
    {marks.guides.map(g => <div key={"g" + g.axis + g.at} className={"snapline " + g.axis + (g.centre ? " centre" : "")} data-at={g.at}
      style={g.axis === "v" ? { display: "block", left: g.at, width: lw, ...(g.centre ? { background: dash("to bottom") } : {}) } : { display: "block", top: g.at, height: lw, ...(g.centre ? { background: dash("to right") } : {}) }} />)}
    {marks.gaps.map((g, k) => dim("snapgap " + g.axis, "q" + k, g.axis === "x", g.from, g.to, g.at, fmt(g.px) + " px"))}
    {marks.sizes.map((z, k) => z.axis === "w" ? dim("snapsize w", "z" + k, true, z.box.x, z.box.x + z.box.w, z.box.y - 8 * inv, "= " + fmt(z.px) + " px")
      : dim("snapsize h", "z" + k, false, z.box.y, z.box.y + z.box.h, z.box.x - 8 * inv, "= " + fmt(z.px) + " px"))}
  </>;
}
const fmt = (v: number) => String(Math.round(v * 4) / 4);
