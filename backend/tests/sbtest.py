"""Shared helpers for the backend tests (imported by every test module)."""
import io
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

os.environ.setdefault("SLIDEBUILDER_ENGINES", "none")

from slidebuilder import paths  # noqa: E402


class TempDirs(unittest.TestCase):
    """Every test gets its own ROOT (workbooks, export) and DATA folder."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sbtest_")
        self.root = os.path.join(self.tmp, "root")
        self.data = os.path.join(self.tmp, "data")
        os.makedirs(self.root)
        self._env = {k: os.environ.get(k) for k in ("SLIDEBUILDER_ROOT", "SLIDEBUILDER_DATA", "SLIDEBUILDER_USER", "SLIDEBUILDER_HOST")}
        os.environ["SLIDEBUILDER_ROOT"] = self.root
        os.environ["SLIDEBUILDER_DATA"] = self.data
        os.environ["SLIDEBUILDER_USER"] = "tester"
        os.environ["SLIDEBUILDER_HOST"] = "pc1"
        paths.configure()

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        paths.configure()
        shutil.rmtree(self.tmp, ignore_errors=True)


def make_png(w=16, h=9, rgb=(89, 168, 255)):
    """A valid 8-bit RGB PNG (what jpegs_to_pdf accepts as a lossless page)."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def make_xlsx_bytes():
    """A small zip that looks like a workbook (enough for the stable-read checks)."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<workbook/>" * 50)
    return bio.getvalue()


def chromium():
    """A Chromium / headless shell from Playwright's browser folder, if this machine has one."""
    import glob
    for pat in ("/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell",
                "/opt/pw-browsers/chromium-*/chrome-linux/chrome"):
        for p in sorted(glob.glob(pat), reverse=True):
            if os.access(p, os.X_OK):
                return p
    return None
