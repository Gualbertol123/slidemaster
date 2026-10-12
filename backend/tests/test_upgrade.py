"""Saved setups keep working across updates (upgrade.py, ARCHITECTURE §3.3):

* every example in fixtures/saved/ (one per format version ever released) is read by this program;
* an older format is converted once, automatically, and the old file is kept in
  data/backups/upgrades/<kind>/;
* a file from a newer program is never changed; pages built for other formats cannot write.
"""
import json
import os
import re
import shutil
import threading
import unittest

from sbtest import REPO, TempDirs

from slidebuilder import paths, store, upgrade
from slidebuilder.ops import apply_ops
from slidebuilder.server import formats_match

FIX = os.path.join(REPO, "backend", "tests", "fixtures", "saved")
WB = "Weekly IBD.xlsx"


class Simulated:
    """pretend a future version: formats raised by one with a step for each kind"""

    def __init__(self, **steps):
        self.steps = steps

    def __enter__(self):
        self.saved = (dict(upgrade.SCHEMA), {k: dict(v) for k, v in upgrade.STEPS.items()}, store.SCHEMA)
        for kind, fn in self.steps.items():
            upgrade.STEPS[kind][upgrade.SCHEMA[kind]] = fn
            upgrade.SCHEMA[kind] += 1
        store.SCHEMA = upgrade.SCHEMA["workbook"]
        return self

    def __exit__(self, *exc):
        schema, steps, s = self.saved
        upgrade.SCHEMA.clear(); upgrade.SCHEMA.update(schema)
        for k in steps:
            upgrade.STEPS[k].clear(); upgrade.STEPS[k].update(steps[k])
        store.SCHEMA = s


def rename_theme(doc):          # an example of a real format change: style.theme.id → style.themeName
    th = doc.get("style", {}).pop("theme", None)
    if th:
        doc["style"]["themeName"] = th.get("id")


class UpgradeTest(TempDirs):
    def put_examples(self):
        os.makedirs(paths.data_dir("workbooks"), exist_ok=True)
        os.makedirs(paths.data_dir("users"), exist_ok=True)
        shutil.copy(os.path.join(FIX, "workbook.v3.json"), store.workbook_path(WB))
        shutil.copy(os.path.join(FIX, "config.v3.json"), store.config_path())
        shutil.copy(os.path.join(FIX, "prefs.unnumbered.json"), store.user_path("tester"))

    def upgrades(self, kind):
        d = paths.data_dir("backups", "upgrades", kind)
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def raw(self, path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    # ------------------------------------------------------------------ today's format
    def test_every_saved_example_is_read(self):
        self.put_examples()
        for name in os.listdir(FIX):
            if name.startswith("workbook."):
                shutil.copy(os.path.join(FIX, name), store.workbook_path(WB))
                doc = store.read_workbook(WB)
                self.assertEqual(doc["schema"], upgrade.SCHEMA["workbook"], name)
                self.assertTrue(doc["preset"]["slides"], name)
                new, applied, _ = apply_ops(doc, [{"op": "cell.patch", "sheet": "SLIDE_1", "ref": "D6", "patch": {"b": True}}], "t", 1)
                self.assertEqual(applied, 1, name)
        cfg = store.read_config()
        self.assertEqual(cfg["defaults"]["style"]["theme"]["id"], "custom")
        prefs = store.read_prefs("tester")
        self.assertEqual(prefs["lastFile"], WB)
        # the current format is not converted, nothing is backed up
        self.assertEqual(store.upgrade_all(), [])
        self.assertFalse(os.path.isdir(paths.data_dir("backups", "upgrades")))

    def test_saving_stamps_the_format(self):
        store.update_workbook(WB, [{"op": "preset.set", "preset": {"sheets": [], "tables": [], "slides": []}}])
        self.assertEqual(store.read_workbook(WB)["schema"], upgrade.SCHEMA["workbook"])
        store.write_prefs({"lastFile": "x.xlsx"}, "tester")
        self.assertEqual(json.loads(self.raw(store.user_path("tester")))["schema"], upgrade.SCHEMA["prefs"])

    # ------------------------------------------------------------------ a future format
    def test_older_file_is_converted_once_and_kept(self):
        self.put_examples()
        path = store.workbook_path(WB)
        original = self.raw(path)
        with Simulated(workbook=rename_theme):
            doc = store.read_workbook(WB)
            self.assertEqual(doc["schema"], 4)
            self.assertEqual(doc["style"]["themeName"], "intesa")
            self.assertNotIn("theme", doc["style"])
            self.assertEqual(doc["edits"], json.loads(original)["edits"])          # everything else intact
            self.assertEqual(json.loads(self.raw(path))["schema"], 4)              # converted on disk
            backups = self.upgrades("workbook")
            self.assertEqual(len(backups), 1)
            self.assertTrue(re.match(r"^.+\.v3\.\d{8}-\d{6}\.json$", backups[0]), backups[0])
            self.assertEqual(self.raw(paths.data_dir("backups", "upgrades", "workbook", backups[0])), original)
            # read again, save changes: no second conversion, the format stays
            store.read_workbook(WB)
            doc, applied, _ = store.update_workbook(WB, [{"op": "slide.patch", "id": "s1", "patch": {"title": "New"}}])
            self.assertEqual((applied, doc["schema"]), (1, 4))
            self.assertEqual(len(self.upgrades("workbook")), 1)

    def test_steps_are_chained(self):
        self.put_examples()
        with Simulated(workbook=rename_theme):
            with Simulated(workbook=lambda d: dict(d, note="v5")):
                doc = store.read_workbook(WB)
        self.assertEqual((doc["schema"], doc["note"], doc["style"]["themeName"]), (5, "v5", "intesa"))
        self.assertEqual(len(self.upgrades("workbook")), 1)       # one backup: the file as it was (v3)

    def test_startup_converts_everything(self):
        self.put_examples()
        def add_flag(d):
            d["converted"] = True
        with Simulated(workbook=rename_theme, config=add_flag, prefs=add_flag):
            done = store.upgrade_all()
            self.assertEqual(len(done), 3)
            self.assertTrue(store.read_config()["converted"])
            self.assertTrue(json.loads(self.raw(store.user_path("tester")))["converted"])
            self.assertEqual((len(self.upgrades("workbook")), len(self.upgrades("config")), len(self.upgrades("prefs"))), (1, 1, 1))
            self.assertEqual(store.upgrade_all(), [])

    def test_two_helpers_convert_once(self):
        self.put_examples()
        calls = []
        def slow(d):
            calls.append(1)
            rename_theme(d)
        with Simulated(workbook=slow):
            errors = []
            def read():
                try:
                    self.assertEqual(store.read_workbook(WB)["schema"], 4)
                except Exception as e:          # noqa: BLE001
                    errors.append(e)
            ts = [threading.Thread(target=read) for _ in range(4)]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            self.assertEqual(errors, [])
            self.assertEqual(len(self.upgrades("workbook")), 1)
            self.assertEqual(len(calls), 1)

    def test_newer_file_is_never_changed(self):
        self.put_examples()
        path = store.workbook_path(WB)
        doc = json.loads(self.raw(path)); doc["schema"] = 99
        store.write_json(path, doc)
        before = self.raw(path)
        with self.assertRaises(store.StoreTooNew):
            store.read_workbook(WB)
        with self.assertRaises(store.StoreTooNew):
            store.update_workbook(WB, [{"op": "slide.patch", "id": "s1", "patch": {"title": "x"}}])
        self.assertEqual(self.raw(path), before)
        self.assertEqual(store.upgrade_all(), [])                  # logged, skipped

    def test_missing_step_fails_loudly_without_touching_the_file(self):
        self.put_examples()
        before = self.raw(store.workbook_path(WB))
        saved = dict(upgrade.SCHEMA)
        try:
            upgrade.SCHEMA["workbook"] = 4                         # raised without a step: a developer mistake
            with self.assertRaises(RuntimeError):
                store.read_workbook(WB)
        finally:
            upgrade.SCHEMA.update(saved)
        self.assertEqual(self.raw(store.workbook_path(WB)), before)

    # ------------------------------------------------------------------ pages and helpers agree
    def test_page_formats(self):
        self.assertTrue(formats_match(None))                       # pages from before this check
        cur = ";".join("%s=%d" % kv for kv in upgrade.SCHEMA.items())
        self.assertTrue(formats_match(cur))
        self.assertFalse(formats_match(cur.replace("workbook=%d" % upgrade.SCHEMA["workbook"], "workbook=2")))

    def test_frontend_formats_equal_backend(self):
        with open(os.path.join(REPO, "core", "src", "model", "types.ts"), encoding="utf-8") as f:
            m = re.search(r"export const FORMATS = \{([^}]*)\}", f.read())
        front = {k: int(v) for k, v in re.findall(r"(\w+):\s*(\d+)", m.group(1))}
        self.assertEqual(front, upgrade.SCHEMA)


if __name__ == "__main__":
    unittest.main()
