# Changelog

Every user-visible change, per release (PLAN Part B §8 lists the only ones allowed during the rebuild).
Releases are made with `docs/next/release-checklist.md`.

## Unreleased

What users notice
* **Comment… dialog: the "Unit after amounts" and "Ignore below" boxes keep what you type.** A space can be
  typed at the end of the unit ("mln EUR"), and "Ignore below" accepts numbers that start with 0 ("0.5").
  Before, each key press cleaned the box. Approved by the product owner on 2026-10-10 (PROGRESS.md).

## 3.5.0 - 2026-10-09

What users notice
* Nothing changes in the slides, the exports or the saved setups (checked against 3.4 on every test deck).
* A few things on screen now update at once instead of with the next background check (up to 10 seconds
  later): a message disappears as soon as its button ("Open", "Show folder") is clicked; the export-engine
  status after an install; the undo/redo buttons after undoing a change of another workbook; "Updated by …
  n min ago" keeps counting on its own (accepted in PROGRESS.md, Decisions, 2026-10-09).
* **"Saving…" shows in the status bar while a change is being written** (B6, like "✓ Saved" in 3.4). It
  used to appear only if something else redrew the status bar during the save.

Under the hood (no visible change)
* The screen around the slides is now real React 19 (it was Preact running the same code). The page is
  larger (about 660 kB instead of 465 kB) and still opens from disk without the helper.
* One store with selectors replaces the global state: a selection change redraws only the toolbars, the
  formula bar and the status bar; a background check that brings nothing new redraws nothing.
* The sources moved from `frontend/` to `app/`, with an empty `core/` package next to it for the next
  milestone (npm workspaces).

## 3.4.0 - 2026-10-09

What users notice
* **"✓ Saved" appears as soon as the change is on the shared folder**, instead of up to 3 seconds later
  (B6). A failed save or a "reload the page" message also shows at once.
* **The Open menu reads the list of workbooks when it opens**, instead of every 6 seconds in the
  background (B13). The "saved again in Excel" banner now checks only the open workbook.
* **Slide Builder starts in an Edge app window** (no tabs, no address bar) when Microsoft Edge is
  installed, and in a normal browser tab otherwise (B12). `SLIDEBUILDER_APP_WINDOW=0` keeps the tab.

For whoever updates the shared folder
* **Side-by-side versions with rollback.** `Update Slide Builder.bat` can install a release next to the
  current one (`app\<version>\`), test it against the folder's saved setups (`--selftest`, read-only), and
  only then switch `app\current.json`. `python tools\update.py --use <version>` goes back at once; the last
  3 versions are kept. `--zip <file>` installs a release ZIP without internet. A folder that has switched
  to releases keeps following releases; others keep the git/ZIP update as before.
* Releases are built by GitHub Actions on a version tag (`tools/make_release.py`, `MANIFEST.json` with a
  SHA-256 per file, checked by the updater together with GitHub's digest).

Under the hood (no visible change)
* Presence ("bob is also here") reads one directory listing instead of every heartbeat file; together with
  the Open-menu change, an idle user's file operations on the share drop about tenfold (measured: 910 to 78
  per user per minute with 10 users and 20 other decks, `tools/loadtest.py --count-ops --idle`; see
  PROGRESS.md, S0.4). Saves and polling are unchanged.
* Continuous integration (`npm run check`, helper tests on Python 3.8 and 3.12, end-to-end tests), golden
  captures of v3 for the rebuild (`golden/`, `npm run parity`), field-test kit (`tools/sharetest.py`,
  `tools/fieldcheck.html`, `docs/next/field-results.md`).

## 3.0 - earlier

The versions before 3.4 were not numbered per release; see the git history.
