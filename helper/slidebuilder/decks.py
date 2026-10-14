"""Decks of Slide Builder 4 on the shared folder: a snapshot plus append-only journals (docs/next/04 §2, ADR-006).

    data/v4/decks/<key>/
      snapshot.json          {"format": 4, "gen", "workbook", "lamport", "rev", "frontier": {journal: offset}, "by", "at", "doc"}
      j/<journal>.log        framed records, append-only, ONE writer per file (no lock on the edit path)
      presence/<who>         empty files; their mtime (file-server clock) is the heartbeat
      lock                   compaction / migration lock (locks.Lock: O_EXCL, token, stale 15 s on the server clock)
      incident-*.json        a journal is corrupt in the middle: the deck is read-only (never happens; monitored)
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

from . import paths
from .fsclock import fs_now, offset_nowait
from .locks import Lock
from .util import current_host, current_user, doc_key, log, remove_quietly, safe_component, write_atomic

FORMAT = 4
LISTING_TTL = 10.0                # s: a deck's journal listing is cached (the SMB client caches it for 10 s anyway)
TAIL_PARALLEL = 8                 # journals read at once by one tail
IDLE_CLOSE = 600.0                # s: an append handle unused for this long is closed; the next append opens a new file
DEAD_JOURNAL = 24 * 3600.0        # s: a covered journal nobody wrote to for this long is dropped by a compaction
PRESENCE_WINDOW = 25.0            # s: "others here" = presence files touched in the last 25 s (server clock)
PRESENCE_CLEANUP = 24 * 3600.0    # s: presence files older than this are deleted by anyone
BACKUP_KEEP = 30
READ_ATTEMPTS, READ_DELAY = 5, 0.1
JOURNAL_RE = re.compile(r"^([A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,60}#[a-z2-7]{8}|shared)(~[1-9][0-9]{0,15})?\.log$")
STORAGE_TTL = 60.0                # s: the storage mode (an environment variable or data/v4/storage.json) is read again
CHECK_TTL = 10.0                  # s: how long a deck's existence / incident files seen by this helper are trusted
WRITER_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}@[A-Za-z0-9._-]{1,60}#[a-z2-7]{8}$")
KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}-[0-9a-f]{10}$")
CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


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
            break                                       # the body or its newline is still missing
        body = buf[a + 10:end]
        if buf[end:end + 1] != b"\n" or zlib.crc32(body) & 0xFFFFFFFF != int(crc_raw, 16):
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


def new_writer(user=None, host=None):
    """a writer id for one page session: <user>@<host>#<8 random base32> (file-name safe)"""
    rnd = base64.b32encode(os.urandom(5)).decode("ascii").lower()
    return "%s@%s#%s" % (safe_component(user or current_user(), 60), safe_component(host or current_host(), 60), rnd)


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
                    if snap.get("format") != FORMAT:
                        raise DeckError(409, "this deck was saved by a newer Slide Builder (format %r) - close the Slide Builder "
                                             "window and start it again to use the update" % snap.get("format"))
                    return snap
                last = "not a snapshot"
            except (ValueError, UnicodeDecodeError) as e:
                last = e
        if i < READ_ATTEMPTS - 1:
            time.sleep(READ_DELAY)
    raise DeckError(503, "the deck's snapshot cannot be read right now (%s) - trying again" % str(last).splitlines()[0][:120])


def deck_exists(key):
    return os.path.exists(snapshot_path(key))


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
        names = [n for n in os.listdir(deck_dir(key)) if n.startswith("incident-") and n.endswith(".json")]
    except OSError:
        return None
    if names:
        _readonly[key] = "a journal of this deck is damaged (%s) - the deck is read-only; tell the maintainer" % sorted(names)[0]
        return _readonly[key]
    return None


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
    inc = sorted(n for n in names if n.startswith("incident-") and n.endswith(".json"))
    if inc:
        _readonly[key] = "a journal of this deck is damaged (%s) - the deck is read-only; tell the maintainer" % inc[0]
    else:
        _readonly.pop(key, None)
    _checked[key] = time.monotonic()


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


def _open_new(key, st, writer, first):
    """a NEW journal file for this writer (O_EXCL: never a file another helper or an earlier handle wrote). The
    writer's first record (s = 1) starts <writer>.log, later files are <writer>~<n>.log with a number never used
    before (_new_number): after a rotation deleted a file, or a restart, its name does not come back."""
    _check_writable(key)
    _look(key, 0)                           # the deck still exists (never re-create a deleted deck's folder)
    if _readonly.get(key):
        raise DeckError(423, _readonly[key], readonly=True)
    folder = journal_dir(key)
    os.makedirs(folder, exist_ok=True)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_APPEND | getattr(os, "O_BINARY", 0)
    names = [journal_name(writer, 0)] if first and not st.last_n else []
    if names:
        try:                                # a <writer>.log a rotation deleted may still be in the frontier: never again
            if writer in (read_snapshot(key).get("frontier") or {}):
                names = []
        except DeckError:
            names = []
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
        st.last_n = int(m.group(1)) if m else max(st.last_n, 1)
        with _guard:
            _listings.pop(key, None)
        return
    raise DeckError(503, "no free journal file name for %s" % writer)


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
            _open_new(key, st, writer, record["s"] == 1)
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
                name = journal_name("shared", _new_number(names, "shared"))
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
    Returns {journals: {journal: {offset, records, ends}}, gen, readonly?}: only journals with new records (`ends`:
    each record's end offset); a journal that cannot be read now is left out (asked again next time, never
    treated as empty)."""
    check_key(key)
    if not isinstance(since, dict) or any(not isinstance(k, str) or not isinstance(v, int) or isinstance(v, bool) or v < 0 for k, v in since.items()):
        raise DeckError(400, "since must map journal names to byte offsets")
    _look(key, CHECK_TTL)                         # exists, incidents: one listing at most every 10 s
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

    out, readonly = {}, _readonly.get(key)
    for name, new_off, recs, ends, corrupt, size in _executor().map(one, names):
        if recs is None:
            continue
        if corrupt is not None:
            readonly = _incident(key, name, corrupt, size)
        if recs:
            out[stem(name)] = {"offset": new_off, "records": recs, "ends": ends}
    gen = _snapshot_gen(key)
    if gen is None and not deck_exists(key):
        _checked.pop(key, None)
        raise DeckError(404, "no such deck")
    res = {"journals": out, "gen": gen}
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
    snap = {"format": FORMAT, "gen": 1, "workbook": workbook, "lamport": 0, "rev": rev, "frontier": {},
            "by": by or current_user(), "at": at if at is not None else server_ms(), "doc": doc}
    if updated is not None:
        snap["updated"] = updated
    if updated_by is not None:
        snap["updatedBy"] = updated_by
    if log_:
        snap["log"] = log_
    return snap


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
        write_snapshot(key, first_snapshot(workbook, empty_doc(workbook)))
    return key, True


# --------------------------------------------------------------------------- compact
def _validate_snapshot(snap, base):
    if not isinstance(snap, dict) or snap.get("format") != FORMAT:
        raise DeckError(400, "a snapshot of format 4 is expected")
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
        entries = [(e.name, e.stat().st_mtime) for e in os.scandir(folder) if JOURNAL_RE.match(e.name)]
    except OSError:
        return dropped
    now = fs_now(paths.DATA)
    mine = _known_files(key)
    for name, mtime in entries:
        j = stem(name)
        if name in mine or j not in frontier or now - mtime < DEAD_JOURNAL:
            continue
        if _covered(os.path.join(folder, name), frontier[j]) and remove_quietly(os.path.join(folder, name)):
            dropped.append(j)
    if dropped:
        with _guard:
            _listings.pop(key, None)
    return dropped


def _backup(key, snap):
    """backups/v4/<key>/<gen>.json, the last 30 kept; a failing backup never fails the compaction"""
    try:
        folder = backup_dir(key)
        write_atomic(os.path.join(folder, "%d.json" % snap["gen"]), (json.dumps(snap, ensure_ascii=False) + "\n").encode("utf-8"))
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
    with st.lock:
        _close(st)
    snap = read_snapshot(key)
    frontier = snap.get("frontier") or {}
    folder = journal_dir(key)
    deleted = []
    try:
        names = [n for n in os.listdir(folder) if journal_writer(n) == writer]
    except OSError:
        names = []
    for name in names:
        j = stem(name)
        if j in frontier and _covered(os.path.join(folder, name), frontier[j]) and remove_quietly(os.path.join(folder, name)):
            deleted.append(j)
    with _guard:
        _listings.pop(key, None)
    return {"deleted": sorted(deleted)}


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
