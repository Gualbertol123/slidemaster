/* LI-01 (AUDIT-2 LIC-1, ADR-020): THIRD-PARTY-NOTICES.txt has an entry for every third-party package the page and the
   core worker really bundle (esbuild's metafile of both bundles, built as app/vite.config.ts builds them) and for every
   licence file next to an inlined WASM; the file and the page's deflated copy (⚙ Options › About › Licences) are what
   tools/notices.mjs writes now. helper/tests/test_release.py checks the release side (ROOT_FILES, REQUIRED, the lock). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundled, isLicence, notices } from "../../tools/notices.mjs";
import { noticesText } from "../src/ui/notices";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const committed = () => fs.readFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.txt"), "utf8");
const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("third-party notices", () => {
  it("every package and inlined WASM the page and the worker bundle has an entry", async () => {
    const b = await bundled(ROOT), text = committed();
    expect([...b.packages.keys()].sort()).toEqual(expect.arrayContaining(["fflate", "react", "react-dom", "scheduler", "zustand"]));
    for (const [name, p] of b.packages) expect(text, `${name} ${p.version} has no entry: node tools/notices.mjs`).toMatch(new RegExp(`^## ${re(name)} ${re(p.version)} `, "m"));
    expect([...b.wasmDirs].sort()).toEqual(["core/src/calc/wasm", "core/src/icons", "core/src/text/wasm"]);
    expect(b.wasmWhere.get("core/src/icons")).toEqual(["the core worker"]);   // the page's own bundle never carries the icon set
    for (const d of b.wasmDirs) {
      const lic = fs.readdirSync(path.join(ROOT, d)).filter(isLicence);
      expect(lic.length).toBeGreaterThan(0);
      for (const f of lic) expect(text).toContain(`(${d}/${f})`);
    }
  }, 60_000);

  it("THIRD-PARTY-NOTICES.txt and the page's copy are up to date (node tools/notices.mjs)", async () => {
    const fresh = await notices(ROOT);
    expect(committed() === fresh).toBe(true);
    expect(await noticesText() === fresh).toBe(true);          // the deflated copy inflates to the same text
  }, 60_000);
});
