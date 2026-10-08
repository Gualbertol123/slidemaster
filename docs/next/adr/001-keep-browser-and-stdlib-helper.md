# ADR-001: Keep the browser UI and the Python standard-library helper; ship no new executable

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
Users' PCs block programs on the share. AppLocker/WDAC may block unsigned executables anywhere outside
Program Files, antivirus scans every new exe, and users have no admin rights. v3 already fights this for one
executable, the Chrome for Testing export engine: it mirrors it to `%LOCALAPPDATA%` (`engines.py:67-89`) and
decodes policy error codes (`engines.py:91-107`). `python.exe` and `msedge.exe` already run on every v3 PC.
The helper's speed is not a bottleneck (01 §3): SMB round trips and Chrome printing are.

## Decision
* The UI stays a page in Edge, opened as an app window (`msedge --app=…`), falling back to the default
  browser.
* The helper stays Python ≥ 3.8 standard library only, slimmed to storage, conversion, fonts, export-file
  saving and update.
* No Rust, Go or .NET binary; no frozen Python exe; no Tauri, Electron or WebView2 host.

## Consequences
+ Nothing new for AppLocker/WDAC/antivirus to judge; no code signing needed; the same install story.
+ All heavy work moves to the page (workers, WASM), where policies do not reach.
− Python must stay ≥ 3.8 compatible (no `match`, no 3.9+ typing).
− Edge app mode is cosmetic; if blocked, a normal tab is used.

## Evidence and alternatives
A2–A7 in 02 §A (scores 33–40 vs 50); A8/A9 violate hard constraints.
