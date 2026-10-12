"""PDF checks for the native export (docs/next/05 GF and SP; PLAN S3.1). Dev only: needs pypdf and pypdfium2, and
qpdf for `check` (QPDF=path\\to\\qpdf.exe, or qpdf on PATH). The helper stays standard-library only.

    python tools/pdfcheck.py info   a.pdf [b.pdf ...]          size, pages, fonts, Type 3 / variable fonts, images, text
    python tools/pdfcheck.py check  a.pdf [...] [--max-kb-per-page N] [--max-images N] [--text expected.json]
                                                              qpdf --check, no Type 3, no variable font; exit 1 on a failure
    python tools/pdfcheck.py render a.pdf [...] --out DIR [--scale 1.3333]
                                                              every page with PDFium to DIR/<name>-<page>.png (1600 × 900 at 4/3)
    python tools/pdfcheck.py cost   a.pdf [...]               time to rasterise each page at screen size with PDFium (viewer cost)
    python tools/pdfcheck.py text   a.pdf                     the text of each page (pypdf), as JSON

From spikes/baseline/pdfinfo.py and spikes/pdfwriter/render_cost.py.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata


def _reader(path):
    from pypdf import PdfReader
    return PdfReader(path)


def _font_program_tables(data):
    """table tags of an sfnt font program, or ['CFF '] for a bare CFF"""
    if len(data) < 12:
        return []
    tag = data[:4]
    if tag in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        n = int.from_bytes(data[4:6], "big")
        return [data[12 + 16 * i:16 + 16 * i].decode("latin-1") for i in range(n)]
    return ["CFF "] if data[0] == 1 else []


def page_text(page):
    """the page's text without artifacts (marked content /Artifact: decorative copies such as a title's text shadow
    are drawn but not text, PDF 32000 §14.8.2.2)"""
    out, stack = [], []

    def before(op, args, cm, tm):
        if op in (b"BMC", b"BDC"):
            stack.append(str(args[0]) if args else "")
        elif op == b"EMC" and stack:
            stack.pop()

    def text(t, cm, tm, font, size):
        if t and "/Artifact" not in stack:
            out.append(t)
    page.extract_text(visitor_operand_before=before, visitor_text=text)
    return "".join(out)


def info(path):
    r = _reader(path)
    fonts, variable, seen, images, pix = {}, set(), set(), 0, 0

    def walk(res):
        nonlocal images, pix
        if not res:
            return
        res = res.get_object()
        for _, fo in (res.get("/Font") or {}).items():
            fo = fo.get_object()
            name = str(fo.get("/BaseFont"))
            fonts[name] = str(fo.get("/Subtype"))
            for d in fo.get("/DescendantFonts") or [fo]:
                desc = d.get_object().get("/FontDescriptor")
                if not desc:
                    continue
                desc = desc.get_object()
                for key in ("/FontFile2", "/FontFile3", "/FontFile"):
                    if key in desc:
                        prog = desc[key].get_object()
                        tables = _font_program_tables(prog.get_data())
                        sub = str(prog.get("/Subtype", ""))
                        if any(t in tables for t in ("fvar", "gvar", "CFF2")) or sub == "/CFF2":
                            variable.add(name)
        for _, xo in (res.get("/XObject") or {}).items():
            ref = getattr(xo, "idnum", None)
            xo = xo.get_object()
            if xo.get("/Subtype") == "/Image":
                if ref not in seen:
                    seen.add(ref)
                    images += 1
                    pix += int(xo.get("/Width", 0)) * int(xo.get("/Height", 0))
            elif xo.get("/Subtype") == "/Form" and ref not in seen:
                seen.add(ref)
                walk(xo.get("/Resources"))
    for p in r.pages:
        walk(p.get("/Resources"))
    mb = r.pages[0].mediabox
    size = os.path.getsize(path)
    texts = [page_text(p) for p in r.pages]
    return {"file": os.path.basename(path), "bytes": size, "kb_per_page": round(size / 1024 / len(r.pages), 1), "pages": len(r.pages),
            "page_pt": [round(float(mb.width), 2), round(float(mb.height), 2)], "fonts": fonts,
            "type3": sum(1 for v in fonts.values() if v == "/Type3"), "variable_fonts": sorted(variable),
            "images": images, "image_mpix": round(pix / 1e6, 2), "text": texts}


def normal(s):
    """text compared without whitespace, ligatures folded (NFKC), as tools/pdftext.py's pageText"""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def qpdf_check(path):
    exe = os.environ.get("QPDF") or shutil.which("qpdf")
    if not exe:
        return False, "qpdf not found (set QPDF or put qpdf on PATH)"
    p = subprocess.run([exe, "--check", path], capture_output=True, text=True)
    # exit 0 = no problems; 3 = warnings only, which also count as a failure here
    return p.returncode == 0, (p.stdout + p.stderr).strip().splitlines()[-1] if (p.stdout + p.stderr).strip() else ""


def check(paths, max_kb=None, max_images=None, text=None):
    expected = json.load(open(text, encoding="utf-8")) if text else None
    ok_all, out = True, []
    for i, path in enumerate(paths):
        problems = []
        ok, msg = qpdf_check(path)
        if not ok:
            problems.append("qpdf --check: " + msg)
        d = info(path)
        if d["type3"]:
            problems.append(f"{d['type3']} Type 3 font(s)")
        if d["variable_fonts"]:
            problems.append("variable font(s): " + ", ".join(d["variable_fonts"]))
        if max_kb is not None and d["kb_per_page"] > max_kb:
            problems.append(f"{d['kb_per_page']} KB per page > {max_kb}")
        if max_images is not None and d["images"] > max_images:
            problems.append(f"{d['images']} images > {max_images}")
        if expected is not None:
            want = expected[i] if isinstance(expected, list) and expected and isinstance(expected[0], list) else expected
            got = [normal(t) for t in d["text"]]
            want = [normal(t) for t in want]
            if got != want:
                bad = [k + 1 for k in range(max(len(got), len(want))) if (got[k:k + 1] or [""]) != (want[k:k + 1] or [""])]
                problems.append(f"text differs on page(s) {bad[:10]}")
        ok_all &= not problems
        out.append({"file": d["file"], "ok": not problems, "problems": problems, "kb_per_page": d["kb_per_page"], "images": d["images"], "fonts": d["fonts"]})
    return ok_all, out


def render(paths, out, scale):
    import pypdfium2 as pdfium
    os.makedirs(out, exist_ok=True)
    made = []
    for path in paths:
        doc = pdfium.PdfDocument(path)
        base = os.path.splitext(os.path.basename(path))[0]
        for i in range(len(doc)):
            f = os.path.join(out, f"{base}-{i + 1}.png")
            doc[i].render(scale=scale).to_pil().save(f)
            made.append(f)
        doc.close()
    return made


def cost(paths):
    import pypdfium2 as pdfium
    res = {}
    for f in paths:
        t0 = time.perf_counter()
        doc = pdfium.PdfDocument(f)
        n = len(doc)
        t1 = time.perf_counter()
        per = []
        for i in range(n):
            a = time.perf_counter()
            doc[i].render(scale=1600 / 1200).to_pil()
            per.append((time.perf_counter() - a) * 1000)
        res[os.path.basename(f)] = {"open_ms": round((t1 - t0) * 1000, 1), "render_ms_per_page_median": round(sorted(per)[n // 2], 1), "render_ms_total": round(sum(per))}
    return res


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")          # the Windows console's code page cannot print every text
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("info", "cost", "text"):
        sub.add_parser(name).add_argument("pdf", nargs="+")
    c = sub.add_parser("check")
    c.add_argument("pdf", nargs="+")
    c.add_argument("--max-kb-per-page", type=float)
    c.add_argument("--max-images", type=int)
    c.add_argument("--text", help="JSON: the expected text per page (a list), or a list of such lists, one per PDF")
    r = sub.add_parser("render")
    r.add_argument("pdf", nargs="+")
    r.add_argument("--out", required=True)
    r.add_argument("--scale", type=float, default=4 / 3)
    a = ap.parse_args(argv)
    if a.cmd == "info":
        print(json.dumps([info(p) for p in a.pdf], ensure_ascii=False, indent=1))
    elif a.cmd == "text":
        print(json.dumps(info(a.pdf[0])["text"], ensure_ascii=False, indent=1))
    elif a.cmd == "cost":
        print(json.dumps(cost(a.pdf), indent=1))
    elif a.cmd == "render":
        print(json.dumps(render(a.pdf, a.out, a.scale)))
    else:
        ok, out = check(a.pdf, a.max_kb_per_page, a.max_images, a.text)
        for o in out:
            print(("PASS " if o["ok"] else "FAIL ") + o["file"] + ("" if o["ok"] else ": " + "; ".join(o["problems"])))
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
