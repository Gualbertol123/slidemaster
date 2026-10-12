import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** "virtual:core-worker": the worker script (core/src/workers/main.ts: the core worker, or an export worker when started
    as "sb-export") bundled as ONE classic script, as a string the page starts from a Blob URL (app/src/rpc/client.ts); a module worker would fail from file:// */
function coreWorker(): Plugin {
  const ID = "\0virtual:core-worker";
  return {
    name: "core-worker",
    resolveId: id => id === "virtual:core-worker" ? ID : null,
    async load(id) {
      if (id !== ID) return null;
      const root = path.join(here, "..");
      // es2022 as core's tsconfig: lowered to es2020, class fields become defineProperty calls and the sheet scanner
      // ran 3× slower (big30: ~1 s instead of ~0.35 s; PLAN S2.6). Chromium has run es2022 since 94 (the field PC: Edge 154)
      const r = await build({ entryPoints: [path.join(root, "core/src/workers/main.ts")], bundle: true, format: "iife", target: "es2022",
        minify: true, legalComments: "none", write: false, metafile: true, logLevel: "silent", absWorkingDir: root });
      for (const f of Object.keys(r.metafile!.inputs)) this.addWatchFile(path.resolve(root, f));
      return "export default " + JSON.stringify(r.outputFiles[0].text) + ";";
    },
  };
}

// The app ships as ONE self-contained HTML file (works offline and from file://), written next to the helper.
// The chrome is React 19 (PLAN S1.4; until then Preact ran it through preact/compat). The React Compiler was
// tried and is not used: see PROGRESS.md, S1.4.
export default defineConfig({
  plugins: [coreWorker(), viteSingleFile({ removeViteModuleLoader: true })],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  build: {
    outDir: "../backend",
    emptyOutDir: false,
    target: "es2022",                     // as the worker (above)
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { input: "slide_builder.html" },
    reportCompressedSize: false,
  },
} as any);
