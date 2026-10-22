# The conditional-format corpus as Excel 16 shows it (S16.4, B39; XC-01). Windows PowerShell 5.1, Excel installed.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-cf-corpus.ps1
#
# Opens tests\corpus\workbooks\cf\cf-rules.xlsx (written by tools/make_cf_corpus.py) in Excel and writes next to it:
#   cf-rules.excel.json   every cell of the two sheets with the colours Excel shows (Range.DisplayFormat: the fill and the
#                         font colour after the conditional formats, bold, italic) – core/tests/cf-m16.test.ts compares
#                         the slides' cells with them (XC-01);
#   cf-rules-excel.xlsx   the workbook saved by Excel itself (its own XML of every rule, the 2010 extension included);
#   cf-rules-excel.xlsb   the same as an Excel Binary Workbook (the .xlsb reader's rules: compare with the .xlsx).
# Commit the three files. Data bars and icons have no DisplayFormat: compare them by eye with Excel's window (the
# script leaves Excel open on the workbook when -Show is given).
param([switch]$Show)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "tests\corpus\workbooks\cf"
$src = Join-Path $dir "cf-rules.xlsx"
if (-not (Test-Path $src)) { throw "missing $src - run: python tools/make_cf_corpus.py" }

function Hex([double]$c) {
  # Excel colours are BGR integers
  $n = [int]$c
  return ("#{0:X2}{1:X2}{2:X2}" -f ($n -band 0xFF), (($n -shr 8) -band 0xFF), (($n -shr 16) -band 0xFF))
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = [bool]$Show
$xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($src)
  $out = New-Object System.Collections.ArrayList
  foreach ($ws in $wb.Worksheets) {
    $used = $ws.UsedRange
    foreach ($cell in $used.Cells) {
      $d = $cell.DisplayFormat
      $fill = $null
      if ($d.Interior.Pattern -ne -4142) { $fill = Hex $d.Interior.Color }
      [void]$out.Add([ordered]@{
        sheet = $ws.Name
        cell = $cell.Address($false, $false)
        fill = $fill
        color = (Hex $d.Font.Color)
        bold = [bool]$d.Font.Bold
        italic = [bool]$d.Font.Italic
      })
    }
  }
  $json = $out | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText((Join-Path $dir "cf-rules.excel.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
  $wb.SaveAs((Join-Path $dir "cf-rules-excel.xlsx"), 51)
  $wb.SaveAs((Join-Path $dir "cf-rules-excel.xlsb"), 50)
  Write-Host ("{0} cells recorded; Excel {1}" -f $out.Count, $xl.Version)
  if (-not $Show) { $wb.Close($false) }
} finally {
  if (-not $Show) {
    $xl.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  }
}
