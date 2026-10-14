"""Clock skew between PCs: ages of shared files use the file server's clock (fsclock)."""
import json
import os
import time
import unittest
from unittest import mock

from sbtest import TempDirs

from slidebuilder import fsclock, paths, presence, store
from slidebuilder.locks import Lock, LockTimeout

REAL_TIME = time.time


def skewed(seconds):
    """Make this process's clock run `seconds` ahead (negative: behind) of the file server."""
    fsclock.reset()
    return mock.patch("time.time", lambda: REAL_TIME() + seconds)


class ClockSkewTests(TempDirs):
    def tearDown(self):
        fsclock.reset()
        super().tearDown()

    def test_offset_is_measured_against_the_file_mtime(self):
        d = os.path.join(self.data, "locks")
        with skewed(60):
            self.assertAlmostEqual(fsclock.offset(d), -60, delta=1)
            self.assertAlmostEqual(fsclock.fs_now(d), REAL_TIME(), delta=1)
        self.assertEqual(os.listdir(d), [])                      # the probe file is removed

    def test_fresh_lock_is_not_broken_by_a_pc_whose_clock_runs_ahead(self):
        holder = Lock("wb-x").acquire()                           # file stamped by the server, now
        try:
            with skewed(60):                                      # the acquiring PC is 60 s ahead
                with self.assertRaises(LockTimeout):
                    Lock("wb-x", timeout=0.5).acquire()
            self.assertTrue(os.path.exists(holder.path))
        finally:
            self.assertTrue(holder.release())

    def test_stale_lock_is_broken_by_a_pc_whose_clock_runs_behind(self):
        os.makedirs(os.path.join(self.data, "locks"))
        p = os.path.join(self.data, "locks", "wb-y.lock")
        with open(p, "w") as f:
            json.dump({"user": "ghost", "host": "pc9", "pid": 1, "at": 0, "token": "dead"}, f)
        old = REAL_TIME() - 20                                    # 20 s old on the server's clock
        os.utime(p, (old, old))
        with skewed(-60):                                         # this PC is 60 s behind
            with Lock("wb-y", timeout=2) as l:
                self.assertTrue(l.held)

    def test_keepalive_writes_instead_of_stamping_the_local_clock(self):
        with skewed(-120):                                        # utime(None) would date the file 2 min back
            l = Lock("long", stale=1.0, keepalive=True).acquire()
            try:
                time.sleep(1.6)
                with self.assertRaises(LockTimeout):
                    Lock("long", stale=1.0, timeout=0.4).acquire()
            finally:
                self.assertTrue(l.release())

    def test_presence_uses_one_timeline(self):
        with skewed(120), mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "ahead", "SLIDEBUILDER_HOST": "pcA"}):
            presence.heartbeat("ca", "W.xlsx")
        with skewed(-120), mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "behind", "SLIDEBUILDER_HOST": "pcB"}):
            others = presence.heartbeat("cb", "W.xlsx")
            self.assertEqual([o["user"] for o in others], ["ahead"])
            self.assertAlmostEqual(others[0]["at"] / 1000.0, REAL_TIME(), delta=2)
        fsclock.reset()
        self.assertEqual(sorted(o["user"] for o in presence.others("someone-else")), ["ahead", "behind"])

    def test_document_timestamps_and_backup_spacing(self):
        with skewed(600):
            doc, _, _ = store.update_workbook("W.xlsx", [{"op": "style.patch", "patch": {"color": 1}}], "u")
            self.assertAlmostEqual(doc["updated"] / 1000.0, REAL_TIME(), delta=2)
        with skewed(-600):                                        # 10 min behind: still within 5 min of rev 1
            store.update_workbook("W.xlsx", [{"op": "style.patch", "patch": {"color": 2}}], "u")
        with skewed(600):                                         # 10 min ahead: still within 5 min of rev 1
            store.update_workbook("W.xlsx", [{"op": "style.patch", "patch": {"color": 3}}], "u")
        self.assertEqual([h["rev"] for h in store.history("W.xlsx")], [1])
        self.assertEqual(sorted(os.listdir(os.path.join(paths.DATA, "backups", store.workbook_key("W.xlsx")))), ["1.json"])


if __name__ == "__main__":
    unittest.main()
