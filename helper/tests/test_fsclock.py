"""Clock skew between PCs: ages of shared files use the file server's clock (fsclock)."""
import json
import os
import time
import unittest
from unittest import mock

from sbtest import TempDirs

from slidebuilder import fsclock, paths, store
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

    def test_a_pc_clock_set_while_running_is_noticed_at_once(self):
        """milestone review: a deck append must not stamp `at` with an offset measured before the PC clock was set"""
        from slidebuilder import decks
        d = paths.DATA
        os.makedirs(d, exist_ok=True)
        self.assertAlmostEqual(fsclock.offset_nowait(d), 0, delta=1)
        self.assertTrue(fsclock.trusted(d))
        with mock.patch("time.time", lambda: REAL_TIME() - 600):     # corrected by -10 min meanwhile (no reset)
            self.assertFalse(fsclock.trusted(d))
            self.assertAlmostEqual(fsclock.offset_nowait(d), 600, delta=1)
            self.assertTrue(fsclock.trusted(d))
            self.assertAlmostEqual(decks.server_ms() / 1000.0, REAL_TIME(), delta=2)

    def test_a_failed_probe_leaves_the_clock_unknown_and_tails_without_now(self):
        from slidebuilder import decks
        key = decks.deck_key("A.xlsx")
        decks.create_if_missing("A.xlsx")
        fsclock.reset()
        with mock.patch.object(fsclock, "measure_offset", return_value=None):
            self.assertEqual(fsclock.offset(paths.DATA), 0.0)
            self.assertFalse(fsclock.trusted(paths.DATA))
            self.assertNotIn("now", decks.tail(key, {}))             # no page compacts on this round
        time.sleep(fsclock.RETRY_SECONDS + 0.1)                      # tried again a second later
        self.assertAlmostEqual(fsclock.offset_nowait(paths.DATA), 0, delta=1)
        self.assertTrue(fsclock.trusted(paths.DATA))
        self.assertIn("now", decks.tail(key, {}))

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

    def test_config_timestamps_use_the_file_server_clock(self):
        with skewed(600):                                          # 10 min ahead
            cfg = store.replace_config_defaults(0, {"color": 1}, "u")
            self.assertAlmostEqual(cfg["updated"] / 1000.0, REAL_TIME(), delta=2)
        with skewed(-600):                                         # 10 min behind
            cfg = store.replace_config_defaults(1, {"color": 2}, "u")
            self.assertAlmostEqual(cfg["updated"] / 1000.0, REAL_TIME(), delta=2)
        # deck presence and `at` under skew: test_decks.test_6_clock_skew


if __name__ == "__main__":
    unittest.main()
