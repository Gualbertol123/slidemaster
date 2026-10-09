"""Build (or check) the release ZIP of Slide Builder. Python 3.8+, standard library only.

    python tools/make_release.py                    run the tests, then write dist/slidebuilder-<ver>.zip
    python tools/make_release.py --no-tests         only assemble the ZIP (CI runs the tests in their own jobs)
    python tools/make_release.py --version 3.4.0-rc1    a test version (must start with the program's version)
    python tools/make_release.py --verify <zip>     re-hash every file against its MANIFEST.json (exit 1 if not)
    python tools/make_release.py --notes 3.4.0      print that version's CHANGELOG.md section (release text)

The ZIP holds what a shared folder needs to run one version side by side with others (app\\<ver>\\):
    backend/**            the helper and the built page (backend/slide_builder.html), without data/,
                          tests/, __pycache__ and anything that belongs to a user (logo, v2 settings)
    tools/update.py       the updater
    *.bat  README.md      the launchers and the guide (CHANGELOG.md when present)
    MANIFEST.json         {"app", "version", "commit", "files": {path: {"sha256", "size"}}}

The ZIP is reproducible: files in sorted order, fixed timestamps, no build time in the manifest.
The page is NOT built here (that needs Node): run `npm run build` (root or app/) first.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = "slide-builder"
ZIP_TIME = (1980, 1, 1, 0, 0, 0)

_spec = importlib.util.spec_from_file_location("sb_update", os.path.join(os.path.dirname(os.path.abspath(__file__)), "update.py"))
update = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(update)

ROOT_FILES = ("Start Slide Builder.bat", "Update Slide Builder.bat", "Install Slide Builder.bat", "README.md", "CHANGELOG.md",
              "tools/update.py", "tools/fieldcheck.html")
SKIP_DIRS = {"data", "tests", "__pycache__", "engine", "export", "node_modules"}      # directly below backend/
SKIP_FILE = re.compile(r"(\.pyc$|\.pyo$|\.update-tmp$|^logo[^/]*$|^slide_builder_settings|^~\$|\.(xlsx|xlsm|xlsb|xls)$|^\.)", re.I)
REQUIRED = ("backend/slide_builder.py", "backend/slide_builder.html", "backend/slidebuilder/__init__.py", "tools/update.py",
            "Start Slide Builder.bat")


def say(msg=""):
    """print that never fails on a cp1252 / ASCII console"""
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        msg.encode(enc)
    except (UnicodeEncodeError, LookupError):
        msg = msg.encode("ascii", "replace").decode("ascii")
    print(msg, flush=True)


def program_version(root):
    with open(os.path.join(root, "backend", "slidebuilder", "__init__.py"), encoding="utf-8") as f:
        m = re.search(r'^VERSION\s*=\s*"([^"]+)"', f.read(), re.M)
    if not m:
        raise SystemExit("backend/slidebuilder/__init__.py has no VERSION")
    return m.group(1)


def _git(root, *args):
    """stdout of a git command in `root`, or None when git or the repository is missing"""
    try:
        r = subprocess.run(["git", "-C", root] + list(args), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    return r.stdout if r.returncode == 0 else None


def git_commit(root):
    """HEAD, with "-dirty" when shipped files differ from it (a local build of uncommitted work)"""
    head = _git(root, "rev-parse", "HEAD")
    if not head:
        return None
    dirty = _git(root, "status", "--porcelain", "--untracked-files=no", "--", "backend", *ROOT_FILES)
    return head.decode().strip() + ("-dirty" if dirty and dirty.strip() else "")


def _keep(rel):
    """a file below backend/ that belongs in a release"""
    parts = rel.split("/")
    if len(parts) > 2 and parts[1] in SKIP_DIRS:             # backend/data/, backend/tests/ ... (top level only)
        return False
    if any(p == "__pycache__" or p.startswith(".") for p in parts[1:-1]):
        return False
    return not SKIP_FILE.search(parts[-1])


def release_files(root):
    """relative paths (with /) of every file that goes into the ZIP, sorted. In a git checkout only files
    git tracks are shipped (nothing left lying around in backend/ by accident); elsewhere the folder."""
    tracked = _git(root, "ls-files", "-z", "--", "backend")
    if tracked is not None and _git(root, "rev-parse", "--show-prefix") == b"\n":
        cand = [n for n in tracked.decode("utf-8").split("\0") if n and os.path.isfile(os.path.join(root, *n.split("/")))]
    else:
        cand = []
        for base, dirs, files in os.walk(os.path.join(root, "backend")):
            dirs.sort()
            cand += [os.path.relpath(os.path.join(base, f), root).replace(os.sep, "/") for f in files]
    out = [n for n in cand if _keep(n)]
    for f in ROOT_FILES:
        if os.path.isfile(os.path.join(root, *f.split("/"))):
            out.append(f)
    missing = [f for f in REQUIRED if f not in out]
    if missing:
        raise SystemExit("cannot build a release, missing: %s%s" % (", ".join(missing),
                         " (run `npm run build`)" if "backend/slide_builder.html" in missing else ""))
    return sorted(set(out))


def _entry(name):
    zi = zipfile.ZipInfo(name, ZIP_TIME)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    return zi


def check_release_version(root, version, check_version=True):
    if not update.VERSION_RE.match(version):
        raise SystemExit("not a release version (X.Y.Z or X.Y.Z-tag): %r" % version)
    prog = program_version(root)
    if check_version and version != prog and not version.startswith(prog + "-"):
        raise SystemExit("version %s does not match the program's VERSION %s (backend/slidebuilder/__init__.py)" % (version, prog))


def build(root, version, out_dir, check_version=True):
    check_release_version(root, version, check_version)
    files = {}
    names = release_files(root)
    for n in names:
        with open(os.path.join(root, *n.split("/")), "rb") as f:
            data = f.read()
        files[n] = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
    manifest = {"app": APP, "version": version, "commit": git_commit(root), "files": files}
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "slidebuilder-%s.zip" % version)
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w") as z:
        for n in names:
            with open(os.path.join(root, *n.split("/")), "rb") as f:
                z.writestr(_entry(n), f.read())
        z.writestr(_entry(update.MANIFEST), json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, path)
    return path, manifest


def verify(path):
    try:
        with zipfile.ZipFile(path) as z:
            man = update.verify_release(z)
    except (OSError, zipfile.BadZipFile, ValueError) as e:
        say("NOT OK: %s: %s" % (os.path.basename(path), e))
        return 1
    say("OK: %s - version %s, %d files match MANIFEST.json" % (os.path.basename(path), man["version"], len(man["files"])))
    return 0


def release_notes(root, version):
    """the CHANGELOG.md section of this version (X.Y.Z, without a -tag), or a one-line default"""
    try:
        with open(os.path.join(root, "CHANGELOG.md"), encoding="utf-8") as f:
            text = f.read()
    except OSError:
        text = ""
    base = version.split("-")[0]
    m = re.search(r"^## \[?" + re.escape(base) + r"\b.*?(?=^## |\Z)", text, re.M | re.S)
    return m.group(0).strip() if m else "Slide Builder %s" % version


def run_tests(root):
    """the helper tests, and the app and core checks when npm is installed (what CI runs)"""
    say("Running the helper tests...")
    if subprocess.call([sys.executable, "-m", "unittest", "discover", "-s", os.path.join(root, "backend", "tests")], cwd=root):
        raise SystemExit("helper tests failed - no release built")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    try:
        rc = subprocess.call([npm, "run", "check"], cwd=root)
    except OSError:
        say("npm not found: app and core checks skipped (CI runs them)")
        return
    if rc:
        raise SystemExit("app or core checks failed - no release built")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build or verify the Slide Builder release ZIP.")
    ap.add_argument("--version", default=None, help="release version (default: VERSION of the program)")
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"), help="output folder (default: dist/)")
    ap.add_argument("--no-tests", action="store_true", help="do not run the tests first")
    ap.add_argument("--verify", metavar="ZIP", default=None, help="check a release ZIP against its MANIFEST.json")
    ap.add_argument("--notes", metavar="VERSION", default=None, help="print the CHANGELOG.md section of a version")
    ap.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.verify:
        return verify(a.verify)
    root = os.path.abspath(a.root)
    if a.notes:                     # UTF-8 bytes (release.yml writes them to a file: the ✓ must survive)
        sys.stdout.flush()
        sys.stdout.buffer.write((release_notes(root, a.notes) + "\n").encode("utf-8"))
        sys.stdout.buffer.flush()
        return 0
    version = a.version or program_version(root)
    check_release_version(root, version)                 # before the tests: a wrong version fails at once
    if not a.no_tests:
        run_tests(root)
    path, man = build(root, version, a.out)
    say("Built %s (%d files, version %s)" % (path, len(man["files"]), man["version"]))
    return verify(path)


if __name__ == "__main__":
    sys.exit(main())
