"""Writing exports into ``export\\`` (ARCHITECTURE §10, §13.3; finding C7).

The page renders the PDF or PNG itself (the native export) and posts the bytes (``/api/export-file``); a
problem report goes to ``/api/export-feedback``. The bytes go to a unique temporary file in the export
folder; then, under lock ``export-<safe name>``, the final name is chosen and the temporary file is
renamed into place. A target that is open in a viewer (locked) is skipped for " (2)", " (3)", ...
"""
import io
import json
import os
import re
import time
import zipfile

from . import paths
from .locks import Lock
from .util import clean_name, doc_key, log, remove_quietly, replace_retry, write_tmp


class ExportError(RuntimeError):
    pass


def is_locked(path):
    """A file another program holds open without write sharing (e.g. a PDF viewer on Windows)."""
    try:
        with open(path, "ab"):
            pass
        return False
    except PermissionError:
        return True
    except FileNotFoundError:
        return False


def candidates(filename, limit=50):
    base, ext = os.path.splitext(filename)
    yield filename
    for k in range(2, limit + 1):
        yield "%s (%d)%s" % (base, k, ext)


def save_export(filename, data, export_dir=None):
    """Write `data` as export_dir/filename atomically; returns the basename actually used."""
    export_dir = export_dir or paths.EXPORT_DIR
    os.makedirs(export_dir, exist_ok=True)
    tmp = write_tmp(os.path.join(export_dir, filename), data)
    try:
        with Lock("export-" + doc_key(filename)):
            for name in candidates(filename):
                target = os.path.join(export_dir, name)
                if os.path.exists(target) and is_locked(target):
                    continue
                try:
                    replace_retry(tmp, target, attempts=3, delay=0.1)
                    return name
                except OSError:
                    continue                       # locked in a way open(..., "ab") did not detect
        raise ExportError("no free file name for %s in the export folder" % filename)
    finally:
        remove_quietly(tmp)


EXPORT_FILE_TYPES = {".pdf": b"%PDF-", ".png": b"\x89PNG\r\n\x1a\n", ".pptx": b"PK\x03\x04"}


def _is_pptx(data):
    """a PowerPoint file (4.5, B21): a zip whose parts include the presentation and its content types"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = set(z.namelist())
        return "[Content_Types].xml" in names and "ppt/presentation.xml" in names
    except (zipfile.BadZipFile, ValueError, OSError):
        return False


def export_file(name, data, export_dir=None):
    """POST /api/export-file?name=: a PDF or PNG the page wrote itself (the native export, PLAN S3.7) saved as
    `name` in the export folder through save_export (temporary file, lock export-<name>, " (2)" when the target is
    open). Only .pdf, .png and .pptx names (4.5, B21), and only bytes that are one, are taken."""
    base = os.path.basename(str(name or "").replace("\\", "/"))
    ext = os.path.splitext(base)[1].lower()
    if ext not in EXPORT_FILE_TYPES:
        raise ExportError("only .pdf, .png and .pptx files are exported")
    # control characters (a tab or line break in a slide's name) are not allowed in Windows file names
    stem = clean_name(re.sub(r"[\x00-\x1f\x7f]+", " ", os.path.splitext(base)[0]))
    if not data or not data.startswith(EXPORT_FILE_TYPES[ext]) or (ext == ".pptx" and not _is_pptx(data)):
        raise ExportError("the exported file is empty or not a %s file" % ext[1:].upper())
    t0 = time.time()
    saved = save_export(stem[:200] + ext, data, export_dir)
    log("exported %s (%d bytes) in %.2fs" % (saved, len(data), time.time() - t0))
    return {"ok": True, "files": [saved]}


FEEDBACK_LIMIT = 64 * 1024


def export_feedback(report, user, host, export_dir=None):
    """POST /api/export-feedback: "Report a problem with this export" (the export pilot, PLAN S3.8). The page's report
    (a JSON object: the form and what the page knows about the last export) is written, with the helper's version,
    user, PC and time, as one new file ``export/feedback/<date>-<time>-<user>.json`` – offline, no e-mail; the product
    owner reads the folder after each pilot cycle. Returns the file's name inside the export folder."""
    if not isinstance(report, dict) or not report:
        raise ExportError("the report must be a JSON object with the form")
    from . import VERSION
    now = time.localtime()
    doc = {"kind": "export-feedback", "schema": 1, "app": "slide-builder", "version": VERSION, "user": user, "host": host,
           "at": time.strftime("%Y-%m-%dT%H:%M:%S", now), "report": report}
    data = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8")
    if len(data) > FEEDBACK_LIMIT:
        raise ExportError("the report is too long (at most %d KB)" % (FEEDBACK_LIMIT // 1024))
    folder = os.path.join(export_dir or paths.EXPORT_DIR, "feedback")
    os.makedirs(folder, exist_ok=True)
    stem = "%s-%s" % (time.strftime("%Y%m%d-%H%M%S", now), clean_name(str(user or "user"))[:40])
    tmp = write_tmp(os.path.join(folder, stem + ".json"), data)
    try:
        with Lock("export-feedback"):
            for name in candidates(stem + ".json"):        # never replaces another report
                target = os.path.join(folder, name)
                if not os.path.exists(target):
                    replace_retry(tmp, target, attempts=3, delay=0.1)
                    log("export feedback saved: feedback/%s" % name)
                    return {"ok": True, "file": "feedback/" + name}
        raise ExportError("no free file name for the report")
    finally:
        remove_quietly(tmp)
