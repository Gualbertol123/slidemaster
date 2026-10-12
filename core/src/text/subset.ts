/* hb-subset for the PDF writer (fonts subset per document, glyph ids retained so the content's CIDs stay the font's
   glyph ids) and for static instances of variable fonts (every axis pinned: no fvar / gvar / HVAR / avar left, so no
   PDF ever contains a variable font). Measured in spikes/fonts/subset_check.mjs. */
import type { PdfFontFace, SubsetFont } from "../pdf/writer";
import { decode64, Hb, hbTag, instantiate } from "./hb";

let loaded: Promise<Hb> | null = null;
/** hb-subset.wasm, loaded once */
export function hbSubsetter(): Promise<Hb> {
  return loaded ||= import("./wasm/hb-subset-wasm").then(m => instantiate(decode64(m.HB_SUBSET_WASM))).then(e => new Hb(e));
}

/* hb-subset.h */
const RETAIN_GIDS = 0x2, NOTDEF_OUTLINE = 0x40;
const SETS_DROP_TABLE_TAG = 3;
/** tables a PDF viewer never reads: layout, colour, bitmaps, signatures */
const DROP = ["GSUB", "GPOS", "GDEF", "BASE", "JSTF", "MATH", "kern", "morx", "mort", "kerx", "feat", "trak", "DSIG", "COLR", "CPAL", "SVG ", "sbix", "CBDT", "CBLC", "EBDT", "EBLC", "EBSC", "MERG", "meta", "STAT", "LTSH", "VDMX", "hdmx", "PCLT"];

export const sfntTables = (d: Uint8Array): string[] => {
  const n = (d[4] << 8) | d[5], out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String.fromCharCode(d[12 + 16 * i], d[13 + 16 * i], d[14 + 16 * i], d[15 + 16 * i]));
  return out;
};
export const VARIABLE_TABLES = ["fvar", "gvar", "HVAR", "VVAR", "MVAR", "avar", "cvar", "CFF2"];
export const isVariable = (d: Uint8Array) => sfntTables(d).some(t => VARIABLE_TABLES.includes(t));

function run(hb: Hb, data: Uint8Array, setup: (input: number, face: number) => void): Uint8Array | null {
  const blob = hb.blob(data), face = hb.fn("hb_face_create")(blob.ptr, 0), input = hb.fn("hb_subset_input_create_or_fail")();
  try {
    if (!input) return null;
    setup(input, face);
    const out = hb.fn("hb_subset_or_fail")(face, input);
    if (!out) return null;
    const ob = hb.fn("hb_face_reference_blob")(out), bytes = hb.blobBytes(ob);
    hb.fn("hb_blob_destroy")(ob); hb.fn("hb_face_destroy")(out);
    return bytes.length ? bytes : null;
  } finally {
    if (input) hb.fn("hb_subset_input_destroy")(input);
    hb.fn("hb_face_destroy")(face); blob.done();
  }
}

/** a font keeping only these glyphs (and .notdef), at their own glyph ids; TrueType or CFF as the font has it */
export function subsetFont(hb: Hb, data: Uint8Array, gids: Iterable<number>): SubsetFont | null {
  if (isVariable(data)) throw new Error("a variable font is instanced before it is embedded (instanceFont)");
  const bytes = run(hb, data, input => {
    const set = hb.fn("hb_subset_input_glyph_set")(input);
    hb.fn("hb_set_add")(set, 0);
    for (const g of gids) hb.fn("hb_set_add")(set, g);
    hb.fn("hb_subset_input_set_flags")(input, RETAIN_GIDS | NOTDEF_OUTLINE);
    const drop = hb.fn("hb_subset_input_set")(input, SETS_DROP_TABLE_TAG);
    for (const t of DROP) hb.fn("hb_set_add")(drop, hbTag(t));
  });
  if (!bytes) return null;
  const tables = sfntTables(bytes);
  return { data: bytes, outline: tables.includes("CFF ") ? "cff" : "truetype" };
}

/** a static instance of a variable font: every axis at its default, then the given ones (e.g. { wght: 700 });
    all glyphs and tables kept */
export function instanceFont(hb: Hb, data: Uint8Array, axes: Record<string, number> = {}): Uint8Array {
  if (!isVariable(data)) return data;
  const bytes = run(hb, data, (input, face) => {
    hb.fn("hb_subset_input_keep_everything")(input);
    if (!hb.fn("hb_subset_input_pin_all_axes_to_default")(input, face)) throw new Error("the font's axes cannot be pinned");
    for (const [axis, v] of Object.entries(axes))
      if (!hb.fn("hb_subset_input_pin_axis_location")(input, face, hbTag(axis.padEnd(4)), v)) throw new Error(`the font has no ${axis} axis`);
  });
  if (!bytes || isVariable(bytes)) throw new Error("the variable font could not be made static");
  return bytes;
}

/** the PDF writer's subset callback, once hb-subset is loaded (falls back to the writer's own subsetter on null) */
export async function pdfSubsetter(): Promise<(face: PdfFontFace, gids: number[]) => SubsetFont | null> {
  const hb = await hbSubsetter();
  return (face, gids) => subsetFont(hb, face.data, gids);
}
