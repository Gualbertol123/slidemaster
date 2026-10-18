/* A:INDEX(…) ranges rewritten as OFFSET (M8, the product owner's real deck, 2026-10-18): IronCalc builds no range that
   ends where INDEX points; the OFFSET form is the same range. */
import { describe, expect, it, beforeAll } from "vitest";
import { rewriteRangeIndex } from "../src/calc/rangeindex";
import { loadEngine } from "../src/calc/engine";

describe("A:INDEX(R, i, j) → OFFSET(A, MIN(0,dr), MIN(0,dc), ABS(dr)+1, ABS(dc)+1)", () => {
  it("the deck's forms", () => {
    expect(rewriteRangeIndex("SUM(D7:INDEX(D7:O7,1,MATCH($F$3,$D$6:$O$6,0)))"))
      .toBe("SUM(OFFSET(D7,MIN(0,(1)-1),MIN(0,(MATCH($F$3,$D$6:$O$6,0))-1),ABS((1)-1)+1,ABS((MATCH($F$3,$D$6:$O$6,0))-1)+1))");
    expect(rewriteRangeIndex("IFERROR(SUM(D7:INDEX(D7:O7,1,MATCH($F$3,$D$6:$O$6,0))),\"\")")).toContain("OFFSET(D7,MIN(0,(1)-1),");
    // INDEX with one index over a row / a column; A before R's start; a sheet prefix kept
    expect(rewriteRangeIndex("SUM(B2:INDEX(C2:H2,3))")).toBe("SUM(OFFSET(B2,MIN(0,(1)-1),MIN(0,(3)),ABS((1)-1)+1,ABS((3))+1))");
    expect(rewriteRangeIndex("SUM(Data!$A$2:INDEX(Data!$A$2:$A$99,N))")).toBe("SUM(OFFSET(Data!$A$2,MIN(0,(N)-1),MIN(0,(1)-1),ABS((N)-1)+1,ABS((1)-1)+1))");
    expect(rewriteRangeIndex("SUM(D7:INDEX(D7:O7,1,2))+SUM(D8:INDEX(D8:O8,1,3))")).not.toContain("INDEX");
  });
  it("whole columns are rewritten from row 1", () => {
    expect(rewriteRangeIndex("SUM(A2:INDEX(A:A,k))")).toBe("SUM(OFFSET(A2,MIN(0,(k)-2),MIN(0,(1)-1),ABS((k)-2)+1,ABS((1)-1)+1))");
  });
  it("left as written: other sheets, 2-D with one index, a 0 index, inside a string, no INDEX", () => {
    for (const f of ["SUM(A1:INDEX(Data!A1:A9,3))", "SUM(A1:INDEX(A1:C9,3))", "SUM(A1:INDEX(A1:C9,0,2))", '"A1:INDEX(A1:C1,1,2)"', "SUM(A1:B2)", "INDEX(A1:C1,1,2)"])
      expect(rewriteRangeIndex(f), f).toBe(f);
  });
});

describe("the rewritten range computes as Excel's", () => {
  let g: Awaited<ReturnType<typeof loadEngine>>;
  beforeAll(async () => { g = await loadEngine(); }, 60_000);
  it("from January to the chosen month, and from the chosen month to the end (INDEX before A)", () => {
    const m = new g.Model("sb", "en", "UTC", "en");
    for (let c = 1; c <= 6; c++) m.setUserInput(0, 1, c, String(c * 10));
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].forEach((t, i) => m.setUserInput(0, 2, i + 1, "'" + t));
    m.setUserInput(0, 3, 1, "'Mar");
    const fs = [
      "SUM(A1:INDEX(A1:F1,1,MATCH(A3,A2:F2,0)))",   // 10+20+30
      "SUM(A1:INDEX(A1:F1,MATCH(A3,A2:F2,0)))",     // 60
      "SUM(B1:INDEX(A1:F1,1,4))",                   // 20+30+40
      "SUM(F1:INDEX(A1:F1,1,MATCH(A3,A2:F2,0)))",   // F1 back to C1: 30+40+50+60
      "SUM(O1:INDEX(A1:F1,1,1))",                   // a single cell before: … empty after F1, so 10..60 = 210
      "SUM(INDEX(A1:F1,5):INDEX(A1:F1,2))",         // reversed: B1..E1 = 140
      "SUM(INDEX(A1:F1,3):INDEX(A1:F1,3))",         // one cell: 30
      "SUM(A1:INDEX(A:A,1))",                       // whole column, the same cell: 10
    ];
    fs.forEach((f, i) => m.setUserInput(0, 4, i + 1, "=" + rewriteRangeIndex(f)));
    m.evaluate();
    expect(fs.map((_, i) => m.getFormattedCellValue(0, 4, i + 1))).toEqual(["60", "60", "90", "180", "210", "140", "30", "10"]);
    m.free();
  }, 60_000);
});

describe("INDEX(R, …):INDEX(R, …) → OFFSET", () => {
  it("the deck's LET form; whole columns; one index over a row; left as written over two ranges", () => {
    expect(rewriteRangeIndex("SUM(INDEX(D:Q,r,1):INDEX(D:Q,r,MATCH(F3,D6:O6,0)))"))
      .toBe("SUM(OFFSET(D$1,MIN(r,r)-1,MIN(1,MATCH(F3,D6:O6,0))-1,ABS((r)-(r))+1,ABS((MATCH(F3,D6:O6,0))-(1))+1))");
    expect(rewriteRangeIndex("SUM(INDEX($D:$Q,r,1):INDEX($D:$Q,r,2))")).toContain("OFFSET($D$1,");
    expect(rewriteRangeIndex("SUM(INDEX(B2:H2,2):INDEX(B2:H2,4))")).toBe("SUM(OFFSET(B2,MIN(1,1)-1,MIN(2,4)-1,ABS((1)-(1))+1,ABS((4)-(2))+1))");
    expect(rewriteRangeIndex("SUM(INDEX(A1:A9,2):INDEX(B1:B9,4))")).toBe("SUM(INDEX(A1:A9,2):INDEX(B1:B9,4))");
  });
  it("computes the range between the two, either way round", async () => {
    const g = await loadEngine(), m = new g.Model("sb", "en", "UTC", "en");
    for (let c = 1; c <= 6; c++) { m.setUserInput(0, 1, c, String(c)); m.setUserInput(0, 2, c, String(c * 10)); }
    m.setUserInput(0, 3, 1, "=" + rewriteRangeIndex("SUM(INDEX(A1:F2,2,2):INDEX(A1:F2,2,4))"));
    m.setUserInput(0, 3, 2, "=" + rewriteRangeIndex("SUM(INDEX(A1:F1,2):INDEX(A1:F1,5))"));
    m.setUserInput(0, 3, 3, "=" + rewriteRangeIndex("SUM(INDEX(A1:F2,2,4):INDEX(A1:F2,1,2))"));
    m.setUserInput(0, 3, 4, "=" + rewriteRangeIndex("SUM(INDEX(A:F,2,2):INDEX(A:F,2,4))"));
    m.evaluate();
    expect([1, 2, 3, 4].map(c => m.getFormattedCellValue(0, 3, c))).toEqual(["90", "14", "99", "90"]);
    m.free();
  }, 60_000);
});
