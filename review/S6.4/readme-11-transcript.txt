README §11.2-§11.3 typed as written, from a new clone of GitHub (branch v4/M6-hardening at ce29447), on the reference PC (Windows 11, Git Bash), 2026-10-15. Only addition: the portable Node on PATH (§11.1). Lines of the helper's own log ([WebServer] …) are kept.

$ node --version
v22.23.3

$ python --version
Python 3.12.7

$ export NODE_OPTIONS=--use-system-ca

$ NODE_OPTIONS=--use-system-ca

$ git clone https://github.com/gualbertol123/slidemaster.git
Cloning into 'slidemaster'...

$ cd slidemaster

$ git checkout v4/M6-hardening
Switched to a new branch 'v4/M6-hardening'
branch 'v4/M6-hardening' set up to track 'origin/v4/M6-hardening'.

$ git log --oneline -1
ce29447 S6.4 · Documentation for Slide Builder 4

$ npm ci

added 110 packages, and audited 113 packages in 5s

19 packages are looking for funding
  run `npm fund` for details

4 vulnerabilities (1 moderate, 3 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

$ npx playwright install chromium

$ npm run build

> slide-builder@4.0.0 build
> npm run build -w app


> @slide-builder/app@4.0.0 build
> tsc --noEmit && vite build

vite v7.3.7 building client environment for production...
transforming...
✓ 136 modules transformed.
rendering chunks...
[plugin vite:singlefile] 

[plugin vite:singlefile] Inlining: slide_builder-Bo2za9R_.js
../helper/slide_builder.html  1,513.67 kB
✓ built in 3.39s

$ git diff --exit-code -- helper/slide_builder.html

$ npm run check

> slide-builder@4.0.0 check
> npm run check -w core && npm run check -w app


> @slide-builder/core@4.0.0 check
> tsc --noEmit -p . && tsc --noEmit -p tests && vitest run


 RUN  v5.0.3 C:/Users/U508169/AppData/Local/Temp/readme11-S6.4/slidemaster/core


 Test Files  24 passed (24)
      Tests  457 passed (457)
   Start at  21:22:11
   Duration  91.61s (tests 62%, environment 29%, transform 5%, import 3%)


> @slide-builder/app@4.0.0 check
> tsc --noEmit && vitest run


 RUN  v5.0.3 C:/Users/U508169/AppData/Local/Temp/readme11-S6.4/slidemaster/app

Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

 Test Files  9 passed (9)
      Tests  41 passed (41)
   Start at  21:23:49
   Duration  10.41s (import 48%, environment 25%, tests 20%, transform 5%, setup 2%)


$ python -m unittest discover -s helper/tests
C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\paths.py:1: SyntaxWarning: invalid escape sequence '\ '
  """Folder layout (ARCHITECTURE �1.3, �2.1).
C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\paths.py:35: SyntaxWarning: invalid escape sequence '\<'
  """the main folder when this program runs from <main>\app\<ver>\helper (a release install), else None"""
.......21:24:01 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
...........21:24:05 INCIDENT: deck Weekly_IBD.xlsx-7bf733017c, journal tester@pc1#n6t4sj52.log is damaged at byte 101 - the deck is read-only (incident-tester_pc1_n6t4sj52-101.json)
..21:24:05 removed a stale lock 'deck Weekly_IBD.xlsx-7bf733017c' (held by c@pc-c)
........21:24:14 removed a stale lock 'deck Weekly_IBD.xlsx-7bf733017c' (held by anna@pc-anna)
...................21:24:15 export feedback saved: feedback/20261015-212415-a_b_c.json
.2026-10-13T10:15:00 export feedback saved: feedback/20261013-101500-ana.json
2026-10-13T10:15:00 export feedback saved: feedback/20261013-101500-ana (2).json
.21:24:15 exported Deck - Q3 sales EMEA.pdf (6 bytes) in 0.02s
.21:24:15 exported A - slides.pdf (8 bytes) in 0.02s
21:24:15 exported A - slides (2).pdf (8 bytes) in 0.02s
..21:24:16 exported Weekly - slides.pdf (23 bytes) in 0.02s
21:24:16 exported L.png (74 bytes) in 0.01s
21:24:16 exported Weekly - a_b_c_.png (74 bytes) in 0.01s
21:24:16 exported Weekly - Chief - Excel.pdf (23 bytes) in 0.02s
.21:24:16 exported B - slides.pdf (6 bytes) in 0.01s
.................................21:24:25 removed a stale lock 'wb-y' (held by ghost@pc9)
......s.21:24:29 export feedback saved: feedback/20261015-212429-tester.json
.21:24:29 exported Deck - Chief - Liquid Glass.pdf (23 bytes) in 0.02s
21:24:29 exported Deck - Cover.png (77 bytes) in 0.01s
..21:24:30 busy: Book One.xlsx cannot be checked right now ([Errno 64] The specified network name is no longer available)
...21:24:32 busy: Half.xlsx: the file is incomplete (still being saved?) - try again in a moment
..............21:24:45 lock 'mine' was taken over by someone else meanwhile - left alone
.21:24:45 removed a stale lock 'old' (held by ghost@pc9)
....21:24:47 Edge could not open the app window (blocked by policy) - opening a browser tab
...21:24:49 Slide Builder 3.8.0 (another version) is running on port 9100 - starting 4.0.0 on the next port.
21:24:49 Slide Builder is already running on port 9100 - opening it.
....21:24:51 imported the v2 settings: 1 workbook(s), shared defaults (kept existing: IBD weekly.xlsx, Existing.xlsx)
.21:24:51 imported the v2 settings: 2 workbook(s) (kept existing: Existing.xlsx)
.21:24:51 imported the v2 settings: 2 workbook(s), shared defaults (kept existing: Existing.xlsx)
...21:24:52 imported the v2 settings: 2 workbook(s), shared defaults (kept existing: Existing.xlsx)
.21:24:52 the v2 settings file could not be read (Expecting property name enclosed in double quotes: line 1 column 3 (char 2)) - not imported, it is left as it is
.21:24:56 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
.21:24:58 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
..21:25:01 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
21:25:02 deck Weekly_IBD.xlsx-7bf733017c rolled back to Slide Builder 3 (rev 2)
21:25:02 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 3, the v3 file is frozen)
..21:25:06 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
.21:25:08 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
21:25:08 deck Weekly_IBD.xlsx-7bf733017c rolled back to Slide Builder 3 (rev 1)
21:25:08 deck Weekly_IBD.xlsx-7bf733017c moved to Slide Builder 4 (gen 2, the v3 file is frozen)
..21:25:12 deck Weekly_IBD.xlsx-7bf733017c rolled back to Slide Builder 3 (rev 0)
.21:25:14 deck Weekly_IBD.xlsx-7bf733017c rolled back to Slide Builder 3 (rev 2)
.21:25:16 deck A.xlsx-230d25c37c moved to Slide Builder 4 (gen 1, the v3 file is frozen)
21:25:16 deck B.xlsx-86e1019b41 moved to Slide Builder 4 (gen 1, the v3 file is frozen)
..21:25:22 deck Weekly_IBD.xlsx-7bf733017c rolled back to Slide Builder 3 (rev 4)
...warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'helper/slide_builder.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'helper/slidebuilder/__init__.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'helper/slidebuilder/server.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'tools/make_release.py', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'tools/update.py', LF will be replaced by CRLF the next time Git touches it
......C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\zipfile\__init__.py:1607: UserWarning: Duplicate name: 'helper/slide_builder.py'
  return self._open_to_write(zinfo, force_zip64=force_zip64)
.........................Traceback (most recent call last):
  File "C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\server.py", line 301, in _dispatch
    if route is None or route(u.path, q) is False:
                        ^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\server.py", line 532, in _post
    return self._send(200, capture_sysfont((q.get("file") or [""])[0]))
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\sysfonts.py", line 326, in capture
    out.update(mode="copy", **_copy_family(family, user=user))
                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\sysfonts.py", line 278, in _copy_family
    lib, added = library.add_system_faces(family, faces, user=user)
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\helper\slidebuilder\fonts.py", line 159, in add_system_faces
    write_json(_index_path(), lib)
  File "C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\unittest\mock.py", line 1139, in __call__
    return self._mock_call(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\unittest\mock.py", line 1143, in _mock_call
    return self._execute_mock_call(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\unittest\mock.py", line 1198, in _execute_mock_call
    raise effect
OSError: the share is full
.....Windows fonts used by decks are now copied to the shared font library (confirmed by J. Doe, 2026-10-14).
...........................Windows fonts are no longer copied: every PC lays out with its own (fingerprint mode).
Giving every deck back to Slide Builder 3 first...
Giving every deck back to Slide Builder 3 first...
Version 3.8.0 is now the current version (was 4.0.0).
....21:27:38 Weekly_IBD.xlsx-7bf733017c.json was not converted now (this file was saved by a newer version of Slide Builder (format 99, this one reads up to 3) - close the Slide Builder window and start it again to use the update) - it is converted when it is opened
.21:27:38 converted Weekly_IBD.xlsx-7bf733017c.json from format 3 to 4 - the old file is in backups\upgrades\workbook\Weekly_IBD.xlsx-7bf733017c.v3.20261015-212738.json
...21:27:38 converted config.json from format 3 to 4 - the old file is in backups\upgrades\config\config.v3.20261015-212738.json
21:27:38 converted Weekly_IBD.xlsx-7bf733017c.json from format 3 to 4 - the old file is in backups\upgrades\workbook\Weekly_IBD.xlsx-7bf733017c.v3.20261015-212738.json
21:27:38 converted tester.json from format 1 to 2 - the old file is in backups\upgrades\prefs\tester.v1.20261015-212738.json
.21:27:38 converted Weekly_IBD.xlsx-7bf733017c.json from format 3 to 5 - the old file is in backups\upgrades\workbook\Weekly_IBD.xlsx-7bf733017c.v3.20261015-212738.json
.21:27:39 converted Weekly_IBD.xlsx-7bf733017c.json from format 3 to 4 - the old file is in backups\upgrades\workbook\Weekly_IBD.xlsx-7bf733017c.v3.20261015-212739.json
.......
----------------------------------------------------------------------
Ran 228 tests in 219.273s

OK (skipped=1)

$ npm run test:e2e

> slide-builder@4.0.0 test:e2e
> npm run test:e2e -w app


> @slide-builder/app@4.0.0 test:e2e
> playwright test


Running 24 tests using 1 worker

  ✓   1 e2e\app.spec.ts:131:3 › two people, one shared folder › anna creates the deck with the wizard (2.4s)
  ✓   2 e2e\app.spec.ts:151:3 › two people, one shared folder › thumbnails are pictures with their tags; an edit draws its own slide again, no other (6.1s)
  ✓   3 e2e\app.spec.ts:170:3 › two people, one shared folder › edits by anna and bob on the same workbook are merged, and each sees the other (15.9s)
[WebServer] ================================================================
[WebServer]  Slide Builder 4.0.0
[WebServer]  Workbooks: C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\root
[WebServer]  Exports  : C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\root\export
[WebServer]  Data     : C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\data
[WebServer]  Open     : http://127.0.0.1:8951/
[WebServer]  Keep this window open while you work. Ctrl+C to stop.
[WebServer] ================================================================
[WebServer] 21:28:14 exported report - slides.pdf (298794 bytes) in 0.02s
[WebServer] 21:28:14 exported report - slides.pdf (298934 bytes) in 0.02s
[WebServer] 21:28:16 exported report - slides (images).pdf (14583332 bytes) in 0.04s
[WebServer] 21:28:19 exported report - slides (images).pdf (14583332 bytes) in 0.05s
[WebServer] 21:28:21 exported report - slides.pdf (298794 bytes) in 0.02s
[WebServer] 21:28:22 exported report - SLIDE_1.pdf (246758 bytes) in 0.02s
  ✓   4 e2e\app.spec.ts:213:3 › two people, one shared folder › export writes a PDF into the shared export folder (9.9s)
[WebServer] 21:28:24 exported report - Index.png (7188477 bytes) in 0.02s
[WebServer] 21:28:27 exported report - Cover.png (7942091 bytes) in 0.03s
[WebServer] 21:28:27 exported report - Index.png (7188477 bytes) in 0.03s
[WebServer] 21:28:27 exported report - SLIDE_1.png (6157745 bytes) in 0.03s
[WebServer] 21:28:28 exported report - SLIDE_3 pair.png (6616174 bytes) in 0.02s
[WebServer] 21:28:30 export feedback saved: feedback/20261015-212830-anna.json
  ✓   5 e2e\app.spec.ts:267:3 › two people, one shared folder › PNG of the current slide and of every slide; the current slide copied to the clipboard (8.4s)
  ✓   6 e2e\app.spec.ts:317:3 › two people, one shared folder › table tools: same size, alignment, widths, text boxes, colour scale, Shift+arrows (10.3s)
  ✓   7 e2e\app.spec.ts:379:3 › two people, one shared folder › drags on the slide: corner scale, grip move, border double-click – each one undo step (5.7s)
  ✓   8 e2e\app.spec.ts:421:3 › two people, one shared folder › wizard table picker: Shift+arrows select, Enter adds the table (1.9s)
  ✓   9 e2e\app.spec.ts:435:3 › two people, one shared folder › header colour, merge/unmerge, format painter, footer (4.7s)
  ✓  10 e2e\app.spec.ts:471:3 › two people, one shared folder › painter copies conditional formats; gridlines, vertical align, border drag, text box bubble, contents subtitles, themes (15.3s)
  ✓  11 e2e\app.spec.ts:564:3 › two people, one shared folder › typing is never overwritten by autosave or other people's changes; logo bubble can be removed (8.8s)
  ✓  12 e2e\app.spec.ts:592:3 › two people, one shared folder › one text toolbar for cells, titles and text boxes; deck text styles; shared font library (6.9s)
  ✓  13 e2e\app.spec.ts:652:3 › two people, one shared folder › automated comments: one short summary for the slide's tables, follows the numbers; text boxes stretch and snap (3.8s)
  ✓  14 e2e\app.spec.ts:707:3 › two people, one shared folder › the + button puts a text box there at once; text boxes move anywhere, snap, and attach back (3.4s)
  ✓  15 e2e\app.spec.ts:737:3 › two people, one shared folder › notes section of a slide: where the footer is, movable next to the page number; raw Excel adds nothing; menus open (4.0s)
[WebServer] ================================================================
[WebServer]  Slide Builder 4.0.0
[WebServer]  Workbooks: C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\root
[WebServer]  Exports  : C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\root\export
[WebServer]  Data     : C:\Users\U508169\AppData\Local\Temp\sb-e2e-cc2LpP\data
[WebServer]  Open     : http://127.0.0.1:8952/
[WebServer]  Keep this window open while you work. Ctrl+C to stop.
[WebServer] ================================================================
[WebServer] 21:29:39 exported weekly - Chief - Liquid Glass.pdf (309569 bytes) in 0.03s
[WebServer] 21:29:39 exported weekly - All - Liquid Glass.pdf (309302 bytes) in 0.03s
[WebServer] 21:29:39 exported weekly - Chief - Excel.pdf (73976 bytes) in 0.02s
[WebServer] 21:29:39 exported weekly - All - Excel.pdf (73843 bytes) in 0.02s
[WebServer] 21:29:39 exported weekly - Chief - Liquid Glass.pdf (309569 bytes) in 0.03s
[WebServer] 21:29:39 exported weekly - Chief - Excel.pdf (73976 bytes) in 0.02s
[WebServer] 21:29:39 exported weekly - All - Liquid Glass.pdf (309302 bytes) in 0.02s
[WebServer] 21:29:39 exported weekly - All - Excel.pdf (73843 bytes) in 0.02s
[WebServer] 21:29:39 exported weekly - Chief - Excel Refined.pdf (103581 bytes) in 0.02s
[WebServer] 21:29:40 exported weekly - All - Excel Refined.pdf (103449 bytes) in 0.02s
[WebServer] 21:29:40 exported weekly - Chief - Liquid Glass.pdf (309569 bytes) in 0.02s
[WebServer] 21:29:40 exported weekly - All - Liquid Glass.pdf (309302 bytes) in 0.02s
  ✓  16 e2e\app.spec.ts:772:3 › two people, one shared folder › versions: Chief and All made in the wizard, cells removed in All, every version × design exported; superscripts (5.0s)
  ✓  17 e2e\app.spec.ts:830:3 › two people, one shared folder › wizard on a sheet larger than the preview: the selection box sits exactly on the selected cells (3.5s)
  ✓  18 e2e\app.spec.ts:855:3 › two people, one shared folder › Prepare rollback: every deck's changes folded into its snapshot, nothing left past the frontier (04 §4.4) (40.1s)
--- trail of no page errors, console errors or warnings (last 150 events)
save status: (no status bar)
decks: big.xlsx-a5df0549ff, report.xlsx-e411b4810e, weekly.xlsx-e0bb5a39d0
  ✘  19 e2e\app.spec.ts:884:3 › two people, one shared folder › no page errors, console errors or warnings (1.2s)
  ✓  20 e2e\file.spec.ts:25:1 › opened from file://: choose a workbook, make the deck, edit a cell, keep it after a reload (2.8s)
  ✓  21 e2e\file.spec.ts:66:1 › opened from file://: an .xlsb opens natively, without Excel (1.1s)
  ✓  22 e2e\file.spec.ts:95:1 › opened from file://: exports are downloads (PDF with the PC's fonts, PNG) (6.8s)
  ✓  23 e2e\file.spec.ts:123:1 › opened from file:// without access to the PC's fonts: the PDF is made of pictures, and the toast says so (2.3s)
  ✓  24 e2e\open.spec.ts:33:1 › a dropped workbook opens; of two drops at once the newer opens; reload from disk; changed on disk (7.4s)


  1) e2e\app.spec.ts:884:3 › two people, one shared folder › no page errors, console errors or warnings 

    Error: expect(received).toEqual(expected) // deep equality

    - Expected  - 1
    + Received  + 3

    - Array []
    + Array [
    +   "console.error: Failed to load resource: net::ERR_CONNECTION_TIMED_OUT @ /api/decks/open:0",
    + ]

      882 |   });
      883 |
    > 884 |   test("no page errors, console errors or warnings", async () => { expect(unexpected(errors)).toEqual([]); });
          |                                                                                               ^
      885 | });
      886 |
      887 | /** a minimal TrueType file: name table (family) + OS/2 (weight) – enough for the upload and its name detection */
        at C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\app\e2e\app.spec.ts:884:95

    Error Context: test-results\app-two-people-one-shared--a9bd5--console-errors-or-warnings\error-context.md

  1 failed
    e2e\app.spec.ts:884:3 › two people, one shared folder › no page errors, console errors or warnings 
  23 passed (3.1m)
npm error Lifecycle script `test:e2e` failed with error:
npm error code 1
npm error path C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\app
npm error workspace @slide-builder/app@4.0.0
npm error location C:\Users\U508169\AppData\Local\Temp\readme11-S6.4\slidemaster\app
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c playwright test

$ python -m pip install --user pypdf
Requirement already satisfied: pypdf in C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\site-packages (6.7.5)

$ npm run parity

> slide-builder@4.0.0 parity
> npm run parity -w app


> @slide-builder/app@4.0.0 parity
> node ../tools/parity.mjs

SP (screen = PDF) not run: this environment is not the goldens'
capturing this build...
NOTE: this machine's Chromium or fonts differ from the goldens' - only texts were compared (geometry, pixels and PDF positions need the same environment).
accepted  big · glass · full · slide-1.json · style: #0 .title "WM_ALL_STOCK_new": font -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Display", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #4 .t "Total": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #5 .t "Stock": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #6 .t "Stock": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #7 .t "Stock": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #8 .t "EOM Bdg": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #9 .t "(mln Euro at last fixed exchange rate)": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #10 .t "01/09/26": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #11 .t "02/09/26": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #12 .t "03/09/26": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #13 .t "04/09/26": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #14 .t "Row 6": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #15 .t "24": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #16 .t "30": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #17 .t "36": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #18 .t "42": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #19 .t "Row 7": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #20 .t "28": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #21 .t "35": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #22 .t "42": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #23 .t "49": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #24 .t "Row 8": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #25 .t "32": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #26 .t "40": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #27 .t "48": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #28 .t "56": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #29 .t "Row 9": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #30 .t "36": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #31 .t "45": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #32 .t "54": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #33 .t "63": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #34 .t "Row 10": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #35 .t "40": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #36 .t "50": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #37 .t "60": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #38 .t "70": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #39 .t "Row 11": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #40 .t "44": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #41 .t "55": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
accepted  big · glass · full · slide-1.json · style: #42 .t "66": font -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif vs -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif
... and 11011 more (see the report)
parity: 11051 difference(s), 0 not accepted (text-only comparison) - report: ..\tests\parity\report\index.html

$ npm run dlparity

> slide-builder@4.0.0 dlparity
> node tools/dlparity.mjs

display list of excel, clean, glass: capturing…
pixels under the whole-pixel dilation alone (information): 0 slide(s) beyond the limit
dlparity (excel, clean, glass): 11051 difference(s) {"style":11051}, 0 not accepted (text-only comparison) - report: tests\parity\report-dl\index.html

$ python -m pip install --user openpyxl pillow
Requirement already satisfied: openpyxl in C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\site-packages (3.1.5)
Requirement already satisfied: pillow in C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\site-packages (12.2.0)
Requirement already satisfied: et-xmlfile in C:\Users\U508169\AppData\Local\Programs\Python\Python312\Lib\site-packages (from openpyxl) (2.0.0)

$ python tools/make_corpus.py big30 tests/corpus/workbooks
ok  big30

$ npm run bench

> slide-builder@4.0.0 bench
> npm run bench -w core && npm run bench -w app && node tools/bench.mjs --json bench-results.json


> @slide-builder/core@4.0.0 bench
> vitest run --config vitest.bench.config.ts --silent=false


 RUN  v5.0.3 C:/Users/U508169/AppData/Local/Temp/readme11-S6.4/slidemaster/core

stdout | bench/parse.bench.test.ts > big30: one sheet parsed under 0.5 s, under 40 MB retained
bench · calibration 36.6 ms: time limit × 1.15

stdout | bench/parse.bench.test.ts > big30: one sheet parsed under 0.5 s, under 40 MB retained
bench · big30 DATA_1 run 1: parse 398 ms (read 623 ms = inflate 224 ms + parse), retained 31.9 MB, 1560012 cells
bench · big30 DATA_1 run 2: parse 358 ms (read 556 ms = inflate 198 ms + parse), retained 32.9 MB, 1560012 cells
bench · big30 DATA_1 run 3: parse 343 ms (read 546 ms = inflate 204 ms + parse), retained 32.9 MB, 1560012 cells


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  21:35:41
   Duration  4.54s (tests 82%, import 11%, transform 6%)


> @slide-builder/app@4.0.0 bench
> vitest run --project react --silent=false tests/renders.test.tsx


 RUN  v5.0.3 C:/Users/U508169/AppData/Local/Temp/readme11-S6.4/slidemaster/app

Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
stdout | tests/renders.test.tsx > render counts > moving the selection re-renders only the toolbars, the formula bar and the status bar
render counts · select a cell: 5 component(s) {"Canvas":1,"FxBar":1,"Ribbon":1,"Status":1,"TableRibbon":1}

stdout | tests/renders.test.tsx > render counts > moving the selection re-renders only the toolbars, the formula bar and the status bar
render counts · extend the selection: 5 component(s) {"Canvas":1,"FxBar":1,"Ribbon":1,"Status":1,"TableRibbon":1}

Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
stdout | tests/renders.test.tsx > render counts > a poll that brings nothing new re-renders nothing
render counts · 10 polls, nothing new: 0 component(s) {}

stdout | tests/renders.test.tsx > render counts > a poll from the helper that brings equal answers (new objects, new seen-at times) re-renders nothing
render counts · 10 helper polls, equal answers: 0 component(s) {}

stdout | tests/renders.test.tsx > render counts > a toast re-renders only Toast
render counts · a toast: 1 component(s) {"Toast":1}


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  21:35:46
   Duration  5.80s (import 38%, environment 22%, transform 21%, tests 16%, setup 4%)

bench · run 1: deck20 open 369 ms (wizard 200 + slides 169) · keypress → pixels (cold 69 / 25) p50 21 / p95 37 / max 37 ms (tasks []) · thumbnails, 100 slides scrolled: 60 fps, 15.7 ms/frame (longest gap 17.5 ms, 183 pictures, tasks []) · drags border 12.7 ms/frame (24 frames, longest gap 16.9 ms, drop 18 ms), corner 9.7 ms/frame (24 frames, longest gap 83.4 ms, drop 28 ms), corner again 10.3 ms/frame (25 frames, longest gap 50 ms, drop 23 ms), stretch 6 ms/frame (24 frames, longest gap 17.3 ms, drop 19 ms), grip 5.9 ms/frame (24 frames, longest gap 17.2 ms, drop 10 ms), note move 6.5 ms/frame (24 frames, longest gap 17 ms, drop 7 ms), note stretch 4.6 ms/frame (24 frames, longest gap 17.3 ms, drop 7 ms) · export deck20 Liquid Glass 877 ms {"start":0,"lists":282,"fonts":138,"write":388} 1338.3 KB, Excel 430 ms {"start":0,"lists":176,"fonts":99,"write":103} 313.2 KB (tasks []) · big30 index 164 ms, sheet read 746 ms (grid 757 ms) · long tasks [] (first draw []) · heap 54 MB (page 19 + worker 35; 1 export workers 3 MB, not gated) · start-up tasks [117]
bench · run 2: deck20 open 432 ms (wizard 251 + slides 181) · keypress → pixels (cold 53 / 55) p50 31 / p95 36 / max 69 ms (tasks []) · thumbnails, 100 slides scrolled: 60 fps, 8 ms/frame (longest gap 17.2 ms, 183 pictures, tasks []) · drags border 10.7 ms/frame (24 frames, longest gap 17 ms, drop 15 ms), corner 7.9 ms/frame (25 frames, longest gap 33.3 ms, drop 31 ms), corner again 8.5 ms/frame (24 frames, longest gap 17.3 ms, drop 31 ms), stretch 5.5 ms/frame (24 frames, longest gap 17.2 ms, drop 19 ms), grip 3.6 ms/frame (24 frames, longest gap 17.2 ms, drop 8 ms), note move 5.5 ms/frame (24 frames, longest gap 17.4 ms, drop 8 ms), note stretch 4.8 ms/frame (24 frames, longest gap 16.8 ms, drop 8 ms) · export deck20 Liquid Glass 865 ms {"start":0,"lists":244,"fonts":140,"write":408} 1338.3 KB, Excel 442 ms {"start":0,"lists":158,"fonts":102,"write":135} 313.2 KB (tasks []) · big30 index 162 ms, sheet read 817 ms (grid 835 ms) · long tasks [] (first draw []) · heap 45 MB (page 18 + worker 28; 1 export workers 3 MB, not gated) · start-up tasks [111]
bench · calibration 34.0 ms: time limits × 1.06
bench · open_deck20_ms: 432 (limit 425 – over, within +10 %)
bench · read_big30_ms: 817 (limit 1061)
bench · longest_task_ms: 0 (limit 50)
bench · first_draw_task_ms: 0 (limit 250)
bench · heap_mb: 54 (limit 150)
bench · export_glass_ms: 877 (limit 2123)
bench · export_excel_ms: 442 (limit 1061)
bench · export_glass_kb: 1338.3 (limit 1790)
bench · export_excel_kb: 313.2 (limit 800)
bench · keypress_p95_ms: 37 (limit 50)
bench · drag_frame_ms: 12.7 (limit 16)
bench · thumbs_gap_ms: 17.5 (limit 20)
bench · not gated: longest start-up task 117 ms; most page work in a frame of the thumbnail scroll 15.7 ms (a garbage collection can fall into one)

$ python tools/loadtest4.py --ci
same - 20 users - 15 ms
  20 helpers ready on 15 ms; editing for 30 s
{"scenario": "same", "users": 20, "fs_ms": 15, "saves": 291, "save_p50": 48, "save_p95": 60, "visible_p50": 1235, "visible_p95": 1978, "tail_p95": 151, "lost": 0, "converged": true, "errors": 0, "error_examples": [], "journal_max_mb": 0.046, "journal_at_2000_mb": 0.317, "gens": [], "gens_back": [], "compactions_ok": 0, "compactions_409": 0, "saves_during_compaction": 0, "save_p95_during_compaction": null, "save_max_during_compaction": null, "undrained": [], "no_saves": [], "simulated": true, "pass": []}
same - 20 users - 40 ms
  20 helpers ready on 40 ms; editing for 30 s
{"scenario": "same", "users": 20, "fs_ms": 40, "saves": 289, "save_p50": 98, "save_p95": 116, "visible_p50": 1413, "visible_p95": 2211, "tail_p95": 361, "lost": 0, "converged": true, "errors": 0, "error_examples": [], "journal_max_mb": 0.046, "journal_at_2000_mb": 0.317, "gens": [], "gens_back": [], "compactions_ok": 0, "compactions_409": 0, "saves_during_compaction": 0, "save_p95_during_compaction": null, "save_max_during_compaction": null, "undrained": [], "no_saves": [], "simulated": true, "pass": []}
different - 20 users - 40 ms
  20 helpers ready on 40 ms; editing for 30 s
{"scenario": "different", "users": 20, "fs_ms": 40, "saves": 289, "save_p50": 98, "save_p95": 117, "visible_p50": null, "visible_p95": null, "tail_p95": 213, "lost": 0, "converged": true, "errors": 0, "error_examples": [], "journal_max_mb": 0.003, "journal_at_2000_mb": 0.314, "gens": [], "gens_back": [], "compactions_ok": 0, "compactions_409": 0, "saves_during_compaction": 0, "save_p95_during_compaction": null, "save_max_during_compaction": null, "undrained": [], "no_saves": [], "simulated": true, "pass": []}
burst - 20 users - 15 ms
  20 helpers ready on 15 ms; editing for 30 s
{"scenario": "burst", "users": 20, "fs_ms": 15, "saves": 944, "save_p50": 48, "save_p95": 59, "visible_p50": 1250, "visible_p95": 1987, "tail_p95": 159, "lost": 0, "converged": true, "errors": 0, "error_examples": [], "journal_max_mb": 0.154, "journal_at_2000_mb": 0.326, "gens": [], "gens_back": [], "compactions_ok": 0, "compactions_409": 0, "saves_during_compaction": 0, "save_p95_during_compaction": null, "save_max_during_compaction": null, "undrained": [], "no_saves": [], "simulated": true, "pass": []}
compaction - 20 users - 40 ms
  20 helpers ready on 40 ms; editing for 30 s
{"scenario": "compaction", "users": 20, "fs_ms": 40, "saves": 289, "save_p50": 97, "save_p95": 113, "visible_p50": 1478, "visible_p95": 2296, "tail_p95": 484, "lost": 0, "converged": true, "errors": 0, "error_examples": [], "journal_max_mb": 0.046, "journal_at_2000_mb": 0.317, "gens": [2, 3, 4], "gens_back": [], "compactions_ok": 3, "compactions_409": 0, "saves_during_compaction": 21, "save_p95_during_compaction": 111, "save_max_during_compaction": 124, "undrained": [], "no_saves": [], "simulated": true, "pass": []}

scenario    users  fs ms  saves   save p50   save p95 visible p50/95  lost converged result
same           20     15    291         48         60     1235/1978     0      True PASS
same           20     40    289         98        116     1413/2211     0      True PASS
different      20     40    289         98        117     None/None     0      True PASS
burst          20     15    944         48         59     1250/1987     0      True PASS
compaction     20     40    289         97        113     1478/2296     0      True PASS

$ set +x
== end
$ npm run test:e2e   # second run
  24 passed (2.9m)
