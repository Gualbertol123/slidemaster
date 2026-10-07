import { describe, expect, it } from "vitest";
import { analyse, defaultGroups, parseNum, signatureOf, writeComment, DEFAULT_COMMENT, type Grid } from "../src/model/comment";

/* the weekly loans table: merged group headers over Abs./% columns, a total row, entities, empty budget cells */
const H1 = ["(mln Euro at last fixed exchange rate)", "Week37", "Week38", "Week39", "Eom Budget", "Δ vs. Budget", "Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. Prev. Week", "Δ vs. BoY", "Δ vs. BoY"];
const H2 = ["(mln Euro at last fixed exchange rate)", "11/09/26", "18/09/26", "25/09/26", "Eom Budget", "Abs.", "%", "Abs.", "%", "Abs.", "%"];
const ROWS = [
  ["TOTAL BANKS LOANS", "54.555", "38", "46", "226.656", "476", "3,5%", "101", "21,1%", "444.444", "-99,9%"],
  ["VUB", "5", "4", "4", "5", "440", "20,0%", "12", "0,0%", "", "-100,0%"],
  ["PBZ", "6", "3", "5", "6", "-28", "-0,5%", "38", "66,7%", "55.555", "-100,0%"],
  ["BIB", "7", "2", "1", "4", "61", "1,8%", "21", "-50,0%", "", "-100,0%"],
  ["Alex", "8", "1", "3", "2", "-1", "-0,2%", "0", "200,0%", "", "-99,8%"],
  ["ISP RO", "11", "3", "2", "1", "-8", "-1,3%", "0", "-33,3%", "", "-99,9%"],
  ["ISP BiH", "13", "5", "5", "4", "5", "1,1%", "0", "0,0%", "", "-99,5%"],
  ["EximBank", "14", "6", "4", "3", "", "", "0", "-33,3%", "", "-97,7%"],
  ["Pravex", "15", "7", "9", "6", "", "", "0", "28,6%", "", "-79,3%"],
];
function grid(): Grid {
  const cell = (t: string, anchor = true, bold = false) => ({ text: t, v: anchor ? parseNum(t) : null, anchor, bold });
  const head = (row: string[]) => row.map((t, i) => cell(t, i === 0 || row[i - 1] !== t));
  return [head(H1), head(H2), ...ROWS.map((r, i) => r.map(t => cell(t, true, i === 0)))];
}

describe("automated comments", () => {
  it("numbers as Excel shows them", () => {
    expect(parseNum("54.555")).toBe(54555);
    expect(parseNum("-226.623")).toBe(-226623);
    expect(parseNum("1.234,5")).toBe(1234.5);
    expect(parseNum("-20,0%")).toBeCloseTo(-.2);
    expect(parseNum("(3)")).toBe(-3);
    expect(parseNum("Week37")).toBeNull();
  });
  it("finds total, entities, period and comparison groups", () => {
    const a = analyse(grid());
    expect(a.total?.label).toBe("TOTAL BANKS LOANS");
    expect(a.entities.map(e => e.label)).toEqual(["VUB", "PBZ", "BIB", "Alex", "ISP RO", "ISP BiH", "EximBank", "Pravex"]);
    expect(a.period).toEqual({ name: "Week39", date: "25/09/26" });
    expect(a.groups.map(g => [g.name, g.kind, g.abs, g.pct])).toEqual([["vs Budget", "target", 5, 6], ["vs Prev. Week", "week", 7, 8], ["vs BoY", "year", 9, 10]]);
    expect(defaultGroups(a)).toEqual(["Δ vs. Budget", "Δ vs. Prev. Week"]);
    expect(signatureOf(a)).toBe("δ vs. budget|δ vs. prev. week|δ vs. boy");
  });
  it("writes the budget and weekly sections like the report", () => {
    const t = writeComment(analyse(grid()), { ...DEFAULT_COMMENT, title: "Retail Loans" });
    expect(t).toContain("# Retail Loans");
    expect(t).toContain("## vs Budget – Budget Performance");
    expect(t).toContain("• **Retail Loans** as of week 25/09/26 are above Budget by [[+476]] ([[+3,5%]]). The strongest positive contributions versus Budget are recorded in **VUB** ([[+440]], [[+20,0%]]), **BIB** ([[+61]], [[+1,8%]]) and **ISP BiH** ([[+5]], [[+1,1%]]).");
    expect(t).toContain("largely driven by **VUB**, which accounts for approximately 87% of total positive country contributions");
    expect(t).toContain("• On the downside, the main negative deviations versus Budget are recorded in **PBZ** ([[-28]], [[-0,5%]]), **ISP RO** ([[-8]], [[-1,3%]]) and **Alex** ([[-1]], [[-0,2%]]).");
    expect(t).toContain("No Budget data is available for **EximBank** and **Pravex**.");
    expect(t).toContain("## vs Prev. Week – Weekly Momentum");
    expect(t).toContain("• **Retail Loans** increased by [[+101]] ([[+21,1%]]) versus the previous week. The strongest positive contributions are recorded in **PBZ** ([[+38]], [[+66,7%]]), **BIB** ([[+21]], [[-50,0%]]) and **VUB** ([[+12]], [[0,0%]]).");
    expect(t).toContain("No material negative country contribution was recorded during the week, with the remaining countries broadly stable or positive.");
    expect(t).not.toContain("BoY");
  });
  it("options: fewer names, a materiality threshold, excluded rows, short", () => {
    const t = writeComment(analyse(grid()), { ...DEFAULT_COMMENT, groups: ["Δ vs. Budget"], top: 1, minAbs: 5, exclude: ["VUB"], noun: "bank", detail: "short" });
    expect(t).toContain("# Total Banks Loans");
    expect(t).toContain("recorded in **BIB** ([[+61]], [[+1,8%]]).");
    expect(t).toContain("negative deviations versus Budget are recorded in **PBZ**");
    expect(t).not.toContain("Alex");                 // -1 is below the threshold
    expect(t).not.toContain("largely driven");
    expect(t).not.toContain("Weekly");
  });
});
