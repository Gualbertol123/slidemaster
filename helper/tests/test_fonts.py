import os
import struct
import urllib.parse

import test_http

from slidebuilder import fonts, paths


def fake_font(tag=b"\x00\x01\x00\x00", size=64):
    """enough of an sfnt header for the format check (the helper never parses fonts)"""
    return tag + struct.pack(">H", 0) + b"\x00" * (size - 6)


TOKEN = test_http.TOKEN


class FontLibrary(test_http.HttpBase):
    def add(self, family, data, **q):
        q = dict({"family": family, "weight": "400", "style": "normal", "name": "x.ttf"}, **q)
        return self.jreq("POST", "/api/fonts?" + urllib.parse.urlencode(q), data, headers={"Content-Type": "application/octet-stream"})

    def test_upload_list_serve_remove(self):
        self.assertEqual(self.jreq("GET", "/api/fonts"), (200, {"schema": 1, "fonts": []}))
        st, lib = self.add("Brand Sans", fake_font())
        self.assertEqual(st, 200, lib)
        st, lib = self.add("Brand Sans", fake_font(b"wOF2"), weight="700", style="italic", name="b.woff2")
        self.assertEqual(st, 200, lib)
        [f] = lib["fonts"]
        self.assertEqual(f["family"], "Brand Sans")
        self.assertEqual(f["by"], "tester")
        self.assertEqual(sorted((x["weight"], x["style"], os.path.splitext(x["file"])[1]) for x in f["faces"]),
                         [(400, "normal", ".ttf"), (700, "italic", ".woff2")])
        # the library is shared: it lives in the data folder
        self.assertTrue(os.path.isfile(os.path.join(paths.DATA, "fonts", "fonts.json")))
        # files are served with the token (header or ?t= for @font-face urls)
        name = f["faces"][0]["file"]
        st, h, data = self.req("GET", "/fonts/" + urllib.parse.quote(name), token=False)
        self.assertEqual(st, 403)
        st, h, data = self.req("GET", "/fonts/" + urllib.parse.quote(name) + "?t=" + TOKEN, token=False)
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("font/"))
        # the same style again replaces the face (no duplicates)
        st, lib = self.add("brand sans", fake_font(size=80))
        self.assertEqual(len(lib["fonts"][0]["faces"]), 2)
        # removing deletes the entry and its files
        st, lib = self.jreq("DELETE", "/api/fonts?family=" + urllib.parse.quote("Brand Sans"))
        self.assertEqual((st, lib["fonts"]), (200, []))
        self.assertEqual([n for n in os.listdir(fonts.fonts_dir()) if n != "fonts.json"], [])

    def test_google_faces_keep_their_unicode_range(self):
        st, lib = self.add("Roboto", fake_font(b"wOF2"), source="google", range="U+0000-00FF, U+0131", name="r.woff2")
        self.assertEqual(st, 200, lib)
        self.assertEqual(lib["fonts"][0]["source"], "google")
        self.assertEqual(lib["fonts"][0]["faces"][0]["range"], "U+0000-00FF, U+0131")

    def test_bad_uploads_are_refused(self):
        self.assertEqual(self.add("Brand", b"<html>not a font</html>")[0], 400)
        self.assertEqual(self.add("Brand", b"")[0], 400)
        for bad in ("", "x" * 80, "a'b", "a;b", "<b>", "../x"):
            st, body = self.add(bad, fake_font())
            self.assertEqual(st, 400, bad)
        self.assertEqual(self.jreq("GET", "/api/fonts")[1]["fonts"], [])

    def test_font_files_stay_in_the_font_folder(self):
        self.add("Brand", fake_font())
        for p in ("/fonts/..%2Fconfig.json", "/fonts/fonts.json", "/fonts/..%2F..%2Fx.ttf", "/fonts/%2E%2E%5Cx.ttf"):
            st, _, _ = self.req("GET", p)
            self.assertIn(st, (403, 404), p)

    def test_token_and_formats_required_to_change(self):
        st, _ = self.jreq("POST", "/api/fonts?family=X", fake_font(), token=False, headers={"Content-Type": "application/octet-stream"})
        self.assertEqual(st, 403)
        st, _ = self.jreq("DELETE", "/api/fonts?family=X", token=False)
        self.assertEqual(st, 403)
        st, _ = self.jreq("DELETE", "/api/fonts?family=X", headers={"X-SB-Formats": "workbook=99;config=3;prefs=1"})
        self.assertEqual(st, 409)


class LogoFiles(test_http.HttpBase):
    def test_logo_found_by_name_case_and_folder_and_uploaded(self):
        from sbtest import make_png
        png = make_png()
        with open(os.path.join(paths.ROOT, "Logo.PNG"), "wb") as f:
            f.write(png)
        for name in ("logo.png", "Logo.PNG", "backend/logo.png"):         # other case, a folder typed in the name
            st, h, data = self.req("GET", "/assets/" + urllib.parse.quote(name))
            self.assertEqual((st, data), (200, png), name)
        self.assertEqual(self.req("GET", "/assets/other.png")[0], 404)
        st, body = self.jreq("POST", "/api/logo?name=" + urllib.parse.quote("brand logo.png"), png, headers={"Content-Type": "application/octet-stream"})
        self.assertEqual((st, body), (200, {"name": "brand_logo.png"}))
        self.assertTrue(os.path.isfile(os.path.join(paths.DATA, "assets", "brand_logo.png")))
        self.assertEqual(self.req("GET", "/assets/brand_logo.png")[2], png)
        self.assertEqual(self.jreq("POST", "/api/logo?name=x.svg", b"<svg/>", headers={"Content-Type": "application/octet-stream"})[0], 400)
        self.assertEqual(self.jreq("POST", "/api/logo?name=x.png", b"", token=False, headers={"Content-Type": "application/octet-stream"})[0], 403)
