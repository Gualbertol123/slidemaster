"""Export engines: find a browser, self-test it, render slides to PNG/JPEG/PDF.

Engines are tried in order, each must pass a self-test first (in the background at start-up):
Playwright (optional package) -> DevTools websocket -> plain command-line headless mode.
Ported unchanged from v2.3 apart from the module split, the paths module and C9 (the engine mirror
runs under a lock on this PC).
"""
import base64
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

from . import paths
from .cdp import CDP
from .locks import Lock
from .paths import PAGE_H_IN, PAGE_W_IN, SLIDE_H, SLIDE_W
from .pdf import png_crop_height, png_first_column
from .util import NO_WINDOW, file_url, log

if os.path.isdir(paths.ENGINE_DIR):
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", paths.ENGINE_DIR)


def is_network_path(p):
    p = os.path.abspath(p)
    if os.environ.get("SLIDEBUILDER_FORCE_NETWORK"):          # testing aid
        return p.startswith(paths.ROOT)
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
        dirs[:] = [d for d in dirs if not d.endswith(".part")]      # a copy that is still running / was interrupted
        for exe in ("chrome-headless-shell.exe", "chrome-headless-shell", "chrome.exe"):
            if exe in files:
                return os.path.join(root, exe)
    return None

def find_local_engines():
    """Chrome for Testing copies: the one on this PC first, then the one in the app's engine folder."""
    out = []
    for d in (paths.LOCAL_ENGINE_DIR, paths.ENGINE_DIR):
        e = _exe_in(d)
        if e and e not in out:
            out.append(e)
    return out

def find_local_engine():
    l = find_local_engines()
    return l[0] if l else None

def local_install_lock(timeout=10.0):
    """Lock on this PC around everything that writes the local engine copy (installer, mirror) - C9."""
    return Lock("install", directory=paths.LOCAL_LOCK_DIR, timeout=timeout, keepalive=True)

def mirror_engine_locally():
    """App folder on a network drive (e.g. T:\\): Chrome for Testing is copied once to this PC, because
    programs started from network shares are often blocked or cannot start their sandbox."""
    src = _exe_in(paths.ENGINE_DIR)
    if not src or not is_network_path(src) or _exe_in(paths.LOCAL_ENGINE_DIR):
        return False
    with local_install_lock():                 # the installer may be writing the same folder right now
        if _exe_in(paths.LOCAL_ENGINE_DIR):
            return False
        folder = os.path.dirname(src)
        dst = os.path.join(paths.LOCAL_ENGINE_DIR, os.path.basename(folder))
        log("copying Chrome for Testing from the network folder to this PC (%s) - one time only…" % paths.LOCAL_ENGINE_DIR)
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
        if "none" in only:     # SLIDEBUILDER_ENGINES=none: no engines at all (tests, in-window export only)
            engines = []
        elif only:   # e.g. SLIDEBUILDER_ENGINES=cli  (playwright, devtools, cli)
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
    if exe and (os.path.abspath(exe).startswith(paths.ENGINE_DIR) or os.path.abspath(exe).startswith(paths.LOCAL_ENGINE_DIR)):
        return "Chrome for Testing" + (" (this PC)" if os.path.abspath(exe).startswith(paths.LOCAL_ENGINE_DIR) else "")
    n = os.path.basename(exe or "").lower()
    return "Edge" if "edge" in n else ("Chrome" if "chrome" in n else "Chromium")

