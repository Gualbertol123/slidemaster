import json
import os
import unittest

from sbtest import TempDirs

from slidebuilder import migrate, paths, store
from slidebuilder.util import doc_key

V2 = {
    "version": 2,
    "app": {"design": "excel", "glass": "medium", "color": 60, "logo": "bank.png", "pdfMode": "vector", "scale": 3,
            "lastFile": "IBD weekly.xlsx", "pageStart": "3",
            "pn": {"on": False, "start": 1, "pos": "tl", "font": "auto", "size": 18, "format": "nN", "style": "plain", "cover": True}},
    "presets": {
        "IBD weekly.xlsx": {
            "version": 3, "updated": 1791214363000,
            "sheets": ["Overview", "Detail"],
            "tables": [{"id": "k3j9x0a", "sheet": "SLIDE_1", "kind": "markers", "anchor": "A3", "index": 0},
                       {"id": "p0q8z1b", "sheet": "Detail", "kind": "range", "range": "A2:K20", "grow": True, "name": "Products"}],
            "slides": [
                {"id": "c1", "type": "cover", "title": "IBD Weekly", "subtitle": None, "date": None, "note": "IBD", "tables": []},
                {"id": "i1", "type": "index", "title": "Contents"},
                {"id": "s1", "type": "content", "title": None, "subtitle": None, "tables": ["k3j9x0a"],
                 "layout": {"bands": [[0]], "w": [1]}, "logo": False},
                {"id": "s2", "type": "content", "title": "Products", "tables": ["p0q8z1b"]},
            ]},
        "Existing.xlsx": {"version": 3, "sheets": ["A"], "tables": [], "slides": []},
    },
    "files": {
        "IBD weekly.xlsx": {
            "Overview": {"cells": {"C7": {"orig": "TOTAL", "text": "Totale", "sz": 14, "b": True},
                                   "D9": {"fill": "#34C759", "role": "header"}},
                         "layouts": {"legacy": 1}}},
        "Budget 2026.xlsm": {
            "Plan": {"cells": {"A1": {"orig": "only orig"},                    # nothing left -> dropped
                               "B2": {"orig": "x", "b": False, "color": "#A8101A"},  # orig without text -> dropped key
                               "bad ref": {"b": True}}},                         # invalid address -> skipped
            "Empty": {"cells": {}}},
    },
}


class MigrationTests(TempDirs):
    def setUp(self):
        super().setUp()
        self.settings = os.path.join(self.tmp, "slide_builder_settings.txt")
        with open(self.settings, "w", encoding="utf-8") as f:
            json.dump(V2, f, indent=2)
        # a document that exists already must not be overwritten
        self.existing, _, _ = store.update_workbook("Existing.xlsx", [{"op": "style.patch", "patch": {"color": 1}}], "carol")
        with open(store.workbook_path("Existing.xlsx"), "rb") as f:
            self.existing_bytes = f.read()

    def test_import(self):
        rep = migrate.migrate(self.settings, user="alice", now=5000)
        self.assertEqual(sorted(rep["workbooks"]), ["Budget 2026.xlsm", "IBD weekly.xlsx"])
        self.assertEqual(rep["skipped"], ["Existing.xlsx"])

        ibd = store.read_workbook("IBD weekly.xlsx")
        self.assertEqual((ibd["schema"], ibd["workbook"], ibd["rev"], ibd["updatedBy"]), (3, "IBD weekly.xlsx", 1, "alice"))
        self.assertEqual(ibd["updated"], 1791214363000)
        p = ibd["preset"]
        self.assertEqual(p["sheets"], ["Overview", "Detail"])
        self.assertEqual(p["tables"], V2["presets"]["IBD weekly.xlsx"]["tables"])
        self.assertEqual([s["type"] for s in p["slides"]], ["cover", "index", "content", "content"])   # positions kept
        self.assertEqual(p["slides"][1], {"id": "i1", "type": "index", "title": "Contents", "tables": []})
        self.assertEqual(p["slides"][2]["layout"], {"bands": [[0]], "w": [1]})
        self.assertFalse(p["slides"][2]["logo"])
        self.assertNotIn("version", p)
        self.assertNotIn("updated", p)
        self.assertEqual(ibd["edits"], {"Overview": {"C7": {"orig": "TOTAL", "text": "Totale", "sz": 14, "b": True},
                                                     "D9": {"fill": "#34C759", "role": "header"}}})
        self.assertEqual(ibd["style"], {})

        bud = store.read_workbook("Budget 2026.xlsm")
        self.assertIsNone(bud["preset"])
        self.assertEqual(bud["edits"], {"Plan": {"B2": {"b": False, "color": "#A8101A"}}})
        self.assertEqual(bud["rev"], 1)
        self.assertTrue(os.path.exists(os.path.join(paths.DATA, "backups", doc_key("Budget 2026.xlsm"), "1.json")))

        with open(store.workbook_path("Existing.xlsx"), "rb") as f:
            self.assertEqual(f.read(), self.existing_bytes)

        cfg = store.read_config()
        self.assertEqual(cfg["defaults"]["style"], {
            "design": "excel", "glass": "medium", "color": 60, "logo": "bank.png",
            "pn": {"on": True, "start": 3, "pos": "tl", "font": "auto", "size": 18, "format": "nN", "style": "plain", "cover": True}})
        self.assertEqual((cfg["rev"], cfg["updatedBy"]), (1, "alice"))

        self.assertEqual(store.read_prefs("alice"), {"lastFile": "IBD weekly.xlsx", "pdfMode": "vector", "zoom": None})

        self.assertFalse(os.path.exists(self.settings))
        backup = os.path.join(self.tmp, "slide_builder_settings.v2-backup.txt")
        with open(backup, encoding="utf-8") as f:
            self.assertEqual(json.load(f), V2)
        with open(os.path.join(paths.DATA, "migrated.json")) as f:
            marker = json.load(f)
        self.assertEqual(marker["backup"], "slide_builder_settings.v2-backup.txt")
        self.assertTrue(marker["config"] and marker["prefs"])
        self.assertEqual(os.listdir(os.path.join(paths.DATA, "locks")), [])

    def test_second_run_is_a_noop(self):
        migrate.migrate(self.settings, user="alice", now=5000)
        snapshot = {}
        for d, _, files in os.walk(paths.DATA):
            for n in files:
                p = os.path.join(d, n)
                with open(p, "rb") as f:
                    snapshot[p] = f.read()
        # the old file comes back (e.g. restored by somebody): still nothing happens
        with open(self.settings, "w", encoding="utf-8") as f:
            json.dump(V2, f)
        self.assertIsNone(migrate.migrate(self.settings, user="bob", now=9999))
        after = {}
        for d, _, files in os.walk(paths.DATA):
            for n in files:
                p = os.path.join(d, n)
                with open(p, "rb") as f:
                    after[p] = f.read()
        self.assertEqual(after, snapshot)
        self.assertTrue(os.path.exists(self.settings))

    def test_no_settings_file(self):
        os.remove(self.settings)
        self.assertIsNone(migrate.migrate(self.settings, user="alice"))
        self.assertFalse(os.path.exists(os.path.join(paths.DATA, "migrated.json")))

    def test_unreadable_settings_are_left_alone(self):
        with open(self.settings, "w") as f:
            f.write("{ not json")
        self.assertIsNone(migrate.migrate(self.settings, user="alice"))
        self.assertTrue(os.path.exists(self.settings))
        self.assertFalse(os.path.exists(os.path.join(paths.DATA, "migrated.json")))

    def test_norm_app_legacy_page_start(self):
        self.assertEqual(migrate.norm_app({"pageStart": ""})["pn"]["on"], False)
        self.assertEqual(migrate.norm_app({"pageStart": "abc"})["pn"]["on"], False)
        a = migrate.norm_app({"pageStart": 0})
        self.assertEqual((a["pn"]["on"], a["pn"]["start"]), (True, 0))
        self.assertNotIn("pageStart", a)
        self.assertEqual(migrate.norm_app(None)["design"], "glass")


if __name__ == "__main__":
    unittest.main()
