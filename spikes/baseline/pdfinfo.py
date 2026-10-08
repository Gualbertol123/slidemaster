"""size, pages, page size, fonts (subtype), images (count, pixels) and text extractability of a PDF (pypdf)"""
import json, os, sys
from pypdf import PdfReader
f = sys.argv[1]; r = PdfReader(f)
fonts, images, pix = {}, 0, 0
seen = set()
def walk(res):
    global images, pix
    if not res: return
    res = res.get_object()
    for _, fo in (res.get("/Font") or {}).items():
        fo = fo.get_object(); fonts[str(fo.get("/BaseFont"))] = str(fo.get("/Subtype"))
    for _, xo in (res.get("/XObject") or {}).items():
        ref = getattr(xo, "idnum", None); xo = xo.get_object()
        if xo.get("/Subtype") == "/Image":
            if ref not in seen: seen.add(ref); images += 1; pix += int(xo.get("/Width", 0)) * int(xo.get("/Height", 0))
        elif xo.get("/Subtype") == "/Form": walk(xo.get("/Resources"))
for p in r.pages: walk(p.get("/Resources"))
mb = r.pages[0].mediabox
text = r.pages[min(1, len(r.pages) - 1)].extract_text() or ""
print(json.dumps({"bytes": os.path.getsize(f), "kb_per_page": round(os.path.getsize(f) / 1024 / len(r.pages), 1), "pages": len(r.pages),
                  "page_pt": [round(float(mb.width), 2), round(float(mb.height), 2)], "fonts": fonts,
                  "type3": sum(1 for v in fonts.values() if v == "/Type3"), "images": images, "image_mpix": round(pix / 1e6, 2),
                  "text_chars_p2": len(text)}))
