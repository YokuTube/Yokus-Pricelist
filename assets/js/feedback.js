// Feedback von Zuschauern (Fehler/Ideen) -> POST /api/feedback der Mod RICS Live.
// Eingaben werden nur per textContent/value angezeigt, nie als HTML. Geht nur, solange die Live-Mod online ist.
import * as live from './live.js';
import { toast } from './util.js';

const KINDS = [
  ['bug', '🐞', 'Fehler'],
  ['idea', '💡', 'Idee'],
  ['other', '💬', 'Sonstiges'],
];
const MAX = 1000, MIN = 3;
let panel = null;
let opener = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function close() {
  if (!panel) return;
  panel.remove(); panel = null;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
  try { opener?.focus(); } catch { /* egal */ }
}
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Nie ueber Stream/Chat legen (Twitch sperrt den Chat bei Ueberdeckung): freie Ecke suchen.
function place() {
  if (!panel) return;
  const w = Math.min(panel.offsetWidth || 360, innerWidth - 24), h = panel.offsetHeight || 340;
  const taken = ['stream-wrap'].map((id) => document.getElementById(id))
    .filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const m = 12;
  const spots = [[innerWidth - w - m, innerHeight - h - m], [m, innerHeight - h - m], [innerWidth - w - m, 64], [m, 64], [(innerWidth - w) / 2, (innerHeight - h) / 2]];
  let pick = spots[0];
  for (const [x, y] of spots) {
    const r = { left: x, top: Math.max(m, y), right: x + w, bottom: Math.max(m, y) + h };
    if (!taken.some((t) => overlaps(r, t))) { pick = [x, y]; break; }
  }
  panel.style.left = Math.max(m, pick[0]) + 'px';
  panel.style.top = Math.max(m, pick[1]) + 'px';
}

function open(from) {
  if (panel) { close(); return; }
  opener = from || null;
  panel = el('div', 'fb-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Feedback');
  const head = el('div', 'fb-head');
  head.append(el('strong', '', '💬 Feedback'));
  const x = el('button', 'fb-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Schließen'); x.onclick = close;
  head.append(x);
  panel.append(head);

  if (!live.isLive()) {
    panel.append(el('p', 'fb-note', 'Feedback geht, solange der Stream mit Spiel läuft.'));
    document.body.append(panel);
  } else {
    let cat = 'bug';
    const kinds = el('div', 'fb-kinds'); kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Art');
    const btns = KINDS.map(([id, sym, label]) => {
      const b = el('button', 'fb-kind'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      b.append(el('span', 'fb-sym', sym), el('span', 'fb-lbl', label));
      b.onclick = () => { cat = id; sync(); };
      kinds.append(b); return [id, b];
    });
    const sync = () => btns.forEach(([id, b]) => { b.setAttribute('aria-pressed', String(id === cat)); b.classList.toggle('on', id === cat); });
    sync();
    const ta = el('textarea', 'fb-text'); ta.maxLength = MAX; ta.rows = 5; ta.placeholder = 'Was ist dir aufgefallen? Was wünschst du dir?';
    ta.setAttribute('aria-label', 'Dein Feedback');
    const count = el('span', 'fb-count', '0/' + MAX);
    const page = location.hash.slice(0, 200);
    const info = el('div', 'fb-info');
    info.append(el('span', 'fb-page', 'Seite: ' + (page || '#/')), count);
    const hint = el('p', 'fb-hint', 'Bitte keine persönlichen Daten.');
    const msg = el('p', 'fb-msg'); msg.setAttribute('role', 'status');
    const send = el('button', 'fb-send', 'Absenden'); send.type = 'button'; send.disabled = true;
    const check = () => { count.textContent = ta.value.length + '/' + MAX; send.disabled = ta.value.trim().length < MIN; };
    ta.addEventListener('input', check);
    send.onclick = async () => {
      send.disabled = true; msg.textContent = 'Sende …'; msg.className = 'fb-msg';
      try {
        await live.sendFeedback(cat, ta.value, page);
        close(); toast('Danke! 💛', 2600);
      } catch (e) {
        msg.textContent = e.message; msg.className = 'fb-msg bad'; check();
      }
    };
    panel.append(kinds, ta, info, hint, msg, send);
    document.body.append(panel);
    ta.focus();
  }
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  place();
}

export function initFeedback() {
  document.querySelectorAll('[data-feedback]').forEach((b) => b.addEventListener('click', () => open(b)));
  // Live-Zustand aendert sich (online/offline): offenes Fenster neu aufbauen
  live.on('change', () => { if (panel) { const o = opener; close(); open(o); } });
}
