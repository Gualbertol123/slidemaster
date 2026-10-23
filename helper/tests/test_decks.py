"""Decks of Slide Builder 4: snapshot + per-writer journals (docs/next/04 §2, tests 1-6 of 05 §3.6).

The records here are synthetic: the helper never looks inside them (only w, s, l and the `at` it stamps), so
these tests fold them by their envelope - (l, w, s) order, one copy per (w, s) - as core/src/model/fold.ts does.
"""
import json
import re
import shutil
import tempfile
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
        # the file grew to the frame's full length but its last bytes never landed (zeros): torn too (milestone review)
        head = b.index(b":", b.index(b":") + 1) + 1
        for torn in (b[:head] + b"\x00" * (len(b) - head),             # the whole body zero
                     b[:-10] + b"\x00" * 10,                           # its end and the newline zero
                     b[:-1] + b"\x00",                                 # the newline lost, a zero instead
                     b[:-1] + b"\x00" * 50):                           # …and zeros after it
            recs, used, bad = decks.unframe(a + torn)
            self.assertEqual((len(recs), used, bad), (1, len(a), None), torn)

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
        # zeros in a frame with a complete frame after it, or a bad last frame without zeros: corruption
        zeroed = bytearray(a + b + c)
        zeroed[len(a) + 20:len(a) + 25] = b"\x00" * 5
        self.assertEqual(decks.unframe(bytes(zeroed))[2], len(a))
        flipped = bytearray(a + b)
        flipped[len(a) + 20] ^= 0x01
        self.assertEqual(decks.unframe(bytes(flipped))[2], len(a))

    def test_a_length_grown_past_the_end_is_corruption_not_a_torn_tail(self):
        # audit (docs/next/AUDIT.md DATA-1): a frame's length damaged into a bigger number ran past the file's end and
        # was read as a tail still being written - no incident, the records after it invisible, and the journal later
        # counted as covered and deleted. A body never holds a raw line end (compact JSON), so a line end after the
        # header of a frame that is not complete yet means the length is wrong.
        a, b, c = (decks.frame({"w": "x", "s": s, "l": s}) for s in (1, 2, 3))
        n = b[:b.index(b":")]
        grown = a + b"9" + b[len(n):] + c if n[0:1] != b"9" else a + b"1" + b + c   # one digit changed: a bigger length
        self.assertEqual(decks.unframe(grown)[2], len(a))
        self.assertEqual(decks.unframe(a + b"9" + b + c)[2], len(a))              # a digit inserted before a header
        self.assertEqual(decks.unframe(a + b"9" + b)[2], len(a))                  # …also in the last frame
        path = os.path.join(tempfile.mkdtemp(), "j.log")
        with open(path, "wb") as f:
            f.write(grown)
        self.assertFalse(decks._covered(path, len(a)))                            # never "covered", never deleted
        shutil.rmtree(os.path.dirname(path))


class SavedFormatTests(TempDirs):
    """the saved 4.0 deck format (fixtures/saved: snapshot.v4.json + journal.v4.log - never edited) is read by
    this program: a snapshot, the records past its frontier, the torn tail ignored, nothing reported as damaged"""

    def test_the_saved_v4_deck_is_read(self):
        import shutil
        from sbtest import REPO
        fix = os.path.join(REPO, "helper", "tests", "fixtures", "saved")
        with open(os.path.join(fix, "snapshot.v4.json"), encoding="utf-8") as f:
            snap = json.load(f)
        key = decks.deck_key(snap["workbook"])
        writer = list(snap["frontier"])[0]
        os.makedirs(decks.journal_dir(key))
        shutil.copy(os.path.join(fix, "snapshot.v4.json"), decks.snapshot_path(key))
        shutil.copy(os.path.join(fix, "journal.v4.log"), os.path.join(decks.journal_dir(key), writer + ".log"))
        got = decks.read_snapshot(key)
        self.assertEqual((got["format"], got["gen"], got["frontier"], got["seen"]), (4, 2, snap["frontier"], {writer: 2}))
        past = decks.tail(key, dict(snap["frontier"]))
        self.assertEqual([r["s"] for r in past["journals"][writer]["records"]], [3, 4])
        self.assertNotIn("readonly", past)
        everything = decks.tail(key, {})["journals"][writer]
        self.assertEqual([r["s"] for r in everything["records"]], [1, 2, 3, 4])       # the torn 5th is no record
        with open(os.path.join(fix, "journal.v4.log"), "rb") as f:
            data = f.read()
        self.assertLess(everything["offset"], len(data))
        self.assertEqual(decks.unframe(data)[1:], (everything["offset"], None))


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
            json.dump({"format": 11, "gen": 3}, f)            # (5 is read since 4.6, 6 since 4.9, 7 since 4.10, 8 since 4.11, 9 since 4.13, 10 since 4.14: ADR-019)
        with self.assertRaises(decks.DeckError) as e:
            decks.read_snapshot(self.key)
        self.assertEqual(e.exception.status, 409)                     # too new: restart

    def test_identifiers_with_a_line_end_are_refused(self):
        # audit SEC-5: `$` also matches before a final line end, so "<key>\n" passed check_key and the request
        # failed later as a 500 with a traceback instead of a 400
        with self.assertRaises(decks.DeckError) as e:
            decks.check_key(self.key + "\n")
        self.assertEqual(e.exception.status, 400)
        w = decks.new_writer("a") + "\n"
        with self.assertRaises(decks.DeckError):
            decks.append(self.key, w, self.rec(w, 1))
        self.assertIsNone(decks.CLIENT_RE.match("client1\n"))
        self.assertIsNone(decks.JOURNAL_RE.match(decks.new_writer("a") + ".log\n"))

    def test_a_missing_snapshot_is_never_started_again_from_nothing(self):
        # audit DATA-2 (docs/next/AUDIT.md): with snapshot.json gone (deleted, or not seen for a moment), the next open
        # migrated the deck again from its frozen v3 file (or made an empty one) at gen 1, and its next compaction
        # replaced backups/v4/<key>/2.json - the only copy of what had been compacted
        from slidebuilder import migrate_v3
        w = decks.new_writer("a")
        decks.append(self.key, w, self.rec(w, 1))
        os.remove(decks.snapshot_path(self.key))
        for start in (lambda: migrate_v3.ensure_deck(WB), lambda: decks.create_if_missing(WB)):
            with self.assertRaises(decks.DeckError) as e:
                start()
            self.assertEqual(e.exception.status, 503)
            self.assertIn("snapshot.json is missing", str(e.exception))
            self.assertFalse(decks.deck_exists(self.key))                    # nothing written in its place
        # a deck moved from v3: its frozen v3 file is not migrated a second time
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "saved", "workbook.v3.json"), "rb") as f:
            doc = json.loads(f.read())
        wb = doc["workbook"] = "Moved from v3.xlsx"
        raw = json.dumps(doc).encode("utf-8")
        os.makedirs(os.path.dirname(migrate_v3.v3_path(wb)), exist_ok=True)
        with open(migrate_v3.v3_path(wb), "wb") as f:
            f.write(raw)
        key, how = migrate_v3.ensure_deck(wb)
        self.assertEqual(how, "migrated")
        os.remove(decks.snapshot_path(key))
        with open(migrate_v3.v3_path(wb), "rb") as f:
            frozen = f.read()
        with self.assertRaises(decks.DeckError) as e:
            migrate_v3.ensure_deck(wb)
        self.assertEqual(e.exception.status, 503)
        self.assertFalse(decks.deck_exists(key))
        with open(migrate_v3.v3_path(wb), "rb") as f:
            self.assertEqual(f.read(), frozen)
        # a backup of a gen is never replaced by a different snapshot of the same gen
        snap = decks.read_snapshot(self.key) if decks.deck_exists(self.key) else decks.first_snapshot(WB, decks.empty_doc(WB))
        a, b = dict(snap, gen=2, by="first"), dict(snap, gen=2, by="second")
        self.assertTrue(decks._backup(self.key, a) and decks._backup(self.key, b))
        with open(os.path.join(decks.backup_dir(self.key), "2.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["by"], "first")
        self.assertEqual(len([n for n in os.listdir(decks.backup_dir(self.key)) if n.startswith("2")]), 2)

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

    def test_rotate_never_deletes_a_journal_a_prepare_opens_meanwhile(self):
        """review of S5.5: a prepare of the same writer while rotate lists the journals waits for it; its new journal
        (empty when listed) is never deleted under it"""
        import threading
        from unittest import mock
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        decks.compact(self.key, 1, self.compact_from_view(1))
        real, started = os.listdir, []

        def listdir(p):
            if not started and p == decks.journal_dir(self.key):
                t = threading.Thread(target=decks.prepare, args=(self.key, w))
                started.append(t)
                t.start()
                time.sleep(0.3)                                         # the prepare would open its journal now
            return real(p)
        with mock.patch.object(decks.os, "listdir", side_effect=listdir):
            deleted = decks.rotate(self.key, w)["deleted"]
        started[0].join(10)
        self.assertEqual(deleted, [w])                                  # the covered journal only
        self.assertJournals([w + "~*"])                                 # the prepared one is there…
        decks.append(self.key, w, self.rec(w, 2))                       # …and the next record goes into it
        self.assertJournals([w + "~*"])
        self.assertEqual(self.final_view(), {(w, 1), (w, 2)})

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

    def test_lean_lock_never_reuses_a_shared_journal_in_the_same_millisecond(self):
        """CI (Linux): a dropped shared journal and its successor created within one ms got the same name"""
        os.environ["SLIDEBUILDER_STORAGE"] = "lean-lock"
        w = decks.new_writer()
        with mock.patch.object(decks, "server_ms", return_value=1792050322091):
            first = decks.append(self.key, w, self.rec(w, 1))["journal"]
            os.remove(os.path.join(decks.journal_dir(self.key), first + ".log"))
            second = decks.append(self.key, w, self.rec(w, 2))["journal"]
            self.assertNotEqual(first, second)
            # another helper (nothing remembered): the snapshot's frontier still names the dropped journals
            res = decks.tail(self.key, {})
            decks.compact(self.key, 1, dict(decks.read_snapshot(self.key), gen=2, lamport=2, rev=2,
                                            frontier={first: 0, second: res["journals"][second]["offset"]}))
            os.remove(os.path.join(decks.journal_dir(self.key), second + ".log"))
            decks.reset()
            third = decks.append(self.key, w, self.rec(w, 3))["journal"]
        self.assertNotIn(third, (first, second))

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


class PrepareTests(DeckBase):
    """POST /api/decks/<key>/prepare: the journal opened during the page's debounce (S5.4)"""

    def test_prepare_is_idempotent_and_the_append_uses_its_file(self):
        w = decks.new_writer()
        decks.prepare(self.key, w)
        decks.prepare(self.key, w)
        self.assertJournals([w])                                       # one file, the bare name (this helper issued w)
        self.assertEqual(decks.append(self.key, w, self.rec(w, 1))["journal"], w)
        self.assertJournals([w])

    def test_prepare_of_a_writer_this_helper_did_not_issue_never_takes_the_bare_name(self):
        w = "other@pc9#abcdefgh"
        decks.prepare(self.key, w)
        self.assertJournals([w + "~*"])

    def test_prepare_refuses_a_read_only_deck_and_does_nothing_in_lean_lock(self):
        with open(os.path.join(decks.deck_dir(self.key), "incident-x-1.json"), "w") as f:
            f.write("{}")
        decks.reset()
        with self.assertRaises(decks.DeckError) as e:
            decks.prepare(self.key, decks.new_writer())
        self.assertEqual(e.exception.status, 423)
        os.remove(os.path.join(decks.deck_dir(self.key), "incident-x-1.json"))
        decks.reset()
        os.environ["SLIDEBUILDER_STORAGE"] = "lean-lock"
        self.assertEqual(decks.prepare(self.key, decks.new_writer()), {"ok": True})
        self.assertFalse(os.path.exists(decks.journal_dir(self.key)))

    def test_empty_journals_are_deleted(self):
        w = decks.new_writer()
        decks.prepare(self.key, w)                                     # an edit that never came
        self.assertEqual(decks.rotate(self.key, w)["deleted"], [w])    # the owner's rotate deletes it
        dead = "gone@pc9#abcdefgh"
        os.makedirs(decks.journal_dir(self.key), exist_ok=True)
        p = os.path.join(decks.journal_dir(self.key), dead + "~5.log")
        open(p, "wb").close()
        t = time.time() - decks.DEAD_JOURNAL - 60
        os.utime(p, (t, t))
        w2 = decks.new_writer()
        decks.append(self.key, w2, self.rec(w2, 1))
        res = decks.tail(self.key, {})
        snap = decks.read_snapshot(self.key)
        r = decks.compact(self.key, 1, dict(snap, gen=2, lamport=1, rev=1, frontier={w2: res["journals"][w2]["offset"]}))
        self.assertEqual(r["dropped"], [dead + "~5"])                  # and a compaction one idle for 24 h
        self.assertJournals([w2])


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

    def test_open_migrates_a_deck_saved_by_v3(self):
        from sbtest import write_v3_doc
        write_v3_doc(WB, {"style": {"design": "excel"}})
        st, r = self.jreq("POST", "/api/decks/open", {"workbook": WB})
        self.assertEqual((st, r["migrated"], r["snapshot"]["doc"]["style"]), (200, True, {"design": "excel"}), r)
        self.assertEqual(self.jreq("GET", "/api/decks")[1]["decks"][0]["workbook"], WB)
        self.assertEqual(self.jreq("POST", "/api/decks/open", {"workbook": WB})[1]["migrated"], False)


# --------------------------------------------------------------------------- the per-deck format guard (ADR-019)
def raise_to_5(key):
    """what a 4.6 page does (DocSync.upgrade): the marker, the wait (none here), then the snapshot unchanged with
    gen + 1 and format 5"""
    decks.mark_format5(key)
    snap = decks.read_snapshot(key)
    with mock.patch.object(decks, "BUMP_WAIT_S", 0):
        decks.compact(key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=5))
    return decks.read_snapshot(key)


class FormatGuardTests(DeckBase):
    def test_new_decks_are_format_4_without_a_marker(self):
        snap = decks.read_snapshot(self.key)
        self.assertEqual(snap["format"], 4)
        self.assertFalse(decks.is_format5(self.key))
        self.assertEqual(decks.summary(snap)["format"], 4)

    def test_the_marker_tells_the_page_the_helpers_wait(self):
        self.assertEqual(decks.mark_format5(self.key)["wait"], int(decks.BUMP_WAIT_S * 1000))

    def test_the_wait_is_23_s_unless_the_test_setting_shortens_it(self):
        import subprocess
        import sys
        code = "from slidebuilder import decks; print(decks.BUMP_WAIT_S)"
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        def run(env):
            e = dict(os.environ)
            for k in ("SLIDEBUILDER_TEST_BUMP_WAIT_S", "SLIDEBUILDER_NO_NET"):
                e.pop(k, None)
            e.update(env)
            return subprocess.run([sys.executable, "-c", code], cwd=here, env=e, stdout=subprocess.PIPE,
                                  universal_newlines=True, check=True).stdout.strip()
        self.assertEqual(run({}), "23.0")
        self.assertEqual(run({"SLIDEBUILDER_TEST_BUMP_WAIT_S": "2", "SLIDEBUILDER_NO_NET": "1"}), "2.0")
        self.assertEqual(run({"SLIDEBUILDER_TEST_BUMP_WAIT_S": "soon", "SLIDEBUILDER_NO_NET": "1"}), "23.0")
        # review of M13, 3: not without SLIDEBUILDER_NO_NET; inf/nan (int(inf * 1000) raised) and out of 0..23 ignored
        self.assertEqual(run({"SLIDEBUILDER_TEST_BUMP_WAIT_S": "2"}), "23.0")
        for v in ("inf", "nan", "-1", "23.5", "1e9"):
            self.assertEqual(run({"SLIDEBUILDER_TEST_BUMP_WAIT_S": v, "SLIDEBUILDER_NO_NET": "1"}), "23.0", v)

    def test_the_test_wait_is_bounded_and_needs_no_net(self):
        # review of M13, 3: read_test_bump_wait -> (seconds or None, the start-up log line)
        f = decks.read_test_bump_wait
        on = {"SLIDEBUILDER_NO_NET": "1"}
        self.assertEqual(f({}), (None, None))
        self.assertEqual(f(on), (None, None))
        v, note = f(dict(on, SLIDEBUILDER_TEST_BUMP_WAIT_S="2"))
        self.assertEqual(v, 2.0)
        self.assertIn("WARNING - TEST SETTING", note)
        self.assertEqual(f(dict(on, SLIDEBUILDER_TEST_BUMP_WAIT_S="0"))[0], 0.0)
        self.assertEqual(f(dict(on, SLIDEBUILDER_TEST_BUMP_WAIT_S="23"))[0], 23.0)
        for env in ({"SLIDEBUILDER_TEST_BUMP_WAIT_S": "2"}, {"SLIDEBUILDER_TEST_BUMP_WAIT_S": "2", "SLIDEBUILDER_NO_NET": "0"}):
            v, note = f(env)
            self.assertIsNone(v)
            self.assertIn("honoured only with SLIDEBUILDER_NO_NET=1", note)
        for raw in ("inf", "-inf", "nan", "-0.5", "23.01", "soon"):
            v, note = f(dict(on, SLIDEBUILDER_TEST_BUMP_WAIT_S=raw))
            self.assertIsNone(v, raw)
            self.assertIn("ignored: not a number of seconds from 0 to 23", note)
        with mock.patch.object(decks, "BUMP_WAIT_S", 2.0):               # (the bound is the real wait, not the current one)
            self.assertEqual(f(dict(on, SLIDEBUILDER_TEST_BUMP_WAIT_S="20"))[0], 20.0)

    def test_the_marker_is_written_once_and_is_no_incident_here(self):
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        m = decks.mark_format5(self.key)
        self.assertTrue(m["created"])
        self.assertAlmostEqual(m["at"] / 1000.0, time.time(), delta=5)
        with open(decks.deck_dir(self.key, decks.MARKER5), encoding="utf-8") as f:
            body = json.load(f)
        self.assertEqual((body["deck"], body["format"], body["at"], body["by"]), (self.key, 5, m["at"], "tester@pc1"))
        self.assertIn("4.6", body["what"])
        again = decks.mark_format5(self.key)                       # O_EXCL: the first one stays, its time is told
        self.assertEqual((again["created"], again["at"]), (False, m["at"]))
        decks.reset()                                               # (another helper, or this one restarted)
        self.assertIsNone(decks.readonly_reason(self.key))
        decks.append(self.key, w, self.rec(w, 2))                   # 4.6 writes on
        self.assertNotIn("readonly", decks.tail(self.key, {}))
        decks.prepare(self.key, w)
        # a real incident keeps its meaning (and no marker is written on a read-only deck)
        with open(decks.deck_dir(self.key, "incident-%s-10.json" % w), "w") as f:
            f.write("{}")
        decks.reset()
        with self.assertRaises(decks.DeckError) as e:
            decks.append(self.key, w, self.rec(w, 3))
        self.assertEqual(e.exception.status, 423)
        self.assertIn("incident-%s-10.json" % w, e.exception.args[0])

    def test_marker_on_a_missing_or_read_only_deck_is_refused(self):
        with self.assertRaises(decks.DeckError) as e:
            decks.mark_format5(decks.deck_key("Other.xlsx"))
        self.assertEqual(e.exception.status, 404)
        self.assertFalse(os.path.exists(decks.deck_dir(decks.deck_key("Other.xlsx"))))
        with open(decks.deck_dir(self.key, "incident-x-1.json"), "w") as f:
            f.write("{}")
        decks.reset()
        with self.assertRaises(decks.DeckError) as e:
            decks.mark_format5(self.key)
        self.assertEqual(e.exception.status, 423)
        self.assertFalse(decks.is_format5(self.key))

    def test_compactions_at_4_and_5_never_lowered(self):
        w = decks.new_writer()
        a = decks.append(self.key, w, self.rec(w, 1))
        snap = raise_to_5(self.key)
        self.assertEqual((snap["format"], snap["gen"], snap["frontier"]), (5, 2, {}))
        self.assertEqual(decks.summary(snap)["format"], 5)
        down = dict(snap, gen=3, frontier={w: a["offset"]}, lamport=1, rev=1, format=4)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 2, down)
        self.assertEqual(e.exception.status, 400)
        self.assertIn("4.6", e.exception.args[0])
        self.assertEqual(decks.read_snapshot(self.key)["gen"], 2)
        decks.compact(self.key, 2, dict(down, format=5))               # (5 -> 5: no wait)
        self.assertEqual(decks.read_snapshot(self.key)["format"], 5)
        for bad in (11, None, "5"):                                    # (7 is 4.10's, B52; 8 is 4.11's, B53; 9 is 4.13's, B54; 10 is 4.14's, B55)
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, 3, dict(down, gen=4, format=bad))
            self.assertEqual(e.exception.status, 400, bad)

    def test_a_raise_to_5_needs_the_marker_and_the_wait_first(self):
        # review of S13.1, 5: the helper's own wall - a raise is refused (409) until the marker is BUMP_WAIT_S old
        self.assertEqual(decks.BUMP_WAIT_S, 23.0)
        snap = decks.read_snapshot(self.key)
        up = dict(snap, gen=2, format=5)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 1, up)                                # (a page that skipped format5: never ours)
        self.assertEqual(e.exception.status, 409)
        self.assertIn("prepared", e.exception.args[0])
        self.assertTrue(decks.is_format5(self.key))                       # the marker is written: the wait starts now
        self.assertEqual(decks.read_snapshot(self.key)["format"], 4)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, 1, up)                                # 0 s of the 23 s passed
        self.assertEqual(e.exception.status, 409)
        at = decks.mark_format5(self.key)["at"]
        with mock.patch.object(decks, "server_ms", return_value=at + 21500):
            with self.assertRaises(decks.DeckError):
                decks.compact(self.key, 1, up)                            # 21.5 s: still refused
        with mock.patch.object(decks, "server_ms", return_value=at + 22000):
            decks.compact(self.key, 1, up)                                # 22 s (1 s for the clocks): raised
        self.assertEqual(decks.read_snapshot(self.key)["format"], 5)

    def test_format5_lists_the_journals_afresh(self):
        # review of S13.1, 2: the page asks for the marker again after its wait, so its next tail sees a journal an old
        # helper opened in the gap at once, not LISTING_TTL later
        w = decks.new_writer()
        decks.append(self.key, w, self.rec(w, 1))
        decks.mark_format5(self.key)
        self.assertEqual(list(decks.tail(self.key, {})["journals"]), [w])
        other = "old@pc9#abcdefgh"
        with open(os.path.join(decks.journal_dir(self.key), other + ".log"), "wb") as f:   # another PC's helper, in the gap
            f.write(decks.frame(self.rec(other, 1)))
        self.assertNotIn(other, decks.tail(self.key, {})["journals"])    # the listing cached LISTING_TTL
        self.assertFalse(decks.mark_format5(self.key)["created"])
        self.assertIn(other, decks.tail(self.key, {})["journals"])

    def test_a_format_5_snapshot_without_its_marker_gets_it_back(self):
        # review of S13.1, 3: removed by hand, or a backup put back by hand - old helpers would refuse reads but take
        # appends of a page still open; the next read here writes it again
        raise_to_5(self.key)
        os.remove(decks.deck_dir(self.key, decks.MARKER5))
        self.assertEqual(decks.read_snapshot(self.key)["format"], 5)
        self.assertTrue(decks.is_format5(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER5), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["format"], 5)
        # a format-4 deck never gets one; a deck folder gone is not re-created
        other = decks.create_if_missing("Other.xlsx")[0]
        decks.read_snapshot(other)
        self.assertFalse(decks.is_format5(other))
        os.remove(decks.deck_dir(self.key, decks.MARKER5))
        with mock.patch.object(decks, "server_ms", side_effect=decks.DeckError(503, "the share is away")):
            self.assertEqual(decks.read_snapshot(self.key)["format"], 5)  # a failed write never fails the read
        self.assertFalse(decks.is_format5(self.key))

    def test_a_newer_format_is_still_refused(self):
        snap = decks.read_snapshot(self.key)
        decks.write_snapshot(self.key, dict(snap, format=11))        # (7 is read since 4.10, B52; 8 since 4.11, B53; 9 since 4.13, B54; 10 since 4.14, B55)
        with self.assertRaises(decks.DeckError) as e:
            decks.read_snapshot(self.key)
        self.assertEqual(e.exception.status, 409)

    def test_the_page_reads_what_this_helper_reads(self):
        from sbtest import REPO
        with open(os.path.join(REPO, "core", "src", "model", "fold.ts"), encoding="utf-8") as f:
            m = re.search(r"export const DECK_FORMATS = \[([^\]]*)\]", f.read())
        self.assertEqual(tuple(int(x) for x in m.group(1).split(",")), decks.READ_FORMATS)

    def test_check_page(self):
        self.assertEqual(decks.page_formats("4,5"), {4, 5})
        self.assertEqual(decks.page_formats(" 4 , 5 "), {4, 5})
        self.assertEqual(decks.page_formats(None), set())
        decks.check_page(self.key, set())                               # a format-4 deck: old pages keep working (CP-02)
        decks.check_page(self.key, set(), decks.read_snapshot(self.key))
        raise_to_5(self.key)
        decks.check_page(self.key, {4, 5})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            with self.assertRaises(decks.DeckError) as e:
                decks.check_page(self.key, {4}, snap)
            self.assertEqual(e.exception.status, 409)
            self.assertIn("reload the page", e.exception.args[0])


class Format6Tests(DeckBase):
    """AUDIT-3 COMPAT-1 (ADR-019 amendment of 2026-10-22): 4.9 objects raise the deck to format 6 the way 4.6's raised
    it to 5 - its own marker, which every 4.0-4.8 helper takes for an incident, the wait, never lowered; a page that does
    not read 6 (a 4.6-4.8 page: X-SB-Deck-Formats 4,5) is refused"""

    def raise_to_6(self):
        decks.mark_format5(self.key, fmt=6)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=6))
        return decks.read_snapshot(self.key)

    def test_the_marker_is_an_incident_to_4_0_to_4_8_only(self):
        self.assertEqual(decks.MARKER6, "incident-format-6.json")
        self.assertFalse(decks._is_incident(decks.MARKER6))
        self.assertFalse(decks._is_incident(decks.MARKER5))
        self.assertTrue(decks._is_incident("incident-x-1.json"))
        # 4.6.0-4.8.0's rule (v4.6.0:helper/slidebuilder/decks.py _is_incident) and 4.0-4.5's (every incident- file)
        old46 = lambda n: n.startswith("incident-") and n.endswith(".json") and n != "incident-format-5.json"
        self.assertTrue(old46(decks.MARKER6))
        m = decks.mark_format5(self.key, fmt=6)
        self.assertTrue(m["created"])
        self.assertTrue(decks.is_format6(self.key))
        self.assertFalse(decks.is_format5(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER6), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["format"], 6)
        decks.reset()
        decks._look(self.key, 0)                                         # this helper: no incident, not read-only
        self.assertIsNone(decks._readonly.get(self.key))
        with self.assertRaises(decks.DeckError) as e:
            decks.mark_format5(self.key, fmt=11)                         # (7 is 4.10's, B52; 8 is 4.11's, B53; 9 is 4.13's, B54; 10 is 4.14's, B55)
        self.assertEqual(e.exception.status, 400)

    def test_a_raise_to_6_needs_its_marker_and_the_wait_and_is_never_lowered(self):
        snap = decks.read_snapshot(self.key)
        raise_to_5(self.key)
        snap = decks.read_snapshot(self.key)
        up = dict(snap, gen=snap["gen"] + 1, format=6)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, snap["gen"], up)                      # the format-5 marker is not the format-6 one
        self.assertEqual(e.exception.status, 409)
        self.assertIn("4.9", e.exception.args[0])
        self.assertTrue(decks.is_format6(self.key))
        at = decks.mark_format5(self.key, fmt=6)["at"]
        with mock.patch.object(decks, "server_ms", return_value=at + 21500):
            with self.assertRaises(decks.DeckError):
                decks.compact(self.key, snap["gen"], up)
        with mock.patch.object(decks, "server_ms", return_value=at + 22000):
            decks.compact(self.key, snap["gen"], up)
        cur = decks.read_snapshot(self.key)
        self.assertEqual(cur["format"], 6)
        for low in (5, 4):
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=low))
            self.assertEqual(e.exception.status, 400)
            self.assertIn("4.9", e.exception.args[0])
        decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1))      # 6 -> 6: no wait
        # removed by hand: written again on the next read
        os.remove(decks.deck_dir(self.key, decks.MARKER6))
        self.assertEqual(decks.read_snapshot(self.key)["format"], 6)
        self.assertTrue(decks.is_format6(self.key))

    def test_a_4_6_to_4_8_page_is_refused_on_a_format_6_deck(self):
        self.assertEqual(decks.page_formats("4,5,6"), {4, 5, 6})
        raise_to_5(self.key)
        decks.check_page(self.key, {4, 5})                               # format 5: the 4.6-4.8 page works
        self.raise_to_6()
        decks.check_page(self.key, {4, 5, 6})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            for formats in ({4, 5}, {4}, set()):
                with self.assertRaises(decks.DeckError) as e:
                    decks.check_page(self.key, formats, snap)
                self.assertEqual(e.exception.status, 409)
                self.assertIn("reload the page", e.exception.args[0])

    def test_a_format_4_deck_goes_straight_to_6(self):
        self.raise_to_6()
        self.assertEqual(decks.read_snapshot(self.key)["format"], 6)
        self.assertFalse(decks.is_format5(self.key))
        decks.reset()
        with self.assertRaises(decks.DeckError):
            decks.check_page(self.key, {4, 5})


class Format10Tests(DeckBase):
    """B55 (ADR-019 amendment for 4.14): a chart card's subtitle and the budget-achievement chart raise the deck to format
    10 exactly as B54 raised it to 9 - its own marker (an incident to every 4.0-4.13 helper: 4.13 excepts the format-5 to
    format-9 markers only), the wait, never lowered; a 4.13 page (4,5,6,7,8,9) is refused"""

    def raise_to(self, fmt):
        decks.mark_format5(self.key, fmt=fmt)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=fmt))
        return decks.read_snapshot(self.key)

    def test_the_marker_is_an_incident_to_4_0_to_4_13_only(self):
        self.assertEqual(decks.MARKER10, "incident-format-10.json")
        self.assertEqual(decks.READ_FORMATS, (4, 5, 6, 7, 8, 9, 10))
        self.assertFalse(decks._is_incident(decks.MARKER10))
        # 4.13.1's rule (87f0951:helper/slidebuilder/decks.py _is_incident: MARKERS of 5-9)
        old413 = lambda n: n.startswith("incident-") and n.endswith(".json") and n not in ("incident-format-5.json", "incident-format-6.json", "incident-format-7.json", "incident-format-8.json", "incident-format-9.json")
        self.assertTrue(old413(decks.MARKER10))
        m = decks.mark_format5(self.key, fmt=10)
        self.assertTrue(m["created"])
        self.assertTrue(decks.is_format10(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER10), encoding="utf-8") as f:
            body = json.load(f)
        self.assertEqual(body["format"], 10)
        self.assertIn("4.14", body["what"])
        decks.reset()
        decks._look(self.key, 0)
        self.assertIsNone(decks._readonly.get(self.key))
        self.assertEqual(decks._v5.get(self.key), 10)

    def test_a_raise_to_10_is_never_lowered_and_a_4_13_page_is_refused(self):
        self.raise_to(9)
        decks.check_page(self.key, {4, 5, 6, 7, 8, 9})                   # format 9: the 4.13 page works
        cur = self.raise_to(10)
        self.assertEqual(cur["format"], 10)
        for low in (9, 8, 4):
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=low))
            self.assertEqual(e.exception.status, 400)
        decks.check_page(self.key, {4, 5, 6, 7, 8, 9, 10})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            for formats in ({4, 5, 6, 7, 8, 9}, {4, 5, 6, 7, 8}, set()):
                with self.assertRaises(decks.DeckError) as e:
                    decks.check_page(self.key, formats, snap)
                self.assertEqual(e.exception.status, 409)


class Format9Tests(DeckBase):
    """B54 (ADR-019 amendment for 4.13): a KPI card and a chart card's stats, tag, separator, momentum row and filter raise
    the deck to format 9 exactly as B53 raised it to 8 - its own marker (an incident to every 4.0-4.12 helper: 4.11 and
    4.12 except the format-5 to format-8 markers only), the wait, never lowered; a 4.11 / 4.12 page (4,5,6,7,8) is refused"""

    def raise_to(self, fmt):
        decks.mark_format5(self.key, fmt=fmt)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=fmt))
        return decks.read_snapshot(self.key)

    def test_the_marker_is_an_incident_to_4_0_to_4_12_only(self):
        self.assertEqual(decks.MARKER9, "incident-format-9.json")
        self.assertEqual(decks.READ_FORMATS[:6], (4, 5, 6, 7, 8, 9))
        self.assertFalse(decks._is_incident(decks.MARKER9))
        # 4.12.0's rule (5eab103:helper/slidebuilder/decks.py _is_incident: MARKERS of 5-8)
        old412 = lambda n: n.startswith("incident-") and n.endswith(".json") and n not in ("incident-format-5.json", "incident-format-6.json", "incident-format-7.json", "incident-format-8.json")
        self.assertTrue(old412(decks.MARKER9))
        m = decks.mark_format5(self.key, fmt=9)
        self.assertTrue(m["created"])
        self.assertTrue(decks.is_format9(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER9), encoding="utf-8") as f:
            body = json.load(f)
        self.assertEqual(body["format"], 9)
        self.assertIn("4.13", body["what"])
        decks.reset()
        decks._look(self.key, 0)
        self.assertIsNone(decks._readonly.get(self.key))
        self.assertEqual(decks._v5.get(self.key), 9)

    def test_a_raise_to_9_is_never_lowered_and_a_4_12_page_is_refused(self):
        self.raise_to(8)
        decks.check_page(self.key, {4, 5, 6, 7, 8})                      # format 8: the 4.12 page works
        cur = self.raise_to(9)
        self.assertEqual(cur["format"], 9)
        for low in (8, 7, 4):
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=low))
            self.assertEqual(e.exception.status, 400)
        decks.check_page(self.key, {4, 5, 6, 7, 8, 9})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            for formats in ({4, 5, 6, 7, 8}, {4, 5, 6, 7}, set()):
                with self.assertRaises(decks.DeckError) as e:
                    decks.check_page(self.key, formats, snap)
                self.assertEqual(e.exception.status, 409)


class Format8Tests(DeckBase):
    """B53 (ADR-019 amendment for 4.11): label places, labels dragged on the stage and an axis's bounds from cells raise the
    deck to format 8 exactly as 4.10's targets raised it to 7 - its own marker (an incident to every 4.0-4.10 helper: 4.10
    excepts the format-5 to format-7 markers only), the wait, never lowered; a page that does not read 8 (a 4.10 page:
    4,5,6,7) is refused"""

    def raise_to(self, fmt):
        decks.mark_format5(self.key, fmt=fmt)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=fmt))
        return decks.read_snapshot(self.key)

    def test_the_marker_is_an_incident_to_4_0_to_4_10_only(self):
        self.assertEqual(decks.MARKER8, "incident-format-8.json")
        self.assertEqual(decks.READ_FORMATS[:5], (4, 5, 6, 7, 8))
        self.assertFalse(decks._is_incident(decks.MARKER8))
        # 4.10.1's rule (c504829:helper/slidebuilder/decks.py _is_incident: MARKERS of 5-7), 4.9's
        old410 = lambda n: n.startswith("incident-") and n.endswith(".json") and n not in ("incident-format-5.json", "incident-format-6.json", "incident-format-7.json")
        old49 = lambda n: n.startswith("incident-") and n.endswith(".json") and n not in ("incident-format-5.json", "incident-format-6.json")
        self.assertTrue(old410(decks.MARKER8))
        self.assertTrue(old49(decks.MARKER8))
        m = decks.mark_format5(self.key, fmt=8)
        self.assertTrue(m["created"])
        self.assertTrue(decks.is_format8(self.key))
        self.assertFalse(decks.is_format7(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER8), encoding="utf-8") as f:
            body = json.load(f)
        self.assertEqual(body["format"], 8)
        self.assertIn("4.11", body["what"])
        decks.reset()
        decks._look(self.key, 0)
        self.assertIsNone(decks._readonly.get(self.key))
        self.assertEqual(decks._v5.get(self.key), 8)

    def test_a_raise_to_8_needs_its_marker_and_the_wait_and_is_never_lowered(self):
        self.raise_to(7)
        snap = decks.read_snapshot(self.key)
        up = dict(snap, gen=snap["gen"] + 1, format=8)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, snap["gen"], up)                      # the format-7 marker is not the format-8 one
        self.assertEqual(e.exception.status, 409)
        self.assertIn("4.11", e.exception.args[0])
        self.assertTrue(decks.is_format8(self.key))
        at = decks.mark_format5(self.key, fmt=8)["at"]
        with mock.patch.object(decks, "server_ms", return_value=at + 21500):
            with self.assertRaises(decks.DeckError):
                decks.compact(self.key, snap["gen"], up)
        with mock.patch.object(decks, "server_ms", return_value=at + 22000):
            decks.compact(self.key, snap["gen"], up)
        cur = decks.read_snapshot(self.key)
        self.assertEqual(cur["format"], 8)
        for low in (7, 6, 5, 4):
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=low))
            self.assertEqual(e.exception.status, 400)
            self.assertIn("4.11", e.exception.args[0])
        decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1))      # 8 -> 8: no wait
        os.remove(decks.deck_dir(self.key, decks.MARKER8))                   # removed by hand: written again on the next read
        self.assertEqual(decks.read_snapshot(self.key)["format"], 8)
        self.assertTrue(decks.is_format8(self.key))

    def test_a_4_10_page_is_refused_on_a_format_8_deck(self):
        self.assertEqual(decks.page_formats("4,5,6,7,8"), {4, 5, 6, 7, 8})
        self.raise_to(7)
        decks.check_page(self.key, {4, 5, 6, 7})                         # format 7: the 4.10 page works
        self.raise_to(8)
        decks.check_page(self.key, {4, 5, 6, 7, 8})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            for formats in ({4, 5, 6, 7}, {4, 5, 6}, {4, 5}, {4}, set()):
                with self.assertRaises(decks.DeckError) as e:
                    decks.check_page(self.key, formats, snap)
                self.assertEqual(e.exception.status, 409)
                self.assertIn("reload the page", e.exception.args[0])

    def test_a_format_4_deck_goes_straight_to_8(self):
        self.raise_to(8)
        self.assertEqual(decks.read_snapshot(self.key)["format"], 8)
        self.assertFalse(decks.is_format5(self.key))
        self.assertFalse(decks.is_format7(self.key))
        decks.reset()
        for formats in ({4, 5, 6, 7}, {4, 5}):
            with self.assertRaises(decks.DeckError):
                decks.check_page(self.key, formats)


class Format7Tests(DeckBase):
    """B52 (ADR-019 amendment for 4.10): a chart's reference lines, gap arrows and change pills raise the deck to format
    7 exactly as 4.9's objects raised it to 6 - its own marker (an incident to every 4.0-4.9 helper: 4.9 excepts the
    format-5 and format-6 markers only), the wait, never lowered; a page that does not read 7 (a 4.9 page: 4,5,6) is
    refused"""

    def raise_to(self, fmt):
        decks.mark_format5(self.key, fmt=fmt)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=fmt))
        return decks.read_snapshot(self.key)

    def test_the_marker_is_an_incident_to_4_0_to_4_9_only(self):
        self.assertEqual(decks.MARKER7, "incident-format-7.json")
        self.assertEqual(decks.READ_FORMATS[:4], (4, 5, 6, 7))
        self.assertFalse(decks._is_incident(decks.MARKER7))
        # 4.9.0's rule (v4/release-4.9.0:helper/slidebuilder/decks.py _is_incident), 4.6-4.8's and 4.0-4.5's
        old49 = lambda n: n.startswith("incident-") and n.endswith(".json") and n not in ("incident-format-5.json", "incident-format-6.json")
        old46 = lambda n: n.startswith("incident-") and n.endswith(".json") and n != "incident-format-5.json"
        self.assertTrue(old49(decks.MARKER7))
        self.assertTrue(old46(decks.MARKER7))
        m = decks.mark_format5(self.key, fmt=7)
        self.assertTrue(m["created"])
        self.assertTrue(decks.is_format7(self.key))
        self.assertFalse(decks.is_format6(self.key))
        with open(decks.deck_dir(self.key, decks.MARKER7), encoding="utf-8") as f:
            body = json.load(f)
        self.assertEqual(body["format"], 7)
        self.assertIn("4.10", body["what"])
        decks.reset()
        decks._look(self.key, 0)
        self.assertIsNone(decks._readonly.get(self.key))
        self.assertEqual(decks._v5.get(self.key), 7)

    def test_a_raise_to_7_needs_its_marker_and_the_wait_and_is_never_lowered(self):
        self.raise_to(6)
        snap = decks.read_snapshot(self.key)
        up = dict(snap, gen=snap["gen"] + 1, format=7)
        with self.assertRaises(decks.DeckError) as e:
            decks.compact(self.key, snap["gen"], up)                      # the format-6 marker is not the format-7 one
        self.assertEqual(e.exception.status, 409)
        self.assertIn("4.10", e.exception.args[0])
        self.assertTrue(decks.is_format7(self.key))
        at = decks.mark_format5(self.key, fmt=7)["at"]
        with mock.patch.object(decks, "server_ms", return_value=at + 21500):
            with self.assertRaises(decks.DeckError):
                decks.compact(self.key, snap["gen"], up)
        with mock.patch.object(decks, "server_ms", return_value=at + 22000):
            decks.compact(self.key, snap["gen"], up)
        cur = decks.read_snapshot(self.key)
        self.assertEqual(cur["format"], 7)
        for low in (6, 5, 4):
            with self.assertRaises(decks.DeckError) as e:
                decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=low))
            self.assertEqual(e.exception.status, 400)
            self.assertIn("4.10", e.exception.args[0])
        decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1))      # 7 -> 7: no wait
        os.remove(decks.deck_dir(self.key, decks.MARKER7))                   # removed by hand: written again on the next read
        self.assertEqual(decks.read_snapshot(self.key)["format"], 7)
        self.assertTrue(decks.is_format7(self.key))

    def test_a_4_9_page_is_refused_on_a_format_7_deck(self):
        self.assertEqual(decks.page_formats("4,5,6,7"), {4, 5, 6, 7})
        self.raise_to(6)
        decks.check_page(self.key, {4, 5, 6})                            # format 6: the 4.9 page works
        self.raise_to(7)
        decks.check_page(self.key, {4, 5, 6, 7})
        decks.reset()
        for snap in (None, decks.read_snapshot(self.key)):
            for formats in ({4, 5, 6}, {4, 5}, {4}, set()):
                with self.assertRaises(decks.DeckError) as e:
                    decks.check_page(self.key, formats, snap)
                self.assertEqual(e.exception.status, 409)
                self.assertIn("reload the page", e.exception.args[0])

    def test_a_format_4_deck_goes_straight_to_7(self):
        self.raise_to(7)
        self.assertEqual(decks.read_snapshot(self.key)["format"], 7)
        self.assertFalse(decks.is_format5(self.key))
        self.assertFalse(decks.is_format6(self.key))
        decks.reset()
        for formats in ({4, 5, 6}, {4, 5}):
            with self.assertRaises(decks.DeckError):
                decks.check_page(self.key, formats)


class SavedFormat5Tests(TempDirs):
    """the saved 4.6 deck format (fixtures/saved: snapshot.v5.json, journal.v5.log, incident-format-5.json - never
    edited) is read by this program: format 5, the records past its frontier, the marker no incident"""

    def test_the_saved_v5_deck_is_read(self):
        from sbtest import REPO
        fix = os.path.join(REPO, "helper", "tests", "fixtures", "saved")
        with open(os.path.join(fix, "snapshot.v5.json"), encoding="utf-8") as f:
            snap = json.load(f)
        key = decks.deck_key(snap["workbook"])
        writer = list(snap["frontier"])[0]
        os.makedirs(decks.journal_dir(key))
        shutil.copy(os.path.join(fix, "snapshot.v5.json"), decks.snapshot_path(key))
        shutil.copy(os.path.join(fix, "journal.v5.log"), os.path.join(decks.journal_dir(key), writer + ".log"))
        shutil.copy(os.path.join(fix, "incident-format-5.json"), decks.deck_dir(key, decks.MARKER5))
        got = decks.read_snapshot(key)
        self.assertEqual((got["format"], got["gen"]), (5, 3))
        past = decks.tail(key, dict(snap["frontier"]))
        self.assertEqual([r["s"] for r in past["journals"][writer]["records"]], [3, 4])
        self.assertNotIn("readonly", past)
        self.assertEqual(decks.mark_format5(key)["created"], False)
        with self.assertRaises(decks.DeckError):
            decks.check_page(key, set())


class OldHelperTests(DeckBase):
    """what the share's 4.0.0 helper does with a deck this helper marked and raised to format 5 - its own code, taken
    from the tag v4.0.0 (git show), on the same data folder. CP-01 repeats it with the real old helpers and pages."""

    old = None

    @classmethod
    def setUpClass(cls):
        import importlib
        import subprocess
        import sys
        from sbtest import REPO
        cls.tmpdir = tempfile.mkdtemp(prefix="sb40_")
        try:
            names = subprocess.run(["git", "-C", REPO, "ls-tree", "--name-only", "v4.0.0", "helper/slidebuilder/"], check=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().split()
            pkg = os.path.join(cls.tmpdir, "sb40")
            os.makedirs(pkg)
            for n in names:
                if n.endswith(".py"):
                    src = subprocess.run(["git", "-C", REPO, "show", "v4.0.0:" + n], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
                    with open(os.path.join(pkg, os.path.basename(n)), "wb") as f:
                        f.write(src)
        except (OSError, subprocess.CalledProcessError) as e:
            shutil.rmtree(cls.tmpdir, ignore_errors=True)
            raise unittest.SkipTest("no git checkout with the tag v4.0.0 here (%s)" % e)
        sys.path.insert(0, cls.tmpdir)
        try:
            cls.old = importlib.import_module("sb40.decks")
            cls.oldpkg = importlib.import_module("sb40")
        finally:
            sys.path.remove(cls.tmpdir)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def setUp(self):
        super().setUp()
        import sb40.paths
        import sb40.fsclock
        sb40.paths.configure()                  # the same ROOT and DATA (this test's folders)
        sb40.fsclock.reset()
        self.old.reset()
        self.assertEqual(self.oldpkg.VERSION, "4.0.0")
        self.assertEqual((self.old.FORMAT, self.old.REFRESH_S), (4, 4.0))
        self.old.REFRESH_S = 0.05               # its folder refresher, sped up (4 s: the bump's wait covers it)

    def tearDown(self):
        self.old.reset()
        self.old.REFRESH_S = 4.0
        super().tearDown()

    def status(self, fn, *a):
        try:
            fn(*a)
        except self.old.DeckError as e:
            return e.status
        return 200

    def test_a_page_that_had_the_deck_open_is_stopped_by_the_marker(self):
        o = self.old
        w = o.new_writer()
        o.append(self.key, w, self.rec(w, 1))                            # its handle is open: re-checked every REFRESH_S
        self.assertNotIn("readonly", o.tail(self.key, {}))
        decks.mark_format5(self.key)
        deadline = time.time() + 5
        while self.status(o.append, self.key, w, self.rec(w, 2)) != 423 and time.time() < deadline:
            time.sleep(0.02)
        mine = [r["s"] for r in decks.tail(self.key, {})["journals"][w]["records"]]
        self.assertEqual(self.status(o.append, self.key, w, self.rec(w, 99)), 423)
        self.assertLessEqual(set(mine), {1, 2})     # only what it sent in the gap (the page waits REFRESH_S + 1 s)
        self.assertIn("readonly", o.tail(self.key, {}))
        self.assertEqual(self.status(o.prepare, self.key, w), 423)
        raise_to_5(self.key)
        t = o.tail(self.key, {})
        self.assertIsNone(t["gen"])                                       # it cannot read the snapshot: never folds
        self.assertIn("readonly", t)
        self.assertEqual(self.status(o.read_snapshot, self.key), 409)    # open refused
        snap = decks.read_snapshot(self.key)
        self.assertEqual(self.status(o.compact, self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=4)), 423)
        self.assertEqual(self.status(o.rotate, self.key, w), 409)
        self.assertEqual(decks.read_snapshot(self.key), snap)             # nothing changed by it
        self.assertEqual([r["s"] for r in decks.tail(self.key, {})["journals"][w]["records"]], mine)
        w6 = decks.new_writer()
        decks.append(self.key, w6, self.rec(w6, 1))                      # 4.6 writes on

    def test_a_helper_without_a_handle_refuses_at_once(self):
        o = self.old
        w = o.new_writer()
        o.tail(self.key, {})                                              # it looked at the deck once (no handle)
        decks.mark_format5(self.key)
        self.assertEqual(self.status(o.append, self.key, w, self.rec(w, 1)), 423)   # a new journal: looked again
        self.assertFalse(os.path.exists(decks.journal_dir(self.key)) and os.listdir(decks.journal_dir(self.key)))

    def test_the_format_alone_blocks_open_compaction_rotation_and_the_24h_drop(self):
        # even if the marker were gone (it never is: deckbin moves it with the deck), format 5 alone keeps the old
        # helper's hands off: its reads under the lock fail before it writes or deletes anything
        o = self.old
        w, w6 = o.new_writer(), decks.new_writer()
        a = o.append(self.key, w, self.rec(w, 1))
        o.reset()                                                         # (its handle closed: a window long gone)
        b = decks.append(self.key, w6, self.rec(w6, 1))
        snap = raise_to_5(self.key)
        snap = dict(snap, frontier={w: a["offset"], w6: b["offset"]}, lamport=1, rev=2, gen=snap["gen"] + 1)
        decks.compact(self.key, snap["gen"] - 1, snap)                   # 4.6 folds both journals: both covered
        os.remove(decks.deck_dir(self.key, decks.MARKER5))
        old_t = time.time() - 25 * 3600                                   # nobody wrote to them for 25 h
        for n in os.listdir(decks.journal_dir(self.key)):
            os.utime(os.path.join(decks.journal_dir(self.key), n), (old_t, old_t))
        before = sorted(os.listdir(decks.journal_dir(self.key)))
        self.assertEqual(self.status(o.read_snapshot, self.key), 409)
        with open(decks.snapshot_path(self.key), encoding="utf-8") as f:
            cur = json.load(f)                                            # (not read here: that writes the marker again)
        self.assertEqual(self.status(o.compact, self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1, format=4)), 409)
        self.assertEqual(self.status(o.compact, self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1)), 400)   # format 5: not its own
        self.assertEqual(self.status(o.rotate, self.key, w), 409)
        self.assertEqual(sorted(os.listdir(decks.journal_dir(self.key))), before)    # the journals survive
        self.assertEqual(decks.read_snapshot(self.key), cur)
        self.assertIsNone(o.tail(self.key, {})["gen"])
        # ... and the next read here writes the marker again: the old helper's appends are refused too (S13.1 review, 3)
        self.assertTrue(decks.is_format5(self.key))
        o.reset()
        self.assertEqual(self.status(o.append, self.key, w, self.rec(w, 2)), 423)

    def test_lean_lock_appends_go_on_until_its_page_tails(self):
        # review of S13.1, 1a: in lean-lock mode (ADR-006's fallback) a 4.0 helper has no append handle, so no folder
        # refresher; an append checks the folder once per helper (no TTL). Only its page's tail (every TAIL_MS = 1.5 s)
        # looks again, at most every CHECK_TTL = 10 s - plus the SMB client's 10 s directory cache on a share. This is
        # why BUMP_WAIT_S is 23 s, not REFRESH_S + 1 s
        o = self.old
        o.CHECK_TTL = 0.2
        try:
            with mock.patch.dict(os.environ, {"SLIDEBUILDER_STORAGE": "lean-lock"}):
                self.assertEqual(o.storage_mode(), "lean-lock")
                w = o.new_writer()
                o.append(self.key, w, self.rec(w, 1))
                self.assertNotIn("readonly", o.tail(self.key, {}))
                decks.mark_format5(self.key)
                for s in (2, 3, 4):
                    time.sleep(3 * self.old.REFRESH_S)                       # past its (sped-up) REFRESH_S: no refresher here
                    self.assertEqual(self.status(o.append, self.key, w, self.rec(w, s)), 200)
                time.sleep(o.CHECK_TTL)
                self.assertIn("readonly", o.tail(self.key, {}))             # its page's next tail, CHECK_TTL later
                self.assertEqual(self.status(o.append, self.key, w, self.rec(w, 5)), 423)
                self.assertEqual(sorted(r["s"] for j in decks.tail(self.key, {})["journals"].values() for r in j["records"]), [1, 2, 3, 4])
        finally:
            o.CHECK_TTL = 10.0

    def test_a_format_4_deck_stays_open_to_it(self):
        # CP-02: decks without 4.6 objects (everything the share's 4.0 made) keep working in 4.0 during the rollout
        o = self.old
        w = o.new_writer()
        a = o.append(self.key, w, self.rec(w, 1))
        snap = o.read_snapshot(self.key)
        o.compact(self.key, 1, dict(snap, gen=2, frontier={w: a["offset"]}, lamport=1, rev=1))
        self.assertEqual(decks.read_snapshot(self.key)["format"], 4)


if __name__ == "__main__":
    unittest.main()
