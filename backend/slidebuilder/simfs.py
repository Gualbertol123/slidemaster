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
    os.remove / os.unlink         os.listdir      os.makedirs      os.fsync

Reads, writes and closes of an already open handle are not charged; real SMB2 adds round trips
for those too (a small read is often compounded with the open, a close is one more), so the
simulation is a **lower bound** of the cost of a real share with the same round-trip time.

Only the names used by the storage modules (``store``, ``locks``, ``fsclock``, ``presence``,
``util``) are replaced - their module-level ``os`` / ``open`` are swapped for wrappers. The rest of
the helper (HTTP server, export engines, workbook reads) is untouched.

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
MODULES = ("store", "locks", "fsclock", "presence", "util")

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


def _rtt():
    _local.n = getattr(_local, "n", 0) + 1
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
        "listdir": _wrap_path(os.listdir), "makedirs": _wrap_path(os.makedirs),
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
        from . import fsclock, locks, presence, store, util   # noqa: F401  (make sure they are loaded)
        fake_os, fake_open = _make_os(), _wrap_path(_real_open)
        saved = []
        for name in MODULES:
            mod = sys.modules[__package__ + "." + name]
            saved.append((mod, mod.__dict__.get("os"), "open" in mod.__dict__, mod.__dict__.get("open")))
            mod.os = fake_os
            mod.open = fake_open              # module global shadows the builtin
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
