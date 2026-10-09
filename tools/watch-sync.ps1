<#
  Yokus Store - Daten NUR dann aktualisieren, wenn RimWorld laeuft und sich RICS-Dateien aendern.
  (Datei bewusst ohne Umlaute: Windows PowerShell 5.1 liest sonst falsch.)

  - Ist RimWorld nicht gestartet, schlaeft das Skript (praktisch kein Verbrauch, nur ein kurzer Check alle 20 Sekunden).
  - Laeuft RimWorld, schaut es alle 30 Sekunden, ob sich eine der 7 Dateien geaendert hat. Wenn ja, wird abgeglichen
    (hoechstens einmal pro Minute).
  - Beendest du RimWorld, gleicht es einmal ab.

  Gestartet wird es von der Aufgabe "YokusStoreSync" beim Anmelden (siehe install-autosync.ps1).
#>
param(
  [string]$ConfigDir = "$env:USERPROFILE\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Config\CAP_ChatInteractive",
  [string]$ProcessName = 'RimWorldWin64',
  [switch]$DryRun
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sync = Join-Path $here 'sync-data.ps1'
$log = Join-Path $here 'sync.log'
$files = 'StoreItems.json', 'Incidents.json', 'Traits.json', 'RaceSettings.json', 'Weather.json', 'ActiveMods.json', 'CommandSettings.json'

function Stamp {
  ($files | ForEach-Object {
    $p = Join-Path $ConfigDir $_
    if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).LastWriteTimeUtc.Ticks } else { 0 }
  }) -join ','
}
function GameRunning { [bool](Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) }
function RunSync {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$sync`"", '-ConfigDir', "`"$ConfigDir`"")
  if ($DryRun) { $a += '-DryRun' }
  Start-Process -FilePath 'powershell.exe' -ArgumentList $a -WindowStyle Hidden -Wait -RedirectStandardOutput $log
}

$last = Stamp
while ($true) {
  if (GameRunning) {
    $lastRun = Get-Date '2000-01-01'
    while (GameRunning) {
      Start-Sleep -Seconds 30
      if ((Stamp) -ne $last -and ((Get-Date) - $lastRun).TotalSeconds -ge 60) {
        Start-Sleep -Seconds 10          # kurz warten, bis RICS fertig geschrieben hat
        $last = Stamp
        RunSync
        $lastRun = Get-Date
      }
    }
    Start-Sleep -Seconds 5               # Spiel beendet: einmal abgleichen
    if ((Stamp) -ne $last) { RunSync }
    $last = Stamp
  }
  else {
    Start-Sleep -Seconds 20
  }
}
