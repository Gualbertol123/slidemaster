"""Update Slide Builder from GitHub without touching anybody's saved work.

    python tools/update.py            connect this folder to GitHub (first time) or update it
    python tools/update.py --check    only say whether an update is available
    python tools/update.py --branch main      follow another branch from now on
    python tools/update.py --release [latest|X.Y.Z]   install a GitHub release side by side (app\\<ver>\\)
    python tools/update.py --use X.Y.Z        go back (or forward) to an installed version
    python tools/update.py --zip <file.zip>   install a release ZIP without internet
    python tools/update.py --migrate-all      move every Slide Builder 3 deck to Slide Builder 4 now (else on first open)
    python tools/update.py --rollback [NAME]  give a deck (NAME, a workbook) or every deck back to Slide Builder 3

What is never changed – it is not part of the repository (see .gitignore):
    backend/data/        decks, cell edits, deck styles, defaults, user preferences, backups
    backend/logo*.*      logos, slide_builder_settings*.txt (v2 settings)
    (the program itself is in helper/ since 4.0 - in backend/ until 3.8; backend/ keeps the user's files)
    *.xlsx …             the workbooks          export/  engine/

How it updates
  * with git on the PC: the folder itself becomes the git working copy ("connected"), in place – no
    second "slidemaster" folder. The first run runs `git init` + `fetch` + a forced checkout, which writes
    only the program files; later runs fetch and move to the newest version. Program files you changed
    by hand are copied to the backup folder first. Nothing untracked is ever deleted (no `git clean`).
  * without git: the newest version is downloaded as a ZIP and the program files are copied over,
    again skipping everything listed above.

Side-by-side releases (--release, --zip <file>, --use)
  * the newest release is found on github.com/<owner>/<repo>/releases/latest (a web page: it does not use up
    the 60 API requests an hour that every PC on the office's internet address shares); GitHub's API only when
    that page does not answer. Nothing newer than the version in use: it says so and changes nothing (no backup);
  * a release ZIP (tools/make_release.py) is checked against the .sha256 file published with it and GitHub's
    SHA-256 "digest" of the asset when they can be had, and always against the MANIFEST.json inside it;
  * it is extracted to app\\<ver>.part\\ and renamed to app\\<ver>\\ only when complete, so an interrupted
    install leaves nothing that looks installed;
  * the new version's `slide_builder.py --selftest` must pass (it reads every saved setup without writing,
    and checks the data folder accepts create, rename and delete) before app\\current.json is replaced
    (atomically) - "Start Slide Builder.bat" starts the version named there, else helper\\ as before;
  * the last 3 versions stay (plus the current one), so --use can go back at once. The data folder is
    shared by all versions and is never written by the install, only backed up.

Before every update the saved setups are copied to backend/data/backups/before-update-<time>/ (the last
5 are kept), and afterwards every saved deck is checked with the new program files. Only one person
can update the shared folder at a time (lock file). People who have Slide Builder open restart it
afterwards (close the black window, start it again) and reload the browser tab.
"""
import argparse
import datetime
import email.utils
import getpass
import hashlib
import io
import json
import os
import re
import shutil
import stat
import ssl
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REPO = "https://github.com/gualbertol123/slidemaster.git"
LOCK_STALE_S = 30 * 60
KEEP_BACKUPS = 5
KEEP_VERSIONS = 3

# never written by the ZIP update (git never touches them either: they are not in the repository). app/ holds
# the side-by-side versions (app/<ver>/, app/current.json); the repository's app/ (the browser app's sources,
# which only developers need) is skipped with them - git checks those sources out next to the versions.
PROTECTED_DIRS = ("backend/data/", "export/", "engine/", ".git/", "slidemaster/", "app/")
PROTECTED_RE = re.compile(r"(^|/)(~\$[^/]*|[^/]*\.(xlsx|xlsm|xlsb|xls))$|^backend/(logo[^/]*|slide_builder_settings[^/]*)$", re.I)


def say(msg=""):
    """print that never fails on a cp1252 / ASCII console"""
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        msg.encode(enc)
    except (UnicodeEncodeError, LookupError):
        msg = msg.encode("ascii", "replace").decode("ascii")
    print(msg, flush=True)


def data_dir(root):
    return os.path.join(root, "backend", "data")


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def is_protected(path):
    p = path.replace("\\", "/").lstrip("/")
    return p.startswith(PROTECTED_DIRS) or bool(PROTECTED_RE.search(p))


# --------------------------------------------------------------------------- lock (shared folder)
class UpdateLock:
    """O_EXCL lock file in backend/data/locks: one update of the shared folder at a time."""

    def __init__(self, root):
        self.path = os.path.join(data_dir(root), "locks", "update.lock")

    def __enter__(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    age = time.time() - os.path.getmtime(self.path)
                    with open(self.path, encoding="utf-8") as f:
                        who = f.read().strip()
                except OSError:
                    continue
                if age > LOCK_STALE_S:
                    try:
                        os.remove(self.path)
                    except OSError:
                        pass
                    continue
                raise SystemExit("Somebody else is updating Slide Builder right now (%s). Try again in a few minutes." % who)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("%s on %s since %s" % (user(), os.environ.get("COMPUTERNAME", "this PC"), datetime.datetime.now().strftime("%H:%M")))
            return self
        raise SystemExit("Could not take the update lock " + self.path)

    def __exit__(self, *exc):
        try:
            os.remove(self.path)
        except OSError:
            pass


def user():
    try:
        return getpass.getuser()
    except Exception:
        return "someone"


# --------------------------------------------------------------------------- backups
def backup_saved(root, stamp):
    """copy the saved setups (not the rolling backups, presence or locks) before anything changes"""
    src = data_dir(root)
    dst = os.path.join(src, "backups", "before-update-" + stamp)
    n = 0
    if os.path.isdir(src):
        for name in ("config.json",):
            if os.path.isfile(os.path.join(src, name)):
                os.makedirs(dst, exist_ok=True); shutil.copy2(os.path.join(src, name), dst); n += 1
        for sub in ("workbooks", "users"):
            d = os.path.join(src, sub)
            if os.path.isdir(d):
                for f in os.listdir(d):
                    if f.endswith(".json"):
                        os.makedirs(os.path.join(dst, sub), exist_ok=True); shutil.copy2(os.path.join(d, f), os.path.join(dst, sub)); n += 1
    backend = os.path.join(root, "backend")
    for f in os.listdir(backend) if os.path.isdir(backend) else []:
        if f.startswith("slide_builder_settings") and os.path.isfile(os.path.join(backend, f)):
            os.makedirs(dst, exist_ok=True); shutil.copy2(os.path.join(backend, f), dst); n += 1
    # keep the last few
    bdir = os.path.join(src, "backups")
    if os.path.isdir(bdir):
        old = sorted(x for x in os.listdir(bdir) if x.startswith("before-update-"))
        for x in old[:-KEEP_BACKUPS]:
            shutil.rmtree(os.path.join(bdir, x), ignore_errors=True)
    return dst, n


def backup_program_file(root, stamp, relpath):
    src = os.path.join(root, relpath)
    dst = os.path.join(data_dir(root), "backups", "before-update-" + stamp, "program-files", relpath)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)


# --------------------------------------------------------------------------- git
def git_exe():
    return shutil.which("git")


def git(root, *args, check=True, quiet=False):
    # safe.directory: network drives often belong to another Windows account ("dubious ownership")
    cmd = [git_exe(), "-c", "safe.directory=*", "-c", "core.longpaths=true", "-C", root] + list(args)
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise SystemExit("git %s failed:\n%s" % (" ".join(args), (r.stderr or r.stdout).strip()))
    if not quiet and r.returncode != 0:
        say((r.stderr or r.stdout).strip())
    return r


def fetch(root, remote="origin"):
    for wait in (0, 2, 4, 8, 16):
        if wait:
            say("  network problem, retrying in %d s…" % wait); time.sleep(wait)
        r = git(root, "fetch", "--prune", remote, check=False, quiet=True)
        if r.returncode == 0:
            return
        last = (r.stderr or r.stdout).strip()
    raise SystemExit("Could not download from GitHub:\n" + last)


def remote_default_branch(root):
    r = git(root, "ls-remote", "--symref", "origin", "HEAD", check=False, quiet=True)
    m = re.search(r"ref: refs/heads/(\S+)\s+HEAD", r.stdout or "")
    return m.group(1) if m else None


def blob_shas(path):
    """git blob ids the file could have been checked out from (as is, and with Windows line endings undone)"""
    with open(path, "rb") as f:
        data = f.read()
    sha = lambda b: hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()
    return {sha(data), sha(data.replace(b"\r\n", b"\n"))}


def update_with_git(root, repo, branch, stamp, check_only):
    first = not os.path.isdir(os.path.join(root, ".git"))
    if first:
        if check_only:
            say("This folder is not connected to GitHub yet. Run the update to connect it (your saved setups stay).")
            return False
        say("Connecting this folder to GitHub (in place – no second folder)…")
        git(root, "init", "-q")
        git(root, "remote", "add", "origin", repo)
    else:
        url = git(root, "remote", "get-url", "origin", check=False, quiet=True).stdout.strip()
        if not url:
            git(root, "remote", "add", "origin", repo)
    say("Downloading the newest version…")
    fetch(root)
    if not branch:
        cur = git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", check=False, quiet=True).stdout.strip()
        branch = cur.split("/", 1)[1] if cur.startswith("origin/") else remote_default_branch(root)
    if not branch:
        raise SystemExit("Could not tell which branch to follow – run again with --branch <name>.")
    target = "origin/" + branch
    if git(root, "rev-parse", "--verify", "-q", target, check=False, quiet=True).returncode != 0:
        raise SystemExit("GitHub has no branch called %r." % branch)
    new = git(root, "rev-parse", target).stdout.strip()
    old = None if first else git(root, "rev-parse", "-q", "--verify", "HEAD", check=False, quiet=True).stdout.strip() or None
    on_branch = not first and git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False, quiet=True).stdout.strip() == branch

    if old == new and on_branch:
        dirty = git(root, "status", "--porcelain", "--untracked-files=no").stdout.strip()
        if not dirty:
            say("Already up to date (%s, %s)." % (branch, new[:7]))
            return False
    if check_only:
        say("An update is available: %s → %s on %s." % ((old or "unknown")[:7], new[:7], branch))
        if old:
            say(git(root, "log", "--oneline", "--no-decorate", "%s..%s" % (old, new), check=False, quiet=True).stdout)
        return True

    # program files that would be overwritten although they differ from the last version: keep a copy
    saved = []
    if first:
        for line in git(root, "ls-tree", "-r", target).stdout.splitlines():
            meta, path = line.split("\t", 1)
            sha = meta.split()[2]
            full = os.path.join(root, path)
            if os.path.isfile(full) and not is_protected(path) and sha not in blob_shas(full):
                backup_program_file(root, stamp, path); saved.append(path)
    else:
        for line in git(root, "status", "--porcelain", "--untracked-files=no").stdout.splitlines():
            path = line[3:].strip().strip('"')
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            if os.path.isfile(os.path.join(root, path)):
                backup_program_file(root, stamp, path); saved.append(path)
    if saved:
        say("%d program file(s) differ from the GitHub version (old copies kept in the backup folder): " % len(saved) + ", ".join(saved[:6]) + (" …" if len(saved) > 6 else ""))

    # only tracked files are written; untracked and ignored files (saved setups, workbooks) are left alone
    if on_branch:
        git(root, "reset", "-q", "--hard", target)
    else:
        git(root, "checkout", "-q", "-f", "-B", branch, "--track", target)
    say("Updated to %s (%s)." % (new[:7], branch))
    if old and old != new:
        log = git(root, "log", "--oneline", "--no-decorate", "-n", "30", "%s..%s" % (old, new), check=False, quiet=True).stdout.strip()
        if log:
            say("What's new:\n" + "\n".join("  " + x for x in log.splitlines()))
    return True


# --------------------------------------------------------------------------- ZIP (no git on this PC)
def parse_repo(repo):
    m = re.search(r"github\.com[/:]([^/]+)/([^/.]+?)(?:\.git)?/?$", repo)
    if not m:
        raise SystemExit("Not a GitHub repository address: " + repo)
    return m.group(1), m.group(2)


class NetError(SystemExit):
    """a GitHub request that failed, as one sentence for the person running the update (no traceback). A SystemExit,
    so the callers that fall back on a failed request (update_with_zip) keep working. `status`: the HTTP status."""
    def __init__(self, msg, status=None):
        SystemExit.__init__(self, msg)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None             # the 30x answer itself is wanted (its Location), see http_request(follow=False)


def retry_at(headers, now=None):
    """when GitHub answers again (epoch seconds), from Retry-After (seconds or an HTTP date) or X-RateLimit-Reset
    (epoch); None if unknown. Each header on its own: one that cannot be read does not hide the other."""
    now = time.time() if now is None else now
    after = (headers.get("Retry-After") or "").strip()
    if after:
        try:
            return now + max(0, int(after))
        except ValueError:
            pass
        try:
            d = email.utils.parsedate_to_datetime(after)     # "Wed, 21 Oct 2026 07:28:00 GMT"
            if d.tzinfo is None:                             # "-0000": UTC
                d = d.replace(tzinfo=datetime.timezone.utc)
            return max(now, d.timestamp())
        except (TypeError, ValueError, IndexError, OverflowError):   # Python 3.8 raises TypeError, 3.10+ ValueError
            pass
    reset = headers.get("X-RateLimit-Reset")
    if reset:
        try:
            return max(now, int(reset))
        except ValueError:
            pass
    return None


def when_text(at, now=None):
    """'after 15:49 (in 25 minutes)', local time - the clock on the wall of the person reading it"""
    now = time.time() if now is None else now
    mins = max(1, int((at - now + 59) // 60))
    t = datetime.datetime.fromtimestamp(at)
    clock = t.strftime("%H:%M") if t.date() == datetime.datetime.fromtimestamp(now).date() else t.strftime("%d/%m %H:%M")
    return "after %s (in %d minute%s)" % (clock, mins, "" if mins == 1 else "s")


def http_request(url, timeout=60, follow=True, retries=True):
    """(status, headers, body) of a GET. Failures become a NetError with a sentence: a used-up GitHub limit (403/429
    with X-RateLimit-Remaining 0 or Retry-After) says when to try again, and is never retried (every retry costs
    another of the 60 requests an hour the office shares); other 4xx are not retried either; network errors and 5xx
    are retried 3 times (retries=False: not at all - an optional check). follow=False: a redirect is returned as it is
    (its Location header), not followed."""
    req = urllib.request.Request(url, headers={"User-Agent": "SlideBuilder-updater"})
    # the Windows proxy settings, and the Windows certificate store (a company root CA is trusted)
    handlers = [urllib.request.HTTPSHandler(context=ssl.create_default_context())]
    opener = urllib.request.build_opener(*(handlers + ([] if follow else [_NoRedirect()])))
    host = urllib.parse.urlparse(url).netloc or url
    last = None
    for wait in ((0, 2, 4, 8) if retries else (0,)):
        if wait:
            say("  network problem (%s), retrying in %d s..." % (last, wait)); time.sleep(wait)
        try:
            with opener.open(req, timeout=timeout) as r:
                return r.status if hasattr(r, "status") else r.getcode(), r.headers, r.read()
        except urllib.error.HTTPError as e:
            if not follow and 300 <= e.code < 400:
                return e.code, e.headers, b""
            try:
                body = e.read()
            except Exception:         # noqa: BLE001 – the status is enough
                body = b""
            limited = e.code == 429 or (e.code == 403 and (e.headers.get("X-RateLimit-Remaining") == "0"
                                                          or e.headers.get("Retry-After") or b"rate limit" in body.lower()))
            if limited:
                at = retry_at(e.headers)
                raise NetError("GitHub is not answering this office for now: its limit for PCs without a GitHub login (60 "
                               "questions an hour, shared by every PC on the office's internet address) is used up. "
                               "Nothing was changed. Try again %s." % (when_text(at) if at else "in an hour"), e.code)
            if e.code < 500:
                raise NetError("GitHub answered %d %s for %s." % (e.code, e.reason, url), e.code)
            last = "%s answered %d %s" % (host, e.code, e.reason)
        except Exception as e:        # noqa: BLE001 – URLError, timeouts, a connection cut half-way
            last = getattr(e, "reason", None) or e
            if url.startswith("file:"):
                break
    raise NetError("Could not reach %s (%s). Nothing was changed. Check that this PC is on the internet (a browser opens "
                   "https://github.com), then try again in a few minutes." % (host, last))


def http_get(url, timeout=60, retries=True):
    return http_request(url, timeout, retries=retries)[2]


def version_file(root):
    return os.path.join(data_dir(root), "app-version.json")


def update_with_zip(root, repo, branch, stamp, check_only, zip_url=None):
    owner, name = parse_repo(repo)
    sha = None
    if not zip_url:
        if not branch:
            try:
                branch = json.loads(http_get("https://api.github.com/repos/%s/%s" % (owner, name)))["default_branch"]
            except (SystemExit, KeyError, ValueError):
                branch = "main"
        try:
            sha = json.loads(http_get("https://api.github.com/repos/%s/%s/commits/%s" % (owner, name, branch)))["sha"]
        except (SystemExit, KeyError, ValueError):
            sha = None
        zip_url = "https://codeload.github.com/%s/%s/zip/refs/heads/%s" % (owner, name, branch)
    try:
        with open(version_file(root), encoding="utf-8") as f:
            have = json.load(f)
    except (OSError, ValueError):
        have = {}
    if sha and have.get("sha") == sha:
        say("Already up to date (%s, %s)." % (branch, sha[:7]))
        return False
    if check_only:
        say("An update is available%s." % (" (%s → %s)" % ((have.get("sha") or "unknown")[:7], sha[:7]) if sha else ""))
        return True
    say("Downloading the newest version (ZIP – git is not installed on this PC)…")
    data = http_get(zip_url, timeout=300)
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in zf.namelist() if not n.endswith("/")]
    top = os.path.commonprefix(names).split("/")[0] + "/" if names and all("/" in n for n in names) else ""
    written, saved = 0, []
    for n in names:
        path = n[len(top):]
        if not path or is_protected(path):
            continue
        dest = os.path.join(root, *path.split("/"))
        blob = zf.read(n)
        if os.path.isfile(dest):
            with open(dest, "rb") as f:
                cur = f.read()
            if cur == blob:
                continue
            backup_program_file(root, stamp, path); saved.append(path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".update-tmp"
        with open(tmp, "wb") as f:
            f.write(blob)
        os.replace(tmp, dest)          # atomic: people running the app never see half a file
        written += 1
    os.makedirs(data_dir(root), exist_ok=True)
    with open(version_file(root), "w", encoding="utf-8") as f:
        json.dump({"sha": sha, "branch": branch, "at": datetime.datetime.now().isoformat(timespec="seconds"), "by": user()}, f, indent=1)
    say("Updated: %d program files written%s." % (written, (" (previous versions in the backup folder)" if saved else "")))
    return True


# --------------------------------------------------------------------------- release ZIPs (MANIFEST.json)
MANIFEST = "MANIFEST.json"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$", re.I)
BAD_CHARS = re.compile(r'[\x00-\x1f<>"|?*:\\]')
# the program's entry: helper/ from 4.0, backend/ in 3.x releases (still installable: --release 3.8.0, --use)
CORE_FILES = ("helper/slide_builder.py", "backend/slide_builder.py")


def program_dir(folder):
    """the program's folder in a version folder or a main folder: helper/ (4.x), else backend/ (3.x); None if neither"""
    for c in CORE_FILES:
        if os.path.isfile(os.path.join(folder, *c.split("/"))):
            return os.path.join(folder, c.split("/")[0])
    return None


def safe_member(name):
    """a ZIP entry that stays inside the folder it is extracted to and that Windows can create as named:
    no drive, no .., no backslashes, no device names (CON, AUX.txt ...), no part ending in "." or " ",
    no control characters or <>"|?*"""
    if not name or name.startswith("/") or BAD_CHARS.search(name):
        return False
    for part in name.rstrip("/").split("/"):
        if part in ("", ".", "..") or part[-1] in ". " or WINDOWS_RESERVED.match(part):
            return False
    return True


def _fold(name):
    """the name as Windows compares it (case-insensitive, one Unicode form)"""
    return unicodedata.normalize("NFC", name).casefold()


def verify_release(zf):
    """check an open release ZIP against its MANIFEST.json: every listed file present with its size and
    SHA-256, nothing extra, every path safe and unique on Windows. Returns the manifest; raises
    ValueError with the reason."""
    all_names = zf.namelist()
    bad = [n for n in all_names if not safe_member(n)]
    if bad:
        raise ValueError("unsafe path in the ZIP: %r" % bad[0])
    folded = [_fold(n.rstrip("/")) for n in all_names]
    if len(set(folded)) != len(folded):
        dup = next(n for n in all_names if folded.count(_fold(n.rstrip("/"))) > 1)
        raise ValueError("two entries with the same name on Windows: %r" % dup)
    names = [n for n in all_names if not n.endswith("/")]
    if MANIFEST not in names:
        raise ValueError("the ZIP has no %s" % MANIFEST)
    try:
        man = json.loads(zf.read(MANIFEST).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise ValueError("%s cannot be read" % MANIFEST)
    files = man.get("files") if isinstance(man, dict) else None
    version = man.get("version") if isinstance(man, dict) else None
    if not isinstance(files, dict) or not files:
        raise ValueError("%s lists no files" % MANIFEST)
    for n, meta in files.items():
        if (not isinstance(meta, dict) or not isinstance(meta.get("size"), int) or isinstance(meta.get("size"), bool)
                or not isinstance(meta.get("sha256"), str) or not re.match(r"^[0-9a-f]{64}$", meta["sha256"])):
            raise ValueError("%s has a bad entry for %s" % (MANIFEST, n))
    if not isinstance(version, str) or not VERSION_RE.match(version):
        raise ValueError("%s has no valid version" % MANIFEST)
    if man.get("app") not in (None, "slide-builder"):
        raise ValueError("not a Slide Builder release (app %r)" % man.get("app"))
    if not any(c in files for c in CORE_FILES):
        raise ValueError("the release has no %s" % CORE_FILES[0])
    listed, present = set(files), set(names) - {MANIFEST}
    unsafe = [n for n in listed if not safe_member(n)]
    if unsafe:
        raise ValueError("unsafe path in %s: %r" % (MANIFEST, sorted(unsafe)[0]))
    if present - listed:
        raise ValueError("file not in %s: %s" % (MANIFEST, sorted(present - listed)[0]))
    if listed - present:
        raise ValueError("file missing from the ZIP: %s" % sorted(listed - present)[0])
    for n in sorted(listed):
        data = zf.read(n)
        want = files[n]
        if len(data) != want["size"] or sha256_bytes(data) != want["sha256"]:
            raise ValueError("file damaged (size or SHA-256 differs): %s" % n)
    return man


def version_key(v):
    """sort key: 3.10.0 after 3.9.2, 3.4.0-rc1 before 3.4.0"""
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$", v or "")
    if not m:
        return (-1, -1, -1, 0, "")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), 0 if m.group(4) else 1, m.group(4) or "")


def app_dir(root):
    return os.path.join(root, "app")


def main_folder(folder):
    """the Slide Builder folder: `folder`, or the main folder when `folder` is an installed version (app\\<ver>\\: its
    tools\\update.py run without --root)"""
    up = os.path.dirname(folder)
    if (os.path.basename(up).lower() == "app" and VERSION_RE.match(os.path.basename(folder))
            and os.path.isfile(os.path.join(folder, MANIFEST))):
        return os.path.dirname(up)
    return folder


def pointer_file(root):
    return os.path.join(app_dir(root), "current.json")


def current_version(root):
    try:
        with open(pointer_file(root), encoding="utf-8") as f:
            v = json.load(f).get("version")
        return v if isinstance(v, str) and VERSION_RE.match(v) else None
    except (OSError, ValueError, AttributeError):
        return None


def installed_versions(root):
    d = app_dir(root)
    out = [n for n in (os.listdir(d) if os.path.isdir(d) else []) if VERSION_RE.match(n)
           and os.path.isfile(os.path.join(d, n, MANIFEST))]
    return sorted(out, key=version_key)


def retry_os(fn, *args, tries=6, delay=0.5):
    """an os call that Windows may refuse for a moment (antivirus scanning new files, a PC reading
    current.json while it starts): retried, then the last error is raised"""
    for i in range(tries):
        try:
            return fn(*args)
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(delay)


def pointer_info(root):
    try:
        with open(pointer_file(root), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def write_pointer(root, version, previous, held=False):
    """app/current.json, replaced atomically (a starting PC sees the old or the new one, never half). `held`: the
    version was chosen with --use over a newer one (a rollback) - a plain update does not move on from it."""
    d = {"version": version, "previous": previous, "at": datetime.datetime.now().isoformat(timespec="seconds"), "by": user()}
    if held:
        d["held"] = True
    data = json.dumps(d, indent=1) + "\n"
    tmp = pointer_file(root) + ".%d.update-tmp" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    try:
        retry_os(os.replace, tmp, pointer_file(root))
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise SystemExit("app\\current.json could not be replaced (%s) - the current version is unchanged. Try again." % e)


def check_installed(folder):
    """the files of an installed version still match its MANIFEST.json; returns the manifest"""
    with open(os.path.join(folder, MANIFEST), encoding="utf-8") as f:
        man = json.load(f)
    for n, meta in man["files"].items():
        p = os.path.join(folder, *n.split("/"))
        try:
            with open(p, "rb") as f:
                data = f.read()
        except OSError:
            raise ValueError("file missing: " + n)
        if len(data) != meta.get("size") or sha256_bytes(data) != meta.get("sha256"):
            raise ValueError("file changed since it was installed: " + n)
    return man


def selftest(root, folder):
    """the version in `folder` runs its own self-test against this folder's data (exit 0 = usable)"""
    env = dict(os.environ, SLIDEBUILDER_ROOT=root, SLIDEBUILDER_DATA=data_dir(root), PYTHONIOENCODING="ascii:replace")
    env.pop("SLIDEBUILDER_EXPORT", None)
    entry = os.path.join(program_dir(folder) or os.path.join(folder, "helper"), "slide_builder.py")
    try:
        r = subprocess.run([sys.executable, entry, "--selftest"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, errors="replace", env=env, cwd=os.path.dirname(entry), timeout=600)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, str(e)
    return r.returncode == 0, (r.stdout or "").strip()


def extract_release(root, zf, man):
    """app/<ver>.part -> app/<ver>; returns the folder. Leaves nothing behind when it fails."""
    ver = man["version"]
    final = os.path.join(app_dir(root), ver)
    part = final + ".part"
    if os.path.exists(part):
        remove_tree(part)                         # an earlier interrupted install
    os.makedirs(part)
    try:
        for n in sorted(man["files"]) + [MANIFEST]:
            dest = os.path.join(part, *n.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(zf.read(n))
        check_installed(part)                     # what is on the disk now, not only what was in the ZIP
        retry_os(os.rename, part, final)
    except BaseException:
        if os.path.exists(part):
            remove_tree(part)
        raise
    return final


LAUNCHERS = ("Start Slide Builder.bat", "Install Slide Builder.bat", "tools/update.py")
# start files a folder may lack (a folder that got its first version from a release ZIP, docs/next/cutover.md):
# added when missing, never replaced - "Update Slide Builder.bat" may be the file running this very update
MISSING_ONLY = ("Update Slide Builder.bat", "Start Slide Builder (v3).bat")


def update_launchers(root, folder, stamp):
    """the main folder's "Start Slide Builder.bat" and tools/update.py from the release (the start file must
    know app/current.json; so must "Install Slide Builder.bat"), and the start files the folder does not have yet
    (MISSING_ONLY). Returns what was done: ["updated <file>", "added <file>"]."""
    changed = []
    for n in LAUNCHERS + MISSING_ONLY:
        src = os.path.join(folder, *n.split("/"))
        dest = os.path.join(root, *n.split("/"))
        if not os.path.isfile(src) or (n in MISSING_ONLY and os.path.exists(dest)):
            continue
        with open(src, "rb") as f:
            new = f.read()
        existed = os.path.isfile(dest)
        if existed:
            with open(dest, "rb") as f:
                if f.read() == new:
                    continue
            backup_program_file(root, stamp, n)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".update-tmp"
        with open(tmp, "wb") as f:
            f.write(new)
        os.replace(tmp, dest)
        changed.append(("updated " if existed else "added ") + n)
    return changed


def prune_versions(root, keep_also):
    """keep the newest KEEP_VERSIONS versions and the ones in keep_also; the rest is removed when possible"""
    vers = installed_versions(root)
    keep = set(vers[-KEEP_VERSIONS:]) | {v for v in keep_also if v}
    threes = [v for v in vers if version_key(v)[0] == 3]
    if threes and any(version_key(v)[0] >= 4 for v in vers):
        # the newest 3.x stays while 4.x is installed: "Start Slide Builder (v3).bat" and --use 3.x (the rollback,
        # docs/next/cutover.md) need it, and a folder of releases has no 3.x program in backend\ to fall back to
        keep.add(threes[-1])
    removed = []
    for v in vers:
        if v not in keep:
            # renamed first: while a PC still runs from it Windows refuses the rename, and the version
            # stays whole (deleting file by file would leave half of it); removed at a later update
            try:
                os.rename(os.path.join(app_dir(root), v), os.path.join(app_dir(root), "%s.old-%s" % (v, uuid_hex())))
                removed.append(v)
            except OSError as e:
                say("  version %s stays for now - it is still in use (%s)" % (v, e))
    clear_leftovers(root)
    return removed


def uuid_hex():
    return uuid.uuid4().hex[:10]


def clear_leftovers(root):
    """versions renamed to <ver>.old-* and interrupted installs <ver>.part (no PC runs those)"""
    d = app_dir(root)
    for n in os.listdir(d) if os.path.isdir(d) else []:
        # only version folders: app/ also holds the browser app's sources in a git checkout
        if VERSION_RE.match(n.split(".old-")[0] if ".old-" in n else n[:-5] if n.endswith(".part") else ""):
            try:
                remove_tree(os.path.join(d, n))
            except OSError:
                pass


def activate(root, version, folder, stamp, fresh, held=False):
    """self-test the version, then point app/current.json at it. A fresh install that fails is removed."""
    say("Testing version %s with this folder's saved setups (read-only)..." % version)
    ok, out = selftest(root, folder)
    if not ok:
        tail = "\n".join("  " + x for x in out.splitlines()[-15:])
        say(tail)
        if fresh:                                 # out of the way at once (a rename), deleted when possible
            for _ in range(20):                   # Windows: the self-test's process may hold the folder a moment longer
                try:
                    os.rename(folder, folder + ".part")
                    break
                except OSError:
                    time.sleep(0.1)
            try:
                remove_tree(folder + ".part")
            except OSError:
                pass
        raise SystemExit("The self-test of version %s failed, so it is NOT used (nothing changed):\n%s" % (version, tail))
    say("  self-test passed.")
    info = pointer_info(root)
    previous = current_version(root)
    if previous == version:                       # the same version again: keep what came before it
        keep = info.get("previous")
        # still held when it was (the same --use again "to be sure" must not release a rollback)
        write_pointer(root, version, keep if isinstance(keep, str) and VERSION_RE.match(keep) else None,
                      held or bool(info.get("held")))
    else:
        write_pointer(root, version, previous, held)
    return previous


def install_release(root, data, stamp, want=None, digest=None):
    """install release ZIP bytes side by side and make it current. Returns (version, changed). `digest`: "sha256:<hex>"
    from GitHub's API, or a list of (where it came from, "sha256:<hex>") - each one must match; MANIFEST.json always."""
    for src, d in ([("GitHub's digest", digest)] if isinstance(digest, str) else digest or []):
        algo, _, hexd = d.partition(":")
        if algo.lower() != "sha256" or sha256_bytes(data) != hexd.lower():
            raise SystemExit("The download does not match GitHub's checksum (%s) - nothing was installed. Try again." % d)
        say("  checksum matches %s." % src)
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        man = verify_release(zf)
    except (zipfile.BadZipFile, ValueError) as e:
        raise SystemExit("This is not a valid Slide Builder release (%s) - nothing was installed." % e)
    ver = man["version"]
    if man.get("app") not in (None, "slide-builder"):
        raise SystemExit("This ZIP is not a Slide Builder release - nothing was installed.")
    if want and want != ver:
        raise SystemExit("Asked for version %s but the ZIP holds %s - nothing was installed." % (want, ver))
    say("  MANIFEST.json verified: version %s, %d files." % (ver, len(man["files"])))
    final = os.path.join(app_dir(root), ver)
    fresh = not os.path.isdir(final)
    if fresh:
        os.makedirs(app_dir(root), exist_ok=True)
        extract_release(root, zf, man)
        say("  installed into %s" % rel(root, final))
    else:
        try:
            check_installed(final)
        except (OSError, ValueError, KeyError) as e:
            raise SystemExit("%s exists but is damaged (%s). Delete that folder and run the update again." % (rel(root, final), e))
        say("  version %s is already installed in %s" % (ver, rel(root, final)))
    previous = activate(root, ver, final, stamp, fresh)
    launchers = update_launchers(root, final, stamp)
    for n in launchers:
        say("  " + n)
    removed = prune_versions(root, [ver, previous, pointer_info(root).get("previous")])
    if removed:
        say("  removed old version(s): " + ", ".join(removed))
    if previous == ver and not fresh:
        say("Version %s was already the current version." % ver)
        return ver, bool(launchers)
    say("Version %s is now the current version%s." % (ver, (" (was %s)" % previous) if previous and previous != ver else ""))
    return ver, True


def use_version(root, ver, stamp, yes=False):
    folder = os.path.join(app_dir(root), ver)
    if not VERSION_RE.match(ver or "") or not os.path.isdir(folder):
        have = installed_versions(root)
        raise SystemExit("Version %s is not installed. Installed: %s" % (ver, ", ".join(have) or "none"))
    try:
        check_installed(folder)
    except (OSError, ValueError, KeyError) as e:
        raise SystemExit("Version %s is damaged (%s) - not used. Install it again with --release %s." % (ver, e, ver))
    marked = format5_decks(root) if version_key(ver)[:3] < FORMAT5_SINCE else []
    marked6 = format5_decks(root, (FORMAT6_MARKER, FORMAT7_MARKER)) if FORMAT5_SINCE <= version_key(ver)[:3] < FORMAT6_SINCE else []
    marked7 = format5_decks(root, (FORMAT7_MARKER,)) if FORMAT6_SINCE <= version_key(ver)[:3] < FORMAT7_SINCE else []
    if marked7:
        # the same for 4.10's objects (format 7, B52): read-only in 4.9
        say("These %d deck(s) use Slide Builder 4.10 objects (reference lines, gap arrows or change pills on a chart). "
            "In version %s they open read-only:" % (len(marked7), ver))
        for wb in marked7:
            say("  " + wb)
        if not yes and not confirm("Use version %s anyway? [y/N] " % ver):
            raise SystemExit("Nothing was changed: version %s is not used." % ver)
    if marked6:
        # the same for 4.9's objects (format 6, AUDIT-3 COMPAT-1): read-only in 4.6-4.8
        say("These %d deck(s) use Slide Builder 4.9 objects (rows or columns deleted for a version, hidden rows or "
            "columns, cell alignment or number formats). In version %s they open read-only:" % (len(marked6), ver))
        for wb in marked6:
            say("  " + wb)
        if not yes and not confirm("Use version %s anyway? [y/N] " % ver):
            raise SystemExit("Nothing was changed: version %s is not used." % ver)
    if marked:
        # ADR-019 (rule c): those decks hold Slide Builder 4.6 objects - read-only below 4.6, and Slide Builder 3 drops them
        say("These %d deck(s) use Slide Builder 4.6 objects (charts, callouts, free layout, looks, cell gridlines or borders, "
            "new slides, hidden slides...). In version %s they open read-only%s:"
            % (len(marked), ver, "" if version_key(ver)[0] >= 4 else " and going back to Slide Builder 3 loses those objects"))
        for wb in marked:
            say("  " + wb)
        if not yes and not confirm("Use version %s anyway? [y/N] " % ver):
            raise SystemExit("Nothing was changed: version %s is not used." % ver)
    if version_key(ver)[0] < 4 and decks_owned(root):
        # back to Slide Builder 3 (04 §4.4, global rollback): every deck first, with the 4.x program still in use
        say("Giving every deck back to Slide Builder 3 first...")
        if not rollback_decks(root, ""):
            raise SystemExit("Some decks could not be given back to Slide Builder 3 (above): version %s is NOT used. "
                             "Close them everywhere (Options › Administration › Prepare rollback), then try again." % ver)
    cur = current_version(root)
    previous = activate(root, ver, folder, stamp, False, held=bool(cur) and version_key(ver) < version_key(cur))
    if previous == ver:
        say("Version %s was already the current version." % ver)
        return ver, False
    say("Version %s is now the current version%s." % (ver, (" (was %s)" % previous) if previous else ""))
    return ver, True


FORMAT5_SINCE = (4, 6, 0)            # the first version that reads decks raised to format 5 (ADR-019)
FORMAT5_MARKER = "incident-format-5.json"
FORMAT6_SINCE = (4, 9, 0)            # the first version that reads decks raised to format 6 (ADR-019 amendment 2026-10-22)
FORMAT6_MARKER = "incident-format-6.json"
FORMAT7_SINCE = (4, 10, 0)           # the first version that reads decks raised to format 7 (ADR-019 amendment for B52)
FORMAT7_MARKER = "incident-format-7.json"


def format5_decks(root, markers=(FORMAT5_MARKER, FORMAT6_MARKER, FORMAT7_MARKER)):
    """the workbooks whose decks hold Slide Builder 4.6 objects (their folder has the marker, or the format-6 / format-7
    one: a deck may go from 4 to 6 or 7 at once; a deck given back to Slide Builder 3 does not count), sorted. `markers`
    (FORMAT6_MARKER, FORMAT7_MARKER): the decks that hold 4.9 objects or later; (FORMAT7_MARKER,): 4.10 objects"""
    folder = os.path.join(data_dir(root), "v4", "decks")
    out = []
    for key in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        d = os.path.join(folder, key)
        if not any(os.path.isfile(os.path.join(d, m)) for m in markers) or os.path.isfile(os.path.join(d, "rolled-back.json")):
            continue
        try:
            with open(os.path.join(d, "snapshot.json"), "rb") as f:
                wb = json.loads(f.read().decode("utf-8-sig")).get("workbook")
        except (OSError, ValueError, AttributeError):
            wb = None
        out.append(wb if isinstance(wb, str) and wb else key)
    return sorted(out, key=lambda s: s.lower())


def confirm(question):
    """True for y / yes (s / si: an Italian keyboard habit); no answer possible (no console) is a no"""
    try:
        return input(question).strip().lower() in ("y", "yes", "s", "si", "sì")
    except (EOFError, KeyboardInterrupt):
        return False


GITHUB_WEB = "https://github.com"
ASSET = "slidebuilder-%s.zip"       # the release's ZIP: tools/make_release.py, .github/workflows/release.yml (+ ".sha256")


def no_release(owner, name, why):
    return SystemExit("GitHub has no published release of %s/%s (%s). Nothing was changed." % (owner, name, why))


def find_release_web(owner, name, want, web_base):
    """the web pages, not the API (no 60-an-hour limit): github.com/<o>/<r>/releases/latest redirects to
    .../releases/tag/v<ver>; the ZIP is .../releases/download/v<ver>/slidebuilder-<ver>.zip, its sha256sum next to it"""
    web = "%s/%s/%s/releases" % (web_base.rstrip("/"), owner, name)
    if want in (None, "latest"):
        try:
            status, headers, _ = http_request(web + "/latest", follow=False)
        except NetError as e:
            if e.status == 404:
                raise no_release(owner, name, "%s/latest is not there" % web)
            raise
        loc = (headers.get("Location") or "") if 300 <= status < 400 else ""
        m = re.search(r"/releases/tag/v([^/?#]+)/?$", loc)
        if not m:
            if re.search(r"/releases/?$", loc):         # what GitHub answers while there is no release at all
                raise no_release(owner, name, "%s/latest leads to the empty list" % web)
            raise NetError("%s/latest answered %d %s instead of the newest release's address." % (web, status, loc or "(no Location)"))
        ver = urllib.parse.unquote(m.group(1))
        if not VERSION_RE.match(ver):
            raise SystemExit("The newest release on GitHub has an unexpected tag: v%s. Nothing was changed." % ver)
    else:
        ver = want
        try:
            http_request("%s/tag/v%s" % (web, ver), follow=False)
        except NetError as e:
            if e.status == 404:
                raise no_release(owner, name, "there is no release v%s" % ver)
            raise
    url = "%s/download/v%s/%s" % (web, ver, ASSET % ver)
    return ver, url, None, url + ".sha256"


def find_release_api(owner, name, want, api_base, retries=True):
    base = (api_base or "https://api.github.com/repos/%s/%s" % (owner, name)).rstrip("/")
    url = base + ("/releases/latest" if want in (None, "latest") else "/releases/tags/v" + want)
    try:
        rel_ = json.loads(http_get(url, retries=retries).decode("utf-8"))
    except NetError as e:
        if e.status == 404:
            raise no_release(owner, name, "GitHub's API knows no %s" % ("latest release" if want in (None, "latest") else "release v" + want))
        raise
    except ValueError:
        raise SystemExit("GitHub's answer about the release could not be read.")
    assets = [x for x in rel_.get("assets") or [] if re.match(r"^slidebuilder-.+\.zip$", x.get("name", ""))]
    if not assets:
        raise SystemExit("Release %s has no slidebuilder-<version>.zip." % rel_.get("tag_name", want))
    a = assets[0]
    ver = a["name"][len("slidebuilder-"):-len(".zip")]
    if not VERSION_RE.match(ver):
        raise SystemExit("Release asset with an unexpected name: " + a["name"])
    return ver, a["browser_download_url"], a.get("digest"), None


def find_release(repo, want, api_base=None, web_base=None):
    """(version, download url, API digest or None, URL of the .sha256 file or None) of a GitHub release ("latest" or
    X.Y.Z). The web pages first (they do not use up the office's 60 API requests an hour); the API when they fail.
    --api-url alone (the tests' file:// "API") asks only the API."""
    owner, name = parse_repo(repo)
    if web_base or not api_base:
        try:
            return find_release_web(owner, name, want, web_base or GITHUB_WEB)
        except NetError as e:
            say("  The release page did not answer (%s) - asking GitHub's API instead." % e)
    return find_release_api(owner, name, want, api_base)


def release_checksums(found, repo, api_base=None, web_base=None):
    """the checksums to compare the download with: the API's digest if the API was asked, else the release's .sha256
    file (written by release.yml) and, as an extra, the API's digest when the API answers. None of them is required -
    MANIFEST.json inside the ZIP is always checked."""
    ver, _url, digest, sums_url = found
    out = [("GitHub's digest", digest)] if digest else []
    if sums_url:
        try:
            m = re.match(r"\s*([0-9a-fA-F]{64})\b", http_get(sums_url).decode("ascii", "replace"))
            if m:
                out.append(("the release's .sha256 file", "sha256:" + m.group(1)))
        except NetError as e:
            say("  (no .sha256 file with the release: %s)" % e)
        if web_base is None or api_base:            # the tests' fake web without a fake API: never the real API
            try:
                # not retried: the download is already here, and 2+4+8 s of waiting for an extra check is not worth it
                d = find_release_api(*(parse_repo(repo) + (ver, api_base)), retries=False)[2]
                if d:
                    out.append(("GitHub's digest", d))
            except SystemExit as e:                 # rate limit, no network: only an extra check
                say("  (GitHub's API did not answer, its checksum is skipped: %s)" % e)
    return out


def not_newer(root, ver, want):
    """the sentence to show when release `ver` is not newer than this folder's current version, else None. Asked for
    the newest release, an older one is never installed over a newer version (a ZIP installed by hand)."""
    cur = current_version(root)
    if not cur or not os.path.isdir(os.path.join(app_dir(root), cur)):
        return None
    latest = want in (None, "latest")
    if cur == ver:
        return "Already up to date (version %s)%s" % (ver, (": this folder runs %s and the newest release on GitHub is %s - "
                                                            "there is no newer one." % (cur, ver)) if latest else ".")
    if latest and version_key(ver) < version_key(cur):
        return ("No newer release: this folder runs version %s, which is newer than the newest release on GitHub (%s). "
                "Nothing was changed." % (cur, ver))
    return None


def release_mode(root, a, stamp, found=None):
    """--release / --zip <file> / --use; returns (changed, ok)"""
    if a.use:
        return use_version(root, a.use, stamp, a.yes)[1], True
    if isinstance(a.zip, str):
        say("Installing %s (offline)..." % a.zip)
        try:
            with open(a.zip, "rb") as f:
                data = f.read()
        except OSError as e:
            raise SystemExit("Cannot read %s: %s" % (a.zip, e))
        return install_release(root, data, stamp)[1], True
    repo = a.repo or DEFAULT_REPO
    found = found or find_release(repo, a.release, a.api_url, a.web_url)
    ver, url = found[:2]
    msg = not_newer(root, ver, a.release)        # again under the lock: somebody else may have just updated
    if msg:
        say(msg)
        return False, True
    say("Downloading version %s from %s ..." % (ver, url))
    data = http_get(url, timeout=300)
    return install_release(root, data, stamp, want=ver, digest=release_checksums(found, repo, a.api_url, a.web_url))[1], True


# --------------------------------------------------------------------------- decks: v3 <-> v4 (docs/next/04 §4)
def current_program(root):
    """the program folder of the version in use (app\\current.json, else the main folder's helper\\)"""
    ver = current_version(root)
    folder = os.path.join(app_dir(root), ver) if ver and os.path.isdir(os.path.join(app_dir(root), ver)) else root
    return program_dir(folder)


DECKS_CODE = r"""
import json, os, sys
os.environ["SLIDEBUILDER_ROOT"], os.environ["SLIDEBUILDER_DATA"] = sys.argv[1], sys.argv[2]
sys.path.insert(0, sys.argv[3])
from slidebuilder import migrate_v3
what, arg = sys.argv[4], sys.argv[5]
if what == "migrate":
    res = migrate_v3.migrate_all()
elif arg:
    try:
        res = {"done": [arg] if migrate_v3.rollback(arg) == "rolled back" else [], "refused": []}
    except Exception as e:
        res = {"done": [], "refused": [[arg, str(e)]]}
else:
    res = migrate_v3.rollback_all()
print(json.dumps(res))
"""


def decks_job(root, what, arg=""):
    """migrate every v3 deck, or roll decks back, with the version in use (its slidebuilder.migrate_v3)"""
    prog = current_program(root)
    if not prog or not os.path.isfile(os.path.join(prog, "slidebuilder", "migrate_v3.py")):
        say("The version in use is Slide Builder 3: there is nothing to %s." % ("migrate" if what == "migrate" else "roll back"))
        return None
    r = subprocess.run([sys.executable, "-c", DECKS_CODE, root, data_dir(root), prog, what, arg or ""], stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, universal_newlines=True, errors="replace")
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        say("Could not run it: " + (r.stderr or r.stdout).strip()[-600:])
        return None


def decks_owned(root):
    """Slide Builder 4 owns at least one deck of this folder (one not rolled back)"""
    folder = os.path.join(data_dir(root), "v4", "decks")
    for key in os.listdir(folder) if os.path.isdir(folder) else []:
        d = os.path.join(folder, key)
        if os.path.isfile(os.path.join(d, "snapshot.json")) and not os.path.isfile(os.path.join(d, "rolled-back.json")):
            return True
    return False


def migrate_all_decks(root):
    res = decks_job(root, "migrate")
    if res is None:
        return False
    say("Moved to Slide Builder 4: %d deck(s)%s" % (len(res["migrated"]), (": " + ", ".join(res["migrated"])) if res["migrated"] else ""))
    for wb, why in res["skipped"]:
        say("  skipped %s - %s; run --migrate-all again later (or it moves when opened in Slide Builder 4)" % (wb, why))
    for wb, why in res["failed"]:
        say("  NOT moved %s - %s" % (wb, why))
    return not res["failed"]


def rollback_decks(root, name):
    res = decks_job(root, "rollback", name)
    if res is None:
        return False
    say("Given back to Slide Builder 3: %d deck(s)%s" % (len(res["done"]), (": " + ", ".join(res["done"])) if res["done"] else ""))
    for key, why in res["refused"]:
        say("  NOT rolled back %s - %s" % (key, why))
    return not res["refused"]


# --------------------------------------------------------------------------- after the update
def verify_saved(root):
    """open every saved deck with the NEW program files (a fresh Python), so a format problem shows now"""
    code = r"""
import json, os, sys
sys.path.insert(0, sys.argv[2])
d = os.path.join(sys.argv[1], "backend", "data", "workbooks")
ok, bad = 0, []
for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
    if not f.endswith(".json"):
        continue
    try:
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            doc = json.load(fh)
        if not isinstance(doc, dict):
            raise ValueError("not a document")
        if doc.get("movedTo") == "v4":          # a deck Slide Builder 4 owns: counted below, with its snapshot
            continue
        from slidebuilder import upgrade
        upgrade.upgrade("workbook", doc)
        ok += 1
    except Exception as e:
        bad.append("%s: %s" % (f, e))
dd = os.path.join(sys.argv[1], "backend", "data", "v4", "decks")
for k in sorted(os.listdir(dd)) if os.path.isdir(dd) else []:
    p = os.path.join(dd, k, "snapshot.json")
    if not os.path.isfile(p):
        continue
    try:
        with open(p, encoding="utf-8") as fh:
            snap = json.load(fh)
        if not isinstance(snap, dict) or not isinstance(snap.get("doc"), dict):
            raise ValueError("not a snapshot")
        ok += 1
    except Exception as e:
        bad.append("v4/decks/%s: %s" % (k, e))
print(json.dumps({"ok": ok, "bad": bad}))
"""
    r = subprocess.run([sys.executable, "-c", code, root, program_dir(root) or os.path.join(root, "helper")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    try:
        res = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        say("Could not check the saved decks: " + (r.stderr or r.stdout).strip()[-400:])
        return False
    if res["bad"]:
        say("WARNING – these saved decks could not be read by the new version (the copies before the update are kept):")
        for b in res["bad"]:
            say("  " + b)
        return False
    say("Saved setups checked: %d deck(s) open fine with the new version." % res["ok"])
    return True


def nested_copy(root):
    """a second copy made by `git clone` inside the folder (git clone always creates a new folder)"""
    out = []
    for name in os.listdir(root):
        p = os.path.join(root, name)
        if os.path.isdir(os.path.join(p, ".git")) and program_dir(p):
            out.append(p)
    return out


def remove_tree(path):
    def onerror(func, p, _exc):      # .git objects are read-only on Windows
        os.chmod(p, stat.S_IWRITE); func(p)
    shutil.rmtree(path, onerror=onerror)


def handle_nested(root, yes):
    for p in nested_copy(root):
        has_data = os.path.isdir(os.path.join(p, "backend", "data", "workbooks")) and os.listdir(os.path.join(p, "backend", "data", "workbooks"))
        say("\nNote: %r is a second copy of Slide Builder (made by git clone). It is not used." % os.path.basename(p))
        if has_data:
            say("  It contains saved decks, so it is left alone – move what you need, then delete it.")
            continue
        ans = "y" if yes else input("  Delete it now? It holds no saved work. [y/N] ").strip().lower()
        if ans in ("y", "yes", "s", "si", "sì"):
            remove_tree(p); say("  Deleted.")


# --------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description="Update Slide Builder from GitHub; saved setups are never touched.")
    ap.add_argument("--repo", default=None, help="GitHub repository (default: the connected one, else %s)" % DEFAULT_REPO)
    ap.add_argument("--branch", default=None, help="branch to follow (default: the one followed so far, else GitHub's default)")
    ap.add_argument("--check", action="store_true", help="only report whether an update is available")
    ap.add_argument("--zip", nargs="?", const=True, default=False, metavar="FILE",
                    help="without FILE: download a ZIP even if git is installed; with FILE: install that release ZIP (offline)")
    ap.add_argument("--release", nargs="?", const="latest", default=None, metavar="VERSION",
                    help="install a GitHub release side by side: latest (default) or X.Y.Z")
    ap.add_argument("--use", default=None, metavar="VERSION", help="make an installed version the current one (roll back)")
    ap.add_argument("--migrate-all", action="store_true", help="move every Slide Builder 3 deck to Slide Builder 4 now (each under its lock)")
    ap.add_argument("--rollback", nargs="?", const="", default=None, metavar="WORKBOOK",
                    help="give WORKBOOK's deck (or, without a name, every deck) back to Slide Builder 3; refused for a deck with "
                         "changes past its snapshot (Options › Administration › Prepare rollback first)")
    ap.add_argument("--api-url", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--web-url", default=None, help=argparse.SUPPRESS)       # tests: a fake https://github.com
    ap.add_argument("--zip-url", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--root", default=None, metavar="FOLDER", help="the Slide Builder folder (default: the one this updater belongs to)")
    ap.add_argument("--yes", action="store_true", help="do not ask questions")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root or main_folder(ROOT))
    say("Slide Builder update - folder: " + root)
    if a.migrate_all or a.rollback is not None:            # decks only: no program file changes
        with UpdateLock(root):
            ok = migrate_all_decks(root) if a.migrate_all else rollback_decks(root, a.rollback)
        return 0 if ok else 2
    if current_version(root) and not (a.release or a.use or isinstance(a.zip, str) or a.branch or a.zip):
        # this folder runs side-by-side versions (app\current.json): updating helper\ would change nothing
        if pointer_info(root).get("held"):
            raise SystemExit("Version %s was chosen with --use over a newer version (a rollback): a plain update would install the "
                             "newest release and undo it, so nothing was changed. To go forward: --release X.Y.Z or --use X.Y.Z "
                             "(docs/next/cutover.md)." % current_version(root))
        say("This folder uses side-by-side versions (app\\current.json, now %s): looking for the newest release." % current_version(root))
        a.release = "latest"
    if a.release or a.use or isinstance(a.zip, str):
        if a.check and (a.use or isinstance(a.zip, str)):
            raise SystemExit("--check works with --release only")
        found = None
        if not (a.use or isinstance(a.zip, str)):
            # asked before the lock and the backup: "nothing newer" and "GitHub does not answer" change nothing at all
            # (a backup per run would push the useful ones out - only the last 5 are kept)
            found = find_release(a.repo or DEFAULT_REPO, a.release, a.api_url, a.web_url)
            msg = not_newer(root, found[0], a.release)
            if msg:
                say(msg)
                return 0
            if a.check:
                cur = current_version(root)
                if cur and version_key(found[0]) < version_key(cur):
                    say("Version %s is older than the current %s; it would be installed only because you named it."
                        % (found[0], cur))
                else:
                    say("An update is available: %s -> %s." % (cur or "none", found[0]))
                return 0
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        with UpdateLock(root):
            dst, n = backup_saved(root, stamp)
            if n:
                say("Saved setups copied to %s (%d files)." % (rel(root, dst), n))
            changed, ok = release_mode(root, a, stamp, found)
        if changed:
            say("\nDone. Everybody who has Slide Builder open: close its black window and start it again.")
        return 0 if ok else 2
    use_git = bool(git_exe()) and not a.zip
    repo = a.repo
    if not repo and use_git and os.path.isdir(os.path.join(root, ".git")):
        repo = git(root, "remote", "get-url", "origin", check=False, quiet=True).stdout.strip() or None
    repo = repo or DEFAULT_REPO
    if a.check:
        update_with_git(root, repo, a.branch, "", True) if use_git else update_with_zip(root, repo, a.branch, "", True, a.zip_url)
        return 0
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    with UpdateLock(root):
        dst, n = backup_saved(root, stamp)
        if n:
            say("Saved setups copied to %s (%d files)." % (rel(root, dst), n))
        changed = update_with_git(root, repo, a.branch, stamp, False) if use_git else update_with_zip(root, repo, a.branch, stamp, False, a.zip_url)
        ok = verify_saved(root)
    handle_nested(root, a.yes)
    if changed:
        say("\nDone. Everybody who has Slide Builder open: close its black window, start it again and reload the page.")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
