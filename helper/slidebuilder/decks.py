"""Decks of Slide Builder 4 on the shared folder: a snapshot plus append-only journals (docs/next/04 §2, ADR-006).

    data/v4/decks/<key>/
      snapshot.json          {"format": 4 or 5, "gen", "workbook", "lamport", "rev", "frontier": {journal: offset}, "by", "at", "doc"}
      j/<journal>.log        framed records, append-only, ONE writer per file (no lock on the edit path)
      presence/<who>         empty files; their mtime (file-server clock) is the heartbeat
      lock                   compaction / migration lock (locks.Lock: O_EXCL, token, stale 15 s on the server clock)
      incident-*.json        a journal is corrupt in the middle: the deck is read-only (never happens; monitored)
      incident-format-5.json the deck holds Slide Builder 4.6 objects (ADR-019): NOT an incident for 4.6 and later; every
                             4.0-4.5 helper takes it for one, so their pages can no longer write, compact or open the deck
      moved-from-v3.json     written once by the migration (migrate_v3.py)
    data/backups/v4/<key>/<gen>.json   each compaction's snapshot (the last 30)

**The helper never parses or applies operations.** A record is an opaque JSON object to it; it reads only the
envelope: ``w`` (the writer, which must own the journal), ``s`` and ``l`` (integers), and it stamps ``at`` (the
file server's clock). Folding records into a document is the TypeScript core's job (core/src/model/fold.ts).

Record framing: ``<decimal length>:<crc32 hex 8>:<json>\\n``. A reader takes a record only when its length, CRC
and newline are all there; an incomplete tail (a frame being written, or torn by a crash) is left in place and
read again at the next poll. A complete frame whose CRC or newline is wrong, or a header that is not a header,
is corruption: an incident file is written and the deck becomes read-only.

Journals. A writer is one page session, ``<user>@<host>#<8 random base32>`` (:func:`new_writer`). Its first record
goes to ``j/<writer>.log``; when a file cannot be used any more - a write failed (it may end in a torn frame), the
handle was idle for 10 minutes, the helper restarted, the page asked to rotate - the next append opens a NEW file
``j/<writer>~<n>.log``, n = the file server's time in ms (larger than every earlier n, so a name is never used
twice, not even after the file was deleted - a reader still holding an offset in it would read the wrong bytes),
created with O_EXCL (two helpers never share one). Nothing is ever appended after a torn frame, so a torn frame is
always a tail. A record retried after a failure carries the same ``(w, s)`` and the fold keeps one copy.

Who deletes journals: the owner, on ``rotate``, the files of its own writer that the snapshot's frontier covers;
and ``compact``, the covered files nobody has written to for 24 hours (a crashed or closed session - its handle
was closed after 10 idle minutes long before, see :data:`IDLE_CLOSE`).

Storage modes (G0 decision 2026-10-14, ADR-006's fallback): ``journal`` (default) as above; ``lean-lock``: every
append takes the deck lock and goes to ONE shared journal ``j/shared~<n>.log`` (n as above; a new one when the
last ends in a torn frame) - same endpoints, same records, same fold. Set by ``SLIDEBUILDER_STORAGE`` or ``data/v4/storage.json`` ``{"storage": "lean-lock"}``. The two can
even mix on one deck: the readers fold every journal they find.

The format guard (ADR-019, amended 2026-10-21). A deck is created and migrated at format 4 (CREATE_FORMAT), which
4.0-4.5 read. Before a 4.6 page writes anything 4.0.0 does not know (core/src/model/ops.ts needsV5) it raises the
deck: the marker (:func:`mark_format5`), a wait of BUMP_WAIT_S from the marker's time (how long a 4.0-4.5 helper
may take to see it: REFRESH_S or CHECK_TTL + the page's 1.5 s tail, plus the SMB client's 10 s directory cache), the
marker asked for again (this helper then lists the journals afresh), tails until every journal was read, then the
snapshot unchanged with gen + 1 and format 5 (compact: refused with 409 while the marker is younger than the wait),
and the record with a Lamport time 2^20 above everything seen. From then on: a 4.0-4.5 helper answers 423 to appends (the marker is an incident to it), refuses to read
the snapshot (409: open, compaction under the lock, rotate, and so the 24 h journal drop), and its tail reports no gen
and "read-only"; this helper refuses a format-5 deck to a page that does not send ``X-SB-Deck-Formats: 4,5``
(:func:`check_page`: a 4.0-4.5 page left open while its PC's helper was restarted on 4.6) and a compaction that would
lower 5 to 4 (400).
"""
import base64
import concurrent.futures
import json
import os
import re
import threading
import time
import urllib.parse
import uuid
import zlib

from . import fsclock, paths
from .fsclock import fs_now, offset_nowait
from .locks import Lock
from .util import current_host, current_user, doc_key, log, remove_quietly, safe_component, write_atomic

CREATE_FORMAT = 4                 # new and migrated decks: 4.0-4.5 read them until they hold a 4.6 object (ADR-019)
READ_FORMATS = (4, 5)             # 5: the deck holds what 4.0.0 does not know (raised by the page, never lowered)
MARKER5 = "incident-format-5.json"                 # (an "incident-" name: what every 4.0-4.5 helper honours)
OUTDATED5 = "Slide Builder was updated - reload the page (F5) to continue; your last change was not saved"
# s: how long after the marker a 4.0-4.5 page may still append (= core BUMP_WAIT_MS; ADR-019 amendment): journal mode,
# REFRESH_S 4 + the SMB directory cache 10 + 1; lean-lock (no refresher: only the page's tail looks again), CHECK_TTL
# 10 + TAIL_MS 1.5 + 10 + 1. The worst of the two, as the mode can differ per PC (SLIDEBUILDER_STORAGE).
BUMP_WAIT_S = 23.0
LISTING_TTL = 3.0                 # s: a deck's journal listing is cached (the SMB client may cache it 10 s more)
TAIL_PARALLEL = 8                 # journals read at once by one tail
IDLE_CLOSE = 600.0                # s: an append handle unused for this long is closed; the next append opens a new file
DEAD_JOURNAL = 24 * 3600.0        # s: a covered journal nobody wrote to for this long is dropped by a compaction
PRESENCE_WINDOW = 25.0            # s: "others here" = presence files touched in the last 25 s (server clock)
PRESENCE_CLEANUP = 24 * 3600.0    # s: presence files older than this are deleted by anyone
BACKUP_KEEP = 30
READ_ATTEMPTS, READ_DELAY = 5, 0.1
JOURNAL_RE = re.compile(r"^([A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,60}#[a-z2-7]{8}|shared)(~[1-9][0-9]{0,15})?\.log\Z")
STORAGE_TTL = 60.0                # s: the storage mode (an environment variable or data/v4/storage.json) is read again
CHECK_TTL = 10.0                  # s: how long a deck's existence / incident files seen by this helper are trusted
REFRESH_S = 4.0                   # s: decks with an open append handle are looked at again in the background (a rollback)
WRITER_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,60}#[a-z2-7]{8}\Z")      # \Z: `$` admits a final line end
KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}-[0-9a-f]{10}\Z")
CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}\Z")


class DeckError(RuntimeError):
    """A request the deck refuses; ``status`` is the HTTP code (404 no such deck, 409 conflict, 423 read-only, 503 busy)."""

    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status = status
        self.extra = extra


# --------------------------------------------------------------------------- framing (spikes/storage/journal_sim.py)
def frame(rec):
    body = json.dumps(rec, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return b"%d:%08x:" % (len(body), zlib.crc32(body) & 0xFFFFFFFF) + body + b"\n"


def unframe(buf):
    """(records, bytes used, corrupt) - the complete records at the start of `buf`. An incomplete frame at the end
    stops the scan without error (a tail still being written, or torn); `corrupt` is the offset (within buf) of a
    frame that is complete but wrong, or of bytes that cannot be a frame header, else None."""
    recs, _ends, used, corrupt = unframe_ends(buf)
    return recs, used, corrupt


def unframe_ends(buf):
    """as :func:`unframe`, with the end offset (within buf) of each record: (records, ends, used, corrupt)"""
    out, ends, p, n_buf = [], [], 0, len(buf)
    while p < n_buf:
        if not buf[p:].strip(b"\x00"):
            break                                       # zeros a crash left when the file grew before its data: torn
        a = buf.find(b":", p, p + 12)
        if a < 0:
            # no ':' after at most 11 digits: a header still being written if all that is there are digits
            if n_buf - p >= 12 or not buf[p:].isdigit():
                return out, ends, p, p
            break
        head = buf[p:a]
        if not head.isdigit():
            return out, ends, p, p
        n = int(head)
        if n_buf < a + 10:
            break                                       # the CRC is not all there yet
        crc_raw = buf[a + 1:a + 9]
        if buf[a + 9:a + 10] != b":" or not re.match(rb"^[0-9a-f]{8}$", crc_raw):
            return out, ends, p, p
        end = a + 10 + n
        if n_buf < end + 1:
            # the body or its newline is still missing - unless a line end follows the header: a body never holds one
            # (compact JSON), so its length is wrong (a damaged length field, digits before a header) - corruption,
            # never a torn tail that would hide the records after it (docs/next/AUDIT.md DATA-1)
            if b"\n" in buf[a + 10:n_buf]:
                return out, ends, p, p
            break
        body = buf[a + 10:end]
        if buf[end:end + 1] != b"\n" or zlib.crc32(body) & 0xFFFFFFFF != int(crc_raw, 16):
            # the last frame, with zeros where its body or newline should be (the file server lost power during an
            # append nobody was told about: the file grew, its data never landed), is torn, not corrupt; a bad frame
            # with anything after it, or without zeros, is corruption
            if b"\x00" in buf[a + 10:end + 1] and not buf[end + 1:].strip(b"\x00"):
                break
            return out, ends, p, p
        try:
            rec = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return out, ends, p, p
        if not isinstance(rec, dict):
            return out, ends, p, p
        out.append(rec)
        p = end + 1
        ends.append(p)
    return out, ends, p, None


# --------------------------------------------------------------------------- names and folders
def deck_key(workbook):
    """v3's document key, so a deck keeps its identity (util.doc_key)"""
    return doc_key(workbook)


def check_key(key):
    if not isinstance(key, str) or not KEY_RE.match(key):
        raise DeckError(400, "invalid deck key")
    return key


def deck_dir(key, *parts):
    return paths.data_dir("v4", "decks", check_key(key), *parts)


def journal_dir(key):
    return deck_dir(key, "j")


def snapshot_path(key):
    return deck_dir(key, "snapshot.json")


def backup_dir(key):
    return paths.data_dir("backups", "v4", check_key(key))


def deck_lock(key, **kw):
    """the deck's compaction / migration lock: data/v4/decks/<key>/lock (v3 Lock protocol)"""
    return Lock("deck " + key, directory=deck_dir(key), filename="lock", **kw)


def server_ms():
    """the file server's clock (fsclock; its offset is measured again in the background every 30 s, so an
    append never waits for a clock probe)"""
    return int((time.time() + offset_nowait(paths.DATA)) * 1000)


_issued = set()                           # writer ids this helper gave out: only those may start <writer>.log
_bound = {}                               # writer -> (key, born): the deck (its creation: born_of) it was issued for
_borns = {}                               # key -> (monotonic time, born): born_of's cache (CHECK_TTL)
DELETED = "this setup was deleted and the workbook was started again - reload the page (F5) to continue"
_shared_last = {}                         # deck key -> the last shared journal number this helper gave out


def new_writer(user=None, host=None):
    """a writer id for one page session: <user>@<host>#<8 random base32> (file-name safe)"""
    rnd = base64.b32encode(os.urandom(5)).decode("ascii").lower()
    w = "%s@%s#%s" % (safe_component(user or current_user(), 60), safe_component(host or current_host(), 60), rnd)
    _issued.add(w)
    return w


BORN = "born"                             # data/v4/decks/<key>/born: the creation id of a deck a delete left (B44)


def born_of(key, ttl=CHECK_TTL):
    """the deck's creation id: the content of its `born` file - written only for the empty deck a delete leaves
    (deckbin.py), so every other deck has none (None) and no compaction, of any version, ever touches it. Cached
    for CHECK_TTL (on another PC a delete is seen up to that much later); a file that cannot be read now counts as
    unchanged, and as UNKNOWN when nothing was read before"""
    seen = _borns.get(key)
    if seen is not None and time.monotonic() - seen[0] < ttl:
        return seen[1]
    try:
        with open(deck_dir(key, BORN), "rb") as f:
            v = f.read().decode("ascii", "replace").strip() or None
    except FileNotFoundError:
        v = None
    except OSError:
        return seen[1] if seen else UNKNOWN
    _borns[key] = (time.monotonic(), v)
    return v


UNKNOWN = object()                        # born_of: the file could not be read and nothing was read before


def bind_writer(writer, key):
    """the writer was issued for this deck as it is now (its creation, born_of; B44) - a writer of a deck deleted
    since never writes into the deck its workbook got afterwards. (In this helper's memory: a helper started again
    forgets it, and a helper older than 4.6 never checks - the deleted deck's gen + 1 still stops their compactions)"""
    b = born_of(key, 0)
    if b is UNKNOWN:
        raise DeckError(503, "the deck's folder cannot be read right now - trying again")
    _bound[writer] = (key, b)


def _check_born(key, writer):
    b = _bound.get(writer)
    if not b or b[0] != key:
        return
    cur = born_of(key)
    if cur is not UNKNOWN and cur != b[1]:         # (not readable now: the deck's existence was checked already)
        raise DeckError(409, DELETED)


def journal_writer(name):
    """the writer of a journal file name (shared for lean-lock files), or None"""
    m = JOURNAL_RE.match(name)
    return m.group(1) if m else None


def journal_name(writer, n):
    return "%s%s.log" % (writer, "~%d" % n if n else "")


def stem(name):
    return name[:-4] if name.endswith(".log") else name


_storage = {}                    # data folder -> (monotonic time, mode)


def storage_mode():
    """journal or lean-lock: SLIDEBUILDER_STORAGE, else data/v4/storage.json (read once a minute, never on every
    append: an append costs the share two round trips, write and flush)"""
    env = (os.environ.get("SLIDEBUILDER_STORAGE") or "").strip().lower()
    if env:
        return "lean-lock" if env == "lean-lock" else "journal"
    hit = _storage.get(paths.DATA)
    if hit and time.monotonic() - hit[0] < STORAGE_TTL:
        return hit[1]
    try:
        with open(paths.data_dir("v4", "storage.json"), "rb") as f:
            v = json.loads(f.read().decode("utf-8-sig"))
        mode = "lean-lock" if isinstance(v, dict) and v.get("storage") == "lean-lock" else "journal"
    except (OSError, ValueError):
        mode = "journal"
    _storage[paths.DATA] = (time.monotonic(), mode)
    return mode


# --------------------------------------------------------------------------- reads with retries
def _read_bytes(path, attempts=READ_ATTEMPTS, delay=READ_DELAY):
    """bytes of `path`; None when it does not exist; DeckError 503 when it exists and stays unreadable"""
    last = None
    for i in range(attempts):
        try:
            with open(path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            if not os.path.exists(path):
                return None
            last = "file vanished while reading"
        except OSError as e:
            last = e
        if i < attempts - 1:
            time.sleep(delay)
    raise DeckError(503, "%s cannot be read right now (%s)" % (os.path.basename(path), str(last).splitlines()[0][:120]))


def read_snapshot(key):
    """the deck's snapshot (a dict). 404 when the deck does not exist; 503 when it cannot be read or parsed -
    never an empty document"""
    path = snapshot_path(key)
    last = None
    for i in range(READ_ATTEMPTS):
        raw = _read_bytes(path, attempts=1)
        if raw is None:
            if not os.path.exists(path):
                raise DeckError(404, "no such deck")
            last = "file vanished while reading"
        else:
            try:
                snap = json.loads(raw.decode("utf-8-sig"))
                if isinstance(snap, dict) and isinstance(snap.get("gen"), int):
                    if snap.get("format") not in READ_FORMATS:
                        raise DeckError(409, "this deck was saved by a newer Slide Builder (format %r) - close the Slide Builder "
                                             "window and start it again to use the update" % snap.get("format"))
                    if snap.get("format") == 5:
                        _keep_marker(key)
                    return snap
                last = "not a snapshot"
            except (ValueError, UnicodeDecodeError) as e:
                last = e
        if i < READ_ATTEMPTS - 1:
            time.sleep(READ_DELAY)
    raise DeckError(503, "the deck's snapshot cannot be read right now (%s) - trying again" % str(last).splitlines()[0][:120])


def deck_exists(key):
    return os.path.exists(snapshot_path(key))


def traces(key):
    """what shows that a deck lived here although its snapshot.json is missing (journals, backups of its snapshots,
    the migration's record) - the first one found, or None. Such a deck is never created or migrated again from
    nothing: that would put gen 1 back over everything compacted (audit DATA-2, docs/next/AUDIT.md)"""
    for folder, what in ((journal_dir(key), "its journals"), (backup_dir(key), "backups of its snapshots")):
        try:
            if any(not n.startswith(".") for n in os.listdir(folder)):
                return what
        except OSError:
            pass
    if os.path.exists(deck_dir(key, "moved-from-v3.json")):
        return "moved-from-v3.json"
    return None


def missing_snapshot(key, what):
    return DeckError(503, "this deck's snapshot.json is missing, but it left %s - the deck is not opened (it would "
                     "start again from nothing); tell the maintainer, who restores snapshot.json from "
                     "data/backups/v4/%s" % (what, key))


# --------------------------------------------------------------------------- per-process state
class _Writer:
    """this helper's append handle of one writer on one deck"""

    def __init__(self):
        self.lock = threading.Lock()
        self.fd = None
        self.name = None                  # journal file name of the open handle
        self.pos = 0
        self.last_n = 0                   # the number of the last file this helper opened for the writer
        self.used = 0.0                   # monotonic time of the last use


_writers = {}                             # (key, writer) -> _Writer
_listings = {}                            # key -> (monotonic time, [journal names])
_snapsig = {}                             # key -> ((mtime_ns, size), gen)
_readonly = {}                            # key -> reason (an incident this helper saw)
_checked = {}                             # key -> monotonic time this helper last looked at the deck's folder
_rolled = {}                              # key -> True: the deck was rolled back to Slide Builder 3
_v5 = {}                                  # key -> True: the deck's folder holds MARKER5 (as of the last look)
ROLLED = "this deck was moved back to Slide Builder 3 - reload the page (F5) to continue"
_guard = threading.Lock()
_pool = None


def _executor():
    global _pool
    with _guard:
        if _pool is None:
            _pool = concurrent.futures.ThreadPoolExecutor(max_workers=TAIL_PARALLEL, thread_name_prefix="tail")
        return _pool


def reset():
    """forget every handle and cache (tests; a helper does this only when it stops)"""
    with _guard:
        for w in _writers.values():
            if w.fd is not None:
                try:
                    os.close(w.fd)
                except OSError:
                    pass
        _writers.clear()
        _listings.clear()
        _snapsig.clear()
        _readonly.clear()
        _checked.clear()
        _rolled.clear()
        _v5.clear()
        _issued.clear()
        _bound.clear()
        _borns.clear()
        _shared_last.clear()
        _storage.clear()


def _writer_state(key, writer):
    with _guard:
        st = _writers.get((key, writer))
        if st is None:
            st = _writers[(key, writer)] = _Writer()
        return st


def _close(st):
    if st.fd is not None:
        try:
            os.close(st.fd)
        except OSError:
            pass
    st.fd, st.name, st.pos = None, None, 0


def _known_files(key):
    """journals this helper writes on the deck (listed at once, without waiting for the directory cache)"""
    with _guard:
        return {st.name for (k, _w), st in _writers.items() if k == key and st.name}


# --------------------------------------------------------------------------- read-only decks (invariant 5)
def readonly_reason(key):
    """why the deck is read-only (an incident file exists), or None"""
    if key in _readonly:
        return _readonly[key]
    try:
        names = [n for n in os.listdir(deck_dir(key)) if _is_incident(n)]
    except OSError:
        return None
    if names:
        _readonly[key] = "a journal of this deck is damaged (%s) - the deck is read-only; tell the maintainer" % sorted(names)[0]
        return _readonly[key]
    return None


def _is_incident(name):
    """a real incident file (the format-5 marker is none for this helper; it is for 4.0-4.5)"""
    return name.startswith("incident-") and name.endswith(".json") and name != MARKER5


def _incident(key, journal, offset, size):
    """a CRC or framing failure in the middle of a journal: written once, never overwritten"""
    reason = "a journal of this deck is damaged (%s at byte %d) - the deck is read-only; tell the maintainer" % (journal, offset)
    _readonly[key] = reason
    name = "incident-%s-%d.json" % (safe_component(stem(journal), 90), offset)
    path = deck_dir(key, name)
    body = json.dumps({"deck": key, "journal": journal, "offset": offset, "size": size, "at": server_ms(),
                       "seenBy": "%s@%s" % (current_user(), current_host())}, indent=1).encode("utf-8")
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
    except FileExistsError:
        return reason
    except OSError as e:
        log("could not write the incident file %s: %s" % (name, e))
        return reason
    try:
        os.write(fd, body)
    finally:
        os.close(fd)
    log("INCIDENT: deck %s, journal %s is damaged at byte %d - the deck is read-only (%s)" % (key, journal, offset, name))
    return reason


def _check_writable(key):
    """refuse a read-only deck; the folder is looked at once per helper (and when a journal is opened), later
    appends cost no round trip for this - a damaged journal is also seen by every tail"""
    _look(key)
    if _rolled.get(key):
        raise DeckError(409, ROLLED)
    reason = _readonly.get(key)
    if reason:
        raise DeckError(423, reason, readonly=True)


# --------------------------------------------------------------------------- append
def _look(key, ttl=None):
    """the deck exists, and its incident files are known: one listing of its folder, at most every CHECK_TTL (an
    append looks only once per helper: `ttl` None; 0 = now)"""
    seen = _checked.get(key)
    if seen is not None and (ttl is None or time.monotonic() - seen < ttl):
        return
    try:
        names = os.listdir(deck_dir(key))
    except FileNotFoundError:
        names = None
    except OSError:
        return                                  # not now: the next request looks again
    if names is None or "snapshot.json" not in names:
        if not deck_exists(key):                # (a listing may be a little stale on SMB: ask for the file itself)
            _checked.pop(key, None)
            raise DeckError(404, "no such deck")
        names = names or []
    if "rolled-back.json" in names:            # back with Slide Builder 3 (migrate_v3.rollback): a v4 page reloads
        _rolled[key] = True
    else:
        _rolled.pop(key, None)
    inc = sorted(n for n in names if _is_incident(n))
    _v5[key] = MARKER5 in names
    if inc:
        _readonly[key] = "a journal of this deck is damaged (%s) - the deck is read-only; tell the maintainer" % inc[0]
    else:
        _readonly.pop(key, None)
    _checked[key] = time.monotonic()


# --------------------------------------------------------------------------- the format guard (ADR-019)
def mark_format5(key, by=None):
    """the deck's marker MARKER5, written once (O_EXCL; an existing one is kept): from their next look at the deck's
    folder every 4.0-4.5 helper takes the deck for read-only. Returns {created, at, now} (the file server's ms; `at`:
    when the marker was written - the page waits BUMP_WAIT_S from then before it raises the snapshot). The page asks
    again after its wait: this helper's journal listing of the deck is dropped each time, so the page's next tail
    lists the folder afresh (a journal an old helper opened in the gap is read before the snapshot is raised)."""
    check_key(key)
    _look(key, 0)                                   # the deck exists (404) - and is not read-only or rolled back:
    _check_writable(key)
    with _guard:
        _listings.pop(key, None)
    created, at, now = _write_marker(key, by)
    if created:
        log("deck %s now holds Slide Builder 4.6 objects: %s written (4.0-4.5 take it for read-only)" % (key, MARKER5))
    return {"created": created, "at": at, "now": now}


def _write_marker(key, by=None):
    """MARKER5 with O_EXCL: (created, at, now) - an existing one is kept and its time told"""
    path = deck_dir(key, MARKER5)
    now = server_ms()
    body = json.dumps({"deck": key, "format": 5, "what": "this deck uses Slide Builder 4.6 objects; it opens in Slide Builder "
                       "4.6 or later", "by": by or "%s@%s" % (current_user(), current_host()), "at": now}, indent=1).encode("utf-8")
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
    except FileExistsError:
        _v5[key] = True
        return False, _marker_at(path, now), now
    except OSError as e:
        raise DeckError(503, "the deck could not be marked for Slide Builder 4.6 (%s) - trying again" % e)
    try:
        os.write(fd, body)
        os.fsync(fd)
    finally:
        os.close(fd)
    _v5[key] = True
    return True, now, now


def _keep_marker(key):
    """a format-5 snapshot read without its marker (removed by hand, a backup put back by hand): written again, so
    that 4.0-4.5 helpers refuse appends of a page still open on the deck, not only its reads (review of S13.1, 3)"""
    if os.path.exists(deck_dir(key, MARKER5)):
        return
    try:
        if _write_marker(key)[0]:
            log("deck %s: format 5 without %s - written again" % (key, MARKER5))
    except DeckError:
        pass                                        # (the folder gone meanwhile: never re-created; the next read again)


def _marker_at(path, now):
    """when an existing marker was written (its "at", else its mtime: the file server's clock)"""
    try:
        at = json.loads((_read_bytes(path, attempts=2, delay=0.05) or b"{}").decode("utf-8")).get("at")
        if isinstance(at, int) and not isinstance(at, bool):
            return at
    except (DeckError, ValueError, UnicodeDecodeError, AttributeError):
        pass
    try:
        return int(os.stat(path).st_mtime * 1000)
    except OSError:
        return now


def page_formats(header):
    """the snapshot formats a page reads, from its X-SB-Deck-Formats header ("4,5"; none = a 4.0-4.5 page)"""
    out = set()
    for x in (header or "").split(","):
        x = x.strip()
        if x.isdigit():
            out.add(int(x))
    return out


def check_page(key, formats, snap=None):
    """409 "reload" for a page that does not read format 5 (no X-SB-Deck-Formats: 4,5 - a 4.0-4.5 page still open
    after its PC's helper was restarted on 4.6) on a deck that holds 4.6 objects: its marker (looked at again after
    REFRESH_S at most: the bump's wait covers that), or the snapshot `snap` read for it. Pages that send the header
    pay nothing."""
    if 5 in formats:
        return
    if snap is not None and snap.get("format") == 5:
        raise DeckError(409, OUTDATED5)
    check_key(key)
    _look(key, REFRESH_S)
    if _v5.get(key):
        raise DeckError(409, OUTDATED5)


def is_format5(key):
    """the deck is marked for 4.6 (its folder holds MARKER5)"""
    return os.path.exists(deck_dir(key, MARKER5))


def _new_number(names, prefix, floor=0):
    """a file number larger than any of `prefix`~<n> in `names`, than `floor` and than the server's time in ms
    (a name is never used twice, even after its file was deleted)"""
    ns = [floor]
    for x in names:
        m = re.match(re.escape(prefix) + r"~([0-9]+)\.log$", x)
        if m:
            ns.append(int(m.group(1)))
    return max(max(ns) + 1, server_ms())


def _validate_record(writer, record):
    if not isinstance(writer, str) or not WRITER_RE.match(writer):
        raise DeckError(400, "invalid writer")
    if not isinstance(record, dict):
        raise DeckError(400, "a record is a JSON object")
    if record.get("w") != writer:
        raise DeckError(400, "the record's writer is not the journal's")
    for k in ("l", "s"):
        v = record.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            raise DeckError(400, "the record's %s must be a positive integer" % k)


_refresher = []


def _start_refresher():
    """every REFRESH_S, the folder of each deck this helper appends to is looked at again (incidents, a rollback),
    off the edit path: an append never waits for it, and a rolled-back deck is refused within a few seconds"""
    with _guard:
        if _refresher:
            return
        t = threading.Thread(target=_refresh_loop, daemon=True, name="deck-folders")
        _refresher.append(t)
    t.start()


def _refresh_loop():
    while True:
        time.sleep(REFRESH_S)
        with _guard:
            keys = {k for (k, _w), st in _writers.items() if st.fd is not None}
        for key in keys:
            try:
                _look(key, 0)
            except Exception:                      # noqa: BLE001 - a deck gone or the share away: the next append says so
                pass


def _open_new(key, st, writer):
    """a NEW journal file for this writer (O_EXCL: never a file another helper or an earlier handle wrote). The
    writer's first record (s = 1) starts <writer>.log, later files are <writer>~<n>.log with a number never used
    before (_new_number): after a rotation deleted a file, or a restart, its name does not come back."""
    _look(key, 0)                           # the deck still exists (never re-create a deleted deck's folder)
    _check_writable(key)
    _check_born(key, writer)                # and it is the deck the writer was issued for (B44: not deleted since)
    folder = journal_dir(key)
    try:
        os.mkdir(folder)                    # (not makedirs: a deck folder deleted meanwhile is never made again)
    except FileExistsError:
        pass
    except FileNotFoundError:
        raise DeckError(404, "no such deck")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_APPEND | getattr(os, "O_BINARY", 0)
    # <writer>.log only for a writer this helper gave out and has not written yet: a writer of another helper (or of
    # this one before a restart) may have had a <writer>.log a rotation deleted, still named in the frontier
    names = [journal_name(writer, 0)] if writer in _issued and not st.last_n else []
    floor = st.last_n
    for _ in range(20):
        if not names:
            names = [journal_name(writer, _new_number(os.listdir(folder), writer, floor))]
        name = names.pop()
        try:
            fd = os.open(os.path.join(folder, name), flags, 0o644)
        except FileExistsError:
            floor = max(floor, _new_number([name], writer))
            continue
        m = re.search(r"~([0-9]+)\.log$", name)
        st.fd, st.name, st.pos = fd, name, 0
        _start_refresher()
        st.last_n = int(m.group(1)) if m else max(st.last_n, 1)
        with _guard:
            _listings.pop(key, None)
        return
    raise DeckError(503, "no free journal file name for %s" % writer)


def prepare(key, writer):
    """open the writer's journal ahead of its first append (the page asks when an edit starts, during its 300 ms
    debounce), so that the append itself costs the share two round trips: write and flush. Idempotent."""
    check_key(key)
    if not isinstance(writer, str) or not WRITER_RE.match(writer):
        raise DeckError(400, "invalid writer")
    _check_writable(key)
    if storage_mode() == "lean-lock":
        return {"ok": True}
    st = _writer_state(key, writer)
    with st.lock:
        if st.fd is not None and time.monotonic() - st.used > IDLE_CLOSE:
            _close(st)
        if st.fd is None:
            _open_new(key, st, writer)
        st.used = time.monotonic()            # the edit is coming: the handle is not idle
    return {"ok": True}


def append(key, writer, record):
    """stamp `at`, append the record's frame to the writer's journal and flush it to the share (FlushFileBuffers).
    Returns {journal, offset (after the record), at}. The record is acknowledged only when this returns."""
    check_key(key)
    _validate_record(writer, record)
    _check_writable(key)
    if storage_mode() == "lean-lock":
        return _append_shared(key, record)
    st = _writer_state(key, writer)
    with st.lock:
        now = time.monotonic()
        if st.fd is not None and now - st.used > IDLE_CLOSE:
            _close(st)                       # long idle (or the PC slept): a new file, never an old handle
        if st.fd is None:
            _open_new(key, st, writer)
        rec = dict(record)
        rec["at"] = server_ms()
        data = frame(rec)
        try:
            view = memoryview(data)
            while view:
                k = os.write(st.fd, view)
                view = view[k:]
            os.fsync(st.fd)
        except OSError as e:
            # the file may now end in a torn frame: it is never written again (the retry goes to a new file)
            _close(st)
            raise DeckError(503, "the record could not be written to the shared folder (%s) - trying again" % e)
        st.pos += len(data)
        st.used = time.monotonic()
        return {"journal": stem(st.name), "offset": st.pos, "at": rec["at"]}


def _append_shared(key, record):
    """lean-lock mode: one shared journal, appended under the deck lock"""
    rec = dict(record)
    folder = journal_dir(key)
    try:
        with deck_lock(key):
            # under the lock a rollback holds while it gives v3 the document: one stat closes its window exactly
            if os.path.exists(deck_dir(key, "rolled-back.json")):
                _rolled[key] = True
                raise DeckError(409, ROLLED)
            if not deck_exists(key):              # deleted (B44; taking the lock made its folder again: empty)
                raise DeckError(404, "no such deck")
            _check_born(key, rec.get("w"))
            os.makedirs(folder, exist_ok=True)
            names = os.listdir(folder)
            ns = [_shared_n(x) for x in names if journal_writer(x) == "shared"]
            rec["at"] = server_ms()
            data = frame(rec)
            name = journal_name("shared", max(ns)) if ns else None
            if name:
                with open(os.path.join(folder, name), "rb") as f:
                    f.seek(0, 2)
                    size = f.tell()
                    if size:
                        f.seek(size - 1)
                        if f.read(1) != b"\n":
                            name = None           # it ends in a torn frame: never append after it
            if not name:                          # a new shared journal, under a number never used before
                name = journal_name("shared", _new_shared_number(key, names))
            fd = os.open(os.path.join(folder, name), os.O_CREAT | os.O_WRONLY | os.O_APPEND | getattr(os, "O_BINARY", 0), 0o644)
            try:
                view = memoryview(data)
                while view:
                    k = os.write(fd, view)
                    view = view[k:]
                os.fsync(fd)
                end = os.fstat(fd).st_size
            finally:
                os.close(fd)
    except OSError as e:
        raise DeckError(503, "the record could not be written to the shared folder (%s) - trying again" % e)
    with _guard:
        _listings.pop(key, None)
    return {"journal": stem(name), "offset": end, "at": rec["at"]}


def _new_shared_number(key, names):
    """the number of a new shared journal (under the deck lock): above every one listed, every one the snapshot's
    frontier still names (a compaction deleted them) and the last one this helper gave out - the server's time in ms
    alone could repeat a deleted file's within the same millisecond"""
    try:
        gone = [j + ".log" for j in (read_snapshot(key).get("frontier") or {})]
    except Exception:                            # noqa: BLE001 - the listing and this helper's memory still apply
        gone = []
    n = _new_number(list(names) + gone, "shared", _shared_last.get(key, 0))
    _shared_last[key] = n
    return n


def _shared_n(name):
    m = re.match(r"^shared~([0-9]+)\.log$", name)
    return int(m.group(1)) if m else -1


# --------------------------------------------------------------------------- tail
def _listing(key):
    """journal file names of the deck (cached LISTING_TTL), plus the ones this helper writes"""
    now = time.monotonic()
    with _guard:
        hit = _listings.get(key)
    if hit and now - hit[0] < LISTING_TTL:
        names = hit[1]
    else:
        try:
            names = sorted(n for n in os.listdir(journal_dir(key)) if JOURNAL_RE.match(n))
        except FileNotFoundError:
            names = []
        except OSError:
            names = hit[1] if hit else []
        with _guard:
            _listings[key] = (now, names)
    return sorted(set(names) | _known_files(key))


def _read_from(path, offset):
    with open(path, "rb") as f:
        f.seek(offset)
        return f.read()


def _snapshot_gen(key):
    """the snapshot's gen with one stat while it does not change (None when unreadable now)"""
    try:
        s = os.stat(snapshot_path(key))
    except OSError:
        return None
    sig = (getattr(s, "st_mtime_ns", int(s.st_mtime * 1e9)), s.st_size)
    hit = _snapsig.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    try:
        gen = read_snapshot(key)["gen"]
    except DeckError:
        return None
    _snapsig[key] = (sig, gen)
    return gen


def tail(key, since):
    """new complete records of every journal past the offsets in `since` ({journal: offset}).
    Returns {journals: {journal: {offset, records, ends}}, gen, now, skipped?, readonly?}: only journals with new
    records (`ends`: each record's end offset); a journal that cannot be read now is left out and named in `skipped`
    (asked again next time, never treated as empty); `now` is the file server's time."""
    check_key(key)
    if not isinstance(since, dict) or any(not isinstance(k, str) or not isinstance(v, int) or isinstance(v, bool) or v < 0 for k, v in since.items()):
        raise DeckError(400, "since must map journal names to byte offsets")
    _look(key, CHECK_TTL)                         # exists, incidents: one listing at most every 10 s
    if _rolled.get(key):
        raise DeckError(409, ROLLED)
    folder = journal_dir(key)
    names = _listing(key)

    def one(name):
        off = since.get(stem(name), 0)
        path = os.path.join(folder, name)
        try:
            buf = _read_from(path, off)
            recs, ends, used, corrupt = unframe_ends(buf)
            if corrupt is not None and off:
                # bytes that are no frame where the reader said one starts: the reader's offset may be wrong (a page's
                # bug, a file it knew under the same name) - only a scan from the start of the file tells corruption
                buf, off = _read_from(path, 0), 0
                recs, ends, used, corrupt = unframe_ends(buf)
        except FileNotFoundError:
            return name, off, [], [], None, 0             # dropped meanwhile (covered by the snapshot)
        except OSError:
            return name, off, None, None, None, 0         # skipped this round, read again at the next poll
        return name, off + used, recs, [off + e for e in ends], (off + corrupt if corrupt is not None else None), off + len(buf)

    out, readonly, skipped = {}, _readonly.get(key), []
    for name, new_off, recs, ends, corrupt, size in _executor().map(one, names):
        if recs is None:
            skipped.append(stem(name))
            continue
        if corrupt is not None:
            readonly = _incident(key, name, corrupt, size)
        if recs:
            out[stem(name)] = {"offset": new_off, "records": recs, "ends": ends}
    gen = _snapshot_gen(key)
    if gen is None and not deck_exists(key):
        _checked.pop(key, None)
        raise DeckError(404, "no such deck")
    # `now`: the file server's time (a page compacts only records older than its margin); `skipped`: journals that could
    # not be read this time - a page does not compact on such a round (it may miss records)
    res = {"journals": out, "gen": gen}
    now = server_ms()                            # first: it notices a PC clock that was set, and measures again
    if fsclock.trusted(paths.DATA):              # an unknown offset: no `now`, so no page compacts on this round
        res["now"] = now
    if skipped:
        res["skipped"] = sorted(skipped)
    if readonly:
        res["readonly"] = readonly
    return res


# --------------------------------------------------------------------------- open (a new deck), snapshot
def empty_doc(workbook):
    """the document of a deck nobody has saved yet (v3's store.default_workbook)"""
    return {"schema": 3, "workbook": workbook, "rev": 0, "preset": None, "style": {}, "edits": {}}


def write_snapshot(key, snap):
    write_atomic(snapshot_path(key), (json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    with _guard:
        _snapsig.pop(key, None)


def first_snapshot(workbook, doc, by=None, at=None, rev=0, log_=None, updated=None, updated_by=None):
    """gen 1 of a deck: the document as it is (a v3 document or an empty one)"""
    snap = {"format": CREATE_FORMAT, "gen": 1, "workbook": workbook, "lamport": 0, "rev": rev, "frontier": {},
            "by": by or current_user(), "at": at if at is not None else server_ms(), "doc": doc}
    if updated is not None:
        snap["updated"] = updated
    if updated_by is not None:
        snap["updatedBy"] = updated_by
    if log_:
        snap["log"] = log_
    return snap


def summary(snap):
    """what a deck holds, for the lists of setups (B44): its workbook, gen, rev, last change, slides, tables, versions -
    as of its snapshot (changes not folded into it yet are not counted)"""
    doc = snap.get("doc") if isinstance(snap.get("doc"), dict) else {}
    preset = doc.get("preset") if isinstance(doc.get("preset"), dict) else {}
    slides = [s for s in (preset.get("slides") or []) if isinstance(s, dict) and (s.get("type") or "content") == "content"]
    return {"workbook": snap.get("workbook"), "gen": snap.get("gen"), "rev": snap.get("rev"), "format": snap.get("format"),
            "updated": snap.get("updated"), "updatedBy": snap.get("updatedBy"),
            "preset": bool(preset), "slides": len(slides), "tables": len(preset.get("tables") or []),
            "versions": len(preset.get("versions") or [])}


def create_if_missing(workbook):
    """the deck of a workbook, created empty under the deck lock when it does not exist. A workbook with a v3
    document is migrated instead (migrate_v3.ensure_deck)."""
    key = deck_key(workbook)
    if deck_exists(key):
        return key, False
    os.makedirs(deck_dir(key), exist_ok=True)
    with deck_lock(key):
        if deck_exists(key):
            return key, False
        left = traces(key)
        if left:
            raise missing_snapshot(key, left)
        write_snapshot(key, first_snapshot(workbook, empty_doc(workbook)))
    return key, True


# --------------------------------------------------------------------------- compact
def _validate_snapshot(snap, base):
    if not isinstance(snap, dict) or snap.get("format") not in READ_FORMATS:
        raise DeckError(400, "a snapshot of format 4 or 5 is expected")
    if snap.get("gen") != base + 1:
        raise DeckError(400, "the new snapshot's gen must be baseGen + 1")
    fr = snap.get("frontier")
    if not isinstance(fr, dict) or any(not isinstance(k, str) or not isinstance(v, int) or isinstance(v, bool) or v < 0 for k, v in fr.items()):
        raise DeckError(400, "frontier must map journal names to byte offsets")
    for k in ("lamport", "rev"):
        v = snap.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise DeckError(400, "%s must be a number" % k)
    if not isinstance(snap.get("doc"), dict):
        raise DeckError(400, "the snapshot has no document")


def compact(key, base_gen, snap, by=None):
    """compare-and-set of the snapshot on `gen`, under the deck lock (re-checked after taking it). The new
    snapshot never goes backwards: gen + 1, and every frontier offset, lamport and rev at least the current ones;
    a page never leaves a journal out of the frontier. Still under the lock, the journals the new frontier covers
    that nobody wrote to for 24 h are deleted and, once gone, their keys are taken out of the frontier (the same
    gen: the same document). After the lock, the backup (best effort). Returns {gen, dropped}."""
    check_key(key)
    if not isinstance(base_gen, int) or isinstance(base_gen, bool):
        raise DeckError(400, "baseGen must be a number")
    _validate_snapshot(snap, base_gen)
    _checked.pop(key, None)
    _check_writable(key)
    snap = dict(snap)
    snap["by"] = by or current_user()
    snap["at"] = server_ms()
    with deck_lock(key, keepalive=True):          # dropping journals on a slow share may take a while
        cur = read_snapshot(key)
        if cur["gen"] != base_gen:
            raise DeckError(409, "the deck was compacted meanwhile (gen %d)" % cur["gen"], gen=cur["gen"])
        old = cur.get("frontier") or {}
        try:
            present = {stem(n) for n in os.listdir(journal_dir(key)) if JOURNAL_RE.match(n)}
        except FileNotFoundError:
            present = set()
        for j, off in old.items():
            if j in snap["frontier"]:
                if snap["frontier"][j] < off:
                    raise DeckError(409, "the new snapshot is behind the current one (%s)" % j)
            elif j in present:
                raise DeckError(409, "the new snapshot leaves out a journal (%s)" % j)
        if snap["lamport"] < (cur.get("lamport") or 0) or snap["rev"] < (cur.get("rev") or 0):
            raise DeckError(409, "the new snapshot is behind the current one")
        if cur.get("format") == 5 and snap["format"] != 5:
            # a page that does not know 4.6's objects would write the deck without them (ADR-019: never lowered)
            raise DeckError(400, "this deck uses Slide Builder 4.6 objects: its snapshot is never written in an older format")
        if snap["format"] == 5 and cur.get("format") != 5:
            # the marker always comes first, and BUMP_WAIT_S before the raise: by then no 4.0-4.5 page appends any more
            # (the page waits for it - DocSync.upgrade; this makes the wall real for any other caller): 409, the page
            # asks for the marker again and waits for the rest
            created, at, now = _write_marker(key)
            if created:
                log("deck %s: %s written by a compaction to format 5 (refused until the wait has passed)" % (key, MARKER5))
            if created or now - at < (BUMP_WAIT_S - 1.0) * 1000:
                raise DeckError(409, "the deck is being prepared for Slide Builder 4.6 objects - trying again in a few seconds")
        write_snapshot(key, snap)
        dropped = _drop_dead(key, snap["frontier"])
        if dropped:
            # the files are gone: their keys only cost every reader a failed open. Readers still holding the
            # snapshot with them (the same gen) fold the same document.
            snap = dict(snap, frontier={j: v for j, v in snap["frontier"].items() if j not in dropped})
            try:
                write_snapshot(key, snap)
            except OSError as e:
                log("deck %s: the frontier keeps the dropped journals for now (%s)" % (key, e))
    _backup(key, snap)
    return {"gen": snap["gen"], "dropped": dropped}


def _covered(path, offset):
    """True when no complete record lies past `offset` in the journal (at most a torn tail); an offset past the
    file's end is not trusted"""
    try:
        if os.path.getsize(path) < offset:
            return False
        buf = _read_from(path, offset)
    except OSError:
        return False
    recs, _used, corrupt = unframe(buf)
    return not recs and corrupt is None


def _drop_dead(key, frontier):
    """delete the journals covered by `frontier` that nobody wrote to for 24 h (their handles were closed long ago:
    IDLE_CLOSE); called under the deck lock, after the snapshot that covers them was written"""
    dropped = []
    folder = journal_dir(key)
    try:
        entries = [(e.name, e.stat().st_mtime, e.stat().st_size) for e in os.scandir(folder) if JOURNAL_RE.match(e.name)]
    except OSError:
        return dropped
    now = fs_now(paths.DATA)
    mine = _known_files(key)
    for name, mtime, size in entries:
        j = stem(name)
        if name in mine or now - mtime < DEAD_JOURNAL:
            continue
        # covered by the frontier, or empty (a journal opened ahead of an edit that never came): nothing in it to keep
        if ((j in frontier and _covered(os.path.join(folder, name), frontier[j])) or size == 0) and remove_quietly(os.path.join(folder, name)):
            dropped.append(j)
    if dropped:
        with _guard:
            _listings.pop(key, None)
    return dropped


def _backup(key, snap):
    """backups/v4/<key>/<gen>.json, the last 30 kept; a failing backup never fails the compaction"""
    try:
        folder = backup_dir(key)
        body, path = (json.dumps(snap, ensure_ascii=False) + "\n").encode("utf-8"), os.path.join(folder, "%d.json" % snap["gen"])
        old = _read_bytes(path, attempts=1) if os.path.exists(path) else None
        if old is not None and old != body:      # another snapshot of the same gen is never replaced (audit DATA-2)
            path = os.path.join(folder, "%d-%d.json" % (snap["gen"], server_ms()))
        write_atomic(path, body)
        gens = sorted(int(n[:-5]) for n in os.listdir(folder) if re.match(r"^[0-9]+\.json$", n))
        for g in gens[:-BACKUP_KEEP]:
            remove_quietly(os.path.join(folder, "%d.json" % g))
        return True
    except Exception as e:                       # noqa: BLE001 - best effort, as v3's backups
        log("backup of deck %s failed: %s" % (key, e))
        return False


def history(key):
    """[{gen, rev, at, by}] of the compaction backups, newest first (the side panel's history)"""
    out = []
    folder = backup_dir(key)
    try:
        gens = sorted((int(n[:-5]) for n in os.listdir(folder) if re.match(r"^[0-9]+\.json$", n)), reverse=True)
    except OSError:
        return out
    for g in gens:
        try:
            raw = _read_bytes(os.path.join(folder, "%d.json" % g), attempts=2, delay=0.05)
            d = json.loads(raw.decode("utf-8")) if raw else {}
        except (DeckError, ValueError, UnicodeDecodeError):
            d = {}
        out.append({"gen": g, "rev": d.get("rev"), "at": d.get("at"), "by": d.get("by")})
    return out


# --------------------------------------------------------------------------- rotate
def rotate(key, writer):
    """close the writer's handle (its next append opens a new journal) and delete the writer's journals the
    current snapshot's frontier covers. Returns {deleted}."""
    check_key(key)
    if not isinstance(writer, str) or not WRITER_RE.match(writer):
        raise DeckError(400, "invalid writer")
    st = _writer_state(key, writer)
    deleted = []
    with st.lock:                              # the writer's own lock throughout: no prepare or append of this writer
        _close(st)                             # opens a journal while its files are looked at and deleted
        snap = read_snapshot(key)
        frontier = snap.get("frontier") or {}
        folder = journal_dir(key)
        try:
            names = [n for n in os.listdir(folder) if journal_writer(n) == writer]
        except OSError:
            names = []
        mine = _known_files(key)               # (another session's handle of the same writer id: never deleted under it)
        for name in names:
            if name in mine:
                continue
            j, p = stem(name), os.path.join(folder, name)
            covered = j in frontier and _covered(p, frontier[j])
            try:
                empty = not covered and os.path.getsize(p) == 0   # opened (prepare) but never written: nothing to keep
            except OSError:
                empty = False
            if (covered or empty) and remove_quietly(p):
                deleted.append(j)
    with _guard:
        _listings.pop(key, None)
    return {"deleted": sorted(deleted)}


def forget(key):
    """close this helper's append handles on the deck and forget what it cached of it (a deck deleted or restored,
    deckbin.py: nobody has it open, so the handles are idle ones of a window closed less than IDLE_CLOSE ago)"""
    with _guard:
        items = [st for (k, _), st in _writers.items() if k == key]
        _listings.pop(key, None)
        _snapsig.pop(key, None)
        _checked.pop(key, None)
        _readonly.pop(key, None)
        _rolled.pop(key, None)
        _v5.pop(key, None)
        _borns.pop(key, None)
    for st in items:
        with st.lock:
            _close(st)


def close_idle():
    """close append handles unused for IDLE_CLOSE (called now and then by the server)"""
    now = time.monotonic()
    with _guard:
        items = list(_writers.values())
    for st in items:
        if st.fd is not None and now - st.used > IDLE_CLOSE and st.lock.acquire(blocking=False):
            try:
                if st.fd is not None and now - st.used > IDLE_CLOSE:
                    _close(st)
            finally:
                st.lock.release()


# --------------------------------------------------------------------------- presence v2
def _penc(s, limit):
    e = urllib.parse.quote(s or "", safe=" !$&'()+,-.;=[]^_`{}").replace("~", "%7E")
    return e if len(e) <= limit else "%23" + uuid.uuid5(uuid.NAMESPACE_OID, s or "").hex[:12]


def presence_name(user, host, client):
    return "%s@%s#%s" % (_penc(user, 40), _penc(host, 40), client)


def parse_presence(name):
    m = re.match(r"^([^@#]+)@([^@#]+)#([A-Za-z0-9_-]{1,64})$", name)
    if not m:
        return None
    return urllib.parse.unquote(m.group(1)), urllib.parse.unquote(m.group(2)), m.group(3)


def heartbeat(key, client, user=None, host=None):
    """touch our presence file (its mtime set to the file server's clock) and return the others whose files were
    touched in the last 25 s - one listing (scandir) gives every name and mtime"""
    check_key(key)
    if not isinstance(client, str) or not CLIENT_RE.match(client):
        raise DeckError(400, "invalid client")
    user, host = user or current_user(), host or current_host()
    folder = deck_dir(key, "presence")
    mine = presence_name(user, host, client)
    path = os.path.join(folder, mine)
    now = fs_now(paths.DATA)
    try:
        os.utime(path, (now, now))
    except FileNotFoundError:
        if not deck_exists(key):
            raise DeckError(404, "no such deck")
        os.makedirs(folder, exist_ok=True)
        with open(path, "wb"):
            pass
        os.utime(path, (now, now))
    return {"others": others(key, client, now)}


def others(key, client, now=None):
    folder = deck_dir(key, "presence")
    now = fs_now(paths.DATA) if now is None else now
    out = []
    try:
        entries = [(e.name, e.stat().st_mtime) for e in os.scandir(folder)]
    except OSError:
        return out
    for name, mtime in entries:
        age = now - mtime
        if age > PRESENCE_CLEANUP:
            remove_quietly(os.path.join(folder, name))
            continue
        row = parse_presence(name)
        if not row or age > PRESENCE_WINDOW or row[2] == client:
            continue
        out.append({"user": row[0], "host": row[1], "client": row[2], "at": int(mtime * 1000)})
    out.sort(key=lambda x: (x["user"], x["host"], x["client"]))
    return out


def leave(key, client, user=None, host=None):
    check_key(key)
    if not isinstance(client, str) or not CLIENT_RE.match(client):
        raise DeckError(400, "invalid client")
    return remove_quietly(deck_dir(key, "presence", presence_name(user or current_user(), host or current_host(), client)))
