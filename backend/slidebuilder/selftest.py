"""``slide_builder.py --selftest``: can THIS program run on this shared folder? (tools/update.py --release)

Read-only for the saved setups: every deck, config.json and every user's preferences is read and
converted to the current format in memory only (a file from a newer version fails the test), every
deck goes through the ops code once. Then the data folder must accept create, rename and delete (a
probe file in data/locks, removed again). Nothing else is written. Output is ASCII (cp1252 consoles).
Exit code 0 = this version can be used; 1 = it must not become the current version.
"""
import copy
import os
import sys
import uuid

from . import VERSION, paths


def _say(msg):
    print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def _check_saved():
    """[(file, problem)] for every saved setup this version cannot read (nothing is written)"""
    from . import upgrade
    from .ops import apply_ops
    from .store import read_json
    bad, n = [], 0
    jobs = [("config", paths.data_dir("config.json"))]
    for sub, kind in (("workbooks", "workbook"), ("users", "prefs")):
        folder = paths.data_dir(sub)
        for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            if name.endswith(".json"):
                jobs.append((kind, os.path.join(folder, name)))
    for kind, path in jobs:
        if not os.path.isfile(path):
            continue
        label = os.path.relpath(path, paths.DATA)
        try:
            doc = read_json(path, None)
            if not isinstance(doc, dict):
                raise ValueError("not a JSON object")
            doc, _ = upgrade.upgrade(kind, copy.deepcopy(doc))
            if kind == "workbook":
                apply_ops(doc, [], None, 0)
            n += 1
        except Exception as e:                     # noqa: BLE001 - report every bad file
            bad.append((label, str(e).splitlines()[0][:160] if str(e) else type(e).__name__))
    return n, bad


def _probe_folder():
    """create, write, rename and delete a file in data/locks; None when all work, else the problem"""
    folder = paths.data_dir("locks")
    probe = os.path.join(folder, "selftest-%s.tmp" % uuid.uuid4().hex[:12])
    moved = probe[:-4] + ".renamed"
    step = "create the folder"
    try:
        os.makedirs(folder, exist_ok=True)
        step = "create a file"
        with open(probe, "wb") as f:
            f.write(b"slide builder self-test")
            f.flush()
            os.fsync(f.fileno())
        step = "rename a file"
        os.replace(probe, moved)
        step = "read it back"
        with open(moved, "rb") as f:
            if f.read() != b"slide builder self-test":
                return "the file read back differs"
        step = "delete a file"
        os.remove(moved)
        if os.path.exists(moved):
            return "a deleted file is still there"
        return None
    except OSError as e:
        return "cannot %s in %s (%s)" % (step, folder, e)
    finally:
        for p in (probe, moved):
            try:
                os.remove(p)
            except OSError:
                pass


def run():
    _say("Slide Builder %s self-test" % VERSION)
    _say("  program: %s" % paths.BACKEND)
    _say("  data   : %s" % paths.DATA)
    ok = True
    try:
        from . import server  # noqa: F401 - the whole helper imports with this Python
    except Exception as e:                         # noqa: BLE001
        _say("FAIL the program does not load with Python %d.%d: %s" % (sys.version_info[0], sys.version_info[1], e))
        return 1
    if not os.path.isfile(paths.APP_FILE):
        _say("FAIL the page is missing: %s" % paths.APP_FILE)
        ok = False
    n, bad = _check_saved()
    for label, why in bad:
        _say("FAIL %s: %s" % (label, why))
    if not bad:
        _say("ok   %d saved setup(s) read (nothing written)" % n)
    problem = _probe_folder()
    if problem:
        _say("FAIL the data folder: " + problem)
    else:
        _say("ok   the data folder accepts create, rename and delete")
    ok = ok and not bad and not problem
    _say("PASSED" if ok else "FAILED - do not use this version on this folder")
    return 0 if ok else 1
