/* The toolbars' icons (S15.6, B35; docs/next/09 §3.5): Tabler outline icons from the small subset compiled into the page
   (app/src/ui/ui-icons.ts, made by tools/vendor-ui-icons.mjs) – the same release and geometry as the vendored set the
   core worker holds, one look (16 px, stroked in currentColor, round), decorative (aria-hidden), the buttons' labels and
   titles kept; the hand-drawn icons and the Unicode symbols they replace are gone from the toolbars. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ribbon, FxBar } from "../src/ui/Ribbon";
import { Topbar } from "../src/ui/Topbar";
import { TableRibbon } from "../src/ui/TableTools";
import { InsertSlots } from "../src/ui/InsertSlots";
import { Ic } from "../src/ui/Ic";
import { UI_ICONS, type UiIconName } from "../src/ui/ui-icons";
import { arcCubics, tabler } from "@slide-builder/core/icons/index";
import type { PathCmd } from "@slide-builder/core/dl/types";
import { toCmds } from "../../tools/vendor-tabler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
afterEach(cleanup);

/** a Tabler path's data as the core's decoder draws it: absolute M L C Z, Q as its exact cubic, arcs as cubics (the same
    conversions as tools/vendor-tabler.mjs + core/src/icons/index.ts decodeIcon, from the page's own copy of the text) */
function drawn(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const c of toCmds(d)) {
    if (c[0] === "Q") {
      const [, qx, qy, ex, ey] = c;
      out.push(["C", x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey]);
    } else if (c[0] === "A") out.push(...arcCubics(x, y, c[1], c[2], c[3], !!c[4], !!c[5], c[6], c[7]));
    else out.push(c);
    if (c[0] === "Z") { x = sx; y = sy; }
    else { x = c[c.length - 2] as number; y = c[c.length - 1] as number; if (c[0] === "M") { sx = x; sy = y; } }
  }
  return out;
}

describe("UI icons (S15.6, B35)", () => {
  it("every icon is in the vendored Tabler set, with the same paths through the same points (every point, not only the first)", () => {
    const set = tabler(), names = Object.keys(UI_ICONS) as UiIconName[];
    expect(names.length).toBeGreaterThanOrEqual(40);
    expect(names).toEqual([...names].sort());
    for (const n of names) {
      const p = set.icon("outline", n);
      expect(p, n).not.toBeNull();
      expect(p!.length, n).toBe(UI_ICONS[n].length);
      UI_ICONS[n].forEach((d, i) => {
        expect(d.startsWith("M"), n).toBe(true);
        const ours = drawn(d), theirs = p![i].d;
        expect(theirs[0][0], n).toBe("M");
        expect(ours.map(c => c[0]).join(""), `${n} path ${i}: commands`).toBe(theirs.map(c => c[0]).join(""));
        ours.forEach((c, k) => c.slice(1).forEach((v, j) =>
          expect(Math.abs((v as number) - (theirs[k][j + 1] as number)), `${n} path ${i} command ${k} number ${j}`).toBeLessThan(1e-6)));
        expect(p![i].paint, `${n} is stroked`).toMatchObject({ stroke: true, fill: false });
      });
    }
  });

  it("one look: 16 px, the 24 × 24 box, stroked in the text colour, round, hidden from assistive technology", () => {
    const { container } = render(<Ic n="trash" />);
    expect(container.innerHTML).toMatchInlineSnapshot(`"<svg class="ic" data-ic="trash" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="vertical-align: middle;"><path d="M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"></path></svg>"`);
  });

  it("the toolbars draw them: each button keeps its label or title; every icon in them is a Tabler one", () => {
    const { container } = render(<><Topbar /><Ribbon /><FxBar /><TableRibbon /><InsertSlots /></>);
    const ic = (sel: string) => container.querySelector(sel + " svg.ic")?.getAttribute("data-ic");
    const expected: [string, UiIconName, string][] = [
      ["#openBtn", "folder-open", "Open"], ["#reloadBtn", "refresh", ""], ["#wizardBtn", "wand", "Wizard"], ["#optBtn", "settings", "Options"],
      ["#exportMenuBtn", "chevron-down", ""], ["#undoBtn", "arrow-back-up", ""], ["#redoBtn", "arrow-forward-up", ""], ["#fillBtn", "bucket-droplet", ""],
      ['[data-align="left"]', "align-left", ""], ['[data-align="center"]', "align-center", ""], ['[data-align="right"]', "align-right", ""],
      ["#spacingBtn", "line-height", ""], ['[data-valign="top"]', "align-box-center-top", ""], ['[data-valign="bottom"]', "align-box-center-bottom", ""],
      ["#painterBtn", "paint", "Format"], ["#resetText", "restore", "Excel value"], ["#sameSize", "dimensions", "Same size"],
      ["#posBtn", "layout-align-center", "Position ▾"], ["#gridBtn", "border-inner", "Gridlines"], ["#addTable", "table-plus", "Add table ▾"],
      ['[data-addnote="top"]', "arrow-up", ""], ['[data-addnote="left"]', "arrow-left", ""], ["#commentBtn", "message-plus", "Comment…"],
      ["#noteAttach", "link", "Attach"], ["#noteDelete", "trash", ""], ["#noteBubble", "message-circle", ""], ["#slideNotes", "notes", "Notes"],
      ["#logoToggle", "photo", "Logo"],
      ["#shapeBtn", "shape", "Insert shape ▾"], ["#lineBtn", "arrow-up-right", "Insert line ▾"]];
    for (const [sel, n, label] of expected) {
      const b = container.querySelector<HTMLButtonElement>(sel);
      expect(b, sel).toBeTruthy();
      expect(ic(sel), sel).toBe(n);
      expect(b!.textContent!.trim(), sel).toBe(label);
      if (!label) expect(b!.title, `${sel}: an icon-only button is named by its title`).not.toBe("");
    }
    // every icon in the toolbars is from the subset, and no Unicode symbol is left as a button's icon
    // (Insert chart ▾ is M14's file, InsertChart.tsx: it takes "chart-pie" from the subset when M14 has merged)
    for (const s of container.querySelectorAll("button:not(#chartBtn) svg")) expect(s.classList.contains("ic"), s.outerHTML.slice(0, 80)).toBe(true);
    for (const b of container.querySelectorAll("button")) expect(b.textContent, b.id).not.toMatch(/[↻✦⚙⤺🗑⇄⇔⌗✎▢◼▬↺✕◯↑↓←→]/u);
    // a few buttons as they are drawn
    const snap = ["#undoBtn", "#wizardBtn", "#noteDelete", '[data-valign="middle"]'].map(s => container.querySelector(s)!.outerHTML.replace(/ title="[^"]*"/, ""));
    expect(snap).toMatchSnapshot();
  });

  it("the app's messages name the buttons by their words, not the old symbols (✦ Wizard, ⚙ Options; M15 review 8)", () => {
    const code = (f: string) => fs.readFileSync(path.join(here, "../src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const f of ["ui/Topbar.tsx", "editor/export.ts", "editor/scenario.ts", "state/app.ts"]) expect(code(f), f).not.toMatch(/[✦⚙]/u);
    expect(code("ui/Topbar.tsx")).toContain("(Wizard › Versions)");
  });

  it("an icon sits on the text's middle, not its baseline (the zoom ± buttons, S15.6 recheck)", () => {
    const { container } = render(<><button id="zoomOut"><Ic n="minus" /></button><button><Ic n="trash" />Delete</button></>);
    for (const s of container.querySelectorAll<SVGElement>("svg.ic")) expect(s.style.verticalAlign, s.dataset.ic).toBe("middle");
  });

  it("the shape and line ribbons' and zoom buttons' symbols are Tabler icons too (source check)", () => {
    const src = (f: string) => fs.readFileSync(path.join(here, "../src/ui", f), "utf8");
    for (const f of ["ShapeTools.tsx", "LineTools.tsx", "Chrome.tsx", "Topbar.tsx", "Ribbon.tsx", "TableTools.tsx"])
      expect(src(f), f).not.toMatch(/>\s*[↻✦⚙⤺🗑⇄⇔⌗✎▢◼▬↺✕◯−+]\s*(<|\w)/u);
    expect(src("ShapeTools.tsx")).toMatch(/<Ic n="bucket-droplet" \/>[\s\S]*<Ic n="square" \/>Border[\s\S]*<Ic n="quote" \/>Quote a cell[\s\S]*<Ic n="pencil" \/>Text/);
    expect(src("LineTools.tsx")).toMatch(/<Ic n="line" \/>[\s\S]*<Ic n="arrows-exchange" \/>/);
    expect(src("Chrome.tsx")).toMatch(/id="zoomOut"[^\n]*<Ic n="minus" \/>[\s\S]*id="zoomIn"[^\n]*<Ic n="plus" \/>/);
  });
});
