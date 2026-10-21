/* B50 (product owner 2026-10-21): the automated comment written as the friend's Excel macro writes it ("Sub
   Summary_Retail_Loans" – the owner's code.docx), the same sentences, branches, sorting, rounding and number formats, but
   generalised: the analysis (comment.ts analyse) finds the total, the entities, the period and the comparison groups instead
   of the macro's fixed cells (R7, D9:D39 step 3 …), and the sections stay modular – any comparison can be a section, in
   any order, each with its own rule for when it is written (always / the last week of the month / the first week / from
   day N), its own alert threshold (the macro's BUDGET_ALERT_PCT -5 %, WEEKLY_ALERT_PCT -1 %) and switches.

   The macro's text, section by section (a plan comparison – "target" – uses the Budget section; every other comparison
   the Weekly Momentum one, worded for its kind):
     Title
     vs Budget - Budget Performance
     • <T> as of week <date> are above Budget by +476 | below Budget by -28 | in line with Budget, while recording a YoY
       change of +11,8% versus the same week in 2025. [if a positive contributor:] The strongest positive contributions
       versus Budget are recorded in A (+440, +3,5%), B (+61, +1,8%) and C (+5, +1,1%). [top 1 ≥ 50 % of the positive
       total:] Budget outperformance is largely driven by A, which accounts for approximately 86% of total positive
       country contributions. [else top 1 + 2 ≥ 70 %:] Budget outperformance is largely concentrated in A and B, which
       together account for approximately N% … ("Positive contributions are largely …" when the total is not above).
     • On the downside, the main negative deviations versus Budget are recorded in X (-28, -0,5%), Y and Z. [the worst %
       among those three ≤ -5 %:] X stands out on the downside, at -5,3% versus Budget, although volumes remain +2,0% YoY.
       | , with volumes also declining -1,0% YoY. | , with volumes broadly flat YoY.
       [no negative:] • No negative deviations versus Budget are recorded across the entities.
     vs Previous Week - Weekly Momentum
     • <T> increased by +101 (+0,4%) | decreased by -50 (-0,2%) versus the previous week. | remained broadly in line with
       the previous week. [positives:] The strongest positive weekly contributions are recorded in … [concentration:] The
       weekly increase is largely driven by … | Positive weekly contributions are largely driven by …
     • On the downside, the main negative weekly contributions are recorded in … [≤ -1 %:] X stands out on the downside,
       declining -1,3% WoW, although volumes remain … YoY. | [none:] • No negative weekly contributions are recorded
       across the entities.
   A list of two is "A (…), B (…)" (the macro's Case 2 joins with a comma; only the third joins with "and").
   Rounding: an amount is "positive" when it rounds (Excel ROUND, half away from zero) above 0; amounts are written
   rounded to whole numbers with Italian thousands ("+1.234"); percentages with one decimal and a comma ("+11,8%"); shares
   as whole percents ("86%"). Sorting: the macro's exchange sort (highest first; equal values keep its order). Colours
   (the macro's ColorSignedText): every signed figure it colours is written as [[+476]] (green / red by its sign, bold);
   the title and the entity names in the text are bold (FormatBodyTextOccurrences). */
import type { Analysis, CommentCfg, GCell, Group, Row } from "./comment";
import { defaultGroups, parseNum, prettyLabel } from "./comment";

/** when a section is written, decided from the latest period's date the analysis finds */
export type SectionWhen = "always" | "monthEnd" | "firstWeek" | "fromDay";
export interface CommentSection {
  /** the comparison group (Analysis Group id, e.g. "Δ vs. Budget") */ g: string;
  /** unset = always */ when?: SectionWhen;
  /** "fromDay": the first day of the month it is written on (1–31, default 25) */ day?: number;
  /** the attention threshold as a fraction (-0.05 = -5 %); unset = the macro's: -5 % for a plan, -1 % otherwise */ alert?: number;
  /** the heading line; unset = the macro's ("vs Budget - Budget Performance", "vs Previous Week - Weekly Momentum") */ heading?: string;
  /** false = leave out: the YoY clause (plan sections), the concentration sentence, the downside bullet, the alert sentence */
  yoy?: false; share?: false; down?: false; flag?: false;
  /** contributors named per side (1–5, default 3 as the macro) */ top?: number;
}
export const WHEN_LABEL: Record<SectionWhen, string> = { always: "Always", monthEnd: "Only in the last week of the month", firstWeek: "Only in the first week of the month", fromDay: "Only from day … of the month" };
export const defaultAlert = (g: Pick<Group, "kind">) => g.kind === "target" ? -0.05 : -0.01;

/* ---- the macro's number formats ---- */
/** Excel's ROUND(x, 0) (RoundedWhole): half away from zero, on the value as Excel shows it (15 significant digits) */
export function roundWhole(x: number): number { const n = Number(Math.abs(x).toPrecision(15)); return Math.sign(x) * Math.floor(n + .5) || 0; }
const thousands = (n: number) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** FormatSignedNumber: "+476", "-1.234", "0" */
export function signedNumber(x: number): string { const r = roundWhole(x); return r > 0 ? "+" + thousands(r) : r < 0 ? "-" + thousands(r) : "0"; }
/** VBA Format(x, "0.0%") with Italian separators */
function pct1(x: number): string { const y = Number((Math.abs(x) * 1000).toPrecision(15)), r = Math.floor(y + .5) / 10; return (x < 0 ? "-" : "") + r.toFixed(1).replace(".", ",") + "%"; }
/** FormatSignedPercentage: "+11,8%", "-0,5%", "0,0%" (the macro writes zero as "0.0%"; here with the comma of its other figures) */
export function signedPct(x: number): string { return x > 0 ? "+" + pct1(x) : x < 0 ? pct1(x) : "0,0%"; }
/** Format(x, "0%") */
export function wholePct(x: number): string { return (x < 0 ? "-" : "") + Math.floor(Number((Math.abs(x) * 100).toPrecision(15)) + .5) + "%"; }
/** a figure the macro colours: [[+476]] (the text boxes colour it by its sign and make it bold); "0" and "0,0%" stay plain */
const col = (s: string) => /^[+-]/.test(s) ? `[[${s}]]` : s;

/* ---- the period date and the sections' rules ---- */
/** the latest period's date ("25/09/26", "25.09.2026", "2026-09-25"; day first, as an Italian sheet writes it) */
export function periodDate(a: Pick<Analysis, "period">): Date | null {
  const s = a.period ? `${a.period.date} ${a.period.name}` : "";
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return mk(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function mk(y: number, mo: number, d: number): Date | null {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null;
}
const daysIn = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
/** is the section written for this date? No date found: written (the dialog says so) */
export function sectionApplies(s: Pick<CommentSection, "when" | "day">, date: Date | null): boolean {
  const w = s.when || "always";
  if (w === "always" || !date) return true;
  const day = date.getUTCDate();
  if (w === "monthEnd") return day > daysIn(date) - 7;                 // the next weekly date falls in the next month
  if (w === "firstWeek") return day <= 7;
  return day >= Math.max(1, Math.min(31, Math.round(s.day ?? 25)));
}
/** the sections a new comment starts with: the plan comparison and the shortest-term change (the macro's two) */
export function defaultSections(a: Analysis): CommentSection[] { return defaultGroups(a).reduce<CommentSection[]>((on, g) => [...on, newSection(a, on, g)], []); }
/** a section added after the others: a plan section after another plan section leaves out the YoY clause (the first one
    already says it, word for word – the macro has one Budget section only) */
export function newSection(a: Pick<Analysis, "groups">, on: CommentSection[], g: string): CommentSection {
  const kind = (id: string) => a.groups.find(x => x.id === id)?.kind;
  return kind(g) === "target" && on.some(s => kind(s.g) === "target") ? { g, yoy: false } : { g };
}
/** an alert threshold as saved: a fraction at or below 0 (a positive one would flag every named negative); else unset */
export const cleanAlert = (x: number | undefined) => x === undefined || !isFinite(x) || x > 0 ? undefined : x;
/** a comment's sections: its own (an empty list: none ticked – the title only), else the default ones */
export const sectionsOf = (a: Analysis, cfg: Pick<CommentCfg, "sections">): CommentSection[] => cfg.sections ?? defaultSections(a);

/* ---- the words of each kind of comparison ---- */
interface Words { vs: string; adj: string; wow: string; heading: string }
const THEME: Partial<Record<Group["kind"], string>> = { month: "Month-to-date", quarter: "Quarter-to-date", year: "Year-to-date", yoy: "Year-on-year" };
function wordsOf(g: Group): Words {
  switch (g.kind) {
    case "target": return { vs: g.vs, adj: "", wow: "", heading: `${g.name} - Budget Performance` };
    case "week": return { vs: "the previous week", adj: "weekly", wow: "WoW", heading: "vs Previous Week - Weekly Momentum" };
    case "month": return { vs: g.vs, adj: "monthly", wow: "MoM", heading: `${g.name} - Month-to-date` };
    case "quarter": return { vs: g.vs, adj: "quarterly", wow: "QoQ", heading: `${g.name} - Quarter-to-date` };
    case "year": return { vs: "the beginning of the year", adj: "year-to-date", wow: "YTD", heading: `${g.name} - Year-to-date` };
    case "yoy": return { vs: "the same period of last year", adj: "year-on-year", wow: "YoY", heading: `${g.name} - Year-on-year` };
    default: return { vs: g.vs, adj: "", wow: "versus " + g.vs, heading: g.name + (THEME[g.kind] ? " - " + THEME[g.kind] : "") };
  }
}
export const sectionHeading = (g: Group, s?: Pick<CommentSection, "heading">) => (s?.heading || "").trim() || wordsOf(g).heading;
const sp = (...xs: string[]) => xs.filter(Boolean).join(" ");

/* ---- the comment ---- */
interface Ent { label: string; v: number; pct: number; yoy: number }
/** a cell's value in the unit Excel shows it in: a raw value a scaling format shows in thousands / millions ("#,##0,,")
    is brought to the shown unit, as the macro reads cells already in it */
function shown(c: GCell | undefined): number | null {
  if (!c || !c.anchor || c.v === null || !isFinite(c.v)) return null;
  const t = parseNum(c.text);
  if (!t || !c.v || /%\s*$/.test(c.text)) return c.v;
  const k = Math.log10(Math.abs(c.v / t)) / 3, n = Math.round(k);
  return n >= 1 && Math.abs(k - n) < .05 ? c.v / Math.pow(1000, n) : c.v;
}
/** the macro's exchange sort: highest first (for i, for j > i: swap when j is greater) */
function exchangeSort(xs: Ent[]) {
  for (let i = 0; i < xs.length - 1; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j].v > xs[i].v) [xs[i], xs[j]] = [xs[j], xs[i]];
}
/** "A (+440, +3,5%), B (…) and C (…)": the macro's Select Case (2nd joined by ", ", the last of `top` by " and ") */
function listOf(es: Ent[], top: number, hasPct: boolean, side: 1 | -1): string {
  return es.map((e, k) => {
    const p = signedPct(e.pct), pc = side > 0 ? (e.pct > 0 ? col(p) : p) : (e.pct < 0 ? col(p) : p);
    return (k === 0 ? "" : k === top - 1 ? " and " : ", ") + `**${e.label}** (${col(signedNumber(e.v))}${hasPct ? ", " + pc : ""})`;
  }).join("");
}

export interface MacroInput { a: Analysis; cfg: CommentCfg; title: string }
export function writeMacro({ a, cfg, title }: MacroInput): string {
  const T = title.trim() || "Table", are = /s$/i.test(T) ? "are" : "is";
  const noun = (cfg.noun || "").trim() || "country";
  const ex = new Set((cfg.exclude || []).map(x => x.toLowerCase()));
  // the YoY % (the macro's AH column); a YoY comparison with an amount only has no % to write: no YoY clause
  const yoyCol = a.groups.find(g => g.kind === "yoy" && g.pct !== null)?.pct ?? null;
  const cell = (r: number, c: number | null) => c === null ? undefined : a.grid[r]?.[c];
  const num0 = (r: number, c: number | null) => cell(r, c)?.v ?? null;
  const date = periodDate(a);
  // "week" only when the header says so (as comment.ts): a monthly column with a date is "as of 30/09/26 … same period"
  const week = a.period ? /week|\bwk\b|\bw\d/i.test(a.period.name) : false;
  const asOf = a.period ? ` as of ${week ? "week " : ""}${a.period.date || a.period.name}` : "";
  const sameWeek = `versus the same ${week ? "week" : "period"} ${date ? "in " + (date.getUTCFullYear() - 1) : "of the previous year"}`;
  const out: string[] = ["# " + T];
  const secs = sectionsOf(a, cfg).map(s => ({ s, g: a.groups.find(g => g.id === s.g) })).filter((x): x is { s: CommentSection; g: Group } => !!x.g && x.g.abs !== null);
  if (!a.groups.some(g => g.abs !== null)) return out.concat("No comparison columns (e.g. “Δ vs. Budget”) were found in this table.").join("\n");
  for (const { s, g } of secs) {
    if (!sectionApplies(s, date)) continue;
    const W = wordsOf(g), top = Math.max(1, Math.min(5, Math.round(s.top ?? 3))), alertAt = cleanAlert(s.alert) ?? defaultAlert(g), hasPct = g.pct !== null;
    // the entities with a number in the section's column (IsNumeric), their % (0 when not a number) and YoY
    const ents: Ent[] = a.entities.filter(e => !ex.has(e.label.toLowerCase()) && e.label.trim()).flatMap((e: Row) => {
      const v = shown(cell(e.r, g.abs)); if (v === null) return [];
      return [{ label: e.label.trim(), v, pct: num0(e.r, g.pct) ?? 0, yoy: yoyCol === null ? 0 : num0(e.r, yoyCol) ?? 0 }];
    });
    exchangeSort(ents);
    const total = a.total ? shown(cell(a.total.r, g.abs)) ?? 0 : ents.reduce((t, e) => t + e.v, 0);
    const totalPct = a.total ? num0(a.total.r, g.pct) ?? 0 : 0, rt = roundWhole(total);
    // the top positives (from the top) and negatives (from the bottom); the share of the positive total
    const positives = ents.filter(e => roundWhole(e.v) > 0), posTotal = positives.reduce((t, e) => t + e.v, 0);
    const pos = positives.slice(0, top), neg = ents.slice().reverse().filter(e => roundWhole(e.v) < 0).slice(0, top);
    const share1 = posTotal > 0 && pos[0] ? pos[0].v / posTotal : 0, share2 = posTotal > 0 && pos[0] ? (pos[0].v + (pos[1]?.v ?? 0)) / posTotal : 0;
    // the attention point: the worst % among the named negatives at or below the threshold
    let alert: Ent | null = null;
    for (const e of neg) if (e.pct <= alertAt && (!alert || e.pct < alert.pct)) alert = e;
    const concentration = (up: string, plain: string) => {
      if (s.share === false || !pos.length) return "";
      if (share1 >= .5) return ` ${rt > 0 ? up : plain} largely driven by **${pos[0].label}**, which accounts for approximately ${wholePct(share1)} of total positive ${noun} contributions.`;
      if (share2 >= .7 && pos[1]) return ` ${rt > 0 ? up : plain} largely concentrated in **${pos[0].label}** and **${pos[1].label}**, which together account for approximately ${wholePct(share2)} of total positive ${noun} contributions.`;
      return "";
    };
    const yoyTail = (e: Ent) => yoyCol === null ? "." : e.yoy > 0 ? `, although volumes remain ${col(signedPct(e.yoy))} YoY.` : e.yoy < 0 ? `, with volumes also declining ${col(signedPct(e.yoy))} YoY.` : ", with volumes broadly flat YoY.";
    let b1: string, b2: string;
    if (g.kind === "target") {
      const desc = rt > 0 ? `above ${W.vs} by ${col(signedNumber(total))}` : rt < 0 ? `below ${W.vs} by ${col(signedNumber(total))}` : `in line with ${W.vs}`;
      const yoyTot = yoyCol === null || !a.total ? null : num0(a.total.r, yoyCol) ?? 0;
      b1 = `• **${T}**${asOf} ${are} ${desc}${yoyTot !== null && s.yoy !== false ? `, while recording a YoY change of ${col(signedPct(yoyTot))} ${sameWeek}` : ""}.`;
      if (pos.length) b1 += ` The strongest positive contributions versus ${W.vs} are recorded in ${listOf(pos, top, hasPct, 1)}.` + concentration(`${W.vs} outperformance is`, "Positive contributions are");
      b2 = neg.length ? `• On the downside, the main negative deviations versus ${W.vs} are recorded in ${listOf(neg, top, hasPct, -1)}.`
        + (alert && s.flag !== false ? ` **${alert.label}** stands out on the downside, at ${col(signedPct(alert.pct))} versus ${W.vs}${yoyTail(alert)}` : "")
        : `• No negative deviations versus ${W.vs} are recorded across the entities.`;
    } else {
      const paren = hasPct ? ` (${col(signedPct(totalPct))})` : "";
      b1 = rt > 0 ? `• **${T}** increased by ${col(signedNumber(total))}${paren} versus ${W.vs}.` : rt < 0 ? `• **${T}** decreased by ${col(signedNumber(total))}${paren} versus ${W.vs}.`
        : `• **${T}** remained broadly in line with ${W.vs}.`;
      if (pos.length) b1 += ` ${sp("The strongest positive", W.adj, "contributions are recorded in")} ${listOf(pos, top, hasPct, 1)}.` + concentration(sp("The", W.adj, "increase is"), sp("Positive", W.adj, "contributions are"));
      b2 = neg.length ? `• On the downside, ${sp("the main negative", W.adj, "contributions are recorded in")} ${listOf(neg, top, hasPct, -1)}.`
        + (alert && s.flag !== false ? ` **${alert.label}** stands out on the downside, declining ${col(signedPct(alert.pct))} ${W.wow}${yoyTail(alert)}` : "")
        : `• ${sp("No negative", W.adj, "contributions are recorded across the entities.")}`;
    }
    out.push("## " + sectionHeading(g, s), "", b1);
    if (s.down !== false) out.push("", b2);
    out.push("");
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
/** the title a comment gets with none typed: the total row's label, else the table's name, without a leading "Total" /
    "Totale" ("TOTAL RETAIL LOANS" → "Retail Loans", the macro's title) */
export function macroTitleFallback(a: Pick<Analysis, "total">, fallback: string): string {
  const p = a.total ? prettyLabel(a.total.label) : prettyLabel(fallback);
  return p.replace(/^tot(?:ale?|\.)?\s+/i, "").trim() || p || "Table";
}
/** the comment's title: the user's, else the fallback above */
export const macroTitle = (a: Analysis, cfg: Pick<CommentCfg, "title">, fallback: string) => (cfg.title || "").trim() || macroTitleFallback(a, fallback);
