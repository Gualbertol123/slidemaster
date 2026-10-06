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
from test_http import FakeExporter


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

    def test_uninstall_restores_the_real_modules(self):
        simfs.install(0)
        simfs.uninstall()
        for mod in (store, locks, fsclock, presence, util):
            self.assertIs(mod.os, os)
            self.assertNotIn("open", mod.__dict__)

    def test_timing_header_only_when_enabled(self):
        httpd = server.make_server(0, server.App(token="t", engine=FakeExporter()))
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
