"""tools/pptxcheck.py (6), the icons (4.8, M15 S15.2 review, 1; 09 §4.3): every shape or group named "Icon n" is native
custom geometry with round strokes, never a picture or a preset, and with --expect each slide holds exactly the icons
the core's export draws (tools/real-icons.mjs). Synthetic files, standard library only (no python-pptx needed)."""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_pptxcheck_icons", os.path.join(REPO, "tools", "pptxcheck.py"))
pptxcheck = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pptxcheck)

NSDECL = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
PATH = '<a:pathLst><a:path w="100" h="100" fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo></a:path></a:pathLst>'
CUST = '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>' + PATH + '</a:custGeom>'
XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>'
ROUND_LN = '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln>'


def sp(name, geom=CUST, fill="<a:noFill/>", ln=ROUND_LN, sid=2):
    return ('<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>%s%s%s%s</p:spPr></p:sp>'
            % (sid, name, XFRM, geom, fill, ln))


def grp(name, kids, sid=9):
    return ('<p:grpSp><p:nvGrpSpPr><p:cNvPr id="%d" name="%s"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>%s</p:grpSp>'
            % (sid, name, "".join(kids)))


class IconChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-pptxcheck-icons-")
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def deck(self, *slides):
        """a file of these slides' shape trees (only the parts check_icons reads)"""
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

    def test_outline_filled_and_half_ink_icons_pass_and_are_counted(self):
        filled = sp("Icon 3", fill='<a:solidFill><a:srgbClr val="1C4F8C"/></a:solidFill>', ln="<a:ln><a:noFill/></a:ln>", sid=3)
        half = grp("Icon 9", [sp("Icon 10", sid=10), sp("Icon 11", sid=11)])
        # an icon inside another group (an item's) is counted; a built-in icon is a shape of another name
        other = grp("Group 20", [sp("Icon 21", sid=21), sp("Shape 22", geom='<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', sid=22)], sid=20)
        f = self.deck(sp("Icon 2") + filled + half, other, sp("Shape 5", sid=5))
        self.assertEqual([len(x) for x in pptxcheck.icons(f)], [3, 1, 0])
        rep = {}
        self.assertEqual(pptxcheck.check_icons(f, [{"slide": 1, "tables": 0, "charts": 0, "icons": 3}, {"slide": 2, "icons": 1}], rep), [])
        self.assertEqual(rep["icons"], [3, 1, 0])
        # without an expectation only the icons' own form is checked
        self.assertEqual(pptxcheck.check_icons(f), [])

    def test_counts_are_exact(self):
        f = self.deck(sp("Icon 2"), "")
        self.assertEqual(pptxcheck.check_icons(f, [{"slide": 1, "icons": 2}]), ["slide 1: 1 icon(s), the export draws 2"])
        # a slide the expectation does not list holds none; an entry without icons (tables only) expects none
        self.assertEqual(pptxcheck.check_icons(f, [{"slide": 1, "tables": 1, "charts": 0}]), ["slide 1: 1 icon(s), the export draws 0"])
        self.assertEqual(pptxcheck.check_icons(f, [{"slide": 3, "icons": 1}]),
                         ["slide 1: 1 icon(s), the export draws 0", "slide 3: 0 icon(s), the export draws 1"])

    def test_a_preset_a_picture_or_a_square_line_fails(self):
        cases = {
            "a preset": sp("Icon 2", geom='<a:prstGeom prst="star5"><a:avLst/></a:prstGeom>'),
            "a picture fill": sp("Icon 2", fill='<a:blipFill><a:blip r:embed="rId9"/></a:blipFill>'),
            "a picture": '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Icon 2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>',
            "square caps": sp("Icon 2", ln='<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln>'),
            "mitred joins": sp("Icon 2", ln='<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:miter lim="800000"/></a:ln>'),
            "no line": sp("Icon 2", ln=""),
            "a picture in a group": grp("Icon 9", [sp("Icon 10", sid=10), '<p:pic><p:nvPicPr><p:cNvPr id="11" name="Picture 11"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>']),
        }
        for what, body in cases.items():
            bad = pptxcheck.check_icons(self.deck(body), [{"slide": 1, "icons": 1}])
            self.assertTrue(bad, what)
            self.assertTrue(all(b.startswith("slide 1, icon 1: ") for b in bad), (what, bad))

    def test_the_whole_check_runs_it(self):
        # check() (1, 2, 5, 6): a structurally incomplete file still gets its icon problems listed
        f = self.deck(sp("Icon 2", geom='<a:prstGeom prst="star5"><a:avLst/></a:prstGeom>'))
        out = os.path.join(self.tmp, "rep.json")
        self.assertFalse(pptxcheck.check([f], ppt=False, report=out, expect={f: [{"slide": 1, "icons": 1}]}))
        with open(out, encoding="utf-8") as fh:
            rep = json.load(fh)[0]
        self.assertIn("slide 1, icon 1: not custom geometry (a preset)", rep["problems"])
        self.assertEqual(rep["icons"], [1])


if __name__ == "__main__":
    unittest.main()
