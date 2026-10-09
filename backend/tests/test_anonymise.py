"""tools/anonymise.py: numbers scrambled (sign, decimals, zeros kept), dates/labels/formulas kept, names renamed,
document properties scrubbed, the same seed gives the same result."""
import importlib.util
import io
import json
import os
import re
import unittest
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_anonymise", os.path.join(REPO, "tools", "anonymise.py"))
an = importlib.util.module_from_spec(spec)
spec.loader.exec_module(an)

STYLES = ('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
          '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="3"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>')
SHEET = ('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>1234</v></c><c r="C1"><v>-12.5</v></c>'
         '<c r="D1"><v>0</v></c><c r="E1" s="2"><v>46000</v></c><c r="F1" s="3"><v>46001</v></c></row>'
         '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>SUM(B1:B1)</f><v>1234</v></c><c r="C2" t="str"><v>12</v></c>'
         '<c r="D2" t="b"><v>1</v></c><c r="E2"><v>0.0525</v></c></row></sheetData></worksheet>')
SST = '<sst><si><t>VUB</t></si><si><t>Δ vs Budget</t></si></sst>'


def xlsx():
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", '<workbook><sheets><sheet name="VUB data" sheetId="1"/></sheets></workbook>')
        z.writestr("xl/styles.xml", STYLES)
        z.writestr("xl/sharedStrings.xml", SST)
        z.writestr("xl/worksheets/sheet1.xml", SHEET)
        z.writestr("docProps/core.xml", "<cp:coreProperties><dc:creator>Mario Rossi</dc:creator><cp:lastModifiedBy>Anna B</cp:lastModifiedBy></cp:coreProperties>")
        z.writestr("docProps/app.xml", "<Properties><Company>Big Bank SpA</Company></Properties>")
    return bio.getvalue()


def cells(data):
    xml = zipfile.ZipFile(io.BytesIO(data)).read("xl/worksheets/sheet1.xml").decode()
    return dict(re.findall(r'<c r="([A-Z]+\d+)"[^>]*>(?:<f>[^<]*</f>)?<v>([^<]*)</v>', xml))


class AnonymiseTest(unittest.TestCase):
    def test_numbers_dates_labels(self):
        before, after = cells(xlsx()), cells(an.anonymise_workbook(xlsx(), seed=1))
        self.assertNotEqual(after["B1"], before["B1"])
        self.assertTrue(after["B1"].lstrip("-").isdigit())                     # an integer stays an integer
        self.assertTrue(after["C1"].startswith("-") and len(after["C1"].split(".")[1]) == 1)   # sign and decimals kept
        self.assertEqual(after["D1"], "0")                                       # zero stays zero
        self.assertEqual((after["E1"], after["F1"]), ("46000", "46001"))       # dates (custom and built-in) kept
        self.assertEqual((after["A1"], after["A2"], after["C2"], after["D2"]), ("0", "1", "12", "1"))   # strings, booleans kept
        self.assertNotEqual(after["B2"], before["B2"])                           # cached formula result scrambled …
        self.assertIn("<f>SUM(B1:B1)</f>", zipfile.ZipFile(io.BytesIO(an.anonymise_workbook(xlsx()))).read("xl/worksheets/sheet1.xml").decode())
        f = float(after["B1"]) / 1234
        self.assertTrue(0.59 <= f <= 1.41, f)
        self.assertNotEqual(after["E2"], before["E2"])

    def test_same_seed_same_result(self):
        self.assertEqual(an.anonymise_workbook(xlsx(), seed=3), an.anonymise_workbook(xlsx(), seed=3))
        self.assertNotEqual(cells(an.anonymise_workbook(xlsx(), seed=3)), cells(an.anonymise_workbook(xlsx(), seed=4)))

    def test_rename_and_properties(self):
        z = zipfile.ZipFile(io.BytesIO(an.anonymise_workbook(xlsx(), renames=[("VUB", "Bank A")])))
        self.assertIn("Bank A", z.read("xl/sharedStrings.xml").decode())
        self.assertIn("Δ vs Budget", z.read("xl/sharedStrings.xml").decode())   # comment-analysis labels kept
        self.assertIn('name="Bank A data"', z.read("xl/workbook.xml").decode())
        self.assertNotIn(b"Mario", z.read("docProps/core.xml"))
        self.assertNotIn(b"Anna", z.read("docProps/core.xml"))
        self.assertNotIn(b"Big Bank", z.read("docProps/app.xml"))

    def test_deck(self):
        doc = {"schema": 3, "workbook": "w.xlsx", "updatedBy": "mario", "log": [{"rev": 1, "by": "mario", "at": 1}],
               "preset": {"slides": [{"id": "s", "title": "VUB results", "notes": {"t:right": {"text": "VUB +476 mln"}}}]},
               "edits": {"VUB data": {"C5": {"text": "1,234", "orig": "1,111", "b": True}}}}
        out = an.anonymise_deck(json.loads(json.dumps(doc)), seed=1, renames=[("VUB", "Bank A")])
        self.assertEqual(out["preset"]["slides"][0]["title"], "Bank A results")
        note = out["preset"]["slides"][0]["notes"]["t:right"]["text"]
        self.assertTrue(note.startswith("Bank A +") and note.endswith(" mln") and note != "Bank A +476 mln")
        self.assertIn("Bank A data", out["edits"])
        self.assertTrue(out["edits"]["Bank A data"]["C5"]["b"])
        self.assertEqual((out["updatedBy"], out["log"][0]["by"]), ("someone", "someone"))


class AnonymiseMoreTest(unittest.TestCase):
    def test_deck_references_follow_a_renamed_sheet(self):
        doc = {"preset": {"sheets": ["VUB data"], "tables": [{"id": "t", "sheet": "VUB data"}],
                          "versions": [{"id": "v", "name": "All", "hide": {"VUB data": ["H10:I11"]}}],
                          "slides": [{"id": "s", "notes": {"t:right": {"text": "", "auto": {"exclude": ["VUB"]}}}}]},
               "edits": {"VUB data": {"C5": {"cf": "VUB data!H10"}}}}
        out = an.anonymise_deck(doc, renames=[("VUB", "Bank A")])
        self.assertEqual(out["preset"]["sheets"], ["Bank A data"])
        self.assertEqual(out["preset"]["tables"][0]["sheet"], "Bank A data")
        self.assertEqual(out["preset"]["versions"][0]["hide"], {"Bank A data": ["H10:I11"]})
        self.assertEqual(out["preset"]["slides"][0]["notes"]["t:right"]["auto"]["exclude"], ["Bank A"])
        self.assertEqual(out["edits"]["Bank A data"]["C5"]["cf"], "Bank A data!H10")
        self.assertNotIn("VUB", json.dumps(out))

    def test_caches_comments_and_prefixed_cells(self):
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as z:
            z.writestr("xl/styles.xml", STYLES)
            z.writestr("xl/worksheets/sheet1.xml", '<x:worksheet><x:sheetData><x:row r="1"><x:c r="B1"><x:v>1234</x:v></x:c></x:row></x:sheetData></x:worksheet>')
            z.writestr("xl/pivotCache/pivotCacheRecords1.xml", '<pivotCacheRecords><r><s v="VUB"/><n v="1234"/></r></pivotCacheRecords>')
            z.writestr("xl/charts/chart1.xml", "<c:chartSpace><c:numCache><c:pt idx=\"0\"><c:v>1234</c:v></c:pt></c:numCache></c:chartSpace>")
            z.writestr("xl/comments1.xml", "<comments><comment><text><t>ask VUB</t></text></comment></comments>")
        out = zipfile.ZipFile(io.BytesIO(an.anonymise_workbook(bio.getvalue(), renames=[("VUB", "Bank A")])))
        self.assertNotIn("<x:v>1234</x:v>", out.read("xl/worksheets/sheet1.xml").decode())
        rec = out.read("xl/pivotCache/pivotCacheRecords1.xml").decode()
        self.assertNotIn('<n v="1234"/>', rec)
        self.assertIn('<s v="Bank A"/>', rec)
        self.assertNotIn("<c:v>1234</c:v>", out.read("xl/charts/chart1.xml").decode())
        self.assertIn("ask Bank A", out.read("xl/comments1.xml").decode())


if __name__ == "__main__":
    unittest.main()
