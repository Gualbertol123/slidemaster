"""Persistent documents in ``data/`` (ARCHITECTURE §3, §4).

* reads retry parsing (5x over 0.5 s); an existing file that still cannot be read raises
  :class:`StoreUnreadable` (HTTP 503) - it is never replaced by an empty document;
* writes go to a unique ``<file>.<uuid>.tmp``, are fsync'ed and moved into place with os.replace
  (retried 20x over ~2 s for Windows sharing violations);
* changes to shared documents are operations applied to the latest version under a lock file.
"""
import copy
import json
import os
import re
import shutil
import sys
import threading
import time

from . import paths
from . import upgrade as _up
from .fsclock import fs_now, fs_now_ms
from .locks import Lock
from .ops import apply_ops
from .util import current_user, doc_key, log, remove_quietly, safe_component, write_atomic

SCHEMA = _up.SCHEMA["workbook"]
BACKUP_KEEP = 30
BACKUP_EVERY = 300.0          # seconds: at most one backup per 5 minutes (plus always rev 1)
PREF_DEFAULTS = {"lastFile": None, "pdfMode": None, "zoom": None}


class StoreUnreadable(RuntimeError):
    """An existing document could not be read (HTTP 503). Nothing was written."""


class StoreTooNew(StoreUnreadable):
    """The document was saved by a newer Slide Builder (HTTP 409). Nothing was written."""


# --------------------------------------------------------------------------- low level
def server_now_ms():
    """Timestamps written into shared documents use the file server's clock, so every PC shares
    one timeline even when their clocks are minutes apart."""
    return fs_now_ms(paths.DATA)


def read_json(path, default=None, attempts=5, delay=0.1):
    """Parsed JSON of `path`; `default()` (a fresh value) when the file does not exist.

    A file that exists but cannot be read or parsed is retried (another helper may be replacing it,
    an antivirus may hold it); after that StoreUnreadable is raised.
    """
    last = None
    for i in range(attempts):
        try:
            with open(path, "rb") as f:
                raw = f.read()
            return json.loads(raw.decode("utf-8-sig"))
        except FileNotFoundError:
            if not os.path.exists(path):
                return default() if callable(default) else copy.deepcopy(default)
            last = "file vanished while reading"
        except (OSError, ValueError) as e:
            last = e
        if i < attempts - 1:
            time.sleep(delay)
    raise StoreUnreadable("%s cannot be read right now (%s)" % (os.path.basename(path), str(last).splitlines()[0][:120] if last else "?"))


def write_json(path, obj):
    data = (json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=False) + "\n").encode("utf-8")
    write_atomic(path, data)


# --------------------------------------------------------------------------- format upgrades (upgrade.py)
def _load(kind, path, default, lock_name, locked):
    """read a saved file; an older format is converted once (old file → backups/upgrades/) under the
    file's lock - `locked` = the caller already holds it"""
    doc = read_json(path, default)
    if not isinstance(doc, dict):
        return doc
    try:
        if not _up.needs_upgrade(kind, doc):
            return doc
        if not os.path.exists(path):              # a default document: always the current format
            return _up.upgrade(kind, doc)[0]
        if locked:
            return _upgrade_file(kind, path, doc)
        with Lock(lock_name):
            doc = read_json(path, default)       # another helper may have converted it meanwhile
            if not isinstance(doc, dict) or not _up.needs_upgrade(kind, doc):
                return doc
            return _upgrade_file(kind, path, doc)
    except _up.TooNew as e:
        raise StoreTooNew("%s: %s" % (os.path.basename(path), e))


def _upgrade_file(kind, path, doc):
    old = _up.version_of(kind, doc)
    new, _ = _up.upgrade(kind, doc)
    bp = _up.backup_path(paths.DATA, kind, path, old)
    os.makedirs(os.path.dirname(bp), exist_ok=True)
    base, n = bp[:-5], 1
    while os.path.exists(bp):                    # never overwrite an earlier backup
        n += 1
        bp = "%s-%d.json" % (base, n)
    shutil.copy2(path, bp)                       # the file exactly as it was
    write_json(path, new)
    log("converted %s from format %d to %d - the old file is in %s" % (os.path.basename(path), old, _up.SCHEMA[kind], os.path.relpath(bp, paths.DATA)))
    return new


def upgrade_all():
    """at start-up: convert every saved setup that is in an older format (never fails the start)"""
    done = []
    jobs = [("config", config_path(), "config")]
    for sub_, kind, lock_prefix in (("workbooks", "workbook", "wb-"), ("users", "prefs", "user-")):
        folder = paths.data_dir(sub_)
        for n in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if n.endswith(".json"):
                jobs.append((kind, os.path.join(folder, n), lock_prefix + n[:-5]))
    for kind, path, lock_name in jobs:
        if not os.path.exists(path):
            continue
        try:
            before = read_json(path, None)
            if isinstance(before, dict) and _up.needs_upgrade(kind, before):
                _load(kind, path, None, lock_name, False)
                done.append(os.path.basename(path))
        except Exception as e:                   # noqa: BLE001 - one bad file never stops the others
            log("%s was not converted now (%s) - it is converted when it is opened" % (os.path.basename(path), e))
    return done


# --------------------------------------------------------------------------- workbook documents
def workbook_key(name):
    return doc_key(name)


def workbook_path(name):
    return paths.data_dir("workbooks", workbook_key(name) + ".json")


def default_workbook(name):
    return {"schema": SCHEMA, "workbook": name, "rev": 0, "preset": None, "style": {}, "edits": {}}


def _normalise_workbook(doc, name):
    if not isinstance(doc, dict):
        raise StoreUnreadable("the document of %s is not a JSON object" % name)
    doc.setdefault("schema", SCHEMA)
    doc.setdefault("workbook", name)
    doc.setdefault("rev", 0)
    doc.setdefault("preset", None)
    if not isinstance(doc.get("style"), dict):
        doc["style"] = {}
    if not isinstance(doc.get("edits"), dict):
        doc["edits"] = {}
    return doc


def read_workbook(name, locked=False):
    key = workbook_key(name)
    return _normalise_workbook(_load("workbook", workbook_path(name), lambda: default_workbook(name), "wb-" + key, locked), name)


def workbook_exists(name):
    return os.path.exists(workbook_path(name))


LOG_KEEP = 20
_timing = threading.local()


def last_timing():
    """{lock_wait_ms, write_ms, fs_ops} of this thread's last update_workbook (X-SB-Timing, load tests)."""
    return getattr(_timing, "value", None)


def _fs_count():
    simfs = sys.modules.get(__package__ + ".simfs")
    return simfs.count() if simfs is not None and simfs.installed() else None


def update_workbook(name, ops, user=None, now=None):
    """lock -> read latest -> apply -> write -> backup -> unlock. Returns (doc, applied, skipped)."""
    user = user or current_user()
    key = workbook_key(name)
    _timing.value = None
    n0, t0 = _fs_count(), time.perf_counter()
    lock = Lock("wb-" + key).acquire()
    t1 = time.perf_counter()
    try:
        return _update_locked(name, key, ops, user, now)
    finally:
        lock.release()
        t2, n1 = time.perf_counter(), _fs_count()
        _timing.value = {"lock_wait_ms": (t1 - t0) * 1000.0, "write_ms": (t2 - t1) * 1000.0,
                         "fs_ops": (n1 - n0) if n0 is not None else None}


def _update_locked(name, key, ops, user, now):
    doc = read_workbook(name, locked=True)
    new, applied, skipped = apply_ops(doc, ops, user, now if now is not None else server_now_ms())
    if applied:
        new["schema"] = SCHEMA
        new["workbook"] = doc.get("workbook") or name
        # short revision log: lets clients name everybody whose changes they just received
        log_ = [x for x in (doc.get("log") or []) if isinstance(x, dict)][-(LOG_KEEP - 1):]
        new["log"] = log_ + [{"rev": new["rev"], "by": new.get("updatedBy"), "at": new.get("updated")}]
        # backups: the document remembers when its last backup was taken (file-server time), so a
        # normal save never lists or stats the backup folder while holding the lock (that cost
        # 30 extra round trips per save once 30 backups existed - see docs/LOADTEST.md)
        at = new.get("updated") if isinstance(new.get("updated"), (int, float)) else server_now_ms()
        last = doc.get("backupAt")
        # a clock set back (more than the spacing) backs up again; a few ms back is the probe's mtime
        # granularity (fsclock), not a new timeline
        due = new["rev"] == 1 or not isinstance(last, (int, float)) or at - last >= BACKUP_EVERY * 1000 or at < last - BACKUP_EVERY * 1000
        if due:
            new["backupAt"] = at
        write_json(workbook_path(name), new)
        if due:
            _backup(key, new)
    return new, applied, skipped


def create_workbook_if_missing(name, doc):
    """Used by the migration: write `doc` unless a document already exists. Returns True if written."""
    key = workbook_key(name)
    with Lock("wb-" + key):
        if os.path.exists(workbook_path(name)):
            return False
        doc = dict(doc, schema=SCHEMA)
        write_json(workbook_path(name), doc)
        _backup(key, doc)
        return True


# --------------------------------------------------------------------------- backups
def _backup_dir(key):
    return paths.data_dir("backups", key)


def _backup_revs(folder):
    out = []
    try:
        names = os.listdir(folder)
    except OSError:
        return out
    for n in names:
        m = re.match(r"^(\d+)\.json$", n)
        if m:
            out.append((int(m.group(1)), os.path.join(folder, n)))
    out.sort()
    return out


def _backup(key, doc):
    """Write a copy of `doc` and keep the last 30. The caller decides when (rev 1, then at most one
    per 5 minutes via doc["backupAt"]). A failing backup never fails the write it belongs to."""
    try:
        rev = int(doc.get("rev") or 0)
        folder = _backup_dir(key)
        write_json(os.path.join(folder, "%d.json" % rev), doc)
        for _, p in _backup_revs(folder)[:-BACKUP_KEEP]:
            remove_quietly(p)
        return True
    except Exception as e:
        log("backup of %s failed: %s" % (key, e))
        return False


def history(name):
    """[{rev, updated, updatedBy}] of the backups of a workbook, newest first."""
    out = []
    for rev, p in reversed(_backup_revs(_backup_dir(workbook_key(name)))):
        try:
            d = read_json(p, None, attempts=2, delay=0.05) or {}
        except StoreUnreadable:
            d = {}
        out.append({"rev": rev, "updated": d.get("updated"), "updatedBy": d.get("updatedBy")})
    return out


# --------------------------------------------------------------------------- config.json
def config_path():
    return paths.data_dir("config.json")


def default_config():
    return {"schema": _up.SCHEMA["config"], "rev": 0, "updated": None, "updatedBy": None, "defaults": {"style": {}}}


def read_config(locked=False):
    doc = _load("config", config_path(), default_config, "config", locked)
    if not isinstance(doc, dict):
        raise StoreUnreadable("config.json is not a JSON object")
    if not isinstance(doc.get("defaults"), dict):
        doc["defaults"] = {}
    if not isinstance(doc["defaults"].get("style"), dict):
        doc["defaults"]["style"] = {}
    doc.setdefault("schema", _up.SCHEMA["config"])
    doc.setdefault("rev", 0)
    return doc


def config_exists():
    return os.path.exists(config_path())


def update_config(ops, user=None, now=None, only_if_missing=False):
    """Only style.patch is accepted (applied to defaults.style). Returns (doc, applied, skipped)."""
    user = user or current_user()
    with Lock("config"):
        if only_if_missing and os.path.exists(config_path()):
            return read_config(locked=True), 0, list(range(len(ops)))
        doc = read_config(locked=True)
        new, applied, skipped = apply_ops(doc, ops, user, now if now is not None else server_now_ms(), kind="config")
        if applied:
            new["schema"] = _up.SCHEMA["config"]
            write_json(config_path(), new)
        return new, applied, skipped


# --------------------------------------------------------------------------- users/<user>.json
def user_path(user=None):
    return paths.data_dir("users", safe_component(user or current_user(), 80) + ".json")


def read_prefs(user=None):
    path = user_path(user)
    stored = _load("prefs", path, dict, "user-" + os.path.basename(path)[:-5], False)
    out = dict(PREF_DEFAULTS)
    if isinstance(stored, dict):
        out.update(stored)
    out.pop("schema", None)              # the format number is the store's business
    return out


def write_prefs(prefs, user=None):
    """Personal file: whole replace (atomic)."""
    if not isinstance(prefs, dict):
        raise ValueError("prefs must be an object")
    path = user_path(user)
    current = read_json(path, None) if os.path.exists(path) else None
    if isinstance(current, dict):
        try:
            _up.needs_upgrade("prefs", current)
        except _up.TooNew as e:
            raise StoreTooNew("%s: %s" % (os.path.basename(path), e))
    write_json(path, dict(prefs, schema=_up.SCHEMA["prefs"]))


def prefs_exist(user=None):
    return os.path.exists(user_path(user))
