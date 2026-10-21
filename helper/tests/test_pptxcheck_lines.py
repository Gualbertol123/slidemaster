"""tools/pptxcheck.py (7), the lines (4.8, M15 S15.3; 09 §4.3, LN-03): every shape or group named "Line n" is plain
shapes – never a connector (p:cxnSp) or a picture – with a drawn stroke (a:prstGeom "line" or an open a:custGeom) whose
ends are DrawingML's own, and with --expect each slide holds exactly the lines the core's export draws. Synthetic files,
standard library only (no python-pptx needed)."""
import importlib.util
import os
import shutil
import tempfile
import unittest
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_pptxcheck_lines", os.path.join(REPO, "tools", "pptxcheck.py"))
pptxcheck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pptxcheck)

NSDECL = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
XFRM = '<a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="100" cy="0"/></a:xfrm>'
PRST = '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
OPEN = ('<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100" fill="none">'
        '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo></a:path></a:pathLst></a:custGeom>')
LN = '<a:ln w="15240" cap="flat"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:miter lim="1000000"/><a:headEnd type="diamond" w="sm" len="sm"/><a:tailEnd type="triangle" w="med" len="med"/></a:ln>'


def sp(name, geom=PRST, ln=LN, sid=2, fill="<a:noFill/>", tx=""):
    return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr%s/><p:nvPr/></p:nvSpPr><p:spPr>%s%s%s%s</p:spPr></p:sp>'
            % (sid, name, tx, XFRM, geom, fill, ln))


def grp(name, kids, sid=9):
    return ('<p:grpSp><p:nvGrpSpPr><p:cNvPr id="%d" name="%s"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>%s</p:grpSp>'
            % (sid, name, "".join(kids)))


class LineChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-pptxcheck-lines-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def deck(self, *slides):
        f = os.path.join(self.tmp, "d%d.pptx" % len(os.listdir(self.tmp)))
        with zipfile.ZipFile(f, "w") as z:
            ids = "".join('<p:sldId id="%d" r:id="rId%d"/>' % (256 + i, i + 1) for i in range(len(slides)))
            z.writestr("ppt/presentation.xml", '<p:presentation %s><p:sldIdLst>%s</p:sldIdLst></p:presentation>' % (NSDECL, ids))
            rels = "".join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>'
                           % (i + 1, i + 1) for i in range(len(slides)))
            z.writestr("ppt/_rels/presentation.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % rels)
            for i, body in enumerate(slides):
                z.writestr("ppt/slides/slide%d.xml" % (i + 1), '<p:sld %s><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>%s</p:spTree></p:cSld></p:sld>'
                           % (NSDECL, body))
        return f

    def test_straight_elbow_and_labelled_lines_pass_and_are_counted(self):
        label = grp("Line 9", [sp("Line 10", geom=OPEN, sid=10),
                               sp("Shape 11", geom='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', fill='<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>', ln="", sid=11),
                               sp("Text 12", geom='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', ln="", sid=12, tx=' txBox="1"')])
        f = self.deck(sp("Line 2") + sp("Line 3", geom=OPEN, sid=3) + label, sp("Shape 5", geom='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', sid=5))
        self.assertEqual([len(x) for x in pptxcheck.lines(f)], [3, 0])
        rep = {}
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "tables": 0, "charts": 0, "lines": 3}], rep), [])
        self.assertEqual(rep["lines"], [3, 0])
        self.assertEqual(pptxcheck.check_lines(f), [])

    def test_counts_are_exact(self):
        f = self.deck(sp("Line 2"))
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "lines": 2}]), ["slide 1: 1 line(s), the export draws 2"])
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "tables": 1}]), ["slide 1: 1 line(s), the export draws 0"])

    def test_a_connector_a_picture_no_stroke_or_a_foreign_end_fails(self):
        cases = {
            "a connector": '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="Straight Connector 2"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>%s%s%s</p:spPr></p:cxnSp>' % (XFRM, PRST, LN),
            "a picture": '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Line 2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>',
            "no line": sp("Line 2", ln="<a:ln><a:noFill/></a:ln>"),
            "a filled shape": sp("Line 2", geom='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'),
            "an unknown end": sp("Line 2", ln='<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:tailEnd type="bar"/></a:ln>'),
        }
        for what, body in cases.items():
            bad = pptxcheck.check_lines(self.deck(body), [{"slide": 1, "lines": 1}])
            self.assertTrue(bad, what)
            self.assertTrue(all(b.startswith("slide 1, line 1: ") for b in bad), (what, bad))

    def test_native_ends_and_dashes_are_counted_where_expected(self):
        """(S15.5) the expectation's `heads` (native a:headEnd / a:tailEnd, "none" not counted) and `dashed` (a line with
        a dashed stroke) per slide, exactly; an entry without them is not asked"""
        plain = '<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:headEnd type="none"/><a:tailEnd type="arrow"/></a:ln>'
        dashed = ('<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:custDash><a:ds d="400000" sp="300000"/></a:custDash>'
                  '<a:miter lim="1000000"/></a:ln>')
        preset = '<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:prstDash val="sysDot"/></a:ln>'
        solid = '<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
        # a dashed limiter: its route dashed, its ticks a solid shape of their own – one dashed line
        ticks = grp("Line 6", [sp("Line 7", geom=OPEN, ln=dashed, sid=7), sp("Line 8", geom=OPEN, ln=solid, sid=8)])
        f = self.deck(sp("Line 2") + sp("Line 3", ln=plain, sid=3) + sp("Line 4", ln=preset, sid=4) + ticks)
        rep = {}
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "lines": 4, "heads": 3, "dashed": 2}], rep), [])
        self.assertEqual((rep["line_heads"], rep["lines_dashed"]), ([3], [2]))
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "lines": 4}]), [])
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "lines": 4, "heads": 4, "dashed": 1}]),
                         ["slide 1: 3 native line end(s), the export draws 4", "slide 1: 2 dashed line(s), the export draws 1"])
        # a line written without its native ends (a picture of a head, or heads dropped) fails against the core's count
        bare = self.deck(sp("Line 2", ln=solid))
        self.assertEqual(pptxcheck.check_lines(bare, [{"slide": 1, "lines": 1, "heads": 2, "dashed": 0}]), ["slide 1: 0 native line end(s), the export draws 2"])

    def test_a_native_end_on_a_segment_of_no_length_fails(self):
        """(S15.5 review 1) an elbow bent at an end written with a repeated point: PowerPoint would aim its end along a
        segment of no length; the same route without the repeat passes"""
        def path(*pts):
            cmds = "".join(('<a:moveTo>' if i == 0 else '<a:lnTo>') + '<a:pt x="%d" y="%d"/>' % p + ('</a:moveTo>' if i == 0 else '</a:lnTo>') for i, p in enumerate(pts))
            return ('<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100" fill="none">%s</a:path></a:pathLst></a:custGeom>' % cmds)
        bent_a = path((0, 0), (0, 0), (0, 100), (100, 100))          # mid 0: the first segment of no length
        bent_b = path((0, 0), (100, 0), (100, 100), (100, 100))      # mid 1: the last
        good = path((0, 0), (0, 100), (100, 100))
        self.assertEqual(pptxcheck.check_lines(self.deck(sp("Line 2", geom=bent_a))), ["slide 1, line 1: its a:headEnd sits on a segment of no length"])
        self.assertEqual(pptxcheck.check_lines(self.deck(sp("Line 2", geom=bent_b))), ["slide 1, line 1: its a:tailEnd sits on a segment of no length"])
        self.assertEqual(pptxcheck.check_lines(self.deck(sp("Line 2", geom=good))), [])
        # without native ends a repeated point is harmless (the ticks' shape, a plain elbow)
        bare = '<a:ln w="15240"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:ln>'
        self.assertEqual(pptxcheck.check_lines(self.deck(sp("Line 2", geom=bent_a, ln=bare))), [])

    def test_the_quarter_px_grid_where_an_entry_asks(self):
        """(S15.5 review 4) `quarter`: every shape or group named with one of its prefixes has a:off / a:ext in
        multiples of 1,905 EMU (1/4 px); an entry without it is not asked"""
        def box(name, x, y, w, h, sid):
            return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
                    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>' % (sid, name, x, y, w, h))
        f = self.deck(box("Callout 2", 767715, 1531620, 2284095, 908685, 2) + box("Table 3", 1508760, 1088136, 100, 100, 3))
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "quarter": ["Callout"]}]), [])
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1}]), [])
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "quarter": ["Callout", "Table"]}]),
                         ["slide 1, Table 3: a:off / a:ext [1508760, 1088136, 100, 100] not on the 1/4 px grid (1,905 EMU)"])
        self.assertEqual(pptxcheck.check_lines(f, [{"slide": 1, "quarter": ["Icon"]}]), ["slide 1: no shape named Icon (quarter)"])


if __name__ == "__main__":
    unittest.main()
