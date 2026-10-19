/* The slide designs: their ids (saved in Style.design), the names users see, and which are consulting designs
   (docs/next/08-consulting-designs.md, ADR-018). The ids "mckinsey" / "bain" are internal; users see neutral names. */
import type { Design, Style, TextFmt } from "./types";

export const DESIGNS: readonly Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
export const DESIGN_LABEL: Record<Design, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
export type ConsultDesign = "mckinsey" | "bain";
/** the consulting designs: one renderer (render/consult-dl.ts) with a spec each (render/consult-spec.ts) */
export const isConsult = (d: unknown): d is ConsultDesign => d === "mckinsey" || d === "bain";
/** the slide element's classes of a design (the consulting designs share Excel Refined's overlays) */
export const designClass = (d: Design) => d === "clean" ? "excel clean" : isConsult(d) ? "excel clean consult " + d : d;
/** the parts of a consulting design's look (08 §2.7–§2.8; product owner 2026-10-16: "add options to make different
    hybrids", 2026-10-19: "composable, with selectors for each composable part"): every part independent, set for the
    deck (designs[d].consult) and, over it, for one slide (SlideDef.looks[d]) – the contextual ribbon's selectors */
export interface ConsultOptions {
  /** tables as data exhibits (08 §2.6), as cards on the Liquid Glass scene, or ruled in the workbook's layout */ tables: "exhibit" | "cards" | "rules";
  /** every number of the table, or the compact exhibit (latest value + trend, bar + %) */ numbers: "full" | "compact";
  /** the Δ bar beside each variance (Navy every variance, Red the first two) */ bars: "on" | "off";
  /** the trend line after the periods */ trend: "on" | "off";
  /** the light bar under the latest period's value */ band: "on" | "off";
  /** a KPI line under the title, a message panel on the left, or none (both from the slide's first table) */ headline: "kpi" | "panel" | "none";
  /** how many variances the KPI line quotes after its headline figure */ kpis: "1" | "2" | "3";
  /** a dark band behind title and KPI line, a tinted slide, or white */ background: "band" | "tinted" | "white";
  /** the KPI line's figures: font, size (px), bold, italic, colour over the design's */ kpiText?: TextFmt;
  /** the message panel's lead figure: as kpiText */ panelText?: TextFmt;
}
/** the parts with a fixed set of choices (kpiText / panelText are text formats) */
export type ConsultChoice = Exclude<keyof ConsultOptions, "kpiText" | "panelText">;
export const CONSULT_DEFAULTS: Record<ConsultDesign, ConsultOptions> = {
  mckinsey: { tables: "exhibit", numbers: "full", bars: "on", trend: "on", band: "off", headline: "kpi", kpis: "3", background: "band" },
  bain: { tables: "exhibit", numbers: "full", bars: "on", trend: "off", band: "on", headline: "panel", kpis: "3", background: "tinted" },
};
export const CONSULT_CHOICES: { [K in ConsultChoice]: readonly ConsultOptions[K][] } = {
  tables: ["exhibit", "cards", "rules"], numbers: ["full", "compact"], bars: ["on", "off"], trend: ["on", "off"], band: ["on", "off"],
  headline: ["kpi", "panel", "none"], kpis: ["1", "2", "3"], background: ["band", "tinted", "white"] };
/** the parts' names and choices as users see them (the ribbon's selectors) */
export const CONSULT_TEXT: { [K in ConsultChoice]: { name: string; hint: string; labels: Record<ConsultOptions[K], string> } } = {
  tables: { name: "Tables", hint: "how each table is drawn", labels: { exhibit: "Exhibit", cards: "Cards", rules: "Ruled" } },
  numbers: { name: "Numbers", hint: "exhibits: every number, or the latest value with its trend and each change as bar + %", labels: { full: "All", compact: "Compact" } },
  bars: { name: "Δ bars", hint: "a bar beside each variance (Consulting Red: the first two)", labels: { on: "On", off: "Off" } },
  trend: { name: "Trend", hint: "a trend line after the periods", labels: { on: "On", off: "Off" } },
  band: { name: "Latest bar", hint: "a light bar under the latest period's value", labels: { on: "On", off: "Off" } },
  headline: { name: "Headline", hint: "from the slide's first table: a KPI line under the title, a message panel on the left, or nothing", labels: { kpi: "KPI line", panel: "Panel", none: "None" } },
  kpis: { name: "KPIs", hint: "how many variances the KPI line quotes", labels: { 1: "1", 2: "2", 3: "3" } },
  background: { name: "Ground", hint: "a dark band behind the title, a tinted slide, or white", labels: { band: "Band", tinted: "Tint", white: "White" } },
};
/** a text format of the look (kpiText / panelText): only valid values survive */
function cleanFmt(f: unknown): TextFmt | undefined {
  if (!f || typeof f !== "object") return undefined;
  const o = f as Record<string, unknown>, out: TextFmt = {};
  if (typeof o.font === "string" && o.font.trim() && o.font.length <= 120) out.font = o.font;
  if (typeof o.size === "number" && isFinite(o.size) && o.size >= 6 && o.size <= 200) out.size = o.size;
  if (typeof o.b === "boolean") out.b = o.b;
  if (typeof o.i === "boolean") out.i = o.i;
  if (typeof o.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(o.color)) out.color = o.color.toUpperCase();
  return Object.keys(out).length ? out : undefined;
}
/** only valid values survive (documents are shared and may come from other pages) */
export function cleanConsult(o: unknown): Partial<ConsultOptions> {
  const out: Partial<Record<keyof ConsultOptions, unknown>> = {};
  if (o && typeof o === "object") {
    for (const k of Object.keys(CONSULT_CHOICES) as ConsultChoice[]) {
      const v = (o as Record<string, unknown>)[k];
      if ((CONSULT_CHOICES[k] as readonly unknown[]).includes(v)) out[k] = v;
    }
    for (const k of ["kpiText", "panelText"] as const) { const f = cleanFmt((o as Record<string, unknown>)[k]); if (f) out[k] = f; }
  }
  return out as Partial<ConsultOptions>;
}
/** the options the current consulting design draws with: its defaults under what the deck – and, in a slide's context
    (render/look.ts slideCtx), the slide – set for it */
export function consultOptions(ctx: { style: Pick<Style, "design" | "consult"> }): ConsultOptions {
  const d = isConsult(ctx.style.design) ? ctx.style.design : "mckinsey";
  return { ...CONSULT_DEFAULTS[d], ...cleanConsult(ctx.style.consult) };
}
/** a slide's own parts for a design (SlideDef.looks[d]), valid values only */
export const slideLook = (cfg: { looks?: Partial<Record<Design, unknown>> } | undefined, d: Design): Partial<ConsultOptions> =>
  isConsult(d) ? cleanConsult(cfg?.looks?.[d]) : {};
/** the look's cache key (the exhibit's geometry and drawing depend on it) */
export const lookKey = (o: ConsultOptions) => JSON.stringify(o);
export const isDesign = (d: unknown): d is Design => (DESIGNS as readonly unknown[]).includes(d);
