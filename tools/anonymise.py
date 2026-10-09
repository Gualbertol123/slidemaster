"""Scramble the numbers of a real workbook (and its saved deck) so it can join the test corpus.
Python 3.8+, standard library only.

    python tools/anonymise.py REAL.xlsx OUT.xlsx [--deck SAVED.json --deck-out OUT.json]
                              [--seed 7] [--rename "VUB=Bank A" --rename "PBZ=Bank B" ...]

What changes
  * every number cell is multiplied by a factor between 0.6 and 1.4 (one per sheet and row, from --seed),
    with the same number of decimals and the same sign; zeros stay zero. Dates and times stay as they are
    (they drive "Week 38" columns and comparisons), and so do formulas (their cached results are scrambled
    like any number);
  * the copies of the numbers Excel keeps elsewhere are scrambled too: pivot caches, chart caches and
    external-link caches;
  * --rename OLD=NEW replaces names everywhere: shared and inline strings, sheet names, cell comments,
    table definitions, drawings, and in the deck every string and key (sheet references included);
  * author, company and last-modified-by are removed from the document properties.
What stays: labels such as Budget, Week, Δ, Abs., % (comment analysis reads them), formats, colours, layout.
In the saved deck (--deck) every digit of a cell text override or note is replaced by another digit.
NOT scrambled: numbers typed as text (text cells, e.g. "12.5%" stored as a string) - review those.
Check the result before committing it: the tool cannot know which other texts are confidential.
"""
import argparse
import io
import json
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape

DATE_IDS = set(range(14, 23)) | {45, 46, 47}
CELL_RE = re.compile(r'<((?:\w+:)?)c\b([^>]*?)(/>|>(.*?)</\1c>)', re.S)
V_RE = re.compile(r"<((?:\w+:)?)v>([^<]*)</\1v>")
CACHE_PART = re.compile(r"xl/(pivotCache/pivotCache(Records|Definition)\d*\.xml|charts/chart\d+\.xml|externalLinks/externalLink\d+\.xml)$")
TEXT_PART = re.compile(r"xl/(sharedStrings|workbook)\.xml$|xl/(drawings|comments|threadedComments|tables|persons)/.*\.xml$|xl/comments\d*\.xml$")


def scramble_cache(xml, rng):
    """numbers in a cache part: <c:v>1.5</c:v>, <v>..</v>, <n v="12"/>, minValue/maxValue, one factor per part"""
    f = rng.uniform(0.6, 1.4)
    xml = V_RE.sub(lambda m: "<%sv>%s</%sv>" % (m.group(1), scramble_number(m.group(2), f), m.group(1)), xml)
    return re.sub(r'(<n\b[^>]*\bv=|\b(?:minValue|maxValue)=)"([^"]*)"', lambda m: '%s"%s"' % (m.group(1), scramble_number(m.group(2), f)), xml)


def is_date_format(code):
    code = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]', "", code or "")
    return bool(re.search(r"[dmyhs]", code, re.I)) and not re.fullmatch(r"\s*general\s*", code, re.I)


def date_styles(styles_xml):
    """indexes of cellXfs whose number format shows a date or time"""
    custom = {int(m.group(1)): m.group(2) for m in re.finditer(r'<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"', styles_xml)}
    xfs = re.search(r"<cellXfs\b[^>]*>(.*?)</cellXfs>", styles_xml, re.S)
    out = set()
    for i, m in enumerate(re.finditer(r"<xf\b([^>]*)", xfs.group(1) if xfs else "")):
        fid = re.search(r'numFmtId="(\d+)"', m.group(1))
        fid = int(fid.group(1)) if fid else 0
        if fid in DATE_IDS or (fid in custom and is_date_format(custom[fid].replace("&quot;", '"'))):
            out.add(i)
    return out


def scramble_number(text, factor):
    try:
        v = float(text)
    except ValueError:
        return text
    if v == 0:
        return text
    dec = len(text.split("e")[0].split("E")[0].split(".")[1]) if "." in text and "e" not in text.lower() else 0
    new = v * factor
    if dec == 0 and "e" not in text.lower():
        r = int(round(new))
        return str(r if r != 0 else (1 if v > 0 else -1))
    out = repr(round(new, dec)) if dec else repr(new)
    return out


def scramble_sheet(xml, dates, rng_for_row):
    def cell(m):
        prefix, attrs, body = m.group(1), m.group(2), m.group(4)
        if body is None or not V_RE.search(body):
            return m.group(0)
        t = re.search(r'\bt="([^"]+)"', attrs)
        if t and t.group(1) != "n":
            return m.group(0)
        s = re.search(r'\bs="(\d+)"', attrs)
        if s and int(s.group(1)) in dates:
            return m.group(0)
        ref = re.search(r'\br="([A-Z]+)(\d+)"', attrs)
        factor = rng_for_row(int(ref.group(2)) if ref else 0)
        return "<%sc%s>%s</%sc>" % (prefix, attrs, V_RE.sub(lambda v: "<%sv>%s</%sv>" % (v.group(1), scramble_number(v.group(2), factor), v.group(1)), body), prefix)
    return CELL_RE.sub(cell, xml)


def rename_text(s, renames):
    for old, new in renames:
        s = s.replace(old, new)
    return s


def anonymise_workbook(data, seed=7, renames=()):
    src = zipfile.ZipFile(io.BytesIO(data))
    names = src.namelist()
    styles = src.read("xl/styles.xml").decode("utf-8") if "xl/styles.xml" in names else ""
    dates = date_styles(styles)
    xml_renames = [(escape(o), escape(n)) for o, n in renames]
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for info in src.infolist():
            b = src.read(info.filename)
            n = info.filename
            if re.match(r"xl/worksheets/sheet\d+\.xml$", n):
                factors = {}

                def per_row(row, sheet=n):
                    if row not in factors:
                        factors[row] = random.Random("%s|%s|%d" % (seed, sheet, row)).uniform(0.6, 1.4)
                    return factors[row]
                b = rename_text(scramble_sheet(b.decode("utf-8"), dates, per_row), xml_renames).encode("utf-8")
            elif CACHE_PART.match(n):
                b = rename_text(scramble_cache(b.decode("utf-8"), random.Random("%s|%s" % (seed, n))), xml_renames).encode("utf-8")
            elif TEXT_PART.search(n):
                b = rename_text(b.decode("utf-8"), xml_renames).encode("utf-8")
            elif n == "docProps/core.xml":
                b = re.sub(rb"<(dc:creator|cp:lastModifiedBy)>[^<]*</\1>", rb"<\1></\1>", b)
            elif n == "docProps/app.xml":
                b = re.sub(rb"<(Company|Manager)>[^<]*</\1>", rb"<\1></\1>", b)
            z.writestr(info, b)
    return out.getvalue()


def anonymise_deck(doc, seed=7, renames=()):
    """names renamed in every string and key (sheets, references like "Sheet!H10", exclusions, titles ...);
    digits of texts typed by people (cell overrides, text boxes, notes) replaced by other digits"""
    rng = random.Random("deck|%s" % seed)

    def digits(s):
        return re.sub(r"\d", lambda m: str(rng.randint(0, 9)), s)

    def walk(x, key=None):
        if isinstance(x, dict):
            return {rename_text(k, renames): walk(v, k) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v, key) for v in x]
        if isinstance(x, str):
            x = rename_text(x, renames)
            return digits(x) if key in ("text", "orig") else x
        return x
    out = walk(doc)
    if isinstance(out, dict) and "updatedBy" in out:
        out["updatedBy"] = "someone"
    if isinstance(out, dict) and isinstance(out.get("log"), list):
        out["log"] = [dict(e, by="someone") if isinstance(e, dict) else e for e in out["log"]]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Scramble the numbers of a workbook (and its saved deck) for the test corpus.")
    ap.add_argument("workbook")
    ap.add_argument("out")
    ap.add_argument("--deck", help="the saved deck document (backend/data/workbooks/<name>-<hash>.json)")
    ap.add_argument("--deck-out", help="where to write the anonymised deck")
    ap.add_argument("--seed", default="7")
    ap.add_argument("--rename", action="append", default=[], metavar="OLD=NEW")
    a = ap.parse_args(argv)
    renames = []
    for r in a.rename:
        if "=" not in r:
            ap.error("--rename needs OLD=NEW: %r" % r)
        renames.append(tuple(r.split("=", 1)))
    with open(a.workbook, "rb") as f:
        data = f.read()
    with open(a.out, "wb") as f:
        f.write(anonymise_workbook(data, a.seed, renames))
    print("written %s" % a.out)
    if a.deck:
        with open(a.deck, encoding="utf-8-sig") as f:
            doc = json.load(f)
        out = a.deck_out or re.sub(r"\.json$", "", a.deck) + ".anon.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(anonymise_deck(doc, a.seed, renames), f, ensure_ascii=False, indent=1)
        print("written %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
