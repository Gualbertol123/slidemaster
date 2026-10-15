"""SIMULATION aid (tools/loadtest4.py): simfs adds latency to data-folder file operations only and counts them."""
import os
import time

from sbtest import TempDirs

from slidebuilder import fsclock, locks, simfs, store, util


class SimFsTests(TempDirs):
    def tearDown(self):
        simfs.uninstall()
        fsclock.reset()
        super().tearDown()

    def test_counts_and_delays_only_data_folder_calls(self):
        simfs.install(0)
        self.assertIsNot(store.os, os)
        n0 = simfs.count()
        store.replace_config_defaults(0, {"b": True})
        per_save = simfs.count() - n0
        self.assertGreaterEqual(per_save, 6)                     # lock, read, tmp, fsync, replace, unlock...
        n1 = simfs.count()
        with util.open(os.path.join(self.root, "outside.txt"), "w") as f:     # not in the data folder
            f.write("x")
        self.assertEqual(simfs.count(), n1)
        fsclock.reset()
        simfs.install(20)
        n2, t0 = simfs.count(), time.perf_counter()
        store.replace_config_defaults(1, {"b": False})
        elapsed = (time.perf_counter() - t0) * 1000
        ops2 = simfs.count() - n2
        self.assertGreaterEqual(ops2, 6)
        self.assertGreater(elapsed, 0.75 * 20 * (ops2 - 2))      # every counted round trip was delayed

    def test_deck_round_trips_as_04_counts_them(self):
        """04 §2.2: an append on an open handle is write + flush = 2 round trips; a tail is open + read per journal
        (+ the listing every 10 s and one stat of the snapshot)"""
        from slidebuilder import decks
        decks.reset()
        key, _ = decks.create_if_missing("Deck.xlsx")
        w = decks.new_writer()
        simfs.install(0)
        try:
            decks.append(key, w, {"w": w, "s": 1, "l": 1, "ops": []})   # opens the handle (and looks at the deck once)
            decks.tail(key, {})
            n0 = simfs.total()
            decks.append(key, w, {"w": w, "s": 2, "l": 2, "ops": []})
            self.assertEqual(simfs.total() - n0, 2)
            others = ["o%d@pc#abcdefg%s" % (i, "abcdefgh"[i]) for i in range(3)]
            for o in others:
                with open(os.path.join(decks.journal_dir(key), o + ".log"), "wb") as f:
                    f.write(decks.frame({"w": o, "s": 1, "l": 1, "ops": []}))
            decks._listings.pop(key, None)
            n1 = simfs.total()
            res = decks.tail(key, {})
            self.assertEqual(len(res["journals"]), 4)
            self.assertEqual(simfs.total() - n1, 2 * 4 + 1 + 1)           # 4 x (open + read), the listing, the snapshot stat
            n2 = simfs.total()
            decks.tail(key, {j: v["offset"] for j, v in res["journals"].items()})
            self.assertEqual(simfs.total() - n2, 2 * 4 + 1)                # listing (3 s) and folder (10 s) cached
            # a new page session: the journal is opened while the page debounces (prepare), its first append is 2 too
            w2 = decks.new_writer("bob")
            decks.prepare(key, w2)
            n3 = simfs.total()
            decks.append(key, w2, {"w": w2, "s": 1, "l": 3, "ops": []})
            self.assertEqual(simfs.total() - n3, 2)
        finally:
            decks.reset()

    def test_uninstall_restores_the_real_modules(self):
        simfs.install(0)
        simfs.uninstall()
        for mod in (store, locks, fsclock, util):
            self.assertIs(mod.os, os)
            self.assertNotIn("open", mod.__dict__)


