"""Workbooks of the parity corpus (tests/corpus/workbooks/). Dev machines only: needs openpyxl and Pillow.

    python tools/make_corpus.py                    the committed workbooks (fixtures, deck20, edge cases)
    python tools/make_corpus.py big30 [OUTDIR]     the 30 MB workbook (not committed: generate it when needed)

    report/plain/big/weekly.xlsx  copies of the e2e fixtures (frontend/tests/fixtures, make_fixtures.py)
    deck20.xlsx       20 sheets SLIDE_01..SLIDE_20, two weekly-report tables each ("x" markers, merged blue
                      headers, delta groups, +/- formats, CF green/red, a superscript) -> 20 slides x 2 tables
    big30.xlsx        3 data sheets of 130k rows x 12 columns (~30 MB): opening/parsing a large workbook
    edge-formats.xlsx number formats (locale tags, currencies, fractions, scientific, dates, text), rich text
                      with superscripts, merges, hidden rows and columns, cell colours, borders, wrapping,
                      indents, colour scales and rule-based CF
    edge-1904.xlsx    the 1904 date system
    edge-pictures.xlsx pictures (plain, cropped, rotated and flipped, SVG with PNG fallback), shapes (rectangle,
                      rounded, ellipse, a line), text boxes with runs and alignment, a group
    edge-macro.xlsm   a macro-enabled workbook (content type only; no macros)
    ../assets/logo.png the logo the saved decks use

Every file is generated deterministically (fixed timestamps), so a re-run gives the same bytes.
"""
import datetime
import io
import os
import re
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "tests", "corpus", "workbooks")
FIXTURES = os.path.join(REPO, "frontend", "tests", "fixtures")
FIXED = datetime.datetime(2026, 1, 1, 0, 0, 0)

from openpyxl import Workbook  # noqa: E402  (dev-only dependency, after the docstring)
from openpyxl.cell.rich_text import CellRichText, TextBlock  # noqa: E402
from openpyxl.cell.text import InlineFont  # noqa: E402
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, FormulaRule  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: E402
from openpyxl.utils.datetime import CALENDAR_MAC_1904  # noqa: E402

thin = Side(style="thin", color="000000")
box = Border(left=thin, right=thin, top=thin, bottom=thin)
blue = PatternFill("solid", fgColor="1F4E79")
wf = Font(bold=True, color="FFFFFF", italic=True)
banks = ["VUB", "PBZ", "BIB", "Alex", "CIB", "ISP SLO", "ISP RO", "ISP ALB", "ISP BiH", "EximBank", "Pravex"]
groups = ["Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. EoM Aug 2026", "Δ vs. Q2", "Δ vs. BoY"]


def save(wb, name, out):
    """save with fixed document times, then rewrite the ZIP with fixed entry times (same bytes every run)"""
    wb.properties.created = wb.properties.modified = FIXED
    wb.properties.creator = "Slide Builder corpus"
    wb.properties.lastModifiedBy = None
    bio = io.BytesIO()
    wb.save(bio)
    write_fixed(bio.getvalue(), os.path.join(out, name))


def write_fixed(data, path, extra=None, edit=None):
    """copy a ZIP with fixed timestamps; `extra` {name: bytes} adds entries, `edit(name, bytes)` changes one"""
    src = zipfile.ZipFile(io.BytesIO(data))
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in src.namelist():
            b = src.read(n)
            if n == "docProps/core.xml":          # openpyxl stamps "now" as the modified time
                b = re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*", rb"\g<1>2026-01-01T00:00:00Z", b)
            if edit:
                b = edit(n, b)
            z.writestr(zipfile.ZipInfo(n, FIXED.timetuple()[:6]), b, zipfile.ZIP_DEFLATED)
        for n, b in sorted((extra or {}).items()):
            z.writestr(zipfile.ZipInfo(n, FIXED.timetuple()[:6]), b, zipfile.ZIP_DEFLATED)
    os.replace(tmp, path)


# --------------------------------------------------------------------------- deck20 / big30 (from spikes/baseline)
def table(ws, top, name, seed):
    ws.cell(row=top, column=2, value="x")
    ws.cell(row=top + 17, column=18, value="x")
    r1, r2 = top + 1, top + 2
    for i, (h, d) in enumerate([("Week37", "11/09/26"), ("Week38", "18/09/26"), ("Week39", "25/09/26")]):
        for r, v in ((r1, h), (r2, d)):
            c = ws.cell(row=r, column=4 + i, value=v)
            c.fill, c.font, c.alignment = blue, wf, Alignment(horizontal="center")
    ws.merge_cells(start_row=r1, start_column=7, end_row=r2, end_column=7)
    c = ws.cell(row=r1, column=7, value="Eom Budget")
    c.fill, c.font = blue, wf
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for g, gname in enumerate(groups):
        col = 8 + 2 * g
        ws.merge_cells(start_row=r1, start_column=col, end_row=r1, end_column=col + 1)
        c = ws.cell(row=r1, column=col, value=gname)
        c.fill, c.font, c.alignment = blue, wf, Alignment(horizontal="center")
        for k, sub in enumerate(["Abs.", "%"]):
            c = ws.cell(row=r2, column=col + k, value=sub)
            c.fill, c.font, c.alignment = blue, wf, Alignment(horizontal="center")
    rows = []
    for k, b in enumerate(banks):
        base = 1000 * (k + 2) + seed * 37
        wk = [base - 30 * ((k * 7 + seed) % 5), base - 12 * ((k * 3 + seed) % 4), base]
        budget = None if b in ("EximBank", "Pravex") else base - ((k * 53 + seed * 11) % 190) + 80
        ref = [budget, wk[1], base - 140 + (k * 29 + seed) % 260, base - 220 + (k * 41) % 400, base - 600 + (k * 61) % 900]
        rows.append([b] + wk + [budget] + [x for v in ref for x in ((None, None) if v is None else (base - v, (base - v) / v))])
    tot = [name] + [sum(r[i] for r in rows if r[i] is not None) for i in range(1, 5)]
    for g in range(5):
        refsum = sum(r[3] - r[5 + 2 * g] for r in rows if r[5 + 2 * g] is not None)
        ab = sum(r[5 + 2 * g] for r in rows if r[5 + 2 * g] is not None)
        tot += [ab, ab / refsum]
    for k, vals in enumerate([tot] + rows):
        r = top + 4 + k + (1 if k else 0)
        for i, v in enumerate(vals):
            c = ws.cell(row=r, column=3 + i, value=v)
            if i == 0:
                c.font = Font(bold=k == 0)
            elif i >= 5:
                c.number_format = "+#,##0;-#,##0;0" if i % 2 == 1 else "+0.0%;-0.0%;0.0%"
            else:
                c.number_format = "#,##0"
            if k == 0:
                c.font = Font(bold=True)
    g, rd = PatternFill("solid", fgColor="00B050"), PatternFill("solid", fgColor="FF0000")
    rng = "H%d:Q%d" % (top + 4, top + 16)
    ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0"], fill=g, font=Font(color="FFFFFF")))
    ws.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["0"], fill=rd, font=Font(color="FFFFFF")))
    for col in range(3, 18):
        ws.cell(row=top + 4, column=col).border = Border(top=thin, bottom=thin, left=thin if col == 3 else None, right=thin if col == 17 else None)


def slide_sheet(ws, n):
    ws["A1"] = "Total Banks Loans & Deposits %d" % n
    ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = "(mln Euro at last fixed exchange rate)"
    table(ws, 4, "TOTAL BANKS LOANS", n)
    ws.cell(row=8, column=3).value = CellRichText("TOTAL BANKS LOANS ", TextBlock(InlineFont(b=True, vertAlign="superscript"), "(1)"))
    table(ws, 24, "TOTAL BANKS DEPOSITS", n + 1)
    for col, w in zip("ABC", [2, 3, 22]):
        ws.column_dimensions[col].width = w


def deck20(out):
    wb = Workbook()
    ws = wb.active
    ws.title = "SLIDE_01"
    slide_sheet(ws, 1)
    for n in range(2, 21):
        slide_sheet(wb.create_sheet("SLIDE_%02d" % n), n)
    save(wb, "deck20.xlsx", out)


def big30(out, rows=130000, sheets=3):
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("DATA_HEADER")
    ws.append(["note"])
    ws.append(["the slide sheet is generated separately with openpyxl normal mode"])
    for s in range(sheets):
        ws = wb.create_sheet("DATA_%d" % (s + 1))
        ws.append(["Date", "Branch", "Product", "Client", "Segment", "Stock", "Flow", "Rate", "Budget", "Delta", "Pct", "Note"])
        for r in range(rows):
            ws.append(["2026-%02d-%02d" % (1 + r % 12, 1 + r % 28), "BR%04d" % (r % 977), ["Loans", "Deposits", "AuM", "Cards"][r % 4],
                       "C%07d" % (r * 7919 % 9999991), ["Retail", "SME", "Corp", "PB"][r % 4], r * 1.37 % 100000, (r * 31 % 2000) - 1000,
                       (r % 500) / 10000, r * 1.21 % 100000, (r * 17 % 3000) - 1500, ((r * 13) % 200 - 100) / 1000, "row %d" % r])
    wb.save(os.path.join(out, "big30.xlsx"))


# --------------------------------------------------------------------------- edge cases
FORMATS = [
    ("Integer, thousands", 1234567.891, "#,##0"),
    ("Two decimals", -9876.5, "#,##0.00"),
    ("Signed", 42.25, "+#,##0.0;-#,##0.0;0.0"),
    ("Percent", 0.12345, "0.0%"),
    ("Signed percent", -0.0321, "+0.0%;-0.0%;0.0%"),
    ("Euro, Italian", 1234.5, "#,##0.00 [$€-410]"),
    ("Locale tag only", 98765.4321, "[$-it-IT]#,##0.00"),
    ("Pound prefix", 2500, "[$£-809]#,##0"),
    ("Red negatives", -1500, '"€"#,##0;[Red]-"€"#,##0'),
    ("Accounting", 1234.5, '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-'),
    ("Millions", 123456789, '#,##0.0,," m"'),
    ("Scientific", 0.000123456, "0.00E+00"),
    ("Fraction", 3.375, "# ?/?"),
    ("Date dd/mm/yyyy", datetime.date(2026, 9, 25), "dd/mm/yyyy"),
    ("Date mmm yy", datetime.date(2026, 3, 1), "mmm yy"),
    ("Date and time", datetime.datetime(2026, 9, 25, 14, 30), "dd/mm/yyyy hh:mm"),
    ("Text format", "00123", "@"),
    ("Zero shown as dash", 0, '#,##0;-#,##0;"-"'),
    ("Basis points", 0.0125, '0" bp"'),
    ("General", 1 / 3, "General"),
]


def edge_formats(out):
    wb = Workbook()
    ws = wb.active
    ws.title = "FORMATS"
    ws["A1"] = "Number formats, locale tags and rich text"
    ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = "(every row one format)"
    ws["B3"] = "x"
    ws.cell(row=5 + len(FORMATS) + 2, column=7, value="x")
    for i, h in enumerate(["Format", "Value", "Same, bold", "Note"]):
        c = ws.cell(row=4, column=3 + i, value=h)
        c.fill, c.font, c.border = blue, wf, box
    for k, (label, v, fmt) in enumerate(FORMATS):
        r = 5 + k
        ws.cell(row=r, column=3, value=label).border = box
        for col, bold in ((4, False), (5, True)):
            c = ws.cell(row=r, column=col, value=v)
            c.number_format, c.border = fmt, box
            c.font = Font(bold=bold)
        ws.cell(row=r, column=6, value=fmt).border = box
    r = 5 + len(FORMATS)
    ws.cell(row=r, column=3).value = CellRichText("Superscript ", TextBlock(InlineFont(vertAlign="superscript", b=True), "(1)"),
                                                  " and subscript ", TextBlock(InlineFont(vertAlign="subscript"), "2"))
    ws.cell(row=r, column=4).value = CellRichText(TextBlock(InlineFont(color="FF0000"), "red "), TextBlock(InlineFont(i=True), "italic"))
    ws.column_dimensions["C"].width = 26
    ws.column_dimensions["F"].width = 34
    for col in "DE":
        ws.column_dimensions[col].width = 18

    ws2 = wb.create_sheet("LAYOUT")
    ws2["A1"] = "Merges, hidden rows and columns, colours, wrapping"
    ws2["A1"].font = Font(bold=True, size=16)
    ws2["B3"] = "x"
    ws2["L18"] = "x"
    ws2.merge_cells("C4:K4")
    ws2["C4"] = "A merged title across the whole table"
    ws2["C4"].fill, ws2["C4"].font = blue, wf
    ws2["C4"].alignment = Alignment(horizontal="center")
    ws2.merge_cells("C5:C7")
    ws2["C5"] = "Merged vertically, wrapped text that needs more than one line"
    ws2["C5"].alignment = Alignment(wrap_text=True, vertical="center")
    for j, h in enumerate(["North", "South", "East", "West", "Centre", "Islands", "Abroad", "Total"]):
        c = ws2.cell(row=5, column=4 + j, value=h)
        c.font, c.fill = Font(bold=True), PatternFill("solid", fgColor="D9D9D9")
        c.alignment = Alignment(horizontal="center")
    for i in range(10):
        r = 6 + i
        ws2.cell(row=r, column=3 if i > 1 else 4, value=None)
        if i > 1:
            ws2.cell(row=r, column=3, value="Line %d" % (i + 1)).alignment = Alignment(indent=i % 3)
        for j in range(8):
            v = ((i * 37 + j * 11) % 23 - 11) * 1.5 if j < 7 else None
            c = ws2.cell(row=r, column=4 + j, value=v if v is not None else "=SUM(D%d:J%d)" % (r, r))
            c.number_format = "#,##0.0;[Red]-#,##0.0"
            c.border = box
            if (i + j) % 7 == 0:
                c.fill = PatternFill("solid", fgColor="FFF2CC")
            if j == 2:
                c.font = Font(color="0070C0", underline="single")
            if j == 3:
                c.alignment = Alignment(horizontal="left")
    ws2.row_dimensions[9].hidden = True
    ws2.column_dimensions["F"].hidden = True
    ws2.row_dimensions[12].height = 32
    ws2.conditional_formatting.add("D6:J15", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="percentile", mid_value=50,
                                                            mid_color="FFEB84", end_type="max", end_color="63BE7B"))
    ws2.conditional_formatting.add("K6:K15", FormulaRule(formula=["$K6<0"], font=Font(color="9C0006", bold=True)))
    ws2.column_dimensions["C"].width = 24
    save(wb, "edge-formats.xlsx", out)


def edge_1904(out):
    wb = Workbook()
    wb.epoch = CALENDAR_MAC_1904
    ws = wb.active
    ws.title = "DATES_1904"
    ws["A1"] = "Dates in the 1904 date system"
    ws["A1"].font = Font(bold=True, size=16)
    ws["B3"] = "x"
    ws["F12"] = "x"
    for i, h in enumerate(["Event", "Date", "Amount"]):
        c = ws.cell(row=4, column=3 + i, value=h)
        c.fill, c.font = blue, wf
    for k in range(6):
        ws.cell(row=5 + k, column=3, value="Event %d" % (k + 1))
        c = ws.cell(row=5 + k, column=4, value=datetime.date(2026, 1 + k, 10 + k))
        c.number_format = "dd mmm yyyy"
        ws.cell(row=5 + k, column=5, value=1000 * (k + 1) - 333).number_format = "#,##0"
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 14
    save(wb, "edge-1904.xlsx", out)


def _png(w, h, rgb, stripes=None):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), rgb)
    d = ImageDraw.Draw(im)
    for i in range(0, w, 12):
        d.rectangle([i, 0, i + 5, h], fill=stripes or (255, 255, 255))
    d.ellipse([w // 4, h // 4, 3 * w // 4, 3 * h // 4], fill=(255, 200, 0))
    bio = io.BytesIO()
    im.save(bio, "PNG", optimize=True)
    return bio.getvalue()


SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">'
       b'<rect width="160" height="90" rx="12" fill="#1F4E79"/><circle cx="45" cy="45" r="28" fill="#FFC000"/>'
       b'<text x="85" y="55" font-family="sans-serif" font-size="22" fill="#fff">SVG</text></svg>')

EMU = 9525          # EMU per pixel


def _anchor(c0, r0, c1, r1, body):
    return ('<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>%d</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>%d</xdr:row>'
            '<xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>%d</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>%d</xdr:row>'
            '<xdr:rowOff>0</xdr:rowOff></xdr:to>%s<xdr:clientData/></xdr:twoCellAnchor>' % (c0, r0, c1, r1, body))


def _pic(i, name, rid, w, h, crop="", rot=0, flip="", svg_rid=None):
    ext = ('<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg='
           '"http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="%s"/></a:ext></a:extLst>' % svg_rid) if svg_rid else ""
    return ('<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="%d" name="%s"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="%s">%s</a:blip>%s'
            '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm%s%s><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>'
            % (i, name, rid, ext, crop, (' rot="%d"' % rot) if rot else "", flip, w * EMU, h * EMU))


def _shape(i, name, prst, fill, w, h, text=None, line="000000", algn="l", anchor="t"):
    tx = ""
    if text:
        runs = "".join('<a:r><a:rPr lang="en-GB" sz="%d" b="%d" i="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r>'
                       % (sz, b, it, col, t) for t, sz, b, it, col in text)
        tx = ('<xdr:txBody><a:bodyPr anchor="%s"/><a:lstStyle/><a:p><a:pPr algn="%s"/>%s</a:p></xdr:txBody>' % (anchor, algn, runs))
    fill_xml = '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % fill if fill else "<a:noFill/>"
    ln = '<a:ln w="19050"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:ln>' % line if line else "<a:ln><a:noFill/></a:ln>"
    return ('<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="%d" name="%s"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/>'
            '<a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="%s"><a:avLst/></a:prstGeom>%s%s</xdr:spPr>%s</xdr:sp>'
            % (i, name, w * EMU, h * EMU, prst, fill_xml, ln, tx))


def edge_pictures(out):
    wb = Workbook()
    ws = wb.active
    ws.title = "PICTURES"
    ws["A1"] = "Pictures, shapes and text boxes"
    ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = "(drawn over the table area)"
    ws["B3"] = "x"
    ws["M24"] = "x"
    for i, h in enumerate(["Item", "Value", "", "", "", "", "", "", "", ""]):
        c = ws.cell(row=4, column=3 + i, value=h or None)
        c.fill, c.font = blue, wf
    for k in range(18):
        ws.cell(row=5 + k, column=3, value="Row %d" % (k + 1))
        ws.cell(row=5 + k, column=4, value=(k * 137) % 1000).number_format = "#,##0"
    ws.column_dimensions["C"].width = 14
    bio = io.BytesIO()
    wb.save(bio)
    base = bio.getvalue()

    pics = [_png(160, 90, (31, 78, 121)), _png(160, 90, (192, 0, 0), (255, 230, 230)), _png(120, 120, (0, 112, 192))]
    objs = [
        _anchor(5, 4, 8, 9, _pic(2, "Plain picture", "rId1", 160, 90)),
        _anchor(8, 4, 11, 9, _pic(3, "Cropped picture", "rId2", 160, 90, crop='<a:srcRect l="10000" t="20000" r="15000" b="5000"/>')),
        _anchor(5, 10, 7, 15, _pic(4, "Rotated picture", "rId3", 120, 120, rot=1800000, flip=' flipH="1"')),
        _anchor(8, 10, 11, 15, _pic(5, "SVG picture", "rId1", 160, 90, svg_rid="rId4")),
        _anchor(5, 16, 7, 19, _shape(6, "Rectangle", "rect", "FFC000", 140, 50)),
        _anchor(7, 16, 9, 19, _shape(7, "Rounded", "roundRect", "70AD47", 140, 50, line=None)),
        _anchor(9, 16, 11, 19, _shape(8, "Ellipse", "ellipse", None, 140, 50, line="C00000")),
        _anchor(5, 19, 11, 22, _shape(9, "Text box", "rect", "FFFFFF", 420, 60,
                                      text=[("Source: ", 1000, 1, 0, "000000"), ("internal data", 1000, 0, 1, "1F4E79"), (", Q3 2026", 900, 0, 0, "7F7F7F")],
                                      algn="ctr", anchor="ctr")),
        _anchor(11, 19, 12, 22, '<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="10" name="Group"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr>'
                '<a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/><a:chOff x="0" y="0"/><a:chExt cx="%d" cy="%d"/></a:xfrm></xdr:grpSpPr>%s</xdr:grpSp>'
                % (60 * EMU, 60 * EMU, 60 * EMU, 60 * EMU, _shape(11, "In group", "ellipse", "7030A0", 60, 60, text=[("G", 1400, 1, 0, "FFFFFF")], algn="ctr", anchor="ctr"))),
    ]
    drawing = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/'
               'spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/'
               'officeDocument/2006/relationships">%s</xdr:wsDr>' % "".join(objs)).encode("utf-8")
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    drels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
             'relationships">%s</Relationships>' % "".join('<Relationship Id="rId%d" Type="%s" Target="../media/%s"/>' % (i + 1, rel, t)
                                                         for i, t in enumerate(["image1.png", "image2.png", "image3.png", "image4.svg"]))).encode()
    srels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
             'relationships"><Relationship Id="rIdD1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" '
             'Target="../drawings/drawing1.xml"/></Relationships>').encode()

    def edit(name, b):
        if name == "[Content_Types].xml":
            s = b.decode()
            s = s.replace("</Types>", '<Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>'
                          '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
            return s.encode()
        if name == "xl/worksheets/sheet1.xml":
            s = b.decode()
            if 'xmlns:r=' not in s.split(">", 2)[1]:
                s = s.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ', 1)
            s = re.sub(r"(</worksheet>)", '<drawing r:id="rIdD1"/>\\1', s)
            return s.encode()
        return b
    extra = {"xl/drawings/drawing1.xml": drawing, "xl/drawings/_rels/drawing1.xml.rels": drels,
             "xl/worksheets/_rels/sheet1.xml.rels": srels, "xl/media/image1.png": pics[0], "xl/media/image2.png": pics[1],
             "xl/media/image3.png": pics[2], "xl/media/image4.svg": SVG}
    write_fixed(base, os.path.join(out, "edge-pictures.xlsx"), extra=extra, edit=edit)


def edge_macro(out):
    wb = Workbook()
    ws = wb.active
    ws.title = "SLIDE"
    ws["A1"] = "A macro-enabled workbook"
    ws["A1"].font = Font(bold=True, size=16)
    ws["B3"] = "x"
    ws["F9"] = "x"
    for i, h in enumerate(["Name", "Q1", "Q2"]):
        c = ws.cell(row=4, column=3 + i, value=h)
        c.fill, c.font = blue, wf
    for k in range(4):
        ws.cell(row=5 + k, column=3, value="Line %d" % (k + 1))
        ws.cell(row=5 + k, column=4, value=100 + k * 7)
        ws.cell(row=5 + k, column=5, value=95 + k * 9)
    bio = io.BytesIO()
    wb.save(bio)

    def edit(name, b):
        if name == "[Content_Types].xml":
            return b.replace(b"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
                             b"application/vnd.ms-excel.sheet.macroEnabled.main+xml")
        return b
    write_fixed(bio.getvalue(), os.path.join(out, "edge-macro.xlsm"), edit=edit)


def logo(out):
    """tests/corpus/assets/logo.png: the logo the decks use (style.logo = "logo.png")"""
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (240, 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, 239, 79], radius=16, fill=(31, 78, 121, 255))
    d.ellipse([16, 16, 64, 64], fill=(255, 192, 0, 255))
    d.rectangle([84, 30, 220, 50], fill=(255, 255, 255, 255))
    assets = os.path.join(os.path.dirname(os.path.abspath(out)), "assets")     # next to workbooks/
    os.makedirs(assets, exist_ok=True)
    im.save(os.path.join(assets, "logo.png"), optimize=True)


def fixtures(out):
    for f in ("report.xlsx", "plain.xlsx", "big.xlsx", "weekly.xlsx"):
        shutil.copyfile(os.path.join(FIXTURES, f), os.path.join(out, f))


ALL = ["fixtures", "deck20", "edge_formats", "edge_1904", "edge_pictures", "edge_macro", "logo"]


def main(argv):
    known = ALL + ["big30"]
    names = [a.replace("-", "_") for a in argv if a.replace("-", "_") in known]
    outs = [a for a in argv if a.replace("-", "_") not in known]
    out = outs[0] if outs else OUT
    os.makedirs(out, exist_ok=True)
    for n in names or ALL:
        globals()[n](out)
        print("ok  %s" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
