"""Windows fonts for the core (PLAN S3.2, docs/next/03 §2.5): the page lays out and exports text from font files, so
the fonts a workbook or deck uses (Calibri, Aptos, Segoe UI, ...) are read from this PC's font folders.

    GET  /sysfonts                 [{file, family, subfamily, weight, italic, faces, size}] of the PC's font files
    GET  /sysfonts/<file>          one font file (only files listed by the index, from the two font folders)
    POST /api/fonts/capture?file=  the font's embedding permission (OS/2 fsType) and metrics fingerprint, recorded
                                   in data/fonts/system/fingerprints.json; the other builds other PCs have; in copy
                                   mode, the family copied into the shared library

Fingerprint mode (gate G0, decision 2026-10-12: R7), the default: Windows fonts are NOT copied to the share. A capture
records what this PC's file is (SHA-1, version, units per em, vertical metrics, a hash of the advance widths), so PCs
with a different build of a font can be told apart (the page names them in its side panel); every PC still lays out
with its own copy.

Copy mode (03 §2.5, W13), only once the licence owner has confirmed that Microsoft's fonts may be copied to the share
(R7) and the maintainer has recorded it (`slide_builder.py --allow-font-copy "<who confirmed, when>"`, in
data/fonts/system/licence.json; `--allow-font-copy off` goes back): a capture copies every face of the family this PC
has into the shared library (fonts.py, source "system") – all of them or none (a copied Regular would otherwise hide
this PC's Bold) – when each is a single-face .ttf / .otf that may be embedded and is not a variable font. The library's
family then wins over every PC's own copy (the page's catalog), so every PC lays it out with the same bytes.

The folders are %WINDIR%\\Fonts and the per-user %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts; SLIDEBUILDER_SYSFONTS
(folders separated by os.pathsep) replaces them, for tests. Only .ttf, .otf and .ttc files are served, and only by
the plain file names the index lists (no paths).
"""
import hashlib
import os
import re
import struct
import threading

from . import paths
from .locks import Lock
from .store import read_json, server_now_ms, write_json
from .util import current_host, current_user

FONT_TYPES = {".ttf": "font/ttf", ".otf": "font/otf", ".ttc": "font/collection"}
SYSFONT_MAX = 64 * 1024 * 1024                    # the largest Windows fonts (CJK collections) are ~35 MB
_NAME = re.compile(r"^[\w .()&+,'-]{1,120}\.(ttf|otf|ttc)$", re.IGNORECASE | re.UNICODE)
MODE = "fingerprint"                              # G0 2026-10-12; copy mode once R7 is answered (copy_allowed)
_index_lock = threading.Lock()
_index_cache = {}


class SysFontError(ValueError):
    """A request for something that is not a listed font file (HTTP 400)."""


def font_dirs():
    env = os.environ.get("SLIDEBUILDER_SYSFONTS")
    if env is not None:
        return [d for d in env.split(os.pathsep) if d]
    dirs = [os.path.join(os.environ.get("WINDIR") or r"C:\Windows", "Fonts")]
    local = os.environ.get("LOCALAPPDATA")
    if local:
        dirs.append(os.path.join(local, "Microsoft", "Windows", "Fonts"))
    return dirs


# ---------------------------------------------------------------- reading sfnt names (stdlib only)
def _tables(data, at=0):
    n = struct.unpack_from(">H", data, at + 4)[0]
    out = {}
    for i in range(n):
        tag, _sum, off, length = struct.unpack_from(">4sIII", data, at + 12 + 16 * i)
        out[tag.decode("latin-1")] = (off, length)
    return out


def _faces(data):
    """offset tables of the faces in a font file (one, or several in a collection)"""
    if data[:4] == b"ttcf":
        n = struct.unpack_from(">I", data, 8)[0]
        return [struct.unpack_from(">I", data, 12 + 4 * i)[0] for i in range(min(n, 64))]
    if data[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        return [0]
    return []


def _name(data, t, ids):
    if "name" not in t:
        return ""
    off, _ = t["name"]
    count, strings = struct.unpack_from(">HH", data, off + 2)
    found = {}
    for i in range(count):
        pid, eid, lang, nid, length, soff = struct.unpack_from(">HHHHHH", data, off + 6 + 12 * i)
        if nid not in ids or nid in found:
            continue
        raw = data[off + strings + soff:off + strings + soff + length]
        if pid == 3 and eid in (1, 10) and lang & 0xFF == 0x09:
            found[nid] = raw.decode("utf-16-be", "replace")
        elif pid == 1 and eid == 0:
            found.setdefault(nid, raw.decode("mac_roman", "replace"))
    for i in ids:
        if found.get(i):
            return found[i]
    return ""


def embeddable(fs_type):
    """OS/2.fsType: outlines may be embedded unless the usage is "restricted licence" (0x0002) or "bitmap embedding
    only" (0x0200); "no subsetting" (0x0100) allows embedding the whole font"""
    return (fs_type & 0x000F) != 0x0002 and not fs_type & 0x0200


def _header(path):
    """the first face's table directory and its name, OS/2, head and hhea tables, as a small sfnt (the listing
    reads a few KB per file instead of whole fonts: Windows has collections of 30+ MB); and the number of faces"""
    with open(path, "rb") as f:
        head = f.read(12)
        faces = [0] if head[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true") else []
        if head[:4] == b"ttcf":
            n = struct.unpack_from(">I", head, 8)[0]
            f.seek(12)
            offs = struct.unpack(">%dI" % min(n, 64), f.read(4 * min(n, 64)))
            faces = list(offs)
        if not faces:
            return None, 0
        f.seek(faces[0])
        d = f.read(12)
        n = struct.unpack_from(">H", d, 4)[0]
        d += f.read(16 * n)
        tables = []
        for i in range(n):
            tag, _s, off, length = struct.unpack_from(">4sIII", d, 12 + 16 * i)
            if tag in (b"name", b"OS/2", b"head", b"hhea") and length <= 1 << 20:
                f.seek(off)
                tables.append((tag, f.read(length)))
    out = bytearray(d[:4] + struct.pack(">HHHH", len(tables), 0, 0, 0))
    pos = 12 + 16 * len(tables)
    body = b""
    for tag, b in tables:
        out += struct.pack(">4sIII", tag, 0, pos + len(body), len(b))
        body += b + b"\0" * (-len(b) % 4)
    return bytes(out) + body, len(faces)


def describe(data, at=0):
    """family, subfamily, weight, italic, fsType, version and the metrics of one face"""
    t = _tables(data, at)
    os2 = t.get("OS/2")
    weight, italic, fs_type, avg = 400, False, 0, 0
    if os2:
        o = os2[0]
        avg, weight, _width, fs_type = struct.unpack_from(">hHHH", data, o + 2)
        if os2[1] > 64:
            italic = bool(struct.unpack_from(">H", data, o + 62)[0] & 1)
    head = t.get("head")
    upem = struct.unpack_from(">H", data, head[0] + 18)[0] if head else 0
    hhea = t.get("hhea")
    asc = desc = gap = nh = 0
    if hhea:
        asc, desc, gap = struct.unpack_from(">hhh", data, hhea[0] + 4)
        nh = struct.unpack_from(">H", data, hhea[0] + 34)[0]
    hmtx = t.get("hmtx")
    widths = hashlib.sha1(data[hmtx[0]:hmtx[0] + 4 * nh]).hexdigest() if hmtx else ""
    return {"family": _name(data, t, (16, 1)), "subfamily": _name(data, t, (17, 2)), "version": _name(data, t, (5,)),
            "postscript": _name(data, t, (6,)), "weight": weight if 1 <= weight <= 1000 else 400, "italic": italic,
            "fsType": fs_type, "embeddable": embeddable(fs_type), "noSubset": bool(fs_type & 0x0100), "variable": "fvar" in t,
            "unitsPerEm": upem, "ascender": asc, "descender": desc, "lineGap": gap, "xAvgCharWidth": avg, "advancesSha1": widths}


# ---------------------------------------------------------------- the index and the files
def _listing():
    """{lower-case file name: full path} of the font files in the folders (the per-user folder wins)"""
    out = {}
    for d in font_dirs():
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if os.path.splitext(n)[1].lower() in FONT_TYPES and _NAME.match(n):
                out[n.lower()] = os.path.join(d, n)
    return out


def list_fonts():
    """every font file with the names of its first face (cached per file size and time)"""
    items = []
    for low, p in sorted(_listing().items()):
        try:
            st = os.stat(p)
        except OSError:
            continue
        key = (p, st.st_size, st.st_mtime)
        with _index_lock:
            row = _index_cache.get(key)
        if row is None:
            try:
                data, nfaces = _header(p)
                d = describe(data) if data else None
            except (OSError, struct.error, IndexError, ValueError):
                d, nfaces = None, 0
            row = None if d is None else {"file": os.path.basename(p), "family": d["family"], "subfamily": d["subfamily"],
                                          "weight": d["weight"], "italic": d["italic"], "faces": nfaces, "size": st.st_size}
            with _index_lock:
                _index_cache[key] = row
        if row:
            items.append(row)
    return items


def read_font(name):
    """(bytes, content type) of one listed font file; anything else is refused"""
    name = str(name or "")
    if "/" in name or "\\" in name or not _NAME.match(name):
        raise SysFontError("not a font file name")
    p = _listing().get(name.lower())
    if not p:
        raise FileNotFoundError(name)
    if os.path.getsize(p) > SYSFONT_MAX:
        raise SysFontError("the font file is too large")
    with open(p, "rb") as f:
        return f.read(), FONT_TYPES[os.path.splitext(p)[1].lower()]


# ---------------------------------------------------------------- capture (fingerprint mode)
def fingerprint(data):
    faces = _faces(data)
    if not faces:
        raise SysFontError("not a font file")
    return {"sha1": hashlib.sha1(data).hexdigest(), "size": len(data), "faces": [describe(data, at) for at in faces]}


def _store_path():
    return os.path.join(paths.data_dir("fonts", "system"), "fingerprints.json")


def _licence_path():
    return os.path.join(paths.data_dir("fonts", "system"), "licence.json")


def copy_allowed():
    """who confirmed that Windows fonts may be copied to the share (R7), or None: fingerprint mode"""
    doc = read_json(_licence_path(), lambda: None)
    if isinstance(doc, dict) and doc.get("copy") is True and str(doc.get("confirmedBy") or "").strip():
        return str(doc["confirmedBy"]).strip()
    return None


def set_copy_allowed(confirmed_by):
    """record the licence owner's yes (copy mode), or with None / "off" go back to fingerprint mode"""
    who = str(confirmed_by or "").strip()
    os.makedirs(os.path.dirname(_licence_path()), exist_ok=True)
    with Lock("fonts"):
        if not who or who.lower() == "off":
            write_json(_licence_path(), {"copy": False, "at": server_now_ms(), "by": current_user()})
            return None
        write_json(_licence_path(), {"copy": True, "confirmedBy": who, "at": server_now_ms(), "by": current_user()})
        return who


def _copy_family(family, user=None):
    """copy mode: every face of `family` on this PC into the shared library, or none – {"copied": bool, "reason"?}"""
    from . import fonts as library
    lib = library.read_library()
    have = next((f for f in lib["fonts"] if f["family"].lower() == family.lower()), None)
    if have is not None:
        if have.get("source") == "system":
            return {"copied": True, "faces": len(have.get("faces") or [])}
        return {"copied": False, "reason": "the library has its own %s" % family}
    rows = [r for r in list_fonts() if str(r.get("family", "")).lower() == family.lower()]
    faces = []
    for r in rows:
        ext = os.path.splitext(r["file"])[1].lower()
        if ext not in (".ttf", ".otf") or r.get("faces", 1) != 1:
            return {"copied": False, "reason": "%s is a font collection (.ttc)" % r["file"]}
        data, _ = read_font(r["file"])
        d = describe(data)
        if not d.get("embeddable"):
            return {"copied": False, "reason": "%s may not be embedded (OS/2 fsType)" % r["file"]}
        if d.get("variable"):
            return {"copied": False, "reason": "%s is a variable font" % r["file"]}
        faces.append((data, ext, d))
    if not faces:
        return {"copied": False, "reason": "no file of %s on this PC" % family}
    for data, ext, d in faces:
        library.add_face(family, d["weight"], "italic" if d["italic"] else "normal", data, ext=ext, source="system", user=user)
    return {"copied": True, "faces": len(faces)}


def capture(name, user=None, host=None):
    """record this PC's file of a Windows font (fingerprint mode). Returns the fingerprint, whether it may be
    embedded, and the other builds of the same family seen on other PCs."""
    data, _ = read_font(name)
    fp = fingerprint(data)
    first = fp["faces"][0]
    family = first["family"] or os.path.splitext(name)[0]
    now = server_now_ms()
    os.makedirs(os.path.dirname(_store_path()), exist_ok=True)
    with Lock("fonts"):
        doc = read_json(_store_path(), lambda: {"schema": 1, "mode": MODE, "fonts": []})
        if not isinstance(doc, dict) or not isinstance(doc.get("fonts"), list):
            doc = {"schema": 1, "mode": MODE, "fonts": []}
        rows = [r for r in doc["fonts"] if isinstance(r, dict)]
        row = next((r for r in rows if r.get("file", "").lower() == name.lower() and r.get("sha1") == fp["sha1"]), None)
        if row is None:
            row = {"file": name, "family": family, "subfamily": first["subfamily"], "sha1": fp["sha1"], "size": fp["size"],
                   "embeddable": all(f["embeddable"] for f in fp["faces"]), "noSubset": any(f["noSubset"] for f in fp["faces"]),
                   "faces": fp["faces"], "seen": []}
            rows.append(row)
        who = {"user": user or current_user(), "host": host or current_host()}
        row["seen"] = [s for s in row.get("seen", []) if isinstance(s, dict) and (s.get("user"), s.get("host")) != (who["user"], who["host"])]
        row["seen"].append(dict(who, at=now))
        row["seen"] = row["seen"][-50:]
        rows.sort(key=lambda r: (str(r.get("family", "")).lower(), str(r.get("file", "")).lower(), str(r.get("sha1", ""))))
        doc = {"schema": 1, "mode": MODE, "fonts": rows}
        write_json(_store_path(), doc)
    other_rows = [r for r in rows if r.get("family", "").lower() == family.lower() and r.get("file", "").lower() == name.lower() and r["sha1"] != fp["sha1"]]
    others = sorted({r["sha1"] for r in other_rows})
    # the PCs that have another build (the page names them: their slides may lay out differently, W13)
    hosts = sorted({str(s.get("host")) for r in other_rows for s in r.get("seen", []) if isinstance(s, dict) and s.get("host")})
    out = {"mode": MODE, "file": name, "family": family, "sha1": fp["sha1"], "embeddable": row["embeddable"], "noSubset": row.get("noSubset", False),
           "faces": fp["faces"], "otherBuilds": others, "otherHosts": hosts}
    if copy_allowed():
        out.update(mode="copy", **_copy_family(family, user=user))
    return out
