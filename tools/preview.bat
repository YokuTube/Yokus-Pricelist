@echo off
rem Doppelklick: Seite lokal ansehen (startet einen kleinen Server und oeffnet den Browser).
cd /d "%~dp0.."
start "" http://localhost:8765
python tools\dev-server.py
