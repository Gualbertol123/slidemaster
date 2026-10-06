#!/usr/bin/env python3
"""Load test of the shared-folder storage, through the real helper (Python standard library only).

Starts one helper process per simulated user (SLIDEBUILDER_USER=userK, SLIDEBUILDER_HOST=pcK), all
sharing one ROOT + data folder - exactly like N PCs that run Slide Builder from the same share - and
drives them over HTTP the way the app does:

* an edit every 1-3 s (human jitter): mostly ``cell.patch``, sometimes ``slide.patch`` / ``style.patch``;
  edits are queued and sent like the app's DocSync: 300 ms debounce, one request in flight, the
  operations queued meanwhile go in the next batch, failures are retried with 2-32 s back-off;
* ``GET .../doc?since=<rev>`` every 3 s (skipped while a save is in flight, like the app);
* ``POST /api/presence`` every 10 s.

Scenarios: ``same`` (everybody on one workbook), ``different`` (one workbook each), ``mixed`` (half
and half). Measured: ops/s, POST .../ops latency, lock wait vs. work under the lock (``X-SB-Timing``),
file-system round trips per save, time until another user sees an edit, errors, and a final check that
every acknowledged operation is in the document.

Latency of the share
--------------------
``--fs-ms 0 5 15 40`` runs the helpers with ``SLIDEBUILDER_SIM_FS_MS`` - a SIMULATION that sleeps that
many ms (+-25 %) before each data-folder file operation that would be an SMB round trip (see
backend/slidebuilder/simfs.py). ``--real-folder T:\\Slide Builder`` instead uses a real share (a
temporary sub-folder that is deleted afterwards) with no simulated latency.

Examples
  python tools/loadtest.py                                    # 10 users, all scenarios, 60 s, no latency
  python tools/loadtest.py --fs-ms 0 5 15 40 --scenario same different --duration 30 --json out.json
  python tools/loadtest.py --real-folder "T:\\Slide Builder" --scenario same --duration 120
"""
import argparse
import http.client
import json
import os
import random
import re
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ENTRY = os.path.join(REPO, "backend", "slide_builder.py")
APP_FILE = os.path.join(REPO, "backend", "slide_builder.html")
TOKEN_RE = re.compile(r'<meta\s+name="sb-token"\s+content="([^"]+)"')
STUB_PAGE = '<!DOCTYPE html><html><head><meta name="sb-token" content="__SB_TOKEN__"></head><body>load test</body></html>'
SLIDES = ["s1", "s2", "s3", "s4"]
POLL_S, PRESENCE_S, DEBOUNCE_S = 3.0, 10.0, 0.3


# --------------------------------------------------------------------------- helpers (processes)
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Helper:
    def __init__(self, k, root, data, fs_ms, app_file):
        self.k, self.user = k, "user%d" % k
        env = dict(os.environ, SLIDEBUILDER_ROOT=root, SLIDEBUILDER_DATA=data, SLIDEBUILDER_USER=self.user,
                   SLIDEBUILDER_HOST="pc%d" % k, SLIDEBUILDER_ENGINES="none", SLIDEBUILDER_TIMING="1",
                   PYTHONUNBUFFERED="1")
        env.pop("SLIDEBUILDER_SIM_FS_MS", None)
        if fs_ms is not None:
            env["SLIDEBUILDER_SIM_FS_MS"] = str(fs_ms)
        if app_file:
            env["SLIDEBUILDER_APP_FILE"] = app_file
        self.port = None
        self.lines = []
        self.proc = subprocess.Popen([sys.executable, "-u", ENTRY, "--port", str(free_port()), "--no-browser"],
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                     env=env, cwd=os.path.dirname(ENTRY))
        self._found = threading.Event()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in iter(self.proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip()
            self.lines = (self.lines + [line])[-50:]
            m = re.search(r"Open\s*:\s*http://127\.0\.0\.1:(\d+)/", line)
            if m:
                self.port = int(m.group(1))
                self._found.set()

    def wait_ready(self, timeout=60):
        if not self._found.wait(timeout):
            raise RuntimeError("helper %d did not start:\n%s" % (self.k, "\n".join(self.lines)))
        status, _, body = request(self.port, None, "GET", "/")
        m = TOKEN_RE.search(body.decode("utf-8", "replace"))
        if status != 200 or not m:
            raise RuntimeError("helper %d: no <meta name=\"sb-token\"> in GET / (status %s)" % (self.k, status))
        self.token = m.group(1)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def request(port, token, method, path, body=None, timeout=60):
    """(status, headers, body bytes). Raises OSError for connection problems."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        headers = {"Host": "127.0.0.1:%d" % port}
        if token:
            headers["X-SB-Token"] = token
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=headers)
        r = conn.getresponse()
        return r.status, dict(r.getheaders()), r.read()
    finally:
        conn.close()


def wb_path(name):
    from urllib.parse import quote
    return "/api/workbooks/%s" % quote(name, safe="")


def parse_timing(h):
    out = {}
    for part in (h or "").split(";"):
        k, _, v = part.partition("=")
        try:
            out[k.strip()] = float(v)
        except ValueError:
            pass
    return out


# --------------------------------------------------------------------------- one simulated user
class User:
    def __init__(self, k, helper, workbook, run):
        self.k, self.h, self.wb, self.run = k, helper, workbook, run
        self.client = uuid.uuid4().hex[:12]
        self.sheet = "u%d" % k
        self.cv = threading.Condition()
        self.pending = []            # [(op, t_created)]
        self.inflight = False
        self.rev = 0
        self.seq = 0
        self.retry = 0
        self.acked_cells = set()
        self.observations = []       # [(t, rev)] - when this user's view reached a revision
        self.post_ms, self.poll_ms = [], []
        self.timings = []
        self.batch_sizes = []
        self.errors = {}
        self.posts = 0
        self.rng = random.Random(1000 + k)

    # ---- edits
    def make_op(self):
        x = self.rng.random()
        if x < 0.85:
            self.seq += 1
            return {"op": "cell.patch", "sheet": self.sheet, "ref": "A%d" % self.seq,
                    "patch": {"text": "v%d" % self.seq, "orig": "o", "b": self.seq % 2 == 0}}
        if x < 0.95:
            return {"op": "slide.patch", "id": self.rng.choice(SLIDES), "patch": {"title": "%s %d" % (self.sheet, self.seq)}}
        return {"op": "style.patch", "patch": {"color": self.rng.randint(0, 100)}}

    def editor(self, stop):
        time.sleep(self.rng.uniform(0, 3))
        while not stop.is_set():
            with self.cv:
                self.pending.append((self.make_op(), time.monotonic()))
                self.cv.notify_all()
            stop.wait(self.rng.uniform(*self.run.think))

    def flusher(self, drain_until):
        while True:
            with self.cv:
                while not self.pending:
                    if self.run.editing_done.is_set():
                        return
                    self.cv.wait(0.2)
            time.sleep(DEBOUNCE_S)
            with self.cv:
                batch, self.pending = self.pending, []
                self.inflight = True
            ok = self.post(batch)
            with self.cv:
                self.inflight = False
                if not ok:
                    self.pending = batch + self.pending
            if not ok:
                delay = 2.0 ** self.retry
                if time.monotonic() + delay > drain_until():
                    return
                time.sleep(delay)
            elif self.pending:
                time.sleep(0.05)
            if time.monotonic() > drain_until():
                return

    def _err(self, what):
        self.errors[what] = self.errors.get(what, 0) + 1

    def post(self, batch):
        t0 = time.monotonic()
        self.posts += 1
        try:
            status, headers, body = request(self.h.port, self.h.token, "POST", wb_path(self.wb) + "/ops",
                                            {"ops": [b[0] for b in batch], "client": self.client})
        except OSError as e:
            self._err("connection: %s" % type(e).__name__)
            self.retry = min(self.retry + 1, 5)
            return False
        t1 = time.monotonic()
        if status != 200:
            self._err("HTTP %d" % status)
            self.retry = min(self.retry + 1, 5)
            return False
        self.retry = 0
        res = json.loads(body.decode("utf-8"))
        rev = res["doc"]["rev"]
        self.post_ms.append((t1 - t0) * 1000.0)
        self.batch_sizes.append(len(batch))
        timing = parse_timing(headers.get("X-SB-Timing"))
        if timing:
            self.timings.append(timing)
        for op, _ in batch:
            if op["op"] == "cell.patch":
                self.acked_cells.add(op["ref"])
        self.run.register_rev(self.wb, rev, self.k, min(t for _, t in batch), len(batch))
        self.rev = max(self.rev, rev)
        self.observations.append((t1, rev))
        return True

    # ---- polling and presence
    def poller(self, stop):
        time.sleep(self.rng.uniform(0, POLL_S))
        while not stop.is_set():
            if not self.inflight:
                t0 = time.monotonic()
                try:
                    status, _, body = request(self.h.port, self.h.token, "GET", wb_path(self.wb) + "/doc?since=%d" % self.rev)
                    t1 = time.monotonic()
                    if status in (200, 204):
                        self.poll_ms.append((t1 - t0) * 1000.0)
                        if status == 200:
                            rev = json.loads(body.decode("utf-8"))["doc"]["rev"]
                            if not self.inflight:
                                self.rev = max(self.rev, rev)
                            self.observations.append((t1, rev))
                    else:
                        self._err("poll HTTP %d" % status)
                except OSError as e:
                    self._err("poll connection: %s" % type(e).__name__)
            stop.wait(POLL_S)

    def presence(self, stop):
        time.sleep(self.rng.uniform(0, PRESENCE_S))
        while not stop.is_set():
            try:
                status, _, _ = request(self.h.port, self.h.token, "POST", "/api/presence",
                                       {"client": self.client, "workbook": self.wb})
                if status != 200:
                    self._err("presence HTTP %d" % status)
            except OSError as e:
                self._err("presence connection: %s" % type(e).__name__)
            stop.wait(PRESENCE_S)


# --------------------------------------------------------------------------- one run
def pct(values, p):
    if not values:
        return None
    v = sorted(values)
    i = min(len(v) - 1, max(0, int(round(p / 100.0 * (len(v) - 1)))))
    return v[i]


def seed_backups(data, books, n):
    """Steady state of a workbook in use for hours: n old backups (the helper keeps the last 30, at
    most one per 5 minutes). Every save looks at their modification times."""
    sys.path.insert(0, os.path.dirname(ENTRY))
    from slidebuilder.util import doc_key
    old = time.time() - 3600
    for wb in books:
        folder = os.path.join(data, "backups", doc_key(wb))
        os.makedirs(folder, exist_ok=True)
        for rev in range(2, n + 2):
            p = os.path.join(folder, "%d.json" % rev)
            with open(p, "w") as f:
                f.write("{}")
            os.utime(p, (old, old))


def workbooks_for(scenario, n):
    if scenario == "same":
        return ["Team.xlsx"] * n
    if scenario == "different":
        return ["Book%d.xlsx" % k for k in range(n)]
    if scenario == "mixed":
        half = n // 2
        return ["Team.xlsx"] * half + ["Book%d.xlsx" % k for k in range(half, n)]
    raise ValueError(scenario)


class Run:
    def __init__(self, scenario, users, duration, fs_ms, real_folder=None, verbose=True, backups=0):
        self.scenario, self.n, self.duration, self.fs_ms = scenario, users, duration, fs_ms
        self.backups = backups
        self.think = (1.0, 3.0)
        self.real_folder, self.verbose = real_folder, verbose
        self.revs = {}                       # workbook -> {rev: (author k, t_edit, n ops)}
        self.revs_lock = threading.Lock()
        self.editing_done = threading.Event()
        self.drain_deadline = None

    def register_rev(self, wb, rev, k, t_edit, nops):
        with self.revs_lock:
            self.revs.setdefault(wb, {})[rev] = (k, t_edit, nops)

    def log(self, msg):
        if self.verbose:
            print(msg, flush=True)

    def execute(self):
        if self.real_folder:
            base = os.path.join(self.real_folder, "sb-loadtest-%s" % uuid.uuid4().hex[:8])
            os.makedirs(base)
        else:
            base = tempfile.mkdtemp(prefix="sb-loadtest-")
        root, data = os.path.join(base, "root"), os.path.join(base, "root", "backend-data")
        os.makedirs(root, exist_ok=True)
        app_file = None
        if not os.path.exists(APP_FILE):
            app_file = os.path.join(base, "page.html")
            with open(app_file, "w", encoding="utf-8") as f:
                f.write(STUB_PAGE)
        fs_ms = self.fs_ms or 0              # 0 on a real folder: no added latency, but round trips are counted
        helpers = []
        try:
            self.log("  starting %d helpers (folder %s)..." % (self.n, base))
            helpers = [Helper(k, root, data, fs_ms, app_file) for k in range(self.n)]
            for h in helpers:
                h.wait_ready()
            books = workbooks_for(self.scenario, self.n)
            preset = {"sheets": [], "tables": [], "slides": [{"id": s, "type": "content", "tables": []} for s in SLIDES]}
            for wb in sorted(set(books)):
                status, _, _ = request(helpers[0].port, helpers[0].token, "POST", wb_path(wb) + "/ops",
                                       {"ops": [{"op": "preset.set", "preset": preset}], "client": "setup"})
                assert status == 200, status
            if self.backups:
                seed_backups(data, sorted(set(books)), self.backups)
            users = [User(k, helpers[k], books[k], self) for k in range(self.n)]
            for u in users:
                u.rev = 1
            stop_edit, stop_bg = threading.Event(), threading.Event()
            self.drain_deadline = float("inf")
            threads = []
            for u in users:
                threads += [threading.Thread(target=u.editor, args=(stop_edit,), daemon=True),
                            threading.Thread(target=u.flusher, args=(lambda: self.drain_deadline,), daemon=True),
                            threading.Thread(target=u.poller, args=(stop_bg,), daemon=True),
                            threading.Thread(target=u.presence, args=(stop_bg,), daemon=True)]
            t_start = time.monotonic()
            for t in threads:
                t.start()
            self.log("  running %s for %d s (fs latency: %s)..." % (self.scenario, self.duration,
                     "real folder" if self.real_folder else "%g ms simulated" % (fs_ms or 0)))
            time.sleep(self.duration)
            stop_edit.set()
            t_edit_end = time.monotonic()
            # drain: queued edits still get saved (like a user who stops typing); pollers keep running
            self.drain_deadline = t_edit_end + 30.0
            self.editing_done.set()
            for t in threads[1::4]:
                t.join(max(0.0, self.drain_deadline - time.monotonic()) + 1)
            time.sleep(POLL_S + 0.5)                 # one more poll round so others can see the last edits
            stop_bg.set()
            t_end = time.monotonic()
            return self.collect(users, helpers, t_start, t_edit_end, t_end)
        finally:
            for h in helpers:
                h.stop()
            shutil.rmtree(base, ignore_errors=True)

    def collect(self, users, helpers, t_start, t_edit_end, t_end):
        # final correctness: every acknowledged cell edit is in the final document
        lost, acked, unsent, final_docs = 0, 0, 0, {}
        for wb in sorted(set(u.wb for u in users)):
            status, _, body = request(helpers[0].port, helpers[0].token, "GET", wb_path(wb) + "/doc")
            final_docs[wb] = json.loads(body.decode("utf-8"))["doc"]
        for u in users:
            cells = final_docs[u.wb]["edits"].get(u.sheet, {})
            acked += len(u.acked_cells)
            lost += len([r for r in u.acked_cells if r not in cells])
            unsent += len([op for op, _ in u.pending if op["op"] == "cell.patch"])
        # time until other users see an edit (from the moment the edit was made)
        visible, not_seen = [], 0
        for wb, revs in self.revs.items():
            others_of = [u for u in users if u.wb == wb]
            for rev, (k, t_edit, _) in revs.items():
                for u in others_of:
                    if u.k == k:
                        continue
                    t_seen = next((t for t, r in sorted(u.observations) if r >= rev and t >= t_edit), None)
                    if t_seen is None:
                        not_seen += 1
                    else:
                        visible.append((t_seen - t_edit) * 1000.0)
        post_ms = [x for u in users for x in u.post_ms]
        poll_ms = [x for u in users for x in u.poll_ms]
        timings = [t for u in users for t in u.timings]
        ops_total = sum(sum(u.batch_sizes) for u in users)
        errors = {}
        for u in users:
            for k, v in u.errors.items():
                errors[k] = errors.get(k, 0) + v
        edit_s = t_edit_end - t_start

        def stats(vals):
            return {"n": len(vals), "p50": pct(vals, 50), "p95": pct(vals, 95), "p99": pct(vals, 99),
                    "max": max(vals) if vals else None, "mean": statistics.mean(vals) if vals else None}
        return {
            "scenario": self.scenario, "users": self.n, "duration_s": round(edit_s, 1), "backups": self.backups,
            "fs_ms": "real" if self.real_folder else self.fs_ms,
            "ops": ops_total, "ops_per_s": round(ops_total / edit_s, 2), "saves": len(post_ms),
            "saves_per_s": round(len(post_ms) / edit_s, 2),
            "ops_per_save": round(ops_total / len(post_ms), 2) if post_ms else None,
            "post_ms": stats(post_ms), "poll_ms": stats(poll_ms),
            "lock_wait_ms": stats([t["lock_wait_ms"] for t in timings if "lock_wait_ms" in t]),
            "write_ms": stats([t["write_ms"] for t in timings if "write_ms" in t]),
            "fs_ops_per_save": stats([t["fs_ops"] for t in timings if "fs_ops" in t]),
            "visible_ms": stats(visible), "not_seen": not_seen,
            "errors": errors, "errors_total": sum(errors.values()),
            "acked_cells": acked, "lost_cells": lost, "unsent_cells": unsent,
            "doc_bytes": {wb: len(json.dumps(d)) for wb, d in final_docs.items()},
        }


# --------------------------------------------------------------------------- report
def fmt(x, nd=0):
    if x is None:
        return "-"
    return ("%%.%df" % nd) % x


def print_table(results):
    cols = ["scenario", "fs ms", "ops/s", "saves/s", "ops/save", "POST p50", "p95", "p99", "max",
            "lock wait p50/p95", "write p50/p95", "SMB ops/save", "visible p50/p95", "errors", "lost"]
    rows = []
    for r in results:
        rows.append([r["scenario"], str(r["fs_ms"]), fmt(r["ops_per_s"], 2), fmt(r["saves_per_s"], 2), fmt(r["ops_per_save"], 2),
                     fmt(r["post_ms"]["p50"]), fmt(r["post_ms"]["p95"]), fmt(r["post_ms"]["p99"]), fmt(r["post_ms"]["max"]),
                     "%s / %s" % (fmt(r["lock_wait_ms"]["p50"]), fmt(r["lock_wait_ms"]["p95"])),
                     "%s / %s" % (fmt(r["write_ms"]["p50"]), fmt(r["write_ms"]["p95"])),
                     fmt(r["fs_ops_per_save"]["p50"]),
                     "%s / %s" % (fmt(r["visible_ms"]["p50"]), fmt(r["visible_ms"]["p95"])),
                     str(r["errors_total"]), "%d/%d" % (r["lost_cells"], r["acked_cells"])])
    print()
    print("| " + " | ".join(cols) + " |")
    print("|" + "|".join("---" for _ in cols) + "|")
    for row in rows:
        print("| " + " | ".join(row) + " |")
    print()
    print("Times in ms. 'lost' = acknowledged cell edits missing from the final document / acknowledged.")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Slide Builder shared-folder load test", formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split("Examples", 1)[1] if "Examples" in __doc__ else None)
    ap.add_argument("--users", type=int, default=10)
    ap.add_argument("--scenario", nargs="+", choices=["same", "different", "mixed"], default=["same", "different", "mixed"])
    ap.add_argument("--duration", type=float, default=60.0, help="seconds of editing per run (default 60)")
    ap.add_argument("--fs-ms", nargs="+", type=float, default=None,
                    help="SIMULATED ms per data-folder file operation, one run per value (default 0)")
    ap.add_argument("--real-folder", help="run against a real (network) folder instead of a temp folder; no simulated latency")
    ap.add_argument("--think", nargs=2, type=float, default=[1.0, 3.0], metavar=("MIN", "MAX"),
                    help="seconds between two edits of one user (default 1 3; smaller = stress test)")
    ap.add_argument("--backups", type=int, default=0, help="seed N old backups per workbook (steady state is 30; default 0 = fresh folder)")
    ap.add_argument("--json", help="write all results to this file")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    if args.real_folder and args.fs_ms:
        ap.error("--real-folder measures the real share: do not combine it with --fs-ms")
    latencies = [None] if args.real_folder else (args.fs_ms or [0.0])
    results = []
    for ms in latencies:
        for sc in args.scenario:
            print("== scenario %s, %d users, %s" % (sc, args.users, "real folder %s" % args.real_folder if args.real_folder else "simulated %g ms" % ms), flush=True)
            run = Run(sc, args.users, args.duration, ms, args.real_folder, verbose=not args.quiet, backups=args.backups)
            run.think = tuple(args.think)
            r = run.execute()
            r["think_s"] = list(args.think)
            results.append(r)
            print("   ops/s %.2f, POST p50 %s ms p95 %s ms, lock wait p95 %s ms, visible p50 %s ms, errors %d, lost %d/%d"
                  % (r["ops_per_s"], fmt(r["post_ms"]["p50"]), fmt(r["post_ms"]["p95"]), fmt(r["lock_wait_ms"]["p95"]),
                     fmt(r["visible_ms"]["p50"]), r["errors_total"], r["lost_cells"], r["acked_cells"]), flush=True)
            if args.json:
                with open(args.json, "w", encoding="utf-8") as f:
                    json.dump(results, f, indent=1)
    print_table(results)
    bad = [r for r in results if r["lost_cells"]]
    if bad:
        print("ERROR: acknowledged edits are missing in %d run(s)!" % len(bad))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
