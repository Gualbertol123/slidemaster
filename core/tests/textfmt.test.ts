/* TEXT as this PC's Italian Excel formats it (M8, Decisions 2026-10-17): the expected texts are what Excel saved in the
   corpora (g4, large, recalc) for these calls. */
import { describe, expect, it } from "vitest";
import { excelText, italianTextFormat, qualify, textCalls } from "../src/calc/textfmt";

const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

describe("TEXT with Italian Excel's codes", () => {
  it("dates: a = year, g = day, Italian names; d and y are not codes", () => {
    expect(excelText(serial(2026, 9, 30), "mmmm aaaa")).toBe("settembre 2026");
    expect(excelText(serial(2025, 1, 31), "mmmm aaaa")).toBe("gennaio 2025");
    expect(excelText(serial(2026, 9, 30), "gg/mm/aaaa")).toBe("30/09/2026");
    expect(excelText(serial(2026, 3, 1), "mmm aa")).toBe("mar 26");
    expect(excelText(serial(2026, 3, 1), "mmm yy")).toBe("mar yy");              // Banks SLIDE_1!E12 as Excel saved it
    expect(excelText(serial(2026, 9, 30), "dd mmm yyyy")).toBe("dd set yyyy");    // g4 Benchmark Compare!B10
    expect(excelText(serial(2026, 10, 17), "gggg")).toBe("sabato");
  });
  it("numbers: \".\" groups thousands, \",\" is the decimal point", () => {
    expect(excelText(7354.8, "#.##0,0")).toBe("7.354,8");                        // large Calc_Text!K
    expect(excelText(0.035, "0,0%")).toBe("3,5%");
    expect(excelText(0.04, "0.0%")).toBe("04%");                                 // large Peers Summary!B7
    expect(excelText(9, "00")).toBe("09");
    expect(excelText(12, "00")).toBe("12");
    expect(excelText(1234.5, "Standard")).toBe("1234,5");
  });
  it("a text value stays; what it cannot say is null", () => {
    expect(excelText("Banca Nord", "00")).toBe("Banca Nord");
    expect(excelText("12", "00")).toBe("12");
    expect(excelText(true, "0")).toBeNull();
    expect(excelText({ err: "#N/A" }, "0")).toBeNull();
    expect(excelText(5, 3)).toBe("3");                                            // a number as the format: its digits, as Excel
  });
  it("the codes translated", () => {
    expect(italianTextFormat("mmmm aaaa")).toBe("[$-410]mmmm yyyy");
    expect(italianTextFormat('#.##0,0" mln"')).toBe('#,##0.0" mln"');
    expect(italianTextFormat("hh:mm AM/PM")).toBe("[$-410]hh:mm AM/PM");
    expect(italianTextFormat("dd")).toBe("\\d\\d");
  });
});

describe("TEXT with Italian Excel's codes: what the review of S8.4 found", () => {
  it("colours dropped, a locale tag of its own kept, a condition's decimal comma", () => {
    expect(excelText(-5, "#.##0;[Rosso]-#.##0")).toBe("-5");
    expect(excelText(-5, "#.##0;[Red]-#.##0")).toBe("-5");
    expect(excelText(serial(2026, 3, 1), "[$-409]mmmm")).toBe("March");
    expect(italianTextFormat("[>=0,5]0,0;0")).toBe("[>=0.5]0.0;0");
  });
  it("times rounded to the second; no dates before 1 March 1900 or below 0", () => {
    expect(excelText(45000.999, "gg/mm/aaaa hh:mm:ss")).toBe("15/03/2023 23:58:34");
    expect(excelText(2.5, "gg/mm/aaaa")).toBeNull();
    expect(excelText(-1, "gg/mm/aaaa")).toBeNull();
    expect(excelText(-1, "0")).toBe("-1");                                         // (a number may be negative)
  });
  it("text values: Italian numbers only, the text section of a format; a number as the format", () => {
    expect(excelText("0x1A", "0")).toBe("0x1A");
    expect(excelText("1.234,5", "0,0")).toBe("1234,5");
    expect(excelText("x", '@" mln"')).toBe("x mln");
    expect(excelText(5, 0)).toBe("5");
    expect(excelText(1e12 + 123, "#.##0")).toBe("1.000.000.000.123");
  });
  it("a quoted sheet name is not a call; calls that depend on their own cell are left out", () => {
    expect(textCalls("'TEXT(1)'!A1&\"x\"")).toEqual([]);
    expect(textCalls('TEXT(ROW(),"0")')).toBeNull();
    expect(textCalls('TEXT(INDIRECT("B5"),"0")')).toBeNull();
  });
});

describe("TEXT calls in a formula", () => {
  it("found with their arguments, strings and quoted sheets skipped", () => {
    expect(textCalls('B2&" - mese "&TEXT(B4,"00")')).toEqual([{ start: 14, end: 27, value: "B4", format: '"00"' }]);
    const f = '"As of "&TEXT(\'[1]Control\'!$B$9,"dd mmm, yyyy")&" · "&_xlfn.TEXT(SUM(A1:A3),C1)';
    const calls = textCalls(f)!;
    expect(calls.map(c => [c.value, c.format])).toEqual([["'[1]Control'!$B$9", '"dd mmm, yyyy"'], ["SUM(A1:A3)", "C1"]]);
    expect(calls.map(c => f.slice(c.start, c.end))).toEqual(["TEXT('[1]Control'!$B$9,\"dd mmm, yyyy\")", "_xlfn.TEXT(SUM(A1:A3),C1)"]);
    expect(textCalls('"TEXT(1,2)"&A1')).toEqual([]);
  });
  it("nested or odd calls: null (kept as Excel saved it)", () => {
    expect(textCalls('TEXT(TEXT(A1,"0"),"0")')).toBeNull();
    expect(textCalls("TEXT(A1)")).toBeNull();
    expect(textCalls('TEXT(A1,"0","x")')).toBeNull();
  });
  it("an expression moved to another sheet keeps pointing at its own sheet", () => {
    expect(qualify("B9+Data!A1+'[1]Peer'!C2", "'Control'!")).toBe("'Control'!B9+Data!A1+'[1]Peer'!C2");
    expect(qualify('SUM(A1:A3)&"A1"', "S!")).toBe('SUM(S!A1:A3)&"A1"');
  });
});
