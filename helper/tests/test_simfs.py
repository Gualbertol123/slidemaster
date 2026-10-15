"""SIMULATION aid (tools/loadtest.py): simfs adds latency to data-folder file operations only, and the
helper reports lock wait / write time in X-SB-Timing when asked to."""
import json
import os
import threading
import time
import urllib.request
from unittest import mock

from sbtest import TempDirs

from slidebuilder import fsclock, locks, presence, server, simfs, store, util


class SimFsTests(TempDirs):
    def tearDown(self):
        simfs.uninstall()
        fsclock.reset()
        super().tearDown()

    def test_counts_and_delays_only_data_folder_calls(self):
        simfs.install(0)
        self.assertIsNot(store.os, os)
        n0 = simfs.count()
        store.update_workbook("Book.xlsx", [{"op": "cell.patch", "sheet": "S", "ref": "A1", "patch": {"b": True}}])
        per_save = simfs.count() - n0
        self.assertGreaterEqual(per_save, 8)                     # lock, read, tmp, fsync, replace, backup, unlock...
        n1 = simfs.count()
        with util.open(os.path.join(self.root, "outside.txt"), "w") as f:     # not in the data folder
            f.write("x")
        self.assertEqual(simfs.count(), n1)
        fsclock.reset()
        simfs.install(20)
        n2, t0 = simfs.count(), time.perf_counter()
        store.update_workbook("Book.xlsx", [{"op": "cell.patch", "sheet": "S", "ref": "A2", "patch": {"b": True}}])
        elapsed = (time.perf_counter() - t0) * 1000
        ops2 = simfs.count() - n2                      # fewer than the first save: no backup is due yet
        self.assertGreaterEqual(ops2, 6)
        self.assertLess(ops2, per_save)
        self.assertGreater(elapsed, 0.75 * 20 * (ops2 - 2))      # every counted round trip was delayed
        t = store.last_timing()
        self.assertGreater(t["write_ms"], 0)
        self.assertGreaterEqual(t["fs_ops"], ops2 - 2)

    def test_deck_round_trips_as_04_counts_them(self):
        """04 §2.2: an append on an open handle is write + flush = 2 round trips; a tail is open + read per journal
        (+ the listing every 10 s and one stat of the snapshot)"""
        from slidebuilder import decks
        decks.reset()
        key, _ = decks.create_if_missing("Deck.xlsx")
        w = decks.new_writer()
        simfs.install(0)
        try:
            decks.append(key, w, {"w": w, "s": 1, "l": 1, "ops": []})   # opens the handle (and looks at the deck once)
            decks.tail(key, {})
            n0 = simfs.total()
            decks.append(key, w, {"w": w, "s": 2, "l": 2, "ops": []})
            self.assertEqual(simfs.total() - n0, 2)
            others = ["o%d@pc#abcdefg%s" % (i, "abcdefgh"[i]) for i in range(3)]
            for o in others:
                with open(os.path.join(decks.journal_dir(key), o + ".log"), "wb") as f:
                    f.write(decks.frame({"w": o, "s": 1, "l": 1, "ops": []}))
            decks._listings.pop(key, None)
            n1 = simfs.total()
            res = decks.tail(key, {})
            self.assertEqual(len(res["journals"]), 4)
            self.assertEqual(simfs.total() - n1, 2 * 4 + 1 + 1)           # 4 x (open + read), the listing, the snapshot stat
            n2 = simfs.total()
            decks.tail(key, {j: v["offset"] for j, v in res["journals"].items()})
            self.assertEqual(simfs.total() - n2, 2 * 4 + 1)                # listing (3 s) and folder (10 s) cached
            # a new page session: the journal is opened while the page debounces (prepare), its first append is 2 too
            w2 = decks.new_writer("bob")
            decks.prepare(key, w2)
            n3 = simfs.total()
            decks.append(key, w2, {"w": w2, "s": 1, "l": 3, "ops": []})
            self.assertEqual(simfs.total() - n3, 2)
        finally:
            decks.reset()

    def test_uninstall_restores_the_real_modules(self):
        simfs.install(0)
        simfs.uninstall()
        for mod in (store, locks, fsclock, presence, util):
            self.assertIs(mod.os, os)
            self.assertNotIn("open", mod.__dict__)

    def test_timing_header_only_when_enabled(self):
        httpd = server.make_server(0, server.App(token="t"))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def post():
            body = json.dumps({"ops": [{"op": "style.patch", "patch": {"color": 3}}], "client": "c"}).encode()
            req = urllib.request.Request("http://127.0.0.1:%d/api/workbooks/B.xlsx/ops" % httpd.app.port, body,
                                         {"X-SB-Token": "t", "Content-Type": "application/json"})
            with opener.open(req, timeout=10) as r:
                return r.headers.get("X-SB-Timing")
        try:
            with mock.patch.dict(os.environ):
                os.environ.pop("SLIDEBUILDER_TIMING", None)
                os.environ.pop("SLIDEBUILDER_SIM_FS_MS", None)
                self.assertIsNone(post())
                os.environ["SLIDEBUILDER_TIMING"] = "1"
                h = post()
            self.assertRegex(h, r"^lock_wait_ms=[0-9.]+;write_ms=[0-9.]+$")
        finally:
            httpd.shutdown()
            httpd.server_close()
