"""Windows fonts for the core (PLAN S3.2): GET /sysfonts, GET /sysfonts/<file>, POST /api/fonts/capture in
fingerprint mode (G0 2026-10-12: nothing is copied) and in copy mode (W13, once the licence owner's yes is recorded),
and the font library staying readable by v3's fonts.py."""
import importlib.util
import json
import os
import shutil
import struct
import tempfile
import urllib.parse

import test_http

from slidebuilder import fonts, paths, sysfonts

HERE = os.path.dirname(os.path.abspath(__file__))
CARLITO = os.path.join(os.path.dirname(os.path.dirname(HERE)), "core", "tests", "fixtures", "fonts")


def collection(*fonts):
    """a .ttc of these sfnt fonts (each face's tables copied whole)"""
    heads, at = [], 12 + 4 * len(fonts)
    for f in fonts:
        n = struct.unpack_from(">H", f, 4)[0]
        heads.append((f, n, at))
        at += 12 + 16 * n
    out, blobs = bytearray(b"ttcf" + struct.pack(">II", 0x00010000, len(fonts))), b""
    out += b"".join(struct.pack(">I", h[2]) for h in heads)
    data_at = at
    for f, n, _ in heads:
        out += f[:12]
        for i in range(n):
            tag, cs, off, length = struct.unpack_from(">4sIII", f, 12 + 16 * i)
            out += struct.pack(">4sIII", tag, cs, data_at + len(blobs), length)
            blobs += f[off:off + length] + b"\0" * (-length % 4)
    return bytes(out) + blobs


def with_fs_type(data, value):
    """a copy of a font with OS/2.fsType set (2 = restricted licence: may not be embedded)"""
    b = bytearray(data)
    n = struct.unpack_from(">H", b, 4)[0]
    for i in range(n):
        tag, _s, off, _l = struct.unpack_from(">4sIII", b, 12 + 16 * i)
        if tag == b"OS/2":
            struct.pack_into(">H", b, off + 8, value)
    return bytes(b)


class SysFonts(test_http.HttpBase):
    def setUp(self):
        super().setUp()
        self.fontdir = tempfile.mkdtemp(prefix="sbfonts_")
        self.userdir = tempfile.mkdtemp(prefix="sbfonts_user_")
        shutil.copy(os.path.join(CARLITO, "Carlito-Regular.ttf"), os.path.join(self.fontdir, "carlito.ttf"))
        shutil.copy(os.path.join(CARLITO, "Carlito-Bold.ttf"), os.path.join(self.userdir, "carlitob.ttf"))
        with open(os.path.join(CARLITO, "Carlito-Regular.ttf"), "rb") as f:
            self.regular = f.read()
        with open(os.path.join(self.fontdir, "locked.ttf"), "wb") as f:
            f.write(with_fs_type(self.regular, 2))
        with open(os.path.join(self.fontdir, "notes.txt"), "w") as f:
            f.write("not a font")
        with open(os.path.join(CARLITO, "Carlito-Bold.ttf"), "rb") as f:
            bold = f.read()
        with open(os.path.join(self.fontdir, "pair.ttc"), "wb") as f:
            f.write(collection(self.regular, bold))
        with open(os.path.join(self.fontdir, "broken.ttf"), "wb") as f:
            f.write(b"garbage")
        self._env_fonts = os.environ.get("SLIDEBUILDER_SYSFONTS")
        os.environ["SLIDEBUILDER_SYSFONTS"] = os.pathsep.join([self.fontdir, self.userdir])

    def tearDown(self):
        if self._env_fonts is None:
            os.environ.pop("SLIDEBUILDER_SYSFONTS", None)
        else:
            os.environ["SLIDEBUILDER_SYSFONTS"] = self._env_fonts
        shutil.rmtree(self.fontdir, ignore_errors=True)
        shutil.rmtree(self.userdir, ignore_errors=True)
        super().tearDown()

    def test_lists_the_font_files_of_both_folders(self):
        st, body = self.jreq("GET", "/sysfonts")
        self.assertEqual(st, 200)
        rows = {r["file"]: r for r in body["fonts"]}
        self.assertEqual(sorted(rows), ["carlito.ttf", "carlitob.ttf", "locked.ttf", "pair.ttc"])     # no .txt, no unreadable file
        self.assertEqual((rows["pair.ttc"]["family"], rows["pair.ttc"]["faces"]), ("Carlito", 2))       # a collection: its first face
        self.assertEqual((rows["carlito.ttf"]["family"], rows["carlito.ttf"]["weight"], rows["carlito.ttf"]["italic"]), ("Carlito", 400, False))
        self.assertEqual(rows["carlitob.ttf"]["weight"], 700)
        self.assertEqual(rows["carlito.ttf"]["size"], len(self.regular))

    def test_serves_listed_files_only(self):
        st, h, data = self.req("GET", "/sysfonts/carlito.ttf")
        self.assertEqual((st, h["content-type"], data), (200, "font/ttf", self.regular))
        st, _, _ = self.req("GET", "/sysfonts/CARLITO.TTF")                              # Windows names: any case
        self.assertEqual(st, 200)
        for bad in ("notes.txt", "missing.ttf", "..%2Fcarlito.ttf", "..%5C..%5Cwin.ini", "%2E%2E%2Fx.ttf", "C:%5CWindows%5CFonts%5Carial.ttf", ""):
            st, _, _ = self.req("GET", "/sysfonts/" + bad)
            self.assertIn(st, (400, 403, 404), bad)
        st, _, _ = self.req("GET", "/sysfonts/carlito.ttf", token=False)
        self.assertEqual(st, 403)
        st, _, _ = self.req("GET", "/sysfonts", token=False)
        self.assertEqual(st, 403)

    def test_capture_records_a_fingerprint_and_copies_nothing(self):
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual(st, 200, fp)
        self.assertEqual((fp["mode"], fp["family"], fp["embeddable"], fp["otherBuilds"]), ("fingerprint", "Carlito", True, []))
        face = fp["faces"][0]
        self.assertEqual((face["unitsPerEm"], face["weight"], face["fsType"], face["variable"]), (2048, 400, 0, False))
        self.assertTrue(face["advancesSha1"] and face["version"])
        store = os.path.join(paths.DATA, "fonts", "system", "fingerprints.json")
        with open(store, encoding="utf-8") as f:
            doc = json.load(f)
        self.assertEqual((doc["schema"], doc["mode"], len(doc["fonts"])), (1, "fingerprint", 1))
        self.assertEqual(doc["fonts"][0]["seen"][0]["user"], "tester")
        # no font file anywhere in the data folder: Windows fonts are not copied (R7)
        for _dir, _d, files in os.walk(paths.DATA):
            self.assertFalse([n for n in files if n.lower().endswith((".ttf", ".otf", ".ttc"))], files)
        # the same file again from another user: one row, two people seen
        os.environ["SLIDEBUILDER_USER"] = "bob"
        self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        with open(store, encoding="utf-8") as f:
            doc = json.load(f)
        self.assertEqual([s["user"] for s in doc["fonts"][0]["seen"]], ["tester", "bob"])
        # another build of the same file on a third PC is told apart
        with open(os.path.join(self.fontdir, "carlito.ttf"), "wb") as f:
            f.write(self.regular[:-4] + b"\x00\x00\x00\x01")
        st, fp2 = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual(fp2["otherBuilds"], [fp["sha1"]])
        self.assertEqual(fp2["otherHosts"], sorted({s["host"] for s in doc["fonts"][0]["seen"]}))     # the PCs to name (W13)

    def test_capture_checks_the_embedding_permission(self):
        st, fp = self.jreq("POST", "/api/fonts/capture?file=locked.ttf", b"")
        self.assertEqual((st, fp["embeddable"], fp["faces"][0]["fsType"]), (200, False, 2))

    def test_capture_refuses_what_is_not_a_listed_font(self):
        for bad in ("notes.txt", "missing.ttf", "../carlito.ttf", ""):
            st, _ = self.jreq("POST", "/api/fonts/capture?file=" + urllib.parse.quote(bad), b"")
            self.assertIn(st, (400, 404), bad)
        st, _ = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"", token=False)
        self.assertEqual(st, 403)

    def test_the_library_stays_schema_1_and_readable_by_v3(self):
        # an upload and a capture: fonts.json keeps schema 1, the capture is not in it
        st, lib = self.jreq("POST", "/api/fonts?" + urllib.parse.urlencode({"family": "Carlito", "weight": "400", "style": "normal", "name": "c.ttf"}),
                            self.regular, headers={"Content-Type": "application/octet-stream"})
        self.assertEqual(st, 200, lib)
        self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        with open(os.path.join(paths.DATA, "fonts", "fonts.json"), encoding="utf-8") as f:
            raw = json.load(f)
        self.assertEqual(raw["schema"], 1)
        self.assertEqual([x["family"] for x in raw["fonts"]], ["Carlito"])
        # v3.6.0's fonts.py (tests/v3/fonts_v360.py, unmodified) reads the same library
        spec = importlib.util.spec_from_file_location("slidebuilder.fonts_v360", os.path.join(HERE, "v3", "fonts_v360.py"),
                                                      submodule_search_locations=None)
        v3 = importlib.util.module_from_spec(spec)
        v3.__package__ = "slidebuilder"
        spec.loader.exec_module(v3)
        self.assertEqual(v3.read_library(), fonts.read_library())
        self.assertEqual(v3.read_library()["fonts"][0]["faces"][0]["file"], raw["fonts"][0]["faces"][0]["file"])
        # removing the family sweeps the library's files but keeps the system fingerprints
        self.jreq("DELETE", "/api/fonts?family=Carlito")
        self.assertTrue(os.path.isfile(os.path.join(paths.DATA, "fonts", "system", "fingerprints.json")))

    # ------------------------------------------------------------ copy mode (W13), once the licence owner said yes (R7)
    def only_regular_and_bold(self):
        """the Carlito family on this PC: Regular and Bold, both single-face .ttf that may be embedded"""
        for n in ("locked.ttf", "pair.ttc"):
            os.remove(os.path.join(self.fontdir, n))

    def library(self):
        return {f["family"]: f for f in fonts.read_library()["fonts"]}

    def test_copy_mode_is_off_until_the_licence_answer_is_recorded(self):
        self.only_regular_and_bold()
        self.assertIsNone(sysfonts.copy_allowed())
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((st, fp["mode"]), (200, "fingerprint"))
        self.assertNotIn("copied", fp)
        self.assertEqual(self.library(), {})
        # a licence file without a name, or switched off, is not a yes
        os.makedirs(os.path.join(paths.DATA, "fonts", "system"), exist_ok=True)
        with open(os.path.join(paths.DATA, "fonts", "system", "licence.json"), "w") as f:
            json.dump({"copy": True, "confirmedBy": " "}, f)
        self.assertIsNone(sysfonts.copy_allowed())
        self.assertIsNone(sysfonts.set_copy_allowed("off"))
        self.assertIsNone(sysfonts.copy_allowed())

    def test_copy_mode_copies_the_whole_family_into_the_library(self):
        self.only_regular_and_bold()
        self.assertEqual(sysfonts.set_copy_allowed("J. Doe, licence owner, mail of 2026-10-14"), "J. Doe, licence owner, mail of 2026-10-14")
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((st, fp["mode"], fp["copied"], fp["copiedFaces"], fp["added"], fp["sha1"]), (200, "copy", True, 2, 2, sysfonts.fingerprint(self.regular)["sha1"]))
        self.assertEqual(fp["faces"][0]["weight"], 400)                       # the fingerprint's faces, in both modes
        fam = self.library()["Carlito"]
        self.assertEqual((fam["source"], sorted((x["weight"], x["style"]) for x in fam["faces"])), ("system", [(400, "normal"), (700, "normal")]))
        for x in fam["faces"]:                                    # the exact bytes of this PC's files
            self.assertTrue(os.path.isfile(os.path.join(paths.DATA, "fonts", x["file"])))
        st, h, data = self.req("GET", "/fonts/" + next(x["file"] for x in fam["faces"] if x["weight"] == 400))
        self.assertEqual((st, data), (200, self.regular))
        # captured again (another PC, another build): the library's copy stays the one every PC uses
        with open(os.path.join(self.fontdir, "carlito.ttf"), "wb") as f:
            f.write(self.regular[:-4] + b"\x00\x00\x00\x01")
        from unittest import mock
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "bob", "SLIDEBUILDER_HOST": "pc-bob"}):
            st, fp2 = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp2["copied"], fp2["otherBuilds"]), (True, [fp["sha1"]]))
        self.assertEqual(self.library()["Carlito"]["faces"], fam["faces"])

    def test_copy_mode_adds_the_faces_the_library_lacks(self):
        # the first PC has Regular only; a PC with Bold too adds it (the library's family hides this PC's own Carlito)
        os.remove(os.path.join(self.fontdir, "locked.ttf")); os.remove(os.path.join(self.fontdir, "pair.ttc"))
        moved = os.path.join(self.fontdir, "carlitob.ttf.away")
        os.rename(os.path.join(self.userdir, "carlitob.ttf"), moved)
        sysfonts.set_copy_allowed("J. Doe")
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp["copied"], fp["copiedFaces"], fp["added"]), (True, 1, 1))
        os.rename(moved, os.path.join(self.userdir, "carlitob.ttf"))
        sysfonts._index_cache.clear()
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp["copied"], fp["copiedFaces"], fp["added"]), (True, 2, 1))
        self.assertEqual(sorted(x["weight"] for x in self.library()["Carlito"]["faces"]), [400, 700])

    def test_copy_mode_leaves_nothing_behind_when_it_fails_halfway(self):
        self.only_regular_and_bold()
        sysfonts.set_copy_allowed("J. Doe")
        from unittest import mock
        with mock.patch.object(fonts, "write_json", side_effect=OSError("the share is full")):
            st, _ = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertNotEqual(st, 200)
        self.assertEqual(self.library(), {})
        self.assertEqual([n for n in os.listdir(os.path.join(paths.DATA, "fonts")) if n.lower().endswith((".ttf", ".otf"))], [])
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")          # the next capture copies it whole
        self.assertEqual((st, fp["copied"], fp["copiedFaces"]), (200, True, 2))

    def test_an_upload_cannot_claim_to_be_a_copied_windows_font(self):
        st, lib = self.jreq("POST", "/api/fonts?" + urllib.parse.urlencode({"family": "Carlito", "weight": "400", "style": "normal", "name": "c.ttf", "source": "system"}),
                            self.regular, headers={"Content-Type": "application/octet-stream"})
        self.assertEqual((st, self.library()["Carlito"]["source"]), (200, "upload"))

    def test_a_pc_that_updated_its_font_is_no_longer_named(self):
        # pc-x had build A, then Windows updated it to build B; pc-me has B: nobody has another build
        from unittest import mock
        build_b = self.regular[:-4] + b"\x00\x00\x00\x01"
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "x", "SLIDEBUILDER_HOST": "pc-x"}):
            self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
            with open(os.path.join(self.fontdir, "carlito.ttf"), "wb") as f:
                f.write(build_b)
            self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        with mock.patch.dict(os.environ, {"SLIDEBUILDER_USER": "me", "SLIDEBUILDER_HOST": "pc-me"}):
            st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp["otherBuilds"], fp["otherHosts"]), ([], []))
        with open(os.path.join(paths.DATA, "fonts", "system", "fingerprints.json"), encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["fonts"]), 1)                     # build A: no PC has it any more

    def test_copy_mode_copies_all_faces_or_none(self):
        sysfonts.set_copy_allowed("J. Doe")
        # the family has a face that may not be embedded (locked.ttf) and a collection (pair.ttc): nothing is copied
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((st, fp["mode"], fp["copied"]), (200, "copy", False))
        self.assertRegex(fp["reason"], r"collection|embedded")
        self.assertEqual(self.library(), {})
        os.remove(os.path.join(self.fontdir, "pair.ttc"))
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp["copied"], fp["reason"]), (False, "locked.ttf may not be embedded (OS/2 fsType)"))
        self.assertEqual(self.library(), {})

    def test_copy_mode_leaves_a_library_family_of_the_same_name_alone(self):
        self.only_regular_and_bold()
        sysfonts.set_copy_allowed("J. Doe")
        st, _ = self.jreq("POST", "/api/fonts?" + urllib.parse.urlencode({"family": "Carlito", "weight": "400", "style": "normal", "name": "c.ttf"}),
                          self.regular, headers={"Content-Type": "application/octet-stream"})
        self.assertEqual(st, 200)
        st, fp = self.jreq("POST", "/api/fonts/capture?file=carlito.ttf", b"")
        self.assertEqual((fp["copied"], fp["reason"]), (False, "the library has its own Carlito"))
        self.assertEqual((self.library()["Carlito"]["source"], len(self.library()["Carlito"]["faces"])), ("upload", 1))

    def test_the_command_line_records_the_licence_answer(self):
        from slidebuilder import main
        for arg, want in (("J. Doe, 2026-10-14", "J. Doe, 2026-10-14"), ("off", None)):
            with self.assertRaises(SystemExit) as ex:
                main.main(["--allow-font-copy", arg])
            self.assertEqual(ex.exception.code, 0)
            self.assertEqual(sysfonts.copy_allowed(), want)

    def test_describe_reads_names_and_metrics(self):
        d = sysfonts.describe(self.regular)
        self.assertEqual((d["family"], d["postscript"], d["unitsPerEm"], d["embeddable"]), ("Carlito", "Carlito-Regular", 2048, True))
        self.assertFalse(sysfonts.describe(with_fs_type(self.regular, 2))["embeddable"])
        self.assertTrue(sysfonts.describe(with_fs_type(self.regular, 4))["embeddable"])     # preview & print: allowed
        self.assertFalse(sysfonts.describe(with_fs_type(self.regular, 0x0200))["embeddable"])   # bitmap embedding only
        d = sysfonts.describe(with_fs_type(self.regular, 0x0108))                             # editable, no subsetting
        self.assertEqual((d["embeddable"], d["noSubset"]), (True, True))

    def test_the_listing_reads_only_the_headers(self):
        data, faces = sysfonts._header(os.path.join(self.fontdir, "carlito.ttf"))
        self.assertEqual(faces, 1)
        self.assertLess(len(data), 20000)                       # name, OS/2, head, hhea – not the 600 KB font
        self.assertEqual(sysfonts.describe(data)["family"], "Carlito")

    def test_default_folders_are_windows_and_the_user_folder(self):
        os.environ.pop("SLIDEBUILDER_SYSFONTS", None)
        old = {k: os.environ.get(k) for k in ("WINDIR", "LOCALAPPDATA")}
        os.environ["WINDIR"], os.environ["LOCALAPPDATA"] = r"C:\Windows", r"C:\Users\x\AppData\Local"
        try:
            self.assertEqual(sysfonts.font_dirs(), [os.path.join(r"C:\Windows", "Fonts"), os.path.join(r"C:\Users\x\AppData\Local", "Microsoft", "Windows", "Fonts")])
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
