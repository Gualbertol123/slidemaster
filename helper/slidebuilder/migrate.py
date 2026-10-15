"""One-time import of the v2 settings file (ARCHITECTURE §6).

Runs at start-up under lock ``migrate``; idempotent (``data/migrated.json`` is the marker) and it
never overwrites a document that already exists.

v2 file (backend/slide_builder_settings.txt)::

    {version: 2, app: {design, glass, color, logo, pdfMode, scale, lastFile, pn:{…}, pageStart?},
     presets: {<wb>: {version, updated, sheets, tables, slides}},
     files: {<wb>: {<sheet>: {cells: {<ref>: {…}}, layouts: {}}}}}
"""
import base64
import copy
import datetime as _dt
import hashlib
import json
import os
import shutil

from . import VERSION, decks, migrate_v3, paths, store
from .locks import Lock
from .util import current_host, current_user, log

# DEFAULT_SETTINGS().app of v2 (backend/src/app.js)
V2_APP_DEFAULTS = {"design": "glass", "glass": "subtle", "color": 35, "logo": "logo.png", "pdfMode": "exact", "scale": 3,
                   "lastFile": "",
                   "pn": {"on": False, "start": 1, "pos": "br", "font": "auto", "size": 16, "format": "n",
                          "style": "capsule", "cover": False}}


def norm_app(app):
    """normSettings() of v2 for the `app` part: defaults merged in, legacy `pageStart` -> pn.on/start."""
    d = copy.deepcopy(V2_APP_DEFAULTS)
    if isinstance(app, dict):
        d.update(copy.deepcopy({k: v for k, v in app.items() if k != "pn"}))
        pn = copy.deepcopy(V2_APP_DEFAULTS["pn"])
        if isinstance(app.get("pn"), dict):
            pn.update(copy.deepcopy(app["pn"]))
        d["pn"] = pn
    if "pageStart" in d:
        v = str(d.pop("pageStart") if d.get("pageStart") is not None else "").strip()
        try:
            n = float(v) if v else None
        except ValueError:
            n = None
        if n is not None and n == n and n not in (float("inf"), float("-inf")):
            d["pn"]["on"] = True
            d["pn"]["start"] = int(n) if n == int(n) else n
    return d


def convert_preset(p):
    """v2 preset -> v3 preset: cover and index are already ordinary slides in the list (kept in place)."""
    if not isinstance(p, dict):
        return None
    slides = []
    for s in p.get("slides") or []:
        if not isinstance(s, dict):
            continue
        s = copy.deepcopy(s)
        s.setdefault("type", "content")
        if not isinstance(s.get("tables"), list):
            s["tables"] = []
        slides.append(s)
    return {"sheets": copy.deepcopy([x for x in (p.get("sheets") or []) if isinstance(x, str)]),
            "tables": copy.deepcopy([t for t in (p.get("tables") or []) if isinstance(t, dict)]),
            "slides": slides}


def workbook_ops(preset, sheets):
    """The import expressed as ordinary operations, so the result follows §3.2 exactly."""
    ops = []
    if preset is not None:
        ops.append({"op": "preset.set", "preset": preset})
    for sheet, cfg in (sheets or {}).items():
        cells = cfg.get("cells") if isinstance(cfg, dict) else None
        for ref, cell in (cells or {}).items():
            if isinstance(cell, dict):
                ops.append({"op": "cell.patch", "sheet": sheet, "ref": ref, "patch": cell})
    return ops


def _marker():
    return paths.data_dir("migrated.json")


def _backup_name(settings_file):
    folder = os.path.dirname(settings_file)
    target = os.path.join(folder, paths.SETTINGS_BACKUP_NAME)
    if os.path.exists(target):
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        target = os.path.join(folder, "slide_builder_settings.v2-backup-%s.txt" % stamp)
    return target


def move_flat_layout():
    """Settings file left over from the old flat layout (in ROOT) moves into backend (C10: under the lock)."""
    if os.path.normcase(paths.ROOT) == os.path.normcase(paths.HOME_BACKEND):
        return False
    old = os.path.join(paths.ROOT, paths.SETTINGS_NAME)
    if os.path.isfile(old) and not os.path.exists(paths.SETTINGS_FILE):
        shutil.move(old, paths.SETTINGS_FILE)
        log("moved %s into the backend folder" % paths.SETTINGS_NAME)
        return True
    return False


def import_writer(key):
    """the writer id of the v2 import's record on a deck: the same on every try (base32 of the deck key's hash)"""
    tag = base64.b32encode(hashlib.sha1(key.encode("utf-8")).digest()[:5]).decode("ascii").lower()
    return "v2-import@slide-builder#" + tag


def _unfinished_import(key):
    """a deck the import created but whose record never arrived (the import stopped in between): the first snapshot,
    nothing in it, and no record in any journal - nobody has used it since"""
    try:
        snap = decks.read_snapshot(key)
    except Exception:                            # noqa: BLE001 - unreadable now: leave it
        return False
    doc = snap.get("doc") or {}
    if snap.get("gen") != 1 or doc.get("preset") or doc.get("style") or doc.get("edits"):
        return False
    folder = decks.journal_dir(key)
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        return True
    except OSError:
        return False
    for n in names:                              # no complete record anywhere (a record torn by the crash is none)
        try:
            with open(os.path.join(folder, n), "rb") as f:
                recs, _used, corrupt = decks.unframe(f.read())
        except OSError:
            return False
        if recs or corrupt is not None:
            return False
    return True


def migrate(settings_file=None, user=None, now=None):
    """Import the v2 settings file once. Returns the report written to migrated.json, or None."""
    with Lock("migrate", keepalive=True):
        if settings_file is None:
            move_flat_layout()
            settings_file = paths.SETTINGS_FILE
        if os.path.exists(_marker()) or not os.path.isfile(settings_file):
            return None
        return _import(settings_file, user or current_user(), now if now is not None else store.server_now_ms())


def _import(settings_file, user, now):
    try:
        with open(settings_file, "rb") as f:
            raw = f.read().decode("utf-8-sig").strip()
        old = json.loads(raw) if raw else {}
    except (OSError, ValueError) as e:
        log("the v2 settings file could not be read (%s) - not imported, it is left as it is" % e)
        return None
    if not isinstance(old, dict):
        old = {}
    report = {"at": now, "user": user, "host": current_host(), "version": VERSION,
              "from": os.path.basename(settings_file), "workbooks": [], "skipped": [], "config": False, "prefs": False}

    # deck defaults shared by everybody
    if isinstance(old.get("app"), dict):
        app = norm_app(old.get("app"))
        style = {k: app[k] for k in ("design", "glass", "color", "logo", "pn") if k in app}
        style = {k: v for k, v in style.items() if v is not None}        # null meant "not set" (v3 deleted it)
        if isinstance(style.get("pn"), dict):
            style["pn"] = {k: v for k, v in style["pn"].items() if v is not None}
        report["config"] = bool(style) and store.create_config_if_missing({"style": style}, user, now)
        # personal preferences of whoever runs the import
        if not store.prefs_exist(user):
            prefs = {"lastFile": app.get("lastFile") or None, "pdfMode": app.get("pdfMode") or None}
            store.write_prefs(prefs, user)
            report["prefs"] = True

    presets = old.get("presets") if isinstance(old.get("presets"), dict) else {}
    files = old.get("files") if isinstance(old.get("files"), dict) else {}
    names = list(presets.keys()) + [n for n in files.keys() if n not in presets]
    for name in names:
        if not isinstance(name, str) or not name:
            continue
        preset = convert_preset(presets.get(name))
        sheets = files.get(name) if isinstance(files.get(name), dict) else {}
        ops = workbook_ops(preset, sheets)
        if not ops:
            continue
        key = decks.deck_key(name)
        if decks.deck_exists(key):
            if not _unfinished_import(key):
                report["skipped"].append(name)
                continue
        elif store.workbook_exists(name):
            report["skipped"].append(name)
            continue
        else:
            # a new deck whose first record holds the import (the core folds it, as any record: the helper applies no
            # operation)
            key, how = migrate_v3.ensure_deck(name)    # a new deck (and the frozen stub that keeps v3 off it)
            if how != "created":
                report["skipped"].append(name)
                continue
        # the import's writer is the deck's own (not random): an import interrupted after the deck was made is
        # finished by the next start, and a record appended twice is folded once
        w = import_writer(key)
        decks.append(key, w, {"w": w, "s": 1, "l": 1, "by": user, "ops": ops})
        report["workbooks"].append(name)

    target = _backup_name(settings_file)
    try:
        os.replace(settings_file, target)
        report["backup"] = os.path.basename(target)
    except OSError as e:
        log("could not rename the v2 settings file (%s); it is left in place" % e)
        report["backup"] = None
    store.write_json(_marker(), report)
    log("imported the v2 settings: %d workbook(s)%s%s" % (
        len(report["workbooks"]), ", shared defaults" if report["config"] else "",
        (" (kept existing: %s)" % ", ".join(report["skipped"])) if report["skipped"] else ""))
    return report
