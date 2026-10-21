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
import { tabler } from "@slide-builder/core/icons/index";

const here = path.dirname(fileURLToPath(import.meta.url));
afterEach(cleanup);

/** the absolute start point of each subpath ("M x y" at the start of a Tabler path) */
const starts = (d: string) => [...d.matchAll(/M\s*(-?[\d.]+)[\s,]*(-?[\d.]+)/g)].map(m => [+m[1], +m[2]]);

describe("UI icons (S15.6, B35)", () => {
  it("every icon is in the vendored Tabler set, with the same paths starting at the same points", () => {
    const set = tabler(), names = Object.keys(UI_ICONS) as UiIconName[];
    expect(names.length).toBeGreaterThanOrEqual(40);
    expect(names).toEqual([...names].sort());
    for (const n of names) {
      const p = set.icon("outline", n);
      expect(p, n).not.toBeNull();
      expect(p!.length, n).toBe(UI_ICONS[n].length);
      UI_ICONS[n].forEach((d, i) => {
        expect(d.startsWith("M"), n).toBe(true);
        const m = p![i].d[0] as [string, number, number];
        expect(m[0], n).toBe("M");
        expect(starts(d)[0], `${n} path ${i}`).toEqual([m[1], m[2]]);
        expect(p![i].paint, `${n} is stroked`).toMatchObject({ stroke: true, fill: false });
      });
    }
  });

  it("one look: 16 px, the 24 × 24 box, stroked in the text colour, round, hidden from assistive technology", () => {
    const { container } = render(<Ic n="trash" />);
    expect(container.innerHTML).toMatchInlineSnapshot(`"<svg class="ic" data-ic="trash" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"></path></svg>"`);
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

  it("the shape and line ribbons' and zoom buttons' symbols are Tabler icons too (source check)", () => {
    const src = (f: string) => fs.readFileSync(path.join(here, "../src/ui", f), "utf8");
    for (const f of ["ShapeTools.tsx", "LineTools.tsx", "Chrome.tsx", "Topbar.tsx", "Ribbon.tsx", "TableTools.tsx"])
      expect(src(f), f).not.toMatch(/>\s*[↻✦⚙⤺🗑⇄⇔⌗✎▢◼▬↺✕◯−+]\s*(<|\w)/u);
    expect(src("ShapeTools.tsx")).toMatch(/<Ic n="bucket-droplet" \/>[\s\S]*<Ic n="square" \/>Border[\s\S]*<Ic n="quote" \/>Quote a cell[\s\S]*<Ic n="pencil" \/>Text/);
    expect(src("LineTools.tsx")).toMatch(/<Ic n="line" \/>[\s\S]*<Ic n="arrows-exchange" \/>/);
    expect(src("Chrome.tsx")).toMatch(/id="zoomOut"[^\n]*<Ic n="minus" \/>[\s\S]*id="zoomIn"[^\n]*<Ic n="plus" \/>/);
  });
});
