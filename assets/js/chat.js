// Optional: Zuschauer können sich mit Twitch verbinden und Befehle direkt aus der Seite in den Chat senden.
// Ohne Anmeldung ändert sich nichts (normales Kopieren). Läuft komplett im Browser (Implicit-Grant, nur Scope user:write:chat).
// Aktiv nur, wenn data/site-config.json eine Twitch-Client-ID und einen Kanal enthält.
import { esc, copyText, toast } from './util.js';

const KEY = 'ys-twitch';        // sessionStorage: { token, userId, login, expiresAt }
const STATE_KEY = 'ys-oauth-state';
const RETURN_KEY = 'ys-oauth-return';

let cfg = null;
let session = null;
let broadcasterId = null;
let onChange = () => {};

const redirectUri = () => location.origin + location.pathname;

function load() {
  try { session = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { session = null; }
  if (session && session.expiresAt && Date.now() > session.expiresAt) { session = null; sessionStorage.removeItem(KEY); }
}
const save = () => { if (session) sessionStorage.setItem(KEY, JSON.stringify(session)); else sessionStorage.removeItem(KEY); };

export const chatEnabled = () => !!cfg?.twitchClientId && !!cfg?.channel;
export const loggedIn = () => !!session?.token;
export const who = () => session?.login || '';

export function login() {
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, location.hash || '#/start');
  const p = new URLSearchParams({
    client_id: cfg.twitchClientId, redirect_uri: redirectUri(), response_type: 'token',
    scope: 'user:write:chat', state, force_verify: 'false',
  });
  location.href = 'https://id.twitch.tv/oauth2/authorize?' + p;
}

export async function logout() {
  const token = session?.token;
  session = null; broadcasterId = null; save();
  if (token && cfg?.twitchClientId) {
    try {
      await fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.twitchClientId, token }),
      });
    } catch { /* egal */ }
  }
  onChange();
}

/** Rückkehr von Twitch: Token aus dem Hash lesen und prüfen. */
async function handleRedirect() {
  if (!location.hash.includes('access_token=')) return;
  const h = new URLSearchParams(location.hash.slice(1));
  const back = sessionStorage.getItem(RETURN_KEY) || '#/start';
  const state = sessionStorage.getItem(STATE_KEY);
  history.replaceState(null, '', location.pathname + location.search + back);
  sessionStorage.removeItem(STATE_KEY); sessionStorage.removeItem(RETURN_KEY);
  if (!state || h.get('state') !== state) { toast('Anmeldung abgebrochen (Sicherheitsprüfung)'); return; }
  const token = h.get('access_token');
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + token } });
    if (!res.ok) throw new Error('validate ' + res.status);
    const v = await res.json();
    if (v.client_id !== cfg.twitchClientId || !(v.scopes || []).includes('user:write:chat')) throw new Error('Scope fehlt');
    session = { token, userId: v.user_id, login: v.login, expiresAt: Date.now() + (v.expires_in || 3600) * 1000 - 60000 };
    save();
    toast('Mit Twitch verbunden als ' + v.login);
  } catch (e) {
    console.warn(e); toast('Twitch-Anmeldung hat nicht geklappt');
  }
}

async function getBroadcasterId() {
  if (broadcasterId) return broadcasterId;
  const r = await fetch('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(cfg.channel), {
    headers: { Authorization: 'Bearer ' + session.token, 'Client-Id': cfg.twitchClientId },
  });
  if (!r.ok) throw new Error('users ' + r.status);
  const j = await r.json();
  broadcasterId = j.data?.[0]?.id;
  if (!broadcasterId) throw new Error('Kanal nicht gefunden');
  return broadcasterId;
}

export async function send(text) {
  if (!loggedIn()) throw new Error('Nicht angemeldet');
  const r = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.token, 'Client-Id': cfg.twitchClientId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ broadcaster_id: await getBroadcasterId(), sender_id: session.userId, message: text }),
  });
  if (r.status === 401) { await logout(); throw new Error('Die Anmeldung ist abgelaufen. Bitte neu verbinden.'); }
  if (!r.ok) throw new Error('Senden fehlgeschlagen (' + r.status + ')');
  const j = await r.json();
  const d = j.data?.[0];
  if (d && d.is_sent === false) throw new Error(d.drop_reason?.message || 'Twitch hat die Nachricht nicht zugestellt');
}

// ---------- Oberfläche ----------

/** Kleiner, unauffälliger Link in der Kopfzeile. */
export function renderSlot(slot) {
  if (!slot) return;
  if (!chatEnabled()) { slot.innerHTML = ''; return; }
  slot.innerHTML = loggedIn()
    ? `<span class="small muted">✓ ${esc(who())} · <button type="button" class="linklike" data-chat="logout">abmelden</button></span>`
    : `<button type="button" class="linklike small" data-chat="login" title="Optional: Befehle direkt aus der Seite in den Chat senden">Mit Twitch verbinden</button>`;
}

let dlg;
function dialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'send-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="sd-body">
      <h3>Im Chat senden?</h3>
      <p class="small muted" id="sd-hint"></p>
      <input class="search mono" id="sd-input" autocomplete="off" spellcheck="false" aria-label="Befehl">
      <p class="small" id="sd-warn" style="color:var(--bad);min-height:1.2em;margin:6px 0 0"></p>
      <div class="sd-actions">
        <button type="button" class="btn primary" id="sd-send">Senden</button>
        <button type="button" class="btn" id="sd-copy">Nur kopieren</button>
        <button type="submit" class="btn">Abbrechen</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('#sd-input'), warn = dlg.querySelector('#sd-warn'), sendBtn = dlg.querySelector('#sd-send');
  const check = () => {
    const bad = /[<>]/.test(input.value) || !input.value.trim();
    warn.textContent = /[<>]/.test(input.value) ? 'Ersetze noch die Teile in < > durch deine Angabe.' : '';
    sendBtn.disabled = bad;
  };
  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!sendBtn.disabled) sendBtn.click(); } });
  dlg.querySelector('#sd-copy').addEventListener('click', () => { copyText(input.value.trim()); dlg.close(); });
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true; warn.textContent = '';
    try { await send(input.value.trim()); toast('Gesendet: ' + input.value.trim()); dlg.close(); }
    catch (e) { warn.textContent = e.message; sendBtn.disabled = false; }
  });
  dlg._set = (text) => {
    input.value = text; check();
    dlg.querySelector('#sd-hint').textContent = `Wird in deinem Namen (${who()}) im Chat von ${cfg.channel} gesendet. Coins werden dort abgezogen.`;
  };
  return dlg;
}

/** Wird beim Antippen eines Befehls aufgerufen. Gibt true zurück, wenn der Dialog übernommen hat. */
export function offerSend(text) {
  if (!chatEnabled() || !loggedIn()) return false;
  const d = dialog();
  d._set(text);
  d.showModal();
  d.querySelector('#sd-input').focus();
  return true;
}

export async function initChat(config, changed) {
  cfg = config && typeof config === 'object' ? config : null;
  onChange = changed || (() => {});
  if (!chatEnabled()) return;
  await handleRedirect();
  load();
}

export const handleSlotClick = (e) => {
  const b = e.target.closest('[data-chat]');
  if (!b) return false;
  if (b.dataset.chat === 'login') login(); else logout();
  return true;
};
