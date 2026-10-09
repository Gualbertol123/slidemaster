"""Presence from one directory listing: names carry user/host/client/workbook, the listing's mtimes
(file-server clock) say who is fresh; files of the old format (<user>@<host>.json) are still read."""
import json
import os
import time
import unittest
from unittest import mock

from sbtest import TempDirs

from slidebuilder import paths, presence


class PresenceTests(TempDirs):
    def folder(self):
        return paths.data_dir("presence")

    def age(self, name, seconds):
        p = os.path.join(self.folder(), name)
        t = time.time() - seconds
        os.utime(p, (t, t))

    def old_format(self, user, host, client, workbook, age_s=0.0):
        os.makedirs(self.folder(), exist_ok=True)
        name = "%s@%s.json" % (user, host)
        with open(os.path.join(self.folder(), name), "w") as f:
            json.dump({"user": user, "host": host, "client": client, "workbook": workbook,
                       "at": int((time.time() - age_s) * 1000)}, f)
        return name

    def test_names_round_trip(self):
        for user, host, client, wb in (("anna", "PC-1", "c1", "Report Q3.xlsx"), ("o'brien~x", "pc", "c~2", "a%b~c [v2].xlsx"),
                                       ("anna", "pc", "c", None), ("dom\\user", "pc:1", "c", "x/y?.xlsx")):
            n = presence.file_name(user, host, client, wb)
            self.assertFalse(set(n) & set('\\/:*?"<>|'), n)
            self.assertEqual(presence.parse_name(n), (user, host, client, wb, True))
        self.assertIsNone(presence.parse_name("anna@pc.json"))
        long_wb = "x" * 200 + ".xlsx"
        self.assertEqual(presence.parse_name(presence.file_name("a", "b", "c", long_wb))[3:], (None, False))

    def test_names_stay_short(self):
        """Windows paths stop at 260 characters: the name has a budget whatever the names are"""
        worst = presence.file_name("ü" * 30, "Ω" * 40, "c" * 200, "Отчёт о продажах " * 10 + ".xlsx")
        self.assertLessEqual(len(worst), 100)
        self.assertLessEqual(len(presence.file_name("u" * 20, "h" * 20, "c" * 16, "w" * 32)), 100)
        # a long part is never cut (a cut %XX would garble it): it is hashed, and the file says the rest
        self.assertEqual(presence.parse_name(presence.file_name("ü" * 30, "pc", "c1", "W.xlsx"))[4], False)
        presence.heartbeat("c1", "W.xlsx", user="ü" * 30, host="pc")
        presence.heartbeat("c" * 50, "Quarterly Budget Report - Marketing & Sales (final version 2).xlsx", user="bob", host="pcB")
        got = presence.others("x")
        self.assertEqual(sorted((o["user"], o["client"]) for o in got), [("bob", "c" * 50), ("ü" * 30, "c1")])
        self.assertEqual([o["user"] for o in presence.others("c" * 50)], ["ü" * 30])          # not myself
        self.assertTrue(presence.leave("c" * 50, user="bob", host="pcB"))
        presence.heartbeat("c2", "W.xlsx", user="ü" * 30, host="pc")                            # one file per user@pc
        self.assertEqual(len(os.listdir(self.folder())), 1)

    def test_others_from_the_listing_alone(self):
        presence.heartbeat("ca", "W.xlsx", user="anna", host="pcA")
        presence.heartbeat("cb", "Long " + "y" * 150 + ".xlsx", user="bob", host="pcB")
        presence.heartbeat("cc", None, user="carol", host="pcC")
        with mock.patch.object(presence, "read_json", wraps=presence.read_json) as rd:
            got = presence.others("someone")
        # only the hashed long name is opened (its workbook is not in the name)
        self.assertEqual(rd.call_count, 1)
        self.assertEqual([(o["user"], o["host"], o["client"], o["workbook"]) for o in got],
                         [("anna", "pcA", "ca", "W.xlsx"), ("bob", "pcB", "cb", "Long " + "y" * 150 + ".xlsx"), ("carol", "pcC", "cc", None)])
        self.assertTrue(all(abs(o["at"] / 1000.0 - time.time()) < 5 for o in got))
        self.assertEqual([o["user"] for o in presence.others("ca")], ["bob", "carol"])     # not myself

    def test_stale_files_are_not_opened_and_old_ones_removed(self):
        presence.heartbeat("ca", "W.xlsx", user="anna", host="pcA")
        presence.heartbeat("cb", "W.xlsx", user="bob", host="pcB")
        self.age(presence.file_name("anna", "pcA", "ca", "W.xlsx"), 30)
        self.age(presence.file_name("bob", "pcB", "cb", "W.xlsx"), 25 * 3600)
        old = self.old_format("dave", "pcD", "cd", "W.xlsx")
        self.age(old, 30)
        with mock.patch.object(presence, "read_json", side_effect=AssertionError("a stale file was opened")):
            self.assertEqual(presence.others("x"), [])
        self.assertTrue(os.path.exists(os.path.join(self.folder(), presence.file_name("anna", "pcA", "ca", "W.xlsx"))))
        self.assertFalse(os.path.exists(os.path.join(self.folder(), presence.file_name("bob", "pcB", "cb", "W.xlsx"))))

    def test_old_format_still_read(self):
        self.old_format("erin", "pcE", "ce", "W.xlsx")
        self.old_format("fred", "pcF", "cf", "W.xlsx", age_s=40)       # fresh file, stale content: not here
        self.assertEqual([(o["user"], o["workbook"]) for o in presence.others("x")], [("erin", "W.xlsx")])

    def test_one_file_per_user_and_pc(self):
        old = self.old_format("anna", "pcA", "c0", "W.xlsx")
        presence.heartbeat("c1", "W.xlsx", user="anna", host="pcA")
        presence.heartbeat("c1", "Other.xlsx", user="anna", host="pcA")
        presence.heartbeat("c2", "Other.xlsx", user="anna", host="pcA")         # a second tab takes over
        self.assertEqual(sorted(os.listdir(self.folder())), [presence.file_name("anna", "pcA", "c2", "Other.xlsx")])
        self.assertNotIn(old, os.listdir(self.folder()))
        # the file still holds the old JSON, so older helpers see this user too
        with open(os.path.join(self.folder(), presence.file_name("anna", "pcA", "c2", "Other.xlsx"))) as f:
            d = json.load(f)
        self.assertEqual((d["user"], d["host"], d["client"], d["workbook"]), ("anna", "pcA", "c2", "Other.xlsx"))
        self.assertIsInstance(d["at"], int)

    def test_leave(self):
        presence.heartbeat("c1", "W.xlsx", user="anna", host="pcA")
        self.assertFalse(presence.leave("other", user="anna", host="pcA"))
        self.assertTrue(presence.leave("c1", user="anna", host="pcA"))
        self.assertEqual(os.listdir(self.folder()), [])
        self.old_format("anna", "pcA", "c9", None)
        self.assertTrue(presence.leave("c9", user="anna", host="pcA"))
        self.assertEqual(os.listdir(self.folder()), [])

    def test_no_folder_yet(self):
        self.assertEqual(presence.others("x"), [])
        self.assertFalse(presence.leave("x", user="a", host="b"))


if __name__ == "__main__":
    unittest.main()
