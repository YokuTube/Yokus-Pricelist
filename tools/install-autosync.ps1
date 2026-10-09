<#
  Richtet ein, dass die Preisliste sich automatisch aktualisiert - aber NUR, wenn RimWorld laeuft und sich RICS-Dateien aendern
  (sowie einmal, wenn du RimWorld beendest). Sonst laeuft nichts.
  (Datei bewusst ohne Umlaute: Windows PowerShell 5.1 liest sonst falsch.)

  Technik: Beim Anmelden startet unsichtbar ein winziger Waechter (tools\watch-sync.ps1). Er schlaeft, solange RimWorld
  nicht laeuft. Kein Admin noetig.

  Einrichten:  powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1
  Entfernen:   powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1 -Remove
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$taskName = 'YokusStoreSync'
$me = "$env:USERDOMAIN\$env:USERNAME"

function StopWatcher {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*watch-sync.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  StopWatcher
  Write-Host "Automatische Aktualisierung entfernt."
  return
}

$watch = Join-Path $PSScriptRoot 'watch-sync.ps1'
$vbs = Join-Path $PSScriptRoot 'run-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`" `"$watch`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User $me
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
StopWatcher
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $logon -Principal $principal -Settings $settings -Description 'Yokus Store: RICS-Daten auf GitHub aktualisieren, nur waehrend RimWorld laeuft' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Eingerichtet: Der Waechter laeuft unsichtbar und gleicht nur ab, wenn RimWorld laeuft und sich Daten aendern."
