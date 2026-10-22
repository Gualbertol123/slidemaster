/* S15.2 · Italian search words for the icon picker (09 §9 Q11, the owner's decision of 2026-10-21): the list in
   core/src/icons/search-it.ts names only icons and English words the vendored set has, about 300 words, none twice;
   Italian queries find the expected icons first, accents or not; English search is as before; an unknown word finds
   nothing. */
import { describe, expect, it } from "vitest";
import { fold, italianWords, tabler } from "../src/icons";
import { IT_WORDS } from "../src/icons/search-it";

const names = (q: string, o = {}) => tabler().search(q, o).map(h => h.name);

describe("Italian icon search words", () => {
  it("every target is an icon name, a whole word of icon names or a tag of the set", () => {
    const t = tabler(), known = new Set<string>(t.names);
    for (const n of t.names) { for (const w of n.split("-")) known.add(w); for (const g of t.tags(n)) known.add(g); }
    const missing: string[] = [];
    for (const [k, targets] of italianWords()) {
      expect(targets.length, k).toBeGreaterThan(0);
      for (const x of targets) if (!known.has(x)) missing.push(`${k} → ${x}`);
    }
    expect(missing).toEqual([]);
  });

  it("about 300 words, each listed once, lower case", () => {
    const keys = IT_WORDS.split("\n").filter(l => l.includes(":")).flatMap(l => l.slice(0, l.indexOf(":")).split("/").map(k => fold(k).trim()));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(k => k === k.toLowerCase() && k.length > 0)).toBe(true);
    expect(italianWords().size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(250);
    expect(keys.length).toBeLessThanOrEqual(400);
    console.log(`${keys.length} Italian words and phrases on ${IT_WORDS.split("\n").filter(l => l.includes(":")).length} lines`);
  });

  it("Italian queries find the expected icons first", () => {
    expect(names("banca")[0]).toBe("building-bank");
    expect(names("obiettivo")[0]).toBe("target");
    expect(names("grafico")[0]).toMatch(/^chart-/);
    expect(names("grafico").slice(0, 5)).toEqual(["chart-bar", "chart-line", "chart-pie", "chart-area", "graph"]);
    expect(names("freccia su")[0]).toBe("arrow-up");
    expect(names("freccia giù")[0]).toBe("arrow-down");
    expect(names("freccia a destra")[0]).toBe("arrow-right");
    expect(names("freccia sinistra")[0]).toBe("arrow-left");
    expect(names("torta")[0]).toBe("chart-pie");
    expect(names("risparmio")[0]).toBe("pig-money");
    expect(names("mutuo")[0]).toBe("home-dollar");
    expect(names("crescita")[0]).toBe("trending-up");
    expect(names("calo")[0]).toBe("trending-down");
    expect(names("lampadina")[0]).toBe("bulb");
    expect(names("stretta di mano")[0]).toBe("heart-handshake");
    expect(names("punto interrogativo")[0]).toBe("question-mark");
    expect(names("impostazioni")[0]).toBe("settings");
    expect(names("lucchetto")[0]).toBe("lock");
    expect(names("bilancia")[0]).toBe("scale");
    expect(names("euro")[0]).toBe("currency-euro");
    expect(names("calendario")).toEqual(expect.arrayContaining(["calendar", "calendar-event", "calendar-week"]));
    expect(names("soldi")).toEqual(expect.arrayContaining(["cash-banknote", "cash", "coin"]));
  });

  it("folds accents both ways", () => {
    expect(names("città")[0]).toBe("building-community");
    expect(names("citta")).toEqual(names("città"));
    expect(names("CITTÀ")).toEqual(names("città"));
    expect(names("più")[0]).toBe("plus");
    expect(names("piu")).toEqual(names("più"));
    expect(names("freccia giu")).toEqual(names("freccia giù"));
    expect(names("società")).toEqual(names("societa"));
  });

  it("keeps English search, sets and categories; an unknown word finds nothing", () => {
    expect(names("arrow up")[0]).toBe("arrow-up");
    expect(names("bank")[0]).toBe("building-bank");
    expect(names("arrow-up")[0]).toBe("arrow-up");
    expect(tabler().search("stella", { style: "filled" }).every(h => h.filled)).toBe(true);
    expect(names("stella", { style: "filled" })[0]).toBe("star");
    expect(tabler().search("euro", { category: "Currencies" }).every(h => h.category === "Currencies")).toBe(true);
    expect(names("pippobaudo")).toEqual([]);
    expect(names("banca pippobaudo")).toEqual([]);
    expect(names("zzzqqq")).toEqual([]);
    const t0 = performance.now();
    for (const q of ["f", "fr", "fre", "frec", "frecc", "freccia", "freccia s", "freccia su"]) tabler().search(q, { limit: 120 });
    console.log(`8 Italian keystrokes searched in ${(performance.now() - t0).toFixed(1)} ms`);
  });
});
