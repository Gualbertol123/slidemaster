/* KPI cards (B54): "KPI cards from table" – a range with a header row and one row per product (image 16) becomes one
   card per data row, evenly across the slide, in ONE change (one undo step); each card is independent afterwards. The
   columns are found by their header names (Product, Current, Budget_reference / Previous_week / EoM_reference,
   Delta_*), else by their order. And the KPI panel's builders: each a plain item.patch (rows replaced whole). */
import type { DataRef, KpiItem, Op } from "@slide-builder/core/model/types";
import type { KpiRow } from "@slide-builder/core/model/kpi";
import { A1, parseRange } from "@slide-builder/core/xlsx/util";
import { get, toast } from "../state/store";
import { change, core } from "../state/app";
import { curSlide } from "./edit";
import { newItemId, selectItem } from "./charts";

type RefKind = "bdg" | "prev" | "eom";
const LABEL: Record<RefKind, string> = { bdg: "vs Bdg", prev: "vs prev. Week", eom: "vs EoM" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const refKind = (h: string): RefKind | null => /budget|bdg/.test(h) ? "bdg" : /prev|week|wow/.test(h) ? "prev" : /eom|month/.test(h) ? "eom" : null;
/** the columns of a KPI table by header name: product, current, the references and the deltas (column numbers); null
    when the headers name neither a product nor a current column (then the column order is used) */
export function kpiColumns(headers: string[], c0: number): { product: number; current: number; rows: { kind: RefKind | null; label: string; ref?: number; delta?: number }[] } | null {
  const H = headers.map(norm);
  const find = (re: RegExp) => { const i = H.findIndex(h => re.test(h)); return i < 0 ? -1 : c0 + i; };
  const product = find(/^(product|name|kpi|item|title)/), current = find(/^(current|actual|value|now|cur)/);
  if (product < 0 && current < 0) return null;
  const rows: { kind: RefKind | null; label: string; ref?: number; delta?: number }[] = [];
  H.forEach((h, i) => {
    const c = c0 + i; if (c === product || c === current || !h) return;
    const delta = /^(delta|var|chg|change)/.test(h), k = refKind(h.replace(/^(delta|var|chg|change)/, ""));
    let row = rows.find(r => k && r.kind === k);
    if (!row) { if (!k && !delta && !/ref|prev|budget/.test(h)) return; row = { kind: k, label: k ? LABEL[k] : headers[i].trim() }; rows.push(row); }
    if (delta) row.delta ??= c; else row.ref ??= c;
  });
  return { product: product < 0 ? c0 : product, current: current < 0 ? c0 + 1 : current, rows };
}
/** the cards of a KPI table: one per data row, laid out evenly across the slide width */
export function kpiCardsFromTable(sheet: string, range: string, headers: string[]): KpiItem[] {
  const g = parseRange(range), ref = (r: number, c: number): DataRef => ({ sheet, range: A1(r, c) });
  const cols = kpiColumns(headers, g.c1);
  // the column order: product, current, then the references (labelled as the owner's picture: Bdg, prev. Week, EoM)
  type Cols = NonNullable<ReturnType<typeof kpiColumns>>;
  const map: Cols = cols ?? { product: g.c1, current: g.c1 + 1, rows: (["bdg", "prev", "eom"] as RefKind[]).slice(0, Math.max(0, g.c2 - g.c1 - 1)).map((k, i) => ({ kind: k, label: LABEL[k], ref: g.c1 + 2 + i })) };
  const first = g.r1 + 1, n = Math.max(0, g.r2 - first + 1);
  if (!n) return [];
  const M = 56, GAP = 24, W = (1600 - 2 * M - (n - 1) * GAP) / n, H = Math.round(Math.max(90, Math.min(160, W * .32)));
  return Array.from({ length: n }, (_, i) => {
    const r = first + i;
    const rows: KpiRow[] = map.rows.map(x => ({ src: x.ref !== undefined ? { ref: ref(r, x.ref), mode: "pct" as const } : { cell: ref(r, x.delta!) }, label: x.label, good: "up" as const }));
    return { kind: "kpi", head: ref(r, map.product), cur: ref(r, map.current), rows, box: { x: Math.round(M + i * (W + GAP)), y: 170, w: Math.round(W), h: H } };
  });
}
/** KPI cards from table (the sheet view's range): its header row read from the workbook, the cards inserted at once */
export async function insertKpiCards(sheet: string, range: string): Promise<string[]> {
  const R = curSlide(), wb = get().deck.wb; if (!R || !wb) return [];
  const g = parseRange(range);
  if (g.r2 <= g.r1) { toast("Choose the header row and at least one row of data."); return []; }
  let headers: string[] = [];
  try {
    const w = await core().call("getSheetWindow", { book: wb.book, sheet, r0: g.r1, r1: g.r1, c0: g.c1, c1: g.c2 });
    headers = Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => w?.cells.find(x => x.r === g.r1 && x.c === g.c1 + i)?.text ?? "");
  } catch { headers = []; }
  const cards = kpiCardsFromTable(sheet, range, headers);
  const ids = cards.map(() => newItemId());
  const S = curSlide(); if (!S || !cards.length) return [];
  change(cards.length > 1 ? `Insert ${cards.length} KPI cards` : "Insert KPI card", cards.map((it, i) => ({ op: "item.patch", slide: S.id, id: ids[i], patch: it }) as Op));
  selectItem(ids[0]);
  return ids;
}
/* ---- the panel's builders ---- */
export const newRow = (k: KpiItem): KpiRow => {
  const last = k.rows?.[k.rows.length - 1];
  return last ? JSON.parse(JSON.stringify(last)) as KpiRow : { src: { ref: k.cur ?? { sheet: "", range: "A1" }, mode: "pct" }, label: "vs Bdg", good: "up" };
};
export const rowsPatch = (k: KpiItem, f: (rows: KpiRow[]) => KpiRow[]) => ({ rows: f((k.rows || []).map(r => JSON.parse(JSON.stringify(r)) as KpiRow)) });
export const moveRow = (k: KpiItem, i: number, d: -1 | 1) => rowsPatch(k, rs => { const j = i + d; if (j < 0 || j >= rs.length) return rs; [rs[i], rs[j]] = [rs[j], rs[i]]; return rs; });
export const setRow = (k: KpiItem, i: number, p: Partial<KpiRow>) => rowsPatch(k, rs => rs.map((r, j) => {
  if (j !== i) return r;
  const o = { ...r, ...p } as KpiRow & Record<string, unknown>;
  for (const key of Object.keys(p)) if ((p as Record<string, unknown>)[key] === undefined || (p as Record<string, unknown>)[key] === "") delete o[key];
  return o;
}));
/** a row's source switched: a cell holding the change, or computed (pct / abs / both) from a reference cell */
export function sourcePatch(k: KpiItem, i: number, mode: "cell" | "pct" | "abs" | "both") {
  const r = k.rows?.[i]; if (!r) return null;
  const at = "cell" in r.src ? r.src.cell : r.src.ref;
  return setRow(k, i, { src: mode === "cell" ? { cell: at } : { ref: at, mode } });
}
/** what the KPI panel picks in the sheet view: the title's cell, the value's, a row's */
export type KpiPick = "head" | "cur" | `row:${number}`;
export function kpiRefPatch(k: KpiItem, what: KpiPick, ref: DataRef) {
  const one = { ...ref, range: ref.range.split(":")[0] } as DataRef;
  if (what === "head") return { head: one };
  if (what === "cur") return { cur: one };
  const i = +what.slice(4), r = k.rows?.[i]; if (!r) return null;
  return setRow(k, i, { src: "cell" in r.src ? { cell: one } : { ref: one, mode: r.src.mode } });
}
export const refName = (ref: DataRef | undefined) => !ref ? "–" : ("sheet" in ref ? ref.sheet : get().doc.view?.preset?.tables.find(t => t.id === ref.table)?.sheet ?? "?") + "!" + ref.range;
