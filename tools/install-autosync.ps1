<#
  Richtet ein, dass die Preisliste sich automatisch aktualisiert (Windows-Aufgabenplanung).
  (Datei bewusst ohne Umlaute: Windows PowerShell 5.1 liest sonst falsch.)
  Laeuft unsichtbar beim Anmelden und danach alle 15 Minuten. Nur wenn sich Daten aendern, wird etwas hochgeladen.

  Einrichten:  powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1
  Entfernen:   powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1 -Remove
#>
param([switch]$Remove, [int]$EveryMinutes = 15)

$ErrorActionPreference = 'Stop'
$taskName = 'YokusStoreSync'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Automatische Aktualisierung entfernt."
  return
}

$script = Join-Path $PSScriptRoot 'sync-data.ps1'
$arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)).Repetition
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Yokus Store: RICS-Daten auf GitHub aktualisieren' -Force | Out-Null
Write-Host "Eingerichtet: Aktualisierung beim Anmelden und alle $EveryMinutes Minuten (nur bei Aenderungen)."
