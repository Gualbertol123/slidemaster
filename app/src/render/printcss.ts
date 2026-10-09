/* Slides made light for PDF: Chrome prints anything it cannot draw as vector shapes as a 300 dpi picture
   (soft box-shadows become huge greyscale masks, one per card) and embeds variable fonts glyph by glyph
   (Type 3: slow in Acrobat, large). Before an export the slide CSS and HTML go through printReady():
   - every blurred shadow becomes a few sharp-edged layers of fading strength – vector, nearly the same look;
   - variable font families ("Segoe UI Variable …") give way to the classic ones next in the list;
   - the glass rim (a gradient ring cut out with a CSS mask) becomes a border shaded per side (PRINT_CSS). */

const STEPS = 5, REACH = .6;
/** split at commas outside brackets */
function layers(v: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of v) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const LEN = /^-?(\d+\.?\d*|\.\d+)(px)?$/;
/** one box-shadow value with its blurred layers replaced by STEPS sharp ones (blur 0 is drawn as vector) */
export function vectorShadow(value: string): string {
  if (/^\s*(none|inherit|initial|unset|var\()/.test(value)) return value;
  const imp = /\s*!important\s*$/.exec(value);
  if (imp) return vectorShadow(value.slice(0, imp.index)) + " !important";
  const out: string[] = [];
  for (const layer of layers(value)) {
    // tokens outside brackets: [inset] x y [blur [spread]] color
    const toks: string[] = []; let depth = 0, cur = "";
    for (const ch of layer) {
      if (ch === "(") depth++; else if (ch === ")") depth--;
      if (/\s/.test(ch) && depth === 0) { if (cur) toks.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) toks.push(cur);
    const inset = toks.includes("inset"), lens = toks.filter(t => LEN.test(t)), color = toks.filter(t => t !== "inset" && !LEN.test(t)).join(" ");
    const blur = parseFloat(lens[2] || "0"), spread = parseFloat(lens[3] || "0");
    if (lens.length < 2 || !color || !(blur > .5)) { out.push(layer); continue; }
    const x = parseFloat(lens[0]), y = parseFloat(lens[1]);
    // the blur spreads the edge over ±blur/2, but its outer half is faint: layer k reaches out to its own
    // distance within ±REACH·blur/2; together they fall off linearly, each with 1/STEPS of the colour
    for (let k = 0; k < STEPS; k++) {
      const s = spread + blur * REACH * ((k + 1) / STEPS - .5);
      const px = (n: number) => (Math.round(n * 100) / 100) + "px";
      out.push(`${inset ? "inset " : ""}${px(x)} ${px(y)} 0 ${px(s)} color-mix(in srgb, ${color} ${100 / STEPS}%, transparent)`);
    }
  }
  return out.join(",");
}

const VARIABLE_FONTS = /\s*(["'])(Segoe UI Variable (Display|Text|Small)|SF Pro (Display|Text))\1\s*,/g;
/** the slide CSS or slide HTML, ready for a light vector PDF (see above) */
export function printReady(text: string): string {
  return text.replace(/box-shadow:([^;}"]+)/g, (_m, v: string) => "box-shadow:" + vectorShadow(v)).replace(VARIABLE_FONTS, "");
}

/** added after the slide CSS for vector PDFs */
export const PRINT_CSS = ".gls::before{-webkit-mask:none!important;mask:none!important;padding:0!important;background:none!important;box-sizing:border-box;"
  + "border:var(--rim,1.25px) solid;border-color:rgba(255,255,255,calc(.55 + .45*var(--gi))) rgba(255,255,255,calc(.16*var(--gi))) "
  + "rgba(255,255,255,calc(.35 + .55*var(--gi))) rgba(255,255,255,calc(.6*var(--gi)))}";
