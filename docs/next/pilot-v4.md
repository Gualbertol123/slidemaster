# Pilot of Slide Builder 4 on a copy (PLAN S5.6, gate G2)

**Purpose:** a few people use Slide Builder 4 for two normal weekly cycles, several of them on the same deck, before
the whole team moves (cut-over, [`cutover.md`](cutover.md)). Slide Builder 4 runs on a **copy** of the data
(04 §4.5), so nothing the pilot does reaches the decks the team uses in Slide Builder 3. The pilot also covers the
field checks that G0 moved to it (Decisions 2026-10-14): Edge, the Windows policies W1–W14 and the storage mode.

**What the pilot decides (G2):** go or no-go for the cut-over. **Go** when, after two cycles:
* no blocking issue is open (a blocking issue: lost or wrong content, a deck that cannot be opened, edited or
  exported, a wrong PDF, a crash);
* no edit was lost, and every page showed the same deck;
* every `incident-*.json` file is explained (below; none is expected);
* the rollback rehearsal (below) gave every deck back to Slide Builder 3 with the pilot's last edits in it;
* the Edge and policy checks passed on every pilot PC;
* the storage mode is confirmed: "journal" (the default) stays unless the pilot found SMB problems (stale reads,
  incidents), in which case v4.0 ships with `lean-lock` (ADR-006).

**People:** the *maintainer* (installs, refreshes the copy, runs the rehearsal, collects the reports) and 3–5
*pilot users*, on at least 3 PCs, one of them on VPN.

---

## 1. Set-up (the maintainer, once, ~15 minutes)

The share must already run Slide Builder 3.8 (`app\current.json` says 3.8.0, or the program is in `backend\`).
`T:\Slide Builder` below stands for the team's Slide Builder folder.

1. Get `slidebuilder-4.0.0-pilot.zip` (from the agent or the PR; it is not a GitHub release) and check it, on any PC
   with the repository: `python tools/make_release.py --verify slidebuilder-4.0.0-pilot.zip` → "OK: … 32 files match".
2. Unzip it to a **local** folder, e.g. `C:\temp\sb-pilot\` (only its updater is used from there).
3. In a command prompt:
   ```
   py -3 C:\temp\sb-pilot\tools\update.py --root "T:\Slide Builder" --pilot --zip C:\temp\slidebuilder-4.0.0-pilot.zip
   ```
   Expected: "MANIFEST.json verified", "installed into app/4.0.0-pilot", "Testing version 4.0.0-pilot on the
   pilot's copy of the data (made now if it is missing)...", "self-test passed", "The pilot runs version
   4.0.0-pilot". The copy is made during that test (a minute or more for a large data folder). Afterwards the folder has `app\4.0.0-pilot\`,
   `app\pilot.json`, `backend\data\v4-pilot\` (the copy) and `Start Slide Builder (v4 pilot).bat`.
   **Not changed:** `app\current.json`, `Start Slide Builder.bat`, `Update Slide Builder.bat`, `tools\update.py`
   and everything in `backend\data` except the new `v4-pilot\` folder. (Slide Builder 3.8's own
   `Update Slide Builder.bat` cannot install a 4.x release – it says "the release has no backend/slide_builder.py"
   and changes nothing – which is why the pilot's own updater is used.)
4. On the Monday the pilot starts, when nobody uses the pilot yet, take a fresh copy:
   `"T:\Slide Builder\Start Slide Builder (v4 pilot).bat" --refresh` (the old copy is kept as
   `v4-pilot.old-<time>`; a refresh is refused while somebody works in the copy).

What the pilot's start file does: it starts the version named in `app\pilot.json` with
`SLIDEBUILDER_DATA=backend\data\v4-pilot` and `SLIDEBUILDER_EXPORT=export\v4-pilot`; the helper refuses any other
data or export folder in pilot mode, listens from port **8865** (Slide Builder 3 from 8765, so neither ever opens
the other's page), and does not import v2 settings (that would rename a file in `backend\`). Its black window is
titled **"PILOT - copy of the data - Slide Builder 4"** and its first lines say so.

## 2. For pilot users (send this part to them)

* Start **`Start Slide Builder (v4 pilot).bat`** in `T:\Slide Builder`. The black window says *PILOT – copy of the
  data*. Keep it open while you work, as with Slide Builder 3.
* **It is a copy.** What you change there does **not** reach Slide Builder 3 and is not kept after the pilot. Do
  your real work in Slide Builder 3 as usual (both can run at the same time on your PC), and repeat a part of it in
  the pilot. PDFs and PNGs of the pilot are saved in `export\v4-pilot\`.
* Things that are meant to be different in Slide Builder 4 (PLAN B1–B14): no export engine; Liquid Glass text in
  static Segoe UI; soft shadows as layers; colleagues' edits appear within about 1–2 s; "✓ Saved" as soon as the
  edit is on the share; two people changing the **same** cell at the same moment: the later one wins by edit order,
  not by arrival; a few cells may wrap or shrink differently; large workbooks never freeze the window; "PDF as
  pictures" is smaller; version exports are named `<workbook> - <version> - <design>.pdf`; it opens in an Edge app
  window; thumbnails are pictures. The side panel's last line ("Deck: snapshot N · M changes since in J journals")
  is for the maintainer.
* Report everything else with the form in §4, the same day.

## 3. The two weekly cycles

Each cycle is one normal week of the team's deck work, repeated in the pilot. Week 1 and week 2 are the same plan.

| When | Who | What |
|---|---|---|
| Monday 9:00 | maintainer | (week 1) `--refresh` the copy (§1.4). Week 2: no refresh – the copy keeps week 1's state, so cycle 2 also tests a deck that has been in v4 for a week |
| Monday–Thursday | everybody | the week's decks in the pilot, as in Slide Builder 3: open the workbook, update, adjust, comment, export |
| Tuesday, 30 min, agreed time | 3+ people | **same deck at the same time**: all open the same deck; each edits different cells for 10 minutes (bold, colours, text boxes, comments), then two people change the **same** cell within a second of each other, then one exports while the others edit. Each notes how long a colleague's edit took to appear |
| Wednesday | one person on VPN | the same as Tuesday's first 10 minutes from VPN |
| Thursday | everybody | export every version × all three designs of one deck; compare the PDFs with Slide Builder 3's of the same week (`export\` vs `export\v4-pilot\`): same slides, same numbers, text that fits |
| Friday 10:00 | maintainer | collects the forms, looks for incident files (§5), notes the deck-health line of 3 busy decks, fills §6 |

Also once per PC (week 1): the Edge checks (`tools/fieldcheck.html`, opened from the helper at
`http://127.0.0.1:8865/fieldcheck` and from `file://`), and the Windows policy matrix W1–W14 of 05 §3.7 that applies
to the PC; results into `docs/next/field-results.md`.

## 4. Report form (one per finding)

Copy into an e-mail or the team's tracker:

```
Date / time:
Name, PC (and VPN yes/no):
Workbook / deck:
What I did (steps):
What I expected:
What happened (screenshot or the PDF from export\v4-pilot\):
Severity: blocking (lost or wrong content, cannot open/edit/export, crash) / annoying / cosmetic
Same in Slide Builder 3?  yes / no / not tried
Save status shown (bottom bar) and the side panel's "Deck:" line:
Other people on the same deck at that moment:
```

## 5. What the maintainer watches

* **Incident files:** `backend\data\v4-pilot\v4\decks\<deck>\incident-*.json`. One means a journal was found damaged
  in the middle and that deck turned read-only (by design: nothing is guessed). None is expected; any one is a
  blocking finding: keep the deck folder as it is (copy it aside) and send it with the report.
* **Deck health:** the side panel's "Deck: snapshot N · M changes since in J journals" for 3 busy decks on Friday.
  M grows during the week and drops after a compaction (> 2 000 records or idle > 24 h); J is about the number of
  people who edited since the last compaction. A deck whose M stays above ~5 000 is worth a report.
* **The helper windows:** a line starting with `INCIDENT` or a Python traceback in any pilot user's black window
  (ask them to copy the window's text into the form).

## 6. Rollback rehearsal on the copy (end of week 2, maintainer, ~20 minutes)

The same steps as a real rollback (04 §4.4, `cutover.md` §5), on the copy only. Do it when the pilot users have
finished; tell them first.

1. In the pilot, *Options ⚙ › Administration › Prepare rollback* → confirm → wait for "Prepare rollback: N decks
   ready." (at least 30 s: recent edits are folded after a margin). Note N.
2. Everybody closes the pilot (the browser window and the black window).
3. In a command prompt:
   ```
   py -3 "T:\Slide Builder\app\4.0.0-pilot\tools\update.py" --pilot --rollback
   ```
   Expected: "Given back to Slide Builder 3: N deck(s)" and no "NOT rolled back" line. A deck refused with
   "open it once in Slide Builder 4, or use Prepare rollback" means a page was still open: repeat steps 1–3.
4. `"T:\Slide Builder\Start Slide Builder (v4 pilot).bat" --v3` starts **Slide Builder 3 on the copy** (port 8885,
   window "PILOT - copy of the data - Slide Builder 3 (rollback rehearsal)"). Open 3 decks that were edited in the
   pilot this week: the last pilot edits are there. Make one edit, see "✓ Saved". Do not export from this window
   (Slide Builder 3 writes its exports to the real `export\` folder).
5. Close it. Optional: start the pilot again – each deck moves to Slide Builder 4 again when it is opened.
6. Fill in the table below.

The same rehearsal, automated, on a temp folder seeded with the test corpus (two helpers and real pages; it also
proves that the real data, export folder and start files are byte for byte unchanged by the pilot):
`node tools/cutover-rehearsal.mjs --v3-zip slidebuilder-3.8.0.zip --v4-zip slidebuilder-4.0.0-pilot.zip --pilot`.

## 7. Results (filled in by the maintainer → PROGRESS.md "Decisions" at G2)

| | Week 1 | Week 2 |
|---|---|---|
| Pilot users / PCs (VPN) | | |
| Decks used / of them by 2+ people at once | | |
| Findings: blocking / annoying / cosmetic (links) | | |
| Lost edits / pages that disagreed | | |
| Incident files | | |
| Colleague's edit visible after (typical / worst, s) | | |
| Exports compared with v3: same / different (which) | | |
| Edge + W1–W14 checks (PCs passed / run) | | |

| Rollback rehearsal | |
|---|---|
| Date, by | |
| Prepare rollback: N decks ready | |
| `--pilot --rollback`: given back / refused | |
| Slide Builder 3 on the copy: decks checked, pilot edits present, edit saved | |

**G2 answer:** go / no-go (and, for no-go, the findings to fix). The agent fixes them as "S5.6-fix · …" commits and
the pilot continues with a new pilot build, `4.0.0-pilot.2`, … (`--pilot --zip` of that ZIP, with that ZIP's own
updater, installs it side by side and `app\pilot.json` then names it; the copy is kept, no refresh needed).
Everybody closes the pilot's black window first and starts the pilot again afterwards: a pilot window still open
on a PC keeps serving the old build there (a new start opens the running one).

## 8. After the pilot

Nothing has to be cleaned up before the cut-over. `backend\data\v4-pilot\`, `app\pilot.json` and the pilot's start
file stay until S6.5 (D+28) and are removed then, with `Start Slide Builder (v3).bat`.
