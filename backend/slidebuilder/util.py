"""Small helpers shared by every module: logging, identity, names, paths, atomic file writes."""
import datetime as _dt
import getpass
import hashlib
import os
import re
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid

NO_WINDOW = 0x08000000 if sys.platform.startswith("win") else 0
IS_WINDOWS = sys.platform.startswith("win")

# Local requests must never go through a corporate proxy (that is what made the engine time out).
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _k in ("NO_PROXY", "no_proxy"):
    os.environ[_k] = ",".join(x for x in (os.environ.get(_k, ""), "127.0.0.1", "localhost", "::1") if x)


def log(*a):
    msg = " ".join(str(x) for x in (_dt.datetime.now().strftime("%H:%M:%S"),) + a)
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:               # old Windows consoles (cp1252/cp850)
        print(msg.encode("ascii", "replace").decode(), flush=True)
    except Exception:
        pass


# --------------------------------------------------------------------------- identity (ARCHITECTURE §2)
def current_user():
    env = os.environ.get("SLIDEBUILDER_USER")
    if env:
        return env
    try:
        return getpass.getuser() or "unknown"
    except Exception:
        return os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"


def current_host():
    env = os.environ.get("SLIDEBUILDER_HOST")
    if env:
        return env
    try:
        return socket.gethostname() or "localhost"
    except Exception:
        return "localhost"


def now_ms():
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- names
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")


def safe_component(s, limit=60):
    """Characters Windows (and SMB) accept in a file name; everything else becomes '_'."""
    return _UNSAFE.sub("_", s or "")[:limit] or "_"


def doc_key(name):
    """ARCHITECTURE §3: safe name (max 60 chars) + '-' + first 10 hex chars of sha1(name.lower())."""
    return safe_component(name, 60) + "-" + hashlib.sha1((name or "").lower().encode("utf-8")).hexdigest()[:10]


def clean_name(s):
    s = re.sub(r'[\\/:*?"<>|]+', "_", s).strip().strip(".")
    return s or "slide"


def valid_workbook_name(name):
    """A workbook is identified by its file name (no folders, no control characters)."""
    return (isinstance(name, str) and 0 < len(name) <= 255 and name.strip() == name and name not in (".", "..")
            and not re.search(r'[\\/\x00-\x1f]', name))


def safe_path(name, base):
    """Resolve a (decoded) file name inside a folder; refuse anything that escapes it."""
    base = os.path.realpath(base)
    name = name.replace("\\", "/").lstrip("/")
    if "\x00" in name:
        raise PermissionError("outside folder")
    p = os.path.realpath(os.path.join(base, name))
    if not (p == base or p.startswith(base.rstrip(os.sep) + os.sep)):
        raise PermissionError("outside folder")
    return p


def file_url(path):
    return "file:///" + urllib.parse.quote(os.path.abspath(path).replace("\\", "/").lstrip("/"), safe="/:")


def open_with_os(path):
    if IS_WINDOWS:
        os.startfile(path)  # noqa
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


# --------------------------------------------------------------------------- atomic writes (ARCHITECTURE §4)
class WriteFailed(OSError):
    """The file could not be replaced (typically locked by another program on Windows)."""


def replace_retry(src, dst, attempts=20, delay=0.1):
    """os.replace, retried for Windows sharing violations (AV scanners, editors, a reader on SMB)."""
    last = None
    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as e:
            last = e
        except OSError as e:                      # e.g. ERROR_SHARING_VIOLATION surfaces as a plain OSError
            if getattr(e, "winerror", None) not in (5, 32, 33):
                raise
            last = e
        time.sleep(delay)
    raise WriteFailed("%s is locked by another program (%s)" % (os.path.basename(dst), last))


def write_tmp(path, data):
    """Write bytes to a unique temp file next to `path` (flush + fsync) and return its name."""
    tmp = "%s.%s.tmp" % (path, uuid.uuid4().hex)
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except BaseException:
        remove_quietly(tmp)
        raise
    return tmp


def write_atomic(path, data):
    """unique tmp -> fsync -> os.replace (retried). Readers see the old or the new file, never a mix."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = write_tmp(path, data)
    try:
        replace_retry(tmp, path)
    except BaseException:
        remove_quietly(tmp)
        raise


def remove_quietly(path):
    try:
        os.remove(path)
        return True
    except OSError:
        return False
