"""Export engine installer (``slide_builder.py --setup`` / "Install export engine.bat") and the
background runner used by ``POST /api/engine/install``.

C9: the installer runs under lock files - always the lock on this PC (it may write the local engine
copy, which the start-up mirror also writes) and, when the app folder is not on a network drive
(engine goes into the shared engine\\ folder), also the shared lock ``data/locks/install.lock``.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

from . import VERSION, paths
from .engines import CommandLineEngine, PlaywrightEngine, _exe_in, find_local_engine, find_local_engines, is_network_path, local_install_lock
from .locks import Lock, LockTimeout
from .util import NO_WINDOW

INSTALL = {"running": False, "done": False, "ok": None, "lines": []}
_install_guard = threading.Lock()


def start_install(exporter):
    """Run 'slide_builder.py --setup' in the background and keep its output for the app."""
    with _install_guard:
        if INSTALL["running"]:
            return dict(INSTALL)
        INSTALL.update(running=True, done=False, ok=None, lines=["Starting the installer…"])

    def work():
        try:
            p = subprocess.Popen([sys.executable, "-u", paths.ENTRY, "--setup"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 cwd=paths.BACKEND, creationflags=NO_WINDOW)
            for raw in iter(p.stdout.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip()
                if line:
                    INSTALL["lines"] = (INSTALL["lines"] + [line])[-200:]
            INSTALL["ok"] = p.wait() == 0
        except Exception as e:
            INSTALL["lines"].append("Installer error: %s" % e); INSTALL["ok"] = False
        finally:
            INSTALL.update(running=False, done=True)
            if exporter is not None:
                exporter.reload()
    threading.Thread(target=work, daemon=True).start()
    return dict(INSTALL)


def install_status():
    return dict(INSTALL, lines=list(INSTALL["lines"]))


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

def _setup(pip=True):
    """Install the export engine into ./engine: Chrome for Testing (downloaded by Python, so company
    certificates and proxy settings from Windows are used) and, on Python 3.9+, the 'playwright' package."""
    plat = _platform()
    print("=" * 66)
    print(" Slide Builder - installing the export engine")
    print(" Python  : %s (%s)" % (sys.version.split()[0], sys.executable))
    print(" Folder  : %s" % paths.ENGINE_DIR)
    print("=" * 66)
    os.makedirs(paths.ENGINE_DIR, exist_ok=True)

    # 1) optional: playwright package (needs Python 3.9+); --install does this itself (requirements.txt)
    if not pip:
        print("\n1/3  Python packages: done by the first-time installer - skipped here.")
    elif sys.version_info >= (3, 9):
        in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "playwright", "--disable-pip-version-check"] + ([] if in_venv else ["--user"])
        print("\n1/3  Python package 'playwright' (optional, makes exports faster)")
        if subprocess.run(cmd).returncode != 0:
            print("   could not install it - continuing without it (exports still work)")
    else:
        print("\n1/3  Python %s is too old for the optional 'playwright' package (3.9+) - skipped, not needed." % sys.version.split()[0])

    # 2) Chrome for Testing (headless shell)
    on_network = is_network_path(paths.ROOT)
    target_dir = paths.LOCAL_ENGINE_DIR if on_network else paths.ENGINE_DIR
    print("\n2/3  Chrome for Testing (headless, about 100 MB)")
    if on_network:
        print("   The app folder is on a network drive; programs cannot run reliably from there,")
        print("   so the engine goes on this PC: %s" % paths.LOCAL_ENGINE_DIR)
    os.makedirs(target_dir, exist_ok=True)
    zips = [os.path.join(d, n) for d in (paths.ENGINE_DIR, paths.ROOT, paths.BACKEND, paths.LOCAL_ENGINE_DIR) if os.path.isdir(d) for n in os.listdir(d)
            if n.lower().startswith("chrome-headless-shell") and n.lower().endswith(".zip")]
    if _exe_in(target_dir):
        print("   already installed: %s" % _exe_in(target_dir))
    elif on_network and _exe_in(paths.ENGINE_DIR) and not zips:
        print("   copying the engine from the network folder to this PC…")
        src = os.path.dirname(_exe_in(paths.ENGINE_DIR))
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
            print("  2. save the .zip into the engine folder:\n     %s" % paths.ENGINE_DIR)
            print("  3. run the installer again - it will unpack it.")
            return 1
        print("   unpacking…")
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            z.extractall(target_dir)
        if zpath.startswith(paths.LOCAL_ENGINE_DIR) or (zpath.startswith(paths.ENGINE_DIR) and not on_network and False):
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
    if not working and not _exe_in(paths.LOCAL_ENGINE_DIR) and _exe_in(paths.ENGINE_DIR):
        print("   trying a copy on this PC instead (%s)…" % paths.LOCAL_ENGINE_DIR)
        src = os.path.dirname(_exe_in(paths.ENGINE_DIR))
        shutil.copytree(src, os.path.join(paths.LOCAL_ENGINE_DIR, os.path.basename(src)), dirs_exist_ok=True)
        try:
            if test(_exe_in(paths.LOCAL_ENGINE_DIR)):
                working = _exe_in(paths.LOCAL_ENGINE_DIR)
        except Exception as ex:
            print("     -> %s" % str(ex).splitlines()[0])
    if not working:
        print("\n   Chrome for Testing cannot run on this PC. This is a company restriction on running programs.")
        print("   Exports still work: they are rendered inside the app window (same look, image PDF).")
        print("   To enable the faster engine, ask IT to allow this program:\n   %s" % (find_local_engine() or paths.LOCAL_ENGINE_DIR))
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


def _holder(e):
    h = e.holder if isinstance(e.holder, dict) else {}
    return "%s@%s" % (h.get("user", "?"), h.get("host", "?")) if h else "another process"


def setup(pip=True):
    """Install the export engine, holding the install locks for the whole run (C9).
    pip=False: do not install the 'playwright' package (the first-time installer already did)."""
    on_network = is_network_path(paths.ROOT)
    held = []
    try:
        try:
            if not on_network:                   # the engine goes into the shared engine folder
                held.append(Lock("install", keepalive=True).acquire())
            held.append(local_install_lock().acquire())
        except LockTimeout as e:
            print("=" * 66)
            print(" Another installation of the export engine is running (%s)." % _holder(e))
            print(" Wait until it has finished, then run the installer again if exports still do not work.")
            print("=" * 66)
            return 1
        return _setup(pip=pip)
    finally:
        for l in reversed(held):
            l.release()
