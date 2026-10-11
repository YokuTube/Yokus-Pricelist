// Stream-Leiste oben: Twitch-Player und -Chat eingebettet (offizielle Twitch-Einbettung, keine App nötig).
// Die Leiste steht unter den Reitern auf ALLEN Seiten gleich; Reiterwechsel lässt Player und Chat unberührt.
// Zuschauer können Chat und/oder Stream schließen oder die Leiste einklappen (dann läuft der Player klein unten rechts weiter).
// Der Player lädt nie von selbst, erst nach Klick auf „Stream hier ansehen“ (kein doppelter Ton).
//
// Player und Chat liegen in einem festen Behälter (#stream-dock) und werden NIE im DOM verschoben oder neu aufgebaut
// (verschobene iframes laden neu). Alles Weitere geschieht nur über CSS-Klassen.
import { esc } from './util.js';
import { streamAllowed } from './live.js';

export const CHANNEL = 'dasyoku';
const KEY = 'ys-stream';
export const CHAT_POPOUT = `https://www.twitch.tv/popout/${CHANNEL}/chat`;

export function getStreamPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* egal */ }
  return { player: p?.player !== false, chat: p?.chat !== false, collapsed: p?.collapsed === true };
}

function setStreamPrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* egal */ }
}

const parent = () => encodeURIComponent(location.hostname || 'localhost');
const dark = () => document.documentElement.dataset.theme !== 'light';
const playerSrc = () => `https://player.twitch.tv/?channel=${CHANNEL}&parent=${parent()}&autoplay=true`;
const chatSrc = () => `https://www.twitch.tv/embed/${CHANNEL}/chat?parent=${parent()}${dark() ? '&darkpopout' : ''}`;

const $ = (id) => document.getElementById(id);
let playing = false;   // Player läuft (bis „Stream ✕“ oder Stream ausgeschaltet)
let chatLoaded = false;
let bound = false;

// Alte Adresse #/stream: Leiste aufklappen (und wenn alles zu war, beides wieder einschalten).
export function openStreamBar() {
  const p = getStreamPrefs();
  if (!p.player && !p.chat) { p.player = true; p.chat = true; }
  p.collapsed = false;
  setStreamPrefs(p);
  syncStreamDock();
}

// Nach jeder Änderung (Einstellung, Live-Status) aufrufen. Ändert nur Klassen/hidden, lädt nichts neu.
export function syncStreamDock() {
  const wrap = $('stream-wrap'), d = $('stream-dock');
  if (!wrap || !d) return;
  if (!streamAllowed()) {
    // Streamer hat den Stream im Spiel abgeschaltet: Player und Chat ganz entfernen
    playing = false; chatLoaded = false;
    d.innerHTML = ''; delete d.dataset.ready; d.hidden = true; wrap.hidden = true;
    return;
  }
  const p = getStreamPrefs();
  if (!p.player) playing = false;
  wrap.hidden = false;
  if (!(p.player || p.chat)) {
    // Beides geschlossen: schmale Zeile bleibt stehen, damit man es wiederfindet (Nutzerwunsch)
    if (d.dataset.ready) { d.innerHTML = ''; delete d.dataset.ready; }
    chatLoaded = false; d.hidden = true;
    bind(wrap, d);
    wrap.classList.add('collapsed');
    $('stream-toolbar').hidden = true;
    $('stream-strip').hidden = false;
    $('stream-strip').dataset.restore = '1';
    $('stream-strip').querySelector('.stream-strip-text').textContent = '▶ Stream & Chat zeigen';
    return;
  }
  delete $('stream-strip').dataset.restore;
  if (!d.dataset.ready) build(d);
  bind(wrap, d);

  const open = !p.collapsed;
  const player = d.querySelector('.stream-player');
  const chat = d.querySelector('.stream-chat');
  player.hidden = !p.player || (!open && !playing);
  chat.hidden = !p.chat || !open;
  if (p.chat && !chatLoaded) {
    chatLoaded = true;
    chat.querySelector('.stream-chat-frame').innerHTML = `<iframe src="${esc(chatSrc())}" title="Twitch-Chat von ${CHANNEL}"></iframe>`;
  }
  if (!p.chat && chatLoaded) { chatLoaded = false; chat.querySelector('.stream-chat-frame').innerHTML = ''; }
  if (!playing && !player.querySelector('.stream-start')) player.querySelector('.stream-frame').innerHTML = startButton();

  d.classList.toggle('mini', !open && playing);
  d.classList.toggle('has-player', p.player);
  d.classList.toggle('has-chat', p.chat);
  d.hidden = open ? false : !playing;
  wrap.classList.toggle('collapsed', !open);

  $('stream-toolbar').hidden = !open;
  $('stream-strip').hidden = open;
  $('stream-strip').querySelector('.stream-strip-text').innerHTML =
    playing ? '<i class="stream-dot" aria-hidden="true"></i>Stream läuft – aufklappen' : 'Stream – aufklappen';
  // Umschalter: geschlossenes lässt sich direkt in der Leiste wieder zeigen
  const cb = wrap.querySelector('[data-stream-chat-close]'), pb = wrap.querySelector('[data-stream-player-close]');
  cb.textContent = p.chat ? 'Chat ✕' : 'Chat zeigen'; cb.title = p.chat ? 'Chat schließen' : 'Chat wieder zeigen';
  pb.textContent = p.player ? 'Stream ✕' : 'Stream zeigen'; pb.title = p.player ? 'Stream schließen' : 'Stream wieder zeigen';
  cb.classList.toggle('off', !p.chat); pb.classList.toggle('off', !p.player);
  wrap.querySelector('.stream-popout').hidden = !p.chat;
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
        <button type="button" class="stream-mini-btn" data-stream-expand title="Leiste aufklappen" aria-label="Leiste aufklappen">Groß</button>
        <button type="button" class="stream-mini-btn" data-stream-stop title="Stream beenden" aria-label="Stream beenden">✕</button>
      </div>
    </div>
    <div class="stream-chat">
      <div class="stream-chat-frame"></div>
    </div>`;
}

function bind(wrap, d) {
  if (bound) return; // Klick-Handler nur einmal, auch wenn der Inhalt neu aufgebaut wird
  bound = true;
  const update = (fn) => { const p = getStreamPrefs(); fn(p); setStreamPrefs(p); syncStreamDock(); };
  wrap.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-stream-start]')) {
      playing = true;
      d.querySelector('.stream-frame').innerHTML =
        `<iframe src="${esc(playerSrc())}" title="Stream von ${CHANNEL}" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
      syncStreamDock();
    } else if (t('[data-stream-stop]')) {
      playing = false; syncStreamDock();
    } else if (t('[data-stream-player-close]')) {
      update((p) => { p.player = !p.player; });
    } else if (t('[data-stream-chat-close]')) {
      update((p) => { p.chat = !p.chat; });
    } else if (t('[data-stream-collapse]')) {
      update((p) => { p.collapsed = true; });
    } else if (t('#stream-strip') && $('stream-strip').dataset.restore) {
      update((p) => { p.player = true; p.chat = true; p.collapsed = false; });
    } else if (t('[data-stream-expand]') || t('#stream-strip')) {
      update((p) => { p.collapsed = false; });
    }
  });
}

// Kleines Einstellungsfeld am Knopf „Stream“ im Kopf. onChange zeichnet die Leiste neu.
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
    if (e.target.checked) p.collapsed = false;
    setStreamPrefs(p);
    onChange();
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
