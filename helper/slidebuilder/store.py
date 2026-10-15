"""Persistent documents in ``data/`` (ARCHITECTURE §3, §4): config.json, users/<user>.json, and - read only -
Slide Builder 3's workbook documents (the migration and the self-test read them; decks are decks.py's).

* reads retry parsing (5x over 0.5 s); an existing file that still cannot be read raises
  :class:`StoreUnreadable` (HTTP 503) - it is never replaced by an empty document;
* writes go to a unique ``<file>.<uuid>.tmp``, are fsync'ed and moved into place with os.replace
  (retried 20x over ~2 s for Windows sharing violations);
* config.json changes by compare-and-set on its rev under the lock ``config`` (the page computes the new
  defaults with the core's operations; the helper applies none).
"""
import copy
import json
import os
import shutil
import time

from . import paths
from . import upgrade as _up
from .fsclock import fs_now_ms
from .locks import Lock
from .util import current_user, doc_key, log, safe_component, write_atomic

SCHEMA = _up.SCHEMA["workbook"]
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
            if isinstance(before, dict) and before.get("movedTo") == "v4":
                continue                         # frozen by the migration to Slide Builder 4: its deck is in data/v4
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


class ConfigConflict(RuntimeError):
    """config.json changed since the page read it (HTTP 409): the page reads it again and redoes its change"""

    def __init__(self, doc):
        super().__init__("the shared defaults were changed meanwhile - try again")
        self.doc = doc


def replace_config_defaults(base_rev, style, user=None, now=None):
    """Compare-and-set of config.json's ``defaults.style`` on its ``rev``, under the lock ``config`` - the lock under
    which Slide Builder 3 helpers apply their changes to the same file, so neither loses the other's. The page computed
    `style` from the rev it read (core/src/model/ops.ts): the helper applies no operation, and only ``defaults.style``
    is ever replaced (as v3 lets a page change only that). Returns the new doc; ConfigConflict when the rev moved on."""
    if not isinstance(style, dict):
        raise ValueError("style must be an object")
    user = user or current_user()
    with Lock("config"):
        doc = read_config(locked=True)
        if doc.get("rev", 0) != base_rev:
            raise ConfigConflict(doc)
        new = dict(doc, defaults=dict(doc.get("defaults") or {}, style=style), rev=int(doc.get("rev") or 0) + 1,
                   updated=now if now is not None else server_now_ms(), updatedBy=user, schema=_up.SCHEMA["config"])
        write_json(config_path(), new)
        return new


def create_config_if_missing(defaults, user=None, now=None):
    """the first config.json (the v2 import): written only when there is none. Returns True if written."""
    user = user or current_user()
    with Lock("config"):
        if os.path.exists(config_path()):
            return False
        doc = dict(default_config(), defaults=defaults, rev=1, updated=now if now is not None else server_now_ms(), updatedBy=user)
        write_json(config_path(), doc)
        return True


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
