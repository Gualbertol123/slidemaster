"""PowerPoint checks for the .pptx export (docs/next/07 §4.3, 05 PX-01…PX-03; S11.1). Dev only, like pdfcheck.py: the
structure check is the standard library; the text, table and chart checks need python-pptx 1.0.2 (MIT); the open
check needs PowerPoint (Windows, COM through PowerShell). The helper stays standard-library only.

    python tools/pptxcheck.py check a.pptx [b.pptx ...] [--slides N] [--no-ppt] [--json out.json] [--sources sources.json] [--expect expect.json]
        (1) structure: the zip opens; [Content_Types].xml types every part; every relationship's target exists and none
            points outside the file (no links); every XML part parses; the slide count (presentation.xml, = N when
            given); the slide size 12 192 000 × 6 858 000 EMU; no empty a:t; no connector shapes (p:cxnSp); every
            slide has a layout, every layout the master; the pictures are PNG or JPEG; and a lint of what PowerPoint
            repairs without saying so in automation (S11 review: an unknown or misplaced child, a duplicate shape id,
            a negative size, a short table row pass Presentations.Open): the schema's child order of sp, pic, spPr, ln,
            effectLst, blipFill, txBody, p, pPr, rPr, tc, tcPr; shape ids, placeholders and relationship ids unique per
            part; value ranges (ext, rot, angles, gradient stops, font sizes, spacing, insets, margins, shadows,
            preset adjustments, custom paths); every table row as many cells as the grid has columns
        (2) content (python-pptx): each slide's texts (text frames, table cells, chart titles), tables (has_table),
            charts (has_chart) with their cached categories and values, pictures
        (3) PowerPoint (unless --no-ppt, or no PowerPoint): Presentations.Open read-only without a window – a file
            it cannot read raises in automation (not every repair does: (1)'s lint covers those) –; the slide count and every shape's text read back and
            compared with (2)
        (4) with --sources ({file: {workbook, charts: [{slide, sheet, range}]}}): each chart's cached values equal the
            workbook's cells (openpyxl, the values Excel saved; text, blank and hidden cells skipped as the chart skips them)
        (5) real objects, gated (S14.P; AUDIT-2 VER-3, PX-02 / PX-03, 09 §7.2): with --expect ({file: [{slide, tables,
            charts}]}, tools/real-objects.mjs: what the core's own export draws) each slide holds exactly those real
            tables (python-pptx has_table) and native charts (has_chart), a slide not listed none;
            where PowerPoint is present, it must open the file (3) and see the same tables (HasTable) and charts
            (HasChart) per slide as python-pptx – a failure, never a count. Each report says `ppt`: opened / failed /
            absent (no PowerPoint here: 1, 2, 4 and python-pptx's part of 5 run) / skipped (--no-ppt). Also in (1): no
            chart formula (c:f) names another file (09 §4.2: no external links)
        (6) icons (4.8, M15 S15.2; 09 §4.3, check_icons): every shape or group named "Icon n" is native custom geometry –
            each of its shapes a:custGeom (never a preset), no picture (p:pic, a:blipFill) –, a shape without fill
            (an outline icon) has a line, and every drawn line of an icon has round caps and joins (a:ln cap="rnd",
            a:round); with --expect, each slide holds exactly the entries' `icons` (tools/real-icons.mjs: the core's
            Tabler icons; a built-in icon or a name the set lacks stays the built-in shape, not named "Icon")
        exit 1 when any check fails; --json writes every file's report (the content of (2) included)
    python tools/pptxcheck.py info a.pptx [...]      the report of (1) and (2) as JSON, nothing checked
"""
import argparse
import json
import os
import posixpath
import re
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}
SLIDE_SIZE = (12192000, 6858000)
RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"


A = "{%s}" % NS["a"]
P = "{%s}" % NS["p"]
# the schema's child order (ECMA-376 part 1) of the elements the writer makes; "r", "br", "fld" are one slot of a:p
ORDER = {
    "spPr": ["xfrm", "custGeom", "prstGeom", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"],
    "rPr": ["ln", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst"],
    "tcPr": ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr", "cell3D", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "headers", "extLst"],
    "pPr": ["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar", "buBlip", "tabLst", "defRPr", "extLst"],
    "effectLst": ["blur", "fillOverlay", "glow", "innerShdw", "outerShdw", "prstShdw", "reflection", "softEdge"],
    "ln": ["noFill", "solidFill", "gradFill", "pattFill", "prstDash", "custDash", "round", "bevel", "miter", "headEnd", "tailEnd", "extLst"],
    "blipFill": ["blip", "srcRect", "tile", "stretch"],
    "sp": ["nvSpPr", "spPr", "style", "txBody", "extLst"],
    "pic": ["nvPicPr", "blipFill", "spPr", "style", "extLst"],
    "tc": ["txBody", "tcPr", "extLst"],
    "txBody": ["bodyPr", "lstStyle", "p"],
    "p": ["pPr", "r", "r", "r", "endParaRPr"],
}
SLOT = {"br": "r", "fld": "r"}
C = "{%s}" % NS["c"]
# the chart part's (c:) child order of the elements the writer makes
C_ORDER = {
    "pieChart": ["varyColors", "ser", "dLbls", "firstSliceAng", "extLst"],
    "doughnutChart": ["varyColors", "ser", "dLbls", "firstSliceAng", "holeSize", "extLst"],
    "ser": ["idx", "order", "tx", "spPr", "explosion", "dPt", "dLbls", "cat", "val", "extLst"],
    "dPt": ["idx", "invertIfNegative", "marker", "bubble3D", "explosion", "spPr", "pictureOptions", "extLst"],
    "dLbls": ["dLbl", "delete", "numFmt", "spPr", "txPr", "dLblPos", "showLegendKey", "showVal", "showCatName", "showSerName", "showPercent", "showBubbleSize", "separator", "showLeaderLines", "leaderLines", "extLst"],
    "dLbl": ["idx", "delete", "layout", "tx", "numFmt", "spPr", "txPr", "dLblPos", "showLegendKey", "showVal", "showCatName", "showSerName", "showPercent", "showBubbleSize", "separator", "extLst"],
    "chart": ["title", "autoTitleDeleted", "pivotFmts", "view3D", "floor", "sideWall", "backWall", "plotArea", "legend", "plotVisOnly", "dispBlanksAs", "extLst"],
    "chartSpace": ["date1904", "lang", "roundedCorners", "AlternateContent", "clrMapOvr", "pivotSource", "protection", "chart", "spPr", "txPr", "externalData", "printSettings", "userShapes", "extLst"],
    "legend": ["legendPos", "legendEntry", "layout", "overlay", "spPr", "txPr", "extLst"],
}
LN_TAGS = ("ln", "lnL", "lnR", "lnT", "lnB")


def _local(tag):
    return tag.split("}")[1] if "}" in tag else tag


def lint(name, root):
    """the problems of one slide, layout or master part that PowerPoint would repair (see the module's doc)"""
    out = []

    def bad(msg):
        if len(out) < 20:
            out.append("%s: %s" % (name, msg))
    ids = [e.get("id") for e in root.iter(P + "cNvPr")]
    if len(ids) != len(set(ids)):
        bad("duplicate shape ids")
    phs = [(e.get("type"), e.get("idx")) for e in root.iter(P + "ph")]
    if len(phs) != len(set(phs)):
        bad("duplicate placeholders")

    def num(e, k):
        try:
            return int(e.get(k))
        except (TypeError, ValueError):
            bad("<%s %s=%r> is not a number" % (_local(e.tag), k, e.get(k)))
            return None
    for e in root.iter():
        t, ns = _local(e.tag), e.tag[:e.tag.index("}") + 1] if "}" in e.tag else ""
        key = "ln" if t in LN_TAGS else t
        if key in ORDER and ns in (A, P) and not (t in ("sp", "pic") and ns != P):
            seq, last = ORDER[key], -1
            for ch in e:
                n = SLOT.get(_local(ch.tag), _local(ch.tag))
                if n not in seq:
                    bad("<%s> in <%s>" % (n, t))
                    continue
                i = seq.index(n)
                if i < last:
                    bad("<%s> after a later child in <%s>" % (n, t))
                last = max(last, i)
        if ns == C and t in C_ORDER:
            seq, last = C_ORDER[t], -1
            for ch in e:
                n = _local(ch.tag)
                if n not in seq:
                    bad("<c:%s> in <c:%s>" % (n, t))
                    continue
                if seq.index(n) < last:
                    bad("<c:%s> after a later child in <c:%s>" % (n, t))
                last = max(last, seq.index(n))
        if ns != A:
            continue
        if t == "off":
            num(e, "x"), num(e, "y")
        elif t == "ext" and e.get("cx") is not None:
            cx, cy = num(e, "cx"), num(e, "cy")
            if cx is not None and cy is not None and (cx < 0 or cy < 0):
                bad("negative size %s × %s" % (cx, cy))
        elif t == "xfrm" and e.get("rot") is not None:
            v = num(e, "rot")
            if v is not None and not 0 <= v < 21600000:
                bad("rotation %s" % v)
        elif t == "lin":
            v = num(e, "ang")
            if v is not None and not 0 <= v < 21600000:
                bad("gradient angle %s" % v)
        elif t == "gs":
            v = num(e, "pos")
            if v is not None and not 0 <= v <= 100000:
                bad("gradient stop at %s" % v)
        elif t == "gsLst" and len(list(e)) < 2:
            bad("a gradient with fewer than two stops")
        elif t == "path" and e.get("w") is not None:
            w, h = num(e, "w"), num(e, "h")
            if w is not None and h is not None and (w <= 0 or h <= 0):
                bad("a custom path of size %s × %s" % (w, h))
        elif t == "gd":
            m = re.match(r"val (-?\d+)$", e.get("fmla") or "")
            if not m:
                bad("adjustment %r" % e.get("fmla"))
            elif e.get("name") == "adj" and not 0 <= int(m.group(1)) <= 50000:
                bad("adj %s" % m.group(1))
        elif t in ("rPr", "endParaRPr", "defRPr") and e.get("sz") is not None:
            v = num(e, "sz")
            if v is not None and not 100 <= v <= 400000:
                bad("font size %s" % v)
        elif t == "spcPts":
            v = num(e, "val")
            if v is not None and not 0 <= v <= 158400:
                bad("spacing %s" % v)
        elif t in ("outerShdw", "innerShdw"):
            vals = [num(e, k) for k in ("blurRad", "dist", "dir")]
            if None not in vals and (vals[0] < 0 or vals[1] < 0 or not 0 <= vals[2] < 21600000):
                bad("shadow %s" % vals)
        elif t == "bodyPr":
            if any(e.get(k) is not None and (num(e, k) or 0) < 0 for k in ("lIns", "tIns", "rIns", "bIns")):
                bad("a negative inset")
        elif t == "tcPr":
            if any(e.get(k) is not None and (num(e, k) or 0) < 0 for k in ("marL", "marR", "marT", "marB")):
                bad("a negative cell margin")
        elif t == "tbl":
            cols = len(list(e.iter(A + "gridCol")))
            for tr in e.findall(A + "tr"):
                if len(tr.findall(A + "tc")) != cols:
                    bad("a table row of %d cells in a grid of %d" % (len(tr.findall(A + "tc")), cols))
                    break
    return out


def _rels_of(part):
    d, f = posixpath.split(part)
    return posixpath.join(d, "_rels", f + ".rels")


def structure(path, slides=None):
    """the structure check (1): a list of problems (empty = passed) and facts"""
    bad, facts = [], {"bytes": os.path.getsize(path)}
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        return ["not a zip: %s" % e], facts
    names = set(z.namelist())
    if "[Content_Types].xml" not in names:
        return ["no [Content_Types].xml"], facts
    ct = ET.fromstring(z.read("[Content_Types].xml"))
    defaults = {d.get("Extension").lower(): d.get("ContentType") for d in ct.findall("ct:Default", NS)}
    overrides = {o.get("PartName").lstrip("/"): o.get("ContentType") for o in ct.findall("ct:Override", NS)}
    for o in overrides:
        if o not in names:
            bad.append("content type for a missing part: " + o)
    xml = {}
    for n in sorted(names):
        if n.endswith("/") or n == "[Content_Types].xml":
            continue
        ext = n.rsplit(".", 1)[-1].lower()
        if n not in overrides and ext not in defaults:
            bad.append("no content type: " + n)
        if ext in ("xml", "rels"):
            try:
                xml[n] = ET.fromstring(z.read(n))
            except ET.ParseError as e:
                bad.append("XML does not parse: %s (%s)" % (n, e))
    # relationships: targets exist, nothing external, ids unique
    for n, root in xml.items():
        if re.match(r"ppt/(slides|slideLayouts|slideMasters|charts)/[^/]+\.xml$", n):
            bad.extend(lint(n, root))
        if not n.endswith(".rels"):
            continue
        rids = [r.get("Id") for r in root.findall("rel:Relationship", NS)]
        if len(rids) != len(set(rids)):
            bad.append("duplicate relationship ids: " + n)
        base = posixpath.dirname(posixpath.dirname(n))
        for r in root.findall("rel:Relationship", NS):
            if r.get("TargetMode") == "External":
                bad.append("a link outside the file: %s → %s" % (n, r.get("Target")))
                continue
            t = posixpath.normpath(posixpath.join(base, r.get("Target"))).lstrip("/")
            if t not in names:
                bad.append("missing target: %s → %s" % (n, r.get("Target")))
    pres = xml.get("ppt/presentation.xml")
    if pres is None:
        return bad + ["no ppt/presentation.xml"], facts
    sz = pres.find("p:sldSz", NS)
    if sz is None or (int(sz.get("cx")), int(sz.get("cy"))) != SLIDE_SIZE:
        bad.append("slide size %s, not 16:9 12192000 × 6858000" % (None if sz is None else (sz.get("cx"), sz.get("cy"))))
    ids = pres.findall("p:sldIdLst/p:sldId", NS)
    facts["slides"] = len(ids)
    if slides is not None and len(ids) != slides:
        bad.append("%d slides, expected %d" % (len(ids), slides))
    prels = {r.get("Id"): r for r in xml.get("ppt/_rels/presentation.xml.rels", ET.Element("x")).findall("rel:Relationship", NS)}
    order = []
    for s in ids:
        r = prels.get(s.get("{%s}id" % NS["r"]))
        if r is None:
            bad.append("a slide id without its relationship")
            continue
        order.append(posixpath.normpath(posixpath.join("ppt", r.get("Target"))))
    facts["masters"] = len([n for n in names if re.match(r"ppt/slideMasters/[^/]+\.xml$", n)])
    facts["layouts"] = len([n for n in names if re.match(r"ppt/slideLayouts/[^/]+\.xml$", n)])
    if facts["masters"] < 1:
        bad.append("no slide master")
    for part in [n for n in names if re.match(r"ppt/slideLayouts/[^/]+\.xml$", n)]:
        rel = xml.get(_rels_of(part))
        if rel is None or not any(r.get("Type") == RT + "slideMaster" for r in rel.findall("rel:Relationship", NS)):
            bad.append("a layout without its master: " + part)
    media = [n for n in names if n.startswith("ppt/media/")]
    for m in media:
        head = z.read(m)[:8]
        if not (head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8")):
            bad.append("a picture that is not PNG or JPEG: " + m)
    facts["media"] = len(media)
    facts["media_bytes"] = sum(z.getinfo(m).file_size for m in media)
    for i, part in enumerate(order):
        root = xml.get(part)
        if root is None:
            bad.append("slide %d: no part %s" % (i + 1, part))
            continue
        rel = xml.get(_rels_of(part))
        if rel is None or not any(r.get("Type") == RT + "slideLayout" for r in rel.findall("rel:Relationship", NS)):
            bad.append("slide %d: no layout" % (i + 1))
        if root.find(".//p:cxnSp", NS) is not None:
            bad.append("slide %d: a connector shape" % (i + 1))
        # (S14.P, 09 §4.2: no external links) a chart's formula never names another file – every c:f points into its own
        # embedded workbook
        for ch in [posixpath.normpath(posixpath.join(posixpath.dirname(part), r.get("Target"))) for r in (rel.findall("rel:Relationship", NS) if rel is not None else [])
                   if r.get("Type") == RT + "chart"]:
            croot = xml.get(ch)
            for f in (croot.iter("{%s}f" % NS["c"]) if croot is not None else []):
                # another workbook is named as [n] / [Book.xlsx] or by a path; Excel forbids [ ] / and the backslash in
                # sheet names, so a sheet called like a file ('Q3.xlsx'!A1) does not trip it (S14.P review, 10)
                if re.search(r"[\[\]\\/]", f.text or ""):
                    bad.append("slide %d: a chart formula names a file: %s" % (i + 1, f.text))
                    break
        for t in root.iter("{%s}t" % NS["a"]):
            if not (t.text or ""):
                bad.append("slide %d: an empty a:t" % (i + 1))
                break
    facts["parts"] = len(names)
    return bad, facts


def _shape_texts(shape, out, info):
    """texts of a shape (groups walked), tables' cells and charts' titles; counts of tables, charts, pictures"""
    if shape.shape_type == 6 or getattr(shape, "shapes", None) is not None and shape.__class__.__name__ == "GroupShape":
        for s in shape.shapes:
            _shape_texts(s, out, info)
        return
    if getattr(shape, "has_table", False) and shape.has_table:
        info["tables"] += 1
        cells = []
        for row in shape.table.rows:
            for cell in row.cells:
                if cell.is_spanned:
                    continue
                t = cell.text_frame.text
                cells.append(t)
                if t.strip():
                    out.append(t)
        info["cells"].append(cells)
        return
    if getattr(shape, "has_chart", False) and shape.has_chart:
        ch = shape.chart
        plot = ch.plots[0]
        info["charts"].append({"type": str(ch.chart_type), "title": ch.chart_title.text_frame.text if ch.has_title else "",
                               "categories": [str(c) for c in plot.categories], "values": list(plot.series[0].values)})
        return
    if shape.shape_type == 13:
        info["pictures"] += 1
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame and shape.text_frame.text.strip():
        out.append(shape.text_frame.text)
    if getattr(shape, "is_placeholder", False) and shape.is_placeholder:
        info["placeholders"].append(str(shape.placeholder_format.type).split(".")[-1].split(" ")[0])


def content(path):
    """the content (2): per slide its texts, tables' cells, charts, pictures, placeholders, layout"""
    from pptx import Presentation
    prs = Presentation(path)
    slides = []
    for s in prs.slides:
        texts, info = [], {"tables": 0, "cells": [], "charts": [], "pictures": 0, "placeholders": []}
        for sh in s.shapes:
            _shape_texts(sh, texts, info)
        slides.append({"layout": s.slide_layout.name, "texts": texts, **info})
    return {"slides": slides, "layouts": [l.name for l in prs.slide_layouts], "masters": len(prs.slide_masters)}


PS_OPEN = r"""
$ErrorActionPreference = "Stop"
$files = Get-Content -Raw -Encoding UTF8 $args[0] | ConvertFrom-Json
# a PowerPoint that was running before (someone's, another check's) is used and left running
$was = $true; try { [Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application") | Out-Null } catch { $was = $false }
$app = New-Object -ComObject PowerPoint.Application
$out = @()
function texts($shapes, [ref]$acc, [ref]$nt, [ref]$nc) {
  foreach ($sh in $shapes) {
    if ($sh.Type -eq 6) { texts $sh.GroupItems $acc $nt $nc; continue }
    if ($sh.HasChart) { $nc.Value++ }
    if ($sh.HasTable) { $nt.Value++; $t = $sh.Table; for ($r = 1; $r -le $t.Rows.Count; $r++) { for ($c = 1; $c -le $t.Columns.Count; $c++) { $x = $t.Cell($r, $c).Shape.TextFrame.TextRange.Text; if ($x.Trim()) { $acc.Value += $x } } }; continue }
    if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $acc.Value += $sh.TextFrame.TextRange.Text }
  }
}
try {
  foreach ($f in $files) {
    $r = @{ file = $f; ok = $false; slides = 0; texts = @(); tables = @(); charts = @(); error = "" }
    try {
      $p = $app.Presentations.Open($f, -1, 0, 0)
      $r.slides = $p.Slides.Count
      foreach ($s in $p.Slides) { $acc = @(); $nt = 0; $nc = 0; texts $s.Shapes ([ref]$acc) ([ref]$nt) ([ref]$nc); $r.texts += ,@($acc); $r.tables += $nt; $r.charts += $nc }
      $p.Close(); $r.ok = $true
    } catch { $r.error = $_.Exception.Message }
    $out += $r
  }
} finally { if (-not $was) { $app.Quit() | Out-Null } }
ConvertTo-Json -Depth 6 -InputObject @($out) | Out-File -Encoding UTF8 $args[1]
"""


def powerpoint_available():
    if os.name != "nt":
        return False
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", "[bool]([Type]::GetTypeFromProgID('PowerPoint.Application'))"],
                           capture_output=True, text=True, timeout=60)
        return r.stdout.strip() == "True"
    except (OSError, subprocess.TimeoutExpired):
        return False


def powerpoint_open(paths, timeout=600):
    """(3): each file opened in PowerPoint (read-only, no window): opened or the error, the slide count, the texts.
    One PowerShell call per file, each within `timeout` s (reading back a large deck's table cells takes a while over
    COM): a file that does not come back in time is a failure of its own, the others are still checked"""
    d = tempfile.mkdtemp(prefix="pptxcheck-")
    script = os.path.join(d, "open.ps1")
    with open(script, "w", encoding="utf-8-sig") as f:
        f.write(PS_OPEN)
    out = []
    for k, p in enumerate(paths):
        lst, res = os.path.join(d, "files%d.json" % k), os.path.join(d, "out%d.json" % k)
        with open(lst, "w", encoding="utf-8") as f:
            json.dump([os.path.abspath(p)], f)
        try:
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, lst, res], capture_output=True, text=True, timeout=timeout)
            with open(res, encoding="utf-8-sig") as f:
                r = json.load(f)
            out.extend(r if isinstance(r, list) else [r])
        except subprocess.TimeoutExpired:
            out.append({"file": os.path.abspath(p), "ok": False, "slides": 0, "texts": [], "error": "not read back within %d s" % timeout})
        except (OSError, ValueError) as e:
            out.append({"file": os.path.abspath(p), "ok": False, "slides": 0, "texts": [], "error": "no answer: %s" % e})
    return out


def squash(s):
    import unicodedata
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or ""))


def source_values(workbook, sheet, rng):
    """the numbers of a range as a chart reads them: rows then columns, hidden rows / columns, text and blanks skipped"""
    import openpyxl
    wb = openpyxl.load_workbook(workbook, data_only=True)
    ws = wb[sheet]
    out = []
    for row in ws[rng]:
        for c in (row if isinstance(row, tuple) else (row,)):
            if ws.row_dimensions[c.row].hidden or ws.column_dimensions[c.column_letter].hidden:
                continue
            if isinstance(c.value, (int, float)) and not isinstance(c.value, bool):
                out.append(float(c.value))
    return out


def real_objects(rep_content, expect, who):
    """(5) the gate of AUDIT-2 VER-3 / PX-03 (S14.P, 09 §7.2): each slide has exactly the real tables (has_table) and
    native charts (has_chart) the core's own export draws there (`expect`, tools/real-objects.mjs: a table of a sheet the
    workbook lacks, a hidden slide are not drawn, so not expected) – never a picture of one, never one too many; a slide
    `expect` does not list must hold none. `who` names the reader in the message"""
    bad = []
    slides = rep_content["slides"] if rep_content else []
    want = {e["slide"]: e for e in expect or []}
    for n in sorted(set(want) | set(range(1, len(slides) + 1))):
        s = slides[n - 1] if 0 < n <= len(slides) else None
        for k, word in (("tables", "real table"), ("charts", "native chart")):
            w = (want.get(n) or {}).get(k) or 0
            have = (len(s["charts"]) if k == "charts" else s["tables"]) if s else 0
            if have != w:
                bad.append("slide %d: %s %d %s(s), the export draws %d" % (n, who, have, word, w))
    return bad


def check(paths, slides=None, ppt=True, report=None, sources=None, expect=None):
    """`expect` ({file: [{slide, tables, charts}]}): the real tables and native charts each slide must hold (5), exactly. Where
    PowerPoint is present it is a gate, not a count (AUDIT-2 VER-3, 09 §7.2): the file must open, and PowerPoint must see
    as many tables (HasTable) and charts (HasChart) per slide as python-pptx does; without it (CI, Linux) the structural
    checks and python-pptx's counts run, and each report says `ppt: absent`"""
    ok, reports = True, []
    use_ppt = ppt and powerpoint_available()
    opened = {os.path.abspath(r["file"]).lower(): r for r in powerpoint_open(paths)} if use_ppt else {}
    for p in paths:
        bad, facts = structure(p, slides)
        rep = {"file": p, **facts, "structure": bad or "ok", "ppt": "opened" if use_ppt else "absent" if ppt else "skipped"}
        try:
            rep["content"] = content(p)
        except Exception as e:                      # noqa: BLE001 (a file python-pptx cannot read is a failure)
            bad = bad + ["python-pptx cannot read it: %s" % e]
            rep["content"] = None
        exp = (expect or {}).get(p, (expect or {}).get(os.path.abspath(p)))
        if exp is not None:
            bad = bad + real_objects(rep["content"], exp, "python-pptx reads")
        bad = bad + check_icons(p, exp, rep)            # (6) M15: the icons (its own function below)
        src = (sources or {}).get(p) or (sources or {}).get(os.path.abspath(p))
        if src and rep["content"]:
            for k, spec in enumerate(src["charts"]):
                found = [c for s in rep["content"]["slides"][spec["slide"] - 1:spec["slide"]] for c in s["charts"]]
                want = source_values(src["workbook"], spec["sheet"], spec["range"])
                # (the cache keeps Excel's 15 significant digits: equal within that)
                same = lambda a, b: len(a) == len(b) and all(abs(float(x) - y) <= 1e-12 * max(1.0, abs(y)) for x, y in zip(a, b))
                mine = [c for c in found if same(c["values"], want)]
                if not mine:
                    bad.append("chart %d (slide %d, %s!%s): no chart with the cells' values %s" % (k + 1, spec["slide"], spec["sheet"], spec["range"], want[:4]))
        if use_ppt:
            o = opened.get(os.path.abspath(p).lower())
            if not o or not o.get("ok"):
                rep["ppt"] = "failed"
                bad.append("PowerPoint: %s" % ((o or {}).get("error") or "not opened"))
            else:
                as_list = lambda v: v if isinstance(v, list) else ([] if v is None else [v])     # (ConvertTo-Json: one slide is a number)
                rep["powerpoint"] = {"slides": o["slides"], "tables": as_list(o.get("tables")), "charts": as_list(o.get("charts"))}
                if o["slides"] != facts.get("slides"):
                    bad.append("PowerPoint reads %s slides, the file has %s" % (o["slides"], facts.get("slides")))
                if rep["content"]:
                    # (5) PowerPoint sees every real table and native chart python-pptx sees (VER-3: gated, not counted)
                    pt, pc = rep["powerpoint"]["tables"], rep["powerpoint"]["charts"]
                    for i, s in enumerate(rep["content"]["slides"]):
                        if (pt[i] if i < len(pt) else 0) != s["tables"] or (pc[i] if i < len(pc) else 0) != len(s["charts"]):
                            bad.append("slide %d: PowerPoint sees %s table(s) and %s chart(s), python-pptx %d and %d"
                                       % (i + 1, pt[i] if i < len(pt) else 0, pc[i] if i < len(pc) else 0, s["tables"], len(s["charts"])))
                    for i, (mine, theirs) in enumerate(zip(rep["content"]["slides"], o["texts"] or [])):
                        # (as sets: PowerPoint gives a merged cell's text for every cell it covers)
                        a, b = set(squash(t) for t in mine["texts"]), set(squash(t) for t in (theirs or []))
                        if a != b:
                            bad.append("slide %d: PowerPoint reads other texts (%d vs %d)" % (i + 1, len(b), len(a)))
        rep["ok"] = not bad
        rep["problems"] = bad
        reports.append(rep)
        ok = ok and not bad
        print(("PASS " if not bad else "FAIL ") + os.path.basename(p) + ("" if not bad else ": " + "; ".join(bad[:4])))
    if not use_ppt and ppt:
        print("(PowerPoint is not available here: checks 1–2, 4 and python-pptx's real tables and charts (5) only; on a PC with PowerPoint, 3 and 5 are gates)")
    if report:
        with open(report, "w", encoding="utf-8") as f:
            json.dump(reports, f, ensure_ascii=False, indent=1)
    return ok


# ---- M15 (4.8; S15.2 review, 1): the icon block of the gate, its own functions (M14-M15-split §2) ----
def _slide_parts(z):
    """the slide parts in the file's order (presentation.xml's sldIdLst)"""
    pres = ET.fromstring(z.read("ppt/presentation.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("ppt/_rels/presentation.xml.rels")).findall("rel:Relationship", NS)}
    return [posixpath.normpath(posixpath.join("ppt", rels[s.get("{%s}id" % NS["r"])])) for s in pres.findall("p:sldIdLst/p:sldId", NS)]


ICON_NAME = re.compile(r"^Icon \d+$")


def _icon_problems(el, where):
    """what is wrong with one icon (an "Icon n" shape, or a group of them): its shapes custom geometry, no picture, an
    outline shape stroked, every drawn line round-capped and round-joined"""
    bad = []
    if el.find(".//p:pic", NS) is not None or el.tag == P + "pic":
        bad.append("%s: a picture" % where)
    if el.find(".//a:blipFill", NS) is not None:
        bad.append("%s: a picture fill (a:blipFill)" % where)
    shapes = [el] if el.tag == P + "sp" else el.findall(".//p:sp", NS)
    if not shapes:
        bad.append("%s: no shape" % where)
    for sp in shapes:
        pr = sp.find("p:spPr", NS)
        if pr is None or pr.find("a:custGeom", NS) is None:
            bad.append("%s: not custom geometry (%s)" % (where, "a preset" if pr is not None and pr.find("a:prstGeom", NS) is not None else "no a:custGeom"))
            continue
        if not pr.findall("a:custGeom/a:pathLst/a:path", NS):
            bad.append("%s: custom geometry without a path" % where)
        ln = pr.find("a:ln", NS)
        drawn = ln is not None and ln.find("a:noFill", NS) is None
        if pr.find("a:noFill", NS) is not None and not drawn:
            bad.append("%s: an outline icon (noFill) without a line" % where)
        if drawn and (ln.get("cap") != "rnd" or ln.find("a:round", NS) is None):
            bad.append("%s: its line is not round-capped and round-joined (cap=%s, %s)" % (where, ln.get("cap"), "a:round" if ln.find("a:round", NS) is not None else "no a:round"))
    return bad


def icons(path):
    """per slide (in the file's order) its icons: the outermost shapes and groups named "Icon n" (a half-ink icon is a
    group "Icon" of shapes "Icon"), each with its problems"""
    z = zipfile.ZipFile(path)
    out = []
    for part in _slide_parts(z):
        found = []

        def walk(e):
            for ch in e:
                if ch.tag in (P + "sp", P + "grpSp", P + "pic"):
                    nv = ch.find("./*/p:cNvPr", NS)
                    if nv is not None and ICON_NAME.match(nv.get("name") or ""):
                        found.append(ch)
                        continue
                if ch.tag == P + "grpSp":
                    walk(ch)
        tree = ET.fromstring(z.read(part)).find("p:cSld/p:spTree", NS)
        walk(tree if tree is not None else [])
        out.append(found)
    return out


def check_icons(path, expect=None, rep=None):
    """(6) the icons of a file: each one native custom geometry with round strokes (_icon_problems); with `expect`
    ({slide, icons} entries, the core's count, tools/real-icons.mjs) each slide holds exactly that many, a slide not
    listed none. `rep` (a report) gets the counts per slide"""
    try:
        per = icons(path)
    except (KeyError, zipfile.BadZipFile, ET.ParseError) as e:
        return ["icons not read: %s" % e]
    if rep is not None:
        rep["icons"] = [len(x) for x in per]
    bad = []
    for i, found in enumerate(per):
        for k, el in enumerate(found):
            bad.extend(_icon_problems(el, "slide %d, icon %d" % (i + 1, k + 1)))
    if expect is not None:
        want = {e["slide"]: e.get("icons") or 0 for e in expect}
        for n in sorted(set(want) | set(range(1, len(per) + 1))):
            have = len(per[n - 1]) if 0 < n <= len(per) else 0
            if have != want.get(n, 0):
                bad.append("slide %d: %d icon(s), the export draws %d" % (n, have, want.get(n, 0)))
    return bad
# ---- end of M15's icon block ----


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check")
    c.add_argument("files", nargs="+")
    c.add_argument("--slides", type=int)
    c.add_argument("--no-ppt", action="store_true")
    c.add_argument("--json")
    c.add_argument("--sources")
    c.add_argument("--expect")
    i = sub.add_parser("info")
    i.add_argument("files", nargs="+")
    a = ap.parse_args(argv)
    if a.cmd == "info":
        out = []
        for p in a.files:
            bad, facts = structure(p)
            out.append({"file": p, **facts, "structure": bad or "ok", "content": content(p)})
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        return 0
    sources = None
    if a.sources:
        with open(a.sources, encoding="utf-8") as f:
            sources = json.load(f)
    expect = None
    if a.expect:
        with open(a.expect, encoding="utf-8") as f:
            expect = json.load(f)
    return 0 if check(a.files, a.slides, not a.no_ppt, a.json, sources, expect) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
