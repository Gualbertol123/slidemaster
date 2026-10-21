import json
import os
import unittest
from unittest import mock

from sbtest import TempDirs, write_v3_doc

from slidebuilder import decks, migrate, migrate_v3, paths, store
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
        write_v3_doc("Existing.xlsx", {"style": {"color": 1}, "updatedBy": "carol"})
        with open(store.workbook_path("Existing.xlsx"), "rb") as f:
            self.existing_bytes = f.read()

    def test_import(self):
        rep = migrate.migrate(self.settings, user="alice", now=5000)
        self.assertEqual(sorted(rep["workbooks"]), ["Budget 2026.xlsm", "IBD weekly.xlsx"])
        self.assertEqual(rep["skipped"], ["Existing.xlsx"])

        # each workbook: a new deck (with the frozen stub that keeps v3 off it) whose first record is the import, as
        # operations - the core folds them (ops.ts; shared/ops-vectors.json covers what they do: an `orig` without text
        # goes, an invalid cell address is skipped); the helper applies none
        for name in ("IBD weekly.xlsx", "Budget 2026.xlsm"):
            key = decks.deck_key(name)
            snap = decks.read_snapshot(key)
            self.assertEqual((snap["gen"], snap["doc"]["edits"], snap["doc"]["preset"]), (1, {}, None))
            recs = [r for j in decks.tail(key, {})["journals"].values() for r in j["records"]]
            self.assertEqual(len(recs), 1)
            self.assertEqual((recs[0]["s"], recs[0]["l"], recs[0]["by"]), (1, 1, "alice"))
            preset = migrate.convert_preset(V2["presets"].get(name))
            self.assertEqual(recs[0]["ops"], migrate.workbook_ops(preset, V2["files"].get(name)))
            self.assertEqual(migrate_v3.owner(name), "v4")
            with open(store.workbook_path(name), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["movedTo"], "v4")
        ops = recs[0]["ops"]                                     # Budget: the cells as v2 had them
        self.assertEqual([o["ref"] for o in ops], ["A1", "B2", "bad ref"])
        ibd = [r for j in decks.tail(decks.deck_key("IBD weekly.xlsx"), {})["journals"].values() for r in j["records"]][0]["ops"]
        p = ibd[0]["preset"]
        self.assertEqual(p["sheets"], ["Overview", "Detail"])
        self.assertEqual(p["tables"], V2["presets"]["IBD weekly.xlsx"]["tables"])
        self.assertEqual([s_["type"] for s_ in p["slides"]], ["cover", "index", "content", "content"])   # positions kept
        self.assertEqual(p["slides"][1], {"id": "i1", "type": "index", "title": "Contents", "tables": []})
        self.assertNotIn("version", p)

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

    def test_an_import_interrupted_after_the_deck_was_made_is_finished_next_time(self):
        """review of S5.5: the deck exists (with its frozen stub) but the import's record never arrived"""
        real = decks.append
        with mock.patch.object(decks, "append", side_effect=OSError("the share went away")):
            with self.assertRaises(OSError):
                migrate.migrate(self.settings, user="alice", now=5000)
        self.assertTrue(os.path.exists(self.settings))                 # not marked as done
        self.assertFalse(os.path.exists(os.path.join(paths.DATA, "migrated.json")))
        made = [n for n in ("IBD weekly.xlsx", "Budget 2026.xlsm") if decks.deck_exists(decks.deck_key(n))]
        self.assertEqual(len(made), 1)                                  # one deck made, its record lost…
        key = decks.deck_key(made[0])                                   # …or torn: half a frame on the share
        os.makedirs(decks.journal_dir(key), exist_ok=True)
        with open(os.path.join(decks.journal_dir(key), migrate.import_writer(key) + "~1.log"), "wb") as f:
            f.write(decks.frame({"w": "x"})[:9])
        with mock.patch.object(decks, "append", side_effect=real):
            rep = migrate.migrate(self.settings, user="alice", now=6000)
        self.assertEqual(sorted(rep["workbooks"]), ["Budget 2026.xlsm", "IBD weekly.xlsx"])
        for name in ("IBD weekly.xlsx", "Budget 2026.xlsm"):
            recs = [r for j in decks.tail(decks.deck_key(name), {})["journals"].values() for r in j["records"]]
            self.assertEqual(len(recs), 1, name)
            self.assertEqual(recs[0]["w"], migrate.import_writer(decks.deck_key(name)))

    def test_a_deck_used_since_is_never_imported_into(self):
        key, how = migrate_v3.ensure_deck("IBD weekly.xlsx")            # made by Slide Builder 4 and edited there
        w = decks.new_writer()
        decks.append(key, w, {"w": w, "s": 1, "l": 1, "by": "bob", "ops": []})
        rep = migrate.migrate(self.settings, user="alice", now=5000)
        self.assertIn("IBD weekly.xlsx", rep["skipped"])
        recs = [r for j in decks.tail(key, {})["journals"].values() for r in j["records"]]
        self.assertEqual([r["w"] for r in recs], [w])

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


class VectorFilesTests(unittest.TestCase):
    """the operation vectors the core runs (core/tests/vectors.ts): shared/ops-vectors.json and, since S14.P, one file per
    parallel milestone in shared/ops-vectors.d (m14.json, m15.json). The helper applies no operation (test_import above),
    so it checks only that each file is an array of cases and that no name is used twice across the files"""

    def test_vector_files(self):
        shared = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "shared")
        d = os.path.join(shared, "ops-vectors.d")
        files = [os.path.join(shared, "ops-vectors.json")] + [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".json")]
        self.assertEqual([os.path.basename(f) for f in files[1:]][:2], ["m14.json", "m15.json"])
        seen = {}
        for f in files:
            with open(f, encoding="utf-8") as h:
                cases = json.load(h)
            self.assertIsInstance(cases, list, f)
            for c in cases:
                self.assertIsInstance(c.get("name"), str, f)
                self.assertIn("expect", c, c["name"])
                self.assertTrue("fold" in c or ("doc" in c and isinstance(c.get("ops"), list)), c["name"])
                self.assertNotIn(c["name"], seen, "%s: also in %s" % (c["name"], seen.get(c["name"])))
                seen[c["name"]] = os.path.basename(f)
        self.assertGreater(len(seen), 100)


if __name__ == "__main__":
    unittest.main()
