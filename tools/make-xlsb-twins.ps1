# The .xlsb twins of the corpus workbooks (PLAN S6.1): each tests\corpus\workbooks\<name>.xlsx / .xlsm is opened
# read-only in the Excel of this PC (macros, events and link updates off) and saved, from the same open workbook,
# twice into tests\corpus\workbooks\xlsb\: as an Excel Binary Workbook <name>.xlsb and as Excel's own <name>.xlsx
# (.xlsm) – the strict twin, both written by Excel (the corpus originals are written by openpyxl, which Excel
# normalises: explicit font names and sizes, renumbered styles). Also edge-xlsb.xlsb / .xlsx: a workbook built here
# by Excel itself with what the corpus lacks (errors, booleans, inline and formula strings, row formats, a default
# column width, a gradient fill, every border style, italic conditional formats, rules over several ranges, formulas
# with functions, hidden and very hidden sheets). Only missing twins are made (-Rewrite makes them all); the twins
# are committed, so this runs once, on a Windows PC with Excel.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-xlsb-twins.ps1 [-Rewrite]
param([switch]$Rewrite)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'tests\corpus\workbooks'
$dst = Join-Path $src 'xlsb'
New-Item -ItemType Directory -Force $dst | Out-Null
# big30 is not committed (made on demand, ~30 MB): no twin
$files = Get-ChildItem $src -File | Where-Object { $_.Extension -in '.xlsx', '.xlsm' -and $_.BaseName -ne 'big30' }

function Save-Twins($wb, $base, $ext) {
  # 50 = xlExcel12 (.xlsb); 51 = .xlsx, 52 = .xlsm
  $wb.SaveAs((Join-Path $dst ($base + '.xlsb')), 50)
  $wb.SaveAs((Join-Path $dst ($base + $ext)), $(if ($ext -eq '.xlsm') { 52 } else { 51 }))
}

function Build-Edge($xl) {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 4) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $s = $wb.Worksheets.Item(1); $s.Name = 'Values'
  $s.Range('A1').Value2 = 'Values, errors and booleans'
  $s.Range('A1').Font.Size = 16; $s.Range('A1').Font.Bold = $true
  $s.Range('A2').Value2 = 'every cell type'
  $s.Range('B4').Value2 = 'Label'; $s.Range('C4').Value2 = 'Number'; $s.Range('D4').Value2 = 'Other'; $s.Range('E4').Value2 = 'Formula'
  $vals = @(0, -7, 123456789, 0.1, -12.34, 1E+20, 3.14159265358979, 1E-7, 1048576, -0.5)
  for ($i = 0; $i -lt $vals.Count; $i++) {
    $r = 5 + $i
    $s.Range("B$r").Value2 = "Row $($i + 1)"
    $s.Range("C$r").Value2 = [double]$vals[$i]
    $s.Range("E$r").Formula = "=C$r*2"
  }
  $s.Range('D5').Formula = '=1/0'; $s.Range('D6').Formula = '=NA()'; $s.Range('D7').Formula = '=SQRT(-1)'
  $s.Range('D8').Value2 = $true; $s.Range('D9').Value2 = $false; $s.Range('D10').Formula = '=C5>C6'
  $s.Range('D11').Formula = '="joined "&B5'; $s.Range('D12').Formula = '=""'; $s.Range('D13').Value2 = "line one`nline two"
  $s.Range('D14').Formula = '=DATE(2026,10,15)'; $s.Range('D14').NumberFormat = 'yyyy-mm-dd'
  $s.Range('C5:C14').NumberFormat = '0.00'
  $s.Range('E5:E14').NumberFormat = '0.0%'
  # styles: every border style, a gradient fill, centre across selection, rotation, indent, wrap, a row format
  $styles = @(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)
  for ($i = 0; $i -lt 13; $i++) {
    $cell = $s.Range("G$(5 + $i)"); $cell.Value2 = "border $($i + 1)"
    $b = $cell.Borders.Item(9)                                          # xlEdgeBottom
    switch ($i) {
      0 { $b.LineStyle = 1; $b.Weight = 2 }   1 { $b.LineStyle = 1; $b.Weight = -4138 }   2 { $b.LineStyle = -4115; $b.Weight = 2 }
      3 { $b.LineStyle = -4118; $b.Weight = 2 } 4 { $b.LineStyle = 1; $b.Weight = 4 }     5 { $b.LineStyle = -4119; $b.Weight = 4 }
      6 { $b.LineStyle = 1; $b.Weight = 1 }   7 { $b.LineStyle = -4115; $b.Weight = -4138 } 8 { $b.LineStyle = 4; $b.Weight = 2 }
      9 { $b.LineStyle = 4; $b.Weight = -4138 } 10 { $b.LineStyle = 5; $b.Weight = 2 }    11 { $b.LineStyle = 5; $b.Weight = -4138 }
      12 { $b.LineStyle = 13; $b.Weight = -4138 }
    }
    $b.Color = 255 * ($i + 1) * 17
  }
  $g = $s.Range('B17'); $g.Value2 = 'gradient'
  $g.Interior.Pattern = 4000; $g.Interior.Gradient.Degree = 90
  $g.Interior.Gradient.ColorStops.Clear(); [void]$g.Interior.Gradient.ColorStops.Add(0); $g.Interior.Gradient.ColorStops.Item(1).Color = 0x7F3F1F; [void]$g.Interior.Gradient.ColorStops.Add(1); $g.Interior.Gradient.ColorStops.Item(2).Color = 0xFFFFFF
  $s.Range('B18').Value2 = 'pattern'; $s.Range('B18').Interior.Pattern = 17; $s.Range('B18').Interior.PatternColor = 0x0000FF
  $s.Range('B19').Value2 = 'gray 6.25'; $s.Range('B19').Interior.Pattern = 18
  $s.Range('B20').Value2 = 'across'; $s.Range('B20:D20').HorizontalAlignment = 7
  $s.Range('B21').Value2 = 'rotated'; $s.Range('B21').Orientation = 45; $s.Range('C21').Value2 = 'vertical'; $s.Range('C21').Orientation = -4166
  $s.Range('B22').Value2 = 'indented'; $s.Range('B22').IndentLevel = 2; $s.Range('C22').Value2 = 'a long text that wraps'; $s.Range('C22').WrapText = $true
  $s.Range('B23').Value2 = 'justified'; $s.Range('B23').HorizontalAlignment = -4130; $s.Range('B23').VerticalAlignment = -4108
  $s.Range('B24').Value2 = 'distributed'; $s.Range('B24').HorizontalAlignment = -4117; $s.Range('B24').VerticalAlignment = -4160
  $s.Range('B25').Value2 = 'theme tint'; $s.Range('B25').Interior.ThemeColor = 5; $s.Range('B25').Interior.TintAndShade = 0.4; $s.Range('B25').Font.ThemeColor = 2; $s.Range('B25').Font.TintAndShade = -0.25
  $s.Range('B26').Value2 = 'strike, double underline, italic'; $s.Range('B26').Font.Strikethrough = $true; $s.Range('B26').Font.Underline = -4119; $s.Range('B26').Font.Italic = $true; $s.Range('B26').Font.Name = 'Georgia'
  $s.Rows.Item(27).Interior.Color = 0xCCFFCC; $s.Range('C27').Value2 = 'in a formatted row'
  $s.Rows.Item(28).RowHeight = 30; $s.Rows.Item(29).Hidden = $true; $s.Range('B29').Value2 = 'hidden row'
  $s.Columns.Item(8).Hidden = $true; $s.Columns.Item(9).ColumnWidth = 3.5; $s.Columns.Item(10).Interior.Color = 0xEEEEEE
  $s.Range('B30').Value2 = 'Superscript'; $s.Range('B30').Characters(12, 1).Font.Superscript = $true
  $s.StandardWidth = 11
  # conditional formats: between, text equality, italic + bold + fill, several ranges, a function, stop if true;
  # FormatConditions take formulas in Excel's own language and separators: translated through a scratch cell
  $z = $s.Range('Z1'); $local = { param($f) $z.Formula = $f; $l = $z.FormulaLocal; [void]$z.ClearContents(); $l }
  $fc = $s.Range('C5:C14').FormatConditions
  $c1 = $fc.Add(1, 1, '=-10', '=10'); $c1.Font.Italic = $true; $c1.Font.Bold = $true; $c1.Interior.Color = 0x99CCFF; $c1.StopIfTrue = $true
  $c2 = $fc.Add(1, 4, '=100'); $c2.Font.Color = 0x0000C0
  $c3 = $s.Range('B5:B14').FormatConditions.Add(1, 3, '="Row 3"'); $c3.Interior.Color = 0x00FFFF
  $sep = $xl.International(5)                                         # xlListSeparator: a union of ranges is written with it
  $c4 = $s.Range('E8:E10' + $sep + 'E5:E6').FormatConditions.Add(2, 0, (& $local '=AND($C5>0,NOT(ISBLANK($B5)))')); $c4.Font.Bold = $true
  $c5 = $s.Range('G5:G17').FormatConditions.Add(2, 0, (& $local '=ROUND(LEN(G5)/2,0)>=4')); $c5.Interior.Color = 0xDDDDDD
  [void]$s.Range('C5:C14').FormatConditions.AddDatabar()
  [void]$s.Range('B5:B14').FormatConditions.AddUniqueValues()
  $m = [System.Reflection.Missing]::Value
  $t = $s.Range('B5:B14').FormatConditions.Add(9, $m, $m, $m, 'Row 1', 0); $t.Interior.Color = 0xFFCC99   # xlTextString, xlContains
  $s.Range('B3:C3').Merge(); $s.Range('B3').Value2 = 'merged'
  # sheets: one more with values, a hidden one, a very hidden one
  $s2 = $wb.Worksheets.Item(2); $s2.Name = 'Second'; $s2.Range('A1').Value2 = 'Second sheet'; $s2.Range('B3').Value2 = 1; $s2.Range('C3').Value2 = 'x'
  $s3 = $wb.Worksheets.Item(3); $s3.Name = 'Hidden'; $s3.Range('A1').Value2 = 'hidden'; $s3.Visible = 0
  $s4 = $wb.Worksheets.Item(4); $s4.Name = 'Very hidden'; $s4.Range('A1').Value2 = 'very hidden'; $s4.Visible = 2
  $wb.Worksheets.Item(1).Activate()
  return $wb
}

$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false; $xl.EnableEvents = $false
  try { $xl.AutomationSecurity = 3 } catch {}
  foreach ($f in $files) {
    if ((Test-Path (Join-Path $dst ($f.BaseName + '.xlsb'))) -and (Test-Path (Join-Path $dst $f.Name)) -and -not $Rewrite) { Write-Output "kept    $($f.Name)"; continue }
    $wb = $xl.Workbooks.Open($f.FullName, 0, $true)
    try { Save-Twins $wb $f.BaseName $f.Extension } finally { $wb.Close($false) }
    Write-Output "made    xlsb\$($f.BaseName).xlsb, xlsb\$($f.Name)"
  }
  if ((Test-Path (Join-Path $dst 'edge-xlsb.xlsb')) -and (Test-Path (Join-Path $dst 'edge-xlsb.xlsx')) -and -not $Rewrite) { Write-Output 'kept    edge-xlsb' }
  else {
    $wb = Build-Edge $xl
    try { Save-Twins $wb 'edge-xlsb' '.xlsx' } finally { $wb.Close($false) }
    Write-Output 'made    xlsb\edge-xlsb.xlsb, xlsb\edge-xlsb.xlsx'
  }
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
