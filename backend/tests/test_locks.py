import json
import multiprocessing
import os
import threading
import time
import unittest

from sbtest import TempDirs

import workers
from slidebuilder import paths
from slidebuilder.locks import Lock, LockTimeout


def _ctx():
    # 'spawn' behaves like Windows (fresh interpreter, nothing inherited but the arguments)
    return multiprocessing.get_context("spawn")


class LockTests(TempDirs):
    def lock_path(self, name):
        return os.path.join(paths.DATA, "locks", name + ".lock")

    def test_body_and_release(self):
        with Lock("x") as l:
            with open(self.lock_path("x")) as f:
                body = json.load(f)
            self.assertEqual((body["user"], body["host"], body["pid"]), ("tester", "pc1", os.getpid()))
            self.assertIn("at", body)
            self.assertEqual(body["token"], l.token)
        self.assertFalse(os.path.exists(self.lock_path("x")))

    def test_mutual_exclusion_across_processes(self):
        os.makedirs(self.data, exist_ok=True)
        with open(os.path.join(self.data, "counter.txt"), "w") as f:
            f.write("0")
        ctx = _ctx()
        with ctx.Pool(6) as pool:
            res = [pool.apply_async(workers.lock_counter, (self.root, self.data, "user%d" % i, 40)) for i in range(6)]
            done = [r.get(timeout=240) for r in res]
        self.assertEqual(sum(done), 240)
        with open(os.path.join(self.data, "counter.txt")) as f:
            self.assertEqual(int(f.read()), 240)
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])

    def test_timeout_names_the_holder(self):
        with Lock("busy"):
            t0 = time.time()
            with self.assertRaises(LockTimeout) as cm:
                Lock("busy", timeout=0.4).acquire()
            self.assertLess(time.time() - t0, 2)
            self.assertIn("tester@pc1", str(cm.exception))

    def test_stale_lock_is_recovered(self):
        os.makedirs(os.path.join(self.data, "locks"))
        p = self.lock_path("old")
        with open(p, "w") as f:
            json.dump({"user": "ghost", "host": "pc9", "pid": 1, "at": 0, "token": "dead"}, f)
        past = time.time() - 60
        os.utime(p, (past, past))
        t0 = time.time()
        with Lock("old") as l:
            self.assertLess(time.time() - t0, 2)
            with open(p) as f:
                self.assertEqual(json.load(f)["token"], l.token)
        self.assertFalse(os.path.exists(p))
        self.assertEqual(os.listdir(os.path.join(self.data, "locks")), [])

    def test_fresh_lock_is_not_broken(self):
        with Lock("fresh"):
            with self.assertRaises(LockTimeout):
                Lock("fresh", timeout=0.3).acquire()

    def test_release_does_not_delete_someone_elses_lock(self):
        l = Lock("mine").acquire()
        p = self.lock_path("mine")
        # our lock went stale and somebody else took it over meanwhile
        with open(p, "w") as f:
            json.dump({"user": "bob", "host": "pc2", "pid": 2, "at": 1, "token": "bobs"}, f)
        self.assertFalse(l.release())
        self.assertTrue(os.path.exists(p))
        with open(p) as f:
            self.assertEqual(json.load(f)["token"], "bobs")

    def test_keepalive_keeps_a_long_lock_fresh(self):
        holder = Lock("long", stale=1.0, keepalive=True).acquire()
        try:
            time.sleep(1.6)
            with self.assertRaises(LockTimeout):
                Lock("long", stale=1.0, timeout=0.5).acquire()
        finally:
            self.assertTrue(holder.release())

    def test_threads_in_one_process(self):
        box = {"n": 0}

        def work():
            for _ in range(25):
                with Lock("t"):
                    v = box["n"]
                    time.sleep(0.001)
                    box["n"] = v + 1
        ts = [threading.Thread(target=work) for _ in range(4)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(box["n"], 100)


if __name__ == "__main__":
    unittest.main()
