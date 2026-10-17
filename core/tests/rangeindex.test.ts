/* A:INDEX(…) ranges rewritten as OFFSET (M8, the product owner's real deck, 2026-10-18): IronCalc builds no range that
   ends where INDEX points; the OFFSET form is the same range. */
import { describe, expect, it, beforeAll } from "vitest";
import { rewriteRangeIndex } from "../src/calc/rangeindex";
import { loadEngine } from "../src/calc/engine";

describe("A:INDEX(R, i, j) → OFFSET(A, 0, 0, h, w)", () => {
  it("the deck's forms", () => {
    expect(rewriteRangeIndex("SUM(D7:INDEX(D7:O7,1,MATCH($F$3,$D$6:$O$6,0)))")).toBe("SUM(OFFSET(D7,0,0,(1),(MATCH($F$3,$D$6:$O$6,0))))");
    expect(rewriteRangeIndex("IFERROR(SUM(D7:INDEX(D7:O7,1,MATCH($F$3,$D$6:$O$6,0))),\"\")")).toContain("OFFSET(D7,0,0,(1),(MATCH(");
    // INDEX with one index over a row / a column; A before R's start; a sheet prefix kept
    expect(rewriteRangeIndex("SUM(B2:INDEX(C2:H2,3))")).toBe("SUM(OFFSET(B2,0,0,(1),(3)+1))");
    expect(rewriteRangeIndex("SUM(B2:INDEX(B3:B9,k))")).toBe("SUM(OFFSET(B2,0,0,(k)+1,(1)))");
    expect(rewriteRangeIndex("SUM(Data!$A$2:INDEX(Data!$A$2:$A$99,N))")).toBe("SUM(OFFSET(Data!$A$2,0,0,(N),(1)))");
    expect(rewriteRangeIndex("SUM(D7:INDEX(D7:O7,1,2))+SUM(D8:INDEX(D8:O8,1,3))")).toBe("SUM(OFFSET(D7,0,0,(1),(2)))+SUM(OFFSET(D8,0,0,(1),(3)))");
  });
  it("left as written: other sheets, 2-D with one index, a 0 index, inside a string, no INDEX", () => {
    for (const f of ["SUM(A1:INDEX(Data!A1:A9,3))", "SUM(A1:INDEX(A1:C9,3))", "SUM(A1:INDEX(A1:C9,0,2))", '"A1:INDEX(A1:C1,1,2)"', "SUM(A1:B2)", "INDEX(A1:C1,1,2)"])
      expect(rewriteRangeIndex(f), f).toBe(f);
  });
});

describe("the rewritten range computes as Excel's", () => {
  let g: Awaited<ReturnType<typeof loadEngine>>;
  beforeAll(async () => { g = await loadEngine(); }, 60_000);
  it("from January to the chosen month", () => {
    const m = new g.Model("sb", "en", "UTC", "en");
    for (let c = 1; c <= 6; c++) m.setUserInput(0, 1, c, String(c * 10));
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].forEach((t, i) => m.setUserInput(0, 2, i + 1, "'" + t));
    m.setUserInput(0, 3, 1, "'Mar");
    m.setUserInput(0, 4, 1, "=" + rewriteRangeIndex("SUM(A1:INDEX(A1:F1,1,MATCH(A3,A2:F2,0)))"));
    m.setUserInput(0, 4, 2, "=" + rewriteRangeIndex("SUM(A1:INDEX(A1:F1,MATCH(A3,A2:F2,0)))"));
    m.setUserInput(0, 4, 3, "=" + rewriteRangeIndex("SUM(B1:INDEX(A1:F1,1,4))"));
    m.evaluate();
    expect([1, 2, 3].map(c => m.getFormattedCellValue(0, 4, c))).toEqual(["60", "60", "90"]);
    m.free();
  }, 60_000);
});

describe("INDEX(R, …):INDEX(R, …) → OFFSET", () => {
  it("the deck's LET form; one index over a row; left as written over two ranges", () => {
    expect(rewriteRangeIndex("SUM(INDEX(D:Q,r,1):INDEX(D:Q,r,MATCH(F3,D6:O6,0)))")).toBe("SUM(INDEX(D:Q,r,1):INDEX(D:Q,r,MATCH(F3,D6:O6,0)))");   // whole columns: RANGE needs cells
    expect(rewriteRangeIndex("SUM(INDEX(Data!$F$2:$Q$1000,r,1):INDEX(Data!$F$2:$Q$1000,r,MATCH($F$3,$D$6:$O$6,0)))"))
      .toBe("SUM(OFFSET(Data!$F$2,(r)-1,(1)-1,(r)-(r)+1,(MATCH($F$3,$D$6:$O$6,0))-(1)+1))");
    expect(rewriteRangeIndex("SUM(INDEX(B2:H2,2):INDEX(B2:H2,4))")).toBe("SUM(OFFSET(B2,(1)-1,(2)-1,(1)-(1)+1,(4)-(2)+1))");
    expect(rewriteRangeIndex("SUM(INDEX(A1:A9,2):INDEX(B1:B9,4))")).toBe("SUM(INDEX(A1:A9,2):INDEX(B1:B9,4))");
  });
  it("computes the range between the two", async () => {
    const g = await loadEngine(), m = new g.Model("sb", "en", "UTC", "en");
    for (let c = 1; c <= 6; c++) { m.setUserInput(0, 1, c, String(c)); m.setUserInput(0, 2, c, String(c * 10)); }
    m.setUserInput(0, 3, 1, "=" + rewriteRangeIndex("SUM(INDEX(A1:F2,2,2):INDEX(A1:F2,2,4))"));
    m.setUserInput(0, 3, 2, "=" + rewriteRangeIndex("SUM(INDEX(A1:F1,2):INDEX(A1:F1,5))"));
    m.evaluate();
    expect([1, 2].map(c => m.getFormattedCellValue(0, 3, c))).toEqual(["90", "14"]);
    m.free();
  }, 60_000);
});
