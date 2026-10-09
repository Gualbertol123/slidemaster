/* backend/slide_builder.html is committed (users cannot build it): it must match the sources. */
import { describe, expect, it } from "vitest";
import { build } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
describe("built app", () => {
  it("backend/slide_builder.html is up to date with app/src (run `npm run build`)", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "sb-build-"));
    process.env.NODE_ENV = "production";
    await build({ mode: "production", root: path.join(here, ".."), configFile: path.join(here, "../vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const fresh = fs.readFileSync(path.join(out, "slide_builder.html"), "utf8");
    const committed = fs.readFileSync(path.join(here, "../../backend/slide_builder.html"), "utf8");
    expect(committed === fresh).toBe(true);
  }, 60_000);
});
