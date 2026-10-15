"""A deck moves from Slide Builder 3 to 4 the first time a v4 page opens it - and back (docs/next/04 §4, ADR-010).

Migration (:func:`ensure_deck`), under v3's own lock ``wb-<key>`` (data/locks: no v3 helper is in the middle of a
save) and then the deck lock:

1. the v3 document is read (unreadable -> 503, nothing written);
2. its bytes are copied to ``backups/upgrades/workbook/<file>.v3.<time>.json``;
3. ``data/v4/decks/<key>/snapshot.json`` gen 1 (or the next gen after a rollback) with ``doc`` = the v3 document as
   it is (every key kept, ``backupAt`` dropped; rev, updated, updatedBy and log also in the snapshot's header) and
   ``moved-from-v3.json`` (what, when, by whom, the sha1 of the v3 bytes);
4. the v3 file is frozen: rewritten with ``"schema": 4, "movedTo": "v4"`` and all its content. From then on every v3
   helper refuses it (its upgrade check: format 4 is too new -> HTTP 409) and an open v3 page turns "outdated" on its
   next save. No v3 code changes.

Rollback (:func:`rollback`, ``tools/update.py --rollback``), under the deck lock and ``wb-<key>``: refused while a
journal holds a complete record past the snapshot's frontier (open the deck once in Slide Builder 4, or *Prepare
rollback*); otherwise the frozen v3 file is copied to the backups and replaced by ``snapshot.doc`` as a v3 document
(schema 3, rev / updated / updatedBy / log from the snapshot), and ``rolled-back.json`` marks the deck: v4 migrates it
again at its next open (keeping fields only v4 knows, which v3 carries along untouched), unless it is listed in
``data/v4/pinned-v3.json``.

**Nothing here applies operations**: documents are copied as they are; the snapshot's document is the one the core
folded (decks.py, core/src/model/fold.ts).
"""
import datetime as _dt
import hashlib
import json
import os
import re

from . import decks, paths, upgrade
from .fsclock import fs_now_ms
from .locks import Lock, LockTimeout
from .util import current_host, current_user, log, write_atomic

MOVED = "moved-from-v3.json"
ROLLED_BACK = "rolled-back.json"
V3_SCHEMA = 3


class NotMigrated(RuntimeError):
    """The deck stays with Slide Builder 3 (pinned, or a v3 document this program cannot take); ``status`` = HTTP code."""

    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def v3_path(workbook):
    return paths.data_dir("workbooks", decks.deck_key(workbook) + ".json")


def pinned():
    """workbook names / keys kept on Slide Builder 3 (data/v4/pinned-v3.json: a list, or {"decks": [...]})"""
    try:
        with open(paths.data_dir("v4", "pinned-v3.json"), "rb") as f:
            v = json.loads(f.read().decode("utf-8-sig"))
    except (OSError, ValueError):
        return set()
    items = v.get("decks") if isinstance(v, dict) else v
    out = set()
    for x in items if isinstance(items, list) else []:
        if isinstance(x, str):
            out.add(x)
            out.add(decks.deck_key(x))
    return out


def owner(workbook):
    """'v4' (a deck that is not rolled back), 'v3' (a v3 document to migrate, or rolled back), or None (new)"""
    key = decks.deck_key(workbook)
    if decks.deck_exists(key) and not os.path.exists(decks.deck_dir(key, ROLLED_BACK)):
        return "v4"
    return "v3" if os.path.exists(v3_path(workbook)) else None


def _read_v3(path):
    """(bytes, document) of a v3 file; None when it does not exist; DeckError 503 when unreadable"""
    raw = decks._read_bytes(path)
    if raw is None:
        return None
    try:
        doc = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise decks.DeckError(503, "%s cannot be read right now - trying again" % os.path.basename(path))
    if not isinstance(doc, dict):
        raise decks.DeckError(503, "%s is not a document" % os.path.basename(path))
    return raw, doc


def _backup_v3(path, raw, version):
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.basename(path)[:-5]
    bp = paths.data_dir("backups", "upgrades", "workbook", "%s.v%d.%s.json" % (base, version, stamp))
    os.makedirs(os.path.dirname(bp), exist_ok=True)
    stem, n = bp[:-5], 1
    while os.path.exists(bp):                    # never overwrite an earlier backup
        n += 1
        bp = "%s-%d.json" % (stem, n)
    with open(bp, "wb") as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    return bp


def _write_json(path, obj):
    write_atomic(path, (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))


def ensure_deck(workbook):
    """the deck of `workbook`, migrated from its v3 document first when v3 owns it, or created empty when there is
    none. Returns (key, how): how = "v4" (already), "migrated", "created"."""
    key = decks.deck_key(workbook)
    if owner(workbook) == "v4":
        return key, "v4"
    if key in pinned() or workbook in pinned():
        raise NotMigrated(409, "this deck is kept on Slide Builder 3 (data/v4/pinned-v3.json) - open it with Slide Builder 3")
    if not os.path.exists(v3_path(workbook)):
        k, created = decks.create_if_missing(workbook)
        return k, "created" if created else "v4"
    return key, migrate(workbook)


def migrate(workbook, lock_timeout=None):
    """the v3 document of `workbook` becomes the deck's snapshot and is frozen (module doc). Returns "migrated", or
    "v4" when another helper did it meanwhile."""
    key = decks.deck_key(workbook)
    path = v3_path(workbook)
    os.makedirs(decks.deck_dir(key), exist_ok=True)
    kw = {} if lock_timeout is None else {"timeout": lock_timeout}
    with Lock("wb-" + key, **kw):                # v3's own lock: no v3 save is half done, none starts
        with decks.deck_lock(key, keepalive=True):
            rolled = os.path.exists(decks.deck_dir(key, ROLLED_BACK))
            if decks.deck_exists(key) and not rolled:
                return "v4"
            got = _read_v3(path)
            if got is None:                          # the v3 file went away meanwhile: a new, empty deck
                decks.write_snapshot(key, decks.first_snapshot(workbook, decks.empty_doc(workbook)))
                return "migrated"
            raw, doc = got
            version = upgrade.version_of("workbook", doc)
            if version > V3_SCHEMA:
                if doc.get("movedTo") == "v4" and rolled:
                    raise decks.DeckError(503, "the deck is half rolled back - run the rollback again")
                raise NotMigrated(409, "this deck was saved by a newer Slide Builder (format %d)" % version)
            _backup_v3(path, raw, version)
            v3 = {k: v for k, v in doc.items() if k != "backupAt"}
            v3["schema"] = V3_SCHEMA
            v3.setdefault("workbook", workbook)
            v3.setdefault("preset", None)
            if not isinstance(v3.get("style"), dict):
                v3["style"] = {}
            if not isinstance(v3.get("edits"), dict):
                v3["edits"] = {}
            rev = v3.get("rev") if isinstance(v3.get("rev"), int) and not isinstance(v3.get("rev"), bool) else 0
            snap = decks.first_snapshot(workbook, v3, rev=rev, log_=v3.get("log") if isinstance(v3.get("log"), list) else None,
                                        updated=v3.get("updated"), updated_by=v3.get("updatedBy"))
            if rolled:                               # back from v3: the next gen, the journals stay covered
                old = decks.read_snapshot(key)
                snap["gen"] = old["gen"] + 1
                snap["frontier"] = dict(old.get("frontier") or {})
                snap["lamport"] = old.get("lamport") or 0
                if old.get("seen"):
                    snap["seen"] = old["seen"]
                snap["rev"] = max(rev, old.get("rev") or 0)
            decks.write_snapshot(key, snap)
            _write_json(decks.deck_dir(key, MOVED), {"workbook": workbook, "file": os.path.basename(path), "at": fs_now_ms(paths.DATA),
                                                     "by": "%s@%s" % (current_user(), current_host()),
                                                     "sha1": hashlib.sha1(raw).hexdigest(), "rev": rev, "gen": snap["gen"]})
            frozen = dict(doc, schema=V3_SCHEMA + 1, movedTo="v4")
            _write_json(path, frozen)                # the freeze: v3 helpers refuse it from now on
            if rolled:
                os.remove(decks.deck_dir(key, ROLLED_BACK))
    log("deck %s moved to Slide Builder 4 (gen %d, the v3 file is frozen)" % (key, snap["gen"]))
    return "migrated"


def v3_documents():
    """[(workbook name, v3 path)] of every v3 document (names from the files' own "workbook" field)"""
    out = []
    folder = paths.data_dir("workbooks")
    for n in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not re.match(r"^.+-[0-9a-f]{10}\.json$", n):
            continue
        p = os.path.join(folder, n)
        try:
            got = _read_v3(p)
        except decks.DeckError:
            out.append((None, p))
            continue
        if got:
            out.append((got[1].get("workbook"), p))
    return out


def migrate_all(lock_timeout=2.0):
    """every v3 deck that is not frozen yet: migrated now, each under its own lock. A deck a v3 helper is saving
    right now (its lock is busy) is skipped and reported - run it again later. Returns {migrated, skipped, failed}."""
    res = {"migrated": [], "skipped": [], "failed": []}
    pins = pinned()
    for wb, p in v3_documents():
        label = wb or os.path.basename(p)
        if not wb or decks.deck_key(wb) + ".json" != os.path.basename(p):
            res["failed"].append((label, "the file's workbook name does not match its file name"))
            continue
        if wb in pins or decks.deck_key(wb) in pins or owner(wb) == "v4":
            continue
        try:
            if migrate(wb, lock_timeout=lock_timeout) == "migrated":
                res["migrated"].append(wb)
        except LockTimeout:
            res["skipped"].append((wb, "open in Slide Builder 3 right now"))
        except (decks.DeckError, NotMigrated, OSError) as e:
            res["failed"].append((wb, str(e)))
    return res


# --------------------------------------------------------------------------- rollback
def _past_frontier(key, frontier):
    """journals with a complete record past the frontier (at most a torn tail is allowed)"""
    folder = decks.journal_dir(key)
    try:
        names = [n for n in os.listdir(folder) if decks.JOURNAL_RE.match(n)]
    except FileNotFoundError:
        return []
    return [decks.stem(n) for n in names if not decks._covered(os.path.join(folder, n), frontier.get(decks.stem(n), 0))]


def rollback(workbook=None, key=None):
    """the deck back to Slide Builder 3 (module doc). Raises NotMigrated(409) when records lie past the frontier."""
    key = key or decks.deck_key(workbook)
    if not decks.deck_exists(key):
        raise NotMigrated(404, "%s has no Slide Builder 4 deck" % (workbook or key))
    with Lock("wb-" + key):                      # the same order as the migration: wb-<key>, then the deck lock
        with decks.deck_lock(key, keepalive=True):
            if os.path.exists(decks.deck_dir(key, ROLLED_BACK)):
                return "already"
            snap = decks.read_snapshot(key)
            late = _past_frontier(key, snap.get("frontier") or {})
            if late:
                raise NotMigrated(409, "%s has changes that are not in its snapshot yet (%s) - open it once in Slide Builder 4, "
                                       "or use Options › Administration › Prepare rollback" % (snap.get("workbook") or key, ", ".join(sorted(late))))
            wb = snap.get("workbook") or workbook
            path = paths.data_dir("workbooks", key + ".json")
            if os.path.exists(path):
                got = _read_v3(path)
                if got:
                    _backup_v3(path, got[0], upgrade.version_of("workbook", got[1]))
            doc = dict(snap["doc"])
            doc.pop("movedTo", None)
            doc["schema"] = V3_SCHEMA
            doc["workbook"] = wb
            doc["rev"] = snap.get("rev") or 0
            for k in ("updated", "updatedBy", "log"):
                if snap.get(k) is not None:
                    doc[k] = snap[k]
            _write_json(path, doc)
            _write_json(decks.deck_dir(key, ROLLED_BACK), {"at": fs_now_ms(paths.DATA), "by": "%s@%s" % (current_user(), current_host()),
                                                           "gen": snap["gen"], "rev": doc["rev"]})
    log("deck %s rolled back to Slide Builder 3 (rev %d)" % (key, doc["rev"]))
    return "rolled back"


def rollback_all():
    """every v4 deck back to v3; returns {done, refused}"""
    res = {"done": [], "refused": []}
    folder = paths.data_dir("v4", "decks")
    for key in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not decks.KEY_RE.match(key) or not decks.deck_exists(key):
            continue
        try:
            if rollback(key=key) == "rolled back":
                res["done"].append(key)
        except (NotMigrated, decks.DeckError, LockTimeout, OSError) as e:
            res["refused"].append((key, str(e)))
    return res


def list_decks():
    """[{key, workbook, gen, rev, rolledBack}] of every deck (Prepare rollback, the side panel)"""
    out = []
    folder = paths.data_dir("v4", "decks")
    for key in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not decks.KEY_RE.match(key):
            continue
        try:
            s = decks.read_snapshot(key)
        except decks.DeckError:
            continue
        out.append({"key": key, "workbook": s.get("workbook"), "gen": s.get("gen"), "rev": s.get("rev"),
                    "rolledBack": os.path.exists(decks.deck_dir(key, ROLLED_BACK))})
    return out

