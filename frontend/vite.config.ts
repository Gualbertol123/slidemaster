import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The app ships as ONE self-contained HTML file (works offline and from file://), written next to the helper.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: "../backend",
    emptyOutDir: false,
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: "slide_builder.html" },
    reportCompressedSize: false,
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as any);
