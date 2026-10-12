/* A static face of an uploaded variable font (PLAN S3.2): the wght axis at the weight the upload declares, every
   other axis at its default – what the browser draws for that @font-face today, so the screen does not change –
   and no variation tables left, so the PDF never embeds a variable font. Fonts that are not variable come back
   unchanged; so do files the core cannot read (WOFF2), which keep working on screen as before. */
import { sfntFaces } from "./fonts";
import { fvarAxes } from "./fvar";
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

export { fvarAxes } from "./fvar";
