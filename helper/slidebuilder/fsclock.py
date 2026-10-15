"""The file server's clock.

Ages of shared files (stale locks, backup spacing, presence heartbeats) must not compare a file's
mtime - stamped by the SMB server - with this PC's clock: domain PCs can be minutes apart
(Kerberos tolerates 5 min), and a PC whose clock runs ahead would break live locks.

``fs_now(directory)`` = ``time.time()`` + the offset of the server that holds ``directory``. The
offset is measured by writing a small probe file there (``.clock-<host>-<pid>``; written, not
``utime``'d - utime would stamp the *local* time), reading its mtime and deleting it. It is cached
per directory for 30 s (cache age measured with the monotonic clock), and measured again at once when the PC
clock was set meanwhile (wall and monotonic clocks disagree). A probe that cannot be written leaves the offset
*unknown* (``trusted`` is False; tried again after 1 s); the last known offset, or 0, is used meanwhile.
"""
import os
import threading
import time

from .util import current_host, safe_component

CACHE_SECONDS = 30.0
RETRY_SECONDS = 1.0             # a probe that failed is tried again this soon (its offset is unknown meanwhile)
JUMP_SECONDS = 2.0              # the PC clock moved by more than this against the monotonic clock: measure again now
_cache = {}                     # directory -> (offset, monotonic time measured, wall time measured, measured ok)
_guard = threading.Lock()


def measure_offset(directory):
    """server time - local time for `directory`; None if the probe cannot be written (the offset is unknown)."""
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
        return None
    finally:
        try:
            os.remove(probe)
        except OSError:
            pass


def _fresh(hit, mono, wall):
    """a cached measurement still good: not too old, and the PC clock was not set since (wall and monotonic agree)"""
    if not hit:
        return False
    if abs((wall - hit[2]) - (mono - hit[1])) > JUMP_SECONDS:
        return False                            # the PC clock was corrected (or jumped): the offset is wrong now
    return mono - hit[1] < (CACHE_SECONDS if hit[3] else RETRY_SECONDS)


def _measure(directory, key):
    off = measure_offset(directory)
    with _guard:
        prev = _cache.get(key)
        if off is None:                          # unknown: the last known offset, if any, until the next try
            entry = ((prev[0] if prev else 0.0), time.monotonic(), time.time(), False)
        else:
            entry = (off, time.monotonic(), time.time(), True)
        _cache[key] = entry
    return entry[0]


def offset(directory):
    key = os.path.normcase(os.path.abspath(directory))
    with _guard:
        hit = _cache.get(key)
        if _fresh(hit, time.monotonic(), time.time()):
            return hit[0]
    return _measure(directory, key)


_refreshing = set()


def offset_nowait(directory):
    """the cached offset even when it is older than CACHE_SECONDS (a new one is measured in the background);
    measured at once the first time, after the PC clock was set (a stale offset would stamp records minutes off),
    and while the last probe failed. For paths that must not wait for a probe when nothing changed (a deck append)."""
    key = os.path.normcase(os.path.abspath(directory))
    mono, wall = time.monotonic(), time.time()
    with _guard:
        hit = _cache.get(key)
        jumped = hit is not None and abs((wall - hit[2]) - (mono - hit[1])) > JUMP_SECONDS
        if hit and hit[3] and not jumped:
            if mono - hit[1] >= CACHE_SECONDS and key not in _refreshing:
                _refreshing.add(key)
                threading.Thread(target=_refresh, args=(directory, key), daemon=True, name="fsclock").start()
            return hit[0]
    return offset(directory)


def trusted(directory):
    """the offset of `directory` was measured (not unknown) and the PC clock has not been set since"""
    key = os.path.normcase(os.path.abspath(directory))
    with _guard:
        hit = _cache.get(key)
        return bool(hit and hit[3] and abs((time.time() - hit[2]) - (time.monotonic() - hit[1])) <= JUMP_SECONDS)


def _refresh(directory, key):
    try:
        _measure(directory, key)
    finally:
        with _guard:
            _refreshing.discard(key)


def fs_now(directory):
    """Current time (seconds) on the clock of the file server holding `directory`."""
    return time.time() + offset(directory)


def fs_now_ms(directory):
    return int(fs_now(directory) * 1000)


def reset():
    """Forget the measured offsets (tests, or after the PC clock was corrected)."""
    with _guard:
        _cache.clear()
