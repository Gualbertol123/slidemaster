# Operation vectors per milestone (S14.P)

`shared/ops-vectors.json` holds every vector up to S14.P (M13 and the shared preparation of M14 and M15). M14 and M15
are built in parallel on separate branches, so each appends only to its own file here – `m14.json` (charts, 4.7.0) and
`m15.json` (lines, icons, snapping, 4.8.0) – and the two never edit the same lines (one shared array would conflict at
its closing `]`). A later milestone adds its own `mNN.json`; a step built beside them its own `bNN.json` (`b49.json`:
B49, a comment's border – `Note.frame` inside a slide's `notes` map; `b50.json`: B50, a comment in the macro's
structure – `auto.mode: "macro"` and `auto.sections`).

Each file is a JSON array of cases in the format of `shared/ops-vectors.json` (an operation case: `name`, `doc`, `ops`,
`expect`; a fold case: `name`, `fold`, `expect`). `core/tests/vectors.ts` reads the main file and then every
`*.json` here in name order; a name used twice anywhere fails the run. `helper/tests/test_migrate.py` checks that each
file is such an array with unique names (the helper itself applies no operation).
