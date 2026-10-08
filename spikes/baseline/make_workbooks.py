"""Spike workbooks (needs openpyxl): python3 make_workbooks.py OUTDIR
deck20.xlsx  - 20 sheets "SLIDE_01".."SLIDE_20", each with two weekly-report tables ("x" markers,
               merged blue headers, Δ groups, +/- formats, CF green/red, superscript) -> 20 slides x 2 tables
big30.xlsx   - SLIDE_1 with one report table + 3 data sheets of 250k rows x 12 columns (~30 MB),
               the shape of a large weekly workbook with raw data sheets next to the slide sheets
"""
import os, sys, importlib.util
from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
thin = Side(style="thin", color="000000")
blue = PatternFill("solid", fgColor="1F4E79"); wf = Font(bold=True, color="FFFFFF", italic=True)
banks = ["VUB", "PBZ", "BIB", "Alex", "CIB", "ISP SLO", "ISP RO", "ISP ALB", "ISP BiH", "EximBank", "Pravex"]
groups = ["Δ vs. Budget", "Δ vs. Prev. Week", "Δ vs. EoM Aug 2026", "Δ vs. Q2", "Δ vs. BoY"]

def table(ws, top, name, seed):
    ws.cell(row=top, column=2, value="x"); ws.cell(row=top + 17, column=18, value="x")
    r1, r2 = top + 1, top + 2
    for i, (h, d) in enumerate([("Week37", "11/09/26"), ("Week38", "18/09/26"), ("Week39", "25/09/26")]):
        for r, v in ((r1, h), (r2, d)):
            c = ws.cell(row=r, column=4 + i, value=v); c.fill = blue; c.font = wf; c.alignment = Alignment(horizontal="center")
    ws.merge_cells(start_row=r1, start_column=7, end_row=r2, end_column=7)
    c = ws.cell(row=r1, column=7, value="Eom Budget"); c.fill = blue; c.font = wf
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for g, gname in enumerate(groups):
        col = 8 + 2 * g
        ws.merge_cells(start_row=r1, start_column=col, end_row=r1, end_column=col + 1)
        c = ws.cell(row=r1, column=col, value=gname); c.fill = blue; c.font = wf; c.alignment = Alignment(horizontal="center")
        for k, sub in enumerate(["Abs.", "%"]):
            c = ws.cell(row=r2, column=col + k, value=sub); c.fill = blue; c.font = wf; c.alignment = Alignment(horizontal="center")
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
        ab = sum(r[5 + 2 * g] for r in rows if r[5 + 2 * g] is not None); tot += [ab, ab / refsum]
    for k, vals in enumerate([tot] + rows):
        r = top + 4 + k + (1 if k else 0)
        for i, v in enumerate(vals):
            c = ws.cell(row=r, column=3 + i, value=v)
            if i == 0: c.font = Font(bold=k == 0)
            elif i >= 5: c.number_format = "+#,##0;-#,##0;0" if i % 2 == 1 else "+0.0%;-0.0%;0.0%"
            else: c.number_format = "#,##0"
            if k == 0: c.font = Font(bold=True)
    g, rd = PatternFill("solid", fgColor="00B050"), PatternFill("solid", fgColor="FF0000")
    rng = "H%d:Q%d" % (top + 4, top + 16)
    ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0"], fill=g, font=Font(color="FFFFFF")))
    ws.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["0"], fill=rd, font=Font(color="FFFFFF")))
    for col in range(3, 18):
        ws.cell(row=top + 4, column=col).border = Border(top=thin, bottom=thin, left=thin if col == 3 else None, right=thin if col == 17 else None)

def slide_sheet(ws, n):
    ws["A1"] = "Total Banks Loans & Deposits %d" % n; ws["A1"].font = Font(bold=True, size=16)
    ws["A2"] = "(mln Euro at last fixed exchange rate)"
    table(ws, 4, "TOTAL BANKS LOANS", n)
    ws.cell(row=8, column=3).value = CellRichText("TOTAL BANKS LOANS ", TextBlock(InlineFont(b=True, vertAlign="superscript"), "(1)"))
    table(ws, 24, "TOTAL BANKS DEPOSITS", n + 1)
    for col, w in zip("ABC", [2, 3, 22]): ws.column_dimensions[col].width = w

def deck20():
    wb = Workbook(); ws = wb.active; ws.title = "SLIDE_01"; slide_sheet(ws, 1)
    for n in range(2, 21): slide_sheet(wb.create_sheet("SLIDE_%02d" % n), n)
    wb.save(os.path.join(OUT, "deck20.xlsx"))

def big30(rows=130000, sheets=3):
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("DATA_HEADER")
    ws.append(["note"]); ws.append(["the slide sheet is generated separately with openpyxl normal mode"])
    for s in range(sheets):
        ws = wb.create_sheet("DATA_%d" % (s + 1))
        ws.append(["Date", "Branch", "Product", "Client", "Segment", "Stock", "Flow", "Rate", "Budget", "Delta", "Pct", "Note"])
        for r in range(rows):
            ws.append(["2026-%02d-%02d" % (1 + r % 12, 1 + r % 28), "BR%04d" % (r % 977), ["Loans", "Deposits", "AuM", "Cards"][r % 4],
                       "C%07d" % (r * 7919 % 9999991), ["Retail", "SME", "Corp", "PB"][r % 4], r * 1.37 % 100000, (r * 31 % 2000) - 1000,
                       (r % 500) / 10000, r * 1.21 % 100000, (r * 17 % 3000) - 1500, ((r * 13) % 200 - 100) / 1000, "row %d" % r])
    tmp = os.path.join(OUT, "_big_data.xlsx"); wb.save(tmp)
    # add one normal slide sheet: reopen is too slow for 3M cells, so build the slide sheet in its own
    # workbook and merge parts by zip surgery is overkill - instead keep the data workbook and a slide sheet
    # in one file by writing the slide sheet first in write-only mode as plain values (formatting is not
    # needed to measure parse time; the 20-slide deck measures rendering)
    os.replace(tmp, os.path.join(OUT, "big30.xlsx"))

for name in (sys.argv[2:] or ["deck20", "big30"]):
    globals()[name]()
print("ok")
