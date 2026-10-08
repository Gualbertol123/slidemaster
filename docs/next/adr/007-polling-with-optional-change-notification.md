# ADR-007: Poll journal tails every 1.5 s; use ReadDirectoryChangesW only as a wake-up hint

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
Push is impossible (no connections between PCs). SMB2 CHANGE_NOTIFY works on Windows file servers, but
it is unreliable on some NAS and DFS setups. Directory metadata is cached by the SMB client for up to 10 s.

## Decision
* The helper reads the new bytes of each other journal (open, seek, read; ≤ 8 in parallel) every 1.5 s
  while a deck is open.
* `ReadDirectoryChangesW` through `ctypes` on `j/` triggers an immediate poll. It ships disabled, and is
  enabled after `tools/sharetest.py` proves it on the real share.
* The workbook list uses snapshot mtimes every 30 s, only while the Open menu is visible (v3 read every
  document every 6 s).

## Consequences
+ Correct on any SMB server; about 250 small reads/s for 20 users is negligible for a file server.
− 1–2 s latency floor without the hint.

## Evidence and alternatives
02 §F; sim visibility numbers.
