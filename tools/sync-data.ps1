<#
  Yokus Store - Daten automatisch aktualisieren
  (Datei bewusst ohne Umlaute: Windows PowerShell 5.1 liest sonst falsch.)

  Kopiert die RICS-JSON-Dateien aus dem Spiel nach data/, prueft sie und laedt sie hoch,
  wenn sich etwas geaendert hat. Aendert sich nichts, passiert nichts.

  Normal:          powershell -ExecutionPolicy Bypass -File tools\sync-data.ps1
  Nur testen:      ... -DryRun   (zeigt, was passieren wuerde, aendert nichts)
  Ohne Hochladen:  ... -NoPush   (kopiert und committet nur lokal)

  Es werden NUR die unten genannten Dateien kopiert (keine Zuschauerdaten, keine Zugangsdaten).
#>
[CmdletBinding()]
param(
  [string]$ConfigDir = "$env:USERPROFILE\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Config\CAP_ChatInteractive",
  [string]$RepoDir = '',
  [switch]$DryRun,
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
if (-not $RepoDir) { $RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }

# Ausschliesslich diese Dateien duerfen die Seite erreichen.
$Allowed = 'StoreItems.json', 'Incidents.json', 'Traits.json', 'RaceSettings.json', 'Weather.json', 'ActiveMods.json', 'CommandSettings.json', 'RICSExtras_Labels.json'

function Log($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

if (-not (Test-Path -LiteralPath $ConfigDir)) { Log "Config-Ordner nicht gefunden: $ConfigDir"; exit 2 }
if (-not (Test-Path -LiteralPath (Join-Path $RepoDir '.git'))) { Log "Kein Git-Repo: $RepoDir"; exit 2 }

$dataDir = Join-Path $RepoDir 'data'
$changed = @()

foreach ($name in $Allowed) {
  $src = Join-Path $ConfigDir $name
  $dst = Join-Path $dataDir $name
  if (-not (Test-Path -LiteralPath $src)) { Log "Uebersprungen (fehlt): $name"; continue }

  # RimWorld schreibt die Dateien manchmal gerade: nur nehmen, wenn sie sich kurz nicht aendern und gueltiges JSON sind.
  $len1 = (Get-Item -LiteralPath $src).Length
  Start-Sleep -Milliseconds 1500
  if ((Get-Item -LiteralPath $src).Length -ne $len1) { Log "Wird gerade geschrieben, spaeter wieder: $name"; continue }
  try { $null = Get-Content -LiteralPath $src -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Log "Kein gueltiges JSON, uebersprungen: $name"; continue }

  $same = (Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $src).Hash -eq (Get-FileHash -LiteralPath $dst).Hash)
  if ($same) { continue }
  $changed += $name
  if (-not $DryRun) { Copy-Item -LiteralPath $src -Destination $dst -Force }
}

if ($changed.Count -eq 0) {
  # Keine neuen Daten - aber falls ein frueherer Upload gescheitert ist, offene Commits jetzt nachholen.
  Push-Location $RepoDir
  try {
    $ahead = 0
    $up = git rev-parse --abbrev-ref '@{u}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $up) { $ahead = [int](git rev-list --count '@{u}..HEAD') }
    if ($ahead -gt 0 -and -not $DryRun -and -not $NoPush) {
      git push --quiet
      if ($LASTEXITCODE -eq 0) { Log "Offene Aenderungen nachgeladen ($ahead)." } else { Log "Nachladen fehlgeschlagen, naechster Versuch folgt." }
    } else { Log "Nichts geaendert." }
  }
  finally { Pop-Location }
  exit 0
}
Log ("Geaendert: " + ($changed -join ', '))
if ($DryRun) { Log "DryRun - nichts kopiert oder hochgeladen."; exit 0 }

# Zeitstempel fuer die Seite ("Stand: ...") und als Cache-Schluessel
$meta = [ordered]@{ updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); files = $changed }
($meta | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Join-Path $dataDir 'meta.json') -Encoding UTF8

Push-Location $RepoDir
try {
  git pull --rebase --autostash --quiet 2>&1 | Out-Null
  git add -- data/*.json
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Log "Git sieht keine Aenderung."; exit 0 }
  git commit --quiet -m ("Daten aktualisiert: " + ($changed -join ', '))
  if ($NoPush) { Log "Lokal committet (NoPush)."; exit 0 }
  git push --quiet
  if ($LASTEXITCODE -ne 0) { throw "git push fehlgeschlagen" }
  Log "Hochgeladen. Die Seite aktualisiert sich in 1-2 Minuten."
}
finally { Pop-Location }
