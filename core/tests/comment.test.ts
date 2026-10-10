import { describe, expect, it } from "vitest";
import { analyse, defaultGroups, parseNum, shapeComment, signatureOf, writeComment, writeSummary, DEFAULT_COMMENT, type Grid } from "../src/model/comment";

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
    const t = writeComment(analyse(grid()), { ...DEFAULT_COMMENT, top: 3, title: "Retail Loans" });
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

/* one registered table with two sub-tables, like "RETAIL LOANS (1)" + countries, "LEGAL ENTITIES LOANS (1)" + countries */
const SUB_H1 = ["", "Stock", "Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. Prev. Week", "Δ vs. EoM Aug 2026"];
const SUB_H2 = ["", "25/09/26", "Abs.", "Abs.", "%", "Abs."];
const SUB = [
  ["RETAIL LOANS (1)", "1000", "476", "101", "0,8%", "454"],
  ["VUB", "400", "440", "70", "1,0%", "300"], ["PBZ", "300", "61", "38", "1,2%", "100"], ["BIB", "300", "-25", "-7", "-0,2%", "54"],
  ["LEGAL ENTITIES LOANS (1)", "2000", "-120", "-40", "-0,1%", "-30"],
  ["VUB", "900", "-150", "-38", "-0,4%", "-20"], ["PBZ", "600", "40", "-6", "-0,1%", "-15"], ["BIB", "500", "-10", "4", "0,1%", "5"],
];
function subGrid(): Grid {
  const cell = (t: string, anchor = true, bold = false) => ({ text: t, v: anchor ? parseNum(t) : null, anchor, bold });
  const head = (row: string[]) => row.map((t, i) => cell(t, i === 0 || row[i - 1] !== t));
  return [head(SUB_H1), head(SUB_H2), ...SUB.map(r => r.map((t, j) => cell(t, true, j === 0 && /LOANS/.test(r[0]))))];
}

describe("summary comments", () => {
  it("finds the sub-tables of one table", () => {
    const a = analyse(subGrid());
    expect(a.blocks.map(b => [b.head?.label, b.rows.map(r => r.label).join(",")])).toEqual([["RETAIL LOANS (1)", "VUB,PBZ,BIB"], ["LEGAL ENTITIES LOANS (1)", "VUB,PBZ,BIB"]]);
  });
  it("one short paragraph per block: week + Budget + EoM, how good, who drives it, no dates", () => {
    const t = writeSummary([{ a: analyse(subGrid()), name: "Loans" }], DEFAULT_COMMENT, "Loans");
    expect(t).toBe([
      "# Loans",
      "• **Retail Loans**: [[+101]] ([[+0,8%]]) w/w · [[+476]] vs Budget · [[+454]] vs EoM Aug. Solid week, mostly from **VUB** ([[+70]]) (69%); **BIB** ([[-7]]) goes the other way. Above Budget mainly thanks to **VUB** ([[+440]]) and **PBZ** ([[+61]]).",
      "",
      "• **Legal Entities Loans**: [[-40]] ([[-0,1%]]) w/w · [[-120]] vs Budget · [[-30]] vs EoM Aug. Slightly negative week, mostly due to **VUB** ([[-38]]) (95%); **BIB** ([[+4]]) goes the other way. Below Budget mainly because of **VUB** ([[-150]]) and **BIB** ([[-10]]).",
    ].join("\n"));
    expect(t).not.toMatch(/25\/09|week 2/);
  });
  it("the week against the plan; tables joined into one comment", () => {
    const g = subGrid(); g[2 + 4][3] = { text: "60", v: 60, anchor: true, bold: false };     // legal entities: +60 w/w while below budget
    const t = writeSummary([{ a: analyse(g), name: "Loans" }, { a: analyse(grid()), name: "Banks" }], DEFAULT_COMMENT, "Loans & Deposits");
    expect(t).toContain("The week closes 33% of the gap to Budget.");
    expect(t).toContain("• **Total Banks Loans**:");                       // the second table's block
    expect(t.split("\n").filter(l => l.startsWith("•")).length).toBe(3);
  });
});

describe("comment layout options", () => {
  it("a single block does not repeat the title; title, names and bullets can be switched off", () => {
    const one = writeSummary([{ a: analyse(grid()), name: "Banks" }], DEFAULT_COMMENT, "Total Banks Loans");
    expect(one.split("\n")[0]).toBe("# Total Banks Loans");
    expect(one.split("\n")[1]).toMatch(/^• \[\[\+101\]\]/);                                  // straight to the numbers
    const two = writeSummary([{ a: analyse(subGrid()), name: "Loans" }], { ...DEFAULT_COMMENT, names: false }, "Loans");
    expect(two).not.toContain("**Retail Loans**:");
    const bare = shapeComment(two, { ...DEFAULT_COMMENT, showTitle: false, bullets: false });
    expect(bare.startsWith("[[+101 mln]]")).toBe(true);
    expect(bare).not.toMatch(/^# |^• /m);
  });
  it("amounts get the unit (mln by default), percentages and amounts with a unit stay", async () => {
    const { withUnit } = await import("../src/model/comment");
    expect(shapeComment("Up [[+476]] ([[+2,1%]]), [[-0,5 pp]]", DEFAULT_COMMENT)).toBe("Up [[+476 mln]] ([[+2,1%]]), [[-0,5 pp]]");
    expect(shapeComment("Up [[+476]]", { ...DEFAULT_COMMENT, unit: "bn" })).toBe("Up [[+476 bn]]");
    expect(shapeComment("Up [[+476]]", { ...DEFAULT_COMMENT, unit: "" })).toBe("Up [[+476]]");
    expect(withUnit("+2,0 m", "mln")).toBe("+2,0 m");
    expect(withUnit("-1.234", "mln")).toBe("-1.234 mln");
  });
});
