/* The PowerPoint writer (docs/next/07 §4, ADR-016, B21): slides' display lists + what the core says of them → a .pptx
   (a zip of OOXML parts, fflate's zipSync). Pure TypeScript like ../pdf: fed by the export worker, pictures by
   content hash (each picture once in ppt/media, however many slides show it), font names from the resolver (named,
   not embedded).
   Standardised and lean (product owner, 2026-10-19): the master and its layouts are made from the slides themselves –
   one layout per kind of slide (cover, contents, content) with its title placeholder where the slides put their
   titles, its background (Liquid Glass's wallpaper: one picture for the whole deck) and the decoration every slide of
   that kind shares (drawn once, on the layout); the theme takes the design's colours and fonts. Slides then hold only
   what is theirs: placeholders for the title, subtitle, footer and page number, real tables, native charts and shapes.
   No connectors and no links outside the file. */
import { strToU8, zipSync } from "fflate";
import type { DisplayList } from "../dl/types";
import { isJpeg, isPng } from "../pdf/png";
import { sha1 } from "../text/sha1";
import { ZIP_TIME, chartWorkbook, chartXml } from "./chart";
import { NS, SLIDE, XML_HEAD, esc, fill, spTree, type Refs } from "./drawingml";
import { sceneOf, type El, type ShapeEl, type SlideSem } from "./scene";

export interface PptxInput {
  slides: { nodes: DisplayList; sem: SlideSem | null }[];
  /** picture bytes by display-list image id (PNG or JPEG) */
  image(id: string): Uint8Array | undefined;
  /** the font name PowerPoint is given for a CSS font list */
  face(css: string): string;
  title?: string;
  /** the design's name (the master's and the theme's) */
  design?: string;
  /** ISO time for docProps (omitted: none, so the same deck gives the same bytes) */
  created?: string;
}
type Kind = SlideSem["type"];
const LAYOUT: Record<Kind | "blank", { name: string; type: string }> = {
  cover: { name: "Title Slide", type: "title" }, index: { name: "Contents", type: "titleOnly" }, content: { name: "Title Only", type: "titleOnly" }, blank: { name: "Blank", type: "blank" },
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.presentationml";
const ns = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const rels = (list: { id: string; type: string; target: string }[]) =>
  XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(r => `<Relationship Id="${r.id}" Type="${r.type.startsWith("http") ? r.type : REL + "/" + r.type}" Target="${esc(r.target)}"/>`).join("")}</Relationships>`;

/** a slide's background: a full-slide opaque rectangle or picture (the elements under it are hidden by it) */
const full = (b: { x: number; y: number; w: number; h: number }) => b.x <= .5 && b.y <= .5 && b.x + b.w >= 1599.5 && b.y + b.h >= 899.5;
function bgOf(el: El): { fill: string } | { image: string } | null {
  if (el.k === "sp" && !el.text && !el.ph && !el.rot && "prst" in el.geom && el.geom.prst === "rect" && full(el.box) && !el.line && !el.outer && el.fill && "solid" in el.fill && (el.fill.a ?? 1) >= .999)
    return { fill: fill(el.fill, el.box.w, el.box.h) };
  if (el.k === "pic" && !el.crop && !el.geom && !el.rot && !el.alpha && full(el.box)) return { image: el.image };
  return null;
}
/** what is placed once on a layout instead of on each slide: plain shapes and pictures, never text or content */
const decor = (el: El) => (el.k === "sp" && !el.text && !el.ph) || el.k === "pic";
const keyOf = (el: El) => JSON.stringify(el);

export function writePptx(input: PptxInput): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const media = new Map<string, string>();            // content hash → part name
  const mediaOf = new Map<string, string>();          // image id → part name
  const partOfImage = (id: string): string | null => {
    if (mediaOf.has(id)) return mediaOf.get(id)!;
    let b = input.image(id);
    if (!b || !(isPng(b) || isJpeg(b))) return null;
    // (bytes of another realm – a test's – are copied: the zip takes this realm's Uint8Array only)
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    const h = sha1(b);
    let name = media.get(h);
    if (!name) { name = `image${media.size + 1}.${isPng(b) ? "png" : "jpeg"}`; media.set(h, name); files["ppt/media/" + name] = b; }
    mediaOf.set(id, name);
    return name;
  };
  const has = (id: string) => partOfImage(id) !== null;

  // every slide's scene, its background and the layout it uses
  const scenes = input.slides.map(s => {
    const kind: Kind = s.sem?.type ?? "content";
    let els = sceneOf(s.nodes, s.sem, has);
    // the background: the topmost opaque full-slide element among the first full-slide ones
    let bg: ReturnType<typeof bgOf> = null, cut = 0;
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.k === "grp" || e.k === "tbl" || e.k === "chart" || !full(e.box)) break;
      const b = bgOf(e); if (b) { bg = b; cut = i + 1; }
      else if (!(e.k === "sp" && !e.text)) break;
    }
    els = els.slice(cut);
    return { kind, els, bg };
  });
  const kinds = [...new Set(scenes.map(s => s.kind))];
  const bgKey = (b: ReturnType<typeof bgOf>) => JSON.stringify(b);
  // each layout: the background all its slides share, the decoration they all begin with (two slides or more)
  const layouts = kinds.map(kind => {
    const S = scenes.filter(s => s.kind === kind);
    const bg = S.every(s => bgKey(s.bg) === bgKey(S[0].bg)) ? S[0].bg : null;
    let common: El[] = [];
    if (S.length > 1) {
      const first = S[0].els;
      let n = 0;
      while (n < first.length && decor(first[n]) && S.every(s => s.els[n] && keyOf(s.els[n]) === keyOf(first[n]))) n++;
      common = first.slice(0, n);
    }
    // the placeholders' frames: where this kind of slide has them
    const ph: Partial<Record<string, ShapeEl>> = {};
    for (const s of S) for (const e of s.els) if (e.k === "sp" && e.ph && !ph[e.ph]) ph[e.ph] = e;
    return { kind, bg, common, ph, n: common.length };
  });
  const master = layouts.find(l => l.kind === "content") ?? layouts[0];
  const masterBg = master?.bg ?? null;

  // the theme: the design's colours (its chart palette as accents) and fonts (titles' and body text's)
  const faces = new Map<string, number>(), titleFaces = new Map<string, number>();
  const count = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) || 0) + n);
  const visit = (els: El[]) => { for (const e of els) {
    if (e.k === "grp") visit(e.children);
    else if (e.k === "sp" && e.text) for (const p of e.text.paras) for (const r of p.runs) count(e.ph === "title" || e.ph === "ctrTitle" ? titleFaces : faces, input.face(r.css), r.text.length);
    else if (e.k === "tbl") for (const row of e.cells) for (const c of row) for (const p of c.text?.paras || []) for (const r of p.runs) count(faces, input.face(r.css), r.text.length);
  } };
  scenes.forEach(s => visit(s.els));
  const top = (m: Map<string, number>, d: string) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || d;
  const minor = top(faces, "Arial"), major = top(titleFaces, minor);
  const palette = (input.slides.find(s => s.sem?.palette?.length)?.sem?.palette || []).filter(c => /^#[0-9A-Fa-f]{6}$/.test(c));
  const accents = [...palette, "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"].slice(0, 6);
  const titleColour = (() => { for (const s of scenes) for (const e of s.els) if (e.k === "sp" && (e.ph === "title" || e.ph === "ctrTitle") && e.text?.paras[0]?.runs[0]) return e.text.paras[0].runs[0].color; return [0, 0, 0] as [number, number, number]; })();
  const hexOf = (c: number[]) => c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  const bgColour = masterBg && "fill" in masterBg ? /val="([0-9A-F]{6})"/.exec(masterBg.fill)?.[1] || "FFFFFF" : "FFFFFF";
  const design = input.design || "Slide Builder";
  files["ppt/theme/theme1.xml"] = strToU8(themeXml(design, { dk2: hexOf(titleColour), lt2: bgColour, accents: accents.map(c => c.slice(1).toUpperCase()) }, major, minor));

  // the master and its layouts (each layout its own relationships: the master, its pictures)
  const refsFor = (relList: { id: string; type: string; target: string }[]): Refs => {
    const byImage = new Map<string, string>();
    return {
      image: id => {
        const part = partOfImage(id); if (!part) return null;
        let rid = byImage.get(part);
        if (!rid) { rid = "rId" + (relList.length + 1); relList.push({ id: rid, type: "image", target: "../media/" + part }); byImage.set(part, rid); }
        return rid;
      },
      chart: () => { throw new Error("a chart on a master or layout"); },
      face: input.face,
    };
  };
  const bgXml = (b: ReturnType<typeof bgOf>, refs: Refs) => !b ? "" : "fill" in b ? `<p:bg><p:bgPr>${b.fill}<a:effectLst/></p:bgPr></p:bg>`
    : `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${refs.image(b.image)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
  const allLayouts = [...layouts.map(l => ({ ...l, blank: false })), { kind: "blank" as const, bg: null, common: [] as El[], ph: {} as Partial<Record<string, ShapeEl>>, n: 0, blank: true }];
  const mRels: { id: string; type: string; target: string }[] = allLayouts.map((_, i) => ({ id: "rId" + (i + 1), type: "slideLayout", target: `../slideLayouts/slideLayout${i + 1}.xml` }));
  mRels.push({ id: "rId" + (mRels.length + 1), type: "theme", target: "../theme/theme1.xml" });
  const mRefs = refsFor(mRels);
  const titlePh = master?.ph.title ?? master?.ph.ctrTitle;
  const mTree = spTree([phTemplate("title", titlePh, { x: 80, y: 40, w: 1440, h: 90 }), phTemplate("body", undefined, { x: 80, y: 160, w: 1440, h: 640 }),
    phTemplate("ftr", master?.ph.ftr, { x: 530, y: 840, w: 540, h: 40 }), phTemplate("sldNum", master?.ph.sldNum, { x: 1360, y: 840, w: 160, h: 40 })], mRefs);
  files["ppt/slideMasters/slideMaster1.xml"] = strToU8(XML_HEAD + `<p:sldMaster ${ns}><p:cSld>${bgXml(masterBg ?? { fill: "<a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill>" }, mRefs)}${mTree}</p:cSld>`
    + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
    + `<p:sldLayoutIdLst>${allLayouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldLayoutIdLst>${txStyles()}</p:sldMaster>`);
  files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = strToU8(rels(mRels));
  allLayouts.forEach((L, i) => {
    const lRels = [{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }];
    const refs = refsFor(lRels), meta = LAYOUT[L.kind];
    const phs: El[] = L.blank ? [] : L.kind === "cover"
      ? [phTemplate("ctrTitle", L.ph.ctrTitle, { x: 120, y: 300, w: 1000, h: 200 }), phTemplate("subTitle", L.ph.subTitle, { x: 120, y: 520, w: 1000, h: 80 })]
      : [phTemplate("title", L.ph.title, { x: 80, y: 40, w: 1440, h: 90 })];
    if (L.ph.ftr) phs.push(phTemplate("ftr", L.ph.ftr, L.ph.ftr.box));
    if (L.ph.sldNum) phs.push(phTemplate("sldNum", L.ph.sldNum, L.ph.sldNum.box));
    const bg = L.bg && bgKey(L.bg) !== bgKey(masterBg) ? bgXml(L.bg, refs) : "";
    // the shared decoration first (under everything), then the placeholders' templates (not drawn on slides)
    files[`ppt/slideLayouts/slideLayout${i + 1}.xml`] = strToU8(XML_HEAD + `<p:sldLayout ${ns} type="${meta.type}" preserve="1"><p:cSld name="${meta.name}">${bg}${spTree([...L.common, ...phs], refs)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    files[`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`] = strToU8(rels(lRels));
  });

  // the slides
  let charts = 0;
  scenes.forEach((s, i) => {
    const li = layouts.findIndex(l => l.kind === s.kind), L = layouts[li];
    const sRels = [{ id: "rId1", type: "slideLayout", target: `../slideLayouts/slideLayout${li + 1}.xml` }];
    const refs = refsFor(sRels);
    refs.chart = el => {
      const n = ++charts, rid = "rId" + (sRels.length + 1);
      sRels.push({ id: rid, type: "chart", target: `../charts/chart${n}.xml` });
      files[`ppt/charts/chart${n}.xml`] = strToU8(chartXml(el.chart, "rId1", input.face));
      files[`ppt/charts/_rels/chart${n}.xml.rels`] = strToU8(rels([{ id: "rId1", type: "package", target: `../embeddings/Microsoft_Excel_Worksheet${n}.xlsx` }]));
      files[`ppt/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`] = chartWorkbook(el.chart);
      return rid;
    };
    const own = s.els.slice(L.n);
    const bg = bgKey(s.bg) !== bgKey(L.bg ?? masterBg) ? bgXml(s.bg ?? { fill: "<a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill>" }, refs) : "";
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(XML_HEAD + `<p:sld ${ns}><p:cSld>${bg}${spTree(own, refs)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(rels(sRels));
  });

  // the presentation and the package
  const n = scenes.length;
  const pRels = [{ id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    ...scenes.map((_, i) => ({ id: "rId" + (i + 2), type: "slide", target: `slides/slide${i + 1}.xml` })),
    { id: "rId" + (n + 2), type: "presProps", target: "presProps.xml" }, { id: "rId" + (n + 3), type: "viewProps", target: "viewProps.xml" },
    { id: "rId" + (n + 4), type: "theme", target: "theme/theme1.xml" }, { id: "rId" + (n + 5), type: "tableStyles", target: "tableStyles.xml" }];
  files["ppt/presentation.xml"] = strToU8(XML_HEAD + `<p:presentation ${ns} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${scenes.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${SLIDE.cx}" cy="${SLIDE.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  files["ppt/_rels/presentation.xml.rels"] = strToU8(rels(pRels));
  files["ppt/presProps.xml"] = strToU8(XML_HEAD + `<p:presentationPr ${ns}/>`);
  files["ppt/viewProps.xml"] = strToU8(XML_HEAD + `<p:viewPr ${ns}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  files["ppt/tableStyles.xml"] = strToU8(XML_HEAD + `<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  files["docProps/core.xml"] = strToU8(XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(input.title || "")}</dc:title><dc:creator>Slide Builder</dc:creator>${input.created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${esc(input.created)}</dcterms:created>` : ""}</cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(XML_HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Slide Builder</Application><Slides>${n}</Slides><PresentationFormat>Widescreen</PresentationFormat></Properties>`);
  files["_rels/.rels"] = strToU8(rels([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" }, { id: "rId3", type: "extended-properties", target: "docProps/app.xml" }]));
  const over = (part: string, type: string) => `<Override PartName="/${part}" ContentType="${type}"/>`;
  const parts = Object.keys(files);
  files["[Content_Types].xml"] = strToU8(XML_HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`
    + over("ppt/presentation.xml", CT + ".presentation.main+xml") + over("ppt/slideMasters/slideMaster1.xml", CT + ".slideMaster+xml")
    + parts.filter(p => /^ppt\/slideLayouts\/[^/]+\.xml$/.test(p)).map(p => over(p, CT + ".slideLayout+xml")).join("")
    + parts.filter(p => /^ppt\/slides\/[^/]+\.xml$/.test(p)).map(p => over(p, CT + ".slide+xml")).join("")
    + parts.filter(p => /^ppt\/charts\/[^/]+\.xml$/.test(p)).map(p => over(p, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml")).join("")
    + over("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml") + over("ppt/presProps.xml", CT + ".presProps+xml") + over("ppt/viewProps.xml", CT + ".viewProps+xml")
    + over("ppt/tableStyles.xml", CT + ".tableStyles+xml") + over("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml") + over("docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml") + `</Types>`);
  // fixed times: the same slides give the same bytes; pictures are stored as they are (already compressed)
  const mtime = ZIP_TIME;
  const zipped: Record<string, [Uint8Array, { level: 0 | 6; mtime: Date }]> = {};
  for (const name of ["[Content_Types].xml", ...parts.filter(p => p !== "[Content_Types].xml")]) zipped[name] = [files[name], { level: /^ppt\/(media|embeddings)\//.test(name) ? 0 : 6, mtime }];
  return zipSync(zipped);
}

/** a placeholder's template on the master or a layout: the frame of the slides' own (or a default one), its text style
    from the slides' first run */
function phTemplate(type: NonNullable<ShapeEl["ph"]>, from: ShapeEl | undefined, box: { x: number; y: number; w: number; h: number }): ShapeEl {
  const name = ({ title: "Title", ctrTitle: "Title", subTitle: "Subtitle", body: "Text Placeholder", ftr: "Footer", sldNum: "Slide Number" } as Record<string, string>)[type] || "Placeholder";
  return { k: "sp", box: from?.box ?? box, geom: { prst: "rect" }, fill: null, name, ph: type as NonNullable<ShapeEl["ph"]>,
    text: { paras: [], anchor: from?.text?.anchor ?? "t", ins: from?.text?.ins ?? [0, 0, 0, 0], wrap: true } };
}

function txStyles(): string {
  const lvl = (n: number, sz: number, font: string) => `<a:lvl${n}pPr marL="0" indent="0" algn="l"><a:buNone/><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="${font}"/><a:ea typeface="+mn-ea"/><a:cs typeface="${font}"/></a:defRPr></a:lvl${n}pPr>`;
  return `<p:txStyles><p:titleStyle>${lvl(1, 3600, "+mj-lt")}</p:titleStyle><p:bodyStyle>${[1, 2, 3].map(n => lvl(n, 1800, "+mn-lt")).join("")}</p:bodyStyle><p:otherStyle>${lvl(1, 1400, "+mn-lt")}</p:otherStyle></p:txStyles>`;
}

function themeXml(name: string, c: { dk2: string; lt2: string; accents: string[] }, major: string, minor: string): string {
  const s = (tag: string, v: string) => `<a:${tag}><a:srgbClr val="${v}"/></a:${tag}>`;
  const fillStyles = `<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>`;
  const lnStyles = `<a:lnStyleLst>${[6350, 12700, 19050].map(w => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join("")}</a:lnStyleLst>`;
  const fx = `<a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst>`;
  return XML_HEAD + `<a:theme xmlns:a="${NS.a}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}">${s("dk1", "000000").replace("srgbClr val=\"000000\"", "sysClr val=\"windowText\" lastClr=\"000000\"")}${s("lt1", "FFFFFF").replace("srgbClr val=\"FFFFFF\"", "sysClr val=\"window\" lastClr=\"FFFFFF\"")}`
    + `${s("dk2", c.dk2)}${s("lt2", c.lt2)}${c.accents.map((v, i) => s("accent" + (i + 1), v)).join("")}${s("hlink", "0563C1")}${s("folHlink", "954F72")}</a:clrScheme>`
    + `<a:fontScheme name="${esc(name)}"><a:majorFont><a:latin typeface="${esc(major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="${esc(name)}">${fillStyles}${lnStyles}${fx}<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}
