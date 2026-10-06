import json
import multiprocessing
import os
import time
import unittest

from sbtest import TempDirs

import workers
from slidebuilder import paths, store
from slidebuilder.store import StoreUnreadable
from slidebuilder.util import doc_key


class StoreTests(TempDirs):
    def test_key_function(self):
        k = doc_key("IBD weekly (v2).xlsx")
        self.assertRegex(k, r"^IBD_weekly__v2_\.xlsx-[0-9a-f]{10}$")
        self.assertEqual(doc_key("Book.xlsx")[-10:], doc_key("BOOK.XLSX")[-10:])
        self.assertLessEqual(len(doc_key("x" * 300 + ".xlsx")), 71)

    def test_missing_doc_is_default_with_rev_0(self):
        doc = store.read_workbook("New.xlsx")
        self.assertEqual(doc, {"schema": 3, "workbook": "New.xlsx", "rev": 0, "preset": None, "style": {}, "edits": {}})
        self.assertFalse(os.path.exists(store.workbook_path("New.xlsx")))

    def test_update_writes_and_backs_up(self):
        doc, applied, skipped = store.update_workbook("Book.xlsx", [{"op": "style.patch", "patch": {"color": 50}}], "alice")
        self.assertEqual((doc["rev"], applied, skipped, doc["updatedBy"]), (1, 1, [], "alice"))
        with open(store.workbook_path("Book.xlsx")) as f:
            self.assertEqual(json.load(f)["style"], {"color": 50})
        backups = os.path.join(paths.DATA, "backups", doc_key("Book.xlsx"))
        self.assertEqual(os.listdir(backups), ["1.json"])
        # within 5 minutes: no new backup
        store.update_workbook("Book.xlsx", [{"op": "style.patch", "patch": {"color": 60}}], "bob")
        self.assertEqual(os.listdir(backups), ["1.json"])
        # older than 5 minutes: a new backup
        old = time.time() - 400
        os.utime(os.path.join(backups, "1.json"), (old, old))
        store.update_workbook("Book.xlsx", [{"op": "style.patch", "patch": {"color": 70}}], "bob")
        self.assertEqual(sorted(os.listdir(backups)), ["1.json", "3.json"])
        hist = store.history("Book.xlsx")
        self.assertEqual([h["rev"] for h in hist], [3, 1])
        self.assertEqual(hist[0]["updatedBy"], "bob")
        # no leftovers
        self.assertEqual([n for n in os.listdir(os.path.dirname(store.workbook_path("Book.xlsx"))) if n.endswith(".tmp")], [])

    def test_revision_log_names_each_author_and_is_capped(self):
        for i in range(25):
            doc, _, _ = store.update_workbook("Log.xlsx", [{"op": "style.patch", "patch": {"color": i}}], "u%d" % i)
        self.assertEqual(len(doc["log"]), store.LOG_KEEP)
        self.assertEqual([x["rev"] for x in doc["log"]], list(range(6, 26)))
        self.assertEqual(doc["log"][-1]["by"], "u24")
        # nothing applied: no new log entry
        doc2, applied, _ = store.update_workbook("Log.xlsx", [{"op": "nope"}], "x")
        self.assertEqual((applied, doc2["log"][-1]["rev"]), (0, 25))

    def test_backups_keep_last_30(self):
        store.BACKUP_EVERY_saved = store.BACKUP_EVERY
        store.BACKUP_EVERY = 0
        try:
            for i in range(35):
                store.update_workbook("Many.xlsx", [{"op": "style.patch", "patch": {"color": i}}], "u")
        finally:
            store.BACKUP_EVERY = store.BACKUP_EVERY_saved
        revs = sorted(int(n.split(".")[0]) for n in os.listdir(os.path.join(paths.DATA, "backups", doc_key("Many.xlsx"))))
        self.assertEqual(revs, list(range(6, 36)))

    def test_no_write_when_nothing_applied(self):
        doc, applied, skipped = store.update_workbook("Book.xlsx", [{"op": "nope"}], "u")
        self.assertEqual((applied, skipped, doc["rev"]), (0, [0], 0))
        self.assertFalse(os.path.exists(store.workbook_path("Book.xlsx")))

    def test_unreadable_doc_raises_and_is_not_replaced(self):
        p = store.workbook_path("Broken.xlsx")
        os.makedirs(os.path.dirname(p))
        garbage = b'{"schema": 3, "rev": 4, "edits": {'          # torn write
        with open(p, "wb") as f:
            f.write(garbage)
        t0 = time.time()
        with self.assertRaises(StoreUnreadable):
            store.read_workbook("Broken.xlsx")
        self.assertGreaterEqual(time.time() - t0, 0.3)          # parse was retried
        with self.assertRaises(StoreUnreadable):
            store.update_workbook("Broken.xlsx", [{"op": "style.patch", "patch": {"color": 1}}], "u")
        with open(p, "rb") as f:
            self.assertEqual(f.read(), garbage)
        self.assertFalse(os.path.exists(os.path.join(paths.DATA, "locks", "wb-" + doc_key("Broken.xlsx") + ".lock")))

    def test_config_and_prefs(self):
        cfg = store.read_config()
        self.assertEqual((cfg["rev"], cfg["defaults"]), (0, {"style": {}}))
        cfg, applied, skipped = store.update_config([{"op": "style.patch", "patch": {"design": "excel"}},
                                                     {"op": "cell.patch", "sheet": "S", "ref": "A1", "patch": {}}], "u")
        self.assertEqual((cfg["rev"], applied, skipped, cfg["defaults"]["style"]), (1, 1, [1], {"design": "excel"}))
        self.assertEqual(store.read_config()["defaults"]["style"], {"design": "excel"})
        self.assertEqual(store.read_prefs(), {"lastFile": None, "pdfMode": None, "zoom": None})
        store.write_prefs({"lastFile": "A.xlsx", "zoom": 1.25})
        store.write_prefs({"lastFile": "B.xlsx"})                   # whole replace
        self.assertEqual(store.read_prefs(), {"lastFile": "B.xlsx", "pdfMode": None, "zoom": None})
        self.assertTrue(os.path.exists(os.path.join(paths.DATA, "users", "tester.json")))

    def test_concurrent_updates_from_six_processes(self):
        ctx = multiprocessing.get_context("spawn")
        cols = "ABCDEF"
        with ctx.Pool(6) as pool:
            res = [pool.apply_async(workers.store_cells, (self.root, self.data, "user%d" % i, cols[i], 30)) for i in range(6)]
            self.assertEqual(sum(r.get(timeout=300) for r in res), 180)
        doc = store.read_workbook("Shared Deck.xlsx")
        self.assertEqual(doc["rev"], 180)
        cells = doc["edits"]["Data"]
        self.assertEqual(len(cells), 180)
        for i, c in enumerate(cols):
            for k in range(1, 31):
                self.assertEqual(cells["%s%d" % (c, k)], {"text": "user%d" % i, "orig": "%s%d" % (c, k), "b": True})
        self.assertEqual(os.listdir(os.path.join(paths.DATA, "locks")), [])
        leftovers = [n for n in os.listdir(os.path.dirname(store.workbook_path("x"))) if not n.endswith(".json")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
