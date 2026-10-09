"""tools/update.py: connecting an existing folder to GitHub in place and updating it never touches the
saved setups (decks, defaults, preferences, logo, v2 settings, workbooks, exports)."""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
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
        # "GitHub": a repository with the program files of this checkout (backend/, tools/, …)
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.work)
        for d in ("backend/slidebuilder", "tools"):
            shutil.copytree(os.path.join(REPO, *d.split("/")), os.path.join(self.work, *d.split("/")), ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for f in (".gitignore", "README.md", "Start Slide Builder.bat", "backend/.gitignore", "backend/slide_builder.py"):
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
        write(self.work, {"docs/NEW.md": "new feature", "backend/slidebuilder/version.py": "V = 2\n"})
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
        for p in ("backend/slide_builder.html", "backend/slidebuilder/store.py", "README.md", "tools/update.py"):
            self.assertFalse(update.is_protected(p), p)


# --------------------------------------------------------------------------- side-by-side releases (S0.3)
spec_mr = importlib.util.spec_from_file_location("sb_make_release_u", os.path.join(REPO, "tools", "make_release.py"))
make_release = importlib.util.module_from_spec(spec_mr)
spec_mr.loader.exec_module(make_release)


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
        self.assertEqual(self.saved_state(), before)
        out.encode("ascii")
        # the same ZIP again: nothing is extracted twice
        rc, out = self.install("3.4.0")
        self.assertEqual(rc, 0, out)
        self.assertIn("already installed", out)

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
        with open(os.path.join(self.root, "app", "3.5.0", "backend", "slide_builder.py"), "a") as f:
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
                b.writestr(n, b"evil" if n == "backend/slidebuilder/server.py" else a.read(n))
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
        write(self.root, {"app/3.4.0.part/backend/half.py": "x"})
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
        """app/<ver>/backend/slide_builder.py, started without any environment, finds the main folder's data"""
        self.assertEqual(self.install("3.4.0")[0], 0)
        env = {k: v for k, v in os.environ.items() if not k.startswith("SLIDEBUILDER_")}
        entry = os.path.join(self.root, "app", "3.4.0", "backend", "slide_builder.py")
        r = subprocess.run([sys.executable, entry, "--selftest"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, env=env, cwd=self.tmp)
        self.assertEqual(r.returncode, 0, r.stdout)
        line = next(x for x in r.stdout.splitlines() if x.startswith("  data   : "))
        self.assertEqual(os.path.realpath(line[len("  data   : "):]), os.path.realpath(self.data))
        self.assertIn("3 saved setup(s) read", r.stdout)          # the deck, config.json, anna's preferences

    def test_one_click_update_follows_releases(self):
        """a folder with app/current.json: a plain "Update Slide Builder.bat" looks for releases, not backend/"""
        api = self.release_json(None)
        self.assertEqual(self.install("3.4.0")[0], 0)
        rc, out = run("--root", self.root, "--api-url", api, "--yes")
        self.assertEqual(rc, 0, out)
        self.assertIn("side-by-side versions", out)
        self.assertIn("Already up to date (version 3.4.0)", out)
        rc, out = run("--root", self.root, "--check", "--api-url", api)
        self.assertIn("Already up to date (version 3.4.0)", out)

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
        sys.path.insert(0, os.path.join(REPO, "backend"))
        from slidebuilder import paths
        fake = os.path.join(self.tmp, "app", "Slide Builder")       # a release ZIP unpacked as a main folder
        write(self.tmp, {"app/Slide Builder/MANIFEST.json": "{}", "app/3.4.0/MANIFEST.json": "{}"})
        with mock.patch.object(paths, "BACKEND", os.path.join(fake, "backend")):
            self.assertIsNone(paths._install_home())
        with mock.patch.object(paths, "BACKEND", os.path.join(self.tmp, "app", "3.4.0", "backend")):
            self.assertEqual(paths._install_home(), self.tmp)

    def test_git_and_zip_updates_never_touch_app(self):
        self.assertTrue(update.is_protected("app/3.4.0/backend/slide_builder.py"))
        self.assertTrue(update.is_protected("app/current.json"))

    def test_version_order(self):
        vs = ["3.10.0", "3.4.0", "3.4.0-rc1", "3.9.2"]
        self.assertEqual(sorted(vs, key=update.version_key), ["3.4.0-rc1", "3.4.0", "3.9.2", "3.10.0"])


if __name__ == "__main__":
    unittest.main()
