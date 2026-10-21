/* A chart as a native PowerPoint chart (07 §4.2, 09 §4.2): `c:chartSpace` with `c:pieChart` / `c:doughnutChart` (one
   series) or, since 4.7, a plot area of chart groups – `c:barChart` (S14.2: column / bar; clustered, stacked, 100 %),
   `c:lineChart` and `c:areaChart` (S14.3), on the primary axes and, for a second value axis, on secondary ones (a hidden
   `c:catAx`, a `c:valAx` on the right crossing at the end), multi-level categories for named category groups, the
   targets of "actual inside target" as an outlined bar series over the actual one (overlap 100); each series
   with its cached categories and values (so PowerPoint draws it without opening anything), each point's colour, the
   data labels the item shows, the legend's place and the title; and the embedded workbook (`embeddings/*.xlsx`:
   categories in A, one column per series) that Edit Data opens. Every formula points into that workbook
   (`Sheet1!$B$2:$B$7`), never at a linked file – a series from a linked workbook is a column of the embedded one.
   A bar chart's plot is fixed where the display list draws it (`c:manualLayout`, layoutTarget inner) and its value
   axis has the drawn min / max / unit, so PowerPoint's bars stand where the slide's do. Written with fflate. */
import { strToU8, zipSync } from "fflate";
import type { RGB } from "../dl/types";
import { parseColor } from "../dl/color";
import { E, NS, PT, XML_HEAD, esc, clr } from "./drawingml";
import type { BarsSem, BarSerSem, ChartSem, FontSem, GroupSem, LabelPos, LineSem, MarkerSem, ValAxisSem } from "./chart-sem";
import type { Box } from "./scene";
import { numToCol } from "../xlsx/util";

const col = (s: string): RGB => parseColor(s).c;
/** the time every zip entry carries (the package's and the embedded workbook's) */
export const ZIP_TIME = new Date(2020, 0, 1, 0, 0, 0);
const sz = (px: number) => Math.max(100, Math.min(400000, Math.round(px * PT * 100)));
function rich(text: string, f: FontSem, face: (css: string) => string): string {
  const F = esc(face(f.css));
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz(f.size)}" b="${f.b ? 1 : 0}" i="${f.i ? 1 : 0}"><a:solidFill>${clr(col(f.color))}</a:solidFill><a:latin typeface="${F}"/></a:defRPr></a:pPr>`
    + `<a:r><a:rPr lang="en-GB" sz="${sz(f.size)}" b="${f.b ? 1 : 0}" i="${f.i ? 1 : 0}"><a:solidFill>${clr(col(f.color))}</a:solidFill><a:latin typeface="${F}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}
function txPr(f: FontSem, face: (css: string) => string): string {
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz(f.size)}" b="${f.b ? 1 : 0}" i="${f.i ? 1 : 0}"><a:solidFill>${clr(col(f.color))}</a:solidFill><a:latin typeface="${esc(face(f.css))}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-GB"/></a:p></c:txPr>`;
}
/** a number as the cache writes it (no exponent for ordinary figures) */
const num = (v: number) => Number.isFinite(v) ? String(+v.toPrecision(15)) : "0";

/** the chart part; `rid` = its relationship to the embedded workbook */
export function chartXml(ch: ChartSem, rid: string, face: (css: string) => string): string {
  if (ch.bars) return barXml(ch, ch.bars, rid, face);
  const n = ch.values.length, kind = ch.type === "donut" ? "c:doughnutChart" : "c:pieChart";
  const sep = ch.sep && ch.sep.w > 0 ? `<a:ln w="${E(ch.sep.w)}"><a:solidFill>${clr(col(ch.sep.color))}</a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  const dPts = ch.colors.slice(0, n).map((c, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill>${clr(col(c))}</a:solidFill>${sep}</c:spPr></c:dPt>`).join("");
  const show = (k: string) => ch.show.includes(k as never) ? 1 : 0;
  const any = ch.show.length > 0;
  const flags = `<c:showLegendKey val="0"/><c:showVal val="${show("value")}"/><c:showCatName val="${show("label")}"/><c:showSerName val="0"/><c:showPercent val="${show("percent")}"/><c:showBubbleSize val="0"/>`;
  const pos = ch.type === "pie" && any ? '<c:dLblPos val="bestFit"/>' : "", sepr = any ? "<c:separator>\n</c:separator>" : "", none = "<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>";
  // where each label goes, as chart-dl.ts draws it: inside a slice wide enough (white on a dark one), else outside it
  // in the ink colour (a pie: at its outer end with a leader; a donut's labels are always on its ring)
  const white = { ...ch.labelFont, color: "#FFFFFF" }, lum = (c: string) => { const [r, g, b] = col(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const total = ch.values.reduce((s, v) => s + Math.abs(v), 0) || 1, inside = ch.values.map(v => n === 1 || Math.abs(v) / total * 360 >= 20);
  const dLbl = any ? ch.colors.slice(0, n).map((c, i) => {
    const onRing = ch.type === "donut" || inside[i], dark = onRing && lum(c) < .6;
    const at = ch.type === "pie" ? `<c:dLblPos val="${inside[i] ? "ctr" : "outEnd"}"/>` : "";
    return `<c:dLbl><c:idx val="${i}"/>${none}${txPr(dark ? white : ch.labelFont, face)}${at}${flags}${sepr}</c:dLbl>`;
  }).join("") : "";
  // (the values' format is the cache's – source-linked –, so a percentage keeps PowerPoint's own 0 %)
  const dLbls = `<c:dLbls>${dLbl}${none}${txPr(ch.labelFont, face)}${pos}${flags}${sepr}<c:showLeaderLines val="1"/></c:dLbls>`;
  const last = n + 1;
  const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${last}</c:f><c:strCache><c:ptCount val="${n}"/>${ch.labels.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$${last}</c:f><c:numCache><c:formatCode>${esc(ch.fmt || "General")}</c:formatCode><c:ptCount val="${n}"/>${ch.values.map((v, i) => `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val>`;
  const tx = `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(ch.series || "Series 1")}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
  const ser = `<c:ser><c:idx val="0"/><c:order val="0"/>${tx}${dPts}${dLbls}${cat}${val}</c:ser>`;
  const angle = Math.round(((ch.startAngle % 360) + 360) % 360);
  const plot = `<${kind}><c:varyColors val="1"/>${ser}<c:firstSliceAng val="${angle}"/>${ch.type === "donut" ? `<c:holeSize val="${Math.max(10, Math.min(90, Math.round(ch.hole)))}"/>` : ""}</${kind}>`;
  const title = ch.title ? `<c:title>${rich(ch.title, ch.titleFont, face)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = ch.legend === "none" ? "" : `<c:legend><c:legendPos val="${ch.legend === "bottom" ? "b" : "r"}"/><c:overlay val="0"/>${txPr(ch.labelFont, face)}</c:legend>`;
  return XML_HEAD + `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>`
    + `<c:chart>${title}<c:plotArea><c:layout/>${plot}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(ch.labelFont, face)}<c:externalData r:id="${rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

/** the embedded workbook: the labels in A, the values in B, the series name in B1 (inline strings, one style) */
export function chartWorkbook(ch: ChartSem): Uint8Array {
  const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const str = (ref: string, t: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
  // a series chart: one column per series (B, C, …), blank where a series has no value; a pie: its one column
  // (two category levels, S14.3: the groups' labels in A, the categories in B, the series from C on)
  const cols: { name: string; values: (number | null)[] }[] = ch.bars ? ch.bars.series.map(s => ({ name: s.name, values: s.values })) : [{ name: ch.series || "Series 1", values: ch.values }];
  const cats = ch.bars ? ch.bars.cats : ch.labels, lv = ch.bars?.levels || null, f = lv ? 3 : 2, last = numToCol(cols.length + f - 1);
  const rows = [`<row r="1">${str("A1", "")}${lv ? str("B1", "") : ""}${cols.map((c, k) => str(numToCol(k + f) + "1", c.name || `Series ${k + 1}`)).join("")}</row>`,
    ...cats.map((l, i) => `<row r="${i + 2}">${lv ? (lv[i] ? str("A" + (i + 2), lv[i]) : "") + str("B" + (i + 2), l) : str("A" + (i + 2), l)}${cols.map((c, k) => { const v = c.values[i]; return v === null || v === undefined ? "" : `<c r="${numToCol(k + f)}${i + 2}"><v>${num(v)}</v></c>`; }).join("")}</row>`)];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(XML_HEAD + `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(XML_HEAD + `<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'),
    "xl/worksheets/sheet1.xml": strToU8(XML_HEAD + `<worksheet xmlns="${S}"><dimension ref="A1:${last}${cats.length + 1}"/><sheetData>${rows.join("")}</sheetData></worksheet>`),
  };
  // a fixed time (local components: fflate writes DOS times from local getters), so the same chart gives the same bytes
  return zipSync(files, { level: 6, mtime: ZIP_TIME });
}

/* ---- column and bar charts (4.7, S14.2; 09 §4.2) ---- */
const frac = (v: number) => String(Math.round(Math.max(-1, Math.min(2, v)) * 1e6) / 1e6);
/** a manual layout: a box as fractions of the chart space (the graphic frame) */
function manual(b: Box, frame: Box, inner: boolean): string {
  return `<c:layout><c:manualLayout>${inner ? '<c:layoutTarget val="inner"/>' : ""}<c:xMode val="edge"/><c:yMode val="edge"/>`
    + `<c:x val="${frac((b.x - frame.x) / frame.w)}"/><c:y val="${frac((b.y - frame.y) / frame.h)}"/><c:w val="${frac(b.w / frame.w)}"/><c:h val="${frac(b.h / frame.h)}"/></c:manualLayout></c:layout>`;
}
const lnOf = (l: LineSem | null) => l ? `<a:ln w="${E(l.w)}"><a:solidFill>${clr(col(l.color))}</a:solidFill>${l.dash ? `<a:prstDash val="${l.dash}"/>` : ""}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
const solidSp = (c: string) => `<c:spPr><a:solidFill>${clr(col(c))}</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
const NONE_SP = "<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>";
/** a series' data labels: per point the hidden ones, the texts of our own (static rich text, refreshed at every export),
    the white ones inside a dark bar, a line label moved to the other side; then the series' own (number format, font,
    position – none on an area –, what they show) */
function barLabels(L: NonNullable<BarSerSem["labels"]>, face: (css: string) => string): string {
  const show = (k: string) => L.show.includes(k as never) ? 1 : 0;
  const flags = (v: number, c: number, s: number) => `<c:showLegendKey val="0"/><c:showVal val="${v}"/><c:showCatName val="${c}"/><c:showSerName val="${s}"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
  const numFmt = L.num ? `<c:numFmt formatCode="${esc(L.num)}" sourceLinked="0"/>` : "", sep = "<c:separator>, </c:separator>";
  const posOf = (p: LabelPos | undefined) => p ? `<c:dLblPos val="${p}"/>` : "", pos = posOf(L.pos), own = flags(show("value"), show("category"), show("name"));
  const pts = L.points.map(p => {
    if (p.hide) return `<c:dLbl><c:idx val="${p.i}"/><c:delete val="1"/></c:dLbl>`;
    const f = p.color ? { ...L.font, color: p.color } : L.font, at = p.pos ? posOf(p.pos) : pos;
    if (p.text !== undefined) return `<c:dLbl><c:idx val="${p.i}"/>${rich(p.text, f, face)}${NONE_SP}${at}${flags(1, 0, 0)}</c:dLbl>`;
    return `<c:dLbl><c:idx val="${p.i}"/>${numFmt}${NONE_SP}${txPr(f, face)}${at}${own}${sep}</c:dLbl>`;
  }).join("");
  return `<c:dLbls>${pts}${numFmt}${NONE_SP}${txPr(L.font, face)}${pos}${own}${sep}</c:dLbls>`;
}
/** a line's stroke as a:ln: its width, colour and dash, round caps and joins (as the display list's) */
const lineLn = (l: LineSem) => `<a:ln w="${E(l.w)}" cap="rnd"><a:solidFill>${clr(col(l.color))}</a:solidFill>${l.dash ? `<a:prstDash val="${l.dash}"/>` : ""}<a:round/></a:ln>`;
/** a line's marker (c:marker): its symbol, size in points, fill and ring; none written as such */
function markerXml(mk: MarkerSem | null | undefined, color?: string): string {
  if (!mk || mk.symbol === "none") return '<c:marker><c:symbol val="none"/></c:marker>';
  return `<c:marker><c:symbol val="${mk.symbol}"/><c:size val="${Math.max(2, Math.min(72, Math.round(mk.size)))}"/><c:spPr><a:solidFill>${clr(col(color || mk.color))}</a:solidFill><a:ln w="${E(mk.w)}"><a:solidFill>${clr(col(mk.ring))}</a:solidFill></a:ln></c:spPr></c:marker>`;
}
/** one series of a chart group: the name, its look, per-point looks and labels, the categories, its cached values (a gap
    is a missing point); `c` is its column of the embedded workbook */
function serXml(kind: GroupSem["kind"], s: BarSerSem, k: number, cat: string, n: number, c: string, face: (css: string) => string): string {
  const last = n + 1;
  const tx = `<c:tx><c:strRef><c:f>Sheet1!$${c}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name || `Series ${k + 1}`)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
  const val = `<c:val><c:numRef><c:f>Sheet1!$${c}$2:$${c}$${last}</c:f><c:numCache><c:formatCode>${esc(s.fmt || "General")}</c:formatCode><c:ptCount val="${n}"/>`
    + s.values.slice(0, n).map((v, i) => v === null || v === undefined ? "" : `<c:pt idx="${i}"><c:v>${num(v)}</c:v></c:pt>`).join("") + "</c:numCache></c:numRef></c:val>";
  const labels = s.labels ? barLabels(s.labels, face) : "", head = `<c:idx val="${k}"/><c:order val="${k}"/>${tx}`;
  if (kind === "line") {
    const dPts = (s.markers || []).map(p => `<c:dPt><c:idx val="${p.i}"/>${markerXml(s.marker, p.color)}<c:bubble3D val="0"/></c:dPt>`).join("");
    return `<c:ser>${head}<c:spPr>${s.stroke ? lineLn(s.stroke) : "<a:ln><a:noFill/></a:ln>"}</c:spPr>${markerXml(s.marker)}${dPts}${labels}${cat}${val}<c:smooth val="${s.smooth ? 1 : 0}"/></c:ser>`;
  }
  if (kind === "area") return `<c:ser>${head}<c:spPr><a:solidFill>${clr(col(s.color), s.alpha ?? 1)}</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>${labels}${cat}${val}</c:ser>`;
  // a bar; the target of "actual inside target": no fill, its outline in the series' (each point's) colour
  const sp = (color: string) => s.target ? `<c:spPr><a:noFill/>${lnOf({ color, w: s.target.w })}</c:spPr>` : solidSp(color);
  const dPts = s.points.map(p => `<c:dPt><c:idx val="${p.i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>${sp(p.color)}</c:dPt>`).join("");
  return `<c:ser>${head}${sp(s.color)}<c:invertIfNegative val="0"/>${dPts}${labels}${cat}${val}</c:ser>`;
}
/** the categories: one level (strRef, column A), or two (multiLvlStrRef: the categories in B, their groups' labels in A) */
function catXml(B: BarsSem): string {
  const n = B.cats.length, pts = (l: string[]) => l.map((v, i) => v === "" && B.levels ? "" : `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("");
  if (!B.levels) return `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/>${B.cats.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`;
  return `<c:cat><c:multiLvlStrRef><c:f>Sheet1!$A$2:$B$${n + 1}</c:f><c:multiLvlStrCache><c:ptCount val="${n}"/><c:lvl>${B.cats.map((l, i) => `<c:pt idx="${i}"><c:v>${esc(l)}</c:v></c:pt>`).join("")}</c:lvl><c:lvl>${pts(B.levels)}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>`;
}
/** the plot area's chart groups: areas, bars, lines on the primary axes, then on the secondary ones (09 §4.2: several
    chart groups in one c:plotArea, as Excel writes a combo) – unset groups: one bar group of every series (S14.2) */
function groupsXml(B: BarsSem, face: (css: string) => string): string {
  const n = B.cats.length, cat = catXml(B), first = B.levels ? 3 : 2;
  const groups: GroupSem[] = B.groups ?? [{ kind: "bar", axis: "y", grouping: B.grouping, gap: B.gap, overlap: B.overlap, series: B.series.map((_, k) => k) }];
  return groups.map(g => {
    const ids = g.axis === "y2" ? `<c:axId val="510003"/><c:axId val="510004"/>` : `<c:axId val="510001"/><c:axId val="510002"/>`;
    const sers = g.series.map(k => serXml(g.kind, B.series[k], k, cat, n, numToCol(k + first), face)).join("");
    if (g.kind === "line") return `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ids}</c:lineChart>`;
    if (g.kind === "area") return `<c:areaChart><c:grouping val="${g.grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:areaChart>`;
    return `<c:barChart><c:barDir val="${B.dir}"/><c:grouping val="${g.grouping}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="${Math.round(g.gap)}"/>${g.overlap ? `<c:overlap val="${Math.round(g.overlap)}"/>` : ""}${ids}</c:barChart>`;
  }).join("");
}
/** a value axis with the drawn bounds and unit (the secondary one on the right, crossing its hidden category axis at the
    end) */
function valAxXml(V: ValAxisSem, id: number, cross: number, pos: string, second: boolean, face: (css: string) => string): string {
  return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/><c:max val="${num(V.max)}"/><c:min val="${num(V.min)}"/></c:scaling><c:delete val="${V.show ? 0 : 1}"/><c:axPos val="${pos}"/>`
    + `${V.grid ? `<c:majorGridlines><c:spPr>${lnOf(V.grid)}</c:spPr></c:majorGridlines>` : ""}<c:numFmt formatCode="${esc(V.num || "General")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:spPr><a:noFill/>${lnOf(V.line)}</c:spPr>${txPr(V.font, face)}<c:crossAx val="${cross}"/><c:crosses val="${second ? "max" : "autoZero"}"/><c:crossBetween val="between"/><c:majorUnit val="${num(V.step)}"/></c:valAx>`;
}
/** the plot area's chart groups at the drawn rectangle, the value axes with the drawn bounds and units, the category axis
    line at zero, the legend at its drawn box */
function barXml(ch: ChartSem, B: BarsSem, rid: string, face: (css: string) => string): string {
  const frame = ch.box, isCol = B.dir === "col", V = B.val, C = B.cat;
  const chartPart = groupsXml(B, face);
  const catAx = `<c:catAx><c:axId val="510001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${C.show ? 0 : 1}"/><c:axPos val="${isCol ? "b" : "l"}"/>`
    + `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:noFill/>${lnOf(C.line)}</c:spPr>${txPr(C.font, face)}`
    + `<c:crossAx val="510002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${C.skip > 1 ? `<c:tickLblSkip val="${C.skip}"/>` : ""}<c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = valAxXml(V, 510002, 510001, isCol ? "l" : "b", false, face);
  // the secondary axes: a hidden category axis and the right value axis
  const second = B.val2 ? `<c:catAx><c:axId val="510003"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:crossAx val="510004"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` + valAxXml(B.val2, 510004, 510003, "r", true, face) : "";
  // the title where it is drawn (its text box's top left; PowerPoint sizes a title itself)
  const tl = B.title ? `<c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="${frac((B.title.x - frame.x) / frame.w)}"/><c:y val="${frac((B.title.y - frame.y) / frame.h)}"/></c:manualLayout></c:layout>` : "";
  const title = ch.title ? `<c:title>${rich(ch.title, ch.titleFont, face)}${tl}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const Lg = B.legend;
  const legend = Lg ? `<c:legend><c:legendPos val="${Lg.pos}"/>${Lg.hide.map(i => `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>`).join("")}`
    + `${manual({ x: Lg.box.x - 4, y: Lg.box.y - 2, w: Lg.box.w + 8, h: Lg.box.h + 4 }, frame, false)}<c:overlay val="${Lg.overlay ? 1 : 0}"/>`
    + `${Lg.overlay ? `<c:spPr><a:solidFill>${clr([255, 255, 255], .85)}</a:solidFill>${lnOf({ color: "#D9D9D9", w: 1 })}</c:spPr>` : ""}${txPr(ch.labelFont, face)}</c:legend>` : "";
  return XML_HEAD + `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/>`
    + `<c:chart>${title}<c:plotArea>${manual(B.plot, frame, true)}${chartPart}${catAx}${valAx}${second}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(ch.labelFont, face)}<c:externalData r:id="${rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}
