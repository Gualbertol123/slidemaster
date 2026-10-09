"""Who else has a workbook open: one heartbeat file per user@host in ``data/presence/``.

The file NAME carries everything the others need:

    hb~<user>~<host>~<client>~<workbook>.json      (each part %-encoded, so "~" never appears inside)

so ``others`` is ONE directory listing: who is there comes from the names, how fresh from the
listing's modification times, which the file server stamps (compared with ``fsclock.fs_now``, so PCs
with wrong clocks agree). On Windows the listing carries the times, so no file is opened or stat'ed
one by one - before, every heartbeat read every other user's file (P10, docs/next/01 §5).

The file still holds the same JSON as before (``user, host, client, workbook, at``), so a helper of an
older version keeps seeing everybody, and files of the old format (``<user>@<host>.json``, written by
an older helper) are still read - only when the listing says they are fresh. A workbook name too long
for a file name is stored as a hash; such a file is read like an old one.

The name stays short whatever the names are (Windows paths without long-path support stop at 260
characters, and the share's own path comes first): each part has a budget, and a part over it is stored
as "#<hash>"; the file is then read for the real values (rare: long user names, long workbook names).
"""
import hashlib
import os
import urllib.parse

from . import paths
from .fsclock import fs_now
from .store import StoreUnreadable, read_json, write_json
from .util import current_host, current_user, remove_quietly, safe_component

WINDOW_MS = 25000                 # "others seen in the last 25 s"
CLEANUP_MS = 24 * 3600 * 1000     # heartbeat files older than this are deleted
PREFIX = "hb~"
NO_WORKBOOK = "-"                 # no workbook open (a real name is never "-": it ends in .xlsx …)
LIMITS = (20, 20, 16, 32)         # user, host, client, workbook: encoded characters, at most 99 for the name


def _dir():
    return paths.data_dir("presence")


def _enc(s):
    # quote() never encodes "~" (an "unreserved" URL character), but here it separates the parts
    return urllib.parse.quote(s or "", safe=" !#$&'()+,-.;=@[]^_`{}").replace("~", "%7E")


def _dec(s):
    return urllib.parse.unquote(s)


def _old_name(user, host):
    return "%s@%s.json" % (safe_component(user, 80), safe_component(host, 80))


def _part(value, limit):
    """the %-encoded value, or "#<hash>" when that is longer than `limit` (never cut: a cut %XX garbles it)"""
    e = _enc(value) or "_"
    return e if len(e) <= limit else "#" + hashlib.sha1((value or "").encode("utf-8")).hexdigest()[:12]


def _parts(user, host, client, workbook):
    return (_part(user, LIMITS[0]), _part(host, LIMITS[1]), _part(client, LIMITS[2]),
            NO_WORKBOOK if workbook is None else _part(workbook, LIMITS[3]))


def file_name(user, host, client, workbook):
    return PREFIX + "~".join(_parts(user, host, client, workbook)) + ".json"


def parse_name(name):
    """(user, host, client, workbook, complete) of a new-format name, or None. complete=False: a part is
    a hash, read the file for the real values."""
    if not (name.startswith(PREFIX) and name.endswith(".json")):
        return None
    parts = name[len(PREFIX):-len(".json")].split("~")
    if len(parts) != 4:
        return None
    if any(p.startswith("#") for p in parts):
        return None, None, None, None, False
    user, host, client, wb = parts
    return _dec(user), _dec(host), _dec(client), (None if wb == NO_WORKBOOK else _dec(wb)), True


def _own(name, user, host):
    """the file belongs to this user@host (either format)"""
    if name == _old_name(user, host):
        return True
    p = name[len(PREFIX):].split("~") if name.startswith(PREFIX) else []
    return len(p) == 4 and (p[0], p[1]) == _parts(user, host, "", None)[:2]


def _listing():
    """[(name, mtime seconds on the server's clock)] - one directory listing"""
    out = []
    try:
        with os.scandir(_dir()) as it:
            for e in it:
                if e.name.endswith(".json"):
                    try:
                        out.append((e.name, e.stat().st_mtime))
                    except OSError:
                        continue
    except OSError:
        pass
    return out


def heartbeat(client, workbook, user=None, host=None, now=None):
    """Record our heartbeat and return the others seen in the last 25 s."""
    user, host = user or current_user(), host or current_host()
    server_now = now / 1000.0 if now is not None else fs_now(_dir())
    mine = file_name(user, host, client, workbook)
    write_json(os.path.join(_dir(), mine), {"user": user, "host": host, "client": client,
                                            "workbook": workbook, "at": int(server_now * 1000)})
    listing = _listing()
    for name, _mtime in listing:          # our heartbeat under an older name (other workbook, client, format)
        if name != mine and _own(name, user, host):
            remove_quietly(os.path.join(_dir(), name))
    return _others(client, server_now, [x for x in listing if not _own(x[0], user, host) or x[0] == mine])


def others(client, now=None):
    server_now = now / 1000.0 if now is not None else fs_now(_dir())
    return _others(client, server_now, _listing())


def _others(client, server_now, listing):
    out = []
    for name, mtime in listing:
        age_ms = (server_now - mtime) * 1000.0
        p = os.path.join(_dir(), name)
        if age_ms > CLEANUP_MS:
            remove_quietly(p)
            continue
        if age_ms > WINDOW_MS:            # stale by the listing: never opened
            continue
        row = parse_name(name)
        if row and row[4]:
            user, host, cl, wb, _ = row
            at = int(mtime * 1000)
        else:                              # old format, or a hashed workbook name: the file says
            try:
                d = read_json(p, None, attempts=2, delay=0.02)
            except StoreUnreadable:
                continue
            if not isinstance(d, dict):
                continue
            at = d.get("at") if isinstance(d.get("at"), (int, float)) else 0
            if server_now * 1000.0 - at > WINDOW_MS:
                continue
            user, host, cl, wb = d.get("user"), d.get("host"), d.get("client"), d.get("workbook")
        if cl == client:
            continue
        out.append({"user": user, "host": host, "client": cl, "workbook": wb, "at": int(at)})
    out.sort(key=lambda x: (str(x["user"]), str(x["host"])))
    return out


def leave(client, user=None, host=None):
    """Delete our heartbeat file if it still belongs to this client."""
    user, host = user or current_user(), host or current_host()
    done = False
    for name, _mtime in _listing():
        if not _own(name, user, host):
            continue
        row = parse_name(name)
        if row and row[4]:
            if row[2] == client:
                done = remove_quietly(os.path.join(_dir(), name)) or done
            continue
        try:
            d = read_json(os.path.join(_dir(), name), None, attempts=2, delay=0.02)
        except StoreUnreadable:
            continue
        if isinstance(d, dict) and d.get("client") == client:
            done = remove_quietly(os.path.join(_dir(), name)) or done
    return done
