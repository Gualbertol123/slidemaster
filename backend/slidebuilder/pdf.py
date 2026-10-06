"""PDF writer for image pages (JPEG, or PNG embedded losslessly) and small PNG helpers."""
import datetime as _dt
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
