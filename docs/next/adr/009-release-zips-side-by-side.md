# ADR-009: Distribute CI-built release ZIPs, installed side by side with an atomic version pointer

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
v3 commits a 464 KB built page and updates the share with `git reset --hard` or a branch ZIP. There is no
side-by-side install and no instant rollback.

## Decision
* GitHub Actions builds `slidebuilder-<ver>.zip` with a `MANIFEST.json` of SHA-256s.
* `Update Slide Builder.bat`:
  * downloads it with `urllib` and the Windows trust store;
  * verifies it against the release asset digest and the manifest;
  * unpacks it to `app\<ver>\` (`.part` then rename);
  * runs `--selftest` (reads every deck read-only);
  * flips `app\current.json`.
* `--use <ver>` rolls back instantly; `--zip <file>` is the offline path.
* The built page is no longer committed.

## Consequences
+ The same one-click friction; instant rollback; reproducible builds; smaller diffs.
− Requires GitHub Releases through the proxy (R11; manual ZIP fallback).
− The first switch is shipped in Phase 0 on v3 itself.

## Evidence and alternatives
02 §I.
