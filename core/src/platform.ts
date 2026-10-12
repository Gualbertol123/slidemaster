/* What the core needs from its host and cannot do itself without a DOM (PLAN S2.1). The core never touches
   `document` or `window`: the page installs browser implementations (app/src/platform/), a worker installs
   its own (OffscreenCanvas), and without any the core falls back the way v3 did outside a page (Excel's
   default digit width of 7 px, no picture analysis, text boxes keep their size). */

/* ---- XML ---- (the core's tokenizer tree implements these, and so does a DOM Element) */
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
/** the core reads XML with its own tokenizer (xlsx/xml.ts); only the equivalence test installs another (DOMParser):
    the page and the workers never set one */
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
/** a run of text in a CSS font shorthand ("italic 700 14.67px Calibri, Arial, sans-serif") */
export interface RunReq { text: string; font: string; /** font-variant-numeric: tabular-nums (Liquid Glass numbers) */ tnum?: boolean }
/** its advance and the font's ascent / descent (what CSS lays a line out with), px */
export interface RunMetrics { w: number; asc: number; desc: number; /** with tnum: each character's advance (one per code point) */ adv?: number[] }
/** a text wrapped at a width, as CSS white-space: normal with word-break: break-word does */
export interface NoteFitReq { note: NoteMeasure; start: number }
export interface LinesReq { text: string; font: string; width: number }
export interface TextMeasurer {
  /** the widest of the digits 0–9 in px for a CSS font shorthand (Excel's "maximum digit width"); 0 = unknown.
      In the core worker it is asked of the page (the page's fonts) */
  maxDigitWidth(cssFont: string): number | Promise<number>;
  /** whether the text box's content fits its box at this font size */
  noteFits(note: NoteMeasure, size: number): boolean;
  /** widths and metrics of runs, measured with the page's fonts (the display list's text until S4.4, decision
      2026-10-12, 3); in the core worker asked of the page, one call per measuring round of a table */
  measureRuns?(runs: RunReq[]): RunMetrics[] | Promise<RunMetrics[]>;
  /** the lines of wrapped texts, with the page's fonts; one call per measuring round of a table */
  breakLines?(reqs: LinesReq[]): string[][] | Promise<string[][]>;
  /** text boxes' font sizes as the page fits them (fitNoteSize over noteFits), one per request (S3.5) */
  fitNotes?(reqs: NoteFitReq[]): number[] | Promise<number[]>;
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

export interface Platform {
  text: TextMeasurer; canvas: CanvasFactory | null; /** null = the core's tokenizer */ xml: XmlParser | null;
  /** pictures analysed elsewhere (the core worker asks the page: a worker cannot decode SVG); else on `canvas` */
  images?: (srcs: string[]) => Promise<[string, import("./xlsx/drawing").ImgMeta][]>;
}

const NONE: Platform = { text: { maxDigitWidth: () => 0, noteFits: () => true }, canvas: null, xml: null };
let current: Platform = NONE;
export const platform = (): Platform => current;
/** install the host's implementations (the page at start-up, a worker when it starts, tests) */
export function setPlatform(p: Partial<Platform>) { current = { ...current, ...p }; }
export function resetPlatform() { current = NONE; }
