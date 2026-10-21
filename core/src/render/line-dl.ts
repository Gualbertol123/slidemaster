/* Lines and annotations on slides (4.8, M15; docs/next/09 §2.3, §3.4): a `line` item's display-list nodes – straight /
   elbow / curve / bracket / range routes, heads (render/heads.ts), a label at the middle, `hit {kind: "line"}` bands.
   S14.P stub: a line item is kept and saved (ops.ts knows the kind) but draws nothing yet; M15 owns this file. */
import type { Node } from "../dl/types";
import type { Box, LineItem } from "../model/types";
import type { RenderCtx } from "./context";

export interface LineDL { nodes: Node[]; issue: string | null }
export function lineNodes(_it: LineItem, _id: string, _box: Box, _ctx: RenderCtx): LineDL {
  return { nodes: [], issue: null };
}
