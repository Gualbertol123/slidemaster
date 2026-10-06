import { S, useApp } from "../state/store";
import { change, ctx, style, undo } from "../state/app";
import { activeItem, applySel, commitText, curSlide, selItems, setSize, editOf } from "../editor/edit";
import { boldAll, italAll } from "../editor/keys";
import { startPainter, stopPainter } from "../editor/painter";
import { canMerge, mergeSel, mergedInSel, unmergeSel } from "../editor/tables";
import { effFmt, effText, keyOf } from "../render/edits";
import { slideHasLogo } from "../render/slide";
import { A1 } from "../xlsx/util";
import { Dropdown } from "./Dropdown";
import type { Op } from "../model/types";

const FILLS: [string, string][] = [["#34C759", "Green (positive)"], ["#FF3B30", "Red (negative)"], ["#FF9500", "Orange"], ["#FFCC00", "Yellow"], ["#007AFF", "Blue"], ["#5856D6", "Indigo"],
  ["#AF52DE", "Purple"], ["#30B0C7", "Teal"], ["#8E8E93", "Grey"], ["#D1D1D6", "Light grey"], ["#0B4F97", "Navy"], ["#FFFFFF", "White"]];
const INKS: [string, string][] = [["#0B0D17", "Black"], ["#5B6274", "Dark grey"], ["#8E8E93", "Grey"], ["#A8101A", "Red"], ["#136B2E", "Green"], ["#0A58CA", "Blue"],
  ["#B25000", "Orange"], ["#6B2FB3", "Purple"], ["#FFFFFF", "White"], ["#1C4F8C", "Navy"], ["#C42B1C", "Bright red"], ["#1F9D55", "Bright green"]];

function Swatches(p: { kind: "fill" | "ink"; close: () => void }) {
  const sw = (list: [string, string][], set: (v: string) => void, attr: string) =>
    <div class="swatches">{list.map(([c, n]) => <button key={c} title={n} {...{ [attr]: c }} style={{ background: c }} onClick={() => { p.close(); set(c); }} />)}</div>;
  if (p.kind === "ink") {
    const set = (v: string) => applySel(v ? "Text colour" : "Automatic text colour", e => { if (v) e.color = v; else delete e.color; });
    return <><div class="hd">Text colour</div>{sw(INKS, set, "data-v")}<div class="wide"><button data-v="" onClick={() => { p.close(); set(""); }}>Automatic</button></div></>;
  }
  const bg = (v: string | null) => applySel(v === null ? "Excel cell colour" : "Cell colour", e => { if (v === null) delete e.bg; else { e.bg = v; delete e.fill; } });
  const hl = (v: string | null) => applySel(v === null ? "Remove highlight" : "Highlight", e => { if (v === null) delete e.fill; else e.fill = v; });
  return <div class="fillmenu">
    <div class="hd">Cell colour <small>replaces the colour from Excel (in Liquid Glass: the colour of the block)</small></div>
    {sw(FILLS.concat(BLOCKS), v => bg(v), "data-bg")}
    <div class="wide"><button data-bg="none" onClick={() => { p.close(); bg("none"); }}>No colour</button><button data-bg="" onClick={() => { p.close(); bg(null); }}>Colour from Excel</button></div>
    <div class="sep" />
    <div class="hd">Highlight <small>a capsule on the cell; green/red keep their positive/negative meaning</small></div>
    {sw(FILLS, v => hl(v), "data-v")}
    <div class="wide"><button data-v="" onClick={() => { p.close(); hl(null); }}>Remove highlight</button></div>
  </div>;
}
const BLOCKS: [string, string][] = [["#1F3864", "Dark navy"], ["#2F5597", "Blue"], ["#404040", "Charcoal"], ["#F2F2F2", "Very light grey"]];

export function Ribbon() {
  useApp();
  const R = curSlide(), it = activeItem(), its = selItems(), has = !!(R && it), c = ctx();
  const f = it ? effFmt(c, it) : null;
  const sizes = new Set(its.map(x => effFmt(c, x).sz));
  const roles = new Set(its.map(x => effFmt(c, x).role)), aligns = new Set(its.map(x => effFmt(c, x).align || "auto"));
  const logoOn = !!R && slideHasLogo(R), logoName = style().logo.trim();
  const slidePatch = (label: string, patch: Record<string, unknown>) => R && change(label, [{ op: "slide.patch", id: R.id, patch } as Op]);
  const tb = ({ active, ...props }: Record<string, unknown>) => ({ class: "tb" + (active ? " on" : ""), disabled: !has, ...props });
  return (
    <nav class="ribbon">
      <div class="grp">
        <button class="tb" id="undoBtn" title="Undo (Ctrl+Z) – only your own changes" disabled={!S.undo.length} onClick={() => undo(false)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg></button>
        <button class="tb" id="redoBtn" title="Redo (Ctrl+Y)" disabled={!S.redo.length} onClick={() => undo(true)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m10.5 3.5 3 3-3 3" /><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" /></svg></button>
      </div>
      <div class="grp">
        <span class="lbl">Size</span>
        <button {...tb({ id: "sizeDown", title: "Smaller text" })} onClick={() => setSize(v => v > 12 ? v - 2 : v - 1)}>A−</button>
        <input class="sizebox" id="sizeBox" disabled={!has} title="Text size in points (Enter to apply)" value={sizes.size === 1 && f ? String(f.sz) : ""}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { const v = parseFloat((e.target as HTMLInputElement).value.replace(",", ".")); if (!isNaN(v)) setSize(() => v); (e.target as HTMLInputElement).blur(); } }} />
        <button {...tb({ id: "sizeUp", title: "Larger text" })} onClick={() => setSize(v => v >= 12 ? v + 2 : v + 1)}>A+</button>
      </div>
      <div class="grp">
        <button {...tb({ id: "boldBtn", title: "Bold (Ctrl+B)", active: has && boldAll() })} onClick={() => { const on = !boldAll(); applySel("Bold", e => { e.b = on; }); }}><b>B</b></button>
        <button {...tb({ id: "italBtn", title: "Italic (Ctrl+I)", active: has && italAll() })} onClick={() => { const on = !italAll(); applySel("Italic", e => { e.i = on; }); }}><i style="font-family:Georgia,serif">I</i></button>
        <Dropdown button={(_o, t) => <button class="tb colorbtn" id="inkBtn" disabled={!has} title="Text colour" onClick={t}><span>A</span><i class="sw" style={{ background: f?.color || "#0B0D17" }} /></button>}>{close => <Swatches kind="ink" close={close} />}</Dropdown>
        <Dropdown button={(_o, t) => <button class="tb colorbtn" id="fillBtn" disabled={!has} title="Cell colour (replaces the Excel colour) or highlight" onClick={t}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8.5 8.5 3l4.5 4.5-5.5 5.5z" /><path d="M13.5 10.5s1.2 1.4 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.8 1.2-2.2 1.2-2.2z" fill="currentColor" /></svg><i class="sw" style={{ background: f?.bg && f.bg !== "none" ? f.bg : f?.fill && f.fill !== "none" ? f.fill : "linear-gradient(90deg,#34C759 50%,#FF3B30 50%)" }} /></button>}>{close => <Swatches kind="fill" close={close} />}</Dropdown>
      </div>
      <div class="grp">
        {(["left", "center", "right"] as const).map(a => <button key={a} {...tb({ "data-align": a, title: a === "center" ? "Centre" : "Align " + a, active: aligns.size === 1 && aligns.has(a) })} onClick={() => applySel("Alignment", e => { e.align = a; })}>
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6"><path d={a === "left" ? "M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8" : a === "center" ? "M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8" : "M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8"} /></svg></button>)}
        <button {...tb({ "data-align": "auto", title: "Alignment from Excel", style: "font-size:11px", active: aligns.size === 1 && aligns.has("auto") })} onClick={() => applySel("Alignment", e => { delete e.align; })}>Auto</button>
      </div>
      <div class="grp">
        <span class="lbl">Role</span>
        {([["auto", "Auto", "Detected from the Excel formatting"], ["header", "Header", "Column/row header"], ["total", "Total", "Highlighted total (tile)"], ["body", "Body", "Normal data"], ["caption", "Note", "Small note"]] as const).map(([k, l, t]) =>
          <button key={k} {...tb({ "data-role": k, title: t, active: roles.size === 1 && roles.has(k) })} onClick={() => applySel("Role: " + l, e => { if (k === "auto") delete e.role; else e.role = k; })}>{l}</button>)}
      </div>
      <div class="grp">
        <button {...tb({ id: "clearFmt", title: "Remove your formatting from the selection" })} onClick={() => applySel("Clear formatting", e => { for (const k of ["sz", "b", "i", "color", "fill", "bg", "align", "role"] as const) delete e[k]; })}>Clear format</button>
        <button class={"tb" + (S.painter ? " on" : "")} id="painterBtn" disabled={!has && !S.painter} title="Copy format: click, then click or drag over the cells to paste. Double-click to paste several times; Esc stops."
          onClick={() => S.painter ? stopPainter() : startPainter(false)} onDblClick={() => startPainter(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="1.5" width="10" height="4" rx="1" /><path d="M12 3.5h1.5v3.5H7.5v2" /><rect x="6" y="9.5" width="3" height="5" rx="1" /></svg>Format</button>
        <button {...tb({ id: "mergeBtn", title: "Merge the selected cells (the top-left value is kept)" })} disabled={!canMerge()} onClick={mergeSel}>Merge</button>
        <button {...tb({ id: "unmergeBtn", title: "Split merged cells in the selection" })} disabled={!mergedInSel().length} onClick={unmergeSel}>Unmerge</button>
        <button {...tb({ id: "resetText", title: "Show the Excel value again" })} onClick={() => applySel("Restore Excel text", e => { delete e.text; delete e.orig; })}>Restore text</button>
        <button class="tb" id="resetLayout" title="Automatic table positions for this slide" disabled={!(R && R.cfg.layout)} onClick={() => slidePatch("Reset layout", { layout: null })}>Reset layout</button>
      </div>
      <div class="grp">
        <span class="lbl">Slide</span>
        <button class={"tb" + (logoOn ? " on" : "")} id="logoToggle" disabled={!R || !logoName} title={R && !logoOn ? "The logo is hidden on this slide – click to show it" : "Hide the logo on this slide"}
          onClick={() => slidePatch(logoOn ? "Hide logo" : "Show logo", { logo: logoOn ? false : null })}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="3.5" width="13" height="9" rx="2" /><path d="m3.5 10.5 3-3 2 2 1.5-1.5 2.5 2.5" /></svg>Logo</button>
      </div>
    </nav>
  );
}

export function FxBar() {
  useApp();
  const R = curSlide(), it = activeItem(), its = selItems(), sel = S.sel;
  const name = it && sel ? it.L!.sheet.name + "!" + (its.length > 1 ? `${A1(sel.r1, sel.c1)}:${A1(sel.r2, sel.c2)}` : keyOf(it)) : R ? "—" : "";
  const value = it ? effText(ctx(), it) : "";
  return (
    <div class="fxbar">
      <div class="namebox" id="nameBox">{name}</div>
      <span class="fxlabel">fx</span>
      {/* key: a different cell resets the field (uncontrolled while typing) */}
      <input class="fxinput" id="fxInput" key={name + "|" + value} disabled={!it} spellcheck={false} defaultValue={value}
        placeholder={it ? (it.text ? "" : "(empty cell)") : R ? "Click a cell to select it · double-click or type to edit" : "Open a workbook to start"}
        onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === "Enter") { e.preventDefault(); commitText(t.value, [1, 0]); t.blur(); } if (e.key === "Escape") { t.value = value; t.blur(); } }} />
      <span class="fxhint">Enter ↵ apply · Esc cancel</span>
    </div>
  );
}

export function selStatus(): string {
  const R = curSlide(), it = activeItem(), its = selItems();
  if (!R) return "";
  if (!it) return `Slide ${S.cur + 1} of ${S.slides.length}`;
  const e = editOf(it);
  return `${its.length} cell${its.length > 1 ? "s" : ""} selected` + (e.text !== undefined && e.orig !== it.text ? " · text edit paused (Excel value changed)" : e.text !== undefined ? ` · Excel value: “${it.text}”` : "");
}
