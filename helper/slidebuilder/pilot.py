"""The Slide Builder 4 pilot on a COPY of the data (docs/next/04 §4.5, docs/next/pilot-v4.md).

"Start Slide Builder (v4 pilot).bat" runs ``slide_builder.py --pilot`` with

    SLIDEBUILDER_DATA   = <main>\\backend\\data\\v4-pilot      the copy (made here once; --refresh takes a new one)
    SLIDEBUILDER_EXPORT = <main>\\export\\v4-pilot             the pilot's PDFs and PNGs

so the pilot never writes the data Slide Builder 3 uses. The copy holds everything of backend\\data but the copy
itself, its older copies, locks (they belong to running programs) and backups (big, and nobody restores them in
the pilot). It is made in v4-pilot.part and renamed when complete, so an interrupted copy is never used. A refresh
renames the old copy to v4-pilot.old-<time> (nothing is deleted) and is refused while somebody is in the copy.

In pilot mode the helper also listens from port 8865 (Slide Builder 3 from 8765: neither opens the other's page)
and skips the v2 settings import, which renames a file in the main backend\\ folder.
"""
import datetime
import json
import os
import shutil
import time
import uuid

from . import VERSION, paths
from .decks import parse_presence
from .util import current_host, current_user

NAME = "v4-pilot"
PORT = 8865
MARKER = "pilot.json"
SKIP = {"locks", "backups"}          # directly below backend\data (plus the copy and its older copies)
BUSY_WINDOW = 60.0                    # s: a presence file touched this recently means somebody is in the copy
PROGRESS = ".copying"                 # in v4-pilot.part: touched every few seconds while a PC makes the copy
STALE_PART = 300.0                    # s: a v4-pilot.part that has not moved for this long is an interrupted copy


class PilotError(Exception):
    """the pilot cannot start: the message says why and what to do"""


def source():
    """the data folder Slide Builder 3 uses: <main>\\backend\\data"""
    return os.path.join(paths.HOME_BACKEND, "data")


def target():
    return os.path.join(source(), NAME)


def export_dir():
    return os.path.join(paths.ROOT, "export", NAME)


def _same(a, b):
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def _skip(name):
    return name.lower() in SKIP or name.lower() == NAME or name.lower().startswith(NAME + ".")


def _copy_file(s, d):
    return shutil.copy2(s, d)


def _copy(src, dest):
    """backend\\data -> dest (a new folder); returns the number of files. Files are read whole: Slide Builder 3
    replaces a saved file atomically, so each copied file is one version of it. dest\\.copying is touched every few
    seconds: another PC starting the pilot meanwhile sees that a copy is being made (prepare)."""
    beat = os.path.join(dest, PROGRESS)
    last = [0.0]

    def copy(s, d):
        if time.monotonic() - last[0] > 2:
            os.utime(beat, None)
            last[0] = time.monotonic()
        return _copy_file(s, d)
    n = 0
    for entry in sorted(os.listdir(src)):
        if _skip(entry):
            continue
        s, d = os.path.join(src, entry), os.path.join(dest, entry)
        if os.path.isdir(s):
            shutil.copytree(s, d, ignore=shutil.ignore_patterns("*.update-tmp", "*.tmp"), copy_function=copy)
            n += sum(len(f) for _r, _d, f in os.walk(d))
        elif os.path.isfile(s):
            copy(s, d)
            n += 1
    return n


def _rename(src, dest, tries=10, delay=0.5):
    """os.rename, asked again for a few seconds: Windows refuses a rename for a moment while it or an antivirus
    still holds a file just written in the folder (seen on a test PC); not when the target exists"""
    for i in range(tries):
        try:
            return os.rename(src, dest)
        except OSError:
            if i == tries - 1 or os.path.exists(dest):
                raise
            time.sleep(delay)


def _server_now(folder):
    """the file server's clock: the mtime of a probe file written in `folder` (a folder of the pilot, never the real
    data); this PC's clock when that fails"""
    probe = os.path.join(folder, ".probe-%s-%d" % (current_host(), os.getpid()))
    try:
        with open(probe, "w"):
            pass
        return os.stat(probe).st_mtime
    except OSError:
        return time.time()
    finally:
        try:
            os.remove(probe)
        except OSError:
            pass


def _start_copy(part):
    """take v4-pilot.part for this copy: True, or False when another PC is making the copy right now. A .part that
    has not moved for STALE_PART seconds is an interrupted copy and is removed."""
    for _ in range(2):
        try:
            os.mkdir(part)                      # exclusive: one PC makes the copy
        except FileExistsError:
            try:
                moved = os.stat(os.path.join(part, PROGRESS)).st_mtime
            except OSError:
                try:
                    moved = os.stat(part).st_mtime
                except OSError:
                    continue                    # gone meanwhile: try again
            if _server_now(part) - moved < STALE_PART:
                return False
            dead = "%s-dead-%s" % (part, uuid.uuid4().hex[:10])
            try:
                os.rename(part, dead)               # only one PC wins this rename: the others never delete a new .part
            except OSError:
                continue
            shutil.rmtree(dead, ignore_errors=True)
            continue
        with open(os.path.join(part, PROGRESS), "w"):
            pass
        return True
    return False


def busy(folder):
    """somebody works in this copy now: a deck's presence file touched in the last minute (the file server's
    clock, read from a probe file written next to them)"""
    decks = os.path.join(folder, "v4", "decks")
    if not os.path.isdir(decks):
        return []
    now = _server_now(folder)
    who = []
    for key in os.listdir(decks):
        pres = os.path.join(decks, key, "presence")
        try:
            with os.scandir(pres) as it:
                for e in it:
                    row = parse_presence(e.name)
                    if row and now - e.stat().st_mtime < BUSY_WINDOW:
                        who.append("%s on %s" % (row[0], row[1]))
        except OSError:
            continue
    return sorted(set(who))


def prepare(refresh=False, say=print):
    """check the pilot's folders, make the copy when missing (or --refresh), point the helper at it.
    Returns the copy's folder."""
    data, src = target(), source()
    want = os.environ.get("SLIDEBUILDER_DATA")
    if want and not _same(want, data):
        raise PilotError("The pilot runs only on %s, not on %s (SLIDEBUILDER_DATA)." % (data, want))
    want = os.environ.get("SLIDEBUILDER_EXPORT")
    if want and not _same(want, export_dir()):
        raise PilotError("The pilot exports only to %s, not to %s (SLIDEBUILDER_EXPORT)." % (export_dir(), want))
    if not os.path.isdir(src):
        raise PilotError("There is no data folder to copy: %s" % src)
    if os.path.isdir(data) and refresh:
        who = busy(data)
        if who:
            raise PilotError("Not refreshed: somebody is working in the pilot copy now - %s. Try again when they have "
                             "closed Slide Builder." % ", ".join(who))
        old = "%s.old-%s" % (data, datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        _rename(data, old)
        say("The old pilot copy is kept as %s" % old)
    if not os.path.isdir(data):
        part = data + ".part"
        if not _start_copy(part):
            raise PilotError("Another PC is copying the data for the pilot right now - start again in a few minutes.")
        say("Copying the data for the pilot (once): %s -> %s ..." % (src, data))
        try:
            n = _copy(src, part)
            with open(os.path.join(part, MARKER), "w", encoding="utf-8") as f:
                json.dump({"from": src, "at": datetime.datetime.now().isoformat(timespec="seconds"), "by": current_user(),
                           "host": current_host(), "version": VERSION, "files": n}, f, indent=1)
            os.remove(os.path.join(part, PROGRESS))
            have = sum(len([f for f in files if not f.startswith(".probe-")]) for _r, _d, files in os.walk(part))
            if have != n + 1:                       # the files and pilot.json: anything else is not this copy
                raise PilotError("The pilot copy came out incomplete (%d of %d files) - start again." % (have - 1, n))
            try:
                _rename(part, data)
            except OSError:
                if not os.path.isdir(data):
                    raise
                shutil.rmtree(part, ignore_errors=True)     # another PC finished a copy first: that one is used
                say("Another PC made the pilot copy at the same time - using that one.")
                n = None
        except BaseException:
            shutil.rmtree(part, ignore_errors=True)
            raise
        if n is not None:
            say("  %d files copied." % n)
    elif not refresh:
        say("Using the pilot copy made %s (Start ... --refresh takes a new one)." % copied_at(data))
    paths.configure(data=data)
    paths.EXPORT_DIR = export_dir()
    if _same(paths.DATA, src):                  # never, by construction: the last guard before anything is written
        raise PilotError("The pilot would use the real data folder - stopped.")
    return data


def copied_at(folder):
    try:
        with open(os.path.join(folder, MARKER), encoding="utf-8") as f:
            return json.load(f).get("at") or "?"
    except (OSError, ValueError, AttributeError):
        return "at an unknown time"
