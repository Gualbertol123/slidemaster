import { defineConfig } from "vitest/config";

/* npm run bench -w core: the core's benchmarks with thresholds (PLAN Part A rule 7, Part F). One process with
   the garbage collector exposed, so retained memory can be measured. The Tabler icon set is registered as in the workers (tests/setup-icons.ts). */
export default defineConfig({ test: { name: "core-bench", environment: "node", include: ["bench/**/*.bench.test.ts"], pool: "forks", execArgv: ["--expose-gc", "--max-old-space-size=4096"], fileParallelism: false, testTimeout: 600_000, setupFiles: ["tests/setup-icons.ts"] } } as never);
