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
    player: p?.player !== false, chat: p?.chat !== false,
    // Handy (< 700 px), noch keine eigene Wahl: Stream & Chat zunächst eingeklappt
    collapsed: typeof p?.collapsed === 'boolean' ? p.collapsed : window.innerWidth < 700,
    pos: POS.includes(p?.pos) ? p.pos : null,                 // null = Zuschauer hat nie gewählt → Automatik
    w: Number.isFinite(p?.w) ? p.w : null,
    h: Number.isFinite(p?.h) ? p.h : null,                     // Höhe der Leiste in Lage „Unten“
    chatSide: ['below', 'left', 'right'].includes(p?.chatSide) ? p.chatSide : 'below',
    cw: Number.isFinite(p?.cw) ? p.cw : null,                   // Chat-Breite, wenn er neben dem Video steht   // Seitenlage: Chat unter/neben dem Video
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
const CHAT_W = 340, CHAT_MIN_W = 260;   // Chat-Spalte, wenn der Chat neben dem Video steht (volle Höhe, ziehbar)
const clampCW = (w) => Math.min(Math.max(CHAT_MIN_W, Math.floor(window.innerWidth * 0.4)), Math.max(CHAT_MIN_W, Math.round(w)));
const chatW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w'), 10) || CHAT_W;
const besideNow = () => document.body.classList.contains('stream-beside');
const sideMax = () => Math.max(SIDE_MIN_W, Math.floor(window.innerWidth * (besideNow() ? 0.62 : 0.5)) - (besideNow() ? chatW() : 0));
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
  document.documentElement.classList.toggle('stream-side-scroll', side && window.innerWidth >= SIDE_MIN_VIEW);
  b.classList.toggle('stream-side-left', side && pos === 'left');
  b.classList.toggle('stream-side-right', side && pos === 'right');
  wrap.classList.toggle('side-nochat', side && !p.chat);
  // Chat neben dem Video (volle Höhe): Video kann wachsen, ohne dass der Chat schrumpft
  const beside = side && p.chat && p.player && p.chatSide !== 'below';
  b.classList.toggle('stream-beside', beside);
  b.classList.toggle('stream-chat-left', beside && p.chatSide === 'left');
  b.classList.toggle('stream-chat-right', beside && p.chatSide === 'right');
  document.documentElement.style.setProperty('--chat-w', `${clampCW(p.cw ?? CHAT_W)}px`);
  const crz = $('stream-chat-resizer');
  if (crz) crz.hidden = !beside;
  document.documentElement.style.setProperty('--side-w', `${clampW(p.w ?? SIDE_DEFAULT_W)}px`);
  const cg = $('stream-chatside');
  if (cg) {
    cg.hidden = !(side && p.chat && p.player);
    cg.querySelectorAll('[data-stream-chatside]').forEach((btn) => {
      const on = btn.dataset.streamChatside === p.chatSide;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('active', on);
    });
  }
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

// Zweiter Griff auf der Grenze Video|Chat: nur die Chat-Breite ändern
function initChatResizer() {
  const wrap = $('stream-wrap');
  if (!wrap || $('stream-chat-resizer')) return;
  const rz = document.createElement('div');
  rz.id = 'stream-chat-resizer'; rz.className = 'stream-chat-resizer'; rz.hidden = true;
  rz.setAttribute('role', 'separator'); rz.setAttribute('aria-orientation', 'vertical'); rz.tabIndex = 0;
  rz.setAttribute('aria-label', 'Breite des Chats ändern'); rz.title = 'Ziehen: Chat breiter/schmaler (Doppelklick: zurücksetzen)';
  wrap.appendChild(rz);   // im Behälter, aber außerhalb des Docks – die iframes bleiben unberührt
  let dragging = false;
  const fromX = (x) => {
    const b = wrap.getBoundingClientRect();
    return document.body.classList.contains('stream-chat-left') ? x - b.left - 8 : b.right - x - 8;
  };
  // Gesamtbreite der Spalte bleibt gleich (die Seite daneben ändert sich nicht): Chat breiter = Video schmaler
  const VIDEO_MIN_W = SIDE_MIN_W;   // gleiche Untergrenze wie applyLayout (clampW), sonst springt die Breite zurück
  const curSide = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10) || SIDE_DEFAULT_W;
  let total = 0;
  const setCW = (w, save) => {
    if (!total) total = curSide() + chatW();
    const v = Math.min(total - VIDEO_MIN_W, clampCW(w));
    const side = total - v;
    document.documentElement.style.setProperty('--chat-w', `${v}px`);
    document.documentElement.style.setProperty('--side-w', `${side}px`);
    if (save) { const p = getStreamPrefs(); p.cw = v; p.w = side; setStreamPrefs(p); total = 0; }
  };
  rz.addEventListener('pointerdown', (e) => {
    dragging = true; try { rz.setPointerCapture(e.pointerId); } catch { /* egal */ }
    document.body.classList.add('stream-dragging'); e.preventDefault();
  });
  rz.addEventListener('pointermove', (e) => { if (dragging) setCW(fromX(e.clientX), false); });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; document.body.classList.remove('stream-dragging');
    setCW(fromX(e.clientX), true); applyLayout();
  };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', () => { dragging = false; document.body.classList.remove('stream-dragging'); applyLayout(); });
  rz.addEventListener('dblclick', () => { setCW(CHAT_W, true); applyLayout(); });
  rz.addEventListener('keydown', (e) => {
    const left = document.body.classList.contains('stream-chat-left');
    const grow = e.key === (left ? 'ArrowRight' : 'ArrowLeft'), shrink = e.key === (left ? 'ArrowLeft' : 'ArrowRight');
    if (grow || shrink) { setCW(chatW() + (grow ? 20 : -20), true); applyLayout(); e.preventDefault(); }
  });
}

function initResizer() {
  const rz = $('stream-resizer');
  if (!rz || rz.dataset.bound) return;
  rz.dataset.bound = '1';
  let dragging = false;
  const widthFrom = (x) => (document.body.classList.contains('stream-side-left') ? x : window.innerWidth - x) - (besideNow() ? chatW() : 0);
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
  initChatResizer();
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
    } else if (t('[data-stream-chatside]')) {
      const v = t('[data-stream-chatside]').dataset.streamChatside;
      update((p) => { p.chatSide = v; });
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
