/* Store hooks for what several components render. Each subscribes to exactly the inputs it computes from,
   so a component re-renders when those change and not otherwise (state/store.ts). */
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../state/store";
import { ctx, ctxInputs, style } from "../state/app";

/** the render context (document, slides, config, workbook, version) */
export function useCtx() { useStore(useShallow(ctxInputs)); return ctx(); }
/** the deck's resolved style (shared config + the document's style) */
export function useStyle() { useStore(useShallow(s => [s.doc.config, s.doc.view?.style])); return style(); }
/** the slide on the stage */
export const useCurSlide = () => useStore(s => s.deck.slides[s.deck.cur]);
