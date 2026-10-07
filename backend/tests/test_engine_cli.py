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

    def test_vector_pages_are_the_slides_edge_to_edge(self):
        import shutil, subprocess, tempfile
        from slidebuilder.engines import check_output
        from slidebuilder.pdf import pdf_page_boxes
        e = CommandLineEngine(EXE)
        # like the real slides: clipped, a filtered full-size wallpaper layer (Liquid Glass), a mark in the corner
        slide = ('<div class="slide" style="width:1600px;height:900px;background:#fff"><div class="wall"></div>'
                 '<div style="right:0;bottom:0;width:8px;height:8px;background:#0000ff"></div></div>')
        css = ".slide{position:relative;overflow:hidden}.slide>div{position:absolute}.wall{inset:0;background:#00ff00;filter:saturate(1.1)}"
        pdf = check_output(e.render(css, [slide] * 3, "vector", 1), "vector", 3, 1)
        for w, h in pdf_page_boxes(pdf):
            self.assertAlmostEqual(w / h, 16 / 9, places=4)
        if not shutil.which("pdftoppm"):
            self.skipTest("pdftoppm not installed: page content not checked")
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "a.pdf"), "wb") as f:
                f.write(pdf)
            subprocess.run(["pdftoppm", "-r", "48", os.path.join(d, "a.pdf"), os.path.join(d, "p")], check=True, stderr=subprocess.DEVNULL)
            pages = sorted(n for n in os.listdir(d) if n.endswith(".ppm"))
            self.assertEqual(len(pages), 3)
            for n in pages:
                with open(os.path.join(d, n), "rb") as f:
                    raw = f.read()
                _, size, _, px = raw.split(b"\n", 3)
                w, h = map(int, size.split())
                at = lambda x, y: tuple(px[(y * w + x) * 3:(y * w + x) * 3 + 3])
                for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w // 2, h - 1), (w - 1, h // 2)):
                    r, g, b = at(x, y)
                    self.assertTrue(r < 90 and (g > 200 or b > 200), "white at %d,%d of %s: %s" % (x, y, n, (r, g, b)))
                r, g, b = at(w - 1, h - 1)
                self.assertTrue(b > 150 and r < 90, "the slide's bottom-right corner is not on page %s" % n)
        finally:
            shutil.rmtree(d, ignore_errors=True)

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
