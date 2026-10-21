"""tools/pptxcheck.py and the native column / bar charts of 4.7 (S14.2, 09 §4.2): the chart part's child order it checks
(c:barChart, c:catAx, c:valAx, c:scaling, a manual layout, a bar series) accepts what python-pptx itself writes for
every bar grouping and refuses an element out of the schema's order; content() lists every series with its cached
values. Skipped where python-pptx is not installed (the helper itself needs only the standard library)."""
import importlib.util
import os
import shutil
import tempfile
import unittest
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_pptxcheck_charts", os.path.join(REPO, "tools", "pptxcheck.py"))
pptxcheck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pptxcheck)
try:
    import pptx  # noqa: F401
    HAVE_PPTX = True
except ImportError:
    HAVE_PPTX = False


@unittest.skipUnless(HAVE_PPTX, "python-pptx is not installed (pip install python-pptx==1.0.2)")
class BarChartTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-pptxcheck-bars-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def deck(self, kind, edit=None):
        """a one-slide deck with python-pptx's own chart of `kind` (two series, one with a gap), its chart part changed by
        `edit` (bytes -> bytes)"""
        from pptx import Presentation
        from pptx.chart.data import CategoryChartData
        from pptx.enum.chart import XL_CHART_TYPE
        from pptx.util import Emu
        prs = Presentation()
        prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
        s = prs.slides.add_slide(prs.slide_layouts[6])
        data = CategoryChartData()
        data.categories = ["R1", "R2", "R3"]
        data.add_series("Q1", (-101.25, 11.25, None))
        data.add_series("Q2", (-90, 22.5, 60))
        s.shapes.add_chart(getattr(XL_CHART_TYPE, kind), 0, 0, Emu(6000000), Emu(4000000), data)
        src = os.path.join(self.tmp, "src.pptx")
        prs.save(src)
        out = os.path.join(self.tmp, "deck-%d.pptx" % len(os.listdir(self.tmp)))
        with zipfile.ZipFile(src) as a, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as b:
            for i in a.infolist():
                x = a.read(i.filename)
                if edit and i.filename.startswith("ppt/charts/chart") and i.filename.endswith(".xml"):
                    x = edit(x)
                b.writestr(i, x)
        return out

    def order_problems(self, path):
        bad, _ = pptxcheck.structure(path)
        return [p for p in bad if "<c:" in p]

    def test_every_bar_grouping_python_pptx_writes_passes(self):
        for kind in ("COLUMN_CLUSTERED", "COLUMN_STACKED", "COLUMN_STACKED_100", "BAR_CLUSTERED", "BAR_STACKED", "BAR_STACKED_100"):
            self.assertEqual(self.order_problems(self.deck(kind)), [], kind)

    def test_an_element_out_of_order_fails(self):
        def swap(x):
            # c:majorUnit is the value axis's last child here; put it first
            i = x.index(b"<c:valAx>") + len(b"<c:valAx>")
            return x[:i] + b'<c:majorUnit val="50"/>' + x[i:]
        self.assertTrue(any("after a later child in <c:valAx>" in p for p in self.order_problems(self.deck("COLUMN_CLUSTERED", swap))))

    def test_content_lists_every_series_and_its_gaps(self):
        c = pptxcheck.content(self.deck("COLUMN_CLUSTERED"))
        ch = c["slides"][0]["charts"][0]
        self.assertTrue(ch["type"].startswith("COLUMN_CLUSTERED"))
        self.assertEqual([s["name"] for s in ch["series"]], ["Q1", "Q2"])
        self.assertEqual(ch["series"][0]["values"], [-101.25, 11.25, None])
        self.assertEqual(ch["categories"], ["R1", "R2", "R3"])


if __name__ == "__main__":
    unittest.main()
