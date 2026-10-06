"""The entry point starts, answers /api/ping, and a second start detects the running helper."""
import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request

from sbtest import BACKEND, TempDirs


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class EntryPointTests(TempDirs):
    def test_start_ping_and_second_start(self):
        port = free_port()
        env = dict(os.environ, SLIDEBUILDER_ENGINES="none", PYTHONUNBUFFERED="1")
        cmd = [sys.executable, os.path.join(BACKEND, "slide_builder.py"), "--port", str(port), "--no-browser"]
        p = subprocess.Popen(cmd, env=env, cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            body = None
            for _ in range(100):
                try:
                    with opener.open("http://127.0.0.1:%d/api/ping" % port, timeout=1) as r:
                        body = json.load(r)
                    break
                except OSError:
                    time.sleep(0.1)
            self.assertEqual(body, {"app": "slide-builder", "version": "3.0"})
            with self.assertRaises(urllib.error.HTTPError) as cm:
                opener.open("http://127.0.0.1:%d/api/health" % port, timeout=2)
            self.assertEqual(cm.exception.code, 403)
            second = subprocess.run(cmd, env=env, cwd=BACKEND, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
            self.assertEqual(second.returncode, 0)
            self.assertIn(b"already running on port %d" % port, second.stdout)
            self.assertTrue(os.path.isdir(os.path.join(self.root, "export")))
            self.assertTrue(os.path.isdir(self.data))
        finally:
            p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
            p.stdout.close()


if __name__ == "__main__":
    unittest.main()
