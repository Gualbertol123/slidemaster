import { defineConfig } from "vitest/config";

/* The core's unit tests run in Node: no DOM (a test that needs one installs a platform, src/platform.ts). */
export default defineConfig({ test: { name: "core", environment: "node", include: ["tests/**/*.test.ts"] } });
