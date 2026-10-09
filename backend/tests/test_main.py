"""The entry point starts, answers /api/ping, and a second start detects the running helper."""
import json
import os
import socket
import subprocess
import sys
import time
import unittest
import unittest.mock
import urllib.request

from sbtest import BACKEND, TempDirs


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class EntryPointTests(TempDirs):
    def test_start_ping_and_second_start(self):
        port = free_port()
        env = dict(os.environ, SLIDEBUILDER_ENGINES="none", PYTHONUNBUFFERED="1")
        cmd = [sys.executable, os.path.join(BACKEND, "slide_builder.py"), "--port", str(port), "--no-browser"]
        p = subprocess.Popen(cmd, env=env, cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            body = None
            for _ in range(100):
                try:
                    with opener.open("http://127.0.0.1:%d/api/ping" % port, timeout=1) as r:
                        body = json.load(r)
                    break
                except OSError:
                    time.sleep(0.1)
            self.assertEqual(body, {"app": "slide-builder", "version": "3.0"})
            with self.assertRaises(urllib.error.HTTPError) as cm:
                opener.open("http://127.0.0.1:%d/api/health" % port, timeout=2)
            self.assertEqual(cm.exception.code, 403)
            second = subprocess.run(cmd, env=env, cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
            self.assertEqual(second.returncode, 0)
            self.assertIn(b"already running on port %d" % port, second.stdout)
            self.assertTrue(os.path.isdir(os.path.join(self.root, "export")))
            self.assertTrue(os.path.isdir(self.data))
        finally:
            p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
            p.stdout.close()


class AppWindowTests(unittest.TestCase):
    """B12: the app opens in an Edge app window (msedge --app=<url>), else in a browser tab"""

    def setUp(self):
        import tempfile
        from slidebuilder import main as m
        self.m = m
        self.tmp = tempfile.mkdtemp(prefix="sb-edge-")
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)

    def edge_in(self, base):
        p = os.path.join(self.tmp, base, "Microsoft", "Edge", "Application", "msedge.exe")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").close()
        return p

    def test_find_edge(self):
        none = lambda: None
        x86 = self.edge_in("pf86")
        env = {"PROGRAMFILES(X86)": os.path.join(self.tmp, "pf86"), "PROGRAMFILES": os.path.join(self.tmp, "pf")}
        self.assertEqual(self.m.find_edge(env, none), x86)
        pf = self.edge_in("pf")
        self.assertEqual(self.m.find_edge({"PROGRAMFILES": os.path.join(self.tmp, "pf")}, none), pf)
        # only in the App Paths registry key (e.g. installed elsewhere)
        reg = os.path.join(self.tmp, "elsewhere", "msedge.exe")
        os.makedirs(os.path.dirname(reg))
        open(reg, "w").close()
        self.assertEqual(self.m.find_edge({}, lambda: reg), reg)
        self.assertIsNone(self.m.find_edge({}, lambda: os.path.join(self.tmp, "gone.exe")))
        self.assertIsNone(self.m.find_edge({}, none))

    def test_open_app(self):
        calls, tabs = [], []
        self.assertEqual(self.m.open_app("http://127.0.0.1:8765/", edge="C:/edge/msedge.exe",
                                         popen=lambda args, **kw: calls.append(args), browser=tabs.append), "edge")
        self.assertEqual(calls, [["C:/edge/msedge.exe", "--app=http://127.0.0.1:8765/"]])
        self.assertEqual(tabs, [])

        def broken(args, **kw):
            raise OSError("blocked by policy")
        self.assertEqual(self.m.open_app("http://x/", edge="C:/edge/msedge.exe", popen=broken, browser=tabs.append), "browser")
        self.assertEqual(tabs, ["http://x/"])
        old = os.environ.get("SLIDEBUILDER_APP_WINDOW")
        os.environ["SLIDEBUILDER_APP_WINDOW"] = "0"
        try:
            self.assertEqual(self.m.open_app("http://y/", edge="C:/edge/msedge.exe", popen=lambda *a, **k: calls.append(a), browser=tabs.append), "browser")
        finally:
            if old is None:
                os.environ.pop("SLIDEBUILDER_APP_WINDOW")
            else:
                os.environ["SLIDEBUILDER_APP_WINDOW"] = old
        self.assertEqual(tabs, ["http://x/", "http://y/"])
        self.assertEqual(len(calls), 1)


class SelfTestTests(TempDirs):
    """--selftest reads every saved setup without writing and probes create/rename/delete in data/locks"""

    def selftest(self):
        env = dict(os.environ, SLIDEBUILDER_ENGINES="none")
        return subprocess.run([sys.executable, os.path.join(BACKEND, "slide_builder.py"), "--selftest"], env=env, cwd=BACKEND,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)

    def write(self, rel, obj):
        p = os.path.join(self.data, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f)
        return p

    def snapshot(self):
        out = {}
        for base, _d, files in os.walk(self.data):
            for f in files:
                with open(os.path.join(base, f), "rb") as fh:
                    out[os.path.relpath(os.path.join(base, f), self.data)] = fh.read()
        return out

    def test_passes_and_writes_nothing(self):
        self.write("config.json", {"schema": 3, "rev": 1, "defaults": {"style": {}}})
        self.write("workbooks/report.xlsx-1a2b.json", {"workbook": "report.xlsx", "rev": 2, "edits": {"S": {"A1": {"b": True}}}})  # an old format
        self.write("users/anna.json", {"lastFile": "report.xlsx"})
        os.makedirs(os.path.join(self.data, "locks"))
        before = self.snapshot()
        r = self.selftest()
        self.assertEqual(r.returncode, 0, r.stdout)
        r.stdout.decode("ascii")
        self.assertIn(b"3 saved setup(s) read", r.stdout)
        self.assertIn(b"accepts create, rename and delete", r.stdout)
        self.assertEqual(self.snapshot(), before)          # not converted, no probe file left

    def test_fails_on_unreadable_or_too_new(self):
        p = self.write("workbooks/new.xlsx-9f9f.json", {"schema": 99})
        with open(os.path.join(self.data, "workbooks", "bad.xlsx-0000.json"), "w") as f:
            f.write("{not json")
        r = self.selftest()
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn(b"new.xlsx-9f9f.json", r.stdout)
        self.assertIn(b"bad.xlsx-0000.json", r.stdout)
        with open(p) as f:
            self.assertEqual(json.load(f), {"schema": 99})

    def test_fails_when_the_folder_refuses_writes(self):
        from slidebuilder import selftest
        with unittest.mock.patch("os.replace", side_effect=PermissionError("denied")):
            problem = selftest._probe_folder()
        self.assertIn("cannot rename a file", problem)
        self.assertEqual([n for n in os.listdir(os.path.join(self.data, "locks"))], [])


if __name__ == "__main__":
    unittest.main()
