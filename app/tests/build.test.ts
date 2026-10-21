/* helper/slide_builder.html is committed (users cannot build it): it must match the sources. */
import { describe, expect, it } from "vitest";
import { build } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** helper/slide_builder.html at most (bytes; docs/next/09 §8 ⏱): page-budget/base.json (M13's, 3,976,092) plus each
    milestone's own file there (S14.P: m14.json, m15.json – the parallel branches never touch the same line); every part
    is raised only by a decision, never to make a build pass */
const BUDGET_DIR = path.join(here, "page-budget");
const BUDGET_PARTS = fs.readdirSync(BUDGET_DIR).filter(f => f.endsWith(".json")).sort()
  .map(f => ({ f, bytes: (JSON.parse(fs.readFileSync(path.join(BUDGET_DIR, f), "utf8")) as { bytes: number }).bytes }));
const PAGE_BUDGET = BUDGET_PARTS.reduce((s, p) => s + p.bytes, 0);
describe("built app", () => {
  it("helper/slide_builder.html is up to date with app/src (run `npm run build`)", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "sb-build-"));
    process.env.NODE_ENV = "production";
    await build({ mode: "production", root: path.join(here, ".."), configFile: path.join(here, "../vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const fresh = fs.readFileSync(path.join(out, "slide_builder.html"), "utf8");
    const committed = fs.readFileSync(path.join(here, "../../helper/slide_builder.html"), "utf8");
    expect(committed === fresh).toBe(true);
  }, 60_000);
  it("the page budget's parts: M13's base and one file per milestone, each a whole number of bytes ≥ 0", () => {
    expect(BUDGET_PARTS.find(p => p.f === "base.json")?.bytes).toBe(3_976_092);
    for (const p of BUDGET_PARTS) expect(Number.isInteger(p.bytes) && p.bytes >= 0, p.f).toBe(true);
    expect(BUDGET_PARTS.map(p => p.f)).toEqual(expect.arrayContaining(["m14.json", "m15.json"]));
  });
  it("the page stays within its budget (base.json + the milestones' page-budget/*.json)", () => {
    const size = fs.statSync(path.join(here, "../../helper/slide_builder.html")).size;
    expect(size, BUDGET_PARTS.map(p => `${p.f} ${p.bytes}`).join(" + ")).toBeLessThanOrEqual(PAGE_BUDGET);
  });
});
