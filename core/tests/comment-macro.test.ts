/* B50 (product owner 2026-10-21: "in this docx file is the macro formula a friend of mine has used to make the auto
   comments. i want you to replicate it exactly in structure but also keeping the current setups' modularity …"): the
   macro's text for the sample at the top of the owner's code.docx, every branch of it, the number formats, and the
   sections' rules (always / last week of the month / first week / from day N). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { applyOp, applyOps, docNeedsV5, emptyDoc, inverseOf, knownOp, needsV5 } from "../src/model/ops";
import { FakeDeck } from "./fakedeck";
import { makeZip } from "./zipbuild";
import type { CoreEvents, CoreMethods, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { CatalogFont } from "../src/text/resolve";
import type { Design, Note, Op, Preset } from "../src/model/types";
import type { Node } from "../src/dl/types";
import { analyse, defaultGroups, shapeComment, DEFAULT_COMMENT, type CommentCfg, type GCell, type Grid } from "../src/model/comment";
import { cleanAlert, defaultSections, macroTitle, macroTitleFallback, newSection, periodDate, roundWhole, sectionApplies, signedNumber, signedPct, wholePct, writeMacro, type CommentSection } from "../src/model/comment-macro";

/* the weekly loans table as the macro's sheet has it: the latest week, Δ vs. Budget (R / S), Δ vs. Prev. Week (T / U),
   a monthly Budget comparison and the YoY % (AH); raw values (what the macro reads) behind the shown text */
const H1 = ["(mln Euro)", "Week38", "Week39", "Eom Budget", "Δ vs. Budget", "Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. Prev. Week", "Δ vs. EoM Budget", "Δ vs. EoM Budget", "Δ YoY"];
const H2 = ["(mln Euro)", "18/09/26", "DATE", "Eom Budget", "Abs.", "%", "Abs.", "%", "Abs.", "%", "%"];
type R = [string, number, number, number, number, number, number, number];
//            label                  vs Bdg   %        WoW    %        vs EoM   %        YoY
const SAMPLE: R[] = [
  ["TOTAL RETAIL LOANS", 476.2, .0198, 101.3, .0041, -35.4, -.0015, .118],
  ["VUB", 440.3, .0352, 12.4, .0011, 20.2, .0016, .092],
  ["PBZ", -28.4, -.0051, 38.2, .0072, -30.1, -.0055, .061],
  ["BIB", 61.2, .018, 21.1, .006, 2.2, .0006, .15],
  ["CIB", 4.2, .002, 9, .004, -3.3, -.0015, .02],
  ["ISP SLO", 2.6, .001, 8, .003, -1, -.0004, .01],
  ["ISP RO", -7.9, -.0133, 6, .01, -12.6, -.021, .033],
  ["ISP ALB", .3, .0004, 7, .009, -2.1, -.0028, .04],
  ["ISP BiH", 5.1, .011, .2, .0004, -4, -.0086, .05],
  ["Alex", -1.2, -.0021, .1, .0002, -3.2, -.0055, -.01],
  ["Eximbank", 0, 0, -.3, -.002, -.1, -.0007, 0],
  ["Pravex", -.4, -.0013, 0, 0, -.2, -.0006, .03],
];
const shownNum = (v: number) => (v < 0 ? "-" : "") + String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const shownPct = (v: number) => (v < 0 ? "-" : "") + (Math.round(Math.abs(v) * 1000) / 10).toFixed(1).replace(".", ",") + "%";
function grid(rows: R[] = SAMPLE, date = "25/09/26"): Grid {
  const c = (text: string, v: number | null, anchor = true, bold = false): GCell => ({ text, v, anchor, bold });
  const head = (row: string[]) => row.map((t, i) => c(t === "DATE" ? date : t, null, i === 0 || row[i - 1] !== t || t === "DATE"));
  return [head(H1), head(H2), ...rows.map((r, i) => [c(r[0], null, true, i === 0), c("1", 1), c("2", 2), c("3", 3),
    ...r.slice(1).map((v, k) => k % 2 === 0 && k < 6 ? c(shownNum(v as number), v as number) : c(shownPct(v as number), v as number))])];
}
const CFG: CommentCfg = { ...DEFAULT_COMMENT, mode: "macro", title: "Retail Loans" };
const write = (cfg: Partial<CommentCfg> = {}, g = grid()) => { const c = { ...CFG, ...cfg }; return writeMacro({ a: analyse(g), cfg: c, title: c.title! }); };
/** the text as the macro's text box holds it: the markup out (# / ## / ** / [[ ]]) */
const plain = (t: string) => t.split("\n").map(l => l.replace(/^#{1,2} /, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[\[([^\]]+)\]\]/g, "$1")).join("\n");

/** the sample at the top of the owner's code.docx (its text box's lines) */
const MACRO_SAMPLE = [
  "Retail Loans",
  "vs Budget - Budget Performance",
  "• Retail Loans as of week 25/09/26 are above Budget by +476, while recording a YoY change of +11,8% versus the same week in 2025. The strongest positive contributions versus Budget are recorded in VUB (+440, +3,5%), BIB (+61, +1,8%) and ISP BiH (+5, +1,1%). Budget outperformance is largely driven by VUB, which accounts for approximately 86% of total positive country contributions.",
  "• On the downside, the main negative deviations versus Budget are recorded in PBZ (-28, -0,5%), ISP RO (-8, -1,3%) and Alex (-1, -0,2%).",
  "vs Previous Week - Weekly Momentum",
  "• Retail Loans increased by +101 (+0,4%) versus the previous week. The strongest positive weekly contributions are recorded in PBZ (+38, +0,7%), BIB (+21, +0,6%) and VUB (+12, +0,1%).",
  "• No negative weekly contributions are recorded across the entities.",
];

describe("the macro's text (B50)", () => {
  it("the owner's sample, exactly: the same lines, and the macro's blank lines (Title, Subtitle, '', bullet, '', bullet, '', Subtitle, '' …)", () => {
    const t = write();
    expect(plain(t).split("\n").filter(Boolean)).toEqual(MACRO_SAMPLE);
    const [T, S1, B1, B2, S2, P1, P2] = MACRO_SAMPLE;
    expect(plain(t)).toBe([T, S1, "", B1, "", B2, "", S2, "", P1, "", P2].join("\n"));
  });
  it("the markup: title and headings, the title and names bold, every signed figure coloured by its sign (ColorSignedText)", () => {
    const t = write();
    expect(t.split("\n").slice(0, 2)).toEqual(["# Retail Loans", "## vs Budget - Budget Performance"]);
    expect(t).toContain("• **Retail Loans** as of week 25/09/26 are above Budget by [[+476]], while recording a YoY change of [[+11,8%]] versus the same week in 2025. The strongest positive contributions versus Budget are recorded in **VUB** ([[+440]], [[+3,5%]]), **BIB** ([[+61]], [[+1,8%]]) and **ISP BiH** ([[+5]], [[+1,1%]]). Budget outperformance is largely driven by **VUB**, which accounts for approximately 86% of total positive country contributions.");
    expect(t).toContain("• On the downside, the main negative deviations versus Budget are recorded in **PBZ** ([[-28]], [[-0,5%]]), **ISP RO** ([[-8]], [[-1,3%]]) and **Alex** ([[-1]], [[-0,2%]]).");
    expect(t).toContain("• **Retail Loans** increased by [[+101]] ([[+0,4%]]) versus the previous week.");
    // no unit after the amounts (the macro writes none) unless the comment sets one
    expect(shapeComment(t, CFG)).toBe(t);
    expect(shapeComment(t, { ...CFG, unit: "mln" })).toContain("[[+476 mln]]");
  });
});

describe("number formats and rounding (RoundedWhole, FormatSignedNumber, FormatSignedPercentage, Format 0%)", () => {
  it("Excel's ROUND half away from zero; Italian separators; zero unsigned", () => {
    expect([.5, 1.5, 2.5, -.5, -2.5, .49, -.49, 1.005 * 100].map(roundWhole)).toEqual([1, 2, 3, -1, -3, 0, 0, 101]);
    expect(signedNumber(1234.4)).toBe("+1.234"); expect(signedNumber(-1234567.6)).toBe("-1.234.568"); expect(signedNumber(.4)).toBe("0"); expect(signedNumber(-.4)).toBe("0");
    expect(signedPct(.118)).toBe("+11,8%"); expect(signedPct(-.0051)).toBe("-0,5%"); expect(signedPct(.0005)).toBe("+0,1%"); expect(signedPct(-.00125)).toBe("-0,1%"); expect(signedPct(0)).toBe("0,0%");
    expect(signedPct(.00004)).toBe("+0,0%");
    expect(wholePct(.8576)).toBe("86%"); expect(wholePct(.585)).toBe("59%");
  });
});

/** rows for a branch: total and entities' vs Budget abs / % and YoY (the other columns as the sample) */
const rows = (tot: [number, number], es: [string, number, number, number?][]): R[] => [["TOTAL RETAIL LOANS", tot[0], tot[1], 101.3, .0041, 0, 0, .05],
  ...es.map(([l, v, p, y]) => [l, v, p, 1, .001, 0, 0, y ?? .02] as R)];
const budget = (t: string) => t.split("## vs Previous Week")[0];

describe("every branch of the macro's Budget section", () => {
  it("below Budget: 'below Budget by -45'; the positives' concentration then reads 'Positive contributions are largely driven by'", () => {
    const t = plain(budget(write({}, grid(rows([-45, -.003], [["A", 30, .02], ["B", -60, -.03], ["C", -15, -.01]])))));
    expect(t).toContain("• Retail Loans as of week 25/09/26 are below Budget by -45, while recording a YoY change of +5,0% versus the same week in 2025. The strongest positive contributions versus Budget are recorded in A (+30, +2,0%). Positive contributions are largely driven by A, which accounts for approximately 100% of total positive country contributions.");
    // two negatives: joined by a comma (the macro's Case 2), the third would take "and"
    expect(t).toContain("• On the downside, the main negative deviations versus Budget are recorded in B (-60, -3,0%), C (-15, -1,0%).");
  });
  it("in line (the total rounds to 0): 'in line with Budget'; no positive: the first bullet stops after the YoY", () => {
    const t = plain(budget(write({}, grid(rows([.4, 0], [["A", -.2, 0], ["B", -2, -.001]])))));
    expect(t).toContain("• Retail Loans as of week 25/09/26 are in line with Budget, while recording a YoY change of +5,0% versus the same week in 2025.\n");
  });
  it("top 1 below 50 % but top 1 + 2 at least 70 %: 'largely concentrated in A and B, which together account for …'", () => {
    const t = plain(budget(write({}, grid(rows([100, .01], [["A", 45, .02], ["B", 35, .015], ["C", 10, .01], ["D", 10, .01]])))));
    expect(t).toContain("Budget outperformance is largely concentrated in A and B, which together account for approximately 80% of total positive country contributions.");
    const flat = plain(budget(write({}, grid(rows([100, .01], [["A", 40, .02], ["B", 20, .015], ["C", 20, .01], ["D", 20, .01]])))));
    expect(flat).not.toMatch(/largely/);
  });
  it("no negative: 'No negative deviations versus Budget are recorded across the entities.'", () => {
    expect(plain(budget(write({}, grid(rows([30, .01], [["A", 20, .02], ["B", 10, .01], ["C", .3, .001]])))))).toContain("• No negative deviations versus Budget are recorded across the entities.");
  });
  it("the alert (≤ -5 % among the named negatives, the worst %): with positive, negative and flat YoY; coloured", () => {
    const es = (y: number): [string, number, number, number?][] => [["A", 50, .02], ["B", -10, -.052, y], ["C", -20, -.07, y], ["D", -30, -.01]];
    expect(plain(budget(write({}, grid(rows([-10, 0], es(.021))))))).toContain("• On the downside, the main negative deviations versus Budget are recorded in D (-30, -1,0%), C (-20, -7,0%) and B (-10, -5,2%). C stands out on the downside, at -7,0% versus Budget, although volumes remain +2,1% YoY.");
    expect(plain(budget(write({}, grid(rows([-10, 0], es(-.013))))))).toContain("C stands out on the downside, at -7,0% versus Budget, with volumes also declining -1,3% YoY.");
    expect(plain(budget(write({}, grid(rows([-10, 0], es(0))))))).toContain("C stands out on the downside, at -7,0% versus Budget, with volumes broadly flat YoY.");
    expect(budget(write({}, grid(rows([-10, 0], es(-.013)))))).toContain("**C** stands out on the downside, at [[-7,0%]] versus Budget, with volumes also declining [[-1,3%]] YoY.");
    // -4,9 % is above the threshold: no alert; the threshold is the section's (here -4 %)
    const mild: [string, number, number, number?][] = [["A", 50, .02], ["B", -10, -.049]];
    expect(plain(budget(write({}, grid(rows([40, 0], mild)))))).not.toContain("stands out");
    expect(plain(budget(write({ sections: [{ g: "Δ vs. Budget", alert: -.04 }] }, grid(rows([40, 0], mild)))))).toContain("B stands out on the downside, at -4,9% versus Budget");
    // only among the named three: a fourth negative at -9 % does not count
    const four: [string, number, number, number?][] = [["A", -50, -.01], ["B", -40, -.01], ["C", -30, -.01], ["D", -5, -.09]];
    expect(plain(budget(write({}, grid(rows([-125, 0], four)))))).not.toContain("stands out");
  });
  it("the sort: the macro's exchange sort, highest first (not stable: A, B, C with B = A < C gives C, B, A); a positive with a negative % is written but not coloured", () => {
    const t = budget(write({}, grid(rows([30, 0], [["A", 10, -.001], ["B", 10, .01], ["C", 20, .01]]))));
    expect(t).toContain("recorded in **C** ([[+20]], [[+1,0%]]), **B** ([[+10]], [[+1,0%]]) and **A** ([[+10]], -0,1%)");
  });
});

describe("every branch of the weekly section", () => {
  const wk = (tot: [number, number], es: [string, number, number, number?][]): R[] => [["TOTAL RETAIL LOANS", 1, 0, tot[0], tot[1], 0, 0, .05],
    ...es.map(([l, v, p, y]) => [l, 1, 0, v, p, 0, 0, y ?? .02] as R)];
  const weekly = (t: string) => plain(t.split("## vs Previous Week - Weekly Momentum")[1] || "");
  it("decreased (with the minus sign, as the macro writes it); 'remained broadly in line'", () => {
    expect(weekly(write({}, grid(wk([-50.2, -.0021], [["A", -50.2, -.004]]))))).toContain("• Retail Loans decreased by -50 (-0,2%) versus the previous week.\n");
    expect(weekly(write({}, grid(wk([.3, 0], []))))).toContain("• Retail Loans remained broadly in line with the previous week.\n");
  });
  it("the concentration ('The weekly increase is largely driven by …'), the downside list and the -1 % WoW alert", () => {
    const t = weekly(write({}, grid(wk([60, .004], [["A", 70, .01], ["B", 5, .001], ["C", -15, -.012, -.02]]))));
    expect(t).toContain("• Retail Loans increased by +60 (+0,4%) versus the previous week. The strongest positive weekly contributions are recorded in A (+70, +1,0%), B (+5, +0,1%). The weekly increase is largely driven by A, which accounts for approximately 93% of total positive country contributions.");
    expect(t).toContain("• On the downside, the main negative weekly contributions are recorded in C (-15, -1,2%). C stands out on the downside, declining -1,2% WoW, with volumes also declining -2,0% YoY.");
    const d = weekly(write({}, grid(wk([-10, -.001], [["A", 70, .01], ["B", 5, .001], ["C", -85, -.005]]))));
    expect(d).toContain("Positive weekly contributions are largely driven by A, which accounts for approximately 93% of total positive country contributions.");
    expect(d).not.toContain("stands out");
  });
});

describe("modular sections and their rules (B50)", () => {
  const S = (x: Partial<CommentSection> & { g: string }): CommentSection => x;
  it("the period date: dd/mm/yy (as the analysis finds it), dd.mm.yyyy, ISO; none", () => {
    expect(periodDate({ period: { name: "Week39", date: "25/09/26" } })!.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(periodDate({ period: { name: "W1", date: "02.10.2026" } })!.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(periodDate({ period: { name: "2026-10-30", date: "" } })!.toISOString().slice(0, 10)).toBe("2026-10-30");
    expect(periodDate({ period: { name: "Week39", date: "" } })).toBeNull();
    expect(periodDate({ period: null })).toBeNull();
  });
  it("each rule at the start and the end of the month", () => {
    const d = (s: string) => periodDate({ period: { name: "", date: s } });
    const start = d("02/10/26"), mid = d("16/10/26"), end = d("30/10/26"), sepEnd = d("25/09/26"), sepBefore = d("18/09/26");
    const when = (w: CommentSection["when"], day?: number) => [start, mid, end, sepEnd, sepBefore].map(x => sectionApplies({ when: w, day }, x));
    expect(when(undefined)).toEqual([true, true, true, true, true]);
    expect(when("always")).toEqual([true, true, true, true, true]);
    // the last week: the next weekly date is in the next month (30 Sep: from the 24th; 31 Oct: from the 25th)
    expect(when("monthEnd")).toEqual([false, false, true, true, false]);
    expect(when("firstWeek")).toEqual([true, false, false, false, false]);
    expect(when("fromDay", 20)).toEqual([false, false, true, true, false]);
    expect(when("fromDay", 16)).toEqual([false, true, true, true, true]);
    // no date found: written
    expect(sectionApplies({ when: "monthEnd" }, null)).toBe(true);
  });
  it("Δ vs. monthly Budget only at the end of the month: written on 25/09/26, left out on 02/10/26; order as set", () => {
    const sections = [S({ g: "Δ vs. Budget" }), S({ g: "Δ vs. Prev. Week" }), S({ g: "Δ vs. EoM Budget", when: "monthEnd" })];
    const end = write({ sections }, grid(SAMPLE, "25/09/26")), start = write({ sections }, grid(SAMPLE, "02/10/26"));
    expect(end.match(/^## .*/gm)).toEqual(["## vs Budget - Budget Performance", "## vs Previous Week - Weekly Momentum", "## vs EoM Budget - Budget Performance"]);
    expect(plain(end)).toContain("• Retail Loans as of week 25/09/26 are below EoM Budget by -35, while recording a YoY change of +11,8% versus the same week in 2025. The strongest positive contributions versus EoM Budget are recorded in VUB (+20, +0,2%), BIB (+2, +0,1%). Positive contributions are largely driven by VUB, which accounts for approximately 90% of total positive country contributions.");
    expect(plain(end)).toContain("• On the downside, the main negative deviations versus EoM Budget are recorded in PBZ (-30, -0,6%), ISP RO (-13, -2,1%) and ISP BiH (-4, -0,9%).");
    expect(start.match(/^## .*/gm)).toEqual(["## vs Budget - Budget Performance", "## vs Previous Week - Weekly Momentum"]);
    expect(start).toContain("as of week 02/10/26");
    // reordered, the weekly section first; the Budget section from day 20 only
    const re = write({ sections: [S({ g: "Δ vs. Prev. Week" }), S({ g: "Δ vs. Budget", when: "fromDay", day: 20 })] }, grid(SAMPLE, "02/10/26"));
    expect(re.match(/^## .*/gm)).toEqual(["## vs Previous Week - Weekly Momentum"]);
  });
  it("per-section switches: heading, no YoY clause, no concentration, no downside bullet, no alert, top 2", () => {
    const t = plain(write({ sections: [S({ g: "Δ vs. Budget", heading: "Budget", yoy: false, share: false, down: false, top: 2 })] }));
    expect(t).toBe("Retail Loans\nBudget\n\n• Retail Loans as of week 25/09/26 are above Budget by +476. The strongest positive contributions versus Budget are recorded in VUB (+440, +3,5%) and BIB (+61, +1,8%).");
    const es: [string, number, number, number?][] = [["A", 50, .02], ["C", -20, -.07]];
    expect(plain(write({ sections: [S({ g: "Δ vs. Budget", flag: false })] }, grid(rows([30, 0], es))))).not.toContain("stands out");
  });
  it("no section ticked (an empty list): the title only", () => {
    expect(write({ sections: [] })).toBe("# Retail Loans");
  });
  it("the default sections (no `sections`): the plan comparison and the week, as the macro", () => {
    expect(write({ sections: undefined }).match(/^## .*/gm)).toEqual(["## vs Budget - Budget Performance", "## vs Previous Week - Weekly Momentum"]);
  });
});

/* ---- the deck: the guard, and the export of a macro comment (PDF, PowerPoint) ---- */
describe("saved in the deck (B50): the key, undo, the format guard; comments made before keep their settings", () => {
  const preset = (): Preset => ({ sheets: ["S"], tables: [{ id: "t1", sheet: "S", kind: "range", range: "A1:K14" } as never], slides: [{ id: "s1", type: "content", tables: ["t1"], title: "Loans" } as never] });
  const OLD: CommentCfg = { ...DEFAULT_COMMENT, mode: "summary" };
  const MACRO: CommentCfg = { ...CFG, sections: [{ g: "Δ vs. Budget" }, { g: "Δ vs. EoM Budget", when: "monthEnd", yoy: false }] };   // (as the dialog adds a second plan section)
  const SP = (notes: Record<string, Note | null>): Op => ({ op: "slide.patch", id: "s1", patch: { notes } } as Op);
  const n = (auto: CommentCfg): Note => ({ text: "", auto, w: 440 });
  it("each change one undo step (the inverse puts back the whole entry); known to this page", () => {
    const d = { preset: preset(), style: {}, edits: {} };
    for (const op of [SP({ "t1:right": n(OLD) }), SP({ "t1:right": n(MACRO) }), SP({ "t1:right": n({ ...MACRO, sections: [{ g: "Δ vs. Prev. Week", alert: -.02 }] }) }), SP({ "t1:right": null })]) {
      expect(knownOp(op)).toBe(true);
      const before = structuredClone(d), inv = inverseOf(d, op)!;
      expect(applyOp(d, op)).toBe(true);
      const after = structuredClone(d);
      expect(applyOp(d, inv)).toBe(true); expect(d).toEqual(before);
      applyOp(d, op); expect(d).toEqual(after);
    }
  });
  it("a macro comment (mode or sections) is format 5 – 4.0.0 would write it as a summary; the comments made before are not", () => {
    for (const a of [MACRO, { ...CFG, sections: undefined }, { ...OLD, sections: [{ g: "x" }] }]) expect(needsV5(SP({ "t1:right": n(a) })), JSON.stringify(a)).toBe(true);
    for (const a of [OLD, { ...OLD, mode: "sections" as const }, { ...DEFAULT_COMMENT, mode: undefined }]) expect(needsV5(SP({ "t1:right": n(a) })), JSON.stringify(a)).toBe(false);
    const d = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: preset() } as Op]).doc;
    expect(docNeedsV5(applyOps(d, [SP({ "t1:right": n(OLD) })]).doc)).toBe(false);
    expect(docNeedsV5(applyOps(d, [SP({ "t1:right": n(MACRO) })]).doc)).toBe(true);
    expect(docNeedsV5(applyOps(d, [SP({ "t1:right": n(MACRO) }), SP({ "t1:right": n(OLD) })]).doc)).toBe(false);
    const p = preset(); (p.slides[0] as { notes?: object }).notes = { "t1:right": n(MACRO) };
    expect(needsV5({ op: "preset.set", preset: p } as Op)).toBe(true);
  });
});

/** the sample as an .xlsx: the macro's columns (label, weeks, EoM Budget, Δ vs. Budget Abs. / %, Δ vs. Prev. Week, Δ vs.
    EoM Budget, Δ YoY %), raw values behind "#,##0" / "0.0%" formats, merged group headers, the total row bold */
function sampleWorkbook(date = "25/09/26"): ArrayBuffer {
  const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", COLS = "ABCDEFGHIJK";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const str = (ref: string, t: string, s = 0) => `<c r="${ref}" t="inlineStr" s="${s}"><is><t>${esc(t)}</t></is></c>`;
  const num = (ref: string, v: number, s: number) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  const head = (row: string[], r: number) => `<row r="${r}">` + row.map((t, i) => i > 0 && row[i - 1] === t && t !== "DATE" ? "" : str(COLS[i] + r, t === "DATE" ? date : t, 3)).join("") + "</row>";
  const body = SAMPLE.map((x, i) => { const r = i + 3, b = i === 0;
    return `<row r="${r}">` + str("A" + r, x[0], b ? 3 : 0) + num("B" + r, 1000 + i, 1) + num("C" + r, 1100 + i, 1) + num("D" + r, 1200 + i, 1)
      + x.slice(1).map((v, k) => num(COLS[4 + k] + r, v as number, k % 2 === 0 && k < 6 ? 1 : 2)).join("") + "</row>"; }).join("");
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Loans" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>`
      + `<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
      + `<borders count="1"><border/></borders><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetData>${head(H1, 1)}${head(H2, 2)}${body}</sheetData><mergeCells count="5"><mergeCell ref="A1:A2"/><mergeCell ref="D1:D2"/><mergeCell ref="E1:F1"/><mergeCell ref="G1:H1"/><mergeCell ref="I1:J1"/></mergeCells></worksheet>`,
  });
}

/* the export's path: the core worker (a deck in memory) and an export worker linked to it (as note-frame.test.ts) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };
const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fonts");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
async function open(buf: ArrayBuffer, preset: Preset) {
  const deck = new FakeDeck("isp.xlsx-0123456789", "isp.xlsx"), api = deck.api(), [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key, x.format));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf }, []));
  await port.call("start", { name: "isp.xlsx", deck: deck.open("anna@pc#aaaaaaaa"), preset, inputs: { defaults: {}, logoSrc: "", version: "", workbook: "isp.xlsx" }, stage: { slide: 0, known: [] } });
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  const fonts: Record<string, Uint8Array> = { "Carlito-Regular.ttf": new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Regular.ttf"))), "Carlito-Bold.ttf": new Uint8Array(fs.readFileSync(path.join(FONTS, "Carlito-Bold.ttf"))) };
  page.handle("fontFile", x => { const g = fonts[x.file]; return g ? g.slice().buffer as ArrayBuffer : null; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: "1 October 2026", pptx: true });
  const sys = (file: string, weight: number): CatalogFont => ({ source: "system", file, family: "Arial", weight, italic: false });
  const run = (kind: "pptx" | "pdf", design: Design) =>
    page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: "1 October 2026", scale: 1, title: "Report", catalog: [sys("Carlito-Regular.ttf", 400), sys("Carlito-Bold.ttf", 700)] });
  return { lists, run };
}
const texts = (ns: Node[]): Extract<Node, { t: "text" }>[] => ns.flatMap(x => x.t === "text" ? [x] : x.t === "group" ? texts(x.children) : []);

describe("a macro comment in every design, exported (B50): PDF and PowerPoint", () => {
  const DESIGNS: Design[] = ["excel", "clean", "glass", "mckinsey", "bain"];
  const auto: CommentCfg = { ...CFG, sections: [{ g: "Δ vs. Budget" }, { g: "Δ vs. Prev. Week" }, { g: "Δ vs. EoM Budget", when: "monthEnd", yoy: false }] };   // (as the dialog adds a second plan section)
  const deckPreset = (): Preset => ({ sheets: ["Loans"], tables: [{ id: "t1", sheet: "Loans", kind: "range", range: "A1:K14" } as never],
    slides: [{ id: "s1", type: "content", tables: ["t1"], title: "Retail Loans", notes: { "t1:bottom": { text: "", auto, h: 330, frame: { w: 1, color: "#C8C8C8" } } } } as never] });
  it("the text of the sample (and the month-end section on 25/09/26) with its bullets, bold names and coloured figures; native text in PowerPoint", async () => {
    const h = await open(sampleWorkbook(), deckPreset());
    for (const design of DESIGNS) {
      const dl = (await h.lists(design))[0].dl.nodes, all = texts(dl).map(t => t.src).join(" ");
      // (a consulting design writes its headings in capitals, its own bullet glyph)
      for (const s of ["vs Budget - Budget Performance", "vs Previous Week - Weekly Momentum", "vs EoM Budget - Budget Performance", "+476", "+11,8%", "86%"]) expect(all.toLowerCase(), `${design}: ${s}`).toContain(s.toLowerCase());
      // the figures green / red, bold; the names bold
      const fig = (s: string) => texts(dl).filter(t => t.src.trim() === s).pop();               // (the comment's, after the table's cells)
      const p = fig("+476"), m = fig("-28"), plainRun = texts(dl).find(t => /above Budget by/.test(t.src));
      expect(p && (p.b || (p.weight ?? 0) >= 700), design).toBe(true); expect(m && (m.b || (m.weight ?? 0) >= 700), design).toBe(true);
      expect(JSON.stringify(p!.fill), design).not.toBe(JSON.stringify(m!.fill));
      expect(JSON.stringify(p!.fill), design).not.toBe(JSON.stringify(plainRun!.fill));
      const r1 = await h.run("pptx", design), z = unzipSync(new Uint8Array(r1.files[0])), xml = strFromU8(z["ppt/slides/slide1.xml"]);
      keep(`b50-comment-${design}.pptx`, r1.files[0]);
      expect(xml, design).not.toContain("<p:pic>");
      expect(xml, design).not.toContain("p:cxnSp");
      const runs = xml.split("<a:r>").slice(1).map(r => r.split("</a:r>")[0]).map(r => ({ attrs: /<a:rPr([^>]*?)\/?>/.exec(r)?.[1] ?? "", inner: r, t: /<a:t>([^<]*)<\/a:t>/.exec(r)?.[1] ?? "" }));
      const plainXml = runs.map(r => r.t).join("");
      for (const s of ["Retail Loans", "above Budget by", "+476", "+11,8%", "versus the same week in 2025", "86%", "No negative weekly contributions are recorded across the entities."]) expect(plainXml, `${design}: ${s}`).toContain(s);
      const run476 = runs.find(r => r.t === "+476")!, run28 = runs.filter(r => r.t === "-28").pop()!;
      expect(run476.attrs, design).toContain('b="1"'); expect(run28.attrs, design).toContain('b="1"');
      const colorOf = (r: { inner: string }) => /srgbClr val="([0-9A-F]{6})"/.exec(r.inner)?.[1];
      expect(colorOf(run476), design).toBeTruthy(); expect(colorOf(run28), design).toBeTruthy(); expect(colorOf(run476), design).not.toBe(colorOf(run28));
      const pdf = await h.run("pdf", design);
      keep(`b50-comment-${design}.pdf`, pdf.files[0]);
      expect(pdf.unreadable ?? [], design).toEqual([]);
    }
  }, 240_000);
  it("on 02/10/26 the month-end section is left out", async () => {
    const h = await open(sampleWorkbook("02/10/26"), deckPreset());
    const all = texts((await h.lists("excel"))[0].dl.nodes).map(t => t.src).join(" ");
    expect(all).toContain("vs Budget - Budget Performance");
    expect(all).not.toContain("vs EoM Budget");
  }, 60_000);
});

/* ---- B50 review fixes ---- */
describe("B50 review fixes: YoY without %, 'week' only from the header, the title, a second plan section, the alert", () => {
  /** the grid with the YoY column an amount ("Δ YoY" / "Abs.", e.g. +1.200) instead of a % */
  const absYoy = (g = grid()) => {
    g[1][10] = { ...g[1][10], text: "Abs." };
    for (const r of g.slice(2)) r[10] = { ...r[10], v: r[10].v! * 10000, text: shownNum(r[10].v! * 10000) };
    return g;
  };
  it("a YoY comparison with an amount only: no YoY clause, no YoY in the alert (not '+120000,0%')", () => {
    const t = plain(write({}, absYoy()));
    expect(t).not.toMatch(/YoY|%\s*versus the same/);
    expect(t).toContain("• Retail Loans as of week 25/09/26 are above Budget by +476. The strongest positive contributions");
    const es: [string, number, number, number?][] = [["A", 50, .02], ["C", -20, -.07, .45]];
    const al = plain(budget(write({}, absYoy(grid(rows([30, 0], es))))));
    expect(al).toContain("C stands out on the downside, at -7,0% versus Budget.");
    expect(al).not.toContain("4500");
  });
  it("'week' only when the period's header says so: a monthly column with a date reads 'as of 30/09/26 … the same period in 2025'", () => {
    const g = grid(SAMPLE, "30/09/26"); g[0][2] = { ...g[0][2], text: "Sep" };
    const t = plain(write({}, g));
    expect(t).toContain("• Retail Loans as of 30/09/26 are above Budget by +476, while recording a YoY change of +11,8% versus the same period in 2025.");
    expect(t).not.toMatch(/\bweek 30\/09|same week/);
    // the owner's header ("Week39") still reads "week"
    expect(plain(write())).toContain("as of week 25/09/26 are above Budget by +476, while recording a YoY change of +11,8% versus the same week in 2025.");
  });
  it("the title with none typed: the total row's label without 'Total' / 'Totale' (the macro's 'Retail Loans')", () => {
    const a = analyse(grid());
    expect(macroTitle(a, {}, "Loans")).toBe("Retail Loans");
    expect(macroTitle(a, { title: "  " }, "Loans")).toBe("Retail Loans");
    expect(macroTitle(a, { title: "Mutui" }, "Loans")).toBe("Mutui");
    expect(macroTitleFallback({ total: { label: "TOTALE IMPIEGHI" } as never }, "x")).toBe("Impieghi");
    expect(macroTitleFallback({ total: { label: "Tot. Retail loans" } as never }, "x")).toBe("Retail loans");
    expect(macroTitleFallback({ total: { label: "TOTAL" } as never }, "x")).toBe("Total");
    expect(macroTitleFallback({ total: null }, "Total deposits")).toBe("deposits");
    expect(macroTitleFallback({ total: { label: "Totalizer" } as never }, "x")).toBe("Totalizer");
  });
  it("a new comment as the dialog starts it (default sections, no title typed) writes the owner's sample exactly", () => {
    const a = analyse(grid());
    const cfg: CommentCfg = { ...DEFAULT_COMMENT, mode: "macro", sections: defaultSections(a), groups: defaultGroups(a) };
    expect(cfg.title).toBeUndefined();
    expect(defaultSections(a)).toEqual([{ g: "Δ vs. Budget" }, { g: "Δ vs. Prev. Week" }]);
    const t = writeMacro({ a, cfg, title: macroTitle(a, cfg, "Loans") });
    expect(plain(t).split("\n").filter(Boolean)).toEqual(MACRO_SAMPLE);
  });
  it("a plan section added after another one leaves out the YoY clause (said once); other sections keep it", () => {
    const a = analyse(grid());
    const on = defaultSections(a);
    expect(newSection(a, on, "Δ vs. EoM Budget")).toEqual({ g: "Δ vs. EoM Budget", yoy: false });
    expect(newSection(a, [{ g: "Δ vs. Prev. Week" }], "Δ vs. EoM Budget")).toEqual({ g: "Δ vs. EoM Budget" });
    expect(newSection(a, [{ g: "Δ vs. EoM Budget" }], "Δ vs. Prev. Week")).toEqual({ g: "Δ vs. Prev. Week" });
    const t = plain(write({ sections: [...on, newSection(a, on, "Δ vs. EoM Budget")] }));
    expect(t.match(/while recording a YoY change/g)).toHaveLength(1);
    expect(t).toContain("• Retail Loans as of week 25/09/26 are below EoM Budget by -35. The strongest positive contributions versus EoM Budget");
  });
  it("a positive alert threshold is not used (saved by hand or by an old page): the macro's -5 % applies", () => {
    expect([.02, 0, -.03, undefined, NaN].map(cleanAlert)).toEqual([undefined, 0, -.03, undefined, undefined]);
    const es: [string, number, number, number?][] = [["A", 50, .02], ["B", -10, -.049], ["C", -5, -.01]];
    expect(plain(write({ sections: [{ g: "Δ vs. Budget", alert: .02 }] }, grid(rows([35, 0], es))))).not.toContain("stands out");
  });
});
