import { describe, expect, it } from "vitest";
import { formatValue, fmtGeneral } from "../src/xlsx/numfmt";

const f = (v: number, fmt: string, t: "n" | "d" = "n") => formatValue({ v, t, fmt }).text;
describe("number formats (Italian separators, as in v2)", () => {
  it("grouping and decimals", () => { expect(f(1234567.891, "#,##0")).toBe("1.234.568"); expect(f(1234.5, "#,##0.00")).toBe("1.234,50"); });
  it("sections and negatives", () => { expect(f(-2.5, "+0.0;-0.0;0.0")).toBe("-2.5".replace(".", ",")); expect(f(0, "+0.0;-0.0;0.0")).toBe("0,0"); expect(f(-5, "0")).toBe("-5"); });
  it("thousands scaling and literals", () => { expect(f(987654.3, '#,##0.0,," m"')).toBe("1,0 m"); });
  it("percent", () => { expect(f(0.0123, "0.0%")).toBe("1,2%"); });
  it("exponent", () => { expect(f(0.000123, "0.00E+00")).toBe("1,23E-04"); expect(f(123456, "##0.0E+0")).toBe("123,5E+3"); });
  it("fractions", () => { expect(f(1.5, "# ?/?")).toBe("1 1/2"); expect(f(0.75, "?/4")).toBe("3/4"); });
  it("currency symbol in a locale tag is kept", () => { expect(f(1234.5, "#,##0 [$€-410]")).toBe("1.235 €"); });
  it("General: 11 characters", () => { expect(fmtGeneral(12345678901234)).toBe("1,23457E+13"); expect(fmtGeneral(0.1 + 0.2)).toBe("0,3"); expect(fmtGeneral(42)).toBe("42"); expect(fmtGeneral(-1234.56789012)).toBe("-1234,56789"); });
});
describe("dates", () => {
  it("English by default, Italian with [$-410]", () => { expect(f(45000, "mmmm yyyy", "d")).toBe("March 2023"); expect(f(45000, "[$-410]mmmm yyyy", "d")).toBe("marzo 2023"); expect(f(45000, "[$-410]ddd d mmm", "d")).toBe("mer 15 mar"); });
  it("m is minutes after h and before s", () => { expect(f(45000.5 + 7 / 1440, "dd/mm/yyyy hh:mm", "d")).toBe("15/03/2023 12:07"); expect(f(0.5 + 7 / 1440 + 9 / 86400, "mm:ss", "d")).toBe("07:09"); });
  it("12-hour clock with AM/PM", () => { expect(f(45000.75, "h:mm AM/PM", "d")).toBe("6:00 PM"); });
  it("elapsed hours", () => { expect(f(1.5, "[h]:mm", "d")).toBe("36:00"); });
});

import { parseSSTRich, richRuns } from "../src/xlsx/workbook";
import { cellHtml } from "../src/render/excel";
describe("rich text: superscript and subscript", () => {
  it("keeps the plain text and remembers the raised / lowered parts", () => {
    const xml = `<sst><si><t>plain</t></si><si><r><t xml:space="preserve">LEGAL ENTITIES MF </t></r><r><rPr><vertAlign val="superscript"/><sz val="8"/></rPr><t>(1)</t></r></si><si><r><t>H</t></r><r><rPr><vertAlign val="subscript"/></rPr><t>2</t></r><r><t>O &amp; co</t></r></si></sst>`;
    const { sst, runs } = parseSSTRich(xml);
    expect(sst).toEqual(["plain", "LEGAL ENTITIES MF (1)", "H2O & co"]);
    expect(runs).toEqual([undefined, [[18, 21, "sup"]], [[1, 2, "sub"]]]);
    expect(richRuns("<t>x</t>")).toEqual({ text: "x" });
    expect(cellHtml({ text: sst[1], scripts: runs[1] })).toBe("LEGAL ENTITIES MF <sup>(1)</sup>");
    expect(cellHtml({ text: "H2O & co", scripts: runs[2] })).toBe("H<sub>2</sub>O &amp; co");
    expect(cellHtml({ text: "edited", scripts: [[0, 2, "sup"]], edited: true })).toBe("edited");     // a text edit drops Excel's formatting
  });
});
