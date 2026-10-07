/* Automated comments on tables (e.g. "Retail Loans · vs Budget – Budget Performance · • Retail Loans as of
   week 25/09/26 are above Budget by +476 …"). Pure functions over a grid of cells, so they are easy to test:
   analyse() finds the label column, the total row, the entities, the latest period and the comparison
   groups ("Δ vs. Budget" with Abs. / % columns); writeComment() turns that into text with a small markup
   that text boxes render: "# title", "## heading", "**bold**", "[[+476]]" (green/red by sign). */

export interface GCell { text: string; v: number | null; anchor: boolean; bold: boolean }
/** cells[row][col]; a merged cell repeats its text in every position it covers (anchor only at its first) */
export type Grid = GCell[][];

export interface CommentCfg {
  /** section ids (comparison group names) to write, in this order; empty = the default choice */
  groups: string[];
  title?: string;
  /** contributors named per side (1–5) */
  top: number;
  /** movements smaller than this (absolute, in the table's unit) are not "material" */
  minAbs?: number;
  /** labels of rows left out of the comment */
  exclude?: string[];
  /** what the rows are called: countries, banks, entities… */
  noun: string;
  detail: "short" | "full";
  /** concentration ("largely driven by X, ~86 %"), breadth, missing data sentences */
  share: boolean; breadth: boolean; missing: boolean;
  /** "summary": one short paragraph per block joining week, Budget and EoM (default for new comments);
      "sections": one section per comparison (comments made before summaries existed) */
  mode?: "summary" | "sections";
  /** summary: the comparisons it joins, by kind (default week, target, month) */
  kinds?: Group["kind"][];
  /** more tables of the same slide covered by this comment (table ids) */
  tables?: string[];
}
export const DEFAULT_COMMENT: CommentCfg = { groups: [], top: 2, noun: "country", detail: "full", share: true, breadth: true, missing: true, mode: "summary" };
export const SUMMARY_KINDS: Group["kind"][] = ["week", "target", "month"];

export interface Row { label: string; r: number }
export interface Group { id: string; name: string; abs: number | null; pct: number | null; kind: "target" | "week" | "month" | "quarter" | "year" | "yoy" | "other"; vs: string }
export interface Analysis {
  labelCol: number; total: Row | null; entities: Row[]; groups: Group[];
  /** every row with a label and numbers (total rows included), top to bottom */ rows: Row[];
  /** sub-tables: a total/heading row (bold or "Total…") and the rows under it; one block when there is none */
  blocks: { head: Row | null; rows: Row[] }[];
  /** latest period: column header and its date, e.g. "Week39", "25/09/26" */
  period: { name: string; date: string } | null;
  grid: Grid;
}

const NUMLIKE = /^[-+(−]?[\d.,\s']*\d[\d.,\s']*%?\)?$/;
const COMPARE = /Δ|∆|\bvs\.?\b|\bvar\.?\b|delta|change|chg|diff/i;
export const TOTAL = /^\s*(grand\s+)?tot(al|ale|\.)?\b|\btotal\b|\btotale\b/i;
const PERIODISH = /week|wk|\bw\d|month|\bm\d|date|\d{1,2}[/.-]\d{1,2}|20\d\d|\bq[1-4]\b|eom|eoq|ytd|actual|current/i;
const PLANISH = /budget|bdg|plan|target|forecast|fcst|objective/i;
const DATEISH = /\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?/;
const isNum = (c?: GCell) => !!c && c.anchor && c.v !== null && isFinite(c.v);

/** parses "1.234,5", "-5,0%", "(3)", "1,234.5" (Excel display text) */
export function parseNum(text: string): number | null {
  let t = String(text || "").trim().replace(/[−–]/g, "-").replace(/\s|'/g, "");
  if (!NUMLIKE.test(t)) return null;
  const neg = /^\(.*\)$/.test(t); t = t.replace(/[()]/g, "");
  const pct = t.endsWith("%"); t = t.replace("%", "");
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (lc >= 0) t = /,\d{3}$/.test(t) && (t.match(/,/g) || []).length > 1 ? t.replace(/,/g, "") : t.replace(",", ".");
  else if (ld >= 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, "");
  else if (ld >= 0 && /^-?\d{1,3}\.\d{3}$/.test(t)) t = t.replace(".", "");      // "54.555" in an Italian sheet = 54555
  const n = parseFloat(t); if (!isFinite(n)) return null;
  return (neg ? -n : n) / (pct ? 100 : 1);
}

export function analyse(grid: Grid): Analysis {
  const R = grid.length, C = R ? grid[0].length : 0;
  const textCell = (c?: GCell) => !!c && c.anchor && !!c.text.trim() && !isNum(c) && !NUMLIKE.test(c.text.trim());
  // label column: most rows with text there and numbers to the right
  let labelCol = 0, best = -1;
  for (let c = 0; c < C; c++) {
    let n = 0; for (let r = 0; r < R; r++) if (textCell(grid[r][c]) && grid[r].some((x, k) => k > c && isNum(x))) n++;
    if (n > best) { best = n; labelCol = c; }
  }
  const dataRows: Row[] = [];
  for (let r = 0; r < R; r++) { const l = grid[r][labelCol]; if (textCell(l) && grid[r].some((x, k) => k > labelCol && isNum(x))) dataRows.push({ r, label: l.text.trim() }); }
  const first = dataRows.length ? dataRows[0].r : R;
  // headers of each column (top → bottom, merged cells repeat), from the rows above the first data row
  const heads: string[][] = [];
  for (let c = 0; c < C; c++) {
    const parts: string[] = [];
    for (let r = 0; r < first; r++) { const t = (grid[r][c]?.text || "").trim(); if (t && !parts.includes(t)) parts.push(t); }
    heads.push(parts);
  }
  const pctCol = (c: number) => heads[c].some(h => /^%$|%\s*$|\bpct\b|perc/i.test(h)) ||
    (() => { const xs = dataRows.map(d => grid[d.r][c]).filter(isNum); return xs.length > 0 && xs.filter(x => x.text.trim().endsWith("%")).length >= xs.length * .6; })();
  // comparison groups
  const groups: Group[] = [], byId = new Map<string, Group>();
  for (let c = labelCol + 1; c < C; c++) {
    const g = heads[c].find(h => COMPARE.test(h)); if (!g) continue;
    if (!dataRows.some(d => isNum(grid[d.r][c]))) continue;
    let G = byId.get(g);
    if (!G) { G = { id: g, name: cleanGroup(g), abs: null, pct: null, ...kindOf(g) }; byId.set(g, G); groups.push(G); }
    if (pctCol(c)) { if (G.pct === null) G.pct = c; } else if (G.abs === null) G.abs = c;
  }
  // latest period: the last plain column that looks like a period and is not a plan
  let period: Analysis["period"] = null;
  for (let c = C - 1; c > labelCol; c--) {
    const h = heads[c]; if (!h.length || h.some(x => COMPARE.test(x)) || h.some(x => PLANISH.test(x))) continue;
    if (!h.some(x => PERIODISH.test(x)) || !dataRows.some(d => isNum(grid[d.r][c]))) continue;
    const date = h.find(x => DATEISH.test(x)) || "", name = h.find(x => x !== date) || date;
    period = { name, date }; break;
  }
  const totals = dataRows.filter(d => TOTAL.test(d.label));
  const total = totals[0] || null;
  const entities = dataRows.filter(d => !TOTAL.test(d.label) && !/^(of which|di cui|o\/w)\b/i.test(d.label) && !(d.r < (total?.r ?? -1) && grid[d.r][labelCol].bold));
  // blocks: every bold or "Total…" row with numbers heads the rows below it (a total at the very end heads the rows above)
  const isHead = (d: Row) => TOTAL.test(d.label) || grid[d.r][labelCol].bold;
  const headRows = dataRows.filter(isHead), blocks: Analysis["blocks"] = [];
  if (!headRows.length || headRows.length === dataRows.length) blocks.push({ head: headRows.length === 1 ? headRows[0] : null, rows: dataRows.filter(d => !isHead(d)) });
  else {
    let cur: Analysis["blocks"][number] | null = null;
    for (const d of dataRows) {
      if (isHead(d)) { if (cur && !cur.head && d === dataRows[dataRows.length - 1]) cur.head = d; else blocks.push(cur = { head: d, rows: [] }); }
      else { if (!cur) blocks.push(cur = { head: null, rows: [] }); cur.rows.push(d); }
    }
  }
  return { labelCol, total, entities, groups, period, grid, rows: dataRows, blocks: blocks.filter(b => b.head || b.rows.length) };
}

function cleanGroup(g: string) { return g.replace(/[Δ∆]/g, "").replace(/\bvs\.?/i, "vs").replace(/\s+/g, " ").trim(); }
function kindOf(g: string): { kind: Group["kind"]; vs: string } {
  const after = cleanGroup(g).replace(/^.*?\bvs\b\s*/i, "").trim() || cleanGroup(g);
  if (PLANISH.test(g)) return { kind: "target", vs: after };
  if (/prev|previous|last\s*week|w\/w|wow|\bweek\b/i.test(g)) return { kind: "week", vs: "the previous week" };
  if (/yoy|y\/y|\bpy\b|\bly\b|prior year|last year|same week/i.test(g)) return { kind: "yoy", vs: "the same period of last year" };
  if (/boy|ytd|beginning of (the )?year|\bdec\b/i.test(g)) return { kind: "year", vs: "the beginning of the year" };
  if (/\bq[1-4]\b|quarter|qtd|eoq/i.test(g)) return { kind: "quarter", vs: after };
  if (/eom|month|m\/m|mom|mtd/i.test(g)) return { kind: "month", vs: after };
  return { kind: "other", vs: after };
}
const THEME: Record<Group["kind"], string> = { target: "Budget Performance", week: "Weekly Momentum", month: "Month-to-date", quarter: "Quarter-to-date", year: "Year-to-date", yoy: "Year-on-year", other: "" };
export const headingOf = (g: Group) => g.name + (THEME[g.kind] ? " – " + THEME[g.kind] : "");
/** sections picked when the user did not choose: the plan comparison and the shortest-term change, as in a weekly report */
export function defaultGroups(a: Analysis): string[] {
  const t = a.groups.find(g => g.kind === "target"), w = a.groups.find(g => g.kind === "week") || a.groups.find(g => g.kind !== "target");
  const out = [t, w].filter(Boolean).map(g => g!.id);
  return out.length ? out : a.groups.slice(0, 2).map(g => g.id);
}

/* ---- writing ---- */
export function prettyLabel(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  return t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()) : t;
}
const join = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
/** the cell's own display text with an explicit sign: "+476", "-0,5%" */
function signed(c: GCell | undefined): string {
  if (!c || c.v === null) return "";
  const t = c.text.trim().replace(/^[+−-]/, "").replace(/^\((.*)\)$/, "$1");
  return c.v > 0 ? "+" + t : c.v < 0 ? "-" + t : t;
}
const num = (c?: GCell) => c && c.v !== null ? `[[${signed(c)}]]` : "";

export function writeComment(a: Analysis, cfg: CommentCfg, fallbackTitle = ""): string {
  const title = (cfg.title || "").trim() || (a.total ? prettyLabel(a.total.label) : prettyLabel(fallbackTitle) || "Table");
  const plural = /s$/i.test(title.trim()) ? "are" : "is";
  const ids = cfg.groups.length ? cfg.groups : defaultGroups(a);
  const groups = ids.map(id => a.groups.find(g => g.id === id)).filter((g): g is Group => !!g && g.abs !== null);
  const ex = new Set((cfg.exclude || []).map(x => x.toLowerCase()));
  const ents = a.entities.filter(e => !ex.has(e.label.toLowerCase()));
  const noun = cfg.noun.trim() || "country", nouns = noun.endsWith("y") ? noun.slice(0, -1) + "ies" : noun + "s";
  const min = Math.max(0, cfg.minAbs || 0), top = Math.max(1, Math.min(5, cfg.top || 3));
  const out: string[] = ["# " + title];
  if (!groups.length) return out.concat("No comparison columns (e.g. “Δ vs. Budget”) were found in this table.").join("\n");
  groups.forEach((g, gi) => {
    const cell = (r: number, c: number | null) => c === null ? undefined : a.grid[r]?.[c];
    const val = (r: number) => cell(r, g.abs)?.v ?? null;
    const show = (r: number) => { const p = num(cell(r, g.pct)); return p ? `${num(cell(r, g.abs))}, ${p}` : num(cell(r, g.abs)); };
    const named = (e: Row) => `**${e.label}** (${show(e.r)})`;
    const withData = ents.filter(e => val(e.r) !== null);
    const missing = ents.filter(e => val(e.r) === null);
    const pos = withData.filter(e => val(e.r)! > 0 && Math.abs(val(e.r)!) >= min && Math.abs(val(e.r)!) > 0).sort((x, y) => val(y.r)! - val(x.r)!);
    const neg = withData.filter(e => val(e.r)! < 0 && Math.abs(val(e.r)!) >= min).sort((x, y) => val(x.r)! - val(y.r)!);
    const sumPos = pos.reduce((s, e) => s + val(e.r)!, 0), sumNeg = neg.reduce((s, e) => s + val(e.r)!, 0);
    const tot = a.total ? val(a.total.r) : withData.reduce((s, e) => s + val(e.r)!, 0);
    const totTxt = a.total ? (num(cell(a.total.r, g.pct)) ? `${num(cell(a.total.r, g.abs))} (${num(cell(a.total.r, g.pct))})` : num(cell(a.total.r, g.abs))) : `[[${tot && tot > 0 ? "+" : ""}${fmtPlain(tot || 0)}]]`;
    const up = (tot || 0) > 0, down = (tot || 0) < 0;
    const asOf = gi === 0 && a.period ? ` as of ${/week/i.test(a.period.name) ? "week " : ""}${a.period.date || a.period.name}` : "";
    const vsTxt = g.kind === "target" ? g.vs : g.kind === "year" ? "the beginning of the year" : g.vs;
    out.push("", "## " + headingOf(g));
    // headline
    let p1 = g.kind === "target"
      ? `**${title}**${asOf} ${plural} ${up ? "above" : down ? "below" : "in line with"} ${vsTxt}${up || down ? " by " + totTxt : ""}.`
      : g.kind === "year" ? `**${title}**${asOf} ${up ? "increased" : down ? "decreased" : "were stable"} ${up || down ? "by " + totTxt + " " : ""}since the beginning of the year.`
        : `**${title}**${asOf} ${up ? "increased" : down ? "decreased" : "remained stable"} ${up || down ? "by " + totTxt + " " : ""}versus ${vsTxt}.`;
    const lead = (up || !down) ? pos : neg, other = (up || !down) ? neg : pos;
    const leadSum = (up || !down) ? sumPos : sumNeg;
    if (lead.length) {
      const list = join(lead.slice(0, top).map(named));
      p1 += up || !down ? ` The strongest positive contributions${g.kind === "target" ? " versus " + vsTxt : ""} are recorded in ${list}.`
        : ` The ${g.kind === "target" ? "shortfall" : "decrease"} is mainly driven by ${list}.`;
      if (cfg.detail === "full" && cfg.share && leadSum) {
        const share = Math.round(val(lead[0].r)! / leadSum * 100);
        if (lead.length === 1) p1 += ` **${lead[0].label}** is the only ${noun} with a ${up || !down ? "positive" : "negative"} contribution.`;
        else if (share >= 50) p1 += ` The ${g.kind === "target" ? (up ? "outperformance" : "gap") : up ? "increase" : "decrease"} is largely driven by **${lead[0].label}**, which accounts for approximately ${share}% of total ${up || !down ? "positive" : "negative"} ${noun} contributions.`;
      }
      if (cfg.detail === "full" && cfg.breadth && withData.length >= 3 && lead.length >= Math.ceil(withData.length * .6))
        p1 += ` The ${up ? "improvement" : "movement"} therefore reflects a broadly based set of ${up || !down ? "positive" : "negative"} ${noun} contributions.`;
    }
    out.push("• " + p1);
    if (cfg.detail === "full" || other.length) {
      if (other.length) {
        const list = join(other.slice(0, top).map(named));
        out.push("", up || !down ? `• On the downside, the main negative ${g.kind === "target" ? "deviations versus " + vsTxt : "contributions"} are recorded in ${list}.`
          : `• Partly offsetting, positive contributions come from ${list}.`);
      } else if (cfg.detail === "full") out.push("", `• No material ${up || !down ? "negative" : "positive"} ${noun} contribution was recorded${g.kind === "week" ? " during the week" : ""}, with the remaining ${nouns} broadly ${up || !down ? "stable or positive" : "stable or negative"}.`);
    }
    if (cfg.detail === "full" && cfg.missing && missing.length && missing.length < ents.length)
      out.push("", `• No ${g.kind === "target" ? vsTxt + " " : ""}data is available for ${join(missing.map(e => `**${e.label}**`))}.`);
  });
  return out.join("\n");
}
function fmtPlain(n: number) { return Math.abs(n) >= 100 ? Math.round(n).toLocaleString("it-IT") : (Math.round(n * 10) / 10).toLocaleString("it-IT"); }

/** the "headers" of a table, to find similar tables elsewhere in the deck */
export const signatureOf = (a: Analysis) => a.groups.map(g => g.id.toLowerCase().replace(/\s+/g, " ")).join("|");

/* ---- summary: short, joint, decisive ----
   One paragraph per block (sub-table): "Retail Loans: +101 w/w (+0,2%) · +476 vs Budget · +454 vs EoM.
   Solid week, driven by VUB (+40) and PBZ (+38); ISP ALB (-12) offsets part of it. Above Budget mainly
   thanks to VUB (+440)." – no dates, the strongest facts only. */
const SHORT_VS: Partial<Record<Group["kind"], (g: Group) => string>> = {
  week: () => "w/w", target: g => "vs " + g.vs.replace(/^the\s+/i, ""), month: g => "vs " + g.vs.replace(/\s*20\d\d\s*$/, ""), quarter: g => "vs " + g.vs, year: () => "YTD", yoy: () => "YoY", other: g => "vs " + g.vs,
};
/** "(1)" footnote markers and all-caps out of a row label */
export const cleanHead = (s: string) => prettyLabel(s.replace(/\s*\(\d+\)\s*$/, "").replace(/\s*\*+\s*$/, ""));
function weekWord(v: number, p: number | null): string {
  if (!v) return "Flat week";
  const q = p === null ? null : Math.abs(p);
  if (v > 0) return q === null ? "Positive week" : q >= .01 ? "Strong week" : q >= .003 ? "Solid week" : "Slightly positive week";
  return q === null ? "Negative week" : q >= .01 ? "Sharp weekly decline" : q >= .003 ? "Weak week" : "Slightly negative week";
}
export interface SummaryPart { a: Analysis; name: string }
export function writeSummary(parts: SummaryPart[], cfg: CommentCfg, title: string): string {
  const kinds = cfg.kinds?.length ? cfg.kinds : SUMMARY_KINDS, top = Math.max(1, Math.min(4, cfg.top || 2));
  const ex = new Set((cfg.exclude || []).map(x => x.toLowerCase()));
  const lines: string[] = [];
  const blocks = parts.flatMap(p => p.a.blocks.map(b => ({ p, b })));
  for (const { p, b } of blocks) {
    const a = p.a, groups = kinds.map(k => a.groups.find(g => g.kind === k && g.abs !== null)).filter((g): g is Group => !!g);
    if (!groups.length) continue;
    const cell = (r: number, c: number | null) => c === null ? undefined : a.grid[r]?.[c];
    const v = (r: number, g: Group) => cell(r, g.abs)?.v ?? null;
    const rows = b.rows.filter(e => !ex.has(e.label.toLowerCase()));
    const sum = (g: Group) => rows.reduce((s, e) => s + (v(e.r, g) || 0), 0);
    const totOf = (g: Group) => b.head ? v(b.head.r, g) : sum(g);
    const name = b.head ? cleanHead(b.head.label) : blocks.length > 1 ? p.name : (cfg.title || p.name);
    // headline: the joint numbers
    const facts = groups.map(g => {
      const t = totOf(g); if (t === null) return "";
      const abs = b.head ? num(cell(b.head.r, g.abs)) : `[[${t > 0 ? "+" : ""}${fmtPlain(t)}]]`, pct = b.head ? num(cell(b.head.r, g.pct)) : "";
      return `${abs}${pct && g.kind === "week" ? ` (${pct})` : ""} ${SHORT_VS[g.kind]!(g)}`;
    }).filter(Boolean);
    let txt = `**${name}**: ${facts.join(" · ")}.`;
    // the week (or the first comparison): how good, who drives it, who offsets it
    const main = groups[0], mt = totOf(main) || 0;
    const contrib = rows.map(e => ({ e, x: v(e.r, main) })).filter((c): c is { e: Row; x: number } => c.x !== null && c.x !== 0);
    const big = Math.max(0, ...contrib.map(c => Math.abs(c.x)));
    const material = (x: number) => Math.abs(x) >= Math.max(cfg.minAbs || 0, big * .08);
    const same = contrib.filter(c => Math.sign(c.x) === Math.sign(mt) && material(c.x)).sort((x, y) => Math.abs(y.x) - Math.abs(x.x));
    const opp = contrib.filter(c => Math.sign(c.x) === -Math.sign(mt) && material(c.x)).sort((x, y) => Math.abs(y.x) - Math.abs(x.x));
    const nm = (c: { e: Row }, g: Group) => `**${c.e.label}** (${num(cell(c.e.r, g.abs))})`;
    const word = main.kind === "week" ? weekWord(mt, b.head ? cell(b.head.r, main.pct)?.v ?? null : null) : mt > 0 ? "Positive" : mt < 0 ? "Negative" : "Flat";
    let s2 = word;
    if (mt && same.length) {
      const lead = same[0], share = Math.round(Math.abs(lead.x / mt) * 100);
      s2 += same.length === 1 || share >= 60 ? `, ${share >= 100 ? "entirely" : "mostly"} ${mt > 0 ? "from" : "due to"} ${nm(lead, main)}${share < 100 && share >= 60 ? ` (${share}%)` : ""}`
        : `, driven by ${join(same.slice(0, top).map(c => nm(c, main)))}`;
    }
    if (mt && opp.length) s2 += `; ${join(opp.slice(0, top).map(c => nm(c, main)))} ${opp.length === 1 && top >= 1 ? "goes" : "go"} the other way`;
    txt += " " + s2 + ".";
    // the plan: above/below and who explains it
    const tg = groups.find(g => g.kind === "target");
    if (tg && tg !== main && cfg.detail === "full") {
      const t = totOf(tg);
      const cs = rows.map(e => ({ e, x: v(e.r, tg) })).filter((c): c is { e: Row; x: number } => c.x !== null && c.x !== 0 && Math.sign(c.x) === Math.sign(t || 0)).sort((x, y) => Math.abs(y.x) - Math.abs(x.x));
      if (t && cs.length) txt += ` ${t > 0 ? "Above" : "Below"} ${tg.vs} mainly ${t > 0 ? "thanks to" : "because of"} ${join(cs.slice(0, Math.min(top, 2)).map(c => nm(c, tg)))}.`;
      // the week against the gap: closing it, or widening it
      // the week against the plan: closing the gap, or eating into the lead
      if (t && mt && main.kind === "week" && Math.sign(t) !== Math.sign(mt)) {
        const share = Math.round(Math.abs(mt) / (Math.abs(t) + Math.abs(mt)) * 100);
        if (share >= 5) txt += mt > 0 ? ` The week closes ${share}% of the gap to ${tg.vs}.` : ` The week takes ${share}% off the lead over ${tg.vs}.`;
      }
    }
    lines.push("• " + txt);
  }
  if (!lines.length) return "# " + title + "\nNo comparison columns (e.g. “Δ vs. Prev. Week”, “Δ vs. Budget”) were found.";
  return ["# " + title, ...lines.flatMap((l, i) => i ? ["", l] : [l])].join("\n");
}
