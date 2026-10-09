# Yokus Store – Preisliste & Befehle für RICS

Eine Seite für GitHub Pages, die zeigt, was der Chat im Stream kaufen, auslösen und tun kann: **Befehle** (mit Eingabe, Beispiel und Wirkung), **Items**, **Events**, **Wetter**, **Eigenschaften**, **Rassen** und **Mods**. Hell/Dunkel, am Handy gut bedienbar, jeder Befehl lässt sich mit einem Tipp kopieren.

Aufgebaut aus der Vorlage von [ekudram/RICS-Pricelist](https://github.com/ekudram/RICS-Pricelist), inzwischen aber komplett neu geschrieben (kein Build-Schritt, reines HTML/CSS/JS).

## Daten aktualisieren (automatisch)

Die Seite liest die JSON-Dateien aus `data/`. Die kommen aus dem Spiel (`%AppData%\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Config\CAP_ChatInteractive`). Du musst sie nicht mehr selbst hochladen:

| Was | Wie |
|---|---|
| **Einmal sofort** | Doppelklick auf `tools\sync-pricelist.bat` |
| **Dauerhaft automatisch** | `powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1` – prüft beim Anmelden und alle 15 Minuten, lädt nur bei Änderungen hoch |
| **Wieder ausschalten** | `powershell -ExecutionPolicy Bypass -File tools\install-autosync.ps1 -Remove` |
| **Nur testen** | `powershell -ExecutionPolicy Bypass -File tools\sync-data.ps1 -DryRun` |

Das Skript kopiert **nur** diese sieben Dateien: `StoreItems`, `Incidents`, `Traits`, `RaceSettings`, `Weather`, `ActiveMods`, `CommandSettings`. Zuschauerdaten (`viewers.json`) und Einstellungen mit Zugangsdaten werden nie angefasst. Ungültige oder gerade geschriebene Dateien werden übersprungen. Danach committet und pusht es mit deinem angemeldeten GitHub-Konto (`gh auth login`). GitHub Pages braucht 1–2 Minuten, bis es sichtbar ist; die Seite zeigt unten rechts „Stand“.

## Befehlstexte pflegen

- `data/commands.json` – die von Hand geschriebenen Erklärungen pro Befehl (Eingabe, Beispiele, Wirkung, Hinweise). Neue Befehle dort eintragen.
- Ob ein Befehl gerade an ist, wer ihn nutzen darf und welche **Aliase** er hat, kommt automatisch aus `CommandSettings.json`. Ausgeschaltete Befehle sind ausgeblendet, Aliase werden angezeigt (wichtig, falls eine Übersetzungs-Mod Befehlsnamen ändert).
- `data/picks.json` – Auswahlhilfen: bei Befehlen wie `!sethair`, `!weather`, `!dye` zeigt die Seite die möglichen Werte als antippbare Knöpfe. Werte kommen aus den Daten (Wetter, Rassen) oder aus `data/choices.json` (Farbnamen aus RICS, Fertigkeiten, Raid-Arten).
- `data/event-notes.json` – Erklärungen in einfachem Deutsch für Events und Wetter (Schlüssel = DefName). Fehlt ein Eintrag, nutzt die Seite die Beschreibung aus dem Spiel oder eine allgemeine nach Art des Events.

## Optional: direkt aus der Seite senden („Mit Twitch verbinden“)

Standardmäßig kopiert ein Tipp auf einen Befehl ihn nur – nichts weiter, niemand muss sich anmelden. Wer will, kann sich freiwillig mit Twitch verbinden; danach fragt ein Dialog vor jedem Befehl „Im Chat senden?“ (Text ist änderbar, es wird nie ohne Bestätigung gesendet). Wer sich nicht anmeldet, sieht davon nur einen kleinen, unauffälligen Link in der Kopfzeile.

**Einrichten (einmalig, nur du als Streamer):**
1. Auf <https://dev.twitch.tv/console> eine Anwendung registrieren. **OAuth-Redirect-URL** = die Adresse deiner Seite, z. B. `https://yokutube.github.io/Yokus-Pricelist/` (mit Schrägstrich am Ende, genau so). Kategorie „Website Integration“, Client-Typ „Öffentlich“.
2. Die **Client-ID** kopieren und in `data/site-config.json` eintragen, dazu den Kanalnamen:
   ```json
   { "channel": "dein_kanalname", "twitchClientId": "abc123…" }
   ```
3. Hochladen. Fertig. Bleibt eines der beiden Felder leer, ist die Funktion komplett aus.

Hinweis: Die Anmeldung läuft nur im Browser des Zuschauers (nur Berechtigung `user:write:chat`, das Token wird nur für diese Browser-Sitzung gespeichert). Gesendet wird als echte Chatnachricht des Zuschauers im Namen des Zuschauers.

## Dateien

```
index.html                 Gerüst
assets/css/site.css        Design (hell/dunkel, Handy)
assets/js/main.js          Start, Tabs, Design-Umschalter, Kopieren
assets/js/data.js          lädt und bereinigt die JSON-Dateien
assets/js/views.js         alle Ansichten (Start, Befehle, Items, Events, …)
assets/js/chat.js          optionales Senden über Twitch
assets/js/util.js          Hilfsfunktionen
data/                      JSON-Daten (siehe oben)
tools/                     Aktualisierungs-Skripte
```

Lokal ansehen: Doppelklick auf `tools\preview.bat` (startet einen kleinen Server ohne Zwischenspeicher und öffnet <http://localhost:8765>). Die Seite lässt sich nicht per Doppelklick auf `index.html` öffnen.

## Anpassen

- Titel: in `index.html` (`<h1>`) und im `<title>`.
- Farben: oben in `assets/css/site.css` (`:root` = dunkles Blau, `[data-theme="light"]` = hell). Das Design ist standardmäßig dunkel; wer „Hell“ wählt, bekommt das helle Design (wird im Browser gemerkt).
