import { describe, expect, it } from "vitest";
import { ASSUMED_FOLDER, PATH_LIMIT, cleanName, nameBudget, pdfName, pngName, runFileName, safeValue, scenarioFileName, scenarioRunStems, stemOf, versionTitle } from "../src/export/names";

describe("export names as before (B11, moved to core/src/export/names.ts)", () => {
  it("the deck, a slide, pictures, versions", () => {
    expect(stemOf("Weekly report.xlsx")).toBe("Weekly report");
    expect(pdfName("Weekly report", null, false)).toBe("Weekly report - slides.pdf");
    expect(pdfName("Weekly report", "Loans / deposits", true)).toBe("Weekly report - Loans _ deposits (images).pdf");
    expect(pngName("Weekly report", "Tab\there")).toBe("Weekly report - Tab here.png");
    expect(versionTitle("Weekly report", "Chief: board", "clean")).toBe("Weekly report - Chief_ board - Excel Refined");
    expect(versionTitle("w", "All", "mckinsey")).toBe("w - All - Consulting Navy");
  });
  it("as the helper cleans names (clean_name)", () => {
    expect(cleanName('a\\b/c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(cleanName("..x..")).toBe("x");
    expect(cleanName("  ")).toBe("slide");
  });
});

describe("a scenario run's names (S8.2, 07 §2.5, SC-03, SC-04)", () => {
  it("<value> - <design>.<ext>, with versions <value> - <version> - <design>.<ext>", () => {
    expect(scenarioFileName("Bank C", "excel", null, "pdf")).toBe("Bank C - Excel.pdf");
    expect(scenarioFileName("Bank C", "glass", "Chief", "pdf")).toBe("Bank C - Chief - Liquid Glass.pdf");
    expect(scenarioFileName("Bank C", "bain", null, "pptx")).toBe("Bank C - Consulting Red.pptx");
  });
  it("unsafe characters and control characters → _", () => {
    expect(safeValue('A\\B/C:D*E?F"G<H>I|J')).toBe("A_B_C_D_E_F_G_H_I_J");
    expect(safeValue("line\nbreak\ttab\u007f")).toBe("line_break_tab_");
    expect(safeValue("1.234,5 €")).toBe("1.234,5 €");                 // a displayed number stays as shown
  });
  it("spaces and dots trimmed at both ends; empty → (blank)", () => {
    expect(safeValue("  .Bank C.  ")).toBe("Bank C");
    expect(safeValue("")).toBe("(blank)");
    expect(safeValue(" . . ")).toBe("(blank)");
    expect(scenarioFileName("", "excel", null, "pdf")).toBe("(blank) - Excel.pdf");
  });
  it("reserved device names prefixed _ (audit SEC-7), in any case and with an extension", () => {
    for (const v of ["CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "LPT9", "COM¹", "NUL.txt", "con .x"]) expect(safeValue(v), v).toBe("_" + v.trim());
    for (const v of ["CONSOB", "COM10", "LPT", "Console", "NULL"]) expect(safeValue(v), v).toBe(v);
  });
  it("long values are cut so the helper's temporary file stays under 240 characters (audit SEC-6)", () => {
    const tmp = (folder: string, name: string) => folder + "\\" + name + "." + "0".repeat(32) + ".tmp";
    for (const folder of ["C:\\x\\export", "T:\\COMMERCIAL PLANNING&PRICING\\BENCHMARKING_CP\\Chief Dashboard\\slider\\export", "D:\\" + "f".repeat(110)]) {
      const name = scenarioFileName("V".repeat(400), "clean", "A version with a long name", "pdf", folder.length);
      expect(tmp(folder, name).length).toBeLessThan(PATH_LIMIT);
      expect(tmp(folder, name).length).toBe(PATH_LIMIT - 1);                                   // as long as allowed
      expect(name.endsWith(" - A version with a long name - Excel Refined.pdf")).toBe(true);
    }
    // a folder so deep that not even " - <version> - <design>.pdf" fits: the value keeps one character (the helper
    // then refuses the file and the run's report names it)
    expect(scenarioFileName("Bank C", "clean", "A version with a long name", "pdf", 160)).toBe("B - A version with a long name - Excel Refined.pdf");
    expect(nameBudget()).toBe(nameBudget(ASSUMED_FOLDER));
    expect(scenarioFileName("x".repeat(300), "excel", null, "pdf").length).toBe(nameBudget());
    // a cut never ends in a space or a dot, nor splits a surrogate pair
    const n = nameBudget() - " - Excel.pdf".length;
    expect(scenarioFileName("a".repeat(n - 1) + " b", "excel", null, "pdf")).toBe("a".repeat(n - 1) + " - Excel.pdf");
    expect(scenarioFileName("a".repeat(n - 1) + "😀", "excel", null, "pdf")).toBe("a".repeat(n - 1) + " - Excel.pdf");
  });
  it("equal names inside one run get (2), (3) after the value – also two values that collapse to one safe name", () => {
    expect(scenarioRunStems(["X", "X"], ["excel"], [null], "pdf")).toEqual(["X", "X (2)"]);
    const stems = scenarioRunStems(["A/B", "A:B", "A?B", "Bank C"], ["excel"], [null], "pdf");
    expect(stems).toEqual(["A_B", "A_B (2)", "A_B (3)", "Bank C"]);
    expect(runFileName(stems[0], "excel", null, "pdf")).toBe("A_B - Excel.pdf");
    expect(runFileName(stems[1], "excel", null, "pdf")).toBe("A_B (2) - Excel.pdf");
    // Windows names ignore case; a value that is literally "X (2)" keeps its name, the repeat moves on
    expect(scenarioRunStems(["bank c", "Bank C"], ["excel"], [null], "pdf")).toEqual(["bank c", "Bank C (2)"]);
    expect(scenarioRunStems(["X (2)", "X", "X"], ["excel"], [null], "pdf")).toEqual(["X (2)", "X", "X (3)"]);
    expect(scenarioRunStems(["", " ", "."], ["excel"], [null], "pdf")).toEqual(["(blank)", "(blank) (2)", "(blank) (3)"]);
  });
  it("in a run, every value is cut for the longest version × design, the (2) inside the limit", () => {
    const long = "L".repeat(300), stems = scenarioRunStems([long, long], ["glass", "bain"], ["Chief", "A much longer version name"], "pdf", 80);
    const longest = " - A much longer version name - Consulting Red.pdf".length;
    expect(stems[0].length).toBe(nameBudget(80) - longest);
    expect(stems[1].endsWith(" (2)")).toBe(true); expect(stems[1].length).toBe(nameBudget(80) - longest);
    for (const s of stems) for (const d of ["glass", "bain"] as const) for (const v of ["Chief", "A much longer version name"])
      expect(runFileName(s, d, v, "pdf").length).toBeLessThanOrEqual(nameBudget(80));
  });
});
