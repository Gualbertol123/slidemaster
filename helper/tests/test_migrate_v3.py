"""Migration v3 -> v4, the freeze, rollback and coexistence (tests 7-9 of docs/next/05 §3.6), with THE REAL v3 HELPER:
the last v3 release (git tag v3.8.0) is checked out with `git worktree add` and started on the same data folder as
this program. v3 is never changed: its own format check refuses a frozen deck.

Records and snapshots here are written the way the core would (the helper never folds operations): a test that
needs a compacted snapshot writes the document that folding its records gives.
"""
import http.client
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest import mock

from sbtest import REPO, TempDirs

from slidebuilder import decks, migrate_v3, paths, store

V3_TAG = "v3.8.0"
FIX = os.path.join(REPO, "helper", "tests", "fixtures", "saved")
WB = "Weekly IBD.xlsx"


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class V3Helper:
    """the v3 helper of the worktree, on the given folders"""

    def __init__(self, program, root, data):
        self.port = _free_port()
        env = dict(os.environ, SLIDEBUILDER_ROOT=root, SLIDEBUILDER_DATA=data, SLIDEBUILDER_USER="v3user", SLIDEBUILDER_HOST="pc-v3",
                   SLIDEBUILDER_APP_WINDOW="0", NO_PROXY="*", PYTHONIOENCODING="utf-8")
        self.log = os.path.join(data, "..", "v3helper-%d.log" % self.port)
        self.out = open(self.log, "wb")
        self.proc = subprocess.Popen([sys.executable, os.path.join(program, "slide_builder.py"), "--no-browser", "--port", str(self.port)],
                                     cwd=program, env=env, stdout=self.out, stderr=subprocess.STDOUT)
        for _ in range(300):
            try:
                st, _h, body = self.raw("GET", "/")
                if st == 200:
                    m = re.search(rb'name="sb-token"\s+content="([^"]+)"', body)
                    self.token = m.group(1).decode() if m else ""
                    return
            except OSError:
                pass
            time.sleep(0.1)
        raise RuntimeError("the v3 helper did not start")

    def raw(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            c.request(method, path, body=body, headers=headers or {})
            r = c.getresponse()
            return r.status, dict(r.getheaders()), r.read()
        finally:
            c.close()

    def api(self, method, path, obj=None):
        h = {"X-SB-Token": self.token, "X-SB-Formats": "workbook=3;config=3;prefs=1"}
        body = None
        if obj is not None:
            body = json.dumps(obj).encode()
            h["Content-Type"] = "application/json"
        st, _h, data = self.raw(method, path, body, h)
        try:
            return st, json.loads(data) if data else None
        except ValueError:
            return st, data

    def ops(self, workbook, ops):
        return self.api("POST", "/api/workbooks/%s/ops" % _q(workbook), {"ops": ops, "client": "v3page"})

    def doc(self, workbook):
        return self.api("GET", "/api/workbooks/%s/doc" % _q(workbook))

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.out.close()


def _q(s):
    import urllib.parse
    return urllib.parse.quote(s, safe="")


def cell(ref, text, sheet="S"):
    return {"op": "cell.patch", "sheet": sheet, "ref": ref, "patch": {"text": text}}


class RealV3(TempDirs):
    """a worktree of the last v3 release for the whole class (one checkout, many helpers)"""

    @classmethod
    def setUpClass(cls):
        cls.wt = os.path.join(tempfile.mkdtemp(prefix="sb-v3wt-"), "v3")
        r = subprocess.run(["git", "-C", REPO, "worktree", "add", "--detach", cls.wt, V3_TAG], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True)
        if r.returncode:
            raise RuntimeError("cannot check out the last v3 release (%s) - fetch the tags (git fetch --tags): %s" % (V3_TAG, r.stdout))
        cls.v3program = os.path.join(cls.wt, "backend")

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["git", "-C", REPO, "worktree", "remove", "--force", cls.wt], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(os.path.dirname(cls.wt), ignore_errors=True)

    def setUp(self):
        super().setUp()
        decks.reset()
        self._quiet = os.environ.get("SLIDEBUILDER_ROLLBACK_QUIET")
        os.environ["SLIDEBUILDER_ROLLBACK_QUIET"] = "0.2"          # the pause after a rollback's marker (14 s for real)
        os.makedirs(self.data, exist_ok=True)
        self.v3 = V3Helper(self.v3program, self.root, self.data)

    def tearDown(self):
        self.v3.stop()
        decks.reset()
        if self._quiet is None:
            os.environ.pop("SLIDEBUILDER_ROLLBACK_QUIET", None)
        else:
            os.environ["SLIDEBUILDER_ROLLBACK_QUIET"] = self._quiet
        super().tearDown()

    def v3file(self, wb=WB):
        return migrate_v3.v3_path(wb)

    def read(self, p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    # ---------------------------------------------------------------- 7. migration
    def test_7_every_saved_fixture_migrates_and_v3_refuses_the_frozen_deck(self):
        with open(os.path.join(FIX, "workbook.v3.json"), "rb") as f:
            raw = f.read()
        orig = json.loads(raw)
        wb = orig["workbook"]
        os.makedirs(os.path.dirname(self.v3file(wb)))
        with open(self.v3file(wb), "wb") as f:
            f.write(raw)
        self.assertEqual(self.v3.doc(wb)[0], 200)                       # v3 reads it before
        key, how = migrate_v3.ensure_deck(wb)
        self.assertEqual(how, "migrated")
        snap = decks.read_snapshot(key)
        expect = {k: v for k, v in orig.items() if k != "backupAt"}
        expect["schema"] = 3
        self.assertEqual(snap["doc"], expect)                            # identity on preset, style, edits (and the rest)
        self.assertEqual((snap["gen"], snap["rev"], snap.get("updatedBy"), snap.get("log")),
                         (1, orig.get("rev", 0), orig.get("updatedBy"), orig.get("log")))
        frozen = self.read(self.v3file(wb))
        self.assertEqual((frozen["schema"], frozen["movedTo"], frozen["movedGen"]), (4, "v4", 1))
        self.assertEqual({k: v for k, v in frozen.items() if k not in ("schema", "movedTo", "movedGen")}, {k: v for k, v in orig.items() if k != "schema"})
        moved = self.read(decks.deck_dir(key, migrate_v3.MOVED))
        import hashlib
        self.assertEqual(moved["sha1"], hashlib.sha1(raw).hexdigest())
        backups = os.listdir(paths.data_dir("backups", "upgrades", "workbook"))
        self.assertEqual(len(backups), 1)
        with open(paths.data_dir("backups", "upgrades", "workbook", backups[0]), "rb") as f:
            self.assertEqual(f.read(), raw)                              # byte for byte
        # the real v3 helper: refuses to save (409) and to read it; a v3 page turns "outdated" on that 409
        st, body = self.v3.ops(wb, [cell("A1", "late")])
        self.assertEqual(st, 409, body)
        self.assertIn("newer version", body["error"])
        self.assertEqual(self.v3.doc(wb)[0], 409)
        self.assertEqual(self.read(self.v3file(wb)), frozen)            # nothing written by v3
        self.assertEqual(migrate_v3.ensure_deck(wb), (key, "v4"))       # once only

    def test_7_a_v3_save_racing_the_migration_is_in_the_snapshot_or_refused(self):
        self.assertEqual(self.v3.ops(WB, [cell("A1", "first")])[0], 200)
        acked, refused, stop = [], [], threading.Event()

        def saver():
            n = 0
            while not stop.is_set():
                n += 1
                st, _b = self.v3.ops(WB, [cell("B%d" % n, "v3-%d" % n)])
                (acked if st == 200 else refused).append((n, st))
                if st == 409:
                    return
        t = threading.Thread(target=saver)
        t.start()
        time.sleep(0.5)
        migrate_v3.ensure_deck(WB)
        time.sleep(0.5)
        stop.set()
        t.join()
        doc = decks.read_snapshot(decks.deck_key(WB))["doc"]
        for n, _st in acked:                                             # every acknowledged v3 save is in the snapshot
            self.assertEqual(doc["edits"]["S"]["B%d" % n], {"text": "v3-%d" % n})
        self.assertTrue(acked)
        self.assertEqual({st for _n, st in refused} - {503}, {409})      # the rest were refused (503: lock busy, retried)
        self.assertNotIn("B%d" % refused[-1][0], doc["edits"]["S"])

    # ---------------------------------------------------------------- 8. rollback
    def _v4_edit_and_compact(self, key, writer, ops_doc):
        """a v4 page appended a record and compacted: the snapshot holds the document folding it gives"""
        rec = decks.append(key, writer, {"w": writer, "s": 1, "l": 1, "by": "anna", "ops": [{"op": "opaque"}]})
        snap = decks.read_snapshot(key)
        new = dict(snap, gen=snap["gen"] + 1, frontier=dict(snap["frontier"], **{rec["journal"]: rec["offset"]}), lamport=1, rev=snap["rev"] + 1,
                   doc=ops_doc, updatedBy="anna", updated=rec["at"])
        decks.compact(key, snap["gen"], new)
        return rec

    def test_8_rollback_refuses_records_past_the_frontier_then_v3_continues(self):
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)
        key, _ = migrate_v3.ensure_deck(WB)
        w = decks.new_writer("anna")
        decks.append(key, w, {"w": w, "s": 1, "l": 1, "by": "anna", "ops": [cell("A2", "v4")]})
        with self.assertRaises(migrate_v3.NotMigrated) as e:
            migrate_v3.rollback(WB)
        self.assertEqual(e.exception.status, 409)
        self.assertIn("Prepare rollback", str(e.exception))
        self.assertEqual(self.read(self.v3file())["schema"], 4)        # nothing changed
        # compacted (the snapshot's document is what folding gives), then rolled back
        snap = decks.read_snapshot(key)
        doc = json.loads(json.dumps(snap["doc"]))
        doc["edits"]["S"]["A2"] = {"text": "v4"}
        doc["preset"] = {"sheets": [], "tables": [], "slides": [], "v4only": {"kept": True}}     # a field v3 does not know
        rec_end = os.path.getsize(os.path.join(decks.journal_dir(key), os.listdir(decks.journal_dir(key))[0]))
        new = dict(snap, gen=2, frontier={decks.stem(os.listdir(decks.journal_dir(key))[0]): rec_end}, lamport=1, rev=snap["rev"] + 1, doc=doc)
        decks.compact(key, 1, new)
        self.assertEqual(migrate_v3.rollback(WB), "rolled back")
        v3doc = self.read(self.v3file())
        self.assertEqual(v3doc["schema"], 3)
        self.assertEqual({k: v3doc[k] for k in ("preset", "style", "edits")}, {k: doc[k] for k in ("preset", "style", "edits")})
        self.assertEqual(v3doc["rev"], new["rev"])
        # the real v3 helper reads it and continues; v4 helpers refuse it now (the page reloads)
        st, body = self.v3.doc(WB)
        self.assertEqual((st, body["doc"]["edits"]["S"]["A2"]), (200, {"text": "v4"}))
        self.assertEqual(self.v3.ops(WB, [cell("A3", "v3 again")])[0], 200)
        decks.reset()
        with self.assertRaises(decks.DeckError) as e:
            decks.append(key, w, {"w": w, "s": 2, "l": 2, "ops": []})
        self.assertEqual(e.exception.status, 409)
        # re-migration at the next v4 open: v4-only fields kept (v3 carried them), v3's new edit there, gen goes on
        self.assertEqual(migrate_v3.ensure_deck(WB), (key, "migrated"))
        snap = decks.read_snapshot(key)
        self.assertEqual(snap["gen"], 3)
        self.assertEqual(snap["doc"]["preset"]["v4only"], {"kept": True})
        self.assertEqual(snap["doc"]["edits"]["S"]["A3"], {"text": "v3 again"})
        self.assertEqual(snap["frontier"], new["frontier"])            # the old journal stays covered
        decks.reset()
        self.assertEqual(decks.tail(key, snap["frontier"])["journals"], {})
        self.assertEqual(self.v3.ops(WB, [cell("A4", "too late")])[0], 409)

    def test_8_pinned_decks_stay_with_v3(self):
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)
        os.makedirs(paths.data_dir("v4"), exist_ok=True)
        with open(paths.data_dir("v4", "pinned-v3.json"), "w") as f:
            json.dump([WB], f)
        with self.assertRaises(migrate_v3.NotMigrated):
            migrate_v3.ensure_deck(WB)
        self.assertEqual(self.v3.ops(WB, [cell("A2", "still v3")])[0], 200)

    def test_migrate_all_skips_decks_open_in_v3_right_now(self):
        for name in ("A.xlsx", "B.xlsx"):
            self.assertEqual(self.v3.ops(name, [cell("A1", name)])[0], 200)
        from slidebuilder.locks import Lock
        with Lock("wb-" + decks.deck_key("B.xlsx")):                   # a v3 save of B in progress
            res = migrate_v3.migrate_all(lock_timeout=0.5)
        self.assertEqual(res["migrated"], ["A.xlsx"])
        self.assertEqual([x[0] for x in res["skipped"]], ["B.xlsx"])
        self.assertEqual(migrate_v3.migrate_all()["migrated"], ["B.xlsx"])     # run again later

    # ---------------------------------------------------------------- review of S5.3: never owned by both, never stuck
    def test_a_crash_after_the_freeze_is_finished_by_the_next_open(self):
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)
        key = decks.deck_key(WB)
        with mock.patch.object(decks, "write_snapshot", side_effect=OSError(32, "sharing violation")):
            with self.assertRaises(OSError):
                migrate_v3.ensure_deck(WB)
        self.assertFalse(decks.deck_exists(key))
        self.assertEqual(self.v3.ops(WB, [cell("A2", "late")])[0], 409)   # already frozen: v3 refuses, never both
        self.assertEqual(migrate_v3.ensure_deck(WB), (key, "migrated"))   # the next open finishes from the frozen file
        self.assertEqual(decks.read_snapshot(key)["doc"]["edits"]["S"], {"A1": {"text": "v3"}})

    def test_a_half_done_rollback_or_re_migration_is_finished_not_stuck(self):
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)
        key, _ = migrate_v3.ensure_deck(WB)
        # a rollback that wrote its marker and stopped: the deck is still v4's (the v3 file is frozen)
        with mock.patch.object(migrate_v3, "_backup_v3", side_effect=OSError(28, "disk full")):
            with self.assertRaises(OSError):
                migrate_v3.rollback(WB, quiet=0)
        self.assertTrue(os.path.exists(decks.deck_dir(key, migrate_v3.ROLLED_BACK)))
        self.assertEqual(self.v3.ops(WB, [cell("A2", "x")])[0], 409)
        self.assertEqual(migrate_v3.rollback(WB, quiet=0), "rolled back")    # run again: it finishes
        self.assertEqual(self.v3.ops(WB, [cell("A2", "v3 again")])[0], 200)
        # a re-migration that froze the v3 file and stopped before its snapshot: the next open finishes it
        decks.reset()
        with mock.patch.object(decks, "write_snapshot", side_effect=OSError(32, "sharing violation")):
            with self.assertRaises(OSError):
                migrate_v3.ensure_deck(WB)
        self.assertEqual(self.v3.ops(WB, [cell("A3", "x")])[0], 409)
        self.assertEqual(migrate_v3.ensure_deck(WB), (key, "migrated"))
        snap = decks.read_snapshot(key)
        self.assertEqual((snap["gen"], snap["doc"]["edits"]["S"]["A2"]), (2, {"text": "v3 again"}))
        self.assertFalse(os.path.exists(decks.deck_dir(key, migrate_v3.ROLLED_BACK)))
        # and a rollback marker left behind with the file still frozen: the open takes the deck back as it is
        with open(decks.deck_dir(key, migrate_v3.ROLLED_BACK), "w") as f:
            json.dump({"state": "marked", "gen": snap["gen"]}, f)
        self.assertEqual(migrate_v3.ensure_deck(WB), (key, "v4"))
        self.assertFalse(os.path.exists(decks.deck_dir(key, migrate_v3.ROLLED_BACK)))

    def test_a_new_deck_is_frozen_for_v3_at_once(self):
        key, how = migrate_v3.ensure_deck("New.xlsx")
        self.assertEqual(how, "created")
        st, body = self.v3.ops("New.xlsx", [cell("A1", "v3")])
        self.assertEqual(st, 409, body)                                  # v3 can never start a second deck
        self.assertEqual(migrate_v3.ensure_deck("New.xlsx"), (key, "v4"))

    def test_rollback_refused_while_somebody_has_the_deck_open(self):
        key, _ = migrate_v3.ensure_deck(WB)
        decks.heartbeat(key, "c1", user="anna", host="pc1")
        with self.assertRaises(migrate_v3.NotMigrated) as e:
            migrate_v3.rollback(WB, quiet=0)
        self.assertIn("anna", str(e.exception))

    def _compacted_with_records(self, key, w, n):
        """n records of writer w, then a snapshot covering them (the document a page would fold; opaque here)"""
        for s_ in range(1, n + 1):
            decks.append(key, w, {"w": w, "s": s_, "l": s_, "ops": []})
        snap = decks.read_snapshot(key)
        t = decks.tail(key, {})
        decks.compact(key, snap["gen"], dict(snap, gen=snap["gen"] + 1, lamport=n, rev=snap["rev"] + n, seen={w: n},
                                             frontier=dict(snap["frontier"], **{j: v["offset"] for j, v in t["journals"].items()})))

    def test_rollback_while_a_v4_helper_appends_loses_nothing(self):
        key, _ = migrate_v3.ensure_deck(WB)
        w = decks.new_writer("anna")
        self._compacted_with_records(key, w, 3)
        # 1. the helper has not looked at the folder since the marker: its append is acknowledged during the pause -
        #    the rollback sees it past the frontier and refuses; the deck stays with v4, the record with it
        result = {}
        with mock.patch.object(decks, "_look"):
            t = threading.Thread(target=lambda: result.setdefault("r", self._try_rollback()))
            t.start()
            time.sleep(0.3)
            decks.append(key, w, {"w": w, "s": 4, "l": 4, "ops": []})
            t.join()
        self.assertIn("stays with Slide Builder 4", str(result["r"]))
        self.assertFalse(os.path.exists(decks.deck_dir(key, migrate_v3.ROLLED_BACK)))
        self.assertEqual(self.read(self.v3file())["movedTo"], "v4")
        self.assertEqual(self.v3.ops(WB, [cell("A1", "x")])[0], 409)
        # 2. once the helper has looked (its refresher, every REFRESH_S): appends are refused, the rollback goes through
        snap = decks.read_snapshot(key)
        t = decks.tail(key, snap["frontier"])
        decks.compact(key, snap["gen"], dict(snap, gen=snap["gen"] + 1, lamport=4, rev=snap["rev"] + 1, seen={w: 4},
                                             frontier=dict(snap["frontier"], **{j: v["offset"] for j, v in t["journals"].items()})))
        t = threading.Thread(target=lambda: result.__setitem__("r", self._try_rollback()))
        t.start()
        time.sleep(0.3)
        decks._look(key, 0)                                              # what the refresher does
        with self.assertRaises(decks.DeckError) as e:
            decks.append(key, w, {"w": w, "s": 5, "l": 5, "ops": []})
        self.assertEqual(e.exception.status, 409)                        # not acknowledged: nothing to lose
        t.join()
        self.assertEqual(result["r"], "rolled back")
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)

    def test_lean_lock_appends_after_a_rollback_are_refused(self):
        key, _ = migrate_v3.ensure_deck(WB)
        os.environ["SLIDEBUILDER_STORAGE"] = "lean-lock"
        self.addCleanup(os.environ.pop, "SLIDEBUILDER_STORAGE", None)
        w = decks.new_writer("anna")
        self._compacted_with_records(key, w, 2)
        self.assertEqual(migrate_v3.rollback(WB, quiet=0), "rolled back")
        with self.assertRaises(decks.DeckError) as e:          # the same helper, no tail since: still refused
            decks.append(key, w, {"w": w, "s": 3, "l": 3, "ops": []})
        self.assertEqual(e.exception.status, 409)

    def test_a_v4_open_during_the_pause_waits_and_the_rollback_finishes(self):
        key, _ = migrate_v3.ensure_deck(WB)
        result = {}
        t = threading.Thread(target=lambda: result.setdefault("r", self._try_rollback()))
        t.start()
        time.sleep(0.4)
        with self.assertRaises(decks.DeckError) as e:          # busy: the page tries again
            migrate_v3.ensure_deck(WB)
        self.assertEqual(e.exception.status, 503)
        t.join()
        self.assertEqual(result["r"], "rolled back")
        self.assertEqual(self.v3.ops(WB, [cell("A1", "v3")])[0], 200)

    def _try_rollback(self):
        try:
            return migrate_v3.rollback(WB, quiet=1.0)
        except migrate_v3.NotMigrated as e:
            return e

    # ---------------------------------------------------------------- 9. coexistence
    def test_9_v3_and_v4_edit_config_json_at_once_nothing_lost(self):
        errors = []

        def v3_side():
            for i in range(15):
                st, b = self.v3.api("POST", "/api/config/ops", {"ops": [{"op": "style.patch", "patch": {"colors": {"v3k%d" % i: "#000001"}}}]})
                if st != 200:
                    errors.append((st, b))

        def v4_side():
            for i in range(15):
                store.update_config([{"op": "style.patch", "patch": {"colors": {"v4k%d" % i: "#000002"}}}])
        t = threading.Thread(target=v3_side)
        t.start()
        v4_side()
        t.join()
        self.assertEqual(errors, [])
        colors = store.read_config()["defaults"]["style"]["colors"]
        self.assertEqual(sorted(colors), sorted(["v3k%d" % i for i in range(15)] + ["v4k%d" % i for i in range(15)]))


if __name__ == "__main__":
    unittest.main()
