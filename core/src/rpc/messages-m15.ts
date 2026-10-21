/* M15's calls of the page to the core worker (4.8), kept apart from messages.ts's CoreMethods, which extends this
   interface once: M14 and M15 then add their methods in different files (S15.2 review, 3). */
import type { IconSearchAnswer, IconSearchReq, IconTile } from "../render/icon-search";

export interface M15CoreMethods {
  /** (S15.2, 09 §3.5) the icon picker searches the worker's icon set; null without one (no worker) */
  iconSearch(a: IconSearchReq): IconSearchAnswer | null;
  /** tiles of icon ids (the picker's grid as it scrolls, its recent icons) */
  iconTiles(a: { ids: string[] }): Record<string, IconTile>;
}
