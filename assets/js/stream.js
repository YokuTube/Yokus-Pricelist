// Reiter „Stream“: Twitch-Player und -Chat eingebettet (offizielle Twitch-Einbettung, keine App nötig).
// Jeder Zuschauer schaltet Stream und Chat getrennt ein/aus (z. B. Stream läuft schon am Fernseher) – gemerkt im Browser.
// Der Player lädt nie von selbst, erst nach Klick auf „Stream hier ansehen“ (kein doppelter Ton).
//
// Player und Chat liegen in einem festen Behälter (#stream-dock) außerhalb der Ansichten und werden NIE im DOM verschoben
// (verschobene iframes laden neu). Beim Reiterwechsel ändert sich nur die Darstellung: auf „Stream“ groß,
// anderswo läuft der Player als kleines Fenster unten rechts weiter, der Chat bleibt unsichtbar geladen.
import { esc } from './util.js';

export const CHANNEL = 'dasyoku';
const KEY = 'ys-stream';
export const CHAT_POPOUT = `https://www.twitch.tv/popout/${CHANNEL}/chat`;

export function getStreamPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* egal */ }
  return { player: p?.player !== false, chat: p?.chat !== false };
}

function setStreamPrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* egal */ }
}

// Reiter nur zeigen, wenn mindestens eins von beidem eingeschaltet ist.
export const streamTabVisible = () => { const p = getStreamPrefs(); return p.player || p.chat; };

const parent = () => encodeURIComponent(location.hostname || 'localhost');
const dark = () => document.documentElement.dataset.theme !== 'light';
const playerSrc = () => `https://player.twitch.tv/?channel=${CHANNEL}&parent=${parent()}&autoplay=true`;
const chatSrc = () => `https://www.twitch.tv/embed/${CHANNEL}/chat?parent=${parent()}${dark() ? '&darkpopout' : ''}`;

const dock = () => document.getElementById('stream-dock');
let playing = false;   // Player läuft (bis „✕“ oder Stream ausgeschaltet)
let chatLoaded = false;
let onStreamTab = false;

// Ansicht des Reiters selbst: nur Hinweistext – Player/Chat zeigt der Dock-Behälter darüber.
export function streamView() {
  return {
    html: `<p class="stream-hint">Zum Mitschreiben musst du bei Twitch angemeldet sein. Klappt das hier nicht (manche Browser blockieren das),
      nimm „Chat in eigenem Fenster öffnen“. Wechselst du den Reiter, läuft der Stream klein unten rechts weiter.
      Stream oder Chat ausblenden: Knopf <b>Stream</b> oben rechts.</p>`,
    bind() {},
  };
}

// Nach jedem Reiterwechsel aufrufen.
export function syncStreamDock(tabId) {
  const d = dock();
  if (!d) return;
  const p = getStreamPrefs();
  onStreamTab = tabId === 'stream';
  if (!p.player) playing = false;
  if (!d.dataset.ready) build(d);

  const player = d.querySelector('.stream-player');
  const chat = d.querySelector('.stream-chat');
  player.hidden = !p.player || (!onStreamTab && !playing);
  chat.hidden = !p.chat || !onStreamTab;
  if (onStreamTab && p.chat && !chatLoaded) {
    chatLoaded = true;
    chat.querySelector('.stream-chat-frame').innerHTML = `<iframe src="${esc(chatSrc())}" title="Twitch-Chat von ${CHANNEL}"></iframe>`;
  }
  if (!p.chat && chatLoaded) { chatLoaded = false; chat.querySelector('.stream-chat-frame').innerHTML = ''; }
  if (!playing) player.querySelector('.stream-frame').innerHTML = startButton();

  d.classList.toggle('mini', !onStreamTab && playing);
  d.classList.toggle('both', onStreamTab && p.player && p.chat);
  d.hidden = onStreamTab ? !(p.player || p.chat) : !playing;
}

function startButton() {
  return `<button type="button" class="stream-start" data-stream-start>
      <span class="stream-start-icon" aria-hidden="true">▶</span>
      <span>Stream hier ansehen</span>
      <small>Startet mit Ton – nicht nötig, wenn du schon woanders zuschaust</small>
    </button>`;
}

function build(d) {
  d.dataset.ready = '1';
  d.innerHTML = `
    <div class="stream-player">
      <div class="stream-frame"></div>
      <div class="stream-mini-bar">
        <a href="#/stream" class="stream-mini-btn" title="Groß anzeigen">Groß</a>
        <button type="button" class="stream-mini-btn" data-stream-stop title="Stream beenden" aria-label="Stream beenden">✕</button>
      </div>
    </div>
    <div class="stream-chat">
      <div class="stream-chat-frame"></div>
      <a class="stream-popout" href="${CHAT_POPOUT}" target="_blank" rel="noopener">Chat in eigenem Fenster öffnen ↗</a>
    </div>`;
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-stream-start]')) {
      playing = true;
      d.querySelector('.stream-frame').innerHTML =
        `<iframe src="${esc(playerSrc())}" title="Stream von ${CHANNEL}" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
      syncStreamDock(onStreamTab ? 'stream' : '');
    } else if (e.target.closest('[data-stream-stop]')) {
      playing = false;
      syncStreamDock(onStreamTab ? 'stream' : '');
    }
  });
}

// Kleines Einstellungsfeld am Knopf „Stream“ im Kopf. onChange zeichnet Reiter/Ansicht neu.
export function initStreamSettings(onChange) {
  const btn = document.getElementById('stream-toggle');
  const panel = document.getElementById('stream-panel');
  if (!btn || !panel) return;
  const draw = () => {
    const p = getStreamPrefs();
    panel.innerHTML = `
      <p class="stream-panel-title">Auf dieser Seite zeigen</p>
      <label><input type="checkbox" data-pref="player" ${p.player ? 'checked' : ''}> Stream</label>
      <label><input type="checkbox" data-pref="chat" ${p.chat ? 'checked' : ''}> Chat</label>
      <p class="stream-panel-note">Wird in diesem Browser gemerkt.</p>`;
  };
  const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) { draw(); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); } else close();
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('change', (e) => {
    const key = e.target?.dataset?.pref;
    if (!key) return;
    const p = getStreamPrefs();
    p[key] = e.target.checked;
    setStreamPrefs(p);
    onChange();
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
