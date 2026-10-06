"""Update Slide Builder from GitHub without touching anybody's saved work.

    python tools/update.py            connect this folder to GitHub (first time) or update it
    python tools/update.py --check    only say whether an update is available
    python tools/update.py --branch main      follow another branch from now on

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
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_REPO = "https://github.com/gualbertol123/slidemaster.git"
LOCK_STALE_S = 30 * 60
KEEP_BACKUPS = 5

# never written by the ZIP update (git never touches them either: they are not in the repository)
PROTECTED_DIRS = ("backend/data/", "export/", "engine/", ".git/", "slidemaster/")
PROTECTED_RE = re.compile(r"(^|/)(~\$[^/]*|[^/]*\.(xlsx|xlsm|xlsb|xls))$|^backend/(logo[^/]*|slide_builder_settings[^/]*)$", re.I)


def say(msg=""):
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
            with urllib.request.urlopen(req, timeout=timeout) as r:     # uses the Windows proxy settings
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
    ap.add_argument("--zip", action="store_true", help="download a ZIP even if git is installed")
    ap.add_argument("--zip-url", default=None, help=argparse.SUPPRESS)
    ap.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)
    ap.add_argument("--yes", action="store_true", help="do not ask questions")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    say("Slide Builder update – folder: " + root)
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
