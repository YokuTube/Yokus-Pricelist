<#
  Richtet ein, dass die Preisliste sich automatisch aktualisiert (Windows-Aufgabenplanung).
  (Datei bewusst ohne Umlaute: Windows PowerShell 5.1 liest sonst falsch.)
  Laeuft unsichtbar als dein normaler Benutzer (kein Admin noetig): beim Anmelden und danach alle 15 Minuten.
  Nur wenn sich Daten aendern, wird etwas hochgeladen.

  Einrichten:  powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1
  Entfernen:   powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1 -Remove
#>
param([switch]$Remove, [int]$EveryMinutes = 15)

$ErrorActionPreference = 'Stop'
$taskName = 'YokusStoreSync'
$me = "$env:USERDOMAIN\$env:USERNAME"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Automatische Aktualisierung entfernt."
  return
}

$script = Join-Path $PSScriptRoot 'sync-data.ps1'
$arg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$logon = New-ScheduledTaskTrigger -AtLogOn -User $me
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat) -Principal $principal -Settings $settings -Description 'Yokus Store: RICS-Daten auf GitHub aktualisieren' -Force | Out-Null
Write-Host "Eingerichtet: Aktualisierung beim Anmelden und alle $EveryMinutes Minuten (nur bei Aenderungen)."
