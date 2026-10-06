"""The file server's clock.

Ages of shared files (stale locks, backup spacing, presence heartbeats) must not compare a file's
mtime - stamped by the SMB server - with this PC's clock: domain PCs can be minutes apart
(Kerberos tolerates 5 min), and a PC whose clock runs ahead would break live locks.

``fs_now(directory)`` = ``time.time()`` + the offset of the server that holds ``directory``. The
offset is measured by writing a small probe file there (``.clock-<host>-<pid>``; written, not
``utime``'d - utime would stamp the *local* time), reading its mtime and deleting it. It is cached
per directory for 30 s (cache age measured with the monotonic clock).
"""
import os
import threading
import time

from .util import current_host, safe_component

CACHE_SECONDS = 30.0
_cache = {}                     # directory -> (offset, monotonic time measured)
_guard = threading.Lock()


def measure_offset(directory):
    """server time - local time for `directory` (0.0 if the probe cannot be written)."""
    probe = os.path.join(directory, ".clock-%s-%d" % (safe_component(current_host(), 40), os.getpid()))
    try:
        os.makedirs(directory, exist_ok=True)
        t0 = time.time()
        with open(probe, "wb") as f:
            f.write(b"clock")
            f.flush()
            os.fsync(f.fileno())
        t1 = time.time()
        mtime = os.stat(probe).st_mtime
        return mtime - (t0 + t1) / 2.0
    except OSError:
        return 0.0
    finally:
        try:
            os.remove(probe)
        except OSError:
            pass


def offset(directory):
    key = os.path.normcase(os.path.abspath(directory))
    now = time.monotonic()
    with _guard:
        hit = _cache.get(key)
        if hit and now - hit[1] < CACHE_SECONDS:
            return hit[0]
    off = measure_offset(directory)
    with _guard:
        _cache[key] = (off, now)
    return off


def fs_now(directory):
    """Current time (seconds) on the clock of the file server holding `directory`."""
    return time.time() + offset(directory)


def fs_now_ms(directory):
    return int(fs_now(directory) * 1000)


def reset():
    """Forget the measured offsets (tests, or after the PC clock was corrected)."""
    with _guard:
        _cache.clear()
