# ADR-006: Store each deck as a snapshot plus per-writer append-only journals with Lamport order

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
v3 serialises every save of a deck through one lock (≈ 12 round trips). With 20 users at 40 ms per
operation, others see an edit after 12 s (p50) to 28 s (p95), with 20 lock time-outs (01 §3.3). Trimming
round trips (lean lock) still gives 7.9 / 19.7 s in the simulation.

## Decision
* `data/v4/decks/<key>/`:
  * `snapshot.json` (v3 document shape + frontier + gen);
  * `j/<writer>.log` (framed records, one writer, no lock);
  * `presence/`;
  * `lock` (used for compaction only).
* Save = append + flush (2 round trips).
* Readers fold the snapshot and the journal records past the frontier in `(lamport, writer, seq)` order.
* Compaction is a compare-and-set on `gen` under the v3 lock protocol, off the editing path.
* The specification and invariants are in 04 §2.

## Consequences
+ Save 82–96 ms p95 and visibility 1.8–3.1 s at 20 users / 40 ms; no lock on the edit path; a complete
  edit history.
− New code with subtle cases (torn tails, rotation, compaction), covered by the invariant tests (05 §3.6).
− Same-field conflicts resolve by Lamport order instead of arrival order (B4).
− Depends on SMB append/read coherence: verified on the real share first (M0, PLAN S0.6, R1). Fallback: one shared journal appended under the deck lock (same endpoints, same fold; the helper never interprets ops).

## Evidence and alternatives
`spikes/storage/journal_sim.py` (04 §2.5). Rejected: SQLite on SMB (unsafe), OneDrive (breaks locks), coordinator (needs inbound ports), DB server (none).
