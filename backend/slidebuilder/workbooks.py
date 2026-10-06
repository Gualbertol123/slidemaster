"""Workbooks in the app folder: listing and stable reads (ARCHITECTURE §5, finding C8)."""
import os
import time

from . import paths
from .store import StoreUnreadable, read_workbook, workbook_exists
from .util import safe_path

EOCD = b"PK\x05\x06"
EOCD_WINDOW = 66 * 1024       # the end-of-central-directory record sits in the last 64 KB + 22 bytes


class Unstable(RuntimeError):
    """The file kept changing while it was read (HTTP 503)."""


def is_workbook_name(n):
    return n.lower().endswith(paths.WORKBOOK_EXT) and not n.startswith("~$")


def list_workbooks():
    """Workbooks in the main folder (and, for older setups, in backend), newest first, with doc info."""
    out, seen = [], set()
    for d in (paths.ROOT, paths.BACKEND):
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if is_workbook_name(n) and n.lower() not in seen:
                try:
                    st = os.stat(os.path.join(d, n))
                except OSError:
                    continue
                seen.add(n.lower())
                row = {"name": n, "mtime": st.st_mtime, "size": st.st_size, "rev": None, "updated": None, "updatedBy": None}
                if workbook_exists(n):
                    try:
                        doc = read_workbook(n)
                        row.update(rev=doc.get("rev"), updated=doc.get("updated"), updatedBy=doc.get("updatedBy"))
                    except StoreUnreadable:
                        pass
                out.append(row)
    out.sort(key=lambda x: -x["mtime"])
    return out


def find_workbook(name):
    """Path of a workbook (main folder, then backend). PermissionError if the name escapes the folders
    or is not a workbook; FileNotFoundError if it does not exist."""
    n = name.replace("\\", "/").rsplit("/", 1)[-1]
    if not is_workbook_name(n):
        raise PermissionError("not a workbook")
    p = safe_path(name, paths.ROOT)
    if os.path.isfile(p):
        return p
    p = safe_path(name, paths.BACKEND)
    if os.path.isfile(p):
        return p
    raise FileNotFoundError(name)


def _complete(data):
    if data[:2] != b"PK":
        return True
    return EOCD in data[-EOCD_WINDOW:]


def stable_read(path, attempts=8, delay=0.5):
    """Read a file that may be being saved (Excel, a copy over SMB). Returns (bytes, mtime, size).

    The read counts only if size and mtime are the same before and after it, the byte count matches,
    and a zip (xlsx/xlsm/xlsb) has its end-of-central-directory record. Otherwise retried
    (8x, ~4 s); then Unstable is raised.
    """
    reason = "?"
    for i in range(attempts):
        try:
            st1 = os.stat(path)
            with open(path, "rb") as f:
                data = f.read()
            st2 = os.stat(path)
            if (st1.st_size, st1.st_mtime) != (st2.st_size, st2.st_mtime) or len(data) != st2.st_size:
                reason = "the file changed while it was read"
            elif not _complete(data):
                reason = "the file is incomplete (still being saved?)"
            else:
                return data, st2.st_mtime, st2.st_size
        except FileNotFoundError:
            raise
        except PermissionError as e:     # Windows: Excel is writing it right now
            reason = "the file is locked (%s)" % e.__class__.__name__
        if i < attempts - 1:
            time.sleep(delay)
    raise Unstable("%s: %s - try again in a moment" % (os.path.basename(path), reason))
