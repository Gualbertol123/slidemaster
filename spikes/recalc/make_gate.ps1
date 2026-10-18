# Builds app/tests/fixtures/Gate.xlsx with the Excel installed on this PC (dev tool): the e2e deck of RC-06 (M8 S8.3).
# Its slide table reads a cell the formula engine computes otherwise than Excel – INFO("osversion"), which IronCalc
# lacks – so a "Run for each value" on it stops at the gate unless "run anyway, mark these cells" is ticked.
#   Control!B2 = the bank (the command cell); SLIDE_1: x at B2, a table C3:D7 with the bank, a number that follows it,
#   and the INFO cell; x at E8.
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "app\tests\fixtures\Gate.xlsx"))
$ErrorActionPreference = "Stop"
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 2) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $ctl = $wb.Worksheets.Item(1); $ctl.Name = "Control"
  $s1 = $wb.Worksheets.Item(2); $s1.Name = "SLIDE_1"
  $ctl.Range("A2").Value2 = "Bank"; $ctl.Range("B2").Value2 = "Bank A"
  $s1.Range("B2").Value2 = "x"
  $s1.Range("C3").Value2 = "Item"; $s1.Range("D3").Value2 = "Value"
  $s1.Range("C4").Value2 = "Bank"; $s1.Range("D4").Formula = '=Control!B2'
  $s1.Range("C5").Value2 = "Score"; $s1.Range("D5").Formula = '=LEN(Control!B2)*10'
  $s1.Range("C6").Value2 = "System"; $s1.Range("D6").Formula = '=INFO("osversion")'
  $s1.Range("C7").Value2 = "Checked"; $s1.Range("D7").Formula = '=IF(D5>0,"yes","no")'
  $s1.Range("E8").Value2 = "x"
  $xl.CalculateFull()
  if (Test-Path $Out) { Remove-Item -Force $Out }
  $wb.SaveAs($Out, 51); $wb.Close($false)
  "D6 = INFO(osversion) saved"
} finally { $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
"done: " + $Out
