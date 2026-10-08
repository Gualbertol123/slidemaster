"""PDF writer for image pages (JPEG, or PNG embedded losslessly) and small PNG helpers."""
import datetime as _dt
import re
import struct
import zlib

from . import VERSION
from .paths import PAGE_H_IN, PAGE_W_IN


def jpeg_size(data):
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            comps = data[i + 9]
            return w, h, comps
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seg
    raise ValueError("not a JPEG")

def pdf_text(s):
    try:
        s.encode("ascii")
        return "(" + s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"
    except UnicodeEncodeError:
        return "<FEFF" + s.encode("utf-16-be").hex().upper() + ">"

def png_info(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or ctype not in (0, 2) or interlace:
        raise ValueError("unsupported PNG layout (%d/%d/%d)" % (depth, ctype, interlace))
    return w, h, (1 if ctype == 0 else 3), b"".join(idat)

def png_first_column(data):
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or ctype not in (2, 6):
        return []
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(b"".join(idat))
    stride, prev, px = 1 + w * bpp, [0] * bpp, []
    for y in range(h):
        f = raw[y * stride]
        cur = []
        for k in range(bpp):
            x, up = raw[y * stride + 1 + k], prev[k]
            cur.append((x + (up if f in (2, 4) else up // 2 if f == 3 else 0)) & 255)
        px.append(tuple(cur[:3])); prev = cur
    return px

def png_crop_height(data, new_h):
    """Keep the top new_h rows of an 8-bit RGB/RGBA PNG (filters are per row, so rows can simply be cut)."""
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", ihdr)
    if h <= new_h or depth != 8 or inter or ctype not in (2, 6, 0):
        return data
    bpp = {0: 1, 2: 3, 6: 4}[ctype]
    raw = zlib.decompress(b"".join(idat))[: new_h * (1 + w * bpp)]
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, new_h, depth, ctype, comp, filt, inter))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))

def picture_size(data):
    """(width, height) of a PNG or JPEG"""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    w, h, _ = jpeg_size(data)
    return w, h

def png_crop(data, new_w, new_h):
    """Keep the top-left new_w x new_h of an 8-bit PNG. Rows are cut at the bottom and bytes at the right
    end of each row: PNG row filters only look left and up, so the kept bytes decode unchanged."""
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = body
        elif typ == b"IDAT":
            idat.append(body)
        pos += 12 + ln
    w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", ihdr)
    if (w <= new_w and h <= new_h) or depth != 8 or inter or ctype not in (0, 2, 4, 6):
        return data
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    nw, nh = min(w, new_w), min(h, new_h)
    raw, stride = zlib.decompress(b"".join(idat)), 1 + w * bpp
    rows = b"".join(raw[y * stride: y * stride + 1 + nw * bpp] for y in range(nh))
    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", nw, nh, depth, ctype, comp, filt, inter))
            + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))

_PAGE = re.compile(rb"/Type\s*/Page(?![a-zA-Z])")
_BOX = re.compile(rb"/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]")

def pdf_page_boxes(data):
    """[(width, height) or None per page] of a PDF written by Chrome, or None when its page objects
    cannot be read (compressed object streams). A box inherited from /Pages counts for each page."""
    if b"/ObjStm" in data:
        return None
    objs = re.split(rb"\bendobj\b", data)
    pages, inherited = [], None
    for o in objs:
        m = _BOX.search(o)
        box = (float(m.group(3)) - float(m.group(1)), float(m.group(4)) - float(m.group(2))) if m else None
        if _PAGE.search(o):
            pages.append(box)
        elif box and re.search(rb"/Type\s*/Pages\b", o):
            inherited = box
    return [b or inherited for b in pages] if pages else None

def _xref(data):
    """object offsets from a PDF's single classic xref table: (xref_pos, [(entry_pos, offset, number)]), or None
    (xref streams, incremental updates – then the PDF is left as it is)"""
    m = list(re.finditer(rb"startxref\s+(\d+)", data))
    if len(m) != 1 or data.count(b"\nxref") + data.startswith(b"xref") != 1:
        return None
    pos = int(m[0].group(1))
    if data[pos:pos + 4] != b"xref":
        return None
    i, entries = pos + 4, []
    while True:
        h = re.compile(rb"\s*(\d+) (\d+)[ \t]*\r?\n").match(data, i)
        if not h:
            break
        i, first = h.end(), int(h.group(1))
        for k in range(int(h.group(2))):
            e = data[i:i + 20]
            if not re.match(rb"\d{10} \d{5} [nf]", e):
                return None
            if e[17:18] == b"n":
                entries.append((i, int(e[:10]), first + k))
            i += 20
    return (pos, entries) if entries else None

# Each page box of an export is painted in this colour (#FFFFFE, invisible under the slide): finding where it
# was drawn in a page's content tells exactly where the browser put the slide on the page.
MARKER_RGB = (1.0, 1.0, 254 / 255)
_TOK = re.compile(rb"/[^\s/\[\]()<>{}]*|\((?:\\.|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\[|\]|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'\"*]+")

def _stream(data, off):
    end = data.find(b"endobj", off)
    m = re.compile(rb"stream\r?\n").search(data, off, end)
    if not m:
        return None
    raw = data[m.end():data.rfind(b"endstream", m.end(), end)]
    if b"/FlateDecode" in data[off:m.start()]:
        try:
            raw = zlib.decompressobj().decompress(raw)
        except zlib.error:
            return None
    return raw

def drawn_marker(content, limit=400000):
    """bounding box (x0, y0, x1, y1, in pt) of the first rectangle filled with MARKER_RGB, or None"""
    ctm, stack, ops, fill, rect = [1, 0, 0, 1, 0, 0], [], [], None, None
    for t in _TOK.findall(content[:limit]):
        c = t[:1]
        if c.isdigit() or c in b"-+.":
            ops.append(float(t)); continue
        if c in b"/([<]" or t in (b">>", b"<<"):
            ops = []; continue
        if t == b"q":
            stack.append(ctm)
        elif t == b"Q":
            ctm = stack.pop() if stack else ctm
        elif t == b"cm" and len(ops) >= 6:
            a1, b1, c1, d1, e1, f1 = ops[-6:]; a2, b2, c2, d2, e2, f2 = ctm
            ctm = [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2]
        elif t == b"rg" and len(ops) >= 3:
            fill = tuple(ops[-3:])
        elif t == b"re" and len(ops) >= 4:
            x, y, w, h = ops[-4:]
            pts = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
            a, b_, c_, d, e, f = ctm
            xs = [a * px + c_ * py + e for px, py in pts]; ys = [b_ * px + d * py + f for px, py in pts]
            rect = (min(xs), min(ys), max(xs), max(ys))
        elif t in (b"f", b"F", b"f*", b"B", b"B*"):
            if rect and fill and all(abs(u - v) < 0.0015 for u, v in zip(fill, MARKER_RGB)):
                return rect
            rect = None
        elif t == b"n":
            rect = None
        ops = []
    return None

def pdf_fit_pages(data, aspect, slack=2.5):
    """Make every page exactly the slide. Where the page's marker box was drawn (MARKER_RGB) is the slide:
    the page is cut to it, whatever the browser did – rounded the paper up (Chrome rounds to 1/300 in: a
    900 px slide became a 675.12 pt page with a white hairline) or drew the slide smaller (Windows display
    scaling: a slide on two thirds of the page). Without a marker, a box a fraction of a point off the
    slide's shape is trimmed (keeping the top-left, where the slide is drawn).
    Returns (data, pages changed), or raises ValueError when a page cannot be made to fit."""
    xr = _xref(data)
    if not xr:
        return data, 0
    xref_pos, entries = xr
    where = {num: off for _, off, num in entries}
    edits = []                                              # (start, end, new bytes)
    for _, off, _num in entries:
        end = data.find(b"endobj", off)
        st = data.find(b"stream", off, end if end > 0 else None)
        head = data[off:st if st > 0 else end]
        if not _PAGE.search(head):
            continue
        m = _BOX.search(head)
        if not m:
            continue
        x0, y0, x1, y1 = (float(v) for v in m.groups())
        w, h = x1 - x0, y1 - y0
        mk, c = None, re.search(rb"/Contents\s*(?:\[\s*)?(\d+)\s+0\s+R", head)
        if c and int(c.group(1)) in where:
            content = _stream(data, where[int(c.group(1))])
            mk = drawn_marker(content) if content else None
        if mk:
            mx0, my0 = max(x0, mk[0]), max(y0, mk[1])
            mx1, my1 = min(x1, mk[2]), min(y1, mk[3])
            mw, mh = mx1 - mx0, my1 - my0
            if mw < 1 or mh < 1 or abs(mw / mh - aspect) > 0.01:
                raise ValueError("the slide was drawn %.1f x %.1f pt on a %.1f x %.1f pt page" % (mk[2] - mk[0], mk[3] - mk[1], w, h))
            if max(abs(mx0 - x0), abs(my0 - y0), abs(mx1 - x1), abs(my1 - y1)) < 0.005:
                continue
            nx0, ny0, nx1, ny1 = mx0, my0, mx1, my1
        else:
            if abs(w / h - aspect) < 1e-4:
                continue
            nw, nh = (h * aspect, h) if w / h > aspect else (w, w / aspect)
            if w - nw > slack or h - nh > slack:
                raise ValueError("page is %.2f x %.2f pt, %.2f x %.2f expected" % (w, h, nw, nh))
            nx0, ny0, nx1, ny1 = x0, y1 - nh, x0 + nw, y1
        box = b"/MediaBox [%s %s %s %s]" % tuple(("%.2f" % v).rstrip("0").rstrip(".").encode() for v in (nx0, ny0, nx1, ny1))
        if box != m.group(0):
            edits.append((off + m.start(), off + m.end(), box))
    if not edits:
        return data, 0
    out, last, shifts = bytearray(), 0, []
    for a, b, rep in sorted(edits):
        out += data[last:a] + rep
        shifts.append((a, len(rep) - (b - a)))
        last = b
    out += data[last:]
    moved = lambda pos: pos + sum(d for at, d in shifts if at < pos)
    for entry_pos, off, _num in entries:                    # same-length rewrite of each xref entry
        p = moved(entry_pos)
        out[p:p + 10] = b"%010d" % moved(off)
    m = list(re.finditer(rb"startxref\s+(\d+)", bytes(out)))[-1]
    out[m.start(1):m.end(1)] = str(moved(xref_pos)).encode()
    return bytes(out), len(edits)

def jpegs_to_pdf(jpegs, title):
    pw, ph = PAGE_W_IN * 72, PAGE_H_IN * 72
    objs = {}
    n = len(jpegs)
    kids = []
    for k, img in enumerate(jpegs):
        page_id, cont_id, img_id = 4 + 3 * k, 5 + 3 * k, 6 + 3 * k
        kids.append(page_id)
        content = ("q %.3f 0 0 %.3f 0 0 cm /Im0 Do Q" % (pw, ph)).encode()
        if img[:4] == b"\x89PNG":          # lossless: PNG data goes into the PDF unchanged (Flate + PNG predictor)
            w, h, colors, raw = png_info(img)
            objs[page_id] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] "
                             "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (pw, ph, img_id, cont_id)).encode()
            objs[cont_id] = b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
            objs[img_id] = (b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /FlateDecode "
                            b"/DecodeParms << /Predictor 15 /Colors %d /BitsPerComponent 8 /Columns %d >> /Length %d >>\nstream\n"
                            % (w, h, b"/DeviceRGB" if colors == 3 else b"/DeviceGray", colors, w, len(raw))) + raw + b"\nendstream"
            continue
        w, h, comps = jpeg_size(img)
        cs = "/DeviceGray" if comps == 1 else ("/DeviceCMYK" if comps == 4 else "/DeviceRGB")
        objs[page_id] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] "
                         "/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (pw, ph, img_id, cont_id)).encode()
        objs[cont_id] = b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream"
        objs[img_id] = (b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 "
                        b"/Filter /DCTDecode /Length %d >>\nstream\n" % (w, h, cs.encode(), len(img))) + img + b"\nendstream"
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>"
    objs[2] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % k for k in kids), n)).encode()
    now = _dt.datetime.now().strftime("D:%Y%m%d%H%M%S")
    objs[3] = ("<< /Title %s /Producer (Slide Builder %s) /CreationDate (%s) >>" % (pdf_text(title), VERSION, now)).encode()
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for i in range(1, max(objs) + 1):
        offsets[i] = len(out)
        out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (max(objs) + 1)
    for i in range(1, max(objs) + 1):
        out += b"%010d 00000 n \n" % offsets[i]
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 3 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (max(objs) + 1, xref)
    return bytes(out)
