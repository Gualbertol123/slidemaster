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
/** a run of text in a CSS font shorthand ("italic 700 14.67px Calibri, Arial, sans-serif") */
export interface RunReq { text: string; font: string; /** font-variant-numeric: tabular-nums (Liquid Glass numbers) */ tnum?: boolean }
/** its advance and the font's ascent / descent (what CSS lays a line out with), px */
export interface RunMetrics { w: number; asc: number; desc: number; /** with tnum: each character's advance (one per code point) */ adv?: number[] }
/** a text wrapped at a width, as CSS white-space: normal with word-break: break-word does */
export interface LinesReq { text: string; font: string; width: number }
export interface TextMeasurer {
  /** the widest of the digits 0–9 in px for a CSS font shorthand (Excel's "maximum digit width"); 0 = unknown.
      In the core worker it is asked of the page (the page's fonts) */
  maxDigitWidth(cssFont: string): number | Promise<number>;
  /** widths and metrics of runs, measured with the page's fonts (the display list's text until S4.4, decision
      2026-10-12, 3); in the core worker asked of the page, one call per measuring round of a table */
  measureRuns?(runs: RunReq[]): RunMetrics[] | Promise<RunMetrics[]>;
  /** the lines of wrapped texts, with the page's fonts; one call per measuring round of a table */
  breakLines?(reqs: LinesReq[]): string[][] | Promise<string[][]>;
  /** the fonts changed (a library font added, fonts loaded): look for faces again (S4.4) */
  reset?(): void;
  /** a run's width at once, or null when its font is not at hand yet (S4.4: Liquid Glass's column widths, which the
      page's drags lay out too) */
  width?(text: string, font: string): number | null;
  /** have these CSS fonts at hand for width() (the core worker loads their files) */
  prepare?(fonts: string[]): Promise<void>;
  /** the per-font check of these CSS fonts (S4.4, 05 §3.4): which fonts the screen draws as outlines */
  check?(fonts: string[]): Promise<boolean>;
  /** whether those checks are done */
  checked?(fonts: string[]): boolean;
  /** a text node's glyph outlines when its font is drawn as outlines, else null */
  outlineRun?(n: import("./dl/types").TextNode): import("./dl/svg").OutlineRun | null;
  /** every font drawn as outlines (S4.4's SP switch) */
  outlineAll?: boolean;
  /** the fonts drawn as outlines, as a short name (part of the stage's keys) */
  outlineSig?(): string;
  /** called when a font that missed the measuring budget arrives (the host draws again with it) */
  onLate?: (() => void) | null;
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

const NONE: Platform = { text: { maxDigitWidth: () => 0 }, canvas: null, xml: null };
let current: Platform = NONE;
export const platform = (): Platform => current;
/** install the host's implementations (the page at start-up, a worker when it starts, tests) */
export function setPlatform(p: Partial<Platform>) { current = { ...current, ...p }; }
export function resetPlatform() { current = NONE; }
