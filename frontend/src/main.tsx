/* Slide Builder 3 – browser app. Built into ONE self-contained file: ../backend/slide_builder.html */
import { render } from "preact";
import uiCss from "./styles/ui.css?raw";
import extraCss from "./styles/app.css?raw";
import slideCss from "./styles/slide.css?raw";
import { App } from "./ui/App";
import { boot } from "./state/app";
import { installKeys } from "./editor/keys";
import { indexWorkbook, readWorkbook } from "./xlsx/workbook";
import { buildLayout } from "./xlsx/layout";
import { formatValue } from "./xlsx/numfmt";
import { renderExcel } from "./render/excel";
import { renderGlass } from "./render/glass";
import { resolveStyle } from "./model/style";

// hooks for automated tests (parity with v2, end-to-end); not used by the app itself
(window as unknown as Record<string, unknown>).__sbTest = { indexWorkbook, readWorkbook, buildLayout, formatValue, renderExcel, renderGlass, resolveStyle };

// slide.css lives in its own <style id="slidecss">: exports send exactly this text to the export engine
const add = (id: string, css: string) => { const s = document.createElement("style"); s.id = id; s.textContent = css; document.head.appendChild(s); };
add("uicss", uiCss + "\n" + extraCss);
add("slidecss", slideCss);
render(<App />, document.getElementById("root")!);
installKeys();
void boot();
