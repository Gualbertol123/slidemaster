/* ⚙ Options › About › Licences (LI-01): THIRD-PARTY-NOTICES.txt, carried deflated (notices-data.ts, tools/notices.mjs)
   and inflated by the browser's own DecompressionStream only when the dialog opens – no inflate code in the page. */
import { NOTICES } from "./notices-data";
import { toast } from "../state/store";
import { ask } from "../state/dialogs";
import { esc } from "@slide-builder/core/xlsx/util";

let text: Promise<string> | null = null;
export function noticesText(): Promise<string> {
  return text ??= new Response(new Response(Uint8Array.from(atob(NOTICES), c => c.charCodeAt(0))).body!   // (not Blob.stream(): jsdom has none)
    .pipeThrough(new DecompressionStream("deflate"))).text().catch(e => { text = null; throw e; });
}

/** About › Licences: opened from ⚙ Options (Topbar) and from the start screen (Chrome's Canvas), which works without a deck */
export async function openLicences() {
  try {
    const pre = `<pre id="licencesText" style="max-height:60vh;overflow:auto;white-space:pre-wrap;font-size:11px;margin:0">${esc(await noticesText())}</pre>`;
    await ask("Licences", pre, [{ id: "ok", label: "OK", primary: true }], { sub: "Third-party software in Slide Builder", width: 760 });
  }
  catch (err) { toast("⚠ " + esc((err as Error).message), [], true); }
}
