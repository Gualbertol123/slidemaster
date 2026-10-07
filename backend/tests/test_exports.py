import base64
import os
import threading
import unittest
from unittest import mock

from sbtest import TempDirs, make_png

from slidebuilder import exports, paths
from slidebuilder.engines import EngineError


class FakeEngine:
    """Stands in for Exporter: records calls, returns PNG pages (jpegs_to_pdf accepts PNG)."""

    def __init__(self):
        self.calls = []

    def render(self, css, slides, kind, scale):
        self.calls.append((kind, scale, len(slides)))
        if kind == "vector":
            return b"%PDF-1.4 fake vector\n%%EOF\n", "Fake"
        return [make_png(16, 9, (i * 40 % 256, 100, 200)) for i in range(len(slides))], "Fake"


class ExportTests(TempDirs):
    def test_exact_pdf_falls_back_to_jpeg_for_pngs_it_cannot_embed(self):
        e = FakeEngine()
        rgba = make_png(4, 4)[:25] + b"\x06" + make_png(4, 4)[26:]            # colour type 6 (alpha): not embeddable
        jpeg = b"\xff\xd8\xff\xc0\x00\x11\x08\x00\x09\x00\x10\x03" + b"\x00" * 40 + b"\xff\xd9"
        e.render = lambda css, slides, kind, scale: (e.calls.append(kind), ([rgba] if kind == "png" else [jpeg]), "Fake")[1:]
        r = exports.export({"name": "W.xlsx", "format": "pdf", "slides": ["a"], "names": ["x"]}, e)
        self.assertEqual(e.calls, ["png", "jpeg"])
        self.assertTrue(r["ok"])

    def ls(self):
        return sorted(os.listdir(paths.EXPORT_DIR))

    def test_names(self):
        e = FakeEngine()
        r = exports.export({"name": "Weekly.xlsx", "format": "pdf", "mode": "exact", "slides": ["<p>1</p>", "<p>2</p>"],
                            "names": ["Cover", "P/L"], "scale": 2}, e)
        self.assertEqual(r["files"], ["Weekly - slides.pdf"])
        self.assertEqual((r["ok"], r["engine"]), (True, "Fake"))
        self.assertEqual(e.calls[-1], ("png", 2.0, 2))                 # lossless pages: sharp text and lines
        with open(os.path.join(paths.EXPORT_DIR, "Weekly - slides.pdf"), "rb") as f:
            pdf = f.read()
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertEqual(pdf.count(b"/Type /Page "), 2)

        r = exports.export({"name": "Weekly.xlsx", "format": "pdf", "slides": ["<p>1</p>"], "names": ["P/L"]}, e)
        self.assertEqual(r["files"], ["Weekly - P_L.pdf"])
        self.assertEqual(e.calls[-1], ("png", 3.0, 1))
        r = exports.export({"name": "Weekly.xlsx", "format": "pdf", "slides": ["<p>1</p>"], "names": ["P/L"], "all": True}, e)
        self.assertEqual(r["files"], ["Weekly - slides.pdf"])
        r = exports.export({"name": "Weekly.xlsx", "format": "pdf", "mode": "vector", "slides": ["a", "b"]}, e)
        self.assertEqual(r["files"], ["Weekly - slides (vector).pdf"])
        r = exports.export({"name": "Weekly.xlsx", "format": "png", "slides": ["a", "b"], "names": ["Cover", "P/L"]}, e)
        self.assertEqual(r["files"], ["Weekly - Cover.png", "Weekly - P_L.png"])
        r = exports.export({"name": "Weekly.xlsx", "format": "png", "slides": ["a"], "inline": True}, e)
        self.assertNotIn("files", r)
        self.assertTrue(r["images"][0].startswith("data:image/png;base64,"))
        self.assertEqual(self.ls(), ["Weekly - Cover.png", "Weekly - P_L.pdf", "Weekly - P_L.png",
                                     "Weekly - slides (vector).pdf", "Weekly - slides.pdf"])

    def test_nothing_to_export(self):
        with self.assertRaises(exports.ExportError):
            exports.export({"name": "W.xlsx", "slides": []}, FakeEngine())

    def test_engine_error_propagates(self):
        class Broken:
            def render(self, *a):
                raise EngineError("export engine: no browser available")
        with self.assertRaises(EngineError):
            exports.export({"name": "W.xlsx", "slides": ["a"]}, Broken())
        self.assertFalse(os.path.exists(paths.EXPORT_DIR) and self.ls())

    def test_existing_unlocked_target_is_replaced(self):
        self.assertEqual(exports.save_export("A - slides.pdf", b"one"), "A - slides.pdf")
        self.assertEqual(exports.save_export("A - slides.pdf", b"two"), "A - slides.pdf")
        with open(os.path.join(paths.EXPORT_DIR, "A - slides.pdf"), "rb") as f:
            self.assertEqual(f.read(), b"two")
        self.assertEqual(self.ls(), ["A - slides.pdf"])

    def test_locked_target_gets_a_suffix(self):
        exports.save_export("A - slides.pdf", b"one")
        exports.save_export("A - slides (2).pdf", b"two")
        locked = {"A - slides.pdf", "A - slides (2).pdf"}
        with mock.patch.object(exports, "is_locked", lambda p: os.path.basename(p) in locked):
            self.assertEqual(exports.save_export("A - slides.pdf", b"three"), "A - slides (3).pdf")
        with open(os.path.join(paths.EXPORT_DIR, "A - slides.pdf"), "rb") as f:
            self.assertEqual(f.read(), b"one")
        self.assertEqual(self.ls(), ["A - slides (2).pdf", "A - slides (3).pdf", "A - slides.pdf"])

    def test_concurrent_writers_never_mix(self):
        payloads = [bytes([65 + i]) * 200000 for i in range(6)]
        out = []

        def go(p):
            out.append(exports.save_export("B - slides.pdf", p))
        ts = [threading.Thread(target=go, args=(p,)) for p in payloads]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(out, ["B - slides.pdf"] * 6)
        with open(os.path.join(paths.EXPORT_DIR, "B - slides.pdf"), "rb") as f:
            self.assertIn(f.read(), payloads)
        self.assertEqual(self.ls(), ["B - slides.pdf"])

    def test_assemble(self):
        png = make_png(32, 18)
        imgs = ["data:image/png;base64," + base64.b64encode(png).decode()] * 3
        r = exports.assemble({"name": "Deck.xlsx", "images": imgs})
        self.assertEqual(r, {"ok": True, "files": ["Deck - slides.pdf"]})
        with open(os.path.join(paths.EXPORT_DIR, "Deck - slides.pdf"), "rb") as f:
            pdf = f.read()
        self.assertEqual(pdf.count(b"/Type /Page "), 3)
        self.assertIn(b"/Title (Deck)", pdf)
        with self.assertRaises(exports.ExportError):
            exports.assemble({"name": "Deck.xlsx", "images": ["data:image/jpeg;base64,AAAA"]})


if __name__ == "__main__":
    unittest.main()
