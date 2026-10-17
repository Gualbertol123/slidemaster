import { describe, expect, it } from "vitest";
import { inputCellText, parseInputCell, parseNumber, scenarioValues, typedValue } from "../src/export/scenario";

describe("Run for each value: the input cell (S8.1, name box syntax)", () => {
  it("a sheet's cell, with or without quotes and $", () => {
    expect(parseInputCell("Control!B2")).toEqual({ sheet: "Control", ref: "B2" });
    expect(parseInputCell("  Control!$b$2 ")).toEqual({ sheet: "Control", ref: "B2" });
    expect(parseInputCell("'My sheet'!C7")).toEqual({ sheet: "My sheet", ref: "C7" });
    expect(parseInputCell("'Bob''s'!C7")).toEqual({ sheet: "Bob's", ref: "C7" });
    expect(parseInputCell("Q1!2024!A1")).toEqual({ sheet: "Q1!2024", ref: "A1" });   // the last "!" separates
  });
  it("a linked workbook's sheet id (ADR-014)", () => {
    expect(parseInputCell("[Peers.xlsx]Peer!C7")).toEqual({ sheet: "[Peers.xlsx]Peer", ref: "C7" });
    expect(parseInputCell("'[Peers.xlsx]Peer data'!C7")).toEqual({ sheet: "[Peers.xlsx]Peer data", ref: "C7" });
  });
  it("not one cell of a named sheet", () => {
    for (const t of ["", "C7", "!C7", "Control!", "Control!B2:C3", "Control!B", "Control!2", "Control!B0", "Control!XFE1", "Control!A1048577", "'Control!B2"])
      expect(parseInputCell(t), t).toBeNull();
    expect(parseInputCell("Control!XFD1048576")).toEqual({ sheet: "Control", ref: "XFD1048576" });
  });
  it("written back as the name box writes it", () => {
    expect(inputCellText({ sheet: "Control", ref: "B2" })).toBe("Control!B2");
    expect(inputCellText({ sheet: "My sheet", ref: "C7" })).toBe("'My sheet'!C7");
    expect(inputCellText({ sheet: "Bob's", ref: "C7" })).toBe("'Bob''s'!C7");
    expect(inputCellText({ sheet: "[Peers.xlsx]Peer", ref: "C7" })).toBe("[Peers.xlsx]Peer!C7");
    for (const t of ["Control!B2", "'My sheet'!C7", "'Bob''s'!C7", "[Peers.xlsx]Peer!C7", "'[Peers.xlsx]Peer data'!C7"])
      expect(inputCellText(parseInputCell(t)!)).toBe(t);
  });
});

describe("Run for each value: the values (S8.1, SC-01)", () => {
  it("one per line, trimmed, blank lines skipped, duplicates removed keeping the order", () => {
    expect(scenarioValues("Bank A\nBank B\n\n  Bank C  \nBank A\r\nBank B\r\n")).toEqual(["Bank A", "Bank B", "Bank C"]);
    expect(scenarioValues("")).toEqual([]);
    expect(scenarioValues(" \n\t\n ")).toEqual([]);
  });
  it("a paste from Excel: a row's cells (tabs) are values too", () => {
    expect(scenarioValues("Bank A\tBank B\nBank C\tBank A\n")).toEqual(["Bank A", "Bank B", "Bank C"]);
  });
  it("case and inner spaces count: they are different values", () => {
    expect(scenarioValues("bank a\nBank A\nBank  A")).toEqual(["bank a", "Bank A", "Bank  A"]);
  });
});

describe("Run for each value: a value's type (07 §8 Q7)", () => {
  it("numbers as the page shows them (Italian separators) and as typed", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("1.234")).toBe(1234);
    expect(parseNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1,234,567")).toBe(1234567);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("−3")).toBe(-3);                 // a typographic minus
    expect(parseNumber("(12)")).toBe(-12);
    expect(parseNumber("12,5%")).toBe(0.125);
    expect(parseNumber("1,23E-04")).toBeCloseTo(0.000123, 12);
    expect(parseNumber("1e3")).toBe(1000);
    // a leading zero is never a thousands group (review of S8.1): rates typed either way
    expect(parseNumber("0.035")).toBe(0.035);
    expect(parseNumber("0.125")).toBe(0.125);
    expect(parseNumber("0.500")).toBe(0.5);
    expect(parseNumber("0,035")).toBe(0.035);
    expect(parseNumber("3,5%")).toBe(0.035);
  });
  it("not numbers", () => {
    for (const t of ["", "Bank A", "31/03/2026", "1.235 €", "12.34.5", "1,2,3", "1.23,4.5", "e3", "-", "(-3)", "1 234", "0x10", "Infinity", "NaN"])
      expect(parseNumber(t), t).toBeNull();
  });
  it("a number goes in as a number only when the input cell holds a number today", () => {
    expect(typedValue("12", "n", false)).toBe(12);
    expect(typedValue("1.234,5", "n", false)).toBe(1234.5);
    expect(typedValue("12", "s", false)).toBe("12");
    expect(typedValue("12", null, false)).toBe("12");
    expect(typedValue("Bank C", "n", false)).toBe("Bank C");
    expect(typedValue(" Bank C ", "s", false)).toBe("Bank C");
  });
  it("Treat as text forces text", () => {
    expect(typedValue("12", "n", true)).toBe("12");
    expect(typedValue("TRUE", "b", true)).toBe("TRUE");
  });
  it("a logical cell takes TRUE / FALSE", () => {
    expect(typedValue("true", "b", false)).toBe(true);
    expect(typedValue("FALSE", "b", false)).toBe(false);
    expect(typedValue("yes", "b", false)).toBe("yes");
    expect(typedValue("TRUE", "s", false)).toBe("TRUE");
  });
});
