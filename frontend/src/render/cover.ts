/* Cover and index slides (both designs). */
import { esc } from "../xlsx/util";
import type { RuntimeSlide } from "../model/types";
import type { RenderCtx } from "./context";
import { pageNumber } from "./pagenumbers";

export function todayLabel(locale = "en-GB") { return new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); }
function coverTitleSize(t: string) { const n = String(t || "").length; return n > 52 ? 52 : n > 40 ? 60 : n > 28 ? 68 : 80; }

export function coverHtml(R: RuntimeSlide, glassy: boolean, rk = 1): string {
  const c = R.cfg, date = c.date || todayLabel(), note = c.note || "", t = R.title || "", fs = coverTitleSize(t);
  if (glassy) return `
    <div class="gls wb chrome cv-orb" style="left:1000px;top:96px;width:560px;height:560px;border-radius:50%"></div>
    <div class="gls wb chrome cv-tile" style="left:900px;top:470px;width:290px;height:290px;border-radius:${Math.round(76 * rk)}px"></div>
    <div class="gls wb chrome cv-orb small" style="left:1300px;top:540px;width:220px;height:220px;border-radius:50%"></div>
    <div class="cv-block g">
      ${note ? `<div class="cv-kicker">${esc(note)}</div>` : ""}
      <div class="cv-title" data-edit="title" style="font-size:${fs}px">${esc(t)}</div>
      <div class="cv-bar"></div>
      <div class="cv-sub" data-edit="subtitle">${esc(R.subtitle || "")}</div>
    </div>
    <div class="gls wb chrome cv-chip" style="left:120px;top:742px;width:${Math.round(56 + date.length * 11.5)}px;height:52px;border-radius:${Math.min(26, 26 * rk)}px"><span>${esc(date)}</span></div>`;
  return `
    <div class="cvx-panel"><div class="cvx-band"></div><div class="cvx-band b2"></div></div>
    <div class="cv-block x">
      ${note ? `<div class="cv-kicker">${esc(note)}</div>` : ""}
      <div class="cv-title" data-edit="title" style="font-size:${fs}px">${esc(t)}</div>
      <div class="cv-bar"></div>
      <div class="cv-sub" data-edit="subtitle">${esc(R.subtitle || "")}</div>
    </div>
    <div class="cvx-rule"></div><div class="cvx-date">${esc(date)}</div>`;
}

export function indexHtml(R: RuntimeSlide, ctx: RenderCtx, glassy: boolean): string {
  const items: { n: number; title: string; sub: string; page: string }[] = [];
  ctx.slides.forEach((S, i) => { if (S.type === "content") items.push({ n: items.length + 1, title: S.title, sub: S.subtitle || "", page: String(pageNumber(ctx, i)) }); });
  if (!items.length) return `<div class="ix-empty">No content slides yet</div>`;
  const two = items.length > 7, per = two ? Math.ceil(items.length / 2) : items.length;
  const top0 = R.subtitle ? 150 : 132, avail = 812 - top0 - 28;
  const rowH = Math.min(per <= 4 ? 112 : 96, Math.floor(avail / per)), fs = Math.max(16, Math.min(30, Math.round(rowH * .29))), badge = Math.min(50, rowH - 18);
  const colW = two ? 690 : 1060, x0 = two ? 90 : 270;
  const top = top0 + Math.max(0, (avail - per * rowH - 28) * .42);          // few entries: the list sits in the optical centre
  let h = "";
  [items.slice(0, per), items.slice(per)].forEach((list, k) => {
    if (!list.length) return;
    const x = x0 + k * (colW + 40), H = list.length * rowH + 28;
    if (glassy) h += `<div class="gls wb chrome card ix-card" style="left:${x}px;top:${top}px;width:${colW}px;height:${H}px;border-radius:${Math.round(30 * ctx.style.radius / 100)}px"></div>`;
    list.forEach((it, j) => {
      const y = top + 14 + j * rowH;
      h += `<div class="ix-row${glassy ? " g" : " x"}" style="left:${x + 24}px;top:${y}px;width:${colW - 48}px;height:${rowH}px;font-size:${fs}px">
        <span class="ix-n" style="width:${badge}px;height:${badge}px;line-height:${badge}px;font-size:${Math.round(badge * .38)}px">${String(it.n).padStart(2, "0")}</span>
        <span class="ix-txt"><span class="ix-t">${esc(it.title)}</span>${it.sub ? `<span class="ix-s">${esc(it.sub)}</span>` : ""}</span>
        <span class="ix-lead"></span><span class="ix-p">${esc(it.page)}</span></div>`;
      if (j < list.length - 1) h += `<div class="ix-sep${glassy ? " g" : ""}" style="left:${x + 24 + badge + 22}px;top:${y + rowH}px;width:${colW - 72 - badge - 22}px"></div>`;
    });
  });
  return h;
}
