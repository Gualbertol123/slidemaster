"""Who else has a workbook open: one heartbeat file per user@host in ``data/presence/``."""
import os

from . import paths
from .fsclock import fs_now, fs_now_ms
from .store import StoreUnreadable, read_json, write_json
from .util import current_host, current_user, remove_quietly, safe_component

WINDOW_MS = 25000                 # "others seen in the last 25 s"
CLEANUP_MS = 24 * 3600 * 1000     # heartbeat files older than this are deleted


def _dir():
    return paths.data_dir("presence")


def _own_path(user=None, host=None):
    return os.path.join(_dir(), "%s@%s.json" % (safe_component(user or current_user(), 80),
                                                 safe_component(host or current_host(), 80)))


def heartbeat(client, workbook, user=None, host=None, now=None):
    """Record our heartbeat and return the others seen in the last 25 s.
    `at` is written on the file server's clock, so all PCs compare on one timeline."""
    now = now if now is not None else fs_now_ms(_dir())
    user, host = user or current_user(), host or current_host()
    write_json(_own_path(user, host), {"user": user, "host": host, "client": client,
                                       "workbook": workbook, "at": now})
    return others(client, now)


def others(client, now=None):
    now = now if now is not None else fs_now_ms(_dir())
    out = []
    try:
        names = os.listdir(_dir())
    except OSError:
        return out
    for n in names:
        if not n.endswith(".json"):
            continue
        p = os.path.join(_dir(), n)
        try:
            d = read_json(p, None, attempts=2, delay=0.02)
        except StoreUnreadable:
            continue
        if not isinstance(d, dict):
            continue
        at = d.get("at") if isinstance(d.get("at"), (int, float)) else 0
        if now - at > CLEANUP_MS:
            try:
                if fs_now(_dir()) - os.path.getmtime(p) > CLEANUP_MS / 1000.0:
                    remove_quietly(p)
            except OSError:
                pass
            continue
        if now - at > WINDOW_MS or d.get("client") == client:
            continue
        out.append({"user": d.get("user"), "host": d.get("host"), "client": d.get("client"),
                    "workbook": d.get("workbook"), "at": at})
    out.sort(key=lambda x: (str(x["user"]), str(x["host"])))
    return out


def leave(client, user=None, host=None):
    """Delete our heartbeat file if it still belongs to this client."""
    p = _own_path(user, host)
    try:
        d = read_json(p, None, attempts=2, delay=0.02)
    except StoreUnreadable:
        return False
    if isinstance(d, dict) and d.get("client") == client:
        return remove_quietly(p)
    return False
