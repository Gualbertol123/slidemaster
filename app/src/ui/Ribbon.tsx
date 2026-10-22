/* First toolbar row: TEXT. One set of controls for every text on a slide – table cells, text boxes,
   titles, subtitles, the cover note and date. They act on what is selected (named at the left); the
   row never changes shape. Deck-wide text styles and the font library: "Text styles…". */
import { isLookText, LOOK_TEXT_LABEL } from "../editor/look";
import { useEffect, useState } from "react";
import { get, useStore } from "../state/store";
import { core, undo } from "../state/app";
import { activeItem, applySel, commitText, curSlide, selCells, selItems, editOf } from "../editor/edit";
import { kindText } from "../editor/item-text";
import { startPainter, stopPainter } from "../editor/painter";
import { numShown, SLIDE_TEXT_LABEL, stepNumber, stepSize, textTarget, type Align, type TextTarget, type VAlign } from "../editor/textfmt";
import { numHas } from "@slide-builder/core/render/numdisplay";
import { effFmt, effText, keyOf, origMatches } from "@slide-builder/core/render/edits";
import { A1 } from "@slide-builder/core/xlsx/util";
import { Dropdown } from "./Dropdown";
import { Field } from "./Field";
import { FontPicker, openFontManager } from "./FontPicker";
import { Input } from "./Input";
import { useCtx, useCurSlide, useDesign } from "./hooks";
import { Ic } from "./Ic";
import { OverflowBar } from "./OverflowBar";
import { isIsp, ISP_FILLS, ISP_TEXT } from "@slide-builder/core/model/isp";

const FILLS: [string, string][] = [["#34C759", "Green (positive)"], ["#FF3B30", "Red (negative)"], ["#FF9500", "Orange"], ["#FFCC00", "Yellow"], ["#007AFF", "Blue"], ["#5856D6", "Indigo"],
  ["#AF52DE", "Purple"], ["#30B0C7", "Teal"], ["#8E8E93", "Grey"], ["#D1D1D6", "Light grey"], ["#0B4F97", "Navy"], ["#FFFFFF", "White"]];
const INKS: [string, string][] = [["#0B0D17", "Black"], ["#5B6274", "Dark grey"], ["#8E8E93", "Grey"], ["#A8101A", "Red"], ["#136B2E", "Green"], ["#0A58CA", "Blue"],
  ["#B25000", "Orange"], ["#6B2FB3", "Purple"], ["#FFFFFF", "White"], ["#1C4F8C", "Navy"], ["#C42B1C", "Bright red"], ["#1F9D55", "Bright green"]];
const BLOCKS: [string, string][] = [["#1F3864", "Dark navy"], ["#2F5597", "Blue"], ["#404040", "Charcoal"], ["#F2F2F2", "Very light grey"]];

const swatches = (list: [string, string][], set: (v: string) => void, attr: string, close: () => void) =>
  <div className="swatches">{list.map(([c, n]) => <button key={c} title={n} {...{ [attr]: c }} style={{ background: c }} onClick={() => { close(); set(c); }} />)}</div>;

function InkMenu({ t, close }: { t: TextTarget; close: () => void }) {
  const set = (v: string | null) => t.apply(v ? "Text colour" : "Automatic text colour", { color: v }), isp = isIsp(useDesign());
  return <>
    <div className="hd">Text colour</div>{swatches(INKS, set, "data-v", close)}
    {isp && <><div className="hd">Template colours <small>Intesa Sanpaolo: the colours for texts</small></div>{swatches(ISP_TEXT, set, "data-v", close)}</>}
    <div className="wide"><button data-v="" onClick={() => { close(); set(null); }}>Automatic</button>
      <label className="custom" title="Any colour"><Input type="color" value={t.shown.color || "#0B0D17"} onCommit={e => { close(); set((e.target as HTMLInputElement).value.toUpperCase()); }} />Custom…</label></div>
  </>;
}
function FillMenu({ close }: { close: () => void }) {
  const bg = (v: string | null) => applySel(v === null ? "Excel cell colour" : "Cell colour", e => { if (v === null) delete e.bg; else { e.bg = v; delete e.fill; } }, selCells());
  const hl = (v: string | null) => applySel(v === null ? "Remove highlight" : "Highlight", e => { if (v === null) delete e.fill; else e.fill = v; }, selCells());
  const isp = isIsp(useDesign());
  return <div className="fillmenu">
    <div className="hd">Cell colour <small>replaces the colour from Excel (in Liquid Glass: the colour of the block)</small></div>
    {swatches(FILLS.concat(BLOCKS), v => bg(v), "data-bg", close)}
    {isp && <><div className="hd">Template fills <small>Intesa Sanpaolo: each colour at 25, 50 or 75 % transparency</small></div>{swatches(ISP_FILLS, v => bg(v), "data-bg", close)}</>}
    <div className="wide"><button data-bg="none" onClick={() => { close(); bg("none"); }}>No colour</button><button data-bg="" onClick={() => { close(); bg(null); }}>Colour from Excel</button></div>
    <div className="sep" />
    <div className="hd">Highlight <small>a capsule on the cell; green/red keep their positive/negative meaning</small></div>
    {swatches(FILLS, v => hl(v), "data-v", close)}
    <div className="wide"><button data-v="" onClick={() => { close(); hl(null); }}>Remove highlight</button></div>
  </div>;
}

const VALIGN_ICON = { top: "align-box-center-top", middle: "align-box-center-middle", bottom: "align-box-center-bottom" } as const satisfies Record<VAlign, string>;

export function Ribbon() {
  const canUndo = useStore(s => s.deck.history.undo > 0), canRedo = useStore(s => s.deck.history.redo > 0);
  const painter = useStore(s => !!s.selection.painter), open = useStore(s => s.doc.open), item = useStore(s => !!s.selection.itemSel);
  useStore(s => s.selection); useCurSlide();                 // what the text target is computed from
  const c = useCtx();
  const t = textTarget(), has = !!t, f = t?.shown, cells = t?.kind === "cells";
  const fillSw = cells ? (() => { const x = effFmt(c, activeItem()!); return x.bg && x.bg !== "none" ? x.bg : x.fill && x.fill !== "none" ? x.fill : null; })() : null;
  const tb = ({ active, off, ...props }: Record<string, unknown>) => ({ className: "tb" + (active ? " on" : ""), disabled: !has || !!off, ...props });
  // the number display of the cells (4.9): the active cell's code; off for anything but cells
  const num = cells ? numShown(activeItem()) : null, nb = (props: Record<string, unknown>) => tb({ off: !cells, ...props });
  return (
    <OverflowBar className="ribbon">
      <div className="grp" data-prio="2">
        <button className="tb" id="undoBtn" title="Undo (Ctrl+Z) – only your own changes" disabled={!canUndo} onClick={() => undo(false)}><Ic n="arrow-back-up" /></button>
        <button className="tb" id="redoBtn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => undo(true)}><Ic n="arrow-forward-up" /></button>
      </div>
      <div className="grp textgrp" data-prio="0">
        <span className={"target" + (t ? " on" : "")} id="textTarget" title={t ? "The text controls change: " + t.label : "Click a cell, a text box, a title or a subtitle on the slide"}>{t ? t.label : "No text selected"}</span>
        <FontPicker id="fontBtn" disabled={!has} value={f?.font ?? null} placeholder={cells && c.style.design === "excel" ? "Font from Excel" : "Design font"}
          title="Font (more fonts: Google Fonts or your own files)" onPick={v => t?.apply("Font", { font: v })} />
        <button {...tb({ id: "sizeDown", title: "Smaller text" })} onClick={() => stepSize(-1)}>A−</button>
        <Field className="sizebox" id="sizeBox" disabled={!has} title="Text size in points (Enter to apply)" value={f?.pt != null ? String(f.pt) : ""}
          onCommit={v => { const n = parseFloat(v.replace(",", ".")); if (isFinite(n) && n > 0) t?.apply("Text size", { pt: n }); }} />
        <button {...tb({ id: "sizeUp", title: "Larger text" })} onClick={() => stepSize(1)}>A+</button>
      </div>
      <div className="grp" data-prio="0">
        <button {...tb({ id: "boldBtn", title: "Bold (Ctrl+B)", active: !!f?.b })} onClick={() => t?.apply("Bold", { b: !f!.b })}><b>B</b></button>
        <button {...tb({ id: "italBtn", title: "Italic (Ctrl+I)", active: !!f?.i })} onClick={() => t?.apply("Italic", { i: !f!.i })}><i style={{ fontFamily: "Georgia,serif" }}>I</i></button>
        <Dropdown button={(_o, tg) => <button className="tb colorbtn" id="inkBtn" disabled={!has} title="Text colour" onClick={tg}><span>A</span><i className="sw" style={{ background: f?.color || "#0B0D17" }} /></button>}>{close => t ? <InkMenu t={t} close={close} /> : null}</Dropdown>
        <Dropdown button={(_o, tg) => <button className="tb colorbtn" id="fillBtn" disabled={!cells} title={cells ? "Cell colour (replaces the Excel colour) or highlight" : "Cell colour – for table cells (text boxes: Bubble)"} onClick={tg}><Ic n="bucket-droplet" /><i className="sw" style={{ background: fillSw || "linear-gradient(90deg,#34C759 50%,#FF3B30 50%)" }} /></button>}>{close => <FillMenu close={close} />}</Dropdown>
      </div>
      <div className="grp" data-prio="3">
        {(["left", "center", "right"] as const).map(a => <button key={a} {...tb({ "data-align": a, off: t?.can.align === false, title: a === "center" ? "Centre" : "Align " + a, active: f?.align === a })} onClick={() => t?.apply("Alignment", { align: a })}>
          <Ic n={`align-${a}`} /></button>)}
        <button {...tb({ "data-align": "auto", off: t?.can.align === false, title: cells ? "Alignment from Excel" : "Alignment of the design", style: { fontSize: "11px" }, active: has && !f?.align })} onClick={() => t?.apply("Alignment", { align: null })}>Auto</button>
        <Dropdown button={(_o, tg) => <button className="tb" id="spacingBtn" disabled={!t?.can.spacing} title={t?.can.spacing ? "Line and paragraph spacing" : "Line spacing – for text boxes"} onClick={tg}>
          <Ic n="line-height" /></button>}>
          {close => t ? <div className="spacemenu">
            <div className="hd">Line spacing</div>
            <div className="row">{[1, 1.15, 1.3, 1.5, 1.75, 2].map(v => <button key={v} data-lh={v} className={(f?.lh ?? 1.28) === v ? "picked" : ""} onClick={() => { close(); t.apply("Line spacing", { lh: v }); }}>{v.toFixed(v % 1 ? 2 : 1).replace(/0$/, "")}</button>)}</div>
            <div className="hd">Space between paragraphs</div>
            <div className="row">{([[0, "None"], [.5, "Small"], [1, "Medium"], [1.5, "Large"]] as const).map(([v, l]) => <button key={v} data-pgap={v} className={f?.pgap === v ? "picked" : ""} onClick={() => { close(); t.apply("Paragraph spacing", { pgap: v }); }}>{l}</button>)}</div>
            <div className="wide"><button onClick={() => { close(); t.apply("Spacing of the design", { lh: null, pgap: null }); }}>As designed</button></div>
          </div> : null}
        </Dropdown>
        {(["top", "middle", "bottom"] as const).map(v => <button key={v} {...tb({ "data-valign": v, off: !t?.can.valign, title: t?.can.valign ? "Text at the " + v : "Vertical position – for text boxes", active: f?.valign === v })}
          onClick={() => t?.apply("Vertical alignment", { valign: f?.valign === v ? null : v })}><Ic n={VALIGN_ICON[v]} /></button>)}
      </div>
      <div className="grp" data-prio="4">
        <button {...tb({ id: "clearFmt", title: "Remove your formatting from the selected text (back to the text style)" })} onClick={() => t?.clear()}>Clear format</button>
        <button className={"tb" + (painter ? " on" : "")} id="painterBtn" disabled={!cells && !item && !painter} title="Copy the format of table cells (or of a chart, callout, icon or line): click, then click or drag over the cells (objects of the same kind) to paste. Ctrl+click several, then let go of Ctrl, to paste onto all of them at once. Double-click to paste several times; Esc stops."
          onClick={() => painter ? stopPainter() : startPainter(false)} onDoubleClick={() => startPainter(true)}>
          <Ic n="paint" />Format</button>
      </div>
      <div className="grp numgrp" data-prio="5" title="Number display of the selected cells (over Excel's format)">
        <button {...nb({ id: "numDecDown", title: "Fewer decimals" })} onClick={() => stepNumber("dec-", activeItem())}><Ic n="arrow-narrow-left" />.0</button>
        <button {...nb({ id: "numDecUp", title: "More decimals" })} onClick={() => stepNumber("dec+", activeItem())}>.00</button>
        <button {...nb({ id: "numPct", title: "Percent (on / off)", active: !!num && numHas(num, "pct") })} onClick={() => stepNumber("pct", activeItem())}>%</button>
        <button {...nb({ id: "numThou", title: "Thousands separator (on / off)", active: !!num && numHas(num, "thou") })} onClick={() => stepNumber("thou", activeItem())}>000</button>
      </div>
      <div className="grp" data-prio="1">
        <button className="tb" id="textStylesBtn" disabled={!open} title="Fonts, sizes and colours of ALL titles, subtitles, tables, text boxes, contents and page numbers in this deck – and the font library" onClick={() => openFontManager("styles")}>
          <span className="aa">Aa</span>Text styles…</button>
      </div>
    </OverflowBar>
  );
}

export function FxBar() {
  const sel = useStore(s => s.selection.sel), R = useCurSlide(), c = useCtx();
  const it = activeItem(), its = selItems();
  const name = it && sel ? it.L!.sheet.name + "!" + (its.length > 1 ? `${A1(sel.r1, sel.c1)}:${A1(sel.r2, sel.c2)}` : keyOf(it)) : R ? "—" : "";
  const value = it ? effText(c, it) : "";
  const edited = selItems().some(x => editOf(x).text !== undefined);
  // the cell's own value in the workbook, read through the core worker (PLAN S2.5) – shown when the text was edited
  const book = useStore(s => s.deck.wb?.book ?? 0);
  // the workbook is part of the key: a reloaded workbook has its own values for the same cell
  const xlKey = it && edited ? book + "|" + it.L!.sheet.name + "!" + keyOf(it) : "";
  const [xl, setXl] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!xlKey || !it) return;
    let live = true;
    void core().call("getCell", { book, sheet: it.L!.sheet.name, ref: keyOf(it) }).then(c => { if (live && c) setXl({ key: xlKey, text: c.text }); }).catch(() => { /* keep the layout's text */ });
    return () => { live = false; };
  }, [xlKey]);
  const excelText = xl && xl.key === xlKey ? xl.text : it?.text;
  return (
    <div className="fxbar">
      <div className="namebox" id="nameBox">{name}</div>
      <span className="fxlabel">fx</span>
      {/* key: a different cell resets the field (uncontrolled while typing) */}
      <input className="fxinput" id="fxInput" key={name + "|" + value} disabled={!it} spellCheck={false} defaultValue={value}
        placeholder={it ? (it.text ? "" : "(empty cell)") : R ? "Click a cell to select it · double-click or type to edit" : "Open a workbook to start"}
        onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === "Enter") { e.preventDefault(); commitText(t.value, [1, 0]); t.blur(); } if (e.key === "Escape") { t.value = value; t.blur(); } }} />
      <span className="fxhint">Enter ↵ apply · Esc cancel</span>
      <button className="tb" id="resetText" disabled={!edited} title={edited ? `Show the Excel value again: “${excelText}”` : "Shows the Excel value again after you changed a cell's text"}
        onClick={() => applySel("Restore Excel text", e => { delete e.text; delete e.orig; })}><Ic n="restore" />Excel value</button>
    </div>
  );
}

export function selStatus(): string {
  const R = curSlide(), it = activeItem(), its = selCells(), { selection: { noteSel, textSel, itemSel }, deck } = get();
  if (!R) return "";
  // a slide item: its kind's words (editor/item-text.ts; M14 and M15 each in their own file)
  if (itemSel && R.cfg.items?.[itemSel.id]) { const it = R.cfg.items[itemSel.id]; return kindText(it).status(it, itemSel); }
  if (noteSel) return "Text box selected · double-click or Enter to write · Del removes it";
  if (textSel && isLookText(textSel)) return `${LOOK_TEXT_LABEL[textSel]} selected · its font, size and colour above, its parts in the Headline group (this slide)`;
  if (textSel) return `${SLIDE_TEXT_LABEL[textSel]} selected · double-click or Enter to edit the text`;
  if (!it) return `Slide ${deck.cur + 1} of ${deck.slides.length}`;
  const e = editOf(it), n = (get().selection.sel?.more?.length ?? 0) + 1;
  // several Ctrl+click ranges: which controls reach them all (S16.3 second review, 6)
  if (n > 1) return `${its.length} cells in ${n} ranges selected · text, colour and number controls: all ranges · borders, merges, roles, rows, columns, charts: the current range only`;
  return `${its.length} cell${its.length > 1 ? "s" : ""} selected` + (e.text !== undefined && !origMatches(e, it) ? " · text edit paused (Excel value changed)" : e.text !== undefined ? ` · Excel value: “${it.text}”` : "");
}
