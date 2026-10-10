"""Fake-Server fuer die RICS-Live-Schnittstelle (siehe RICS-Live/docs/API.md) - nur zum Testen der Webseite.

Start:   python tools/live-fake.py            (Port 8790)
Seite:   python tools/dev-server.py           (Port 8765), dann
         http://localhost:8765/?live=http://127.0.0.1:8790

Verhalten:
- /api/link/start liefert einen Code; nach ~4 s gilt er als bestaetigt (Benutzer "yoku").
- Muenzen steigen alle 10 s um 50.
- Aktionen liefern nach 1 s eine Beispiel-Antwort. Zum Testen der Fehlerfaelle:
  Argument "zuschnell" -> 429, "nospiel" -> 409, Befehl ausserhalb von "allowed" -> 400.
- Pawn "mira_spielt" ist niedergestreckt und blutet, "eddi_tv" schlaeft und hat keine Wuensche/Quirks (null).
"""
import hashlib
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
ALLOWED = ["buy", "use", "equip", "wear", "event", "weather", "bal", "mypawn", "join", "leave", "flirt", "chitchat"]
ARGS_RE = re.compile(r"^[\w \-.'#]{0,80}$", re.UNICODE)

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
    keys = ["user", "displayName", "name", "portrait", "healthPct", "moodPct", "state", "stateLabel", "job"]
    return {k: p[k] for k in keys}


def game_info():
    t = int(time.time())
    return {
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
    }


def ticker():
    while True:
        time.sleep(10)
        with LOCK:
            STATE["coins"] += 50


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
        if p == "/api/colony":
            return self.js(200, {"pawns": [summary(x) for x in PAWNS.values()]})
        if p.startswith("/api/pawn/"):
            pw = PAWNS.get(unquote(p[10:]).lower())
            return self.js(200, pw) if pw else self.js(404, {"error": "Kein Kolonist mit diesem Namen."}, cache=False)
        if p == "/api/me":
            user = self.user()
            if not user:
                return self.js(401, {"error": "Nicht angemeldet."}, cache=False)
            with LOCK:
                coins, karma = STATE["coins"], STATE["karma"]
            return self.js(200, {"user": user, "displayName": ALLOWED_USERS.get(user, user), "coins": coins,
                                 "karma": karma, "pawn": PAWNS.get(user)})
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
            ACTIONS[aid] = {"created": time.time(), "messages": [msg.replace("  ", " ")] if cmd != "event" else []}
            return self.js(202, {"id": aid}, cache=False)
        self.js(404, {"error": "Nicht gefunden."}, cache=False)


if __name__ == "__main__":
    threading.Thread(target=ticker, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print("RICS-Live-Fake: http://127.0.0.1:%d  (Strg+C beendet)" % PORT)
    srv.serve_forever()
