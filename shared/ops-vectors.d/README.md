# Operation vectors per milestone (S14.P)

`shared/ops-vectors.json` holds every vector up to S14.P (M13 and the shared preparation of M14 and M15). M14 and M15
are built in parallel on separate branches, so each appends only to its own file here – `m14.json` (charts, 4.7.0) and
`m15.json` (lines, icons, snapping, 4.8.0) – and the two never edit the same lines (one shared array would conflict at
its closing `]`). A later milestone adds its own `mNN.json`; a step built beside them its own `bNN.json` (`b49.json`:
B49, a comment's border – `Note.frame` inside a slide's `notes` map; `b50.json`: B50, a comment in the macro's
structure – `auto.mode: "macro"` and `auto.sections`; `b51.json`: B51, the contents slide's title and list in a free
layout – boxes `c:title` / `c:toc` of a slide's `free` entry, format 6; `b52.json`: B52, a chart's reference lines, gap
arrows and change pills – marks of kinds `ref` / `gap` / `change` and their keys, format 7; `b53.json`: B53, label
places, labels dragged on the stage (`nudge`) and an axis's bounds from cells (`cells`), format 8; `b54.json`: B54, the chart card – `stats`, `tag`, `sep`, `moms`,
`momLabel`, `filter` – and a KPI card's kind, format 9; `b55.json`: B55, the budget-achievement chart – a chart's type
`progress` and its `progress` key – and a chart card's `subtitle`, format 10).

Each file is a JSON array of cases in the format of `shared/ops-vectors.json` (an operation case: `name`, `doc`, `ops`,
`expect`; a fold case: `name`, `fold`, `expect`). `core/tests/vectors.ts` reads the main file and then every
`*.json` here in name order; a name used twice anywhere fails the run. `helper/tests/test_migrate.py` checks that each
file is such an array with unique names (the helper itself applies no operation).

4.9 (M16): each step its own `m16-<step>.json` – `m16-hidden.json` (S16.1), `m16-versions.json` (S16.2),
`m16-cells.json` (S16.3), `m16-slides.json` (S13.7's duplicated slide, moved out of the main file by AUDIT-3 VEC-2).

4.14 (B56): `m19-text.json` – an item's `texts` (a part's text format), `lay` (its parts' layout) and `offs` (parts dragged
on the stage), each merged per entry (a KPI card's and a chart card's).

4.14 (B57): `m20-repoint.json` – an item's `bind` (what each reference was bound to, follow its header; merged per entry),
a table.patch moving a table's cells (`sheet`, `range`, its header row `bind`), and a whole Move by 2 rows of a table
as Data sources sends it (with each op's inverse).
