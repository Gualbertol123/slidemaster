#!/usr/bin/env python3
"""
Slide Builder - local helper (entry point)
==========================================

Run this file (double-click "Start Slide Builder.bat" on Windows, or `python slide_builder.py`).
It needs only the Python standard library (3.8+) and the Microsoft Edge or Google Chrome that is
already installed on the machine. The code lives in the `slidebuilder` package next to this file
(see README-backend.md); the contract with the app is docs/ARCHITECTURE.md.

Options
  python slide_builder.py --port 8765 --no-browser
  python slide_builder.py --setup              (install the export engine; "Install export engine.bat")
  set SLIDEBUILDER_BROWSER=C:\\path\\to\\msedge.exe   (to force a specific browser)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from slidebuilder.main import main  # noqa: E402

if __name__ == "__main__":
    main()
