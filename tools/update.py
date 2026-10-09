"""Update Slide Builder from GitHub without touching anybody's saved work.

    python tools/update.py            connect this folder to GitHub (first time) or update it
    python tools/update.py --check    only say whether an update is available
    python tools/update.py --branch main      follow another branch from now on
    python tools/update.py --release [latest|X.Y.Z]   install a GitHub release side by side (app\\<ver>\\)
    python tools/update.py --use X.Y.Z        go back (or forward) to an installed version
    python tools/update.py --zip <file.zip>   install a release ZIP without internet

What is never changed – it is not part of the repository (see .gitignore):
    backend/data/        decks, cell edits, deck styles, defaults, user preferences, backups
    backend/logo*.*      logos, slide_builder_settings*.txt (v2 settings)
    *.xlsx …             the workbooks          export/  engine/

How it updates
  * with git on the PC: the folder itself becomes the git working copy ("connected"), in place – no
    second "slidemaster" folder. The first run runs `git init` + `fetch` + a forced checkout, which writes
    only the program files; later runs fetch and move to the newest version. Program files you changed
    by hand are copied to the backup folder first. Nothing untracked is ever deleted (no `git clean`).
  * without git: the newest version is downloaded as a ZIP and the program files are copied over,
    again skipping everything listed above.

Side-by-side releases (--release, --zip <file>, --use)
  * a release ZIP (tools/make_release.py) is checked against GitHub's SHA-256 "digest" of the asset when
    the API gives one, and always against the MANIFEST.json inside it;
  * it is extracted to app\\<ver>.part\\ and renamed to app\\<ver>\\ only when complete, so an interrupted
    install leaves nothing that looks installed;
  * the new version's `slide_builder.py --selftest` must pass (it reads every saved setup without writing,
    and checks the data folder accepts create, rename and delete) before app\\current.json is replaced
    (atomically) - "Start Slide Builder.bat" starts the version named there, else backend\\ as before;
  * the last 3 versions stay (plus the current one), so --use can go back at once. The data folder is
    shared by all versions and is never written by the install, only backed up.

Before every update the saved setups are copied to backend/data/backups/before-update-<time>/ (the last
5 are kept), and afterwards every saved deck is checked with the new program files. Only one person
can update the shared folder at a time (lock file). People who have Slide Builder open restart it
afterwards (close the black window, start it again) and reload the browser tab.
"""
import argparse
import datetime
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


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "SlideBuilder-updater"})
    for wait in (0, 2, 4, 8):
        if wait:
            say("  network problem, retrying in %d s…" % wait); time.sleep(wait)
        try:
            # the Windows proxy settings, and the Windows certificate store (a company root CA is trusted)
            with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
                return r.read()
        except Exception as e:        # noqa: BLE001 – report the last error
            last = e
    raise SystemExit("Could not download %s: %s" % (url, last))


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
CORE_FILES = ("backend/slide_builder.py",)


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
    missing_core = [c for c in CORE_FILES if c not in files]
    if missing_core:
        raise ValueError("the release has no %s" % missing_core[0])
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


def write_pointer(root, version, previous):
    """app/current.json, replaced atomically (a starting PC sees the old or the new one, never half)"""
    data = json.dumps({"version": version, "previous": previous, "at": datetime.datetime.now().isoformat(timespec="seconds"),
                       "by": user()}, indent=1) + "\n"
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
    entry = os.path.join(folder, "backend", "slide_builder.py")
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


def update_launchers(root, folder, stamp):
    """the main folder's "Start Slide Builder.bat" and tools/update.py from the release (the start file must
    know app/current.json). "Update Slide Builder.bat" is running right now, so it is left alone."""
    changed = []
    for n in ("Start Slide Builder.bat", "tools/update.py"):
        src = os.path.join(folder, *n.split("/"))
        dest = os.path.join(root, *n.split("/"))
        if not os.path.isfile(src):
            continue
        with open(src, "rb") as f:
            new = f.read()
        if os.path.isfile(dest):
            with open(dest, "rb") as f:
                if f.read() == new:
                    continue
            backup_program_file(root, stamp, n)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".update-tmp"
        with open(tmp, "wb") as f:
            f.write(new)
        os.replace(tmp, dest)
        changed.append(n)
    return changed


def prune_versions(root, keep_also):
    """keep the newest KEEP_VERSIONS versions and the ones in keep_also; the rest is removed when possible"""
    vers = installed_versions(root)
    keep = set(vers[-KEEP_VERSIONS:]) | {v for v in keep_also if v}
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


def activate(root, version, folder, stamp, fresh):
    """self-test the version, then point app/current.json at it. A fresh install that fails is removed."""
    say("Testing version %s with this folder's saved setups (read-only)..." % version)
    ok, out = selftest(root, folder)
    if not ok:
        tail = "\n".join("  " + x for x in out.splitlines()[-15:])
        say(tail)
        if fresh:                                 # out of the way at once (a rename), deleted when possible
            try:
                os.rename(folder, folder + ".part")
                remove_tree(folder + ".part")
            except OSError:
                pass
        raise SystemExit("The self-test of version %s failed, so it is NOT used (nothing changed):\n%s" % (version, tail))
    say("  self-test passed.")
    info = pointer_info(root)
    previous = current_version(root)
    if previous == version:                       # the same version again: keep what came before it
        keep = info.get("previous")
        write_pointer(root, version, keep if isinstance(keep, str) and VERSION_RE.match(keep) else None)
    else:
        write_pointer(root, version, previous)
    return previous


def install_release(root, data, stamp, want=None, digest=None):
    """install release ZIP bytes side by side and make it current. Returns (version, changed)."""
    if digest:
        algo, _, hexd = digest.partition(":")
        if algo.lower() != "sha256" or sha256_bytes(data) != hexd.lower():
            raise SystemExit("The download does not match GitHub's checksum (%s) - nothing was installed. Try again." % digest)
        say("  checksum matches GitHub's digest.")
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
        say("  updated %s" % n)
    removed = prune_versions(root, [ver, previous, pointer_info(root).get("previous")])
    if removed:
        say("  removed old version(s): " + ", ".join(removed))
    if previous == ver and not fresh:
        say("Version %s was already the current version." % ver)
        return ver, bool(launchers)
    say("Version %s is now the current version%s." % (ver, (" (was %s)" % previous) if previous and previous != ver else ""))
    return ver, True


def use_version(root, ver, stamp):
    folder = os.path.join(app_dir(root), ver)
    if not VERSION_RE.match(ver or "") or not os.path.isdir(folder):
        have = installed_versions(root)
        raise SystemExit("Version %s is not installed. Installed: %s" % (ver, ", ".join(have) or "none"))
    try:
        check_installed(folder)
    except (OSError, ValueError, KeyError) as e:
        raise SystemExit("Version %s is damaged (%s) - not used. Install it again with --release %s." % (ver, e, ver))
    previous = activate(root, ver, folder, stamp, False)
    if previous == ver:
        say("Version %s was already the current version." % ver)
        return ver, False
    say("Version %s is now the current version%s." % (ver, (" (was %s)" % previous) if previous else ""))
    return ver, True


def find_release(repo, want, api_base=None):
    """(version, download url, digest or None) of a GitHub release ("latest" or X.Y.Z)"""
    owner, name = parse_repo(repo)
    base = (api_base or "https://api.github.com/repos/%s/%s" % (owner, name)).rstrip("/")
    url = base + ("/releases/latest" if want in (None, "latest") else "/releases/tags/v" + want)
    try:
        rel_ = json.loads(http_get(url).decode("utf-8"))
    except ValueError:
        raise SystemExit("GitHub's answer about the release could not be read.")
    assets = [x for x in rel_.get("assets") or [] if re.match(r"^slidebuilder-.+\.zip$", x.get("name", ""))]
    if not assets:
        raise SystemExit("Release %s has no slidebuilder-<version>.zip." % rel_.get("tag_name", want))
    a = assets[0]
    ver = a["name"][len("slidebuilder-"):-len(".zip")]
    if not VERSION_RE.match(ver):
        raise SystemExit("Release asset with an unexpected name: " + a["name"])
    return ver, a["browser_download_url"], a.get("digest")


def release_mode(root, a, stamp):
    """--release / --zip <file> / --use; returns (changed, ok)"""
    if a.use:
        return use_version(root, a.use, stamp)[1], True
    if isinstance(a.zip, str):
        say("Installing %s (offline)..." % a.zip)
        try:
            with open(a.zip, "rb") as f:
                data = f.read()
        except OSError as e:
            raise SystemExit("Cannot read %s: %s" % (a.zip, e))
        return install_release(root, data, stamp)[1], True
    ver, url, digest = find_release(a.repo or DEFAULT_REPO, a.release, a.api_url)
    if current_version(root) == ver and os.path.isdir(os.path.join(app_dir(root), ver)):
        say("Already up to date (version %s)." % ver)
        return False, True
    say("Downloading version %s..." % ver)
    return install_release(root, http_get(url, timeout=300), stamp, want=ver, digest=digest)[1], True


# --------------------------------------------------------------------------- after the update
def verify_saved(root):
    """open every saved deck with the NEW program files (a fresh Python), so a format problem shows now"""
    code = r"""
import json, os, sys
sys.path.insert(0, os.path.join(sys.argv[1], "backend"))
from slidebuilder import ops
d = os.path.join(sys.argv[1], "backend", "data", "workbooks")
ok, bad = 0, []
for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
    if not f.endswith(".json"):
        continue
    try:
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            doc = json.load(fh)
        ops.apply_ops(doc, [], None, 0)
        ok += 1
    except Exception as e:
        bad.append("%s: %s" % (f, e))
print(json.dumps({"ok": ok, "bad": bad}))
"""
    r = subprocess.run([sys.executable, "-c", code, root], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
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
        if os.path.isdir(os.path.join(p, ".git")) and os.path.isfile(os.path.join(p, "backend", "slide_builder.py")):
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
    ap.add_argument("--api-url", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--zip-url", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)
    ap.add_argument("--yes", action="store_true", help="do not ask questions")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    say("Slide Builder update - folder: " + root)
    if current_version(root) and not (a.release or a.use or isinstance(a.zip, str) or a.branch or a.zip):
        # this folder runs side-by-side versions (app\current.json): updating backend\ would change nothing
        say("This folder uses side-by-side versions (app\\current.json, now %s): looking for the newest release." % current_version(root))
        a.release = "latest"
    if a.release or a.use or isinstance(a.zip, str):
        if a.check:
            if a.use or isinstance(a.zip, str):
                raise SystemExit("--check works with --release only")
            ver, _url, _d = find_release(a.repo or DEFAULT_REPO, a.release, a.api_url)
            cur = current_version(root)
            say("Already up to date (version %s)." % ver if cur == ver else "An update is available: %s -> %s." % (cur or "none", ver))
            return 0
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        with UpdateLock(root):
            dst, n = backup_saved(root, stamp)
            if n:
                say("Saved setups copied to %s (%d files)." % (rel(root, dst), n))
            changed, ok = release_mode(root, a, stamp)
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
