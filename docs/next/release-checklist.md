# Release checklist (every release: v3.4, v3.5, … v4.x)

Copy this list into the release PR or issue and tick it. Steps 1–4 can be done by an agent; **steps 5–7
are for a person** (agents never push tags and never touch the real share, PLAN Part A).
`X.Y.Z` is the new version, `P.Q.R` the one the share runs now.

## 1. Content
- [ ] The milestone's PR is merged into `main`; CI is green on `main` (unit, core, helper 3.8 + 3.12, e2e, parity).
- [ ] Every step of the milestone is ticked in `PROGRESS.md` with its numbers.
- [ ] `CHANGELOG.md` has a `## X.Y.Z - <date>` section; every user-visible change in it is in PLAN B1–B14.
- [ ] `VERSION = "X.Y.Z"` in `helper/slidebuilder/__init__.py` (`backend/` up to 3.8); `"version": "X.Y.Z"` in `package.json`,
      `app/package.json`, `core/package.json` and in `package-lock.json` (every place that names them).

## 2. Checks on a clean clone
```
git clone https://github.com/gualbertol123/slidemaster.git /tmp/rel && cd /tmp/rel
npm ci && npm run build && git diff --exit-code -- helper/slide_builder.html      # the committed page is fresh
npm run check                                                                         # typecheck (core, app) + unit tests
node tools/notices.mjs --check                                                        # THIRD-PARTY-NOTICES.txt up to date
python3.8 -m unittest discover -s helper/tests && python3.12 -m unittest discover -s helper/tests
npm run test:e2e && npm run parity
```
- [ ] all green; `npm run parity` reports 0 unaccepted differences.

### 2a. The format guard against the real older versions (CP-01, CP-02; ADR-019)
`tools/compat-old.mjs` makes git worktrees of v4.0.0, 4.1 (`061a5b3`), 4.4 (`a1d3aba`) and 4.5 (`637f7b4`), starts each
old helper with its own committed page next to this checkout's helper on the same workbook and data folders (fresh
temporary ones per case; ports 8961 and up, never 8951/8952), and drives both pages with Playwright, without network.
Cases per version: CP-02 (a deck without 4.6 objects stays format 4 and opens, edits and compacts in the old version;
`style.designs.*.consult` kept), (a) the old page opens a format-5 deck holding every 4.6 object, (b) the old page has
the deck open while a 4.6 page raises it – a cell and the wizard's Finish in the gap and after the raise, then alone
past the compaction margin – in journal and in lean-lock storage, (c) the old user's helper restarted as 4.6 under the
open old page (403 with the old token, 409 without `X-SB-Deck-Formats`), (d) the journals aged 25 h and the old helper's
compact / rotate / idle loop. One `RESULT` line per version and case, a JSON report; exit code 1 when one fails.
Takes about 35 minutes per Python (the real 23 s bump wait; `--bump-wait-s N` shortens the 4.6 side only).
```
node tools/compat-old.mjs --pythons "python3.8,python3.12" --out /tmp/compat-old.json
```
On Windows (PowerShell 5.1; `py -3.8` and `py -3.12` from the Python launcher):
```
node tools/compat-old.mjs --pythons "py -3.8,py -3.12" --new-python python --out $env:TEMP\compat-old.json
```
- [ ] every `RESULT` line says PASS (per version: CP-02, a, b-journal, c-journal, b-lean-lock, c-lean-lock, d).

## 3. The release ZIP
```
python tools/make_release.py --version X.Y.Z            # runs the tests again, writes dist/slidebuilder-X.Y.Z.zip
python tools/make_release.py --verify dist/slidebuilder-X.Y.Z.zip
python tools/make_release.py --notes X.Y.Z              # the text the GitHub release will show
```
- [ ] "OK: … files match MANIFEST.json"; the notes are the CHANGELOG section.

## 4. Rehearsal on a COPY of a share folder
Use a copy (never the real share): the program files, `backend\data\` with real-looking saved decks,
some workbooks, `app\` if the share has side-by-side versions already.
```
python tools/update.py --root <copy> --zip dist/slidebuilder-X.Y.Z.zip --yes   # install X.Y.Z side by side
python <copy>/app/X.Y.Z/helper/slide_builder.py --selftest                  # again by hand: PASSED
python <copy>/app/X.Y.Z/helper/slide_builder.py --no-browser --port 8799    # starts; uses <copy>'s data
python tools/update.py --root <copy> --use P.Q.R                              # rollback works (when P.Q.R is installed)
python tools/update.py --root <copy> --use X.Y.Z
```
- [ ] install, self-test, start, rollback and forward all work; `<copy>\backend\data\` is unchanged apart
      from `backups\before-update-*` and `locks\`.

## 5. Tag (a person)
- [ ] In `CHANGELOG.md`, `## X.Y.Z - unreleased` becomes `## X.Y.Z - <date>`; commit and push that to `main` first.
```
git checkout main && git pull
git tag -a vX.Y.Z -m "Slide Builder X.Y.Z"
git push origin vX.Y.Z
```
- [ ] The `release` workflow is green and the GitHub release has `slidebuilder-X.Y.Z.zip` and its `.sha256`.
- [ ] Downloaded ZIP verifies: `python tools/make_release.py --verify slidebuilder-X.Y.Z.zip`.

A test of the pipeline without a real release: tag `vX.Y.Z-rc1` (a pre-release; delete it afterwards).

## 6. Update the team's share (a person, on one PC, when nobody is in the middle of an export)
```
REM first time (the share still updates from git/ZIP): the share's updater is older and has no --release,
REM so bring the new updater first (a plain update to main), then switch:
"T:\Slide Builder\Update Slide Builder.bat"
"T:\Slide Builder\Update Slide Builder.bat" --release X.Y.Z
REM later releases (the share has app\current.json): a plain double-click follows the newest release
"T:\Slide Builder\Update Slide Builder.bat"
```
- [ ] The output says "self-test passed" and "Version X.Y.Z is now the current version".

**The first release after 4.0.0 (once, by hand).** The share's 4.0.0 updater still asks only GitHub's API (60
requests an hour for the whole office) and retries a refusal, so until this release is installed a used-up limit
still prints 4.0's old message ("Could not download …: HTTP Error 403: Forbidden"). Install it in PowerShell 5.1,
one of these two ways:
```
# a) when GitHub's API limit is not used up
& "T:\Slide Builder\Update Slide Builder.bat" --release X.Y.Z
# b) otherwise: download slidebuilder-X.Y.Z.zip and slidebuilder-X.Y.Z.zip.sha256 with the browser from the
#    release page (github.com/Gualbertol123/slidemaster/releases/tag/vX.Y.Z); the hash must equal the .sha256 file's
Get-FileHash "$env:USERPROFILE\Downloads\slidebuilder-X.Y.Z.zip" -Algorithm SHA256
Get-Content "$env:USERPROFILE\Downloads\slidebuilder-X.Y.Z.zip.sha256"
& "T:\Slide Builder\Update Slide Builder.bat" --zip "$env:USERPROFILE\Downloads\slidebuilder-X.Y.Z.zip" --yes
```
- [ ] The output says "MANIFEST.json verified: version X.Y.Z" and "Version X.Y.Z is now the current version".

**The new `Update Slide Builder.bat` (once, by hand).** An update replaces `tools\update.py` but never an existing
`Update Slide Builder.bat` (it may be the file running the update), so its Python 3.8 check and its "The update
stopped" line reach the share only this way. Do it while nobody is running an update: `Test-Path` must print
`False` (no update lock). The old file stays as `Update Slide Builder.bat.old` until the next release.
```
Test-Path "T:\Slide Builder\backend\data\locks\update.lock"
Copy-Item "T:\Slide Builder\Update Slide Builder.bat" "T:\Slide Builder\Update Slide Builder.bat.old"
Copy-Item "T:\Slide Builder\app\X.Y.Z\Update Slide Builder.bat" "T:\Slide Builder\Update Slide Builder.bat" -Force
```
- [ ] Double-click `T:\Slide Builder\Update Slide Builder.bat`: it says "Already up to date (version X.Y.Z) …"
      and waits for a key.
- [ ] Everybody closes the black Slide Builder window and starts it again.
- [ ] **4.6.0 and later (ADR-019), in the update-day message:** every Slide Builder window and black window is
      closed before the update. A window of an older version left open on a deck that holds 4.6 objects turns
      read-only, and an older version opening such a deck says "a journal of this deck is damaged - tell the
      maintainer": that message means **update Slide Builder** (close the black window and start it again), not a
      damaged deck. The first 4.6 object saved on a deck shows "Saving…" for about 25 seconds, once per deck.
- [ ] Rollback, if needed: `python tools\update.py --use P.Q.R` (in `T:\Slide Builder`). **The first release on a
      share** (it still ran `backend\`, so there is no P.Q.R in `app\`): rename `app\current.json` to
      `app\current.json.off` - "Start Slide Builder.bat" then starts `backend\` again, as before the update.

## 7. Record
- [ ] `PROGRESS.md`: the ship step ticked with the date, the version and the release link.
