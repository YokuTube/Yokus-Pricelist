@echo off
rem Doppelklick: Preisliste jetzt aktualisieren (kopiert die RICS-Daten und laedt sie hoch).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-data.ps1"
echo.
pause
