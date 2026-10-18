# Builds the LARGE stress corpus with the Excel installed on this PC (dev tool; the product never needs Excel).
# The product owner asked (2026-10-17) to test "very complicated excel workbooks, multiple, interconnected, large and
# complex". The real dashboards are confidential, so these stand-ins are built like them, bigger than G4's:
#   Model.xlsx   : the group dashboard, formulas typed in ITALIAN (Formula2Local). Control (command cells B2 bank,
#                  B3 month index 1..36, B4 scenario rate, B5 region), Data (20 banks x 36 months x 8 products = 5760
#                  rows, two formula columns), Banks / FX / Budget (2-D grids) / Products / Aree lookup sheets, ~20 Calc_*
#                  sheets (SUMIFS grids, XLOOKUP modes, INDEX/MATCH two-way, HLOOKUP, SUMPRODUCT, LET, dynamic arrays,
#                  OFFSET, INDIRECT, named ranges, whole columns, text and date maths, deep cross-sheet chains) and 24
#                  "SLIDE ..." sheets (marker tables: x at B2, x after the last cell).
#   Peers.xlsx   : English formulas (Formula2); reads Model's Control and results ('[Model.xlsx]Sheet'!A1), its own peer
#                  data by XLOOKUP / VLOOKUP / SUMIFS / IFS / SWITCH / LET; Model reads its Summary back.
#   Regions.xlsx : English; reads BOTH Model.xlsx and Peers.xlsx; Model reads its Summary back (A -> B -> C -> A).
#   Speed.xlsx   : one stand-alone file for speed: Control + Data + a SUMIFS grid + 60 chained sheets of formulas.
#   truth\<case>\*.xlsx : the files recalculated and saved by Excel for each scenario case (truth\cases.json lists the
#                  command cells each case sets).
# Output: tests\corpus\workbooks\large (regenerate only on a PC with Excel; Italian Excel assumed: FormulaLocal text
# and NumberFormatLocal codes are Italian). No macros.
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "tests\corpus\workbooks\large"))
$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$inv = [System.Globalization.CultureInfo]::InvariantCulture

$banks = @("Banca Alpi", "Banca Adriatica", "Banca Tirrena", "Banca Padana", "Banca Etrusca", "Banca Lariana", "Banca Sabina",
  "Banca Irpina", "Banca Sannita", "Banca Ligure", "Banca Veneta", "Banca Friulana", "Banca Umbra", "Banca Marchigiana",
  "Banca Lucana", "Banca Calabra", "Banca Sicula", "Banca Sarda", "Banca Romagnola", "Banca Città")
$bankRegion = @("Nord-Ovest", "Nord-Est", "Centro", "Nord-Ovest", "Centro", "Nord-Ovest", "Centro", "Sud", "Sud", "Nord-Ovest",
  "Nord-Est", "Nord-Est", "Centro", "Centro", "Sud", "Sud", "Isole", "Isole", "Nord-Est", "Centro")
$segments = @("Grande", "Media", "Grande", "Grande", "Media", "Piccola", "Piccola", "Piccola", "Media", "Media", "Grande", "Media",
  "Piccola", "Media", "Piccola", "Piccola", "Grande", "Media", "Media", "Grande")
$managers = @("Rossi", "Bianchi  Anna", "Verdi", " Ferrari", "Russo", "Colombo  Luca", "Ricci", "Marino", "Greco", "Bruno",
  "Gallo", "Conti ", "De Luca", "Mancini", "Costa", "Giordano", "Rizzo", "Lombardi", "Moretti", "Barbieri")
$regions = @("Nord-Ovest", "Nord-Est", "Centro", "Sud", "Isole")
$products = @("Mutui", "Prestiti", "Conti", "Carte", "Leasing", "Factoring", "Risparmio", "Assicurazioni")
$prodCat = @("Credito", "Credito", "Raccolta", "Servizi", "Credito", "Credito", "Raccolta", "Servizi")
$NB = $banks.Count; $NM = 36; $NP = $products.Count; $ND = $NB * $NM * $NP   # 5760 data rows
$DLAST = 1 + $ND                                                                # last data row (5761)
$rnd = New-Object System.Random(20261017)

function CL([int]$n) { $s = ""; while ($n -gt 0) { $m = ($n - 1) % 26; $s = [char](65 + $m) + $s; $n = [int][Math]::Floor(($n - 1) / 26) }; $s }
# a formula on a cell or a whole range (relative references move as Excel's fill does); Italian (L) or English (E)
function FIt($ws, [string]$addr, [string]$f) { try { $ws.Range($addr).Formula2Local = $f } catch { throw ("Formula2Local " + $ws.Name + "!" + $addr + " : " + $f + " :: " + $_.Exception.Message) } }
function FE($ws, [string]$addr, [string]$f) { try { $ws.Range($addr).Formula2 = $f } catch { throw ("Formula2 " + $ws.Name + "!" + $addr + " : " + $f + " :: " + $_.Exception.Message) } }
function Row($ws, [string]$addr, [object[]]$vals) { $ws.Range($addr).Value2 = $vals }
function Col($ws, [int]$r, [int]$c, [object[]]$vals) { $a = New-Object 'object[,]' $vals.Count, 1; for ($i = 0; $i -lt $vals.Count; $i++) { $a[$i, 0] = $vals[$i] }; $ws.Range($ws.Cells.Item($r, $c), $ws.Cells.Item($r + $vals.Count - 1, $c)).Value2 = $a }
# a slide sheet: x at B2, title at C3, headers from C4, the data rows from row 5; each column is a formula (filled
# down $n rows) or an array of constants; the closing x after the last row's last cell
function Slide($ws, [string]$title, [object[]]$headers, [int]$n, [object[]]$cols, [bool]$italian = $true) {
  $ws.Range("B2").Value2 = "x"
  if ($italian) { FIt $ws "C3" $title } else { FE $ws "C3" $title }
  Row $ws ("C4:" + (CL (2 + $headers.Count)) + "4") $headers
  for ($k = 0; $k -lt $cols.Count; $k++) {
    $c = 3 + $k; $e = $cols[$k]
    if ($e -is [array]) { Col $ws 5 $c $e }
    else { $addr = (CL $c) + "5:" + (CL $c) + (4 + $n); if ($italian) { FIt $ws $addr $e } else { FE $ws $addr $e } }
  }
  $ws.Cells.Item(4 + $n, 3 + $cols.Count).Value2 = "x"
}
# a defined name; RefersTo set as a property (English syntax: Names.Add's argument is read in the Italian syntax here)
function AddName($wb, [string]$name, [string]$ref) { $n = $wb.Names.Add($name, '=Control!$A$1'); $n.RefersTo = $ref }
function Count-Formulas($wb) { ($wb.Worksheets | ForEach-Object { try { $_.UsedRange.SpecialCells(-4123).Count } catch { 0 } } | Measure-Object -Sum).Sum }
# formula cells holding an error value (to catch an unknown function name: Excel keeps it as #NOME?)
function Errors($wb) {
  $out = @()
  foreach ($ws in $wb.Worksheets) {
    try { $cells = $ws.UsedRange.SpecialCells(-4123, 16) } catch { continue }
    foreach ($a in $cells.Areas) { $out += ($ws.Name + "!" + $a.Address($false, $false) + " " + $a.Cells.Item(1, 1).Formula2) }
  }
  $out
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false; $xl.EnableEvents = $false; $xl.ScreenUpdating = $false
"Excel " + $xl.Version + " build " + $xl.Build + " - decimal '" + $xl.International(3) + "' list '" + $xl.International(5) + "'"
try {
  # ================================================================ every file and every sheet first (links need them)
  $modelSheets = @("Control", "Data", "Banks", "FX", "Budget", "Products", "Aree",
    "Calc_Month", "Calc_Bank", "Calc_Product", "Calc_Region", "Calc_BankMonth", "Calc_Growth", "Calc_Scenario", "Calc_Stats",
    "Calc_Text", "Calc_Dates", "Calc_Dynamic", "Calc_Names", "Calc_Indirect", "Calc_Links", "Calc_Deep", "Calc_Summary",
    "SLIDE Sintesi", "SLIDE Ranking", "SLIDE Regioni", "SLIDE Prodotti", "SLIDE Budget", "SLIDE FX", "SLIDE Scenario",
    "SLIDE Heatmap", "SLIDE Peers", "SLIDE Aree", "SLIDE Testi", "SLIDE Date", "SLIDE Dinamica", "SLIDE Trimestri",
    "SLIDE Segmenti", "SLIDE Profondita", "SLIDE Nomi", "SLIDE Indiretti", "SLIDE Controlli",
    "SLIDE Trend Volumi", "SLIDE Trend Ricavi", "SLIDE Trend Costi", "SLIDE Trend Clienti", "SLIDE Trend Margine")
  $peerSheets = @("PeerData", "PeerMaster", "Link", "Compare", "PeerTrend", "PeerGrid", "Summary",
    "SLIDE Peer Overview", "SLIDE Peer Trend", "SLIDE Peer Gap", "SLIDE Peer Rank")
  $regSheets = @("RegMaster", "RegTargets", "FromModel", "FromPeers", "RegCalc", "Summary",
    "SLIDE Region Overview", "SLIDE Region Trend", "SLIDE Region Peers")
  function NewBook([string[]]$names, [string]$path) {
    $wb = $xl.Workbooks.Add()
    while ($wb.Worksheets.Count -lt $names.Count) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
    for ($i = 0; $i -lt $names.Count; $i++) { $wb.Worksheets.Item($i + 1).Name = $names[$i] }
    $wb.SaveAs($path, 51); $wb
  }
  $pM = Join-Path $Out "Model.xlsx"; $pP = Join-Path $Out "Peers.xlsx"; $pR = Join-Path $Out "Regions.xlsx"; $pS = Join-Path $Out "Speed.xlsx"
  $wbM = NewBook $modelSheets $pM; $wbP = NewBook $peerSheets $pP; $wbR = NewBook $regSheets $pR
  $xl.Calculation = -4135                                                     # manual while building
  $MW = @{}; foreach ($n in $modelSheets) { $MW[$n] = $wbM.Worksheets.Item($n) }
  $PW = @{}; foreach ($n in $peerSheets) { $PW[$n] = $wbP.Worksheets.Item($n) }
  $RW = @{}; foreach ($n in $regSheets) { $RW[$n] = $wbR.Worksheets.Item($n) }
  "sheets created: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Model.xlsx: constants
  # Data: bank x month x product
  $d = $MW["Data"]
  Row $d "A1:L1" @("Banca", "Mese", "Prodotto", "Data", "Volumi", "Ricavi", "Costi", "Clienti", "Regione", "Anno", "Margine", "Chiave")
  $rows = New-Object 'object[,]' $ND, 10; $r = 0
  for ($b = 0; $b -lt $NB; $b++) {
    $base = 800 + $b * 137
    for ($m = 1; $m -le $NM; $m++) {
      $dt = (Get-Date -Year 2024 -Month 1 -Day 1).AddMonths($m).AddDays(-1)  # month end
      for ($p = 0; $p -lt $NP; $p++) {
        $pf = 0.4 + 0.15 * $p
        $rows[$r, 0] = $banks[$b]; $rows[$r, 1] = $m; $rows[$r, 2] = $products[$p]; $rows[$r, 3] = [Math]::Floor($dt.ToOADate())
        $vol = $base * $pf * (1 + 0.008 * $m) + $rnd.Next(-30, 30) + $rnd.NextDouble()
        $rows[$r, 4] = [Math]::Round($vol, 1)
        $rows[$r, 5] = [Math]::Round($vol * (0.045 + 0.002 * $p) + $rnd.NextDouble(), 2)
        $rows[$r, 6] = [Math]::Round($vol * (0.028 + 0.001 * $p) + $rnd.NextDouble(), 2)
        $rows[$r, 7] = [int]($base / 10 * $pf + $rnd.Next(0, 40))
        $rows[$r, 8] = $bankRegion[$b]; $rows[$r, 9] = $dt.Year
        $r++
      }
    }
  }
  $d.Range("A2:J$DLAST").Value2 = $rows
  FIt $d "K2:K$DLAST" '=F2-G2'
  FIt $d "L2:L$DLAST" '=A2&"|"&B2&"|"&C2'
  $d.Range("D2:D$DLAST").NumberFormatLocal = "gg/mm/aaaa"

  # Banks master
  $s = $MW["Banks"]
  Row $s "A1:H1" @("Banca", "Codice", "Regione", "Responsabile", "Segmento", "Fondazione", "Obiettivo", "Peso")
  $a = New-Object 'object[,]' $NB, 8
  for ($b = 0; $b -lt $NB; $b++) { $a[$b, 0] = $banks[$b]; $a[$b, 1] = "B" + (101 + $b); $a[$b, 2] = $bankRegion[$b]; $a[$b, 3] = $managers[$b]; $a[$b, 4] = $segments[$b]; $a[$b, 5] = 1850 + 7 * $b; $a[$b, 6] = [Math]::Round((800 + $b * 137) * 5.6, 0); $a[$b, 7] = [Math]::Round(0.02 + 0.003 * $b, 3) }
  $s.Range("A2:H21").Value2 = $a

  # FX by month (vertical) and the same rates horizontally (HLOOKUP)
  $s = $MW["FX"]
  Row $s "A1:E1" @("Mese", "Data", "USD", "GBP", "CHF")
  $a = New-Object 'object[,]' $NM, 5; $h = New-Object 'object[,]' 4, ($NM + 1)
  $h[0, 0] = "Mese"; $h[1, 0] = "USD"; $h[2, 0] = "GBP"; $h[3, 0] = "CHF"
  for ($m = 1; $m -le $NM; $m++) {
    $usd = [Math]::Round(1.05 + 0.04 * [Math]::Sin($m / 5) + 0.0001 * $m, 4); $gbp = [Math]::Round(0.85 + 0.01 * [Math]::Cos($m / 4), 4); $chf = [Math]::Round(0.95 - 0.002 * $m, 4)
    $a[($m - 1), 0] = $m; $a[($m - 1), 1] = [Math]::Floor((Get-Date -Year 2024 -Month 1 -Day 1).AddMonths($m).AddDays(-1).ToOADate()); $a[($m - 1), 2] = $usd; $a[($m - 1), 3] = $gbp; $a[($m - 1), 4] = $chf
    $h[0, $m] = $m; $h[1, $m] = $usd; $h[2, $m] = $gbp; $h[3, $m] = $chf
  }
  $s.Range("A2:E37").Value2 = $a; $s.Range("A40:AK43").Value2 = $h
  $s.Range("B2:B37").NumberFormatLocal = "gg/mm/aaaa"

  # Budget: two bank x month grids (volumes rows 2-21, revenues rows 25-44)
  $s = $MW["Budget"]
  $g1 = New-Object 'object[,]' ($NB + 1), ($NM + 1); $g2 = New-Object 'object[,]' ($NB + 1), ($NM + 1)
  $g1[0, 0] = "Budget volumi"; $g2[0, 0] = "Budget ricavi"
  for ($m = 1; $m -le $NM; $m++) { $g1[0, $m] = $m; $g2[0, $m] = $m }
  for ($b = 0; $b -lt $NB; $b++) {
    $g1[($b + 1), 0] = $banks[$b]; $g2[($b + 1), 0] = $banks[$b]
    for ($m = 1; $m -le $NM; $m++) { $v = (800 + $b * 137) * 7.4 * (1 + 0.009 * $m); $g1[($b + 1), $m] = [Math]::Round($v, 0); $g2[($b + 1), $m] = [Math]::Round($v * 0.052, 1) }
  }
  $s.Range("A1:AK21").Value2 = $g1; $s.Range("A24:AK44").Value2 = $g2

  $s = $MW["Products"]
  Row $s "A1:D1" @("Prodotto", "Categoria", "Peso margine", "Codice")
  $a = New-Object 'object[,]' $NP, 4
  for ($p = 0; $p -lt $NP; $p++) { $a[$p, 0] = $products[$p]; $a[$p, 1] = $prodCat[$p]; $a[$p, 2] = [Math]::Round(0.6 + 0.05 * $p, 2); $a[$p, 3] = "P" + ($p + 1) }
  $s.Range("A2:D9").Value2 = $a

  $s = $MW["Aree"]
  Row $s "A1:C1" @("Regione", "Responsabile", "Obiettivo")
  $a = New-Object 'object[,]' 5, 3
  for ($i = 0; $i -lt 5; $i++) { $a[$i, 0] = $regions[$i]; $a[$i, 1] = @("Galli", "Fontana", "Santoro", "Marini", "Caruso")[$i]; $a[$i, 2] = @(42000, 30000, 47000, 26000, 16000)[$i] }
  $s.Range("A2:C6").Value2 = $a

  # named ranges (English RefersTo)
  AddName $wbM "SelBank" '=Control!$B$2'
  AddName $wbM "SelMonth" '=Control!$B$3'
  AddName $wbM "Rate" '=Control!$B$4'
  AddName $wbM "SelRegion" '=Control!$B$5'
  AddName $wbM "D_Bank" "=Data!`$A`$2:`$A`$$DLAST"
  AddName $wbM "D_Month" "=Data!`$B`$2:`$B`$$DLAST"
  AddName $wbM "D_Vol" "=Data!`$E`$2:`$E`$$DLAST"
  AddName $wbM "BankList" '=Banks!$A$2:$A$21'
  AddName $wbM "BankRegion" '=Banks!$C$2:$C$21'
  AddName $wbM "TaxRate" '=0.24'
  AddName $wbM "VolSel" '=SUMIFS(D_Vol,D_Bank,SelBank,D_Month,SelMonth)'
  "Model constants: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Model.xlsx: Control
  $c = $MW["Control"]
  $lab = @("Parametro", "Banca", "Mese (indice)", "Tasso scenario", "Regione", "Indice banca", "Codice", "Regione banca", "Data rif.",
    "Etichetta", "Anno", "Mese anno", "Mese prec.", "Anno prec.", "Cambio USD", "Titolo", "Oggi", "Gap peer", "Totale regioni",
    "Trimestre", "Inizio trimestre", "Primo mese anno", "Responsabile", "Segmento", "Tasso mensile")
  Col $c 1 1 $lab
  $c.Range("B2").Value2 = "Banca Tirrena"; $c.Range("B3").Value2 = 30; $c.Range("B4").Value2 = 0.03; $c.Range("B5").Value2 = "Centro"
  $c.Range("B4").NumberFormatLocal = "0,0%"
  FIt $c "B6" '=CONFRONTA(B2;Banks!$A$2:$A$21;0)'
  FIt $c "B7" '=CERCA.VERT(B2;Banks!$A$2:$H$21;2;FALSO)'
  FIt $c "B8" '=CERCA.X(B2;Banks!$A$2:$A$21;Banks!$C$2:$C$21;"n.d.";0)'
  FIt $c "B9" '=FINE.MESE(DATA(2024;B3;1);0)'
  FIt $c "B10" '=TESTO(B9;"mmmm aaaa")'
  FIt $c "B11" '=ANNO(B9)'
  FIt $c "B12" '=MESE(B9)'
  FIt $c "B13" '=MAX(1;B3-1)'
  FIt $c "B14" '=MAX(1;B3-12)'
  FIt $c "B15" '=CERCA.X(B3;FX!$A$2:$A$37;FX!$C$2:$C$37)'
  FIt $c "B16" '=B2&" ("&B7&") - "&B10'
  FIt $c "B17" '=OGGI()'
  # B18, B19: read back from Peers.xlsx / Regions.xlsx (below)
  FIt $c "B20" '=ARROTONDA.PER.ECC(B12/3;0)'
  FIt $c "B21" '=B3-RESTO(B12-1;3)'
  FIt $c "B22" '=B3-B12+1'
  FIt $c "B23" '=ANNULLA.SPAZI(INDICE(Banks!$D$2:$D$21;B6))'
  FIt $c "B24" '=INDICE(Banks!$E$2:$E$21;B6)'
  FIt $c "B25" '=(1+B4)^(1/12)-1'
  $c.Range("B9").NumberFormatLocal = "gg/mm/aaaa"; $c.Range("B17").NumberFormatLocal = "gg/mm/aaaa"

  # ================================================================ Model.xlsx: calculation sheets
  function DR([string]$col) { "Data!`$$col`$2:`$$col`$$DLAST" }
  $dA = DR "A"; $dB = DR "B"; $dC = DR "C"; $dE = DR "E"; $dF = DR "F"; $dG = DR "G"; $dH = DR "H"; $dI = DR "I"; $dJ = DR "J"; $dK = DR "K"; $dL = DR "L"

  # Calc_Month: the selected bank month by month (rows 2-37 = months 1-36)
  $s = $MW["Calc_Month"]
  Row $s "A1:U1" @("Mese", "Data", "Volumi", "Ricavi", "Costi", "Clienti", "Margine", "Budget", "Scost. %", "YTD volumi", "Anno", "Media mobile 3m", "Volumi USD", "Scenario", "Rango", "Var. m/m", "Cost/income", "Ricavo/cliente", "Esito", "Trimestre", "Media 12m")
  FIt $s "A2:A37" '=RIF.RIGA()-1'
  FIt $s "B2:B37" '=FINE.MESE(DATA(2024;A2;1);0)'
  FIt $s "C2:C37" "=SOMMA.PIÙ.SE($dE;$dA;Control!`$B`$2;$dB;A2)"
  FIt $s "D2:D37" "=SOMMA.PIÙ.SE($dF;$dA;Control!`$B`$2;$dB;A2)"
  FIt $s "E2:E37" "=SOMMA.PIÙ.SE($dG;$dA;Control!`$B`$2;$dB;A2)"
  FIt $s "F2:F37" "=SOMMA.PIÙ.SE($dH;$dA;Control!`$B`$2;$dB;A2)"
  FIt $s "G2:G37" '=D2-E2'
  FIt $s "H2:H37" '=INDICE(Budget!$B$2:$AK$21;Control!$B$6;CONFRONTA(A2;Budget!$B$1:$AK$1;0))'
  FIt $s "I2:I37" '=SE.ERRORE(C2/H2-1;0)'
  FIt $s "J2:J37" '=SOMMA.PIÙ.SE($C$2:$C$37;$K$2:$K$37;K2;$A$2:$A$37;"<="&A2)'
  FIt $s "K2:K37" '=ANNO(B2)'
  FIt $s "L2:L37" '=MEDIA(SCARTO(C2;-MIN(2;A2-1);0;MIN(3;A2);1))'
  FIt $s "M2:M37" '=C2*CERCA.X(A2;FX!$A$2:$A$37;FX!$C$2:$C$37)'
  FIt $s "N2:N37" '=C2*(1+Control!$B$4)^(A2/12)'
  FIt $s "O2:O37" '=RANGO(C2;$C$2:$C$37;0)'
  FIt $s "P2:P37" '=SE.ERRORE(C2-C1;0)'
  FIt $s "Q2:Q37" '=SE.ERRORE(E2/D2;0)'
  FIt $s "R2:R37" '=ARROTONDA(SE.ERRORE(D2/F2;0);2)'
  FIt $s "S2:S37" '=SE(E(I2>0;G2>0);"sopra";SE(O(I2<-0,05;G2<0);"sotto";"in linea"))'
  FIt $s "T2:T37" '="T"&ARROTONDA.PER.ECC(MESE(B2)/3;0)&"-"&ANNO(B2)'
  FIt $s "U2:U37" '=MEDIA.PIÙ.SE($C$2:$C$37;$A$2:$A$37;">"&(A2-12);$A$2:$A$37;"<="&A2)'
  $s.Range("B2:B37").NumberFormatLocal = "gg/mm/aaaa"

  # Calc_Bank: every bank for the selected month (rows 2-21)
  $s = $MW["Calc_Bank"]
  Row $s "A1:AB1" @("Banca", "Regione", "Volumi", "Ricavi", "Costi", "Margine", "Mese prec.", "Var. %", "Anno prec.", "YoY", "Quota", "Rango", "Max mutui", "Media prodotti", "Prodotti sopra media", "Budget", "Gap budget", "Segmento", "Classe", "Codice area", "Quartile", "Selezionata", "Clienti", "Ricavo/cliente", "Scenario", "In regione sel.", "Scost. LET", "YTD")
  FIt $s "A2:A21" '=Banks!A2'
  FIt $s "B2:B21" '=CERCA.VERT(A2;Banks!$A$2:$C$21;3;FALSO)'
  FIt $s "C2:C21" '=SOMMA.PIÙ.SE(Data!$E:$E;Data!$A:$A;A2;Data!$B:$B;Control!$B$3)'
  FIt $s "D2:D21" "=SOMMA.PIÙ.SE($dF;$dA;A2;$dB;Control!`$B`$3)"
  FIt $s "E2:E21" "=SOMMA.PIÙ.SE($dG;$dA;A2;$dB;Control!`$B`$3)"
  FIt $s "F2:F21" '=D2-E2'
  FIt $s "G2:G21" "=SOMMA.PIÙ.SE($dE;$dA;A2;$dB;Control!`$B`$13)"
  FIt $s "H2:H21" '=SE.ERRORE(C2/G2-1;0)'
  FIt $s "I2:I21" "=SOMMA.PIÙ.SE($dE;$dA;A2;$dB;Control!`$B`$14)"
  FIt $s "J2:J21" '=SE.ERRORE(C2/I2-1;0)'
  FIt $s "K2:K21" '=C2/SOMMA($C$2:$C$21)'
  FIt $s "L2:L21" '=RANGO(C2;$C$2:$C$21)'
  FIt $s "M2:M21" "=MAX.PIÙ.SE($dE;$dA;A2;$dC;`"Mutui`")"
  FIt $s "N2:N21" "=MEDIA.PIÙ.SE($dE;$dA;A2;$dB;Control!`$B`$3)"
  FIt $s "O2:O21" "=CONTA.PIÙ.SE($dA;A2;$dB;Control!`$B`$3;$dE;`">`"&N2)"
  FIt $s "P2:P21" '=INDICE(Budget!$B$2:$AK$21;CONFRONTA(A2;Budget!$A$2:$A$21;0);CONFRONTA(Control!$B$3;Budget!$B$1:$AK$1;0))'
  FIt $s "Q2:Q21" '=C2-P2'
  FIt $s "R2:R21" '=CERCA.X(A2;Banks!$A$2:$A$21;Banks!$E$2:$E$21)'
  FIt $s "S2:S21" '=SCEGLI(SE(R2="Grande";1;SE(R2="Media";2;3));"A";"B";"C")'
  FIt $s "T2:T21" '=SWITCH(B2;"Nord-Ovest";"NO";"Nord-Est";"NE";"Centro";"CE";"Sud";"SU";"IS")'
  FIt $s "U2:U21" '=SE(C2>=PERCENTILE($C$2:$C$21;0,75);"primo quartile";SE(C2<=PERCENTILE($C$2:$C$21;0,25);"ultimo quartile";"centrale"))'
  FIt $s "V2:V21" '=SE(A2=Control!$B$2;"<<";"")'
  FIt $s "W2:W21" "=SOMMA.PIÙ.SE($dH;$dA;A2;$dB;Control!`$B`$3)"
  FIt $s "X2:X21" '=SE.ERRORE(D2/W2;0)'
  FIt $s "Y2:Y21" '=C2*(1+Control!$B$4)'
  FIt $s "Z2:Z21" '=SE(B2=Control!$B$5;C2;0)'
  FIt $s "AA2:AA21" '=LET(v;C2;b;P2;SE(b=0;0;ARROTONDA((v-b)/b;4)))'
  FIt $s "AB2:AB21" "=MATR.SOMMA.PRODOTTO(($dA=A2)*($dB<=Control!`$B`$3)*($dJ=Control!`$B`$11)*$dE)"
  $s.Range("A23").Value2 = "Totale"
  FIt $s "C23:G23" '=SOMMA(C2:C21)'
  FIt $s "K23" '=SOMMA(K2:K21)'

  # Calc_Product: the selected bank and month by product (rows 2-9)
  $s = $MW["Calc_Product"]
  Row $s "A1:O1" @("Prodotto", "Volumi", "Ricavi", "Costi", "Margine", "Peso", "Margine pesato", "Quota", "Rango", "YTD", "Mercato", "Quota mercato", "Categoria", "Riga chiave", "Volumi da chiave")
  FIt $s "A2:A9" '=Products!A2'
  FIt $s "B2:B9" "=SOMMA.PIÙ.SE($dE;$dA;Control!`$B`$2;$dB;Control!`$B`$3;$dC;A2)"
  FIt $s "C2:C9" "=SOMMA.PIÙ.SE($dF;$dA;Control!`$B`$2;$dB;Control!`$B`$3;$dC;A2)"
  FIt $s "D2:D9" "=SOMMA.PIÙ.SE($dG;$dA;Control!`$B`$2;$dB;Control!`$B`$3;$dC;A2)"
  FIt $s "E2:E9" '=C2-D2'
  FIt $s "F2:F9" '=CERCA.VERT(A2;Products!$A$2:$C$9;3;FALSO)'
  FIt $s "G2:G9" '=E2*F2'
  FIt $s "H2:H9" '=B2/SOMMA($B$2:$B$9)'
  FIt $s "I2:I9" '=RANGO(B2;$B$2:$B$9)'
  FIt $s "J2:J9" "=SOMMA.PIÙ.SE($dE;$dA;Control!`$B`$2;$dB;`"<=`"&Control!`$B`$3;$dB;`">=`"&Control!`$B`$22;$dC;A2)"
  FIt $s "K2:K9" "=SOMMA.PIÙ.SE($dE;$dC;A2;$dB;Control!`$B`$3)"
  FIt $s "L2:L9" '=B2/K2'
  FIt $s "M2:M9" '=CERCA.X(A2;Products!$A$2:$A$9;Products!$B$2:$B$9)'
  FIt $s "N2:N9" "=SE.ERRORE(CONFRONTA(Control!`$B`$2&`"|`"&Control!`$B`$3&`"|`"&A2;$dL;0);`"n.d.`")"
  FIt $s "O2:O9" "=INDICE($dE;N2)"

  # Calc_Region (rows 2-6)
  $s = $MW["Calc_Region"]
  Row $s "A1:M1" @("Regione", "Banche", "Volumi", "Ricavi", "Margine", "Media banca", "Max banca", "Min banca", "Obiettivo", "Gap", "Quota", "Selezionata", "Migliore")
  FIt $s "A2:A6" '=Aree!A2'
  FIt $s "B2:B6" '=CONTA.SE(Banks!$C$2:$C$21;A2)'
  FIt $s "C2:C6" "=SOMMA.PIÙ.SE($dE;$dI;A2;$dB;Control!`$B`$3)"
  FIt $s "D2:D6" "=SOMMA.PIÙ.SE($dF;$dI;A2;$dB;Control!`$B`$3)"
  FIt $s "E2:E6" '=SOMMA.SE(Calc_Bank!$B$2:$B$21;A2;Calc_Bank!$F$2:$F$21)'
  FIt $s "F2:F6" '=SE.ERRORE(C2/B2;0)'
  FIt $s "G2:G6" '=MAX.PIÙ.SE(Calc_Bank!$C$2:$C$21;Calc_Bank!$B$2:$B$21;A2)'
  FIt $s "H2:H6" '=MIN.PIÙ.SE(Calc_Bank!$C$2:$C$21;Calc_Bank!$B$2:$B$21;A2)'
  FIt $s "I2:I6" '=CERCA.VERT(A2;Aree!$A$2:$C$6;3;FALSO)'
  FIt $s "J2:J6" '=C2-I2'
  FIt $s "K2:K6" '=C2/SOMMA($C$2:$C$6)'
  FIt $s "L2:L6" '=SE(A2=Control!$B$5;"sì";"no")'
  FIt $s "M2:M6" '=INDICE(Calc_Bank!$A$2:$A$21;CONFRONTA(G2;Calc_Bank!$C$2:$C$21;0))'

  # Calc_BankMonth: three 20 x 36 grids (volumes, revenues, scenario volumes) and the totals
  $s = $MW["Calc_BankMonth"]
  $hdr = New-Object 'object[,]' 1, 37; $hdr[0, 0] = "Banca \ mese"; for ($m = 1; $m -le $NM; $m++) { $hdr[0, $m] = $m }
  foreach ($top in @(2, 25, 48)) { $s.Range("A${top}:AK${top}").Value2 = $hdr; Col $s ($top + 1) 1 $banks }
  $s.Range("A1").Value2 = "Volumi"; $s.Range("A24").Value2 = "Ricavi"; $s.Range("A47").Value2 = "Scenario volumi"
  FIt $s "B3:AK22" "=SOMMA.PIÙ.SE($dE;$dA;`$A3;$dB;B`$2)"
  FIt $s "B26:AK45" "=SOMMA.PIÙ.SE($dF;$dA;`$A26;$dB;B`$25)"
  FIt $s "B49:AK68" '=B3*(1+Control!$B$4)^(B$48/12)'
  $s.Range("A23").Value2 = "Totale"; FIt $s "B23:AK23" '=SOMMA(B3:B22)'
  $s.Range("A46").Value2 = "Totale"; FIt $s "B46:AK46" '=SOMMA(B26:B45)'

  # Calc_Growth: month-on-month growth (C3:AK22) and its statistics
  $s = $MW["Calc_Growth"]
  $s.Range("A2:AK2").Value2 = $hdr; Col $s 3 1 $banks
  Row $s "AM2:AP2" @("Media", "Max", "Min", "Mese max")
  FIt $s "C3:AK22" '=SE.ERRORE(Calc_BankMonth!C3/Calc_BankMonth!B3-1;0)'
  FIt $s "AM3:AM22" '=MEDIA(C3:AK3)'
  FIt $s "AN3:AN22" '=MAX(C3:AK3)'
  FIt $s "AO3:AO22" '=MIN(C3:AK3)'
  FIt $s "AP3:AP22" '=CONFRONTA(AN3;C3:AK3;0)+1'

  # Calc_Scenario: volumes x monthly rate compounding x USD (HLOOKUP on the horizontal FX table)
  $s = $MW["Calc_Scenario"]
  FIt $s "B2:AK2" '=Calc_BankMonth!B2'
  Col $s 3 1 $banks
  FIt $s "B3:AK22" '=Calc_BankMonth!B3*(1+Control!$B$25)^B$2*CERCA.ORIZZ(B$2;FX!$B$40:$AK$43;2;FALSO)'
  $s.Range("AL2").Value2 = "Mese sel."
  FIt $s "AL3:AL22" '=INDICE(B3:AK3;Control!$B$3)'

  # Calc_Stats: top 10 / bottom 5 and statistics of the month's volumes
  $s = $MW["Calc_Stats"]
  Row $s "A1:F1" @("k", "Volumi", "Banca", "Regione", "Quota", "Var. %")
  Col $s 2 1 @(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
  FIt $s "B2:B11" '=GRANDE(Calc_Bank!$C$2:$C$21;A2)'
  FIt $s "C2:C11" '=INDICE(Calc_Bank!$A$2:$A$21;CONFRONTA(B2;Calc_Bank!$C$2:$C$21;0))'
  FIt $s "D2:D11" '=CERCA.X(C2;Calc_Bank!$A$2:$A$21;Calc_Bank!$B$2:$B$21)'
  FIt $s "E2:E11" '=B2/SOMMA(Calc_Bank!$C$2:$C$21)'
  FIt $s "F2:F11" '=CERCA.X(C2;Calc_Bank!$A$2:$A$21;Calc_Bank!$H$2:$H$21)'
  Col $s 14 1 @(1, 2, 3, 4, 5)
  FIt $s "B14:B18" '=PICCOLO(Calc_Bank!$C$2:$C$21;A14)'
  FIt $s "C14:C18" '=INDICE(Calc_Bank!$A$2:$A$21;CONFRONTA(B14;Calc_Bank!$C$2:$C$21;0))'
  Col $s 2 8 @("Mediana", "Dev. st.", "90° percentile", "1° quartile", "Media", "Campo", "Banche in crescita", "Concentrazione", "Radice", "Media arrot.", "Percent. rango sel.", "Media prodotti")
  FIt $s "I2" '=MEDIANA(Calc_Bank!C2:C21)'
  FIt $s "I3" '=DEV.ST.C(Calc_Bank!C2:C21)'
  FIt $s "I4" '=INC.PERCENTILE(Calc_Bank!C2:C21;0,9)'
  FIt $s "I5" '=INC.QUARTILE(Calc_Bank!C2:C21;1)'
  FIt $s "I6" '=MEDIA(Calc_Bank!C2:C21)'
  FIt $s "I7" '=MAX(Calc_Bank!C2:C21)-MIN(Calc_Bank!C2:C21)'
  FIt $s "I8" '=CONTA.SE(Calc_Bank!H2:H21;">0")'
  FIt $s "I9" '=MATR.SOMMA.PRODOTTO(Calc_Bank!K2:K21;Calc_Bank!K2:K21)'
  FIt $s "I10" '=RADQ(I9)'
  FIt $s "I11" '=ARROTONDA.PER.DIF(I6;-1)'
  FIt $s "I12" '=PERCENT.RANGO(Calc_Bank!C2:C21;CERCA.X(Control!B2;Calc_Bank!A2:A21;Calc_Bank!C2:C21))'
  FIt $s "I13" '=MEDIA(Calc_Product!B2:B9)'

  # Calc_Text (rows 2-21)
  $s = $MW["Calc_Text"]
  Row $s "A1:P1" @("Banca", "Sigla", "Nome", "Estratto", "Responsabile", "Codice", "Breve", "Email", "Proprio", "Stelle", "Volumi testo", "Elenco", "Numero codice", "Lunghezza", "Accento", "Etichetta")
  FIt $s "A2:A21" '=Banks!A2'
  FIt $s "B2:B21" '=MAIUSC(SINISTRA(A2;5))'
  FIt $s "C2:C21" '=DESTRA(A2;LUNGHEZZA(A2)-TROVA(" ";A2))'
  FIt $s "D2:D21" '=STRINGA.ESTRAI(A2;7;3)'
  FIt $s "E2:E21" '=ANNULLA.SPAZI(Banks!D2)'
  FIt $s "F2:F21" '=CONCATENA(Banks!B2;"-";SINISTRA(Banks!C2;3))'
  FIt $s "G2:G21" '=SOSTITUISCI(A2;"Banca";"Bk")'
  FIt $s "H2:H21" '=MINUSC(C2)&"@esempio.it"'
  FIt $s "I2:I21" '=MAIUSC.INIZ(MINUSC(A2))'
  FIt $s "J2:J21" '=RIPETI("*";Calc_Bank!L2)'
  FIt $s "K2:K21" '=TESTO(Calc_Bank!C2;"#.##0,0")'
  FIt $s "L2:L21" '=TESTO.UNISCI(", ";VERO;A2;B2;Calc_Bank!R2)'
  FIt $s "M2:M21" '=VALORE(DESTRA(Banks!B2;3))'
  FIt $s "N2:N21" '=LUNGHEZZA(E2)'
  FIt $s "O2:O21" '=SE(VAL.NUMERO(TROVA("à";A2));"accento";"-")'
  FIt $s "P2:P21" '=A2&" ("&Calc_Bank!T2&") "&TESTO(Calc_Bank!K2;"0,0%")'

  # Calc_Dates (rows 2-37)
  $s = $MW["Calc_Dates"]
  Row $s "A1:P1" @("Mese", "Inizio", "Fine", "+12 mesi", "Anno", "Mese", "Giorno", "Giorno sett.", "Giorni lav.", "Giorni", "Mesi da rif.", "Stato", "Etichetta", "Trimestre", "Fine rel.", "Primo lav. dopo")
  FIt $s "A2:A37" '=RIF.RIGA()-1'
  FIt $s "B2:B37" '=DATA(2024;A2;1)'
  FIt $s "C2:C37" '=FINE.MESE(B2;0)'
  FIt $s "D2:D37" '=DATA.MESE(B2;12)'
  FIt $s "E2:E37" '=ANNO(C2)'
  FIt $s "F2:F37" '=MESE(C2)'
  FIt $s "G2:G37" '=GIORNO(C2)'
  FIt $s "H2:H37" '=GIORNO.SETTIMANA(C2;2)'
  FIt $s "I2:I37" '=GIORNI.LAVORATIVI.TOT(B2;C2)'
  FIt $s "J2:J37" '=C2-B2+1'
  FIt $s "K2:K37" '=SE(C2<=Control!$B$9;DATA.DIFF(C2;Control!$B$9;"m");-DATA.DIFF(Control!$B$9;C2;"m"))'
  FIt $s "L2:L37" '=SE(C2=Control!$B$9;"corrente";SE(C2<Control!$B$9;"passato";"futuro"))'
  FIt $s "M2:M37" '=TESTO(C2;"mmm-aa")'
  FIt $s "N2:N37" '=INT((F2-1)/3)+1'
  FIt $s "O2:O37" '=FINE.MESE(Control!$B$9;-(A2-1))'
  FIt $s "P2:P37" '=GIORNO.LAVORATIVO(C2;1)'
  $s.Range("B2:D37").NumberFormatLocal = "gg/mm/aaaa"; $s.Range("O2:P37").NumberFormatLocal = "gg/mm/aaaa"

  # Calc_Dynamic: spilling functions (FILTER's size follows the region), XLOOKUP's match / search modes
  $s = $MW["Calc_Dynamic"]
  Row $s "A1:N1" @("Banche della regione", "", "Ordinate", "", "", "", "Prodotti", "", "Sequenza", "Ultimi 12", "", "Per volumi", "", "")
  FIt $s "A2" '=FILTRO(Banks!A2:A21;Banks!C2:C21=Control!B5;"nessuna")'
  FIt $s "C2" '=DATI.ORDINA(Calc_Bank!A2:C21;3;-1)'
  FIt $s "G2" '=UNICI(Data!C2:C5761)'
  FIt $s "I2" '=SEQUENZA(12)'
  FIt $s "J2" '=Control!B3-12+SEQUENZA(12)'
  FIt $s "L2" '=DATI.ORDINA.PER(Banks!A2:A21;Calc_Bank!C2:C21;-1)'
  FIt $s "A30" '=MATR.TRASPOSTA(Calc_Month!C2:C13)'
  Col $s 2 16 @("CONFRONTA.X", "LET media", "CERCA.X non trovato", "CERCA.X successivo", "CERCA.X precedente", "CERCA.X jolly", "CERCA.X dal fondo", "SOMMA(FILTRO)", "CONTA regione", "PIÙ.SE")
  FIt $s "Q2" '=CONFRONTA.X(Control!B2;Banks!A2:A21)'
  FIt $s "Q3" '=LET(x;Calc_Bank!C2:C21;SOMMA(x)/CONTA.NUMERI(x))'
  FIt $s "Q4" '=CERCA.X(Control!B3+100;FX!A2:A37;FX!C2:C37;"fuori";0)'
  FIt $s "Q5" '=CERCA.X(Control!B3+0,5;FX!A2:A37;FX!C2:C37;;1)'
  FIt $s "Q6" '=CERCA.X(Control!B3-0,5;FX!A2:A37;FX!C2:C37;;-1)'
  FIt $s "Q7" '=CERCA.X("Banca T*";Banks!A2:A21;Banks!B2:B21;"n.d.";2)'
  FIt $s "Q8" "=CERCA.X(Control!B2;Data!A2:A$DLAST;Data!E2:E$DLAST;0;0;-1)"
  FIt $s "Q9" '=SOMMA(FILTRO(Calc_Bank!C2:C21;Calc_Bank!B2:B21=Control!B5;0))'
  FIt $s "Q10" '=RIGHE(FILTRO(Banks!A2:A21;Banks!C2:C21=Control!B5))'
  FIt $s "Q11" '=PIÙ.SE(Q9>50000;"alto";Q9>20000;"medio";VERO;"basso")'

  # Calc_Names: formulas through the workbook's defined names
  $s = $MW["Calc_Names"]
  Col $s 2 1 @("Volumi sel.", "Scenario", "Banche regione", "Prima banca", "Imposta", "Totale netto", "Etichetta", "Nome calcolato")
  FIt $s "B2" '=SOMMA.PIÙ.SE(D_Vol;D_Bank;SelBank;D_Month;SelMonth)'
  FIt $s "B3" '=B2*(1+Rate)'
  FIt $s "B4" '=CONTA.SE(BankRegion;SelRegion)'
  FIt $s "B5" '=INDICE(BankList;1)'
  FIt $s "B6" '=TaxRate*B2'
  FIt $s "B7" '=SOMMA(Calc_Bank!C2:C21)*(1-TaxRate)'
  FIt $s "B8" '=SelBank&" / "&SelRegion'
  FIt $s "B9" '=VolSel'
  FIt $s "A11:A30" '=INDICE(BankList;RIF.RIGA()-10)'
  FIt $s "B11:B30" '=SOMMA.PIÙ.SE(D_Vol;D_Bank;A11;D_Month;SelMonth)'

  # Calc_Indirect: INDIRECT / OFFSET / ADDRESS
  $s = $MW["Calc_Indirect"]
  Col $s 2 1 @("INDIRETTO mese", "INDIRETTO slide", "INDIRETTO riga", "SCARTO cella", "SCARTO trimestre", "INDIRIZZO", "RIGHE")
  FIt $s "B2" '=INDIRETTO("Calc_Month!C"&(Control!$B$3+1))'
  FIt $s "B3" '=INDIRETTO("''SLIDE Sintesi''!D5")'
  FIt $s "B4" '=SOMMA(INDIRETTO("Calc_BankMonth!B"&(Control!$B$6+2)&":AK"&(Control!$B$6+2)))'
  FIt $s "B5" '=SCARTO(Calc_BankMonth!$A$2;Control!$B$6;Control!$B$3)'
  FIt $s "B6" '=SOMMA(SCARTO(Calc_Month!$C$1;Control!$B$3-2;0;3;1))'
  FIt $s "B7" '=INDIRETTO(INDIRIZZO(Control!$B$3+1;3;1;1;"Calc_Month"))'
  FIt $s "B8" '=RIGHE(Calc_Month!A2:A37)'
  FIt $s "A12:A31" '=Banks!A2'
  FIt $s "B12:B31" '=INDICE(SCARTO(Calc_BankMonth!$B$3;0;0;20;36);RIF.RIGA()-11;Control!$B$3)'

  # Calc_Deep: a chain several sheets deep, per bank (rows 2-21)
  $s = $MW["Calc_Deep"]
  Row $s "A1:K1" @("Banca", "L1 USD", "L2 +scenario", "L3 crescita", "L4 regione", "L5 statistica", "L6 arrot.", "L7 indice", "L8 date", "L9 classe", "L10 rango")
  FIt $s "A2:A21" '=Calc_Bank!A2'
  FIt $s "B2:B21" '=Calc_Bank!C2*Control!$B$15'
  FIt $s "C2:C21" '=B2+Calc_Scenario!AL3/100'
  FIt $s "D2:D21" '=C2*(1+Calc_Growth!AM3)'
  FIt $s "E2:E21" '=D2-CERCA.X(Calc_Bank!B2;Calc_Region!$A$2:$A$6;Calc_Region!$F$2:$F$6)*0,01'
  FIt $s "F2:F21" '=E2+Calc_Stats!$I$2*0,001'
  FIt $s "G2:G21" '=ARROTONDA(F2;2)'
  FIt $s "H2:H21" '=G2/MAX(1;Calc_Month!$C$2)*1000'
  FIt $s "I2:I21" '=H2+Calc_Dates!$J$2'
  FIt $s "J2:J21" '=SE(I2>MEDIA($I$2:$I$21);"alto";"basso")'
  FIt $s "K2:K21" '=RANGO(I2;$I$2:$I$21)'

  # Calc_Summary: the selected bank's figures from every sheet (rows 2-20)
  $s = $MW["Calc_Summary"]
  Row $s "A1:E1" @("Voce", "Valore", "Riferimento", "Var.", "Var. %")
  Col $s 2 1 @("Volumi", "Ricavi", "Costi", "Margine", "Clienti", "Budget", "Rango", "Quota", "YTD", "Scenario", "Quota regione", "Prodotto top", "Profondità", "Crescita media", "Mediana sistema", "Titolo", "Media 12m", "Media mobile")
  $mc = @("C", "D", "E", "G", "F")
  for ($i = 0; $i -lt 5; $i++) {
    $row = 2 + $i; $cc = $mc[$i]
    FIt $s "B$row" "=INDICE(Calc_Month!`$$cc`$2:`$$cc`$37;Control!`$B`$3)"
    FIt $s "C$row" "=INDICE(Calc_Month!`$$cc`$2:`$$cc`$37;Control!`$B`$13)"
    FIt $s "D$row" "=B$row-C$row"
    FIt $s "E$row" "=SE.ERRORE(D$row/C$row;0)"
  }
  FIt $s "B7" '=INDICE(Calc_Month!$H$2:$H$37;Control!$B$3)'
  FIt $s "B8" '=CERCA.X(Control!$B$2;Calc_Bank!$A$2:$A$21;Calc_Bank!$L$2:$L$21)'
  FIt $s "B9" '=CERCA.X(Control!$B$2;Calc_Bank!$A$2:$A$21;Calc_Bank!$K$2:$K$21)'
  FIt $s "B10" '=INDICE(Calc_Month!$J$2:$J$37;Control!$B$3)'
  FIt $s "B11" '=INDICE(Calc_Scenario!$B$3:$AK$22;Control!$B$6;Control!$B$3)'
  FIt $s "B12" '=CERCA.X(Control!$B$8;Calc_Region!$A$2:$A$6;Calc_Region!$K$2:$K$6)'
  FIt $s "B13" '=INDICE(Calc_Product!$A$2:$A$9;CONFRONTA(MAX(Calc_Product!$B$2:$B$9);Calc_Product!$B$2:$B$9;0))'
  FIt $s "B14" '=CERCA.X(Control!$B$2;Calc_Deep!$A$2:$A$21;Calc_Deep!$I$2:$I$21)'
  FIt $s "B15" '=INDICE(Calc_Growth!$AM$3:$AM$22;Control!$B$6)'
  FIt $s "B16" '=Calc_Stats!$I$2'
  FIt $s "B17" '=Control!$B$16'
  FIt $s "B18" '=INDICE(Calc_Month!$U$2:$U$37;Control!$B$3)'
  FIt $s "B19" '=INDICE(Calc_Month!$L$2:$L$37;Control!$B$3)'
  FIt $s "C7:C19" '=SE(VAL.NUMERO(B7);ARROTONDA(B7;2);B7)'
  "Model calc sheets: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Model.xlsx: slides
  $L12 = 12
  Slide $MW["SLIDE Sintesi"] '="Sintesi - "&Control!$B$16' @("Voce", "Mese", "Mese prec.", "Var.", "Var. %") 5 @(
    [object[]]@("Volumi", "Ricavi", "Costi", "Margine", "Clienti"), '=Calc_Summary!B2', '=Calc_Summary!C2', '=D5-E5', '=SE.ERRORE(F5/E5;"-")')
  $MW["SLIDE Sintesi"].Range("D5:F9").NumberFormatLocal = "#.##0,0"; $MW["SLIDE Sintesi"].Range("G5:G9").NumberFormatLocal = "0,0%"
  Slide $MW["SLIDE Ranking"] '="Classifica - "&Control!$B$10' @("Pos.", "Banca", "Regione", "Volumi", "Quota", "Var. %") 10 @(
    '=Calc_Stats!A2', '=Calc_Stats!C2', '=Calc_Stats!D2', '=Calc_Stats!B2', '=Calc_Stats!E2', '=Calc_Stats!F2')
  Slide $MW["SLIDE Regioni"] '="Regioni - mese "&Control!$B$3' @("Regione", "Banche", "Volumi", "Obiettivo", "Gap", "Quota", "Migliore", "Sel.") 5 @(
    '=Calc_Region!A2', '=Calc_Region!B2', '=Calc_Region!C2', '=Calc_Region!I2', '=Calc_Region!J2', '=Calc_Region!K2', '=Calc_Region!M2', '=Calc_Region!L2')
  Slide $MW["SLIDE Prodotti"] '="Prodotti - "&Control!$B$2' @("Prodotto", "Categoria", "Volumi", "Margine", "Quota", "Quota mercato", "YTD", "Verifica") 8 @(
    '=Calc_Product!A2', '=Calc_Product!M2', '=Calc_Product!B2', '=Calc_Product!E2', '=Calc_Product!H2', '=Calc_Product!L2', '=Calc_Product!J2', '=SE(Calc_Product!O2=Calc_Product!B2;"ok";"diverso")')
  Slide $MW["SLIDE Budget"] '="Budget - "&Control!$B$2' @("Mese", "Effettivo", "Budget", "Budget (ORIZZ)", "Scost.", "Ricavi budget") 6 @(
    '=Control!$B$3-6+RIF.RIGA()-4', '=INDICE(Calc_Month!$C$2:$C$37;C5)', '=INDICE(Budget!$B$2:$AK$21;Control!$B$6;CONFRONTA(C5;Budget!$B$1:$AK$1;0))',
    '=CERCA.ORIZZ(C5;Budget!$B$1:$AK$21;Control!$B$6+1;FALSO)', '=SE.ERRORE(D5/E5-1;0)', '=INDICE(Budget!$B$25:$AK$44;CONFRONTA(Control!$B$2;Budget!$A$25:$A$44;0);C5)')
  Slide $MW["SLIDE FX"] '="Volumi in valuta - "&Control!$B$2' @("Mese", "EUR", "USD", "GBP", "CHF") 6 @(
    '=Control!$B$3-6+RIF.RIGA()-4', '=INDICE(Calc_Month!$C$2:$C$37;C5)', '=D5*CERCA.VERT(C5;FX!$A$2:$E$37;3;FALSO)', '=D5*CERCA.X(C5;FX!$A$2:$A$37;FX!$D$2:$D$37)', '=D5*INDICE(FX!$E$2:$E$37;C5)')
  Slide $MW["SLIDE Scenario"] '="Scenario al "&TESTO(Control!$B$4;"0,0%")' @("Banca", "Base", "Scenario", "Delta", "Scenario USD") 20 @(
    '=Banks!A2', '=INDICE(Calc_BankMonth!$B3:$AK3;Control!$B$3)', '=INDICE(Calc_BankMonth!$B49:$AK49;Control!$B$3)', '=E5-D5', '=Calc_Scenario!AL3')
  $hm = @('=Banks!A2'); for ($k = 5; $k -ge 0; $k--) { $hm += ('=INDICE(Calc_Growth!$C3:$AK3;Control!$B$3-1-' + $k + ')') }
  Slide $MW["SLIDE Heatmap"] '="Crescita m/m - ultimi 6 mesi"' @("Banca", "m-5", "m-4", "m-3", "m-2", "m-1", "m") 20 $hm
  Slide $MW["SLIDE Peers"] '="Confronto peer - "&Control!$B$2' @("Banca", "Volumi", "Peer", "Gap", "Gap %") 20 @(
    '=Calc_Links!A20', '=Calc_Bank!C2', '=Calc_Links!B20', '=D5-E5', '=Calc_Links!C20')
  Slide $MW["SLIDE Aree"] '="Aree (da Regions.xlsx)"' @("Voce", "Valore") 6 @(
    [object[]]@("Totale regioni", "Gap regione sel.", "Gap peer totale", "Gap peer sel.", "Rango peer", "Regione sel."), '=Calc_Links!B10')
  Slide $MW["SLIDE Testi"] '="Anagrafica testi"' @("Banca", "Sigla", "Email", "Elenco", "Volumi", "Etichetta", "Stelle") 20 @(
    '=Calc_Text!A2', '=Calc_Text!B2', '=Calc_Text!H2', '=Calc_Text!L2', '=Calc_Text!K2', '=Calc_Text!P2', '=Calc_Text!J2')
  Slide $MW["SLIDE Date"] '="Calendario - "&Control!$B$10' @("Mese", "Fine", "Giorni lav.", "Stato", "Etichetta", "Mesi da rif.") 12 @(
    '=Control!$B$3-12+RIF.RIGA()-4', '=INDICE(Calc_Dates!$C$2:$C$37;C5)', '=INDICE(Calc_Dates!$I$2:$I$37;C5)', '=INDICE(Calc_Dates!$L$2:$L$37;C5)', '=INDICE(Calc_Dates!$M$2:$M$37;C5)', '=INDICE(Calc_Dates!$K$2:$K$37;C5)')
  $MW["SLIDE Date"].Range("D5:D16").NumberFormatLocal = "gg/mm/aaaa"
  Slide $MW["SLIDE Dinamica"] '="Banche della regione "&Control!$B$5' @("Banca", "Volumi", "Ordine", "Sel.") 8 @(
    '=SE.ERRORE(INDICE(Calc_Dynamic!$A$2:$A$21;RIF.RIGA()-4)&"";"")', '=SE(C5="";"";SOMMA.PIÙ.SE(Calc_Bank!$C$2:$C$21;Calc_Bank!$A$2:$A$21;C5))', '=INDICE(Calc_Dynamic!$L$2:$L$21;RIF.RIGA()-4)', '=SE(C5=Control!$B$2;"<<";"")')
  FIt $MW["SLIDE Dinamica"] "H5" '=FILTRO(Calc_Bank!A2:A21;Calc_Bank!B2:B21=Control!B5)'      # a spill inside a slide sheet
  $q = @(); for ($i = 0; $i -lt 12; $i++) { $q += ("T" + (($i % 4) + 1) + "-" + (2024 + [Math]::Floor($i / 4))) }
  Slide $MW["SLIDE Trimestri"] '="Trimestri - "&Control!$B$2' @("Trimestre", "Volumi", "Ricavi", "Margine", "Media mensile") 12 @(
    [object[]]$q, '=SOMMA.SE(Calc_Month!$T$2:$T$37;C5;Calc_Month!$C$2:$C$37)', '=SOMMA.SE(Calc_Month!$T$2:$T$37;C5;Calc_Month!$D$2:$D$37)', '=SOMMA.SE(Calc_Month!$T$2:$T$37;C5;Calc_Month!$G$2:$G$37)', '=MEDIA.SE(Calc_Month!$T$2:$T$37;C5;Calc_Month!$C$2:$C$37)')
  Slide $MW["SLIDE Segmenti"] '="Segmenti - mese "&Control!$B$3' @("Segmento", "Banche", "Volumi", "Margine", "Quota") 3 @(
    [object[]]@("Grande", "Media", "Piccola"), '=CONTA.SE(Calc_Bank!$R$2:$R$21;C5)', '=SOMMA.SE(Calc_Bank!$R$2:$R$21;C5;Calc_Bank!$C$2:$C$21)', '=SOMMA.SE(Calc_Bank!$R$2:$R$21;C5;Calc_Bank!$F$2:$F$21)', '=E5/Calc_Bank!$C$23')
  Slide $MW["SLIDE Profondita"] '="Catena di calcolo"' @("Banca", "L1", "L4", "L7", "L9", "Classe", "Rango") 20 @(
    '=Calc_Deep!A2', '=Calc_Deep!B2', '=Calc_Deep!E2', '=Calc_Deep!H2', '=Calc_Deep!I2', '=Calc_Deep!J2', '=Calc_Deep!K2')
  Slide $MW["SLIDE Nomi"] '="Nomi definiti - "&SelBank' @("Banca", "Volumi", "Netto") 20 @(
    '=Calc_Names!A11', '=Calc_Names!B11', '=D5*(1-TaxRate)')
  Slide $MW["SLIDE Indiretti"] '="Riferimenti indiretti"' @("Banca", "Volumi mese", "Diretto", "Uguale") 20 @(
    '=Calc_Indirect!A12', '=Calc_Indirect!B12', '=INDICE(Calc_BankMonth!$B$3:$AK$22;RIF.RIGA()-4;Control!$B$3)', '=SE(D5=E5;"sì";"no")')
  Slide $MW["SLIDE Controlli"] '="Controlli di quadratura"' @("Controllo", "Valore", "Atteso", "Esito") 6 @(
    [object[]]@("Volumi banche = griglia", "Prodotti = banca", "Regioni = banche", "Chiave = SOMMA.PIÙ.SE", "Nomi = diretto", "Indiretto = diretto"),
    '=SCEGLI(RIF.RIGA()-4;Calc_Bank!$C$23;SOMMA(Calc_Product!$B$2:$B$9);SOMMA(Calc_Region!$C$2:$C$6);SOMMA(Calc_Product!$O$2:$O$9);Calc_Names!$B$2;Calc_Indirect!$B$2)',
    '=SCEGLI(RIF.RIGA()-4;INDICE(Calc_BankMonth!$B$23:$AK$23;Control!$B$3);Calc_Summary!$B$2;Calc_Bank!$C$23;SOMMA(Calc_Product!$B$2:$B$9);Calc_Summary!$B$2;Calc_Summary!$B$2)',
    '=SE(VAL.ERRORE(D5-E5);"errore";SE(ASS(D5-E5)<0,001;"ok";"KO"))')
  $tm = @(@("Volumi", "C", "E"), @("Ricavi", "D", "F"), @("Costi", "E", "G"), @("Clienti", "F", "H"), @("Margine", "G", "K"))
  foreach ($t in $tm) {
    $mcol = $t[1]; $dcol = $t[2]
    Slide $MW["SLIDE Trend " + $t[0]] ('="' + $t[0] + ' - "&Control!$B$2&" - ultimi 12 mesi"') @("Mese", "Data", "Banca", "Sistema (media)", "Regione (media)", "Gap", "Gap %", "Indice") $L12 @(
      '=Control!$B$3-12+RIF.RIGA()-4', '=INDICE(Calc_Dates!$C$2:$C$37;C5)', "=INDICE(Calc_Month!`$$mcol`$2:`$$mcol`$37;C5)",
      "=SOMMA.PIÙ.SE(Data!`$$dcol`$2:`$$dcol`$$DLAST;$dB;C5)/20",
      "=SOMMA.PIÙ.SE(Data!`$$dcol`$2:`$$dcol`$$DLAST;$dI;Control!`$B`$8;$dB;C5)/CONTA.SE(Banks!`$C`$2:`$C`$21;Control!`$B`$8)",
      '=E5-F5', '=SE.ERRORE(H5/F5;0)', '=ARROTONDA(E5/$E$5*100;1)')
    $MW["SLIDE Trend " + $t[0]].Range("D5:D16").NumberFormatLocal = "gg/mm/aaaa"
  }
  "Model slides: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Peers.xlsx (English)
  $s = $PW["PeerData"]
  Row $s "A1:G1" @("Bank", "Month", "PeerVolume", "PeerRevenue", "PeerCost", "PeerGroup", "Key")
  $a = New-Object 'object[,]' ($NB * $NM), 6; $r = 0
  for ($b = 0; $b -lt $NB; $b++) { for ($m = 1; $m -le $NM; $m++) {
    $v = (800 + $b * 137) * 7.1 * (1 + 0.0075 * $m) + $rnd.Next(-200, 200) + $rnd.NextDouble()
    $a[$r, 0] = $banks[$b]; $a[$r, 1] = $m; $a[$r, 2] = [Math]::Round($v, 1); $a[$r, 3] = [Math]::Round($v * 0.05, 2); $a[$r, 4] = [Math]::Round($v * 0.031, 2); $a[$r, 5] = "G" + (1 + $b % 4); $r++ } }
  $s.Range("A2:F721").Value2 = $a
  FE $s "G2:G721" '=A2&"|"&B2'
  $s = $PW["PeerMaster"]
  Row $s "A1:D1" @("Bank", "PeerGroup", "Tier", "Weight")
  $a = New-Object 'object[,]' $NB, 4
  for ($b = 0; $b -lt $NB; $b++) { $a[$b, 0] = $banks[$b]; $a[$b, 1] = "G" + (1 + $b % 4); $a[$b, 2] = 1 + $b % 3; $a[$b, 3] = [Math]::Round(1 - 0.01 * $b, 2) }
  $s.Range("A2:D21").Value2 = $a

  $s = $PW["Link"]
  Col $s 2 1 @("Bank", "Month", "Rate", "Region", "Bank index", "Label", "Bank region")
  FE $s "B2" '=''[Model.xlsx]Control''!$B$2'
  FE $s "B3" '=''[Model.xlsx]Control''!$B$3'
  FE $s "B4" '=''[Model.xlsx]Control''!$B$4'
  FE $s "B5" '=''[Model.xlsx]Control''!$B$5'
  FE $s "B6" '=''[Model.xlsx]Control''!$B$6'
  FE $s "B7" '=''[Model.xlsx]Control''!$B$10'
  FE $s "B8" '=''[Model.xlsx]Control''!$B$8'
  Row $s "A10:E10" @("Bank", "Volume", "Revenue", "Cost", "Rank")
  FE $s "A11:A30" '=''[Model.xlsx]Calc_Bank''!A2'
  FE $s "B11:B30" '=''[Model.xlsx]Calc_Bank''!C2'
  FE $s "C11:C30" '=''[Model.xlsx]Calc_Bank''!D2'
  FE $s "D11:D30" '=''[Model.xlsx]Calc_Bank''!E2'
  FE $s "E11:E30" '=''[Model.xlsx]Calc_Bank''!L2'
  Row $s "A33:C33" @("Month", "Volume", "Revenue")
  FE $s "A34:A69" '=ROW()-33'
  FE $s "B34:B69" '=''[Model.xlsx]Calc_Month''!C2'
  FE $s "C34:C69" '=INDEX(''[Model.xlsx]Calc_Month''!$D$2:$D$37,A34)'

  $s = $PW["Compare"]
  Row $s "A1:P1" @("Bank", "Own volume", "Peer volume", "Peer revenue", "Gap", "Gap %", "Group", "Tier", "Rank", "Position", "Tier name", "Ratio", "Group avg", "Ahead in group", "Best in group", "Selected")
  FE $s "A2:A21" '=Link!A11'
  FE $s "B2:B21" '=Link!B11'
  FE $s "C2:C21" '=SUMIFS(PeerData!$C$2:$C$721,PeerData!$A$2:$A$721,A2,PeerData!$B$2:$B$721,Link!$B$3)'
  FE $s "D2:D21" '=XLOOKUP(A2&"|"&Link!$B$3,PeerData!$G$2:$G$721,PeerData!$D$2:$D$721,0)'
  FE $s "E2:E21" '=B2-C2'
  FE $s "F2:F21" '=IFERROR(E2/C2,0)'
  FE $s "G2:G21" '=VLOOKUP(A2,PeerMaster!$A$2:$D$21,2,FALSE)'
  FE $s "H2:H21" '=INDEX(PeerMaster!$C$2:$C$21,MATCH(A2,PeerMaster!$A$2:$A$21,0))'
  FE $s "I2:I21" '=RANK.EQ(F2,$F$2:$F$21)'
  FE $s "J2:J21" '=IFS(F2>0.05,"ahead",F2<-0.05,"behind",TRUE,"in line")'
  FE $s "K2:K21" '=SWITCH(H2,1,"Tier one",2,"Tier two","Other")'
  FE $s "L2:L21" '=LET(a,B2,b,C2,IF(b=0,0,ROUND(a/b,4)))'
  FE $s "M2:M21" '=AVERAGEIFS($C$2:$C$21,$G$2:$G$21,G2)'
  FE $s "N2:N21" '=COUNTIFS($G$2:$G$21,G2,$F$2:$F$21,">0")'
  FE $s "O2:O21" '=MAXIFS($F$2:$F$21,$G$2:$G$21,G2)'
  FE $s "P2:P21" '=IF(A2=Link!$B$2,"<<","")'

  $s = $PW["PeerGrid"]
  $s.Range("A2:AK2").Value2 = $hdr; Col $s 3 1 $banks
  FE $s "B3:AK22" '=SUMIFS(PeerData!$C$2:$C$721,PeerData!$A$2:$A$721,$A3,PeerData!$B$2:$B$721,B$2)'
  $s.Range("A24").Value2 = "Selected (HLOOKUP)"
  FE $s "B24" '=HLOOKUP(Link!$B$3,$B$2:$AK$22,Link!$B$6+1,FALSE)'

  $s = $PW["PeerTrend"]
  Row $s "A1:H1" @("Month", "Own", "Peer", "Gap", "Ratio", "Cumulative peer", "Grid", "Rolling 3")
  FE $s "A2:A37" '=ROW()-1'
  FE $s "B2:B37" '=Link!B34'
  FE $s "C2:C37" '=SUMIFS(PeerData!C:C,PeerData!A:A,Link!$B$2,PeerData!B:B,A2)'
  FE $s "D2:D37" '=B2-C2'
  FE $s "E2:E37" '=IFERROR(B2/C2,0)'
  FE $s "F2:F37" '=SUM($C$2:C2)'
  FE $s "G2:G37" '=HLOOKUP(A2,PeerGrid!$B$2:$AK$22,Link!$B$6+1,FALSE)'
  FE $s "H2:H37" '=AVERAGE(OFFSET(C2,-MIN(2,A2-1),0,MIN(3,A2),1))'

  $s = $PW["Summary"]
  Col $s 2 1 @("Gap % selected", "Peer rank selected", "Total gap", "Banks ahead", "Month code", "Gap label", "Peer avg volume", "Model check", "Days since 2026")
  FE $s "B2" '=XLOOKUP(Link!B2,Compare!A2:A21,Compare!F2:F21)'
  FE $s "B3" '=XLOOKUP(Link!B2,Compare!A2:A21,Compare!I2:I21)'
  FE $s "B4" '=SUM(Compare!E2:E21)'
  FE $s "B5" '=COUNTIF(Compare!J2:J21,"ahead")'
  FE $s "B6" '=TEXT(Link!B3,"00")'
  FE $s "B7" '=TEXT(B2,"0.0%")'
  FE $s "B8" '=AVERAGE(Compare!C2:C21)'
  FE $s "B9" '=''[Model.xlsx]Calc_Summary''!B2*2'
  FE $s "B10" '=TODAY()-DATE(2026,1,1)'

  Slide $PW["SLIDE Peer Overview"] '="Peers - "&Link!B2&" - month "&Link!B3' @("Bank", "Own", "Peer", "Gap", "Gap %", "Position", "Sel.") 20 @(
    '=Compare!A2', '=Compare!B2', '=Compare!C2', '=Compare!E2', '=Compare!F2', '=Compare!J2', '=Compare!P2') $false
  Slide $PW["SLIDE Peer Trend"] '="Peer trend - "&Link!B2' @("Month", "Own", "Peer", "Gap", "Rolling") 12 @(
    '=Link!$B$3-12+ROW()-4', '=INDEX(PeerTrend!$B$2:$B$37,C5)', '=INDEX(PeerTrend!$C$2:$C$37,C5)', '=D5-E5', '=INDEX(PeerTrend!$H$2:$H$37,C5)') $false
  Slide $PW["SLIDE Peer Gap"] '="Gap by group"' @("Group", "Banks", "Avg gap %", "Best", "Ahead") 4 @(
    [object[]]@("G1", "G2", "G3", "G4"), '=COUNTIF(Compare!$G$2:$G$21,C5)', '=AVERAGEIF(Compare!$G$2:$G$21,C5,Compare!$F$2:$F$21)', '=MAXIFS(Compare!$F$2:$F$21,Compare!$G$2:$G$21,C5)', '=COUNTIFS(Compare!$G$2:$G$21,C5,Compare!$J$2:$J$21,"ahead")') $false
  Slide $PW["SLIDE Peer Rank"] '="Peer ranking"' @("Rank", "Bank", "Gap %", "Tier") 10 @(
    [object[]]@(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), '=INDEX(Compare!$A$2:$A$21,MATCH(C5,Compare!$I$2:$I$21,0))', '=XLOOKUP(D5,Compare!$A$2:$A$21,Compare!$F$2:$F$21)', '=XLOOKUP(D5,Compare!$A$2:$A$21,Compare!$K$2:$K$21)') $false
  "Peers: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Regions.xlsx (English)
  $s = $RW["RegMaster"]
  Row $s "A1:C1" @("Region", "Head", "Weight")
  $a = New-Object 'object[,]' 5, 3; for ($i = 0; $i -lt 5; $i++) { $a[$i, 0] = $regions[$i]; $a[$i, 1] = @("North-west desk", "North-east desk", "Centre desk", "South desk", "Islands desk")[$i]; $a[$i, 2] = @(0.3, 0.2, 0.25, 0.15, 0.1)[$i] }
  $s.Range("A2:C6").Value2 = $a
  $s = $RW["RegTargets"]
  $g = New-Object 'object[,]' 6, 37; $g[0, 0] = "Region \ month"; for ($m = 1; $m -le $NM; $m++) { $g[0, $m] = $m }
  for ($i = 0; $i -lt 5; $i++) { $g[($i + 1), 0] = $regions[$i]; for ($m = 1; $m -le $NM; $m++) { $g[($i + 1), $m] = [Math]::Round(@(42000, 30000, 47000, 26000, 16000)[$i] * (1 + 0.006 * $m), 0) } }
  $s.Range("A1:AK6").Value2 = $g

  $s = $RW["FromModel"]
  Row $s "A1:D1" @("Region", "Banks", "Volume", "Margin")
  FE $s "A2:A6" '=''[Model.xlsx]Calc_Region''!A2'
  FE $s "B2:B6" '=''[Model.xlsx]Calc_Region''!B2'
  FE $s "C2:C6" '=''[Model.xlsx]Calc_Region''!C2'
  FE $s "D2:D6" '=''[Model.xlsx]Calc_Region''!E2'
  $s.Range("A9").Value2 = "Month"; FE $s "B9" '=''[Model.xlsx]Control''!$B$3'
  $s.Range("A10").Value2 = "Region"; FE $s "B10" '=''[Model.xlsx]Control''!$B$5'
  Row $s "A11:C11" @("Bank", "Region", "Volume")
  FE $s "A12:A31" '=''[Model.xlsx]Calc_Bank''!A2'
  FE $s "B12:B31" '=''[Model.xlsx]Calc_Bank''!B2'
  FE $s "C12:C31" '=''[Model.xlsx]Calc_Bank''!C2'

  $s = $RW["FromPeers"]
  Row $s "A1:D1" @("Bank", "Peer volume", "Gap", "Group")
  FE $s "A2:A21" '=''[Peers.xlsx]Compare''!A2'
  FE $s "B2:B21" '=''[Peers.xlsx]Compare''!C2'
  FE $s "C2:C21" '=''[Peers.xlsx]Compare''!E2'
  FE $s "D2:D21" '=''[Peers.xlsx]Compare''!G2'
  $s.Range("A24").Value2 = "Total gap"; FE $s "B24" '=''[Peers.xlsx]Summary''!B4'
  $s.Range("A25").Value2 = "Peer rank"; FE $s "B25" '=''[Peers.xlsx]Summary''!$B$3'

  $s = $RW["RegCalc"]
  Row $s "A1:K1" @("Region", "Model volume", "Peer volume", "Target", "Gap", "Share", "Peer gap", "Signal", "Rank", "Place", "Selected")
  FE $s "A2:A6" '=RegMaster!A2'
  FE $s "B2:B6" '=XLOOKUP(A2,FromModel!$A$2:$A$6,FromModel!$C$2:$C$6)'
  FE $s "C2:C6" '=SUMIFS(FromPeers!$B$2:$B$21,FromModel!$B$12:$B$31,A2)'
  FE $s "D2:D6" '=INDEX(RegTargets!$B$2:$AK$6,MATCH(A2,RegTargets!$A$2:$A$6,0),FromModel!$B$9)'
  FE $s "E2:E6" '=B2-D2'
  FE $s "F2:F6" '=B2/SUM($B$2:$B$6)'
  FE $s "G2:G6" '=SUMIFS(FromPeers!$C$2:$C$21,FromModel!$B$12:$B$31,A2)'
  FE $s "H2:H6" '=IF(AND(E2>0,G2>0),"strong",IF(OR(E2<0,G2<0),"watch","neutral"))'
  FE $s "I2:I6" '=RANK.EQ(B2,$B$2:$B$6)'
  FE $s "J2:J6" '=CHOOSE(I2,"1st","2nd","3rd","4th","5th")'
  FE $s "K2:K6" '=IF(A2=FromModel!$B$10,"*","")'
  Row $s "A9:D9" @("Month", "Target sel. region", "Model total", "Ratio")
  FE $s "A10:A45" '=ROW()-9'
  FE $s "B10:B45" '=INDEX(RegTargets!$B$2:$AK$6,MATCH(FromModel!$B$10,RegTargets!$A$2:$A$6,0),A10)'
  FE $s "C10:C45" '=INDEX(''[Model.xlsx]Calc_BankMonth''!$B$23:$AK$23,A10)'
  FE $s "D10:D45" '=IFERROR(C10/SUM(RegTargets!$B$2:$AK$6)*36,0)'

  $s = $RW["Summary"]
  Col $s 2 1 @("Total model volume", "Gap selected region", "Peer total gap", "Peer gap selected", "Peer rank", "Selected region")
  FE $s "B2" '=SUM(RegCalc!B2:B6)'
  FE $s "B3" '=XLOOKUP(FromModel!B10,RegCalc!A2:A6,RegCalc!E2:E6,"n/a")'
  FE $s "B4" '=FromPeers!B24*1'
  FE $s "B5" '=XLOOKUP(FromModel!B10,RegCalc!A2:A6,RegCalc!G2:G6,"n/a")'
  FE $s "B6" '=FromPeers!B25'
  FE $s "B7" '=FromModel!B10'

  Slide $RW["SLIDE Region Overview"] '="Regions - month "&FromModel!B9' @("Region", "Volume", "Target", "Gap", "Share", "Signal", "Place") 5 @(
    '=RegCalc!A2', '=RegCalc!B2', '=RegCalc!D2', '=RegCalc!E2', '=RegCalc!F2', '=RegCalc!H2', '=RegCalc!J2') $false
  Slide $RW["SLIDE Region Trend"] '="Targets - "&FromModel!B10' @("Month", "Target", "Model total", "Ratio") 12 @(
    '=FromModel!$B$9-12+ROW()-4', '=INDEX(RegCalc!$B$10:$B$45,C5)', '=INDEX(RegCalc!$C$10:$C$45,C5)', '=IFERROR(E5/D5,0)') $false
  Slide $RW["SLIDE Region Peers"] '="Peer gap by region"' @("Region", "Peer volume", "Peer gap", "Banks") 5 @(
    '=RegCalc!A2', '=RegCalc!C2', '=RegCalc!G2', '=COUNTIF(FromModel!$B$12:$B$31,C5)') $false
  "Regions: " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"

  # ================================================================ Model.xlsx reads Peers and Regions back
  $s = $MW["Calc_Links"]
  Col $s 2 1 @("Gap % peer", "Rango peer", "Gap totale", "Banche avanti", "Codice mese", "Etichetta gap", "Media peer")
  FIt $s "B2" "='[Peers.xlsx]Summary'!`$B`$2"
  FIt $s "B3" "='[Peers.xlsx]Summary'!`$B`$3"
  FIt $s "B4" "='[Peers.xlsx]Summary'!`$B`$4"
  FIt $s "B5" "='[Peers.xlsx]Summary'!`$B`$5"
  FIt $s "B6" "='[Peers.xlsx]Summary'!`$B`$6"
  FIt $s "B7" "='[Peers.xlsx]Summary'!`$B`$7"
  FIt $s "B8" "='[Peers.xlsx]Summary'!`$B`$8"
  Col $s 10 1 @("Totale regioni", "Gap regione sel.", "Gap peer totale", "Gap peer sel.", "Rango peer", "Regione sel.")
  FIt $s "B10:B15" "='[Regions.xlsx]Summary'!B2"
  FIt $s "C2" "=CERCA.X(Control!B2;'[Peers.xlsx]Compare'!`$A`$2:`$A`$21;'[Peers.xlsx]Compare'!`$E`$2:`$E`$21)"
  Row $s "A19:C19" @("Banca", "Peer", "Gap %")
  FIt $s "A20:A39" '=Calc_Bank!A2'
  FIt $s "B20:B39" "=CERCA.VERT(A20;'[Peers.xlsx]Compare'!`$A`$2:`$H`$21;3;FALSO)"
  FIt $s "C20:C39" "=SE.ERRORE(INDICE('[Peers.xlsx]Compare'!`$F`$2:`$F`$21;CONFRONTA(A20;'[Peers.xlsx]Compare'!`$A`$2:`$A`$21;0));0)"
  FIt $c "B18" "='[Peers.xlsx]Summary'!`$B`$2"
  FIt $c "B19" "='[Regions.xlsx]Summary'!`$B`$2"
  $c.Range("B18").NumberFormatLocal = "0,0%"

  $xl.CalculateFull()
  $wbM.Save(); $wbP.Save(); $wbR.Save()
  $fm = Count-Formulas $wbM; $fp = Count-Formulas $wbP; $fr = Count-Formulas $wbR
  "formulas: Model $fm - Peers $fp - Regions $fr (" + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s)"
  foreach ($wb in @($wbM, $wbP, $wbR)) { $e = Errors $wb; if ($e) { "error values in " + $wb.Name + ":"; $e | ForEach-Object { "  " + $_ } } }

  # ================================================================ scenario truth for the three linked files
  $truth = Join-Path $Out "truth"; New-Item -ItemType Directory -Force $truth | Out-Null
  $base = @{ bank = "Banca Tirrena"; month = 30; rate = 0.03; region = "Centro" }
  $cases = New-Object System.Collections.ArrayList
  $i = 0
  foreach ($bk in @("Banca Alpi", "Banca Città", "Banca Sarda", "Banca Lucana", "Banca Veneta", "Banca Padana")) { $i++; [void]$cases.Add(@{ name = ("{0:D2}_bank_{1}" -f $i, ($bk -replace "Banca ", "" -replace "à", "a")); bank = $bk; month = 30; rate = 0.03; region = "Centro" }) }
  foreach ($rt in @(0.0, 0.08)) { $i++; [void]$cases.Add(@{ name = ("{0:D2}_rate_{1}" -f $i, $rt.ToString($inv)); bank = "Banca Tirrena"; month = 30; rate = $rt; region = "Centro" }) }
  foreach ($mo in @(13, 36)) { $i++; [void]$cases.Add(@{ name = ("{0:D2}_month_{1}" -f $i, $mo); bank = "Banca Tirrena"; month = $mo; rate = 0.03; region = "Centro" }) }
  $i++; [void]$cases.Add(@{ name = ("{0:D2}_region_Isole" -f $i); bank = "Banca Tirrena"; month = 30; rate = 0.03; region = "Isole" })
  $i++; [void]$cases.Add(@{ name = ("{0:D2}_combo" -f $i); bank = "Banca Sicula"; month = 18; rate = 0.05; region = "Sud" })
  $json = @()
  foreach ($k in $cases) {
    $c.Range("B2").Value2 = $k.bank; $c.Range("B3").Value2 = $k.month; $c.Range("B4").Value2 = $k.rate; $c.Range("B5").Value2 = $k.region
    $xl.CalculateFull()
    $dir = Join-Path $truth $k.name; New-Item -ItemType Directory -Force $dir | Out-Null
    $wbM.SaveCopyAs((Join-Path $dir "Model.xlsx")); $wbP.SaveCopyAs((Join-Path $dir "Peers.xlsx")); $wbR.SaveCopyAs((Join-Path $dir "Regions.xlsx"))
    $json += ('  {"name": "' + $k.name + '", "files": ["Model.xlsx", "Peers.xlsx", "Regions.xlsx"], "set": [' +
      '{"book": "Model.xlsx", "sheet": "Control", "r": 2, "c": 2, "v": "' + $k.bank + '"}, ' +
      '{"book": "Model.xlsx", "sheet": "Control", "r": 3, "c": 2, "v": ' + $k.month + '}, ' +
      '{"book": "Model.xlsx", "sheet": "Control", "r": 4, "c": 2, "v": ' + ([double]$k.rate).ToString($inv) + '}, ' +
      '{"book": "Model.xlsx", "sheet": "Control", "r": 5, "c": 2, "v": "' + $k.region + '"}]}')
    "truth " + $k.name + ": " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"
  }
  $c.Range("B2").Value2 = $base.bank; $c.Range("B3").Value2 = $base.month; $c.Range("B4").Value2 = $base.rate; $c.Range("B5").Value2 = $base.region
  $xl.CalculateFull(); $wbM.Save(); $wbP.Save(); $wbR.Save()
  $wbR.Close($false); $wbP.Close($false); $wbM.Close($false)

  # ================================================================ Speed.xlsx: one big stand-alone file (English)
  $NS = 60; $NROW = 30; $NCOL = 50                                    # 60 sheets x 30 rows x 50 columns of formulas
  $wbS = NewBook (@("Control", "Data", "Base") + (1..$NS | ForEach-Object { "Step{0:D2}" -f $_ }) + @("Summary")) $pS
  $xl.Calculation = -4135
  $sc = $wbS.Worksheets.Item("Control"); $sd = $wbS.Worksheets.Item("Data"); $sbase = $wbS.Worksheets.Item("Base")
  Col $sc 2 1 @("Bank", "Rate", "Week")
  $sc.Range("B2").Value2 = "Banca Tirrena"; $sc.Range("B3").Value2 = 0.03; $sc.Range("B4").Value2 = 40
  Row $sd "A1:E1" @("Bank", "Week", "Loans", "Deposits", "Fees")
  $a = New-Object 'object[,]' ($NB * 52), 5; $r = 0
  for ($b = 0; $b -lt $NB; $b++) { for ($w = 1; $w -le 52; $w++) { $v = (900 + 120 * $b) * (1 + 0.003 * $w) + $rnd.Next(-50, 50) + $rnd.NextDouble(); $a[$r, 0] = $banks[$b]; $a[$r, 1] = $w; $a[$r, 2] = [Math]::Round($v, 2); $a[$r, 3] = [Math]::Round($v * 1.3, 1); $a[$r, 4] = [Math]::Round($v * 0.01, 3); $r++ } }
  $sd.Range("A2:E1041").Value2 = $a
  $wh = New-Object 'object[,]' 1, 53; $wh[0, 0] = "Bank \ week"; for ($w = 1; $w -le 52; $w++) { $wh[0, $w] = $w }
  $sbase.Range("A2:BA2").Value2 = $wh; Col $sbase 3 1 $banks
  FE $sbase "B3:BA22" '=SUMIFS(Data!$C$2:$C$1041,Data!$A$2:$A$1041,$A3,Data!$B$2:$B$1041,B$2)*IF($A3=Control!$B$2,1+Control!$B$3,1)'
  $last = (CL (1 + $NCOL))
  for ($k = 1; $k -le $NS; $k++) {
    $ws = $wbS.Worksheets.Item(("Step{0:D2}" -f $k)); $prev = if ($k -eq 1) { "Base" } else { "Step{0:D2}" -f ($k - 1) }
    $ws.Range("A1").Value2 = "Sheet $k"
    $f = switch ($k % 5) {
      1 { "=$prev!B3*(1+Control!`$B`$3/12)+IF(MOD(ROW()+COLUMN(),7)=0,INDEX(Base!`$B`$3:`$BA`$22,MOD(ROW(),20)+1,MOD(COLUMN(),52)+1)*0.001,0)" }
      2 { "=ROUND($prev!B3+$prev!`$B3*0.0005,6)" }
      3 { "=IF($prev!B3>$prev!`$B`$3,$prev!B3-0.5,$prev!B3+0.5)" }
      4 { "=$prev!B3+SUM($prev!`$B3:`$F3)/1000-AVERAGE($prev!B`$3:B`$7)/1000" }
      0 { "=IFERROR(VLOOKUP(`$A3,$prev!`$A`$3:`$AY`$32,COLUMN(),FALSE),0)*0.999+MAX($prev!B3,0)*0.001" }
    }
    Col $ws 3 1 (@($banks) + @(1..10 | ForEach-Object { "Extra $_" }))
    FE $ws ("B3:" + $last + (2 + $NROW)) $f
  }
  $ss = $wbS.Worksheets.Item("Summary")
  Row $ss "A1:E1" @("Sheet", "Total", "Max", "Selected bank", "Check")
  Col $ss 2 1 @(1..$NS | ForEach-Object { "Step{0:D2}" -f $_ })
  FE $ss ("B2:B" + (1 + $NS)) ('=SUM(INDIRECT("''"&A2&"''!B3:' + $last + (2 + $NROW) + '"))')
  FE $ss ("C2:C" + (1 + $NS)) ('=MAX(INDIRECT(A2&"!B3:' + $last + (2 + $NROW) + '"))')
  FE $ss ("D2:D" + (1 + $NS)) ('=XLOOKUP(Control!$B$2,INDIRECT(A2&"!A3:A' + (2 + $NROW) + '"),INDIRECT(A2&"!B3:B' + (2 + $NROW) + '"),0)')
  FE $ss ("E2:E" + (1 + $NS)) '=IF(B2>0,"ok","check")'
  FE $ss "G2" (("=SUM(Step{0:D2}!B3:" -f $NS) + $last + (2 + $NROW) + ")")
  $xl.CalculateFull(); $wbS.Save()
  "formulas: Speed " + (Count-Formulas $wbS) + " (" + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s)"
  $e = Errors $wbS; if ($e) { "error values in Speed.xlsx:"; $e | Select-Object -First 20 | ForEach-Object { "  " + $_ } }
  $i = 0
  foreach ($k in @(@{ name = "speed_bank_Sarda"; bank = "Banca Sarda"; rate = 0.03 }, @{ name = "speed_rate_0.07"; bank = "Banca Tirrena"; rate = 0.07 })) {
    $sc.Range("B2").Value2 = $k.bank; $sc.Range("B3").Value2 = $k.rate; $xl.CalculateFull()
    $dir = Join-Path $truth $k.name; New-Item -ItemType Directory -Force $dir | Out-Null
    $wbS.SaveCopyAs((Join-Path $dir "Speed.xlsx"))
    $json += ('  {"name": "' + $k.name + '", "files": ["Speed.xlsx"], "set": [' +
      '{"book": "Speed.xlsx", "sheet": "Control", "r": 2, "c": 2, "v": "' + $k.bank + '"}, ' +
      '{"book": "Speed.xlsx", "sheet": "Control", "r": 3, "c": 2, "v": ' + ([double]$k.rate).ToString($inv) + '}]}')
    "truth " + $k.name + ": " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s"
  }
  $sc.Range("B2").Value2 = "Banca Tirrena"; $sc.Range("B3").Value2 = 0.03; $xl.CalculateFull(); $wbS.Save(); $wbS.Close($false)
  [System.IO.File]::WriteAllText((Join-Path $truth "cases.json"), "[`n" + ($json -join ",`n") + "`n]`n", (New-Object System.Text.UTF8Encoding($false)))
} finally { $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
Get-ChildItem -Recurse -File $Out | ForEach-Object { "{0,10:N0}  {1}" -f $_.Length, $_.FullName.Substring($Out.Length + 1) }
"done in " + $sw.Elapsed.TotalSeconds.ToString("0.0", $inv) + " s: " + $Out
