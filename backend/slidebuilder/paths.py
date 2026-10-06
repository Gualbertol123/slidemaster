"""Folder layout (ARCHITECTURE §1, §3).

    Slide Builder\\                  ROOT: Start Slide Builder.bat + the Excel workbooks
      export\\                       every PDF / PNG is written here
      engine\\                       Chrome for Testing (installed once, see --setup)
      backend\\                      BACKEND: slide_builder.py, slide_builder.html, logo, this package
        data\\                       DATA: all persistent state

Other modules read these values as attributes (``paths.DATA``) at call time, so tests can point
them somewhere else with :func:`configure` or the environment variables

    SLIDEBUILDER_ROOT   root folder (workbooks, export\\, engine\\)
    SLIDEBUILDER_DATA   data folder
    SLIDEBUILDER_APP_FILE   the app page to serve instead of backend/slide_builder.html (testing aid,
                        used by tools/loadtest.py when the app has not been built)
"""
import os
import tempfile

PACKAGE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(PACKAGE)
ENTRY = os.path.join(BACKEND, "slide_builder.py")
APP_FILE = os.environ.get("SLIDEBUILDER_APP_FILE") or os.path.join(BACKEND, "slide_builder.html")
SETTINGS_NAME = "slide_builder_settings.txt"
SETTINGS_BACKUP_NAME = "slide_builder_settings.v2-backup.txt"
WORKBOOK_EXT = (".xlsx", ".xlsm", ".xlsb", ".xls")
SLIDE_W, SLIDE_H = 1600, 900            # CSS px of one slide
PAGE_W_IN, PAGE_H_IN = 13.333, 7.5      # PowerPoint 16:9

# Programs cannot run reliably from network drives (T:\, \\server\share), so there the engine lives on this PC:
LOCAL_ENGINE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "SlideBuilder", "engine")
# Lock folder on this PC (protects LOCAL_ENGINE_DIR against the installer and the mirror running at once)
LOCAL_LOCK_DIR = os.path.join(os.path.dirname(LOCAL_ENGINE_DIR), "locks")

ROOT = DATA = EXPORT_DIR = ENGINE_DIR = SETTINGS_FILE = SETTINGS_BACKUP = None


def _default_root():
    return os.path.dirname(BACKEND) if os.path.basename(BACKEND).lower() == "backend" else BACKEND


def configure(root=None, data=None):
    """(Re)compute the folder layout. Arguments win over environment variables, which win over defaults."""
    global ROOT, DATA, EXPORT_DIR, ENGINE_DIR, SETTINGS_FILE, SETTINGS_BACKUP
    ROOT = os.path.abspath(root or os.environ.get("SLIDEBUILDER_ROOT") or _default_root())
    DATA = os.path.abspath(data or os.environ.get("SLIDEBUILDER_DATA") or os.path.join(BACKEND, "data"))
    EXPORT_DIR = os.path.join(ROOT, "export")
    ENGINE_DIR = os.path.join(ROOT, "engine")
    # the v2 settings file always lived next to the script (or, in the old flat layout, in ROOT)
    SETTINGS_FILE = os.path.join(BACKEND, SETTINGS_NAME)
    SETTINGS_BACKUP = os.path.join(BACKEND, SETTINGS_BACKUP_NAME)


def data_dir(*parts):
    return os.path.join(DATA, *parts)


configure()
