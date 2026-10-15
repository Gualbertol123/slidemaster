import os
import threading
import time
import unittest

from sbtest import write_v3_doc, TempDirs, make_xlsx_bytes

from slidebuilder import paths, store, workbooks


class WorkbookTests(TempDirs):
    def write(self, name, data):
        p = os.path.join(paths.ROOT, name)
        with open(p, "wb") as f:
            f.write(data)
        return p

    def test_list(self):
        self.write("A.xlsx", make_xlsx_bytes())
        self.write("~$A.xlsx", b"lock")
        self.write("notes.txt", b"x")
        self.write("B.xlsx", make_xlsx_bytes())
        write_v3_doc("A.xlsx", {"rev": 1, "updated": 1791214363000, "updatedBy": "alice"})       # still Slide Builder 3's
        from slidebuilder import decks, migrate_v3
        migrate_v3.ensure_deck("B.xlsx")
        key = decks.deck_key("B.xlsx")
        w = decks.new_writer("bob")
        decks.append(key, w, {"w": w, "s": 1, "l": 1, "by": "bob", "ops": []})
        snap = decks.read_snapshot(key)
        t = decks.tail(key, {})
        decks.compact(key, 1, dict(snap, gen=2, lamport=1, rev=1, updated=t["now"], updatedBy="bob",
                                   frontier={j: v["offset"] for j, v in t["journals"].items()}))
        rows = workbooks.list_workbooks()
        names = [r["name"] for r in rows]
        self.assertIn("A.xlsx", names)
        self.assertNotIn("~$A.xlsx", names)
        self.assertNotIn("notes.txt", names)
        a = next(r for r in rows if r["name"] == "A.xlsx")
        self.assertEqual((a["rev"], a["updatedBy"]), (1, "alice"))
        self.assertIsInstance(a["updated"], int)
        b = next(r for r in rows if r["name"] == "B.xlsx")                     # a deck: from its snapshot
        self.assertEqual((b["rev"], b["updatedBy"]), (1, "bob"))

    def test_find_is_path_safe(self):
        self.write("A.xlsx", b"PK")
        self.assertTrue(workbooks.find_workbook("A.xlsx").endswith("A.xlsx"))
        for bad in ("../A.xlsx", "../../etc/passwd", "slide_builder.py", "data/config.json"):
            with self.assertRaises(PermissionError):
                workbooks.find_workbook(bad)
        with self.assertRaises(FileNotFoundError):
            workbooks.find_workbook("Missing.xlsx")

    def test_stable_read(self):
        data = make_xlsx_bytes()
        p = self.write("A.xlsx", data)
        got, mtime, size = workbooks.stable_read(p)
        self.assertEqual((got, size), (data, len(data)))
        self.assertAlmostEqual(mtime, os.path.getmtime(p), places=3)

    def test_incomplete_zip_is_retried_then_unstable(self):
        p = self.write("A.xlsx", make_xlsx_bytes()[:-30])
        t0 = time.time()
        with self.assertRaises(workbooks.Unstable):
            workbooks.stable_read(p, attempts=3, delay=0.1)
        self.assertGreaterEqual(time.time() - t0, 0.2)

    def test_file_completed_while_waiting(self):
        full = make_xlsx_bytes()
        p = self.write("A.xlsx", full[:100])

        def finish():
            time.sleep(0.3)
            with open(p, "wb") as f:
                f.write(full)
        t = threading.Thread(target=finish)
        t.start()
        got, _, size = workbooks.stable_read(p, attempts=8, delay=0.2)
        t.join()
        self.assertEqual((got, size), (full, len(full)))

    def test_non_zip_workbook(self):
        p = self.write("Old.xls", b"\xd0\xcf\x11\xe0" + b"\x00" * 100)
        self.assertEqual(workbooks.stable_read(p)[2], 104)


if __name__ == "__main__":
    unittest.main()
