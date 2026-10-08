"""Exports never have white bars: page boxes are trimmed to the slide, wrong output is refused."""
import re
import struct
import unittest
import zlib

from sbtest import make_png

from slidebuilder.engines import EngineError, check_output, compose
from slidebuilder.pdf import jpegs_to_pdf, pdf_fit_pages, pdf_page_boxes, picture_size, png_crop


def xref_ok(pdf):
    """every xref entry points at its object, startxref at the table"""
    start = int(re.findall(rb"startxref\s+(\d+)", pdf)[-1])
    assert pdf[start:start + 4] == b"xref", "startxref"
    n = int(re.match(rb"xref\s+0 (\d+)", pdf[start:]).group(1))
    body = pdf[start:].split(b"\n", 2)[2]
    for k in range(1, n):
        off = int(body[k * 20:k * 20 + 10])
        assert pdf[off:].startswith(b"%d 0 obj" % k), k
    return True


def chrome_like(n=2, h="675.12"):
    """a PDF like Chrome's: pages rounded up to 1/300 in"""
    pdf = jpegs_to_pdf([make_png()] * n, "t")
    return pdf.replace(b"/MediaBox [0 0 1200.000 675.000]", ("/MediaBox [0 0 1200 %s]" % h).encode().ljust(32))


class PageBoxes(unittest.TestCase):
    def test_image_pdfs_are_one_slide_per_page(self):
        self.assertEqual(pdf_page_boxes(jpegs_to_pdf([make_png()] * 3, "t")), [(1200.0, 675.0)] * 3)

    def test_a_rounded_up_page_is_trimmed_to_the_slide_keeping_its_top(self):
        pdf = chrome_like()
        self.assertTrue(xref_ok(pdf))
        out, n = pdf_fit_pages(pdf, 16 / 9)
        self.assertEqual(n, 2)
        self.assertEqual(re.findall(rb"/MediaBox \[[^\]]*\]", out), [b"/MediaBox [0 0.12 1200 675.12]"] * 2)
        self.assertTrue(xref_ok(out))                              # offsets moved with the longer boxes
        self.assertEqual(pdf_fit_pages(out, 16 / 9), (out, 0))     # exact pages are left alone

    def test_a_page_far_off_is_refused(self):
        with self.assertRaises(ValueError):
            pdf_fit_pages(chrome_like(h="792"), 16 / 9)            # e.g. Letter paper: the slide would sit in white

    def test_check_output_trims_and_counts(self):
        out = check_output(chrome_like(2), "vector", 2, 1)
        self.assertIn(b"/MediaBox [0 0.12 1200 675.12]", out)
        with self.assertRaises(EngineError):
            check_output(chrome_like(3), "vector", 2, 1)          # a blank page more than slides
        with self.assertRaises(EngineError):
            check_output(chrome_like(2, h="900"), "vector", 2, 1)
        with self.assertRaises(EngineError):
            check_output(b"<html>", "vector", 1, 1)


def pdf_with(pages):
    """a small PDF: one page per (media box, content stream), content Flate-compressed like Chrome's"""
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>"}
    kids = []
    for k, (box, content) in enumerate(pages):
        pid, cid = 3 + 2 * k, 4 + 2 * k
        kids.append(pid)
        objs[pid] = b"<< /Type /Page /Parent 2 0 R /MediaBox [%s] /Contents %d 0 R >>" % (" ".join("%g" % v for v in box).encode(), cid)
        z = zlib.compress(content)
        objs[cid] = b"<< /Filter /FlateDecode /Length %d >>\nstream\n" % len(z) + z + b"\nendstream"
    objs[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    out, offs = bytearray(b"%PDF-1.4\n"), {}
    for i in range(1, max(objs) + 1):
        offs[i] = len(out)
        out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (max(objs) + 1) + b"".join(b"%010d 00000 n \n" % offs[i] for i in range(1, max(objs) + 1))
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (max(objs) + 1, x)
    return bytes(out)


class DrawnSlide(unittest.TestCase):
    MARK = b"1 1 .99607843 rg 0 0 1600 900 re f "

    def test_a_slide_drawn_smaller_gets_a_page_of_its_own_size(self):
        # Windows display scaling 150 %: the slide drawn at 2/3 in the top-left corner of the page
        k = 0.75 / 1.5
        pdf = pdf_with([((0, 0, 1200, 675), b"%g 0 0 %g 0 675 cm q " % (k, -k) + self.MARK + b"0 0 1 rg 10 10 50 50 re f Q")] * 2)
        out, n = pdf_fit_pages(pdf, 16 / 9)
        self.assertEqual(n, 2)
        self.assertEqual(re.findall(rb"/MediaBox \[[^\]]*\]", out), [b"/MediaBox [0 225 800 675]"] * 2)
        self.assertTrue(xref_ok(out))

    def test_the_marker_is_found_through_nested_transforms(self):
        pdf = pdf_with([((0, 0, 1200, 675.12), b".23999999 0 0 -.23999999 0 675.12 cm q 3.125 0 0 3.125 0 0 cm 1 1 1 rg 0 0 1600 900 re f Q q 3.125 0 0 3.125 0 0 cm " + self.MARK + b"Q")])
        out, n = pdf_fit_pages(pdf, 16 / 9)
        self.assertEqual(re.findall(rb"/MediaBox \[[^\]]*\]", out), [b"/MediaBox [0 0.12 1200 675.12]"])

    def test_a_slide_drawn_out_of_shape_is_refused(self):
        pdf = pdf_with([((0, 0, 1200, 675), b"0.75 0 0 -0.4 0 675 cm " + self.MARK)])
        with self.assertRaises(ValueError):
            pdf_fit_pages(pdf, 16 / 9)


class Pictures(unittest.TestCase):
    def test_a_larger_capture_is_cut_to_the_slide_a_smaller_one_refused(self):
        big = make_png(1610, 910)
        [p] = check_output([big], "png", 1, 1)
        self.assertEqual(picture_size(p), (1600, 900))
        self.assertEqual(check_output([make_png(1600, 900)], "png", 1, 1)[0], make_png(1600, 900))
        with self.assertRaises(EngineError):
            check_output([make_png(1500, 900)], "png", 1, 1)      # would be stretched or padded
        with self.assertRaises(EngineError):
            check_output([make_png(1600, 900)], "png", 2, 1)

    def test_png_crop_keeps_the_pixels(self):
        # rows with every filter type: cropping the right side must not change the kept pixels
        w, h = 7, 5
        rows = b"".join(bytes([f]) + bytes((x * 30 + y * 7 + c) % 256 for x in range(w) for c in range(3)) for y, f in zip(range(h), (0, 1, 2, 3, 4)))
        def chunk(t, b):
            return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        import io
        full, cut = Image.open(io.BytesIO(png)).convert("RGB"), Image.open(io.BytesIO(png_crop(png, 4, 3))).convert("RGB")
        self.assertEqual(cut.size, (4, 3))
        self.assertEqual([cut.getpixel((x, y)) for x in range(4) for y in range(3)], [full.getpixel((x, y)) for x in range(4) for y in range(3)])


class PageCss(unittest.TestCase):
    def test_one_unscaled_slide_per_page(self):
        html = compose("", ["<div class=slide>a</div>", "<div class=slide>b</div>"])
        self.assertIn("@page{size:1600px 900px;margin:0}", html)
        self.assertNotIn("zoom", html)
        self.assertNotIn("scale(", html)
        self.assertEqual(html.count('<div class="page">'), 2)


if __name__ == "__main__":
    unittest.main()
