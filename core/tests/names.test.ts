import { describe, expect, it } from "vitest";
import { ASSUMED_FOLDER, PATH_LIMIT, cleanName, nameBudget, pdfName, pngName, runFileName, safeValue, scenarioFileName, runVersionLabels, scenarioRunNames, stemOf, versionTitle } from "../src/export/names";

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
  it("values and names Windows treats alike: C1 controls, lone surrogates, its upper-case comparison", () => {
    expect(safeValue("\u0085X\u009f")).toBe("_X_");
    expect(safeValue("a\ud800b")).toBe("a_b");
    expect(safeValue("a\udc00b")).toBe("a_b");
    expect(safeValue("a😀b")).toBe("a😀b");                                      // a pair is kept
    expect(() => encodeURIComponent(safeValue("x\ud83d"))).not.toThrow();
    expect(scenarioRunNames(["ſ", "S"], ["excel"], [null], "pdf").stems).toEqual(["ſ", "S (2)"]);   // "ſ" upper-cases to "S"
  });
  it("versions in the names: none for the full deck alone; with several, every one named (\"Full deck\"), alike ones apart", () => {
    expect(runVersionLabels([null])).toEqual([null]);
    expect(runVersionLabels(["Chief"])).toEqual(["Chief"]);
    expect(runVersionLabels([null, "Chief"])).toEqual(["Full deck", "Chief"]);
    expect(runVersionLabels(["A/B", "A:B", "chief", "Chief"])).toEqual(["A_B", "A_B (2)", "chief", "Chief (2)"]);
  });
  it("equal names inside one run get (2), (3) after the value – also two values that collapse to one safe name", () => {
    const names = (values: string[], versions: (string | null)[] = [null], designs: ("excel" | "glass")[] = ["excel"]) => {
      const r = scenarioRunNames(values, designs, versions, "pdf");
      return r.stems.flatMap(s => designs.flatMap(d => r.labels.map(l => runFileName(s, d, l, "pdf"))));
    };
    expect(names(["X", "X"])).toEqual(["X - Excel.pdf", "X (2) - Excel.pdf"]);
    expect(names(["A/B", "A:B", "A?B", "Bank C"])).toEqual(["A_B - Excel.pdf", "A_B (2) - Excel.pdf", "A_B (3) - Excel.pdf", "Bank C - Excel.pdf"]);
    // Windows names ignore case; a value that is literally "X (2)" keeps its name, the repeat moves on
    expect(names(["bank c", "Bank C"])).toEqual(["bank c - Excel.pdf", "Bank C (2) - Excel.pdf"]);
    expect(names(["X (2)", "X", "X"])).toEqual(["X (2) - Excel.pdf", "X - Excel.pdf", "X (3) - Excel.pdf"]);
    expect(names(["", " ", "."])).toEqual(["(blank) - Excel.pdf", "(blank) (2) - Excel.pdf", "(blank) (3) - Excel.pdf"]);
  });
  it("no two files of a run are one file, whatever \" - \" the values and versions hold (review of S8.2)", () => {
    const all = (values: string[], versions: (string | null)[]) => {
      const designs = ["excel", "glass"] as const, r = scenarioRunNames(values, [...designs], versions, "pdf");
      return r.stems.flatMap(s => designs.flatMap(d => r.labels.map(l => runFileName(s, d, l, "pdf"))));
    };
    for (const [values, versions] of [
      [["A", "A - X"], ["X - Chief", "Chief"]],
      [["A", "A - Chief"], [null, "Chief"]],
      [["A", "A - Full deck"], [null, "Chief"]],
      [["Bank C", "bank c", "Bank/C", "Bank:C"], ["A/B", "A:B", "Chief", "chief", null]],
    ] as [string[], (string | null)[]][]) {
      const files = all(values, versions);
      expect(new Set(files.map(f => f.toUpperCase())).size, files.join(" | ")).toBe(files.length);
    }
    const files = all(["A", "A - X"], ["X - Chief", "Chief"]);
    expect(files).toContain("A - X - Chief - Excel.pdf"); expect(files).toContain("A - X (2) - Chief - Excel.pdf");
  });
  it("in a run, every value is cut for the longest version × design, the (2) inside the limit", () => {
    const long = "L".repeat(300), r = scenarioRunNames([long, long], ["glass", "bain"], ["Chief", "A much longer version name"], "pdf", 80);
    const longest = " - A much longer version name - Consulting Red.pdf".length;
    expect(r.stems[0].length).toBe(nameBudget(80) - longest);
    expect(r.stems[1].endsWith(" (2)")).toBe(true); expect(r.stems[1].length).toBe(nameBudget(80) - longest);
    for (const s of r.stems) for (const d of ["glass", "bain"] as const) for (const l of r.labels)
      expect(runFileName(s, d, l, "pdf").length).toBeLessThanOrEqual(nameBudget(80));
  });
});
