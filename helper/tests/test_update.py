"""tools/update.py: connecting an existing folder to GitHub in place and updating it never touches the
saved setups (decks, defaults, preferences, logo, v2 settings, workbooks, exports)."""
import datetime
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_update", os.path.join(REPO, "tools", "update.py"))
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)

GIT = shutil.which("git")
SAVED = {
    "backend/data/workbooks/report.xlsx-1a2b.json": json.dumps({"schema": 3, "workbook": "report.xlsx", "rev": 7, "preset": None,
                                                                "style": {"design": "excel", "theme": {"id": "intesa"}}, "edits": {"S": {"C6": {"b": True}}}}),
    "backend/data/config.json": json.dumps({"schema": 3, "rev": 2, "defaults": {"style": {"radius": 60}}}),
    "backend/data/users/anna.json": json.dumps({"lastFile": "report.xlsx"}),
    "backend/logo.png": "PNG-bytes",
    "backend/slide_builder_settings.txt": "v2 settings",
    "report.xlsx": "workbook",
    "export/report - slides.pdf": "%PDF-",
}


def git(*args, cwd=None):
    r = subprocess.run([GIT, "-c", "safe.directory=*", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main"] + list(args),
                       cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def write(root, files):
    for path, text in files.items():
        p = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)


def read(root, path):
    with open(os.path.join(root, *path.split("/")), encoding="utf-8") as f:
        return f.read()


def run(*argv):
    out = io.StringIO()
    with redirect_stdout(out):
        rc = update.main(list(argv))
    return rc, out.getvalue()


@unittest.skipUnless(GIT, "git is not installed")
class UpdateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-update-")
        # "GitHub": a repository with the program files of this checkout (helper/, tools/, …)
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.work)
        for d in ("helper/slidebuilder", "tools"):
            shutil.copytree(os.path.join(REPO, *d.split("/")), os.path.join(self.work, *d.split("/")), ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for f in (".gitignore", "README.md", "Start Slide Builder.bat", "helper/.gitignore", "helper/slide_builder.py"):
            os.makedirs(os.path.dirname(os.path.join(self.work, f)), exist_ok=True)
            shutil.copy2(os.path.join(REPO, f), os.path.join(self.work, f))
        git("init", "-q", "-b", "main", cwd=self.work); git("add", "-A", cwd=self.work); git("commit", "-qm", "v1", cwd=self.work)
        self.origin = os.path.join(self.tmp, "origin.git")
        git("clone", "-q", "--bare", self.work, self.origin)

        # the folder on the shared drive: a plain copy of the program files (no .git) plus saved work
        self.pc = os.path.join(self.tmp, "Slide Builder")
        shutil.copytree(self.work, self.pc, ignore=shutil.ignore_patterns(".git"))
        write(self.pc, SAVED)
        write(self.pc, {"README.md": "edited by hand on the share"})
        # …and the second copy that "git clone" made inside it
        git("clone", "-q", self.origin, os.path.join(self.pc, "slidemaster"))

    def tearDown(self):
        update.remove_tree(self.tmp)

    def assertSavedIntact(self, root):
        for path, text in SAVED.items():
            self.assertEqual(read(root, path), text, path)

    def test_connect_in_place_then_update(self):
        rc, out = run("--root", self.pc, "--repo", self.origin, "--yes")
        self.assertEqual(rc, 0, out)
        self.assertTrue(os.path.isdir(os.path.join(self.pc, ".git")))
        self.assertIn("1 deck(s) open fine", out)
        self.assertSavedIntact(self.pc)
        # the hand-edited program file is back to the GitHub version, the edit kept in the backup folder
        self.assertEqual(read(self.pc, "README.md"), read(self.work, "README.md"))
        bdir = os.path.join(self.pc, "backend", "data", "backups")
        before = [d for d in os.listdir(bdir) if d.startswith("before-update-")]
        self.assertEqual(len(before), 1)
        self.assertEqual(read(os.path.join(bdir, before[0]), "program-files/README.md"), "edited by hand on the share")
        self.assertTrue(os.path.isfile(os.path.join(bdir, before[0], "workbooks", "report.xlsx-1a2b.json")))
        # the nested copy is gone, the folder follows the default branch
        self.assertFalse(os.path.exists(os.path.join(self.pc, "slidemaster")))
        self.assertEqual(git("rev-parse", "--abbrev-ref", "HEAD", cwd=self.pc), "main")
        self.assertEqual(git("status", "--porcelain", "--untracked-files=no", cwd=self.pc), "")

        # nothing new on GitHub
        rc, out = run("--root", self.pc, "--yes")
        self.assertIn("Already up to date", out)

        # a new version on GitHub: only program files change
        write(self.work, {"docs/NEW.md": "new feature", "helper/slidebuilder/version.py": "V = 2\n"})
        git("add", "-A", cwd=self.work); git("commit", "-qm", "v2: new feature", cwd=self.work); git("push", "-q", self.origin, "main", cwd=self.work)
        rc, out = run("--root", self.pc, "--check")
        self.assertIn("An update is available", out)
        rc, out = run("--root", self.pc, "--yes")
        self.assertEqual(rc, 0, out)
        self.assertIn("v2: new feature", out)
        self.assertEqual(read(self.pc, "docs/NEW.md"), "new feature")
        self.assertSavedIntact(self.pc)

    def test_zip_update_without_git(self):
        pc = os.path.join(self.tmp, "Share2")
        shutil.copytree(self.work, pc, ignore=shutil.ignore_patterns(".git"))
        write(pc, SAVED)
        write(pc, {"README.md": "old"})
        zpath = os.path.join(self.tmp, "slidemaster-main.zip")
        with zipfile.ZipFile(zpath, "w") as z:
            for base, _dirs, files in os.walk(self.work):
                if ".git" in base.split(os.sep):
                    continue
                for f in files:
                    full = os.path.join(base, f)
                    z.write(full, "slidemaster-main/" + os.path.relpath(full, self.work).replace(os.sep, "/"))
            # a hostile/accidental archive entry must not overwrite saved work
            z.writestr("slidemaster-main/backend/data/config.json", "{}")
            z.writestr("slidemaster-main/report.xlsx", "other")
        rc, out = run("--root", pc, "--zip", "--zip-url", "file:///" + zpath.replace(os.sep, "/").lstrip("/"), "--yes")
        self.assertEqual(rc, 0, out)
        self.assertSavedIntact(pc)
        self.assertEqual(read(pc, "README.md"), read(self.work, "README.md"))
        self.assertTrue(os.path.isfile(os.path.join(pc, "backend", "data", "app-version.json")))

    def test_one_update_at_a_time(self):
        with update.UpdateLock(self.pc):
            with self.assertRaises(SystemExit) as e:
                update.UpdateLock(self.pc).__enter__()
        self.assertIn("Somebody else is updating", str(e.exception))

    def test_protected_paths(self):
        for p in ("backend/data/workbooks/x.json", "export/a.pdf", "Report Q3.XLSX", "backend/logo.png", "backend/slide_builder_settings.txt", "engine/chrome.exe", "~$book.xlsx"):
            self.assertTrue(update.is_protected(p), p)
        for p in ("helper/slide_builder.html", "helper/slidebuilder/store.py", "README.md", "tools/update.py"):
            self.assertFalse(update.is_protected(p), p)


# --------------------------------------------------------------------------- side-by-side releases (S0.3)
spec_mr = importlib.util.spec_from_file_location("sb_make_release_u", os.path.join(REPO, "tools", "make_release.py"))
make_release = importlib.util.module_from_spec(spec_mr)
spec_mr.loader.exec_module(make_release)


class DeckJobsTest(unittest.TestCase):
    """--migrate-all and --rollback (docs/next/04 §4.3, §4.4) with the program of this checkout"""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="sb-decks-")
        shutil.copytree(os.path.join(REPO, "helper", "slidebuilder"), os.path.join(self.root, "helper", "slidebuilder"),
                        ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copy2(os.path.join(REPO, "helper", "slide_builder.py"), os.path.join(self.root, "helper"))
        write(self.root, {"backend/data/workbooks/report.xlsx-%s.json" % hashlib.sha1(b"report.xlsx").hexdigest()[:10]:
                          json.dumps({"schema": 3, "workbook": "report.xlsx", "rev": 4, "preset": None, "style": {"design": "excel"}, "edits": {}})})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_migrate_all_then_rollback(self):
        os.environ["SLIDEBUILDER_ROLLBACK_QUIET"] = "0.2"          # the subprocess inherits it (14 s for real)
        self.addCleanup(os.environ.pop, "SLIDEBUILDER_ROLLBACK_QUIET", None)
        v3 = os.path.join(self.root, "backend", "data", "workbooks", "report.xlsx-%s.json" % hashlib.sha1(b"report.xlsx").hexdigest()[:10])
        rc, out = run("--root", self.root, "--migrate-all")
        self.assertEqual(rc, 0, out)
        self.assertIn("Moved to Slide Builder 4: 1 deck(s): report.xlsx", out)
        said = []                                                   # the frozen stub is not a second deck
        with mock.patch.object(update, "say", said.append):
            self.assertTrue(update.verify_saved(self.root))
        self.assertIn("1 deck(s) open fine", said[-1])
        with open(v3, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["schema"], 4)
        rc, out = run("--root", self.root, "--migrate-all")
        self.assertIn("Moved to Slide Builder 4: 0 deck(s)", out)
        rc, out = run("--root", self.root, "--rollback")
        self.assertEqual(rc, 0, out)
        self.assertIn("Given back to Slide Builder 3: 1 deck(s)", out)
        with open(v3, encoding="utf-8") as f:
            back = json.load(f)
        self.assertEqual((back["schema"], back["rev"], back["style"]), (3, 4, {"design": "excel"}))
        self.assertFalse(os.path.exists(os.path.join(self.root, "backend", "data", "locks", "update.lock")))


class UseThreeRollsBackTest(unittest.TestCase):
    """--use <3.x> is the global rollback (04 §4.4): every deck goes back first, or the version is not switched"""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="sb-use3-")
        write(self.root, {"app/3.8.0/MANIFEST.json": "{}", "backend/data/v4/decks/A.xlsx-0123456789/snapshot.json": "{}"})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_use_3_rolls_every_deck_back_first(self):
        self.assertTrue(update.decks_owned(self.root))
        calls = []
        with mock.patch.object(update, "check_installed"), mock.patch.object(update, "activate", lambda *a, **k: calls.append("activate") or "4.0.0"),                 mock.patch.object(update, "rollback_decks", lambda root, name: calls.append(("rollback", name)) or False):
            with self.assertRaises(SystemExit) as e:
                update.use_version(self.root, "3.8.0", "stamp")
        self.assertIn("NOT used", str(e.exception))
        self.assertEqual(calls, [("rollback", "")])                    # not switched
        calls.clear()
        with mock.patch.object(update, "check_installed"), mock.patch.object(update, "activate", lambda *a, **k: calls.append("activate") or "4.0.0"),                 mock.patch.object(update, "rollback_decks", lambda root, name: calls.append(("rollback", name)) or True):
            update.use_version(self.root, "3.8.0", "stamp")
        self.assertEqual(calls, [("rollback", ""), "activate"])
        write(self.root, {"backend/data/v4/decks/A.xlsx-0123456789/rolled-back.json": "{}"})
        self.assertFalse(update.decks_owned(self.root))


class UseBelowFormat5Test(unittest.TestCase):
    """--use below 4.6 (ADR-019 rule c): the decks that hold 4.6 objects are named, and the switch waits for a yes"""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="sb-use45-")
        d = "backend/data/v4/decks/"
        write(self.root, {"app/4.5.0/MANIFEST.json": "{}", "app/4.6.0/MANIFEST.json": "{}", "app/3.8.0/MANIFEST.json": "{}",
                          d + "Plain.xlsx-0123456789/snapshot.json": json.dumps({"format": 4, "workbook": "Plain.xlsx"}),
                          d + "Charts.xlsx-0123456789/snapshot.json": json.dumps({"format": 5, "workbook": "Charts.xlsx"}),
                          d + "Charts.xlsx-0123456789/incident-format-5.json": "{}",
                          d + "Back.xlsx-0123456789/snapshot.json": json.dumps({"format": 5, "workbook": "Back.xlsx"}),
                          d + "Back.xlsx-0123456789/incident-format-5.json": "{}",
                          d + "Back.xlsx-0123456789/rolled-back.json": "{}"})

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def use(self, ver, answer=None, yes=False):
        calls, out = [], io.StringIO()
        asked = mock.patch("builtins.input", side_effect=(lambda q: calls.append(("asked", q)) or answer) if answer is not None else EOFError)
        with asked, redirect_stdout(out), mock.patch.object(update, "check_installed"), \
                mock.patch.object(update, "activate", lambda *a, **k: calls.append("activate") or "4.6.0"), \
                mock.patch.object(update, "rollback_decks", lambda root, name: calls.append("rollback") or True):
            try:
                update.use_version(self.root, ver, "stamp", yes)
            except SystemExit as e:
                calls.append(("refused", str(e)))
        return calls, out.getvalue()

    def test_marked_decks_are_listed_and_asked_for(self):
        self.assertEqual(update.format5_decks(self.root), ["Charts.xlsx"])        # (one given back to v3 does not count)
        calls, out = self.use("4.5.0", "n")
        self.assertIn("These 1 deck(s) use Slide Builder 4.6 objects", out)
        self.assertIn("new slides, hidden slides...)", out)               # (review of M13, 5: hidden slides are 4.6 too)
        self.assertIn("  Charts.xlsx", out)
        self.assertNotIn("Plain.xlsx", out)
        self.assertEqual(calls[0][0], "asked")
        self.assertEqual(calls[1][0], "refused")
        self.assertIn("Nothing was changed", calls[1][1])
        self.assertEqual(len(calls), 2)                                          # not switched
        self.assertEqual(self.use("4.5.0")[0][-1][0], "refused")                 # no console to answer: no
        calls, _ = self.use("4.5.0", "y")
        self.assertEqual(calls[-1], "activate")
        calls, out = self.use("4.5.0", yes=True)                                 # --yes: named, not asked
        self.assertEqual(calls, ["activate"])
        self.assertIn("Charts.xlsx", out)
        calls, out = self.use("3.8.0", "sì")                                     # to v3: the objects are lost there
        self.assertIn("loses those objects", out)
        self.assertEqual(calls[1:], ["rollback", "activate"])

    def test_46_and_later_ask_nothing(self):
        calls, out = self.use("4.6.0", "n")
        self.assertEqual(calls, ["activate"])
        self.assertNotIn("4.6 objects", out)


def tree_hashes(root, skip=()):
    """{relative path: sha256} of every file below root, except under the `skip` sub-folders"""
    out = {}
    for base, dirs, files in os.walk(root):
        r = os.path.relpath(base, root).replace(os.sep, "/")
        dirs[:] = [d for d in dirs if (d if r == "." else r + "/" + d) not in skip]
        for f in files:
            with open(os.path.join(base, f), "rb") as fh:
                out[os.path.relpath(os.path.join(base, f), root).replace(os.sep, "/")] = hashlib.sha256(fh.read()).hexdigest()
    return out


class ReleaseInstallTest(unittest.TestCase):
    """--release / --zip <file> / --use: app/<ver> side by side, app/current.json, self-test gate"""

    @classmethod
    def setUpClass(cls):
        cls.dist = tempfile.mkdtemp(prefix="sb-dist-")
        cls.zips = {}
        for v in ("3.4.0", "3.5.0", "3.6.0", "3.7.0"):
            cls.zips[v] = make_release.build(REPO, v, cls.dist, check_version=False)[0]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dist, ignore_errors=True)

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-rel-")
        self.root = os.path.join(self.tmp, "Slide Builder")
        os.makedirs(os.path.join(self.root, "backend"))
        write(self.root, SAVED)
        write(self.root, {"Start Slide Builder.bat": "old start file", "tools/update.py": "# old updater\n"})
        self.data = os.path.join(self.root, "backend", "data")

    def tearDown(self):
        update.remove_tree(self.tmp)

    def saved_state(self):
        # the data folder minus what the updater itself owns (its lock, the before-update backups);
        # the workbooks, exports and the user's files next to the program
        return (tree_hashes(self.data, skip=("backups", "locks")),
                {p: read(self.root, p) for p in SAVED if not p.startswith("backend/data/")})

    def pointer(self):
        with open(os.path.join(self.root, "app", "current.json"), encoding="utf-8") as f:
            return json.load(f)

    def install(self, v):
        return run("--root", self.root, "--zip", self.zips[v], "--yes")

    def test_install_offline(self):
        before = self.saved_state()
        rc, out = self.install("3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("self-test passed", out)
        self.assertEqual(self.pointer()["version"], "3.4.0")
        app = os.path.join(self.root, "app")
        self.assertEqual(sorted(os.listdir(app)), ["3.4.0", "current.json"])
        update.check_installed(os.path.join(app, "3.4.0"))
        # the main folder's start file now knows app/current.json; the old one is in the backup folder
        self.assertIn("app\\current.json", read(self.root, "Start Slide Builder.bat"))
        self.assertNotEqual(read(self.root, "tools/update.py"), "# old updater\n")
        # a folder that got its first version from a ZIP had no Update / Install / v3 start file: added (cutover.md)
        for n in update.MISSING_ONLY + ("Install Slide Builder.bat",):
            with open(os.path.join(self.root, n), "rb") as a, open(os.path.join(REPO, n), "rb") as b:
                self.assertEqual(a.read(), b.read(), n)
            self.assertIn("added " + n, out)
        self.assertIn("updated Start Slide Builder.bat", out)
        self.assertEqual(self.saved_state(), before)
        out.encode("ascii")
        # the same ZIP again: nothing is extracted twice
        write(self.root, {"Update Slide Builder.bat": "the running updater's start file"})
        rc, out = self.install("3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("already installed", out)
        self.assertEqual(read(self.root, "Update Slide Builder.bat"), "the running updater's start file")   # never replaced

    def test_flip_rollback_and_prune(self):
        before = self.saved_state()
        for v in ("3.4.0", "3.5.0"):
            rc, out = self.install(v)
            self.assertEqual(rc, 0, out)
        self.assertEqual((self.pointer()["version"], self.pointer()["previous"]), ("3.5.0", "3.4.0"))
        rc, out = run("--root", self.root, "--use", "3.4.0")          # roll back
        self.assertEqual(rc, 0, out)
        self.assertEqual((self.pointer()["version"], self.pointer()["previous"]), ("3.4.0", "3.5.0"))
        with self.assertRaises(SystemExit) as e:
            run("--root", self.root, "--use", "9.9.9")
        self.assertIn("not installed", str(e.exception))
        self.assertEqual(self.pointer()["version"], "3.4.0")
        # a changed program file: --use refuses that version
        with open(os.path.join(self.root, "app", "3.5.0", "helper", "slide_builder.py"), "a") as f:
            f.write("# edited\n")
        with self.assertRaises(SystemExit) as e:
            run("--root", self.root, "--use", "3.5.0")
        self.assertIn("damaged", str(e.exception))
        for v in ("3.6.0", "3.7.0"):
            rc, out = self.install(v)
            self.assertEqual(rc, 0, out)
        # the newest 3 stay (and the current and previous ones): 3.4.0 goes
        self.assertEqual(update.installed_versions(self.root), ["3.5.0", "3.6.0", "3.7.0"])
        self.assertEqual(self.pointer()["version"], "3.7.0")
        self.assertEqual(self.saved_state(), before)

    def release_json(self, digest):
        api = os.path.join(self.tmp, "api", "releases")
        os.makedirs(api, exist_ok=True)
        z = self.zips["3.4.0"]
        body = {"tag_name": "v3.4.0", "assets": [{"name": os.path.basename(z), "digest": digest,
                                                  "browser_download_url": "file:///" + z.replace(os.sep, "/").lstrip("/")}]}
        with open(os.path.join(api, "latest"), "w") as f:
            json.dump(body, f)
        return "file:///" + os.path.join(self.tmp, "api").replace(os.sep, "/").lstrip("/")

    def test_release_digest(self):
        with open(self.zips["3.4.0"], "rb") as f:
            good = "sha256:" + hashlib.sha256(f.read()).hexdigest()
        api = self.release_json("sha256:" + "0" * 64)
        with self.assertRaises(SystemExit) as e:
            run("--root", self.root, "--release", "--api-url", api)
        self.assertIn("does not match GitHub's checksum", str(e.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "3.4.0")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "current.json")))
        api = self.release_json(good)
        rc, out = run("--root", self.root, "--check", "--release", "--api-url", api)
        self.assertIn("An update is available: none -> 3.4.0", out)
        rc, out = run("--root", self.root, "--release", "latest", "--api-url", api)
        self.assertEqual(rc, 0, out)
        self.assertIn("checksum matches", out)
        self.assertEqual(self.pointer()["version"], "3.4.0")
        rc, out = run("--root", self.root, "--release", "--api-url", api)
        self.assertIn("Already up to date (version 3.4.0)", out)
        # no digest in the API answer (older GitHub): MANIFEST.json alone
        api = self.release_json(None)
        os.remove(os.path.join(self.root, "app", "current.json"))
        rc, out = run("--root", self.root, "--release", "--api-url", api)
        self.assertEqual(rc, 0, out)

    def test_bad_zip_refused(self):
        bad = os.path.join(self.tmp, "bad.zip")
        with zipfile.ZipFile(self.zips["3.4.0"]) as a, zipfile.ZipFile(bad, "w") as b:
            for n in a.namelist():
                b.writestr(n, b"evil" if n == "helper/slidebuilder/server.py" else a.read(n))
        with self.assertRaises(SystemExit) as e:
            run("--root", self.root, "--zip", bad)
        self.assertIn("not a valid Slide Builder release", str(e.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "3.4.0")))

    def test_interrupted_install_leaves_nothing(self):
        # a crash half-way through the extraction (here: right before the final check)
        real = update.check_installed
        with mock.patch.object(update, "check_installed", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.install("3.4.0")
        app = os.path.join(self.root, "app")
        self.assertEqual(os.listdir(app), [])
        # a .part left by a power cut is cleared by the next install
        write(self.root, {"app/3.4.0.part/helper/half.py": "x"})
        self.assertEqual(update.installed_versions(self.root), [])
        self.assertIs(update.check_installed, real)
        rc, out = self.install("3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertEqual(sorted(os.listdir(app)), ["3.4.0", "current.json"])

    def test_selftest_gates_the_pointer(self):
        self.assertEqual(self.install("3.4.0")[0], 0)
        # a deck saved by a newer version: 3.5.0 cannot read it, so it must not become current
        too_new = os.path.join(self.data, "workbooks", "new.xlsx-9f9f.json")
        write(self.root, {"backend/data/workbooks/new.xlsx-9f9f.json": json.dumps({"schema": 99, "workbook": "new.xlsx"})})
        before = self.saved_state()
        with self.assertRaises(SystemExit) as e:
            self.install("3.5.0")
        self.assertIn("self-test of version 3.5.0 failed", str(e.exception))
        self.assertIn("new.xlsx-9f9f.json", str(e.exception))
        self.assertEqual(self.pointer()["version"], "3.4.0")
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "3.5.0")))
        self.assertEqual(self.saved_state(), before)       # read-only: the too-new deck is unchanged
        with open(too_new) as f:
            self.assertEqual(json.load(f)["schema"], 99)

    def test_installed_version_uses_the_main_folder(self):
        """app/<ver>/helper/slide_builder.py, started without any environment, finds the main folder's data"""
        self.assertEqual(self.install("3.4.0")[0], 0)
        env = {k: v for k, v in os.environ.items() if not k.startswith("SLIDEBUILDER_")}
        entry = os.path.join(self.root, "app", "3.4.0", "helper", "slide_builder.py")
        r = subprocess.run([sys.executable, entry, "--selftest"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, env=env, cwd=self.tmp)
        self.assertEqual(r.returncode, 0, r.stdout)
        line = next(x for x in r.stdout.splitlines() if x.startswith("  data   : "))
        self.assertEqual(os.path.realpath(line[len("  data   : "):]), os.path.realpath(self.data))
        self.assertIn("3 saved setup(s) read", r.stdout)          # the deck, config.json, anna's preferences

    def test_one_click_update_follows_releases(self):
        """a folder with app/current.json: a plain "Update Slide Builder.bat" looks for releases, not helper/"""
        api = self.release_json(None)
        self.assertEqual(self.install("3.4.0")[0], 0)
        rc, out = run("--root", self.root, "--api-url", api, "--yes")
        self.assertEqual(rc, 0, out)
        self.assertIn("side-by-side versions", out)
        self.assertIn("Already up to date (version 3.4.0)", out)
        rc, out = run("--root", self.root, "--check", "--api-url", api)
        self.assertIn("Already up to date (version 3.4.0)", out)

    def test_a_rollback_with_use_is_held(self):
        """after --use of an older version (the cut-over's global rollback) a plain update does not undo it"""
        api = self.release_json(None)
        self.assertEqual(self.install("3.4.0")[0], 0)
        self.assertEqual(self.install("3.5.0")[0], 0)
        self.assertNotIn("held", self.pointer())
        self.assertEqual(run("--root", self.root, "--use", "3.4.0")[0], 0)
        self.assertTrue(self.pointer()["held"])
        with self.assertRaises(SystemExit) as e:
            run("--root", self.root, "--api-url", api, "--yes")
        self.assertIn("chosen with --use", str(e.exception))
        self.assertEqual(self.pointer()["version"], "3.4.0")
        self.assertEqual(run("--root", self.root, "--use", "3.4.0")[0], 0)      # the same --use again: still held
        self.assertTrue(self.pointer()["held"])
        self.assertEqual(run("--root", self.root, "--use", "3.5.0")[0], 0)      # forward again: no longer held
        self.assertNotIn("held", self.pointer())

    def test_newest_3x_stays_beside_4x(self):
        """a 4.0.x hotfix never removes Slide Builder 3: "Start Slide Builder (v3).bat" and --use 3.x need it"""
        for v in ("3.7.0", "3.8.0", "4.0.0-rc1", "4.0.0", "4.0.1"):
            write(self.root, {"app/%s/MANIFEST.json" % v: "{}"})
        removed = update.prune_versions(self.root, ["4.0.1", "4.0.0"])
        self.assertEqual(removed, ["3.7.0"])
        self.assertEqual(update.installed_versions(self.root), ["3.8.0", "4.0.0-rc1", "4.0.0", "4.0.1"])

    def test_main_folder_of_an_installed_version(self):
        """app\\<ver>\\tools\\update.py run without --root updates the main folder"""
        write(self.tmp, {"app/4.0.0/MANIFEST.json": "{}"})
        self.assertEqual(update.main_folder(os.path.join(self.tmp, "app", "4.0.0")), self.tmp)
        self.assertEqual(update.main_folder(os.path.join(self.tmp, "app")), os.path.join(self.tmp, "app"))
        self.assertEqual(update.main_folder(self.root), self.root)

    def test_reinstall_keeps_previous_and_says_nothing_changed(self):
        self.install("3.4.0"); self.install("3.5.0")
        rc, out = self.install("3.5.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("was already the current version", out)
        self.assertNotIn("Done.", out)
        self.assertEqual((self.pointer()["version"], self.pointer()["previous"]), ("3.5.0", "3.4.0"))
        rc, out = run("--root", self.root, "--use", "3.5.0")
        self.assertEqual(self.pointer()["previous"], "3.4.0")

    def test_version_in_use_is_not_half_deleted(self):
        for v in ("3.4.0", "3.5.0", "3.6.0"):
            self.install(v)
        real = os.rename

        def busy(src, dst):          # Windows: a PC runs 3.4.0, its folder cannot be renamed
            if os.path.basename(src) == "3.4.0":
                raise PermissionError("in use")
            return real(src, dst)
        with mock.patch.object(update.os, "rename", busy):
            rc, out = self.install("3.7.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("version 3.4.0 stays for now", out)
        update.check_installed(os.path.join(self.root, "app", "3.4.0"))         # whole, still runnable
        # no longer in use: the next update removes it, and nothing named .old-* is left over
        self.install("3.7.0")
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "app"))), ["3.5.0", "3.6.0", "3.7.0", "current.json"])

    def test_leftovers_are_only_version_folders(self):
        """app/ also holds the browser app's sources in a git checkout (S1.2): cleaning up leaves them alone"""
        self.install("3.4.0")
        app = os.path.join(self.root, "app")
        for n in ("src", "e2e", "notes.part", "x.old-1", "3.3.0.old-abc", "3.6.0.part"):
            os.makedirs(os.path.join(app, n))
        update.clear_leftovers(self.root)
        self.assertEqual(sorted(os.listdir(app)), ["3.4.0", "current.json", "e2e", "notes.part", "src", "x.old-1"])

    def test_pointer_replace_is_retried(self):
        self.install("3.4.0")
        real, calls = os.replace, []

        def flaky(src, dst):         # a PC reads current.json right now (Windows sharing violation)
            if dst.endswith("current.json") and len(calls) < 2:
                calls.append(dst)
                raise PermissionError("sharing violation")
            return real(src, dst)
        with mock.patch.object(update.os, "replace", flaky), mock.patch.object(update.time, "sleep"):
            rc, out = self.install("3.5.0")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.pointer()["version"], "3.5.0")
        self.assertEqual(len(calls), 2)
        with mock.patch.object(update.os, "replace", side_effect=PermissionError("locked")), mock.patch.object(update.time, "sleep"):
            with self.assertRaises(SystemExit) as e:
                run("--root", self.root, "--use", "3.4.0")
        self.assertIn("current version is unchanged", str(e.exception))
        self.assertEqual(self.pointer()["version"], "3.5.0")
        self.assertFalse([n for n in os.listdir(os.path.join(self.root, "app")) if n.endswith(".update-tmp")])

    def test_install_detection_needs_a_version_folder(self):
        sys.path.insert(0, os.path.join(REPO, "helper"))
        from slidebuilder import paths
        fake = os.path.join(self.tmp, "app", "Slide Builder")       # a release ZIP unpacked as a main folder
        write(self.tmp, {"app/Slide Builder/MANIFEST.json": "{}", "app/3.4.0/MANIFEST.json": "{}"})
        with mock.patch.object(paths, "HELPER", os.path.join(fake, "helper")):
            self.assertIsNone(paths._install_home())
        with mock.patch.object(paths, "HELPER", os.path.join(self.tmp, "app", "3.4.0", "helper")):
            self.assertEqual(paths._install_home(), self.tmp)

    def test_program_folder_helper_or_backend(self):
        """4.x keeps the program in helper/ (S5.1), 3.x in backend/: both start, and their data is backend/data"""
        sys.path.insert(0, os.path.join(REPO, "helper"))
        from slidebuilder import paths
        write(self.tmp, {"app/4.0.0/helper/slide_builder.py": "", "app/3.8.0/backend/slide_builder.py": "", "main/helper/slide_builder.py": ""})
        self.assertEqual(update.program_dir(os.path.join(self.tmp, "app", "4.0.0")), os.path.join(self.tmp, "app", "4.0.0", "helper"))
        self.assertEqual(update.program_dir(os.path.join(self.tmp, "app", "3.8.0")), os.path.join(self.tmp, "app", "3.8.0", "backend"))
        self.assertIsNone(update.program_dir(os.path.join(self.tmp, "app")))
        with mock.patch.object(paths, "HELPER", os.path.join(self.tmp, "main", "helper")), mock.patch.object(paths, "INSTALL_HOME", None):
            self.assertEqual(paths._home_backend(), os.path.join(self.tmp, "main", "backend"))   # a checkout: data in backend/data
        with mock.patch.object(paths, "INSTALL_HOME", self.tmp):
            self.assertEqual(paths._home_backend(), os.path.join(self.tmp, "backend"))
        self.assertEqual(os.path.basename(paths.HOME_BACKEND), "backend")       # this checkout too

    def test_git_and_zip_updates_never_touch_app(self):
        self.assertTrue(update.is_protected("app/3.4.0/helper/slide_builder.py"))
        self.assertTrue(update.is_protected("app/current.json"))

    def test_version_order(self):
        vs = ["3.10.0", "3.4.0", "3.4.0-rc1", "3.9.2"]
        self.assertEqual(sorted(vs, key=update.version_key), ["3.4.0-rc1", "3.4.0", "3.9.2", "3.10.0"])


class FakeGitHub(object):
    """github.com and api.github.com on 127.0.0.1: `routes` maps a path to (status, headers, body); every request is
    recorded in `hits`. No real network in the tests."""

    def __init__(self):
        self.routes, self.hits = {}, []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fake.hits.append(self.path)
                status, headers, body = fake.routes.get(self.path, (404, {}, b"Not Found"))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def api_hits(self):
        return [h for h in self.hits if h.startswith("/api/")]

    def publish(self, ver, zip_path, sums=None):
        """a release as release.yml publishes it: /releases/latest -> /releases/tag/v<ver>, the ZIP and its .sha256"""
        with open(zip_path, "rb") as f:
            data = f.read()
        web = "/o/r/releases"
        dl = "%s/download/v%s/slidebuilder-%s.zip" % (web, ver, ver)
        self.routes.update({
            web + "/latest": (302, {"Location": self.url + web + "/tag/v" + ver}, b""),
            web + "/tag/v" + ver: (200, {}, b"<html>release</html>"),
            dl: (200, {}, data),
            dl + ".sha256": (200, {}, (sums or "%s  dist/slidebuilder-%s.zip\n" % (hashlib.sha256(data).hexdigest(), ver)).encode()),
        })

    def rate_limited(self, path, reset):
        self.routes[path] = (403, {"X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": str(int(reset))},
                             b'{"message":"API rate limit exceeded for 203.0.113.7."}')


class GitHubReleaseTest(unittest.TestCase):
    """the one-click update of a side-by-side folder against a fake GitHub: no newer release, the API's limit used up,
    no network, the download from the release page without the API (A3)"""

    @classmethod
    def setUpClass(cls):
        cls.dist = tempfile.mkdtemp(prefix="sb-dist-")
        cls.zips = {v: make_release.build(REPO, v, cls.dist, check_version=False)[0] for v in ("3.4.0", "3.5.0")}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dist, ignore_errors=True)

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-gh-")
        self.root = os.path.join(self.tmp, "Slide Builder")
        os.makedirs(os.path.join(self.root, "backend"))
        write(self.root, SAVED)
        self.gh = FakeGitHub()
        self.sleep = mock.patch.object(update.time, "sleep")
        self.sleep.start()
        self.env = mock.patch.dict(os.environ, {"no_proxy": "127.0.0.1,localhost", "NO_PROXY": "127.0.0.1,localhost"})
        self.env.start()                 # the fake GitHub is local even on a PC with a proxy

    def tearDown(self):
        self.env.stop()
        self.sleep.stop()
        self.gh.close()
        update.remove_tree(self.tmp)

    def update(self, *extra):
        return run("--root", self.root, "--repo", "https://github.com/o/r.git", "--web-url", self.gh.url,
                   "--api-url", self.gh.url + "/api/repos/o/r", "--yes", *extra)

    def pointer(self):
        with open(os.path.join(self.root, "app", "current.json"), encoding="utf-8") as f:
            return json.load(f)["version"]

    def backups(self):
        d = os.path.join(self.root, "backend", "data", "backups")
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def test_download_from_the_release_page_without_the_api(self):
        self.assertEqual(run("--root", self.root, "--zip", self.zips["3.4.0"], "--yes")[0], 0)
        self.gh.publish("3.5.0", self.zips["3.5.0"])
        self.gh.rate_limited("/api/repos/o/r/releases/tags/v3.5.0", time.time() + 600)
        rc, out = self.update("--check")
        self.assertIn("An update is available: 3.4.0 -> 3.5.0.", out)
        self.assertEqual(self.gh.api_hits(), [])
        rc, out = self.update()
        self.assertEqual(rc, 0, out)
        self.assertIn("checksum matches the release's .sha256 file", out)
        self.assertIn("its checksum is skipped", out)              # the API's digest is only an extra check
        self.assertIn("MANIFEST.json verified: version 3.5.0", out)
        self.assertEqual(self.pointer(), "3.5.0")
        self.assertEqual(self.gh.api_hits(), ["/api/repos/o/r/releases/tags/v3.5.0"])
        self.assertIn("/o/r/releases/download/v3.5.0/slidebuilder-3.5.0.zip", self.gh.hits)

    def test_api_digest_checked_when_the_api_answers(self):
        self.gh.publish("3.5.0", self.zips["3.5.0"])
        asset = {"name": "slidebuilder-3.5.0.zip", "digest": "sha256:" + "0" * 64, "browser_download_url": "unused"}
        self.gh.routes["/api/repos/o/r/releases/tags/v3.5.0"] = (200, {}, json.dumps({"tag_name": "v3.5.0", "assets": [asset]}).encode())
        with self.assertRaises(SystemExit) as e:
            self.update("--release")
        self.assertIn("does not match GitHub's checksum", str(e.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "3.5.0")))

    def test_wrong_sha256_file_refused(self):
        self.gh.publish("3.5.0", self.zips["3.5.0"], sums="0" * 64 + "  dist/slidebuilder-3.5.0.zip\n")
        self.gh.rate_limited("/api/repos/o/r/releases/tags/v3.5.0", time.time() + 600)
        with self.assertRaises(SystemExit) as e:
            self.update("--release")
        self.assertIn("does not match", str(e.exception))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "3.5.0")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "app", "current.json")))

    def test_no_newer_release_says_so_and_changes_nothing(self):
        self.assertEqual(run("--root", self.root, "--zip", self.zips["3.5.0"], "--yes")[0], 0)
        before = self.backups()
        self.gh.publish("3.5.0", self.zips["3.5.0"])
        rc, out = self.update()
        self.assertEqual(rc, 0, out)
        self.assertIn("Already up to date (version 3.5.0): this folder runs 3.5.0 and the newest release on GitHub is 3.5.0 - "
                      "there is no newer one.", out)
        self.assertEqual(self.backups(), before)                   # no backup, no lock: nothing to do
        # a version installed by hand is newer than GitHub's newest release: never "updated" back to it
        self.gh.routes.clear()
        self.gh.publish("3.4.0", self.zips["3.4.0"])
        rc, out = self.update()
        self.assertEqual(rc, 0, out)
        self.assertIn("No newer release: this folder runs version 3.5.0, which is newer than the newest release on GitHub "
                      "(3.4.0). Nothing was changed.", out)
        rc, out = self.update("--check")
        self.assertIn("No newer release", out)
        self.assertEqual(self.pointer(), "3.5.0")
        self.assertFalse([h for h in self.gh.hits if "/download/" in h])
        self.assertEqual(self.gh.api_hits(), [])
        self.assertEqual(self.backups(), before)
        # asked for by number, an older version is installed (the documented way back besides --use)
        rc, out = self.update("--release", "3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.pointer(), "3.4.0")

    def test_rate_limit_is_one_sentence_with_the_time_to_retry(self):
        self.assertEqual(run("--root", self.root, "--zip", self.zips["3.4.0"], "--yes")[0], 0)
        before = self.backups()
        self.gh.routes["/o/r/releases/latest"] = (502, {}, b"bad gateway")       # the web page fails: the API is asked
        reset = time.time() + 25 * 60
        self.gh.rate_limited("/api/repos/o/r/releases/latest", reset)
        for extra in ((), ("--check",)):
            with self.assertRaises(SystemExit) as e:
                self.update(*extra)
            msg = str(e.exception)
            self.assertIn("60 questions an hour", msg)
            self.assertIn("Nothing was changed", msg)
            self.assertIn(datetime.datetime.fromtimestamp(reset).strftime("%H:%M"), msg)
            self.assertNotIn("Traceback", msg)
        self.assertEqual(self.gh.api_hits(), ["/api/repos/o/r/releases/latest"] * 2)   # never retried
        self.assertEqual(self.backups(), before)
        self.assertEqual(self.pointer(), "3.4.0")
        # GitHub's secondary limit: Retry-After, 429
        self.gh.routes["/api/repos/o/r/releases/latest"] = (429, {"Retry-After": "120"}, b"")
        with self.assertRaises(SystemExit) as e:
            self.update()
        self.assertIn("(in 2 minutes)", str(e.exception))

    def test_when_text(self):
        now = time.mktime((2026, 10, 20, 15, 0, 0, 0, 0, -1))
        self.assertEqual(update.when_text(now + 25 * 60 - 10, now), "after 15:24 (in 25 minutes)")
        self.assertEqual(update.when_text(now + 30, now), "after 15:00 (in 1 minute)")
        self.assertEqual(update.when_text(now + 10 * 3600, now), "after 21/10 01:00 (in 600 minutes)")
        self.assertIsNone(update.retry_at({}))
        self.assertEqual(update.retry_at({"X-RateLimit-Reset": str(int(now) - 5)}, now), now)

    def api_release(self, ver):
        asset = {"name": "slidebuilder-%s.zip" % ver, "browser_download_url": "unused"}
        return (200, {}, json.dumps({"tag_name": "v" + ver, "assets": [asset]}).encode())

    def test_release_page_without_a_redirect_falls_back_to_the_api(self):
        self.gh.routes["/o/r/releases/latest"] = (200, {}, b"<html>proxy login</html>")   # e.g. a proxy's login page
        self.gh.routes["/api/repos/o/r/releases/latest"] = self.api_release("3.5.0")
        rc, out = self.update("--release", "--check")
        self.assertEqual(rc, 0, out)
        self.assertIn("The release page did not answer", out)
        self.assertIn("An update is available: none -> 3.5.0.", out)
        self.assertEqual(self.gh.api_hits(), ["/api/repos/o/r/releases/latest"])

    def test_release_page_rate_limited_is_not_retried(self):
        self.gh.routes["/o/r/releases/latest"] = (429, {"Retry-After": "60"}, b"")
        self.gh.routes["/api/repos/o/r/releases/latest"] = self.api_release("3.5.0")
        rc, out = self.update("--release", "--check")
        self.assertEqual(rc, 0, out)
        self.assertIn("An update is available: none -> 3.5.0.", out)
        self.assertNotIn("retrying", out)
        self.assertEqual(self.gh.hits.count("/o/r/releases/latest"), 1)
        self.assertEqual(self.gh.api_hits(), ["/api/repos/o/r/releases/latest"])

    def test_missing_sha256_file_installs_on_the_manifest_check(self):
        self.gh.publish("3.5.0", self.zips["3.5.0"])
        del self.gh.routes["/o/r/releases/download/v3.5.0/slidebuilder-3.5.0.zip.sha256"]
        self.gh.rate_limited("/api/repos/o/r/releases/tags/v3.5.0", time.time() + 600)
        rc, out = self.update("--release")
        self.assertEqual(rc, 0, out)
        self.assertIn("(no .sha256 file with the release:", out)
        self.assertNotIn("checksum matches", out)
        self.assertIn("MANIFEST.json verified: version 3.5.0", out)
        self.assertEqual(self.pointer(), "3.5.0")

    def test_api_digest_is_asked_once_without_retries(self):
        self.gh.publish("3.5.0", self.zips["3.5.0"])
        self.gh.routes["/api/repos/o/r/releases/tags/v3.5.0"] = (503, {}, b"unavailable")
        rc, out = self.update("--release")
        self.assertEqual(rc, 0, out)
        self.assertIn("its checksum is skipped", out)
        self.assertNotIn("retrying", out)                          # no 2 + 4 + 8 s after the download
        self.assertEqual(self.gh.api_hits(), ["/api/repos/o/r/releases/tags/v3.5.0"])

    def test_check_with_an_older_version_named(self):
        self.assertEqual(run("--root", self.root, "--zip", self.zips["3.5.0"], "--yes")[0], 0)
        self.gh.publish("3.4.0", self.zips["3.4.0"])
        rc, out = self.update("--check", "--release", "3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("Version 3.4.0 is older than the current 3.5.0; it would be installed only because you named it.", out)
        self.assertNotIn("An update is available", out)
        self.assertEqual(self.pointer(), "3.5.0")

    def test_retry_after_as_a_date(self):
        now = 1792510080.0                                         # Mon, 20 Oct 2026 15:28:00 GMT
        self.assertEqual(update.retry_at({"Retry-After": "Mon, 20 Oct 2026 15:30:00 GMT"}, now), now + 120)
        self.assertEqual(update.retry_at({"Retry-After": "Mon, 20 Oct 2026 15:00:00 GMT"}, now), now)   # in the past
        # an unreadable Retry-After does not hide X-RateLimit-Reset
        self.assertEqual(update.retry_at({"Retry-After": "soon", "X-RateLimit-Reset": str(int(now) + 300)}, now), now + 300)
        self.assertIsNone(update.retry_at({"Retry-After": "soon"}, now))
        self.assertEqual(update.retry_at({"Retry-After": "90"}, now), now + 90)

    def test_no_network_is_one_sentence(self):
        self.gh.close()                                            # nothing listens there any more
        with self.assertRaises(SystemExit) as e:
            self.update("--release")
        msg = str(e.exception)
        self.assertIn("Could not reach 127.0.0.1", msg)
        self.assertIn("try again in a few minutes", msg)
        self.assertEqual(self.backups(), [])
        self.gh = FakeGitHub()                                     # for tearDown

    def test_no_release_at_all(self):
        self.gh.routes["/o/r/releases/latest"] = (302, {"Location": self.gh.url + "/o/r/releases"}, b"")
        with self.assertRaises(SystemExit) as e:
            self.update("--release")
        self.assertIn("GitHub has no published release of o/r", str(e.exception))
        self.assertEqual(self.gh.api_hits(), [])
        with self.assertRaises(SystemExit) as e:
            self.update("--release", "9.9.9")
        self.assertIn("there is no release v9.9.9", str(e.exception))


if __name__ == "__main__":
    unittest.main()
