# Builds the recalculation-spike workbooks with the Excel installed on this PC (dev tool; the product never needs Excel).
#   Banks.xlsx  : Control!B2 = the bank (the "command cell"); Data; SLIDE_1..3 chained tables; FromB reads Peers.xlsx back
#   Peers.xlsx  : Peer sheet reads Banks.xlsx (bank + summary) and compares with its own peer data
#   BanksBig.xlsx: Control + Data (52 weeks) + 20 slide sheets of formulas (the speed deck)
#   truth\<bank>\{Banks,Peers}.xlsx: the same two files recalculated and saved by Excel for every bank (scenario ground truth)
#   formulas.json: every formula cell's text as Excel's Range.Formula gives it (the reference for the readers, core/tests/formulas.test.ts)
#   xlsb\<name>.xlsb: the same three files saved by Excel as Excel Binary Workbooks (the .xlsb formula reader's twins)
# Output: tests\corpus\workbooks\recalc (committed; regenerate only on a PC with Excel).
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "tests\corpus\workbooks\recalc"))
$ErrorActionPreference = "Stop"
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo("en-US")
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo("en-US")
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$banks = @("Bank A","Bank B","Bank C","Bank D","Bank E","Bank F","Bank G","Bank H","Bank I","Bank J")
$rnd = New-Object System.Random(20261016)

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false; $xl.EnableEvents = $false
"Excel version: " + $xl.Version
try {
  function FillData($ws, $weeks) {
    $ws.Name = "Data"
    $ws.Cells.Item(1,1).Value2 = "Bank"; $ws.Cells.Item(1,2).Value2 = "Week"; $ws.Cells.Item(1,3).Value2 = "Loans"
    $ws.Cells.Item(1,4).Value2 = "Deposits"; $ws.Cells.Item(1,5).Value2 = "Budget loans"; $ws.Cells.Item(1,6).Value2 = "Budget deposits"; $ws.Cells.Item(1,7).Value2 = "Date"
    $rows = New-Object 'object[,]' ($banks.Count * $weeks), 7
    $r = 0
    for ($b = 0; $b -lt $banks.Count; $b++) {
      $base = 1500 + $b * 700
      for ($w = 1; $w -le $weeks; $w++) {
        $rows[$r,0] = $banks[$b]; $rows[$r,1] = $w
        $rows[$r,2] = [Math]::Round($base * (1 + 0.004 * $w) + $rnd.Next(-60, 60) + $rnd.NextDouble(), 3)
        $rows[$r,3] = [Math]::Round($base * 1.2 * (1 + 0.003 * $w) + $rnd.Next(-80, 80), 1)
        $rows[$r,4] = [Math]::Round($base * (1 + 0.0045 * $w), 0)
        $rows[$r,5] = [Math]::Round($base * 1.2 * (1 + 0.0035 * $w), 0)
        $rows[$r,6] = (Get-Date -Year 2026 -Month 1 -Day 5).AddDays(7 * ($w - 1)).ToOADate()
        $r++
      }
    }
    $ws.Range($ws.Cells.Item(2,1), $ws.Cells.Item(1 + $r, 7)).Value2 = $rows
    $ws.Range("H1").Value2 = "Banks"; for ($b = 0; $b -lt $banks.Count; $b++) { $ws.Cells.Item(2 + $b, 8).Value2 = $banks[$b] }
  }
  function FillControl($ws, $week) {
    $ws.Name = "Control"
    $ws.Range("A2").Value2 = "Bank"; $ws.Range("B2").Value2 = "Bank A"
    $ws.Range("A3").Value2 = "Bank index"; $ws.Range("B3").Formula = "=MATCH(B2,Data!H2:H11,0)"
    $ws.Range("A4").Value2 = "Week"; $ws.Range("B4").Value2 = $week
    $ws.Range("A5").Value2 = "FX"; $ws.Range("B5").Value2 = 1.0847
    $ws.Range("A6").Value2 = "Unit"; $ws.Range("B6").Value2 = "mln"
    $ws.Range("A7").Value2 = "Title"; $ws.Range("B7").Formula = '=B2&" - week "&TEXT(B4,"00")&" ("&B6&" EUR)"'
    $ws.Range("A8").Value2 = "Week date"; $ws.Range("B8").Formula = "=INDEX(Data!G:G,MATCH(1,INDEX((Data!A:A=B2)*(Data!B:B=B4),0),0))"
    $ws.Range("A9").Value2 = "Month end"; $ws.Range("B9").Formula = "=EOMONTH(B8,0)"
  }
  # one slide sheet: the 4 weeks up to Control!B4-$off for the chosen bank, with deltas, budget, and a total row
  function FillSlide($ws, $name, $off, $prev) {
    $ws.Name = $name
    $ws.Range("B2").Value2 = "x"                      # the marker tables of the product start at a cell marked x
    $ws.Range("C3").Formula = '="Loans & deposits - "&Control!$B$2'
    $ws.Range("C4").Value2 = "Item"
    for ($k = 0; $k -lt 4; $k++) {
      $col = [char](68 + $k)   # D..G
      $ws.Range("${col}4").Formula = '="Week "&TEXT(Control!$B$4-' + ($off + 3 - $k) + ',"00")'
    }
    $ws.Range("H4").Value2 = "Delta w/w"; $ws.Range("I4").Value2 = "Delta %"; $ws.Range("J4").Value2 = "Budget"; $ws.Range("K4").Value2 = "vs Budget"
    $items = @(@("Loans","C"), @("Deposits","D"))
    $row = 5
    foreach ($it in $items) {
      $ws.Cells.Item($row,3).Value2 = $it[0]
      for ($k = 0; $k -lt 4; $k++) {
        $col = [char](68 + $k)
        $ws.Range("${col}${row}").Formula = "=ROUND(SUMIFS(Data!`$$($it[1]):`$$($it[1]),Data!`$A:`$A,Control!`$B`$2,Data!`$B:`$B,Control!`$B`$4-" + ($off + 3 - $k) + ")*Control!`$B`$5,1)"
      }
      $ws.Range("H$row").Formula = "=G$row-F$row"
      $ws.Range("I$row").Formula = "=IFERROR(H$row/F$row,0)"
      $bcol = if ($it[1] -eq "C") { "E" } else { "F" }
      $ws.Range("J$row").Formula = "=ROUND(SUMIFS(Data!`$${bcol}:`$${bcol},Data!`$A:`$A,Control!`$B`$2,Data!`$B:`$B,Control!`$B`$4-$off)*Control!`$B`$5,1)"
      $ws.Range("K$row").Formula = "=IF(ABS(G$row-J$row)<0.05,0,G$row-J$row)"
      $row++
    }
    # total and ratio rows (depend on the rows above), then a row that depends on the previous slide sheet (the chain)
    $ws.Range("C7").Value2 = "Total"
    foreach ($col in @("D","E","F","G","H","J","K")) { $ws.Range("${col}7").Formula = "=SUM(${col}5:${col}6)" }
    $ws.Range("I7").Formula = "=IFERROR(H7/F7,0)"
    $ws.Range("C8").Value2 = "L/D ratio"
    foreach ($col in @("D","E","F","G")) { $ws.Range("${col}8").Formula = "=IF(${col}6=0,`"n/a`",${col}5/${col}6)" }
    $ws.Range("C9").Value2 = "Average 4w"; $ws.Range("D9").Formula = "=AVERAGE(D7:G7)"; $ws.Range("E9").Formula = "=MAX(D7:G7)"; $ws.Range("F9").Formula = "=MIN(D7:G7)"
    $ws.Range("G9").Formula = "=COUNTIF(H5:H6,`">0`")"
    if ($prev) {
      $ws.Range("C10").Formula = '="vs '+$prev+'"'
      $ws.Range("D10").Formula = "=G7-'$prev'!G7"
      $ws.Range("E10").Formula = "=IFERROR(D10/'$prev'!G7,0)"
      $ws.Range("F10").Formula = "=IF(AND(D10>0,'$prev'!H7>0),`"up`",IF(OR(D10<0,'$prev'!H7<0),`"down`",`"flat`"))"
      $ws.Range("G10").Formula = "=INDEX('$prev'!D5:G6,2,MATCH(MAX('$prev'!D6:G6),'$prev'!D6:G6,0))"
    }
    $ws.Range("C11").Value2 = "Rank"; $ws.Range("D11").Formula = "=RANK(G5,Data!`$C`$2:`$C`$121)"
    $ws.Range("E11").Formula = "=SUMPRODUCT((Data!`$B`$2:`$B`$121=Control!`$B`$4)*(Data!`$C`$2:`$C`$121>G5))+1"
    $ws.Range("F11").Formula = "=VLOOKUP(Control!`$B`$2,Data!`$H`$2:`$H`$11,1,FALSE)"
    $ws.Range("G11").Formula = "=LEFT(Control!`$B`$2,4)&MID(Control!`$B`$2,6,1)&LEN(Control!`$B`$2)"
    $ws.Range("C12").Value2 = "Misc"; $ws.Range("D12").Formula = "=CHOOSE(MOD(Control!`$B`$3,3)+1,`"one`",`"two`",`"three`")"
    $ws.Range("E12").Formula = "=TEXT(Control!`$B`$8,`"mmm yy`")"; $ws.Range("F12").Formula = "=OFFSET(D5,1,2)"; $ws.Range("G12").Formula = "=INDIRECT(`"D7`")"
    $ws.Range("H12").Formula = "=AVERAGEIF(Data!`$A`$2:`$A`$121,Control!`$B`$2,Data!`$C`$2:`$C`$121)"
    $ws.Range("I12").Formula = "=DATE(2026,1,5)+7*(Control!`$B`$4-1)"
    $ws.Range("J12").Formula = "=CONCATENATE(Control!`$B`$6,`" EUR`")"; $ws.Range("K12").Formula = "=ROUNDUP(G7/1000,0)*1000"
    $ws.Range("C13").Value2 = "Today"; $ws.Range("D13").Formula = "=TODAY()"
    $ws.Range("E13").Formula = "=IF(ISNUMBER(G5),`"ok`",`"missing`")"; $ws.Range("F13").Formula = "=LARGE(Data!`$C`$2:`$C`$121,3)"; $ws.Range("G13").Formula = "=SMALL(D5:G6,2)"
    try { $ws.Range("H13").Formula2 = "=XLOOKUP(Control!`$B`$2,Data!`$H`$2:`$H`$11,Data!`$H`$2:`$H`$11,`"none`")" } catch { $ws.Range("H13").Value2 = "no XLOOKUP" }
    try { $ws.Range("I13").Formula2 = "=IFS(G5>F5,`"up`",G5<F5,`"down`",TRUE,`"flat`")" } catch { $ws.Range("I13").Value2 = "no IFS" }
    try { $ws.Range("J13").Formula2 = "=SWITCH(Control!`$B`$6,`"mln`",1000000,`"k`",1000,1)" } catch { $ws.Range("J13").Value2 = "no SWITCH" }
    try { $ws.Range("K13").Formula2 = "=LET(x,G7,y,J7,IF(y=0,0,x/y-1))" } catch { $ws.Range("K13").Value2 = "no LET" }
    try { $ws.Range("L13").Formula2 = "=SUM(FILTER(Data!`$C`$2:`$C`$121,Data!`$A`$2:`$A`$121=Control!`$B`$2))" } catch { $ws.Range("L13").Value2 = "no FILTER" }
  }

  # ---- Banks.xlsx and Peers.xlsx (created first so the cross-file formulas resolve) ----
  $wbA = $xl.Workbooks.Add(); $wbB = $xl.Workbooks.Add(); $xl.Calculation = -4105
  $pathA = Join-Path $Out "Banks.xlsx"; $pathB = Join-Path $Out "Peers.xlsx"
  $wbA.SaveAs($pathA, 51); $wbB.SaveAs($pathB, 51)
  while ($wbA.Worksheets.Count -lt 6) { [void]$wbA.Worksheets.Add([Type]::Missing, $wbA.Worksheets.Item($wbA.Worksheets.Count)) }
  FillData $wbA.Worksheets.Item(2) 12
  FillControl $wbA.Worksheets.Item(1) 12
  FillSlide $wbA.Worksheets.Item(3) "SLIDE_1" 0 $null
  FillSlide $wbA.Worksheets.Item(4) "SLIDE_2" 1 "SLIDE_1"
  FillSlide $wbA.Worksheets.Item(5) "SLIDE_3" 2 "SLIDE_2"
  # Peers.xlsx: its own peer data, the bank and totals read from Banks.xlsx, a comparison table
  while ($wbB.Worksheets.Count -lt 2) { [void]$wbB.Worksheets.Add([Type]::Missing, $wbB.Worksheets.Item($wbB.Worksheets.Count)) }
  $pd = $wbB.Worksheets.Item(2); $pd.Name = "PeerData"
  $pd.Range("A1").Value2 = "Bank"; $pd.Range("B1").Value2 = "Peer avg loans"; $pd.Range("C1").Value2 = "Peer avg deposits"
  for ($b = 0; $b -lt $banks.Count; $b++) { $pd.Cells.Item(2+$b,1).Value2 = $banks[$b]; $pd.Cells.Item(2+$b,2).Value2 = 1800 + 650*$b + $rnd.Next(-100,100); $pd.Cells.Item(2+$b,3).Value2 = 2200 + 780*$b + $rnd.Next(-100,100) }
  $pw = $wbB.Worksheets.Item(1); $pw.Name = "Peer"
  $pw.Range("B2").Value2 = "x"; $pw.Range("C3").Formula = "=`"Peer comparison - `"&'[Banks.xlsx]Control'!`$B`$2"
  $pw.Range("C4").Value2 = "Item"; $pw.Range("D4").Value2 = "Bank"; $pw.Range("E4").Value2 = "Peer avg"; $pw.Range("F4").Value2 = "Gap"; $pw.Range("G4").Value2 = "Gap %"
  $pw.Range("C5").Value2 = "Loans"; $pw.Range("D5").Formula = "='[Banks.xlsx]SLIDE_1'!G5"
  $pw.Range("E5").Formula = "=VLOOKUP('[Banks.xlsx]Control'!`$B`$2,PeerData!`$A`$2:`$C`$11,2,FALSE)"
  $pw.Range("C6").Value2 = "Deposits"; $pw.Range("D6").Formula = "='[Banks.xlsx]SLIDE_1'!G6"
  $pw.Range("E6").Formula = "=VLOOKUP('[Banks.xlsx]Control'!`$B`$2,PeerData!`$A`$2:`$C`$11,3,FALSE)"
  $pw.Range("C7").Value2 = "Total"; $pw.Range("D7").Formula = "=SUM(D5:D6)"; $pw.Range("E7").Formula = "=SUM(E5:E6)"
  foreach ($r in 5..7) { $pw.Range("F$r").Formula = "=D$r-E$r"; $pw.Range("G$r").Formula = "=IFERROR(F$r/E$r,0)" }
  $pw.Range("C8").Value2 = "Position"; $pw.Range("D8").Formula = "=IF(F7>0,`"above peers`",`"below peers`")"
  $pw.Range("E8").Formula = "=PERCENTRANK.INC(PeerData!`$B`$2:`$B`$11,D5)"
  $pw.Range("F8").Formula = "='[Banks.xlsx]SLIDE_2'!G7-D7"
  # Banks.xlsx reads the peer result back (FromB) and SLIDE_3 uses it
  $fb = $wbA.Worksheets.Item(6); $fb.Name = "FromB"
  $fb.Range("B2").Value2 = "x"; $fb.Range("C3").Value2 = "From Peers.xlsx"; $fb.Range("C4").Value2 = "Gap total"; $fb.Range("D4").Formula = "='[Peers.xlsx]Peer'!F7"
  $fb.Range("C5").Value2 = "Position"; $fb.Range("D5").Formula = "='[Peers.xlsx]Peer'!D8"
  $fb.Range("C6").Value2 = "Gap + own delta"; $fb.Range("D6").Formula = "=D4+SLIDE_3!H7"
  $wbA.Worksheets.Item("SLIDE_3").Range("C14").Value2 = "Peer gap"; $wbA.Worksheets.Item("SLIDE_3").Range("D14").Formula = "=FromB!D4*2"

  $xl.CalculateFull()
  $wbA.Save(); $wbB.Save()
  "saved " + $pathA + " and " + $pathB


  $allFormulas = [ordered]@{}
  function DumpFormulas($wb, $key) {
    $sheets = [ordered]@{}
    foreach ($ws in $wb.Worksheets) {
      $cells = [ordered]@{}
      $ur = $ws.UsedRange
      foreach ($cell in $ur.Cells) { if ($cell.HasFormula) { $cells[$cell.Address($false, $false)] = [string]$cell.Formula } }
      if ($cells.Count) { $sheets[$ws.Name] = $cells }
    }
    $allFormulas[$key] = $sheets
  }
  DumpFormulas $wbA "Banks.xlsx"; DumpFormulas $wbB "Peers.xlsx"
  $xlsbDir = Join-Path $Out "xlsb"; New-Item -ItemType Directory -Force $xlsbDir | Out-Null

  # ---- scenario truth: every bank, both files recalculated by Excel ----
  foreach ($bank in $banks) {
    $wbA.Worksheets.Item("Control").Range("B2").Value2 = $bank
    $xl.CalculateFull()
    $dir = Join-Path (Join-Path $Out "truth") ($bank -replace " ", "_"); New-Item -ItemType Directory -Force $dir | Out-Null
    $wbA.SaveCopyAs((Join-Path $dir "Banks.xlsx")); $wbB.SaveCopyAs((Join-Path $dir "Peers.xlsx"))
  }
  $wbA.Worksheets.Item("Control").Range("B2").Value2 = "Bank A"; $xl.CalculateFull(); $wbA.Save(); $wbB.Save()
  # the .xlsb twins, saved last (SaveAs moves the open workbooks to the new files; their links then name the twins)
  $wbB.SaveAs((Join-Path $xlsbDir "Peers.xlsb"), 50); $wbA.SaveAs((Join-Path $xlsbDir "Banks.xlsb"), 50)
  $wbA.Close($false); $wbB.Close($false)

  # ---- BanksBig.xlsx: the speed deck (20 slide sheets, 52 weeks of data) ----
  $wbC = $xl.Workbooks.Add()
  while ($wbC.Worksheets.Count -lt 22) { [void]$wbC.Worksheets.Add([Type]::Missing, $wbC.Worksheets.Item($wbC.Worksheets.Count)) }
  FillData $wbC.Worksheets.Item(2) 52
  FillControl $wbC.Worksheets.Item(1) 40
  $prev = $null
  for ($s = 1; $s -le 20; $s++) { FillSlide $wbC.Worksheets.Item(2 + $s) ("SLIDE_" + $s) ($s - 1) $prev; $prev = "SLIDE_" + $s }
  # fix the RANK/SUMPRODUCT/AVERAGEIF ranges to the 52-week data (520 rows)
  foreach ($ws in $wbC.Worksheets) { if ($ws.Name -like "SLIDE_*") { [void]$ws.Cells.Replace('$121', '$521', 2) } }
  $xl.CalculateFull()
  $t0 = Get-Date; $xl.CalculateFull(); $t1 = Get-Date
  "Excel CalculateFull of BanksBig: " + [int]($t1 - $t0).TotalMilliseconds + " ms"
  DumpFormulas $wbC "BanksBig.xlsx"
  $wbC.SaveAs((Join-Path $Out "BanksBig.xlsx"), 51)
  $wbC.SaveAs((Join-Path $xlsbDir "BanksBig.xlsb"), 50); $wbC.Close($false)
  # ---- Functions.xlsx: one cell per newer / Analysis-ToolPak function, so the .xlsb reader's function table (Cetab,
  # the fCeFunc ids) is learnt from Excel and checked against it (core/tests/formulas.test.ts) ----
  $wbF = $xl.Workbooks.Add(); $wf = $wbF.Worksheets.Item(1); $wf.Name = "F"
  $wf.Range("A1:A20").Value2 = 5; $wf.Range("B1").Value2 = "text"; $wf.Range("C1").Value2 = 44927
  $funcs = @(
    '=IFERROR(A1/0,0)', '=IFNA(A1,0)', '=SUMIFS(A1:A5,A1:A5,">1")', '=COUNTIFS(A1:A5,">1")', '=AVERAGEIF(A1:A5,">1")', '=AVERAGEIFS(A1:A5,A1:A5,">1")',
    '=MAXIFS(A1:A5,A1:A5,">1")', '=MINIFS(A1:A5,A1:A5,">1")', '=EOMONTH(C1,0)', '=EDATE(C1,1)', '=NETWORKDAYS(C1,C1+10)', '=NETWORKDAYS.INTL(C1,C1+10)',
    '=WORKDAY(C1,3)', '=WORKDAY.INTL(C1,3)', '=WEEKNUM(C1)', '=ISOWEEKNUM(C1)', '=YEARFRAC(C1,C1+100)', '=DAYS(C1+3,C1)', '=RANDBETWEEN(1,9)',
    '=MROUND(A1,2)', '=QUOTIENT(A1,2)', '=GCD(A1,10)', '=LCM(A1,3)', '=ISEVEN(A1)', '=ISODD(A1)', '=FACTDOUBLE(A1)', '=MULTINOMIAL(A1,2)', '=SQRTPI(A1)',
    '=SERIESSUM(A1,1,1,A1:A3)', '=CONVERT(A1,"m","ft")', '=BIN2DEC(101)', '=DEC2BIN(A1)', '=DEC2HEX(A1)', '=HEX2DEC("1F")', '=OCT2DEC(17)', '=DEC2OCT(A1)',
    '=RANK.EQ(A1,A1:A5)', '=RANK.AVG(A1,A1:A5)', '=PERCENTRANK.INC(A1:A5,A1)', '=PERCENTRANK.EXC(A1:A5,A1)', '=PERCENTILE.INC(A1:A5,0.5)', '=PERCENTILE.EXC(A1:A5,0.5)',
    '=QUARTILE.INC(A1:A5,1)', '=QUARTILE.EXC(A1:A5,1)', '=STDEV.S(A1:A5)', '=STDEV.P(A1:A5)', '=VAR.S(A1:A5)', '=VAR.P(A1:A5)', '=MODE.SNGL(A1:A5)', '=MEDIAN(A1:A5)',
    '=NORM.DIST(A1,5,1,TRUE)', '=NORM.INV(0.5,5,1)', '=NORM.S.DIST(A1,TRUE)', '=NORM.S.INV(0.5)', '=T.DIST(A1,3,TRUE)', '=T.INV(0.5,3)', '=T.INV.2T(0.5,3)', '=CHISQ.DIST(A1,3,TRUE)',
    '=CHISQ.INV(0.5,3)', '=F.DIST(A1,3,3,TRUE)', '=F.INV(0.5,3,3)', '=BINOM.DIST(2,5,0.5,TRUE)', '=POISSON.DIST(2,5,TRUE)', '=EXPON.DIST(A1,1,TRUE)', '=GAMMA.DIST(A1,1,1,TRUE)',
    '=LOGNORM.DIST(A1,0,1,TRUE)', '=WEIBULL.DIST(A1,1,1,TRUE)', '=CONFIDENCE.NORM(0.05,1,10)', '=CONFIDENCE.T(0.05,1,10)', '=COVARIANCE.P(A1:A5,A1:A5)', '=COVARIANCE.S(A1:A5,A1:A5)',
    '=CEILING.MATH(A1,2)', '=FLOOR.MATH(A1,2)', '=CEILING.PRECISE(A1,2)', '=FLOOR.PRECISE(A1,2)', '=ISO.CEILING(A1,2)', '=AGGREGATE(9,6,A1:A5)', '=NUMBERVALUE("1,5",",",".")',
    '=UNICHAR(65)', '=UNICODE("A")', '=CONCAT(B1,B1)', '=TEXTJOIN(";",TRUE,A1:A3)', '=IFS(A1>1,"a",TRUE,"b")', '=SWITCH(A1,5,"five","other")', '=XLOOKUP(A1,A1:A5,A1:A5)',
    '=XMATCH(A1,A1:A5)', '=LET(x,A1,x*2)', '=FORMULATEXT(A1)', '=ISFORMULA(A1)', '=SHEET()', '=SHEETS()', '=XNPV(0.1,A1:A3,C1:C3)', '=XIRR(A1:A3,C1:C3)',
    '=CUMIPMT(0.05,10,1000,1,2,0)', '=CUMPRINC(0.05,10,1000,1,2,0)', '=EFFECT(0.05,12)', '=NOMINAL(0.05,12)', '=PRICE(C1,C1+365,0.05,0.06,100,2)', '=DISC(C1,C1+365,95,100)',
    '=ACCRINT(C1,C1+180,C1+365,0.05,1000,2)', '=TBILLPRICE(C1,C1+100,0.05)', '=DURATION(C1,C1+365,0.05,0.06,2)', '=YIELD(C1,C1+365,0.05,95,100,2)', '=ERF(A1)', '=ERFC(A1)',
    '=DELTA(A1,5)', '=GESTEP(A1,4)', '=BESSELJ(A1,1)', '=IMSUM("1+i","2")', '=COMPLEX(1,2)', '=IMREAL("1+2i")', '=BITAND(A1,3)', '=BITOR(A1,3)', '=BITXOR(A1,3)',
    '=BITLSHIFT(A1,1)', '=BITRSHIFT(A1,1)', '=BASE(A1,2)', '=DECIMAL("101",2)', '=ARABIC("IV")', '=GAMMA(A1)', '=GAUSS(A1)', '=PHI(A1)', '=PERMUTATIONA(A1,2)', '=COMBINA(A1,2)',
    '=SKEW.P(A1:A5)', '=MODE.MULT(A1:A5)', '=FORECAST.LINEAR(A1,A1:A5,A1:A5)', '=DATEDIF(C1,C1+40,"d")', '=HYPERLINK("http://x","x")', '=GETPIVOTDATA("x",A1)',
    '=IMAGE("x")', '=TOCOL(A1:A3)', '=VSTACK(A1:A2,A3)', '=UNIQUE(A1:A5)', '=SORT(A1:A5)', '=SORTBY(A1:A5,A1:A5)', '=SEQUENCE(3)', '=RANDARRAY(2)', '=FILTER(A1:A5,A1:A5>1)',
    '=TEXTSPLIT("a,b",",")', '=TEXTBEFORE("a,b",",")', '=TEXTAFTER("a,b",",")', '=LAMBDA(x,x+1)(A1)', '=MAP(A1:A3,LAMBDA(x,x*2))', '=SCAN(0,A1:A3,LAMBDA(a,b,a+b))',
    '=ENCODEURL("a b")', '=WEBSERVICE("http://x")', '=FILTERXML("<a/>","/a")', '=SUMSQ(A1:A3)', '=COUNTBLANK(A1:A5)', '=CELL("address",A1)', '=INFO("osversion")',
    '=N(A1)', '=T(B1)', '=TYPE(A1)', '=AREAS(A1:A3)', '=INDEX(A1:A5,2)', '=OFFSET(A1,1,0)', '=INDIRECT("A1")', '=TRANSPOSE(A1:A3)', '=ROW(A1)', '=COLUMN(A1)', '=ROWS(A1:A3)', '=COLUMNS(A1:B1)'
  )
  $row = 1
  foreach ($f in $funcs) { try { $wf.Cells.Item($row, 5).Formula2 = $f } catch { try { $wf.Cells.Item($row, 5).Formula = $f } catch { $wf.Cells.Item($row, 5).Value2 = "not entered: " + $f } }; $row++ }
  $xl.CalculateFull()
  DumpFormulas $wbF "Functions.xlsx"
  $wbF.SaveAs((Join-Path $Out "Functions.xlsx"), 51); $wbF.SaveAs((Join-Path $xlsbDir "Functions.xlsb"), 50); $wbF.Close($false)
  ($allFormulas | ConvertTo-Json -Depth 5 -Compress) | Out-File -Encoding utf8 (Join-Path $Out "formulas.json")
  # one truth copy of the big file for another bank
  $wbC = $xl.Workbooks.Open((Join-Path $Out "BanksBig.xlsx"))
  $wbC.Worksheets.Item("Control").Range("B2").Value2 = "Bank G"; $xl.CalculateFull()
  $t0 = Get-Date; $wbC.Worksheets.Item("Control").Range("B2").Value2 = "Bank H"; $xl.Calculate(); $t1 = Get-Date
  "Excel recalculation after a change of the control cell (BanksBig): " + [int]($t1 - $t0).TotalMilliseconds + " ms"
  $wbC.Worksheets.Item("Control").Range("B2").Value2 = "Bank G"; $xl.CalculateFull()
  $dir = Join-Path (Join-Path $Out "truth") "big_Bank_G"; New-Item -ItemType Directory -Force $dir | Out-Null
  $wbC.SaveCopyAs((Join-Path $dir "BanksBig.xlsx")); $wbC.Close($false)
  "done"
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
