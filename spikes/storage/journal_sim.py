"""Storage spike: one shared deck, N users, simulated SMB latency - two protocols compared.

  journal  (proposed) - every writer appends its operation batches to ITS OWN journal file
           (data/decks/<key>/j/<writer>.log, single writer, no lock). Readers fold snapshot + all
           journals in Lamport order (lamport, writer, seq). A compaction (under a lock, off the
           editing path) folds the journals into a new snapshot from time to time.
  lock     (today's protocol, trimmed to its minimum) - lock file (O_EXCL) -> read doc -> write temp
           -> fsync -> rename -> delete lock; readers poll the document.

Latency model = backend/slidebuilder/simfs.py: every call that is an SMB round trip sleeps
FS_MS +-25 % (open/create, stat, rename, remove, listdir, fsync). In addition this spike charges
one round trip for every write and read on an open handle (simfs does not), so it is the more
pessimistic of the two models.

Run:  python3 journal_sim.py --users 10 20 --fs-ms 15 40 --duration 30 --json out.json
Every acknowledged operation must be in every user's final view, and all final views must be
identical (convergence); the script checks both.
"""
import argparse, hashlib, json, multiprocessing as mp, os, random, shutil, statistics, sys, tempfile, threading, time, uuid, zlib

def charge(ms, n=1):
    for _ in range(n):
        time.sleep(ms * random.uniform(0.75, 1.25) / 1000.0)

# ------------------------------------------------------------------ records (framed, torn tails ignored)
def frame(rec):
    b = json.dumps(rec, separators=(",", ":")).encode()
    return b"%d:%08x:" % (len(b), zlib.crc32(b)) + b + b"\n"

def unframe(buf):
    """complete records from `buf`, and how many bytes they used (a torn tail is left for later)"""
    out, p = [], 0
    while True:
        a = buf.find(b":", p)
        if a < 0: break
        try:
            n = int(buf[p:a]); crc = int(buf[a + 1:a + 9], 16)
        except ValueError:
            break
        body = buf[a + 10:a + 10 + n]
        if len(body) < n or buf[a + 10 + n:a + 11 + n] != b"\n": break
        if zlib.crc32(body) != crc: break
        out.append(json.loads(body)); p = a + 11 + n
    return out, p

def fold(records):
    """deterministic: the same set of records gives the same document on every PC"""
    doc = {}
    for r in sorted(records, key=lambda r: (r["l"], r["w"], r["s"])):
        for op in r["ops"]:
            doc.setdefault(op["ref"], {}).update(op["patch"])
    return doc

# ------------------------------------------------------------------ one user (one process = one PC)
def user(k, cfg, root, out_q):
    random.seed(1000 + k)
    ms, proto, wid = cfg["fs_ms"], cfg["proto"], "u%02d-%s" % (k, uuid.uuid4().hex[:6])
    deck = os.path.join(root, "deck"); jdir = os.path.join(deck, "j"); docp = os.path.join(deck, "doc.json")
    lock = threading.Lock()
    pending, inflight = [], [False]
    seen_rec = {}                     # journal name -> (offset, records) ; lock protocol: rev
    acked, vis, save_ms, lockwait = [], [], [], []
    lamport, seq = [0], [0]
    stop = time.time() + cfg["duration"]
    known_ops = set()

    def note_visible(ops):
        now = time.time()
        for op in ops:
            if op["id"] not in known_ops:
                known_ops.add(op["id"])
                if not op["id"].startswith(wid): vis.append((now - op["t"]) * 1000)

    # ---------------- journal protocol
    def j_save(ops):
        t0 = time.time()
        lamport[0] += 1; seq[0] += 1
        rec = {"l": lamport[0], "w": wid, "s": seq[0], "ops": ops}
        with open(os.path.join(jdir, wid + ".log"), "ab") as f:   # handle kept open in the real design: write + flush
            charge(ms, 1); f.write(frame(rec)); f.flush(); os.fsync(f.fileno()); charge(ms, 1)
        save_ms.append((time.time() - t0) * 1000)
        return rec

    def j_read_all(final=False):
        charge(ms, 1); names = sorted(os.listdir(jdir))        # new writers appear (dir cache: up to 10 s on SMB)
        recs = []
        for n in names:
            off, have = seen_rec.get(n, (0, []))
            if n != wid + ".log" or final:
                charge(ms, 2)                                  # open + read from the last offset (+close compounded)
                with open(os.path.join(jdir, n), "rb") as f:
                    f.seek(off); buf = f.read()
                new, used = unframe(buf)
                if new:
                    have = have + new; seen_rec[n] = (off + used, have)
                    for r in new:
                        lamport[0] = max(lamport[0], r["l"])
                        note_visible(r["ops"])
            recs.extend(seen_rec.get(n, (0, []))[1])
        return recs

    # ---------------- lock protocol (lean: no backups, no clock probes)
    def l_save(ops):
        t0 = time.time(); lp = os.path.join(deck, "doc.lock")
        while True:
            charge(ms, 1)
            try:
                fd = os.open(lp, os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.close(fd); break
            except FileExistsError:
                if time.time() - t0 > 10: raise TimeoutError("lock busy 10 s")
                time.sleep(random.uniform(0.01, 0.03))
        t1 = time.time()
        try:
            charge(ms, 2)                                      # open + read
            with open(docp, "rb") as f: doc = json.loads(f.read() or b'{"rev":0,"recs":[]}')
            doc["rev"] += 1; doc["recs"].append({"l": doc["rev"], "w": wid, "s": doc["rev"], "ops": ops})
            tmp = docp + "." + uuid.uuid4().hex + ".tmp"
            charge(ms, 3)                                      # create + write + fsync
            with open(tmp, "wb") as f: f.write(json.dumps(doc).encode()); f.flush(); os.fsync(f.fileno())
            charge(ms, 1); os.replace(tmp, docp)
        finally:
            charge(ms, 1); os.remove(lp)
        lockwait.append((t1 - t0) * 1000); save_ms.append((time.time() - t0) * 1000)
        note_visible(ops)
        for r in doc["recs"]: note_visible(r["ops"])
        return doc

    def l_read():
        charge(ms, 2)
        with open(docp, "rb") as f: doc = json.loads(f.read() or b'{"rev":0,"recs":[]}')
        for r in doc["recs"]: note_visible(r["ops"])
        return doc["recs"]

    save, read_all = (j_save, j_read_all) if proto == "journal" else (l_save, lambda final=False: l_read())

    def saver():
        while time.time() < stop + cfg["drain"]:
            time.sleep(0.3)                                    # 300 ms debounce, one request in flight
            with lock:
                ops, pending[:] = pending[:], []
            if not ops: continue
            try:
                save(ops); acked.extend(op["id"] for op in ops if not op["ref"].startswith("A"))
            except TimeoutError:
                with lock: pending[:0] = ops                   # kept, retried
                time.sleep(2)

    def poller():
        while time.time() < stop + cfg["drain"]:
            time.sleep(cfg["poll"])
            try: read_all()
            except Exception as e: print("poll", e, file=sys.stderr)

    th = [threading.Thread(target=saver, daemon=True), threading.Thread(target=poller, daemon=True)]
    for t in th: t.start()
    n = 0
    while time.time() < stop:
        time.sleep(random.uniform(*cfg["think"]))
        n += 1
        shared = random.random() < 0.2                         # 20 %: a cell somebody else also edits (last write wins)
        ref = ("A%d" % random.randint(1, 5)) if shared else ("C%d_%s" % (n, wid))
        with lock: pending.append({"id": "%s#%d" % (wid, n), "t": time.time(), "ref": ref, "patch": {"v": "%s:%d" % (wid, n)}})
    for t in th: t.join()
    final = fold(read_all(final=True))
    out_q.put({"k": k, "acked": acked, "vis": vis, "save": save_ms, "lockwait": lockwait,
               "hash": hashlib.sha1(json.dumps(final, sort_keys=True).encode()).hexdigest(),
               "ops_in_final": sorted({op for c in final.values() for op in [c.get("v")]})})

def pct(xs, p):
    xs = sorted(xs); return round(xs[min(len(xs) - 1, int(len(xs) * p))]) if xs else None

def run(proto, users, fs_ms, duration, poll):
    root = tempfile.mkdtemp(prefix="sbsim-")
    os.makedirs(os.path.join(root, "deck", "j"))
    open(os.path.join(root, "deck", "doc.json"), "w").write('{"rev":0,"recs":[]}')
    cfg = {"proto": proto, "fs_ms": fs_ms, "duration": duration, "drain": 8, "poll": poll, "think": (1.0, 3.0)}
    q = mp.Queue(); ps = [mp.Process(target=user, args=(k, cfg, root, q)) for k in range(users)]
    for p in ps: p.start()
    res = [q.get() for _ in ps]
    for p in ps: p.join()
    acked = [a for r in res for a in r["acked"]]
    vis = [v for r in res for v in r["vis"]]; sv = [v for r in res for v in r["save"]]; lw = [v for r in res for v in r["lockwait"]]
    hashes = {r["hash"] for r in res}
    # every acknowledged own-cell edit must be in the final document
    final_vals = set(res[0]["ops_in_final"])
    lost = sum(1 for a in acked if a.replace("#", ":") not in final_vals)
    shutil.rmtree(root, ignore_errors=True)
    return {"proto": proto, "users": users, "fs_ms": fs_ms, "poll_s": poll, "ops_acked": len(acked),
            "save_p50": pct(sv, .5), "save_p95": pct(sv, .95), "lockwait_p95": pct(lw, .95),
            "visible_p50": pct(vis, .5), "visible_p95": pct(vis, .95),
            "converged": len(hashes) == 1, "lost": lost}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--users", type=int, nargs="+", default=[10, 20]); ap.add_argument("--fs-ms", type=float, nargs="+", default=[15, 40])
    ap.add_argument("--duration", type=float, default=30); ap.add_argument("--proto", nargs="+", default=["journal", "lock"])
    ap.add_argument("--poll", type=float, nargs="+", default=[1.5]); ap.add_argument("--json")
    a = ap.parse_args(); rows = []
    for proto in a.proto:
        for u in a.users:
            for ms in a.fs_ms:
                for poll in (a.poll if proto == "journal" else [3.0]):
                    r = run(proto, u, ms, a.duration, poll); rows.append(r); print(json.dumps(r), flush=True)
    if a.json: json.dump(rows, open(a.json, "w"), indent=1)
