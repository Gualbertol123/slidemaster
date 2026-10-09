"""tools/sharetest.py: the field-test protocols run end to end with local processes on a temp folder
(coordinator + workers, barrier files, round trips, journal and lean lock, convergence, nothing lost)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOL = os.path.join(REPO, "tools", "sharetest.py")


class ShareTestTest(unittest.TestCase):
    def test_local_run_converges(self):
        tmp = tempfile.mkdtemp(prefix="sb-sharetest-")
        try:
            r = subprocess.run([sys.executable, TOOL, "local", "--folder", tmp, "--workers", "2", "--duration", "3",
                                "--think", "0.2", "0.5", "--rdcw", "--out", tmp], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               universal_newlines=True, timeout=240)
            self.assertEqual(r.returncode, 0, r.stdout)
            r.stdout.encode("ascii")                                  # cp1252 consoles
            reports = [f for f in os.listdir(tmp) if f.startswith("sharetest-") and f.endswith(".json")]
            self.assertEqual(len(reports), 1, os.listdir(tmp))
            with open(os.path.join(tmp, reports[0])) as f:
                rep = json.load(f)
            self.assertEqual(len(rep["pcs"]), 2)
            for proto in ("journal", "lock"):
                ph = rep["phases"][proto]
                self.assertTrue(ph["converged"], ph)
                self.assertEqual(ph["lost"], 0)
                self.assertGreater(ph["acked"], 0)
                self.assertIsNotNone(ph["visible_ms"]["p50"])
            self.assertIn("rdcw", rep["phases"]["journal"])
            self.assertEqual(set(rep["rtt_ms"][rep["pcs"][0]]), {"create_write_fsync", "open_read", "stat", "listdir", "rename", "delete"})
            # the temporary sub-folder is gone
            self.assertFalse([f for f in os.listdir(tmp) if f.startswith("sb-sharetest-")])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_pc_that_stops_ends_the_run(self):
        """a worker killed during a phase: the coordinator names the problem and cleans up instead of hanging"""
        import time
        tmp = tempfile.mkdtemp(prefix="sb-sharetest-dead-")
        try:
            coord = subprocess.Popen([sys.executable, TOOL, "coordinator", "--folder", tmp, "--pcs", "2", "--duration", "6",
                                      "--think", "0.2", "0.5", "--grace", "3", "--out", tmp],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
            run = None
            for _ in range(100):
                runs = [n for n in os.listdir(tmp) if n.startswith("sb-sharetest-")]
                if runs:
                    run = runs[0][len("sb-sharetest-"):]
                    break
                time.sleep(0.1)
            self.assertIsNotNone(run)
            worker = subprocess.Popen([sys.executable, TOOL, "worker", "--folder", tmp, "--run", run, "--name", "doomed"],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            go = os.path.join(tmp, "sb-sharetest-" + run, "go-journal.json")
            for _ in range(600):
                if os.path.exists(go):
                    break
                time.sleep(0.1)
            time.sleep(12)                                            # inside the journal phase
            worker.kill()
            worker.wait(10)
            out, _ = coord.communicate(timeout=120)
            self.assertNotEqual(coord.returncode, 0, out)
            self.assertIn("a PC stopped or lost the share", out)
            self.assertFalse([n for n in os.listdir(tmp) if n.startswith("sb-sharetest-")])     # cleaned up
        finally:
            for p in ("coord", "worker"):
                if p in locals() and locals()[p].poll() is None:
                    locals()[p].kill()
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
