"""Deleted setups (B44, helper/slidebuilder/deckbin.py): a deck deleted while no other window has it open, kept as a
backup (its folder, its snapshot backups, a copy of its v3 file) with an empty deck in its place, and restored only
while the workbook holds no setup of its own."""
import json
import os
import unittest
from unittest import mock

from sbtest import TempDirs, write_v3_doc
from test_http import HttpBase

from slidebuilder import deckbin, decks, migrate_v3

WB = "Weekly IBD.xlsx"
PRESET = {"tables": [{"id": "t1", "sheet": "SLIDE_1", "kind": "markers", "anchor": "C3", "index": 0}],
          "slides": [{"id": "s1", "type": "content", "tables": ["t1"]}, {"id": "s0", "type": "cover", "tables": []}]}


def v3_file():
    with open(migrate_v3.v3_path(WB), encoding="utf-8") as f:
        return json.load(f)


class DeckBinTests(TempDirs):
    def setUp(self):
        super().setUp()
        decks.reset()
        # a deck with a setup: a migrated v3 document (its v3 file stays, frozen), one compaction's backup, a journal
        write_v3_doc(WB, {"preset": PRESET})
        self.key, how = migrate_v3.ensure_deck(WB)
        self.assertEqual(how, "migrated")
        os.makedirs(decks.backup_dir(self.key))
        with open(os.path.join(decks.backup_dir(self.key), "1.json"), "w") as f:
            f.write("{}")
        self.w = self.writer()
        decks.append(self.key, self.w, {"w": self.w, "s": 1, "l": 1, "ops": []})
        self.snap = decks.read_snapshot(self.key)

    def writer(self):
        """a writer as the helper issues it to a page that opens the deck (bound to the deck as it is now)"""
        w = decks.new_writer()
        decks.bind_writer(w, self.key)
        return w

    def records(self):
        return sum(len(j["records"]) for j in decks.tail(self.key, {})["journals"].values())

    def test_delete_keeps_everything_and_leaves_an_empty_deck(self):
        r = deckbin.delete(self.key)                     # (this helper's own journal handle is closed first)
        self.assertEqual(r["workbook"], WB)
        kept = deckbin.bin_dir(r["id"])
        self.assertTrue(os.path.exists(os.path.join(kept, "deck", "snapshot.json")))
        self.assertTrue(os.listdir(os.path.join(kept, "deck", "j")))
        self.assertTrue(os.path.exists(os.path.join(kept, "backups", "1.json")))
        with open(os.path.join(kept, "v3.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["preset"], PRESET)
        self.assertFalse(os.path.exists(os.path.join(kept, "deck", "lock")))        # released where it went
        self.assertEqual([(x["id"], x["workbook"], x["slides"], x["tables"], x["gen"], x["by"]) for x in deckbin.listing()],
                         [(r["id"], WB, 1, 1, self.snap["gen"], "tester@pc1")])
        # in its place: an empty deck, a later gen, a creation of its own; the v3 file a frozen stub without the setup
        new = decks.read_snapshot(self.key)
        self.assertEqual((new["gen"], new["doc"]["preset"], new["frontier"]), (self.snap["gen"] + 1, None, {}))
        self.assertNotIn("born", new)                    # (the snapshot's keys as before: older helpers rewrite it)
        with open(decks.deck_dir(self.key, decks.BORN), encoding="ascii") as f:
            self.assertRegex(f.read(), r"^[0-9a-f]{12}$")
        self.assertFalse(os.path.exists(os.path.join(kept, "deck", decks.BORN)))   # (the deleted deck had none)
        self.assertFalse(os.path.exists(decks.backup_dir(self.key)))
        self.assertEqual(self.records(), 0)
        stub = v3_file()
        self.assertTrue(migrate_v3.frozen(stub))
        self.assertNotIn("preset", stub)
        self.assertEqual(migrate_v3.ensure_deck(WB), (self.key, "v4"))     # the next open: that empty deck
        self.assertEqual(migrate_v3.list_decks()[0]["preset"], False)

    def test_a_window_of_the_deleted_deck_writes_nothing_into_the_new_one(self):
        old_gen = self.snap["gen"]
        deckbin.delete(self.key)
        # its writer (presence lapsed: a sleeping PC) appends again: refused, nothing written, the page is told to reload
        with self.assertRaises(decks.DeckError) as c:
            decks.append(self.key, self.w, {"w": self.w, "s": 2, "l": 2, "ops": []})
        self.assertEqual(c.exception.status, 409)
        self.assertIn("deleted", str(c.exception))
        self.assertEqual(self.records(), 0)
        # in lean-lock mode too
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_STORAGE": "lean-lock"}):
            decks.reset()
            decks._bound[self.w] = (self.key, None)     # (issued for the deleted deck, which had no born file)
            with self.assertRaises(decks.DeckError):
                decks.append(self.key, self.w, {"w": self.w, "s": 2, "l": 2, "ops": []})
        decks.reset()
        self.assertEqual(self.records(), 0)
        # its compaction on leaving (the old deck's gen): refused, the empty deck stays
        with self.assertRaises(decks.DeckError) as c:
            decks.compact(self.key, old_gen, dict(self.snap, gen=old_gen + 1))
        self.assertEqual(c.exception.status, 409)
        self.assertIsNone(decks.read_snapshot(self.key)["doc"]["preset"])
        # a page that opens the workbook now writes as usual, also after a compaction that writes the page's snapshot
        # as it is (an older helper's)
        w2 = self.writer()
        decks.append(self.key, w2, {"w": w2, "s": 1, "l": 1, "ops": []})
        self.assertEqual(self.records(), 1)
        cur = decks.read_snapshot(self.key)
        decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1))
        decks.forget(self.key)                           # (its handle closed: the next append opens a journal again)
        decks.append(self.key, w2, {"w": w2, "s": 2, "l": 2, "ops": []})
        self.assertEqual(self.records(), 2)

    def test_a_born_file_that_cannot_be_read_refuses_no_one_wrongly(self):
        deckbin.delete(self.key)
        w2 = self.writer()                               # bound to the empty deck's born
        decks.reset()
        decks._bound[w2] = (self.key, decks.born_of(self.key, 0))
        decks._borns.clear()
        real = open

        def unreadable(p, *a, **k):
            if str(p).endswith(os.sep + decks.BORN):
                raise PermissionError("the share is busy")
            return real(p, *a, **k)
        with mock.patch("builtins.open", unreadable):
            decks.append(self.key, w2, {"w": w2, "s": 1, "l": 1, "ops": []})   # not "deleted": the check is skipped
            with self.assertRaises(decks.DeckError) as c:
                decks.bind_writer(decks.new_writer(), self.key)                 # not bound to a guess: try again
            self.assertEqual(c.exception.status, 503)
        self.assertEqual(self.records(), 1)

    def test_a_deck_never_deleted_writes_as_before(self):
        # no born file: every writer bound to None; after compactions, a helper restart (bindings gone), lean-lock mode
        w = self.writer()
        for s in (2, 3):
            cur = decks.read_snapshot(self.key)
            decks.compact(self.key, cur["gen"], dict(cur, gen=cur["gen"] + 1))
            decks.forget(self.key)
            decks.append(self.key, w, {"w": w, "s": s - 1, "l": s, "ops": []})
        decks.reset()                                    # a helper started again: the binding is forgotten
        decks.append(self.key, w, {"w": w, "s": 3, "l": 4, "ops": []})
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_STORAGE": "lean-lock"}):
            decks.reset()
            w3 = self.writer()
            for s in (1, 2):
                decks.append(self.key, w3, {"w": w3, "s": s, "l": 10 + s, "ops": []})
        decks.reset()
        self.assertEqual(self.records(), 1 + 3 + 2)
        self.assertFalse(os.path.exists(decks.deck_dir(self.key, decks.BORN)))

    def test_a_deleted_deck_folder_is_never_made_again_by_an_append(self):
        deckbin.delete(self.key)
        os.rename(decks.deck_dir(self.key), os.path.join(self.tmp, "aside"))         # (as if the empty deck were gone too)
        w = decks.new_writer()
        for mode in ("", "lean-lock"):
            with mock.patch.dict(os.environ, {"SLIDEBUILDER_STORAGE": mode} if mode else {}):
                decks.reset()
                with self.assertRaises(decks.DeckError) as c:
                    decks.append(self.key, w, {"w": w, "s": 1, "l": 1, "ops": []})
                self.assertEqual(c.exception.status, 404)
                self.assertFalse(os.path.exists(decks.journal_dir(self.key)))
                self.assertIsNone(decks.traces(self.key))

    def test_refused_while_another_window_has_it_open_nothing_moves(self):
        decks.heartbeat(self.key, "clientB", user="bob", host="PC2")
        with self.assertRaises(decks.DeckError) as c:
            deckbin.delete(self.key, "clientA")
        self.assertEqual(c.exception.status, 409)
        self.assertIn("bob (PC2)", str(c.exception))
        self.assertEqual([o["user"] for o in c.exception.extra["others"]], ["bob"])
        self.assertEqual(decks.read_snapshot(self.key)["gen"], self.snap["gen"])
        self.assertEqual(v3_file()["preset"], PRESET)
        self.assertTrue(os.path.isdir(decks.backup_dir(self.key)))
        self.assertEqual(deckbin.listing(), [])
        self.assertFalse(os.path.isdir(deckbin.bin_dir()) and os.listdir(deckbin.bin_dir()))
        # the asking window's own (stale) presence does not count
        decks.leave(self.key, "clientB", user="bob", host="PC2")
        decks.heartbeat(self.key, "clientA")
        self.assertEqual(deckbin.delete(self.key, "clientA")["workbook"], WB)

    def test_not_for_a_deck_given_back_to_v3_or_a_document_v3_owns(self):
        with open(decks.deck_dir(self.key, migrate_v3.ROLLED_BACK), "w") as f:
            f.write("{}")
        with self.assertRaises(decks.DeckError) as c:
            deckbin.delete(self.key)
        self.assertIn("Slide Builder 3", str(c.exception))
        os.remove(decks.deck_dir(self.key, migrate_v3.ROLLED_BACK))
        doc = v3_file()
        doc.pop("movedTo")
        with open(migrate_v3.v3_path(WB), "w", encoding="utf-8") as f:
            json.dump(doc, f)
        with self.assertRaises(decks.DeckError) as c:
            deckbin.delete(self.key)
        self.assertIn("Slide Builder 3", str(c.exception))
        self.assertEqual(deckbin.listing(), [])

    def test_a_delete_that_fails_half_way_puts_everything_back(self):
        real = os.rename

        def in_use(a, b):
            if os.path.normcase(a) == os.path.normcase(decks.deck_dir(self.key)):
                raise PermissionError("in use")          # a journal another PC's helper still holds open (Windows)
            return real(a, b)
        for patch in (mock.patch("os.rename", in_use), mock.patch.object(decks, "write_snapshot", side_effect=OSError("disk full"))):
            with patch:
                with self.assertRaises((decks.DeckError, OSError)):
                    deckbin.delete(self.key)
            self.assertEqual(decks.read_snapshot(self.key)["gen"], self.snap["gen"])
            self.assertEqual(self.records(), 1)
            self.assertTrue(os.path.exists(os.path.join(decks.backup_dir(self.key), "1.json")))
            self.assertEqual(v3_file()["preset"], PRESET)
            self.assertFalse(os.path.exists(decks.deck_dir(self.key, "lock")))
            self.assertEqual(deckbin.listing(), [])
            self.assertFalse(os.path.isdir(deckbin.bin_dir()) and os.listdir(deckbin.bin_dir()))
        self.assertEqual(migrate_v3.ensure_deck(WB), (self.key, "v4"))       # the deck is as it was

    def test_restore_only_without_a_setup_and_it_comes_back_as_it_was(self):
        first = deckbin.delete(self.key)["id"]
        self.assertEqual(deckbin.restore(first), {"key": self.key, "workbook": WB})   # the empty deck does not count
        back = decks.read_snapshot(self.key)
        self.assertEqual((back["gen"], back["doc"]["preset"]), (self.snap["gen"], PRESET))
        self.assertIsNone(decks.born_of(self.key, 0))   # its own creation again (it had no born file): its writers write on
        self.assertTrue(os.path.exists(os.path.join(decks.backup_dir(self.key), "1.json")))
        self.assertEqual(self.records(), 1)
        self.assertEqual(v3_file()["preset"], PRESET)
        self.assertEqual(deckbin.listing(), [])
        decks.append(self.key, self.w, {"w": self.w, "s": 2, "l": 2, "ops": []})    # its own windows write on
        # deleted again; meanwhile someone makes a setup in the empty deck: no restore over it
        second = deckbin.delete(self.key)["id"]
        w2 = self.writer()
        decks.append(self.key, w2, {"w": w2, "s": 1, "l": 1, "ops": []})
        with self.assertRaises(decks.DeckError) as c:
            deckbin.restore(second)
        self.assertEqual(c.exception.status, 409)
        third = deckbin.delete(self.key)["id"]           # that one deleted too (kept as well)
        self.assertEqual({x["id"] for x in deckbin.listing()}, {second, third})
        self.assertEqual(deckbin.restore(second)["workbook"], WB)
        self.assertEqual(self.records(), 2)
        self.assertEqual([x["id"] for x in deckbin.listing()], [third])

    def test_a_restore_that_fails_changes_nothing(self):
        gone = deckbin.delete(self.key)["id"]
        empty = decks.read_snapshot(self.key)
        real = os.rename

        def fail(a, b):
            if os.path.normcase(a) == os.path.normcase(deckbin.bin_dir(gone, "backups")):
                raise PermissionError("in use")
            return real(a, b)
        with mock.patch("os.rename", fail):
            with self.assertRaises(decks.DeckError):
                deckbin.restore(gone)
        self.assertEqual(decks.read_snapshot(self.key)["gen"], empty["gen"])
        self.assertIsNone(decks.read_snapshot(self.key)["doc"]["preset"])
        self.assertEqual([x["id"] for x in deckbin.listing()], [gone])
        self.assertTrue(os.path.exists(deckbin.bin_dir(gone, "backups", "1.json")))
        self.assertEqual(deckbin.restore(gone)["workbook"], WB)

    def test_names_and_keys_are_checked(self):
        for bad in ("../x", "", None, "a~1", self.key):
            with self.assertRaises(decks.DeckError):
                deckbin.restore(bad)
        with self.assertRaises(decks.DeckError):
            deckbin.delete("../" + self.key)
        with self.assertRaises(decks.DeckError) as c:
            deckbin.delete("nosuch-0123456789")
        self.assertEqual(c.exception.status, 404)

    def test_a_format_5_deck_keeps_its_marker_in_the_bin_and_back(self):
        # ADR-019: the marker goes wherever the deck goes; the empty deck a delete leaves is format 4 without one
        decks.mark_format5(self.key)
        snap = decks.read_snapshot(self.key)
        with mock.patch.object(decks, "BUMP_WAIT_S", 0):              # (the bump's wait: not here)
            decks.compact(self.key, snap["gen"], dict(snap, gen=snap["gen"] + 1, format=5))
        r = deckbin.delete(self.key)
        kept = os.path.join(deckbin.bin_dir(r["id"]), "deck")
        self.assertTrue(os.path.exists(os.path.join(kept, decks.MARKER5)))
        with open(os.path.join(kept, "snapshot.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["format"], 5)
        new = decks.read_snapshot(self.key)
        self.assertEqual(new["format"], 4)
        self.assertFalse(decks.is_format5(self.key))
        decks.check_page(self.key, set())                        # an old page may use the empty deck
        deckbin.restore(r["id"])
        self.assertTrue(decks.is_format5(self.key))
        self.assertEqual(decks.read_snapshot(self.key)["format"], 5)
        with self.assertRaises(decks.DeckError) as e:
            decks.check_page(self.key, set())
        self.assertEqual(e.exception.status, 409)


class DeckBinHttpTests(HttpBase):
    def test_delete_list_restore_over_http(self):
        st, r = self.jreq("POST", "/api/decks/open", {"workbook": WB})
        self.assertEqual(st, 200)
        key = r["key"]
        st, lst = self.jreq("GET", "/api/decks")
        self.assertEqual([(d["key"], d["workbook"], d["preset"], d["slides"], d["tables"]) for d in lst["decks"]], [(key, WB, False, 0, 0)])
        self.jreq("POST", "/api/presence", {"deck": key, "client": "c1"})
        st, r = self.jreq("POST", "/api/decks/%s/delete" % key, {"client": "c2"})
        self.assertEqual(st, 409)
        self.assertIn("open in a Slide Builder window", r["error"])
        st, r = self.jreq("POST", "/api/decks/%s/delete" % key, {"client": "c1"})    # (its own presence)
        self.assertEqual((st, r["workbook"]), (200, WB))
        st, gone = self.jreq("GET", "/api/decks/deleted")
        self.assertEqual([x["id"] for x in gone["deleted"]], [r["id"]])
        st, back = self.jreq("POST", "/api/decks/restore", {"id": r["id"], "client": "c1"})
        self.assertEqual((st, back), (200, {"key": key, "workbook": WB}))
        self.assertEqual(self.jreq("GET", "/api/decks/deleted")[1]["deleted"], [])


if __name__ == "__main__":
    unittest.main()
