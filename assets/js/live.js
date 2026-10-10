// RICS Live: Verbindung zur Live-Schnittstelle der Mod (siehe RICS-Live/docs/API.md).
// Alles hier läuft im Hintergrund und still: Ist die Mod nicht erreichbar, passiert nichts Sichtbares.
// Ereignisse (on): 'change' (live/offline, verknüpft/abgemeldet), 'me' (neue Daten zu mir), 'notice' (Hinweistext).

const TOKEN_KEY = 'ys-live-token';
const LIVE_JSON = 'https://api.github.com/repos/YokuTube/Yokus-Pricelist/contents/live.json?ref=live';
const RETRY_FAILED_MS = 60000;   // Adresse war da, ist aber ausgefallen: höchstens jede Minute neu suchen
const RETRY_ABSENT_MS = 120000;  // Es gibt gar keine Live-Adresse: seltener nachsehen (GitHub-Abruflimit)
const FAILS_TO_OFFLINE = 2;      // so viele Fehler in Folge, bevor die Seite „offline“ annimmt

const bus = new EventTarget();
export const on = (type, fn) => { bus.addEventListener(type, fn); return () => bus.removeEventListener(type, fn); };
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

const S = { live: false, base: '', status: null, token: null, me: null, fails: 0 };
let rediscoverTimer = null;
let rediscoverPending = false;
let discovering = false;
let settled = false;   // erste Suche abgeschlossen (egal ob gefunden)
let meStop = null;
let statusStop = null;
const pollers = new Set();

try { S.token = localStorage.getItem(TOKEN_KEY) || null; } catch { /* egal */ }

// ---------- Zustand lesen ----------
export const isLive = () => S.live;
export const streamAllowed = () => S.streamAllowed !== false;
export const isSettled = () => settled;
export const isLinked = () => S.live && !!S.token;
export const getStatus = () => S.status;
export const getMe = () => S.me;
export const prefix = () => S.status?.prefix || '!';
// Nie per Knopf – wer Kolonist wird, entscheidet der Streamer (gleiche Sperre steckt auch in der Mod)
const NEVER = ['pawn', 'leave'];
export const isAllowed = (cmd) => { const c = String(cmd).toLowerCase(); return !NEVER.includes(c) && !!S.status?.allowed?.includes(c); };
export const portraitUrl = (user, v) => `${S.base}/api/portrait/${encodeURIComponent(user)}?v=${encodeURIComponent(v ?? 0)}`;

// ---------- Netzwerk ----------
/** Eine Anfrage an die Schnittstelle. Wirft bei Netzfehler/Zeitüberschreitung ein Objekt mit net:true. */
async function api(path, { method = 'GET', body, auth = false, etag, timeout = 8000 } = {}) {
  const headers = {};
  if (auth && S.token) headers.Authorization = 'Bearer ' + S.token;
  if (etag) headers['If-None-Match'] = etag;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(S.base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal });
    let data = null;
    if (res.status !== 304 && (res.headers.get('content-type') || '').includes('json')) { data = await res.json().catch(() => null); if (data) cleanDescs(data); }
    return { status: res.status, ok: res.ok, data, etag: res.headers.get('ETag') };
  } catch {
    throw Object.assign(new Error('net'), { net: true });
  } finally {
    clearTimeout(t);
  }
}

function fail() {
  S.fails += 1;
  if (S.fails >= FAILS_TO_OFFLINE) goOffline();
}

function goOffline() {
  if (!S.live) return;
  S.live = false; S.me = null; S.status = null; S.fails = 0;
  pollers.forEach((p) => p.stop());
  meStop = null; statusStop = null;
  emit('change');
  scheduleRediscover(RETRY_FAILED_MS);
}

/** Wiederkehrende Abfrage mit ETag. Hört auf, sobald alive() false liefert oder die Seite offline geht. */
export function poll({ path, every, auth = false, alive = () => true, onResult }) {
  let stopped = false, timer = null, etag = null, cached = null, running = false;
  const entry = { kick: () => { clearTimeout(timer); tick(); }, stop: () => stop() };
  const stop = () => { stopped = true; clearTimeout(timer); pollers.delete(entry); };
  const next = () => { if (!stopped) timer = setTimeout(tick, every); };
  async function tick() {
    if (stopped || running) return;
    if (!S.live || !alive() || (auth && !S.token)) return stop();
    if (document.hidden) return;              // kommt beim Sichtbarwerden per kick() wieder
    running = true;
    try {
      const r = await api(path, { auth, etag });
      if (stopped) return;
      if (r.status === 401 && auth) { dropToken(true); return stop(); }
      if (r.status >= 500) { fail(); }
      else {
        S.fails = 0;
        if (r.status === 304) onResult({ status: 200, data: cached, unchanged: true });
        else {
          if (r.ok) { etag = r.etag; cached = r.data; } else { etag = null; cached = null; }
          onResult({ status: r.status, data: r.data, unchanged: false });
        }
      }
    } catch (e) {
      if (!stopped) fail();
    } finally {
      running = false;
      if (!stopped && S.live) next();
    }
  }
  pollers.add(entry);
  tick();
  return stop;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  pollers.forEach((p) => p.kick());
  if (rediscoverPending) { rediscoverPending = false; discover(); }
});

// ---------- Adresse finden ----------
function devBase() {
  // Nur auf dem eigenen Rechner: sonst könnte ein präparierter Link den Anmelde-Token an fremde Server schicken.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  const v = new URLSearchParams(location.search).get('live');
  return v && /^https?:\/\//i.test(v) ? v.replace(/\/+$/, '') : null;
}

function b64utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function scheduleRediscover(ms) {
  clearTimeout(rediscoverTimer);
  rediscoverTimer = setTimeout(() => { if (document.hidden) rediscoverPending = true; else discover(); }, ms);
}

async function findBase() {
  const dev = devBase();
  if (dev) return { base: dev };
  let res;
  try { res = await fetch(LIVE_JSON, { headers: { Accept: 'application/vnd.github+json' } }); } catch { return { error: true }; }
  if (res.status === 404) return { absent: true };
  if (!res.ok) return { error: true };
  try {
    const info = JSON.parse(b64utf8((await res.json()).content));
    // Stream-Reiter erlaubt? Gilt auch offline (Streamer kann ihn im Spiel abschalten).
    const sa = info?.stream !== false;
    if (sa !== S.streamAllowed) { S.streamAllowed = sa; emit('change'); }
    if (!info || info.online !== true || typeof info.url !== 'string' || !/^https:\/\//i.test(info.url)) return { absent: true };
    return { base: info.url.replace(/\/+$/, '') };
  } catch { return { error: true }; }
}

async function discover() {
  if (discovering || S.live) return;
  discovering = true;
  try {
    const f = await findBase();
    if (!f.base) { scheduleRediscover(f.absent ? RETRY_ABSENT_MS : RETRY_FAILED_MS); return; }
    S.base = f.base;
    let st;
    try { st = await api('/api/status'); } catch { scheduleRediscover(RETRY_FAILED_MS); return; }
    if (!st.ok || !st.data || st.data.live !== true) { scheduleRediscover(RETRY_FAILED_MS); return; }
    S.status = st.data; S.live = true; S.fails = 0;
    startPollers();
    emit('change');
  } finally {
    discovering = false;
    if (!settled) { settled = true; if (!S.live) emit('change'); }
  }
}

function startPollers() {
  statusStop = poll({
    path: '/api/status', every: 30000,
    onResult: (r) => {
      if (r.status !== 200 || !r.data) return;
      if (r.data.live !== true) return goOffline();
      if (!r.unchanged) S.status = r.data;
    },
  });
  startMe();
}

function startMe() {
  if (meStop) { meStop(); meStop = null; }
  if (!S.live || !S.token) return;
  meStop = poll({
    path: '/api/me', every: 1000, auth: true,
    onResult: (r) => {
      if (r.status !== 200 || !r.data || r.unchanged) return;
      S.me = r.data;
      emit('me', r.data);
    },
  });
}

// Manche Mods hängen ihren Namen an Beschreibungen an ("…\n\nCharacter Development", teils doppelt) – für
// Zuschauer bedeutungslos. Neue Mod-Versionen entfernen das schon; das hier fängt ältere ab: kurze Absätze
// ohne Satzzeichen am Ende einer Beschreibung weg.
function cleanDescs(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return;
  for (const k in o) {
    const v = o[k];
    if (k === 'desc' && typeof v === 'string' && v.includes('\n\n')) {
      const parts = v.split('\n\n');
      while (parts.length > 1 && /^[^.!?:;…]{1,40}$/.test(parts[parts.length - 1].trim())) parts.pop();
      o[k] = parts.join('\n\n').trim();
    } else if (v && typeof v === 'object') cleanDescs(v, depth + 1);
  }
}

/** Einmaliger Abruf (ohne Wiederholung), z. B. für statische Daten wie /api/isekai. Gibt { status, data } zurück; wirft bei Netzfehler. */
export async function getJson(path) {
  if (!S.live) throw Object.assign(new Error('offline'), { net: true });
  const r = await api(path, { auth: false });
  return { status: r.status, data: r.data };
}

/** Sofort neu laden (z. B. nach einem Kauf). */
export async function refreshMe() {
  if (!isLinked()) return;
  try {
    const r = await api('/api/me', { auth: true });
    if (r.status === 401) return dropToken(true);
    if (r.ok && r.data) { S.me = r.data; emit('me', r.data); }
  } catch { /* der nächste Takt versucht es wieder */ }
}

// ---------- Verknüpfen ----------
function setToken(t) {
  S.token = t;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* egal */ }
}

function dropToken(expired) {
  const had = !!S.token;
  setToken(null); S.me = null;
  if (meStop) { meStop(); meStop = null; }
  if (had) { emit('change'); if (expired) emit('notice', 'Die Verknüpfung ist abgelaufen. Bitte neu verbinden.'); }
}

export async function startLink() {
  const r = await api('/api/link/start', { method: 'POST', body: {} });
  if (!r.ok || !r.data?.code) throw new Error(r.data?.error || 'Der Verbindungs-Code konnte nicht angefordert werden.');
  return r.data;   // { pendingId, code, expiresInSec }
}

/** Fragt einmal ab. Bei 'done' ist die Verknüpfung fertig. */
export async function pollLink(pendingId) {
  const r = await api('/api/link/poll?id=' + encodeURIComponent(pendingId));
  if (!r.ok || !r.data) throw new Error('net');
  if (r.data.state === 'done' && r.data.token) {
    setToken(r.data.token);
    startMe();
    emit('change');
  }
  return r.data;
}

export async function logout() {
  try { await api('/api/logout', { method: 'POST', auth: true, body: {} }); } catch { /* Token wird lokal trotzdem verworfen */ }
  dropToken(false);
}

// ---------- Aktionen ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Löst einen Befehl aus. Liefert die Chat-Antworten (kann leer sein); wirft Error mit deutschem Text. */
export async function act(command, args) {
  if (NEVER.includes(String(command).toLowerCase())) throw new Error('Das geht nur über den Streamer.');
  let r;
  try { r = await api('/api/action', { method: 'POST', auth: true, body: { command, args } }); }
  catch { throw new Error('Keine Verbindung zum Spiel. Versuch es gleich noch einmal.'); }
  if (r.status === 401) { dropToken(true); throw new Error('Die Verknüpfung ist abgelaufen. Bitte neu verbinden.'); }
  if (r.status === 400) throw new Error(r.data?.error || 'Das lässt sich nicht per Knopf auslösen. Kopiere den Befehl und schreib ihn in den Chat.');
  if (r.status === 429) throw new Error(r.data?.error || 'Nicht so schnell – warte einen Moment und versuch es dann noch einmal.');
  if (r.status === 409) throw new Error(r.data?.error || 'Gerade ist kein Spiel geladen.');
  if (r.status !== 202 && r.status !== 200) throw new Error(r.data?.error || 'Das hat nicht geklappt (Fehler ' + r.status + ').');
  const id = r.data?.id;
  if (!id) return [];
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    await wait(700);
    try {
      const s = await api('/api/action/' + encodeURIComponent(id), { auth: true });
      if (s.status === 401) { dropToken(true); throw new Error('Die Verknüpfung ist abgelaufen. Bitte neu verbinden.'); }
      if (s.ok && s.data?.state === 'done') { refreshMe(); return Array.isArray(s.data.messages) ? s.data.messages : []; }
    } catch (e) {
      if (!e.net) throw e;       // Netzfehler beim Abfragen: weiter versuchen, bis die Zeit um ist
    }
  }
  refreshMe();
  return [];
}

// ---------- Start ----------
export function initLive() {
  discover();
}
