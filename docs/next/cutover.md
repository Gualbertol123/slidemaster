# Cut-over to Slide Builder 4.0 (PLAN S5.7, gate G3)

The runbook for the agreed Monday (04 §4.3), minute by minute, then four weeks of monitoring. Everything here is
done by people; the agent prepared and rehearsed it (`tools/cutover-rehearsal.mjs`, PROGRESS.md S5.6–S5.7).

| | |
|---|---|
| **Share** (`$S` below) | `T:\COMMERCIAL PLANNING&PRICING\BENCHMARKING_CP\Chief Dashboard\slider` – runs 3.8.0 (`app\current.json`) and the pilot 4.0.0-pilot (`app\pilot.json`). Nothing outside `slider\` is touched. |
| **Maintainer** | runs the commands, from one PC, and watches the four weeks: ______________________ |
| **Decides a rollback** | the product owner: ______________________ (the maintainer may roll back **one deck** on their own when it is blocked; **everything** only with the product owner's yes) |
| **Monday** | ____ / ____ / 2026 (G3) |
| **Two check PCs** | PC 1: ____________ (the maintainer's)   PC 2: ____________ (a colleague's, ideally on VPN) |

All commands are for **Windows PowerShell**. Open it once and set the share:
```powershell
$S = "T:\COMMERCIAL PLANNING&PRICING\BENCHMARKING_CP\Chief Dashboard\slider"
```

---

## 1. Before the Monday (D-7 … D-1)

| When | Who | What |
|---|---|---|
| D-7 | product owner | G3: agree the Monday; the tag `v4.0.0` is pushed (release checklist §5) and the `release` workflow is green |
| D-7 | maintainer | send the announcement (§6) |
| D-1 | maintainer | download `slidebuilder-4.0.0.zip` from https://github.com/Gualbertol123/slidemaster/releases/tag/v4.0.0 to `C:\temp\`, check it, unzip it (only its updater is used, once): |

```powershell
cd C:\Users\U508169\Downloads\claude\slidemaster-lf          # any checkout of the repository
python tools\make_release.py --verify C:\temp\slidebuilder-4.0.0.zip     # "OK: … files match MANIFEST.json"
Expand-Archive C:\temp\slidebuilder-4.0.0.zip C:\temp\sb-4.0.0
```

**Why the 4.0 ZIP's updater:** the share's own `Update Slide Builder.bat` is Slide Builder 3.8's; it refuses a 4.x
release ("the release has no backend/slide_builder.py") and changes nothing. 4.0's updater installs 4.0 and, with
it, replaces the share's `tools\update.py`, so from then on `Update Slide Builder.bat` is 4.0's (`--migrate-all`,
`--rollback`, plain updates).

## 2. The Monday, minute by minute

| Time | Who | Step | Expected |
|---|---|---|---|
| 08:00 | maintainer | Last reminder in the team chat: "Slide Builder is updated at 08:15. Close it now (the browser window AND the black window); start it again after 08:45." | |
| 08:10 | maintainer | Nobody is in a deck: in `$S\backend\data`, `dir presence` shows no file changed in the last minute (Slide Builder 3's heartbeats). Somebody still in? Call them. | |
| 08:15 | maintainer | **Update** (below, 1) | "self-test passed", "updated Start Slide Builder.bat", "updated Install Slide Builder.bat", "updated tools/update.py", "added Start Slide Builder (v3).bat", "Version 4.0.0 is now the current version (was 3.8.0)" |
| 08:20 | maintainer | **Check the folder** (below, 2) | `current.json` 4.0.0, the start files present |
| 08:25 | maintainer, PC 1 | Double-click `$S\Start Slide Builder.bat` | black window: " Slide Builder 4.0.0" and the line "Data" ending in `…\slider\backend\data`; the app opens |
| 08:27 | maintainer, PC 1 | Open a deck the team uses; bold one cell, undo it | "✓ Saved" within a second; the side panel's last line "Deck: snapshot 1 · …" |
| 08:30 | colleague, PC 2 | The same start, the same deck | the deck is the same; PC 1 bolds a cell → PC 2 sees it within ~2 s, and back |
| 08:35 | colleague, PC 2 | Export ▾ › PDF of that deck | the PDF in `$S\export\` looks like last week's |
| 08:40 | maintainer | **Optional: move every deck now** (below, 3) – otherwise each deck moves the first time somebody opens it | "Moved to Slide Builder 4: N deck(s)" and no "NOT moved" |
| 08:45 | maintainer | Team chat: "Slide Builder 4 is live – start it as usual. Problems: write to <maintainer> with the form (§5)." | |
| 09:00–12:00 | maintainer | Watch (§4, the daily checks), answer questions | no incident file |

**1. Update** (PC 1):
```powershell
py -3 C:\temp\sb-4.0.0\tools\update.py --root $S --release 4.0.0
```
If GitHub answers "rate limit exceeded" (too many requests from the office's address), install the downloaded file
instead – the same result: `py -3 C:\temp\sb-4.0.0\tools\update.py --root $S --zip C:\temp\slidebuilder-4.0.0.zip --yes`.
A failed or refused update changes nothing: 3.8 stays the current version.

**2. Check the folder:**
```powershell
Get-Content "$S\app\current.json"
dir $S
```
`"version": "4.0.0"`, `"previous": "3.8.0"`; the folder has `Start Slide Builder.bat`, `Start Slide Builder (v3).bat`,
`Update Slide Builder.bat`, `Install Slide Builder.bat`, `Start Slide Builder (v4 pilot).bat`, `app`, `backend`,
`tools`. A release install replaces `Start Slide Builder.bat`, `Install Slide Builder.bat` (3.8's cannot find the
program in a folder of side-by-side versions) and `tools\update.py`, and adds `Update Slide Builder.bat` and
`Start Slide Builder (v3).bat` when they are missing (never replacing them).

**3. Optional – every deck at once** (only after the checks at 08:25–08:35 passed):
```powershell
cd $S
& ".\Update Slide Builder.bat" --migrate-all
```
A deck somebody still has open in Slide Builder 3 is skipped ("skipped … run --migrate-all again later"); it moves
when it is opened in 4.0, or at the next `--migrate-all`.

**`Start Slide Builder (v3).bat` stays** for four weeks: it starts Slide Builder 3 (the newest 3.x in `app\`) on the
same data, from port 8785, for decks given back to it (§3). Slide Builder 3 refuses every deck that Slide Builder 4
owns ("Slide Builder was updated – reload the page"), so it cannot change a moved deck by mistake.

## 3. Rollback (who, when, how)

Nothing is lost by a rollback: Slide Builder 4 gives a deck back as a Slide Builder 3 document with every change
made in 4.0 (fields only 4.0 knows are kept in it and come back if the deck moves again). It refuses a deck with
changes that are not folded yet, instead of guessing – hence *Prepare rollback* first.

**Who decides:** one deck – the maintainer, when that deck is blocked (cannot be opened, edited or exported, or an
incident file names it); everything – the product owner, when several decks or people are blocked and a fix is
not in sight the same day. Write every rollback into PROGRESS.md ("Decisions") with the reason.

**One deck** (the others stay on 4.0):
1. Pin it to Slide Builder 3 first, so that nobody moves it back to 4.0 by opening it right after step 4: add its workbook
   name to `$S\backend\data\v4\pinned-v3.json` (a JSON list), e.g. `["Weekly report.xlsx"]`; with two decks
   `["Weekly report.xlsx", "Monthly.xlsx"]`. (The pin does not stop 4.0 users yet – the deck is still 4.0's until
   step 4; afterwards Slide Builder 4 says "this deck is kept on Slide Builder 3" instead of moving it again.)
2. Somebody opens Slide Builder 4 → *⚙ Options › Administration › Prepare rollback* → confirm → wait for
   "Prepare rollback: N decks ready." (at least 30 s).
3. Everybody closes that deck (or Slide Builder).
4. Maintainer:
   ```powershell
   cd $S
   & ".\Update Slide Builder.bat" --rollback "Weekly report.xlsx"      # the deck's workbook name
   ```
   Expected: "Given back to Slide Builder 3: 1 deck(s)". Refused with "… is open in Slide Builder 4 – close it
   everywhere first", "… has changes that are not in its snapshot yet – open it once in Slide Builder 4, …" or
   "… close it everywhere, Prepare rollback and try again": somebody still had it open – repeat 2–4.
5. The people working on that deck use `Start Slide Builder (v3).bat` for it. To move it to 4.0 again later, take
   its name out of `pinned-v3.json`; it moves the next time somebody opens it in Slide Builder 4.

**Everything** (back to 3.8 for everybody):
1. *Prepare rollback* as above; then everybody closes Slide Builder (browser and black window).
2. Maintainer:
   ```powershell
   cd $S
   & ".\Update Slide Builder.bat" --use 3.8.0
   ```
   It first gives every deck back ("Given back to Slide Builder 3: N deck(s)"), then "Version 3.8.0 is now the
   current version". If a deck is refused, 3.8 is **not** switched on: repeat *Prepare rollback*, then again.
3. Everybody starts `Start Slide Builder.bat` as usual – it now starts 3.8.
4. **Nobody double-clicks `Update Slide Builder.bat` meanwhile.** It would refuse anyway ("Version 3.8.0 was chosen
   with --use over a newer version (a rollback): a plain update would install the newest release and undo it, so
   nothing was changed"), but the product owner decides when to go forward.
5. Forward again later (after a fix, the product owner's yes): `& ".\Update Slide Builder.bat" --release 4.0.x`
   (or `--use 4.0.0`). The newest 3.x always stays installed beside 4.x, so `--use 3.8.0` and
   `Start Slide Builder (v3).bat` keep working after any 4.0.x update.

Rehearsed on a temp copy of a share (14 decks, real helpers and pages): install 3.8 → 4.0, migrate-all, Prepare
rollback, rollback of every deck, `--use 3.8.0`, Slide Builder 3 edits again – every deck exactly as before, the
4.0 edits kept (PROGRESS.md S5.7). The same on any PC: `node tools/cutover-rehearsal.mjs --v3-zip
slidebuilder-3.8.0.zip --v4-zip slidebuilder-4.0.0.zip`.

## 4. Four weeks of monitoring (D0 … D+28)

| When | What | Where | Action |
|---|---|---|---|
| daily, week 1; then Mondays | **incident files** – a journal damaged in the middle; the deck is read-only (never expected) | `dir "$S\backend\data\v4\decks" -Recurse -Filter "incident-*.json"` | none: fine. One: copy that deck's folder aside, tell the product owner, roll that deck back (§3), send the folder with a report |
| daily, week 1 | **helper windows**: a line `INCIDENT` or a Python traceback | ask the team to report it with the form | report |
| Fridays | **deck health** of 3 busy decks: the side panel's last line "Deck: snapshot N · M changes since in J journals" | Slide Builder 4, side panel | M grows during the week and drops after a compaction; M above ~5 000 → report |
| Fridays | **reports** (§5): count blocking / annoying / cosmetic | the maintainer's inbox | blocking → §3 and a fix (4.0.x) |
| Fridays | **record** the week in PROGRESS.md, Measurements: incidents, rollbacks, reports, deck health | | |
| D+28 | four weekly cycles without a rollback → PLAN S6.5 (Prompt 9): `Start Slide Builder (v3).bat` and the pilot's files are removed; `backend\` stays | | |

A rollback (§3) restarts the four weeks for the decision on S6.5.

## 5. Report form (users)

```
Date / time:
Name, PC (VPN yes/no):
Workbook / deck:
What I did:
What I expected:
What happened (screenshot or PDF):
Severity: blocking (lost or wrong content, cannot open/edit/export, crash) / annoying / cosmetic
Save status (bottom bar) and the side panel's "Deck:" line:
Others on the same deck at that moment:
```

## 6. Announcement (send at D-7, again at D-1)

> **Slide Builder 4.0 on Monday __/__ at 08:15.** Please close Slide Builder (the browser window and the black
> window) before 08:15 that morning and start it again after 08:45 as usual. Your decks, settings, fonts and
> exports stay as they are. What changes: colleagues' edits appear within a second or two; "✓ Saved" as soon as a
> change is on the share; when two people change the same cell at the same moment, the later change wins for
> everybody. If anything looks wrong, write to <maintainer> with the form attached.
