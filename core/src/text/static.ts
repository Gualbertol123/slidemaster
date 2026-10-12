/* A static face of an uploaded variable font (PLAN S3.2): the wght axis at the weight the upload declares, every
   other axis at its default – what the browser draws for that @font-face today, so the screen does not change –
   and no variation tables left, so the PDF never embeds a variable font. Fonts that are not variable come back
   unchanged; so do files the core cannot read (WOFF2), which keep working on screen as before. */
import { sfntFaces } from "./fonts";
import { hbSubsetter, instanceFont, isVariable } from "./subset";

export async function staticFace(file: Uint8Array, weight: number): Promise<{ data: Uint8Array; variable: boolean }> {
  let faces: Uint8Array[];
  try { faces = sfntFaces(file); } catch { return { data: file, variable: false }; }
  if (faces.length !== 1 || !isVariable(faces[0])) return { data: file, variable: false };
  // the screen applies wght from the declared weight (one value: Chrome pins the axis to it), but also opsz from the
  // font size (font-optical-sizing: auto) and wdth / slnt / ital from font-stretch and font-style: a font with any
  // axis other than wght, whose default is not what the browser would pick, would look different once pinned. Such
  // a font is stored as it is (prepareTextForPdf instances it for the PDF as the screen draws it: wght at the
  // declared weight, opsz at the run's size)
  const axes = fvarAxes(faces[0]), browserDefault: Record<string, number> = { wdth: 100, slnt: 0, ital: 0 };
  if (axes.some(a => a.tag !== "wght" && !(a.tag in browserDefault && a.def === browserDefault[a.tag]))) return { data: file, variable: false };
  const hb = await hbSubsetter(), pin: Record<string, number> = {};
  if (axes.some(a => a.tag === "wght")) pin.wght = weight;
  return { data: instanceFont(hb, faces[0], pin), variable: true };
}

/** the axes of an fvar table: tag and default value */
export function fvarAxes(d: Uint8Array): { tag: string; def: number }[] {
  const n = (d[4] << 8) | d[5], out: { tag: string; def: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + 16 * i;
    if (String.fromCharCode(d[r], d[r + 1], d[r + 2], d[r + 3]) !== "fvar") continue;
    const at = ((d[r + 8] << 24) >>> 0) + (d[r + 9] << 16) + (d[r + 10] << 8) + d[r + 11];
    const axesAt = at + ((d[at + 4] << 8) | d[at + 5]), count = (d[at + 8] << 8) | d[at + 9], size = (d[at + 10] << 8) | d[at + 11];
    for (let k = 0; k < count; k++) {
      const p = axesAt + k * size, fixed = (o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) / 65536;
      out.push({ tag: String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]), def: fixed(p + 8) });
    }
  }
  return out;
}
