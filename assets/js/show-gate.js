// Show-Erkennung (Mod Wildshow). Das ist der EINZIGE Show-Teil, der im Hauptspiel geladen wird: ein stiller Abruf von /api/show.
// Antwortet die Mod mit 404 (Wildshow nicht aktiv) oder { active: false } (kein Show-Spielstand), bleibt alles andere unberührt:
// show.js, show-live.js und show.css werden dann gar nicht erst geladen und nichts davon taucht auf der Seite auf.
// Erst wenn eine Show läuft, werden die Module nachgeladen; danach melden onShowChange-Abnehmer „Show an“.
import * as live from './live.js';

export const SHOW_TAB = { id: 'show', label: 'Show', view: showView };
// Im Show-Modus fallen diese Reiter weg (Einkauf/Preislisten)
export const SHOW_HIDDEN = ['items', 'events', 'wetter', 'traits', 'rassen', 'mods', 'spiel'];

let showData = null;          // letzte Antwort von /api/show (nur wenn active)
let active = false;
let settled = false;          // erste Antwort der Mod ausgewertet
let wantSettle = false;       // jemand wartet darauf (Direktlink auf den Show-Reiter)
let mod = null;               // nachgeladenes show.js
let loading = null;
let probeStop = null;
let probeEvery = 0;
const listeners = new Set();

export const isShowMode = () => active && live.isLive();
export const getShowData = () => showData;
export const onShowChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** true, sobald klar ist, ob eine Show läuft (ohne Live-Mod sofort). */
export function isShowSettled() {
  if (settled || !live.isLive()) return true;
  wantSettle = true;
  return false;
}

const emit = () => listeners.forEach((fn) => { try { fn(active); } catch (e) { console.warn('[show]', e); } });

function loadModule() {
  if (!loading) {
    if (!document.getElementById('show-css')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.id = 'show-css'; l.href = 'assets/css/show.css';
      document.head.append(l);
    }
    loading = import('./show.js').then((m) => { mod = m; return m; }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function setActive(v, keepUnsettled) {
  const was = active;
  active = !!v;
  document.body.classList.toggle('show-mode', active && live.isLive());
  const first = !settled;
  if (!keepUnsettled) settled = true;
  if (was !== active || (first && wantSettle && !keepUnsettled)) { wantSettle = false; emit(); }
}

function startProbe(every) {
  if (probeStop) { probeStop(); probeStop = null; }
  probeEvery = every;
  probeStop = live.poll({
    path: '/api/show', every, alive: () => live.isLive(),
    onResult: (r) => {
      if (r.status === 200 && r.data && r.data.active) {
        if (!r.unchanged || !showData) showData = r.data;
        if (mod) setActive(true);
        else loadModule().then(() => { if (live.isLive()) setActive(true); }).catch((e) => console.warn('[show] Laden fehlgeschlagen', e));
      } else if (r.status === 200 || r.status === 404) {
        showData = null;
        setActive(false);
        if (r.status === 404 && probeEvery < 60000) startProbe(60000);   // Mod gar nicht aktiv: nur noch selten nachsehen
        else if (r.status === 200 && probeEvery > 8000) startProbe(8000);
      }
    },
  });
}

/** Einmal beim Start: erkennt im Hintergrund, ob eine Show läuft. Ohne Live-Mod passiert nichts. */
export function initShow() {
  const start = () => {
    if (probeStop) { probeStop(); probeStop = null; }
    if (!live.isLive()) { showData = null; settled = false; setActive(false, true); return; }
    startProbe(8000);
  };
  live.on('change', start);
  start();
}

/** Reiter-Ansicht: gibt es das Modul schon (es gibt sie nur im Show-Modus), zeichnet es; sonst ein Platzhalter. */
export function showView() {
  return mod ? mod.showView() : { html: '<div class="empty">Lade …</div>', bind() {} };
}
