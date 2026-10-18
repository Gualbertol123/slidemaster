import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { sysFontDirs } from "../tools/sysfonts.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Two helpers = two people on two PCs, sharing one app folder (workbooks + data), like on the network drive. */
// the config is evaluated by the runner and again by each worker: create the folder once, share it via env
const fresh = !process.env.SB_E2E_TMP;
const tmp = process.env.SB_E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), "sb-e2e-"));
const root = path.join(tmp, "root"), data = path.join(tmp, "data");
if (fresh) {
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  // Banks.xlsx and Peers.xlsx link to each other (S7.3, tests/corpus/workbooks/recalc)
  for (const f of ["report.xlsx", "plain.xlsx", "big.xlsx", "weekly.xlsx", "Banks.xlsx", "Peers.xlsx", "Gate.xlsx"]) fs.copyFileSync(path.join(__dirname, "tests/fixtures", f), path.join(root, f));
}
process.env.SB_E2E_TMP = tmp; process.env.SB_E2E_ROOT = root; process.env.SB_E2E_DATA = data;
// the browser: CHROME, else Playwright's own Chromium (npx playwright install chromium), the same on every OS
const chrome = process.env.CHROME || createRequire(import.meta.url)("playwright").chromium.executablePath();
// the native export (S3.7) embeds this PC's fonts: off Windows the helper is given the system's font folders
const SYSFONTS = sysFontDirs();
// Windows has "python" (python3 is the Microsoft Store's placeholder there)
const PY = process.platform === "win32" ? "python" : "python3";
const helper = (user: string, port: number) => ({
  command: `${PY} ../helper/slide_builder.py --no-browser --port ${port}`,
  url: `http://127.0.0.1:${port}/api/ping`,
  env: { SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: user, SLIDEBUILDER_HOST: "pc-" + user, NO_PROXY: "*",
    ...(SYSFONTS ? { SLIDEBUILDER_SYSFONTS: SYSFONTS } : {}) },
  reuseExistingServer: false, timeout: 90_000,
  stdout: "pipe" as const, stderr: "pipe" as const,          // the helpers' logs appear in the test output (CI diagnosis)
});
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  // on GitHub Actions each failure is also an annotation of the run (readable without the log's admin rights)
  reporter: process.env.GITHUB_ACTIONS ? [["github"], ["list"]] : "list",
  use: { launchOptions: { executablePath: chrome }, viewport: { width: 1500, height: 900 } },
  webServer: [helper("anna", 8951), helper("bob", 8952)],
});
