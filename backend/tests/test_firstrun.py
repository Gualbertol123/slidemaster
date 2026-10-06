"""First-time installer (--install): pip/truststore decisions, shortcut fallback, shared-folder probe,
idempotency. No network, no real pip: subprocess calls are faked."""
import io
import os
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
        if cmd[1:4] == ["-m", "pip", "--version"]:
            return 0, "pip 23.3.1 from x (python 3.12)"
        return self.default


def report():
    lines = []
    return firstrun.Report(out=lines.append), lines


CERT_FAIL = (1, "WARNING: Retrying ... SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] "
                "certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)'))\n"
                "ERROR: Could not find a version that satisfies the requirement playwright")


class TruststoreDecision(unittest.TestCase):
    def test_table(self):
        d = firstrun.truststore_decision
        self.assertEqual(d((22, 2, 0), (3, 10)), "flag")
        self.assertEqual(d((24, 1, 2), (3, 12)), "flag")
        self.assertEqual(d((24, 2, 0), (3, 12)), "default")     # pip 24.2+: already the system store
        self.assertEqual(d((25, 1), (3, 15)), "default")
        self.assertEqual(d((22, 1, 2), (3, 12)), "unsupported")
        self.assertEqual(d((23, 0), (3, 9)), "unsupported")      # truststore needs Python 3.10
        self.assertEqual(d(None, (3, 12)), "unsupported")

    def test_parse_pip_version_and_cert_detection(self):
        self.assertEqual(firstrun.parse_pip_version("pip 24.1.2 from /x (python 3.8)"), (24, 1, 2))
        self.assertEqual(firstrun.parse_pip_version("pip 25.0 from C:\\x"), (25, 0, 0))
        self.assertIsNone(firstrun.parse_pip_version("No module named pip"))
        self.assertTrue(firstrun.is_cert_error(CERT_FAIL[1]))
        self.assertFalse(firstrun.is_cert_error("ERROR: No matching distribution found for playwright"))


class Packages(TempDirs):
    def setUp(self):
        super().setUp()
        self.req = os.path.join(self.tmp, "requirements.txt")
        with open(self.req, "w") as f:
            f.write("# optional\nplaywright; python_version >= \"3.9\"\n")

    def run_step(self, answers, pip_ver, py_ver=(3, 12), venv=False):
        run = FakeRun(answers)
        r, lines = report()
        ok = firstrun.step_packages(r, run, pip_ver, requirements=self.req, venv=venv, py_ver=py_ver)
        return ok, run.calls, r.steps[-1][2], "\n".join(lines)

    def test_certificate_error_is_retried_with_truststore(self):
        ok, calls, status, text = self.run_step([CERT_FAIL, (0, "Successfully installed playwright")], (23, 3, 1))
        self.assertTrue(ok)
        self.assertEqual(status, "OK")
        self.assertEqual(len(calls), 2)
        self.assertNotIn("--use-feature=truststore", calls[0])
        self.assertIn("--use-feature=truststore", calls[1])
        self.assertIn("--user", calls[0])
        for c in calls:                                     # never weaken verification
            self.assertFalse(any("trusted-host" in x or "cert" in x for x in c), c)

    def test_no_retry_when_pip_cannot_use_truststore(self):
        for pip_ver, py_ver in (((24, 2, 0), (3, 12)), ((23, 0, 0), (3, 9)), ((21, 3, 1), (3, 11))):
            ok, calls, status, text = self.run_step([CERT_FAIL], pip_ver, py_ver)
            self.assertFalse(ok)
            self.assertEqual(len(calls), 1, (pip_ver, py_ver))
            self.assertEqual(status, "WARN")                 # optional: never a FAIL
            self.assertIn("PIP_CERT", text)

    def test_other_failure_is_not_retried(self):
        ok, calls, status, _ = self.run_step([(1, "ERROR: No matching distribution found for playwright")], (23, 0, 0))
        self.assertEqual((ok, len(calls), status), (False, 1, "WARN"))

    def test_venv_installs_without_user(self):
        ok, calls, status, _ = self.run_step([(0, "")], (23, 0, 0), venv=True)
        self.assertTrue(ok)
        self.assertNotIn("--user", calls[0])
        self.assertEqual(calls[0][calls[0].index("-r") + 1], self.req)

    def test_no_pip_is_a_warning(self):
        ok, calls, status, _ = self.run_step([], None)
        self.assertEqual((ok, calls, status), (False, [], "WARN"))

    def test_pip_missing_runs_ensurepip(self):
        run = FakeRun([(1, "No module named pip"), (0, "ok"), (0, "pip 24.0 from x")])
        r, _ = report()
        v = firstrun.step_pip(r, run)
        self.assertEqual(v, (24, 0, 0))
        self.assertEqual(run.calls[1][1:3], ["-m", "ensurepip"])


class PythonStep(unittest.TestCase):
    def info(self, ver, bits=64):
        return {"version": ".".join(map(str, ver)), "info": ver, "impl": "CPython", "bits": bits,
                "venv": False, "exe": "C:\\Python\\python.exe", "store": False}

    def test_versions(self):
        for ver, ok, status in (((3, 8, 10), True, "WARN"), ((3, 12, 4), True, "OK"),
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


class WholeInstall(TempDirs):
    def test_install_twice_is_safe(self):
        desktop = os.path.join(self.tmp, "Desktop")
        os.makedirs(desktop)
        setups = []

        def setup_fn(pip=True):
            setups.append(pip)
            return 1                                        # engine blocked by policy -> WARN only
        codes, outputs = [], []
        for _ in range(2):
            lines = []
            run = FakeRun([(0, "pip 24.0 from x"), CERT_FAIL, (1, "Cannot create type.")])
            with mock.patch.object(firstrun, "truststore_decision", return_value="unsupported"):
                codes.append(firstrun.run_install(run=run, setup_fn=setup_fn, desktop=desktop, windows=True,
                                                  smoke=lambda: (True, "pong", True), out=lines.append))
            outputs.append("\n".join(lines))
        self.assertEqual(codes, [0, 0])
        self.assertEqual(setups, [False, False])            # the engine installer does not run pip again
        self.assertEqual(os.listdir(desktop), ["Slide Builder.bat"])
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])
        for text in outputs:
            self.assertIn("Detected: Python %d.%d.%d" % sys.version_info[:3], text)
            self.assertIn("WARN  3. Python packages", text)
            self.assertIn("OK    7. Self-test", text)

    def test_failed_self_test_gives_exit_code_1(self):
        lines = []
        code = firstrun.run_install(run=FakeRun(), setup_fn=lambda pip=True: 0, windows=False,
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

    def test_requirements_file(self):
        with open(os.path.join(BACKEND, "requirements.txt"), encoding="utf-8") as f:
            reqs = [l.strip() for l in f if l.strip() and not l.startswith("#")]
        self.assertEqual(reqs, ['playwright; python_version >= "3.9"'])


if __name__ == "__main__":
    unittest.main()
