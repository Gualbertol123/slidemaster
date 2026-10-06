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
import time

from . import paths
from .fsclock import fs_now, fs_now_ms
from .locks import Lock
from .ops import apply_ops
from .util import current_user, doc_key, log, remove_quietly, safe_component, write_atomic

SCHEMA = 3
BACKUP_KEEP = 30
BACKUP_EVERY = 300.0          # seconds: at most one backup per 5 minutes (plus always rev 1)
PREF_DEFAULTS = {"lastFile": None, "pdfMode": None, "zoom": None}


class StoreUnreadable(RuntimeError):
    """An existing document could not be read (HTTP 503). Nothing was written."""


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


def read_workbook(name):
    return _normalise_workbook(read_json(workbook_path(name), lambda: default_workbook(name)), name)


def workbook_exists(name):
    return os.path.exists(workbook_path(name))


LOG_KEEP = 20


def update_workbook(name, ops, user=None, now=None):
    """lock -> read latest -> apply -> write -> backup -> unlock. Returns (doc, applied, skipped)."""
    user = user or current_user()
    key = workbook_key(name)
    with Lock("wb-" + key):
        doc = read_workbook(name)
        new, applied, skipped = apply_ops(doc, ops, user, now if now is not None else server_now_ms())
        if applied:
            new["schema"] = SCHEMA
            new["workbook"] = doc.get("workbook") or name
            # short revision log: lets clients name everybody whose changes they just received
            log_ = [x for x in (doc.get("log") or []) if isinstance(x, dict)][-(LOG_KEEP - 1):]
            new["log"] = log_ + [{"rev": new["rev"], "by": new.get("updatedBy"), "at": new.get("updated")}]
            write_json(workbook_path(name), new)
            _backup(key, new)
        return new, applied, skipped


def create_workbook_if_missing(name, doc):
    """Used by the migration: write `doc` unless a document already exists. Returns True if written."""
    key = workbook_key(name)
    with Lock("wb-" + key):
        if os.path.exists(workbook_path(name)):
            return False
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
    """Keep a copy: always for rev 1, otherwise at most one per 5 minutes; keep the last 30.
    A failing backup never fails the write it belongs to."""
    try:
        rev = int(doc.get("rev") or 0)
        folder = _backup_dir(key)
        existing = _backup_revs(folder)
        if rev != 1 and existing:
            newest = max(os.path.getmtime(p) for _, p in existing)
            if fs_now(folder) - newest < BACKUP_EVERY:          # file server's clock, not this PC's
                return False
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
    return {"schema": SCHEMA, "rev": 0, "updated": None, "updatedBy": None, "defaults": {"style": {}}}


def read_config():
    doc = read_json(config_path(), default_config)
    if not isinstance(doc, dict):
        raise StoreUnreadable("config.json is not a JSON object")
    if not isinstance(doc.get("defaults"), dict):
        doc["defaults"] = {}
    if not isinstance(doc["defaults"].get("style"), dict):
        doc["defaults"]["style"] = {}
    doc.setdefault("schema", SCHEMA)
    doc.setdefault("rev", 0)
    return doc


def config_exists():
    return os.path.exists(config_path())


def update_config(ops, user=None, now=None, only_if_missing=False):
    """Only style.patch is accepted (applied to defaults.style). Returns (doc, applied, skipped)."""
    user = user or current_user()
    with Lock("config"):
        if only_if_missing and os.path.exists(config_path()):
            return read_config(), 0, list(range(len(ops)))
        doc = read_config()
        new, applied, skipped = apply_ops(doc, ops, user, now if now is not None else server_now_ms(), kind="config")
        if applied:
            write_json(config_path(), new)
        return new, applied, skipped


# --------------------------------------------------------------------------- users/<user>.json
def user_path(user=None):
    return paths.data_dir("users", safe_component(user or current_user(), 80) + ".json")


def read_prefs(user=None):
    stored = read_json(user_path(user), dict)
    out = dict(PREF_DEFAULTS)
    if isinstance(stored, dict):
        out.update(stored)
    return out


def write_prefs(prefs, user=None):
    """Personal file: whole replace (atomic)."""
    if not isinstance(prefs, dict):
        raise ValueError("prefs must be an object")
    write_json(user_path(user), prefs)


def prefs_exist(user=None):
    return os.path.exists(user_path(user))
