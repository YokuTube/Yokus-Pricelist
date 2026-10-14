import { loadAll } from './data.js';
import { copyText, esc, fmt, scrollPageTo, scrollTopNow } from './util.js';
import { startView, commandsView, itemsView, eventsView, weatherView, traitsView, racesView, modsView } from './views.js';
import { icon } from './icons.js';
import { initChat, renderSlot, offerSend, handleSlotClick } from './chat.js';
import * as live from './live.js';
import { setIcons, fillAll as fillPics } from './pics.js';
import { setEventIndex } from './event-pics.js';
import { initLiveUi, setLiveData, offerLive, ichView, kolonieView, spielView, ereignisseView, gedenkenView } from './live-views.js';
import { initStreamSettings, syncStreamDock, openStreamBar } from './stream.js';
import { initCooldowns, setCooldownData } from './cooldowns.js';
import { initFeedback } from './feedback.js';
import { showView, initShow, isShowMode, onShowChange } from './show.js';

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

// Zusätzliche Tabs, nur sichtbar, solange die Live-Schnittstelle (RICS Live) erreichbar ist.
const LIVE_TABS = [
  { id: 'ich', label: 'Ich', view: ichView },
  { id: 'kolonie', label: 'Kolonie', view: kolonieView },
  { id: 'spiel', label: 'Spiel', view: spielView },
  { id: 'ereignisse', label: 'Ereignisse', view: ereignisseView },
  { id: 'gedenken', label: 'Gedenken', view: gedenkenView },
];
// Show-Modus (Mod Wildshow läuft, Show-Spielstand): eigener Reiter „Show“, Einkaufs- und Preislisten-Reiter fallen weg.
const SHOW_TAB = { id: 'show', label: 'Show', view: showView };
const SHOW_HIDDEN = ['items', 'events', 'wetter', 'traits', 'rassen', 'mods', 'spiel'];
const LIVE_IDS = [...LIVE_TABS.map((t) => t.id), SHOW_TAB.id];
// Der Stream ist kein Reiter mehr, sondern eine Leiste oben (stream.js).
const tabList = () => {
  if (!live.isLive()) return [...TABS];
  if (isShowMode()) return [TABS[0], SHOW_TAB, ...LIVE_TABS.filter((t) => !SHOW_HIDDEN.includes(t.id)), ...TABS.slice(1).filter((t) => !SHOW_HIDDEN.includes(t.id))];
  return [TABS[0], ...LIVE_TABS, ...TABS.slice(1)];
};

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
let shownTab = 'start';
let renderedHash = null;   // Adresse der zuletzt gezeichneten Ansicht

function renderTabs() {
  const cur = currentTab();
  document.getElementById('tabs').innerHTML = tabList().map((t) => {
    const n = DATA && t.count ? `<span class="count">${fmt(t.count(DATA))}</span>` : '';
    return `<a class="tab" role="tab" href="#/${t.id}" title="${esc(t.label)}" aria-selected="${t.id === cur}">${icon(t.id)}<span>${esc(t.label)}</span> ${n}</a>`;
  }).join('');
  // Handy: aktiven Reiter ins Bild holen und zeigen, ob links/rechts noch mehr kommt
  const nav = document.getElementById('tabs');
  nav.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTabFade();
  setTabsH();
}

function setTabsH() {
  const tb = document.querySelector('.tabs-bar');
  if (tb) document.documentElement.style.setProperty('--tabs-h', `${tb.offsetHeight}px`);
}

function updateTabFade() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  nav.classList.toggle('more-left', nav.scrollLeft > 4);
  nav.classList.toggle('more-right', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
}

function currentTab() {
  const id = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'start').toLowerCase();
  return tabList().some((t) => t.id === id) ? id : 'start';
}

function renderView() {
  let rawId = location.hash.replace(/^#\/?/, '').split('/')[0].toLowerCase();
  if (rawId === 'stream') {
    // Alte Adresse des früheren Stream-Reiters: auf Start, Leiste aufklappen
    history.replaceState(null, '', '#/start');
    rawId = 'start';
    openStreamBar();
  }
  if (LIVE_IDS.includes(rawId) && !live.isLive() && !live.isSettled()) {
    // Live-Status noch unbekannt: gewünschte Ansicht abwarten statt auf Start umzubiegen.
    renderTabs();
    document.getElementById('view').innerHTML = '<div class="empty">Lade …</div>';
    return;
  }
  const tab = tabList().find((t) => t.id === currentTab());
  shownTab = tab.id;
  syncStreamDock();
  const main = document.getElementById('view');
  renderTabs();
  if (!DATA) { main.innerHTML = '<div class="empty">Lade Daten …</div>'; return; }
  setIcons(DATA.icons); setEventIndex(DATA.events, DATA.weather);
  try {
    const v = tab.view(DATA);
    main.innerHTML = v.html;
    v.bind(main);
  } catch (err) {
    console.warn('Ansicht', tab.id, err);
    main.innerHTML = '<div class="empty">Diese Ansicht ist gerade nicht verfügbar.</div>';
  }
  fillPics(main);
  document.title = (tab.id === 'start' ? 'Yokus Store' : `${tab.label} – Yokus Store`);
  // Nur bei echtem Wechsel der Adresse nach oben; ein Neuzeichnen derselben Ansicht (z. B. Live an/aus) behält die Scrollposition
  if (renderedHash !== location.hash && !location.hash.split('/')[2]) scrollPageTo({ top: 0 });
  renderedHash = location.hash;
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
    if (offerLive(text)) return;          // verknüpft + live: Auslösen anbieten
    if (!offerSend(text)) copyText(text);
  });

  // Nach-oben-Knopf und Tastenkürzel "/" für die Suche
  const top = document.getElementById('to-top');
  top.addEventListener('click', () => scrollPageTo({ top: 0, behavior: 'smooth' }));
  document.addEventListener('scroll', () => top.classList.toggle('show', scrollTopNow() > 700), { passive: true, capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const s = document.querySelector('#view input.search');
    if (s) { e.preventDefault(); s.focus(); }
  });

  // Höhe der klebenden Reiterleiste merken, damit die Stream-Leiste direkt darunter kleben kann
  const tb = document.querySelector('.tabs-bar');
  if (window.ResizeObserver) new ResizeObserver(setTabsH).observe(tb);
  window.addEventListener('resize', setTabsH);
  window.addEventListener('ys-layout', setTabsH);
  setTabsH();

  renderTabs();
  renderView();
  window.addEventListener('hashchange', renderView);
  document.getElementById('tabs').addEventListener('scroll', updateTabFade, { passive: true });
  window.addEventListener('resize', updateTabFade);

  // RICS Live: im Hintergrund suchen, die Seite wartet nicht darauf.
  initLiveUi();
  initCooldowns();
  initFeedback();
  live.on('change', () => {
    const wanted = location.hash.replace(/^#\/?/, '').split('/')[0].toLowerCase();
    // Nur neu zeichnen, wenn eine Live-Ansicht betroffen ist - sonst gehen z. B. Sucheingaben nicht verloren.
    if (LIVE_IDS.includes(wanted) || LIVE_IDS.includes(shownTab)) renderView(); else { renderTabs(); syncStreamDock(); }
  });
  live.initLive();
  initShow();
  onShowChange(() => { renderTabs(); syncStreamDock(); renderView(); });
  initStreamSettings(() => syncStreamDock());

  let config = null;
  try { const r = await fetch('data/site-config.json', { cache: 'no-cache' }); if (r.ok) config = await r.json(); } catch { /* optional */ }
  const slot = document.getElementById('chat-slot');
  await initChat(config, () => renderSlot(slot));
  renderSlot(slot);

  DATA = await loadAll();
  setLiveData(DATA);
  setCooldownData(DATA);
  showUpdated();
  renderView();
}

boot();
