/* The slide designs: their ids (saved in Style.design), the names users see, and which are consulting designs
   (docs/next/08-consulting-designs.md, ADR-018). The ids "mckinsey" / "bain" are internal; users see neutral names. */
import type { Design, Style } from "./types";

export const DESIGNS: readonly Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
export const DESIGN_LABEL: Record<Design, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
export type ConsultDesign = "mckinsey" | "bain";
/** the consulting designs: one renderer (render/consult-dl.ts) with a spec each (render/consult-spec.ts) */
export const isConsult = (d: unknown): d is ConsultDesign => d === "mckinsey" || d === "bain";
/** the slide element's classes of a design (the consulting designs share Excel Refined's overlays) */
export const designClass = (d: Design) => d === "clean" ? "excel clean" : isConsult(d) ? "excel clean consult " + d : d;
/** the options of the consulting designs (product owner, 2026-10-16: "don't necessarily delete anything, add options to make
    different hybrids"): every look built for them stays a choice, per design (Design… › Layout; saved in designs[d].consult) */
export interface ConsultOptions {
  /** tables as data exhibits (08 §2.6), as cards on the Liquid Glass scene, or ruled in the workbook's layout */ tables: "exhibit" | "cards" | "rules";
  /** every number of the table, or the compact exhibit (latest value + trend, bar + %) */ numbers: "full" | "compact";
  /** a KPI line under the title, a message panel on the left, or none (both from the slide's first table) */ headline: "kpi" | "panel" | "none";
  /** a dark band behind title and KPI line, a tinted slide, or white */ background: "band" | "tinted" | "white";
}
export const CONSULT_DEFAULTS: Record<ConsultDesign, ConsultOptions> = {
  mckinsey: { tables: "exhibit", numbers: "full", headline: "kpi", background: "band" },
  bain: { tables: "exhibit", numbers: "full", headline: "panel", background: "tinted" },
};
export const CONSULT_CHOICES: { [K in keyof ConsultOptions]: readonly ConsultOptions[K][] } = {
  tables: ["exhibit", "cards", "rules"], numbers: ["full", "compact"], headline: ["kpi", "panel", "none"], background: ["band", "tinted", "white"] };
/** the options' names and choices as users see them (Design… › Layout, the topbar's Look dropdown) */
export const CONSULT_TEXT: { [K in keyof ConsultOptions]: { name: string; hint: string; labels: Record<ConsultOptions[K], string> } } = {
  tables: { name: "Tables", hint: "how each table is drawn", labels: { exhibit: "Exhibit", cards: "Cards", rules: "Ruled" } },
  numbers: { name: "Numbers", hint: "exhibits: every number, or the latest value with its trend and each change as bar + %", labels: { full: "All numbers", compact: "Compact" } },
  headline: { name: "Headline", hint: "from the slide's first table: a KPI line under the title, a message panel on the left, or nothing", labels: { kpi: "KPI line", panel: "Message panel", none: "None" } },
  background: { name: "Background", hint: "a dark band behind the title, a tinted slide, or white", labels: { band: "Dark band", tinted: "Tinted", white: "White" } },
};
/** every distinct look (product owner, 2026-10-16: "keep all of the combinations for now in a dropdown, we can remove them
    later"): Numbers only changes exhibits, so cards and ruled tables come once each – 18 + 9 + 9 = 36 */
export function consultLooks(): ConsultOptions[] {
  const out: ConsultOptions[] = [];
  for (const tables of CONSULT_CHOICES.tables) for (const numbers of tables === "exhibit" ? CONSULT_CHOICES.numbers : (["full"] as const))
    for (const headline of CONSULT_CHOICES.headline) for (const background of CONSULT_CHOICES.background) out.push({ tables, numbers, headline, background });
  return out;
}
/** a look's key (the dropdown's value) and name; Numbers is left out where it changes nothing */
export const consultLookKey = (o: ConsultOptions) => [o.tables, o.tables === "exhibit" ? o.numbers : "-", o.headline, o.background].join(" ");
export const consultLookName = (o: ConsultOptions) => [CONSULT_TEXT.tables.labels[o.tables], ...(o.tables === "exhibit" ? [CONSULT_TEXT.numbers.labels[o.numbers]] : []),
  o.headline === "none" ? "No headline" : CONSULT_TEXT.headline.labels[o.headline], CONSULT_TEXT.background.labels[o.background] + (o.background === "band" ? "" : " background")].join(" · ");
/** only valid values survive (documents are shared and may come from other pages) */
export function cleanConsult(o: unknown): Partial<ConsultOptions> {
  const out: Partial<Record<keyof ConsultOptions, string>> = {};
  if (o && typeof o === "object") for (const k of Object.keys(CONSULT_CHOICES) as (keyof ConsultOptions)[]) {
    const v = (o as Record<string, unknown>)[k];
    if ((CONSULT_CHOICES[k] as readonly unknown[]).includes(v)) out[k] = v as string;
  }
  return out as Partial<ConsultOptions>;
}
/** the options the current consulting design draws with (its defaults under what was set for it) */
export function consultOptions(ctx: { style: Pick<Style, "design" | "consult"> }): ConsultOptions {
  const d = isConsult(ctx.style.design) ? ctx.style.design : "mckinsey";
  return { ...CONSULT_DEFAULTS[d], ...cleanConsult(ctx.style.consult) };
}
export const isDesign = (d: unknown): d is Design => (DESIGNS as readonly unknown[]).includes(d);
