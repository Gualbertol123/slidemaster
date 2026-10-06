"""Document operations (ARCHITECTURE §3.2). Tested against shared/ops-vectors.json.

``apply_ops(doc, ops, user, now_ms)`` returns ``(new_doc, applied, skipped)``; the input document
is never modified. Every value taken from an operation is deep-copied into the document.
"""
import copy
import re

REF_RE = re.compile(r"^[A-Z]{1,3}[0-9]{1,7}$")
SLIDE_KEYS = ("title", "subtitle", "date", "note", "logo", "layout", "align", "scale")
SLIDE_MAPS = ("notes",)
TABLE_KEYS = ("name",)
TABLE_MAPS = ("cols", "rows", "scales")
CELL_KEYS = ("text", "orig", "sz", "b", "i", "color", "fill", "align", "role")
STYLE_KEYS = ("design", "glass", "color", "logo", "radius", "contrast", "logoBubble")
STYLE_MAPS = ("pn",)


def _set_or_delete(target, key, value):
    if value is None:
        target.pop(key, None)
    else:
        target[key] = copy.deepcopy(value)


def _map_merge(target, key, value):
    """Map merge (§3.2): null deletes the whole map; an object sets (deep copy, replacing the
    entry) or deletes (null) each entry; a map left empty is deleted. Other values are ignored."""
    if value is None:
        target.pop(key, None)
        return
    if not isinstance(value, dict):
        return
    current = target.get(key)
    merged = dict(current) if isinstance(current, dict) else {}
    for k, v in value.items():
        if isinstance(k, str):
            _set_or_delete(merged, k, v)
    if merged:
        target[key] = merged
    else:
        target.pop(key, None)


def _apply_patch(target, patch, keys, maps):
    for k in keys:
        if k in patch:
            _set_or_delete(target, k, patch[k])
    for k in maps:
        if k in patch:
            _map_merge(target, k, patch[k])


def _preset_list(doc, name):
    preset = doc.get("preset")
    items = preset.get(name) if isinstance(preset, dict) else None
    return items if isinstance(items, list) else None


def _find_by_id(items, item_id):
    return next((x for x in items if isinstance(x, dict) and x.get("id") == item_id), None)


def _preset_set(doc, op):
    if "preset" not in op:
        return False
    p = op["preset"]
    if p is not None and not isinstance(p, dict):
        return False
    doc["preset"] = copy.deepcopy(p)
    return True


def _slide_patch(doc, op):
    sid, patch = op.get("id"), op.get("patch")
    if not isinstance(sid, str) or not isinstance(patch, dict):
        return False
    slides = _preset_list(doc, "slides")
    slide = _find_by_id(slides, sid) if slides is not None else None
    if slide is None:
        return False
    _apply_patch(slide, patch, SLIDE_KEYS, SLIDE_MAPS)
    return True


def _table_patch(doc, op):
    tid, patch = op.get("id"), op.get("patch")
    if not isinstance(tid, str) or not isinstance(patch, dict):
        return False
    tables = _preset_list(doc, "tables")
    table = _find_by_id(tables, tid) if tables is not None else None
    if table is None:
        return False
    _apply_patch(table, patch, TABLE_KEYS, TABLE_MAPS)
    return True


def _cell_patch(doc, op):
    sheet, ref, patch = op.get("sheet"), op.get("ref"), op.get("patch")
    if not isinstance(sheet, str) or not sheet or not isinstance(ref, str) or not REF_RE.match(ref) \
            or not isinstance(patch, dict):
        return False
    edits = doc.get("edits")
    if not isinstance(edits, dict):
        edits = doc["edits"] = {}
    cells = edits.get(sheet)
    cells = dict(cells) if isinstance(cells, dict) else {}
    cell = cells.get(ref)
    cell = dict(cell) if isinstance(cell, dict) else {}
    for k in CELL_KEYS:
        if k in patch:
            _set_or_delete(cell, k, patch[k])
    if "text" not in cell:
        cell.pop("orig", None)
    if cell:
        cells[ref] = cell
    else:
        cells.pop(ref, None)
    if cells:
        edits[sheet] = cells
    else:
        edits.pop(sheet, None)
    return True


def _style_patch(style, op):
    patch = op.get("patch")
    if not isinstance(patch, dict):
        return False
    _apply_patch(style, patch, STYLE_KEYS, STYLE_MAPS)
    return True


def _style_of(doc):
    style = doc.get("style")
    if not isinstance(style, dict):
        style = doc["style"] = {}
    return style


def _config_style_of(doc):
    defaults = doc.get("defaults")
    if not isinstance(defaults, dict):
        defaults = doc["defaults"] = {}
    style = defaults.get("style")
    if not isinstance(style, dict):
        style = defaults["style"] = {}
    return style


def apply_ops(doc, ops, user, now_ms, kind="workbook"):
    """Apply a list of operations to a copy of `doc`.

    kind = "workbook" (all ops) or "config" (only style.patch, applied to defaults.style).
    Returns (doc, applied, skipped) where skipped lists the indices of ops that were not applied.
    """
    doc = copy.deepcopy(doc) if isinstance(doc, dict) else {}
    applied, skipped = 0, []
    for i, op in enumerate(ops if isinstance(ops, list) else []):
        ok = False
        if isinstance(op, dict):
            t = op.get("op")
            if kind == "config":
                if t == "style.patch":
                    ok = _style_patch(_config_style_of(doc), op)
            elif t == "preset.set":
                ok = _preset_set(doc, op)
            elif t == "slide.patch":
                ok = _slide_patch(doc, op)
            elif t == "table.patch":
                ok = _table_patch(doc, op)
            elif t == "cell.patch":
                ok = _cell_patch(doc, op)
            elif t == "style.patch":
                ok = _style_patch(_style_of(doc), op)
        if ok:
            applied += 1
        else:
            skipped.append(i)
    if applied:
        try:
            rev = int(doc.get("rev") or 0)
        except (TypeError, ValueError):
            rev = 0
        doc["rev"] = rev + 1
        doc["updated"] = int(now_ms)
        doc["updatedBy"] = user
    return doc, applied, skipped
