/* Delete-versions without the wizard (S16.2, B37, docs/next/09 §3.7): the actions of ribbon 2 › Cells › For this
   version ▾ on the version chosen in the top bar (#versionSel; the stage shows it). Each is one version.patch – one undo
   step; the sheet's list is replaced whole (model/versions.ts), so other sheets' lists and other versions are never
   touched. */
import { get, patch, toast } from "../state/store";
import { change } from "../state/app";
import { selTable } from "./edit";
import { selCols, selRows } from "./tables";
import { versionOf, versionOp, type VersionAction } from "@slide-builder/core/model/versions";
import type { DeckVersion } from "@slide-builder/core/model/types";

/** the version shown (null: the full deck – the menu is disabled) */
export const shownVersion = (): DeckVersion | null => versionOf(get().doc.view?.preset, get().deck.version);

const LABEL: Record<VersionAction, string> = { dropRows: "Delete rows", dropCols: "Delete columns", empty: "Empty cells", restoreSel: "Restore selection", restoreAll: "Restore all" };
export function forVersion(action: VersionAction): boolean {
  const v = shownVersion();
  if (!v) { toast("Choose a version first (Version in the top bar)."); return false; }
  const T = selTable(), sel = get().selection.sel;
  if (action !== "restoreAll" && (!T || !sel)) { toast("Select cells of a table first."); return false; }
  // the table's own rows / columns of the selection (Excel's hidden ones between them are not the user's to delete)
  const rows = selRows(), cols = selCols();
  if (action === "dropRows" && T && T.rows.length - rows.length < 1) { toast("A table keeps at least one row: select fewer rows."); return false; }
  if (action === "dropCols" && T && T.cols.length - cols.length < 1) { toast("A table keeps at least one column: select fewer columns."); return false; }
  const op = versionOp(v, action, T?.sheet.name || "", sel, { rows, cols });
  if (!op) { toast(action === "restoreAll" ? `Nothing is removed in “${v.name}”.` : "Nothing to change in the selection."); return false; }
  const ok = change(`${LABEL[action]}${action === "restoreAll" ? ` of “${v.name}”` : ""}`, [op]);
  if (ok && (action === "dropRows" || action === "dropCols")) patch("selection", { sel: null });     // the cells are gone from the slides
  return ok;
}
