"""C9: the engine mirror and the installer are coordinated by lock files."""
import contextlib
import functools
import io
import os
import unittest
from unittest import mock

from sbtest import TempDirs

from slidebuilder import engines, installer, locks, paths


class InstallLockTests(TempDirs):
    def setUp(self):
        super().setUp()
        self.local = os.path.join(self.tmp, "local", "engine")
        self.local_locks = os.path.join(self.tmp, "local", "locks")
        self._p = [mock.patch.object(paths, "LOCAL_ENGINE_DIR", self.local),
                   mock.patch.object(paths, "LOCAL_LOCK_DIR", self.local_locks)]
        for p in self._p:
            p.start()
        exe_dir = os.path.join(paths.ENGINE_DIR, "chrome-headless-shell-linux64")
        os.makedirs(exe_dir)
        with open(os.path.join(exe_dir, "chrome-headless-shell"), "w") as f:
            f.write("#!/bin/sh\n")

    def tearDown(self):
        for p in self._p:
            p.stop()
        super().tearDown()

    def test_mirror_copies_once_under_the_local_lock(self):
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_FORCE_NETWORK": "1"}):
            with locks.Lock("install", directory=self.local_locks):
                with mock.patch.object(engines, "local_install_lock",
                                       functools.partial(locks.Lock, "install", directory=self.local_locks, timeout=0.3)):
                    with self.assertRaises(locks.LockTimeout):        # the installer is busy on this PC
                        engines.mirror_engine_locally()
            self.assertIsNone(engines._exe_in(self.local))
            self.assertTrue(engines.mirror_engine_locally())
            self.assertTrue(engines._exe_in(self.local).startswith(self.local))
            self.assertFalse(engines.mirror_engine_locally())         # one time only
        self.assertEqual(os.listdir(self.local_locks), [])

    def test_part_folder_is_not_an_engine(self):
        os.makedirs(os.path.join(self.local, "x.part"))
        with open(os.path.join(self.local, "x.part", "chrome-headless-shell"), "w") as f:
            f.write("")
        self.assertIsNone(engines._exe_in(self.local))

    def test_setup_refuses_while_another_install_runs(self):
        out = io.StringIO()
        with locks.Lock("install"):                                   # someone else installs into engine\
            with mock.patch.object(installer, "Lock", functools.partial(locks.Lock, timeout=0.3)), \
                    mock.patch.object(installer, "_setup", side_effect=AssertionError("must not run")), \
                    contextlib.redirect_stdout(out):
                self.assertEqual(installer.setup(), 1)
        self.assertIn("Another installation of the export engine is running (tester@pc1)", out.getvalue())
        self.assertEqual(os.listdir(self.local_locks) if os.path.isdir(self.local_locks) else [], [])

    def test_setup_runs_under_both_locks(self):
        seen = {}

        def fake():
            seen["shared"] = os.path.exists(os.path.join(paths.DATA, "locks", "install.lock"))
            seen["local"] = os.path.exists(os.path.join(self.local_locks, "install.lock"))
            return 0
        with mock.patch.object(installer, "_setup", fake):
            self.assertEqual(installer.setup(), 0)
        self.assertEqual(seen, {"shared": True, "local": True})
        self.assertFalse(os.path.exists(os.path.join(paths.DATA, "locks", "install.lock")))


if __name__ == "__main__":
    unittest.main()
