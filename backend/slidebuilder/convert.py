"""Conversions done with Windows / Excel (Windows only; elsewhere they raise RuntimeError -> HTTP 501).

* EMF / WMF / TIFF pictures -> PNG with GDI+ (fallback: PowerShell System.Drawing)
* .xlsb / .xls workbooks -> .xlsx with the installed Excel via COM (read-only copy, macros off)
"""
import os
import shutil
import subprocess
import sys
import tempfile

from .util import NO_WINDOW, log

_conv_cache = {}


def _remember(cache, key, value, limit):
    """Bounded cache (oldest entry dropped first) - converted workbooks can be large."""
    cache[key] = value
    while len(cache) > limit:
        cache.pop(next(iter(cache)))


def _gdiplus_to_png(src, dst):
    """Render EMF/WMF/TIFF with Windows GDI+ (built into Windows, no PowerShell needed)."""
    import ctypes
    from ctypes import byref, c_void_p, c_uint, c_size_t, c_wchar_p
    class StartupInput(ctypes.Structure):
        _fields_ = [("GdiplusVersion", c_uint), ("DebugEventCallback", c_void_p),
                    ("SuppressBackgroundThread", ctypes.c_int), ("SuppressExternalCodecs", ctypes.c_int)]
    class GUID(ctypes.Structure):
        _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]
    gdip = ctypes.WinDLL("gdiplus")
    token = c_size_t()
    if gdip.GdiplusStartup(byref(token), byref(StartupInput(1, None, 0, 0)), None):
        raise RuntimeError("GDI+ could not start")
    img, bmp, gfx = c_void_p(), c_void_p(), c_void_p()
    try:
        if gdip.GdipLoadImageFromFile(c_wchar_p(src), byref(img)):
            raise RuntimeError("GDI+ could not read the picture")
        w, h = c_uint(), c_uint()
        gdip.GdipGetImageWidth(img, byref(w)); gdip.GdipGetImageHeight(img, byref(h))
        scale = min(4.0, max(1.0, 1600.0 / max(w.value, 1)))
        W, H = max(1, int(w.value * scale)), max(1, int(h.value * scale))
        gdip.GdipCreateBitmapFromScan0(W, H, 0, 0x26200A, None, byref(bmp))      # 32bpp ARGB
        gdip.GdipGetImageGraphicsContext(bmp, byref(gfx))
        gdip.GdipSetSmoothingMode(gfx, 4); gdip.GdipSetInterpolationMode(gfx, 7)
        gdip.GdipSetPixelOffsetMode(gfx, 2); gdip.GdipSetTextRenderingHint(gfx, 3)
        gdip.GdipGraphicsClear(gfx, 0)
        if gdip.GdipDrawImageRectI(gfx, img, 0, 0, W, H):
            raise RuntimeError("GDI+ could not draw the picture")
        png = GUID(0x557CF406, 0x1A04, 0x11D3, (ctypes.c_ubyte * 8)(0x9A, 0x73, 0x00, 0x00, 0xF8, 0x1E, 0xF3, 0x2E))
        if gdip.GdipSaveImageToFile(bmp, c_wchar_p(dst), byref(png), None):
            raise RuntimeError("GDI+ could not save the PNG")
    finally:
        if gfx: gdip.GdipDeleteGraphics(gfx)
        if bmp: gdip.GdipDisposeImage(bmp)
        if img: gdip.GdipDisposeImage(img)
        gdip.GdiplusShutdown(token)

def convert_picture(data, ext):
    """EMF / WMF / TIFF pictures from the workbook -> PNG (Windows only)."""
    key = (ext, hash(data))
    if key in _conv_cache:
        return _conv_cache[key]
    if not sys.platform.startswith("win"):
        raise RuntimeError("EMF/WMF/TIFF pictures can only be converted on Windows")
    tmpd = tempfile.mkdtemp(prefix="slidebuilder_img_")
    try:
        src, dst = os.path.join(tmpd, "in." + ext), os.path.join(tmpd, "out.png")
        with open(src, "wb") as f:
            f.write(data)
        try:
            _gdiplus_to_png(src, dst)
        except Exception as e:
            log("GDI+ conversion failed (%s), trying PowerShell" % e)
        if not os.path.exists(dst):
            q = lambda p: p.replace("'", "''")
            ps = ("Add-Type -AssemblyName System.Drawing;$img=[System.Drawing.Image]::FromFile('%s');"
                  "$s=[Math]::Min(4,[Math]::Max(1,1600/[Math]::Max($img.Width,1)));$w=[int]($img.Width*$s);$h=[int]($img.Height*$s);"
                  "$bmp=New-Object System.Drawing.Bitmap($w,$h);$g=[System.Drawing.Graphics]::FromImage($bmp);"
                  "$g.SmoothingMode='HighQuality';$g.InterpolationMode='HighQualityBicubic';$g.Clear([System.Drawing.Color]::Transparent);"
                  "$g.DrawImage($img,0,0,$w,$h);$bmp.Save('%s',[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();$img.Dispose()") % (q(src), q(dst))
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, creationflags=NO_WINDOW)
        if not os.path.exists(dst):
            raise RuntimeError("Windows could not convert this .%s picture" % ext)
        with open(dst, "rb") as f:
            out = f.read()
        _remember(_conv_cache, key, out, 64)
        return out
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)

_wb_cache = {}

def convert_workbook(data, name):
    """.xlsb / .xls -> .xlsx with the Excel installed on this PC. The original file is never touched:
    Excel opens a temporary copy read-only, with macros, events and link updates switched off."""
    import hashlib
    key = hashlib.sha1(data).hexdigest()
    if key in _wb_cache:
        return _wb_cache[key]
    if not sys.platform.startswith("win"):
        raise RuntimeError("this needs Microsoft Excel on Windows")
    ext = os.path.splitext(name)[1].lower() or ".xlsb"
    tmpd = tempfile.mkdtemp(prefix="slidebuilder_wb_")
    try:
        src, dst = os.path.join(tmpd, "in" + ext), os.path.join(tmpd, "out.xlsx")
        with open(src, "wb") as f:
            f.write(data)
        q = lambda p: p.replace("'", "''")
        ps = ("$ErrorActionPreference='Stop';$xl=New-Object -ComObject Excel.Application;"
              "try{ $xl.Visible=$false; $xl.DisplayAlerts=$false; $xl.AskToUpdateLinks=$false; $xl.EnableEvents=$false;"
              " try{ $xl.AutomationSecurity=3 }catch{};"
              " $wb=$xl.Workbooks.Open('%s',0,$true); $wb.SaveAs('%s',51); $wb.Close($false) }"
              "finally{ $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }") % (q(src), q(dst))
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240, creationflags=NO_WINDOW)
        if not os.path.exists(dst):
            err = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError("Excel could not open or save it" + (": " + err[0][:200] if err else ""))
        with open(dst, "rb") as f:
            out = f.read()
        _remember(_wb_cache, key, out, 4)
        log("converted %s with Excel" % name)
        return out
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)
