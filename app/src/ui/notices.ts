/* ⚙ Options › About › Licences (LI-01): THIRD-PARTY-NOTICES.txt, carried deflated (notices-data.ts, tools/notices.mjs)
   and inflated by the browser's own DecompressionStream only when the dialog opens – no inflate code in the page. */
import { NOTICES } from "./notices-data";

let text: Promise<string> | null = null;
export function noticesText(): Promise<string> {
  return text ??= new Response(new Blob([Uint8Array.from(atob(NOTICES), c => c.charCodeAt(0))]).stream()
    .pipeThrough(new DecompressionStream("deflate"))).text().catch(e => { text = null; throw e; });
}
