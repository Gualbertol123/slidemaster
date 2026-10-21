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

from slidebuilder import APP_NAME, VERSION, decks, paths, server, store, workbooks

TOKEN = "test-token-123"


class HttpBase(TempDirs):
    """a helper on a free port (also used by test_fonts.py)"""

    def setUp(self):
        super().setUp()
        self.app_file = os.path.join(self.tmp, "slide_builder.html")
        with open(self.app_file, "w", encoding="utf-8") as f:
            f.write("<html><script>const T='__SB_TOKEN__';</script><meta name=t content=\"__SB_TOKEN__\"></html>")
        self._app_file = mock.patch.object(paths, "APP_FILE", self.app_file)
        self._app_file.start()
        self.httpd = server.make_server(0, server.App(token=TOKEN))
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
    def test_a_stalled_request_does_not_hold_its_thread_for_ever(self):
        # audit SEC-4 (docs/next/AUDIT.md): no socket timeout - 40 connections that sent headers and no body were all
        # still held after 21 s (each a thread of the helper)
        self.assertTrue(server.Handler.timeout and server.Handler.timeout <= 120)
        with mock.patch.object(server.Handler, "timeout", 0.5):
            s = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            s.sendall(b"POST /api/config HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nContent-Length: 100\r\n\r\n" % self.port)
            t = time.time()
            try:
                while s.recv(4096):
                    pass
            except OSError:
                pass                                    # reset by the helper: closed too
            s.close()
            self.assertLess(time.time() - t, 5)

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
        for path in ("/api/health", "/api/config", "/files/A.xlsx", "/assets/logo.png", "/api/decks/A.xlsx-0123456789/snapshot"):
            self.assertEqual(self.jreq("GET", path, token=False)[0], 403, path)
            self.assertEqual(self.jreq("GET", path, token=False, headers={"X-SB-Token": "wrong"})[0], 403, path)
        st, body = self.jreq("POST", "/api/export-file?name=x.pdf", b"%PDF-1.7", token=False, headers={"Content-Type": "text/plain"})
        self.assertEqual(st, 403)
        self.assertEqual(body, {"error": "forbidden (token)"})
        self.assertFalse(os.path.exists(paths.EXPORT_DIR) and os.listdir(paths.EXPORT_DIR))

    def test_origin(self):
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.jreq("POST", "/api/presence", {"deck": "A.xlsx-0123456789", "client": "c"}, headers={"Origin": "http://127.0.0.1:1"})[0], 403)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "http://127.0.0.1:%d" % self.port})[0], 200)
        self.assertEqual(self.jreq("GET", "/api/health", headers={"Origin": "http://localhost:%d" % self.port})[0], 200)

    def test_body_limit(self):
        s = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        try:
            s.sendall(("POST /api/config HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-SB-Token: %s\r\n"
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
        st, body = self.jreq("POST", "/api/decks/open", b"{nope", headers={"Content-Type": "application/json"})
        self.assertEqual((st, body), (400, {"error": "invalid JSON"}))
        st, body = self.jreq("POST", "/api/config", {"baseRev": "x"})
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
        self.assertEqual(set(body), {"app", "version", "user", "host", "folder", "export"})     # no "engine" since 3.8 (B1)
        st, me = self.jreq("GET", "/api/me")
        self.assertEqual(me, {"user": "tester", "host": "pc1", "prefs": {"lastFile": None, "pdfMode": None, "zoom": None}})
        self.assertEqual(self.jreq("PUT", "/api/me", {"prefs": {"lastFile": "A.xlsx", "zoom": 0.8}}), (200, {"ok": True}))
        self.assertEqual(self.jreq("GET", "/api/me")[1]["prefs"], {"lastFile": "A.xlsx", "pdfMode": None, "zoom": 0.8})
        self.assertEqual(self.jreq("PUT", "/api/me", {"prefs": [1]})[0], 400)

    def test_config(self):
        st, cfg = self.jreq("GET", "/api/config")
        self.assertEqual((st, cfg["rev"], cfg["defaults"]), (200, 0, {"style": {}}))
        st, r = self.jreq("POST", "/api/config", {"baseRev": 0, "style": {"design": "excel"}})
        self.assertEqual((st, r["doc"]["rev"], r["doc"]["updatedBy"]), (200, 1, "tester"))
        self.assertEqual(self.jreq("GET", "/api/config")[1]["defaults"], {"style": {"design": "excel"}})
        st, r = self.jreq("POST", "/api/config", {"baseRev": 0, "style": {"design": "glass"}})
        self.assertEqual((st, r["doc"]["rev"], r["doc"]["defaults"]["style"]), (409, 1, {"design": "excel"}))   # read again, redo
        self.assertEqual(self.jreq("POST", "/api/config", {"baseRev": 1})[0], 400)
        # only defaults.style: anything else the page sends is not written (v3 let a page change only that, too)
        st, r = self.jreq("POST", "/api/config", {"baseRev": 1, "style": {"design": "glass"}, "defaults": {"other": 1}})
        self.assertEqual((st, r["doc"]["defaults"]), (200, {"style": {"design": "glass"}}))

    def test_config_keeps_a_consulting_design(self):
        """M7b (08 §3): the helper stores a design it does not know as it is, with its per-design settings"""
        style = {"design": "mckinsey", "designs": {"mckinsey": {"colors": {"accent": "#0A2A66"}}, "bain": {"theme": {"id": "ocean"}}}}
        st, r = self.jreq("POST", "/api/config", {"baseRev": 0, "style": style})
        self.assertEqual((st, r["doc"]["defaults"]["style"]), (200, style))
        self.assertEqual(self.jreq("GET", "/api/config")[1]["defaults"], {"style": style})

    def test_v3_storage_routes_are_gone(self):
        """S5.5: v3's workbook documents, their operations and v3 presence are no longer served (decks: /api/decks)"""
        for method, path, body in (("GET", self.wb("A.xlsx") + "/doc", None), ("POST", self.wb("A.xlsx") + "/ops", {"ops": []}),
                                   ("GET", self.wb("A.xlsx") + "/history", None), ("POST", "/api/config/ops", {"ops": []})):
            self.assertEqual(self.jreq(method, path, body)[0], 404, path)
        self.assertEqual(self.jreq("POST", "/api/presence", {"client": "c", "workbook": "W.xlsx"})[0], 400)    # a deck is needed

    # ---- presence (per deck)
    def test_presence_between_two_clients(self):
        key = self.jreq("POST", "/api/decks/open", {"workbook": "W.xlsx"})[1]["key"]
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "alice", "SLIDEBUILDER_HOST": "pcA"}):
            st, r = self.jreq("POST", "/api/presence", {"deck": key, "client": "ca"})
            self.assertEqual((st, r), (200, {"others": []}))
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "bob", "SLIDEBUILDER_HOST": "pcB"}):
            st, r = self.jreq("POST", "/api/presence", {"deck": key, "client": "cb"})
            self.assertEqual(st, 200)
            self.assertEqual([(o["user"], o["host"], o["client"]) for o in r["others"]], [("alice", "pcA", "ca")])
            self.assertIsInstance(r["others"][0]["at"], int)
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "alice", "SLIDEBUILDER_HOST": "pcA"}):
            self.assertEqual(self.jreq("POST", "/api/presence/leave", {"deck": key, "client": "ca"}), (200, {"ok": True}))
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "bob", "SLIDEBUILDER_HOST": "pcB"}):
            self.assertEqual(self.jreq("POST", "/api/presence", {"deck": key, "client": "cb"})[1], {"others": []})
        self.assertEqual(self.jreq("POST", "/api/presence", {"deck": key})[0], 400)

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

    def test_burst_of_connections_is_not_refused(self):
        """a page asks for fonts, pictures and a save at once: no connection may wait for a TCP retry (>= 1 s)"""
        import socket
        import threading
        took = []

        def one():
            t = time.time()
            s = socket.create_connection(("127.0.0.1", self.port), timeout=30)
            s.sendall(b"GET /api/ping HTTP/1.0\r\nHost: 127.0.0.1:%d\r\n\r\n" % self.port)
            s.recv(1000)
            s.close()
            took.append(time.time() - t)
        threads = [threading.Thread(target=one) for _ in range(60)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(took), 60)
        self.assertLess(max(took), 0.9, "a connection waited for a SYN retry: the listen backlog is too small")

    def test_file_stat(self):
        """GET /api/files/<name>/stat: one stat for the changed-on-disk banner, no deck document read (B13)"""
        data = make_xlsx_bytes()
        p = os.path.join(paths.ROOT, "Book One.xlsx")
        with open(p, "wb") as f:
            f.write(data)
        with mock.patch.object(workbooks, "read_workbook", side_effect=AssertionError("no deck read")):
            st, r = self.jreq("GET", "/api/files/" + urllib.parse.quote("Book One.xlsx") + "/stat")
        self.assertEqual(st, 200)
        self.assertEqual((r["name"], r["size"]), ("Book One.xlsx", len(data)))
        self.assertAlmostEqual(r["mtime"], os.path.getmtime(p), places=3)
        self.assertEqual(self.jreq("GET", "/api/files/Missing.xlsx/stat")[0], 404)
        for bad in ("/api/files/..%2F..%2Fetc%2Fpasswd/stat", "/api/files/slide_builder.py/stat", "/api/files/%2Fetc%2Fhosts.xlsx/stat",
                    "/api/files/..%2Fx.xlsx/stat"):
            self.assertIn(self.jreq("GET", bad)[0], (403, 404), bad)
        with mock.patch.object(workbooks.os, "stat", side_effect=OSError(64, "The specified network name is no longer available")):
            st, r = self.jreq("GET", "/api/files/" + urllib.parse.quote("Book One.xlsx") + "/stat")
        self.assertEqual(st, 503)                                     # "try again", not a 500 with a traceback
        os.makedirs(os.path.join(paths.ROOT, "Folder.xlsx"))
        self.assertEqual(self.jreq("GET", "/api/files/Folder.xlsx/stat")[0], 404)
        self.assertEqual(self.jreq("GET", "/api/files/" + urllib.parse.quote("Book One.xlsx") + "/stat", token=False)[0], 403)

    def test_fieldcheck_page(self):
        """the field-test page (PLAN S0.6) from the helper, without a token, like the app page"""
        st, h, body = self.req("GET", "/fieldcheck", token=False)
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("text/html"))
        self.assertIn(b"Slide Builder field check", body)

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

    def test_engine_routes_are_gone(self):
        """B1: the page writes PDFs and PNGs itself; the old export engine and its routes are removed"""
        for method, path, body in (("POST", "/api/export", {"name": "Deck.xlsx", "slides": ["a"]}),
                                   ("POST", "/api/assemble", {"name": "Deck.xlsx", "images": []}),
                                   ("GET", "/api/engine/install", None), ("POST", "/api/engine/install", {}),
                                   ("POST", "/api/engine/restart", {})):
            self.assertEqual(self.jreq(method, path, body)[0], 404, path)
        self.assertFalse(os.path.exists(paths.EXPORT_DIR) and os.listdir(paths.EXPORT_DIR))

    def test_export_file(self):
        pdf = b"%PDF-1.7\n%native\n%%EOF\n"
        st, r = self.jreq("POST", "/api/export-file?name=" + urllib.parse.quote("Deck - Chief - Liquid Glass.pdf"), pdf)
        self.assertEqual((st, r), (200, {"ok": True, "files": ["Deck - Chief - Liquid Glass.pdf"]}))
        with open(os.path.join(paths.EXPORT_DIR, "Deck - Chief - Liquid Glass.pdf"), "rb") as f:
            self.assertEqual(f.read(), pdf)
        st, r = self.jreq("POST", "/api/export-file?name=Deck%20-%20Cover.png", make_png())
        self.assertEqual((st, r["files"]), (200, ["Deck - Cover.png"]))
        self.assertEqual(self.jreq("POST", "/api/export-file?name=x.js", b"%PDF-")[0], 400)
        self.assertEqual(self.jreq("POST", "/api/export-file?name=x.pdf", b"<html>")[0], 400)
        self.assertEqual(self.jreq("POST", "/api/export-file?name=x.pdf", pdf, token=False)[0], 403)

    def test_export_feedback(self):
        st, r = self.jreq("POST", "/api/export-feedback", {"what": "P3 look", "slide": 2, "comment": "Rahmen fehlt"})
        self.assertEqual(st, 200)
        self.assertRegex(r["file"], r"^feedback/\d{8}-\d{6}-.+\.json$")
        with open(os.path.join(paths.EXPORT_DIR, *r["file"].split("/")), encoding="utf-8") as f:
            doc = json.load(f)
        self.assertEqual((doc["kind"], doc["version"], doc["report"]["comment"]), ("export-feedback", VERSION, "Rahmen fehlt"))
        self.assertEqual(self.jreq("POST", "/api/export-feedback", [1, 2])[0], 400)
        self.assertEqual(self.jreq("POST", "/api/export-feedback", {"a": 1}, token=False)[0], 403)

    def test_convert_is_501_off_windows(self):
        if os.name == "nt":
            self.skipTest("Windows converts for real")
        self.assertEqual(self.jreq("POST", "/api/convert?ext=emf", b"xx")[0], 501)
        self.assertEqual(self.jreq("POST", "/api/convert-workbook?name=a.xlsb", b"xx")[0], 501)


class DeckFormatHttpTests(HttpBase):
    """ADR-019 over HTTP: a 4.0-4.5 page left open while its PC's helper was restarted on 4.6 gets 403 for its old token
    (the token is random per process); were its token valid, the deck formats header is the second wall"""

    NEW = {"X-SB-Deck-Formats": "4,5"}

    def setUp(self):
        super().setUp()
        decks.reset()

    def tearDown(self):
        decks.reset()
        super().tearDown()

    def open(self, headers=None):
        st, r = self.jreq("POST", "/api/decks/open", {"workbook": "W.xlsx"}, headers=headers or self.NEW)
        self.assertEqual(st, 200, r)
        return r

    def test_a_page_without_the_header_is_refused_on_a_format_5_deck_only(self):
        r = self.open({})                                            # a format-4 deck: old pages keep working (CP-02)
        key, w = r["key"], r["writer"]
        base = "/api/decks/" + key
        self.assertEqual(r["snapshot"]["format"], 4)
        self.assertEqual(self.jreq("POST", base + "/append", {"writer": w, "record": {"w": w, "s": 1, "l": 1, "ops": []}})[0], 200)
        self.assertEqual(self.jreq("GET", base + "/tail?since={}")[0], 200)
        # the 4.6 page raises the deck
        st, m = self.jreq("POST", base + "/format5", {}, headers=self.NEW)
        self.assertEqual((st, m["created"]), (200, True))
        self.assertTrue(os.path.exists(decks.deck_dir(key, decks.MARKER5)))
        snap = self.jreq("GET", base + "/snapshot", headers=self.NEW)[1]["snapshot"]
        up = {"baseGen": 1, "snapshot": dict(snap, gen=2, format=5)}
        st, e = self.jreq("POST", base + "/compact", up, headers=self.NEW)
        self.assertEqual(st, 409, e)                                      # the marker is younger than the bump's wait
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            self.assertEqual(self.jreq("POST", base + "/compact", up, headers=self.NEW), (200, {"gen": 2, "dropped": []}))
        # a page without the header, with a valid token: 409 "reload" for everything it would do
        cur = self.jreq("GET", base + "/snapshot", headers=self.NEW)[1]["snapshot"]
        calls = [("POST", base + "/append", {"writer": w, "record": {"w": w, "s": 2, "l": 2, "ops": []}}),
                 ("POST", base + "/prepare", {"writer": w}),
                 ("POST", base + "/compact", {"baseGen": 2, "snapshot": dict(cur, gen=3, format=4)}),
                 ("POST", base + "/compact", {"baseGen": 2, "snapshot": dict(cur, gen=3)}),
                 ("POST", base + "/rotate", {"writer": w}),
                 ("GET", base + "/tail?since={}", None),
                 ("GET", base + "/snapshot", None),
                 ("POST", "/api/decks/open", {"workbook": "W.xlsx"})]
        for method, path, body in calls:
            for headers in ({}, {"X-SB-Deck-Formats": "4"}):
                st, e = self.jreq(method, path, body, headers=headers)
                self.assertEqual(st, 409, (path, headers, e))
                self.assertIn("reload the page", e["error"])
        self.assertEqual(decks.read_snapshot(key)["gen"], 2)            # nothing it sent was taken
        self.assertEqual([r["s"] for r in decks.tail(key, {})["journals"][w]["records"]], [1])
        # the new page: everything as before; a compaction that would lower the format is refused
        self.assertEqual(self.jreq("POST", base + "/append", {"writer": w, "record": {"w": w, "s": 2, "l": 2, "ops": []}}, headers=self.NEW)[0], 200)
        self.assertEqual(self.jreq("GET", base + "/tail?since={}", headers=self.NEW)[1]["gen"], 2)
        st, e = self.jreq("POST", base + "/compact", {"baseGen": 2, "snapshot": dict(cur, gen=3, format=4)}, headers=self.NEW)
        self.assertEqual(st, 400)
        self.assertIn("4.6", e["error"])
        self.assertEqual(self.open()["snapshot"]["format"], 5)
        st, m = self.jreq("POST", base + "/format5", {}, headers=self.NEW)
        self.assertEqual((st, m["created"]), (200, False))
        self.assertEqual([(d["key"], d["format"]) for d in self.jreq("GET", "/api/decks")[1]["decks"]], [(key, 5)])

    def test_an_old_token_is_refused_first(self):
        key = self.open()["key"]
        st, _ = self.jreq("POST", "/api/decks/%s/append" % key, {"writer": "a@b#abcdefgh", "record": {}}, token=False, headers={"X-SB-Token": "the-token-of-the-helper-before-the-restart"})
        self.assertEqual(st, 403)

    def test_format5_of_a_missing_deck(self):
        self.assertEqual(self.jreq("POST", "/api/decks/Nope.xlsx-0123456789/format5", {}, headers=self.NEW)[0], 404)


if __name__ == "__main__":
    unittest.main()
