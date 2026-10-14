"""Decks of Slide Builder 4: snapshot + per-writer journals (docs/next/04 §2, tests 1-6 of 05 §3.6).

The records here are synthetic: the helper never looks inside them (only w, s, l and the `at` it stamps), so
these tests fold them by their envelope - (l, w, s) order, one copy per (w, s) - as core/src/model/fold.ts does.
"""
import json
import re
import multiprocessing
import os
import threading
import time
import unittest
from unittest import mock

import workers
from sbtest import TempDirs
from test_fsclock import skewed
from test_http import HttpBase

from slidebuilder import decks, fsclock, paths

WB = "Weekly IBD.xlsx"


def fold_envelope(snapshot_seen, tail_res, frontier=None):
    """(w, s) pairs a reader ends up with: the snapshot's (a test snapshot lists them in doc.seen) plus every
    record past the frontier, one copy per (w, s)"""
    seen = {tuple(x) for x in snapshot_seen}
    for j in tail_res["journals"].values():
        for r in j["records"]:
            seen.add((r["w"], r["s"]))
    return seen


class DeckBase(TempDirs):
    def setUp(self):
        super().setUp()
        decks.reset()
        fsclock.reset()
        os.environ.pop("SLIDEBUILDER_STORAGE", None)
        self.key, created = decks.create_if_missing(WB)
        self.assertTrue(created)

    def tearDown(self):
        decks.reset()
        fsclock.reset()
        os.environ.pop("SLIDEBUILDER_STORAGE", None)
        super().tearDown()

    def rec(self, w, s, l=None, **kw):
        return dict({"w": w, "s": s, "l": s if l is None else l, "ops": [{"op": "opaque", "n": s}]}, **kw)

    def all_records(self, since=None):
        res = decks.tail(self.key, since or {})
        return [r for j in res["journals"].values() for r in j["records"]], res

    def journals(self):
        return sorted(os.listdir(decks.journal_dir(self.key)))

    def assertJournals(self, pattern):
        """journal names: exact stems, or "<prefix>~*" for a numbered one (the server's time in ms)"""
        names = self.journals()
        self.assertEqual(len(names), len(pattern), names)
        rest = list(names)
        for p in pattern:
            hit = next((n for n in rest if (n == p + ".log" if not p.endswith("~*") else re.match(re.escape(p[:-1]) + r"[0-9]{13,16}\.log$", n))), None)
            self.assertIsNotNone(hit, (p, names))
            rest.remove(hit)


class FramingTests(unittest.TestCase):
    def test_frame_round_trip_and_torn_tails(self):
        a, b = decks.frame({"w": "x", "s": 1, "l": 1}), decks.frame({"w": "x", "s": 2, "l": 2, "t": "àé€"})
        recs, used, bad = decks.unframe(a + b)
        self.assertEqual(([r["s"] for r in recs], used, bad), ([1, 2], len(a + b), None))
        for cut in range(1, len(b)):                    # every prefix of a frame is a torn tail, never corruption
            recs, used, bad = decks.unframe(a + b[:cut])
            self.assertEqual((len(recs), used, bad), (1, len(a), None), cut)
        self.assertEqual(decks.unframe(a + b"\x00" * 300)[1:], (len(a), None))      # zeros of a crash

    def test_corruption_is_reported_where_it_starts(self):
        a, b, c = (decks.frame({"w": "x", "s": s, "l": s}) for s in (1, 2, 3))
        bad = bytearray(a + b + c)
        bad[len(a) + 20] ^= 0x01                        # a bit flip in the middle record's body
        recs, used, at = decks.unframe(bytes(bad))
        self.assertEqual((len(recs), used, at), (1, len(a), len(a)))
        for junk in (b"garbage, not a header at all", b"12x", b"1:zzzzzzzz:{}\n"):
            self.assertEqual(decks.unframe(a + junk)[2], len(a), junk)
        no_newline = a[:-1] + b"X" + b
        self.assertEqual(decks.unframe(no_newline)[2], 0)


class DeckTests(DeckBase):
    # ---------------------------------------------------------------- basics
    def test_open_append_tail(self):
        snap = decks.read_snapshot(self.key)
        self.assertEqual((snap["format"], snap["gen"], snap["frontier"], snap["doc"]["workbook"]), (4, 1, {}, WB))
        w = decks.new_writer()
        self.assertRegex(w, r"^tester@pc1#[a-z2-7]{8}$")
        r1 = decks.append(self.key, w, self.rec(w, 1))
        r2 = decks.append(self.key, w, self.rec(w, 2))
        self.assertEqual(r1["journal"], w)
        self.assertGreater(r2["offset"], r1["offset"])
        self.assertAlmostEqual(r1["at"] / 1000.0, time.time(), delta=5)
        res = decks.tail(self.key, {})
        self.assertEqual(list(res["journals"]), [w])
        self.assertEqual([r["s"] for r in res["journals"][w]["records"]], [1, 2])
        self.assertEqual(res["journals"][w]["records"][0]["at"], r1["at"])            # stamped by the helper
        self.assertEqual(res["journals"][w]["offset"], r2["offset"])
        self.assertEqual(res["journals"][w]["ends"], [r1["offset"], r2["offset"]])     # where each record ends
        self.assertEqual(res["gen"], 1)
        again = decks.tail(self.key, {w: r2["offset"]})                             # nothing new
        self.assertEqual(again["journals"], {})

    def test_the_helper_never_changes_a_record_but_its_time(self):
        w = decks.new_writer()
        rec = self.rec(w, 1, ops=[{"op": "cell.patch", "sheet": "S", "ref": "A1", "patch": {"text": "x", "unknown": [1, {"a": None}]}}],
                       by="anna", future={"anything": True})
        decks.append(self.key, w, rec)
        got = self.all_records()[0][0]
        self.assertEqual({k: v for k, v in got.items() if k != "at"}, rec)

    def test_refusals(self):
        w = decks.new_writer()
        for bad in ({"w": w, "s": 0, "l": 1}, {"w": w, "s": 1}, {"w": "other@pc#abcdefgh", "s": 1, "l": 1}, [1], {"w": w, "s": True, "l": 1}):
            with self.assertRaises(decks.DeckError) as e:
                decks.append(self.key, w, bad)
            self.assertEqual(e.exception.status, 400, bad)
        with self.assertRaises(decks.DeckError) as e:
            decks.append(self.key, "../../evil", {"w": "../../evil", "s": 1, "l": 1})
        self.assertEqual(e.exception.status, 400)
        for key in ("../x", "a/b-0123456789", "nohash", ""):
            with self.assertRaises(decks.DeckError):
                decks.tail(key, {})
        with self.assertRaises(decks.DeckError) as e:
            decks.append(decks.deck_key("Other.xlsx"), w, self.rec(w, 1))
        self.assertEqual(e.exception.status, 404)
        self.assertFalse(os.path.exists(decks.deck_dir(decks.deck_key("Other.xlsx"))))   # never created by an append

    def test_snapshot_unreadable_is_503_never_empty(self):
        p = decks.snapshot_path(self.key)
        with open(p, "wb") as f:
            f.write(b'{"format": 4, "gen": ')                 # half written by somebody else's tool
        with mock.patch.object(decks, "READ_DELAY", 0.001):
            with self.assertRaises(decks.DeckError) as e:
                decks.read_snapshot(self.key)
        self.assertEqual(e.exception.status, 503)
        with open(p, "rb") as f:
            self.assertEqual(f.read(), b'{"format": 4, "gen": ')     # nothing was written
        with open(p, "w") as f:
            json.dump({"format": 5, "gen": 3}, f)
        with self.assertRaises(decks.DeckError) as e:
            decks.read_snapshot(self.key)
        self.assertEqual(e.exception.status, 409)                     # too new: restart

    def test_unreadable_journal_is_skipped_this_round_not_empty(self):
        w1, w2 = decks.new_writer("a"), decks.new_writer("b")
        decks.append(self.key, w1, self.rec(w1, 1))
        decks.append(self.key, w2, self.rec(w2, 1))
        real = decks._read_from

        def flaky(path, off):
            if os.path.basename(path).startswith("a@"):
                raise PermissionError("sharing violation")
            return real(path, off)
        with mock.patch.object(decks, "_read_from", flaky):
            res = decks.tail(self.key, {})
        self.assertEqual(list(res["journals"]), [w2])                 # w1 left out (asked again), not "no records"
        self.assertEqual(res["skipped"], [w1])                         # and named: no compaction on this round
        self.assertAlmostEqual(res["now"] / 1000.0, time.time(), delta=5)
        res = decks.tail(self.key, {w2: res["journals"][w2]["offset"]})
        self.assertEqual(list(res["journals"]), [w1])

    def test_listing_is_cached_but_own_journals_are_seen_at_once(self):
        w1 = decks.new_writer("a")
        decks.tail(self.key, {})                                       # caches an empty listing
        decks.append(self.key, w1, self.rec(w1, 1))
        self.assertEqual(list(decks.tail(self.key, {})["journals"]), [w1])
        # another PC's new journal: written behind this helper's back, seen within LISTING_TTL
        other = "b@pc9#abcdefgh"
        with open(os.path.join(decks.journal_dir(self.key), other + ".log"), "wb") as f:
            f.write(decks.frame(self.rec(other, 1)))
        self.assertEqual(sorted(decks.tail(self.key, {})["journals"]), [w1])
        with mock.patch.object(decks, "LISTING_TTL", 0):
            self.assertEqual(sorted(decks.tail(self.key, {})["journals"]), sorted([w1, other]))

    def test_idle_handle_is_closed_and_the_next_append_uses_a_new_file(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        st = decks._writers[(self.key, w)]
        st.used -= decks.IDLE_CLOSE + 1
        decks.close_idle()
        self.assertIsNone(st.fd)
        decks.append(self.key, w, self.rec(w, 2))
        self.assertJournals([w, w + "~*"])
        self.assertEqual(sorted(r["s"] for r in self.all_records()[0]), [1, 2])

    def test_a_restarted_helper_never_appends_to_an_old_file(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        decks.reset()                                                   # the helper restarted; the page kept its writer
        decks.append(self.key, w, self.rec(w, 2))
        self.assertJournals([w, w + "~*"])

    # ---------------------------------------------------------------- 1. multi-process append
    def test_1_twenty_processes_append_10000_records(self):
        ctx = multiprocessing.get_context("spawn")
        n_proc, per = 20, 500
        with ctx.Pool(n_proc) as pool:
            res = [pool.apply_async(workers.deck_append, (self.root, self.data, "user%02d" % i, self.key, per)) for i in range(n_proc)]
            out = [r.get(timeout=600) for r in res]
        acked = {(w, s) for w, ss in out for s in ss}
        self.assertEqual(len(acked), n_proc * per)
        with ctx.Pool(4) as pool:                                       # four readers, each its own process
            views = pool.starmap(workers.deck_read_all, [(self.root, self.data, self.key)] * 4)
        self.assertEqual(len({v[1] for v in views}), 1)               # every reader sees the same records
        self.assertEqual({(w, s) for w, s, _l in views[0][0]}, acked)  # none missing, none extra
        self.assertEqual(len(views[0][0]), n_proc * per)               # one copy each

    # ---------------------------------------------------------------- 2. torn tails
    def test_2_writer_killed_mid_append(self):
        ctx = multiprocessing.get_context("spawn")
        w = decks.new_writer("anna")
        p = ctx.Process(target=workers.deck_torn, args=(self.root, self.data, "anna", self.key, w, 3))
        p.start()
        p.join(120)
        self.assertEqual(p.exitcode, 3)                                 # died between the two writes
        size = os.path.getsize(os.path.join(decks.journal_dir(self.key), w + ".log"))
        recs, res = self.all_records()
        self.assertEqual([r["s"] for r in recs], [1, 2, 3])             # the torn frame is ignored
        off = res["journals"][w]["offset"]
        self.assertLess(off, size)                                      # ... and left in place
        self.assertNotIn("readonly", res)                               # a torn tail is not corruption
        # the same page session continues through a new helper: a new file, the torn one is never appended to
        decks.reset()
        decks.append(self.key, w, self.rec(w, 4))
        self.assertJournals([w, w + "~*"])
        self.assertEqual(os.path.getsize(os.path.join(decks.journal_dir(self.key), w + ".log")), size)
        self.assertEqual(sorted(r["s"] for r in self.all_records()[0]), [1, 2, 3, 4])
        self.assertEqual(decks.tail(self.key, {w: off})["journals"].get(w), None)    # still torn, still ignored

    def test_2_failed_write_seals_the_file(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        real = os.write

        def half(fd, b):
            real(fd, bytes(b[:7]))
            raise OSError(64, "The specified network name is no longer available")
        with mock.patch.object(decks.os, "write", half):
            with self.assertRaises(decks.DeckError) as e:
                decks.append(self.key, w, self.rec(w, 2))
        self.assertEqual(e.exception.status, 503)                       # not acknowledged: the page retries
        decks.append(self.key, w, self.rec(w, 2))                       # the retry goes to a new file
        self.assertJournals([w, w + "~*"])
        self.assertEqual(sorted(r["s"] for r in self.all_records()[0]), [1, 2])

    # ---------------------------------------------------------------- 3. duplicates
    def test_3_same_record_appended_twice_is_kept_twice_and_folded_once(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        with mock.patch.object(decks.os, "fsync", side_effect=OSError(59, "unexpected network error")):
            with self.assertRaises(decks.DeckError):
                decks.append(self.key, w, self.rec(w, 2))               # written, but the flush failed: not acked
        decks.append(self.key, w, self.rec(w, 2))                       # retried: the same (w, s)
        decks.append(self.key, w, self.rec(w, 2))                       # and a second time (the answer was lost)
        recs, _ = self.all_records()
        self.assertEqual(sorted(r["s"] for r in recs), [1, 2, 2, 2])    # the helper keeps every copy (records are opaque)
        self.assertEqual(fold_envelope([], decks.tail(self.key, {})), {(w, 1), (w, 2)})

    # ---------------------------------------------------------------- 4. corruption in the middle
    def test_4_crc_corruption_makes_the_deck_read_only(self):
        w = decks.new_writer()
        for s in (1, 2, 3):
            decks.append(self.key, w, self.rec(w, s))
        path = os.path.join(decks.journal_dir(self.key), w + ".log")
        with open(path, "rb") as f:
            data = bytearray(f.read())
        first = data.index(b"\n") + 1                                   # the end of record 1's frame
        data[first + 25] ^= 0x20                                        # inside record 2's body
        with open(path, "wb") as f:
            f.write(bytes(data))
        decks.reset()
        res = decks.tail(self.key, {})
        self.assertIn("readonly", res)
        self.assertEqual([r["s"] for r in res["journals"][w]["records"]], [1])
        incidents = [n for n in os.listdir(decks.deck_dir(self.key)) if n.startswith("incident-")]
        self.assertEqual(len(incidents), 1)
        with open(os.path.join(decks.deck_dir(self.key), incidents[0])) as f:
            inc = json.load(f)
        self.assertEqual((inc["journal"], inc["offset"]), (w + ".log", first))
        w2 = decks.new_writer()
        for call in (lambda: decks.append(self.key, w2, self.rec(w2, 1)),
                     lambda: decks.compact(self.key, 1, self.snap(2, {w: 10}))):
            with self.assertRaises(decks.DeckError) as e:
                call()
            self.assertEqual(e.exception.status, 423)
        decks.tail(self.key, {})                                        # seen again: still one incident file
        with open(path, "rb") as f:
            self.assertEqual(f.read(), bytes(data))                     # nothing overwritten
        self.assertEqual(len([n for n in os.listdir(decks.deck_dir(self.key)) if n.startswith("incident-")]), 1)
        decks.reset()                                                   # another helper: sees the incident at once
        with self.assertRaises(decks.DeckError) as e:
            decks.append(self.key, w2, self.rec(w2, 1))
        self.assertEqual(e.exception.status, 423)
        self.assertEqual(decks.read_snapshot(self.key)["gen"], 1)

    # ---------------------------------------------------------------- 5. compaction
    def snap(self, gen, frontier, lamport=0, rev=0, seen=()):
        return {"format": 4, "gen": gen, "workbook": WB, "lamport": lamport, "rev": rev, "frontier": frontier,
                "doc": {"schema": 3, "workbook": WB, "preset": None, "style": {}, "edits": {}, "seen": sorted(seen)}}

    def compact_from_view(self, base):
        """what a page does: fold snapshot + tail, write the result with the tail's offsets as the frontier"""
        cur = decks.read_snapshot(self.key)
        res = decks.tail(self.key, dict(cur["frontier"]))
        seen = fold_envelope(cur["doc"].get("seen", []), res)
        frontier = dict(cur["frontier"])
        for j, v in res["journals"].items():
            frontier[j] = v["offset"]
        lam = max([cur["lamport"]] + [r["l"] for v in res["journals"].values() for r in v["records"]])
        return self.snap(base + 1, frontier, lam, len(seen), seen)

    def final_view(self):
        cur = decks.read_snapshot(self.key)
        return fold_envelope(cur["doc"].get("seen", []), decks.tail(self.key, dict(cur["frontier"])))

    def test_5_compaction_is_a_cas_on_gen_and_never_goes_back(self):
        w = decks.new_writer()
        for s in (1, 2, 3):
            decks.append(self.key, w, self.rec(w, s))
        new = self.compact_from_view(1)
        self.assertEqual(decks.compact(self.key, 1, new)["gen"], 2)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 1, self.compact_from_view(1))       # a second compactor with the old base
        self.assertEqual((e.exception.status, e.exception.extra), (409, {"gen": 2}))
        behind = self.compact_from_view(2)
        behind["frontier"][w] -= 1
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 2, behind)
        self.assertEqual(e.exception.status, 409)
        dropped = self.compact_from_view(2)
        dropped["frontier"].pop(w)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 2, dropped)                         # would fold the journal twice
        self.assertEqual(e.exception.status, 409)
        self.assertEqual(decks.read_snapshot(self.key)["gen"], 2)
        self.assertEqual(os.listdir(decks.backup_dir(self.key)), ["2.json"])
        self.assertEqual([h["gen"] for h in decks.history(self.key)], [2])
        self.assertEqual(self.final_view(), {(w, 1), (w, 2), (w, 3)})

    def test_5_two_compactors_at_once(self):
        w = decks.new_writer()
        for s in range(1, 21):
            decks.append(self.key, w, self.rec(w, s))
        snaps = [self.compact_from_view(1) for _ in range(2)]
        ctx = multiprocessing.get_context("spawn")
        with ctx.Pool(2) as pool:
            got = pool.starmap(workers.deck_compact, [(self.root, self.data, "c%d" % i, self.key, 1, snaps[i]) for i in range(2)])
        self.assertEqual(sorted(got), [2, 409])                         # one wins, the other drops its work
        self.assertEqual(decks.read_snapshot(self.key)["gen"], 2)
        self.assertFalse(os.path.exists(os.path.join(decks.deck_dir(self.key), "lock")))
        self.assertEqual(len(self.final_view()), 20)

    def test_5_compactor_dies_after_the_rename(self):
        w = decks.new_writer()
        for s in (1, 2):
            decks.append(self.key, w, self.rec(w, s))
        new = self.compact_from_view(1)
        ctx = multiprocessing.get_context("spawn")
        p = ctx.Process(target=workers.deck_compact_dies_after_rename, args=(self.root, self.data, "c", self.key, 1, new))
        p.start()
        p.join(120)
        self.assertEqual(p.exitcode, 5)
        self.assertEqual(decks.read_snapshot(self.key)["gen"], 2)      # already valid
        self.assertFalse(os.path.exists(decks.backup_dir(self.key)))   # no backup: best effort
        self.assertTrue(os.path.exists(os.path.join(decks.deck_dir(self.key), "lock")))    # left behind ...
        decks.append(self.key, w, self.rec(w, 3))                       # ... and editing never waits for it
        age_lock(self.key, 20)                                          # 20 s later the lock is stale
        self.assertEqual(decks.compact(self.key, 2, self.compact_from_view(2))["gen"], 3)
        self.assertEqual(self.final_view(), {(w, 1), (w, 2), (w, 3)})

    def test_5_writer_rotates_during_compaction(self):
        ctx = multiprocessing.get_context("spawn")
        w = decks.new_writer("anna")
        acked = set()
        for s in range(1, 6):
            decks.append(self.key, w, self.rec(w, s)); acked.add((w, s))
        snap = self.compact_from_view(1)
        stop = threading.Event()

        errors = []

        def writer():                                                 # appends and rotates while compactions run
            s = 6
            while not stop.is_set():
                try:
                    decks.append(self.key, w, self.rec(w, s)); acked.add((w, s)); s += 1
                    if s % 4 == 0:
                        decks.rotate(self.key, w)
                except decks.DeckError as e:                          # a snapshot being replaced (Windows): as a page, again
                    errors.append(e.status)
                    if e.status != 503:
                        raise
        t = threading.Thread(target=writer)
        t.start()
        try:
            gens = [1]
            for _ in range(5):
                got = workers.deck_compact(self.root, self.data, "c", self.key, gens[-1], self.compact_from_view(gens[-1]))
                if got != 409:
                    gens.append(got)
        finally:
            stop.set()
            t.join()
        self.assertEqual(gens, sorted(set(gens)))                      # strictly increasing
        self.assertGreater(len(gens), 2)
        self.assertEqual(set(errors) - {503}, set())
        self.assertEqual(self.final_view() >= acked, True)              # no acknowledged record lost
        self.assertEqual(self.final_view(), acked)
        del ctx, snap

    def test_rotate_deletes_only_covered_journals(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        decks.rotate(self.key, w)                                       # not covered yet: kept
        self.assertEqual(self.journals(), [w + ".log"])
        decks.append(self.key, w, self.rec(w, 2))                       # goes to the new file
        self.assertJournals([w, w + "~*"])
        decks.compact(self.key, 1, self.compact_from_view(1))
        deleted = decks.rotate(self.key, w)["deleted"]
        self.assertEqual((len(deleted), deleted[0]), (2, w))
        self.assertEqual(self.journals(), [])
        decks.append(self.key, w, self.rec(w, 3))
        self.assertEqual(self.final_view(), {(w, 1), (w, 2), (w, 3)})

    def test_compaction_drops_dead_covered_journals_only(self):
        dead, live = "old@pc9#abcdefgh", decks.new_writer()
        jd = decks.journal_dir(self.key)
        os.makedirs(jd)
        with open(os.path.join(jd, dead + ".log"), "wb") as f:
            f.write(decks.frame(self.rec(dead, 1)) + decks.frame(self.rec(dead, 2))[:9])     # a crashed session's torn tail
        decks.append(self.key, live, self.rec(live, 1))
        t = time.time() - decks.DEAD_JOURNAL - 60
        os.utime(os.path.join(jd, dead + ".log"), (t, t))
        with mock.patch.object(decks, "LISTING_TTL", 0):
            r = decks.compact(self.key, 1, self.compact_from_view(1))
        self.assertEqual(r["dropped"], [dead])                          # covered (only a torn tail left) and idle 24 h
        self.assertEqual(self.journals(), [live + ".log"])              # the live one stays
        self.assertNotIn(dead, decks.read_snapshot(self.key)["frontier"])   # the helper took its key out
        self.assertIn(live, decks.read_snapshot(self.key)["frontier"])
        self.assertEqual(self.final_view(), {(dead, 1), (live, 1)})
        with open(os.path.join(decks.backup_dir(self.key), "2.json"), encoding="utf-8") as f:
            self.assertNotIn(dead, json.load(f)["frontier"])            # the backup is the final snapshot
        self.assertEqual(decks.compact(self.key, 2, self.compact_from_view(2))["gen"], 3)

    def test_backups_keep_the_last_30(self):
        for g in range(1, 34):
            decks.compact(self.key, g, self.compact_from_view(g))
        self.assertEqual(sorted(int(n[:-5]) for n in os.listdir(decks.backup_dir(self.key))), list(range(5, 35)))

    # ---------------------------------------------------------------- 6. clock skew
    def test_6_clock_skew(self):
        w_ahead, w_behind = "ahead@pc1#aaaaaaaa", "behind@pc2#bbbbbbbb"
        with skewed(600):
            ra = decks.append(self.key, w_ahead, self.rec(w_ahead, 1, l=5))
            decks.heartbeat(self.key, "clientA", user="ahead", host="pc1")
        decks.reset()
        with skewed(-600):
            rb = decks.append(self.key, w_behind, self.rec(w_behind, 1, l=4))
            others = decks.heartbeat(self.key, "clientB", user="behind", host="pc2")["others"]
        fsclock.reset()
        for r in (ra, rb):                                              # `at` is the file server's time on both
            self.assertAlmostEqual(r["at"] / 1000.0, time.time(), delta=5)
        self.assertEqual([o["user"] for o in others], ["ahead"])        # 10 min ahead, still seen as present now
        recs, _ = self.all_records()
        recs.sort(key=lambda r: (r["l"], r["w"], r["s"]))
        self.assertEqual([r["w"] for r in recs], [w_behind, w_ahead])   # order: Lamport, whatever the clocks

    # ---------------------------------------------------------------- presence v2
    def test_presence_v2(self):
        self.assertEqual(decks.heartbeat(self.key, "c1", user="anna", host="PC1")["others"], [])
        others = decks.heartbeat(self.key, "c2", user="bob rossi", host="PC 7")["others"]
        self.assertEqual([(o["user"], o["host"], o["client"]) for o in others], [("anna", "PC1", "c1")])
        files = sorted(os.listdir(decks.deck_dir(self.key, "presence")))
        self.assertEqual(files, sorted(["anna@PC1#c1", "bob rossi@PC 7#c2"]))
        for f in files:
            self.assertEqual(os.path.getsize(decks.deck_dir(self.key, "presence", f)), 0)   # empty files
        old = time.time() - 30
        os.utime(decks.deck_dir(self.key, "presence", "anna@PC1#c1"), (old, old))
        self.assertEqual(decks.heartbeat(self.key, "c2", user="bob rossi", host="PC 7")["others"], [])
        ancient = time.time() - decks.PRESENCE_CLEANUP - 10
        os.utime(decks.deck_dir(self.key, "presence", "anna@PC1#c1"), (ancient, ancient))
        decks.heartbeat(self.key, "c2", user="bob rossi", host="PC 7")
        self.assertEqual(os.listdir(decks.deck_dir(self.key, "presence")), ["bob rossi@PC 7#c2"])
        self.assertTrue(decks.leave(self.key, "c2", user="bob rossi", host="PC 7"))
        self.assertEqual(os.listdir(decks.deck_dir(self.key, "presence")), [])
        with self.assertRaises(decks.DeckError):
            decks.heartbeat(self.key, "../x")

    # ---------------------------------------------------------------- lean-lock (ADR-006's fallback)
    def test_lean_lock_mode_one_shared_journal(self):
        ctx = multiprocessing.get_context("spawn")
        with ctx.Pool(6) as pool:
            res = [pool.apply_async(workers.deck_append, (self.root, self.data, "u%d" % i, self.key, 25, "lean-lock")) for i in range(6)]
            out = [r.get(timeout=600) for r in res]
        self.assertJournals(["shared~*"])
        acked = {(w, s) for w, ss in out for s in ss}
        self.assertEqual(fold_envelope([], decks.tail(self.key, {})), acked)
        # a writer dies mid-append: the next one starts another shared journal instead of appending after the torn frame
        p = ctx.Process(target=workers.deck_torn, args=(self.root, self.data, "anna", self.key, decks.new_writer("anna"), 1, "lean-lock"))
        p.start()
        p.join(120)
        self.assertEqual(p.exitcode, 3)
        age_lock(self.key, 20)                                          # it died holding the lock: stale 15 s later
        os.environ["SLIDEBUILDER_STORAGE"] = "lean-lock"
        w = decks.new_writer("bob")
        decks.append(self.key, w, self.rec(w, 1))
        self.assertJournals(["shared~*", "shared~*"])
        res = decks.tail(self.key, {})
        self.assertNotIn("readonly", res)
        self.assertEqual(len(fold_envelope([], res)), len(acked) + 2)
        self.assertFalse(os.path.exists(os.path.join(decks.deck_dir(self.key), "lock")))


class DeckReuseTests(DeckBase):
    """review of S5.1: a journal name never comes back, a reader's wrong offset never makes a deck read-only"""

    def test_a_rotated_away_name_is_never_reused_after_a_restart(self):
        w = decks.new_writer()
        for s in (1, 2, 3):
            decks.append(self.key, w, self.rec(w, s))
        snap = decks.read_snapshot(self.key)
        res = decks.tail(self.key, {})
        new = dict(snap, gen=2, frontier={w: res["journals"][w]["offset"]}, lamport=3, rev=3)
        decks.compact(self.key, 1, new)
        self.assertEqual(decks.rotate(self.key, w)["deleted"], [w])   # w.log is gone; its key stays in the frontier
        decks.reset()                                                    # the helper restarts; the page keeps its writer
        r = decks.append(self.key, w, self.rec(w, 4))
        self.assertNotEqual(r["journal"], w)                             # not w.log again
        past = decks.tail(self.key, decks.read_snapshot(self.key)["frontier"])
        self.assertEqual([x["s"] for j in past["journals"].values() for x in j["records"]], [4])     # visible past the frontier
        decks.reset()
        r2 = decks.append(self.key, w, self.rec(w, 5))                   # and again: a third, new name
        self.assertNotIn(r2["journal"], (w, r["journal"]))

    def test_a_first_record_retried_after_rotate_and_restart_never_recreates_the_bare_name(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        res = decks.tail(self.key, {})
        decks.compact(self.key, 1, dict(decks.read_snapshot(self.key), gen=2, frontier={w: res["journals"][w]["offset"]}, lamport=1, rev=1))
        decks.rotate(self.key, w)
        decks.reset()
        r = decks.append(self.key, w, self.rec(w, 1))                    # s == 1 again (a retry)
        self.assertNotEqual(r["journal"], w)

    def test_lean_lock_never_reuses_a_dropped_shared_journal(self):
        os.environ["SLIDEBUILDER_STORAGE"] = "lean-lock"
        w = decks.new_writer()
        first = decks.append(self.key, w, self.rec(w, 1))["journal"]
        os.remove(os.path.join(decks.journal_dir(self.key), first + ".log"))      # dropped by a compaction
        second = decks.append(self.key, w, self.rec(w, 2))["journal"]
        self.assertNotEqual(first, second)
        self.assertEqual(decks.append(self.key, w, self.rec(w, 3))["journal"], second)   # then appended to

    def test_a_wrong_offset_is_read_again_from_the_start_not_an_incident(self):
        w = decks.new_writer()
        for s in (1, 2):
            decks.append(self.key, w, self.rec(w, s))
        res = decks.tail(self.key, {w: 5})                               # not where a record starts
        self.assertNotIn("readonly", res)
        self.assertEqual([r["s"] for r in res["journals"][w]["records"]], [1, 2])
        self.assertEqual([n for n in os.listdir(decks.deck_dir(self.key)) if n.startswith("incident-")], [])
        decks.append(self.key, w, self.rec(w, 3))                        # still writable

    def test_the_edit_path_reads_no_settings_file(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        real = open
        opened = []

        def spy(path, *a, **k):
            opened.append(str(path))
            return real(path, *a, **k)
        with mock.patch("builtins.open", spy), mock.patch.object(decks.os, "listdir", side_effect=AssertionError("listdir")), \
                mock.patch.object(decks.os.path, "exists", side_effect=AssertionError("exists")):
            for s in range(2, 6):
                decks.append(self.key, w, self.rec(w, s))
        self.assertEqual(opened, [])


def age_lock(key, seconds):
    """make the deck's lock file look `seconds` old (time passing, as the file server sees it)"""
    p = os.path.join(decks.deck_dir(key), "lock")
    t = time.time() - seconds
    os.utime(p, (t, t))


class DeckHttpTests(HttpBase):
    def setUp(self):
        super().setUp()
        decks.reset()

    def tearDown(self):
        decks.reset()
        super().tearDown()

    def test_endpoints(self):
        st, r = self.jreq("POST", "/api/decks/open", {"workbook": WB})
        self.assertEqual(st, 200, r)
        key, w = r["key"], r["writer"]
        self.assertEqual((key, r["created"], r["snapshot"]["gen"], r["storage"]), (decks.deck_key(WB), True, 1, "journal"))
        self.assertFalse(self.jreq("POST", "/api/decks/open", {"workbook": WB})[1]["created"])
        base = "/api/decks/" + key
        st, a = self.jreq("POST", base + "/append", {"writer": w, "record": {"w": w, "s": 1, "l": 1, "ops": []}})
        self.assertEqual(st, 200, a)
        st, t = self.jreq("GET", base + "/tail?since=" + json.dumps({}))
        self.assertEqual((st, t["journals"][w]["offset"], t["gen"]), (200, a["offset"], 1))
        st, s = self.jreq("GET", base + "/snapshot")
        self.assertEqual((st, s["snapshot"]["gen"]), (200, 1))
        snap = dict(s["snapshot"], gen=2, frontier={w: a["offset"]}, lamport=1, rev=1)
        self.assertEqual(self.jreq("POST", base + "/compact", {"baseGen": 1, "snapshot": snap}), (200, {"gen": 2, "dropped": []}))
        st, e = self.jreq("POST", base + "/compact", {"baseGen": 1, "snapshot": snap})
        self.assertEqual((st, e["gen"]), (409, 2))
        self.assertEqual(self.jreq("POST", base + "/rotate", {"writer": w}), (200, {"deleted": [w]}))
        self.assertEqual(self.jreq("GET", base + "/history")[1]["backups"][0]["gen"], 2)
        st, p = self.jreq("POST", "/api/presence", {"deck": key, "client": "c1"})
        self.assertEqual((st, p), (200, {"others": []}))
        self.assertEqual(self.jreq("POST", "/api/presence/leave", {"deck": key, "client": "c1"}), (200, {"ok": True}))
        # refusals
        self.assertEqual(self.jreq("GET", "/api/decks/nope-0123456789/snapshot")[0], 404)
        self.assertEqual(self.jreq("GET", "/api/decks/..%2F..%2Fx/snapshot")[0], 400)
        self.assertEqual(self.jreq("GET", base + "/tail?since=notjson")[0], 400)
        self.assertEqual(self.jreq("GET", base + "/tail", token=False)[0], 403)
        self.assertEqual(self.jreq("POST", base + "/append", {"writer": w, "record": {"w": "x", "s": 1, "l": 1}})[0], 400)

    def test_open_refuses_a_deck_still_owned_by_v3(self):
        from slidebuilder import store
        store.update_workbook(WB, [{"op": "style.patch", "patch": {"design": "excel"}}])
        st, r = self.jreq("POST", "/api/decks/open", {"workbook": WB})
        self.assertEqual(st, 409, r)
        self.assertFalse(os.path.exists(paths.data_dir("v4")))


if __name__ == "__main__":
    unittest.main()
