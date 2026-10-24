"""Fake-Server fuer die RICS-Live-Schnittstelle (siehe RICS-Live/docs/API.md) - nur zum Testen der Webseite.

Start:   python tools/live-fake.py            (Port 8790)
Seite:   python tools/dev-server.py           (Port 8765), dann
         http://localhost:8765/?live=http://127.0.0.1:8790

Verhalten:
- /api/link/start liefert einen Code; nach ~4 s gilt er als bestaetigt (Benutzer "yoku").
- Muenzen steigen alle 10 s um 50.
- Aktionen liefern nach 1 s eine Beispiel-Antwort. Zum Testen der Fehlerfaelle:
  Argument "zuschnell" -> 429, "nospiel" -> 409, Befehl ausserhalb von "allowed" -> 400.
- Neu: /api/research (3 Reiter), /api/isekai (2 Baeume), GameInfo.animalList/quirkOffers/isekaiSkilling, bonds,
  wants.rewardPoints, Isekai-Daten bei "yoku" (Klingenmeister) und "luna_88" (noch ohne Klasse). Aktionen wants/aspirations/
  quirks/isekai antworten mit Beispieltext; bei "yoku" aendern "isekai lernen/stat" und "quirks nehmen" die Daten wirklich.
  Mehr Tiere (Gruppierung testen): Umgebungsvariable FAKE_MANY=1.
- Pawn "mira_spielt" ist niedergestreckt und blutet, "eddi_tv" schlaeft und hat keine Wuensche/Quirks (null).
- Neu: /api/vote (Abstimmung 90 s offen, 20 s Pause, Stimmen per Aktion "vote"), /api/events (Chronik mit Texten),
  relations in /api/log, work/workEditable (nur yoku darf setzen: Aktion mypawn "work <id> <prio>"),
  duelIncoming (alle 120 s Herausforderung von Mira fuer 45 s; "duel ja/nein" beantworten, "duel <Name>" fordert),
  goals und stock in /api/game.
- Neu (Zuschauer-Interaktionen): GameInfo.duel (Mira gegen Luna, 40 s Wetten offen / 20 s zu), praise, tutor, sponsorPrice;
  animalList mit id/img/sponsor/conditions/pain (Bild "404" und leeres img testen den Platzhalter); /api/animalimg/<key>;
  Befehle wette/lob/nachhilfe/pate antworten mit Beispieltext, "pate #p103 Name" setzt den Paten wirklich.
- Neu: memorials (2 Gedenk-Eintraege), wealthHistory (30 Tage), factions (4), visitors (1 Haendlergruppe + 1 Schiff)
  in /api/game; story (Lebensgeschichte) in /api/log (yoku 6, mira 3 Eintraege, sonst leer); kills, daysInColony und
  isekaiLevel in /api/colony und /api/pawn. Alles nur aus Konstanten, keine Sperre noetig.
"""
import hashlib
import os
import json
import re
import secrets
import struct
import sys
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
ORIGINS = {"https://yokutube.github.io", "http://localhost:8765", "http://127.0.0.1:8765"}
FAKE_START = time.time()


def fake_cooldowns_global():
    # Beispielwerte: global gesperrte Ereignisse/Befehle (unit game = Spielstunden, real = Sekunden)
    return {
        "events": {"Ambush": {"left": 31.5, "unit": "game", "used": 1, "max": 1},
                   "ShipChunkDrop": {"left": 6.2, "unit": "game", "used": 2, "max": 2},
                   "Rain": {"left": 12.0, "unit": "game", "used": 1, "max": 1},
                   "Disease_Flu": {"left": 80.0, "unit": "game", "used": 1, "max": 1}},
        "eventTypes": {"good": {"left": 4.3, "unit": "game", "used": 10, "max": 10}} if os.environ.get("FAKE_TYPE_LOCK") else {},
        "eventsAll": {"left": 2.4, "unit": "game", "used": 25, "max": 25} if os.environ.get("FAKE_ALL_LOCK") else None,
        "items": {"left": 9.8, "unit": "game", "used": 50, "max": 50} if os.environ.get("FAKE_ITEM_LOCK") else None,
        "commands": {"duel": {"left": 1.2, "unit": "game"}, "forschung": {"left": 15.0, "unit": "game", "used": 3, "max": 3},
                     "raid": {"left": 20.0, "unit": "game", "used": 3, "max": 3}},
    }


def fake_cooldowns_me():
    # nur fuer den angemeldeten Zuschauer: Echtzeit (Sekunden, laeuft in 300 s herunter, dann wieder von vorn) + Spielzeit
    real = 300 - int(time.time() - FAKE_START) % 300
    return {"slots": {"left": 3.0, "unit": "game"}, "lob": {"left": 7.0, "unit": "game"},
            "chitchat": {"left": real, "unit": "real"}, "flirt": {"left": real, "unit": "real"},
            "buy": {"left": min(real, 20), "unit": "real"},
            "forschung": {"left": 5.0, "unit": "game"}, "benutzen": {"left": 1.5, "unit": "game"},
            "wants": {"left": 12.0, "unit": "game"}, "duel": {"left": 20.0, "unit": "game"}}


RB_WAIT = [0]  # Spielstunden bis !forschung wieder geht (Test)
ALLOWED = ["buy", "use", "equip", "wear", "event", "weather", "bal", "mypawn", "join", "leave", "flirt", "chitchat", "wants", "aspirations", "quirks", "isekai", "duel", "vote", "sethair", "setbeard", "dyehair", "setfavoritecolor", "geschenk", "forschung", "slots", "wette", "lob", "nachhilfe", "pate", "chitchat", "deeptalk", "buildrapport", "reassure", "flirt", "insult", "benutzen"]
ARGS_RE = re.compile(r"^[\w \-.'#@]{0,80}$", re.UNICODE)

LOCK = threading.Lock()
STATE = {"coins": 1234, "karma": 100}
PENDING = {}   # pendingId -> {code, created, token, user}
TOKENS = {}    # token -> user
ACTIONS = {}   # id -> {created, messages}


def need(label, pct):
    return {"label": label, "pct": pct}


def skill(label, level, passion=0, disabled=False):
    return {"label": label, "level": level, "passion": passion, "disabled": disabled}


def cond(label, part=None, bad=True, bleeding=False):
    return {"label": label, "part": part, "bad": bad, "bleeding": bleeding}


def make_pawn(user, display, name, full, gender, age, race, xeno, state, state_label, job, health, mood, mood_label,
              child, adult, skills, traits, conditions, pain, gear, wants, quirks, asp, kills, portrait=1, needs=None):
    return {
        "user": user, "displayName": display, "name": name, "portrait": portrait, "art": portrait,
        "breaks": {"extreme": 5, "major": 20, "minor": 35},
        "healthPct": health, "moodPct": mood, "state": state, "stateLabel": state_label, "job": job,
        "fullName": full, "gender": gender, "age": age, "race": race, "xenotype": xeno,
        "childhood": child, "adulthood": adult, "location": "Kolonie", "moodLabel": mood_label,
        "childhoodDesc": "Als Kind wuchs sie in den Gassen einer Glitzerwelt-Stadt auf und lernte früh, für sich selbst zu sorgen.",
        "adulthoodDesc": "Später kochte sie in einer Raumhafen-Kantine – schnell, laut und immer mit einem Lied auf den Lippen.",
        "psyche": {"personality": {"Rimpsyche_Sociability": 0.72, "Rimpsyche_Tension": -0.45, "Rimpsyche_Diligence": 0.31, "Rimpsyche_Openness": -0.12, "Rimpsyche_Aggressiveness": 0.05, "Rimpsyche_Compassion": 0.88, "Rimpsyche_Imagination": 0.5, "Rimpsyche_Playfulness": -0.66, "Rimpsyche_Humbleness": 0.2, "Rimpsyche_Bravery": 0.4},
                   "interests": {"Cooking": 88, "Music": 74, "Animals": 61, "Combat": 12, "Art": 55, "Science": 30, "Nature": 47},
                   "sexuality": {"orientation": "Bisexuell", "orientationDesc": "Fühlt sich zu mehreren Geschlechtern hingezogen.", "kinsey": 3, "drive": 0.64, "attraction": 0.41},
                   "body": {"fat": 18.5, "muscle": 31.2, "muscleGoal": 38, "exhaustion": 12, "fatigue": [10, 55, 80, 20, 35, 5, 0, 65, 40]}} if user == "yoku" else None,
        "expertise": {"owned": [{"id": "VSE_Chef", "level": 4}], "available": ["Precision"]} if user == "yoku" else {"owned": [], "available": []},
        "psycasts": {"level": 3, "xp": 120, "xpNext": 300, "points": 1, "paths": ["VPE_Conflagrator"], "learned": ["VPE_Fireball"], "learnable": ["VPE_FireBeam"], "learnablePaths": ["VPE_Empath"]} if user == "yoku" else None,
        "ideo": {"id": 1, "name": "Sonnenpfad", "certainty": 82, "role": "Moralführer" if user == "yoku" else None},
        "thoughts": [
            {"label": "Hat eine feine Mahlzeit gegessen", "value": 5, "count": 1, "desc": "Das war richtig gutes Essen."},
            {"label": "Schöne Umgebung", "value": 3, "count": 1, "desc": "Hier ist es hübsch."},
            {"label": "Hat im Regen geschlafen", "value": -4, "count": 2, "desc": "Nass und kalt."},
            {"label": "Schmerz", "value": -6.5, "count": 1, "desc": "Es tut weh."},
            {"label": "Gutes Gespräch mit Kira", "value": 4, "count": 1, "desc": "Das Gespräch mit Kira und Luna Mertens tat gut."},
        ],
        "needs": needs or [need("Nahrung", 72), need("Erholung", 55), need("Schlaf", 81), need("Komfort", 64), need("Schönheit", 40), need("Freude", 33)],
        "capacities": [need("Bewusstsein", 100 if state != "downed" else 28), need("Bewegung", 100 if state != "downed" else 0),
                       need("Sehen", 100), need("Hören", 100), need("Manipulation", 92), need("Sprechen", 100)],
        "skills": skills, "traits": traits, "conditions": conditions, "pain": pain,
        "bleeding": any(c["bleeding"] for c in conditions), "gear": gear,
        "wants": wants, "quirks": quirks, "aspirations": asp, "kills": kills,
    }


ALL_SKILLS = ["Kämpfen im Nahkampf", "Schießen", "Bauen", "Bergbau", "Pflanzenanbau", "Kochen", "Handwerken", "Medizin",
              "Soziales", "Tierhaltung", "Forschung", "Künstlerisch"]


def skills_for(seed):
    out = []
    for i, n in enumerate(ALL_SKILLS):
        lvl = (seed * 7 + i * 5) % 17 + 1
        passion = 2 if lvl > 13 else (1 if lvl > 8 and i % 2 == 0 else 0)
        out.append(skill(n, lvl, passion, disabled=(n == "Künstlerisch" and seed == 3)))
    return out


PAWNS = {
    "yoku": make_pawn(
        "yoku", "Yoku", "Kira", "Kira \"Funke\" Aldemar", "Weiblich", 27, "Mensch", "Basismensch",
        "ok", "Gesund", "Kocht eine einfache Mahlzeit", 96, 71, "Zufrieden",
        "Straßenkind", "Feldköchin", skills_for(1),
        [{"label": "Fleißig", "desc": "Arbeitet schneller als andere, braucht aber mehr Erholung."},
         {"label": "Optimist", "desc": "Gute Laune: +12 Stimmung. Lässt sich nicht so leicht entmutigen."},
         {"label": "Nachtaktiv", "desc": "Fühlt sich nachts am wohlsten und arbeitet dann besser."}],
        [cond("Narbe", "Linker Arm", bad=False), cond("Bionisches Bein", "Rechtes Bein", bad=False)],
        2, {"weapon": "Revolver (gut)", "apparel": ["Kochschürze (normal)", "Cowboyhut", "Lederstiefel (meisterhaft)"],
            "inventory": ["Bier x3", "Verband x2", "Silber x120"],
            "inventoryItems": [{"id": "#t9001", "label": "Einfache Mahlzeit", "count": 2, "kind": "food", "icon": None}, {"id": "#t9002", "label": "Bier", "count": 3, "kind": "drug", "icon": None}, {"id": "#t9003", "label": "Parka (gut)", "count": 1, "kind": "apparel", "icon": None}, {"id": "#t9004", "label": "Kurzschwert (normal)", "count": 1, "kind": "weapon", "icon": None}, {"id": "#t9005", "label": "Verband", "count": 2, "kind": "other", "icon": None}]},
        {"points": 40, "needed": 100, "list": [
            {"label": "Kochen bis Stufe 12", "desc": "Erreiche Stufe 12 in Kochen.", "reward": 20},
            {"label": "Ein Fest feiern", "desc": "Lade die Kolonie zu einem Fest ein.", "reward": 30}]},
        [{"label": "Schnarcher", "desc": "Weckt andere Kolonisten im selben Raum."}],
        {"pct": 50, "list": [{"label": "Meisterköchin werden", "done": True}, {"label": "Ein Haus mit Garten", "done": False}]},
        12, 1),
    "mira_spielt": make_pawn(
        "mira_spielt", "Mira_spielt", "Mira", "Mira Voss", "Weiblich", 34, "Mensch", "Basismensch",
        "downed", "Niedergestreckt", "Liegt am Boden", 31, 38, "Am Rande",
        "Söldnerkind", "Kopfgeldjägerin", skills_for(2),
        [{"label": "Brutal", "desc": "Mag Gewalt: +Stimmung durch Kämpfe, aber verstört andere."},
         {"label": "Schnelle Läuferin", "desc": "Bewegt sich merklich schneller."}],
        [cond("Schusswunde", "Brust", bad=True, bleeding=True), cond("Schnitt", "Linker Arm", bad=True, bleeding=True),
         cond("Prellung", "Kopf", bad=True), cond("Grippe", None, bad=True)],
        64, {"weapon": "Sturmgewehr (normal)", "apparel": ["Kampfweste", "Helm (schlecht)"], "inventory": ["Verband x1"]},
        {"points": 85, "needed": 100, "list": [{"label": "Überleben!", "desc": "Überstehe den Angriff.", "reward": 15}]},
        [], {"pct": 20, "list": [{"label": "Ein Feind weniger", "done": False}]}, 47, 2,
        needs=[need("Nahrung", 45), need("Erholung", 18), need("Schlaf", 30), need("Komfort", 50)]),
    "eddi_tv": make_pawn(
        "eddi_tv", "Eddi_TV", "Eddi", "Eddi Brandt", "Männlich", 19, "Mensch", "Sanguophage-Erbe",
        "sleeping", "Schläft", "Schläft im Bett", 100, 88, "Glücklich",
        None, "Student", skills_for(3),
        [{"label": "Langschläfer", "desc": "Braucht mehr Schlaf, ist dafür ausgeruht sehr produktiv."}],
        [], 0, {"weapon": None, "apparel": ["Schlafanzug"], "inventory": []},
        None, None, None, 0, portrait=0),
    "luna_88": make_pawn(
        "luna_88", "luna_88", "Luna", "Luna Mertens", "Weiblich", 41, "Mensch", "Basismensch",
        "ok", "Gesund", "Pflegt Pflanzen im Garten", 82, 54, "Okay",
        "Gelehrtenkind", "Gärtnerin", skills_for(4),
        [{"label": "Grüner Daumen", "desc": "Pflanzen wachsen bei ihr schneller."},
         {"label": "Pazifistin", "desc": "Kann keine Gewalt ausüben."},
         {"label": "Kerngesund", "desc": "Krankheiten haben kaum Chancen."},
         {"label": "Schöngeist", "desc": "Liebt schöne Räume, hasst hässliche."}],
        [cond("Alterswehwehchen", "Rücken", bad=True), cond("Hörgerät", "Linkes Ohr", bad=False)],
        18, {"weapon": None, "apparel": ["Gartenkittel", "Strohhut"], "inventory": ["Rübensamen x20"]},
        {"points": 10, "needed": 100, "list": [{"label": "Rosen züchten", "desc": "Baue 10 Rosen an.", "reward": 25}]},
        [{"label": "Redselig", "desc": "Plaudert bei jeder Gelegenheit."}, {"label": "Kitzlig", "desc": "Zuckt bei Berührung."}],
        {"pct": 75, "list": [{"label": "Ein Gewächshaus bauen", "done": True}, {"label": "Alle Pflanzen kennen", "done": True},
                             {"label": "Rosenkönigin", "done": False}]}, 3),
}
for _p in PAWNS.values():
    _p["id"] = _p["user"]          # echte Schnittstelle liefert eine Pawn-ID; hier gleich dem Namen
ALLOWED_USERS = {"yoku": "Yoku"}



# ---------- Isekai-Baeume ----------
def tree_nodes(spec):
    return [{"id": i, "label": l, "desc": d, "type": t, "x": x, "y": y, "cost": c, "bonuses": ["+3% Nahkampfschaden", "+2% Bewegungstempo"] if t != "start" else []} for (i, l, d, t, x, y, c) in spec]


TREES = {
    "krieger": {
        "id": "krieger", "className": "Klingenmeister",
        "desc": "Nahkampf-Klasse: wer zuerst zuschlägt, gewinnt.", "gimmick": "Klingentanz",
        "gimmickDesc": "Jeder Treffer im Nahkampf erhöht kurz das Angriffstempo.",
        "nodes": tree_nodes([
            ("kr_start", "Kämpferblut", "Der Anfang jedes Klingenmeisters: +5 % Nahkampfschaden.", "start", 0, 0, 0),
            ("kr_a1", "Stahlhaut", "+4 % Schadensreduktion.", "minor", -1, 1, 1),
            ("kr_a2", "Harte Hiebe", "+6 % Nahkampfschaden.", "minor", 1, 1, 1),
            ("kr_a3", "Eiserne Haut", "Wunden heilen 20 % schneller, Rüstung wirkt besser.", "notable", -2, 2, 2),
            ("kr_a4", "Kampfrausch", "Nach jedem Treffer: +10 % Tempo für 5 Sekunden.", "notable", 0, 2, 2),
            ("kr_a5", "Schneller Schritt", "+8 % Bewegungstempo.", "minor", 2, 2, 1),
            ("kr_a6", "Zähigkeit", "+10 Lebenspunkte.", "minor", -1, 3, 1),
            ("kr_a7", "Wirbelschlag", "Chance auf einen Rundumschlag gegen mehrere Gegner.", "minor", 1, 3, 1),
            ("kr_a8", "Bollwerk", "Blockt Fernkampfschaden zu 15 %.", "notable", -2, 4, 2),
            ("kr_a9", "Unbesiegbar", "Fällt dein Leben unter 20 %, wirst du einmal pro Tag vollständig geheilt.", "keystone", 0, 4, 4),
            ("kr_a10", "Klingenorkan", "Nahkampfangriffe treffen alle Gegner im Umkreis.", "notable", 2, 4, 3),
            ("kr_a11", "Letzter Atemzug", "Im Niedergestreckt-Zustand: kurz unverwundbar.", "minor", 0, 5, 1),
        ]),
        "links": [["kr_start", "kr_a1"], ["kr_start", "kr_a2"], ["kr_a1", "kr_a3"], ["kr_a1", "kr_a4"], ["kr_a2", "kr_a4"],
                  ["kr_a2", "kr_a5"], ["kr_a3", "kr_a6"], ["kr_a4", "kr_a6"], ["kr_a4", "kr_a7"], ["kr_a5", "kr_a7"],
                  ["kr_a6", "kr_a8"], ["kr_a6", "kr_a9"], ["kr_a7", "kr_a9"], ["kr_a7", "kr_a10"], ["kr_a9", "kr_a11"]],
    },
    "magier": {
        "id": "magier", "className": "Äthermagier",
        "desc": "Fernkampf und Zauber aus sicherer Entfernung.", "gimmick": None, "gimmickDesc": None,
        "nodes": tree_nodes([
            ("mg_start", "Funke des Äthers", "Du spürst den Äther: +5 % Zauberkraft.", "start", 0, 0, 0),
            ("mg_b1", "Konzentration", "+8 % Zauberkraft.", "minor", -2, 1, 1),
            ("mg_b2", "Schneller Zauber", "-10 % Zauberdauer.", "minor", 0, 1, 1),
            ("mg_b3", "Flüsternde Winde", "+6 % Reichweite.", "minor", 2, 1, 1),
            ("mg_b4", "Feuerball", "Schaltet den Feuerball frei.", "notable", -3, 2, 2),
            ("mg_b5", "Blitzschlag", "Schaltet den Blitzschlag frei.", "notable", -1, 2, 2),
            ("mg_b6", "Eisnadel", "Schaltet die Eisnadel frei.", "notable", 1, 2, 2),
            ("mg_b7", "Manafluss", "Mana regeneriert 25 % schneller.", "minor", 3, 2, 1),
            ("mg_b8", "Sturmruf", "Mehrere Blitze auf einmal.", "minor", -2, 3, 1),
            ("mg_b9", "Frostpanzer", "Eis schützt dich vor Schaden.", "minor", 2, 3, 1),
            ("mg_b10", "Erzmagier", "Alle Zauber kosten 30 % weniger Mana.", "keystone", 0, 4, 5),
            ("mg_b11", "Ätherriss", "Teleportiert dich kurz.", "notable", 0, 3, 3),
        ]),
        "links": [["mg_start", "mg_b1"], ["mg_start", "mg_b2"], ["mg_start", "mg_b3"], ["mg_b1", "mg_b4"], ["mg_b1", "mg_b5"],
                  ["mg_b2", "mg_b5"], ["mg_b2", "mg_b6"], ["mg_b3", "mg_b6"], ["mg_b3", "mg_b7"], ["mg_b5", "mg_b8"],
                  ["mg_b6", "mg_b9"], ["mg_b2", "mg_b11"], ["mg_b11", "mg_b10"], ["mg_b8", "mg_b10"], ["mg_b9", "mg_b10"]],
    },
}


def isekai_data(tree, level, xp, xp_next, rank, points, stat_points, stats, unlocked):
    d = {"level": level, "xp": xp, "xpNext": xp_next, "rank": rank, "tree": tree,
         "className": TREES[tree]["className"] if tree else None, "entered": [tree] if tree else [],
         "points": points, "statPoints": stat_points, "stats": stats, "unlocked": unlocked, "learnable": []}
    recompute_learnable(d)
    return d


def recompute_learnable(d):
    """Lernbar = direkter Nachbar eines gelernten Knotens (mit genug Punkten); ohne Klasse die Startknoten."""
    if not d["tree"]:
        d["learnable"] = [t["nodes"][0]["id"] for t in TREES.values()]
        return
    t = TREES[d["tree"]]
    cost = {n["id"]: n["cost"] for n in t["nodes"]}
    out = set()
    for a, b in t["links"]:
        for x, y in ((a, b), (b, a)):
            if x in d["unlocked"] and y not in d["unlocked"]:
                out.add(y)
    d["learnable"] = [n["id"] for n in t["nodes"] if n["id"] in out and cost[n["id"]] <= d["points"]]


# Test: Stimmungen ueberschreiben, z. B. FAKE_MOODS="mira_spielt=3,luna_88=27,yoku=15"; Farb-Tags in Eigenschaft (Test fuer Rich-Text)
for _kv in filter(None, os.environ.get("FAKE_MOODS", "").split(",")):
    _u, _, _v = _kv.partition("=")
    if _u in PAWNS:
        PAWNS[_u]["moodPct"] = float(_v)
def _gene(label, cat, mod, met, arc, cpx, desc, active=True, icon=None):
    return {"label": label, "desc": desc, "cat": cat, "mod": mod, "icon": icon or ("g_" + label.replace(" ", "")),
            "active": active, "met": met, "arc": arc, "cpx": cpx}


PAWNS["yoku"]["genes"] = {
    "xenotype": {"label": "Hochmensch", "icon": "x_Highmate",
                 "desc": "Ein Mensch mit stark verbesserten Genen: hohe Intelligenz, Schönheit und Lebenserwartung. Die Einzigartigkeit hat ihren Preis im Stoffwechsel."},
    "endo": [
        _gene("Schönheit, stark", "Kosmetisch", "Biotech", 0, 0, 1, "Pawns mit diesem Gen sind außergewöhnlich schön.\n\nSchönheit: +2"),
        _gene("Haarfarbe: Kupfer", "Kosmetisch", "Biotech", 0, 0, 1, "Bestimmt die Haarfarbe.", icon="0"),
        _gene("Flinke Finger", "Fähigkeit", "Biotech", -1, 0, 1, "Hände von Natur aus flink.\n\nManipulation: +10 %"),
        _gene("Robust", "Verschiedenes", "Biotech", 1, 0, 1, "Hohe Widerstandskraft gegen Krankheit.\n\nKrankheitsresistenz +20 %"),
        _gene("Dunkle Haut", "Kosmetisch", "Biotech", 0, 0, 1, "Haut dunkel getönt. (Wird von einem anderen Gen überschrieben.)", active=False),
    ],
    "xeno": [
        _gene("Scharfer Verstand", "Fähigkeit", "Biotech", -2, 0, 2, "Der Verstand arbeitet überdurchschnittlich schnell.\n\nBewusstsein: +15 %\nLernen: +25 %"),
        _gene("Langlebig", "Verschiedenes", "Biotech", -1, 0, 1, "Alter wird langsamer. Lebenserwartung +40 %."),
        _gene("Schnelle Wundheilung", "Verschiedenes", "Biotech", -2, 0, 2, "Wunden heilen mehrfach schneller."),
        _gene("Archit: Eisenhaut", "Archit", "Biotech", -3, 1, 3, "Haut so zäh wie Eisen.\n\nRüstung gegen Hieb: +30 %"),
        _gene("Blutspender", "Verschiedenes", "Vanilla Genetics Expanded", 1, 0, 1, "Das Blut ist mit Nährstoffen angereichert. Kann ohne Schaden öfter Blut spenden."),
        _gene("Mondlicht-Seher", "Fähigkeit", "Alpha Genes", 0, 0, 2, "Sieht auch bei Nacht gut.\n\nNachtsicht: keine Lichtstrafe"),
    ],
}
for _g in PAWNS["yoku"]["genes"]["endo"] + PAWNS["yoku"]["genes"]["xeno"]:
    if _g["icon"] == "0":
        _g["icon"] = None   # Gen ohne Symbol testen
PAWNS["yoku"]["traits"].append({"label": "<color=#66B3FF>Rang b</color>", "desc": "<b>Abenteurerrang</b>: <color=#66B3FF>Rang b</color> der Gilde."})
PAWNS["yoku"]["isekai"] = isekai_data("krieger", 7, 340, 500, "D-Rang", 3, 2,
                                      {"str": 12, "dex": 9, "vit": 11, "int": 6, "wis": 7, "cha": 8},
                                      ["kr_start", "kr_a1", "kr_a2", "kr_a4"])
PAWNS["luna_88"]["isekai"] = isekai_data(None, 2, 40, 120, None, 1, 0,
                                         {"str": 5, "dex": 6, "vit": 6, "int": 9, "wis": 8, "cha": 7}, [])
def _gear_item(text):
    """Aus "Revolver (gut)" ein GearItem wie in der Mod machen: label, icon, quality 0-6, qualityLabel, hpPct."""
    if not text:
        return None
    qmap = {"schrott": 0, "schlecht": 1, "normal": 2, "gut": 3, "hervorragend": 4, "meisterhaft": 5, "legendär": 6}
    label, q = text, None
    if "(" in text and text.endswith(")"):
        label, q = text[:text.index("(")].strip(), text[text.index("(") + 1:-1].strip().lower()
    hp = 40 + int(hashlib.md5(text.encode()).hexdigest()[:2], 16) % 61
    return {"label": label, "icon": "t_" + "".join(c for c in label if c.isalnum()),
            "quality": qmap.get(q) if q in qmap else None, "qualityLabel": q.capitalize() if q in qmap else None,
            "hpPct": hp}


for _p in PAWNS.values():
    _g = _p["gear"]
    _g["weaponItem"] = _gear_item(_g.get("weapon"))
    _g["apparelItems"] = [_gear_item(a) for a in _g.get("apparel", [])]
    for _i, _t in enumerate(_p["thoughts"]):   # manche Gedanken haben ein Symbol, manche nicht
        _t["icon"] = ["h_AteFineMeal", "h_Beauty", None, "h_Pain", None][_i % 5]
    if _p["wants"]:
        for _i, _w in enumerate(_p["wants"]["list"]):
            if _i % 3 != 2:   # bei jedem dritten kennt die Mod keinen Teilfortschritt -> Feld fehlt
                _w["pct"] = [35, 80, 0, 12][_i % 4]
    _p.setdefault("isekai", None)
    _p["bonds"] = {"yoku": ["Rex (Husky)"], "luna_88": ["Mieze (Katze)"]}.get(_p["user"], [])
    if _p["wants"]:
        _p["wants"]["rewardPoints"] = 3 if _p["user"] == "yoku" else 0
        for _i, _w in enumerate(_p["wants"]["list"]):
            _w["rerollable"] = _i % 2 == 0

# ---------- Arbeit (work/workEditable) ----------
WORK_DEFS = [("Cooking", "Kochen"), ("Doctor", "Medizin"), ("Firefighter", "Feuerwehr"), ("Construction", "Bauen"),
             ("Mining", "Bergbau"), ("Hauling", "Transport"), ("Cleaning", "Reinigen"), ("Art", "Kunst")]
WORK_PRIO = {
    "yoku": {"Cooking": 1, "Doctor": 3, "Firefighter": 2, "Construction": 2, "Mining": 0, "Hauling": 4, "Cleaning": 3, "Art": 0},
    "mira_spielt": {"Cooking": 0, "Doctor": 2, "Firefighter": 1, "Construction": 3, "Mining": 4, "Hauling": 0, "Cleaning": 0, "Art": 0},
    "eddi_tv": {"Cooking": 3, "Doctor": 0, "Firefighter": 4, "Construction": 1, "Mining": 2, "Hauling": 0, "Cleaning": 3, "Art": 2},
    "luna_88": {"Cooking": 2, "Doctor": 1, "Firefighter": 0, "Construction": 0, "Mining": 0, "Hauling": 3, "Cleaning": 1, "Art": 4},
}
for _p in PAWNS.values():
    _u = _p["user"]
    _p["work"] = [{"id": i, "label": l, "prio": WORK_PRIO[_u].get(i, 0),
                   "disabled": (_p["state"] == "downed" and i in ("Construction", "Mining", "Hauling", "Cleaning"))}
                  for i, l in WORK_DEFS]
    _p["workEditable"] = _u == "yoku"

# ---------- Tage in der Kolonie, Isekai-Stufe (PawnSummary/PawnDetail, für Abzeichen und Ranglisten) ----------
DAYS_IN_COLONY = {"yoku": 212, "mira_spielt": 37, "eddi_tv": 9, "luna_88": 365}
for _p in PAWNS.values():
    _p["daysInColony"] = DAYS_IN_COLONY[_p["user"]]
    _p["isekaiLevel"] = _p["isekai"]["level"] if _p["isekai"] else None


# ---------- Beziehungen (Log: relations) ----------
def rel(name, user, rels, op, theirs, dead=False, animal=False):
    return {"name": name, "id": user or name, "portrait": 1 if user else 0, "user": user, "relations": rels, "opinion": op, "theirs": theirs,
            "colonist": user is not None, "dead": dead, "animal": animal}


RELATIONS = {
    "yoku": [rel("Luna Mertens", "luna_88", ["Mutter"], 60, 55),
             rel("Eddi Brandt", "eddi_tv", ["Bruder"], 20, 15),
             rel("Jonas Krag", None, ["Ex-Partner"], -40, -55),
             rel("Olaf Aldemar", None, ["Vater"], 0, 0, dead=True),
             rel("Mira Voss", "mira_spielt", [], 35, -10),
             rel("Sven Reiter", None, [], -25, -30),
             rel("Pia Lund", None, [], 12, 4),
             rel("Tom Berg", None, [], 48, 40),
             rel("Hanna Wolf", None, [], -60, -35),
             rel("Jan Westmann", None, [], 5, 0),
             rel("Rex", None, [], 0, 0, animal=True)],
    "mira_spielt": [rel("Kira Aldemar", "yoku", [], 30, 35),
                    rel("Luna Mertens", "luna_88", [], -15, 5)],
    "luna_88": [rel("Kira Aldemar", "yoku", ["Tochter"], 70, 60),
                rel("Eddi Brandt", "eddi_tv", [], 10, 8)],
    "eddi_tv": [rel("Kira Aldemar", "yoku", ["Schwester"], 25, 15)],
}

# ---------- Ereignisse (Chronik mit Text) ----------
EVENTS = [
    {"label": "🟡 Rimazon Delivery - Luna", "text": "RIMAZON INVOICE ==== Customer: luna_88 Item: 2x Bier Delivery: Locker Delivery. Thank you for shopping with Rimazon!", "kind": "neutral", "ago": "6 Stunden", "day": 37},
    {"label": "Rimazon Pet Delivery - Eddi", "text": "Ein Tier wurde geliefert.", "kind": "good", "ago": "8 Stunden", "day": 37},
    {"img": {"type": "img", "img": "faction-pirates", "name": "Plünderer"}, "label": "Überfall: Plünderer", "text": "Fünf Plünderer sind über den Nordpass gekommen. Zwei wurden erledigt, die übrigen flohen.", "kind": "threat", "ago": "2 Stunden", "day": 37},
    {"img": {"type": "img", "img": "Steel", "name": "Stahl"}, "label": "Händler aus Fernost", "text": "Ein Händler hat drei Kisten Stahl gegen Reis getauscht.", "kind": "good", "ago": "7 Stunden", "day": 37},
    {"label": "Zwielicht am Himmel", "text": "Ein seltsames Licht stand über dem Tal. Danach war alles wie vorher.", "kind": "neutral", "ago": "9 Stunden", "day": 37},
    {"img": {"type": "pawn", "id": "mira_spielt", "name": "Mira Voss", "portrait": 1}, "label": "Pawn ist krank: Grippe", "text": "Mira hat sich bei einem Wanderer angesteckt und liegt im Bett.", "kind": "bad", "ago": "1 Tag", "day": 36},
    {"img": {"type": "pawn", "id": "jan", "name": "Jan", "portrait": 0}, "label": "Wanderer schließt sich an", "text": "Ein Wanderer aus dem Westen wollte bleiben. Sein Name ist Jan.", "kind": "good", "ago": "2 Tage", "day": 35},
    {"label": "Wetterwechsel", "text": "Der Regen hat aufgehört. Es ist jetzt trocken und warm.", "kind": "neutral", "ago": "3 Tage", "day": 34},
    {"img": {"type": "img", "img": "404", "name": "Fehlt"}, "label": "Kurze Kälte", "text": "Die Temperatur ist für einen Tag unter den Gefrierpunkt gefallen.", "kind": "bad", "ago": "4 Tage", "day": 33},
    {"label": "Schwarm Fledermäuse", "text": "Ein Schwarm ist in die Höhle gezogen. Niemand wurde verletzt.", "kind": "neutral", "ago": "5 Tage", "day": 32},
    {"label": "Mondfest", "text": "Die Kolonie hat gefeiert. Die Stimmung ist deutlich gestiegen.", "kind": "good", "ago": "6 Tage", "day": 31},
]

# ---------- Abstimmung (RICS Voting): 90 s offen, dann 20 s Pause ----------
ASK = os.environ.get("FAKE_ASK") == "1"   # eigene freie Frage des Streamers statt Event-Abstimmung
ASK_Q = "Was soll Svenja heute als Erstes bauen?"
VOTE_OPTS = ["Eine Hütte", "Ein Lagerfeuer", "Eine Falle"] if ASK else ["Überfall: Plünderer", "Hitzewelle", "Händler-Besuch", "Wanderer aufnehmen"]
VOTE = {"cycle": -1, "counts": [0] * len(VOTE_OPTS)}


def vote_phase():
    t = int(time.time())
    return t // 110, t % 110


def vote_state():
    cyc, ph = vote_phase()
    if ph >= 90:
        return {"open": False}
    if VOTE["cycle"] != cyc:
        VOTE["cycle"] = cyc
        VOTE["counts"] = [5 + secrets.randbelow(20) for _ in VOTE_OPTS]
    total = sum(VOTE["counts"])
    opts = [{"label": l, "count": c, "pct": round(c * 100 / total) if total else 0} for l, c in zip(VOTE_OPTS, VOTE["counts"])]
    res = {"open": True, "kind": "frage" if ASK else "event", "options": opts, "total": total, "secondsLeft": 90 - ph}
    if ASK:
        res.update({"question": ASK_Q, "answers": list(VOTE_OPTS), "votes": list(VOTE["counts"]), "remaining": 90 - ph})
    return res


# ---------- Herausforderung (Duell): alle 120 s fuer 45 s, Antwort beendet sie ----------
DUEL = {"answered": -1}


def duel_state():
    t = int(time.time())
    cyc, ph = t // 120, t % 120
    if not (30 <= ph < 75) or DUEL["answered"] == cyc:
        return None
    return {"from": "Mira", "fromUser": "mira_spielt", "secondsLeft": 75 - ph}


# ---------- Tiere, Quirk-Angebote, Forschung ----------
def an(id_, name, kind, gender, age, health, bond=None, master=None, img="", sponsor=None, conditions=None, pain=0):
    conditions = conditions or []
    return {"id": id_, "name": name, "kind": kind, "gender": gender, "age": age, "healthPct": health, "bond": bond, "master": master,
            "img": img or None, "sponsor": sponsor, "conditions": conditions, "pain": pain,
            "bleeding": any(c["bleeding"] for c in conditions),
            "bondId": FAKE_IDS.get(bond), "masterId": FAKE_IDS.get(master),
            "needs": [{"label": "Hunger", "pct": (sum(map(ord, id_)) * 37) % 100}, {"label": "Ruhe", "pct": (sum(map(ord, id_)) * 53) % 100},
                      {"label": "Freude", "pct": (sum(map(ord, id_)) * 71) % 100}]}


FAKE_IDS = {"Kira": "yoku", "Mira": "mira_spielt", "Eddi": "eddi_tv", "Luna": "luna_88"}


ANIMALS = [
    an("p101", "Rex", "Husky", "Männlich", 4.2, 96, "Kira", "Kira", "husky", sponsor="luna_88"),
    an("p102", "Mieze", "Katze", "Weiblich", 2.1, 88, "Luna", None, "katze", conditions=[cond("Narbe", "Ohr", bad=False)]),
    an("p103", "Bruno", "Alpaka", "Männlich", 5.0, 100, None, "Luna", "alpaka"),
    an("p104", None, "Huhn", "Weiblich", 1.3, 74, None, None, "huhn", conditions=[cond("Grippe", None)], pain=12),
    an("p105", None, "Huhn", "Weiblich", 0.8, 100, None, None, "huhn"),
    an("p106", "Schnauzi", "Wildschwein", "Männlich", 3.4, 35, None, None, "",   # ohne Bild (img null) -> Platzhalter
       conditions=[cond("Schusswunde", "Flanke", bleeding=True), cond("Biss", "Bein"), cond("Infektion", None), cond("Prellung", "Kopf"), cond("Narbe", "Rücken", bad=False)], pain=58),
    an("p107", "Fridolin", "Ziege", "Männlich", 2.5, 90, None, None, "404"),         # Bild liefert 404 -> Platzhalter per onerror
]
if os.environ.get("FAKE_MANY"):
    ANIMALS += [an("p2%02d" % i, None, "Huhn", "Weiblich", 1.0 + i / 10, 60 + i * 5, img="huhn", pain=8 if i == 2 else 0) for i in range(5)]
    ANIMALS += [an("p3%02d" % i, None, "Alpaka", "Männlich", 2.0 + i, 90, None, "Luna" if i == 0 else None, "alpaka") for i in range(3)]

QUIRK_OFFERS = [
    {"label": "Frühaufsteher", "desc": "Braucht weniger Schlaf und ist morgens besonders fit.", "rarity": "common"},
    {"label": "Glückskind", "desc": "Hin und wieder fällt ein kleines Geschenk vom Himmel.", "rarity": "uncommon"},
    {"label": "Drachenblut", "desc": "Feuer kann dir deutlich weniger anhaben.", "rarity": "rare"},
    {"label": "Unsterblicher Funke", "desc": "Einmal pro Jahr kehrst du aus dem Tod zurück.", "rarity": "legendary"},
]


def research_info():
    def pr(label, state, pct=0, desc=""):
        return {"label": label, "state": state, "pct": pct, "desc": desc or "Beschreibung zu " + label + "."}
    return {
        "current": {"label": "Elektrizität", "pct": 62},
        "tabs": [
            {"label": "Grundlagen", "done": 6, "total": 9, "projects": [
                pr("Steinmetzkunst", 3), pr("Töpferei", 3), pr("Kochen", 3), pr("Pflanzenanbau", 3), pr("Schmiedekunst", 3), pr("Holzverarbeitung", 3),
                pr("Elektrizität", 2, 62, "Strom für Lampen, Kühlschrank und mehr."), pr("Batterien", 1), pr("Solarenergie", 0)]},
            {"label": "Waffen", "done": 2, "total": 8, "projects": [
                pr("Bögen", 3), pr("Einfache Gewehre", 3), pr("Granaten", 1, 0, "Wurfwaffe mit großem Schaden."), pr("Mörser", 1),
                pr("Sturmgewehre", 0), pr("Raketenwerfer", 0), pr("Plasmawaffen", 0), pr("Monoschwerter", 0)]},
            {"label": "Medizin", "done": 3, "total": 7, "projects": [
                pr("Kräutermedizin", 3), pr("Verbandszeug", 3), pr("Prothesen", 3), pr("Medizinische Maschinen", 1),
                pr("Bionik", 0), pr("Organtransplantation", 0), pr("Neuroimplantate", 0)]},
        ],
    }


def isekai_info():
    return {"skilling": True, "trees": list(TREES.values())}


def png(seed):
    """Kleines generiertes PNG (64x64) - Verlauf mit einer Figur aus Kreisen."""
    w = h = 64
    h1 = hashlib.md5(seed.encode()).digest()
    base = (h1[0] // 2 + 60, h1[1] // 2 + 60, h1[2] // 2 + 60)
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            r, g, b = base
            d_head = (x - 32) ** 2 + (y - 22) ** 2
            d_body = (x - 32) ** 2 / 1.8 + (y - 52) ** 2 / 0.9
            if d_head < 150:
                r, g, b = 230, 190, 160
            elif d_body < 380:
                r, g, b = h1[3], h1[4], h1[5]
            else:
                f = 0.7 + 0.3 * (y / h)
                r, g, b = int(r * f), int(g * f), int(b * f)
            row += bytes((r, g, b))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def summary(p):
    keys = ["id", "user", "displayName", "name", "portrait", "healthPct", "moodPct", "state", "stateLabel", "job",
            "kills", "daysInColony", "isekaiLevel"]
    return {k: p[k] for k in keys}


# ---------- Gedenkwand, Koloniewert-Verlauf, Fraktionen, Besucher (GameInfo) ----------
for _i, _e in enumerate(EVENTS):
    _e["letterDef"] = {"threat": "ThreatBig", "bad": "NegativeEvent", "good": "PositiveEvent"}.get(_e["kind"], "NeutralEvent")
    _e["def"] = ["RaidEnemy", "OrbitalTraderArrival", "ShortCircuit", "FoodFight", None, "Disease_Flu", "WandererJoin", "WeatherChange"][_i % 8] or _e["letterDef"]

MEMORIALS = [
    {"name": "Olaf", "fullName": "Olaf Aldemar", "user": None, "cause": "Schussverletzung (Plünderer)",
     "diedDay": 29, "joinedDay": 3, "age": 58, "kills": 6, "ago": "8 Tage", "portrait": "m_olaf", "causeKind": "shot"},
    {"name": "Fenja", "fullName": "Fenja Pixel", "user": "fenja_pixel", "cause": "Blutverlust nach einem Angriff",
     "diedDay": 33, "joinedDay": 20, "age": 22, "kills": 2, "ago": "4 Tage", "portrait": None, "causeKind": "bleed"},
]
NOISE = [0, 90, -60, 40, -120, 70, 20, 0, 10]   # kleine Schwankungen; Tag 37 (letzter Punkt) ist exakt 48250
WEALTH_HISTORY = [[d, 41000 + (d - 8) * 250 + NOISE[(d * 7) % 9]] for d in range(8, 38)]
FACTIONS = [
    {"name": "Glitzerwelt", "kind": "Imperium", "goodwill": 62, "hasGoodwill": True, "relation": "ally", "img": "f_Empire_FFD700"},
    {"name": "Pilzbund", "kind": "Stamm", "goodwill": 8, "hasGoodwill": True, "relation": "neutral", "img": "f_Tribe_55AA55"},
    {"name": "Schwarzer Pakt", "kind": "Piraten", "goodwill": -74, "hasGoodwill": True, "relation": "hostile", "img": "f_Pirate_CC3333"},
    {"name": "Raumhafen-Kette", "kind": "Händler", "goodwill": 0, "hasGoodwill": False, "relation": "neutral", "img": None},
]
VISITORS = {
    "groups": [{"faction": "Glitzerwelt", "count": 4, "trader": "Waffenhändler"}],
    "ships": ["Handelsschiff Silbermöwe"],
}

# ---------- Lebensgeschichte (Log: story) ----------
STORY = {
    "yoku": [
        {"day": 3, "text": "Kira kam als Wanderin in die Kolonie und fing gleich an zu kochen.", "ago": "34 Tage"},
        {"day": 9, "text": "Ihr erstes Festmahl: 40 Portionen für die ganze Kolonie.", "ago": "28 Tage"},
        {"day": 17, "text": "Im Kampf gegen Plünderer hat sie zum ersten Mal den Revolver benutzt.", "ago": "20 Tage"},
        {"day": 24, "text": "Die Narbe am linken Arm ist verheilt. Sie sagt, es sehe gefährlich aus.", "ago": "13 Tage"},
        {"day": 31, "text": "Hat Eddi bei einem Streit beigestanden und ihn nach Hause gebracht.", "ago": "6 Tage"},
        {"day": 36, "text": "Hat Rex gefunden, der seitdem ihr treuer Begleiter ist.", "ago": "1 Tag"},
    ],
    "mira_spielt": [
        {"day": 20, "text": "Nach einem Überfall niedergestreckt, aber von den anderen gerettet.", "ago": "17 Tage"},
        {"day": 30, "text": "Hat zum ersten Mal einen Plünderer alleine besiegt.", "ago": "7 Tage"},
    ],
}


def duel_fight(t):
    """Fake-Duell Mira gegen Luna: immer vorhanden; 40 s Wetten offen, 20 s zu (Zyklus 60 s). Wettsummen wachsen mit der Zeit."""
    ph = t % 60
    open_ = ph < 40
    ba, bb = 300 + ph * 9, 180 + ph * 5 + BETS["b"]
    return {"a": {"name": "Mira", "user": "mira_spielt", "id": "mira_spielt", "healthPct": max(10, 100 - ph) if not open_ else None, "bets": ba + BETS["a"]},
            "b": {"name": "Luna", "user": "luna_88", "id": "luna_88", "healthPct": max(15, 90 - ph // 2) if not open_ else None, "bets": bb},
            "betOpen": open_, "betSecondsLeft": max(0, 40 - ph) if open_ else 0, "minBet": 10, "maxBet": 500,  # Sekunden = Spielsekunden
            "pot": ba + BETS["a"] + bb}


BETS = {"a": 0, "b": 0}


def game_info():
    t = int(time.time())
    return {
        "giftPrice": 150,
        "slots": {"minBet": 10, "maxBet": 200, "cooldownHours": 6},
        "duel": duel_fight(t),
        "praise": {"yoku": 12, "mira_spielt": 7, "luna_88": 3, "eddi_tv": 0},
        "tutor": {"price": 100, "minLevel": 6, "gap": 2},
        "sponsorPrice": 300,
        "cooldowns": fake_cooldowns_global(),
        "researchBoost": {"price": 800, "percent": 25, "viewerCooldownHours": 24, "maxPerDay": 3},
        "colony": "Neu-Yoku", "date": "5. Aprimay 5501", "day": 37, "hour": (t // 20) % 24,
        "season": "Frühling", "seasonKey": "Spring", "weatherDef": "RainyLight", "weather": "Leichter Regen", "temperature": "12 °C", "wealth": 48250 + (t // 10) % 7 * 10,
        "colonists": 6, "prisoners": 1, "animals": 9, "viewerPawns": len(PAWNS),
        "storyteller": "Cassandra Classic", "difficulty": "Herausforderung",
        "research": {"label": "Elektrizität", "pct": 62},
        "conditions": [
            {"label": "Hitzewelle", "desc": "Es ist ungewöhnlich heiß.", "left": "1,2 Tage", "kind": "HeatWave", "good": False},
            {"label": "Toxischer Niederschlag", "desc": "Gift liegt in der Luft.", "left": "3 Tage", "kind": "ToxicFallout", "good": False},
            {"label": "Polarlicht", "desc": "Der Himmel leuchtet.", "left": "8 Stunden", "kind": "Aurora", "good": True},
            {"label": "Ruhige Zeiten", "desc": "Der Erzähler hält sich zurück.", "left": None, "kind": "QuietTimes", "good": None}],
        "events": [
            {"label": "Überfall: Plünderer", "kind": "threat", "ago": "vor 2 Stunden", "day": 37, "def": "RaidEnemy", "letterDef": "ThreatBig"},
            {"label": "Händler aus Fernost", "kind": "good", "ago": "vor 7 Stunden", "day": 37, "def": "OrbitalTraderArrival", "letterDef": "PositiveEvent"},
            {"label": "Pawn ist krank: Grippe", "kind": "bad", "ago": "vor 1 Tag", "day": 36},
            {"label": "Wanderer schließt sich an", "kind": "good", "ago": "vor 2 Tagen", "day": 35},
            {"label": "Wetterwechsel", "kind": "neutral", "ago": "vor 3 Tagen", "day": 34}],
        "animalList": ANIMALS,
        "quirkOffers": QUIRK_OFFERS,
        "isekaiSkilling": True,
        "goals": [
            {"title": "Festmahl", "what": "Die Kolonie serviert gemeinsam 50 Mahlzeiten.", "current": 32, "target": 50, "done": False,
             "reward": "300 Coins für alle", "top": [{"user": "yoku", "amount": 12}, {"user": "mira_spielt", "amount": 9}, {"user": "luna_88", "amount": 6}]},
            {"title": "Rosenfest", "what": "20 Rosen anbauen.", "current": 20, "target": 20, "done": True,
             "reward": 500, "top": [{"user": "luna_88", "amount": 14}, {"user": "yoku", "amount": 6}]},
        ],
        "memorials": MEMORIALS,
        "wealthHistory": WEALTH_HISTORY,
        "factions": FACTIONS,
        "visitors": VISITORS,
        "stock": {"foodNutrition": 2140, "foodDays": 6.4,
                  "items": [{"label": "Reis", "count": 120, "def": "RawRice", "img": "t_RawRice"}, {"label": "Bier", "count": 14, "def": "Beer", "img": "t_Beer"},
                            {"label": "Medizin", "count": 22, "def": "MedicineIndustrial", "img": "t_MedicineIndustrial"}, {"label": "Stahl", "count": 540, "def": "Steel", "img": "t_Steel"}]},
    }


def ticker():
    while True:
        time.sleep(10)
        with LOCK:
            STATE["coins"] += 50


def fake_effect(user, cmd, args):
    """Beispielantworten der neuen Knoepfe; fuer "yoku" aendern Lernen/Stat/Quirk die Daten wirklich."""
    pw = PAWNS.get(user)
    a = args.split()
    if cmd == "wette" and len(a) >= 2 and a[-1].isdigit():
        who, amt = " ".join(a[:-1]).lower(), int(a[-1])
        if who not in ("mira", "luna"):
            return "@%s Dieses Duell kenne ich nicht." % user
        BETS["a" if who == "mira" else "b"] += amt
        return "@%s Wette gesetzt: %d Münzen auf %s." % (user, amt, who.capitalize())
    if cmd == "lob" and a:
        return "@%s Du hast %s gelobt – ein bisschen Stolz fürs Team!" % (user, " ".join(a))
    if cmd == "nachhilfe" and len(a) >= 2:
        return "@%s Nachhilfe gegeben: %s lernt in %s dazu (−100 Münzen)." % (user, a[0], " ".join(a[1:]))
    if cmd == "pate" and a and a[0].startswith("#"):
        an_ = next((x for x in ANIMALS if "#" + x["id"] == a[0]), None)
        if not an_ or an_["sponsor"]:
            return "@%s Dieses Tier hat schon einen Paten oder gibt es nicht." % user
        an_["sponsor"] = user
        if len(a) > 1:
            an_["name"] = " ".join(a[1:])
        return "@%s Du bist jetzt Pate von %s (−300 Münzen)." % (user, an_["name"] or an_["kind"])
    if cmd == "slots":
        return "@%s 🎰 🍒 🍒 🍋 – Leider nichts." % user
    if cmd == "forschung":
        RB_WAIT[0] = 24
        return "@%s Danke! „Mikroelektronik“ ist jetzt bei 68 %% (+25 %%)." % user
    if cmd == "vote" and a[:1] and a[0].isdigit():
        cyc, ph = vote_phase()
        n = int(a[0])
        if ph >= 90 or not (1 <= n <= len(VOTE["counts"])):
            return "@%s Gerade ist keine Abstimmung mit dieser Nummer offen." % user
        VOTE["counts"][n - 1] += 1      # fake_effect laeuft schon unter LOCK (nicht erneut sperren)
        return "@%s Stimme für „%s“ gezählt." % (user, VOTE_OPTS[n - 1])
    if cmd == "mypawn" and pw and a[:1] == ["work"] and len(a) == 3 and a[2].isdigit():
        if not pw.get("workEditable"):
            return "@%s Der Streamer erlaubt das Setzen gerade nicht." % user
        for w in pw["work"]:
            if w["id"] == a[1] and not w["disabled"]:
                w["prio"] = int(a[2])
                return "@%s %s: Priorität %s." % (user, w["label"], "aus" if a[2] == "0" else a[2])
        return "@%s Die Arbeit gibt es nicht oder sie ist gesperrt." % user
    if cmd == "duel":
        if a[:1] in (["ja"], ["nein"]):
            if duel_state() is None:
                return "@%s Gerade liegt keine Herausforderung vor." % user
            DUEL["answered"] = int(time.time()) // 120
            return "@%s Herausforderung %s." % (user, "angenommen – möge der Bessere gewinnen!" if a[0] == "ja" else "abgelehnt")
        if a:
            return "@%s Herausforderung an %s gesendet." % (user, " ".join(a))
    if cmd == "wants" and a[:1] == ["reroll"]:
        return "@%s Wunsch %s getauscht: Neuer Wunsch – Bau ein Beet (+20)." % (user, a[1] if len(a) > 1 else "?")
    if cmd == "aspirations" and a[:1] == ["reroll"]:
        return "@%s Lebensziel %s getauscht (−250 Coins)." % (user, a[1] if len(a) > 1 else "?")
    if cmd == "quirks" and a[:1] == ["nehmen"] and len(a) > 1 and a[1].isdigit() and pw and pw["wants"]:
        i = int(a[1]) - 1
        if 0 <= i < len(QUIRK_OFFERS) and pw["wants"]["rewardPoints"] > 0:
            q = QUIRK_OFFERS.pop(i)
            pw["wants"]["rewardPoints"] -= 1
            if pw["quirks"] is not None:
                pw["quirks"].append({"label": q["label"], "desc": q["desc"]})
            return "@%s Eigenheit genommen: %s." % (user, q["label"])
        return "@%s Das Angebot gibt es nicht (mehr) oder keine Punkte." % user
    if cmd == "isekai" and pw and pw["isekai"]:
        d = pw["isekai"]
        if a[:1] == ["lernen"] and len(a) > 1:
            node = next((n for t in TREES.values() for n in t["nodes"] if n["id"] == a[1]), None)
            if node and a[1] in d["learnable"] and d["points"] >= node["cost"]:
                d["unlocked"].append(a[1])
                d["points"] -= node["cost"]
                recompute_learnable(d)
                return "@%s Gelernt: %s (−%d Skillpunkte)." % (user, node["label"], node["cost"])
            return "@%s %s lässt sich gerade nicht lernen." % (user, a[1])
        if a[:1] == ["stat"] and len(a) > 1 and a[1] in d["stats"] and d["statPoints"] > 0:
            d["stats"][a[1]] += 1
            d["statPoints"] -= 1
            return "@%s %s steigt auf %d." % (user, a[1].upper(), d["stats"][a[1]])
    return None


# ---------- Wildshow (Show-Modus), nur mit FAKE_SHOW=1: /api/show und /api/show/diary/<id> ----------
# Ohne FAKE_SHOW antwortet der Fake wie die echte Mod ohne Wildshow: 404 "Keine Show aktiv".
SHOW = bool(os.environ.get("FAKE_SHOW"))
if SHOW:
    import copy
    for _u, _n, _m in (("svenja", "Svenja", 64), ("tom_w", "Tom", 38), ("jule", "Jule", 81)):
        _c = copy.deepcopy(PAWNS["eddi_tv"])
        _c.update({"user": _u, "id": _u, "displayName": _n + "_TV" if _u != "jule" else None, "name": _n, "fullName": _n + " Wald", "moodPct": _m})
        PAWNS[_u] = _c
    PAWNS["jule"]["user"] = None
    PAWNS["yoku"]["name"] = "Kira"


def show_info():
    ids = ["yoku", "mira_spielt", "svenja", "eddi_tv", "tom_w", "luna_88", "jule"]
    cl = {"yoku": 0, "mira_spielt": 0, "svenja": 0, "eddi_tv": 1, "tom_w": 1}
    roles = {"yoku": ("Kochen", 0.9, 0.8), "mira_spielt": ("Jagen", 0.4, 0.75), "svenja": ("Sammeln", 1.0, 0.5), "eddi_tv": ("Bauen", 0.2, 0.3),
             "tom_w": ("Jagen", 0.7, 0.2), "luna_88": ("Feuer hüten", 0.55, 0.9), "jule": (None, None, None)}
    psy = {"yoku": ["gesellig", "fleißig", "mutig"], "mira_spielt": ["verspielt", "offen"], "svenja": ["gelassen", "mitfühlend"],
           "eddi_tv": ["angespannt", "eitel"], "tom_w": ["aggressiv", "nüchtern"], "luna_88": ["fantasievoll", "verschlossen"], "jule": ["ängstlich", "bescheiden"]}
    members = []
    for i in ids:
        r = roles[i]
        members.append({"id": i, "name": PAWNS[i]["name"], "leader": i == "svenja", "clique": cl.get(i, -1),
                        "regard": {"yoku": 0.4, "mira_spielt": 0.1, "svenja": 0.7, "eddi_tv": -0.5, "tom_w": -0.2, "luna_88": 0.0, "jule": 0.2}[i],
                        "popularity": 0.2,
                        "role": {"text": r[0], "done": r[1], "yesterday": r[2]}, "psyche": psy[i],
                        "marks": {"yoku": ["scar"], "eddi_tv": ["saboteur"], "tom_w": ["hoard", "scar"]}.get(i, [])})
    pairs = {("yoku", "mira_spielt"): (62, 55), ("yoku", "svenja"): (48, 51), ("mira_spielt", "svenja"): (40, 33), ("eddi_tv", "tom_w"): (44, 47),
             ("yoku", "eddi_tv"): (-45, -52), ("svenja", "eddi_tv"): (-30, -12), ("luna_88", "jule"): (22, 10), ("tom_w", "mira_spielt"): (-8, 15),
             ("luna_88", "yoku"): (18, 5)}
    ops = []
    for (a, b), (x, y) in pairs.items():
        ops.append({"a": a, "b": b, "v": x}); ops.append({"a": b, "b": a, "v": y})
    res = show_info_base(ids, members, ops)
    res.update(show_extra())
    if not os.environ.get("FAKE_NOFOG"):
        res["fog"] = fog_fake()
    return res


def show_extra():
    """Strang live-show2: events, eventStats, missing, donation, camps, journeys, archive. FAKE_SHOW_EMPTY=1: alles leer (Test Leerzustand)."""
    if os.environ.get("FAKE_SHOW_EMPTY"):
        return {"events": [], "eventStats": {"done": 0, "failed": 0, "open": 0}, "missing": [], "donation": None, "camps": [], "journeys": [], "archive": []}
    el = int(time.time() - FAKE_START)
    left = max(0, 150000 - el * 400)          # Spielticks, laufen sichtbar ab
    dsec = max(0, 180 - el % 200)
    return {
        "events": [
            {"id": 7, "def": "WS_SE_Challenge_Vorrat", "title": "Vorrat für den Winter", "kind": "challenge", "startTick": 520000, "endTick": 520000 + 180000,
             "ticksLeft": left, "ticksTotal": 180000, "leftText": "noch %d T. %d Std." % (left // 60000, (left % 60000) // 2500), "progress": round(min(0.95, 0.35 + el / 400), 2),
             "text": "Vorrat 35 %", "camp": 1, "members": ["yoku", "svenja", "tom_w"]},
            {"id": 8, "def": "WS_SE_Dilemma_Fell", "title": "Wer bekommt das Fell?", "kind": "dilemma", "startTick": 560000, "endTick": 560000 + 20000, "ticksLeft": 3000, "ticksTotal": 20000,
             "leftText": "noch 2 Std.", "progress": None, "text": None, "camp": 1, "members": []},
            {"id": 9, "def": "WS_SE_Natur_Nebel", "title": "Dichter Nebel", "kind": "nature", "startTick": 570000, "endTick": None, "ticksLeft": -1, "ticksTotal": -1,
             "leftText": "ohne Frist", "progress": None, "text": "Nebel zieht durch das Tal", "camp": 1, "members": ["luna_88"]},
        ],
        "eventStats": {"done": 3, "failed": 1, "open": 3},
        "missing": [{"pawn": "tom_w", "name": "Tom", "state": "missing", "sinceDay": 8, "sinceTick": 500000, "phase": "search", "searchSinceTick": 520000, "round": 1},
                    {"pawn": "jule", "name": "Jule", "state": "home", "sinceDay": 5, "sinceTick": 330000, "phase": None, "searchSinceTick": None, "round": 1}],
        "donation": {"open": True, "secondsLeft": dsec if os.environ.get("FAKE_DON_LIMIT") else -1, "donors": 3, "total": 7, "totalMax": 10, "perViewer": 1,
                     "items": [{"name": "Schokolade", "price": 40, "max": 3, "left": 3}, {"name": "Mahlzeit", "price": 25, "max": 5, "left": 2},
                               {"name": "Heilkraut", "price": 30, "max": 2, "left": 0}],
                     "list": [{"name": "eddi_tv", "item": "Mahlzeit", "count": 3}, {"name": "mira_spielt", "item": "Schokolade", "count": 1}, {"name": "<b>luna_88</b>", "item": "Heilkraut", "count": 2}]},
        "camps": [{"map": 1, "name": "Hauptlager", "tile": 100, "second": False, "current": True, "members": ["yoku", "mira_spielt", "svenja", "luna_88"]},
                  {"map": 2, "name": "Flusslager", "tile": 101, "second": True, "current": False, "members": ["eddi_tv"]}],
        "journeys": [{"kind": "Besuch", "phase": 1, "members": ["eddi_tv"], "from": 2, "to": 1, "tile": 100, "destTile": 100, "moving": True, "resting": False, "days": 1.4}],
        "archive": [{"season": "20261001-1200", "endTick": 400000, "endDay": 7, "winner": {"id": "p901", "name": "Lena"}, "viewerWinner": {"id": "p902", "name": "Ole"},
                     "members": [{"id": "p901", "name": "Lena", "fate": "Siegerin"}, {"id": "p902", "name": "Ole", "fate": "Publikumsliebling"}, {"id": "p903", "name": "Rik", "fate": "ausgeschieden an Tag 4"}],
                     "highlights": ["Lena zündete das Signalfeuer.", "Ole trug Rik durch den Sturm."]}],
    }


def show_info_base(ids, members, ops):
    return {
        "active": True, "tag": 9, "tick": 9 * 60000 + 21000, "staffel": "20261014-1200", "members": members, "opinions": ops,
        "cliques": [{"nr": 0, "members": ["yoku", "mira_spielt", "svenja"]}, {"nr": 1, "members": ["eddi_tv", "tom_w"]}],
        "feuerabend": {"running": True, "topic": "Svenja erzählt vom ersten Fisch des Tages.", "seated": ["yoku", "mira_spielt", "svenja", "luna_88", "tom_w"]},
        "timeline": [
            {"kind": "Etappe", "title": "Erstes Feuer", "text": "Kira hat das erste Feuer entfacht.", "day": 1, "tick": 20000, "pawn": "yoku", "name": "Kira"},
            {"kind": "Erster", "title": "Erster Fisch", "text": "Tom hat den ersten Fisch gefangen.", "day": 3, "tick": 190000, "pawn": "tom_w", "name": "Tom"},
            {"kind": "Bestwert", "title": "Längste Jagd", "text": "Mira jagte vier Stunden am Stück.", "day": 6, "tick": 370000, "pawn": "mira_spielt", "name": "Mira"},
            {"kind": "Etappe", "title": "Erster Streit", "text": "Kira und Eddi gerieten aneinander.", "day": 7, "tick": 430000, "pawn": "eddi_tv", "name": "Eddi"},
            {"kind": "Etappe", "title": "Neuer Anführer", "text": "Svenja führt jetzt die Gruppe.", "day": 8, "tick": 500000, "pawn": "svenja", "name": "Svenja"}],
        "talk": [
            {"tick": 540000, "from": "svenja", "to": "yoku", "kind": "Erzaehlen_Antwort", "text": "Der Fisch war so groß wie mein Unterarm.", "thread": 4},
            {"tick": 540200, "from": "yoku", "to": "svenja", "kind": "Erzaehlen_Antwort", "text": "Dann braten wir ihn heute Abend.", "thread": 4},
            {"tick": 540400, "from": "tom_w", "to": "mira_spielt", "kind": "Erzaehlen_Antwort", "text": "Ich hab die Spur im Schilf gesehen.", "thread": 4},
            {"tick": 540600, "from": "luna_88", "to": None, "kind": "Selbstgespraech", "text": "Ob es morgen regnet?", "thread": 0}],
        "memorial": [{"id": "olaf", "name": "Olaf", "viewer": "olaf_tv", "kind": "tot", "days": 6, "tick": 400000,
                      "memories": ["Hat den ersten Fisch gefangen.", "Stritt oft mit Eddi.", "Sang abends am Feuer."]}],
        "confessions": [{"pawn": "yoku", "day": 8, "question": "Wem vertraust du am meisten?", "answer": "Mira. Sie hört zu, ohne zu urteilen.", "viewer": "mira_spielt"},
                        {"pawn": "tom_w", "day": 8, "question": "Was nervt dich?", "answer": "Eddi redet zu viel. Aber ich sag's ihm nicht.", "viewer": "luna_88"}],
        "council": {"running": False, "openWishes": 2,
                    "protocol": [{"id": 3, "tick": 400000, "kind": "Teilen", "question": "Wer bekommt das letzte Fell?", "options": ["Kira", "Tom", "Niemand"],
                                  "chosen": 0, "decision": "Kira bekommt das Fell.", "tie": False,
                                  "votes": [{"pawn": "svenja", "option": 0, "weight": 1.5}, {"pawn": "yoku", "option": 1, "weight": 1.0}, {"pawn": "tom_w", "option": 1, "weight": 1.0},
                                            {"pawn": "mira_spielt", "option": 0, "weight": 1.0}, {"pawn": "luna_88", "option": 0, "weight": 1.0}]}],
                    "rules": [{"kind": "Feuer", "text": "Nachts wacht immer einer am Feuer.", "pawn": "svenja"}, {"kind": "Essen", "text": "Beute wird zuerst geteilt.", "pawn": None}]},
    }


def show_diary(pid):
    if pid not in PAWNS:
        return None
    n = PAWNS[pid]["name"]
    return {"id": pid, "name": n, "sections": [
        {"title": "Erlebtes", "lines": [{"text": "Tag 8: Hat Eddi widersprochen – Eddi", "tone": "bad"}, {"text": "Tag 7: Hat Beeren geteilt – Mira", "tone": "good"}, {"text": "Tag 5: Hat am Feuer gesessen", "tone": "text"}]},
        {"title": "Erste Male", "lines": [{"text": "der erste Fisch (Tag 3)", "tone": "good"}]},
        {"title": "Meinungen", "lines": [{"text": "Mira ist mir sympathisch.", "tone": "good"}, {"text": "Eddi nervt mich.", "tone": "bad"}]},
        {"title": "Befinden", "lines": [{"text": "Heute: Kochen", "tone": "text"}, {"text": "Gestern lief es gut.", "tone": "quiet"}]},
        {"title": "Ich", "lines": [{"text": "„Ich will nicht, dass wir hungern.“", "tone": "text"}]},
        {"title": "Wünsche", "lines": [{"text": "Einmal wieder warm schlafen.", "tone": "quiet"}]},
        {"title": "Beichtstuhl", "lines": [{"text": "Noch nichts im Beichtstuhl.", "tone": "quiet"}]}]}


# ---------- Daten-Karte: /api/map und /api/map/terrain/<id> ----------
import math
MAP_W = MAP_H = 100


_TERR = {}
# Kategorie-Zeichen -> TerrainDef (nur Fake). Bilder: siehe WS_TERRAIN weiter unten (fehlende -> 404 = Ersatzfarbe).
TERR_DEF = {"g": "Soil", "t": "SoilRich", "s": "Sand", "w": "WaterShallow", "W": "WaterDeep", "r": "Granite_Rough", "f": "WoodPlankFloor",
            "b": "BridgeWood", "m": "Mud", "i": "Ice", "c": "Gravel"}


def map_terrain():
    """Gelaende in voller Aufloesung (250x250, step 1) mit den Zeichen g s w W r t + f b m i c. Einmal berechnet."""
    if "t" in _TERR:
        return _TERR["t"]
    n = 250
    rows = []
    prows = []
    for gz in range(n):
        r = []
        pr = []
        for gx in range(n):
            bx = 125 + 28 * math.sin(gz / 22.0)
            bach = abs(gx - bx) < 3
            teich = (gx - 185) ** 2 + (gz - 170) ** 2 < 300
            tief = (gx - 185) ** 2 + (gz - 170) ** 2 < 50
            fels = (gx - 45) ** 2 + (gz - 55) ** 2 < 700 or (gx - 210) ** 2 + (gz - 40) ** 2 < 400
            h = hashlib.md5(("%d,%d" % (gx, gz)).encode()).digest()[0]
            baum = h < 38 and (gx < 90 or gz > 190)
            sand = abs(gx - bx) < 8
            bruecke = bach and 118 <= gz <= 123
            boden = 100 <= gx <= 150 and 105 <= gz <= 145
            schlamm = (gx - 200) ** 2 + (gz - 215) ** 2 < 260 or (gx < 60 and gz > 200 and h < 140)
            eis = gz < 15 and gx > 120
            kies = (gx - 60) ** 2 + (gz - 150) ** 2 < 350 and h < 200
            ch = ("b" if bruecke else "W" if tief else "w" if bach or teich else "f" if boden and h < 220 else "r" if fels else "m" if schlamm else "i" if eis
                  else "c" if kies else "t" if baum else "s" if sand else "g")
            r.append(ch)
            pch = 0                                   # Pflanzen (Index in PDEFS): 0 keine, 1 Gras, 2 Busch, 3 Baum, 4 Reis (Feld), 5 Moos
            if os.environ.get("FAKE_NOPLANTS") != "1":
                crop = 88 <= gx <= 98 and 105 <= gz <= 125 and ch == "g"
                pch = (4 if crop and h < 230 else 3 if ch == "t" and h < 14 else 2 if ch == "t" and h < 26 else 1 if ch in "tg" and h < 150
                       else 2 if ch == "g" and h < 162 else 5 if ch == "r" and h < 25 else 0)
            pr.append(pch)
        rows.append("".join(r)); prows.append(pr)
    _TERR["t"] = {"id": "m1", "w": n, "h": n, "step": 1, "sizeX": 250, "sizeZ": 250, "rows": rows}
    if os.environ.get("FAKE_NOGFX") != "1":           # Spielgrafik-Felder (Plan karte-spielgrafik): defs + cells (enc 1). FAKE_NOGFX=1 = alte Mod ohne
        defs = [TERR_DEF[c] for c in "gtswWrfbmic"]
        alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        ix = {c: alpha[i] for i, c in enumerate("gtswWrfbmic")}
        _TERR["t"]["defs"] = defs
        _TERR["t"]["cells"] = ["".join(ix.get(ch, "A") for ch in r) for r in rows]
        if os.environ.get("FAKE_NOPLANTS") != "1":    # Pflanzen-Felder (Nachtrag): pdefs/pkinds/pcells, Index 0 = keine
            _TERR["t"]["pdefs"] = ["", "Plant_Grass", "Plant_Bush", "Plant_TreeOak", "Plant_Rice", "Plant_Moss"]
            _TERR["t"]["pkinds"] = ["", "grass", "bush", "tree", "crop", "other"]
            _TERR["t"]["pcells"] = ["".join(alpha[v] for v in pr) for pr in prows]
    return _TERR["t"]


def terrain_ver():
    return 1 + int((time.time() - FAKE_START) // 120)   # steigt alle 2 Minuten: Seite muss Gelaende neu laden


def map_live():
    t = time.time()
    pawns = []
    homes = {"yoku": (120, 120), "mira_spielt": (130, 118), "luna_88": (118, 132), "eddi_tv": (150, 100)}
    for i, (k, p) in enumerate(PAWNS.items()):
        bx, bz = homes.get(k, (110 + i * 9, 125 - i * 4))
        a = t / 6.0 + i * 1.7
        x, z = int(bx + 10 * math.sin(a)), int(bz + 8 * math.cos(a * 0.8))
        pawns.append({"id": p["id"], "name": p["name"], "x": x, "z": z, "job": p.get("job") or "Steht herum", "food": 80 - i * 9, "rest": 90 - i * 12,
                      "thirst": 70 - i * 6, "mood": int(p.get("moodPct") or 50), "health": [100, 74, 41, 18][i % 4], "sleeping": i == 3,
                      "dx": bx + 14, "dz": bz - 6})
    blds = [{"id": "b1", "x": 125, "z": 125, "k": "fire", "sx": 1, "sz": 1, "label": "Lagerfeuer"}]
    n = 2
    for j in range(7):
        blds.append({"id": "b%d" % n, "x": 108 + j * 4, "z": 112, "k": "bed", "sx": 1, "sz": 2, "label": "Schlafplatz"}); n += 1
    for j in range(5):
        blds.append({"id": "b%d" % n, "x": 134, "z": 140 + j, "k": "wall", "sx": 1, "sz": 1, "label": "Wand"}); n += 1
    blds.append({"id": "b%d" % n, "x": 140, "z": 128, "k": "build", "sx": 2, "sz": 2, "label": "Reuse"}); n += 1
    kinds = [("bench", "Schmiede", 3, 1), ("table", "Esstisch", 2, 1), ("seat", "Stuhl", 1, 1), ("turret", "Mini-Geschuetz", 1, 1), ("storage", "Regal", 2, 1),
             ("joy", "Hufeisenplatz", 1, 1), ("power", "Generator", 2, 2), ("light", "Stehlampe", 1, 1), ("plant", "Pflanzgefaess", 1, 1), ("med", "Krankenbett", 1, 2),
             ("other", "Kuehlschrank", 2, 1), ("door", "Tuer", 1, 1)]
    for i, (k, lab, sx, sz) in enumerate(kinds):
        blds.append({"id": "b%d" % n, "x": 112 + (i % 6) * 5, "z": 120 + (i // 6) * 5, "k": k, "sx": sx, "sz": sz, "label": lab}); n += 1
    if os.environ.get("FAKE_MANY_BLDS", "1") == "1":     # Leistungsprobe: ~900 Wandteile/Sonstiges
        for i in range(900):
            blds.append({"id": "b%d" % n, "x": 20 + (i % 60) * 3, "z": 10 + (i // 60) * 3, "k": "wall" if i % 3 else "other", "sx": 1, "sz": 1, "label": "Gebaeude"}); n += 1
    animals = []
    spec = [("a201", "Rex", "Dog", "Hund", 120, 125, "yoku", "Yoku"), ("a202", None, "Cat", "Katze", 128, 128, None, None), ("a203", "Lama Dora", "Alpaca", "Alpaka", 105, 128, None, None),
            ("a204", None, "Chicken", "Huhn", 100, 118, None, None), ("a205", None, "Chicken", "Huhn", 101, 119, None, None), ("a206", "Kuno", "Donkey", "Esel", 150, 135, None, None)]
    for i, (aid, nm, kind, lab, bx, bz, bond, bondName) in enumerate(spec):
        a = t / 5.0 + i * 2.1
        d = {"id": aid, "name": nm, "kind": kind if kind != "Chicken" else "404", "label": lab, "x": int(bx + 4 * math.sin(a)), "z": int(bz + 3 * math.cos(a)),
             "job": "Wandert umher" if i % 2 else "Frisst", "sleeping": i == 1, "health": 100 - i * 8, "food": 70 - i * 9}
        if bond:
            d["bondId"] = PAWNS[bond]["id"]; d["bondName"] = bondName
        if i == 2:
            d["masterId"] = PAWNS["mira_spielt"]["id"]
        animals.append(d)
    strangers = [
        {"id": "p301", "name": "Gruenkohl", "label": "Pirat", "x": 160 + int(6 * math.sin(t / 7)), "z": 170, "dx": 140, "dz": 140, "rel": "enemy", "faction": "Plunderer-Bande"},
        {"id": "p302", "name": "Hanna", "label": "Haendler", "x": 90, "z": 150, "rel": "guest", "faction": "Handelsgilde"},
        {"id": "p303", "name": "Gregor", "label": "Gefangener", "x": 118, "z": 108, "rel": "prisoner", "faction": "Plunderer-Bande"},
        {"id": "p304", "name": "Bo", "label": "Sklave", "x": 132, "z": 112, "rel": "slave", "faction": None},
        {"id": "p305", "name": None, "label": "Mech", "x": 70, "z": 100, "rel": "other", "faction": None}]
    if os.environ.get("FAKE_NOGFX") != "1":
        for b in blds:
            b["def"] = BLD_DEF.get(b["k"], "Reuse"); b["rot"] = (b["x"] + b["z"]) % 4
            if b["k"] in BLD_COL and os.environ.get("FAKE_NOPLANTS") != "1":
                b["col"] = BLD_COL[b["k"]]
    return {"maps": [{"id": "m1", "name": "Strand", "sizeX": 250, "sizeZ": 250, "pawns": pawns, "buildings": blds, "animals": animals, "strangers": strangers, "terrainVer": terrain_ver()}],
            "world": [{"kind": "settlement", "name": "Strand", "lon": 12.0, "lat": 48.0},
                      {"kind": "caravan", "name": "Karawane", "lon": 14.5, "lat": 47.0, "destLon": 18.0, "destLat": 45.0, "pawns": ["yoku"]}]}


BLD_DEF = {"fire": "Campfire", "bed": "Bed", "wall": "Wall", "door": "Door", "build": "Reuse", "bench": "TableSmithing", "table": "Table2x2", "seat": "Stool",
           "turret": "Turret_MiniTurret", "storage": "Shelf", "joy": "HorseshoesPin", "power": "Generator", "light": "TorchLamp", "plant": "PlantPot",
           "med": "HospitalBed", "other": "Fridge"}
BLD_COL = {"wall": "#8c6a3e", "door": "#8c6a3e", "bed": "#b04a4a", "table": "#a07848", "bench": "#7d8088", "storage": "#9a7a50"}   # Zeichenfarbe (Material), nur wenn nicht weiss
_THING_SEEN = set()


def thing_info(tid):
    for b in map_live()["maps"][0]["buildings"]:
        if b["id"] == tid:
            break
    else:
        return 404, {"error": "Unbekannt"}
    if tid not in _THING_SEEN:
        _THING_SEEN.add(tid)
        return 202, {"pending": True}
    d = {"id": tid, "label": b["label"], "k": b["k"], "x": b["x"], "z": b["z"], "hp": 180, "hpMax": 200, "quality": "gut", "stuff": "Stahl"}
    if b["k"] == "bench":
        d["bills"] = ["Kurzschwert herstellen x3", "Stahl schmelzen (dauerhaft)"]; d["user"] = {"id": PAWNS["yoku"]["id"], "name": "Yoku"}
    if b["k"] == "power":
        d["power"] = "an"; d["fuel"] = 64
    if b["k"] == "light":
        d["power"] = "aus"
    return 200, d


# ---------- Spielgrafik-Fake: echte lose PNGs aus den Workshop-Mods (nur LESEN), sonst 404 ----------
WS = "C:/Program Files (x86)/Steam/steamapps/workshop/content/294100"
WS_TERRAIN = {   # TerrainDef -> Datei (relativ zu WS); nicht aufgefuehrt (Sand, Wasser, Eis, Bruecke, Schlamm) -> 404 = Ersatzfarbe
    "Soil": "1542284250/Textures/Terrain/Surfaces/Soil.png", "SoilRich": "1561838700/Textures/Terrain/Surfaces/SoilRichPatched.png",
    "Granite_Rough": "1817862464/Textures/Terrain/Surfaces/Stone/WDStoneTileRough.png", "WoodPlankFloor": "1817862464/Textures/Terrain/Surfaces/Wooden/WDWoodPlankFloor.png",
    "Gravel": "1542284250/Textures/Terrain/Surfaces/Gravel.png", "Mud": "1542284250/Textures/Terrain/Surfaces/Mossy.png"}
WS_THING = {     # ThingDef -> Datei; nicht aufgefuehrt (Wall, Door, Reuse, Generator ...) -> 404 = Farbkaestchen
    "Campfire": "1718190143/Textures/NewThings/Temperature/Firepit/StoneCampfire.png", "Bed": "1659631711/Textures/Things/Building/Furniture/DoublePillowBed/DoublePillowBed.png",
    "Table2x2": "1558635181/Textures/Things/Building/Table/RGK_Table2x2.png", "Stool": "1694750191/Textures/Things/Building/Art/DryadStool/DryadStool.png",
    "Shelf": "1558635181/Textures/Things/Building/Furniture/GL_TablewareShelf.png", "TorchLamp": "1541438614/Textures/Things/Building/Imperial/BuildingStyles/ImperialTorchLamp.png",
    "Plant_Grass": "1786466855/Textures/Plants/MutatedGrass/MutatedGrassA.png", "Plant_Bush": "1786466855/Textures/Plants/MutatedBush/MutatedBushA.png",
    "Plant_TreeOak": "1786466855/Textures/Plants/GnarledTree/GnarledTreeA.png", "Plant_Rice": "1841354677/Textures/Things/Plants/AB_GauGrass/AB_GauGrassA.png",
    "TableSmithing": "1558161673/Textures/Things/Building/RB_Beekeeping_Workbench_m.png"}
WS_TINT = {"WoodPlankFloor": (176, 124, 72), "Granite_Rough": (140, 136, 130)}
_WS_CACHE = {}


def ws_image(key):
    if key in _WS_CACHE:
        return _WS_CACHE[key]
    terr = key.startswith("tr_")
    rel = (WS_TERRAIN if terr else WS_THING).get(key[3:] if terr else key[2:])
    out = None
    if rel:
        try:
            import io
            from PIL import Image
            im = Image.open(os.path.join(WS, *rel.split("/"))).convert("RGBA")
            if terr:
                im = im.resize((64, 64), Image.LANCZOS)
                tint = WS_TINT.get(key[3:])                  # graue Texturen wie im Spiel mit der Materialfarbe einfaerben
                if tint:
                    from PIL import ImageChops
                    im = ImageChops.multiply(im, Image.new("RGBA", im.size, tint + (255,)))
            elif max(im.size) > 256:
                im.thumbnail((256, 256), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, "PNG"); out = buf.getvalue()
        except Exception as e:                          # Datei/PIL fehlt -> 404, Seite nutzt Ersatz
            print("ws_image:", key, e)
    _WS_CACHE[key] = out
    return out


def fog_fake():
    """Strang live-nebel: Sichtmaske (Zellraster, 10 Felder je Zelle) + sichtbare Wesen + Merkpunkte. FAKE_NOFOG=1: kein Nebel (fog fehlt)."""
    m = map_live()["maps"][0]
    cell, cols, rows = 10, 25, 25
    t = int(time.time() - FAKE_START)
    vis = []
    for gz in range(rows):
        row = []
        for gx in range(cols):
            cx, cz = gx * cell + 5, gz * cell + 5
            d = min(math.hypot(cx - p["x"], cz - p["z"]) for p in m["pawns"])
            row.append("2" if d < 24 else "1" if d < 60 or (cx < 100 and cz > 150) else "0")
        vis.append("".join(row))
    seen = [{"kind": "animal", "label": "Wolf", "x": m["pawns"][0]["x"] + 12, "z": m["pawns"][0]["z"] + 8}]
    ghosts = [{"kind": "animal", "label": "Hirsch", "x": 70, "z": 190, "age": 1800 + t * 40},
              {"kind": "foreign", "label": "Fremder", "x": 190, "z": 60, "age": 9000 + t * 40},
              {"kind": "animal", "label": "Wildschwein", "x": 40, "z": 100, "age": 14000 + t * 40}]
    return {"on": True, "tick": 9 * 60000 + 21000, "fade": 15000,
            "maps": [{"id": m["id"], "cell": cell, "cols": cols, "rows": rows, "vis": vis, "seen": seen, "ghosts": [g for g in ghosts if g["age"] < 15000]}]}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # --- Helfer ---
    def cors(self):
        o = self.headers.get("Origin")
        if o in ORIGINS or (o and o.startswith("http://127.0.0.1:")) or (o and o.startswith("http://localhost:")):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, If-None-Match")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "ETag")

    def send(self, status, body=b"", ctype="application/json; charset=utf-8", etag=None, extra=None):
        self.send_response(status)
        self.cors()
        if status != 304:
            self.send_header("Content-Type", ctype)
        if etag:
            self.send_header("ETag", etag)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def js(self, status, obj, cache=True):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        etag = '"%s"' % hashlib.md5(body).hexdigest() if cache else None
        if etag and self.headers.get("If-None-Match") == etag:
            return self.send(304, b"", etag=etag)
        self.send(status, body, etag=etag)

    def user(self):
        a = self.headers.get("Authorization", "")
        if a.startswith("Bearer "):
            return TOKENS.get(a[7:])
        return None

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    # --- Methoden ---
    def do_OPTIONS(self):
        self.send(204)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        q = parse_qs(u.query)
        if p == "/api/map":
            return self.js(200, map_live(), cache=False)
        if p.startswith("/api/map/thing/"):
            st, body = thing_info(unquote(p[15:]))
            return self.js(st, body, cache=False)
        if p.startswith("/api/map/terrain/"):
            return self.js(200, map_terrain())
        if p == "/api/show" or p.startswith("/api/show/diary/"):
            if not SHOW:
                return self.js(404, {"error": "Keine Show aktiv"}, cache=False)
            if p == "/api/show":
                return self.js(200, show_info())
            d = show_diary(unquote(p[16:]).lower())
            return self.js(200, d) if d else self.js(404, {"error": "Noch kein Tagebuch"}, cache=False)
        if p == "/api/status":
            return self.js(200, {"live": True, "colony": "Neu-Yoku", "prefix": "!", "allowed": ALLOWED})
        if p == "/api/game":
            return self.js(200, game_info())
        if p == "/api/research":
            return self.js(200, research_info())
        if p == "/api/isekai":
            return self.js(200, isekai_info())
        if p == "/api/vote":
            return self.js(200, vote_state())
        if p.startswith("/api/stats/"):
            cats = [{"label": "Allgemein", "stats": [{"label": "Bewegungstempo", "value": "4,6 Felder/s", "desc": "Wie schnell man läuft."}, {"label": "Fruchtbarkeit", "value": "85 %", "desc": "Wie fruchtbar jemand ist."}]},
                    {"label": "Nahkampf", "stats": [{"label": "Nahkampf-Trefferchance", "value": "78 %", "desc": ""}, {"label": "Nahkampfschaden", "value": "112 %", "desc": ""}]},
                    {"label": "Soziales", "stats": [{"label": "Verhandlungsgeschick", "value": "64 %", "desc": ""}]}]
            return self.js(200, {"name": "Test", "categories": cats})
        if p == "/api/psyche":
            pers = [("Rimpsyche_Sociability", "Geselligkeit", "verschlossen", "gesellig"), ("Rimpsyche_Tension", "Anspannung", "gelassen", "angespannt"),
                    ("Rimpsyche_Diligence", "Fleiß", "nachlässig", "fleißig"), ("Rimpsyche_Openness", "Offenheit", "traditionell", "offen"),
                    ("Rimpsyche_Aggressiveness", "Aggressivität", "friedlich", "aggressiv"), ("Rimpsyche_Compassion", "Mitgefühl", "kaltherzig", "mitfühlend"),
                    ("Rimpsyche_Imagination", "Fantasie", "nüchtern", "fantasievoll"), ("Rimpsyche_Playfulness", "Verspieltheit", "ernst", "verspielt"),
                    ("Rimpsyche_Humbleness", "Bescheidenheit", "eitel", "bescheiden"), ("Rimpsyche_Bravery", "Mut", "ängstlich", "mutig")]
            ints = [("Cooking", "Kochen"), ("Music", "Musik"), ("Animals", "Tiere"), ("Combat", "Kampf"), ("Art", "Kunst"), ("Science", "Wissenschaft"), ("Nature", "Natur")]
            parts = ["Schultern", "Brust", "Bizeps", "Trizeps", "Rücken", "Rumpf", "Gesäß", "Oberschenkel vorn", "Oberschenkel hinten"]
            ids = ["shoulder", "chest", "biceps", "triceps", "back", "core", "glutes", "quads", "hams"]
            return self.js(200, {"personalities": [{"id": i, "label": l, "low": lo, "high": hi, "lowDesc": "Ist eher %s." % lo, "highDesc": "Ist eher %s." % hi} for i, l, lo, hi in pers],
                                 "interests": [{"id": i, "label": l, "desc": "Redet gern über %s." % l} for i, l in ints],
                                 "body": {"max": 50, "fatThin": 15, "fatFat": 35, "muscleThin": 15, "muscleHulk": 35,
                                          "parts": [{"id": i, "label": l} for i, l in zip(ids, parts)]}})
        if p == "/api/expertise":
            e = lambda i, l, d, eff: {"id": i, "label": l, "desc": d, "effects": eff}
            return self.js(200, {"skills": [
                {"skill": "Schießen", "skillId": "Shooting", "list": [e("Precision", "Scharfschießen", "Treffsicherheit mit Fernwaffen.", ["Schusspräzision +1 je Stufe"]), e("VSE_Sniping", "Präzisionsschütze", "Größere Reichweite.", ["Reichweite +1 % je Stufe"])]},
                {"skill": "Kochen", "skillId": "Cooking", "list": [e("VSE_Chef", "Küchenchef", "Kocht schneller und sauberer.", ["Kochgeschwindigkeit +2 % je Stufe"])]}]})
        if p == "/api/psycasts":
            ab = lambda i, l, lv, o, pre=(): {"id": i, "label": l, "desc": "Beschreibung von " + l + ".", "level": lv, "order": o, "prereqs": list(pre)}
            return self.js(200, {"paths": [
                {"id": "VPE_Conflagrator", "label": "Feuerteufel", "desc": "Meister des Feuers.", "locked": None,
                 "abilities": [ab("VPE_Fireball", "Feuerball", 1, 1), ab("VPE_FireBeam", "Feuerstrahl", 2, 1, ["VPE_Fireball"]), ab("VPE_HeatPearls", "Hitzeperlen", 3, 1, ["VPE_FireBeam"])]},
                {"id": "VPE_Empath", "label": "Empath", "desc": "Fühlt und heilt die Seele.", "locked": None,
                 "abilities": [ab("VPE_Calm", "Beruhigen", 1, 1), ab("VPE_Joyburst", "Freudenstoß", 2, 1, ["VPE_Calm"])]},
                {"id": "VPE_Necropath", "label": "Nekropath", "desc": "Spricht mit den Toten.", "locked": "Braucht die Meme „Tod“.",
                 "abilities": [ab("VPE_RaiseDead", "Tote erwecken", 4, 1)]}]})
        if p == "/api/ideos":
            return self.js(200, {"ideos": [{"id": 1, "name": "Sonnenpfad", "culture": "Astrisch", "primary": True, "followers": 4,
                "desc": "Die Sonne gibt, die Sonne nimmt. Wer hart arbeitet, wird von ihr gesegnet.",
                "memes": [{"label": "Arbeitsam", "desc": "Fleiß ist heilig.", "structure": False}, {"label": "Animistisch", "desc": "Alles hat eine Seele.", "structure": True}],
                "precepts": [{"issue": "Kannibalismus", "label": "Verabscheut", "desc": "Menschenfleisch zu essen ist ein schweres Vergehen.", "impact": "high"},
                             {"issue": "Drogen", "label": "Nur medizinisch", "desc": "Drogen nur zur Heilung.", "impact": "medium"},
                             {"issue": "Bäume fällen", "label": "Missbilligt", "desc": "Bäume sind lebendig.", "impact": "low"}],
                "roles": [{"label": "Moralführer", "desc": "Leitet Rituale und Gespräche über den Glauben.", "holders": ["Kira", "Fremder"], "holderIds": ["yoku", None]},
                          {"label": "Erntemeister", "desc": "Spezialist für die Ernte.", "holders": []}],
                "rituals": [{"label": "Sonnenfest", "desc": "Ein Fest zur Sommersonnenwende."}]}]})
        if p == "/api/events":
            return self.js(200, {"events": EVENTS, "social": [{"text": "Kira hat mit Mira über Kochrezepte geplaudert.", "ago": "1 Stunde", "pawns": [{"id": "yoku", "name": "Kira"}, {"id": "mira_spielt", "name": "Mira"}], "kind": "Chitchat", "good": True, "icon": "i_Chitchat"}, {"text": "Luna hat Eddi ein Geschenk gemacht.", "ago": "3 Stunden", "pawns": [{"id": "luna_88", "name": "Luna"}, {"id": "eddi", "name": "Eddi"}], "kind": "Gift", "good": True, "icon": None}, {"text": "Eddi hat Kira beleidigt.", "ago": "2 Tage", "pawns": [{"id": "eddi", "name": "Eddi"}, {"id": "yoku", "name": "Kira"}], "kind": "Insult", "good": False, "icon": "i_Insult"}, {"text": "Mira hat versucht, ein Tier zu zähmen.", "ago": "3 Tage", "pawns": [{"id": "mira_spielt", "name": "Mira"}], "kind": "TameAttempt", "good": None, "icon": None}]})
        if p == "/api/colony":
            return self.js(200, {"pawns": [summary(x) for x in PAWNS.values()]})
        if p.startswith("/api/log/"):
            if unquote(p[9:]).lower() not in PAWNS:
                return self.js(404, {"error": "Noch keine Einträge"}, cache=False)
            key = unquote(p[9:]).lower()
            return self.js(200, {
                "relations": RELATIONS.get(key, []),
                "story": STORY.get(key, []),
                "style": {"hair": "Bob", "hairLabel": "Bob", "hairColor": "#8a5a2b", "favColor": "#3a7bd5",
                          "hairOptions": [["Bob", "Bob"], ["Braids", "Zöpfe"], ["Mohawk", "Irokese"], ["Pigtails", "Rattenschwänze"], ["Shaved", "Rasiert"]],
                          "beard": None, "beardLabel": None, "beardOptions": None},
                "social": [
                    {"text": "Kira hat mit Mira über Kochrezepte geplaudert.", "ago": "2 Stunden", "pawns": [{"id": "yoku", "name": "Kira"}, {"id": "mira_spielt", "name": "Mira"}], "kind": "Chitchat", "good": True, "icon": "i_Chitchat"},
                    {"text": "Kira hat Eddi beleidigt.", "ago": "5 Stunden", "pawns": [{"id": "yoku", "name": "Kira"}, {"id": "eddi", "name": "Eddi"}], "kind": "Insult", "good": False, "icon": "i_Insult"},
                    {"text": "Luna hat Kira ein tiefes Gespräch über das Leben angeboten.", "ago": "1 Tag", "pawns": [{"id": "luna_88", "name": "Luna"}, {"id": "yoku", "name": "Kira"}], "kind": "DeepTalk", "good": True, "icon": None},
                ],
                "combat": [
                    {"text": "Kira hat einen Plünderer mit dem Revolver in den Kopf getroffen.", "ago": "3 Stunden"},
                    {"text": "Ein Plünderer hat Kira verfehlt.", "ago": "3 Stunden"},
                ],
            })
        if p.startswith("/api/pawn/"):
            pw = PAWNS.get(unquote(p[10:]).lower())
            return self.js(200, pw) if pw else self.js(404, {"error": "Kein Kolonist mit diesem Namen."}, cache=False)
        if p == "/api/me":
            user = self.user()
            if not user:
                return self.js(401, {"error": "Nicht angemeldet."}, cache=False)
            with LOCK:
                coins, karma = STATE["coins"], STATE["karma"]
            pawn = dict(PAWNS[user]) if user in PAWNS else None
            if pawn is not None:
                pawn["duelIncoming"] = duel_state()
            return self.js(200, {"user": user, "displayName": ALLOWED_USERS.get(user, user), "coins": coins,
                                 "karma": karma, "coinsPerMinute": 7.5, "earning": True, "activeMinutesLeft": 24, "researchWaitHours": RB_WAIT[0], "useWaitHours": float(os.environ.get("FAKE_USE_WAIT", "0")), "cooldowns": fake_cooldowns_me(), "pawn": pawn})
        if p.startswith("/api/art/"):
            user = unquote(p[9:]).lower()
            key = user if user in PAWNS else next((k for k, v in PAWNS.items() if v.get("id") == user), None)
            if key is None or not PAWNS[key].get("art"):
                return self.js(404, {"error": "Kein gemaltes Porträt."}, cache=False)
            return self.send(200, png(key), "image/png", extra={"Cache-Control": "public, max-age=3600"})
        if p.startswith("/api/img/"):
            key = unquote(p[9:])
            if key.startswith(("tr_", "t_")) and os.environ.get("FAKE_NOGFX") != "1":
                body = ws_image(key)
                if body is None:
                    return self.js(404, {"error": "Noch nicht gerendert."}, cache=False)
                return self.send(200, body, "image/png", extra={"Cache-Control": "no-cache"})
            if key == "404":
                return self.js(404, {"error": "Noch nicht gerendert."}, cache=False)
            return self.send(200, png("img-" + key), "image/png", extra={"Cache-Control": "public, max-age=3600"})
        if p.startswith("/api/animalimg/"):
            key = unquote(p[15:])
            if key == "404":
                return self.js(404, {"error": "Noch nicht gerendert."}, cache=False)
            return self.send(200, png("tier-" + key), "image/png", extra={"Cache-Control": "public, max-age=3600"})
        if p.startswith("/api/portrait/"):
            user = unquote(p[14:]).lower()
            if user not in PAWNS or PAWNS[user]["portrait"] == 0:
                return self.js(404, {"error": "Kein Porträt."}, cache=False)
            return self.send(200, png(user), "image/png", extra={"Cache-Control": "public, max-age=3600"})
        if p == "/api/link/poll":
            pid = (q.get("id") or [""])[0]
            e = PENDING.get(pid)
            if not e:
                return self.js(200, {"state": "expired"}, cache=False)
            age = time.time() - e["created"]
            if age > 300:
                PENDING.pop(pid, None)
                return self.js(200, {"state": "expired"}, cache=False)
            if age >= 4:
                PENDING.pop(pid, None)       # Token kommt genau einmal
                tok = secrets.token_hex(16)
                TOKENS[tok] = "yoku"
                return self.js(200, {"state": "done", "token": tok, "user": "yoku", "displayName": "Yoku"}, cache=False)
            return self.js(200, {"state": "pending"}, cache=False)
        if p.startswith("/api/action/"):
            if not self.user():
                return self.js(401, {"error": "Nicht angemeldet."}, cache=False)
            a = ACTIONS.get(p[12:])
            if not a:
                return self.js(404, {"error": "Unbekannte Aktion."}, cache=False)
            if time.time() - a["created"] < 1:
                return self.js(200, {"state": "queued", "messages": []}, cache=False)
            return self.js(200, {"state": "done", "messages": a["messages"]}, cache=False)
        self.js(404, {"error": "Nicht gefunden."}, cache=False)

    def do_POST(self):
        p = urlparse(self.path).path
        payload = self.body()   # Body immer lesen, sonst stoert er die naechste Anfrage auf derselben Verbindung
        if p == "/api/link/start":
            pid = secrets.token_hex(8)
            code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
            PENDING[pid] = {"code": code, "created": time.time()}
            return self.js(200, {"pendingId": pid, "code": code, "expiresInSec": 300}, cache=False)
        if p == "/api/logout":
            a = self.headers.get("Authorization", "")
            TOKENS.pop(a[7:], None)
            return self.js(200, {"ok": True}, cache=False)
        if p == "/api/feedback":
            # Fake: schreibt NICHT ins Repo, sondern in den Temp-Ordner (oder Umgebung FAKE_FEEDBACK_FILE)
            b = payload
            text = str(b.get("text", "")).strip()
            if b.get("cat") not in ("bug", "idea", "other") or not 3 <= len(text) <= 1000:
                return self.js(400, {"error": "Text zu kurz oder zu lang (3 bis 1000 Zeichen)."}, cache=False)
            if "zuschnell" in text:
                return self.js(429, {"error": "Nicht so schnell – bitte in ein paar Minuten nochmal"}, cache=False)
            import tempfile
            fn = os.environ.get("FAKE_FEEDBACK_FILE") or os.path.join(tempfile.gettempdir(), "live-fake-feedback.jsonl")
            with open(fn, "a", encoding="utf-8") as f:
                f.write(json.dumps({"cat": b.get("cat"), "page": str(b.get("page", ""))[:200], "text": text}, ensure_ascii=False) + "\n")
            return self.js(200, {"ok": True}, cache=False)
        if p == "/api/action":
            user = self.user()
            if not user:
                return self.js(401, {"error": "Nicht angemeldet."}, cache=False)
            b = payload
            cmd, args = str(b.get("command", "")).lower(), str(b.get("args", ""))
            if cmd not in ALLOWED or not ARGS_RE.match(args):
                return self.js(400, {"error": "Dieser Befehl ist per Knopf nicht erlaubt."}, cache=False)
            if "zuschnell" in args:
                return self.js(429, {"error": "Nicht so schnell – warte einen Moment."}, cache=False)
            if "nospiel" in args:
                return self.js(409, {"error": "Gerade ist kein Spiel geladen."}, cache=False)
            aid = secrets.token_hex(6)
            with LOCK:
                STATE["coins"] -= 15
                msg = "@%s Erledigt: !%s %s (−15 Coins)" % (user, cmd, args)
                msg = fake_effect(user, cmd, args) or msg
            ACTIONS[aid] = {"created": time.time(), "messages": [msg.replace("  ", " ")] if cmd != "event" else []}
            return self.js(202, {"id": aid}, cache=False)
        self.js(404, {"error": "Nicht gefunden."}, cache=False)


if __name__ == "__main__":
    threading.Thread(target=ticker, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print("RICS-Live-Fake: http://127.0.0.1:%d  (Strg+C beendet)" % PORT)
    srv.serve_forever()
