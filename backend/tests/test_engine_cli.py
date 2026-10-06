"""Optional: render a real slide with the command-line engine if a Chromium is available."""
import os
import struct
import unittest

from sbtest import TempDirs, chromium

from slidebuilder.engines import CommandLineEngine, Exporter
from slidebuilder.pdf import jpegs_to_pdf, png_first_column

EXE = chromium()
SLIDE = '<div style="width:1600px;height:900px;background:#00ff00"></div>'


@unittest.skipUnless(EXE, "no Chromium found in /opt/pw-browsers")
class CommandLineEngineTests(TempDirs):
    def test_png_and_pdf(self):
        e = CommandLineEngine(EXE)
        png = e.render("", [SLIDE], "png", 1)[0]
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        w, h = struct.unpack(">II", png[16:24])
        self.assertEqual((w, h), (1600, 900))                    # browser chrome cropped by the calibration
        col = png_first_column(png)
        self.assertTrue(all(g > 200 and r < 80 for (r, g, b) in col))
        self.assertIn(png[25], (0, 2))                          # RGB: packed into the PDF without re-encoding
        self.assertTrue(jpegs_to_pdf([png], "test").startswith(b"%PDF"))
        vec = e.render("", [SLIDE, SLIDE], "vector", 1)
        self.assertTrue(vec.startswith(b"%PDF"))

    def test_exporter_picks_the_cli_engine(self):
        env = {"SLIDEBUILDER_BROWSER": EXE, "SLIDEBUILDER_ENGINES": "cli"}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            ex = Exporter()
            ex.warm()
            st = ex.status()
            self.assertEqual(st["state"], "ready", st)
            out, label = ex.render("", [SLIDE], "png", 1)
            self.assertEqual(out[0][:4], b"\x89PNG")
            ex.stop()
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
