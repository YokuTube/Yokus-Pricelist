' Startet ein PowerShell-Skript ohne sichtbares Fenster (auch kein kurzes Aufblitzen).
' Aufruf: wscript.exe //B //Nologo run-hidden.vbs "C:\Pfad\skript.ps1"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False
