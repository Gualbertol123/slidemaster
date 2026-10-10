import { defineConfig } from "vitest/config";

/* npm run bench -w core: the core's benchmarks with thresholds (PLAN Part A rule 7, Part F). One process with
   the garbage collector exposed, so retained memory can be measured. */
export default defineConfig({ test: { name: "core-bench", environment: "node", include: ["bench/**/*.bench.test.ts"], pool: "forks", execArgv: ["--expose-gc", "--max-old-space-size=4096"], fileParallelism: false, testTimeout: 600_000 } } as never);
