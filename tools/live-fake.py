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
ALLOWED = ["buy", "use", "equip", "wear", "event", "weather", "bal", "mypawn", "join", "leave", "flirt", "chitchat", "wants", "aspirations", "quirks", "isekai", "duel", "vote", "sethair", "setbeard", "dyehair", "setfavoritecolor", "geschenk", "chitchat", "deeptalk", "buildrapport", "reassure", "flirt", "insult"]
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
        "user": user, "displayName": display, "name": name, "portrait": portrait,
        "healthPct": health, "moodPct": mood, "state": state, "stateLabel": state_label, "job": job,
        "fullName": full, "gender": gender, "age": age, "race": race, "xenotype": xeno,
        "childhood": child, "adulthood": adult, "location": "Kolonie", "moodLabel": mood_label,
        "childhoodDesc": "Als Kind wuchs sie in den Gassen einer Glitzerwelt-Stadt auf und lernte früh, für sich selbst zu sorgen.",
        "adulthoodDesc": "Später kochte sie in einer Raumhafen-Kantine – schnell, laut und immer mit einem Lied auf den Lippen.",
        "ideo": {"id": 1, "name": "Sonnenpfad", "certainty": 82, "role": "Moralführer" if user == "yoku" else None},
        "thoughts": [
            {"label": "Hat eine feine Mahlzeit gegessen", "value": 5, "count": 1, "desc": "Das war richtig gutes Essen."},
            {"label": "Schöne Umgebung", "value": 3, "count": 1, "desc": "Hier ist es hübsch."},
            {"label": "Hat im Regen geschlafen", "value": -4, "count": 2, "desc": "Nass und kalt."},
            {"label": "Schmerz", "value": -6.5, "count": 1, "desc": "Es tut weh."},
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
            "inventory": ["Bier x3", "Verband x2", "Silber x120"]},
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


PAWNS["yoku"]["isekai"] = isekai_data("krieger", 7, 340, 500, "D-Rang", 3, 2,
                                      {"str": 12, "dex": 9, "vit": 11, "int": 6, "wis": 7, "cha": 8},
                                      ["kr_start", "kr_a1", "kr_a2", "kr_a4"])
PAWNS["luna_88"]["isekai"] = isekai_data(None, 2, 40, 120, None, 1, 0,
                                         {"str": 5, "dex": 6, "vit": 6, "int": 9, "wis": 8, "cha": 7}, [])
for _p in PAWNS.values():
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
    return {"name": name, "user": user, "relations": rels, "opinion": op, "theirs": theirs,
            "colonist": user is not None, "dead": dead, "animal": animal}


RELATIONS = {
    "yoku": [rel("Luna Mertens", "luna_88", ["Mutter"], 60, 55),
             rel("Eddi Brandt", "eddi_tv", ["Bruder"], 20, 15),
             rel("Jonas Krag", None, ["Ex-Partner"], -40, -55),
             rel("Olaf Aldemar", None, ["Vater"], 0, 0, dead=True),
             rel("Mira Voss", "mira_spielt", [], 35, -10),
             rel("Sven Reiter", None, [], -25, -30),
             rel("Rex", None, [], 0, 0, animal=True)],
    "mira_spielt": [rel("Kira Aldemar", "yoku", [], 30, 35),
                    rel("Luna Mertens", "luna_88", [], -15, 5)],
    "luna_88": [rel("Kira Aldemar", "yoku", ["Tochter"], 70, 60),
                rel("Eddi Brandt", "eddi_tv", [], 10, 8)],
    "eddi_tv": [rel("Kira Aldemar", "yoku", ["Schwester"], 25, 15)],
}

# ---------- Ereignisse (Chronik mit Text) ----------
EVENTS = [
    {"label": "Überfall: Plünderer", "text": "Fünf Plünderer sind über den Nordpass gekommen. Zwei wurden erledigt, die übrigen flohen.", "kind": "threat", "ago": "2 Stunden", "day": 37},
    {"label": "Händler aus Fernost", "text": "Ein Händler hat drei Kisten Stahl gegen Reis getauscht.", "kind": "good", "ago": "7 Stunden", "day": 37},
    {"label": "Pawn ist krank: Grippe", "text": "Mira hat sich bei einem Wanderer angesteckt und liegt im Bett.", "kind": "bad", "ago": "1 Tag", "day": 36},
    {"label": "Wanderer schließt sich an", "text": "Ein Wanderer aus dem Westen wollte bleiben. Sein Name ist Jan.", "kind": "good", "ago": "2 Tage", "day": 35},
    {"label": "Wetterwechsel", "text": "Der Regen hat aufgehört. Es ist jetzt trocken und warm.", "kind": "neutral", "ago": "3 Tage", "day": 34},
    {"label": "Kurze Kälte", "text": "Die Temperatur ist für einen Tag unter den Gefrierpunkt gefallen.", "kind": "bad", "ago": "4 Tage", "day": 33},
    {"label": "Schwarm Fledermäuse", "text": "Ein Schwarm ist in die Höhle gezogen. Niemand wurde verletzt.", "kind": "neutral", "ago": "5 Tage", "day": 32},
    {"label": "Mondfest", "text": "Die Kolonie hat gefeiert. Die Stimmung ist deutlich gestiegen.", "kind": "good", "ago": "6 Tage", "day": 31},
]

# ---------- Abstimmung (RICS Voting): 90 s offen, dann 20 s Pause ----------
VOTE_OPTS = ["Überfall: Plünderer", "Hitzewelle", "Händler-Besuch", "Wanderer aufnehmen"]
VOTE = {"cycle": -1, "counts": [0, 0, 0, 0]}


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
    return {"open": True, "options": opts, "total": total, "secondsLeft": 90 - ph}


# ---------- Herausforderung (Duell): alle 120 s fuer 45 s, Antwort beendet sie ----------
DUEL = {"answered": -1}


def duel_state():
    t = int(time.time())
    cyc, ph = t // 120, t % 120
    if not (30 <= ph < 75) or DUEL["answered"] == cyc:
        return None
    return {"from": "Mira", "fromUser": "mira_spielt", "secondsLeft": 75 - ph}


# ---------- Tiere, Quirk-Angebote, Forschung ----------
ANIMALS = [
    {"name": "Rex", "kind": "Husky", "gender": "Männlich", "age": 4.2, "healthPct": 96, "bond": "Kira", "master": "Kira"},
    {"name": "Mieze", "kind": "Katze", "gender": "Weiblich", "age": 2.1, "healthPct": 88, "bond": "Luna", "master": None},
    {"name": "Bruno", "kind": "Alpaka", "gender": "Männlich", "age": 5.0, "healthPct": 100, "bond": None, "master": "Luna"},
    {"name": None, "kind": "Huhn", "gender": "Weiblich", "age": 1.3, "healthPct": 74, "bond": None, "master": None},
    {"name": None, "kind": "Huhn", "gender": "Weiblich", "age": 0.8, "healthPct": 100, "bond": None, "master": None},
    {"name": "Schnauzi", "kind": "Wildschwein", "gender": "Männlich", "age": 3.4, "healthPct": 35, "bond": None, "master": None},
]
if os.environ.get("FAKE_MANY"):
    ANIMALS += [{"name": None, "kind": "Huhn", "gender": "Weiblich", "age": 1.0 + i / 10, "healthPct": 60 + i * 5, "bond": None, "master": None} for i in range(5)]
    ANIMALS += [{"name": None, "kind": "Alpaka", "gender": "Männlich", "age": 2.0 + i, "healthPct": 90, "bond": None, "master": "Luna" if i == 0 else None} for i in range(3)]

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
    keys = ["user", "displayName", "name", "portrait", "healthPct", "moodPct", "state", "stateLabel", "job",
            "kills", "daysInColony", "isekaiLevel"]
    return {k: p[k] for k in keys}


# ---------- Gedenkwand, Koloniewert-Verlauf, Fraktionen, Besucher (GameInfo) ----------
MEMORIALS = [
    {"name": "Olaf", "fullName": "Olaf Aldemar", "user": None, "cause": "Schussverletzung (Plünderer)",
     "diedDay": 29, "joinedDay": 3, "age": 58, "kills": 6, "ago": "8 Tage"},
    {"name": "Fenja", "fullName": "Fenja Pixel", "user": "fenja_pixel", "cause": "Blutverlust nach einem Angriff",
     "diedDay": 33, "joinedDay": 20, "age": 22, "kills": 2, "ago": "4 Tage"},
]
NOISE = [0, 90, -60, 40, -120, 70, 20, 0, 10]   # kleine Schwankungen; Tag 37 (letzter Punkt) ist exakt 48250
WEALTH_HISTORY = [[d, 41000 + (d - 8) * 250 + NOISE[(d * 7) % 9]] for d in range(8, 38)]
FACTIONS = [
    {"name": "Glitzerwelt", "kind": "Imperium", "goodwill": 62, "hasGoodwill": True, "relation": "ally"},
    {"name": "Pilzbund", "kind": "Stamm", "goodwill": 8, "hasGoodwill": True, "relation": "neutral"},
    {"name": "Schwarzer Pakt", "kind": "Piraten", "goodwill": -74, "hasGoodwill": True, "relation": "hostile"},
    {"name": "Raumhafen-Kette", "kind": "Händler", "goodwill": 0, "hasGoodwill": False, "relation": "neutral"},
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


def game_info():
    t = int(time.time())
    return {
        "giftPrice": 150,
        "colony": "Neu-Yoku", "date": "5. Aprimay 5501", "day": 37, "hour": (t // 20) % 24,
        "season": "Frühling", "weather": "Leichter Regen", "temperature": "12 °C", "wealth": 48250 + (t // 10) % 7 * 10,
        "colonists": 6, "prisoners": 1, "animals": 9, "viewerPawns": len(PAWNS),
        "storyteller": "Cassandra Classic", "difficulty": "Herausforderung",
        "research": {"label": "Elektrizität", "pct": 62},
        "conditions": [
            {"label": "Hitzewelle", "desc": "Es ist ungewöhnlich heiß.", "left": "1,2 Tage"},
            {"label": "Toxischer Niederschlag", "desc": "Gift liegt in der Luft.", "left": "3 Tage"},
            {"label": "Ruhige Zeiten", "desc": "Der Erzähler hält sich zurück.", "left": None}],
        "events": [
            {"label": "Überfall: Plünderer", "kind": "threat", "ago": "vor 2 Stunden", "day": 37},
            {"label": "Händler aus Fernost", "kind": "good", "ago": "vor 7 Stunden", "day": 37},
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
                  "items": [{"label": "Reis", "count": 120}, {"label": "Bier", "count": 14}, {"label": "Medizin", "count": 22}, {"label": "Stahl", "count": 540}]},
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
        if p == "/api/ideos":
            return self.js(200, {"ideos": [{"id": 1, "name": "Sonnenpfad", "culture": "Astrisch", "primary": True, "followers": 4,
                "desc": "Die Sonne gibt, die Sonne nimmt. Wer hart arbeitet, wird von ihr gesegnet.",
                "memes": [{"label": "Arbeitsam", "desc": "Fleiß ist heilig.", "structure": False}, {"label": "Animistisch", "desc": "Alles hat eine Seele.", "structure": True}],
                "precepts": [{"issue": "Kannibalismus", "label": "Verabscheut", "desc": "Menschenfleisch zu essen ist ein schweres Vergehen.", "impact": "high"},
                             {"issue": "Drogen", "label": "Nur medizinisch", "desc": "Drogen nur zur Heilung.", "impact": "medium"},
                             {"issue": "Bäume fällen", "label": "Missbilligt", "desc": "Bäume sind lebendig.", "impact": "low"}],
                "roles": [{"label": "Moralführer", "desc": "Leitet Rituale und Gespräche über den Glauben.", "holders": ["Kira"]},
                          {"label": "Erntemeister", "desc": "Spezialist für die Ernte.", "holders": []}],
                "rituals": [{"label": "Sonnenfest", "desc": "Ein Fest zur Sommersonnenwende."}]}]})
        if p == "/api/events":
            return self.js(200, {"events": EVENTS, "social": [{"text": "Kira hat mit Mira über Kochrezepte geplaudert.", "ago": "1 Stunde"}, {"text": "Luna hat Eddi ein Geschenk gemacht.", "ago": "3 Stunden"}, {"text": "Eddi hat Kira beleidigt.", "ago": "2 Tage"}]})
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
                    {"text": "Kira hat mit Mira über Kochrezepte geplaudert.", "ago": "2 Stunden"},
                    {"text": "Kira hat Eddi beleidigt.", "ago": "5 Stunden"},
                    {"text": "Luna hat Kira ein tiefes Gespräch über das Leben angeboten.", "ago": "1 Tag"},
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
                                 "karma": karma, "coinsPerMinute": 7.5, "earning": True, "activeMinutesLeft": 24, "pawn": pawn})
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
