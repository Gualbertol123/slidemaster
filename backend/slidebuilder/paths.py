"""Folder layout (ARCHITECTURE §1, §3).

    Slide Builder\\                  ROOT: Start Slide Builder.bat + the Excel workbooks
      export\\                       every PDF / PNG is written here
      engine\\                       Chrome for Testing (installed once, see --setup)
      backend\\                      BACKEND: slide_builder.py, slide_builder.html, logo, this package
        data\\                       DATA: all persistent state

A side-by-side install (tools/update.py --release) runs the program from Slide Builder\\app\\<ver>\\backend\\
(that folder holds a MANIFEST.json one level up). Then ROOT, the data folder and the user's files of the
backend folder (logo, v2 settings, old workbooks) are still those of the main folder, never of app\\<ver>:
HOME_BACKEND is Slide Builder\\backend\\ in both layouts, BACKEND is where the code is.

Other modules read these values as attributes (``paths.DATA``) at call time, so tests can point
them somewhere else with :func:`configure` or the environment variables

    SLIDEBUILDER_ROOT   root folder (workbooks, export\\, engine\\)
    SLIDEBUILDER_DATA   data folder
    SLIDEBUILDER_APP_FILE   the app page to serve instead of backend/slide_builder.html (testing aid,
                        used by tools/loadtest.py when the app has not been built)
"""
import os
import re
import tempfile

PACKAGE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(PACKAGE)
ENTRY = os.path.join(BACKEND, "slide_builder.py")


def _install_home():
    """the main folder when this program runs from <main>\\app\\<ver>\\backend (a release install), else None"""
    ver = os.path.dirname(BACKEND)
    app = os.path.dirname(ver)
    if (os.path.basename(BACKEND).lower() == "backend" and os.path.basename(app).lower() == "app"
            and re.match(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$", os.path.basename(ver))
            and os.path.isfile(os.path.join(ver, "MANIFEST.json"))):
        return os.path.dirname(app)
    return None


INSTALL_HOME = _install_home()
HOME_BACKEND = os.path.join(INSTALL_HOME, "backend") if INSTALL_HOME else BACKEND
APP_FILE = os.environ.get("SLIDEBUILDER_APP_FILE") or os.path.join(BACKEND, "slide_builder.html")
SETTINGS_NAME = "slide_builder_settings.txt"
SETTINGS_BACKUP_NAME = "slide_builder_settings.v2-backup.txt"
WORKBOOK_EXT = (".xlsx", ".xlsm", ".xlsb", ".xls")
SLIDE_W, SLIDE_H = 1600, 900            # CSS px of one slide
PAGE_W_IN, PAGE_H_IN = SLIDE_W / 96, SLIDE_H / 96   # one PDF page = one slide at 1 CSS px = 1/96 in (16:9, 1200 x 675 pt)

# Programs cannot run reliably from network drives (T:\, \\server\share), so there the engine lives on this PC:
LOCAL_ENGINE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "SlideBuilder", "engine")
# Lock folder on this PC (protects LOCAL_ENGINE_DIR against the installer and the mirror running at once)
LOCAL_LOCK_DIR = os.path.join(os.path.dirname(LOCAL_ENGINE_DIR), "locks")

ROOT = DATA = EXPORT_DIR = ENGINE_DIR = SETTINGS_FILE = SETTINGS_BACKUP = None


def _default_root():
    return os.path.dirname(HOME_BACKEND) if os.path.basename(HOME_BACKEND).lower() == "backend" else HOME_BACKEND


def configure(root=None, data=None):
    """(Re)compute the folder layout. Arguments win over environment variables, which win over defaults."""
    global ROOT, DATA, EXPORT_DIR, ENGINE_DIR, SETTINGS_FILE, SETTINGS_BACKUP
    ROOT = os.path.abspath(root or os.environ.get("SLIDEBUILDER_ROOT") or _default_root())
    DATA = os.path.abspath(data or os.environ.get("SLIDEBUILDER_DATA") or os.path.join(HOME_BACKEND, "data"))
    EXPORT_DIR = os.path.join(ROOT, "export")
    ENGINE_DIR = os.path.join(ROOT, "engine")
    # the v2 settings file always lived next to the script (or, in the old flat layout, in ROOT)
    SETTINGS_FILE = os.path.join(HOME_BACKEND, SETTINGS_NAME)
    SETTINGS_BACKUP = os.path.join(HOME_BACKEND, SETTINGS_BACKUP_NAME)


def data_dir(*parts):
    return os.path.join(DATA, *parts)


configure()
