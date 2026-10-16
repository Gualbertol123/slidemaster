/* The slide designs: their ids (saved in Style.design), the names users see, and which are consulting designs
   (docs/next/08-consulting-designs.md, ADR-018). The ids "mckinsey" / "bain" are internal; users see neutral names. */
import type { Design } from "./types";

export const DESIGNS: readonly Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
export const DESIGN_LABEL: Record<Design, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
export type ConsultDesign = "mckinsey" | "bain";
/** the consulting designs: one renderer (render/consult-dl.ts) with a spec each (render/consult-spec.ts) */
export const isConsult = (d: unknown): d is ConsultDesign => d === "mckinsey" || d === "bain";
/** the slide element's classes of a design (the consulting designs share Excel Refined's overlays) */
export const designClass = (d: Design) => d === "clean" ? "excel clean" : isConsult(d) ? "excel clean consult " + d : d;
export const isDesign = (d: unknown): d is Design => (DESIGNS as readonly unknown[]).includes(d);
