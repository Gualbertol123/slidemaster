"""Deleted setups (B44, product owner 2026-10-20): a workbook's saved deck - its tables, slides, looks, versions,
comments - deleted so that its next open starts the wizard as for a new file, and kept as a backup that can be
restored (Options > Administration > Saved setups).

A deck is deleted only while no other window has it open (its presence, decks.others; the asking window's own
presence does not count - the page offers Delete only for a deck it has not open): the person is told who has it
open. A deck given back to Slide Builder 3 (rolled-back.json) or a v3 document v3 still owns is never deleted here.
Under v3's workbook lock and the deck's lock, everything of the deck moves to data/v4/deleted/<key>~<ms>/:
  deck/      the deck's folder (snapshot.json, the journals, its markers; one rename: all or nothing - on Windows a
             journal another helper still holds open makes it fail, and nothing has moved)
  backups/   its snapshot backups (data/backups/v4/<key>; left behind they would make the next open refuse the deck,
             decks.traces)
  v3.json    a copy of the workbook's v3 file, frozen since its migration
  deleted.json  what it was: workbook, key, gen, rev, slides, tables, who deleted it and when
and, still under the locks, the workbook gets a NEW EMPTY deck at once: gen = the deleted one's + 1 and a creation id
of its own (the file `born`, decks.born_of - no compaction touches it, of any version), so a window whose presence
lapsed (a sleeping PC) can neither compact over it with the old deck's gen nor open a journal in it with a writer
of the old deck (decks.bind_writer: while the helper that issued the writer runs, and it is 4.6 or later); and its
v3 file becomes a fresh frozen stub (a frozen v3 file left with its content could be thawed back; a missing one would let Slide Builder 3
start a document of its own).
A restore puts the deleted deck back, only while the workbook holds no setup of its own (_empty: the empty deck the
delete left, or the next open made, does not count - it is set aside in the bin), all or nothing.
"""
import json
import os
import re
import shutil
import uuid

from . import decks, migrate_v3, paths
from .fsclock import fs_now_ms
from .locks import Lock, LockTimeout
from .util import current_host, current_user, log, remove_quietly, write_atomic

NAME_RE = re.compile(r"^([A-Za-z0-9._-]{1,60}-[0-9a-f]{10})~([0-9]{1,16})\Z")
INFO = "deleted.json"


def bin_dir(*parts):
    return paths.data_dir("v4", "deleted", *parts)


def _busy(others):
    names = sorted({"%s (%s)" % (o["user"], o["host"]) for o in others})
    return decks.DeckError(409, "this setup is open in a Slide Builder window right now: %s - it can be deleted when "
                                "it is closed" % ", ".join(names), others=others)


def _v3_doc(path):
    try:
        with open(path, "rb") as f:
            return json.loads(f.read().decode("utf-8-sig"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        raise decks.DeckError(503, "%s cannot be read right now - try again" % os.path.basename(path))


def _check_deletable(key, client):
    if os.path.exists(decks.deck_dir(key, migrate_v3.ROLLED_BACK)):
        raise decks.DeckError(409, "this setup was given back to Slide Builder 3 - it is not deleted here")
    v3 = _v3_doc(migrate_v3.v3_path_key(key))
    if v3 is not None and not migrate_v3.frozen(v3):
        raise decks.DeckError(409, "Slide Builder 3 holds this workbook's setup - it is not deleted here")
    others = decks.others(key, client)
    if others:
        raise _busy(others)


def _undo(moved, key, what):
    """the steps of `moved` undone, newest first: (a, b) = a was renamed to b; (None, b) = folder b was made. A
    failure is logged (where everything is now) and raised."""
    for a, b in reversed(moved):
        try:
            if a is None:
                shutil.rmtree(b)
            else:
                os.rename(b, a)
        except OSError as e:
            log("%s deck %s: could not put %s back to %s (%s)" % (what, key, b, a, e))
            raise


def delete(key, client=None, user=None, host=None):
    """the deck `key` moved to the bin and an empty one in its place (module doc). `client`: the asking window (its
    own presence does not count). Returns {id, workbook}. 404: no such deck; 409: open elsewhere, given back to v3,
    or still in use by another PC's helper."""
    decks.check_key(key)
    snap = decks.read_snapshot(key)
    workbook = snap.get("workbook")
    _check_deletable(key, client)
    at = fs_now_ms(paths.DATA)
    for _ in range(50):                                 # (two deletes of one deck in one millisecond)
        name = "%s~%d" % (key, at)
        dest = bin_dir(name)
        try:
            os.makedirs(dest)
            break
        except FileExistsError:
            at += 1
    else:
        raise decks.DeckError(503, "no free name in the bin for this setup - try again")
    v3 = migrate_v3.v3_path_key(key)
    try:
        with Lock("wb-" + key, keepalive=True):          # no migration or v3 save of this workbook meanwhile
            lock = decks.deck_lock(key, timeout=10)
            try:
                lock.acquire()
            except LockTimeout:
                raise decks.DeckError(409, "this setup is being saved right now - try again in a moment")
            moved = []
            try:
                _check_deletable(key, client)            # again, under the locks
                decks.forget(key)                        # this helper's idle handles (a window closed minutes ago)
                snap = decks.read_snapshot(key)          # (the newest gen)
                workbook = snap.get("workbook") or workbook
                if os.path.exists(v3):
                    shutil.copy2(v3, os.path.join(dest, "v3.json"))
                try:
                    os.rename(decks.deck_dir(key), os.path.join(dest, "deck"))
                except OSError as e:
                    raise decks.DeckError(409, "this setup is still in use on another PC (a window closed less than ten "
                                               "minutes ago keeps it open) - try again later (%s)" % e.__class__.__name__)
                moved.append((decks.deck_dir(key), os.path.join(dest, "deck")))
                lock.path = os.path.join(dest, "deck", "lock")   # the lock moved with its folder: released there
                if os.path.isdir(decks.backup_dir(key)):
                    os.rename(decks.backup_dir(key), os.path.join(dest, "backups"))
                    moved.append((decks.backup_dir(key), os.path.join(dest, "backups")))
                # the empty deck in its place: a gen the deleted deck's pages never had, a creation of its own
                os.makedirs(decks.deck_dir(key))
                moved.append((None, decks.deck_dir(key)))
                fresh = decks.first_snapshot(workbook, decks.empty_doc(workbook))
                fresh["gen"] = (snap.get("gen") or 0) + 1
                write_atomic(decks.deck_dir(key, decks.BORN), uuid.uuid4().hex[:12].encode("ascii"))
                decks.write_snapshot(key, fresh)
            except BaseException:
                _undo(moved, key, "deleting")
                if moved:
                    lock.path = os.path.join(decks.deck_dir(key), "lock")
                raise
            finally:
                lock.release()
            try:                                        # best effort: the deck exists, so a v4 open never reads it
                migrate_v3._write_json(v3, {"schema": migrate_v3.V3_SCHEMA + 1, "movedTo": "v4", "movedGen": fresh["gen"], "workbook": workbook})
            except OSError as e:
                log("deck %s deleted: its v3 file was not replaced by a stub (%s)" % (key, e))
    except BaseException:
        if not any(os.path.exists(os.path.join(dest, p)) for p in ("deck", "backups")):
            shutil.rmtree(dest, ignore_errors=True)
        raise
    decks.forget(key)
    info = dict(decks.summary(snap), key=key, id=name, at=at, by="%s@%s" % (user or current_user(), host or current_host()))
    write_atomic(os.path.join(dest, INFO), (json.dumps(info, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
    log("deck %s (%s) deleted; kept in %s" % (key, workbook, dest))
    return {"id": name, "workbook": workbook}


def _info(name):
    try:
        with open(bin_dir(name, INFO), "rb") as f:
            got = json.loads(f.read().decode("utf-8"))
        return got if isinstance(got, dict) else None
    except (OSError, ValueError):
        return None


def listing():
    """[{id, key, workbook, at, by, slides, tables, ...}] of the deleted setups, newest first"""
    out = []
    folder = bin_dir()
    for name in os.listdir(folder) if os.path.isdir(folder) else []:
        if not NAME_RE.match(name) or not os.path.isdir(bin_dir(name, "deck")):
            continue
        info = _info(name) or {}
        m = NAME_RE.match(name)
        out.append(dict(info, id=name, key=m.group(1), at=info.get("at") or int(m.group(2))))
    out.sort(key=lambda x: -x["at"])
    return out


def _empty(key):
    """the deck holds no setup: no preset, no cell edits, no record in its journals, no snapshot backups - what a
    delete leaves, or an open makes (it does not block a restore)"""
    try:
        doc = decks.read_snapshot(key).get("doc") or {}
    except decks.DeckError:
        return False
    if doc.get("preset") or doc.get("edits"):
        return False
    for folder in (decks.journal_dir(key), decks.backup_dir(key)):
        try:
            names = os.listdir(folder)
        except FileNotFoundError:
            continue
        except OSError:
            return False
        for n in names:
            try:
                if not n.startswith(".") and os.path.getsize(os.path.join(folder, n)) > 0:
                    return False
            except OSError:
                return False
    return True


def restore(name, client=None):
    """the deleted setup `name` back as the workbook's deck, all or nothing. 409 while the workbook holds a setup of
    its own (an empty deck does not count, _empty) or another window has its deck open."""
    m = NAME_RE.match(name or "")
    if not m or not os.path.isdir(bin_dir(name, "deck")):
        raise decks.DeckError(404, "no such deleted setup")
    key, src = m.group(1), bin_dir(name)
    v3 = migrate_v3.v3_path_key(key)
    stamp = fs_now_ms(paths.DATA)
    with Lock("wb-" + key, keepalive=True):            # no migration (an open creating a deck) meanwhile
        others = decks.others(key, client)
        if others:
            raise _busy(others)
        here, there = decks.deck_dir(key), decks.backup_dir(key)
        if (decks.deck_exists(key) and not _empty(key)) or (not decks.deck_exists(key) and decks.traces(key)):
            raise decks.DeckError(409, "this workbook has a setup now - delete that one first (it is kept too), then "
                                       "restore this one")
        decks.forget(key)
        moved = []
        try:
            steps = []
            if os.path.isdir(here):                     # the empty deck (or an empty folder): set aside in the bin
                steps.append((here, os.path.join(src, "replaced-%d" % stamp)))
            if os.path.isdir(there):
                steps.append((there, os.path.join(src, "replaced-backups-%d" % stamp)))
            steps.append((os.path.join(src, "deck"), here))
            if os.path.isdir(os.path.join(src, "backups")):
                steps.append((os.path.join(src, "backups"), there))
            for a, b in steps:
                os.makedirs(os.path.dirname(b), exist_ok=True)
                os.rename(a, b)
                moved.append((a, b))
        except OSError as e:
            _undo(moved, key, "restoring")
            raise decks.DeckError(409, "the setup could not be restored now (%s: the workbook's deck is in use on "
                                       "another PC?) - nothing changed; try again later" % e.__class__.__name__)
        # its v3 file as it was (frozen) - never over a document Slide Builder 3 owns
        saved = os.path.join(src, "v3.json")
        try:
            cur = _v3_doc(v3)
        except decks.DeckError:
            cur = {}
        if os.path.exists(saved) and (cur is None or migrate_v3.frozen(cur)):
            try:
                shutil.copy2(saved, v3)
                remove_quietly(saved)
            except OSError as e:
                log("deck %s restored: its v3 file was not put back (%s; kept in %s)" % (key, e, src))
    decks.forget(key)
    info = _info(name) or {}
    remove_quietly(os.path.join(src, INFO))
    try:
        os.rmdir(src)
    except OSError:
        pass                                            # (what was set aside stays there)
    log("deck %s (%s) restored from %s" % (key, info.get("workbook"), name))
    return {"key": key, "workbook": info.get("workbook")}
