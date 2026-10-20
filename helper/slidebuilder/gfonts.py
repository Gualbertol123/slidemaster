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

Proxy: Python does not read a PAC file. The helper uses, in this order, the first line of this PC's
%LOCALAPPDATA%\SlideBuilder\proxy.txt (a laptop at home or on VPN needs another proxy than the office), else of the
shared data\proxy.txt ("http://proxy.example:8080", or "none" for a direct connection), else HTTPS_PROXY / the
Windows proxy setting (urllib's own lookup).
"""
import os
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

from . import paths
from .fonts import FONT_MAX, clean_family, detect_ext
from .util import log

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


def fetch_url(url, timeout=TIMEOUT):
    """the body of a GET, or NetError (tests replace this function)"""
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
def family_faces(family):
    """GET /api/fonts/google: the faces of a Google font and where the helper takes them from"""
    family = clean_family(family)
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
    p, path = proxy_source()
    where = ("the proxy in %s (%s)" % (path, p)) if p else ("a direct connection (%s)" % path) if p == "" else "this PC's proxy setting"
    here = local_proxy_file()
    return ("Google Fonts cannot be reached from the Slide Builder helper through %s (%s). To add the font, %s; "
            "or ask IT for the proxy address and write it in %s (every PC)%s." % (
                where, why, UPLOAD_HINT, proxy_file(), " or %s (this PC only)" % here if here else ""))


def face_file(ref):
    """GET /api/fonts/google/file: the bytes of one file named by family_faces (a google/fonts path, from either
    mirror, or a fonts.gstatic.com address) - never any other address"""
    ref = str(ref or "")
    if _REPO_FILE.match(ref) and ".." not in ref:
        urls = [m + urllib.parse.quote(ref) for m in GITHUB]
    elif _GSTATIC_FILE.match(ref) and ".." not in ref:
        urls = [ref]
    else:
        raise PermissionError("not a Google font file")
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
    raise GFontError(502, unreachable_message(failures))
