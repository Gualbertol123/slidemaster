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
