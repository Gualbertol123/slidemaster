r"""Google fonts fetched by the helper, for the shared font library (fonts.py).

The page asked fonts.googleapis.com itself until 4.5; at the office that name does not resolve (only the browser's
PAC file reaches it through a proxy), so adding a font failed. The helper fetches instead, from sources that need no
googleapis, in this order:

    1. the google/fonts repository on GitHub: <ofl|apache|ufl>/<dir>/METADATA.pb and its TTF files, from
       raw.githubusercontent.com, else the same files from cdn.jsdelivr.net/gh/google/fonts
    2. the Google Fonts CSS API (fonts.googleapis.com, files on fonts.gstatic.com): asked by Python it answers
       with static TTF files (one per weight), so it stays an option where a proxy reaches it

The page then stores each file as an upload is stored (POST /api/fonts): a variable TTF (most families on GitHub
now ship only those) becomes a static face at 400 and 700 there (core text/static.ts), so exports embed static faces.

Cache (B46): what the helper fetched is kept in the shared data\fonts\cache\ (fetched once for the office: a second
PC adding the same family, or showing the same preview, asks nothing of the network). Several helpers use it at once:
an entry is written whole (temp file, then os.replace), carries its length and SHA-256 (a half-written or damaged
entry is a miss and is fetched again), a reader treats a vanished or locked entry as a miss, and the folder is kept
under CACHE_MAX by deleting the least recently used entries first. 4.0's fonts.py _sweep deletes only font files at
the top of data\fonts, never a folder in it.

Proxy: Python does not read a PAC file. The helper uses, in this order, the first line of this PC's
%LOCALAPPDATA%\SlideBuilder\proxy.txt (a laptop at home or on VPN needs another proxy than the office), else of the
shared data\proxy.txt ("http://proxy.example:8080", or "none" for a direct connection), else HTTPS_PROXY / the
Windows proxy setting (urllib's own lookup).

SLIDEBUILDER_NO_NET=1 (the e2e helpers, app/playwright.config.ts): no outbound request at all - every fetch fails at
once, so a family, a file and a preview answer the usual "cannot be reached" 502, the same with or without network.
"""
import hashlib
import json
import os
import re
import socket
import ssl
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from . import paths
from .fonts import FONT_MAX, FONT_TYPES, clean_family, detect_ext, fonts_dir
from .util import log, remove_quietly, write_atomic

GITHUB = ("https://raw.githubusercontent.com/google/fonts/main/", "https://cdn.jsdelivr.net/gh/google/fonts@main/")
LICENCES = ("ofl", "apache", "ufl")
CSS_API = "https://fonts.googleapis.com/css2?family="
GSTATIC = "https://fonts.gstatic.com/"
WANT = (400, 700)                                          # the weights a family is added with (as the page asked before)
TIMEOUT = 20
FILE_TIMEOUT = 90
UPLOAD_HINT = "download the family from fonts.google.com (Download family) and use \u201cUpload font files\u201d"
_REPO_FILE = re.compile(r"^(ofl|apache|ufl)/[a-z0-9]+/[A-Za-z0-9._\-\[\],]+\.(ttf|otf)$")
_GSTATIC_FILE = re.compile(r"^https://fonts\.gstatic\.com/[A-Za-z0-9._\-/]+\.(ttf|otf|woff2?)$")
_GSTATIC_SUBSET = re.compile(r"^https://fonts\.gstatic\.com/l/font\?[A-Za-z0-9._\-=&%]+$")   # a &text= subset (previews)
CACHE_MAX = 200 * 1024 * 1024                              # data\fonts\cache (owner, 2026-10-21)
CACHE_KEEP = 0.9                                           # pruning goes down to 90 % of the cap, not once per entry
CACHE_EXT = ".sbc"
FAMILY_MAX_AGE = 30 * 86400                                # a family's faces are asked again a month after they were fetched
STALE_TMP_S = 3600                                         # a temp file this old is a crashed writer's
_MAGIC = b"SBFC"
_HEAD = struct.Struct(">4sQ32s")                           # magic, length, SHA-256 of the bytes that follow


class GFontError(Exception):
    """A Google font that cannot be fetched; `status` is the HTTP status the helper answers with, the message says
    what to do."""

    def __init__(self, status, msg):
        Exception.__init__(self, msg)
        self.status = status


class Absent(GFontError):
    """a source that answered: it does not have this family"""

    def __init__(self, msg="not there"):
        GFontError.__init__(self, 404, msg)


class NetError(Exception):
    """One request that failed: `status` is the HTTP status, or None when nothing answered (`reason` says why)."""

    def __init__(self, url, status=None, reason=""):
        Exception.__init__(self, "%s: %s" % (urllib.parse.urlsplit(url).netloc, "HTTP %d" % status if status else reason))
        self.url, self.status, self.reason = url, status, reason


# ---------------------------------------------------------------------------------------------------- network
def proxy_file():
    """the shared proxy file (every PC that uses this data folder)"""
    return paths.data_dir("proxy.txt")


def local_proxy_file():
    """this PC's proxy file, %LOCALAPPDATA%\\SlideBuilder\\proxy.txt (None without LOCALAPPDATA: not Windows)"""
    local = os.environ.get("LOCALAPPDATA")
    return os.path.join(local, "SlideBuilder", "proxy.txt") if local else None


def _read_proxy(path):
    """a proxy file's setting: a URL, "" for a direct connection ("none"), or None when it is missing or says nothing"""
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            lines = [x.strip() for x in f.read().splitlines()]
    except (OSError, UnicodeDecodeError):
        return None
    line = next((x for x in lines if x and not x.startswith("#")), "")
    if not line:
        return None
    if line.lower() in ("none", "direct"):
        return ""
    return line if "://" in line else "http://" + line


def proxy_source():
    """(setting, file): the first proxy file that says something, this PC's before the shared one; (None, None) when
    neither does (then urllib looks at HTTPS_PROXY and the Windows setting)"""
    for path in (local_proxy_file(), proxy_file()):
        p = _read_proxy(path)
        if p is not None:
            return p, path
    return None, None


def proxy_setting():
    """the proxy from the proxy files: a URL, "" for a direct connection, or None (see proxy_source)"""
    return proxy_source()[0]


def _opener():
    p = proxy_setting()
    return urllib.request.build_opener(urllib.request.ProxyHandler({} if p == "" else {"http": p, "https": p} if p else None))


NO_NET = "SLIDEBUILDER_NO_NET"


def no_net():
    """the helper's network is switched off (set and not "0"; see the docstring above)"""
    return (os.environ.get(NO_NET) or "0").strip() not in ("", "0")


def fetch_url(url, timeout=TIMEOUT):
    """the body of a GET, or NetError (tests replace this function)"""
    if no_net():
        raise NetError(url, None, "network switched off (%s=1)" % NO_NET)
    req = urllib.request.Request(url, headers={"User-Agent": "SlideBuilder (Python-urllib)"})
    try:
        with _opener().open(req, timeout=timeout) as r:
            return r.read(FONT_MAX + 1)
    except urllib.error.HTTPError as e:
        raise NetError(url, e.code)
    except urllib.error.URLError as e:
        raise NetError(url, _tunnel_status(e.reason), _reason(e.reason))
    except (socket.timeout, ssl.SSLError, OSError) as e:
        raise NetError(url, _tunnel_status(e), _reason(e))


_TUNNEL = re.compile(r"Tunnel connection failed: (\d{3})")


def _tunnel_status(e):
    """the proxy's status when it refused an HTTPS tunnel (CONNECT): http.client raises OSError("Tunnel connection
    failed: 407 Proxy Authentication Required"), which urllib wraps in a URLError, not an HTTPError"""
    m = _TUNNEL.search(str(e))
    return int(m.group(1)) if m else None


def _reason(e):
    if isinstance(e, socket.gaierror):
        return "name not found (DNS)"
    if isinstance(e, (socket.timeout,)) or "timed out" in str(e):
        return "no answer (timed out)"
    if isinstance(e, ssl.SSLError):
        return "secure connection refused (%s)" % (getattr(e, "reason", None) or e)
    return str(e) or e.__class__.__name__


# ---------------------------------------------------------------------------------------------------- cache (B46)
def cache_dir():
    """data\\fonts\\cache: a folder, so fonts.py _sweep (which deletes unused font files at the top of data\\fonts, in 4.0
    as now) never touches it"""
    return os.path.join(fonts_dir(), "cache")


def _entry_path(key):
    return os.path.join(cache_dir(), hashlib.sha256(key.encode("utf-8")).hexdigest()[:40] + CACHE_EXT)


def _entry(path):
    """the bytes of a whole entry, or None: missing, vanished (pruned by another helper), locked (Windows, being
    replaced), half-written or damaged are all a miss"""
    try:
        with open(path, "rb") as f:
            raw = f.read(_HEAD.size + FONT_MAX + 1)
    except OSError:
        return None
    if len(raw) < _HEAD.size:
        return None
    magic, n, digest = _HEAD.unpack_from(raw)
    data = raw[_HEAD.size:]
    if magic != _MAGIC or n != len(data) or hashlib.sha256(data).digest() != digest:
        return None
    return data


def cache_get(key):
    """the cached bytes for `key`, or None. A hit marks the entry used: its mtime is the order pruning goes by (least
    recently used first), never its age - an entry that must be fetched again after a while keeps its fetch time
    inside (family_faces)"""
    path = _entry_path(key)
    got = _entry(path)
    if got is None:
        return None
    try:
        os.utime(path, None)
    except OSError:
        pass
    return got


def cache_drop(key):
    """forgets `key` (its answer is known to be out of date); one another helper has open stays until the next fetch"""
    remove_quietly(_entry_path(key))


def cache_put(key, data):
    """keeps `data` for `key`: written whole (temp + os.replace), so a reader sees the old entry or the new one; a
    failure (the folder read-only, the disk full, the entry locked) costs only a later fetch"""
    path = _entry_path(key)
    try:
        write_atomic(path, _HEAD.pack(_MAGIC, len(data), hashlib.sha256(data).digest()) + data)
    except Exception as e:
        log("font cache: not kept (%s)" % e)
        return
    try:
        _prune(path)
    except Exception as e:
        log("font cache: not pruned (%s)" % e)


def _prune(keep):
    """deletes the least recently used entries while the folder is above CACHE_MAX (down to CACHE_KEEP of it), and
    crashed writers' temp files. Never `keep` (just written); an entry another helper has open on Windows cannot be
    deleted and stays (the next one goes); on SMB/POSIX a reader keeps what it opened"""
    now, entries, total = time.time(), [], 0
    for e in os.scandir(cache_dir()):
        try:
            st = e.stat()
        except OSError:
            continue                                     # (deleted by another helper meanwhile)
        if e.name.endswith(".tmp"):
            if now - st.st_mtime > STALE_TMP_S:
                remove_quietly(e.path)
            else:
                total += st.st_size                      # another helper's entry on its way in
        elif e.name.endswith(CACHE_EXT):
            entries.append((st.st_mtime, e.path, st.st_size))
            total += st.st_size
    if total <= CACHE_MAX:
        return
    for _, path, size in sorted(entries):
        if total <= CACHE_MAX * CACHE_KEEP:
            break
        if path != keep and remove_quietly(path):
            total -= size


def _font_entry(data):
    return data if data and len(data) <= FONT_MAX and detect_ext(data) else None


# ---------------------------------------------------------------------------------------------------- METADATA.pb
_TOKEN = re.compile(r'"(?:\\.|[^"\\])*"|[{}:]|#[^\n]*|[^\s{}:"#]+')


def parse_metadata(text):
    """the protobuf text format of google/fonts' METADATA.pb, as nested dicts: every field is a list of values
    (strings unquoted, blocks as dicts)"""
    toks = [t for t in _TOKEN.findall(text) if not t.startswith("#")]
    pos = [0]

    def value(t):
        if t.startswith('"'):
            return re.sub(r"\\(.)", r"\1", t[1:-1])
        return t

    def block():
        out = {}
        while pos[0] < len(toks):
            key = toks[pos[0]]
            pos[0] += 1
            if key == "}":
                return out
            nxt = toks[pos[0]] if pos[0] < len(toks) else ""
            if nxt == ":":
                pos[0] += 1
                nxt = toks[pos[0]] if pos[0] < len(toks) else ""
            if nxt == "{":
                pos[0] += 1
                out.setdefault(key, []).append(block())
            else:
                pos[0] += 1
                parts = [value(nxt)]
                while pos[0] < len(toks) and toks[pos[0]].startswith('"') and nxt.startswith('"'):   # "a" "b" concatenated
                    parts.append(value(toks[pos[0]]))
                    pos[0] += 1
                out.setdefault(key, []).append("".join(parts))
        return out
    return block()


def _num(v, d):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return d


def pick_faces(meta, base):
    """the faces to add from a METADATA.pb: regular and bold, upright and italic, as the family has them.
    [{weight, style, file (repository path), variable}]; a variable file gives every wanted weight in its wght range."""
    axes = {a.get("tag", [""])[0]: (_num(a.get("min_value", [0])[0], 0), _num(a.get("max_value", [0])[0], 0)) for a in meta.get("axes", [])}
    out = []
    for style in ("normal", "italic"):
        fonts = [f for f in meta.get("fonts", []) if f.get("style", ["normal"])[0] == style and f.get("filename")]
        var = [f for f in fonts if "[" in f["filename"][0]]
        if var:
            lo, hi = axes.get("wght", (_num(var[0].get("weight", [400])[0], 400),) * 2)
            for w in sorted({max(lo, min(hi, x)) for x in WANT}):
                out.append({"weight": w, "style": style, "file": base + var[0]["filename"][0], "variable": True})
            continue
        by_weight = {}
        for f in fonts:
            by_weight.setdefault(_num(f.get("weight", [400])[0], 400), f["filename"][0])
        if not by_weight:
            continue
        regular = min(by_weight, key=lambda w: (abs(w - 400), w))
        chosen = [regular]
        bolds = [w for w in by_weight if w >= 600 and w != regular]
        if bolds:
            chosen.append(min(bolds, key=lambda w: abs(w - 700)))
        out += [{"weight": w, "style": style, "file": base + by_weight[w], "variable": False} for w in chosen]
    return [f for f in out if _REPO_FILE.match(f["file"])]


def repo_dir(family):
    """the folder of a family in google/fonts: its name in lower case, letters and digits only"""
    return re.sub(r"[^a-z0-9]", "", family.lower())


def _github(family):
    """(faces, mirror) from google/fonts; GFontError(404) when no licence folder has the family; NetError when no
    mirror answers"""
    d = repo_dir(family)
    last = None
    for mirror in GITHUB:
        try:
            for lic in LICENCES:
                try:
                    text = fetch_url(mirror + "%s/%s/METADATA.pb" % (lic, d)).decode("utf-8", "replace")
                except NetError as e:
                    if e.status == 404:              # only a 404 says the mirror lacks it; anything else (a 429 rate
                        continue                     # limit, a proxy's 403 or 407, no answer) says nothing about the font
                    raise
                meta = parse_metadata(text)
                if not meta.get("fonts"):            # a proxy's sign-in page answering 200: not the repository
                    raise NetError(mirror, None, "the answer is not a METADATA.pb (a proxy's sign-in page?)")
                faces = pick_faces(meta, "%s/%s/" % (lic, d))
                if not faces:
                    raise Absent("no TrueType files on GitHub")
                return {"family": (meta.get("name") or [family])[0], "source": "github", "license": lic, "faces": faces}
            raise Absent()
        except NetError as e:                    # (a 404 never gets here: the next licence folder is tried)
            last = e
            log("google fonts: %s" % e)
    raise last


# ---------------------------------------------------------------------------------------------------- CSS API
def parse_css(css):
    """the @font-face blocks of a Google Fonts stylesheet (only the latin subsets when the sheet names subsets), with
    files on fonts.gstatic.com only"""
    out = []
    for m in re.finditer(r"(?:/\*\s*([\w-]+)\s*\*/\s*)?@font-face\s*{([^}]*)}", css):
        body = m.group(2)
        url = re.search(r"url\(([^)]+)\)", body)
        url = url and url.group(1).strip("'\" ")
        if not url or not _GSTATIC_FILE.match(url):
            continue
        w = re.search(r"font-weight:\s*(\d+)", body)
        r = re.search(r"unicode-range:\s*([^;]+)", body)
        face = {"subset": m.group(1) or "", "weight": int(w.group(1)) if w else 400,
                "style": "italic" if re.search(r"font-style:\s*italic", body) else "normal", "file": url, "variable": False}
        if r:
            face["range"] = r.group(1).strip()
        out.append(face)
    named = any(f["subset"] for f in out)
    return [dict((k, v) for k, v in f.items() if k != "subset") for f in out if not named or f["subset"] in ("latin", "latin-ext")]


def _css_api(family):
    q = urllib.parse.quote(family).replace("%20", "+")
    for spec in (":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ""):    # not every family has bold or italic
        try:
            css = fetch_url(CSS_API + q + spec + "&display=swap").decode("utf-8", "replace")
        except NetError as e:
            if e.status == 400:
                continue
            raise
        faces = parse_css(css)
        if faces:
            return {"family": family, "source": "googleapis", "faces": faces}
    raise Absent()


# ---------------------------------------------------------------------------------------------------- the API
def _family_entry(raw):
    """(fetched at, family_faces answer) of a cached family, or None when the entry is not one"""
    try:
        ent = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(ent, dict) or not isinstance(ent.get("at"), (int, float)):
        return None
    res = ent.get("res")
    ok = isinstance(res, dict) and isinstance(res.get("faces"), list) and res["faces"] and all(
        isinstance(f, dict) and (_REPO_FILE.match(str(f.get("file"))) or _GSTATIC_FILE.match(str(f.get("file")))) for f in res["faces"])
    return (ent["at"], res) if ok else None


def _family_key(ref):
    """the cache key of the family a file named by family_faces belongs to (its google/fonts folder, or the folder
    fonts.gstatic.com names after the family), or None"""
    m = re.match(r"^(?:ofl|apache|ufl)/([a-z0-9]+)/", ref) or re.match(r"^https://fonts\.gstatic\.com/s/([a-z0-9]+)/", ref)
    return "family:" + m.group(1) if m else None


def family_faces(family):
    """GET /api/fonts/google: the faces of a Google font and where the helper takes them from; from the cache when a
    helper fetched them in the last month (or longer ago, when Google cannot be asked now). The month is counted from
    the fetch (kept in the entry), not from the last read: a family read every day is still asked again"""
    family = clean_family(family)
    key = "family:" + repo_dir(family)
    raw = cache_get(key)
    got = _family_entry(raw) if raw is not None else None
    if got and time.time() - got[0] <= FAMILY_MAX_AGE:
        return got[1]
    try:
        res = _family_faces(family)
    except GFontError:
        if got:
            log("google fonts: %s from the cache (Google not asked again)" % family)
            return got[1]
        raise
    cache_put(key, json.dumps({"at": time.time(), "res": res}, sort_keys=True).encode("utf-8"))
    return res


def _family_faces(family):
    failures, absent = [], []
    for source in (_github, _css_api):
        try:
            res = source(family)
            log("google fonts: %s from %s (%d faces)" % (family, res["source"], len(res["faces"])))
            return res
        except Absent:
            absent.append(source)
        except NetError as e:
            failures.append(e)
    if len(failures) == 2:
        raise GFontError(502, unreachable_message(failures))
    if absent == [_github]:
        # GitHub has no folder of that name (or no TrueType files in it), and the CSS API, which knows every family by
        # its name, could not be asked: the name may be right (the office: googleapis does not resolve)
        raise GFontError(404, "\u201c%s\u201d was not found on GitHub (google/fonts), and Google Fonts could not be asked from "
                              "this PC (%s). If the name is right, %s." % (family, "; ".join(str(e) for e in failures), UPLOAD_HINT))
    # a source answered without it (GitHub names a family's folder after it: a family it has under another name
    # is found by the CSS API, where that answers)
    raise GFontError(404, "\u201c%s\u201d is not a Google font \u2013 check the spelling on fonts.google.com, or %s" % (family, UPLOAD_HINT))


def unreachable_message(failures):
    why = "; ".join(sorted(set(str(e) for e in failures)))
    if any(e.status == 407 for e in failures):
        return ("The proxy asks for a password, which Slide Builder cannot give (%s). To add the font, %s." % (why, UPLOAD_HINT))
    if no_net():
        return ("Google Fonts cannot be reached from the Slide Builder helper: its network is switched off (%s=1 is set). "
                "To add the font, %s." % (NO_NET, UPLOAD_HINT))
    p, path = proxy_source()
    where = ("the proxy in %s (%s)" % (path, p)) if p else ("a direct connection (%s)" % path) if p == "" else "this PC's proxy setting"
    here = local_proxy_file()
    return ("Google Fonts cannot be reached from the Slide Builder helper through %s (%s). To add the font, %s; "
            "or ask IT for the proxy address and write it in %s (every PC)%s." % (
                where, why, UPLOAD_HINT, proxy_file(), " or %s (this PC only)" % here if here else ""))


def face_file(ref):
    """GET /api/fonts/google/file: the bytes of one file named by family_faces (a google/fonts path, from either
    mirror, or a fonts.gstatic.com address) - never any other address. From the cache when a helper fetched it."""
    ref = str(ref or "")
    if _REPO_FILE.match(ref) and ".." not in ref:
        urls = [m + urllib.parse.quote(ref) for m in GITHUB]
    elif _GSTATIC_FILE.match(ref) and ".." not in ref:
        urls = [ref]
    else:
        raise PermissionError("not a Google font file")
    data = _font_entry(cache_get("file:" + ref))
    if data:
        return data
    data = _fetch_file(ref, urls)
    cache_put("file:" + ref, data)
    return data


def _fetch_file(ref, urls):
    """the file's bytes from the first address that has it; GFontError(404) when every one answered it is not there
    (google/fonts renamed it, static to variable: the page asks for the family again, once)"""
    failures = []
    for url in urls:
        try:
            data = fetch_url(url, FILE_TIMEOUT)
        except NetError as e:
            failures.append(e)                   # (any failure: the other mirror may answer, a 429 is GitHub's)
            continue
        if len(data) > FONT_MAX:
            raise GFontError(413, "%s is larger than %d MB, too large for the font library. To add the font, %s, choosing the "
                                  "files in its static folder." % (os.path.basename(ref), FONT_MAX // (1024 * 1024), UPLOAD_HINT))
        if not detect_ext(data):
            failures.append(NetError(url, None, "the answer is not a font file"))
            continue
        return data
    if any(e.status == 404 for e in failures):
        # the family's faces the cache keeps (fresh for a month) name a file that is not there any more: forgotten, so
        # the next family_faces asks Google (a file pruned from the cache would otherwise never be had again)
        key = _family_key(ref)
        if key:
            cache_drop(key)
        if all(e.status == 404 for e in failures):
            raise GFontError(404, "%s is not on Google Fonts any more (the family's files changed). Add the family again; "
                                  "if that fails, %s." % (os.path.basename(ref), UPLOAD_HINT))
    raise GFontError(502, unreachable_message(failures))


# ---------------------------------------------------------------------------------------------------- previews
def _subset(family):
    """the letters of the family's name as Google subsets them (googleapis &text=), or NetError / Absent"""
    css = fetch_url(CSS_API + urllib.parse.quote(family).replace("%20", "+") + "&text=" + urllib.parse.quote(family) + "&display=swap")
    for m in re.finditer(r"url\(([^)]+)\)", css.decode("utf-8", "replace")):
        url = m.group(1).strip("'\" ")
        if (_GSTATIC_SUBSET.match(url) or _GSTATIC_FILE.match(url)) and ".." not in url:
            data = _font_entry(fetch_url(url))
            if data:
                return data
            raise NetError(url, None, "the answer is not a font file")
    raise Absent()


def preview(family):
    """GET /api/fonts/google/preview: a font to show the family's name in the picker - googleapis' subset of the name's
    letters where it answers (a few KB), else the family's regular file (the one adding the family fetches). Fetched
    once for the office: the subset, or which file it was, is kept in the cache."""
    family = clean_family(family)
    key = "preview:" + repo_dir(family)
    raw = cache_get(key)
    if raw is not None:
        if _font_entry(raw):
            return raw
        try:
            return face_file(json.loads(raw.decode("utf-8"))["ref"])
        except (GFontError, PermissionError, UnicodeDecodeError, ValueError, KeyError, TypeError):
            pass                                          # (not a pointer, or its file cannot be had: as if not cached)
    try:
        data = _subset(family)
        cache_put(key, data)
        return data
    except (NetError, Absent) as e:
        log("google fonts: no preview subset of %s (%s)" % (family, e))
    faces = family_faces(family)["faces"]
    face = min(faces, key=lambda f: (f.get("style") != "normal", abs(_num(f.get("weight"), 400) - 400)))
    data = face_file(face["file"])
    cache_put(key, json.dumps({"ref": face["file"]}).encode("utf-8"))
    return data


def preview_type(data):
    """the content type of a preview (detect_ext names the extensions its first bytes may have)"""
    return FONT_TYPES[(detect_ext(data) or (".ttf",))[0]]
