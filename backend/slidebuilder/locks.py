"""Cross-process / cross-PC lock files (ARCHITECTURE §4).

A lock is the file ``data/locks/<name>.lock`` created with ``O_CREAT | O_EXCL`` - atomic on local
disks and on SMB shares. Its body is ``{user, host, pid, at, token}``; the random token lets the
owner verify, before deleting it, that the file is still its own.

* acquisition waits up to 10 s, retrying every 50-200 ms (jittered);
* a lock file not modified for 15 s is stale (its owner crashed or lost the network): it is moved
  aside atomically and acquisition is retried. The age is measured on the **file server's clock**
  (:mod:`fsclock`), never this PC's clock against a server-stamped mtime - PCs can be minutes apart;
* long critical sections (installer, migration) pass ``keepalive=True``: a thread rewrites the file
  every few seconds (a write, so the server stamps the mtime) and it never looks stale while the
  owner is alive.

Usage::

    with Lock("wb-" + key):
        ...
"""
import json
import os
import random
import threading
import time
import uuid

from . import paths
from .fsclock import fs_now
from .util import current_host, current_user, log, remove_quietly

WAIT = 10.0
STALE = 15.0


class LockTimeout(RuntimeError):
    """The lock could not be acquired in time (someone else holds it)."""

    def __init__(self, name, holder=None):
        who = ""
        if isinstance(holder, dict) and holder.get("user"):
            who = " by %s@%s" % (holder.get("user"), holder.get("host") or "?")
        super().__init__("'%s' is busy (locked%s) - try again in a moment" % (name, who))
        self.name = name
        self.holder = holder


def _read(path):
    try:
        with open(path, "rb") as f:
            return json.loads(f.read().decode("utf-8") or "null")
    except (OSError, ValueError):
        return None


class Lock:
    def __init__(self, name, directory=None, timeout=WAIT, stale=STALE, keepalive=False):
        self.name = name
        self.directory = directory or paths.data_dir("locks")
        self.path = os.path.join(self.directory, name + ".lock")
        self.timeout = timeout
        self.stale = stale
        self.keepalive = keepalive
        self.token = None
        self._stop = None
        self._thread = None
        self._body = None

    # ---- acquisition
    def _try_create(self):
        token = uuid.uuid4().hex
        body = json.dumps({"user": current_user(), "host": current_host(), "pid": os.getpid(),
                           "at": int(fs_now(self.directory) * 1000), "token": token}).encode("utf-8")
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
        except FileExistsError:
            return False
        except PermissionError:
            # Windows: a lock file that is being deleted ("delete pending") refuses new opens for a moment
            if os.name == "nt":
                return False
            raise
        try:
            os.write(fd, body)
            try:
                os.fsync(fd)
            except OSError:
                pass
        finally:
            os.close(fd)
        self.token = token
        self._body = body
        return True

    def _age(self, path):
        """Seconds since `path` was last written, on the file server's clock."""
        return fs_now(self.directory) - os.stat(path).st_mtime

    def _break_if_stale(self):
        """Remove a stale lock without ever removing a live one. Returns True if something was removed."""
        try:
            if self._age(self.path) < self.stale:
                return False
        except OSError:
            return False
        old = _read(self.path)
        aside = "%s.%s.stale" % (self.path, uuid.uuid4().hex)
        try:
            os.rename(self.path, aside)        # atomic: only one waiter wins
        except OSError:
            return False
        moved = _read(aside)
        try:
            fresh = self._age(aside) < self.stale
        except OSError:
            fresh = False
        same = (old or {}).get("token") == (moved or {}).get("token")
        if fresh or not same:
            # In the window between our stat and the rename somebody else broke the stale lock and took
            # it. Put theirs back (O_EXCL: never over a newer one) and keep waiting.
            try:
                with open(aside, "rb") as f:
                    content = f.read()
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
                try:
                    os.write(fd, content)
                finally:
                    os.close(fd)
            except OSError:
                pass
            remove_quietly(aside)
            return False
        remove_quietly(aside)
        log("removed a stale lock '%s' (held by %s@%s)" % (self.name, (old or {}).get("user", "?"), (old or {}).get("host", "?")))
        return True

    def acquire(self):
        os.makedirs(self.directory, exist_ok=True)
        end = time.monotonic() + self.timeout
        while True:
            if self._try_create():
                if self.keepalive:
                    self._start_keepalive()
                return self
            if self._break_if_stale():
                continue
            if time.monotonic() >= end:
                raise LockTimeout(self.name, _read(self.path))
            time.sleep(random.uniform(0.05, 0.2))

    # ---- keepalive for long critical sections
    def _start_keepalive(self):
        self._stop = threading.Event()

        def beat():
            while not self._stop.wait(min(3.0, self.stale / 4.0)):
                self._touch()
        self._thread = threading.Thread(target=beat, daemon=True, name="lock-" + self.name)
        self._thread.start()

    def _touch(self):
        """Rewrite our own lock file in place (same bytes). os.utime would stamp this PC's clock."""
        token, body = self.token, self._body
        if not token or not body:
            return False
        cur = _read(self.path)
        if not cur or cur.get("token") != token:
            return False                       # not ours any more: never touch someone else's lock
        try:
            fd = os.open(self.path, os.O_WRONLY | getattr(os, "O_BINARY", 0))
            try:
                os.write(fd, body)
            finally:
                os.close(fd)
            return True
        except OSError:
            return False

    # ---- release
    def release(self):
        if self._stop is not None:
            self._stop.set()
            self._stop = None
        if not self.token:
            return False
        token, self.token = self.token, None
        body = _read(self.path)
        if not body or body.get("token") != token:
            log("lock '%s' was taken over by someone else meanwhile - left alone" % self.name)
            return False
        for _ in range(20):
            try:
                os.remove(self.path)
                return True
            except FileNotFoundError:
                return False
            except PermissionError:            # Windows: someone is reading the lock file right now
                time.sleep(0.05)
        return False

    @property
    def held(self):
        return self.token is not None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self.release()
        return False


def lock(name, **kw):
    return Lock(name, **kw)
