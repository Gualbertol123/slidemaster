"""The v4 pilot on a copy of the data (slidebuilder/pilot.py, docs/next/04 §4.5): the copy is made once, a refresh
keeps the old copy and waits for nobody to be in it, and the real data folder is never the pilot's."""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import sbtest  # noqa: F401  (puts the helper on sys.path)
from slidebuilder import paths, pilot


def tree(root, skip=()):
    out = {}
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            with open(os.path.join(base, f), "rb") as fh:
                out[os.path.relpath(os.path.join(base, f), root)] = hashlib.sha256(fh.read()).hexdigest()
    return out


def write(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class PilotCopyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sb-pilot-")
        self.backend = os.path.join(self.tmp, "backend")
        self.src = os.path.join(self.backend, "data")
        write(os.path.join(self.src, "config.json"), '{"schema": 3}')
        write(os.path.join(self.src, "workbooks", "a.xlsx-0123456789.json"), '{"schema": 3, "rev": 1}')
        write(os.path.join(self.src, "users", "anna.json"), "{}")
        write(os.path.join(self.src, "locks", "wb-a.lock"), "anna")
        write(os.path.join(self.src, "backups", "x.json"), "old")
        write(os.path.join(self.src, "fonts", "f.ttf"), "font")
        env = {k: os.environ.pop(k) for k in ("SLIDEBUILDER_DATA", "SLIDEBUILDER_EXPORT", "SLIDEBUILDER_ROOT") if k in os.environ}
        self.addCleanup(os.environ.update, env)
        for p in (mock.patch.object(paths, "HOME_BACKEND", self.backend), mock.patch.object(paths, "_default_root", lambda: self.tmp)):
            p.start()
            self.addCleanup(p.stop)
        paths.configure()
        self.addCleanup(paths.configure)
        self.said = []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_copied_once_without_locks_and_backups(self):
        before = tree(self.src)
        data = pilot.prepare(say=self.said.append)
        self.assertEqual(data, os.path.join(self.src, "v4-pilot"))
        self.assertEqual((paths.DATA, paths.EXPORT_DIR), (data, os.path.join(self.tmp, "export", "v4-pilot")))
        got = tree(data)
        self.assertIn("pilot.json", got)
        got.pop("pilot.json")
        want = {k: v for k, v in before.items() if not k.startswith(("locks", "backups"))}
        self.assertEqual(got, want)
        self.assertEqual(tree(self.src, skip=("v4-pilot",)), before)              # the real data: unchanged
        # the second start uses the copy as it is, even when the real data changed meanwhile
        write(os.path.join(self.src, "workbooks", "a.xlsx-0123456789.json"), '{"schema": 3, "rev": 2}')
        write(os.path.join(data, "workbooks", "b.xlsx-0123456789.json"), "pilot's own")
        pilot.prepare(say=self.said.append)
        self.assertIn("Using the pilot copy made", self.said[-1])
        with open(os.path.join(data, "workbooks", "a.xlsx-0123456789.json"), encoding="utf-8") as f:
            self.assertIn('"rev": 1', f.read())
        self.assertTrue(os.path.isfile(os.path.join(data, "workbooks", "b.xlsx-0123456789.json")))
        self.assertEqual(sorted(os.listdir(self.src)), ["backups", "config.json", "fonts", "locks", "users", "v4-pilot", "workbooks"])

    def test_refresh_keeps_the_old_copy_and_waits_for_nobody_there(self):
        data = pilot.prepare(say=self.said.append)
        pres = os.path.join(data, "v4", "decks", "a.xlsx-0123456789", "presence", "bob@pc2#abc123")
        write(pres)
        with self.assertRaises(pilot.PilotError) as e:
            pilot.prepare(refresh=True, say=self.said.append)
        self.assertIn("bob on pc2", str(e.exception))
        old = time.time() - 600
        os.utime(pres, (old, old))                                             # bob left ten minutes ago
        write(os.path.join(self.src, "workbooks", "a.xlsx-0123456789.json"), '{"schema": 3, "rev": 2}')
        pilot.prepare(refresh=True, say=self.said.append)
        with open(os.path.join(data, "workbooks", "a.xlsx-0123456789.json"), encoding="utf-8") as f:
            self.assertIn('"rev": 2', f.read())
        kept = [n for n in os.listdir(self.src) if n.startswith("v4-pilot.old-")]
        self.assertEqual(len(kept), 1)
        self.assertTrue(os.path.isfile(os.path.join(self.src, kept[0], "v4", "decks", "a.xlsx-0123456789", "presence", "bob@pc2#abc123")))
        self.assertNotIn(kept[0], os.listdir(data))                            # an older copy is never copied into the new one

    def test_an_interrupted_copy_is_never_used(self):
        part = os.path.join(self.src, "v4-pilot.part")
        write(os.path.join(part, ".copying"))
        os.makedirs(os.path.join(part, "half"))
        with self.assertRaises(pilot.PilotError) as e:                         # moved just now: another PC is copying
            pilot.prepare(say=self.said.append)
        self.assertIn("Another PC is copying", str(e.exception))
        self.assertTrue(os.path.isdir(os.path.join(part, "half")))
        old = time.time() - 3600
        os.utime(os.path.join(part, ".copying"), (old, old))                   # not for an hour: an interrupted copy
        with mock.patch.object(pilot, "_copy", side_effect=OSError("share dropped")):
            with self.assertRaises(OSError):
                pilot.prepare(say=self.said.append)
        self.assertFalse(os.path.exists(os.path.join(self.src, "v4-pilot")))
        self.assertFalse(os.path.exists(os.path.join(self.src, "v4-pilot.part")))
        pilot.prepare(say=self.said.append)
        self.assertFalse(os.path.exists(os.path.join(self.src, "v4-pilot", "half")))

    def test_only_the_copy_and_its_export_folder(self):
        os.environ["SLIDEBUILDER_DATA"] = self.src                              # the real data: refused
        self.addCleanup(os.environ.pop, "SLIDEBUILDER_DATA", None)
        with self.assertRaises(pilot.PilotError):
            pilot.prepare(say=self.said.append)
        os.environ["SLIDEBUILDER_DATA"] = os.path.join(self.src, "v4-pilot")
        os.environ["SLIDEBUILDER_EXPORT"] = os.path.join(self.tmp, "export")    # the real export folder: refused
        self.addCleanup(os.environ.pop, "SLIDEBUILDER_EXPORT", None)
        with self.assertRaises(pilot.PilotError):
            pilot.prepare(say=self.said.append)
        self.assertFalse(os.path.exists(os.path.join(self.src, "v4-pilot")))
        os.environ["SLIDEBUILDER_EXPORT"] = os.path.join(self.tmp, "export", "v4-pilot")
        self.assertEqual(pilot.prepare(say=self.said.append), os.path.join(self.src, "v4-pilot"))

    def test_two_pcs_starting_the_first_pilot_at_once(self):
        """one makes the copy, complete; the other is told to wait (it never touches the copy being made)"""
        for i in range(60):
            write(os.path.join(self.src, "workbooks", "w%02d.xlsx-0123456789.json" % i), '{"schema": 3}')
        code = (
            "import os, sys, time\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "from slidebuilder import paths, pilot\n"
            "paths.HOME_BACKEND = sys.argv[2]\n"
            "paths._default_root = lambda: os.path.dirname(sys.argv[2])\n"
            "paths.configure()\n"
            "slow = pilot._copy_file\n"
            "pilot._copy_file = lambda s, d: (time.sleep(0.05), slow(s, d))[1]\n"
            "try:\n"
            "    pilot.prepare(say=lambda m: None)\n"
            "except pilot.PilotError as e:\n"
            "    print(e); sys.exit(3)\n")
        env = {k: v for k, v in os.environ.items() if not k.startswith("SLIDEBUILDER_")}
        args = [sys.executable, "-c", code, os.path.dirname(os.path.dirname(os.path.abspath(pilot.__file__))), self.backend]
        first = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        part = os.path.join(self.src, "v4-pilot.part")
        for _ in range(200):
            if os.path.isdir(part):
                break
            time.sleep(0.02)
        second = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, timeout=60)
        out, _ = first.communicate(timeout=120)
        self.assertEqual(first.returncode, 0, out)
        self.assertEqual(second.returncode, 3, second.stdout)
        self.assertIn("Another PC is copying", second.stdout)
        got = tree(os.path.join(self.src, "v4-pilot"))
        got.pop("pilot.json")
        self.assertEqual(got, {k: v for k, v in tree(self.src, skip=("v4-pilot",)).items() if not k.startswith(("locks", "backups"))})
        self.assertFalse(os.path.exists(part))

    def test_a_refused_rename_is_asked_again(self):
        """Windows refuses the final rename for a moment while it still holds a file just copied (seen on a test PC)"""
        real, calls = os.rename, []

        def flaky(a, b):
            calls.append(b)
            if len(calls) <= 2:
                raise PermissionError(5, "Access is denied")
            return real(a, b)
        with mock.patch.object(pilot.os, "rename", flaky), mock.patch.object(pilot.time, "sleep"):
            data = pilot.prepare(say=self.said.append)
        self.assertEqual(len(calls), 3)
        self.assertTrue(os.path.isfile(os.path.join(data, "pilot.json")))

    def test_no_data_folder(self):
        shutil.rmtree(self.src)
        with self.assertRaises(pilot.PilotError):
            pilot.prepare(say=self.said.append)


if __name__ == "__main__":
    unittest.main()
