/* What the core needs from its host and cannot do itself without a DOM (PLAN S2.1). The core never touches
   `document` or `window`: the page installs browser implementations (app/src/platform/), a worker installs
   its own (OffscreenCanvas), and without any the core falls back the way v3 did outside a page (Excel's
   default digit width of 7 px, no picture analysis, text boxes keep their size). */

/* ---- XML ---- (a DOM Element satisfies these; so will the core's own tokenizer tree, S2.2) */
export interface XmlElement {
  readonly localName: string;
  readonly textContent: string | null;
  /** child elements only (no text nodes), in document order */
  readonly children: ArrayLike<XmlElement>;
  getAttribute(name: string): string | null;
  getAttributeNS(ns: string | null, localName: string): string | null;
  /** every descendant element with this local name ("*" = any namespace), in document order */
  getElementsByTagNameNS(ns: string, localName: string): ArrayLike<XmlElement>;
}
export interface XmlDocument {
  readonly documentElement: XmlElement;
  readonly children: ArrayLike<XmlElement>;
  getElementsByTagNameNS(ns: string, localName: string): ArrayLike<XmlElement>;
}
export interface XmlParser { parse(xml: string): XmlDocument }

/* ---- text measurement ---- */
/** a text box as the slide draws it, to shrink its font until it fits (render/slide.ts fitNoteSize) */
export interface NoteMeasure {
  /** "glass" | "excel" | "clean": the slide's CSS that applies */
  design: string;
  className: string; cssText: string; html: string;
  /** the box, slide px */
  w: number; h: number;
}
export interface TextMeasurer {
  /** the widest of the digits 0–9 in px for a CSS font shorthand (Excel's "maximum digit width"); 0 = unknown */
  maxDigitWidth(cssFont: string): number;
  /** whether the text box's content fits its box at this font size */
  noteFits(note: NoteMeasure, size: number): boolean;
}

/* ---- canvas ---- */
export type Ctx2D = OffscreenCanvasRenderingContext2D;
export interface Surface {
  readonly ctx: Ctx2D;
  /** the surface itself, to draw it onto another */
  readonly image: CanvasImageSource;
  toDataURL(type: string, quality?: number): Promise<string>;
}
export interface DecodedImage { image: CanvasImageSource; width: number; height: number }
export interface CanvasFactory {
  /** a w × h surface with a 2D context, or null when the host cannot make one */
  create(w: number, h: number, opts?: { willReadFrequently?: boolean }): Surface | null;
  /** decode a picture (a data: URL) for drawing */
  decode(src: string): Promise<DecodedImage>;
}

export interface Platform { text: TextMeasurer; canvas: CanvasFactory | null; xml: XmlParser | null }

const NONE: Platform = { text: { maxDigitWidth: () => 0, noteFits: () => true }, canvas: null, xml: null };
let current: Platform = NONE;
export const platform = (): Platform => current;
/** install the host's implementations (the page at start-up, a worker when it starts, tests) */
export function setPlatform(p: Partial<Platform>) { current = { ...current, ...p }; }
export function resetPlatform() { current = NONE; }
