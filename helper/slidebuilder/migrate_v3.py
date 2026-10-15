"""A deck moves from Slide Builder 3 to 4 the first time a v4 page opens it - and back (docs/next/04 §4, ADR-010).

A deck is never owned by both: every step below runs under v3's own lock ``wb-<key>`` (held with keepalive, so a v3
helper never takes it for stale) and then the deck lock, and is ordered so that a crash anywhere leaves a state the
next try recognises and finishes or undoes.

Migration (:func:`migrate`, on the first v4 open, or ``tools/update.py --migrate-all``):
1. the v3 bytes are copied to ``backups/upgrades/workbook/<file>.v3.<time>.json`` (unreadable -> 503, nothing written);
2. the v3 file is FROZEN first: rewritten with ``"schema": 4, "movedTo": "v4", "movedGen": <gen>`` and all its
   content - from here on every v3 helper refuses it (format 4 is too new -> HTTP 409) and an open v3 page turns
   "outdated" on its next save, with no v3 code change;
3. ``data/v4/decks/<key>/snapshot.json`` at that gen with ``doc`` = the v3 document as it is (every key kept,
   ``backupAt`` dropped; rev, updated, updatedBy, log also in the header), and ``moved-from-v3.json``;
4. after a rollback, ``rolled-back.json`` is removed last.
A frozen file without its snapshot is the newest v3 content: the next open finishes from it. A new deck (no v3 file)
gets a frozen stub in data/workbooks, so a v3 helper can never start a second one.

Rollback (:func:`rollback_many`, ``tools/update.py --rollback`` or ``--use <3.x>``): refused while somebody has the
deck open (presence) or a complete record lies past the snapshot's frontier (open the deck once in Slide Builder 4,
or *Prepare rollback*); otherwise ``rolled-back.json`` is written FIRST (helpers then refuse appends and tails with
409: those with an append handle look again every few seconds, decks.REFRESH_S), a pause lets every helper see it,
the frontier is checked once more (an append acknowledged before its helper saw the marker keeps the deck with v4:
the marker goes and the rollback is refused), and only then the frozen file is backed up and replaced by the
snapshot's document as a v3 document (schema 3, rev / updated / updatedBy / log from the snapshot). A marker next to a
still-frozen file means the rollback never finished: the deck is still v4's. The next v4 open migrates a rolled-back
deck again (gen + 1, the frontier kept, the fields only v4 knows carried by v3), unless it is listed in
``data/v4/pinned-v3.json``.

**Nothing here applies operations**: documents are copied as they are; the snapshot's document is the one the core
folded (decks.py, core/src/model/fold.ts).
"""
import datetime as _dt
import hashlib
import json
import os
import re
import time

from . import decks, paths, upgrade
from .fsclock import fs_now_ms
from .locks import Lock, LockTimeout
from .util import current_host, current_user, log, remove_quietly, write_atomic

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


def frozen(doc):
    return isinstance(doc, dict) and doc.get("movedTo") == "v4"


def _thaw(doc):
    """a frozen v3 document's content as v3 had it (the freeze adds schema 4, movedTo, movedGen only)"""
    out = {k: v for k, v in doc.items() if k not in ("movedTo", "movedGen", "backupAt")}
    out["schema"] = V3_SCHEMA
    return out


def ensure_deck(workbook):
    """the deck of `workbook`, migrated from its v3 document first when v3 owns it, or created when there is none.
    Returns (key, how): how = "v4" (already), "migrated", "created"."""
    key = decks.deck_key(workbook)
    if owner(workbook) == "v4":
        return key, "v4"
    if key in pinned() or workbook in pinned():
        raise NotMigrated(409, "this deck is kept on Slide Builder 3 (data/v4/pinned-v3.json) - open it with Slide Builder 3")
    return key, migrate(workbook)


def migrate(workbook, lock_timeout=None):
    """the deck moves to Slide Builder 4 (module doc), as one sequence a crash can interrupt anywhere and the next
    try - under the same locks - finishes or undoes:

    1. the v3 bytes are backed up;
    2. the v3 file is FROZEN first (schema 4, movedTo "v4", movedGen = the gen the snapshot will have): from here
       on v3 refuses the deck, whatever happens next, so it is never owned by both;
    3. the snapshot (that gen; after a rollback the old frontier, lamport and seen go on) and moved-from-v3.json;
    4. rolled-back.json removed (a re-migration).

    A new deck (no v3 file) gets a frozen stub in data/workbooks too, so a v3 helper can never start a second one.
    Returns "migrated", "created", or "v4" when it was the deck of Slide Builder 4 already."""
    key = decks.deck_key(workbook)
    path = v3_path(workbook)
    os.makedirs(decks.deck_dir(key), exist_ok=True)
    kw = {"keepalive": True}                     # held through backups and writes: never stale for a v3 helper
    if lock_timeout is not None:
        kw["timeout"] = lock_timeout
    with Lock("wb-" + key, **kw):                # v3's own lock: no v3 save is half done, none starts
        with decks.deck_lock(key, keepalive=True):
            marker = decks.deck_dir(key, ROLLED_BACK)
            rolled = os.path.exists(marker)
            has_deck = decks.deck_exists(key)
            if has_deck and not rolled:
                return "v4"
            got = _read_v3(path)
            old = decks.read_snapshot(key) if has_deck else None
            gen = (old["gen"] + 1) if old else 1
            if got is None:                          # a new deck (or the v3 file went away): an empty one
                if has_deck:                         # rolled back, then the v3 file was deleted: the deck stays as it is
                    os.remove(marker)
                    return "v4"
                _write_json(path, {"schema": V3_SCHEMA + 1, "movedTo": "v4", "movedGen": 1, "workbook": workbook})
                decks.write_snapshot(key, decks.first_snapshot(workbook, decks.empty_doc(workbook)))
                return "created"
            raw, doc = got
            if frozen(doc):
                if has_deck and doc.get("movedGen", old["gen"]) <= old["gen"]:
                    # a rollback that marked the deck but never gave v3 its document back: the deck never left v4 -
                    # unless that rollback is still in its pause (then: busy, try again)
                    m = _read_marker(marker)
                    if m.get("state") == "marked" and fs_now_ms(paths.DATA) - (m.get("at") or 0) < (_quiet(None) + 30) * 1000:
                        raise decks.DeckError(503, "this deck is being given back to Slide Builder 3 right now - try again in a moment")
                    remove_quietly(marker)
                    return "v4"
                # frozen by a migration that stopped before its snapshot: its content is the newest v3 had
                v3 = _thaw(doc)
                if not doc.get("movedGen"):
                    _write_json(path, dict(doc, movedGen=gen))
            else:
                version = upgrade.version_of("workbook", doc)
                if version > V3_SCHEMA:
                    raise NotMigrated(409, "this deck was saved by a newer Slide Builder (format %d)" % version)
                _backup_v3(path, raw, version)
                v3 = _thaw(doc)
                _write_json(path, dict(doc, schema=V3_SCHEMA + 1, movedTo="v4", movedGen=gen))     # the freeze
            v3.setdefault("workbook", workbook)
            v3.setdefault("preset", None)
            if not isinstance(v3.get("style"), dict):
                v3["style"] = {}
            if not isinstance(v3.get("edits"), dict):
                v3["edits"] = {}
            rev = v3.get("rev") if isinstance(v3.get("rev"), int) and not isinstance(v3.get("rev"), bool) else 0
            snap = decks.first_snapshot(workbook, v3, rev=rev, log_=v3.get("log") if isinstance(v3.get("log"), list) else None,
                                        updated=v3.get("updated"), updated_by=v3.get("updatedBy"))
            snap["gen"] = gen
            if old:                                  # back from v3: the journals stay covered, the clocks go on
                snap["frontier"] = dict(old.get("frontier") or {})
                snap["lamport"] = old.get("lamport") or 0
                if old.get("seen"):
                    snap["seen"] = old["seen"]
                snap["rev"] = max(rev, old.get("rev") or 0)
            decks.write_snapshot(key, snap)
            _write_json(decks.deck_dir(key, MOVED), {"workbook": workbook, "file": os.path.basename(path), "at": fs_now_ms(paths.DATA),
                                                     "by": "%s@%s" % (current_user(), current_host()),
                                                     "sha1": hashlib.sha1(raw).hexdigest(), "rev": rev, "gen": gen})
            if rolled:
                os.remove(marker)
    log("deck %s moved to Slide Builder 4 (gen %d, the v3 file is frozen)" % (key, gen))
    return "migrated"


def v3_documents():
    """[(workbook name, v3 path)] of every v3 document that is not frozen (names from the files' "workbook" field)"""
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
QUIET_S = 3 * decks.REFRESH_S + 2.0         # after the marker: every helper appending to the deck has seen it


def _past_frontier(key, frontier):
    """journals with a complete record past the frontier (at most a torn tail is allowed)"""
    folder = decks.journal_dir(key)
    try:
        names = [n for n in os.listdir(folder) if decks.JOURNAL_RE.match(n)]
    except FileNotFoundError:
        return []
    return [decks.stem(n) for n in names if not decks._covered(os.path.join(folder, n), frontier.get(decks.stem(n), 0))]


def _present(key):
    """people with the deck open now (presence files touched in the last 25 s)"""
    return decks.others(key, client="-")


def _quiet(q):
    """the pause after the marker (SLIDEBUILDER_ROLLBACK_QUIET: tests)"""
    if q is not None:
        return q
    try:
        return float(os.environ["SLIDEBUILDER_ROLLBACK_QUIET"])
    except (KeyError, ValueError):
        return QUIET_S


def rollback(workbook=None, key=None, quiet=None):
    return rollback_many([key or decks.deck_key(workbook)], quiet=quiet, names={key or decks.deck_key(workbook): workbook})[0]


def rollback_many(keys, quiet=None, names=None):
    """decks back to Slide Builder 3 (module doc), each one: [result] = "rolled back" | "already" | NotMigrated.

    1. refused while somebody has the deck open (presence) or a complete record lies past the frontier;
    2. rolled-back.json first: helpers refuse appends and tails from then on - each sees it within CHECK_TTL;
    3. a pause of `quiet` s, for all the decks at once; then, under the locks, the frontier is checked again (an
       append acknowledged before a helper saw the marker refuses that deck: the marker goes, it stays with v4);
    4. the frozen file backed up and replaced by the snapshot's document, a v3 document."""
    names = names or {}
    results = {}
    marked = []
    mark_at = {}
    for key in keys:
        try:
            if not decks.deck_exists(key):
                raise NotMigrated(404, "%s has no Slide Builder 4 deck" % (names.get(key) or key))
            with Lock("wb-" + key, keepalive=True):          # the same order as the migration: wb-<key>, then the deck lock
                with decks.deck_lock(key, keepalive=True):
                    snap = decks.read_snapshot(key)
                    got = _read_v3(v3_path_key(key))
                    if os.path.exists(decks.deck_dir(key, ROLLED_BACK)) and got and not frozen(got[1]):
                        results[key] = "already"
                        continue
                    who = _present(key)
                    if who:
                        raise NotMigrated(409, "%s is open in Slide Builder 4 (%s) - close it everywhere first"
                                          % (snap.get("workbook") or key, ", ".join(sorted({o["user"] for o in who}))))
                    late = _past_frontier(key, snap.get("frontier") or {})
                    if late:
                        raise NotMigrated(409, "%s has changes that are not in its snapshot yet (%s) - open it once in Slide Builder 4, "
                                               "or use Options › Administration › Prepare rollback" % (snap.get("workbook") or key, ", ".join(sorted(late))))
                    mark_at[key] = fs_now_ms(paths.DATA)
                    _write_json(decks.deck_dir(key, ROLLED_BACK), {"at": mark_at[key], "by": "%s@%s" % (current_user(), current_host()),
                                                                   "gen": snap["gen"], "rev": snap.get("rev") or 0, "state": "marked"})
            marked.append(key)
        except (NotMigrated, decks.DeckError, LockTimeout, OSError) as e:
            results[key] = e
    if marked and _quiet(quiet):
        time.sleep(_quiet(quiet))
    for key in marked:
        try:
            with Lock("wb-" + key, keepalive=True):
                with decks.deck_lock(key, keepalive=True):
                    marker = decks.deck_dir(key, ROLLED_BACK)
                    snap = decks.read_snapshot(key)
                    if _read_marker(marker).get("at") != mark_at.get(key):
                        raise NotMigrated(409, "%s was opened in Slide Builder 4 while it was being rolled back - it stays there"
                                          % (snap.get("workbook") or key))
                    late = _past_frontier(key, snap.get("frontier") or {})
                    who = _present(key)
                    if late or who:                          # somebody appended (or opened it) during the pause
                        remove_quietly(marker)
                        raise NotMigrated(409, "%s was changed or opened while it was being rolled back (%s) - it stays with Slide Builder 4; "
                                               "close it everywhere, Prepare rollback and try again"
                                          % (snap.get("workbook") or key, ", ".join(sorted(late) + sorted({o["user"] for o in who}))))
                    wb = snap.get("workbook") or names.get(key)
                    path = v3_path_key(key)
                    got = _read_v3(path)
                    if got:
                        _backup_v3(path, got[0], upgrade.version_of("workbook", got[1]))
                    doc = dict(snap["doc"])
                    for k in ("movedTo", "movedGen"):
                        doc.pop(k, None)
                    doc["schema"] = V3_SCHEMA
                    doc["workbook"] = wb
                    doc["rev"] = snap.get("rev") or 0
                    for k in ("updated", "updatedBy", "log"):
                        if snap.get(k) is not None:
                            doc[k] = snap[k]
                    _write_json(path, doc)
                    _write_json(marker, {"at": fs_now_ms(paths.DATA), "by": "%s@%s" % (current_user(), current_host()),
                                         "gen": snap["gen"], "rev": doc["rev"], "state": "done"})
            log("deck %s rolled back to Slide Builder 3 (rev %d)" % (key, doc["rev"]))
            results[key] = "rolled back"
        except (NotMigrated, decks.DeckError, LockTimeout, OSError) as e:
            results[key] = e
    out = []
    for key in keys:
        r = results.get(key)
        if isinstance(r, Exception):
            if len(keys) == 1:
                raise r
            out.append(r)
        else:
            out.append(r)
    return out


def _read_marker(path):
    try:
        with open(path, "rb") as f:
            v = json.loads(f.read().decode("utf-8"))
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def v3_path_key(key):
    return paths.data_dir("workbooks", key + ".json")


def rollback_all(quiet=None):
    """every v4 deck back to v3 (one pause for all); returns {done, refused}"""
    res = {"done": [], "refused": []}
    folder = paths.data_dir("v4", "decks")
    keys = [k for k in sorted(os.listdir(folder)) if decks.KEY_RE.match(k) and decks.deck_exists(k)] if os.path.isdir(folder) else []
    for key, r in zip(keys, rollback_many(keys, quiet=quiet) if keys else []):
        if r == "rolled back":
            res["done"].append(key)
        elif isinstance(r, Exception):
            res["refused"].append((key, str(r)))
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

