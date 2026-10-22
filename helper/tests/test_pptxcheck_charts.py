"""tools/pptxcheck.py and the native column / bar charts of 4.7 (S14.2, 09 §4.2; line and area charts S14.3; scatter charts
S14.4): the chart part's child order it checks
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

    def deck(self, kind, edit=None, series=None):
        """a one-slide deck with python-pptx's own chart of `kind` (two series, one with a gap – or `series`), its chart
        part changed by `edit` (bytes -> bytes)"""
        from pptx import Presentation
        from pptx.chart.data import CategoryChartData
        from pptx.enum.chart import XL_CHART_TYPE
        from pptx.util import Emu
        prs = Presentation()
        prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
        s = prs.slides.add_slide(prs.slide_layouts[6])
        data = CategoryChartData()
        data.categories = ["R1", "R2", "R3"]
        for name, vals in series or [("Q1", (-101.25, 11.25, None)), ("Q2", (-90, 22.5, 60))]:
            data.add_series(name, vals)
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


@unittest.skipUnless(HAVE_PPTX, "python-pptx is not installed (pip install python-pptx==1.0.2)")
class LineAreaChartTests(BarChartTests):
    """4.7 (S14.3, 09 §4.2): c:lineChart / c:areaChart parts, a line series' marker and smooth, a series cached over
    every category of a combo (blanks where its group has none) checked against its cells"""

    def test_every_line_and_area_python_pptx_writes_passes(self):
        for kind in ("LINE", "LINE_MARKERS", "LINE_MARKERS_STACKED", "AREA", "AREA_STACKED", "AREA_STACKED_100"):
            self.assertEqual(self.order_problems(self.deck(kind)), [], kind)

    def test_a_series_child_out_of_order_fails(self):
        def swap(x):
            # c:smooth is a line series' last child but one; put it before its categories
            x = x.replace(b'<c:smooth val="0"/>', b"", 1)
            return x.replace(b"<c:cat>", b'<c:smooth val="0"/><c:cat>', 1)
        self.assertTrue(any("after a later child in <c:ser>" in p for p in self.order_problems(self.deck("LINE_MARKERS", swap))))

    def test_sources_match_a_series_at_its_categories(self):
        import openpyxl
        f = self.deck("LINE_MARKERS", series=[("Weekly", (11576, 11258, None)), ("Actual", (None, None, 11324))])
        book = os.path.join(self.tmp, "src.xlsx")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Weekly"
        ws["A1"], ws["B1"], ws["C1"] = 11576, 11258, 11324
        ws["A2"], ws["C2"] = 11576, 11258                     # B2 blank: a gap at the second category
        wb.save(book)
        chk = lambda *specs: pptxcheck.check([f], ppt=False, sources={f: {"workbook": book, "charts": [dict(slide=1, sheet="Weekly", **x) for x in specs]}})
        # a group's series: its cells from its group's first category on, gaps elsewhere; a series by its name
        self.assertTrue(chk({"range": "A1:B1"}, {"range": "C1", "start": 2}, {"range": "C1", "start": 2, "name": "Actual"}))
        # (S14.3 review 4) the same values one category off (the group's start missed), in another series, or with the
        # blanks left out are not a match
        self.assertFalse(chk({"range": "C1"}))
        self.assertFalse(chk({"range": "C1", "start": 1}))
        self.assertFalse(chk({"range": "A1:B1", "start": 1}))
        self.assertFalse(chk({"range": "C1", "start": 2, "name": "Weekly"}))
        self.assertFalse(chk({"range": "A1:C1"}))
        # a blank cell is a gap at its own place: "11576, —, 11258" is not Weekly's "11576, 11258, —"
        self.assertFalse(chk({"range": "A2:C2"}))

    def test_a_groups_start_skips_hidden_category_cells(self):
        # (S14.3 re-check) the groups before a series' own: their category ranges' visible cells, as the chart counts
        # them – a hidden row in the first group's range is no category
        import openpyxl
        f = self.deck("LINE_MARKERS", series=[("First", (5, 6, None)), ("Second", (None, None, 11324))])
        book = os.path.join(self.tmp, "src.xlsx")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Weekly"
        ws["A1"], ws["A2"], ws["A3"], ws["C1"] = "R1", "hidden", "R2", 11324
        ws.row_dimensions[2].hidden = True
        wb.save(book)
        chk = lambda **x: pptxcheck.check([f], ppt=False, sources={f: {"workbook": book, "charts": [dict(slide=1, sheet="Weekly", range="C1", **x)]}})
        self.assertTrue(chk(before=[{"sheet": "Weekly", "range": "A1:A3"}], name="Second"))
        # (the range's three cells, hidden one included – export-check's old count – put it one category off)
        self.assertFalse(chk(start=3, name="Second"))
        self.assertTrue(chk(start=1, before=[{"sheet": "Weekly", "range": "A3"}], name="Second"))

    def test_series_order_is_checked_per_chart_group(self):
        # (S14.2 review 4) each chart group's own c:ser type: a bar's explosion, a pie's invertIfNegative, an area's
        # marker are refused; a line's marker and smooth pass
        bar = self.deck("COLUMN_CLUSTERED", lambda x: x.replace(b"</c:tx>", b'</c:tx><c:explosion val="5"/>', 1))
        self.assertIn("<c:explosion> in <c:ser> of <c:barChart>", " ".join(self.order_problems(bar)))
        pie = self.deck("PIE", lambda x: x.replace(b"</c:tx>", b'</c:tx><c:invertIfNegative val="0"/>', 1), series=[("S", (1, 2, 3))])
        self.assertIn("<c:invertIfNegative> in <c:ser> of <c:pieChart>", " ".join(self.order_problems(pie)))
        self.assertEqual(self.order_problems(self.deck("PIE", series=[("S", (1, 2, 3))])), [])
        area = self.deck("AREA", lambda x: x.replace(b"</c:tx>", b'</c:tx><c:marker><c:symbol val="none"/></c:marker>', 1))
        self.assertIn("<c:marker> in <c:ser> of <c:areaChart>", " ".join(self.order_problems(area)))
        # the helper alone: lint() no longer checks c:ser (no parent-blind list)
        import xml.etree.ElementTree as ET
        with zipfile.ZipFile(bar) as z:
            root = ET.fromstring(z.read("ppt/charts/chart1.xml"))
        self.assertEqual([p for p in pptxcheck.lint("c", root) if "<c:ser>" in p], [])
        self.assertTrue(pptxcheck.chart_order("c", root))

    def test_content_names_each_plot(self):
        ch = pptxcheck.content(self.deck("AREA_STACKED"))["slides"][0]["charts"][0]
        self.assertEqual(ch["plots"], ["AreaPlot"])
        self.assertEqual(ch["levels"], 1)


@unittest.skipUnless(HAVE_PPTX, "python-pptx is not installed (pip install python-pptx==1.0.2)")
class ScatterChartTests(unittest.TestCase):
    """4.7 (S14.4, 09 §4.2): c:scatterChart parts (CT_ScatterSer's order), each series' cached x values (c:xVal, which
    python-pptx does not read) listed by content(), and --sources `axis: "x"` checked against them"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-pptxcheck-xy-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def deck(self, kind="XY_SCATTER", edit=None):
        from pptx import Presentation
        from pptx.chart.data import XyChartData
        from pptx.enum.chart import XL_CHART_TYPE
        from pptx.util import Emu
        prs = Presentation()
        prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)
        s = prs.slides.add_slide(prs.slide_layouts[6])
        data = XyChartData()
        a = data.add_series("Retail")
        for x, y in ((730, 2.1), (755, 2.3), (805, 2.2)):
            a.add_data_point(x, y)
        s.shapes.add_chart(getattr(XL_CHART_TYPE, kind), 0, 0, Emu(6000000), Emu(4000000), data)
        src = os.path.join(self.tmp, "src.pptx")
        prs.save(src)
        out = os.path.join(self.tmp, "xy-%d.pptx" % len(os.listdir(self.tmp)))
        with zipfile.ZipFile(src) as z, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as b:
            for i in z.infolist():
                x = z.read(i.filename)
                if edit and i.filename.startswith("ppt/charts/chart") and i.filename.endswith(".xml"):
                    x = edit(x)
                b.writestr(i, x)
        return out

    def test_every_scatter_python_pptx_writes_passes_and_order_is_checked(self):
        for kind in ("XY_SCATTER", "XY_SCATTER_LINES", "XY_SCATTER_SMOOTH_NO_MARKERS"):
            bad, _ = pptxcheck.structure(self.deck(kind))
            self.assertEqual([p for p in bad if "<c:" in p], [], kind)

        def swap(x):
            # c:smooth after c:yVal; put it before c:xVal
            x = x.replace(b'<c:smooth val="0"/>', b"", 1)
            return x.replace(b"<c:xVal>", b'<c:smooth val="0"/><c:xVal>', 1)
        bad, _ = pptxcheck.structure(self.deck("XY_SCATTER", swap))
        self.assertIn("after a later child in <c:ser> of <c:scatterChart>", " ".join(bad))

    def test_content_and_sources_read_the_x_values(self):
        import openpyxl
        f = self.deck()
        ch = pptxcheck.content(f)["slides"][0]["charts"][0]
        self.assertEqual(ch["series"][0]["xs"], [730.0, 755.0, 805.0])
        self.assertEqual(ch["series"][0]["values"], [2.1, 2.3, 2.2])
        book = os.path.join(self.tmp, "src.xlsx")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Scatter"
        for r, (x, y) in enumerate(((730, 2.1), (755, 2.3), (805, 2.2)), start=1):
            ws["A%d" % r], ws["B%d" % r] = x, y
        wb.save(book)
        chk = lambda **x: pptxcheck.check([f], ppt=False, sources={f: {"workbook": book, "charts": [dict(slide=1, sheet="Scatter", start=0, **x)]}})
        self.assertTrue(chk(range="A1:A3", axis="x", name="Retail"))
        self.assertTrue(chk(range="B1:B3", name="Retail"))
        # the y cells are not the x values, nor the x cells the y values
        self.assertFalse(chk(range="B1:B3", axis="x"))
        self.assertFalse(chk(range="A1:A3"))

    def test_a_y_cell_without_its_x_is_masked(self):
        """S14.4 review 5: a y cell whose x cell is blank has no point, so no cache: `mask` (the x cells) leaves it out"""
        import openpyxl
        f = self.deck()
        book = os.path.join(self.tmp, "src.xlsx")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Scatter"
        for r, (x, y) in enumerate(((730, 2.1), (755, 2.3), (805, 2.2), (None, 2.5)), start=1):
            ws["A%d" % r], ws["B%d" % r] = x, y
        wb.save(book)
        chk = lambda **x: pptxcheck.check([f], ppt=False, sources={f: {"workbook": book, "charts": [dict(slide=1, sheet="Scatter", start=0, **x)]}})
        self.assertFalse(chk(range="B1:B4", name="Retail"))
        self.assertTrue(chk(range="B1:B4", name="Retail", mask={"sheet": "Scatter", "range": "A1:A4"}))


class ChartKindsTests(unittest.TestCase):
    """4.7 (S14.6, PX-05): (5) with `kinds` (tools/real-charts.mjs) – each slide's native charts' chart groups as python-pptx
    reads them, compared sorted; and `plots` (PX-06) says plainly where PowerPoint is not present. Standard library only"""

    def test_kinds_name_each_plot_in_order(self):
        self.assertEqual(pptxcheck.chart_kinds({"plots": ["BarPlot", "LinePlot"]}), "bar+line")
        self.assertEqual(pptxcheck.chart_kinds({"plots": ["XyPlot"]}), "scatter")
        self.assertEqual(pptxcheck.chart_kinds({"plots": ["DoughnutPlot"]}), "doughnut")

    def test_real_objects_compare_kinds_per_slide(self):
        rep = {"slides": [{"tables": 0, "charts": [{"plots": ["LinePlot", "BarPlot"]}, {"plots": ["AreaPlot"]}]}]}
        self.assertEqual(pptxcheck.real_objects(rep, [{"slide": 1, "tables": 0, "charts": 2, "kinds": ["area", "line+bar"]}], "x"), [])
        # (no kinds: the counts only, as before S14.6)
        self.assertEqual(pptxcheck.real_objects(rep, [{"slide": 1, "tables": 0, "charts": 2}], "x"), [])
        bad = pptxcheck.real_objects(rep, [{"slide": 1, "tables": 0, "charts": 2, "kinds": ["area", "bar+line"]}], "x")
        self.assertEqual(len(bad), 1)
        self.assertIn("chart types", bad[0])

    @unittest.skipIf(os.name == "nt", "the message for a machine without PowerPoint")
    def test_plots_without_powerpoint_says_so(self):
        bad, got = pptxcheck.plots("x.pptx", [])
        self.assertEqual(got, [])
        self.assertIn("PowerPoint is not available", bad[0])


class PlotsMarksTests(unittest.TestCase):
    """S14.6 review 5 (PX-06): `plots` compares each arrow / line mark's two ends with the slide's (`arrows[].a/b`, slide
    px) within 2 px – PowerPoint's answer faked here (PS_PLOTS' JSON: points, msoTrue = -1 for a flip), so it runs
    without PowerPoint. Standard library only"""

    CHART = {"slide": 1, "left": 60.0, "top": 120.0, "width": 384.0, "height": 252.0, "inLeft": 30.0, "inTop": 24.0, "inWidth": 330.0, "inHeight": 204.0,
             "ymin": 0, "ymax": 600, "y2min": None, "y2max": None}
    EXPECT = {"slide": 1, "frame": {"x": 100, "y": 200, "w": 640, "h": 420}, "plot": {"x": 150, "y": 240, "w": 550, "h": 340}, "val": {"min": 0, "max": 600}}

    @staticmethod
    def line(a, b, name="Arrow 11"):
        """the line shape pptx/chart-overlay.ts writes from a to b (slide px), as PowerPoint reports it (points)"""
        return {"name": name, "left": min(a[0], b[0]) * .6, "top": min(a[1], b[1]) * .6, "width": abs(b[0] - a[0]) * .6, "height": abs(b[1] - a[1]) * .6,
                "flipH": -1 if b[0] < a[0] else 0, "flipV": -1 if b[1] < a[1] else 0}

    def run_(self, arrows, lines):
        return pptxcheck.compare_plots([dict(self.EXPECT, arrows=arrows)], [dict(self.CHART, lines=lines)])

    def test_line_ends_follow_the_flips(self):
        self.assertEqual(pptxcheck.line_ends(self.line((300, 250), (200, 400))), ((300, 250), (200, 400)))
        self.assertEqual(pptxcheck.line_ends(self.line((200, 400), (300, 250))), ((200, 400), (300, 250)))
        self.assertEqual(pptxcheck.line_ends(self.line((200, 250), (300, 400))), ((200, 250), (300, 400)))
        self.assertEqual(pptxcheck.line_ends(self.line((300, 400), (200, 250))), ((300, 400), (200, 250)))

    def test_marks_on_their_points_pass(self):
        A = [{"a": {"x": 300, "y": 250}, "b": {"x": 200, "y": 400}, "head": "triangle"}, {"a": {"x": 150, "y": 300}, "b": {"x": 700, "y": 300}}]
        L = [self.line((300.8, 251.5), (199.0, 401.2)), self.line((150, 300), (700, 300), "Line 12")]
        self.assertEqual(self.run_(A, L), [])
        # (PowerShell gives one shape as an object, not a list)
        self.assertEqual(self.run_(A[:1], L[0]), [])

    def test_a_mark_off_by_more_than_2_px_fails(self):
        bad = self.run_([{"a": {"x": 300, "y": 250}, "b": {"x": 200, "y": 400}}], [self.line((300, 250), (200, 403))])
        # (the mark, then the shape no mark claims)
        self.assertEqual(len(bad), 2)
        self.assertIn("mark 1", bad[0])
        self.assertIn("3.0 px off", bad[0])

    def test_a_reversed_line_fails(self):
        # (its head would be on the wrong end)
        bad = self.run_([{"a": {"x": 300, "y": 250}, "b": {"x": 200, "y": 400}}], [self.line((200, 400), (300, 250))])
        self.assertEqual(len(bad), 2)
        self.assertIn("mark 1", bad[0])

    def test_a_missing_or_extra_line_fails(self):
        A = [{"a": {"x": 300, "y": 250}, "b": {"x": 200, "y": 400}}]
        self.assertIn("no line shape", self.run_(A, [])[0])
        bad = self.run_(A, [self.line((300, 250), (200, 400)), self.line((150, 300), (700, 300), "Line 12")])
        self.assertEqual(bad, ["chart 1 (slide 1): Line 12: a line shape no mark of the slide has"])

    def test_charts_without_marks_still_compare_the_plot(self):
        self.assertEqual(pptxcheck.compare_plots([self.EXPECT], [self.CHART]), [])
        moved = dict(self.CHART, inLeft=33.0)
        self.assertIn("px off the slide's", pptxcheck.compare_plots([self.EXPECT], [moved])[0])


if __name__ == "__main__":
    unittest.main()
