# Field results (gate G0, PLAN S0.6)

**To be filled in by a person on the real share and real corporate PCs.** Nothing here may be invented: an
empty cell means "not run yet". When every section is filled in, the product owner writes the G0 decisions
under "Decisions" in `PROGRESS.md` (PLAN S0.6: storage protocol, Acrobat recipe, font fallback).

| | |
|---|---|
| Date(s) | |
| Run by | |
| Share (path, DFS?, VPN?) | |
| PCs (name · Windows build · Edge version · Python version) | |
| Slide Builder version | v3.4 on a copy of the share folder: update it once as usual (that brings the new updater), then `Update Slide Builder.bat --release 3.4.0` |

## 1. Share test (`tools/sharetest.py`)

`tools\sharetest.py` is in the repository (a checkout of `main`), not in the release ZIP: copy it to each PC,
e.g. to `C:\temp\`, and run it from there with the PC's own Python. Run it from 3–5 PCs at once, one of them
over VPN, against a temporary sub-folder of the **real** share (the tool creates `sb-sharetest-<run>\` and
deletes it afterwards; nothing else is touched). 05 §3.5 asks for 10 writers: start 2–3 workers on each PC
(each in its own window, with `--name <pc>-1`, `--name <pc>-2` …) and count them all in `--pcs`.

```
REM on the first PC
python C:\temp\sharetest.py coordinator --folder "T:\Slide Builder" --pcs 10 --duration 120 --rdcw
REM on the PCs (2-3 windows each), with the run id the first PC prints
python C:\temp\sharetest.py worker --folder "T:\Slide Builder" --run <id> --name PC2-1
```

Paste the printed summary and attach `sharetest-<run>.json` (written in the folder the coordinator was started
from). Pass criteria are 05 §3.5 (save p95 < 150 ms, visible p95 < 4 s, 0 lost, 0 unsaved, converged). The
summary also gives "visible after the first 10 s": the first seconds can be slowed by the SMB directory cache
of a new run folder, which a real deck (folders that already exist) does not have.

| Protocol | writers | acked | lost | unsaved | converged | save p50 / p95 ms | visible p50 / p95 ms (after 10 s) | lock wait p95 ms | meets 05 §3.5? |
|---|---|---|---|---|---|---|---|---|---|
| journal | | | | | | | | – | |
| lock (lean) | | | | | | | | | |

| Round trips per PC (ms, p50 / p95) | create+write+fsync | open+read | stat | listdir | rename | delete |
|---|---|---|---|---|---|---|
| PC 1 | | | | | | |
| PC 2 | | | | | | |
| PC 3 (VPN) | | | | | | |

ReadDirectoryChangesW (`--rdcw`, journal phase): woke for ___ of ___ appends by other PCs, p50 ___ ms.
Errors: ___. (Decides S6.3.)

## 2. Page capabilities (`tools/fieldcheck.html`)

On each PC, open the page **twice** and paste the JSON box of each:
1. double-click `tools\fieldcheck.html` (file://);
2. start Slide Builder, then open `http://127.0.0.1:<port>/fieldcheck` in Edge (`<port>` = the number after
   "Open" in the black window, usually 8765).

In each, also choose a font file in the page (e.g. `C:\Windows\Fonts\calibri.ttf`, and a font from the Slide
Builder font library) for the two font rows.

| Check | file:// | from the helper |
|---|---|---|
| Blob worker (classic) | | |
| Blob worker (module) | | |
| WebAssembly in the page | | |
| WebAssembly in a worker | | |
| WebAssembly.compile | | |
| OffscreenCanvas in a worker | | |
| createImageBitmap | | |
| App window (Edge `--app`) | | |
| FontFace from bytes (page) | | |
| FontFace from bytes + OffscreenCanvas text (worker) | | |

Note from the Linux CI container (Chromium 141, for reference only, not a field result): from file://
every check passes except **Blob worker (module)**, which Chromium refuses for a `null` origin; from the
helper all pass. If Edge behaves the same, the workers of M2 must be classic (non-module) workers to keep
file:// working.

## 3. Windows policy matrix W1–W14 (05 §3.7)

Mark each row PASS / FAIL / not applicable, with a note; "v3.4 today" = what the current version does there.

| # | Condition | Expected (v4) | v3.4 today | Notes |
|---|---|---|---|---|
| W1 | AppLocker default rules (exe only from Program Files/Windows) | runs (no new exe) | | |
| W2 | WDAC enforced, unsigned binaries blocked | runs | | |
| W3 | "Programs may not run from T:\" | runs (python and msedge are local) | | |
| W4 | Edge DevTools disabled (`DeveloperToolsAvailability = 2`) and headless disabled | runs, exports work | | |
| W5 | Edge `--app` mode blocked or Edge not default | falls back to the default browser (B12) | | |
| W6 | PowerShell Constrained Language Mode | all works except `.xls` conversion; shortcut falls back to a `.bat` | | |
| W7 | TLS-intercepting proxy with a corporate root CA | `Update Slide Builder.bat --release` downloads with the Windows trust store; Google fonts are fetched by Edge (system trust) | | |
| W8 | Console cp1252 | all helper and updater output ASCII-safe | | |
| W9 | Display scaling 125/150/175 % | stage crisp; PDF page exactly 1200 × 675 pt | | |
| W10 | Python 3.8 (oldest) and 3.13 | helper and `slide_builder.py --selftest` pass | | |
| W11 | Antivirus scanning every new file on the share | journals: one new file per session; saves not slowed | | |
| W12 | SMB share via DFS namespace; via VPN at ~40 ms | load criteria 05 §3.5 met (see §1) | | |
| W13 | Fonts: a PC without Aptos, a PC with an older Calibri | layout differences listed | | |
| W14 | Acrobat Reader (current) and Edge's PDF viewer | open in < 1 s; scroll smoothly; text selectable; same look as screen | | see §4 |

## 4. Acrobat with the spike PDFs

Open `docs/next/field/acrobat-excel.pdf` and `docs/next/field/acrobat-glass.pdf` (20 pages each, written by
the spike PDF writer, `spikes/pdfwriter/bench.ts`) in the current Acrobat Reader and in Edge's viewer.

| | Acrobat: opens in (s) | scrolls smoothly? | text selectable? | gradients / soft masks look right? | Edge viewer: same? |
|---|---|---|---|---|---|
| acrobat-excel.pdf | | | | | |
| acrobat-glass.pdf | | | | | |

If soft masks (the glass cards' transparency) look wrong or slow → S3.5 uses the flattened-gradient recipe.

## 5. Font licence question (risk R7)

Question for the bank's software-licence owner: *may Windows system fonts (e.g. Segoe UI, Calibri, Aptos) be
copied into the shared folder `backend\data\fonts\system\`, so that every PC lays out and exports slides with
the same font files?*

| Answer | Who answered | Date |
|---|---|---|
| | | |

If "no" → S3.2 uses the per-PC fallback (each PC uses its own font file; the deck stores a metrics
fingerprint and warns on a mismatch).
