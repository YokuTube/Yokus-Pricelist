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
  return {
    player: p?.player !== false, chat: p?.chat !== false, collapsed: p?.collapsed === true,
    pos: POS.includes(p?.pos) ? p.pos : null,                 // null = Zuschauer hat nie gewählt → Automatik
    w: Number.isFinite(p?.w) ? p.w : null,
    h: Number.isFinite(p?.h) ? p.h : null,                     // Höhe der Leiste in Lage „Unten“
  };
}

// ---- Position: Oben (Leiste über der Seite) | Unten (feste Leiste am unteren Rand, auch Handy)
//      | Links | Rechts (feste Spalte neben der Seite, nur breite Fenster) ----
const POS = ['top', 'bottom', 'left', 'right'];
const BOT_MIN_H = 160;
const botDefaultVh = () => (window.innerWidth < 700 ? 0.6 : 0.38);   // Handy: Video + Chat übereinander brauchen mehr Höhe
const clampH = (h) => Math.min(Math.floor(window.innerHeight * 0.75), Math.max(BOT_MIN_H, Math.round(h)));
const SIDE_MIN_VIEW = 1200;   // darunter immer Oben
const SIDE_MIN_W = 320, SIDE_DEFAULT_W = 440;
const sideMax = () => Math.max(SIDE_MIN_W, Math.floor(window.innerWidth * 0.5));
const clampW = (w) => Math.min(sideMax(), Math.max(SIDE_MIN_W, Math.round(w)));
function effectivePos(p) {
  if (p.pos === 'bottom') return 'bottom';
  if (window.innerWidth < SIDE_MIN_VIEW) return 'top';
  if (p.pos) return p.pos;
  return window.innerWidth >= 1400 && window.innerWidth / window.innerHeight > 1.34 ? 'right' : 'top';
}

// Nur Klassen und CSS-Variable ändern – die iframes bleiben unberührt.
function applyLayout() {
  const wrap = $('stream-wrap');
  if (!wrap) return;
  const p = getStreamPrefs();
  const pos = effectivePos(p);
  const shown = !wrap.hidden && (p.player || p.chat) && !p.collapsed;
  const side = shown && (pos === 'left' || pos === 'right');
  const bottom = shown && pos === 'bottom';
  const b = document.body;
  b.classList.toggle('stream-bottom', bottom);
  wrap.classList.toggle('bottom-nochat', bottom && !p.chat);
  document.documentElement.style.setProperty('--bot-h', `${clampH(p.h ?? window.innerHeight * botDefaultVh())}px`);
  b.classList.toggle('stream-side', side);
  b.classList.toggle('stream-side-left', side && pos === 'left');
  b.classList.toggle('stream-side-right', side && pos === 'right');
  wrap.classList.toggle('side-nochat', side && !p.chat);
  document.documentElement.style.setProperty('--side-w', `${clampW(p.w ?? SIDE_DEFAULT_W)}px`);
  const rz = $('stream-resizer');
  if (rz) rz.hidden = !(side || bottom);
  const grp = $('stream-pos');
  if (grp) {
    grp.hidden = false;
    const narrow = window.innerWidth < SIDE_MIN_VIEW;   // Links/Rechts nur auf breiten Fenstern
    grp.querySelectorAll('[data-stream-pos]').forEach((btn) => {
      if (btn.dataset.streamPos === 'left' || btn.dataset.streamPos === 'right') btn.hidden = narrow;
      const on = btn.dataset.streamPos === pos;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('active', on);
    });
  }
  // Reiterleiste neu messen (--tabs-h), falls sich die Breite des Inhalts geändert hat
  window.dispatchEvent(new Event('ys-layout'));
}

function initResizer() {
  const rz = $('stream-resizer');
  if (!rz || rz.dataset.bound) return;
  rz.dataset.bound = '1';
  let dragging = false;
  const widthFrom = (x) => (document.body.classList.contains('stream-side-left') ? x : window.innerWidth - x);
  const isBottom = () => document.body.classList.contains('stream-bottom');
  const setH = (h, save) => {
    const v = clampH(h);
    document.documentElement.style.setProperty('--bot-h', `${v}px`);
    if (save) { const p = getStreamPrefs(); p.h = v; setStreamPrefs(p); }
    return v;
  };
  const setW = (w, save) => {
    const v = clampW(w);
    document.documentElement.style.setProperty('--side-w', `${v}px`);
    if (save) { const p = getStreamPrefs(); p.w = v; setStreamPrefs(p); }
    return v;
  };
  rz.addEventListener('pointerdown', (e) => {
    dragging = true; try { rz.setPointerCapture(e.pointerId); } catch { /* egal */ }
    document.body.classList.add('stream-dragging');   // iframes schlucken sonst die Mausbewegung
    e.preventDefault();
  });
  rz.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (isBottom()) setH(window.innerHeight - e.clientY, false); else setW(widthFrom(e.clientX), false);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; document.body.classList.remove('stream-dragging');
    if (isBottom()) setH(window.innerHeight - e.clientY, true); else setW(widthFrom(e.clientX), true);
    window.dispatchEvent(new Event('ys-layout'));
  };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', () => { dragging = false; document.body.classList.remove('stream-dragging'); applyLayout(); });
  rz.addEventListener('dblclick', () => { if (isBottom()) setH(window.innerHeight * botDefaultVh(), true); else setW(SIDE_DEFAULT_W, true); });
  rz.addEventListener('keydown', (e) => {
    if (isBottom()) {
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bot-h'), 10) || 300;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { setH(cur + (e.key === 'ArrowUp' ? 20 : -20), true); e.preventDefault(); }
      return;
    }
    const left = document.body.classList.contains('stream-side-left');
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10) || SIDE_DEFAULT_W;
    const grow = e.key === (left ? 'ArrowRight' : 'ArrowLeft'), shrink = e.key === (left ? 'ArrowLeft' : 'ArrowRight');
    if (grow || shrink) { setW(cur + (grow ? 20 : -20), true); e.preventDefault(); }
  });
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(applyLayout, 60); });
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
  syncInner();
  initResizer();
  applyLayout();
}

function syncInner() {
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
    } else if (t('[data-stream-pos]')) {
      const v = t('[data-stream-pos]').dataset.streamPos;
      update((p) => { p.pos = v; });
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
