/* Text of display lists made ready for the PDF writer: every text node without a glyph run is shaped with HarfBuzz
   from its face's file (kern, liga, mark offsets), the difference to the width the screen measured spread between
   its clusters, so the PDF's glyphs sit where the screen's do and the writer only places them. A variable face (a
   Windows font such as Segoe UI Variable, or a library font with an optical-size axis) is first made static as the
   screen draws it and added to the registry, so the PDF never embeds a variable font: wght at the library face's
   declared weight (its @font-face has one value, which Chrome pins wght to; bold beyond it is synthetic) or, for a
   Windows font, the run's weight; opsz at the run's size (font-optical-sizing: auto); every other axis default. */
import { weightOf, type DisplayList, type Node } from "../dl/types";
import { FontRegistry, type FaceInfo } from "./fonts";
import { shaper } from "./shape";
import { hbSubsetter, instanceFont } from "./subset";
import { fvarAxes } from "./static";

export async function prepareTextForPdf(pages: DisplayList[], fonts: FontRegistry): Promise<DisplayList[]> {
  const s = await shaper();
  // the static faces the pages need, made first (instancing is asynchronous: hb-subset loads once)
  const want = new Map<string, { face: FaceInfo; pin: Record<string, number>; key: string }>();
  const pinFor = (f: FaceInfo, n: Node & { t: "text" }) => {
    const axes = fvarAxes(f.data), pin: Record<string, number> = {};
    if (axes.some(a => a.tag === "wght")) pin.wght = f.source === "library" ? f.weight : weightOf(n);
    if (axes.some(a => a.tag === "opsz")) pin.opsz = n.size;
    return pin;
  };
  const instKey = (f: FaceInfo, pin: Record<string, number>) => `${f.family}|${f.italic ? "i" : ""}|${f.id}|${JSON.stringify(pin)}`;
  const made = new Map<string, FaceInfo>();
  const scan = (n: Node) => {
    if (n.t === "group") n.children.forEach(scan);
    else if (n.t === "text" && n.src && !n.gids) {
      const f = fonts.match(n.font, weightOf(n), !!n.i);
      if (f?.variable) { const pin = pinFor(f, n), key = instKey(f, pin); want.set(key, { face: f, pin, key }); }
    }
  };
  pages.forEach(p => p.forEach(scan));
  if (want.size) {
    const hb = await hbSubsetter();
    for (const { face, pin, key } of want.values())
      made.set(key, new FontRegistry().add(instanceFont(hb, face.data, pin), { family: face.family, weight: face.weight, italic: face.italic, source: face.source, file: face.file })[0]);
  }
  // each run is shaped with its own static instance; the writer finds it by the instance's family key
  const resolve = (n: Node & { t: "text" }) => {
    const f = fonts.match(n.font, weightOf(n), !!n.i);
    if (!f?.variable) return { face: f, node: n };
    const inst = made.get(instKey(f, pinFor(f, n)))!, alias = `${f.family}#${inst.id.slice(0, 10)}`;
    fonts.add(inst.data, { family: alias, weight: weightOf(n), italic: !!n.i, source: f.source, file: f.file });
    return { face: inst, node: { ...n, font: alias } };
  };
  const visit = (n: Node): Node => {
    if (n.t === "group") return { ...n, children: n.children.map(visit) };
    if (n.t !== "text" || n.gids || !n.src) return n;
    const { face, node } = resolve(n);
    if (!face) return n;                                   // the writer reports the missing font
    return s.shapeNode(face, node);
  };
  return pages.map(p => p.map(visit));
}
