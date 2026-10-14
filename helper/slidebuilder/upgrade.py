"""Versions of the saved setups and their automatic upgrade (ARCHITECTURE §3.3).

Every saved file carries a format number in ``"schema"``:

    kind        file                               current
    workbook    data/workbooks/<key>.json          SCHEMA["workbook"]
    config      data/config.json                   SCHEMA["config"]
    prefs       data/users/<user>.json             SCHEMA["prefs"]

Files written before formats were numbered count as the first numbered version (workbook/config 3,
prefs 1), so every setup ever saved by v3 is covered.

When the way setups are stored changes, the developer raises the number in ``SCHEMA`` and adds ONE
step function that converts version n → n+1::

    @step("workbook", 3)
    def _workbook_3_to_4(doc):
        ...change doc in place...

Steps are chained, so a file several versions old is converted step by step. The store calls
:func:`upgrade` whenever it reads a file (under the file's lock); the first read after an update
converts the file once, after copying the old file to

    data/backups/upgrades/<kind>/<file name>.v<old>.<time>.json

A file newer than this program (written by a PC that was already updated) is never changed:
reading it raises :class:`TooNew`, and the user is asked to restart Slide Builder.
"""
import copy
import datetime as _dt
import os

SCHEMA = {"workbook": 3, "config": 3, "prefs": 1}
FIRST = {"workbook": 3, "config": 3, "prefs": 1}        # the version of files without a number
STEPS = {"workbook": {}, "config": {}, "prefs": {}}


class TooNew(RuntimeError):
    """The file was written by a newer Slide Builder. Nothing was changed."""


def step(kind, from_version):
    def deco(fn):
        STEPS[kind][from_version] = fn
        return fn
    return deco


def version_of(kind, doc):
    v = doc.get("schema") if isinstance(doc, dict) else None
    return v if isinstance(v, int) and not isinstance(v, bool) else FIRST[kind]


def needs_upgrade(kind, doc):
    v = version_of(kind, doc)
    if v > SCHEMA[kind]:
        raise TooNew("this file was saved by a newer version of Slide Builder (format %d, this one reads up to %d) - "
                     "close the Slide Builder window and start it again to use the update" % (v, SCHEMA[kind]))
    return v < SCHEMA[kind]


def upgrade(kind, doc):
    """(new doc, [versions passed]) - the input is not modified"""
    v = version_of(kind, doc)
    needs_upgrade(kind, doc)
    out, passed = copy.deepcopy(doc), []
    while v < SCHEMA[kind]:
        fn = STEPS[kind].get(v)
        if fn is None:
            raise RuntimeError("no upgrade step for %s format %d -> %d" % (kind, v, v + 1))
        res = fn(out)
        out = res if isinstance(res, dict) else out
        passed.append(v)
        v += 1
        out["schema"] = v
    return out, passed


def backup_path(data_dir, kind, file_path, old_version):
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    name = os.path.basename(file_path)
    base = name[:-5] if name.endswith(".json") else name
    return os.path.join(data_dir, "backups", "upgrades", kind, "%s.v%d.%s.json" % (base, old_version, stamp))


# --------------------------------------------------------------------------- the steps
# (none yet: format 3 is the first numbered version. Add new steps here, newest last, each with a test
#  in backend/tests/test_upgrade.py that converts the saved examples in backend/tests/fixtures/saved/.)
