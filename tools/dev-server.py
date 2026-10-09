"""Kleiner lokaler Server zum Ansehen der Seite - ohne Zwischenspeicher, damit Änderungen sofort sichtbar sind.

Start:  python tools/dev-server.py        (dann http://localhost:8765 öffnen)
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


handler = functools.partial(NoCache, directory=ROOT)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as srv:
    print(f"Yokus Store: http://localhost:{PORT}  (Strg+C beendet)")
    srv.serve_forever()
