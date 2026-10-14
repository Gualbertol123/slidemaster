/* Slide Builder 3 – browser app. Built into ONE self-contained file: ../helper/slide_builder.html */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import uiCss from "./styles/ui.css?raw";
import extraCss from "./styles/app.css?raw";
import { installBrowserPlatform } from "./platform";
import { App } from "./ui/App";
import { boot, change, core, coreStats, ctx } from "./state/app";
import { get } from "./state/store";
import { installKeys } from "./editor/keys";
import { indexWorkbook, readWorkbook } from "@slide-builder/core/xlsx/workbook";
import { buildLayout } from "@slide-builder/core/xlsx/layout";
import { formatValue } from "@slide-builder/core/xlsx/numfmt";
import { resolveStyle } from "@slide-builder/core/model/style";
import { todayLabel } from "@slide-builder/core/render/cover";
import { drawDl } from "@slide-builder/core/dl/canvas";
import type { DesignReq } from "@slide-builder/core/rpc/messages";
import { lastExport, pool } from "./editor/export";
import { thumbStats } from "./editor/thumbs";
import { stageBusy, stageNodes, stats as stageStats, useStage } from "./stage/data";

// the core measures text and draws canvases through the page (core/src/platform.ts)
installBrowserPlatform();

// hooks for automated tests (parity with v2, end-to-end); not used by the app itself
(window as unknown as Record<string, unknown>).__sbTest = { indexWorkbook, readWorkbook, buildLayout, formatValue, resolveStyle, coreStats,
  // the display list: built by the core worker, drawn on a canvas by the parity tools
  slideLists: (a: DesignReq & { slides?: number[] }) => core().call("slideLists", { today: todayLabel(), ...a }), drawDl,
  // the export (S3.7): the last one's files and time from the click, and how many export workers run
  lastExport, exportWorkers: () => pool().size, exportPhases: () => pool().last, toastNow: () => get().ui.toast, exporting: () => get().ui.exporting,
  // the stage (S4.1): the slide it shows (its display list in layers), whether it shows the current slide with nothing
  // on its way, and how many slides it received and how long the last took (parity, bench)
  stage: () => useStage.getState().shown, stageNodes, stageStats,
  // a late font's redraw still to come (S4.4's budget): the capture tools wait for false
  fontsSettling: () => core().call("fontsSettling", {}),
  // the thumbnails (S4.3): pictures drawn and slides asked for
  thumbStats: () => ({ ...thumbStats }),
  // the bench's 100-slide deck (S4.3): the deck's preset, and a change made as the page makes it (one undo step)
  preset: () => structuredClone(ctx().preset), change,
  stageIdle: () => { const s = useStage.getState(), R = get().deck.slides[get().deck.cur]; return !stageBusy() && !!s.shown && !!R && s.shown.id === R.id && !s.editor && !s.drag; } };

const add = (id: string, css: string) => { const s = document.createElement("style"); s.id = id; s.textContent = css; document.head.appendChild(s); };
add("uicss", uiCss + "\n" + extraCss);
// StrictMode in development only (`npm run dev`): it runs every effect twice to show the ones that are not
// idempotent; the built page renders once
createRoot(document.getElementById("root")!).render(import.meta.env.DEV ? <StrictMode><App /></StrictMode> : <App />);
installKeys();
void boot();
