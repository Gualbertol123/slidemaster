#!/usr/bin/env python3
"""
Slide Builder – local helper
============================

Run this file (double-click "Start Slide Builder.bat" on Windows, or `python slide_builder.py`).
It needs only the Python standard library and the Microsoft Edge or Google Chrome that is
already installed on the machine.

What it does
  * serves slide_builder.html on http://127.0.0.1:<port>/ and opens it in your browser
  * lists the workbooks that sit in this folder and serves them to the app
  * keeps every setting (design, layouts, cell edits, logo, …) in slide_builder_settings.txt
  * exports slides with a headless copy of Edge/Chrome that loads the very same page:
      - "exact"  : each slide is captured at 3x (4800 x 2700 px) and packed into a PDF
                   -> pixel-identical to what you see on screen
      - "vector" : Chrome's PDF engine with screen styles -> selectable text, smaller file
      - "png"    : one high-resolution PNG per slide
    Output files are written to this same folder.

Options
  python slide_builder.py --port 8765 --no-browser
  set SLIDEBUILDER_BROWSER=C:\\path\\to\\msedge.exe   (to force a specific browser)
"""
import argparse
import atexit
import base64
import datetime as _dt
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "slide-builder"
VERSION = "2.3"
# Folder layout
#   Slide Builder\                  <- ROOT: Start Slide Builder.bat + your Excel workbooks
#     export\                       <- every PDF / PNG is written here
#     engine\                       <- Chrome for Testing (installed once)
#     backend\                      <- this script, the app, the settings file, the logo
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = HERE
ROOT = os.path.dirname(HERE) if os.path.basename(HERE).lower() == "backend" else HERE
EXPORT_DIR = os.path.join(ROOT, "export")
APP_FILE = os.path.join(BACKEND, "slide_builder.html")
SETTINGS_FILE = os.path.join(BACKEND, "slide_builder_settings.txt")
WORKBOOK_EXT = (".xlsx", ".xlsm", ".xlsb", ".xls")
SLIDE_W, SLIDE_H = 1600, 900            # CSS px of one slide
PAGE_W_IN, PAGE_H_IN = 13.333, 7.5      # PowerPoint 16:9
PORT = None
NO_WINDOW = 0x08000000 if sys.platform.startswith("win") else 0
ENGINE_DIR = os.path.join(ROOT, "engine")          # Chrome for Testing is installed here (see --setup)
# Programs cannot run reliably from network drives (T:\, \\server\share), so there the engine lives on this PC:
LOCAL_ENGINE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "SlideBuilder", "engine")
if os.path.isdir(ENGINE_DIR):
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", ENGINE_DIR)

def log(*a):
    msg = " ".join(str(x) for x in (_dt.datetime.now().strftime("%H:%M:%S"),) + a)
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:               # old Windows consoles (cp1252/cp850)
        print(msg.encode("ascii", "replace").decode(), flush=True)

# Local requests must never go through a corporate proxy (that is what made the engine time out).
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _k in ("NO_PROXY", "no_proxy"):
    os.environ[_k] = ",".join(x for x in (os.environ.get(_k, ""), "127.0.0.1", "localhost", "::1") if x)


# --------------------------------------------------------------------------- settings
_settings_lock = threading.Lock()

def read_settings():
    with _settings_lock:
        if not os.path.exists(SETTINGS_FILE):
            return {}
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                txt = f.read().strip()
            return json.loads(txt) if txt else {}
        except Exception as e:  # keep a copy of a broken file instead of losing it
            bad = SETTINGS_FILE + ".unreadable-" + _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            try:
                shutil.copy2(SETTINGS_FILE, bad)
            except Exception:
                pass
            log("settings file could not be read (%s); a copy was kept as %s" % (e, os.path.basename(bad)))
            return {}

def write_settings(obj):
    data = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False)
    with _settings_lock:
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(data + "\n")
        for attempt in range(5):           # Windows: the file can be briefly locked by an editor/AV
            try:
                os.replace(tmp, SETTINGS_FILE)
                return
            except PermissionError:
                time.sleep(0.15)
        raise PermissionError("slide_builder_settings.txt is locked by another program")


# --------------------------------------------------------------------------- folder helpers
def safe_path(name, base=None):
    """Resolve a file name inside a folder; refuse anything that escapes it."""
    base = os.path.realpath(base or ROOT)
    name = urllib.parse.unquote(name).replace("\\", "/").lstrip("/")
    p = os.path.realpath(os.path.join(base, name))
    if not (p == base or p.startswith(base + os.sep)):
        raise PermissionError("outside folder")
    return p

def list_workbooks():
    """Workbooks in the main folder (and, for older setups, in backend)."""
    out, seen = [], set()
    for d in (ROOT, BACKEND):
        for n in os.listdir(d):
            if n.lower().endswith(WORKBOOK_EXT) and not n.startswith("~$") and n not in seen:
                seen.add(n)
                st = os.stat(os.path.join(d, n))
                out.append({"name": n, "mtime": st.st_mtime, "size": st.st_size})
    out.sort(key=lambda x: -x["mtime"])
    return out

def unique_output(path):
    """If the target is open in another program (e.g. a PDF viewer on Windows), write next to it."""
    try:
        if os.path.exists(path):
            with open(path, "ab"):
                pass
        return path
    except PermissionError:
        base, ext = os.path.splitext(path)
        return "%s (%s)%s" % (base, _dt.datetime.now().strftime("%H%M%S"), ext)

def clean_name(s):
    s = re.sub(r'[\\/:*?"<>|]+', "_", s).strip().strip(".")
    return s or "slide"

def open_with_os(path):
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


# --------------------------------------------------------------------------- PDF writer (JPEG pages)
def jpeg_size(data):
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            comps = data[i + 9]
            return w, h, comps
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seg
    raise ValueError("not a JPEG")

def pdf_text(s):
    try:
        s.encode("ascii")
        return "(" + s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"
    except UnicodeEncodeError:
        return "<FEFF" + s.encode("utf-16-be").hex().upper() + ">"

def png_info(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or ctype not in (0, 2) or interlace:
        raise ValueError("unsupported PNG layout (%d/%d/%d)" % (depth, ctype, interlace))
    return w, h, (1 if ctype == 0 else 3), b"".join(idat)

def png_first_column(data):
    import zlib
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or ctype not in (2, 6):
        return []
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(b"".join(idat))
    stride, prev, px = 1 + w * bpp, [0] * bpp, []
    for y in range(h):
        f = raw[y * stride]
        cur = []
        for k in range(bpp):
            x, up = raw[y * stride + 1 + k], prev[k]
            cur.append((x + (up if f in (2, 4) else up // 2 if f == 3 else 0)) & 255)
        px.append(tuple(cur[:3])); prev = cur
    return px

def png_crop_height(data, new_h):
    """Keep the top new_h rows of an 8-bit RGB/RGBA PNG (filters are per row, so rows can simply be cut)."""
    import zlib
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", ihdr)
    if h <= new_h or depth != 8 or inter or ctype not in (2, 6, 0):
        return data
    bpp = {0: 1, 2: 3, 6: 4}[ctype]
    raw = zlib.decompress(b"".join(idat))[: new_h * (1 + w * bpp)]
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, new_h, depth, ctype, comp, filt, inter))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))

def jpegs_to_pdf(jpegs, title):
    pw, ph = PAGE_W_IN * 72, PAGE_H_IN * 72
    objs = {}
    n = len(jpegs)
    kids = []
    for k, img in enumerate(jpegs):
        page_id, cont_id, img_id = 4 + 3 * k, 5 + 3 * k, 6 + 3 * k
        kids.append(page_id)
        content = ("q %.3f 0 0 %.3f 0 0 cm /Im0 Do Q" % (pw, ph)).encode()
        if img[:4] == b"\x89PNG":          # lossless: PNG data goes into the PDF unchanged (Flate + PNG predictor)
            w, h, colors, raw = png_info(img)
            objs[page_id] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] "
                             "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (pw, ph, img_id, cont_id)).encode()
            objs[cont_id] = b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
            objs[img_id] = (b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /FlateDecode "
                            b"/DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent 8 /Columns %d >> /Length %d >>\nstream\n"
                            % (w, h, b"/DeviceRGB" if colors == 3 else b"/DeviceGray", colors, w, len(raw))) + raw + b"\nendstream"
            continue
        w, h, comps = jpeg_size(img)
        cs = "/DeviceGray" if comps == 1 else ("/DeviceCMYK" if comps == 4 else "/DeviceRGB")
        objs[page_id] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] "
                         "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (pw, ph, img_id, cont_id)).encode()
        objs[cont_id] = b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
        objs[img_id] = (b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 "
                        b"/Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, cs.encode(), len(img))) + img + b"\nendstream"
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>"
    objs[2] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % k for k in kids), n)).encode()
    now = _dt.datetime.now().strftime("D:%Y%m%d%H%M%S")
    objs[3] = ("<< /Title %s /Producer (Slide Builder %s) /CreationDate (%s) >>" % (pdf_text(title), VERSION, now)).encode()
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for i in range(1, max(objs) + 1):
        offsets[i] = len(out)
        out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (max(objs) + 1)
    for i in range(1, max(objs) + 1):
        out += b"%010d 00000 n \n" % offsets[i]
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 3 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (max(objs) + 1, xref)
    return bytes(out)


# --------------------------------------------------------------------------- minimal Chrome DevTools client
class CDP:
    """Tiny websocket + DevTools protocol client (no third-party packages)."""

    def __init__(self, ws_url, timeout=180):
        u = urllib.parse.urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (u.path, u.hostname, u.port, key))
        self.sock.sendall(req.encode())
        self.buf = bytearray()
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("DevTools handshake failed")
            self.buf += chunk
        head, _, rest = bytes(self.buf).partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("DevTools refused the connection: %r" % head[:120])
        self.buf = bytearray(rest)
        self.next_id = 0

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(1 << 20, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("DevTools connection closed")
            self.buf += chunk
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def _send(self, op, payload):
        hdr = bytearray([0x80 | op])
        n = len(payload)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", n)
        mask = os.urandom(4)
        hdr += mask
        body = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.sock.sendall(bytes(hdr) + body)

    def _message(self):
        parts = []
        while True:
            h = self._exact(2)
            fin, op, ln = h[0] & 0x80, h[0] & 0x0F, h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._exact(8))[0]
            if h[1] & 0x80:
                m = self._exact(4)
                data = bytes(b ^ m[i & 3] for i, b in enumerate(self._exact(ln)))
            else:
                data = self._exact(ln)
            if op == 0x9:
                self._send(0xA, data); continue
            if op == 0x8:
                raise ConnectionError("DevTools connection closed")
            parts.append(data)
            if fin:
                return b"".join(parts)

    def call(self, method, params=None, timeout=120, session=None):
        self.next_id += 1
        mid = self.next_id
        msg = {"id": mid, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.sock.settimeout(max(5, timeout))
        self._send(0x1, json.dumps(msg).encode())
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self._message())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"].get("message")))
                return msg.get("result", {})
        raise TimeoutError(method)

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def is_network_path(p):
    p = os.path.abspath(p)
    if os.environ.get("SLIDEBUILDER_FORCE_NETWORK"):          # testing aid
        return p.startswith(ROOT)
    if p.startswith("\\\\"):
        return True
    if sys.platform.startswith("win"):
        drive = os.path.splitdrive(p)[0]
        if drive:
            try:
                import ctypes
                return ctypes.windll.kernel32.GetDriveTypeW(drive + "\\") == 4      # DRIVE_REMOTE
            except Exception:
                return False
    return False

def _exe_in(folder):
    if not os.path.isdir(folder):
        return None
    for root, dirs, files in os.walk(folder):
        for exe in ("chrome-headless-shell.exe", "chrome-headless-shell", "chrome.exe"):
            if exe in files:
                return os.path.join(root, exe)
    return None

def find_local_engines():
    """Chrome for Testing copies: the one on this PC first, then the one in the app's engine folder."""
    out = []
    for d in (LOCAL_ENGINE_DIR, ENGINE_DIR):
        e = _exe_in(d)
        if e and e not in out:
            out.append(e)
    return out

def find_local_engine():
    l = find_local_engines()
    return l[0] if l else None

def mirror_engine_locally():
    """App folder on a network drive (e.g. T:\\): Chrome for Testing is copied once to this PC, because
    programs started from network shares are often blocked or cannot start their sandbox."""
    src = _exe_in(ENGINE_DIR)
    if not src or not is_network_path(src) or _exe_in(LOCAL_ENGINE_DIR):
        return False
    folder = os.path.dirname(src)
    dst = os.path.join(LOCAL_ENGINE_DIR, os.path.basename(folder))
    log("copying Chrome for Testing from the network folder to this PC (%s) - one time only…" % LOCAL_ENGINE_DIR)
    tmp = dst + ".part"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(folder, tmp)
    shutil.rmtree(dst, ignore_errors=True)
    os.replace(tmp, dst)
    log("copy finished")
    return True

def explain_start_error(e):
    w = getattr(e, "winerror", None)
    return {1260: "Windows blocks programs in this folder (AppLocker / software restriction policy)",
            4551: "Windows Application Control blocks this program",
            225: "the antivirus blocked this program",
            5: "access denied – the program may not be started from this folder",
            2: "the program file is missing"}.get(w, str(e))

def explain_exit(rc):
    if rc is None:
        return ""
    u = rc & 0xFFFFFFFF
    return {0xC0000022: "access denied – blocked by security software or a policy",
            0xC0000135: "a Windows component it needs is missing",
            0xC0000005: "it crashed while starting",
            0xC0000409: "it stopped itself during start-up",
            0x80000003: "it stopped during start-up"}.get(u, ("exit code 0x%08X" % u) if u > 0xFFFF else "exit code %d" % rc)

def find_browser():
    env = os.environ.get("SLIDEBUILDER_BROWSER")
    if env and os.path.exists(env):
        return env
    cands = []
    if sys.platform.startswith("win"):
        for base in (os.environ.get("PROGRAMFILES(X86)"), os.environ.get("PROGRAMFILES"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                          os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")]
    elif sys.platform == "darwin":
        cands += ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    for c in cands:
        if c and os.path.exists(c):
            return c
    for n in ("microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge", "chrome"):
        p = shutil.which(n)
        if p:
            return p
    return None


# --------------------------------------------------------------------------- export engines
EXPORT_CSS = ("@page{size:13.333in 7.5in;margin:0}html,body{margin:0;padding:0;background:#fff}"
              ".page{position:relative;width:1600px;height:900px;overflow:hidden;break-after:page;page-break-after:always}"
              ".page:last-child{break-after:auto;page-break-after:auto}@media print{.page{zoom:.8}}"
              "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}")

def compose(css, slides):
    return ("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>%s</style><style>%s</style></head><body>%s</body></html>"
            % (css, EXPORT_CSS, "".join('<div class="page">%s</div>' % s for s in slides)))

WAIT_JS = ("async () => { if (document.fonts) await document.fonts.ready;"
           " await Promise.all([...document.images].map(i => i.decode ? i.decode().catch(() => {}) : 0));"
           " await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; }")


class EngineError(RuntimeError):
    def __init__(self, msg, permanent=False):
        super().__init__(msg)
        self.permanent = permanent


class PlaywrightEngine:
    """Playwright driving Chrome for Testing: not affected by company Edge policies. Recommended."""
    name = "Playwright"

    def __init__(self, local_exes=None):
        self.locals = [x for x in (local_exes or []) if x]
        self.q = None
        self.thread = None
        self.browser = None
        self.pw = None
        self.label = "Playwright"

    def installed(self):
        try:
            import importlib.util
            return importlib.util.find_spec("playwright") is not None
        except Exception:
            return False

    def _loop(self):
        while True:
            fn, box, done = self.q.get()
            try:
                box["result"] = fn()
            except BaseException as e:
                box["error"] = e
            done.set()

    def _call(self, fn, timeout=600):
        if self.thread is None:
            import queue
            self.q = queue.Queue()
            self.thread = threading.Thread(target=self._loop, daemon=True, name="playwright")
            self.thread.start()
        box, done = {}, threading.Event()
        self.q.put((fn, box, done))
        if not done.wait(timeout):
            raise EngineError("Playwright did not answer in time", permanent=True)
        if "error" in box:
            raise box["error"]
        return box["result"]

    def _ensure(self):
        if self.browser is not None and self.browser.is_connected():
            return
        from playwright.sync_api import sync_playwright
        if self.pw is None:
            self.pw = sync_playwright().start()
        errors = []
        # Edge/Chrome are left to the other engines: when they are locked down, launching them here only wastes time
        tries = [({"executable_path": x}, "Chrome for Testing") for x in self.locals] + [({}, "Chromium")]
        for kw, label in tries:
            b = None
            try:
                b = self.pw.chromium.launch(headless=True, timeout=30000, **kw)
                pg = b.new_page()                      # a company policy can let the browser start but block pages
                pg.set_content("<p>ok</p>", timeout=20000)
                pg.close()
                self.browser = b
                self.label = "Playwright · " + label
                log("export engine ready (%s)" % self.label)
                return
            except Exception as e:
                errors.append("%s: %s" % (label, (str(e).strip().splitlines() or ["error"])[0][:140]))
                try:
                    if b: b.close()
                except Exception:
                    pass
        raise EngineError("no usable browser (" + "; ".join(errors) + ")", permanent=True)

    def warm(self):
        if self.installed():
            self._call(self._ensure)

    def selftest(self):
        if not self.installed():
            raise EngineError("the Python package 'playwright' is not installed", permanent=True)
        self._call(self._ensure, timeout=90)

    def render(self, css, slides, kind, scale):
        if not self.installed():
            raise EngineError("Playwright is not installed (run \"Install export engine.bat\")", permanent=True)
        def job():
            self._ensure()
            page = self.browser.new_page(viewport={"width": SLIDE_W, "height": SLIDE_H}, device_scale_factor=(1 if kind == "vector" else scale))
            try:
                page.set_content(compose(css, slides), wait_until="load", timeout=180000)
                page.evaluate(WAIT_JS)
                if kind == "vector":
                    return page.pdf(width="13.333in", height="7.5in", print_background=True, prefer_css_page_size=True,
                                    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
                out = []
                for i in range(len(slides)):
                    el = page.locator(".page").nth(i)
                    out.append(el.screenshot(type="jpeg", quality=95) if kind == "jpeg" else el.screenshot(type="png"))
                return out
            finally:
                page.close()
        return self._call(job)

    def stop(self):
        def job():
            try:
                if self.browser:
                    self.browser.close()
            except Exception:
                pass
            self.browser = None
        if self.thread is not None:
            try:
                self._call(job, timeout=20)
            except Exception:
                pass


class DevToolsEngine:
    """Edge/Chrome driven through its DevTools port (often disabled by company policy)."""

    def __init__(self, exe):
        self.exe = exe
        self.proc = self.cdp = self.session = self.tmp = None
        self.label = browser_label(exe) + " (DevTools)" if exe else "DevTools"
        self.name = "DevTools · " + browser_label(exe)

    def installed(self):
        return bool(self.exe)

    def _start(self):
        self.tmp = tempfile.mkdtemp(prefix="slidebuilder_")
        args = [self.exe, "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + self.tmp, "--no-first-run",
                "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--disable-extensions",
                "--disable-background-networking", "--force-color-profile=srgb", "--remote-allow-origins=*", "about:blank"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            args.insert(1, "--no-sandbox")
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
        port_file = os.path.join(self.tmp, "DevToolsActivePort")
        end, lines = time.time() + 20, []
        while time.time() < end:
            if self.proc.poll() is not None:
                raise EngineError("the browser closed immediately (blocked by policy?)", permanent=True)
            try:
                with open(port_file) as f:
                    lines = [l.strip() for l in f.read().splitlines() if l.strip()]
            except OSError:
                lines = []
            if len(lines) >= 2:
                break
            time.sleep(0.15)
        if len(lines) < 2:
            raise EngineError("remote debugging is disabled on this browser", permanent=True)
        self.cdp = CDP("ws://127.0.0.1:%d%s" % (int(lines[0]), lines[1]), timeout=60)
        target = self.cdp.call("Target.createTarget", {"url": "about:blank"}, timeout=30)["targetId"]
        try:
            self.session = self.cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True}, timeout=30)["sessionId"]
        except RuntimeError as e:
            if "not allowed" in str(e).lower():
                raise EngineError("DevTools access is blocked by a company policy on this browser", permanent=True)
            raise
        self.page("Page.enable")
        self.page("Runtime.enable")

    def page(self, method, params=None, timeout=120):
        return self.cdp.call(method, params, timeout=timeout, session=self.session)

    def selftest(self):
        if self.proc is None or self.proc.poll() is not None or self.cdp is None:
            self.stop()
            self._start()

    def render(self, css, slides, kind, scale):
        if self.proc is None or self.proc.poll() is not None or self.cdp is None:
            self.stop()
            self._start()
        work = tempfile.mkdtemp(prefix="slidebuilder_doc_")
        try:
            doc = os.path.join(work, "slides.html")
            with open(doc, "w", encoding="utf-8") as f:
                f.write(compose(css, slides))
            self.page("Emulation.setDeviceMetricsOverride", {"width": SLIDE_W, "height": SLIDE_H, "deviceScaleFactor": 1 if kind == "vector" else scale, "mobile": False})
            self.page("Page.navigate", {"url": file_url(doc)})
            end = time.time() + 120
            while time.time() < end:
                time.sleep(0.15)
                r = self.page("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True})
                if r.get("result", {}).get("value") == "complete":
                    break
            self.page("Runtime.evaluate", {"expression": "(%s)()" % WAIT_JS, "awaitPromise": True, "returnByValue": True})
            if kind == "vector":
                pdf = self.page("Page.printToPDF", {"paperWidth": PAGE_W_IN, "paperHeight": PAGE_H_IN, "marginTop": 0, "marginBottom": 0,
                                                    "marginLeft": 0, "marginRight": 0, "printBackground": True, "preferCSSPageSize": True}, timeout=300)
                return base64.b64decode(pdf["data"])
            out = []
            for i in range(len(slides)):
                p = {"format": kind, "fromSurface": True, "captureBeyondViewport": True,
                     "clip": {"x": 0, "y": i * SLIDE_H, "width": SLIDE_W, "height": SLIDE_H, "scale": 1}}
                if kind == "jpeg":
                    p["quality"] = 95
                out.append(base64.b64decode(self.page("Page.captureScreenshot", p, timeout=120)["data"]))
            return out
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def stop(self):
        if self.cdp:
            self.cdp.close()
        self.cdp = self.session = None
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except Exception:
                self.proc.kill()
        self.proc = None
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)
            self.tmp = None


class CommandLineEngine:
    """Edge/Chrome in plain headless mode (--screenshot / --print-to-pdf): needs no DevTools."""

    def __init__(self, exe):
        self.exe = exe
        self.label = browser_label(exe) + " (headless)" if exe else "headless browser"
        self.name = "Command line · " + browser_label(exe)
        self.chrome_h = None     # extra window height the browser keeps outside the page (measured once)
        self.extra = []          # switches this PC needs (found by the self-test)

    def installed(self):
        return bool(self.exe)

    def _calibrate(self):
        """Self-test: take a 1x screenshot of a green page. Tells us whether the browser can render here,
        which extra switches it needs, and how much of the window is not page (to crop it later)."""
        if self.chrome_h is not None:
            return self.chrome_h
        work = tempfile.mkdtemp(prefix="slidebuilder_cal_")
        last = "no result"
        try:
            doc, out = os.path.join(work, "t.html"), os.path.join(work, "t.png")
            with open(doc, "w") as f:
                f.write('<!DOCTYPE html><html style="background:#ff0000"><body style="margin:0;height:100vh;background:#00ff00"></body></html>')
            for extra in ([], ["--no-sandbox"], ["--no-sandbox", "--disable-gpu-compositing", "--single-process"]):
                prof = tempfile.mkdtemp(prefix="slidebuilder_cli_")
                cmd = [self.exe, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--user-data-dir=" + prof] + extra + \
                      ["--window-size=%d,%d" % (SLIDE_W, SLIDE_H), "--default-background-color=FFFFFFFF", "--screenshot=" + out, file_url(doc)]
                try:
                    if os.path.exists(out):
                        os.remove(out)
                    rc, _, err = run_killable(cmd, 40, capture=True)
                except OSError as e:
                    raise EngineError("%s could not be started: %s" % (browser_label(self.exe), explain_start_error(e)), permanent=True)
                except subprocess.TimeoutExpired:
                    last = "it did not respond within 40 s"; continue
                finally:
                    shutil.rmtree(prof, ignore_errors=True)
                if os.path.exists(out) and os.path.getsize(out) > 0:
                    with open(out, "rb") as f:
                        col = png_first_column(f.read())
                    green = sum(1 for (r, g, b) in col if g > 200 and r < 80)
                    if green > 100:
                        self.extra = extra
                        self.chrome_h = max(0, SLIDE_H - green)
                        if extra:
                            log("%s works with %s" % (browser_label(self.exe), " ".join(extra)))
                        return self.chrome_h
                    last = "it produced an empty picture"
                else:
                    tail = (err or b"").decode("utf-8", "replace").strip().splitlines()
                    last = "no picture produced (%s%s)" % (explain_exit(rc), ("; " + tail[-1][:160]) if tail else "")
            raise EngineError("%s cannot render here: %s" % (browser_label(self.exe), last), permanent=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def selftest(self):
        self._calibrate()

    def _run(self, args, out, timeout=75):
        prof = tempfile.mkdtemp(prefix="slidebuilder_cli_")
        try:
            cmd = [self.exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
                   "--mute-audio", "--disable-extensions", "--force-color-profile=srgb", "--user-data-dir=" + prof] + getattr(self, "extra", []) + args
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                cmd.insert(1, "--no-sandbox")
            try:
                run_killable(cmd, timeout)
            except subprocess.TimeoutExpired:
                raise EngineError("%s stopped responding while rendering" % browser_label(self.exe), permanent=True)
            if not os.path.exists(out) or os.path.getsize(out) == 0:
                raise EngineError("the browser did not produce an output file (headless mode may be disabled by policy)", permanent=True)
            with open(out, "rb") as f:
                return f.read()
        finally:
            shutil.rmtree(prof, ignore_errors=True)

    def render(self, css, slides, kind, scale):
        self._calibrate()                      # fails fast if the browser cannot run headless
        work = tempfile.mkdtemp(prefix="slidebuilder_doc_")
        try:
            if kind == "vector":
                doc, out = os.path.join(work, "all.html"), os.path.join(work, "out.pdf")
                with open(doc, "w", encoding="utf-8") as f:
                    f.write(compose(css, slides))
                return self._run(["--no-pdf-header-footer", "--print-to-pdf-no-header", "--print-to-pdf=" + out, "--virtual-time-budget=8000", file_url(doc)], out, 300)
            from concurrent.futures import ThreadPoolExecutor
            extra = self._calibrate()
            def one(i):
                doc, out = os.path.join(work, "s%d.html" % i), os.path.join(work, "s%d.png" % i)
                with open(doc, "w", encoding="utf-8") as f:
                    f.write(compose(css, [slides[i]]))
                png = self._run(["--window-size=%d,%d" % (SLIDE_W, SLIDE_H + extra), "--force-device-scale-factor=%g" % scale,
                                 "--default-background-color=FFFFFFFF", "--virtual-time-budget=8000",
                                 "--screenshot=" + out, file_url(doc)], out)
                return png_crop_height(png, int(round(SLIDE_H * scale)))
            with ThreadPoolExecutor(max_workers=3) as ex:
                return list(ex.map(one, range(len(slides))))   # PNG (lossless) - packed into the PDF without re-encoding
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def stop(self):
        pass


class Exporter:
    """Tries the engines in order; each one must pass a self-test before it is used."""

    def __init__(self):
        self.lock = threading.Lock()
        self.disabled = {}
        self.tested = set()
        self.last = None
        self.testing = False
        self._build()

    def _build(self):
        exe = find_browser()
        locals_ = find_local_engines()
        self.exe, self.local = exe, (locals_[0] if locals_ else None)
        engines = [PlaywrightEngine(locals_)]
        for b in locals_ + ([exe] if exe else []):
            engines += [DevToolsEngine(b), CommandLineEngine(b)]
        only = [x.strip().lower() for x in os.environ.get("SLIDEBUILDER_ENGINES", "").split(",") if x.strip()]
        if only:   # e.g. SLIDEBUILDER_ENGINES=cli  (playwright, devtools, cli)
            keys = {"playwright": "Playwright", "devtools": "DevTools", "cli": "Command line"}
            engines = [e for k in only for e in engines if e.name.startswith(keys.get(k, "?"))]
        self.engines = engines

    def reload(self):
        """After installing the engine: rebuild the list and test again."""
        with self.lock:
            self.stop()
            self.disabled.clear(); self.tested.clear(); self.last = None
            self._build()
        threading.Thread(target=self.warm, daemon=True).start()

    def status(self):
        rows = []
        for e in self.engines:
            st = "missing" if not e.installed() else ("blocked" if e.name in self.disabled else ("ok" if e.name in self.tested else "untested"))
            rows.append({"name": e.name, "label": e.label, "state": st, "detail": self.disabled.get(e.name, "")})
        ok = [r for r in rows if r["state"] == "ok"]
        maybe = [r for r in rows if r["state"] in ("ok", "untested")]
        first = next((r for r in ok if r["name"] == self.last), ok[0] if ok else None)
        state = "ready" if first else ("starting" if (self.testing and maybe) else ("unavailable" if not maybe else "idle"))
        return {"state": state, "browser": first["label"] if first else None, "local": bool(self.local),
                "error": None if first else "; ".join("%s: %s" % (r["name"], r["detail"] or r["state"]) for r in rows),
                "engines": rows}

    def _fail(self, e, ex):
        msg = (str(ex).strip().splitlines() or [ex.__class__.__name__])[0]
        log("%s: %s" % (e.name, msg))
        if getattr(ex, "permanent", False) or isinstance(ex, subprocess.TimeoutExpired):
            self.disabled[e.name] = msg
        try:
            e.stop()
        except Exception:
            pass
        return msg

    def warm(self):
        """Test the engines one by one at start-up until one works, so the status is known before exporting."""
        self.testing = True
        try:
            try:
                if mirror_engine_locally():
                    with self.lock:
                        self._build()
            except Exception as ex:
                log("could not copy the engine to this PC: %s" % ex)
            for e in self.engines:
                if not e.installed() or e.name in self.disabled:
                    continue
                with self.lock:
                    try:
                        e.selftest()
                        self.tested.add(e.name)
                        if not self.last:
                            self.last = e.name
                        log("export engine ready: %s" % e.label)
                        return
                    except Exception as ex:
                        self._fail(e, ex)
            log("no export engine works on this PC - exports are rendered in the app window (run the installer for better results)")
        finally:
            self.testing = False

    def render(self, css, slides, kind, scale):
        with self.lock:
            order = sorted(self.engines, key=lambda e: 0 if e.name == self.last else 1)
            errors = []
            for e in order:
                if not e.installed() or e.name in self.disabled:
                    continue
                try:
                    out = e.render(css, slides, kind, scale)
                    self.last = e.name
                    self.tested.add(e.name)
                    return out, e.label
                except Exception as ex:
                    errors.append("%s: %s" % (e.name, self._fail(e, ex)))
            raise EngineError("export engine: " + (" | ".join(errors) or "no browser available"))

    def restart(self):
        with self.lock:
            self.stop()
            self.disabled.clear(); self.tested.clear()
        threading.Thread(target=self.warm, daemon=True).start()

    def stop(self):
        for e in self.engines:
            try:
                e.stop()
            except Exception:
                pass


def run_killable(cmd, timeout, capture=False):
    """Run a browser; on timeout kill it together with its child processes (a hung Edge leaves several).
    Returns (returncode, stdout, stderr)."""
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    try:
        out, err = p.communicate(timeout=timeout)
        return p.returncode, out or b"", err or b""
    except subprocess.TimeoutExpired:
        if sys.platform.startswith("win"):
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
        else:
            p.kill()
        try:
            p.communicate(timeout=5)
        except Exception:
            pass
        raise

def browser_label(exe):
    if exe and (os.path.abspath(exe).startswith(ENGINE_DIR) or os.path.abspath(exe).startswith(LOCAL_ENGINE_DIR)):
        return "Chrome for Testing" + (" (this PC)" if os.path.abspath(exe).startswith(LOCAL_ENGINE_DIR) else "")
    n = os.path.basename(exe or "").lower()
    return "Edge" if "edge" in n else ("Chrome" if "chrome" in n else "Chromium")

def file_url(path):
    return "file:///" + urllib.parse.quote(os.path.abspath(path).replace("\\", "/").lstrip("/"), safe="/:")


# --------------------------------------------------------------------------- conversions done with Windows / Excel
_conv_cache = {}

def _gdiplus_to_png(src, dst):
    """Render EMF/WMF/TIFF with Windows GDI+ (built into Windows, no PowerShell needed)."""
    import ctypes
    from ctypes import byref, c_void_p, c_uint, c_size_t, c_wchar_p
    class StartupInput(ctypes.Structure):
        _fields_ = [("GdiplusVersion", c_uint), ("DebugEventCallback", c_void_p),
                    ("SuppressBackgroundThread", ctypes.c_int), ("SuppressExternalCodecs", ctypes.c_int)]
    class GUID(ctypes.Structure):
        _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]
    gdip = ctypes.WinDLL("gdiplus")
    token = c_size_t()
    if gdip.GdiplusStartup(byref(token), byref(StartupInput(1, None, 0, 0)), None):
        raise RuntimeError("GDI+ could not start")
    img, bmp, gfx = c_void_p(), c_void_p(), c_void_p()
    try:
        if gdip.GdipLoadImageFromFile(c_wchar_p(src), byref(img)):
            raise RuntimeError("GDI+ could not read the picture")
        w, h = c_uint(), c_uint()
        gdip.GdipGetImageWidth(img, byref(w)); gdip.GdipGetImageHeight(img, byref(h))
        scale = min(4.0, max(1.0, 1600.0 / max(w.value, 1)))
        W, H = max(1, int(w.value * scale)), max(1, int(h.value * scale))
        gdip.GdipCreateBitmapFromScan0(W, H, 0, 0x26200A, None, byref(bmp))      # 32bpp ARGB
        gdip.GdipGetImageGraphicsContext(bmp, byref(gfx))
        gdip.GdipSetSmoothingMode(gfx, 4); gdip.GdipSetInterpolationMode(gfx, 7)
        gdip.GdipSetPixelOffsetMode(gfx, 2); gdip.GdipSetTextRenderingHint(gfx, 3)
        gdip.GdipGraphicsClear(gfx, 0)
        if gdip.GdipDrawImageRectI(gfx, img, 0, 0, W, H):
            raise RuntimeError("GDI+ could not draw the picture")
        png = GUID(0x557CF406, 0x1A04, 0x11D3, (ctypes.c_ubyte * 8)(0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E))
        if gdip.GdipSaveImageToFile(bmp, c_wchar_p(dst), byref(png), None):
            raise RuntimeError("GDI+ could not save the PNG")
    finally:
        if gfx: gdip.GdipDeleteGraphics(gfx)
        if bmp: gdip.GdipDisposeImage(bmp)
        if img: gdip.GdipDisposeImage(img)
        gdip.GdiplusShutdown(token)

def convert_picture(data, ext):
    """EMF / WMF / TIFF pictures from the workbook -> PNG (Windows only)."""
    key = (ext, hash(data))
    if key in _conv_cache:
        return _conv_cache[key]
    if not sys.platform.startswith("win"):
        raise RuntimeError("EMF/WMF/TIFF pictures can only be converted on Windows")
    tmpd = tempfile.mkdtemp(prefix="slidebuilder_img_")
    try:
        src, dst = os.path.join(tmpd, "in." + ext), os.path.join(tmpd, "out.png")
        with open(src, "wb") as f:
            f.write(data)
        try:
            _gdiplus_to_png(src, dst)
        except Exception as e:
            log("GDI+ conversion failed (%s), trying PowerShell" % e)
        if not os.path.exists(dst):
            q = lambda p: p.replace("'", "''")
            ps = ("Add-Type -AssemblyName System.Drawing;$img=[System.Drawing.Image]::FromFile('%s');"
                  "$s=[Math]::Min(4,[Math]::Max(1,1600/[Math]::Max($img.Width,1)));$w=[int]($img.Width*$s);$h=[int]($img.Height*$s);"
                  "$bmp=New-Object System.Drawing.Bitmap($w,$h);$g=[System.Drawing.Graphics]::FromImage($bmp);"
                  "$g.SmoothingMode='HighQuality';$g.InterpolationMode='HighQualityBicubic';$g.Clear([System.Drawing.Color]::Transparent);"
                  "$g.DrawImage($img,0,0,$w,$h);$bmp.Save('%s',[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();$img.Dispose()") % (q(src), q(dst))
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, creationflags=NO_WINDOW)
        if not os.path.exists(dst):
            raise RuntimeError("Windows could not convert this .%s picture" % ext)
        with open(dst, "rb") as f:
            out = f.read()
        _conv_cache[key] = out
        return out
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)

_wb_cache = {}

def convert_workbook(data, name):
    """.xlsb / .xls -> .xlsx with the Excel installed on this PC. The original file is never touched:
    Excel opens a temporary copy read-only, with macros, events and link updates switched off."""
    import hashlib
    key = hashlib.sha1(data).hexdigest()
    if key in _wb_cache:
        return _wb_cache[key]
    if not sys.platform.startswith("win"):
        raise RuntimeError("this needs Microsoft Excel on Windows")
    ext = os.path.splitext(name)[1].lower() or ".xlsb"
    tmpd = tempfile.mkdtemp(prefix="slidebuilder_wb_")
    try:
        src, dst = os.path.join(tmpd, "in" + ext), os.path.join(tmpd, "out.xlsx")
        with open(src, "wb") as f:
            f.write(data)
        q = lambda p: p.replace("'", "''")
        ps = ("$ErrorActionPreference='Stop';$xl=New-Object -ComObject Excel.Application;"
              "try{ $xl.Visible=$false; $xl.DisplayAlerts=$false; $xl.AskToUpdateLinks=$false; $xl.EnableEvents=$false;"
              " try{ $xl.AutomationSecurity=3 }catch{};"
              " $wb=$xl.Workbooks.Open('%s',0,$true); $wb.SaveAs('%s',51); $wb.Close($false) }"
              "finally{ $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }") % (q(src), q(dst))
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240, creationflags=NO_WINDOW)
        if not os.path.exists(dst):
            err = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError("Excel could not open or save it" + (": " + err[0][:200] if err else ""))
        with open(dst, "rb") as f:
            out = f.read()
        _wb_cache[key] = out
        log("converted %s with Excel" % name)
        return out
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)


ENGINE = Exporter()
INSTALL = {"running": False, "done": False, "ok": None, "lines": []}

def start_install():
    """Run 'slide_builder.py --setup' in the background and keep its output for the app."""
    if INSTALL["running"]:
        return INSTALL
    INSTALL.update(running=True, done=False, ok=None, lines=["Starting the installer…"])
    def work():
        try:
            p = subprocess.Popen([sys.executable, "-u", os.path.abspath(__file__), "--setup"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 cwd=BACKEND, creationflags=NO_WINDOW)
            for raw in iter(p.stdout.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip()
                if line:
                    INSTALL["lines"] = (INSTALL["lines"] + [line])[-200:]
            INSTALL["ok"] = p.wait() == 0
        except Exception as e:
            INSTALL["lines"].append("Installer error: %s" % e); INSTALL["ok"] = False
        finally:
            INSTALL.update(running=False, done=True)
            ENGINE.reload()
    threading.Thread(target=work, daemon=True).start()
    return INSTALL
UPLOADS = {}  # id -> (name, bytes, time)


# --------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "SlideBuilder/" + VERSION

    def log_message(self, fmt, *args):
        pass

    # ---- helpers
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        try:
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass                                   # the page was closed or reloaded meanwhile

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _json(self):
        b = self._body()
        return json.loads(b.decode("utf-8")) if b else {}

    def _file(self, path):
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(path)[1].lower()
        ctype = {".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
                 ".txt": "text/plain; charset=utf-8", ".json": "application/json",
                 ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsb": "application/octet-stream", ".xls": "application/vnd.ms-excel",
                 ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12"}.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, ctype)

    # ---- routes
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html", "/slide_builder.html"):
                return self._file(APP_FILE)
            if u.path == "/api/health":
                return self._send(200, {"app": APP_NAME, "version": VERSION, "folder": ROOT, "export": EXPORT_DIR,
                                        "engine": ENGINE.status()})
            if u.path == "/api/settings":
                return self._send(200, read_settings())
            if u.path == "/api/engine/install":
                return self._send(200, INSTALL)
            if u.path == "/api/files":
                return self._send(200, {"workbooks": list_workbooks(), "folder": ROOT})
            if u.path.startswith("/files/"):                 # workbooks (main folder, then backend)
                n = u.path[len("/files/"):]
                p = safe_path(n, ROOT)
                return self._file(p if os.path.isfile(p) else safe_path(n, BACKEND))
            if u.path.startswith("/assets/"):                # logo and other images (backend, then main folder)
                n = u.path[len("/assets/"):]
                p = safe_path(n, BACKEND)
                return self._file(p if os.path.isfile(p) else safe_path(n, ROOT))
            if u.path.startswith("/api/upload/"):
                uid = u.path.rsplit("/", 1)[-1]
                if uid not in UPLOADS:
                    return self._send(404, {"error": "upload expired, open the workbook again"})
                return self._send(200, UPLOADS[uid][1], "application/octet-stream")
            return self._send(404, {"error": "not found"})
        except PermissionError:
            return self._send(403, {"error": "forbidden"})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": str(e)})

    def do_PUT(self):
        u = urllib.parse.urlparse(self.path)
        try:
            if u.path == "/api/settings":
                write_settings(self._json())
                return self._send(200, {"ok": True, "file": os.path.basename(SETTINGS_FILE)})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": str(e)})

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/api/upload":
                name = os.path.basename(q.get("name", ["workbook.xlsx"])[0])
                uid = uuid.uuid4().hex
                for k in [k for k, v in UPLOADS.items() if time.time() - v[2] > 6 * 3600]:
                    UPLOADS.pop(k, None)
                UPLOADS[uid] = (name, self._body(), time.time())
                return self._send(200, {"id": uid, "name": name})
            if u.path == "/api/export":
                try:
                    return self._send(200, self.export(self._json()))
                except EngineError as e:
                    return self._send(503, {"error": str(e)})
            if u.path == "/api/convert-workbook":
                name = os.path.basename(q.get("name", ["workbook.xlsb"])[0])
                try:
                    return self._send(200, convert_workbook(self._body(), name), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                except Exception as e:
                    log("workbook conversion failed: %s" % e)
                    return self._send(501, {"error": str(e)})
            if u.path == "/api/convert":
                ext = re.sub(r"[^a-z]", "", (q.get("ext", ["emf"])[0]).lower())[:5] or "emf"
                try:
                    return self._send(200, convert_picture(self._body(), ext), "image/png")
                except Exception as e:
                    return self._send(501, {"error": str(e)})
            if u.path == "/api/engine/install":
                return self._send(200, start_install())
            if u.path == "/api/engine/restart":
                ENGINE.restart()
                return self._send(200, {"ok": True})
            if u.path == "/api/assemble":           # fallback: PDF from images rendered by the page itself
                os.makedirs(EXPORT_DIR, exist_ok=True)
                req = self._json()
                imgs = [base64.b64decode(x.split(",", 1)[-1]) for x in req["images"]]
                base = clean_name(os.path.splitext(req.get("name") or "slides")[0])
                out = unique_output(os.path.join(EXPORT_DIR, base + " - slides.pdf"))
                with open(out, "wb") as f:
                    f.write(jpegs_to_pdf(imgs, base))
                return self._send(200, {"ok": True, "files": [os.path.basename(out)]})
            if u.path == "/api/open":
                req = self._json()
                os.makedirs(EXPORT_DIR, exist_ok=True)
                target = EXPORT_DIR if req.get("folder") else safe_path(req["name"], EXPORT_DIR)
                open_with_os(target)
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": str(e)})

    def export(self, req):
        t0 = time.time()
        os.makedirs(EXPORT_DIR, exist_ok=True)
        name = req.get("name", "")
        css, slides, names = req.get("css", ""), req.get("slides") or [], req.get("names") or []
        if not slides:
            raise RuntimeError("nothing to export")
        fmt, mode = req.get("format", "pdf"), req.get("mode", "exact")
        scale = max(1, min(4, float(req.get("scale") or 3)))
        base = clean_name(os.path.splitext(name)[0] or "slides")
        files = []
        if fmt == "pdf" and mode == "vector":
            pdf, used = ENGINE.render(css, slides, "vector", 1)
            out = unique_output(os.path.join(EXPORT_DIR, base + " - slides (vector).pdf"))
            with open(out, "wb") as f:
                f.write(pdf)
            files.append(os.path.basename(out))
        elif fmt == "pdf":
            shots, used = ENGINE.render(css, slides, "jpeg", scale)
            suffix = " - slides.pdf" if len(slides) > 1 or req.get("all") else " - %s.pdf" % clean_name(names[0] if names else "slide")
            out = unique_output(os.path.join(EXPORT_DIR, base + suffix))
            with open(out, "wb") as f:
                f.write(jpegs_to_pdf(shots, base))
            files.append(os.path.basename(out))
        else:
            shots, used = ENGINE.render(css, slides, "png", scale)
            if req.get("inline"):
                return {"ok": True, "engine": used, "images": ["data:image/png;base64," + base64.b64encode(s).decode() for s in shots]}
            for s, n in zip(shots, names or ["slide"] * len(shots)):
                out = unique_output(os.path.join(EXPORT_DIR, "%s - %s.png" % (base, clean_name(n))))
                with open(out, "wb") as f:
                    f.write(s)
                files.append(os.path.basename(out))
        log("exported %s in %.1fs with %s" % (", ".join(files) or "image", time.time() - t0, used))
        return {"ok": True, "files": files, "engine": used, "seconds": round(time.time() - t0, 1)}


# --------------------------------------------------------------------------- one-time setup
CFT_JSON = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
CFT_URLS = ["https://storage.googleapis.com/chrome-for-testing-public/{v}/{p}/chrome-headless-shell-{p}.zip",
            "https://cdn.playwright.dev/builds/cft/{v}/{p}/chrome-headless-shell-{p}.zip"]

def _platform():
    if sys.platform.startswith("win"):
        return "win64" if sys.maxsize > 2 ** 32 else "win32"
    if sys.platform == "darwin":
        import platform
        return "mac-arm64" if platform.machine() == "arm64" else "mac-x64"
    return "linux64"

def _playwright_chromium_version():
    """The Chromium version the installed Playwright package expects (so both match)."""
    try:
        import importlib.util
        spec = importlib.util.find_spec("playwright")
        if not spec:
            return None
        bj = os.path.join(os.path.dirname(spec.origin), "driver", "package", "browsers.json")
        with open(bj, encoding="utf-8") as f:
            data = json.load(f)
        for b in data.get("browsers", []):
            if b.get("name") in ("chromium-headless-shell", "chromium") and b.get("browserVersion"):
                return b["browserVersion"]
    except Exception:
        return None
    return None

def _download(url, dest):
    import ssl
    ctx = ssl.create_default_context()           # on Windows this trusts the company certificates in the Windows store
    req = urllib.request.Request(url, headers={"User-Agent": "SlideBuilder/" + VERSION})
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r, open(dest + ".part", "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done, last = 0, 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if time.time() - last > (0.5 if sys.stdout.isatty() else 3):
                last = time.time()
                pct = (" %3d%%" % (done * 100 // total)) if total else ""
                sys.stdout.write(("\r" if sys.stdout.isatty() else "") + "   %6.1f MB%s" % (done / 1048576.0, pct) + ("" if sys.stdout.isatty() else "\n")); sys.stdout.flush()
    sys.stdout.write("\r   %6.1f MB done        \n" % (done / 1048576.0))
    os.replace(dest + ".part", dest)

def setup():
    """Install the export engine into ./engine: Chrome for Testing (downloaded by Python, so company
    certificates and proxy settings from Windows are used) and, on Python 3.9+, the 'playwright' package."""
    plat = _platform()
    print("=" * 66)
    print(" Slide Builder - installing the export engine")
    print(" Python  : %s (%s)" % (sys.version.split()[0], sys.executable))
    print(" Folder  : %s" % ENGINE_DIR)
    print("=" * 66)
    os.makedirs(ENGINE_DIR, exist_ok=True)

    # 1) optional: playwright package (needs Python 3.9+)
    if sys.version_info >= (3, 9):
        in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "playwright", "--disable-pip-version-check"] + ([] if in_venv else ["--user"])
        print("\n1/3  Python package 'playwright' (optional, makes exports faster)")
        if subprocess.run(cmd).returncode != 0:
            print("   could not install it - continuing without it (exports still work)")
    else:
        print("\n1/3  Python %s is too old for the optional 'playwright' package (3.9+) - skipped, not needed." % sys.version.split()[0])

    # 2) Chrome for Testing (headless shell)
    on_network = is_network_path(ROOT)
    target_dir = LOCAL_ENGINE_DIR if on_network else ENGINE_DIR
    print("\n2/3  Chrome for Testing (headless, about 100 MB)")
    if on_network:
        print("   The app folder is on a network drive; programs cannot run reliably from there,")
        print("   so the engine goes on this PC: %s" % LOCAL_ENGINE_DIR)
    os.makedirs(target_dir, exist_ok=True)
    zips = [os.path.join(d, n) for d in (ENGINE_DIR, ROOT, BACKEND, LOCAL_ENGINE_DIR) if os.path.isdir(d) for n in os.listdir(d)
            if n.lower().startswith("chrome-headless-shell") and n.lower().endswith(".zip")]
    if _exe_in(target_dir):
        print("   already installed: %s" % _exe_in(target_dir))
    elif on_network and _exe_in(ENGINE_DIR) and not zips:
        print("   copying the engine from the network folder to this PC…")
        src = os.path.dirname(_exe_in(ENGINE_DIR))
        shutil.copytree(src, os.path.join(target_dir, os.path.basename(src)), dirs_exist_ok=True)
        print("   copied: %s" % _exe_in(target_dir))
    else:
        version = _playwright_chromium_version()
        urls = []
        if not zips:
            if not version:
                try:
                    with urllib.request.urlopen(urllib.request.Request(CFT_JSON, headers={"User-Agent": "SlideBuilder"}), timeout=30) as r:
                        version = json.load(r)["channels"]["Stable"]["version"]
                except Exception as e:
                    print("   could not look up the current version (%s)" % str(e).splitlines()[0])
            if version:
                urls = [u.format(v=version, p=plat) for u in CFT_URLS]
        zpath = os.path.join(target_dir, "chrome-headless-shell-%s.zip" % plat)
        ok = False
        if zips:
            zpath = zips[0]; ok = True
            print("   using the downloaded file %s" % zpath)
        for u in urls:
            print("   %s" % u)
            try:
                _download(u, zpath); ok = True; break
            except Exception as e:
                print("   failed: %s" % str(e).splitlines()[0])
        if not ok:
            print("\nThe download did not work from Python either. Do it by hand:")
            print("  1. open this link in Edge (it trusts the bank's certificates):\n     %s" % (urls[0] if urls else "https://googlechromelabs.github.io/chrome-for-testing/  (chrome-headless-shell, %s, Stable)" % plat))
            print("  2. save the .zip into the engine folder:\n     %s" % ENGINE_DIR)
            print("  3. run the installer again - it will unpack it.")
            return 1
        print("   unpacking…")
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            z.extractall(target_dir)
        if zpath.startswith(LOCAL_ENGINE_DIR) or (zpath.startswith(ENGINE_DIR) and not on_network and False):
            os.remove(zpath)
        exe = _exe_in(target_dir)
        if exe and not sys.platform.startswith("win"):
            os.chmod(exe, 0o755)
        print("   installed: %s" % exe)

    # 3) test every copy; if the one in the app folder is blocked, try a copy on this PC
    print("\n3/3  test render")
    page = ['<div style="width:1600px;height:900px;background:linear-gradient(90deg,#59A8FF,#FF9A7A)"></div>']
    def test(exe):
        e = CommandLineEngine(exe)
        png = e.render("", page, "png", 1)[0]
        print("   OK - %s rendered a test slide (%d KB)%s" % (exe, len(png) // 1024, (" using " + " ".join(e.extra)) if e.extra else ""))
        return True
    working = None
    for exe in find_local_engines():
        try:
            if test(exe):
                working = exe; break
        except Exception as ex:
            print("   %s\n     -> %s" % (exe, str(ex).splitlines()[0]))
    if not working and not _exe_in(LOCAL_ENGINE_DIR) and _exe_in(ENGINE_DIR):
        print("   trying a copy on this PC instead (%s)…" % LOCAL_ENGINE_DIR)
        src = os.path.dirname(_exe_in(ENGINE_DIR))
        shutil.copytree(src, os.path.join(LOCAL_ENGINE_DIR, os.path.basename(src)), dirs_exist_ok=True)
        try:
            if test(_exe_in(LOCAL_ENGINE_DIR)):
                working = _exe_in(LOCAL_ENGINE_DIR)
        except Exception as ex:
            print("     -> %s" % str(ex).splitlines()[0])
    if not working:
        print("\n   Chrome for Testing cannot run on this PC. This is a company restriction on running programs.")
        print("   Exports still work: they are rendered inside the app window (same look, image PDF).")
        print("   To enable the faster engine, ask IT to allow this program:\n   %s" % (find_local_engine() or LOCAL_ENGINE_DIR))
        return 1
    if sys.version_info >= (3, 9):
        try:
            import importlib, site
            importlib.invalidate_caches()
            try:
                sys.path.append(site.getusersitepackages())
            except Exception:
                pass
            pe = PlaywrightEngine([working])
            pe.render("", page, "jpeg", 1)
            pe.stop()
            print("   OK - Playwright works too (fastest mode).")
        except Exception as e:
            print("   Playwright is not usable (%s) - exports use Chrome for Testing directly." % str(e).splitlines()[0][:120])
    print("\nDone. Start the app with 'Start Slide Builder.bat'.")
    return 0


# --------------------------------------------------------------------------- main
def port_in_use_by_us(port):
    try:
        with LOCAL.open("http://127.0.0.1:%d/api/health" % port, timeout=1) as r:
            return json.load(r).get("app") == APP_NAME
    except Exception:
        return False

def main():
    global PORT
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="Slide Builder helper")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="do not open the app automatically")
    ap.add_argument("--setup", action="store_true", help="install the export engine (Playwright + Chromium) into this folder")
    args = ap.parse_args()
    if args.setup:
        sys.exit(setup())
    if not os.path.exists(APP_FILE):
        print("slide_builder.html must be in the same folder as this script.")
        sys.exit(1)
    for d in (EXPORT_DIR, ENGINE_DIR):
        os.makedirs(d, exist_ok=True)
    if ROOT != BACKEND:                     # files left over from the old flat layout move into backend
        for n in ("slide_builder_settings.txt",):
            old, new = os.path.join(ROOT, n), os.path.join(BACKEND, n)
            if os.path.isfile(old) and not os.path.exists(new):
                shutil.move(old, new); log("moved %s into the backend folder" % n)
    httpd = None
    for port in range(args.port, args.port + 20):
        if port_in_use_by_us(port):
            log("Slide Builder is already running on port %d - opening it." % port)
            if not args.no_browser:
                webbrowser.open("http://127.0.0.1:%d/" % port)
            return
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            PORT = port
            break
        except OSError:
            continue
    if not httpd:
        print("No free port found."); sys.exit(1)
    httpd.daemon_threads = True
    atexit.register(ENGINE.stop)
    url = "http://127.0.0.1:%d/" % PORT
    print("=" * 64)
    print(" Slide Builder %s" % VERSION)
    print(" Workbooks: %s" % ROOT)
    print(" Exports  : %s" % EXPORT_DIR)
    print(" Settings : %s" % os.path.basename(SETTINGS_FILE))
    print(" Engines  : " + ", ".join(e.name for e in ENGINE.engines if e.installed()) + " (testing in the background…)")
    if not find_local_engine():
        print(" Tip      : click the 'Export' status in the app, or run backend\\Install export engine.bat,")
        print("            to install Chrome for Testing into the engine folder (needed when Edge is locked down)")
    print(" Open     : %s" % url)
    print(" Keep this window open while you work. Ctrl+C to stop.")
    print("=" * 64)
    threading.Thread(target=ENGINE.warm, daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        ENGINE.stop()

if __name__ == "__main__":
    main()
