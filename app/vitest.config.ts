import { defineConfig } from "vitest/config";
import { alias } from "./vite.config";

/* Two projects: the unit tests (node, the app's runtime: Preact through the aliases until S1.4) and the
   component tests (jsdom, real React 19: Testing Library + Profiler render counts). */
export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, esbuild: { jsx: "automatic", jsxImportSource: "react" }, test: { name: "unit", environment: "node", include: ["tests/**/*.test.ts"] } },
      { esbuild: { jsx: "automatic", jsxImportSource: "react" }, test: { name: "react", environment: "jsdom", include: ["tests/**/*.test.tsx"] } },
    ],
  },
});
