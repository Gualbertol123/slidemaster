/* First toolbar row: TEXT. One set of controls for every text on a slide – table cells, text boxes,
   titles, subtitles, the cover note and date. They act on what is selected (named at the left); the
   row never changes shape. Deck-wide text styles and the font library: "Text styles…". */
import { S, useApp } from "../state/store";
import { ctx, undo } from "../state/app";
import { activeItem, applySel, commitText, curSlide, selItems, editOf } from "../editor/edit";
import { startPainter, stopPainter } from "../editor/painter";
import { SLIDE_TEXT_LABEL, stepSize, textTarget, type Align, type TextTarget, type VAlign } from "../editor/textfmt";
import { effFmt, effText, keyOf } from "../render/edits";
import { A1 } from "../xlsx/util";
import { Dropdown } from "./Dropdown";
import { Field } from "./Field";
import { FontPicker, openFontManager } from "./FontPicker";

const FILLS: [string, string][] = [["#34C759", "Green (positive)"], ["#FF3B30", "Red (negative)"], ["#FF9500", "Orange"], ["#FFCC00", "Yellow"], ["#007AFF", "Blue"], ["#5856D6", "Indigo"],
  ["#AF52DE", "Purple"], ["#30B0C7", "Teal"], ["#8E8E93", "Grey"], ["#D1D1D6", "Light grey"], ["#0B4F97", "Navy"], ["#FFFFFF", "White"]];
const INKS: [string, string][] = [["#0B0D17", "Black"], ["#5B6274", "Dark grey"], ["#8E8E93", "Grey"], ["#A8101A", "Red"], ["#136B2E", "Green"], ["#0A58CA", "Blue"],
  ["#B25000", "Orange"], ["#6B2FB3", "Purple"], ["#FFFFFF", "White"], ["#1C4F8C", "Navy"], ["#C42B1C", "Bright red"], ["#1F9D55", "Bright green"]];
const BLOCKS: [string, string][] = [["#1F3864", "Dark navy"], ["#2F5597", "Blue"], ["#404040", "Charcoal"], ["#F2F2F2", "Very light grey"]];

const swatches = (list: [string, string][], set: (v: string) => void, attr: string, close: () => void) =>
  <div class="swatches">{list.map(([c, n]) => <button key={c} title={n} {...{ [attr]: c }} style={{ background: c }} onClick={() => { close(); set(c); }} />)}</div>;

function InkMenu({ t, close }: { t: TextTarget; close: () => void }) {
  const set = (v: string | null) => t.apply(v ? "Text colour" : "Automatic text colour", { color: v });
  return <>
    <div class="hd">Text colour</div>{swatches(INKS, set, "data-v", close)}
    <div class="wide"><button data-v="" onClick={() => { close(); set(null); }}>Automatic</button>
      <label class="custom" title="Any colour"><input type="color" value={t.shown.color || "#0B0D17"} onChange={e => { close(); set((e.target as HTMLInputElement).value.toUpperCase()); }} />Custom…</label></div>
  </>;
}
function FillMenu({ close }: { close: () => void }) {
  const bg = (v: string | null) => applySel(v === null ? "Excel cell colour" : "Cell colour", e => { if (v === null) delete e.bg; else { e.bg = v; delete e.fill; } });
  const hl = (v: string | null) => applySel(v === null ? "Remove highlight" : "Highlight", e => { if (v === null) delete e.fill; else e.fill = v; });
  return <div class="fillmenu">
    <div class="hd">Cell colour <small>replaces the colour from Excel (in Liquid Glass: the colour of the block)</small></div>
    {swatches(FILLS.concat(BLOCKS), v => bg(v), "data-bg", close)}
    <div class="wide"><button data-bg="none" onClick={() => { close(); bg("none"); }}>No colour</button><button data-bg="" onClick={() => { close(); bg(null); }}>Colour from Excel</button></div>
    <div class="sep" />
    <div class="hd">Highlight <small>a capsule on the cell; green/red keep their positive/negative meaning</small></div>
    {swatches(FILLS, v => hl(v), "data-v", close)}
    <div class="wide"><button data-v="" onClick={() => { close(); hl(null); }}>Remove highlight</button></div>
  </div>;
}

const ALIGN_ICON: Record<Align, string> = { left: "M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8", center: "M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8", right: "M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8" };
const VALIGN_ICON: Record<VAlign, string> = { top: "M2 2.5h12M8 5v8M5.5 7.5 8 5l2.5 2.5", middle: "M2 8h12M8 1.5v4M8 10.5v4M6 3.5l2 2 2-2M6 12.5l2-2 2 2", bottom: "M2 13.5h12M8 3v8M5.5 8.5 8 11l2.5-2.5" };

export function Ribbon() {
  useApp();
  const t = textTarget(), has = !!t, f = t?.shown, cells = t?.kind === "cells";
  const fillSw = cells ? (() => { const x = effFmt(ctx(), activeItem()!); return x.bg && x.bg !== "none" ? x.bg : x.fill && x.fill !== "none" ? x.fill : null; })() : null;
  const tb = ({ active, off, ...props }: Record<string, unknown>) => ({ class: "tb" + (active ? " on" : ""), disabled: !has || !!off, ...props });
  return (
    <nav class="ribbon">
      <div class="grp">
        <button class="tb" id="undoBtn" title="Undo (Ctrl+Z) – only your own changes" disabled={!S.undo.length} onClick={() => undo(false)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg></button>
        <button class="tb" id="redoBtn" title="Redo (Ctrl+Y)" disabled={!S.redo.length} onClick={() => undo(true)}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m10.5 3.5 3 3-3 3" /><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" /></svg></button>
      </div>
      <div class="grp textgrp">
        <span class={"target" + (t ? " on" : "")} id="textTarget" title={t ? "The text controls change: " + t.label : "Click a cell, a text box, a title or a subtitle on the slide"}>{t ? t.label : "No text selected"}</span>
        <FontPicker id="fontBtn" disabled={!has} value={f?.font ?? null} placeholder={cells && ctx().style.design === "excel" ? "Font from Excel" : "Design font"}
          title="Font (more fonts: Google Fonts or your own files)" onPick={v => t?.apply("Font", { font: v })} />
        <button {...tb({ id: "sizeDown", title: "Smaller text" })} onClick={() => stepSize(-1)}>A−</button>
        <Field class="sizebox" id="sizeBox" disabled={!has} title="Text size in points (Enter to apply)" value={f?.pt != null ? String(f.pt) : ""}
          onCommit={v => { const n = parseFloat(v.replace(",", ".")); if (isFinite(n) && n > 0) t?.apply("Text size", { pt: n }); }} />
        <button {...tb({ id: "sizeUp", title: "Larger text" })} onClick={() => stepSize(1)}>A+</button>
      </div>
      <div class="grp">
        <button {...tb({ id: "boldBtn", title: "Bold (Ctrl+B)", active: !!f?.b })} onClick={() => t?.apply("Bold", { b: !f!.b })}><b>B</b></button>
        <button {...tb({ id: "italBtn", title: "Italic (Ctrl+I)", active: !!f?.i })} onClick={() => t?.apply("Italic", { i: !f!.i })}><i style="font-family:Georgia,serif">I</i></button>
        <Dropdown button={(_o, tg) => <button class="tb colorbtn" id="inkBtn" disabled={!has} title="Text colour" onClick={tg}><span>A</span><i class="sw" style={{ background: f?.color || "#0B0D17" }} /></button>}>{close => t ? <InkMenu t={t} close={close} /> : null}</Dropdown>
        <Dropdown button={(_o, tg) => <button class="tb colorbtn" id="fillBtn" disabled={!cells} title={cells ? "Cell colour (replaces the Excel colour) or highlight" : "Cell colour – for table cells (text boxes: Bubble)"} onClick={tg}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8.5 8.5 3l4.5 4.5-5.5 5.5z" /><path d="M13.5 10.5s1.2 1.4 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.8 1.2-2.2 1.2-2.2z" fill="currentColor" /></svg><i class="sw" style={{ background: fillSw || "linear-gradient(90deg,#34C759 50%,#FF3B30 50%)" }} /></button>}>{close => <FillMenu close={close} />}</Dropdown>
      </div>
      <div class="grp">
        {(["left", "center", "right"] as const).map(a => <button key={a} {...tb({ "data-align": a, title: a === "center" ? "Centre" : "Align " + a, active: f?.align === a })} onClick={() => t?.apply("Alignment", { align: a })}>
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6"><path d={ALIGN_ICON[a]} /></svg></button>)}
        <button {...tb({ "data-align": "auto", title: cells ? "Alignment from Excel" : "Alignment of the design", style: "font-size:11px", active: has && !f?.align })} onClick={() => t?.apply("Alignment", { align: null })}>Auto</button>
        <Dropdown button={(_o, tg) => <button class="tb" id="spacingBtn" disabled={!t?.can.spacing} title={t?.can.spacing ? "Line and paragraph spacing" : "Line spacing – for text boxes"} onClick={tg}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 3.5h7M7 8h7M7 12.5h7" /><path d="M3 2v12M1.5 3.5 3 2l1.5 1.5M1.5 12.5 3 14l1.5-1.5" /></svg></button>}>
          {close => t ? <div class="spacemenu">
            <div class="hd">Line spacing</div>
            <div class="row">{[1, 1.15, 1.3, 1.5, 1.75, 2].map(v => <button key={v} data-lh={v} class={(f?.lh ?? 1.28) === v ? "picked" : ""} onClick={() => { close(); t.apply("Line spacing", { lh: v }); }}>{v.toFixed(v % 1 ? 2 : 1).replace(/0$/, "")}</button>)}</div>
            <div class="hd">Space between paragraphs</div>
            <div class="row">{([[0, "None"], [.5, "Small"], [1, "Medium"], [1.5, "Large"]] as const).map(([v, l]) => <button key={v} data-pgap={v} class={f?.pgap === v ? "picked" : ""} onClick={() => { close(); t.apply("Paragraph spacing", { pgap: v }); }}>{l}</button>)}</div>
            <div class="wide"><button onClick={() => { close(); t.apply("Spacing of the design", { lh: null, pgap: null }); }}>As designed</button></div>
          </div> : null}
        </Dropdown>
        {(["top", "middle", "bottom"] as const).map(v => <button key={v} {...tb({ "data-valign": v, off: !t?.can.valign, title: t?.can.valign ? "Text at the " + v : "Vertical position – for text boxes", active: f?.valign === v })}
          onClick={() => t?.apply("Vertical alignment", { valign: f?.valign === v ? null : v })}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d={VALIGN_ICON[v]} /></svg></button>)}
      </div>
      <div class="grp">
        <button {...tb({ id: "clearFmt", title: "Remove your formatting from the selected text (back to the text style)" })} onClick={() => t?.clear()}>Clear format</button>
        <button class={"tb" + (S.painter ? " on" : "")} id="painterBtn" disabled={!cells && !S.painter} title="Copy the format of table cells: click, then click or drag over the cells to paste. Double-click to paste several times; Esc stops."
          onClick={() => S.painter ? stopPainter() : startPainter(false)} onDblClick={() => startPainter(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="1.5" width="10" height="4" rx="1" /><path d="M12 3.5h1.5v3.5H7.5v2" /><rect x="6" y="9.5" width="3" height="5" rx="1" /></svg>Format</button>
      </div>
      <div class="grp">
        <button class="tb" id="textStylesBtn" disabled={!S.sync} title="Fonts, sizes and colours of ALL titles, subtitles, tables, text boxes, contents and page numbers in this deck – and the font library" onClick={() => openFontManager("styles")}>
          <span class="aa">Aa</span>Text styles…</button>
      </div>
    </nav>
  );
}

export function FxBar() {
  useApp();
  const R = curSlide(), it = activeItem(), its = selItems(), sel = S.sel;
  const name = it && sel ? it.L!.sheet.name + "!" + (its.length > 1 ? `${A1(sel.r1, sel.c1)}:${A1(sel.r2, sel.c2)}` : keyOf(it)) : R ? "—" : "";
  const value = it ? effText(ctx(), it) : "";
  const edited = selItems().some(x => editOf(x).text !== undefined);
  return (
    <div class="fxbar">
      <div class="namebox" id="nameBox">{name}</div>
      <span class="fxlabel">fx</span>
      {/* key: a different cell resets the field (uncontrolled while typing) */}
      <input class="fxinput" id="fxInput" key={name + "|" + value} disabled={!it} spellcheck={false} defaultValue={value}
        placeholder={it ? (it.text ? "" : "(empty cell)") : R ? "Click a cell to select it · double-click or type to edit" : "Open a workbook to start"}
        onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === "Enter") { e.preventDefault(); commitText(t.value, [1, 0]); t.blur(); } if (e.key === "Escape") { t.value = value; t.blur(); } }} />
      <span class="fxhint">Enter ↵ apply · Esc cancel</span>
      <button class="tb" id="resetText" disabled={!edited} title={edited ? `Show the Excel value again: “${it!.text}”` : "Shows the Excel value again after you changed a cell's text"}
        onClick={() => applySel("Restore Excel text", e => { delete e.text; delete e.orig; })}>↺ Excel value</button>
    </div>
  );
}

export function selStatus(): string {
  const R = curSlide(), it = activeItem(), its = selItems();
  if (!R) return "";
  if (S.noteSel) return "Text box selected · double-click or Enter to write · Del removes it";
  if (S.textSel) return `${SLIDE_TEXT_LABEL[S.textSel]} selected · double-click or Enter to edit the text`;
  if (!it) return `Slide ${S.cur + 1} of ${S.slides.length}`;
  const e = editOf(it);
  return `${its.length} cell${its.length > 1 ? "s" : ""} selected` + (e.text !== undefined && e.orig !== it.text ? " · text edit paused (Excel value changed)" : e.text !== undefined ? ` · Excel value: “${it.text}”` : "");
}
