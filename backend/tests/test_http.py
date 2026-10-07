import base64
import http.client
import json
import os
import socket
import threading
import time
import unittest
import urllib.parse
from unittest import mock

from sbtest import TempDirs, make_png, make_xlsx_bytes

from slidebuilder import APP_NAME, VERSION, paths, server, store, workbooks
from test_exports import FakeEngine

TOKEN = "test-token-123"


class FakeExporter(FakeEngine):
    engines = []

    def status(self):
        return {"state": "unavailable", "browser": None, "local": False, "error": "", "engines": []}

    def restart(self):
        self.restarted = True

    def stop(self):
        pass


class HttpBase(TempDirs):
    """a helper on a free port with a fake export engine (also used by test_fonts.py)"""

    def setUp(self):
        super().setUp()
        self.app_file = os.path.join(self.tmp, "slide_builder.html")
        with open(self.app_file, "w", encoding="utf-8") as f:
            f.write("<html><script>const T='__SB_TOKEN__';</script><meta name=t content=\"__SB_TOKEN__\"></html>")
        self._app_file = mock.patch.object(paths, "APP_FILE", self.app_file)
        self._app_file.start()
        self.httpd = server.make_server(0, server.App(token=TOKEN, engine=FakeExporter()))
        self.port = self.httpd.app.port
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self._app_file.stop()
        super().tearDown()

    # ---- helpers
    def req(self, method, path, body=None, headers=None, token=True):
        h = {}
        if token:
            h["X-SB-Token"] = TOKEN
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            c.request(method, path, body=body, headers=h)
            r = c.getresponse()
            data = r.read()
            return r.status, dict((k.lower(), v) for k, v in r.getheaders()), data
        finally:
            c.close()

    def jreq(self, method, path, body=None, **kw):
        st, h, data = self.req(method, path, body, **kw)
        return st, (json.loads(data) if data and h.get("content-type", "").startswith("application/json") else data)

    @staticmethod
    def wb(name):
        return "/api/workbooks/" + urllib.parse.quote(name, safe="")


class HttpTests(HttpBase):
    # ---- security
    def test_ping_needs_no_token(self):
        self.assertEqual(self.jreq("GET", "/api/ping", token=False), (200, {"app": APP_NAME, "version": VERSION}))

    def test_wrong_host_is_refused(self):
        for host in ("evil.example:%d" % self.port, "127.0.0.1", "127.0.0.1:1", "attacker.localhost:%d" % self.port):
            st, _ = self.jreq("GET", "/api/health", headers={"Host": host})
            self.assertEqual(st, 403, host)
        st, _ = self.jreq("GET", "/", headers={"Host": "rebind.example:%d" % self.port})
        self.assertEqual(st, 403)
        st, _ = self.jreq("GET", "/api/ping", headers={"Host": "rebind.example:%d" % self.port}, token=False)
        self.assertEqual(st, 403)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Host": "localhost:%d" % self.port})[0], 200)

    def test_token_required(self):
        for path in ("/api/health", "/api/config", "/files/A.xlsx", "/assets/logo.png", self.wb("A.xlsx") + "/doc"):
            self.assertEqual(self.jreq("GET", path, token=False)[0], 403, path)
            self.assertEqual(self.jreq("GET", path, token=False, headers={"X-SB-Token": "wrong"})[0], 403, path)
        st, body = self.jreq("POST", "/api/export", {"slides": ["x"]}, token=False, headers={"Content-Type": "text/plain"})
        self.assertEqual(st, 403)
        self.assertEqual(body, {"error": "forbidden (token)"})
        self.assertFalse(os.path.exists(paths.EXPORT_DIR) and os.listdir(paths.EXPORT_DIR))

    def test_origin(self):
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.jreq("POST", "/api/presence", {"client": "c"}, headers={"Origin": "http://127.0.0.1:1"})[0], 403)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "http://127.0.0.1:%d" % self.port})[0], 200)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "http://localhost:%d" % self.port})[0], 200)

    def test_body_limit(self):
        s = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        try:
            s.sendall(("POST /api/config/ops HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-SB-Token: %s\r\n"
                       "Content-Type: application/json\r\nContent-Length: %d\r\n\r\n" % (self.port, TOKEN, 3 * 1024 * 1024)).encode())
            resp = b""
            while True:
                chunk = s.recv(65536)
                if not chunk:
                    break
                resp += chunk
        finally:
            s.close()
        self.assertTrue(resp.startswith(b"HTTP/1.0 413"), resp[:80])
        self.assertNotIn(b"Traceback", resp)

    def test_bad_json_and_no_tracebacks(self):
        st, body = self.jreq("POST", self.wb("A.xlsx") + "/ops", b"{nope", headers={"Content-Type": "application/json"})
        self.assertEqual((st, body), (400, {"error": "invalid JSON"}))
        st, body = self.jreq("POST", self.wb("A.xlsx") + "/ops", {"ops": "x"})
        self.assertEqual(st, 400)
        st, body = self.jreq("GET", "/api/nope")
        self.assertEqual((st, body), (404, {"error": "not found"}))

    # ---- page
    def test_page_has_token_injected(self):
        st, h, data = self.req("GET", "/", token=False)
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("text/html"))
        self.assertEqual(data.count(TOKEN.encode()), 2)
        self.assertNotIn(b"__SB_TOKEN__", data)
        self.assertEqual(h["cache-control"], "no-store")

    def test_page_missing_explains_build(self):
        os.remove(self.app_file)
        st, h, data = self.req("GET", "/", token=False)
        self.assertEqual(st, 503)
        self.assertIn(b"npm run build", data)

    # ---- health / me / config
    def test_health_and_me(self):
        st, body = self.jreq("GET", "/api/health")
        self.assertEqual(st, 200)
        self.assertEqual((body["app"], body["version"], body["user"], body["host"]), (APP_NAME, VERSION, "tester", "pc1"))
        self.assertEqual((body["folder"], body["export"]), (paths.ROOT, paths.EXPORT_DIR))
        self.assertEqual(set(body["engine"]), {"state", "browser", "local", "error", "engines"})
        st, me = self.jreq("GET", "/api/me")
        self.assertEqual(me, {"user": "tester", "host": "pc1", "prefs": {"lastFile": None, "pdfMode": None, "zoom": None}})
        self.assertEqual(self.jreq("PUT", "/api/me", {"prefs": {"lastFile": "A.xlsx", "zoom": 0.8}}), (200, {"ok": True}))
        self.assertEqual(self.jreq("GET", "/api/me")[1]["prefs"], {"lastFile": "A.xlsx", "pdfMode": None, "zoom": 0.8})
        self.assertEqual(self.jreq("PUT", "/api/me", {"prefs": [1]})[0], 400)

    def test_config(self):
        st, cfg = self.jreq("GET", "/api/config")
        self.assertEqual((st, cfg["rev"], cfg["defaults"]), (200, 0, {"style": {}}))
        st, r = self.jreq("POST", "/api/config/ops", {"ops": [{"op": "style.patch", "patch": {"design": "excel"}}, {"op": "preset.set", "preset": None}]})
        self.assertEqual((st, r["applied"], r["skipped"], r["doc"]["rev"]), (200, 1, [1], 1))
        self.assertEqual(self.jreq("GET", "/api/config")[1]["defaults"]["style"], {"design": "excel"})

    # ---- workbook documents
    def test_ops_and_since(self):
        name = "IBD weekly #1.xlsx"
        st, r = self.jreq("GET", self.wb(name) + "/doc")
        self.assertEqual((st, r["doc"]["rev"], r["doc"]["workbook"]), (200, 0, name))
        self.assertEqual(self.req("GET", self.wb(name) + "/doc?since=0")[0], 204)
        ops = [{"op": "cell.patch", "sheet": "Overview", "ref": "C7", "patch": {"text": "Totale", "orig": "TOTAL"}},
               {"op": "slide.patch", "id": "nope", "patch": {"title": "x"}}]
        st, r = self.jreq("POST", self.wb(name) + "/ops", {"ops": ops, "client": "c1"})
        self.assertEqual((st, r["applied"], r["skipped"], r["doc"]["rev"], r["doc"]["updatedBy"]), (200, 1, [1], 1, "tester"))
        st, h, data = self.req("GET", self.wb(name) + "/doc?since=1")
        self.assertEqual((st, data), (204, b""))
        st, r = self.jreq("GET", self.wb(name) + "/doc?since=0")
        self.assertEqual((st, r["doc"]["edits"]), (200, {"Overview": {"C7": {"text": "Totale", "orig": "TOTAL"}}}))
        st, r = self.jreq("GET", self.wb(name) + "/history")
        self.assertEqual((st, [b["rev"] for b in r["backups"]]), (200, [1]))
        self.assertEqual(self.jreq("GET", self.wb(name) + "/doc?since=x")[0], 400)
        self.assertEqual(self.jreq("GET", "/api/workbooks/" + urllib.parse.quote("a/b.xlsx", safe="") + "/doc")[0], 400)

    def test_unreadable_doc_is_503_and_untouched(self):
        p = store.workbook_path("Bad.xlsx")
        os.makedirs(os.path.dirname(p))
        with open(p, "wb") as f:
            f.write(b"{torn")
        self.assertEqual(self.jreq("GET", self.wb("Bad.xlsx") + "/doc")[0], 503)
        st, body = self.jreq("POST", self.wb("Bad.xlsx") + "/ops", {"ops": [{"op": "style.patch", "patch": {"color": 1}}]})
        self.assertEqual(st, 503)
        self.assertIn("cannot be read", body["error"])
        with open(p, "rb") as f:
            self.assertEqual(f.read(), b"{torn")

    # ---- presence
    def test_presence_between_two_clients(self):
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "alice", "SLIDEBUILDER_HOST": "pcA"}):
            st, r = self.jreq("POST", "/api/presence", {"client": "ca", "workbook": "W.xlsx"})
            self.assertEqual((st, r), (200, {"others": []}))
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "bob", "SLIDEBUILDER_HOST": "pcB"}):
            st, r = self.jreq("POST", "/api/presence", {"client": "cb", "workbook": "W.xlsx"})
            self.assertEqual(st, 200)
            self.assertEqual([(o["user"], o["host"], o["client"], o["workbook"]) for o in r["others"]], [("alice", "pcA", "ca", "W.xlsx")])
            self.assertIsInstance(r["others"][0]["at"], int)
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "alice", "SLIDEBUILDER_HOST": "pcA"}):
            r = self.jreq("POST", "/api/presence", {"client": "ca", "workbook": None})[1]
            self.assertEqual([o["user"] for o in r["others"]], ["bob"])
            self.assertEqual(self.jreq("POST", "/api/presence/leave", {"client": "wrong"}), (200, {"ok": True}))
            self.assertTrue(os.path.exists(os.path.join(paths.DATA, "presence", "alice@pcA.json")))
            self.assertEqual(self.jreq("POST", "/api/presence/leave", {"client": "ca"}), (200, {"ok": True}))
            self.assertFalse(os.path.exists(os.path.join(paths.DATA, "presence", "alice@pcA.json")))
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "bob", "SLIDEBUILDER_HOST": "pcB"}):
            self.assertEqual(self.jreq("POST", "/api/presence", {"client": "cb", "workbook": "W.xlsx"})[1], {"others": []})
        # a heartbeat older than 25 s is not reported
        p = os.path.join(paths.DATA, "presence", "carol@pcC.json")
        with open(p, "w") as f:
            json.dump({"user": "carol", "host": "pcC", "client": "cc", "workbook": "W.xlsx", "at": int(time.time() * 1000) - 26000}, f)
        self.assertEqual(self.jreq("POST", "/api/presence", {"client": "cb", "workbook": "W.xlsx"})[1], {"others": []})
        self.assertEqual(self.jreq("POST", "/api/presence", {})[0], 400)

    # ---- files
    def test_files_listing_and_stable_read(self):
        data = make_xlsx_bytes()
        with open(os.path.join(paths.ROOT, "Book One.xlsx"), "wb") as f:
            f.write(data)
        st, r = self.jreq("GET", "/api/files")
        self.assertEqual(st, 200)
        self.assertEqual(r["folder"], paths.ROOT)
        row = next(w for w in r["workbooks"] if w["name"] == "Book One.xlsx")
        self.assertEqual((row["size"], row["rev"], row["updated"], row["updatedBy"]), (len(data), None, None, None))
        st, h, body = self.req("GET", "/files/" + urllib.parse.quote("Book One.xlsx"))
        self.assertEqual((st, body), (200, data))
        self.assertEqual(h["x-sb-size"], str(len(data)))
        self.assertAlmostEqual(float(h["x-sb-mtime"]), os.path.getmtime(os.path.join(paths.ROOT, "Book One.xlsx")), places=3)
        self.assertEqual(h["content-type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertEqual(self.req("GET", "/files/Missing.xlsx")[0], 404)
        for bad in ("/files/..%2F..%2Fetc%2Fpasswd", "/files/../slide_builder.py", "/files/slide_builder.py", "/files/%2Fetc%2Fpasswd"):
            self.assertIn(self.req("GET", bad)[0], (403, 404), bad)

    def test_incomplete_workbook_is_503(self):
        with open(os.path.join(paths.ROOT, "Half.xlsx"), "wb") as f:
            f.write(make_xlsx_bytes()[:-40])
        orig = workbooks.stable_read
        with mock.patch.object(server, "stable_read", lambda p: orig(p, attempts=2, delay=0.05)):
            st, body = self.jreq("GET", "/files/Half.xlsx")
        self.assertEqual(st, 503)
        self.assertIn("incomplete", body["error"])

    def test_assets(self):
        png = make_png()
        with open(os.path.join(paths.ROOT, "logo-root.png"), "wb") as f:
            f.write(png)
        st, h, body = self.req("GET", "/assets/logo-root.png?t=" + TOKEN, token=False)
        self.assertEqual((st, body, h["content-type"]), (200, png, "image/png"))
        self.assertEqual(self.req("GET", "/assets/logo-root.png?t=bad", token=False)[0], 403)
        self.assertEqual(self.req("GET", "/assets/slide_builder.py")[0], 403)
        self.assertEqual(self.req("GET", "/assets/..%2F..%2Fx.png")[0], 403)

    # ---- uploads, exports
    def test_upload_store_is_capped(self):
        ids = []
        for i in range(9):
            st, r = self.jreq("POST", "/api/upload?name=" + urllib.parse.quote("dir/B%d.xlsx" % i), b"data%d" % i)
            self.assertEqual((st, r["name"]), (200, "B%d.xlsx" % i))
            ids.append(r["id"])
            time.sleep(0.002)
        self.assertEqual(self.req("GET", "/api/upload/" + ids[0])[0], 404)
        st, _, body = self.req("GET", "/api/upload/" + ids[-1])
        self.assertEqual((st, body), (200, b"data8"))
        self.assertEqual(len(self.httpd.app.uploads), 8)

    def test_export_and_assemble(self):
        st, r = self.jreq("POST", "/api/export", {"name": "Deck.xlsx", "format": "pdf", "mode": "exact", "css": "", "slides": ["a", "b"], "names": ["A", "B"], "scale": 1})
        self.assertEqual((st, r["files"], r["engine"]), (200, ["Deck - slides.pdf"], "Fake"))
        png = "data:image/png;base64," + base64.b64encode(make_png()).decode()
        st, r = self.jreq("POST", "/api/assemble", {"name": "Deck.xlsx", "images": [png]})
        self.assertEqual((st, r), (200, {"ok": True, "files": ["Deck - slides.pdf"]}))
        self.assertEqual(self.jreq("POST", "/api/export", {"name": "Deck.xlsx", "slides": []})[0], 400)

    def test_export_without_engine_is_503(self):
        from slidebuilder.engines import Exporter
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_ENGINES": "none"}):
            self.httpd.app.engine = Exporter()
        self.assertEqual(self.httpd.app.engine.engines, [])
        st, r = self.jreq("POST", "/api/export", {"name": "Deck.xlsx", "slides": ["a"]})
        self.assertEqual(st, 503)
        self.assertIn("export engine", r["error"])

    def test_convert_is_501_off_windows(self):
        if os.name == "nt":
            self.skipTest("Windows converts for real")
        self.assertEqual(self.jreq("POST", "/api/convert?ext=emf", b"xx")[0], 501)
        self.assertEqual(self.jreq("POST", "/api/convert-workbook?name=a.xlsb", b"xx")[0], 501)


if __name__ == "__main__":
    unittest.main()
