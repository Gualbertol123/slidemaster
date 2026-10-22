"""The conditional-format corpus (S16.4, B39; XC-01, XC-02): tests/corpus/workbooks/cf/cf-rules.xlsx.

Written as SpreadsheetML by hand (no library, fixed zip dates: the same bytes every run), so every rule type and the
2010 extension parts are exactly as Excel 16 writes them:
  sheet "CF rules"  – a table (markers B3 / J15) with a 3-colour scale, a 2010 gradient data bar with a border, an icon
                      set, top / bottom and above-average rules (two true rules on one cell: their formats merge), text
                      rules, unique values, a solid data bar with negatives and an automatic axis, a formula rule;
  sheet "Icon sets" – one row per icon set Excel offers (the 17 of 2007 and the 3 of 2010, whose rules live only in the
                      extension list), plus a reversed set and one showing the icons only.
tools/make-cf-corpus.ps1 (Windows, Excel 16) opens it in Excel, saves Excel's own .xlsx and .xlsb of it and records
the colours Excel shows (DisplayFormat) next to it: core/tests/cf-m16.test.ts compares the slides with them.

    python3.12 tools/make_cf_corpus.py
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "tests", "corpus", "workbooks", "cf", "cf-rules.xlsx")
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
NS_X14 = 'xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"'
NS_XM = 'xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def col(c):
    s = ""
    while c > 0:
        c, m = divmod(c - 1, 26)
        s = chr(65 + m) + s
    return s


def cell(r, c, v):
    ref = col(c) + str(r)
    if v is None:
        return ""
    if isinstance(v, str):
        return f'<c r="{ref}" t="inlineStr"><is><t>{esc(v)}</t></is></c>'
    return f'<c r="{ref}"><v>{v}</v></c>'


def sheet_data(rows):
    out = []
    for r in sorted(rows):
        cells = "".join(cell(r, c, v) for c, v in sorted(rows[r].items()))
        out.append(f'<row r="{r}">{cells}</row>')
    return "<sheetData>" + "".join(out) + "</sheetData>"


def put(rows, r, c, v):
    rows.setdefault(r, {})[c] = v


# ---------------------------------------------------------------- sheet 1: every rule type on one table
def sheet1():
    rows = {}
    put(rows, 1, 1, "Conditional formats")
    put(rows, 2, 1, "Every rule type")
    put(rows, 3, 2, "x")
    put(rows, 15, 10, "x")
    for c, h in zip(range(3, 10), ["Item", "Scale", "Bar", "Arrows", "Top / avg", "Status", "Variance"]):
        put(rows, 4, c, h)
    scale = list(range(1, 11))
    bar = [5, 12, 20, 33, 41, 55, 62, 78, 85, 100]
    arrows = [-5, -3, -1, 0, 1, 2, 3, 4, 6, 9]
    top = [12, 45, 7, 88, 23, 61, 5, 99, 34, 50]
    status = ["OK", "KO", "OK", "Late", "OK", "KO", "n/a", "OK", "Late", "OK"]
    var = [-40, -25, -10, 0, 10, 20, 35, 50, 65, 80]
    for k in range(10):
        r = 5 + k
        put(rows, r, 3, f"Row {k + 1}")
        put(rows, r, 4, scale[k])
        put(rows, r, 5, bar[k])
        put(rows, r, 6, arrows[k])
        put(rows, r, 7, top[k])
        put(rows, r, 8, status[k])
        put(rows, r, 9, var[k])
    bar_id, var_id = "{6A1D4C21-0001-4B5E-9A3B-CF0000000001}", "{6A1D4C21-0002-4B5E-9A3B-CF0000000002}"
    cf = (
        '<conditionalFormatting sqref="C5:C14"><cfRule type="expression" dxfId="0" priority="1"><formula>$D5&gt;=8</formula></cfRule></conditionalFormatting>'
        '<conditionalFormatting sqref="D5:D14"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>'
        '<color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>'
        f'<conditionalFormatting sqref="E5:E14"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>'
        f'<extLst><ext uri="{{B025F937-C7B1-47D3-B67F-A62EFF666E3E}}" {NS_X14}><x14:id>{bar_id}</x14:id></ext></extLst></cfRule></conditionalFormatting>'
        '<conditionalFormatting sqref="F5:F14"><cfRule type="iconSet" priority="4"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule></conditionalFormatting>'
        '<conditionalFormatting sqref="G5:G14"><cfRule type="top10" dxfId="1" priority="5" rank="3"/><cfRule type="aboveAverage" dxfId="2" priority="6" aboveAverage="0"/></conditionalFormatting>'
        '<conditionalFormatting sqref="H5:H14"><cfRule type="containsText" dxfId="3" priority="7" operator="containsText" text="KO"><formula>NOT(ISERROR(SEARCH("KO",H5)))</formula></cfRule>'
        '<cfRule type="beginsWith" dxfId="4" priority="8" operator="beginsWith" text="La"><formula>LEFT(H5,LEN("La"))="La"</formula></cfRule>'
        '<cfRule type="uniqueValues" dxfId="5" priority="9"/></conditionalFormatting>'
        f'<conditionalFormatting sqref="I5:I14"><cfRule type="dataBar" priority="10"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF5B9BD5"/></dataBar>'
        f'<extLst><ext uri="{{B025F937-C7B1-47D3-B67F-A62EFF666E3E}}" {NS_X14}><x14:id>{var_id}</x14:id></ext></extLst></cfRule></conditionalFormatting>'
    )
    ext = (
        f'<extLst><ext uri="{{78C0D931-6437-407d-A8EE-F0AAD7539E65}}" {NS_X14}><x14:conditionalFormattings>'
        f'<x14:conditionalFormatting {NS_XM}><x14:cfRule type="dataBar" id="{bar_id}"><x14:dataBar minLength="0" maxLength="100" border="1" negativeBarBorderColorSameAsPositive="0">'
        '<x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:borderColor rgb="FF638EC6"/><x14:negativeFillColor rgb="FFFF0000"/><x14:negativeBorderColor rgb="FFFF0000"/><x14:axisColor rgb="FF000000"/>'
        '</x14:dataBar></x14:cfRule><xm:sqref>E5:E14</xm:sqref></x14:conditionalFormatting>'
        f'<x14:conditionalFormatting {NS_XM}><x14:cfRule type="dataBar" id="{var_id}"><x14:dataBar minLength="0" maxLength="100" gradient="0" axisPosition="automatic">'
        '<x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:negativeFillColor rgb="FFFF0000"/><x14:axisColor rgb="FF000000"/>'
        '</x14:dataBar></x14:cfRule><xm:sqref>I5:I14</xm:sqref></x14:conditionalFormatting>'
        '</x14:conditionalFormattings></ext></extLst>'
    )
    cols = '<cols><col min="1" max="2" width="3" customWidth="1"/><col min="3" max="9" width="12" customWidth="1"/><col min="10" max="10" width="3" customWidth="1"/></cols>'
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet {NS}><sheetFormatPr defaultRowHeight="15"/>{cols}{sheet_data(rows)}{cf}{ext}</worksheet>'


# ---------------------------------------------------------------- sheet 2: every icon set
SETS = [("3Arrows", 3), ("3ArrowsGray", 3), ("3Flags", 3), ("3TrafficLights1", 3), ("3TrafficLights2", 3), ("3Signs", 3),
        ("3Symbols", 3), ("3Symbols2", 3), ("4Arrows", 4), ("4ArrowsGray", 4), ("4RedToBlack", 4), ("4Rating", 4),
        ("4TrafficLights", 4), ("5Arrows", 5), ("5ArrowsGray", 5), ("5Rating", 5), ("5Quarters", 5)]
SETS14 = [("3Stars", 3), ("3Triangles", 3), ("5Boxes", 5)]


def sheet2():
    rows = {}
    put(rows, 1, 1, "Icon sets")
    put(rows, 2, 1, "Excel's sets in each design")
    put(rows, 3, 2, "x")
    put(rows, 4, 3, "Set")
    for k in range(5):
        put(rows, 4, 4 + k, f"Icon {k + 1}")
    allsets = SETS + SETS14 + [("3TrafficLights1 reversed", 3), ("3Symbols icons only", 3)]
    last = 5 + len(allsets)
    put(rows, last, 9, "x")
    cf, ext, pri = [], [], 1
    for k, (name, n) in enumerate(allsets):
        r = 5 + k
        put(rows, r, 3, name)
        for j in range(n):
            put(rows, r, 4 + j, j + 1)
        ref = f"D{r}:{col(3 + n)}{r}"
        thr = "".join(f'<cfvo type="percent" val="{round(100 * j / n)}"/>' for j in range(n))
        if (name, n) in SETS14:
            thr14 = "".join(f'<x14:cfvo type="percent"><xm:f>{round(100 * j / n)}</xm:f></x14:cfvo>' for j in range(n))
            ext.append(f'<x14:conditionalFormatting {NS_XM}><x14:cfRule type="iconSet" priority="{pri}" id="{{6A1D4C21-1{k:03d}-4B5E-9A3B-CF0000000000}}">'
                       f'<x14:iconSet iconSet="{name}">{thr14}</x14:iconSet></x14:cfRule><xm:sqref>{ref}</xm:sqref></x14:conditionalFormatting>')
        else:
            setname = name.split(" ")[0]
            extra = ' reverse="1"' if "reversed" in name else ' showValue="0"' if "only" in name else ""
            cf.append(f'<conditionalFormatting sqref="{ref}"><cfRule type="iconSet" priority="{pri}"><iconSet iconSet="{setname}"{extra}>{thr}</iconSet></cfRule></conditionalFormatting>')
        pri += 1
    extlst = f'<extLst><ext uri="{{78C0D931-6437-407d-A8EE-F0AAD7539E65}}" {NS_X14}><x14:conditionalFormattings>{"".join(ext)}</x14:conditionalFormattings></ext></extLst>'
    cols = '<cols><col min="1" max="2" width="3" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="8" width="9" customWidth="1"/><col min="9" max="9" width="3" customWidth="1"/></cols>'
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet {NS}><sheetFormatPr defaultRowHeight="15"/>{cols}{sheet_data(rows)}{"".join(cf)}{extlst}</worksheet>'


STYLES = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet {NS}>'
    '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    '<dxfs count="6">'
    '<dxf><font><b/><color rgb="FF006100"/></font></dxf>'
    '<dxf><font><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>'
    '<dxf><font><i/></font></dxf>'
    '<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>'
    '<dxf><font><color rgb="FF9C5700"/></font><fill><patternFill><bgColor rgb="FFFFEB9C"/></patternFill></fill></dxf>'
    '<dxf><font><u/></font><numFmt numFmtId="164" formatCode="&quot;[&quot;@&quot;]&quot;"/></dxf>'
    '</dxfs></styleSheet>'
)
THEME = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office">'
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>'
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>'
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>'
    '</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
    '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>'
    '</a:themeElements></a:theme>'
)


def main():
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook {NS}><sheets><sheet name="CF rules" sheetId="1" r:id="rId1"/><sheet name="Icon sets" sheetId="2" r:id="rId2"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{REL}/worksheet" Target="worksheets/sheet2.xml"/>'
        f'<Relationship Id="rId3" Type="{REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId4" Type="{REL}/styles" Target="styles.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet1(),
        "xl/worksheets/sheet2.xml": sheet2(),
        "xl/theme/theme1.xml": THEME,
        "xl/styles.xml": STYLES,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 21, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, body.encode("utf-8"))
    print(OUT)


if __name__ == "__main__":
    main()
