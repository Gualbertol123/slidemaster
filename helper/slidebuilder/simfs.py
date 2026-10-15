"""SIMULATION ONLY - adds network-share latency to the helper's data-folder file operations.

Used by ``tools/loadtest.py`` to answer "what happens to saving when the shared folder is N ms away".
It is installed only when the environment variable ``SLIDEBUILDER_SIM_FS_MS`` is set when the
helper starts (``main.py``); a normal start never imports this module.

Model
-----
Every file-system call that would be a round trip to the SMB server for a path inside the data
folder sleeps ``SLIDEBUILDER_SIM_FS_MS`` milliseconds (+-25 % jitter) before doing the real call:

    open() / os.open()            (create or open for read/write)
    os.replace / os.rename        os.stat / os.path.exists / os.path.getmtime / os.path.isfile
    os.remove / os.unlink         os.listdir      os.scandir       os.makedirs      os.fsync

A directory listing (listdir / scandir) is one charge: on Windows the listing also carries every
entry's size and times, so ``DirEntry.stat()`` costs no further round trip (and is not charged).

For v3's modules, reads, writes and closes of an already open handle are not charged; real SMB2 adds
round trips for those too (a small read is often compounded with the open, a close is one more), so
for them the simulation is a **lower bound** of the cost of a real share with the same round-trip time.
For the decks of Slide Builder 4 (``decks``, ``migrate_v3``) every write (``os.write``) and every read on
an open handle is charged too, as docs/next/04 §2.5's model does: an append is write + flush = 2 round
trips on a handle that is already open, a tail is open + read per journal.

Only the names used by the storage modules (``store``, ``locks``, ``fsclock``, ``presence``,
``util``, ``decks``, ``migrate_v3``) are replaced - their module-level ``os`` / ``open`` are swapped for
wrappers. The rest of the helper (HTTP server, exports, workbook reads) is untouched.

The wrappers also count the charged calls per thread (``count()``); with ``SLIDEBUILDER_SIM_FS_MS=0``
nothing sleeps, but the counts still tell how many SMB round trips one request costs.
"""
import builtins
import os
import random
import sys
import threading
import time
import types

from . import paths

ENV = "SLIDEBUILDER_SIM_FS_MS"
MODULES = ("store", "locks", "fsclock", "presence", "util", "decks", "migrate_v3")
HANDLE_MODULES = ("decks", "migrate_v3")         # reads and writes on open handles are charged too

_state = {"ms": 0.0, "installed": None}
_local = threading.local()
_real_open = builtins.open


def enabled():
    return os.environ.get(ENV) is not None


def installed():
    return _state["installed"] is not None


def count():
    """Charged file-system calls made by this thread so far."""
    return getattr(_local, "n", 0)


def _in_data(p):
    try:
        p = os.fspath(p)
    except TypeError:
        return False                       # file descriptors etc.
    if isinstance(p, bytes):
        p = os.fsdecode(p)
    data = paths.DATA
    if not data:
        return False
    p = os.path.abspath(p)
    return p == data or p.startswith(data.rstrip(os.sep) + os.sep)


_total = [0]
_total_lock = threading.Lock()


def total():
    """Charged file-system calls of every thread (a tail reads its journals in parallel threads)."""
    return _total[0]


def _rtt():
    _local.n = getattr(_local, "n", 0) + 1
    with _total_lock:
        _total[0] += 1
    ms = _state["ms"]
    if ms > 0:
        time.sleep(ms * random.uniform(0.75, 1.25) / 1000.0)


def _wrap_path(fn):
    def wrapper(path, *a, **kw):
        if _in_data(path):
            _rtt()
        return fn(path, *a, **kw)
    wrapper.__name__ = getattr(fn, "__name__", "wrapper")
    wrapper.__wrapped__ = fn
    return wrapper


def _wrap_two(fn):
    def wrapper(src, dst, *a, **kw):
        if _in_data(src) or _in_data(dst):
            _rtt()
        return fn(src, dst, *a, **kw)
    wrapper.__name__ = getattr(fn, "__name__", "wrapper")
    wrapper.__wrapped__ = fn
    return wrapper


def _fsync(fd):
    # only the storage modules are patched, and they fsync data-folder files (export files written
    # through util.write_atomic are the exception; they are not part of a load test)
    _rtt()
    return os.fsync(fd)


class _Proxy(types.ModuleType):
    """A stand-in for ``os`` / ``os.path`` inside one module: overridden names, the rest delegated."""

    def __init__(self, real, overrides):
        super().__init__(real.__name__)
        self.__dict__.update(overrides)
        self.__dict__["_real"] = real

    def __getattr__(self, name):
        return getattr(self.__dict__["_real"], name)


class _ChargedFile:
    """a file object whose reads and writes cost a round trip each (the decks' journal reads)"""

    def __init__(self, f):
        self._f = f

    def read(self, *a):
        _rtt()
        return self._f.read(*a)

    def write(self, *a):
        _rtt()
        return self._f.write(*a)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._f.close()
        return False

    def __getattr__(self, name):
        return getattr(self._f, name)


def _charged_open(path, *a, **kw):
    if not _in_data(path):
        return _real_open(path, *a, **kw)
    _rtt()                                     # the open
    return _ChargedFile(_real_open(path, *a, **kw))


_data_fds = set()


def _make_handle_os():
    """os for the decks: os.open remembers data-folder handles; os.write on them is charged"""
    base = _make_os()

    def _open(path, *a, **kw):
        fd = base.open(path, *a, **kw)
        if _in_data(path):
            _data_fds.add(fd)
        return fd

    def _write(fd, data):
        if fd in _data_fds:
            _rtt()
        return os.write(fd, data)

    def _close(fd):
        _data_fds.discard(fd)
        return os.close(fd)
    overrides = {k: v for k, v in base.__dict__.items() if not k.startswith("_")}
    return _Proxy(os, dict(overrides, open=_open, write=_write, close=_close))


def _make_os():
    p = os.path
    path_proxy = _Proxy(p, {
        "exists": _wrap_path(p.exists), "getmtime": _wrap_path(p.getmtime),
        "isfile": _wrap_path(p.isfile), "isdir": _wrap_path(p.isdir), "getsize": _wrap_path(p.getsize),
    })
    return _Proxy(os, {
        "path": path_proxy,
        "open": _wrap_path(os.open), "stat": _wrap_path(os.stat),
        "replace": _wrap_two(os.replace), "rename": _wrap_two(os.rename),
        "remove": _wrap_path(os.remove), "unlink": _wrap_path(os.unlink),
        "listdir": _wrap_path(os.listdir), "scandir": _wrap_path(os.scandir), "makedirs": _wrap_path(os.makedirs),
        "fsync": _fsync,
    })


def install(ms=None):
    """Patch the storage modules. `ms` defaults to the environment variable. Returns the delay used."""
    if ms is None:
        try:
            ms = float(os.environ.get(ENV) or 0)
        except ValueError:
            ms = 0.0
    _state["ms"] = max(0.0, float(ms))
    if _state["installed"] is None:
        from . import decks, fsclock, locks, migrate_v3, presence, store, util   # noqa: F401  (make sure they are loaded)
        fake_os, fake_open = _make_os(), _wrap_path(_real_open)
        handle_os = _make_handle_os()
        saved = []
        for name in MODULES:
            mod = sys.modules[__package__ + "." + name]
            saved.append((mod, mod.__dict__.get("os"), "open" in mod.__dict__, mod.__dict__.get("open")))
            mod.os = handle_os if name in HANDLE_MODULES else fake_os
            mod.open = _charged_open if name in HANDLE_MODULES else fake_open      # module global shadows the builtin
        _state["installed"] = saved
    return _state["ms"]


def uninstall():
    saved = _state["installed"]
    if not saved:
        return
    for mod, real_os, had_open, real_open in saved:
        mod.os = real_os
        if had_open:
            mod.open = real_open
        else:
            mod.__dict__.pop("open", None)
    _state["installed"] = None
    _state["ms"] = 0.0
