import { loadAll } from './data.js';
import { copyText, esc, fmt } from './util.js';
import { startView, commandsView, itemsView, eventsView, weatherView, traitsView, racesView, modsView } from './views.js';
import { initChat, renderSlot, offerSend, handleSlotClick } from './chat.js';

const TABS = [
  { id: 'start', label: 'Start', view: startView },
  { id: 'befehle', label: 'Befehle', view: commandsView, count: (d) => d.commands.list.filter((c) => c.enabled && c.group !== 'mod').length },
  { id: 'items', label: 'Items', view: itemsView, count: (d) => d.items.filter((i) => i.available).length },
  { id: 'events', label: 'Events', view: eventsView, count: (d) => d.events.length },
  { id: 'wetter', label: 'Wetter', view: weatherView, count: (d) => d.weather.length },
  { id: 'traits', label: 'Traits', view: traitsView, count: (d) => d.traits.length },
  { id: 'rassen', label: 'Rassen', view: racesView, count: (d) => d.races.length },
  { id: 'mods', label: 'Mods', view: modsView, count: (d) => d.mods.length },
];

// ---------- Design (hell/dunkel) ----------
const THEME_KEY = 'ys-theme';
// Standard ist das dunkle Blau; nur wer "Hell" wählt, bekommt das helle Design (wird gemerkt).
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const light = t === 'light';
    btn.textContent = light ? 'Dunkel' : 'Hell';
    btn.setAttribute('aria-label', light ? 'Zum dunklen Design wechseln' : 'Zum hellen Design wechseln');
  }
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* egal */ }
  applyTheme(saved);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* egal */ }
    applyTheme(next);
  });
}

// ---------- Start ----------
let DATA = null;

function renderTabs() {
  const cur = currentTab();
  document.getElementById('tabs').innerHTML = TABS.map((t) => {
    const n = DATA && t.count ? `<span class="count">${fmt(t.count(DATA))}</span>` : '';
    return `<a class="tab" role="tab" href="#/${t.id}" aria-selected="${t.id === cur}">${esc(t.label)} ${n}</a>`;
  }).join('');
}

function currentTab() {
  const id = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'start').toLowerCase();
  return TABS.some((t) => t.id === id) ? id : 'start';
}

function renderView() {
  const tab = TABS.find((t) => t.id === currentTab());
  const main = document.getElementById('view');
  renderTabs();
  if (!DATA) { main.innerHTML = '<div class="empty">Lade Daten …</div>'; return; }
  const v = tab.view(DATA);
  main.innerHTML = v.html;
  v.bind(main);
  document.title = (tab.id === 'start' ? 'Yokus Store' : `${tab.label} – Yokus Store`);
  if (!location.hash.split('/')[2]) window.scrollTo({ top: 0 });
}

function showUpdated() {
  const el = document.getElementById('updated');
  const t = DATA?.meta?.updatedAt;
  if (!t) { el.textContent = ''; return; }
  const d = new Date(t);
  if (isNaN(d)) return;
  el.innerHTML = `Stand<br>${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

async function boot() {
  initTheme();

  // Befehl-Knöpfe: kopieren (oder, falls der Zuschauer sich verbunden hat, optional senden)
  document.addEventListener('click', (e) => {
    if (handleSlotClick(e)) return;
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const text = b.dataset.copy;
    if (!offerSend(text)) copyText(text);
  });

  // Nach-oben-Knopf und Tastenkürzel "/" für die Suche
  const top = document.getElementById('to-top');
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => top.classList.toggle('show', window.scrollY > 700), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const s = document.querySelector('#view input.search');
    if (s) { e.preventDefault(); s.focus(); }
  });

  renderTabs();
  renderView();
  window.addEventListener('hashchange', renderView);

  let config = null;
  try { const r = await fetch('data/site-config.json', { cache: 'no-cache' }); if (r.ok) config = await r.json(); } catch { /* optional */ }
  const slot = document.getElementById('chat-slot');
  await initChat(config, () => renderSlot(slot));
  renderSlot(slot);

  DATA = await loadAll();
  showUpdated();
  renderView();
}

boot();
