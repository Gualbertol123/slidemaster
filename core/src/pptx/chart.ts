/* A pie or donut as a native PowerPoint chart (07 §4.2): `c:chartSpace` with `c:pieChart` / `c:doughnutChart`, one
   series with its cached labels and values (so PowerPoint draws it without opening anything), each point's colour,
   the data labels the item shows (name / value / percent), the legend's place and the title; and the embedded
   workbook (`embeddings/*.xlsx`, two columns) that Edit Data opens. Written with fflate, like the package. */
import { strToU8, zipSync } from "fflate";
import type { RGB } from "../dl/types";
import { parseColor } from "../dl/color";
import { E, NS, PT, XML_HEAD, esc, clr } from "./drawingml";
import type { ChartSem, FontSem } from "./chart-sem";

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
  const rows = [`<row r="1">${str("A1", "")}${str("B1", ch.series || "Series 1")}</row>`,
    ...ch.labels.map((l, i) => `<row r="${i + 2}">${str("A" + (i + 2), l)}<c r="B${i + 2}"><v>${num(ch.values[i])}</v></c></row>`)];
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(XML_HEAD + `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(XML_HEAD + `<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'),
    "xl/worksheets/sheet1.xml": strToU8(XML_HEAD + `<worksheet xmlns="${S}"><dimension ref="A1:B${ch.labels.length + 1}"/><sheetData>${rows.join("")}</sheetData></worksheet>`),
  };
  // a fixed time (local components: fflate writes DOS times from local getters), so the same chart gives the same bytes
  return zipSync(files, { level: 6, mtime: ZIP_TIME });
}
