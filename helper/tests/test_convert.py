"""The Windows conversions (convert.py) never put a file name or a path into PowerShell's command text (audit SEC-2,
docs/next/AUDIT.md): the workbook's name came from the request, and PowerShell also ends a '…' string at the
Unicode quotes ‘ ’ ‚ ‛, which the old quoting did not double - so a name such as «Budget.x’);Start-Process notepad}…»
ran a command. The commands are captured here (subprocess.run is replaced), nothing is run."""
import os
import sys
import unittest
from unittest import mock

import sbtest  # noqa: F401  (puts the helper on sys.path)
from slidebuilder import convert

EVIL = "Budget.x’);Start-Process notepad}finally{};#"


class Captured:
    def __init__(self):
        self.calls = []

    def __call__(self, args, **kw):
        self.calls.append((args, kw))
        return mock.Mock(returncode=1, stdout=b"", stderr=b"")


class ConvertCommandTests(unittest.TestCase):
    def setUp(self):
        convert._wb_cache.clear()
        convert._conv_cache.clear()
        self.run = Captured()
        patches = [mock.patch.object(convert.subprocess, "run", self.run), mock.patch.object(convert.sys, "platform", "win32")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def command(self):
        self.assertEqual(len(self.run.calls), 1)
        args, kw = self.run.calls[0]
        return args[args.index("-Command") + 1], kw

    def test_a_workbook_name_never_reaches_the_command(self):
        with self.assertRaises(RuntimeError):            # nothing was converted (no Excel here)
            convert.convert_workbook(b"\xd0\xcf\x11\xe0 not really a workbook", EVIL)
        ps, kw = self.command()
        for part in ("Start-Process", "notepad", "’", "Budget", "slidebuilder_wb_"):
            self.assertNotIn(part, ps)
        src = (kw.get("env") or {}).get("SB_SRC", "")
        self.assertIn(os.path.splitext(src)[1], (".xls", ".xlsx", ".xlsm", ".xlsb"))   # only a workbook extension

    def test_a_picture_path_never_reaches_the_command(self):
        with mock.patch.object(convert, "_gdiplus_to_png", side_effect=OSError("no GDI+ here")):
            with self.assertRaises(RuntimeError):
                convert.convert_picture(b"not a picture", "emf")
        ps, kw = self.command()
        self.assertNotIn("slidebuilder_img_", ps)
        self.assertTrue((kw.get("env") or {}).get("SB_SRC", "").endswith("in.emf"))


if __name__ == "__main__":
    unittest.main()
