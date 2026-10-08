# ADR-002: One TypeScript core in Web Workers is the only implementation of model, ops, reader and renderers

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
v3 implements the op semantics twice (`model/ops.ts`, `ops.py`) and keeps them equal with test vectors.
Parsing and rendering run on the UI thread (6.1 s and a 561 ms freeze for one large sheet).

## Decision
* `core/` (TypeScript) holds the types, ops, fold, reader, layout, scene, display list and comments.
* It runs in a core worker; export workers handle PDF/PNG.
* The helper never interprets operations.
* `ops.py` is deleted; `shared/ops-vectors.json` stays as the TS regression suite.
* No Rust/WASM core.

## Consequences
+ One implementation; the UI never blocks; about 70 % of v3 TS moves unchanged (06 §3).
− The helper cannot fold journals, so rollback needs compacted snapshots (04 §4.4).
− Messages between UI and workers must be designed (structured clone; DLs are plain arrays).

## Evidence and alternatives
Spike `spikes/parser`: TS byte scanner 303 ms vs 3 148 ms regex, 26.5 MB vs 242 MB. Spike `spikes/pdfwriter`: TS writer 0.1 s for 20 slides. Rust/WASM (B2) was not needed for the budgets.
