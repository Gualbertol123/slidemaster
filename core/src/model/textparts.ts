/* Text parts, layout and offsets of an item (B56, 4.14; ADR-015 amendment of 2026-10-23): every text of a KPI card and of
   a chart card gets the deck's one text-style shape (TextFmt: font, size in slide px, colour, bold, italic, alignment,
   caps), and the parts inside the box their size and place.
   * `texts` – a map part → TextFmt, merged per part by item.patch (two writers on two parts both keep theirs). A part
     without an entry keeps exactly the look it had before 4.14. Texts that already had a format of their own keep it
     there: a chart's title (`titleFmt`), its axes' tick and category labels (`axes[a].fmt`), a series' data labels
     (`sers[s].labels.fmt`), a reference line's, gap arrow's or pills' labels (`marks[m].fmt`), all labels (`fmt`).
   * `lay` – a map setting → value (a number, a word or a switch), merged per setting: the KPI card's value alignment
     (vertical), the divider's place and switch, the header bar's height and switch, the rows' spacing and place, the
     padding; the chart card's stats and momentum rows (alignment, chip width), the tag's place, the spacing between the
     header, the plot and the footer, and the plot's margins.
   * `offs` – a map part → offset from where the layout puts it, as fractions of the item's box (as B53's `nudge`):
     a KPI card's value ("kv") and rows ("kr"), a chart card's stat chips ("st:<id>"), momentum chips ("mo:<id>"), the
     momentum label ("mh") and the tag ("tag").
   Every value is read through the clamps here: an item's maps are merged without checks (another writer, a later page).
   Pure. */
import type { TextFmt } from "./types";

/** a KPI card's texts: the header's title, the big value, each row's change (delta %) and its label */
export const KPI_PARTS = ["head", "value", "delta", "label"] as const;
/** a chart card's texts that had no format of their own: the legend, a stat chip's label and value, the tag, a momentum
    chip's change and caption, the momentum row's label word, the subtitle under the title (B55) */
export const CARD_PARTS = ["legend", "statLabel", "statValue", "tag", "momVal", "momCap", "momHead", /* B55's subtitle line */ "sub"] as const;
export type KpiPart = typeof KPI_PARTS[number];
export type CardPart = typeof CARD_PARTS[number];
export type TextPart = KpiPart | CardPart;
export type TextParts = Partial<Record<TextPart, TextFmt>>;

/** a KPI card's layout (every key optional: unset = as before 4.14) */
export interface KpiLay {
  /** the value's vertical place in its section (its horizontal one is texts.value.align) */ valign?: "top" | "middle" | "bottom";
  /** where the divider splits the body: the value section's width, % of the card (10–90; default 36) */ split?: number;
  /** false: no divider line (the split stays) */ div?: boolean;
  /** false: no header bar – the title stays, on the card */ bar?: boolean;
  /** the header bar's height, px (8–200; default from the card's height) */ headH?: number;
  /** the rows: spread over the body (default) or a block at its top, middle or bottom */ rows?: "spread" | "top" | "middle" | "bottom";
  /** the space between two rows of a block, px (0–80; default 4) */ rowGap?: number;
  /** the padding inside the card, px (0–80; default from the card's width) */ pad?: number }
/** a chart card's layout */
export interface CardLay {
  /** the stats row: chips from the left (default, as before), centred as a group, or spread to both edges */ stats?: "left" | "center" | "spread";
  /** a stat chip's width, % of the chart (5–100; unset: a third of the row on the left, each chip's own width else) */ statW?: number;
  /** the momentum row, as the stats row */ moms?: "left" | "center" | "spread"; momW?: number;
  /** the tag: in the title line's right corner (default) or on a line of its own under the title */ tag?: "right" | "below";
  /** the space under the title, px (0–80; default 8); above the plot (after the stats row, 0–120; default 10); between the
      plot and the momentum row (0–120; default 14) */ gapH?: number; gapP?: number; gapF?: number;
  /** the plot's margins inside the chart, px (0–400 each; default 0) */ padL?: number; padR?: number; padT?: number; padB?: number }
export type ItemLay = KpiLay & CardLay;
export type Offs = Record<string, { dx: number; dy: number }>;

const HEX = /^#[0-9A-Fa-f]{6}$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** a part's format, if it has one (an object) */
export function partFmt(it: { texts?: unknown }, part: TextPart): TextFmt | undefined {
  const T = isObj(it.texts) ? it.texts : null, f = T && Object.prototype.hasOwnProperty.call(T, part) ? T[part] : null;
  return isObj(f) ? f as TextFmt : undefined;
}
/** a format's own size, px (6–150), or undefined */
export function fmtSize(f: TextFmt | undefined, max = 150): number | undefined {
  const n = f ? +(f.size as number) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.max(6, Math.min(max, n)) : undefined;
}
export const fmtColor = (f: TextFmt | undefined): string | undefined => f && HEX.test(f.color || "") ? f.color!.toUpperCase() : undefined;
export const fmtAlign = (f: TextFmt | undefined): "left" | "center" | "right" | undefined => f && (f.align === "left" || f.align === "center" || f.align === "right") ? f.align : undefined;
/** a layout number, clamped (undefined: unset or not a number) */
export function layNum(it: { lay?: unknown }, key: string, min: number, max: number): number | undefined {
  const L = isObj(it.lay) ? it.lay : null, v = L && Object.prototype.hasOwnProperty.call(L, key) ? +(L[key] as number) : NaN;
  return L && L[key] !== null && L[key] !== "" && typeof L[key] !== "boolean" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined;
}
/** a layout word among `of` (undefined: unset or another) */
export function layWord<T extends string>(it: { lay?: unknown }, key: string, of: readonly T[]): T | undefined {
  const L = isObj(it.lay) ? it.lay : null, v = L && Object.prototype.hasOwnProperty.call(L, key) ? L[key] : undefined;
  return typeof v === "string" && (of as readonly string[]).includes(v) ? v as T : undefined;
}
/** a layout switch: false only when it is false */
export const layOff = (it: { lay?: unknown }, key: string) => isObj(it.lay) && it.lay[key] === false;
/** a part's offset in px of `unit` (fractions clamped to ±1; unset or broken: none) */
export function offOf(it: { offs?: unknown }, key: string, unit: { w: number; h: number }): { x: number; y: number } {
  const O = isObj(it.offs) ? it.offs : null, o = O && Object.prototype.hasOwnProperty.call(O, key) ? O[key] : null;
  if (!isObj(o)) return { x: 0, y: 0 };
  const f = (v: unknown) => Number.isFinite(+(v as number)) ? Math.max(-1, Math.min(1, +(v as number))) : 0, r2 = (v: number) => Math.round(v * 100) / 100 || 0;
  return { x: r2(f(o.dx) * unit.w), y: r2(f(o.dy) * unit.h) };
}
/** whether an offset key is one of `offs` (else a chart label's B53 `nudge`) */
export const isOffKey = (key: string) => key === "kv" || key === "kr" || key === "tag" || key === "mh" || key.startsWith("st:") || key.startsWith("mo:");
