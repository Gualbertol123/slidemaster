# Builds the G4 stand-in corpus with the Excel installed on this PC (dev tool; the product never needs Excel).
# The product owner cannot share the team's confidential dashboards (2026-10-17), so gate G4 – the self-check numbers
# of real workbooks – is measured on two macro-enabled workbooks built like them: several interlinked sheets, a command
# cell, arithmetic, lookups (XLOOKUP, VLOOKUP, HLOOKUP, INDEX/MATCH), conditional sums, cells pointing at each other
# across sheets and across files, a VBA module – written in Italian Excel (FormulaLocal, Italian function names and
# separators) and in English (Formula).
#   Cruscotto.xlsm : Controllo!B2 = the bank (text command cell), Controllo!B5 = a rate (number command cell); Dati,
#                    Anagrafica, Calcoli, "SLIDE Sintesi", "SLIDE Area" (marker tables, x at B2), Macro (a VBA UDF
#                    cell); module Modulo1: Sub AggiornaBanca, Function CommissioneBanca. Formulas typed in Italian.
#   Benchmark.xlsm : Peers, Compare (reads Cruscotto.xlsm by XLOOKUP / VLOOKUP / direct refs), "SLIDE Benchmark";
#                    Cruscotto reads one of its cells back. Formulas typed in English (Formula); English TEXT codes.
#   truth\<bank>\{Cruscotto,Benchmark}.xlsm : both files recalculated and saved by Excel for every bank
#   truth\rate_<r>\... : the same for the number command cell
# Number formats are typed in Italian too (NumberFormatLocal): under the Italian Excel the English property fails.
# Output: tests\corpus\workbooks\g4 (committed; regenerate only on a PC with Excel; VBA project access must be allowed:
# File › Options › Trust Center › Macro settings › "Trust access to the VBA project object model").
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "tests\corpus\workbooks\g4"))
$ErrorActionPreference = "Stop"
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$banks = @("Banca Nord", "Banca Sud", "Banca Centro", "Banca Città", "Banca Isole", "Banca Est", "Banca Ovest", "Banca Alpi")
$areas = @("Nord", "Sud", "Centro", "Centro", "Sud", "Nord", "Nord", "Nord")
$rnd = New-Object System.Random(20261017)

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false; $xl.EnableEvents = $false
"Excel " + $xl.Version + " build " + $xl.Build + " · language " + $xl.LanguageSettings.LanguageID(2) + " · decimal '" + $xl.International(3) + "' list '" + $xl.International(5) + "'"
try {
  $wbA = $xl.Workbooks.Add(); $wbB = $xl.Workbooks.Add()
  while ($wbA.Worksheets.Count -lt 7) { [void]$wbA.Worksheets.Add([Type]::Missing, $wbA.Worksheets.Item($wbA.Worksheets.Count)) }
  while ($wbB.Worksheets.Count -lt 3) { [void]$wbB.Worksheets.Add([Type]::Missing, $wbB.Worksheets.Item($wbB.Worksheets.Count)) }
  $pathA = Join-Path $Out "Cruscotto.xlsm"; $pathB = Join-Path $Out "Benchmark.xlsm"
  $wbA.SaveAs($pathA, 52); $wbB.SaveAs($pathB, 52)                       # 52 = xlOpenXMLWorkbookMacroEnabled

  # ---------------------------------------------------------------- Cruscotto.xlsm (Italian)
  $ctl = $wbA.Worksheets.Item(1); $ctl.Name = "Controllo"
  $dat = $wbA.Worksheets.Item(2); $dat.Name = "Dati"
  $ana = $wbA.Worksheets.Item(3); $ana.Name = "Anagrafica"
  $cal = $wbA.Worksheets.Item(4); $cal.Name = "Calcoli"
  $s1 = $wbA.Worksheets.Item(5); $s1.Name = "SLIDE Sintesi"
  $s2 = $wbA.Worksheets.Item(6); $s2.Name = "SLIDE Area"
  $mac = $wbA.Worksheets.Item(7); $mac.Name = "Macro"

  # Dati: 8 banks × 12 months
  $dat.Range("A1:H1").Value2 = [object[]]@("Banca", "Mese", "Impieghi", "Raccolta", "Costi", "Ricavi", "Area", "Data")
  $rows = New-Object 'object[,]' ($banks.Count * 12), 8; $r = 0
  for ($b = 0; $b -lt $banks.Count; $b++) {
    $base = 1200 + $b * 450
    for ($m = 1; $m -le 12; $m++) {
      $rows[$r,0] = $banks[$b]; $rows[$r,1] = $m
      $rows[$r,2] = [Math]::Round($base * (1 + 0.006 * $m) + $rnd.Next(-40, 40) + $rnd.NextDouble(), 2)
      $rows[$r,3] = [Math]::Round($base * 1.3 * (1 + 0.004 * $m) + $rnd.Next(-60, 60), 1)
      $rows[$r,4] = [Math]::Round($base * 0.031 + $rnd.Next(-5, 5) + $rnd.NextDouble(), 2)
      $rows[$r,5] = [Math]::Round($base * 0.052 + $rnd.Next(-6, 6) + $rnd.NextDouble(), 2)
      $rows[$r,6] = $areas[$b]
      $rows[$r,7] = (Get-Date -Year 2026 -Month $m -Day 1).ToOADate()
      $r++
    }
  }
  $dat.Range($dat.Cells.Item(2,1), $dat.Cells.Item(1 + $r, 8)).Value2 = $rows
  $dat.Range("H:H").NumberFormatLocal = "gg/mm/aaaa"

  # Anagrafica: the lookup table (VLOOKUP / XLOOKUP / INDEX-MATCH targets) and a month header row (HLOOKUP)
  $ana.Range("A1:E1").Value2 = [object[]]@("Banca", "Codice", "Area", "Responsabile", "Obiettivo impieghi")
  for ($b = 0; $b -lt $banks.Count; $b++) {
    $ana.Cells.Item(2 + $b, 1).Value2 = $banks[$b]; $ana.Cells.Item(2 + $b, 2).Value2 = "B" + (101 + $b)
    $ana.Cells.Item(2 + $b, 3).Value2 = $areas[$b]; $ana.Cells.Item(2 + $b, 4).Value2 = @("Rossi", "Bianchi", "Verdi", "Ferrari", "Russo", "Colombo", "Ricci", "Marino")[$b]
    $ana.Cells.Item(2 + $b, 5).Value2 = 1300 + $b * 470
  }
  $ana.Range("G1").Value2 = "Mese"; $ana.Range("G2").Value2 = "Peso"
  for ($m = 1; $m -le 12; $m++) { $ana.Cells.Item(1, 7 + $m).Value2 = $m; $ana.Cells.Item(2, 7 + $m).Value2 = [Math]::Round(0.06 + 0.005 * $m, 3) }

  # Controllo: the command cells and what derives from them
  $ctl.Range("A2").Value2 = "Banca";            $ctl.Range("B2").Value2 = $banks[0]
  $ctl.Range("A3").Value2 = "Indice banca";     $ctl.Range("B3").FormulaLocal = '=CONFRONTA(B2;Anagrafica!A2:A9;0)'
  $ctl.Range("A4").Value2 = "Mese";             $ctl.Range("B4").Value2 = 9
  $ctl.Range("A5").Value2 = "Tasso scenario";   $ctl.Range("B5").Value2 = 0.035; $ctl.Range("B5").NumberFormatLocal = "0,0%"
  $ctl.Range("A6").Value2 = "Codice";           $ctl.Range("B6").FormulaLocal = '=CERCA.VERT(B2;Anagrafica!A2:E9;2;FALSO)'
  $ctl.Range("A7").Value2 = "Area";             $ctl.Range("B7").FormulaLocal = '=CERCA.X(B2;Anagrafica!A2:A9;Anagrafica!C2:C9;"n.d.")'
  $ctl.Range("A8").Value2 = "Titolo";           $ctl.Range("B8").FormulaLocal = '=B2&" ("&B6&") - mese "&TESTO(B4;"00")'
  $ctl.Range("A9").Value2 = "Data rif.";        $ctl.Range("B9").FormulaLocal = '=FINE.MESE(DATA(2026;B4;1);0)'; $ctl.Range("B9").NumberFormatLocal = "gg/mm/aaaa"
  $ctl.Range("A10").Value2 = "Etichetta mese";  $ctl.Range("B10").FormulaLocal = '=TESTO(B9;"mmmm aaaa")'      # Italian codes: locale-dependent
  $ctl.Range("A11").Value2 = "Responsabile";    $ctl.Range("B11").FormulaLocal = '=INDICE(Anagrafica!D2:D9;B3)'
  $ctl.Range("A12").Value2 = "Peso mese";       $ctl.Range("B12").FormulaLocal = '=CERCA.ORIZZ(B4;Anagrafica!H1:S2;2;FALSO)'
  $ctl.Range("A13").Value2 = "Benchmark gap"     # B13 reads Benchmark.xlsm back once its sheets exist (below)

  # Calcoli: the bank's month (C), the previous month (D), year to date (E); cells pointing at each other
  $cal.Range("A1:E1").Value2 = [object[]]@("Voce", "", "Mese", "Mese prec.", "Da inizio anno")
  $items = @("Impieghi", "Raccolta", "Costi", "Ricavi")
  for ($i = 0; $i -lt 4; $i++) {
    $row = 2 + $i; $col = @("C", "D", "E", "F")[$i]
    $cal.Cells.Item($row, 1).Value2 = $items[$i]
    $cal.Range("C$row").FormulaLocal = "=SOMMA.PIÙ.SE(Dati!`$$col`$2:`$$col`$97;Dati!`$A`$2:`$A`$97;Controllo!`$B`$2;Dati!`$B`$2:`$B`$97;Controllo!`$B`$4)"
    $cal.Range("D$row").FormulaLocal = "=SOMMA.PIÙ.SE(Dati!`$$col`$2:`$$col`$97;Dati!`$A`$2:`$A`$97;Controllo!`$B`$2;Dati!`$B`$2:`$B`$97;Controllo!`$B`$4-1)"
    $cal.Range("E$row").FormulaLocal = "=SOMMA.PIÙ.SE(Dati!`$$col`$2:`$$col`$97;Dati!`$A`$2:`$A`$97;Controllo!`$B`$2;Dati!`$B`$2:`$B`$97;`"<=`"&Controllo!`$B`$4)"
  }
  $f = @(
    @("Margine",            '=C5-C4',                               '=D5-D4',                  '=E5-E4'),
    @("Cost/income",        '=SE.ERRORE(C4/C5;0)',                  '=SE.ERRORE(D4/D5;0)',     '=SE.ERRORE(E4/E5;0)'),
    @("Impieghi/Raccolta",  '=ARROTONDA(C2/C3;4)',                  '=ARROTONDA(D2/D3;4)',     '=ARROTONDA(E2/E3;4)'),
    @("Var. impieghi",      '=C2-D2',                               '=(C2-D2)/D2',             '=SE(C2>D2;"in crescita";"in calo")'),
    @("Impieghi scenario",  '=C2*(1+Controllo!$B$5)',               '=D2*(1+Controllo!$B$5)',  '=E2*(1+Controllo!$B$5/12*Controllo!$B$4)'),
    @("Obiettivo",          '=CERCA.X(Controllo!$B$2;Anagrafica!$A$2:$A$9;Anagrafica!$E$2:$E$9)*Controllo!$B$12*12', '=INDICE(Anagrafica!$E$2:$E$9;CONFRONTA(Controllo!$B$2;Anagrafica!$A$2:$A$9;0))', '=C2/C12'),
    @("Media area",         '=MEDIA.PIÙ.SE(Dati!$C$2:$C$97;Dati!$G$2:$G$97;Controllo!$B$7;Dati!$B$2:$B$97;Controllo!$B$4)', '=CONTA.PIÙ.SE(Dati!$G$2:$G$97;Controllo!$B$7;Dati!$B$2:$B$97;Controllo!$B$4)', '=C2-C13'),
    @("Max / min mese",     '=MAX.PIÙ.SE(Dati!$C$2:$C$97;Dati!$A$2:$A$97;Controllo!$B$2)', '=MIN.PIÙ.SE(Dati!$C$2:$C$97;Dati!$A$2:$A$97;Controllo!$B$2)', '=MATR.SOMMA.PRODOTTO((Dati!$A$2:$A$97=Controllo!$B$2)*(Dati!$B$2:$B$97<=Controllo!$B$4)*Dati!$D$2:$D$97)'),
    @("Posizione",          '=RANGO.EQ(C2;$G$2:$G$9)',              '=SCEGLI(Controllo!$B$3;"uno";"due";"tre";"quattro";"cinque";"sei";"sette";"otto")', '=MAIUSC(SINISTRA(Controllo!$B$2;5))&"-"&Controllo!$B$6'),
    @("Controllo",          '=SE(E(C4>0;C5>0);"ok";"verifica")',    '=ASS(C8)*100',            '=ANNO(Controllo!$B$9)*100+MESE(Controllo!$B$9)')
  )
  for ($i = 0; $i -lt $f.Count; $i++) {
    $row = 6 + $i; $cal.Cells.Item($row, 1).Value2 = $f[$i][0]
    $cal.Range("C$row").FormulaLocal = $f[$i][1]; $cal.Range("D$row").FormulaLocal = $f[$i][2]; $cal.Range("E$row").FormulaLocal = $f[$i][3]
  }
  # every bank's month loans (for the rank): G2:G9
  $cal.Range("G1").Value2 = "Impieghi per banca"
  for ($b = 0; $b -lt $banks.Count; $b++) { $cal.Cells.Item(2 + $b, 7).FormulaLocal = "=SOMMA.PIÙ.SE(Dati!`$C`$2:`$C`$97;Dati!`$A`$2:`$A`$97;Anagrafica!A$($b + 2);Dati!`$B`$2:`$B`$97;Controllo!`$B`$4)" }

  # SLIDE Sintesi: the bank's summary (a marker table: x at B2, the title above the header)
  $s1.Range("B2").Value2 = "x"
  $s1.Range("C3").FormulaLocal = '="Sintesi - "&Controllo!$B$8'
  $s1.Range("C4:G4").Value2 = [object[]]@("Voce", "Mese", "Mese prec.", "Var.", "Var. %")
  $lines = @(@("Impieghi", 2), @("Raccolta", 3), @("Costi", 4), @("Ricavi", 5), @("Margine", 6))
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $row = 5 + $i; $src = $lines[$i][1]
    $s1.Range("C$row").Value2 = $lines[$i][0]
    $s1.Range("D$row").FormulaLocal = "=Calcoli!C$src"; $s1.Range("E$row").FormulaLocal = "=Calcoli!D$src"
    $s1.Range("F$row").FormulaLocal = "=D$row-E$row"; $s1.Range("G$row").FormulaLocal = "=SE.ERRORE(F$row/E$row;`"-`")"
  }
  $s1.Range("C10").Value2 = "Cost/income"; $s1.Range("D10").FormulaLocal = '=Calcoli!C7'; $s1.Range("E10").FormulaLocal = '=Calcoli!D7'; $s1.Range("F10").FormulaLocal = '=D10-E10'
  $s1.Range("C11").Value2 = "Responsabile"; $s1.Range("D11").FormulaLocal = '=Controllo!B11'; $s1.Range("E11").FormulaLocal = '=Calcoli!E14'
  $s1.Range("C12").Value2 = "Gap vs peer"; $s1.Range("D12").FormulaLocal = '=Controllo!B13'
  $s1.Range("C13").Value2 = "Riferimento"; $s1.Range("D13").FormulaLocal = '=Controllo!B10'
  $s1.Range("H13").Value2 = "x"
  $s1.Range("D5:F9").NumberFormatLocal = "#.##0,0"; $s1.Range("G5:G9").NumberFormatLocal = "0,0%"; $s1.Range("D10:F10").NumberFormatLocal = "0,0%"

  # SLIDE Area: every bank of the selected bank's area (FILTER-free: IF + XLOOKUP per row, as dashboards do)
  $s2.Range("B2").Value2 = "x"
  $s2.Range("C3").FormulaLocal = '="Area "&Controllo!$B$7&" - mese "&Controllo!$B$4'
  $s2.Range("C4:G4").Value2 = [object[]]@("Banca", "Area", "Impieghi", "Quota area", "Selezionata")
  for ($b = 0; $b -lt $banks.Count; $b++) {
    $row = 5 + $b
    $s2.Range("C$row").FormulaLocal = "=Anagrafica!A$($b + 2)"
    $s2.Range("D$row").FormulaLocal = "=CERCA.X(C$row;Anagrafica!`$A`$2:`$A`$9;Anagrafica!`$C`$2:`$C`$9)"
    $s2.Range("E$row").FormulaLocal = "=SE(D$row=Controllo!`$B`$7;Calcoli!G$($b + 2);0)"
    $s2.Range("F$row").FormulaLocal = "=SE.ERRORE(E$row/SOMMA(`$E`$5:`$E`$12);0)"
    $s2.Range("G$row").FormulaLocal = "=SE(C$row=Controllo!`$B`$2;`"◀`";`"`")"
  }
  $s2.Range("C13").Value2 = "Totale area"; $s2.Range("E13").FormulaLocal = '=SOMMA(E5:E12)'; $s2.Range("F13").FormulaLocal = '=SOMMA(F5:F12)'
  $s2.Range("H13").Value2 = "x"
  $s2.Range("E5:E13").NumberFormatLocal = "#.##0"; $s2.Range("F5:F13").NumberFormatLocal = "0,0%"

  # Macro: the VBA module and a cell using its function (a UDF: no engine but Excel's can compute it)
  $code = @"
Option Explicit

' Sets the command cell to a bank and recalculates (what the team's dashboards do with a button)
Public Sub AggiornaBanca(ByVal banca As String)
    ThisWorkbook.Worksheets("Controllo").Range("B2").Value = banca
    Application.CalculateFull
End Sub

' A user-defined function: the commission on an amount
Public Function CommissioneBanca(ByVal importo As Double, ByVal tasso As Double) As Double
    CommissioneBanca = Round(importo * tasso / 12, 2)
End Function
"@
  $proj = $null; foreach ($p in $xl.VBE.VBProjects) { try { if ($p.FileName -eq $pathA) { $proj = $p } } catch { } }   # (Workbook.VBProject is null through PowerShell)
  if ($proj) { $mod = $proj.VBComponents.Add(1); $mod.Name = "Modulo1"; $mod.CodeModule.AddFromString($code); "VBA module Modulo1 added" }
  else { "WARNING: no VBA module – Excel does not allow scripts into VBA projects here (Trust Center › Macro settings › 'Trust access to the VBA project object model'); the UDF cell caches #NAME?" }
  $mac.Range("A1").Value2 = "Commissione (funzione VBA)"; $mac.Range("B1").FormulaLocal = '=CommissioneBanca(Calcoli!C2;Controllo!B5)'
  $mac.Range("A2").Value2 = "Stessa formula senza VBA";    $mac.Range("B2").FormulaLocal = '=ARROTONDA(Calcoli!C2*Controllo!B5/12;2)'

  # ---------------------------------------------------------------- Benchmark.xlsm (English)
  $peer = $wbB.Worksheets.Item(1); $peer.Name = "Peers"
  $cmp = $wbB.Worksheets.Item(2); $cmp.Name = "Compare"
  $sb = $wbB.Worksheets.Item(3); $sb.Name = "SLIDE Benchmark"
  $peer.Range("A1:D1").Value2 = [object[]]@("Bank", "Peer loans", "Peer deposits", "Peer cost/income")
  for ($b = 0; $b -lt $banks.Count; $b++) {
    $peer.Cells.Item(2 + $b, 1).Value2 = $banks[$b]
    $peer.Cells.Item(2 + $b, 2).Value2 = 1400 + $b * 430; $peer.Cells.Item(2 + $b, 3).Value2 = 1800 + $b * 560
    $peer.Cells.Item(2 + $b, 4).Value2 = [Math]::Round(0.55 + 0.02 * $b, 3)
  }
  $cmp.Range("A1:B1").Value2 = [object[]]@("Item", "Value")
  $cmp.Range("A2").Value2 = "Bank";           $cmp.Range("B2").Formula = "='[Cruscotto.xlsm]Controllo'!`$B`$2"
  $cmp.Range("A3").Value2 = "Loans";          $cmp.Range("B3").Formula = "='[Cruscotto.xlsm]Calcoli'!`$C`$2"
  $cmp.Range("A4").Value2 = "Peer loans";     $cmp.Range("B4").Formula = '=XLOOKUP(B2,Peers!A2:A9,Peers!B2:B9,0)'
  $cmp.Range("A5").Value2 = "Peer deposits";  $cmp.Range("B5").Formula = '=VLOOKUP(B2,Peers!A2:D9,3,FALSE)'
  $cmp.Range("A6").Value2 = "Gap";            $cmp.Range("B6").Formula = '=B3-B4'
  $cmp.Range("C6").Value2 = "Gap %";          $cmp.Range("D6").Formula = '=IFERROR(B6/B4,0)'
  $cmp.Range("A7").Value2 = "Deposits";       $cmp.Range("B7").Formula = "='[Cruscotto.xlsm]Calcoli'!`$C`$3"
  $cmp.Range("A8").Value2 = "Cost/income";    $cmp.Range("B8").Formula = "='[Cruscotto.xlsm]Calcoli'!`$C`$7"
  $cmp.Range("A9").Value2 = "C/I vs peers";   $cmp.Range("B9").Formula = '=B8-INDEX(Peers!D2:D9,MATCH(B2,Peers!A2:A9,0))'
  $cmp.Range("A10").Value2 = "Label";         $cmp.Range("B10").Formula = "=`"As of `"&TEXT('[Cruscotto.xlsm]Controllo'!`$B`$9,`"dd mmm yyyy`")"   # English codes: locale-dependent
  $cmp.Range("A11").Value2 = "Weighted";      $cmp.Range("B11").Formula = '=SUMPRODUCT(Peers!B2:B9,--(Peers!A2:A9=B2))*1.05'
  $sb.Range("B2").Value2 = "x"
  $sb.Range("C3").Formula = '="Benchmark - "&Compare!B2'
  $sb.Range("C4:F4").Value2 = [object[]]@("Item", "Bank", "Peers", "Gap")
  $sb.Range("C5").Value2 = "Loans";       $sb.Range("D5").Formula = '=Compare!B3'; $sb.Range("E5").Formula = '=Compare!B4'; $sb.Range("F5").Formula = '=D5-E5'
  $sb.Range("C6").Value2 = "Deposits";    $sb.Range("D6").Formula = '=Compare!B7'; $sb.Range("E6").Formula = '=Compare!B5'; $sb.Range("F6").Formula = '=D6-E6'
  $sb.Range("C7").Value2 = "Cost/income"; $sb.Range("D7").Formula = '=Compare!B8'; $sb.Range("E7").Formula = '=Compare!B8-Compare!B9'; $sb.Range("F7").Formula = '=Compare!B9'
  $sb.Range("C8").Value2 = "Position";    $sb.Range("D8").Formula = '=IF(F5>=0,"above peers","below peers")'
  $sb.Range("G8").Value2 = "x"
  $sb.Range("D5:F6").NumberFormatLocal = "#.##0,0"; $sb.Range("D7:F7").NumberFormatLocal = "0,0%"

  $ctl.Range("B13").FormulaLocal = "='[Benchmark.xlsm]Compare'!D6"                 # read back from the linked file
  $ctl.Range("B13").NumberFormatLocal = "0,0%"
  $xl.CalculateFull(); $wbA.Save(); $wbB.Save()
  "formulas: Cruscotto " + ($wbA.Worksheets | ForEach-Object { try { $_.UsedRange.SpecialCells(-4123).Count } catch { 0 } } | Measure-Object -Sum).Sum + " · Benchmark " + ($wbB.Worksheets | ForEach-Object { try { $_.UsedRange.SpecialCells(-4123).Count } catch { 0 } } | Measure-Object -Sum).Sum

  # ---------------------------------------------------------------- scenario truth (Excel's own recalculation)
  foreach ($bank in $banks) {
    $ctl.Range("B2").Value2 = $bank; $xl.CalculateFull()
    $dir = Join-Path (Join-Path $Out "truth") ($bank -replace " ", "_"); New-Item -ItemType Directory -Force $dir | Out-Null
    $wbA.SaveCopyAs((Join-Path $dir "Cruscotto.xlsm")); $wbB.SaveCopyAs((Join-Path $dir "Benchmark.xlsm"))
  }
  $ctl.Range("B2").Value2 = $banks[0]
  foreach ($rate in @(0.02, 0.05)) {
    $ctl.Range("B5").Value2 = $rate; $xl.CalculateFull()
    $dir = Join-Path (Join-Path $Out "truth") ("rate_" + $rate.ToString([System.Globalization.CultureInfo]::InvariantCulture)); New-Item -ItemType Directory -Force $dir | Out-Null
    $wbA.SaveCopyAs((Join-Path $dir "Cruscotto.xlsm")); $wbB.SaveCopyAs((Join-Path $dir "Benchmark.xlsm"))
  }
  $ctl.Range("B5").Value2 = 0.035; $xl.CalculateFull(); $wbA.Save(); $wbB.Save()
  $wbB.Close($false); $wbA.Close($false)
} finally { $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
"done: " + $Out
