"""Writing exports into ``export\\`` (ARCHITECTURE §5, finding C7).

Rendering happens first, without any lock. The bytes go to a unique temporary file in the export
folder; then, under lock ``export-<safe name>``, the final name is chosen and the temporary file is
renamed into place. A target that is open in a viewer (locked) is skipped for " (2)", " (3)", ...
"""
import base64
import os
import time

from . import paths
from .locks import Lock
from .pdf import jpegs_to_pdf
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


def export(req, engine, export_dir=None):
    """POST /api/export. `engine.render(css, slides, kind, scale)` -> (output, label)."""
    t0 = time.time()
    name = req.get("name") or ""
    css, slides, names = req.get("css") or "", req.get("slides") or [], req.get("names") or []
    if not isinstance(slides, list) or not slides:
        raise ExportError("nothing to export")
    if not isinstance(names, list):
        names = []
    fmt, mode = req.get("format", "pdf"), req.get("mode", "vector")      # text and tables unless pictures are asked for
    try:
        scale = max(1, min(4, float(req.get("scale") or 3)))
    except (TypeError, ValueError):
        scale = 3
    base = clean_name(os.path.splitext(str(name))[0] or "slides")
    files = []
    suffix = " - slides.pdf" if len(slides) > 1 or req.get("all") else " - %s.pdf" % clean_name(str(names[0]) if names else "slide")
    if fmt == "pdf" and mode == "vector":
        # the default: real text and tables (selectable, sharp at any zoom) – no pictures of the slides
        pdf, used = engine.render(css, slides, "vector", 1)
        files.append(save_export(base + suffix, pdf, export_dir))
    elif fmt == "pdf":
        suffix = suffix[:-4] + " (images).pdf"
        # lossless pages: PNG keeps text and thin lines sharp (JPEG blurred white numbers on coloured cells);
        # an engine whose PNGs the PDF writer cannot take (e.g. with transparency) falls back to JPEG
        shots, used = engine.render(css, slides, "png", scale)
        try:
            pdf = jpegs_to_pdf(shots, base)
        except ValueError:
            shots, used = engine.render(css, slides, "jpeg", scale)
            pdf = jpegs_to_pdf(shots, base)
        files.append(save_export(base + suffix, pdf, export_dir))
    else:
        shots, used = engine.render(css, slides, "png", scale)
        if req.get("inline"):
            return {"ok": True, "engine": used, "images": ["data:image/png;base64," + base64.b64encode(s).decode() for s in shots]}
        for s, n in zip(shots, names or ["slide"] * len(shots)):
            files.append(save_export("%s - %s.png" % (base, clean_name(str(n))), s, export_dir))
    log("exported %s in %.1fs with %s" % (", ".join(files) or "image", time.time() - t0, used))
    return {"ok": True, "files": files, "engine": used, "seconds": round(time.time() - t0, 1)}


def assemble(req, export_dir=None):
    """POST /api/assemble: PDF from images rendered by the page itself (JPEG or PNG data URLs)."""
    images = req.get("images")
    if not isinstance(images, list) or not images:
        raise ExportError("nothing to export")
    try:
        imgs = [base64.b64decode(str(x).split(",", 1)[-1]) for x in images]
        base = clean_name(os.path.splitext(str(req.get("name") or "slides"))[0])
        pdf = jpegs_to_pdf(imgs, base)
    except Exception as e:                         # malformed data URL / JPEG / PNG
        raise ExportError("the slide pictures could not be read (%s)" % str(e)[:100])
    return {"ok": True, "files": [save_export(base + " - slides.pdf", pdf, export_dir)]}
