"""tools/make_release.py: the release ZIP holds exactly the program files, its MANIFEST.json verifies, and
any damaged, extra, missing or unsafe entry is refused (by the same check tools/update.py uses)."""
import ast
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import sysconfig
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from unittest import mock

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("sb_make_release", os.path.join(REPO, "tools", "make_release.py"))
mr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mr)


def write(root, files):
    for path, data in files.items():
        p = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def rewrite(src, dst, change):
    """copy a ZIP, letting change(name, data) return new bytes, None (drop) or the same bytes"""
    with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst, "w") as b:
        for n in a.namelist():
            out = change(n, a.read(n))
            if out is not None:
                b.writestr(n, out)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-release-")
        self.root = os.path.join(self.tmp, "repo")
        write(self.root, {
            "helper/slide_builder.py": "print('hi')\n",
            "helper/slide_builder.html": "<!doctype html>",
            "helper/slidebuilder/__init__.py": 'APP_NAME = "slide-builder"\nVERSION = "3.4.0"\n',
            "helper/slidebuilder/server.py": "# server\n",
            "tools/update.py": "# updater\n",
            "tools/make_release.py": "# not shipped\n",
            "Start Slide Builder.bat": "@echo off\r\n",
            "Update Slide Builder.bat": "@echo off\r\n",
            "Install Slide Builder.bat": "@echo off\r\n",
            "README.md": "# Slide Builder\n",
            "THIRD-PARTY-NOTICES.txt": "## react 19.2.8 · MIT\n",
            # never shipped: user data, tests, caches, a user's logo and settings, workbooks, dot files
            "helper/data/config.json": "{}",
            "helper/data/workbooks/a.json": "{}",
            "helper/tests/test_x.py": "",
            "helper/slidebuilder/__pycache__/server.cpython-38.pyc": b"\x00",
            "helper/logo.png": b"PNG",
            "helper/slide_builder_settings.txt": "v2",
            "helper/report.xlsx": b"PK",
            "helper/.gitignore": "data/",
            "app/src/main.tsx": "",
        })
        self.out = os.path.join(self.tmp, "dist")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, *extra):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = mr.main(["--root", self.root, "--out", self.out, "--no-tests"] + list(extra))
        return rc, out.getvalue()

    def verify(self, path):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = mr.main(["--verify", path])
        return rc, out.getvalue()

    def test_contents_and_manifest(self):
        rc, out = self.build()
        self.assertEqual(rc, 0, out)
        path = os.path.join(self.out, "slidebuilder-3.4.0.zip")
        with zipfile.ZipFile(path) as z:
            names = sorted(z.namelist())
            man = json.loads(z.read("MANIFEST.json"))
            self.assertEqual(names, sorted([
                "MANIFEST.json", "README.md", "Install Slide Builder.bat", "Start Slide Builder.bat", "Update Slide Builder.bat",
                "THIRD-PARTY-NOTICES.txt", "helper/slide_builder.html",
                "helper/slide_builder.py", "helper/slidebuilder/__init__.py", "helper/slidebuilder/server.py", "tools/update.py"]))
            self.assertEqual(man["version"], "3.4.0")
            self.assertEqual(man["app"], "slide-builder")
            for n, meta in man["files"].items():
                data = z.read(n)
                self.assertEqual(meta, {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}, n)
        self.assertEqual(self.verify(path)[0], 0)

    def test_reproducible(self):
        self.build()
        path = os.path.join(self.out, "slidebuilder-3.4.0.zip")
        with open(path, "rb") as f:
            first = f.read()
        os.remove(path)
        self.build()
        with open(path, "rb") as f:
            self.assertEqual(f.read(), first)

    def test_versions(self):
        self.assertEqual(self.build("--version", "3.4.0-rc1")[0], 0)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "slidebuilder-3.4.0-rc1.zip")))
        with self.assertRaises(SystemExit):
            self.build("--version", "3.5.0")          # not the program's version
        with self.assertRaises(SystemExit):
            self.build("--version", "../x")

    def test_version_checked_before_the_tests(self):
        with mock.patch.object(mr, "run_tests", side_effect=AssertionError("tests ran")):
            with self.assertRaises(SystemExit):
                mr.main(["--root", self.root, "--out", self.out, "--version", "9.9.9"])

    def test_git_checkout_ships_tracked_files_only(self):
        if not shutil.which("git"):
            self.skipTest("git is not installed")
        import subprocess
        g = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", self.root]
        subprocess.run(g + ["init", "-q"], check=True)
        subprocess.run(g + ["add", "-A"], check=True)
        subprocess.run(g + ["commit", "-qm", "x"], check=True)
        write(self.root, {"helper/slidebuilder/notes.orig": "left over", "helper/venv/lib/x.py": "", "helper/slide_builder.log": ""})
        files = mr.release_files(self.root)
        self.assertNotIn("helper/slidebuilder/notes.orig", files)
        self.assertNotIn("helper/venv/lib/x.py", files)
        self.assertIn("helper/slidebuilder/server.py", files)
        self.assertNotIn("helper/data/config.json", files)          # tracked here, but user data is never shipped
        self.assertFalse(mr.git_commit(self.root).endswith("-dirty"))
        write(self.root, {"helper/slidebuilder/server.py": "# changed\n"})
        self.assertTrue(mr.git_commit(self.root).endswith("-dirty"))

    def test_nested_folder_named_like_a_skipped_one_is_kept(self):
        write(self.root, {"helper/slidebuilder/data/table.py": "x = 1\n"})
        self.assertIn("helper/slidebuilder/data/table.py", mr.release_files(self.root))

    def test_page_must_be_built(self):
        os.remove(os.path.join(self.root, "helper", "slide_builder.html"))
        with self.assertRaises(SystemExit) as e:
            self.build()
        self.assertIn("npm run build", str(e.exception))

    def test_notices_must_be_there(self):
        os.remove(os.path.join(self.root, "THIRD-PARTY-NOTICES.txt"))
        with self.assertRaises(SystemExit) as e:
            self.build()
        self.assertIn("THIRD-PARTY-NOTICES.txt", str(e.exception))

    def forged(self, good, extra):
        """a copy of the release with `extra` files added AND listed in its manifest with the right hashes"""
        out = os.path.join(self.tmp, "forged.zip")
        with zipfile.ZipFile(good) as a, zipfile.ZipFile(out, "w") as b:
            man = json.loads(a.read("MANIFEST.json"))
            for n in a.namelist():
                if n != "MANIFEST.json":
                    b.writestr(n, a.read(n))
            for n, data in extra.items():
                b.writestr(n, data)
                man["files"][n] = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
            b.writestr("MANIFEST.json", json.dumps(man))
        return out

    def test_verify_refuses_bad_zips(self):
        self.build()
        good = os.path.join(self.out, "slidebuilder-3.4.0.zip")
        cases = {
            "damaged": lambda n, d: b"evil" if n == "helper/slidebuilder/server.py" else d,
            "missing": lambda n, d: None if n == "helper/slide_builder.py" else d,
            "no manifest": lambda n, d: None if n == "MANIFEST.json" else d,
            "bad manifest": lambda n, d: b"{" if n == "MANIFEST.json" else d,
        }
        for label, change in cases.items():
            bad = os.path.join(self.tmp, label + ".zip")
            rewrite(good, bad, change)
            rc, out = self.verify(bad)
            self.assertEqual(rc, 1, label)
            self.assertIn("NOT OK", out)
        # extra and unsafe entries
        for label, name in (("extra", "helper/extra.py"), ("unsafe", "../evil.py"), ("absolute", "/etc/x"), ("drive", "C:/x")):
            bad = os.path.join(self.tmp, label + ".zip")
            shutil.copy(good, bad)
            with zipfile.ZipFile(bad, "a") as z:
                z.writestr(name, "x")
            self.assertEqual(self.verify(bad)[0], 1, label)
        # an unsafe name that IS listed in the manifest with the right hash: refused for its name
        for label, name in (("listed traversal", "../evil.py"), ("device", "helper/aux.txt"), ("trailing dot", "helper/x.py."),
                            ("trailing space", "helper/x.py "), ("control", "helper/a\x01.py"), ("wildcard", "helper/a?.py")):
            self.assertEqual(self.verify(self.forged(good, {name: b"x"}))[0], 1, label)
        # names Windows would merge: case, Unicode form, an exact duplicate
        for label, extra in (("case", {"helper/SLIDE_BUILDER.py": b"x"}), ("nfd", {"helper/cafe\u0301.py": b"x", "helper/caf\u00e9.py": b"y"})):
            self.assertEqual(self.verify(self.forged(good, extra))[0], 1, label)
        dup = os.path.join(self.tmp, "dup.zip")
        shutil.copy(good, dup)
        with zipfile.ZipFile(dup, "a") as z:
            z.writestr("helper/slide_builder.py", "other")
        self.assertEqual(self.verify(dup)[0], 1, "duplicate entry")
        # manifests of the wrong shape are refused, never a traceback
        for label, man in (("files not a dict", {"version": "3.4.0", "files": ["a.py"]}), ("entry not a dict", {"version": "3.4.0", "files": {"a.py": "x"}}),
                           ("no files", {"version": "3.4.0", "files": {}}), ("not an object", ["x"]),
                           ("other app", {"app": "other", "version": "3.4.0", "files": {"helper/slide_builder.py": {"size": 1, "sha256": "0" * 64}}}),
                           ("no helper", {"version": "3.4.0", "files": {"a.py": {"size": 1, "sha256": "0" * 64}}})):
            bad = os.path.join(self.tmp, "man.zip")
            with zipfile.ZipFile(bad, "w") as z:
                z.writestr("MANIFEST.json", json.dumps(man))
                z.writestr("a.py", "x")
            rc, out = self.verify(bad)
            self.assertEqual(rc, 1, label)
            self.assertIn("NOT OK", out)
        with open(os.path.join(self.tmp, "not.zip"), "wb") as f:
            f.write(b"not a zip")
        self.assertEqual(self.verify(os.path.join(self.tmp, "not.zip"))[0], 1)

    def test_release_notes(self):
        self.assertEqual(mr.release_notes(self.root, "3.4.0"), "Slide Builder 3.4.0")
        write(self.root, {"CHANGELOG.md": "# Changelog\n\n## 3.4.0 - 2026-10-09\n- faster\n\n## 3.3.0\n- old\n"})
        self.assertEqual(mr.release_notes(self.root, "3.4.0-rc1"), "## 3.4.0 - 2026-10-09\n- faster")
        self.assertEqual(mr.release_notes(self.root, "3.3.0"), "## 3.3.0\n- old")

    def test_output_is_ascii(self):
        rc, out = self.build()
        out.encode("ascii")
        self.assertEqual(rc, 0)


class RealTreeTest(unittest.TestCase):
    def test_this_checkout_builds(self):
        """the real repository assembles into a release that verifies (needs the committed page)"""
        tmp = tempfile.mkdtemp(prefix="sb-release-real-")
        try:
            path, man = mr.build(REPO, "0.0.0-test", tmp, check_version=False)
            self.assertIn("helper/slide_builder.html", man["files"])
            self.assertIn("helper/slidebuilder/server.py", man["files"])
            self.assertIn("THIRD-PARTY-NOTICES.txt", man["files"])
            self.assertFalse([n for n in man["files"] if n.startswith(("helper/data/", "helper/tests/", "app/", "docs/"))])
            with zipfile.ZipFile(path) as z:
                mr.update.verify_release(z)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class NoticesTest(unittest.TestCase):
    """LI-01 (AUDIT-2 LIC-1): THIRD-PARTY-NOTICES.txt ships in every release and names every runtime dependency.
    What the bundles really hold is checked by app/tests/notices.test.ts; this test reads package-lock.json, so it
    runs where node_modules is missing too."""

    def read(self, *parts):
        with open(os.path.join(REPO, *parts), encoding="utf-8") as f:
            return f.read()

    def sections(self):
        """{name: version} of the "## <name> <version> ..." headings"""
        return dict(re.findall(r"^## (\S+) (\S+) ", self.read("THIRD-PARTY-NOTICES.txt"), re.M))

    def test_shipped_and_required(self):
        self.assertIn("THIRD-PARTY-NOTICES.txt", mr.ROOT_FILES)
        self.assertIn("THIRD-PARTY-NOTICES.txt", mr.REQUIRED)

    def test_every_runtime_dependency_has_an_entry(self):
        """the runtime dependencies of app/ and core/ in package-lock.json, and theirs, each at its locked version"""
        pkgs = json.loads(self.read("package-lock.json"))["packages"]
        todo = [n for ws in ("app", "core") for n in pkgs[ws].get("dependencies", {}) if not n.startswith("@slide-builder/")]
        have, seen = self.sections(), set()
        while todo:
            n = todo.pop()
            if n in seen:
                continue
            seen.add(n)
            entry = pkgs["node_modules/" + n]
            self.assertEqual(have.get(n), entry["version"], "%s %s has no entry in THIRD-PARTY-NOTICES.txt (node tools/notices.mjs)" % (n, entry["version"]))
            todo += list(entry.get("dependencies", {}))
        self.assertTrue({"react", "react-dom", "scheduler", "zustand", "fflate"} <= seen, seen)    # scheduler through react-dom

    def test_vendored_licences_have_an_entry(self):
        """every licence file next to an inlined WASM (core/src/**/wasm/) is reproduced whole, and so is the Apache-2.0 text"""
        text = self.read("THIRD-PARTY-NOTICES.txt")
        found = []
        for base, _dirs, files in os.walk(os.path.join(REPO, "core", "src")):
            if os.path.basename(base) != "wasm":
                continue
            rel = os.path.relpath(base, REPO).replace(os.sep, "/")
            lic = sorted(f for f in files if f.startswith(("LICENSE", "COPYING")))
            self.assertTrue(lic, rel + " has no licence file")
            for f in lic:
                found.append(f)
                self.assertIn("(%s/%s)" % (rel, f), text)
                self.assertIn(self.read(*(rel.split("/") + [f])).strip(), text, f)
        self.assertEqual(sorted(found), ["COPYING-harfbuzz", "LICENSE-harfbuzzjs", "LICENSE-ironcalc"])
        self.assertIn(self.read("tools", "licenses", "Apache-2.0.txt").strip(), text)
        self.assertTrue({"IronCalc", "harfbuzzjs", "HarfBuzz", "Apache-2.0"} <= set(self.sections()))

    def test_helper_uses_the_standard_library_only(self):
        """the helper and the updater ship no third-party Python code, so they need no entry"""
        std = [os.path.normcase(os.path.realpath(sysconfig.get_paths()[k])) for k in ("stdlib", "platstdlib")]
        pkg = os.path.join(REPO, "helper", "slidebuilder")
        files = [os.path.join(REPO, "helper", "slide_builder.py"), os.path.join(REPO, "tools", "update.py")]
        files += [os.path.join(pkg, f) for f in os.listdir(pkg) if f.endswith(".py")]
        local = {"slidebuilder"} | {f[:-3] for f in os.listdir(pkg) if f.endswith(".py")}
        names = set()
        for path in files:
            with open(path, encoding="utf-8") as f:
                tree = ast.parse(f.read(), path)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names |= {a.name.split(".")[0] for a in node.names}
                elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
                    names.add(node.module.split(".")[0])
        for n in sorted(names - local):
            if n in sys.builtin_module_names or (os.name != "nt" and n in ("winreg", "msvcrt", "_winapi", "winsound", "nt")):
                continue                                     # (Windows' own standard modules, missing elsewhere)
            spec = importlib.util.find_spec(n)
            self.assertIsNotNone(spec, n)
            if spec.origin in ("built-in", "frozen"):
                continue
            origin = os.path.normcase(os.path.realpath(spec.origin or ""))
            self.assertTrue(any(origin.startswith(s + os.sep) for s in std) and "site-packages" not in origin,
                            "%s is not in the standard library (%s)" % (n, spec.origin))


if __name__ == "__main__":
    unittest.main()
