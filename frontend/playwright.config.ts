import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Two helpers = two people on two PCs, sharing one app folder (workbooks + data), like on the network drive. */
// the config is evaluated by the runner and again by each worker: create the folder once, share it via env
const fresh = !process.env.SB_E2E_TMP;
const tmp = process.env.SB_E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), "sb-e2e-"));
const root = path.join(tmp, "root"), data = path.join(tmp, "data");
if (fresh) {
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  for (const f of ["report.xlsx", "plain.xlsx", "big.xlsx", "weekly.xlsx"]) fs.copyFileSync(path.join(__dirname, "tests/fixtures", f), path.join(root, f));
}
process.env.SB_E2E_TMP = tmp; process.env.SB_E2E_ROOT = root; process.env.SB_E2E_DATA = data;
const chrome = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const helper = (user: string, port: number) => ({
  command: `python3 ../backend/slide_builder.py --no-browser --port ${port}`,
  url: `http://127.0.0.1:${port}/api/ping`,
  env: { SLIDEBUILDER_ROOT: root, SLIDEBUILDER_DATA: data, SLIDEBUILDER_USER: user, SLIDEBUILDER_HOST: "pc-" + user, SLIDEBUILDER_BROWSER: chrome, NO_PROXY: "*" },
  reuseExistingServer: false, timeout: 90_000,
});
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  use: { launchOptions: { executablePath: chrome }, viewport: { width: 1500, height: 900 } },
  webServer: [helper("anna", 8951), helper("bob", 8952)],
});
