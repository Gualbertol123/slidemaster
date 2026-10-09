# Release checklist (every release: v3.4, v3.5, … v4.x)

Copy this list into the release PR or issue and tick it. Steps 1–4 can be done by an agent; **steps 5–7
are for a person** (agents never push tags and never touch the real share, PLAN Part A).
`X.Y.Z` is the new version, `P.Q.R` the one the share runs now.

## 1. Content
- [ ] The milestone's PR is merged into `main`; CI is green on `main` (unit, core, helper 3.8 + 3.12, e2e, parity).
- [ ] Every step of the milestone is ticked in `PROGRESS.md` with its numbers.
- [ ] `CHANGELOG.md` has a `## X.Y.Z - <date>` section; every user-visible change in it is in PLAN B1–B14.
- [ ] `VERSION = "X.Y.Z"` in `backend/slidebuilder/__init__.py`; `"version": "X.Y.Z"` in `package.json`,
      `app/package.json`, `core/package.json` and in `package-lock.json` (every place that names them).

## 2. Checks on a clean clone
```
git clone https://github.com/gualbertol123/slidemaster.git /tmp/rel && cd /tmp/rel
npm ci && npm run build && git diff --exit-code -- backend/slide_builder.html      # the committed page is fresh
npm run check                                                                         # typecheck (core, app) + unit tests
python3.8 -m unittest discover -s backend/tests && python3.12 -m unittest discover -s backend/tests
npm run test:e2e && npm run parity
```
- [ ] all green; `npm run parity` reports 0 unaccepted differences.

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
python <copy>/app/X.Y.Z/backend/slide_builder.py --selftest                  # again by hand: PASSED
python <copy>/app/X.Y.Z/backend/slide_builder.py --no-browser --port 8799    # starts; uses <copy>'s data
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
- [ ] Everybody closes the black Slide Builder window and starts it again.
- [ ] Rollback, if needed: `python tools\update.py --use P.Q.R` (in `T:\Slide Builder`). **The first release on a
      share** (it still ran `backend\`, so there is no P.Q.R in `app\`): rename `app\current.json` to
      `app\current.json.off` - "Start Slide Builder.bat" then starts `backend\` again, as before the update.

## 7. Record
- [ ] `PROGRESS.md`: the ship step ticked with the date, the version and the release link.
