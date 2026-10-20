"""Workbooks of the 09 Phase 0 pictures (dev tool, not shipped; run from the repository root):

    python spikes/charts/make_books.py

* spikes/charts/books/loans-weekly.xlsx – the owner's reference chart's numbers (09 §3.3): sheet Weekly (Q3, Week37 …
  Week39 and the loans volume), sheet Targets (Eom Budget, EoM Ambition and their targets), sheet Gallery (the series of
  the chart-type pictures). Plain values, no formulas (openpyxl writes no cached values for formulas).
* spikes/charts/books/report-hidden.xlsx – tests/corpus/workbooks/report.xlsx with rows 10–12 of SLIDE_1 hidden: F11 and
  F14 close rows up through the very path that closes Excel's own hidden rows (buildLayout), so this file shows exactly
  what a slide with those rows hidden will show.
* spikes/charts/books/report-drop.xlsx – the same with rows 10–12 and columns I:J (Since, Note) hidden: a delete-version.
The two report copies are made by editing the sheet XML in the zip (every other byte kept: styles, cached formula values)."""
import os
import re
import zipfile

import openpyxl
from openpyxl.styles import Font

HERE = os.path.dirname(os.path.abspath(__file__))
BOOKS = os.path.join(HERE, "books")
REPORT = os.path.join(HERE, "..", "..", "tests", "corpus", "workbooks", "report.xlsx")
os.makedirs(BOOKS, exist_ok=True)


def loans():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Weekly"
    ws["B2"] = "Loans volume, EUR m"
    for col, (cat, v) in zip("CDEF", [("Q3", 11576), ("Week37", 11258), ("Week38", 11258), ("Week39", 11324)]):
        ws[col + "4"] = cat
        ws[col + "5"] = v
        ws[col + "5"].number_format = "#,##0"
    ws["B5"] = "Loans"
    t = wb.create_sheet("Targets")
    for col, (name, target) in zip("BC", [("Eom Budget", 11624), ("EoM Ambition", 12000)]):
        t[col + "2"] = name
        t[col + "3"] = target
        t[col + "3"].number_format = "#,##0"
    t["A3"] = "Target"
    g = wb.create_sheet("Gallery")
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    rows = {"Retail": [420, 455, 470, 510, 498, 530], "Corporate": [310, 300, 335, 360, 372, 390],
            "SME": [150, 162, 158, 171, 180, 176], "Margin %": [2.1, 2.3, 2.2, 2.6, 2.5, 2.8]}
    for i, m in enumerate(months):
        g.cell(row=1, column=2 + i, value=m)
    for r, (name, vals) in enumerate(rows.items(), start=2):
        g.cell(row=r, column=1, value=name)
        for i, v in enumerate(vals):
            g.cell(row=r, column=2 + i, value=v)
    for c in g[1]:
        c.font = Font(bold=True)
    wb.save(os.path.join(BOOKS, "loans-weekly.xlsx"))


def sheet_part(z):
    """the part of sheet SLIDE_1 (workbook.xml order → rels)"""
    wbx = z.read("xl/workbook.xml").decode("utf8")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf8")
    rid = re.search(r'<sheet [^>]*name="SLIDE_1"[^>]*r:id="([^"]+)"', wbx).group(1)
    target = re.search(r'<Relationship [^>]*Id="%s"[^>]*Target="([^"]+)"' % rid, rels) or re.search(r'<Relationship [^>]*Target="([^"]+)"[^>]*Id="%s"' % rid, rels)
    t = target.group(1).lstrip("/")
    return t if t.startswith("xl/") else "xl/" + t


def hide(dst, rows, cols):
    with zipfile.ZipFile(REPORT) as z:
        part = sheet_part(z)
        xml = z.read(part).decode("utf8")
        for r in rows:
            xml, n = re.subn(r'<row r="%d"' % r, '<row r="%d" hidden="1"' % r, xml, count=1)
            assert n == 1, r
        for c in range(cols[0], cols[1] + 1) if cols else []:
            # report.xlsx defines each of these columns once (<col … min="9" max="9"/>): mark that element hidden
            xml, n = re.subn(r'<col (?![^>]*hidden)([^>]*min="%d" max="%d")' % (c, c), r'<col hidden="1" \1', xml, count=1)
            assert n == 1, c
        with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as out:
            for info in z.infolist():
                data = xml.encode("utf8") if info.filename == part else z.read(info.filename)
                out.writestr(info, data)


loans()
hide(os.path.join(BOOKS, "report-hidden.xlsx"), [10, 11, 12], None)
hide(os.path.join(BOOKS, "report-drop.xlsx"), [10, 11, 12], (9, 10))
print("written:", sorted(os.listdir(BOOKS)))
