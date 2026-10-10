/* Slide Builder 3 – browser app. Built into ONE self-contained file: ../backend/slide_builder.html */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import uiCss from "./styles/ui.css?raw";
import extraCss from "./styles/app.css?raw";
import slideCss from "./styles/slide.css?raw";
import { installBrowserPlatform } from "./platform";
import { App } from "./ui/App";
import { boot } from "./state/app";
import { installKeys } from "./editor/keys";
import { indexWorkbook, readWorkbook } from "@slide-builder/core/xlsx/workbook";
import { buildLayout } from "@slide-builder/core/xlsx/layout";
import { formatValue } from "@slide-builder/core/xlsx/numfmt";
import { renderExcel } from "@slide-builder/core/render/excel";
import { renderGlass } from "@slide-builder/core/render/glass";
import { resolveStyle } from "@slide-builder/core/model/style";

// the core measures text and draws canvases through the page (core/src/platform.ts)
installBrowserPlatform();

// hooks for automated tests (parity with v2, end-to-end); not used by the app itself
(window as unknown as Record<string, unknown>).__sbTest = { indexWorkbook, readWorkbook, buildLayout, formatValue, renderExcel, renderGlass, resolveStyle };

// slide.css lives in its own <style id="slidecss">: exports send exactly this text to the export engine
const add = (id: string, css: string) => { const s = document.createElement("style"); s.id = id; s.textContent = css; document.head.appendChild(s); };
add("uicss", uiCss + "\n" + extraCss);
add("slidecss", slideCss);
// StrictMode in development only (`npm run dev`): it runs every effect twice to show the ones that are not
// idempotent; the built page renders once
createRoot(document.getElementById("root")!).render(import.meta.env.DEV ? <StrictMode><App /></StrictMode> : <App />);
installKeys();
void boot();
