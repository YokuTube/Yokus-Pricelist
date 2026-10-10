# Yokus Store (GitHub Pages) – Projektanleitung

Antworte auf Deutsch. Öffentliche Preislisten-/Befehlsseite für Andreas' RICS-Stream. Repo: `github.com/YokuTube/Yokus-Pricelist` (Fork von `ekudram/RICS-Pricelist`, inzwischen komplett neu geschrieben – ein „Sync fork“ vom Original würde Konflikte erzeugen). Gemeinsame Regeln: `../CLAUDE.md`.

## Stand
- **Live** unter https://yokutube.github.io/Yokus-Pricelist/ (GitHub Pages, Branch `main`), seit 9.10.2026 (Neuaufbau).
- **Upload per Knopf, keine Automatik** (Nutzer wollte ausdrücklich nichts Dauerhaftes/Zeitgesteuertes; ändert die Daten nur alle paar Wochen): In der RICS-Leiste gibt es den Eintrag „Preisliste hochladen“ (Mod `RICS-Extras`, `src/PricelistButton.cs`), der `tools/sync-data.ps1` im Hintergrund startet und das Ergebnis im Fenster zeigt. Pfad zum Skript in den Mod-Einstellungen. Frühere Versuche mit Aufgabenplanung/Wächter wurden verworfen und entfernt – **nicht wieder einführen**.
- Twitch-Senden ist **bewusst aus** (`data/site-config.json` leer; Nutzer will keine Twitch-App registrieren) – nicht wieder einschalten ohne Rückfrage.
- Die RICS-Item-Einstellungen wurden am 9.10.2026 auf den alten Stand (ca. 70 Items) zurückgesetzt; Sicherung unter `...\Config\CAP_ChatInteractive\Backups\StoreItems_vor_Rueckstellung_*.json`.

## Regeln
- **Neue größere Änderungen an der öffentlichen Seite vorher kurz bestätigen lassen** (der Nutzer hat den Neuaufbau freigegeben).
- Nur die sieben Dateien aus `tools/sync-data.ps1` (`$Allowed`) dürfen aus dem RICS-Config-Ordner ins Repo – nie `viewers.json` oder Einstellungsdateien mit Tokens.
- `.ps1`-Dateien nur mit ASCII-Zeichen (Windows PowerShell 5.1 liest BOM-loses UTF-8 falsch).
- Handy zuerst denken: 44-px-Ziele, keine Querscroll-Seiten, Filter am Handy eingeklappt.

## Aufbau
- `index.html` – Gerüst; `assets/css/site.css` – hell/dunkel über Variablen
- `assets/js/main.js` Start/Router (Hash `#/befehle`, `#/items` …, `#/befehle/<cmd>` = Direktlink), `data.js` lädt+bereinigt JSON, `views.js` alle Ansichten, `chat.js` optionales Senden über Twitch, `util.js` Helfer (Suche mit Wortstamm/Synonymen: `makeMatcher`)
- `data/*.json` – RICS-Exporte (per Skript aktualisiert) + von Hand gepflegt: `commands.json` (Befehlsdoku), `event-notes.json` (Erklärungen, deutsche Namen), `site-config.json` (Twitch-Senden an/aus), `meta.json` (Stand, vom Skript)
- `tools/` – `sync-data.ps1` (kopieren, prüfen, committen, pushen; `-DryRun`, `-NoPush`), `sync-pricelist.bat`, `preview.bat` + `dev-server.py` (lokale Vorschau ohne Zwischenspeicher)

## Wichtige Entscheidungen
- **Spiegelt exakt RICS:** Item „kaufbar“ nur bei `Enabled`; `!use/!equip/!wear` nur bei jeweiligem Schalter. Ausgeschaltete Items sind ausgeblendet, werden aber bei der Suche erklärt („gibt es, wird gerade nicht verkauft“). Befehle: live aus `CommandSettings.json` (an/aus, Berechtigung, Alias).
- **Befehlsnamen für Zuschauer:** lesbarer Name (`!buy beer 5`, Leerzeichen → `_`), nur wenn eindeutig und nur Buchstaben/Ziffern/Leerzeichen; sonst technischer DefName (`assignCmdNames` in `data.js`).
- Einstieg in die Kolonie ist `!join` (= `!joinqueue`), dann `!acceptpawn`. `!pawn` je nach Streamer-Einstellung Kauf oder Liste.
- Erwartet: eine Mod übersetzt RICS bald ins Deutsche → nichts hart auf englische Befehle/Labels verdrahten; Aliase anzeigen (geschieht über `CommandSettings.json`).
- Senden über Twitch ist freiwillig (Implicit Grant, Scope `user:write:chat`), standardmäßig aus; ohne Anmeldung nur Kopieren.

## Live-Teil (Mod RICS Live) und Stream
- `assets/js/live.js` + `live-views.js`: Reiter **Ich / Kolonie / Spiel**, Live-Leiste, Verbinden (`!link`), Kaufen per Knopf – nur sichtbar, wenn die Mod RICS Live läuft (Adresse aus Branch `live`, `live.json`, über GitHub-API). Ohne Mod verhält sich die Seite exakt wie vorher. Schnittstelle: `../RICS-Live/docs/API.md`. Test ohne Spiel: `tools/live-fake.py` + `?live=http://127.0.0.1:8790` (wirkt nur auf localhost).
- `assets/js/stream.js`: Reiter **Stream** (Twitch-Kanal `dasyoku`, offizielle Einbettung, `parent=location.hostname`). Zuschauer schalten Stream/Chat einzeln über den Knopf „Stream“ im Kopf aus (localStorage `ys-stream`); beides aus = Reiter weg. Player lädt nie von selbst (Klick nötig, kein doppelter Ton).
- Branch `live` wird von der Mod per force push beschrieben – **nicht** in `main` mergen, nicht löschen.

## Lokal ansehen
`python -m http.server 8765` im Projektordner (oder `preview_start pricelist` aus `../.claude/launch.json`).
