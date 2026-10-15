"""store.py since Slide Builder 4 (S5.5): v3's workbook documents read only (the migration, the self-test), config.json
by compare-and-set on its rev under the lock `config` (shared with v3 helpers), personal preferences."""
import json
import multiprocessing
import os
import time

from sbtest import TempDirs, write_v3_doc

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

    def test_a_v3_document_is_read_as_it_is(self):
        write_v3_doc("Book.xlsx", {"schema": 3, "workbook": "Book.xlsx", "rev": 7, "preset": None, "style": {"color": 50}, "edits": {}, "futureKey": 1})
        doc = store.read_workbook("Book.xlsx")
        self.assertEqual((doc["rev"], doc["style"], doc["futureKey"]), (7, {"color": 50}, 1))
        self.assertFalse(hasattr(store, "update_workbook"))                 # v3's write path is gone (S5.5)

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
        with open(p, "rb") as f:
            self.assertEqual(f.read(), garbage)

    def test_config_compare_and_set_and_prefs(self):
        cfg = store.read_config()
        self.assertEqual((cfg["rev"], cfg["defaults"]), (0, {"style": {}}))
        cfg = store.replace_config_defaults(0, {"design": "excel"}, "u")
        self.assertEqual((cfg["rev"], cfg["defaults"]["style"], cfg["updatedBy"], cfg["schema"]), (1, {"design": "excel"}, "u", 3))
        with self.assertRaises(store.ConfigConflict) as e:
            store.replace_config_defaults(0, {"design": "glass"}, "v")      # read rev 0, it is 1 now
        self.assertEqual(e.exception.doc["defaults"]["style"], {"design": "excel"})
        self.assertEqual(store.read_config()["defaults"]["style"], {"design": "excel"})
        with self.assertRaises(ValueError):
            store.replace_config_defaults(1, "excel")
        self.assertFalse(store.create_config_if_missing({"style": {"design": "x"}}))
        self.assertEqual(store.read_prefs(), {"lastFile": None, "pdfMode": None, "zoom": None})
        store.write_prefs({"lastFile": "A.xlsx", "zoom": 1.25})
        store.write_prefs({"lastFile": "B.xlsx"})                   # whole replace
        self.assertEqual(store.read_prefs(), {"lastFile": "B.xlsx", "pdfMode": None, "zoom": None})
        self.assertTrue(os.path.exists(os.path.join(paths.DATA, "users", "tester.json")))

    def test_config_keeps_its_other_keys(self):
        os.makedirs(paths.DATA, exist_ok=True)
        with open(store.config_path(), "w", encoding="utf-8") as f:
            json.dump({"schema": 3, "rev": 4, "defaults": {"style": {"a": 1}, "v5only": True}, "extra": "kept"}, f)
        cfg = store.replace_config_defaults(4, {"a": 2})
        self.assertEqual((cfg["extra"], cfg["defaults"]["v5only"], cfg["defaults"]["style"]), ("kept", True, {"a": 2}))

    def test_concurrent_config_changes_from_six_processes_lose_nothing(self):
        ctx = multiprocessing.get_context("spawn")
        with ctx.Pool(6) as pool:
            res = [pool.apply_async(workers.config_keys, (self.root, self.data, "user%d" % i, "k%d" % i, 20)) for i in range(6)]
            self.assertEqual(sum(r.get(timeout=300) for r in res), 120)
        cfg = store.read_config()
        self.assertEqual(cfg["rev"], 120)
        self.assertEqual(len(cfg["defaults"]["style"]["colors"]), 120)
        self.assertEqual(os.listdir(os.path.join(paths.DATA, "locks")), [])


if __name__ == "__main__":
    unittest.main()
