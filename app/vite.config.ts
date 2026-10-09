import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The components are written against the React API; until S1.4 (PLAN M1) Preact runs them through
// preact/compat. The same aliases serve the build and the unit tests (vitest.config.ts).
export const alias = [
  { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
  { find: /^react\/jsx-runtime$/, replacement: "preact/compat/jsx-runtime" },
  { find: /^react\/jsx-dev-runtime$/, replacement: "preact/compat/jsx-dev-runtime" },
  { find: /^react-dom$/, replacement: "preact/compat" },
  { find: /^react$/, replacement: "preact/compat" },
];

// The app ships as ONE self-contained HTML file (works offline and from file://), written next to the helper.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  resolve: { alias },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  build: {
    outDir: "../backend",
    emptyOutDir: false,
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: "slide_builder.html" },
    reportCompressedSize: false,
  },
} as any);
