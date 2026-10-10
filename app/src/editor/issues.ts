/* Side panel notes for the current slide: what is on it, what could not be reproduced. */
import { A1, esc } from "@slide-builder/core/xlsx/util";
import type { Sheet } from "@slide-builder/core/xlsx/types";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import { tableName } from "@slide-builder/core/model/preset";
import { computeLayout, sizingOf } from "@slide-builder/core/render/slide";
import type { RenderCtx } from "@slide-builder/core/render/context";

export interface Issue { cls: "" | "ok" | "warn" | "err"; html: string }
export function slideIssues(R: RuntimeSlide, ctx: RenderCtx): Issue[] {
  const out: Issue[] = [];
  if (R.type === "cover") return [{ cls: "", html: "Cover slide · double-click the title to edit it, or use the wizard (step 3)." }];
  if (R.type === "index") return [{ cls: "", html: `Index slide · lists ${ctx.slides.filter(s => s.type === "content").length} content slide(s) with their page numbers.` }];
  if (R.missing) out.push({ cls: "err", html: `${R.missing} table${R.missing > 1 ? "s" : ""} of this slide could not be found (sheet renamed or deleted?). Open the wizard to fix.` });
  if (!R.tables.length) out.push({ cls: "warn", html: "No tables on this slide." });
  const { boxes } = computeLayout(R, ctx);
  const sheets = new Set<Sheet>();
  R.tables.forEach((T, i) => {
    sheets.add(T.sheet);
    out.push({ cls: "", html: `<b>${esc(tableName(T, ctx.preset))}</b> · ${esc(T.sheet.name)} <code>${A1(T.g.r1 + 1, T.g.c1 + 1)}:${A1(T.g.r2 - 1, T.g.c2 - 1)}</code> · ${T.rows.length}×${T.cols.length}` + (T.hiddenRows || T.hiddenCols ? ` · ${T.hiddenRows} hidden rows, ${T.hiddenCols} hidden cols skipped` : "") + (T.def && T.def.kind === "range" && T.def.grow ? " · grows with new rows" : "") });
    if (T.errors.length) out.push({ cls: "err", html: `Error values: <code>${T.errors.slice(0, 8).join(" ")}${T.errors.length > 8 ? " …" : ""}</code>` });
    const sizes = T.items.filter(it => it.text && it.text.length > 1).map(it => it.font.sz || 11).sort((a, b) => a - b);
    const typical = sizes.length ? sizes[Math.floor(sizes.length * 0.25)] : 11;
    const px = typical * 96 / 72 * (boxes[i]?.scale || 1);
    if (isFinite(px) && px < 9.5) out.push({ cls: "warn", html: `Small text (≈${px.toFixed(1)}px at 100%): enlarge the table or move it to its own slide.` });
  });
  for (const S of sheets) {
    const D = S.drawing;
    if (D.charts.length) out.push({ cls: "warn", html: `Chart${D.charts.length > 1 ? "s" : ""} on ${esc(S.name)} not reproduced: ${D.charts.map(esc).join(", ")}. In Excel: copy the chart › Paste Special › Picture (PNG) inside the table area.` });
    if (D.unsupported.length) out.push({ cls: "warn", html: `Picture${D.unsupported.length > 1 ? "s" : ""} on ${esc(S.name)} that could not be read: ${D.unsupported.map(esc).join(", ")}` });
    if (S.unsupportedCF.size) out.push({ cls: "warn", html: `Not reproduced on ${esc(S.name)}: ${[...S.unsupportedCF].join(", ")} conditional formats` });
    const cells = ctx.edits[S.name] || {}, n = Object.keys(cells).length;
    if (n) {
      const all = R.tables.filter(T => T.sheet === S).flatMap(T => T.items);
      const stale = Object.entries(cells).filter(([k, e]) => e.text !== undefined && all.some(it => A1(it.b.src.r, it.b.src.c) === k) && !all.some(it => A1(it.b.src.r, it.b.src.c) === k && it.text === e.orig)).length;
      out.push({ cls: "", html: `${n} edited cell${n > 1 ? "s" : ""} on ${esc(S.name)}` + (stale ? ` · <span class="warn">${stale} text edit${stale > 1 ? "s" : ""} paused: the Excel value changed (rows inserted above the table, or new figures)</span>` : "") });
    }
  }
  if (sizingOf(R, ctx).layout) out.push({ cls: "ok", html: "Custom table layout saved" });
  return out;
}
