"""First-time installer (--install): five steps (Python, shared folder, journal, shortcut, self-test),
shortcut fallback, shared-folder and journal probes, idempotency. No network: subprocess calls are faked."""
import io
import os
import re
import sys
import unittest
from unittest import mock

from sbtest import BACKEND, TempDirs

from slidebuilder import firstrun, paths


class FakeRun:
    """Stands in for firstrun.run_cmd: records commands, answers from a list of (rc, output)."""

    def __init__(self, answers=None, default=(0, "")):
        self.answers = list(answers or [])
        self.default = default
        self.calls = []

    def __call__(self, cmd, env=None, timeout=None, echo=True):
        self.calls.append(list(cmd))
        if self.answers:
            a = self.answers.pop(0)
            return a(cmd, env) if callable(a) else a
        return self.default


def report():
    lines = []
    return firstrun.Report(out=lines.append), lines


class PythonStep(unittest.TestCase):
    def info(self, ver, bits=64):
        return {"version": ".".join(map(str, ver)), "info": ver, "impl": "CPython", "bits": bits,
                "venv": False, "exe": "C:\\Python\\python.exe", "store": False}

    def test_versions(self):
        for ver, ok, status in (((3, 8, 10), True, "OK"), ((3, 12, 4), True, "OK"),
                                ((3, 17, 2), True, "OK"), ((3, 7, 9), False, "FAIL")):
            r, lines = report()
            self.assertEqual(firstrun.step_python(r, self.info(ver)), ok)
            self.assertEqual(r.steps[-1][2], status, ver)
            self.assertIn("Python %d.%d.%d" % ver, "\n".join(lines))


class Shortcut(TempDirs):
    def setUp(self):
        super().setUp()
        self.desktop = os.path.join(self.tmp, "Desktop")
        os.makedirs(self.desktop)

    def test_powershell_blocked_writes_a_launcher_bat(self):
        blocked = (1, "New-Object : Cannot create type. Only core types are supported in this language mode.")
        run = FakeRun([blocked, blocked])
        for _ in range(2):                                   # idempotent: same single file again
            kind, path, reason = firstrun.create_shortcut(self.desktop, self.root, run, windows=True)
            self.assertEqual(kind, "bat")
            self.assertIn("language mode", reason)
        self.assertEqual(os.listdir(self.desktop), ["Slide Builder.bat"])
        with open(path, "rb") as f:
            text = f.read().decode("utf-8")
        self.assertIn('cd /d "%s"' % self.root, text)
        self.assertIn('call "Start Slide Builder.bat"', text)
        self.assertIn("\r\n", text)
        self.assertEqual(run.calls[0][0], "powershell")

    def test_powershell_missing_writes_a_launcher_bat(self):
        run = FakeRun([(127, "[Errno 2] No such file or directory: 'powershell'")])
        kind, path, _ = firstrun.create_shortcut(self.desktop, self.root, run, windows=True)
        self.assertEqual((kind, os.path.basename(path)), ("bat", "Slide Builder.bat"))

    def test_unc_folder_uses_pushd(self):
        text = firstrun.launcher_bat("\\\\srv\\share\\Slide Builder")
        self.assertIn('pushd "\\\\srv\\share\\Slide Builder"', text)
        self.assertNotIn("cd /d", text)

    def test_lnk_replaces_an_earlier_fallback(self):
        firstrun.create_shortcut(self.desktop, self.root, FakeRun([(1, "blocked")]), windows=True)
        mine = os.path.join(self.desktop, "Notes.bat")      # someone else's file is never touched
        with open(mine, "w") as f:
            f.write("@echo off\n")

        def make_lnk(cmd, env):
            with open(env["SB_LNK"], "wb") as f:
                f.write(b"L\x00\x00\x00")
            self.assertTrue(env["SB_TARGET"].endswith("Start Slide Builder.bat"))
            return 0, ""
        kind, path, _ = firstrun.create_shortcut(self.desktop, self.root, FakeRun([make_lnk]), windows=True)
        self.assertEqual(kind, "lnk")
        self.assertEqual(sorted(os.listdir(self.desktop)), ["Notes.bat", "Slide Builder.lnk"])

    def test_step_skips_off_windows(self):
        r, lines = report()
        self.assertTrue(firstrun.step_shortcut(r, FakeRun(), desktop=self.desktop, windows=False))
        self.assertEqual(os.listdir(self.desktop), [])
        self.assertIn("SKIP", "\n".join(lines))


class SharedFolder(TempDirs):
    def test_probe(self):
        res = firstrun.shared_folder_check(rounds=5)
        self.assertTrue(res["lock"] and res["export"], res["errors"])
        self.assertEqual(len(res["times_ms"]), 5)
        self.assertGreaterEqual(res["median_ms"], 0)
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])     # nothing left behind
        self.assertEqual(os.listdir(paths.EXPORT_DIR), [])

    def test_unwritable_export_fails_the_step(self):
        with open(os.path.join(self.root, "export"), "w") as f:          # a file where the folder should be
            f.write("x")
        r, lines = report()
        self.assertFalse(firstrun.step_shared(r, lambda: firstrun.shared_folder_check(rounds=2)))
        self.assertEqual(r.steps[-1][2], "FAIL")

    def test_slow_share_warns(self):
        r, lines = report()
        fake = {"lock": True, "export": True, "errors": [], "median_ms": 48.0, "times_ms": [48.0] * 20}
        self.assertTrue(firstrun.step_shared(r, lambda: fake))
        self.assertEqual(r.steps[-1][2], "WARN")
        self.assertIn("48.00 ms", "\n".join(lines))


class Journal(TempDirs):
    def test_probe_appends_flushes_and_cleans_up(self):
        synced, real = [], os.fsync

        def spy(fd):
            synced.append(fd)
            return real(fd)
        with mock.patch.object(firstrun.os, "fsync", spy):
            self.assertIsNone(firstrun.journal_check())
        self.assertEqual(len(synced), 2)                   # each appended record is flushed
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])     # nothing left behind
        r, lines = report()
        self.assertTrue(firstrun.step_journal(r))
        self.assertEqual(r.steps[-1][:3], [3, "Journal (append and flush in the data folder)", "OK"])

    def test_second_append_is_checked(self):
        real_open = open
        writes = []

        def lossy_open(path, mode="r", *a, **kw):           # a share that truncates instead of appending
            if "journal-test" in str(path) and mode == "ab":
                writes.append(path)
                if len(writes) == 2:
                    mode = "wb"
            return real_open(path, mode, *a, **kw)
        with mock.patch("builtins.open", lossy_open):
            problem = firstrun.journal_check()
        self.assertIn("appends are not kept in order", problem)
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])

    def test_failed_flush_fails_the_step(self):
        with mock.patch.object(firstrun.os, "fsync", side_effect=OSError(5, "Input/output error")):
            problem = firstrun.journal_check()
        self.assertIn("cannot flush record 1 (os.fsync)", problem)
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])
        r, lines = report()
        self.assertFalse(firstrun.step_journal(r, lambda: problem))
        self.assertEqual(r.steps[-1][2], "FAIL")
        self.assertEqual(r.summary(), 1)                    # required: the PC is not ready
        self.assertIn("NOT ready", "\n".join(lines))

    def test_unwritable_data_folder(self):
        with open(os.path.join(self.tmp, "blocked"), "w") as f:      # a file where the folder should be
            f.write("x")
        problem = firstrun.journal_check(os.path.join(self.tmp, "blocked"))
        self.assertIn("cannot create the folder", problem)


class WholeInstall(TempDirs):
    def test_install_twice_is_safe(self):
        desktop = os.path.join(self.tmp, "Desktop")
        os.makedirs(desktop)
        codes, outputs, runs = [], [], []
        for _ in range(2):
            lines = []
            run = FakeRun([(1, "Cannot create type.")])
            codes.append(firstrun.run_install(run=run, desktop=desktop, windows=True,
                                              smoke=lambda: (True, "pong", True), out=lines.append))
            outputs.append("\n".join(lines))
            runs.append(run.calls)
        self.assertEqual(codes, [0, 0])
        for calls in runs:                                  # only the shortcut: no pip, no download, no engine
            self.assertEqual([c[0] for c in calls], ["powershell"])
        self.assertEqual(os.listdir(desktop), ["Slide Builder.bat"])
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])
        for text in outputs:
            self.assertIn("Detected: Python %d.%d.%d" % sys.version_info[:3], text)
            self.assertEqual(re.findall(r"^\[(\d)/(\d)\] (.+)$", text, re.M),
                             [("1", "5", "Python"), ("2", "5", "Shared folder"), ("3", "5", "Journal (append and flush in the data folder)"),
                              ("4", "5", "Desktop shortcut"), ("5", "5", "Self-test (start the helper, ping it, stop it)")])
            self.assertIn("OK    3. Journal", text)
            self.assertIn("OK    5. Self-test", text)
            for gone in ("pip install", "ensurepip", "playwright", "Playwright", "export engine", "Chrome"):
                self.assertNotIn(gone, text)

    def test_failed_journal_gives_exit_code_1(self):
        lines = []
        code = firstrun.run_install(run=FakeRun(), windows=False, journal=lambda: "cannot flush record 1",
                                    smoke=lambda: (True, "pong", True), out=lines.append)
        self.assertEqual(code, 1)
        self.assertIn("FAIL  3. Journal", "\n".join(lines))

    def test_failed_self_test_gives_exit_code_1(self):
        lines = []
        code = firstrun.run_install(run=FakeRun(), windows=False,
                                    smoke=lambda: (False, "the helper did not answer", False), out=lines.append)
        self.assertEqual(code, 1)
        self.assertIn("NOT ready", "\n".join(lines))

    def test_real_smoke_test(self):
        ok, msg, _ = firstrun.smoke_test(timeout=60)
        self.assertTrue(ok, msg)


class EntryPoint(unittest.TestCase):
    def test_install_flag_dispatches(self):
        from slidebuilder import main
        with mock.patch.object(firstrun, "run_install", return_value=0) as ri, \
                mock.patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as cm:
                main.main(["--install"])
        self.assertEqual(cm.exception.code, 0)
        ri.assert_called_once_with()

    def test_engine_installer_is_gone(self):
        from slidebuilder import main
        with mock.patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit) as cm:
                main.main(["--setup"])                     # "Install export engine.bat" and --setup were removed (B1)
        self.assertEqual(cm.exception.code, 2)
        self.assertFalse(os.path.exists(os.path.join(BACKEND, "requirements.txt")))     # standard library only
        self.assertFalse(os.path.exists(os.path.join(BACKEND, "Install export engine.bat")))

if __name__ == "__main__":
    unittest.main()
