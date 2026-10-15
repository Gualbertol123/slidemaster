"""Folder layout (ARCHITECTURE §1, §3).

    Slide Builder\                  ROOT: Start Slide Builder.bat + the Excel workbooks
      export\                       every PDF / PNG is written here
      helper\                       HELPER: slide_builder.py, slide_builder.html, this package (the program)
      backend\                      HOME_BACKEND: the user's files of v3's program folder (logo, v2 settings)
        data\                       DATA: all persistent state, shared with Slide Builder 3

Until 3.8 the program itself lived in backend\ (PLAN S5.1 moved it to helper\); the data, the logo and the v2
settings stay in backend\, where every installed share keeps them and where Slide Builder 3 reads them too.

A side-by-side install (tools/update.py --release) runs the program from Slide Builder\app\<ver>\helper\
(that folder holds a MANIFEST.json one level up). Then ROOT and HOME_BACKEND are still those of the main
folder, never of app\<ver>: HOME_BACKEND is Slide Builder\backend\ in every layout, HELPER is where the code is.

Other modules read these values as attributes (``paths.DATA``) at call time, so tests can point
them somewhere else with :func:`configure` or the environment variables

    SLIDEBUILDER_ROOT   root folder (workbooks, export\)
    SLIDEBUILDER_DATA   data folder
    SLIDEBUILDER_EXPORT export folder (default: ROOT/export)
    SLIDEBUILDER_APP_FILE   the app page to serve instead of helper/slide_builder.html (testing aid,
                        used by tools/loadtest4.py)
"""
import os
import re

PACKAGE = os.path.dirname(os.path.abspath(__file__))
HELPER = os.path.dirname(PACKAGE)
ENTRY = os.path.join(HELPER, "slide_builder.py")
CODE_DIRS = ("helper", "backend")          # the program's folder: 4.x, and 3.x (an install of 3.x side by side)


def _install_home():
    """the main folder when this program runs from <main>\app\<ver>\helper (a release install), else None"""
    ver = os.path.dirname(HELPER)
    app = os.path.dirname(ver)
    if (os.path.basename(HELPER).lower() in CODE_DIRS and os.path.basename(app).lower() == "app"
            and re.match(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$", os.path.basename(ver))
            and os.path.isfile(os.path.join(ver, "MANIFEST.json"))):
        return os.path.dirname(app)
    return None


def _home_backend():
    """<main>\backend: the main folder's of a release install, else the one next to the program's folder"""
    if INSTALL_HOME:
        return os.path.join(INSTALL_HOME, "backend")
    if os.path.basename(HELPER).lower() in CODE_DIRS:
        return os.path.join(os.path.dirname(HELPER), "backend")
    return HELPER


INSTALL_HOME = _install_home()
HOME_BACKEND = _home_backend()
APP_FILE = os.environ.get("SLIDEBUILDER_APP_FILE") or os.path.join(HELPER, "slide_builder.html")
SETTINGS_NAME = "slide_builder_settings.txt"
SETTINGS_BACKUP_NAME = "slide_builder_settings.v2-backup.txt"
WORKBOOK_EXT = (".xlsx", ".xlsm", ".xlsb", ".xls")

ROOT = DATA = EXPORT_DIR = SETTINGS_FILE = SETTINGS_BACKUP = None


def _default_root():
    return os.path.dirname(HOME_BACKEND) if os.path.basename(HOME_BACKEND).lower() == "backend" else HOME_BACKEND


def configure(root=None, data=None):
    """(Re)compute the folder layout. Arguments win over environment variables, which win over defaults."""
    global ROOT, DATA, EXPORT_DIR, SETTINGS_FILE, SETTINGS_BACKUP
    ROOT = os.path.abspath(root or os.environ.get("SLIDEBUILDER_ROOT") or _default_root())
    DATA = os.path.abspath(data or os.environ.get("SLIDEBUILDER_DATA") or os.path.join(HOME_BACKEND, "data"))
    EXPORT_DIR = os.path.abspath(os.environ.get("SLIDEBUILDER_EXPORT") or os.path.join(ROOT, "export"))
    # the v2 settings file always lived next to the v3 program (or, in the old flat layout, in ROOT)
    SETTINGS_FILE = os.path.join(HOME_BACKEND, SETTINGS_NAME)
    SETTINGS_BACKUP = os.path.join(HOME_BACKEND, SETTINGS_BACKUP_NAME)


def data_dir(*parts):
    return os.path.join(DATA, *parts)


configure()
