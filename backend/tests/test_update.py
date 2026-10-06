"""tools/update.py: connecting an existing folder to GitHub in place and updating it never touches the
saved setups (decks, defaults, preferences, logo, v2 settings, workbooks, exports)."""
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout

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


if __name__ == "__main__":
    unittest.main()
