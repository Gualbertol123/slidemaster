"""Field test of the shared folder: the journal and the lean-lock protocols, from several PCs at once.
Python 3.8+, standard library only. Writes only into a new temporary sub-folder, deleted at the end.

On ONE PC (the coordinator):
    python tools/sharetest.py coordinator --folder "T:\\Slide Builder" --pcs 3 [--duration 60]
It prints a run id. On each of the other PCs, while the coordinator waits:
    python tools/sharetest.py worker --folder "T:\\Slide Builder" --run <id>
The coordinator also works itself. To try it on one machine (2-4 local processes):
    python tools/sharetest.py local --folder C:\\temp --workers 3 --duration 20

What runs (docs/next/04-data-and-migration.md §2, spikes/storage/journal_sim.py, now on real files)
  * round trips: create+write+fsync+close, open+read, stat, listdir, rename, delete (each 30 x), per PC;
  * "journal": every PC appends its edits (one every 1-3 s, 20 % to cells others edit too) to ITS OWN
    file j/<pc>.log (framed records, fsync), and every 1.5 s reads the others' files from the last offset;
  * "lock": the lean lock - lock file (O_EXCL) -> read deck.json -> write temp -> fsync -> rename -> unlock;
    readers poll deck.json every 3 s;
  * optional (--rdcw, Windows only): does a ReadDirectoryChangesW watch on j/ wake up when ANOTHER PC
    appends? (the hint of PLAN S6.3)
  Measured: save time p50/p95, time until the other PCs see an edit p50/p95 (on the file server's clock),
  and at the end of each protocol: every PC's final document must be identical (converged) and contain
  every acknowledged edit (lost = 0).
Start barrier: a file go-<phase>.json written by the coordinator when all PCs have reported ready.
Results: <run>/results/<pc>-<phase>.json, summarised and printed as ASCII and saved as sharetest-<run>.json in
the current folder (or --out); attach it to docs/next/field-results.md. A PC that stops ends the run with its name.
More writers than PCs: start 2-3 workers per PC (each with its own --name).
"""
import argparse
import hashlib
import json
import os
import random
import shutil
import socket
import statistics
import struct
import subprocess
import sys
import threading
import time
import uuid
import zlib

PHASES = ("journal", "lock")
POLL = {"journal": 1.5, "lock": 3.0}


def say(msg):
    print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p))], 1) if xs else None


def write_json(path, obj):
    tmp = "%s.%s.tmp" % (path, uuid.uuid4().hex[:8])
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
        f.flush()
        os.fsync(f.fileno())
    for _ in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:            # Windows: somebody is reading it right now
            time.sleep(0.1)
    os.replace(tmp, path)


class Unreadable(OSError):
    """the file exists but cannot be read now (sharing violation, antivirus, half written)"""


def read_json(path, retries=20):
    """the JSON in `path`; None when the file does not exist; Unreadable when it exists but cannot be read
    (never treat that as "empty": the lock protocol would then overwrite the deck)"""
    last = None
    for _ in range(retries):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            last = e
            time.sleep(0.1)
    raise Unreadable("%s cannot be read: %s" % (os.path.basename(path), last))


# --------------------------------------------------------------------------- the file server's clock
def server_offset(folder):
    """file-server time - local time, from the mtime of a file written there (median of 5)"""
    out = []
    for i in range(5):
        p = os.path.join(folder, ".clock-%s-%s" % (socket.gethostname(), uuid.uuid4().hex[:10]))
        t0 = time.time()
        with open(p, "wb") as f:
            f.write(b"x")
            f.flush()
            os.fsync(f.fileno())
        t1 = time.time()
        out.append(os.stat(p).st_mtime - (t0 + t1) / 2)
        os.remove(p)
    return statistics.median(out)


# --------------------------------------------------------------------------- framed records (as journal_sim.py)
def frame(rec):
    b = json.dumps(rec, separators=(",", ":")).encode()
    return b"%d:%08x:" % (len(b), zlib.crc32(b)) + b + b"\n"


def unframe(buf):
    out, p = [], 0
    while True:
        a = buf.find(b":", p)
        if a < 0:
            break
        try:
            n, crc = int(buf[p:a]), int(buf[a + 1:a + 9], 16)
        except ValueError:
            break
        body = buf[a + 10:a + 10 + n]
        if len(body) < n or buf[a + 10 + n:a + 11 + n] != b"\n" or zlib.crc32(body) != crc:
            break
        out.append(json.loads(body))
        p = a + 11 + n
    return out, p


def fold(records):
    doc = {}
    for r in sorted(records, key=lambda r: (r["l"], r["w"], r["s"])):
        for op in r["ops"]:
            doc.setdefault(op["ref"], {}).update(op["patch"])
    return doc


# --------------------------------------------------------------------------- round trips
def round_trips(folder, n=30):
    d = os.path.join(folder, "rtt-%s" % uuid.uuid4().hex[:6])
    os.makedirs(d)
    res = {k: [] for k in ("create_write_fsync", "open_read", "stat", "listdir", "rename", "delete")}

    def t(k, fn):
        t0 = time.perf_counter()
        fn()
        res[k].append((time.perf_counter() - t0) * 1000)
    for i in range(n):
        p, q = os.path.join(d, "f%d" % i), os.path.join(d, "g%d" % i)

        def cw(p=p):
            with open(p, "wb") as f:
                f.write(b"x" * 512)
                f.flush()
                os.fsync(f.fileno())

        def rd(p=p):
            with open(p, "rb") as f:
                f.read()
        t("create_write_fsync", cw)
        t("open_read", rd)
        t("stat", lambda p=p: os.stat(p))
        t("listdir", lambda: os.listdir(d))
        t("rename", lambda p=p, q=q: os.replace(p, q))
        t("delete", lambda q=q: os.remove(q))
    shutil.rmtree(d, ignore_errors=True)
    return {k: {"p50": pct(v, .5), "p95": pct(v, .95)} for k, v in res.items()}


# --------------------------------------------------------------------------- ReadDirectoryChangesW (Windows)
class DirWatch:
    """ReadDirectoryChangesW on `folder` (Windows): the time (server clock) of every change, per file name.
    The PC's own journal is ignored, so an event can only come from another PC's append."""

    def __init__(self, folder, offset, own):
        self.events, self.ok, self.error, self.own = {}, False, None, own
        self.handle, self.k32 = None, None
        if os.name != "nt":
            self.error = "not Windows"
            return
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        k32.CreateFileW.restype = wintypes.HANDLE
        k32.ReadDirectoryChangesW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, wintypes.BOOL, wintypes.DWORD,
                                              ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p, ctypes.c_void_p]
        k32.ReadDirectoryChangesW.restype = wintypes.BOOL
        k32.CancelIoEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        # FILE_LIST_DIRECTORY, share read/write/delete, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS
        h = k32.CreateFileW(folder, 0x0001, 0x7, None, 3, 0x02000000, None)
        if h is None or h == ctypes.c_void_p(-1).value:
            self.error = "CreateFileW failed (%d)" % ctypes.get_last_error()
            return
        self.handle, self.k32, self.ok = h, k32, True

        def loop():
            buf = ctypes.create_string_buffer(16384)
            got = wintypes.DWORD()
            while self.handle is not None:
                # FILE_NOTIFY_CHANGE_FILE_NAME | SIZE | LAST_WRITE
                if not k32.ReadDirectoryChangesW(h, buf, len(buf), False, 0x1 | 0x8 | 0x10, ctypes.byref(got), None, None):
                    if self.handle is not None:
                        self.error = "ReadDirectoryChangesW failed (%d)" % ctypes.get_last_error()
                    return
                t = time.time() + offset
                raw, pos = buf.raw[:got.value], 0
                while pos + 12 <= len(raw):           # FILE_NOTIFY_INFORMATION records
                    nxt, _action, nlen = struct.unpack_from("<III", raw, pos)
                    name = raw[pos + 12:pos + 12 + nlen].decode("utf-16-le", "replace")
                    if name != self.own:
                        self.events.setdefault(name, []).append(t)
                    if not nxt:
                        break
                    pos += nxt
        threading.Thread(target=loop, daemon=True).start()

    def close(self):
        h, self.handle = self.handle, None
        if h is not None:
            self.k32.CancelIoEx(h, None)
            self.k32.CloseHandle(h)


# --------------------------------------------------------------------------- one PC
class Worker:
    def __init__(self, run_dir, name, cfg):
        self.run, self.name, self.cfg = run_dir, name, cfg
        self.offset = server_offset(run_dir)

    def now(self):
        return time.time() + self.offset

    def prepare(self, proto):
        """before "ready": this PC's journal exists (and is listed) before anybody starts writing, so the first
        seconds are not measured against an SMB directory cache that does not know the file yet"""
        self.wid = "%s-%s" % (self.name, uuid.uuid4().hex[:4])
        self.jfile = None
        if proto == "journal":
            self.jfile = open(os.path.join(self.run, proto, "j", self.wid + ".log"), "ab")
            os.fsync(self.jfile.fileno())

    def phase(self, proto):
        deck = os.path.join(self.run, proto)
        jdir = os.path.join(deck, "j")
        docp = os.path.join(deck, "deck.json")
        wid, jfile = self.wid, self.jfile
        rng = random.Random(wid)
        t_start = self.now()
        pending, lock = [], threading.Lock()
        acked, vis, save_ms, lockwait, appends = [], [], [], [], []
        known, seen = set(), {}
        lamport, seq = [0], [0]
        stop = time.time() + self.cfg["duration"]
        drain = self.cfg["drain"]
        watch = DirWatch(jdir, self.offset, wid + ".log") if proto == "journal" and self.cfg.get("rdcw") else None
        vis_late = []                                  # edits made 10 s or more after the start

        def note(ops):
            t = self.now()
            for op in ops:
                if op["id"] not in known:
                    known.add(op["id"])
                    if not op["id"].startswith(wid):
                        vis.append((t - op["t"]) * 1000)
                        if op["t"] - t_start >= 10:
                            vis_late.append((t - op["t"]) * 1000)

        def j_save(ops):
            t0 = time.perf_counter()
            lamport[0] += 1
            seq[0] += 1
            jfile.write(frame({"l": lamport[0], "w": wid, "s": seq[0], "ops": ops, "at": self.now()}))
            jfile.flush()
            os.fsync(jfile.fileno())
            save_ms.append((time.perf_counter() - t0) * 1000)
            note(ops)

        def j_read():
            recs = []
            for n in sorted(os.listdir(jdir)):
                off, have = seen.get(n, (0, []))
                with open(os.path.join(jdir, n), "rb") as f:
                    f.seek(off)
                    buf = f.read()
                new, used = unframe(buf)
                if new:
                    seen[n] = (off + used, have + new)
                    for r in new:
                        lamport[0] = max(lamport[0], r["l"])
                        if r["w"] != wid:
                            appends.append([n, r["at"]])
                        note(r["ops"])
                recs.extend(seen.get(n, (0, []))[1])
            return recs

        def l_save(ops):
            t0 = time.perf_counter()
            lp = os.path.join(deck, "deck.lock")
            while True:
                try:
                    os.close(os.open(lp, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                    break
                except (FileExistsError, PermissionError):
                    if time.perf_counter() - t0 > 15:
                        raise TimeoutError("lock busy 15 s")
                    time.sleep(rng.uniform(0.01, 0.03))
            t1 = time.perf_counter()
            try:
                doc = read_json(docp)                      # Unreadable -> the save fails and is retried
                if doc is None:
                    doc = {"rev": 0, "recs": []}
                doc["rev"] += 1
                doc["recs"].append({"l": doc["rev"], "w": wid, "s": doc["rev"], "ops": ops})
                write_json(docp, doc)
            finally:
                os.remove(lp)
            lockwait.append((t1 - t0) * 1000)
            save_ms.append((time.perf_counter() - t0) * 1000)
            for r in doc["recs"]:
                note(r["ops"])

        def l_read():
            doc = read_json(docp) or {"rev": 0, "recs": []}
            for r in doc["recs"]:
                note(r["ops"])
            return doc["recs"]
        save, read = (j_save, j_read) if proto == "journal" else (l_save, l_read)

        def saver():
            while time.time() < stop + drain:
                time.sleep(0.3)
                with lock:
                    ops, pending[:] = pending[:], []
                if not ops:
                    continue
                try:
                    save(ops)
                    acked.extend(op["id"] for op in ops if not op["ref"].startswith("A"))
                except (TimeoutError, OSError) as e:          # Unreadable is an OSError
                    say("  %s: save failed (%s), retried" % (self.name, e))
                    with lock:
                        pending[:0] = ops
                    time.sleep(2)

        def poller():
            while time.time() < stop + drain:
                time.sleep(POLL[proto])
                try:
                    read()
                except OSError as e:
                    say("  %s: read failed (%s)" % (self.name, e))
        th = [threading.Thread(target=saver, daemon=True), threading.Thread(target=poller, daemon=True)]
        for t in th:
            t.start()
        n = 0
        while time.time() < stop:
            time.sleep(rng.uniform(*self.cfg["think"]))
            n += 1
            shared = rng.random() < 0.2
            ref = ("A%d" % rng.randint(1, 5)) if shared else ("C%d_%s" % (n, wid))
            with lock:
                pending.append({"id": "%s#%d" % (wid, n), "t": self.now(), "ref": ref, "patch": {"v": "%s:%d" % (wid, n)}})
        for t in th:
            t.join()
        # what the live (incremental) reader ended up with: it must equal a fresh read of everything
        live = fold([r for _off, have in seen.values() for r in have]) if proto == "journal" else fold(l_read())
        if jfile:
            jfile.close()
        if watch:
            watch.close()
        return {"pc": self.name, "writer": wid, "proto": proto, "acked": acked, "vis_ms": vis, "vis_late_ms": vis_late, "save_ms": save_ms,
                "lockwait_ms": lockwait, "appends_seen": appends,
                "rdcw": None if watch is None else {"ok": watch.ok, "error": watch.error, "events": watch.events},
                "offset_s": round(self.offset, 3), "pending_left": len(pending),
                "live_hash": hashlib.sha1(json.dumps(live, sort_keys=True).encode()).hexdigest()}

    def final(self, proto):
        """read everything again after the barrier: the document every PC ends up with"""
        deck = os.path.join(self.run, proto)
        if proto == "journal":
            recs = []
            jdir = os.path.join(deck, "j")
            for n in sorted(os.listdir(jdir)):
                with open(os.path.join(jdir, n), "rb") as f:
                    recs.extend(unframe(f.read())[0])
        else:
            recs = (read_json(os.path.join(deck, "deck.json"), retries=100) or {"recs": []})["recs"]
        doc = fold(recs)
        return {"hash": hashlib.sha1(json.dumps(doc, sort_keys=True).encode()).hexdigest(),
                "values": sorted({c.get("v") for c in doc.values()})}


def wait_for(path, timeout, what):
    end = time.time() + timeout
    while time.time() < end:
        if os.path.exists(path):
            return read_json(path)
        time.sleep(0.25)
    raise SystemExit("timed out waiting for %s" % what)


def worker_main(run_dir, name, timeout=600):
    cfg = wait_for(os.path.join(run_dir, "run.json"), 60, "run.json (is the run id right?)")
    w = Worker(run_dir, name, cfg)
    say("%s: file-server clock offset %+.3f s; measuring round trips..." % (name, w.offset))
    write_json(os.path.join(run_dir, "results", "%s-rtt.json" % name), {"pc": name, "rtt_ms": round_trips(run_dir)})
    for proto in cfg["phases"]:
        w.prepare(proto)
        write_json(os.path.join(run_dir, "ready", "%s-%s" % (name, proto)), {"pc": name})
        go = wait_for(os.path.join(run_dir, "go-%s.json" % proto), timeout, "the start of %s" % proto)
        time.sleep(max(0.0, go["start"] - w.now()))
        say("%s: %s running for %d s..." % (name, proto, cfg["duration"]))
        res = w.phase(proto)
        write_json(os.path.join(run_dir, "done", "%s-%s" % (name, proto)), {"pc": name})
        wait_for(os.path.join(run_dir, "final-%s.json" % proto), timeout, "the end of %s" % proto)
        res.update(w.final(proto))
        write_json(os.path.join(run_dir, "results", "%s-%s.json" % (name, proto)), res)
    say("%s: done." % name)


def all_present(folder, names):
    return all(os.path.exists(os.path.join(folder, n)) for n in names)


def coordinator_main(folder, pcs, cfg, local_workers=0, keep=False, out_dir=None):
    run_id = "%s-%s" % (time.strftime("%Y%m%d-%H%M%S"), uuid.uuid4().hex[:4])
    run_dir = os.path.join(folder, "sb-sharetest-" + run_id)
    for sub in ("results", "ready", "done") + tuple(os.path.join(p, "j") for p in cfg["phases"]):
        os.makedirs(os.path.join(run_dir, sub), exist_ok=True)
    for p in cfg["phases"]:
        if p == "lock":
            write_json(os.path.join(run_dir, p, "deck.json"), {"rev": 0, "recs": []})
    write_json(os.path.join(run_dir, "run.json"), cfg)
    say("Run id: %s   (folder %s)" % (run_id, run_dir))
    if pcs > 1 + local_workers:
        say("On each other PC run:  python tools/sharetest.py worker --folder \"%s\" --run %s" % (folder, run_id))
    me = "%s-coord" % socket.gethostname()
    names = [me] + ["%s-w%d" % (socket.gethostname(), i + 1) for i in range(local_workers)]
    procs = [subprocess.Popen([sys.executable, os.path.abspath(__file__), "worker", "--folder", folder, "--run", run_id, "--name", n])
             for n in names[1:]]
    failed = []

    def own_worker():
        try:
            worker_main(run_dir, me)
        except BaseException as e:         # noqa: BLE001 - shown, and the run stops below
            failed.append(e)
            say("%s: FAILED: %r" % (me, e))
    t = threading.Thread(target=own_worker, daemon=True)
    t.start()
    offset = server_offset(run_dir)
    try:
        for proto in cfg["phases"]:
            ready_dir = os.path.join(run_dir, "ready")
            end = time.time() + cfg["wait"]
            while len([n for n in os.listdir(ready_dir) if n.endswith("-" + proto)]) < pcs:
                if failed:
                    raise SystemExit("this PC's own run failed: %r" % failed[0])
                if time.time() > end:
                    raise SystemExit("only %d of %d PCs are ready for %s" % (len([n for n in os.listdir(ready_dir) if n.endswith("-" + proto)]), pcs, proto))
                time.sleep(0.5)
            # 10 s: other PCs see go-*.json through their SMB caches (a missing file is cached for up to 5 s)
            write_json(os.path.join(run_dir, "go-%s.json" % proto), {"start": time.time() + offset + 10})
            barrier(os.path.join(run_dir, "done"), "-" + proto, pcs, 10 + cfg["duration"] + cfg["drain"] + cfg.get("grace", 120), failed, "finish " + proto)
            write_json(os.path.join(run_dir, "final-%s.json" % proto), {"at": time.time() + offset})
        barrier(os.path.join(run_dir, "results"), ".json", pcs * (1 + len(cfg["phases"])), 60 + cfg.get("grace", 120), failed, "report their results")
        t.join(30)
        for p in procs:
            p.wait(60)
        report = summarise(run_dir, cfg, run_id)
        out = os.path.join(out_dir or os.getcwd(), "sharetest-%s.json" % run_id)
        write_json(out, report)
        print_report(report)
        say("Report saved: %s" % out)
        return report
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()
        if not keep:
            shutil.rmtree(run_dir, ignore_errors=True)


def barrier(folder, suffix, want, timeout, failed, what):
    """wait until `want` files ending in `suffix` are in `folder`; a dead PC stops the run with its name"""
    end = time.time() + timeout
    while True:
        have = [n for n in os.listdir(folder) if n.endswith(suffix)]
        if len(have) >= want:
            return
        if failed:
            raise SystemExit("this PC's own run failed: %r" % failed[0])
        if time.time() > end:
            raise SystemExit("only %d of %d expected files to %s after %d s (here: %s) - a PC stopped or lost the share"
                             % (len(have), want, what, timeout, ", ".join(sorted(have)) or "none"))
        time.sleep(0.5)


def summarise(run_dir, cfg, run_id):
    res = {}
    for n in os.listdir(os.path.join(run_dir, "results")):
        if n.endswith(".json"):
            r = read_json(os.path.join(run_dir, "results", n))
            res[n[:-5]] = r
    rtt = {r["pc"]: r["rtt_ms"] for k, r in res.items() if k.endswith("-rtt")}
    out = {"run": run_id, "config": cfg, "pcs": sorted(rtt), "rtt_ms": rtt, "phases": {}}
    for proto in cfg["phases"]:
        rows = [r for k, r in res.items() if k.endswith("-" + proto)]
        acked = [a for r in rows for a in r["acked"]]
        values = set(rows[0]["values"]) if rows else set()
        lost = [a for a in acked if a.replace("#", ":") not in values]
        # converged: every PC's fresh read is the same, and so is what its live (incremental) reader had
        ph = {"pcs": len(rows), "acked": len(acked), "lost": len(lost),
              "converged": len({r["hash"] for r in rows}) == 1 and all(r.get("live_hash") == r["hash"] for r in rows),
              "live_matches_final": [r["pc"] for r in rows if r.get("live_hash") == r["hash"]],
              "pending_left": sum(r["pending_left"] for r in rows),
              "visible_after_10s_ms": {"p50": pct([v for r in rows for v in r.get("vis_late_ms", [])], .5),
                                       "p95": pct([v for r in rows for v in r.get("vis_late_ms", [])], .95)},
              "save_ms": {"p50": pct([v for r in rows for v in r["save_ms"]], .5), "p95": pct([v for r in rows for v in r["save_ms"]], .95)},
              "visible_ms": {"p50": pct([v for r in rows for v in r["vis_ms"]], .5), "p95": pct([v for r in rows for v in r["vis_ms"]], .95)}}
        if proto == "lock":
            ph["lockwait_ms"] = {"p95": pct([v for r in rows for v in r["lockwait_ms"]], .95)}
        rd = [r for r in rows if r.get("rdcw")]
        if rd:
            woke = []
            for r in rd:                                    # an append by another PC, then an event for THAT file
                for name, at in r["appends_seen"]:
                    ev = sorted(r["rdcw"]["events"].get(name, []))
                    nxt = next((e for e in ev if e >= at - 0.05), None)
                    if nxt is not None and nxt - at < 30:
                        woke.append((nxt - at) * 1000)
            ph["rdcw"] = {"pcs": len(rd), "working": [r["pc"] for r in rd if r["rdcw"]["ok"] and r["rdcw"]["events"]],
                          "errors": sorted({r["rdcw"]["error"] for r in rd if r["rdcw"]["error"]}),
                          "others_appends": sum(len(r["appends_seen"]) for r in rd), "woke": len(woke), "wake_ms_p50": pct(woke, .5)}
        out["phases"][proto] = ph
    return out


def print_report(r):
    say("")
    say("Share test %s - PCs: %s" % (r["run"], ", ".join(r["pcs"])))
    for pc, rt in sorted(r["rtt_ms"].items()):
        say("  %-24s round trips p50/p95 ms: %s" % (pc, ", ".join("%s %s/%s" % (k, v["p50"], v["p95"]) for k, v in rt.items())))
    for proto, ph in r["phases"].items():
        say("  %-8s acked %d, lost %d, unsaved %d, converged %s, save p50/p95 %s/%s ms, visible p50/p95 %s/%s ms (after the first 10 s: %s/%s)%s"
            % (proto, ph["acked"], ph["lost"], ph["pending_left"], "yes" if ph["converged"] else "NO", ph["save_ms"]["p50"], ph["save_ms"]["p95"],
               ph["visible_ms"]["p50"], ph["visible_ms"]["p95"], ph["visible_after_10s_ms"]["p50"], ph["visible_after_10s_ms"]["p95"],
               ", lock wait p95 %s ms" % ph["lockwait_ms"]["p95"] if "lockwait_ms" in ph else ""))
        if "rdcw" in ph:
            x = ph["rdcw"]
            say("           ReadDirectoryChangesW: woke for %d of %d appends by other PCs (p50 %s ms); %s" % (
                x["woke"], x["others_appends"], x["wake_ms_p50"], "; ".join(x["errors"]) or "no errors"))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Field test of the shared folder (journal and lean-lock protocols, several PCs).")
    sub = ap.add_subparsers(dest="mode", required=True)
    for name in ("coordinator", "local"):
        p = sub.add_parser(name)
        p.add_argument("--folder", required=True, help="a folder on the share (a temporary sub-folder is created there)")
        p.add_argument("--duration", type=float, default=60, help="seconds of editing per protocol (default 60)")
        p.add_argument("--think", type=float, nargs=2, default=[1.0, 3.0], metavar=("MIN", "MAX"))
        p.add_argument("--phases", nargs="+", choices=PHASES, default=list(PHASES))
        p.add_argument("--rdcw", action="store_true", help="also probe ReadDirectoryChangesW (Windows)")
        p.add_argument("--keep", action="store_true", help="keep the temporary sub-folder")
        p.add_argument("--wait", type=float, default=600, help="seconds to wait for the PCs to join (default 600)")
        p.add_argument("--out", default=None, help="folder for the report (default: the current folder)")
        p.add_argument("--grace", type=float, default=120, help=argparse.SUPPRESS)      # seconds a slow PC may take beyond the run
        if name == "coordinator":
            p.add_argument("--pcs", type=int, required=True, help="number of PCs taking part, this one included")
        else:
            p.add_argument("--workers", type=int, default=3, help="local processes (default 3)")
    w = sub.add_parser("worker")
    w.add_argument("--folder", required=True)
    w.add_argument("--run", required=True)
    w.add_argument("--name", default=None)
    a = ap.parse_args(argv)
    if a.mode == "worker":
        worker_main(os.path.join(a.folder, "sb-sharetest-" + a.run), a.name or "%s-%d" % (socket.gethostname(), os.getpid()))
        return 0
    if not os.path.isdir(a.folder):
        raise SystemExit("The folder %s does not exist (it is not created: check the drive letter / path)." % a.folder)
    cfg = {"duration": a.duration, "think": a.think, "phases": a.phases, "rdcw": a.rdcw, "drain": 5.0, "wait": a.wait, "grace": a.grace}
    if a.mode == "local":
        rep = coordinator_main(a.folder, a.workers, cfg, local_workers=a.workers - 1, keep=a.keep, out_dir=a.out)
    else:
        rep = coordinator_main(a.folder, a.pcs, cfg, keep=a.keep, out_dir=a.out)
    return 0 if all(ph["converged"] and ph["lost"] == 0 and ph["pending_left"] == 0 for ph in rep["phases"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
