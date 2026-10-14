"""Functions run in child processes by the concurrency tests (must be importable for 'spawn')."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _setup(root, data, user):
    os.environ["SLIDEBUILDER_ROOT"] = root
    os.environ["SLIDEBUILDER_DATA"] = data
    os.environ["SLIDEBUILDER_USER"] = user
    os.environ["SLIDEBUILDER_HOST"] = "pc-" + user
    from slidebuilder import paths
    paths.configure()


def lock_counter(root, data, user, n):
    """n increments of a plain counter file, each one read-modify-write under the lock."""
    _setup(root, data, user)
    from slidebuilder.locks import Lock
    counter = os.path.join(data, "counter.txt")
    for _ in range(n):
        with Lock("counter"):
            with open(counter, "r") as f:
                v = int(f.read().strip() or 0)
            with open(counter, "w") as f:
                f.write(str(v + 1))
                f.flush()
                os.fsync(f.fileno())
    return n


def store_cells(root, data, user, column, n):
    """n update_workbook calls, each patching its own cell (column<k>) of the same workbook."""
    _setup(root, data, user)
    from slidebuilder import store
    for k in range(1, n + 1):
        ref = "%s%d" % (column, k)
        store.update_workbook("Shared Deck.xlsx",
                              [{"op": "cell.patch", "sheet": "Data", "ref": ref, "patch": {"text": user, "orig": ref, "b": True}}],
                              user)
    return n


# ---------------------------------------------------------------- decks (test_decks.py, 05 §3.6)
def deck_append(root, data, user, key, n, storage="journal"):
    """n records appended by one writer session; returns (writer, [s of each acknowledged record])"""
    _setup(root, data, user)
    os.environ["SLIDEBUILDER_STORAGE"] = storage
    from slidebuilder import decks
    w = decks.new_writer()
    acked = []
    for s in range(1, n + 1):
        decks.append(key, w, {"w": w, "s": s, "l": s, "by": user, "ops": [{"k": "%s-%d" % (user, s)}]})
        acked.append(s)
    return w, acked


def deck_torn(root, data, user, key, writer, before, storage="journal"):
    """`before` records, then the process dies in the middle of writing the next frame (os._exit between writes)"""
    _setup(root, data, user)
    os.environ["SLIDEBUILDER_STORAGE"] = storage
    from slidebuilder import decks
    for s in range(1, before + 1):
        decks.append(key, writer, {"w": writer, "s": s, "l": s, "ops": []})
    real = os.write

    def half(fd, b):
        if not bytes(b[:1]).isdigit():            # not a frame (a lock file's body): written as usual
            return real(fd, b)
        real(fd, bytes(b[:len(b) // 2]))
        os._exit(3)
    os.write = half
    decks.append(key, writer, {"w": writer, "s": before + 1, "l": before + 1, "ops": []})
    os._exit(4)                                   # never reached


def deck_read_all(root, data, key):
    """every complete record of the deck as one reader sees it: (sorted (w, s, l) list, sha1 of the sorted records)"""
    import hashlib
    import json
    _setup(root, data, "reader")
    from slidebuilder import decks
    res = decks.tail(key, {})
    recs = [r for j in res["journals"].values() for r in j["records"]]
    recs.sort(key=lambda r: (r["l"], r["w"], r["s"]))
    return ([(r["w"], r["s"], r["l"]) for r in recs],
            hashlib.sha1(json.dumps(recs, sort_keys=True).encode()).hexdigest())


def deck_compact_dies_after_rename(root, data, user, key, base, snap):
    """a compaction whose process dies right after the snapshot's rename (before the backup and the unlock)"""
    _setup(root, data, user)
    from slidebuilder import decks
    decks._backup = lambda *a: os._exit(5)
    real = decks.write_snapshot

    def write_then_die(k, s):
        real(k, s)
        os._exit(5)
    decks.write_snapshot = write_then_die
    decks.compact(key, base, snap)
    os._exit(6)


def deck_compact(root, data, user, key, base, snap):
    _setup(root, data, user)
    from slidebuilder import decks
    try:
        return decks.compact(key, base, snap)["gen"]
    except decks.DeckError as e:
        return e.status
