/* Pictures in cells: Excel 365's "Place in Cell" and the IMAGE function. Such a cell is written as an error cell
   (<c t="e" vm="n"><v>#VALUE!</v></c>); its picture is found through the workbook's parts:
     vm (1-based) → metadata.xml <valueMetadata> block → its <rc t v>: type t (1-based, XLRICHVALUE) and block v of
     <futureMetadata name="XLRICHVALUE"> → its <xlrd:rvb i> → rich value i of richData/rdrichvalue.xml, whose <v>s are
     the keys of its structure (richData/rdrichvaluestructure.xml, <s t><k n>) in order →
       a placed picture (_localImage): _rvRel:LocalImageIdentifier, a relationship of richData/richValueRel.xml;
       an IMAGE result (_webimage): WebImageIdentifier, a <webImageSrd> of richData/rdRichValueWebImage.xml whose
       <blip r:id> is the picture Excel kept (its <address> the URL it came from), with ImageSizing, ImageHeight,
       ImageWidth;
     both with Text, the picture's alternative text.
   The parts are read once per workbook. An .xlsb keeps them in binary parts: not read (its pictures in cells show
   their error value, as before). Laid out in their cells by layout.ts (cellPicBox). */
import type { Zip } from "./zip";
import { pictureSrc } from "./drawing";
import { A1, all, kid, kids, parseXml, readRels, resolvePath, zget, NS_R, type Rel } from "./util";
import type { CellPic } from "./types";
import type { XmlElement } from "../platform";

/** a picture of the workbook's rich values: as CellPic without its cell */
type RichPic = Omit<CellPic, "r" | "c" | "name"> & { alt: string };

const BY_ZIP = new WeakMap<Zip, Promise<(RichPic | null)[]>>();

/** the pictures in cells of a sheet: `vms` are its cells with value metadata ([row, column, vm], sheetstore.ts) */
export async function readCellPics(zip: Zip, vms: [number, number, number][]): Promise<CellPic[]> {
  if (!vms.length) return [];
  let p = BY_ZIP.get(zip);
  if (!p) { p = readRichPics(zip).catch(() => []); BY_ZIP.set(zip, p); }
  const pics = await p, out: CellPic[] = [];
  for (const [r, c, vm] of vms) {
    const q = pics[vm - 1]; if (!q) continue;
    const { alt, ...pic } = q;
    out.push({ r, c, name: alt || "Picture in " + A1(r, c), ...pic });
  }
  return out;
}

/** the workbook part's path (from _rels/.rels) */
async function workbookPath(zip: Zip): Promise<string> {
  const rels = await readRels(zip, "");
  const r = Object.values(rels).find(x => /\/officeDocument$/.test(x.type));
  return r && zget(zip, r.target) ? r.target : zget(zip, "xl/workbook.bin") ? "xl/workbook.bin" : "xl/workbook.xml";
}
const xmlOf = async (zip: Zip, path: string | undefined) => { const f = zget(zip, path); return f ? parseXml(await f.async("string")) : null; };
const rid = (el: XmlElement | null) => el ? el.getAttributeNS(NS_R, "id") || el.getAttribute("r:id") || "" : "";

/** per value metadata block (vm − 1): its picture, null when it is not one */
async function readRichPics(zip: Zip): Promise<(RichPic | null)[]> {
  const wb = await workbookPath(zip), wbRels = Object.values(await readRels(zip, wb));
  /** a workbook part by its relationship type, else where Excel writes it */
  const part = (type: RegExp, path: string) => wbRels.find(x => type.test(x.type))?.target ?? resolvePath(wb, path);
  const meta = await xmlOf(zip, part(/\/sheetMetadata$/, "metadata.xml"));
  if (!meta) return [];
  // value metadata blocks → rich value indexes
  const types = kids(kid(meta.documentElement, "metadataTypes"), "metadataType").map(t => t.getAttribute("name") || "");
  const future = kids(meta.documentElement, "futureMetadata").find(f => f.getAttribute("name") === "XLRICHVALUE");
  const rvOf = kids(future, "bk").map(bk => { const i = all(bk, "rvb")[0]?.getAttribute("i"); return i == null ? -1 : +i; });
  const blocks = kids(kid(meta.documentElement, "valueMetadata"), "bk").map(bk => {
    const rc = kid(bk, "rc"); if (!rc) return -1;
    return types[+(rc.getAttribute("t") || 0) - 1] === "XLRICHVALUE" ? rvOf[+(rc.getAttribute("v") || 0)] ?? -1 : -1;
  });
  if (!blocks.some(i => i >= 0)) return [];
  const [values, structs, relX, webX] = await Promise.all([
    xmlOf(zip, part(/\/rdRichValue$/, "richData/rdrichvalue.xml")),
    xmlOf(zip, part(/\/rdRichValueStructure$/, "richData/rdrichvaluestructure.xml")),
    xmlOf(zip, part(/\/richValueRel$/, "richData/richValueRel.xml")),
    xmlOf(zip, part(/\/rdRichValueWebImage$/, "richData/rdRichValueWebImage.xml")),
  ]);
  if (!values || !structs) return [];
  const sdefs = kids(structs.documentElement, "s").map(s => ({ t: s.getAttribute("t") || "", keys: kids(s, "k").map(k => k.getAttribute("n") || "") }));
  const relPath = part(/\/richValueRel$/, "richData/richValueRel.xml"), webPath = part(/\/rdRichValueWebImage$/, "richData/rdRichValueWebImage.xml");
  const [relRels, webRels] = await Promise.all([relX ? readRels(zip, relPath) : {}, webX ? readRels(zip, webPath) : {}]) as Record<string, Rel>[];
  const localRels = relX ? kids(relX.documentElement, "rel").map(rid) : [];
  const webImages = webX ? kids(webX.documentElement, "webImageSrd").map(w => ({ blip: rid(kid(w, "blip")), address: rid(kid(w, "address")) })) : [];
  const rvs = kids(values.documentElement, "rv");
  const pics = new Map<number, Promise<RichPic | null>>();
  const picOf = (i: number) => { let p = pics.get(i); if (!p) { p = richPic(rvs[i]); pics.set(i, p); } return p; };
  async function richPic(rv: XmlElement | undefined): Promise<RichPic | null> {
    const sd = rv && sdefs[+(rv.getAttribute("s") || 0)]; if (!sd) return null;
    const vals: Record<string, string> = {};
    kids(rv, "v").forEach((v, k) => { if (sd.keys[k]) vals[sd.keys[k]] = v.textContent || ""; });
    let rel: Rel | undefined, linked = false;
    if (sd.t === "_localImage" && vals["_rvRel:LocalImageIdentifier"] !== undefined) rel = relRels[localRels[+vals["_rvRel:LocalImageIdentifier"]]];
    else if (sd.t === "_webimage" && vals.WebImageIdentifier !== undefined) {
      const w = webImages[+vals.WebImageIdentifier]; rel = w && webRels[w.blip]; linked = !!w && !rel;
    } else return null;
    const sizing = (+vals.ImageSizing || 0) as CellPic["sizing"];
    const base = { alt: vals.Text || "", sizing: sizing >= 0 && sizing <= 3 ? sizing : 0, iw: 0, ih: 0,
      ...(sizing === 3 ? { w: +vals.ImageWidth || 0, h: +vals.ImageHeight || 0 } : {}) } as RichPic;
    const file = rel && !rel.external ? zget(zip, rel.target) : null;
    if (!file) return { ...base, unsupported: linked ? "Picture not kept in the workbook" : "Picture not found" };
    const ext = (rel!.target.split(".").pop() || "").toLowerCase();
    const src = await pictureSrc(file, ext);
    if (!src) return { ...base, unsupported: ext.toUpperCase() + " picture" };
    const size = imageSize(await file.async("uint8array")) || imageSize(dataBytes(src));
    return { ...base, src, iw: size?.w || 0, ih: size?.h || 0 };
  }
  return Promise.all(blocks.map(i => i >= 0 ? picOf(i) : null));
}

/** a data URL's bytes (a converted picture is PNG) */
function dataBytes(src: string): Uint8Array {
  const k = src.indexOf(";base64,"); if (k < 0) return new Uint8Array(0);
  try { return Uint8Array.from(atob(src.slice(k + 8)), ch => ch.charCodeAt(0)); } catch { return new Uint8Array(0); }
}

/** a picture's size in pixels from its header (PNG, JPEG, GIF, BMP, WebP); null for anything else */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1], u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const l16 = (i: number) => b[i] | (b[i + 1] << 8), l24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16), l32 = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24));
  const ok = (w: number, h: number) => w > 0 && h > 0 ? { w, h } : null;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return ok(u32(16), u32(20));
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(l16(6), l16(8));
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4D) return ok(Math.abs(l32(18)), Math.abs(l32(22)));
  if (b.length >= 30 && u32(0) === 0x52494646 && u32(8) === 0x57454250) {             // RIFF … WEBP
    const kind = u32(12);
    if (kind === 0x56503820) return ok(l16(26) & 0x3FFF, l16(28) & 0x3FFF);           // "VP8 "
    if (kind === 0x5650384C) { const v = l32(21); return ok((v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1); }   // "VP8L"
    if (kind === 0x56503858) return ok(l24(24) + 1, l24(27) + 1);                     // "VP8X"
    return null;
  }
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
    // the first frame header (SOF0–SOF15 but DHT, JPG and DAC) after the segments before it
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return ok(u16(i + 7), u16(i + 5));
      i += 2 + u16(i + 2);
    }
  }
  return null;
}
