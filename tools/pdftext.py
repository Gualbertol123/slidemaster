"""Text of a PDF as JSON (golden capture, docs/next/05 §2 GF). Dev only: needs pypdf.

    python tools/pdftext.py file.pdf  >  pdf.json

{"pages": n, "sizes": [[w, h] per page, points], "fonts": [base font names], "images": n,
 "pageText": [the page's text, NFKC (ligatures folded), whitespace removed],
 "text": [[{"s": text run, "font": name} ...] per page]}
No positions: pypdf does not follow the transforms of the Form XObjects Chromium writes, so its glyph
origins are not page coordinates (05 SP checks positions with PDFium from M3 on).
"""
import json
import re
import sys
import unicodedata

from pypdf import PdfReader


def page_text(page):
    runs = []

    def visit(text, cm, tm, font, size):
        # pypdf calls the visitor once more at the end with the whole page's text: that is not a run
        if not text or not text.strip() or "\n" in text.strip():
            return
        name = str(font.get("/BaseFont", "")) if font else ""
        runs.append({"s": text.strip(), "font": name.split("+", 1)[-1]})
    page.extract_text(visitor_text=visit)
    return runs


def normal(runs):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", "".join(r["s"] for r in runs)))


def info(path):
    r = PdfReader(path)
    fonts, images = set(), 0
    texts = [page_text(p) for p in r.pages]
    for p in r.pages:
        res = p.get("/Resources") or {}
        for f in (res.get("/Font") or {}).values():
            fonts.add(str(f.get_object().get("/BaseFont", "")).split("+", 1)[-1])
        images += len(p.images)
    return {"pages": len(r.pages), "sizes": [[round(float(p.mediabox.width), 1), round(float(p.mediabox.height), 1)] for p in r.pages],
            "fonts": sorted(fonts), "images": images, "pageText": [normal(t) for t in texts], "text": texts}


def dumps(d):
    """one text run per line: small, and a diff shows which run changed"""
    head = json.dumps({k: v for k, v in d.items() if k != "text"}, ensure_ascii=True)[:-1]
    pages = ",\n".join("[\n" + ",\n".join(json.dumps(r, ensure_ascii=True) for r in page) + "\n]" for page in d["text"])
    return head + ',"text":[\n' + pages + "\n]}\n"


if __name__ == "__main__":
    sys.stdout.write(dumps(info(sys.argv[1])))
