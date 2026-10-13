# Changelog

Every user-visible change, per release (PLAN Part B §8 lists the only ones allowed during the rebuild).
Releases are made with `docs/next/release-checklist.md`.

## 3.7.0 - 2026-10-13

What users notice – the export (PLAN S3.7–S3.8; piloted, go on 2026-10-13)
* **Slide Builder writes the PDFs and pictures itself.** No export engine (Chrome) is needed any more for
  *Export PDF*, *PDF · as pictures*, *PNG* and *Copy current slide*; the work runs in the background, the window
  keeps responding. The 20-slide test deck (3.6: the baseline in `docs/next/01-current-system.md` §3.2, and the
  3.6 way measured again on 2026-10-13 with the old-engine item; 3.7: `npm run bench`, PROGRESS.md Measurements):

  | | 3.6 (export engine) | 3.7 |
  |---|---|---|
  | Liquid Glass, click → PDF saved | 9.4–10.7 s (5.6–5.8 s on 2026-10-13) | 1.3–1.5 s |
  | Liquid Glass, PDF size | 24.7 MB (25.0 MB) | 1.3 MB |
  | Excel / Excel Refined, click → PDF saved | 2.2–2.5 s (1.5–1.6 s) | 0.33–0.44 s |
  | Excel / Excel Refined, PDF size | 2.7 MB (3.3 MB) | 0.26 MB |
  | Liquid Glass, PDF as pictures | 90 s, 125 MB (4× pages) | 7–8 s, 69 MB (2× pages) |

  Every test deck's PDF is 1.3–18× smaller than 3.6's; the text in it is the slide's text once (3.6's PDFs held
  table texts twice and "ﬁ" ligatures, so copy / search gave doubled text).
* **Opened from disk (without the helper), exports work too: the files are downloaded** (B1). The browser asks
  once to use the PC's fonts; refused, the PDF is made of pictures and the message says so. Exports of several
  files (every version, PNG of every slide) are several downloads: the browser may ask once to allow that.
* **PDF · as pictures uses lossless pictures at 2× instead of 4×** (B9): sharp on screen, a quarter of the
  pixels (Excel, 20 slides: 11.6 MB; Liquid Glass 69 MB instead of 125 MB – its wallpaper's fine grain does not
  compress further).
* **Every version export is named `<workbook> - <version> - <design>.pdf`** (B11), also in one design.
  If one of them fails, the others are still saved and the message names the failed ones.
* A message names any font that had to be replaced in the PDF (a font of the library stored as WOFF2, as most
  Google fonts, is drawn with the next font of its list; the old engine below still embeds it).
* For this release only: **Export ▾ › PDF · text & tables (old engine)** makes the PDF the 3.6 way
  (`<workbook> (old engine) - slides.pdf`), and **Report a problem with this export…** saves a short report with
  the last export's details as a JSON file in `export\feedback\` (downloaded when opened from disk).
* In a dialog's text box, Enter starts a new line.
* A variable font uploaded to the font library is stored as a static .ttf at the weight given when uploading,
  so PDFs can embed it.

What users notice (fixes found by the review before M3, `docs/next/review-pre-M3.md`; approved by the product
owner on 2026-10-12)
* **Opening a second workbook while the first one is still being read** (a second drop, or Browse… during an
  upload) opens the newer one only. Before, the slides of one workbook could be shown and saved under the
  other's name.
* **Other people's changes no longer disappear for a moment on a slow shared folder** (a late answer could
  replace a newer one).
* **The "Reading…" / "Preparing pictures…" screen never stays up after an error**: the error is shown instead.
* **A large workbook whose saved slides use no sheet** (cover or contents only) shows the data of the tables
  added later at once, without a reload.
* **If the background reader stops** (e.g. out of memory on a huge workbook), the window says so and asks to
  reload, and no further edit is taken as if it were saved.
* **Changes that are not saved yet are kept** when another workbook is opened while the shared folder is
  failing (they keep being retried), and the browser asks before the window is closed with unsaved changes.
* **A password-protected workbook** is refused at once with a clear message ("is protected …") instead of
  "Converting with Excel…" for up to 4 minutes; Excel's conversion of other files never waits on a password.
* **A shared folder that stops answering** shows an error after 60 s (5 minutes for reading, uploading and
  converting a workbook) instead of "Saving…" or "Opening…" for ever; saving is retried.
* **Opened from disk (file://), a full browser storage** shows "not saved" instead of "Saved in this browser".

Also in 3.6.0 (not listed there)
* New texts in the wizard while a large workbook is read: "Reading the workbook…", "Reading “<sheet>”…",
  "“<sheet>” could not be shown: …"; a damaged workbook's message now names the reader's reason.
* The helper accepts a burst of requests without the ~1 s TCP retry (a save could stay "Unsaved changes" for a
  moment); the start file prints clearer messages when Python or the installed version is missing.
* The core worker holds the workbook: page and worker together use about 40 MB with a 130,000-row sheet open
  (the 15 MB of 3.6.0's note was the page alone).

Under the hood
* The page receives the document from the core worker only when it changed (not with every save-state
  change), and compares it once per confirmed edit.
* Goldens re-captured from v3.4.0 on the reference PC, so geometry, pixels and PDF positions are compared again
  (`golden/README.md`); a fresh Windows checkout builds the committed page and runs the tests (LF line ends,
  `python` on Windows).
* `npm run bench` also gates the core worker's memory and the first-slide task (250 ms), and scales its time
  limits by at most 2× on slower machines.

## 3.6.0 - 2026-10-12

What users notice
* **Opening a large workbook no longer freezes the window** (B8). The workbook is read in the background:
  the window keeps responding, the progress bar moves, and a 130,000-row sheet appears in the wizard in
  under a second (about 3 seconds in 3.5). The wizard's preview of a large sheet fills in row block by row
  block instead of all at once.
* **Comment… dialog: the "Unit after amounts" and "Ignore below" boxes keep what you type.** A space can be
  typed at the end of the unit ("mln EUR"), and "Ignore below" accepts numbers that start with 0 ("0.5").
  Before, each key press cleaned the box. Approved by the product owner on 2026-10-10 (PROGRESS.md).
* Nothing else changes in the slides, the exports or the saved setups (checked against 3.5 on every test deck).

Under the hood (no visible change)
* The workbook, the shared document and undo/redo live in a background worker ("core"); the page keeps
  read-only copies of the parts it shows. The page uses about 15 MB of memory with a 130,000-row sheet
  open instead of about 300 MB.
* Workbooks are read with a small XML reader and a columnar sheet store instead of the browser's XML parser
  and one object per cell; JSZip is replaced by fflate.
* The page needs a browser from 2021 or later (Chromium 94+: Edge and Chrome on every supported PC).
* `npm run bench` measures the page in Chromium too (open a 20-slide deck, read a 130,000-row sheet, long
  tasks, memory); CI fails above the limits.

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
