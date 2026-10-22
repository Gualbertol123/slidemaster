/* The conditional formats of a worksheet's XML (S16.4, B39): <conditionalFormatting> blocks and their rules with the
   parts of each type (colour scale, data bar, icon set, top 10, above average, text, time period), plus the 2010
   extension list (<x14:conditionalFormatting>): a data bar's 2010 look joins its rule (by id); a rule only there (the
   2010 icon sets, custom icons) is read whole, its ranges from <xm:sqref>. Evaluated by cf.ts. */
import { parseRange } from "./util";
import { xattrs, xdec } from "./strings";
import type { CFBar14, CFRule, CFVO, Shared } from "./types";
import { unsupportedOf } from "./cf";

const attrsEl = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null }) as never;
const P = "(?:\\w+:)?";
const each = (xml: string, tag: string, fn: (attrs: Record<string, string>, inner: string) => void) => {
  const re = new RegExp(`<${P}${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}${tag}>)`, "g"); let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) fn(xattrs(m[1]), m[2] || "");
};
const firstOf = (xml: string, tag: string) => { let o: { a: Record<string, string>; inner: string } | null = null; each(xml, tag, (a, inner) => { o ||= { a, inner }; }); return o as { a: Record<string, string>; inner: string } | null; };
/** the thresholds: 2007 <cfvo val=""/>, 2010 <x14:cfvo><xm:f>…</xm:f></x14:cfvo> */
function cfvos(inner: string): CFVO[] {
  const out: CFVO[] = [];
  each(inner, "cfvo", (a, body) => {
    const f = /<(?:\w+:)?f>([^<]*)<\/(?:\w+:)?f>/.exec(body);
    const val = a.val !== undefined ? a.val : f ? xdec(f[1]) : undefined;
    out.push({ type: a.type || "min", ...(val !== undefined ? { val } : {}), ...(a.gte === "0" || a.gte === "false" ? { gte: false } : {}) });
  });
  return out;
}
const colorsOf = (inner: string, ctx: Shared): string[] => { const out: string[] = []; each(inner, "color", a => { out.push(ctx.color(attrsEl(a), "#000000") || "#000000"); }); return out; };
const yes = (v: string | undefined, d: boolean) => v === undefined ? d : v === "1" || v === "true";

/** the type-specific parts of a rule (shared by the 2007 rule and a rule only in the extension) */
function ruleParts(rule: CFRule, a: Record<string, string>, inner: string, ctx: Shared) {
  if (a.text !== undefined) rule.text = a.text;
  if (rule.type === "top10") { rule.rank = +(a.rank || 10); rule.percent = yes(a.percent, false); rule.bottom = yes(a.bottom, false); }
  if (rule.type === "aboveAverage") { rule.above = yes(a.aboveAverage, true); rule.equal = yes(a.equalAverage, false); rule.stdDev = +(a.stdDev || 0); }
  if (rule.type === "timePeriod") rule.period = a.timePeriod || "today";
  if (rule.type === "colorScale") { const s = firstOf(inner, "colorScale"); if (s) rule.scale = { cfvo: cfvos(s.inner), colors: colorsOf(s.inner, ctx) }; }
  if (rule.type === "dataBar") {
    const d = firstOf(inner, "dataBar");
    if (d) {
      const fill = /<(?:\w+:)?(?:fillColor|color)\b[^>]*>/.exec(d.inner);
      rule.bar = { cfvo: cfvos(d.inner), color: fill ? ctx.color(attrsEl(xattrs(fill[0])), "#638EC6") || "#638EC6" : "#638EC6",
        minLength: +(d.a.minLength ?? 10), maxLength: +(d.a.maxLength ?? 90), showValue: yes(d.a.showValue, true) };
    }
  }
  if (rule.type === "iconSet") {
    const s = firstOf(inner, "iconSet");
    if (s) {
      const custom: ([string, number] | null)[] = [];
      each(s.inner, "cfIcon", ia => { custom.push(ia.iconSet === "NoIcons" ? null : [ia.iconSet || "3TrafficLights1", +(ia.iconId || 0)]); });
      rule.icons = { set: s.a.iconSet || "3TrafficLights1", cfvo: cfvos(s.inner), reverse: yes(s.a.reverse, false), showValue: yes(s.a.showValue, true), ...(yes(s.a.custom, false) && custom.length ? { custom } : {}) };
    }
  }
}
/** a 2010 data bar's look (x14:dataBar) */
function bar14(a: Record<string, string>, inner: string, ctx: Shared): CFBar14 {
  const o: CFBar14 = {};
  if (a.minLength !== undefined) o.minLength = +a.minLength;
  if (a.maxLength !== undefined) o.maxLength = +a.maxLength;
  o.border = yes(a.border, false); o.gradient = yes(a.gradient, true);
  if (a.direction) o.direction = a.direction;
  if (a.axisPosition) o.axis = a.axisPosition;
  o.negSame = yes(a.negativeBarColorSameAsPositive, false); o.negBorderSame = yes(a.negativeBarBorderColorSameAsPositive, true);
  const col = (tag: string) => { const m = new RegExp(`<${P}${tag}\\b([^>]*?)\\/?>`).exec(inner); return m ? ctx.color(attrsEl(xattrs(m[1])), null) || undefined : undefined; };
  const bc = col("borderColor"), nc = col("negativeFillColor"), nbc = col("negativeBorderColor"), ac = col("axisColor");
  if (bc) o.borderColor = bc; if (nc) o.negColor = nc; if (nbc) o.negBorderColor = nbc; if (ac) o.axisColor = ac;
  const v = cfvos(inner); if (v.length === 2) o.cfvo = v;
  return o;
}

/** the rules of a worksheet's XML (outside sheetData), sorted by priority, and what of them is not reproduced */
export function readCFXml(xml: string, ctx: Shared): { cfRules: CFRule[]; unsupportedCF: Set<string> } {
  const cfRules: CFRule[] = [], unsupportedCF = new Set<string>(), byId = new Map<string, CFRule>();
  // the extension list first cut out: its rules are read apart
  // (the worksheet's extension list is its last part; a 2007 rule's own <extLst> only names its id)
  const at = xml.search(/<(?:\w+:)?conditionalFormattings\b/), ext = at >= 0 ? [xml.slice(at)] : null;
  const main = at >= 0 ? xml.slice(0, at) : xml;
  const re = /<(?:\w+:)?conditionalFormatting\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?conditionalFormatting>/g; let q: RegExpExecArray | null;
  while ((q = re.exec(main))) {
    const ranges = (xattrs(q[1]).sqref || "").split(/\s+/).filter(Boolean).map(parseRange);
    each(q[2], "cfRule", (a, inner) => {
      const formulas: string[] = []; const fr = /<(?:\w+:)?formula(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?formula>/g; let f: RegExpExecArray | null; while ((f = fr.exec(inner))) formulas.push(xdec(f[1]));
      const rule: CFRule = { ranges, type: a.type, op: a.operator ?? null, priority: +(a.priority || 999), stop: a.stopIfTrue === "1", dxf: ctx.dxfs[+a.dxfId] || null, formulas };
      ruleParts(rule, a, inner, ctx);
      const id = /<(?:\w+:)?id>([^<]*)<\/(?:\w+:)?id>/.exec(inner); if (id) byId.set(id[1], rule);
      cfRules.push(rule);
    });
  }
  if (ext) {
    const xre = /<(?:\w+:)?conditionalFormatting\b[^>]*>([\s\S]*?)<\/(?:\w+:)?conditionalFormatting>/g; let x: RegExpExecArray | null;
    while ((x = xre.exec(ext[0]))) {
      const sq = /<(?:\w+:)?sqref>([^<]*)<\/(?:\w+:)?sqref>/.exec(x[1]);
      const ranges = (sq ? sq[1] : "").split(/\s+/).filter(Boolean).map(parseRange);
      each(x[1], "cfRule", (a, inner) => {
        const own = a.id ? byId.get(a.id) : undefined;
        if (own) { if (own.bar) { const d = firstOf(inner, "dataBar"); if (d) own.bar.x14 = bar14(d.a, d.inner, ctx); } return; }
        // a rule of the extension alone: the 2010 icon sets and custom icons, data bars; others (a rule naming another
        // sheet, with its own x14:dxf) are listed as not reproduced
        if (a.type !== "iconSet" && a.type !== "dataBar") { unsupportedCF.add(a.type === "expression" || a.type === "cellIs" ? "formulas naming another sheet" : `"${a.type}" rules`); return; }
        const rule: CFRule = { ranges, type: a.type, op: null, priority: +(a.priority || 999), stop: false, dxf: null, formulas: [] };
        ruleParts(rule, a, inner, ctx);
        if (rule.bar) { const d = firstOf(inner, "dataBar")!; rule.bar.x14 = bar14(d.a, d.inner, ctx); }
        if (ranges.length) cfRules.push(rule);
      });
    }
  }
  for (const r of cfRules) { const why = unsupportedOf(r); if (why) unsupportedCF.add(why); }
  cfRules.sort((a, b) => a.priority - b.priority);
  return { cfRules, unsupportedCF };
}
