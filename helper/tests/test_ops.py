import copy
import json
import os
import unittest

from sbtest import REPO

from slidebuilder.ops import apply_ops

VECTORS = os.path.join(REPO, "shared", "ops-vectors.json")


class OpsVectors(unittest.TestCase):
    def test_vectors(self):
        with open(VECTORS, encoding="utf-8") as f:
            cases = json.load(f)
        self.assertTrue(cases)
        for case in cases:
            with self.subTest(case["name"]):
                doc = copy.deepcopy(case["doc"])
                doc["rev"] = 7
                before = copy.deepcopy(doc)
                out, applied, skipped = apply_ops(doc, case["ops"], "alice", 1234)
                exp = case["expect"]
                self.assertEqual(out["preset"], exp["preset"])
                self.assertEqual(out["style"], exp["style"])
                self.assertEqual(out["edits"], exp["edits"])
                self.assertEqual(applied, exp["applied"])
                self.assertEqual(skipped, exp["skipped"])
                self.assertEqual(doc, before, "the input document must not be modified")
                if applied:
                    self.assertEqual((out["rev"], out["updated"], out["updatedBy"]), (8, 1234, "alice"))
                else:
                    self.assertEqual(out["rev"], 7)
                    self.assertNotIn("updatedBy", out)


class OpsDetails(unittest.TestCase):
    def base(self):
        return {"rev": 0, "preset": None, "style": {}, "edits": {}}

    def test_values_are_deep_copied(self):
        patch = {"layout": {"bands": [[0]], "w": [1]}}
        doc = {"rev": 0, "preset": {"sheets": [], "tables": [], "slides": [{"id": "s1"}]}, "style": {}, "edits": {}}
        out, applied, _ = apply_ops(doc, [{"op": "slide.patch", "id": "s1", "patch": patch}], "u", 1)
        patch["layout"]["w"].append(99)
        self.assertEqual(out["preset"]["slides"][0]["layout"], {"bands": [[0]], "w": [1]})
        preset = {"sheets": ["A"], "tables": [], "slides": []}
        out, _, _ = apply_ops(self.base(), [{"op": "preset.set", "preset": preset}], "u", 1)
        preset["sheets"].append("B")
        self.assertEqual(out["preset"]["sheets"], ["A"])

    def test_field_validation(self):
        ops = [
            {"op": "cell.patch", "sheet": "", "ref": "A1", "patch": {"b": True}},       # empty sheet
            {"op": "cell.patch", "sheet": 5, "ref": "A1", "patch": {"b": True}},        # sheet not str
            {"op": "cell.patch", "sheet": "S", "ref": "a1", "patch": {"b": True}},      # lower case ref
            {"op": "cell.patch", "sheet": "S", "ref": "ABCD1", "patch": {"b": True}},   # 4 letters
            {"op": "cell.patch", "sheet": "S", "ref": "A12345678", "patch": {"b": True}},
            {"op": "slide.patch", "id": 1, "patch": {"title": "x"}},
            {"op": "slide.patch", "id": "s1", "patch": []},
            {"op": "preset.set"},
            {"op": "preset.set", "preset": [1]},
            {"op": "style.patch", "patch": None},
            "not an op",
            None,
        ]
        out, applied, skipped = apply_ops(self.base(), ops, "u", 1)
        self.assertEqual(applied, 0)
        self.assertEqual(skipped, list(range(len(ops))))
        self.assertEqual(out["rev"], 0)

    def test_table_patch_validation_and_copies(self):
        doc = {"rev": 0, "preset": {"sheets": [], "tables": [{"id": "t1"}], "slides": [{"id": "s1"}]}, "style": {}, "edits": {}}
        rule = {"range": "B2:B5", "dir": "col"}
        note = {"text": "A"}
        ops = [{"op": "table.patch", "id": 1, "patch": {"name": "x"}},             # id not a string
               {"op": "table.patch", "id": "t1", "patch": None},                  # patch not an object
               {"op": "table.patch", "id": "t1", "patch": {"scales": {"r": rule}, "cols": 5}},  # cols not a map: ignored
               {"op": "slide.patch", "id": "s1", "patch": {"notes": {"t1:top": note}}}]
        out, applied, skipped = apply_ops(doc, ops, "u", 1)
        self.assertEqual((applied, skipped), (2, [0, 1]))
        rule["dir"] = "row"
        note["text"] = "B"
        self.assertEqual(out["preset"]["tables"][0], {"id": "t1", "scales": {"r": {"range": "B2:B5", "dir": "col"}}})
        self.assertEqual(out["preset"]["slides"][0]["notes"], {"t1:top": {"text": "A"}})
        out2, applied, _ = apply_ops({"rev": 0, "preset": None}, [{"op": "table.patch", "id": "t1", "patch": {}}], "u", 1)
        self.assertEqual(applied, 0)

    def test_config_only_accepts_style_patch(self):
        cfg = {"rev": 3, "defaults": {"style": {"design": "glass"}}}
        ops = [{"op": "style.patch", "patch": {"color": 50, "pn": {"on": True}}},
               {"op": "cell.patch", "sheet": "S", "ref": "A1", "patch": {"b": True}},
               {"op": "preset.set", "preset": None}]
        out, applied, skipped = apply_ops(cfg, ops, "u", 9, kind="config")
        self.assertEqual(out["defaults"]["style"], {"design": "glass", "color": 50, "pn": {"on": True}})
        self.assertEqual((applied, skipped, out["rev"]), (1, [1, 2], 4))
        self.assertNotIn("edits", out)
        self.assertNotIn("preset", out)


if __name__ == "__main__":
    unittest.main()
