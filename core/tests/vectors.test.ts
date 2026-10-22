/* S14.P review, 3: the vectors are read from shared/ops-vectors.json and shared/ops-vectors.d/*.json (one file per
   parallel milestone, so M14 and M15 never append to the same array). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVectors, vectorFiles } from "./vectors";

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "sb-vec-")); fs.mkdirSync(path.join(d, "ops-vectors.d")); return d; };
const op = (name: string) => ({ name, doc: { preset: null, style: {}, edits: {} }, ops: [], expect: { preset: null, style: {}, edits: {}, applied: 0, skipped: [] } });

describe("the vector files (S14.P)", () => {
  it("the main file, then b49.json (B49, a comment's border), b50.json (B50, the macro's comments), m14.json and m15.json; every name once", () => {
    const files = vectorFiles().map(f => path.relative(path.join(__dirname, "../../shared"), f).replace(/\\/g, "/")), later = files.slice(5);
    expect(files.slice(0, 5)).toEqual(["ops-vectors.json", "ops-vectors.d/b49.json", "ops-vectors.d/b50.json", "ops-vectors.d/m14.json", "ops-vectors.d/m15.json"]);
    // then a later milestone's own files only (M16: m16-<step>.json), in name order
    for (const f of later) expect(f).toMatch(/^ops-vectors\.d\/m\d+-[a-z-]+\.json$/);
    expect(later).toEqual([...later].sort());
    const all = loadVectors(), main = JSON.parse(fs.readFileSync(vectorFiles()[0], "utf8"));
    expect(all.length).toBeGreaterThanOrEqual(main.length);
    expect(new Set(all.map(v => v.name)).size).toBe(all.length);
  });
  it("a file of ops-vectors.d is read after the main file, in name order", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "ops-vectors.json"), JSON.stringify([op("a")]));
    fs.writeFileSync(path.join(d, "ops-vectors.d", "m15.json"), JSON.stringify([op("c")]));
    fs.writeFileSync(path.join(d, "ops-vectors.d", "m14.json"), JSON.stringify([op("b")]));
    fs.writeFileSync(path.join(d, "ops-vectors.d", "README.md"), "not a vector file");
    expect(loadVectors(d).map(v => v.name)).toEqual(["a", "b", "c"]);
  });
  it("a name in two files, or a file that is not an array of cases, fails", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "ops-vectors.json"), JSON.stringify([op("a")]));
    fs.writeFileSync(path.join(d, "ops-vectors.d", "m14.json"), JSON.stringify([op("a")]));
    expect(() => loadVectors(d)).toThrow(/"a" in both ops-vectors.json and m14.json/);
    fs.writeFileSync(path.join(d, "ops-vectors.d", "m14.json"), JSON.stringify({ name: "x" }));
    expect(() => loadVectors(d)).toThrow(/not an array/);
    fs.writeFileSync(path.join(d, "ops-vectors.d", "m14.json"), JSON.stringify([{ name: "x" }]));
    expect(() => loadVectors(d)).toThrow(/without name/);
  });
});
