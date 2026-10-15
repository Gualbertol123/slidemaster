#!/usr/bin/env python3
"""Load test of Slide Builder 4's deck storage, through REAL v4 helpers (Python standard library only).

One helper process per simulated user (SLIDEBUILDER_USER=userK), all on one ROOT + data folder, like N PCs on
one share. Each user is driven over HTTP the way the core's DocSync v4 drives its helper (core/src/sync/docsync.ts):

* an edit every 1-3 s (``--think``; the burst scenario 0.3-0.9 s), 20 % of them on a cell somebody else also edits;
* 300 ms debounce, ONE record per batch, one append in flight, the same record sent again after a failure
  (2-32 s back-off) - an edit counts as saved ("acknowledged") when its append returned;
* a tail every 1.5 s from the offsets read so far; a newer snapshot (gen) is loaded;
* presence v2 every 10 s;
* in the ``compaction`` scenario one user compacts every ``--compact-every`` s while everybody edits.

The records carry this tool's own toy operations (``{"k": cell, "v": value}``): the helper never looks inside a
record, and the toy fold (last writer in (l, w, s) order wins per cell, one copy per (w, s)) stands in for the core's.

Measured (docs/next/05 §3.5): save = the append's round trip, visible = from an edit to another user's tail that
brings it, lost = acknowledged edits missing from the final document, converged = every user's final document the
same, gen strictly increasing, the largest journal before compaction.

Latency of the share: ``--fs-ms 0 15 40`` runs the helpers with ``SLIDEBUILDER_SIM_FS_MS`` (helper/slidebuilder/simfs.py:
every SMB round trip of the data folder sleeps that long, +-25 %; for the decks also every read and write on an open
handle, as docs/next/04 §2.5). ``--real-folder "T:\\Slide Builder"`` uses a real share instead (a temporary
sub-folder, deleted afterwards) - for people, before the cut-over.

    python tools/loadtest4.py --ci                         the CI job: 20 users at 15 and 40 ms, the 05 §3.5 criteria
    python tools/loadtest4.py --scenario same --users 10 20 --fs-ms 0 15 40 --duration 30
    python tools/loadtest4.py --real-folder "T:\\Slide Builder" --scenario same --users 10 --duration 120
"""
import argparse
import http.client
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ENTRY = os.path.join(REPO, "helper", "slide_builder.py")
TOKEN_RE = re.compile(r'<meta\s+name="sb-token"\s+content="([^"]+)"')
STUB_PAGE = '<!doctype html><meta name="sb-token" content="__SB_TOKEN__"><title>load test</title>'
# 05 §3.5 (and PLAN Part F): save p95 < 150 ms, visible p95 < 4 s, nothing lost, every view the same
LIMITS = {"save_p95": 150, "visible_p95": 4000, "journal_mb": 2.0}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def pct(values, p):
    v = sorted(values)
    return round(v[min(len(v) - 1, int(len(v) * p))]) if v else None


class Helper:
    def __init__(self, k, root, data, fs_ms, app_file, entry=ENTRY, storage=None):
        self.k, self.user = k, "user%02d" % k
        env = dict(os.environ, SLIDEBUILDER_ROOT=root, SLIDEBUILDER_DATA=data, SLIDEBUILDER_USER=self.user, SLIDEBUILDER_HOST="pc%02d" % k,
                   SLIDEBUILDER_APP_FILE=app_file, SLIDEBUILDER_APP_WINDOW="0", PYTHONUNBUFFERED="1", NO_PROXY="*")
        env.pop("SLIDEBUILDER_SIM_FS_MS", None)
        if fs_ms is not None:
            env["SLIDEBUILDER_SIM_FS_MS"] = str(fs_ms)
        if storage:
            env["SLIDEBUILDER_STORAGE"] = storage
        self.port, self.token, self.lines = free_port(), None, []
        self.proc = subprocess.Popen([sys.executable, "-u", entry, "--port", str(self.port), "--no-browser"], stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, cwd=os.path.dirname(entry))
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in iter(self.proc.stdout.readline, b""):
            self.lines = (self.lines + [raw.decode("utf-8", "replace").rstrip()])[-60:]

    def wait_ready(self, timeout=90):
        end = time.time() + timeout
        while time.time() < end:
            try:
                st, body = self.call("GET", "/", raw=True)
                m = TOKEN_RE.search(body.decode("utf-8", "replace"))
                if st == 200 and m:
                    self.token = m.group(1)
                    return
            except OSError:
                pass
            time.sleep(0.2)
        raise RuntimeError("helper %d did not start:\n%s" % (self.k, "\n".join(self.lines)))

    def call(self, method, path, body=None, raw=False, timeout=60):
        h = {"Host": "127.0.0.1:%d" % self.port}
        if self.token:
            h["X-SB-Token"] = self.token
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        try:
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            out = r.read()
        finally:
            c.close()
        if raw:
            return r.status, out
        return r.status, (json.loads(out) if out else None)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def toy_fold(snapshot_doc, records):
    """the tool's own model: {cell: value}; the last record in (l, w, s) order wins; one copy per (w, s)"""
    doc = dict(snapshot_doc.get("cells") or {})
    seen = set()
    for r in sorted(records, key=lambda r: (r["l"], r["w"], r["s"])):
        if (r["w"], r["s"]) in seen:
            continue
        seen.add((r["w"], r["s"]))
        for op in r.get("ops") or []:
            doc[op["k"]] = op["v"]
    return doc


class User:
    """one person: a page session on helper `h`, editing deck `wb`"""

    def __init__(self, k, h, wb, run):
        self.k, self.h, self.wb, self.run = k, h, wb, run
        self.rand = random.Random(1000 + k)
        self.lock = threading.Lock()
        self.pending, self.inflight = [], None
        self.lamport, self.seq, self.n = 0, 0, 0
        self.offsets, self.records = {}, {}             # journal -> offset; (w, s) -> record
        self.snap = None
        self.acked, self.saves, self.errors = [], [], []
        self.seen_ops = set()
        self.compactions = []                           # (status, ms, start, end)
        self.prepared = False
        self.last_edit = 0.0
        self.gens_seen = []                             # every gen this page's tails and snapshot loads told it

    # ---------------------------------------------------------------- the deck
    def open(self):
        st, o = self.h.call("POST", "/api/decks/open", {"workbook": self.wb})
        if st != 200:
            raise RuntimeError("open %s: %s %s" % (self.wb, st, o))
        self.key, self.writer = o["key"], o["writer"]
        self.base = "/api/decks/" + urllib.parse.quote(self.key, safe="")
        self.rebase(o["snapshot"])

    def rebase(self, snap):
        self.snap = snap
        self.gens_seen.append(snap["gen"])
        for j, off in (snap.get("frontier") or {}).items():
            self.offsets[j] = max(self.offsets.get(j, 0), off)
        held = set(map(tuple, (snap["doc"].get("ids") or [])))
        self.records = {k: v for k, v in self.records.items() if k not in held}
        self.lamport = max(self.lamport, snap.get("lamport") or 0)

    def tail(self):
        t0 = time.time()
        st, t = self.h.call("GET", self.base + "/tail?since=" + urllib.parse.quote(json.dumps(self.offsets)))
        if st != 200:
            self.errors.append("tail %s" % st)
            return
        now = time.time()
        for j, v in t["journals"].items():
            for r in v["records"]:
                self.lamport = max(self.lamport, r["l"])
                if (r["w"], r["s"]) in set(map(tuple, self.snap["doc"].get("ids") or [])):
                    continue
                self.records[(r["w"], r["s"])] = r
                for op in r["ops"]:
                    if op["id"] not in self.seen_ops:
                        self.seen_ops.add(op["id"])
                        if r["w"] != self.writer:
                            self.run.visible.append((now - op["t"]) * 1000)
            self.offsets[j] = max(self.offsets.get(j, 0), v["offset"])
        if t.get("gen"):
            self.gens_seen.append(t["gen"])
        if t.get("gen") and t["gen"] > self.snap["gen"]:
            st, s = self.h.call("GET", self.base + "/snapshot")
            if st == 200 and s["snapshot"]["gen"] > self.snap["gen"]:
                self.rebase(s["snapshot"])
        self.run.tail_ms.append((time.time() - t0) * 1000)

    def compact(self):
        """what a page does: everything read so far folded into gen + 1 (the toy document lists the record ids)"""
        self.tail()
        held = [k for k in self.records]
        ids = sorted(set(map(tuple, self.snap["doc"].get("ids") or [])) | set(held))
        cells = toy_fold(self.snap["doc"], list(self.records.values()))
        snap = dict(self.snap, gen=self.snap["gen"] + 1, frontier=dict(self.offsets), lamport=self.lamport,
                    rev=(self.snap.get("rev") or 0) + len(held), doc=dict(self.snap["doc"], cells=cells, ids=[list(x) for x in ids]))
        t0 = time.time()
        st, r = self.h.call("POST", self.base + "/compact", {"baseGen": self.snap["gen"], "snapshot": snap}, timeout=120)
        t1 = time.time()
        self.compactions.append((st, (t1 - t0) * 1000, t0, t1))
        if st == 200:
            self.rebase(dict(snap, frontier={j: v for j, v in snap["frontier"].items() if j not in (r.get("dropped") or [])}))
            self.run.gens.append(snap["gen"])

    # ---------------------------------------------------------------- the person
    def editor(self, stop, think):
        while not stop.is_set():
            time.sleep(self.rand.uniform(*think))
            if stop.is_set():
                break
            self.n += 1
            shared = self.rand.random() < 0.2
            cell = ("Z%d" % self.rand.randint(1, 5)) if shared else ("C%d_%s" % (self.n, self.k))
            op = {"k": cell, "v": "%s:%d" % (self.k, self.n), "id": "%s#%d" % (self.k, self.n), "t": time.time(), "own": not shared}
            with self.lock:
                self.pending.append(op)
                self.last_edit = time.time()
                first = not self.prepared
                self.prepared = True
            if first:                                           # as DocSync: the journal opened during the debounce
                try:
                    self.h.call("POST", self.base + "/prepare", {"writer": self.writer})
                except OSError:
                    pass

    def saver(self, until):
        backoff = 0
        while time.time() < until:
            time.sleep(0.05)
            with self.lock:                                     # the debounce: 300 ms after the last edit
                if self.inflight is None and self.pending and time.time() - self.last_edit >= 0.3:
                    self.lamport += 1
                    self.seq += 1
                    self.inflight = {"l": self.lamport, "w": self.writer, "s": self.seq, "by": self.h.user, "ops": self.pending}
                    self.pending = []
                rec = self.inflight
            if rec is None:
                continue
            t0 = time.time()
            try:
                st, r = self.h.call("POST", self.base + "/append", {"writer": self.writer, "record": rec})
            except OSError as e:
                st, r = 0, str(e)
            ms = (time.time() - t0) * 1000
            if st == 200:
                self.saves.append(ms)
                self.run.saves.append(ms)
                self.run.save_times.append((t0, t0 + ms / 1000.0, ms))
                self.acked.extend(op for op in rec["ops"] if op["own"])
                with self.lock:
                    self.inflight = None
                backoff = 0
            else:
                self.errors.append("append %s %s" % (st, str(r)[:80]))
                backoff = min(backoff + 1, 5)
                time.sleep(min(2 ** backoff, 32) if st not in (409, 423) else 1e9)

    def poller(self, until):
        while time.time() < until:
            time.sleep(1.5)
            try:
                self.tail()
            except OSError as e:
                self.errors.append("tail %s" % e)

    def presence(self, until):
        while time.time() < until:
            try:
                self.h.call("POST", "/api/presence", {"deck": self.key, "client": "c%02d" % self.k})
            except OSError:
                pass
            time.sleep(10)


class Run:
    def __init__(self, scenario, users, fs_ms, duration, real_folder=None, entry=ENTRY, think=(1.0, 3.0), compact_every=10.0, storage=None, verbose=True):
        self.scenario, self.n, self.fs_ms, self.duration = scenario, users, fs_ms, duration
        self.real_folder, self.entry, self.think, self.compact_every, self.storage, self.verbose = real_folder, entry, think, compact_every, storage, verbose
        self.saves, self.visible, self.tail_ms, self.gens, self.save_times = [], [], [], [], []

    def log(self, msg):
        if self.verbose:
            print(msg, flush=True)

    def execute(self):
        base = tempfile.mkdtemp(prefix="sb-load4-", dir=self.real_folder or None)
        root, data = os.path.join(base, "root"), os.path.join(base, "data")
        os.makedirs(root)
        os.makedirs(data)
        app = os.path.join(base, "page.html")
        with open(app, "w", encoding="utf-8") as f:
            f.write(STUB_PAGE)
        fs_ms = None if self.real_folder else self.fs_ms
        helpers = [Helper(k, root, data, fs_ms, app, self.entry, self.storage) for k in range(self.n)]
        try:
            for h in helpers:
                h.wait_ready()
            books = ["Deck%02d.xlsx" % k for k in range(self.n)] if self.scenario == "different" else ["Shared deck.xlsx"]
            users = [User(k, h, books[k % len(books)], self) for k, h in enumerate(helpers)]
            for u in users:
                u.open()
            self.log("  %d helpers ready on %s; editing for %d s" % (self.n, "the real folder" if self.real_folder else "%s ms" % self.fs_ms, self.duration))
            stop, drain = threading.Event(), 8.0
            t_end = time.time() + self.duration
            threads = []
            for u in users:
                threads += [threading.Thread(target=u.editor, args=(stop, self.think), daemon=True),
                            threading.Thread(target=u.saver, args=(t_end + drain,), daemon=True),
                            threading.Thread(target=u.poller, args=(t_end + drain,), daemon=True),
                            threading.Thread(target=u.presence, args=(t_end,), daemon=True)]
            compactor = users[-1]
            if self.scenario == "compaction":
                def compacting():
                    while time.time() < t_end:
                        time.sleep(self.compact_every)
                        try:
                            compactor.compact()
                        except OSError as e:
                            compactor.errors.append("compact %s" % e)
                threads.append(threading.Thread(target=compacting, daemon=True))
            for t in threads:
                t.start()
            journal_max = 0
            while time.time() < t_end:
                time.sleep(1)
                if self.scenario == "burst":
                    journal_max = max(journal_max, self.journal_bytes(data))
            stop.set()
            for t in threads:
                t.join(drain + 60)
            journal_max = max(journal_max, self.journal_bytes(data))
            for u in users:                                     # every user reads everything there is
                u.tail()
                u.tail()
            return self.collect(users, journal_max)
        finally:
            for h in helpers:
                h.stop()
            shutil.rmtree(base, ignore_errors=True)

    @staticmethod
    def journal_bytes(data):
        """the largest deck's journals together (bytes)"""
        top = os.path.join(data, "v4", "decks")
        most = 0
        for d in os.listdir(top) if os.path.isdir(top) else []:
            j, n = os.path.join(top, d, "j"), 0
            for f in os.listdir(j) if os.path.isdir(j) else []:
                try:
                    n += os.path.getsize(os.path.join(j, f))
                except OSError:
                    pass
            most = max(most, n)
        return most

    def collect(self, users, journal_max):
        by_deck = {}
        for u in users:
            by_deck.setdefault(u.wb, []).append(u)
        lost = 0
        converged = True
        for wb, us in by_deck.items():
            finals = [json.dumps(toy_fold(u.snap["doc"], list(u.records.values())), sort_keys=True) for u in us]
            converged = converged and len(set(finals)) == 1
            final = json.loads(finals[0])
            for u in us:
                lost += sum(1 for op in u.acked if final.get(op["k"]) != op["v"])
        compactions = [c for u in users for c in u.compactions]
        errs = [e for u in users for e in u.errors]
        ok_c = [c for c in compactions if c[0] == 200]
        during = [ms for (a, b, ms) in self.save_times if any(a < c[3] and b > c[2] for c in ok_c)]
        gens_back = [u.h.user for u in users if any(y < x for x, y in zip(u.gens_seen, u.gens_seen[1:]))]
        undrained = [u.h.user for u in users if u.pending or u.inflight]
        no_saves = [u.h.user for u in users if not u.saves]
        # bytes per record on the share (the largest deck), at the compaction threshold of 2 000 records
        per_deck = max((sum(len(u.saves) for u in us) for us in by_deck.values()), default=0)
        per_record = journal_max / max(1, per_deck)
        res = {"scenario": self.scenario, "users": self.n, "fs_ms": "real" if self.real_folder else self.fs_ms,
               "saves": len(self.saves), "save_p50": pct(self.saves, .5), "save_p95": pct(self.saves, .95),
               "visible_p50": pct(self.visible, .5), "visible_p95": pct(self.visible, .95), "tail_p95": pct(self.tail_ms, .95),
               "lost": lost, "converged": converged, "errors": len(errs), "error_examples": errs[:3],
               "journal_max_mb": round(journal_max / 1048576.0, 3), "journal_at_2000_mb": round(per_record * 2000 / 1048576.0, 3),
               "gens": self.gens, "gens_back": gens_back, "compactions": [[c[0], round(c[1])] for c in compactions],
               "compactions_ok": len(ok_c), "compactions_409": sum(1 for c in compactions if c[0] == 409),
               "saves_during_compaction": len(during), "save_p95_during_compaction": pct(during, .95),
               "save_max_during_compaction": round(max(during)) if during else None,
               "undrained": undrained, "no_saves": no_saves, "simulated": not self.real_folder}
        res["pass"] = self.verdict(res)
        return res

    def verdict(self, r):
        """05 §3.5 for this scenario: [] when it passes, else the reasons"""
        bad = []
        if r["save_p95"] is None or r["save_p95"] >= LIMITS["save_p95"]:
            bad.append("save p95 %s ms (< %d)" % (r["save_p95"], LIMITS["save_p95"]))
        if r["scenario"] != "different" and (r["visible_p95"] is None or r["visible_p95"] >= LIMITS["visible_p95"]):
            bad.append("visible p95 %s ms (< %d)" % (r["visible_p95"], LIMITS["visible_p95"]))
        if r["lost"]:
            bad.append("%d acknowledged edits lost" % r["lost"])
        if not r["converged"]:
            bad.append("views differ")
        if r["undrained"]:
            bad.append("edits never saved by %s" % ", ".join(r["undrained"]))
        if r["no_saves"]:
            bad.append("no save at all by %s" % ", ".join(r["no_saves"]))
        if r["simulated"] and r["errors"]:
            bad.append("%d errors (e.g. %s)" % (r["errors"], r["error_examples"][:1]))
        if r["gens_back"]:
            bad.append("a snapshot went back for %s" % ", ".join(r["gens_back"]))
        if r["scenario"] == "burst" and r["journal_at_2000_mb"] >= LIMITS["journal_mb"]:
            bad.append("%s MB of journals at 2 000 records (before compaction)" % r["journal_at_2000_mb"])
        if r["scenario"] == "compaction":
            gens = r["gens"]
            if r["compactions_ok"] < 2:
                bad.append("only %d compactions succeeded" % r["compactions_ok"])
            if gens != list(range(gens[0], gens[0] + len(gens))) if gens else False:
                bad.append("compactions' gens not one after the other: %s" % gens)
            if r["saves_during_compaction"] and r["save_max_during_compaction"] >= LIMITS["save_p95"]:
                bad.append("a save waited on a compaction (%s ms)" % r["save_max_during_compaction"])
        return bad


CI_RUNS = [("same", 20, 15, None), ("same", 20, 40, None), ("different", 20, 40, None), ("burst", 20, 15, (0.3, 0.9)), ("compaction", 20, 40, None)]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Load test of Slide Builder 4's deck storage (docs/next/05 §3.5)")
    ap.add_argument("--scenario", nargs="+", default=["same"], choices=["same", "different", "burst", "compaction"])
    ap.add_argument("--users", type=int, nargs="+", default=[10, 20])
    ap.add_argument("--fs-ms", type=float, nargs="+", default=[0, 15, 40])
    ap.add_argument("--duration", type=float, default=30)
    ap.add_argument("--compact-every", type=float, default=10)
    ap.add_argument("--real-folder", default=None, help="a folder on the real share (a temporary sub-folder is used and deleted)")
    ap.add_argument("--helper", default=ENTRY, help="the helper to run (default: this checkout's helper/slide_builder.py)")
    ap.add_argument("--storage", default=None, choices=["journal", "lean-lock"], help="the helpers' storage mode (SLIDEBUILDER_STORAGE)")
    ap.add_argument("--ci", action="store_true", help="the CI job: 20 users at 15 and 40 ms in every scenario; exit 1 when a criterion fails")
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    runs = []
    if a.ci:
        runs = [(sc, u, ms, think) for sc, u, ms, think in CI_RUNS]
    else:
        for sc in a.scenario:
            for u in a.users:
                for ms in ([None] if a.real_folder else a.fs_ms):
                    runs.append((sc, u, ms, (0.3, 0.9) if sc == "burst" else None))
    results = []
    for sc, u, ms, think in runs:
        print("%s - %d users - %s" % (sc, u, "real folder" if a.real_folder else "%g ms" % ms), flush=True)
        r = Run(sc, u, ms, a.duration, a.real_folder, a.helper, think or (1.0, 3.0), a.compact_every, a.storage).execute()
        results.append(r)
        print(json.dumps({k: v for k, v in r.items() if k not in ("compactions",)}), flush=True)
    print()
    print("%-11s %5s %6s %6s %10s %10s %13s %5s %9s %s" % ("scenario", "users", "fs ms", "saves", "save p50", "save p95", "visible p50/95", "lost", "converged", "result"))
    for r in results:
        print("%-11s %5d %6s %6d %10s %10s %13s %5d %9s %s" % (r["scenario"], r["users"], r["fs_ms"], r["saves"], r["save_p50"], r["save_p95"],
              "%s/%s" % (r["visible_p50"], r["visible_p95"]), r["lost"], r["converged"], "PASS" if not r["pass"] else "FAIL: " + "; ".join(r["pass"])))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1)
    return 1 if any(r["pass"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
