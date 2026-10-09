import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The app ships as ONE self-contained HTML file (works offline and from file://), written next to the helper.
// The chrome is React 19 (PLAN S1.4; until then Preact ran it through preact/compat). The React Compiler was
// tried and is not used: see PROGRESS.md, S1.4.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
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
