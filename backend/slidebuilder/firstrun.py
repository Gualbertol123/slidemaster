"""First-time set-up on a PC: ``python slide_builder.py --install`` ("Install Slide Builder.bat").

Made for locked-down corporate Windows PCs: no administrator rights, an SSL-inspecting proxy, the app
folder on a network share, PowerShell possibly in Constrained Language Mode, AppLocker on shares.

Steps (each prints OK / WARN / FAIL lines; a summary and the exit code follow):

  1. Python version, 64/32-bit, venv                         required (3.8+)
  2. pip available (else ``python -m ensurepip --user``)      optional
  3. Python packages from backend/requirements.txt             optional (Playwright makes exports faster)
     ``pip install --user -r`` (no --user inside a venv). Certificate errors behind SSL inspection are
     retried with ``--use-feature=truststore`` (Windows certificate store) when pip supports it; the
     installer never uses --trusted-host and never turns verification off.
  4. Export engine (installer.setup: Chrome for Testing)        optional (in-window export still works)
  5. Shared folder: lock file in data/locks, file in export/,  required
     file-server round trip (create+stat+replace+delete x20 -> median)
  6. Desktop shortcut: .lnk via PowerShell/WScript.Shell, or a small .bat when that is blocked
  7. Smoke test: start the helper on a free port, GET /api/ping, stop it   required

Exit code 0 when every required step passed (warnings allowed), 1 otherwise. Running it again is safe.
Only ASCII is printed (old Windows consoles).
"""
import os
import re
import socket
import statistics
import subprocess
import sys
import tempfile
import time

from . import APP_NAME, VERSION, paths
from .util import IS_WINDOWS, LOCAL, NO_WINDOW, current_host, current_user, safe_component

OK, WARN, FAIL, SKIP = "OK", "WARN", "FAIL", "SKIP"
MIN_PY = (3, 8)
PLAYWRIGHT_PY = (3, 9)
TESTED_UP_TO = (3, 14)          # information only - newer versions are accepted, never refused
SLOW_SHARE_MS = 30.0
REQUIREMENTS = os.path.join(paths.BACKEND, "requirements.txt")
SHORTCUT_NAME = "Slide Builder"
LAUNCHER_MARK = "rem Slide Builder desktop launcher"
CERT_PATTERNS = ("CERTIFICATE_VERIFY_FAILED", "certificate verify failed", "SSLCertVerificationError",
                 "unable to get local issuer certificate", "self signed certificate in certificate chain",
                 "self-signed certificate in certificate chain")


# --------------------------------------------------------------------------- output
class Report:
    """Collects the status of each step; prints as it goes."""

    def __init__(self, out=None):
        self.out = out or _print
        self.steps = []            # [no, title, status, required]
        self.current = None

    def step(self, no, title, required=False):
        self.current = [no, title, OK, required]
        self.steps.append(self.current)
        self.out("")
        self.out("[%d/7] %s" % (no, title))

    def _line(self, status, msg):
        self.out("  %-4s  %s" % (status, msg))
        rank = {OK: 0, SKIP: 0, WARN: 1, FAIL: 2}
        if self.current is not None and rank[status] > rank[self.current[2]]:
            self.current[2] = status

    def ok(self, msg):
        self._line(OK, msg)

    def warn(self, msg):
        self._line(WARN, msg)

    def fail(self, msg):
        self._line(FAIL, msg)

    def skip(self, msg):
        self._line(SKIP, msg)

    def note(self, msg):
        self.out("        " + msg)

    def failed(self):
        return any(s[2] == FAIL for s in self.steps)

    def summary(self):
        self.out("")
        self.out("=" * 66)
        self.out(" Summary")
        for no, title, status, required in self.steps:
            self.out("  %-4s  %d. %s%s" % (status, no, title, "" if required else " (optional)"))
        self.out("=" * 66)
        if self.failed():
            self.out(" Slide Builder is NOT ready on this PC - see the FAIL lines above.")
        elif any(s[2] == WARN for s in self.steps):
            self.out(" Slide Builder is ready. Some optional parts need attention (WARN) - the app works without them.")
        else:
            self.out(" Slide Builder is ready.")
        self.out(" Start it with the 'Slide Builder' shortcut on your desktop or 'Start Slide Builder.bat'.")
        self.out("=" * 66)
        return 1 if self.failed() else 0


def _print(s):
    try:
        print(s, flush=True)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode(), flush=True)


def run_cmd(cmd, env=None, timeout=None, echo=True):
    """Run a command, streaming its output when `echo`. Returns (returncode, output). Never raises
    for a missing or blocked program (returncode 127 / 126 then)."""
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             env=env, creationflags=NO_WINDOW)
    except FileNotFoundError as e:
        return 127, str(e)
    except OSError as e:                 # e.g. blocked by AppLocker / software restriction policy
        return 126, str(e)
    lines = []
    start = time.monotonic()
    for raw in iter(p.stdout.readline, b""):
        line = raw.decode("utf-8", "replace").rstrip()
        lines.append(line)
        if echo and line:
            _print("        | " + line)
        if timeout and time.monotonic() - start > timeout:
            p.kill()
            lines.append("(stopped after %d s)" % timeout)
            break
    p.stdout.close()
    return p.wait(), "\n".join(lines)


# --------------------------------------------------------------------------- 1. Python
def in_venv():
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def python_info():
    import platform
    return {"version": platform.python_version(), "info": tuple(sys.version_info[:3]),
            "impl": platform.python_implementation(), "bits": 64 if sys.maxsize > 2 ** 32 else 32,
            "venv": in_venv(), "exe": sys.executable,
            "store": "WindowsApps" in (sys.executable or "")}


def step_python(r, info=None):
    info = info or python_info()
    r.step(1, "Python", required=True)
    ver = info["info"]
    r.note("Detected: Python %s (%s, %d-bit)" % (info["version"], info["impl"], info["bits"]))
    r.note("Program : %s" % info["exe"])
    r.note("Virtual environment: %s" % ("yes" if info["venv"] else "no"))
    if tuple(ver[:2]) < MIN_PY:
        r.fail("Python %s is too old - Slide Builder needs Python 3.8 or newer." % info["version"])
        return False
    r.ok("Python %s is supported (3.8 or newer)." % info["version"])
    if tuple(ver[:2]) > TESTED_UP_TO:
        r.note("This version is newer than the ones this release was tested with (up to %d.%d); it is accepted." % TESTED_UP_TO)
        r.note("If an optional package has no build for it yet, step 3 only warns.")
    if tuple(ver[:2]) < PLAYWRIGHT_PY:
        r.warn("Python %s: the optional 'playwright' package needs 3.9+ and is skipped (exports still work)." % info["version"])
    if info["bits"] == 32 and IS_WINDOWS:
        r.note("32-bit Python works; the 64-bit version is recommended for large workbooks.")
    if info.get("store"):
        r.note("This is the Microsoft Store Python. It works; if exports misbehave, use the python.org version.")
    return True


# --------------------------------------------------------------------------- 2. pip
def parse_pip_version(text):
    m = re.search(r"\bpip (\d+)\.(\d+)(?:\.(\d+))?", text or "")
    return tuple(int(x or 0) for x in m.groups()) if m else None


def _v(ver):
    return ".".join(map(str, ver[:3] if ver[2:3] != (0,) else ver[:2]))


def pip_version(run):
    rc, out = run([sys.executable, "-m", "pip", "--version"], echo=False)
    return parse_pip_version(out) if rc == 0 else None


def step_pip(r, run):
    r.step(2, "pip")
    v = pip_version(run)
    if v:
        r.ok("pip %s" % _v(v))
        return v
    r.note("pip is not available - installing it with ensurepip (no administrator rights needed)...")
    cmd = [sys.executable, "-m", "ensurepip", "--upgrade"] + ([] if in_venv() else ["--user"])
    rc, out = run(cmd)
    v = pip_version(run)
    if v:
        r.ok("pip %s installed" % _v(v))
        return v
    r.warn("pip could not be installed (%s). Optional Python packages are skipped." % _last_line(out))
    return None


# --------------------------------------------------------------------------- 3. packages
def truststore_decision(pip_ver, py_ver=None):
    """How pip can use the Windows certificate store (company root CA of an SSL-inspecting proxy):

    "flag"        pip 22.2 - 24.1 on Python 3.10+: retry with --use-feature=truststore
    "default"     pip 24.2+ on Python 3.10+: pip already uses the system store - a retry cannot help
    "unsupported" anything else (older pip, or Python < 3.10)
    """
    py_ver = tuple(py_ver or sys.version_info[:2])
    if not pip_ver or py_ver[:2] < (3, 10) or tuple(pip_ver[:2]) < (22, 2):
        return "unsupported"
    if tuple(pip_ver[:2]) >= (24, 2):
        return "default"
    return "flag"


def is_cert_error(output):
    low = (output or "").lower()
    return any(p.lower() in low for p in CERT_PATTERNS)


def pip_install_cmd(requirements, venv, truststore=False):
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check",
           "--no-warn-script-location", "-r", requirements]
    if not venv:
        cmd.append("--user")
    if truststore:
        cmd.append("--use-feature=truststore")
    return cmd


def has_requirements(path):
    try:
        with open(path, encoding="utf-8") as f:
            return any(l.strip() and not l.strip().startswith("#") for l in f)
    except OSError:
        return False


def step_packages(r, run, pip_ver, requirements=REQUIREMENTS, venv=None, py_ver=None):
    r.step(3, "Python packages (Playwright: faster exports)")
    venv = in_venv() if venv is None else venv
    if not has_requirements(requirements):
        r.skip("nothing to install (%s is empty or missing)" % requirements)
        return True
    if not pip_ver:
        r.warn("skipped - pip is not available (exports still work without these packages).")
        return False
    r.note("pip install %s-r %s" % ("" if venv else "--user ", requirements))
    rc, out = run(pip_install_cmd(requirements, venv))
    if rc == 0:
        r.ok("packages installed / up to date")
        return True
    if is_cert_error(out):
        decision = truststore_decision(pip_ver, py_ver)
        r.note("The download was refused because of a certificate error - usually the company proxy")
        r.note("inspects HTTPS with its own certificate.")
        if decision == "flag":
            r.note("Retrying with the Windows certificate store (pip --use-feature=truststore)...")
            rc, out = run(pip_install_cmd(requirements, venv, truststore=True))
            if rc == 0:
                r.ok("packages installed (using the Windows certificate store)")
                return True
        elif decision == "default":
            r.note("This pip already uses the Windows certificate store, so the proxy's certificate is not there.")
        else:
            r.note("This pip/Python cannot use the Windows certificate store (needs pip 22.2+ and Python 3.10+).")
        r.warn("could not install the optional packages (certificate error). Exports still work.")
        r.note("Ask IT for the company root certificate as a .pem file and run once:")
        r.note("  set PIP_CERT=C:\\path\\to\\company-root.pem   then run this installer again.")
        return False
    r.warn("could not install the optional packages (%s). Exports still work." % _last_line(out))
    return False


# --------------------------------------------------------------------------- 4. export engine
def step_engine(r, setup_fn=None):
    r.step(4, "Export engine (Chrome for Testing)")
    if setup_fn is None:
        from .installer import setup as setup_fn
    try:
        rc = setup_fn(pip=False)
    except Exception as e:
        rc = 1
        r.note("installer error: %s" % _last_line(str(e)))
    if rc == 0:
        r.ok("export engine installed and tested")
        return True
    r.warn("the export engine is not available - exports are rendered inside the app window instead (same look).")
    return False


# --------------------------------------------------------------------------- 5. shared folder
def shared_folder_check(data=None, export=None, rounds=20):
    """Can this user lock and write in the shared folder, and how far away is the file server?"""
    from .locks import Lock
    data = data or paths.DATA
    export = export or paths.EXPORT_DIR
    me = safe_component("%s-%s" % (current_user(), current_host()), 80)
    res = {"lock": False, "export": False, "errors": [], "median_ms": None, "times_ms": []}
    try:
        os.makedirs(data, exist_ok=True)
        with Lock("firstrun-" + me, directory=os.path.join(data, "locks"), timeout=5.0):
            pass
        res["lock"] = True
    except Exception as e:
        res["errors"].append("lock file in %s: %s" % (os.path.join(data, "locks"), _last_line(str(e))))
    probe = os.path.join(export, ".sb-write-test-%s.tmp" % me)
    try:
        os.makedirs(export, exist_ok=True)
        with open(probe, "wb") as f:
            f.write(b"Slide Builder write test")
            f.flush()
            os.fsync(f.fileno())
        os.remove(probe)
        res["export"] = True
    except Exception as e:
        res["errors"].append("file in %s: %s" % (export, _last_line(str(e))))
        _remove(probe)
    if res["lock"]:
        folder = os.path.join(data, "locks")
        target = os.path.join(folder, ".rtt-%s-%d" % (me, os.getpid()))
        tmp = target + ".tmp"
        try:
            for _ in range(rounds):
                t0 = time.perf_counter()
                with open(tmp, "wb") as f:
                    f.write(b"rtt")
                os.stat(tmp)
                os.replace(tmp, target)
                os.remove(target)
                res["times_ms"].append((time.perf_counter() - t0) * 1000.0)
            res["median_ms"] = statistics.median(res["times_ms"])
        except Exception as e:
            res["errors"].append("round-trip probe: %s" % _last_line(str(e)))
        finally:
            _remove(tmp)
            _remove(target)
    return res


def step_shared(r, check=None):
    from .engines import is_network_path
    r.step(5, "Shared folder", required=True)
    net = is_network_path(paths.ROOT)
    r.note("App folder: %s (%s)" % (paths.ROOT, "network drive" if net else "local disk"))
    r.note("Data      : %s" % paths.DATA)
    res = (check or shared_folder_check)()
    if res["lock"]:
        r.ok("can create and delete lock files in data\\locks")
    if res["export"]:
        r.ok("can write files in export\\")
    for e in res["errors"]:
        r.fail(e)
    if res["errors"] and not (res["lock"] and res["export"]):
        r.note("Ask IT for 'Modify' rights on this folder for your account (all users of the app need it).")
    if res["median_ms"] is not None:
        ms = res["median_ms"]
        r.ok("file-server round trip: %.2f ms median (create+stat+replace+delete, %d runs)" % (ms, len(res["times_ms"])))
        if ms > SLOW_SHARE_MS:
            r.warn("the file server is slow from this PC (> %d ms): saving will be noticeably slower." % SLOW_SHARE_MS)
            r.note("A save needs about 3 of these cycles plus waiting for other people's saves on the same workbook.")
    return res["lock"] and res["export"]


# --------------------------------------------------------------------------- 6. desktop shortcut
def desktop_dir():
    if IS_WINDOWS:
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(1024)
            # CSIDL_DESKTOPDIRECTORY: follows OneDrive / folder redirection, no PowerShell needed
            if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf) == 0 and buf.value:
                return buf.value
        except Exception:
            pass
    p = os.path.join(os.path.expanduser("~"), "Desktop")
    return p if os.path.isdir(p) else None


PS_SHORTCUT = ("$ErrorActionPreference='Stop';"
               "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:SB_LNK);"
               "$s.TargetPath=$env:SB_TARGET;$s.WorkingDirectory=$env:SB_DIR;"
               "$s.Description='Slide Builder';$s.Save()")


def launcher_bat(root):
    """Contents of the fallback desktop launcher (CRLF line endings are added when written)."""
    go = ('pushd "%s"' % root) if root.startswith("\\\\") else ('cd /d "%s"' % root)   # cmd cannot cd to a UNC path
    return "\r\n".join([
        "@echo off",
        LAUNCHER_MARK + ' (written by "Install Slide Builder.bat"; safe to delete)',
        go + ' || (echo The Slide Builder folder cannot be reached: "%s" & pause & exit /b 1)' % root,
        'call "Start Slide Builder.bat"',
        "",
    ])


def _write_launcher(path, root):
    text = launcher_bat(root)
    try:
        data = text.encode("oem" if IS_WINDOWS else "utf-8")      # cmd reads .bat files in the OEM code page
    except (LookupError, UnicodeEncodeError):
        data = ("@chcp 65001 >nul\r\n" + text).encode("utf-8")
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _is_our_launcher(path):
    try:
        with open(path, "rb") as f:
            return LAUNCHER_MARK.encode() in f.read(4096)
    except OSError:
        return False


def create_shortcut(desktop, root, run, windows=None):
    """Returns (kind, path, reason): kind "lnk" or "bat"; reason says why the .lnk was not possible."""
    windows = IS_WINDOWS if windows is None else windows
    target = os.path.join(root, "Start Slide Builder.bat")
    lnk = os.path.join(desktop, SHORTCUT_NAME + ".lnk")
    bat = os.path.join(desktop, SHORTCUT_NAME + ".bat")
    reason = None
    if windows:
        env = dict(os.environ, SB_LNK=lnk, SB_TARGET=target, SB_DIR=root)
        rc, out = run(["powershell", "-NoProfile", "-NonInteractive", "-Command", PS_SHORTCUT], env=env, timeout=60, echo=False)
        if rc == 0 and os.path.isfile(lnk):
            if os.path.exists(bat) and _is_our_launcher(bat):
                _remove(bat)                      # an earlier run had to use the fallback
            return "lnk", lnk, None
        reason = _last_line(out) or "PowerShell returned %s" % rc
    _write_launcher(bat, root)
    return "bat", bat, reason


def step_shortcut(r, run, desktop=None, windows=None):
    windows = IS_WINDOWS if windows is None else windows
    r.step(6, "Desktop shortcut")
    if not windows:
        r.skip("not Windows - no desktop shortcut created (start with: python backend/slide_builder.py)")
        return True
    desktop = desktop or desktop_dir()
    if not desktop or not os.path.isdir(desktop):
        r.warn("your desktop folder was not found - start the app with 'Start Slide Builder.bat'.")
        return False
    try:
        kind, path, reason = create_shortcut(desktop, paths.ROOT, run, windows=True)
    except OSError as e:
        r.warn("could not create the shortcut (%s) - start the app with 'Start Slide Builder.bat'." % _last_line(str(e)))
        return False
    if kind == "lnk":
        r.ok("shortcut created: %s" % path)
    else:
        r.note("A Windows shortcut could not be created (PowerShell/COM blocked: %s)." % (reason or "?"))
        r.ok("created a small launcher instead: %s" % path)
    return True


# --------------------------------------------------------------------------- 7. smoke test
def free_port():
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def smoke_test(timeout=45.0):
    """Start the helper with --no-browser on a free port, GET /api/ping, stop it. Returns (ok, message, page_ok)."""
    import json
    port = free_port()
    env = dict(os.environ, SLIDEBUILDER_ENGINES="none", PYTHONUNBUFFERED="1")
    env.pop("SLIDEBUILDER_SIM_FS_MS", None)
    log = tempfile.TemporaryFile()
    p = subprocess.Popen([sys.executable, "-u", paths.ENTRY, "--port", str(port), "--no-browser"],
                         stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, cwd=paths.BACKEND,
                         env=env, creationflags=NO_WINDOW)
    try:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if p.poll() is not None:
                break
            try:
                with LOCAL.open("http://127.0.0.1:%d/api/ping" % port, timeout=2) as resp:
                    body = json.load(resp)
                if body.get("app") == APP_NAME:
                    page_ok = True
                    try:
                        LOCAL.open("http://127.0.0.1:%d/" % port, timeout=5).close()
                    except Exception:
                        page_ok = False
                    return True, "the helper answered on port %d (version %s)" % (port, body.get("version")), page_ok
            except Exception:
                time.sleep(0.2)
        log.seek(0)
        tail = [l for l in log.read().decode("utf-8", "replace").splitlines() if l.strip()][-6:]
        return False, "the helper did not answer%s" % ((":\n          " + "\n          ".join(tail)) if tail else ""), False
    finally:
        if p.poll() is None:
            p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait(5)
        log.close()


def step_smoke(r, smoke=None):
    r.step(7, "Self-test (start the helper, ping it, stop it)", required=True)
    ok, msg, page_ok = (smoke or smoke_test)()
    if ok:
        r.ok(msg)
        if not page_ok:
            r.warn("the app page (backend\\slide_builder.html) is missing - copy the complete Slide Builder folder.")
    else:
        r.fail(msg)
    return ok


# --------------------------------------------------------------------------- main
def run_install(run=None, setup_fn=None, desktop=None, windows=None, smoke=None, check=None, out=None):
    run = run or run_cmd
    r = Report(out)
    r.out("=" * 66)
    r.out(" Slide Builder %s - first-time set-up for %s on %s" % (VERSION, current_user(), current_host()))
    r.out(" Folder: %s" % paths.ROOT)
    r.out(" Safe to run again at any time.")
    r.out("=" * 66)
    if not step_python(r):
        return r.summary()
    pip_ver = step_pip(r, run)
    step_packages(r, run, pip_ver)
    step_engine(r, setup_fn)
    for d in (paths.EXPORT_DIR, paths.DATA):
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass                                    # reported by step 5
    step_shared(r, check)
    step_shortcut(r, run, desktop=desktop, windows=windows)
    step_smoke(r, smoke)
    return r.summary()


def _last_line(text):
    lines = [l.strip() for l in str(text or "").splitlines() if l.strip()]
    return lines[-1][:200] if lines else ""


def _remove(p):
    try:
        os.remove(p)
    except OSError:
        pass
