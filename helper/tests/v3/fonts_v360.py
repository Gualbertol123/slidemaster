"""Shared font library (ARCHITECTURE §3.4): fonts uploaded by users or saved from Google Fonts.

    data/fonts/fonts.json        {"schema": 1, "fonts": [{family, source, faces: [{file, weight, style, range?}], by, at}]}
    data/fonts/<file>            the font files (.ttf .otf .woff .woff2), named after family/weight/style + content hash

The library lives in the shared data folder, so a font added once is available to everybody, in every
deck and in exports. Writes take the ``fonts`` lock; files are written before the index refers to them.
"""
import hashlib
import os
import re

from . import paths
from .locks import Lock
from .store import read_json, server_now_ms, write_json
from .util import current_user, remove_quietly, safe_component, safe_path, write_atomic

FONT_TYPES = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}
FONT_MAX = 15 * 1024 * 1024
MAX_FACES = 64                                    # per family
_MAGIC = {b"\x00\x01\x00\x00": (".ttf", ".otf"), b"true": (".ttf",), b"OTTO": (".otf", ".ttf"),
          b"wOFF": (".woff",), b"wOF2": (".woff2",)}
_FAMILY = re.compile(r"^[\w][\w .\-&+]{0,63}$", re.UNICODE)
_RANGE = re.compile(r"^[uU0-9A-Fa-f+?, -]{1,4000}$")


class FontError(ValueError):
    """An upload that is not a usable font (HTTP 400)."""


def fonts_dir():
    return paths.data_dir("fonts")


def _index_path():
    return os.path.join(fonts_dir(), "fonts.json")


def _empty():
    return {"schema": 1, "fonts": []}


def read_library():
    doc = read_json(_index_path(), _empty)
    if not isinstance(doc, dict) or not isinstance(doc.get("fonts"), list):
        doc = _empty()
    doc["fonts"] = [f for f in doc["fonts"] if isinstance(f, dict) and isinstance(f.get("family"), str) and isinstance(f.get("faces"), list)]
    return doc


def clean_family(family):
    family = re.sub(r"\s+", " ", str(family or "")).strip()
    if not _FAMILY.match(family):
        raise FontError("font name: use letters, digits, spaces and . - & + (at most 64 characters)")
    return family


def detect_ext(data):
    """the font format from its first bytes, or None"""
    return _MAGIC.get(bytes(data[:4]))


def add_face(family, weight, style, data, ext=None, source="upload", unicode_range=None, user=None):
    """Store one font file and list it under `family` (a face with the same weight/style/range is replaced).
    Returns the library."""
    family = clean_family(family)
    try:
        weight = int(weight)
    except (TypeError, ValueError):
        weight = 400
    weight = max(1, min(1000, weight))
    style = "italic" if style == "italic" else "normal"
    source = "google" if source == "google" else "upload"
    if not data:
        raise FontError("the font file is empty")
    if len(data) > FONT_MAX:
        raise FontError("the font file is larger than %d MB" % (FONT_MAX // (1024 * 1024)))
    exts = detect_ext(data)
    if not exts:
        raise FontError("not a font file (TrueType .ttf, OpenType .otf, .woff or .woff2 are accepted)")
    ext = (ext or "").lower()
    if ext not in exts:
        ext = exts[0]
    if unicode_range is not None and not (isinstance(unicode_range, str) and _RANGE.match(unicode_range)):
        unicode_range = None
    name = "%s-%d%s-%s%s" % (safe_component(family.replace(" ", ""), 40), weight, "i" if style == "italic" else "",
                             hashlib.sha1(data).hexdigest()[:10], ext)
    path = os.path.join(fonts_dir(), name)
    os.makedirs(fonts_dir(), exist_ok=True)
    with Lock("fonts"):
        if not os.path.exists(path):
            write_atomic(path, data)
        lib = read_library()
        entry = next((f for f in lib["fonts"] if f["family"].lower() == family.lower()), None)
        if entry is None:
            entry = {"family": family, "source": source, "faces": []}
            lib["fonts"].append(entry)
        face = {"file": name, "weight": weight, "style": style}
        if unicode_range:
            face["range"] = unicode_range
        entry["faces"] = [x for x in entry["faces"] if isinstance(x, dict) and not (
            x.get("weight") == weight and x.get("style") == style and x.get("range") == face.get("range"))] + [face]
        if len(entry["faces"]) > MAX_FACES:
            raise FontError("%s already has %d styles" % (family, MAX_FACES))
        entry["by"] = user or current_user()
        entry["at"] = server_now_ms()
        lib["fonts"].sort(key=lambda f: f["family"].lower())
        write_json(_index_path(), lib)
        _sweep(lib)
        return lib


def remove_family(family):
    with Lock("fonts"):
        lib = read_library()
        before = len(lib["fonts"])
        lib["fonts"] = [f for f in lib["fonts"] if f["family"].lower() != str(family or "").strip().lower()]
        if len(lib["fonts"]) != before:
            write_json(_index_path(), lib)
            _sweep(lib)
        return lib


def _sweep(lib):
    """delete font files no family refers to any more (called under the lock)"""
    used = {x.get("file") for f in lib["fonts"] for x in f["faces"] if isinstance(x, dict)}
    try:
        names = os.listdir(fonts_dir())
    except OSError:
        return
    for n in names:
        if os.path.splitext(n)[1].lower() in FONT_TYPES and n not in used:
            remove_quietly(os.path.join(fonts_dir(), n))


def font_file(name):
    """(bytes, content type) of a library font file"""
    ext = os.path.splitext(name)[1].lower()
    if ext not in FONT_TYPES or "/" in name or "\\" in name:
        raise PermissionError("not a font")
    p = safe_path(name, fonts_dir())
    with open(p, "rb") as f:
        return f.read(), FONT_TYPES[ext]
