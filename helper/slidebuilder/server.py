"""HTTP API (ARCHITECTURE §10) on 127.0.0.1.

Security for every request (findings S1-S5):
* ``Host`` must be ``127.0.0.1:<port>`` or ``localhost:<port>``                 -> else 403
* ``/api/*`` (except ``/api/ping``), ``/files/*``, ``/assets/*``, ``/fonts/*`` and ``/sysfonts*`` need ``X-SB-Token``
  (``/assets/*`` and ``/fonts/*`` may pass ``?t=`` instead)                      -> else 403
* an ``Origin`` header, when present, must be ``http://127.0.0.1:<port>`` / ``http://localhost:<port>``
* bodies: 2 MB for JSON documents/ops (32 MB for a deck snapshot), 300 MB for uploads/exports/conversions -> else 413
* error bodies are ``{"error": "<message>"}`` without tracebacks
"""
import hmac
import json
import os
import re
import secrets
import threading
import time
import traceback
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import APP_NAME, VERSION, deckbin, decks, migrate_v3, paths, store
from .convert import convert_picture, convert_workbook
from .exports import ExportError, export_feedback, export_file
from .fonts import FONT_MAX, FontError, add_face, font_file, read_library, remove_family
from .gfonts import GFontError, face_file as google_font_file, family_faces as google_font, preview as google_preview, preview_type
from .sysfonts import SysFontError, capture as capture_sysfont, list_fonts as list_sysfonts, read_font as read_sysfont
from .locks import LockTimeout
from .store import StoreTooNew, StoreUnreadable
from .util import WriteFailed, current_host, current_user, log, open_with_os, safe_component, safe_path, valid_workbook_name, write_atomic
from .workbooks import Unstable, find_workbook, list_workbooks, stable_read, stat_workbook

JSON_LIMIT = 2 * 1024 * 1024
SNAPSHOT_LIMIT = 32 * 1024 * 1024
BIG_LIMIT = 300 * 1024 * 1024
UPLOAD_MAX = 8
UPLOAD_TTL = 2 * 3600
TOKEN_PLACEHOLDER = b"__SB_TOKEN__"
TOKEN_HEADER = "X-SB-Token"
FORMATS_HEADER = "X-SB-Formats"
DECK_FORMATS_HEADER = "X-SB-Deck-Formats"      # "4,5": the deck snapshot formats a 4.6+ page reads (ADR-019); "4,5,6": 4.9+; "4,5,6,7": 4.10+; "4,5,6,7,8": 4.11+; "4,5,6,7,8,9": 4.13+; "4,5,6,7,8,9,10": 4.14+


def formats_match(header):
    """X-SB-Formats: workbook=3;config=3;prefs=1 - the data formats the page was built for"""
    if not header:
        return True
    from .upgrade import SCHEMA
    try:
        page = dict((k.strip(), int(v)) for k, v in (x.split("=", 1) for x in header.split(";") if x.strip()))
    except ValueError:
        return True
    return all(page.get(k, v) == v for k, v in SCHEMA.items())
IMAGE_EXT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
             ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon"}
WORKBOOK_TYPES = {".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  ".xlsb": "application/octet-stream", ".xls": "application/vnd.ms-excel",
                  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12"}

NOT_BUILT = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slide Builder</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,sans-serif;margin:60px auto;max-width:640px;color:#1d1d1f;padding:0 16px}
code{background:#f2f2f5;padding:2px 6px;border-radius:4px}</style></head><body>
<h1>Slide Builder has not been built</h1>
<p>The app file <code>helper/slide_builder.html</code> is missing. It is generated from the
<code>app</code> folder. On a developer machine run:</p>
<p><code>cd app &amp;&amp; npm run build</code></p>
<p>then reload this page. The helper itself is running.</p></body></html>"""


LOGO_MAX = 10 * 1024 * 1024


def asset_dirs():
    """where pictures such as the logo are looked for: data/assets (chosen in the app), backend, the main folder"""
    return [paths.data_dir("assets"), paths.HOME_BACKEND, paths.ROOT]


def find_asset(name):
    """the file for an asset name: exact, then by file name only (\"backend\\logo.png\" works too), then ignoring
    upper/lower case (a file copied as LOGO.PNG on a share); None when there is none"""
    base = os.path.basename(name.replace("\\", "/"))
    for d in asset_dirs():
        for cand in (name, base):
            try:
                p = safe_path(cand, d)
            except PermissionError:
                continue
            if os.path.isfile(p):
                return p
        try:
            hit = next((n for n in os.listdir(d) if n.lower() == base.lower()), None)
        except OSError:
            hit = None
        if hit and os.path.isfile(os.path.join(d, hit)):
            return os.path.join(d, hit)
    return None


DECK_ROUTE = re.compile(r"^/api/decks/([^/]+)/(snapshot|tail|append|prepare|compact|rotate|history|delete|format5|format6|format7|format8|format9|format10)$")


class HttpError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


_idle_closer = []


def _start_idle_closer():
    """deck journals: append handles nobody used for 10 minutes are closed (decks.IDLE_CLOSE); one thread per process"""
    if _idle_closer:
        return

    def loop():
        while True:
            time.sleep(60)
            try:
                decks.close_idle()
            except Exception as e:             # noqa: BLE001 - never stop the thread
                log("closing idle deck handles: %s" % e)
    t = threading.Thread(target=loop, daemon=True, name="deck-handles")
    _idle_closer.append(t)
    t.start()


class App:
    """State of one running helper: port, token, uploads kept in memory."""

    def __init__(self, token=None):
        self.token = token or secrets.token_urlsafe(24)
        self.port = None
        self.uploads = {}                  # id -> (name, bytes, time)
        self.uploads_lock = threading.Lock()
        _start_idle_closer()

    # ---- uploads (S4: max 8 entries, 2 h)
    def put_upload(self, name, data):
        uid = uuid.uuid4().hex
        with self.uploads_lock:
            now = time.time()
            for k in [k for k, v in self.uploads.items() if now - v[2] > UPLOAD_TTL]:
                self.uploads.pop(k, None)
            self.uploads[uid] = (name, data, now)
            while len(self.uploads) > UPLOAD_MAX:
                oldest = min(self.uploads, key=lambda k: self.uploads[k][2])
                self.uploads.pop(oldest, None)
        return uid

    def get_upload(self, uid):
        with self.uploads_lock:
            v = self.uploads.get(uid)
            if v and time.time() - v[2] > UPLOAD_TTL:
                self.uploads.pop(uid, None)
                v = None
            return v


class Handler(BaseHTTPRequestHandler):
    server_version = "SlideBuilder/" + VERSION
    # a connection that stops sending (a request or body that never completes) is dropped after a minute instead of
    # holding its thread for ever (audit SEC-4; every request here is one short exchange, uploads arrive steadily)
    timeout = 60
    # HTTP/1.0 (one request per connection); a refused request's body is read before the answer (_drain): closing a
    # socket with unread data makes Windows reset the connection, and the client may never see the answer

    def log_message(self, fmt, *args):
        pass

    @property
    def app(self):
        return self.server.app

    # ------------------------------------------------------------------ responses
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        if code != 204:
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        try:
            self.end_headers()
            if self.command != "HEAD" and code != 204:
                self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True               # the page was closed or reloaded meanwhile

    def _error(self, code, msg):
        self._drain()
        self._send(code, {"error": msg})

    # ------------------------------------------------------------------ request bodies
    def _body(self, limit):
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            self.close_connection = True
            raise HttpError(411, "Content-Length required")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.close_connection = True
            raise HttpError(400, "bad Content-Length")
        if n < 0:
            self.close_connection = True
            raise HttpError(400, "bad Content-Length")
        if n > limit:
            self.close_connection = True               # the body is not read: the connection cannot be reused
            raise HttpError(413, "request too large (limit %d MB)" % (limit // (1024 * 1024)))
        self._consumed = True
        return self.rfile.read(n) if n else b""

    def _drain(self):
        """read a body the request handler never read (it was refused first), up to the JSON limit"""
        if getattr(self, "_consumed", True):
            return
        self._consumed = True
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return
        if 0 < n <= JSON_LIMIT and "chunked" not in (self.headers.get("Transfer-Encoding") or "").lower():
            try:
                self.rfile.read(n)
            except OSError:
                pass

    def _json(self, limit=JSON_LIMIT):
        b = self._body(limit)
        if not b:
            return {}
        try:
            obj = json.loads(b.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HttpError(400, "invalid JSON")
        if not isinstance(obj, dict):
            raise HttpError(400, "a JSON object is expected")
        return obj

    # ------------------------------------------------------------------ security
    def _allowed_hosts(self):
        p = self.app.port
        return ("127.0.0.1:%d" % p, "localhost:%d" % p)

    def _guard(self, path, query):
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in self._allowed_hosts():
            raise HttpError(403, "forbidden (host)")
        origin = self.headers.get("Origin")
        if origin is not None and origin.strip().lower() not in tuple("http://" + h for h in self._allowed_hosts()):
            raise HttpError(403, "forbidden (origin)")
        if path == "/api/ping":
            return
        if path.startswith(("/api/", "/files/", "/assets/", "/fonts/", "/sysfonts")):
            tok = self.headers.get(TOKEN_HEADER) or ""
            if not tok and path.startswith(("/assets/", "/fonts/")):
                tok = (query.get("t") or [""])[0]
            if not tok or not hmac.compare_digest(tok.encode("utf-8"), self.app.token.encode("utf-8")):
                raise HttpError(403, "forbidden (token)")
        # a page loaded before an update speaks the old data formats: its changes are refused (the page
        # asks to reload). Pages without the header (built before formats were numbered) are accepted.
        if self.command in ("POST", "PUT", "DELETE") and path.startswith("/api/") and not formats_match(self.headers.get(FORMATS_HEADER)):
            raise HttpError(409, "Slide Builder was updated - reload the page (F5) to continue; your last change was not saved")

    # ------------------------------------------------------------------ dispatch
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def do_HEAD(self):
        self._dispatch("GET")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self._dispatch("OPTIONS")

    def _dispatch(self, method):
        self._consumed = False
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            self._guard(u.path, q)
            route = getattr(self, "_%s" % method.lower(), None)
            if route is None or route(u.path, q) is False:
                raise HttpError(404, "not found")
        except HttpError as e:
            self._error(e.code, str(e))
        except PermissionError:
            self._error(403, "forbidden")
        except FileNotFoundError:
            self._error(404, "not found")
        except migrate_v3.NotMigrated as e:
            self._error(e.status, str(e))
        except decks.DeckError as e:
            if e.status == 503:
                log("busy: %s" % e)
            self._drain()
            self._send(e.status, dict(e.extra, error=str(e)))
        except StoreTooNew as e:
            self._error(409, str(e))
        except (StoreUnreadable, WriteFailed, LockTimeout, Unstable) as e:
            log("busy: %s" % e)
            self._error(503, str(e))
        except (ExportError, FontError, SysFontError) as e:
            self._error(400, str(e))
        except GFontError as e:
            self._error(e.status, str(e))
        except Exception:
            traceback.print_exc()
            self._error(500, "internal error - details are in the Slide Builder window")

    # ------------------------------------------------------------------ GET
    def _get(self, path, q):
        if path in ("/", "/index.html", "/slide_builder.html"):
            return self._page()
        if path in ("/fieldcheck", "/fieldcheck.html"):            # field test page (PLAN S0.6), same origin as the app
            return self._fieldcheck()
        if path == "/api/ping":
            return self._send(200, {"app": APP_NAME, "version": VERSION})
        if path == "/api/health":
            health = {"app": APP_NAME, "version": VERSION, "user": current_user(), "host": current_host(),
                      "folder": paths.ROOT, "export": paths.EXPORT_DIR}
            if decks.TEST_BUMP_WAIT_S is not None:              # a test setting in effect (decks.TEST_BUMP_WAIT_ENV)
                health["testBumpWaitS"] = decks.TEST_BUMP_WAIT_S
            return self._send(200, health)
        if path == "/api/config":
            return self._send(200, store.read_config())
        if path == "/api/me":
            return self._send(200, {"user": current_user(), "host": current_host(), "prefs": store.read_prefs()})
        if path == "/api/files":
            return self._send(200, {"workbooks": list_workbooks(), "folder": paths.ROOT})
        if path.startswith("/api/files/") and path.endswith("/stat"):
            return self._send(200, stat_workbook(urllib.parse.unquote(path[len("/api/files/"):-len("/stat")])))
        if path == "/api/fonts":
            return self._send(200, read_library())
        if path == "/api/fonts/google":                   # a Google font's faces, fetched by the helper (not the page)
            return self._send(200, google_font((q.get("family") or [""])[0]))
        if path == "/api/fonts/google/file":              # one of its files (a google/fonts or fonts.gstatic.com file only)
            return self._send(200, google_font_file((q.get("ref") or [""])[0]), "application/octet-stream")
        if path == "/api/fonts/google/preview":           # a font to show a Google family's name in the picker (B46)
            data = google_preview((q.get("family") or [""])[0])
            return self._send(200, data, preview_type(data))
        if path.startswith("/fonts/"):
            data, ctype = font_file(urllib.parse.unquote(path[len("/fonts/"):]))
            return self._send(200, data, ctype)
        if path == "/sysfonts":                           # this PC's Windows fonts (the core lays out from files, S3.2)
            return self._send(200, {"fonts": list_sysfonts()})
        if path.startswith("/sysfonts/"):
            data, ctype = read_sysfont(urllib.parse.unquote(path[len("/sysfonts/"):]))
            return self._send(200, data, ctype)
        if path.startswith("/files/"):
            return self._workbook_file(urllib.parse.unquote(path[len("/files/"):]))
        if path.startswith("/assets/"):
            return self._asset(urllib.parse.unquote(path[len("/assets/"):]))
        if path.startswith("/api/upload/"):
            v = self.app.get_upload(path.rsplit("/", 1)[-1])
            if not v:
                return self._error(404, "upload expired, open the workbook again")
            return self._send(200, v[1], "application/octet-stream")
        if path == "/api/decks":                          # every deck (Options › Administration › Prepare rollback, Saved setups)
            return self._send(200, {"decks": migrate_v3.list_decks()})
        if path == "/api/decks/deleted":                  # the deleted setups, kept as backups (B44, deckbin.py)
            return self._send(200, {"deleted": deckbin.listing()})
        m = DECK_ROUTE.match(path)
        if m:
            key, action = urllib.parse.unquote(m.group(1)), m.group(2)
            if action == "snapshot":
                snap = decks.read_snapshot(key)
                decks.check_page(key, self._deck_formats(), snap)
                return self._send(200, {"snapshot": snap})
            if action == "tail":
                try:
                    since = json.loads((q.get("since") or ["{}"])[0])
                except ValueError:
                    raise HttpError(400, "since must be JSON")
                decks.check_page(key, self._deck_formats())
                return self._send(200, decks.tail(key, since))
            if action == "history":
                return self._send(200, {"backups": decks.history(key)})
            return False
        return False

    def _page(self):
        try:
            with open(paths.APP_FILE, "rb") as f:
                html = f.read()
        except OSError:
            return self._send(503, NOT_BUILT, "text/html; charset=utf-8")
        html = html.replace(TOKEN_PLACEHOLDER, self.app.token.encode("ascii"))
        return self._send(200, html, "text/html; charset=utf-8")

    def _fieldcheck(self):
        """tools/fieldcheck.html next to the program (a checkout or a release folder; 404 when absent)"""
        with open(os.path.join(os.path.dirname(paths.HELPER), "tools", "fieldcheck.html"), "rb") as f:
            return self._send(200, f.read(), "text/html; charset=utf-8")

    def _workbook_file(self, name):
        p = find_workbook(name)
        data, mtime, size = stable_read(p)
        ctype = WORKBOOK_TYPES.get(os.path.splitext(p)[1].lower(), "application/octet-stream")
        return self._send(200, data, ctype, {"X-SB-Mtime": repr(float(mtime)), "X-SB-Size": str(size)})

    def _asset(self, name):
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMAGE_EXT:
            raise PermissionError("not an image")
        if ".." in name.replace("\\", "/").split("/"):
            raise PermissionError("outside folder")
        p = find_asset(name)
        if not p:
            raise FileNotFoundError(name)
        with open(p, "rb") as f:
            data = f.read()
        return self._send(200, data, IMAGE_EXT[ext], {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})

    # ------------------------------------------------------------------ PUT
    def _put(self, path, q):
        if path == "/api/me":
            req = self._json()
            prefs = req.get("prefs")
            if not isinstance(prefs, dict):
                raise HttpError(400, "prefs must be an object")
            store.write_prefs(prefs)
            return self._send(200, {"ok": True})
        return False

    # ------------------------------------------------------------------ DELETE
    def _delete(self, path, q):
        if path == "/api/fonts":
            family = (q.get("family") or [""])[0]
            if not family:
                raise HttpError(400, "family is required")
            return self._send(200, remove_family(family))
        return False

    def _deck_formats(self):
        """the deck formats the page reads (X-SB-Deck-Formats; a 4.0-4.5 page sends none: decks.check_page)"""
        return decks.page_formats(self.headers.get(DECK_FORMATS_HEADER))

    # ------------------------------------------------------------------ POST
    def _post_deck(self, path):
        """the decks of Slide Builder 4 (docs/next/04 §2.2; helper/slidebuilder/decks.py)"""
        if path == "/api/decks/open":
            wb = self._json().get("workbook")
            if not valid_workbook_name(wb):
                raise HttpError(400, "invalid workbook name")
            # the first open in Slide Builder 4 moves a v3 deck over (migrate_v3: under v3's lock, backup, freeze)
            key, how = migrate_v3.ensure_deck(wb)
            snap = decks.read_snapshot(key)
            decks.check_page(key, self._deck_formats(), snap)      # a 4.0-4.5 page never opens a 4.6 deck (ADR-019)
            writer = decks.new_writer()
            decks.bind_writer(writer, key)                # (B44: a writer of a deck deleted since writes nothing)
            return self._send(200, {"key": key, "writer": writer, "created": how == "created", "migrated": how == "migrated",
                                    "storage": decks.storage_mode(), "snapshot": snap})
        if path == "/api/decks/restore":                  # a deleted setup back (B44)
            req = self._json()
            return self._send(200, deckbin.restore(req.get("id"), req.get("client")))
        m = DECK_ROUTE.match(path)
        if not m:
            return False
        key, action = urllib.parse.unquote(m.group(1)), m.group(2)
        if action in ("append", "prepare", "compact", "rotate"):
            decks.check_page(key, self._deck_formats())
        if action == "format5":                           # the deck is about to hold 4.6 objects: its marker (ADR-019)
            return self._send(200, decks.mark_format5(key))
        if action == "format6":                           # 4.9 objects: incident-format-6.json (ADR-019 amendment 2026-10-22)
            return self._send(200, decks.mark_format5(key, fmt=6))
        if action == "format7":                           # 4.10 objects (B52): incident-format-7.json (ADR-019 amendment)
            return self._send(200, decks.mark_format5(key, fmt=7))
        if action == "format8":                           # 4.11 objects (B53): incident-format-8.json (ADR-019 amendment)
            return self._send(200, decks.mark_format5(key, fmt=8))
        if action == "format9":                           # 4.13 objects (B54): incident-format-9.json (ADR-019 amendment)
            return self._send(200, decks.mark_format5(key, fmt=9))
        if action == "format10":                          # 4.14 objects (B55): incident-format-10.json (ADR-019 amendment)
            return self._send(200, decks.mark_format5(key, fmt=10))
        if action == "append":
            req = self._json()
            return self._send(200, decks.append(key, req.get("writer"), req.get("record")))
        if action == "prepare":
            return self._send(200, decks.prepare(key, self._json().get("writer")))
        if action == "compact":
            req = self._json(SNAPSHOT_LIMIT)
            return self._send(200, decks.compact(key, req.get("baseGen"), req.get("snapshot")))
        if action == "rotate":
            return self._send(200, decks.rotate(key, self._json().get("writer")))
        if action == "delete":                            # the setup deleted, kept as a backup (B44)
            return self._send(200, deckbin.delete(key, self._json().get("client")))
        return False

    def _post(self, path, q):
        if path.startswith("/api/decks/"):
            return self._post_deck(path)
        if path == "/api/config":                      # the shared defaults' style: compare-and-set on rev (the page computed it)
            req = self._json()
            base, style = req.get("baseRev"), req.get("style")
            if not isinstance(base, int) or isinstance(base, bool) or not isinstance(style, dict):
                raise HttpError(400, "baseRev and style are required")
            try:
                return self._send(200, {"doc": store.replace_config_defaults(base, style)})
            except store.ConfigConflict as e:
                return self._send(409, {"error": str(e), "doc": e.doc})
        if path == "/api/presence":                    # presence on a deck: {deck, client}
            req = self._json()
            return self._send(200, decks.heartbeat(req.get("deck"), req.get("client")))
        if path == "/api/presence/leave":
            req = self._json()
            return self._send(200, {"ok": decks.leave(req.get("deck"), req.get("client"))})
        if path == "/api/upload":
            name = os.path.basename((q.get("name") or ["workbook.xlsx"])[0].replace("\\", "/")) or "workbook.xlsx"
            uid = self.app.put_upload(name, self._body(BIG_LIMIT))
            return self._send(200, {"id": uid, "name": name})
        if path == "/api/export-file":                   # the native export (S3.7): the page's PDF or PNG, saved as it is
            return self._send(200, export_file((q.get("name") or [""])[0], self._body(BIG_LIMIT)))
        if path == "/api/export-feedback":               # the export pilot (S3.8): a problem report, as a JSON file
            return self._send(200, export_feedback(self._json(), current_user(), current_host()))
        if path == "/api/convert-workbook":
            name = os.path.basename((q.get("name") or ["workbook.xlsb"])[0].replace("\\", "/")) or "workbook.xlsb"
            data = self._body(BIG_LIMIT)
            try:
                out = convert_workbook(data, name)
            except Exception as e:
                log("workbook conversion failed: %s" % e)
                return self._error(501, str(e))
            return self._send(200, out, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if path == "/api/convert":
            ext = re.sub(r"[^a-z]", "", ((q.get("ext") or ["emf"])[0]).lower())[:5] or "emf"
            data = self._body(BIG_LIMIT)
            try:
                out = convert_picture(data, ext)
            except Exception as e:
                return self._error(501, str(e))
            return self._send(200, out, "image/png")
        if path == "/api/open":
            req = self._json()
            os.makedirs(paths.EXPORT_DIR, exist_ok=True)
            if req.get("folder"):
                target = paths.EXPORT_DIR
            else:
                if not isinstance(req.get("name"), str) or not req.get("name"):
                    raise HttpError(400, "name is required")
                target = safe_path(req["name"], paths.EXPORT_DIR)
                if not os.path.exists(target):
                    raise FileNotFoundError(req["name"])
            open_with_os(target)
            return self._send(200, {"ok": True})
        if path == "/api/logo":                          # a picture chosen in the app: kept in data/assets for everybody
            name = os.path.basename((q.get("name") or [""])[0].replace("\\", "/")).strip()
            ext = os.path.splitext(name)[1].lower()
            if ext not in IMAGE_EXT or ext == ".svg":
                raise HttpError(400, "choose a PNG, JPG, GIF, WEBP or BMP picture")
            data = self._body(LOGO_MAX)
            if not data:
                raise HttpError(400, "the picture is empty")
            safe = safe_component(name, 80)
            write_atomic(os.path.join(paths.data_dir("assets"), safe), data)
            return self._send(200, {"name": safe})
        if path == "/api/fonts/capture":                 # a Windows font a deck uses: fingerprint (G0 R7: not copied)
            self._body(JSON_LIMIT)
            return self._send(200, capture_sysfont((q.get("file") or [""])[0]))
        if path == "/api/fonts":                         # one font file; family/weight/style in the query
            one = lambda k, d=None: (q.get(k) or [d])[0]
            return self._send(200, add_face(one("family"), one("weight", "400"), one("style", "normal"), self._body(FONT_MAX),
                                            ext=os.path.splitext(one("name", "") or "")[1], source=one("source", "upload"),
                                            unicode_range=one("range")))
        return False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    # socketserver listens with a backlog of 5: a page that asks for fonts, pictures and a save at once
    # overflowed it, and a refused connection is only retried by the PC after 1, 2, 4 ... s (a save then
    # stayed "Unsaved changes" for seconds). The operating system caps this value anyway.
    request_queue_size = 128


def make_server(port, app=None, host="127.0.0.1"):
    """Bind the helper on host:port (port 0 = any free port). Raises OSError if the port is taken."""
    httpd = Server((host, port), Handler)
    httpd.app = app or App()
    httpd.app.port = httpd.server_address[1]
    return httpd
