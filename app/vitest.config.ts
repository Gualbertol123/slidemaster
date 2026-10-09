import { defineConfig } from "vitest/config";

/* Two projects: the unit tests (node) and the component tests (jsdom: Testing Library + Profiler render
   counts). Both run the app's runtime, React 19; the component tests fail on console errors and warnings
   (React's development build reports misuse there: tests/setup-console.ts). */
export default defineConfig({
  test: {
    projects: [
      { esbuild: { jsx: "automatic", jsxImportSource: "react" }, test: { name: "unit", environment: "node", include: ["tests/**/*.test.ts"] } },
      { esbuild: { jsx: "automatic", jsxImportSource: "react" }, test: { name: "react", environment: "jsdom", include: ["tests/**/*.test.tsx"], setupFiles: ["tests/setup-console.ts"] } },
    ],
  },
});
