/* The one worker script the page carries (app/vite.config.ts, "virtual:core-worker"): started without a name it is
   the core worker (core.worker.ts); started as "sb-export" it is an export worker (export.worker.ts, PLAN S3.7). One
   script, so HarfBuzz and the shared code are in the page once. */
import { startCore } from "./core.worker";
import { startExport } from "./export.worker";
import { installTabler } from "../icons";

// the Tabler icon set (S15.1, ADR-020): both workers draw "tabler:" icons; the set is inflated when the first one is drawn
installTabler();
const scope = self as unknown as Parameters<typeof startCore>[0] & Parameters<typeof startExport>[0] & { name?: string };
if (scope.name === "sb-export") startExport(scope); else startCore(scope);
