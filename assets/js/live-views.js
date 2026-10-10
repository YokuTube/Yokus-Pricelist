// RICS Live – Oberfläche: Live-Leiste, Verbinden-Dialog, Kauf-Dialog, Tabs „Ich“ und „Kolonie“, Charakter-Ansicht.
// Alle Texte aus der Schnittstelle sind Zuschauernamen/Spielinhalte und werden mit esc() entschärft.
import { esc, fmt, copyText, toast, cmdBtn } from './util.js';
import * as live from './live.js';
import { CHAT_POPOUT as CHAT_URL } from './stream.js';

let DATA = null;
/** Preislisten-Daten (für die Preisanzeige im Kauf-Dialog). */
export const setLiveData = (d) => { DATA = d; };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, Number(n) || 0));
const tone = (p) => (p >= 60 ? 'good' : p >= 30 ? 'mid' : 'low');
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function bar(pct, tn) {
  const p = clamp(pct);
  return `<span class="lbar ${tn || tone(p)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"><i style="width:${p}%"></i></span>`;
}
function barRow(label, pct, text, tn, cls = '') {
  return `<div class="brow ${cls}"><span class="bl">${esc(label)}</span>${bar(pct, tn)}<span class="bv">${esc(text ?? Math.round(clamp(pct)) + ' %')}</span></div>`;
}

// =====================================================================
// Münzen mit Animation
// =====================================================================
const coinsHtml = (v) =>
  `<span class="coins-box"><span class="coin-ico" aria-hidden="true">🪙</span><b data-live-coins data-v="${Number(v) || 0}">${fmt(v)}</b></span>`;

function animateNumber(el, from, to) {
  el.dataset.v = to;
  const token = (el._anim = {});
  const box = el.parentElement;
  if (reduceMotion()) el.textContent = fmt(to);
  else {
    const t0 = performance.now();
    const step = (t) => {
      if (el._anim !== token) return;
      const k = Math.min(1, (t - t0) / 700);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  if (!box) return;
  const b = document.createElement('span');
  const up = to > from;
  b.className = 'coin-delta ' + (up ? 'up' : 'down');
  b.textContent = (up ? '+' : '−') + fmt(Math.abs(to - from));
  box.appendChild(b);
  box.classList.remove('flash-up', 'flash-down');
  void box.offsetWidth;
  box.classList.add(up ? 'flash-up' : 'flash-down');
  setTimeout(() => { b.remove(); box.classList.remove('flash-up', 'flash-down'); }, 1600);
}

function updateCoins(value) {
  const to = Number(value) || 0;
  document.querySelectorAll('[data-live-coins]').forEach((el) => {
    const from = Number(el.dataset.v);
    if (Number.isNaN(from)) { el.dataset.v = to; el.textContent = fmt(to); return; }
    if (from !== to) animateNumber(el, from, to);
  });
}

// =====================================================================
// Kleine Dialog-Helfer
// =====================================================================
function makeDialog(html) {
  const d = document.createElement('dialog');
  d.className = 'live-dialog';
  d.innerHTML = `<div class="ld-body">${html}</div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.showModal();
  return d;
}

// =====================================================================
// Verbinden-Dialog
// =====================================================================
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function openLinkDialog() {
  const d = makeDialog(`
    <h3>Mit Twitch verbinden</h3>
    <div id="ld-main" class="ld-main"><p class="muted">Code wird geholt …</p></div>
    <div class="ld-actions"><button type="button" class="btn" data-close>Schließen</button></div>`);
  const main = d.querySelector('#ld-main');
  let alive = true, pollTimer = null, clock = null;
  d.addEventListener('close', () => { alive = false; clearTimeout(pollTimer); clearInterval(clock); });

  const showError = (msg) => {
    main.innerHTML = `<p class="ld-err">${esc(msg)}</p><button type="button" class="btn primary" data-retry>Neuen Code holen</button>`;
    main.querySelector('[data-retry]').addEventListener('click', start);
  };

  async function start() {
    clearTimeout(pollTimer); clearInterval(clock);
    main.innerHTML = '<p class="muted">Code wird geholt …</p>';
    let r;
    try { r = await live.startLink(); } catch (e) { if (alive) showError(e.message === 'net' ? 'Keine Verbindung zum Spiel.' : e.message); return; }
    if (!alive) return;
    const cmd = `${live.prefix()}link ${r.code}`;
    const until = Date.now() + (Number(r.expiresInSec) || 300) * 1000;
    main.innerHTML = `
      <p class="ld-lead">Schreib im Twitch-Chat:</p>
      <div class="ld-code"><code>${esc(cmd)}</code></div>
      <div class="ld-row">
        <button type="button" class="btn primary" data-copy-code>Kopieren</button>
        <a class="btn" href="${CHAT_URL}" target="_blank" rel="noopener">Chat öffnen ↗</a>
      </div>
      <p class="small muted ld-wait"><span class="ld-spin" aria-hidden="true"></span>Warte auf deine Nachricht … noch <b id="ld-left">${mmss(Math.round((until - Date.now()) / 1000))}</b> gültig</p>`;
    main.querySelector('[data-copy-code]').addEventListener('click', () => copyText(cmd));
    const left = main.querySelector('#ld-left');
    clock = setInterval(() => { if (left) left.textContent = mmss(Math.max(0, Math.round((until - Date.now()) / 1000))); }, 1000);
    let errs = 0;
    const tick = async () => {
      if (!alive) return;
      try {
        const s = await live.pollLink(r.pendingId);
        if (!alive) return;
        errs = 0;
        if (s.state === 'done') {
          clearInterval(clock);
          toast(`Verbunden als ${s.displayName || s.user}`);
          d.close();
          return;
        }
        if (s.state === 'expired') { clearInterval(clock); showError('Der Code ist abgelaufen.'); return; }
      } catch {
        if (++errs >= 5) { clearInterval(clock); showError('Keine Verbindung zum Spiel.'); return; }
      }
      pollTimer = setTimeout(tick, 2000);
    };
    pollTimer = setTimeout(tick, 2000);
  }
  start();
}

// =====================================================================
// Kaufen per Knopf
// =====================================================================
const ARGS_OK = /^[\p{L}\p{N} _\-.'#]*$/u;
const normName = (s) => s.toLowerCase().trim().replace(/\s+/g, '_');

/** Befehlstext → { cmd, args } – nur wenn per Knopf erlaubt und vollständig. */
function parseCommand(text) {
  const pre = live.prefix();
  const t = String(text || '').trim();
  if (!t.startsWith(pre)) return null;
  const rest = t.slice(pre.length).trim();
  const cmd = rest.split(/\s+/)[0].toLowerCase();
  if (!cmd || !live.isAllowed(cmd)) return null;
  const args = rest.slice(cmd.length).trim().replace(/\s+/g, ' ');
  if (args.length > 80 || !ARGS_OK.test(args)) return null;   // z. B. Platzhalter in < >: bleibt beim Kopieren
  return { cmd, args };
}

/** Preis nur, wenn eindeutig zuordenbar – sonst null. */
function priceOf({ cmd, args }) {
  if (!DATA) return null;
  if (cmd === 'buy' || cmd === 'use' || cmd === 'equip' || cmd === 'wear' || cmd === 'backpack') {
    const tok = args.split(' ').filter(Boolean);
    let qty = 1;
    if (tok.length > 1 && /^\d{1,6}$/.test(tok[tok.length - 1])) qty = Number(tok.pop());
    const name = normName(tok.join(' '));
    const hit = DATA.items.filter((i) => i.cmdName === name || i.defName.toLowerCase() === name);
    return hit.length === 1 ? { price: hit[0].price * qty, label: qty > 1 ? `${hit[0].name} ×${fmt(qty)}` : hit[0].name } : null;
  }
  if (cmd === 'event' || cmd === 'weather') {
    const list = cmd === 'event' ? DATA.events : DATA.weather;
    const name = normName(args);
    const hit = list.filter((x) => x.cmdName === name || x.defName.toLowerCase() === name);
    return hit.length === 1 ? { price: hit[0].cost, label: hit[0].de || hit[0].label } : null;
  }
  return null;
}

const VERBS = { buy: 'Sofort kaufen', use: 'Sofort benutzen', equip: 'Sofort ausrüsten', wear: 'Sofort anziehen', backpack: 'Ins Gepäck',
  event: 'Sofort auslösen', weather: 'Sofort auslösen', raid: 'Sofort auslösen', militaryaid: 'Sofort auslösen' };

/** Früher: Dialog beim Antippen. Jetzt gibt es eigene Knöpfe „Sofort kaufen/auslösen“ – Antippen kopiert immer. */
export function offerLive() { return false; }

function buyLabel(p) {
  const pr = priceOf(p);
  const verb = VERBS[p.cmd] || 'Sofort ausführen';
  return { verb, price: pr?.price ?? null };
}

async function buyNow(btn) {
  const src = btn.previousElementSibling?.matches?.('[data-copy]') ? btn.previousElementSibling.dataset.copy : btn.dataset.liveBuy;
  const p = parseCommand(src);
  if (!p || btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span>Läuft …</span>';
  try {
    const msgs = await live.act(p.cmd, p.args);
    toast(msgs.length ? msgs.join(' · ') : 'An RICS übergeben – Antwort im Chat', 7000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.innerHTML = old;
    btn.disabled = false;
    markBuyable();
  }
}

const coinsHtmlStatic = (v) => `<span class="coin-ico" aria-hidden="true">🪙</span> ${fmt(v)} Münzen`;

// =====================================================================
// Live-Leiste im Kopf
// =====================================================================
let strip = null;
let stripName = null;
let barGame = null, barPawns = null, barPolling = false;

const MOOD_TONE = (p) => (p.state === 'downed' || p.state === 'mental' ? 'low' : tone(p.moodPct ?? p.healthPct ?? 100));

function gameChipsHtml(g) {
  if (!g) return '';
  const chips = [
    `Tag ${fmt(g.day)}`,
    g.hour != null ? `${g.hour} Uhr` : null,
    g.season || null,
    [g.weather, g.temperature].filter(Boolean).join(' '),
  ].filter(Boolean);
  const alarm = (g.conditions || []).slice(0, 2).map((c) => `<span class="lg-alarm" title="${esc(c.desc || '')}">${esc(c.label)}</span>`).join('');
  return `<a class="live-game" href="#/spiel" title="Mehr zum Spiel">${chips.map((c, i) => `<span class="lg-chip${i > 1 ? ' lg-opt' : ''}">${esc(c)}</span>`).join('')}${alarm}</a>`;
}

function pawnBarHtml(list) {
  if (!list?.length) return '';
  const me = live.getMe()?.user;
  return list.map((p) => {
    const mine = p.user && p.user === me;
    const mood = p.moodPct == null ? null : Math.round(p.moodPct);
    const ini = esc((p.name || '?').charAt(0).toUpperCase());
    const img = p.portrait
      ? `<img src="${esc(live.portraitUrl(p.id || p.user, p.portrait))}" alt="" width="40" height="40" data-portrait data-initial="${ini}" class="portrait">`
      : `<div class="portrait ph" aria-hidden="true">${ini}</div>`;
    const st = p.state && p.state !== 'ok' ? `<i class="lp-state ${STATE_BADGE[p.state] || 'neutral'}" title="${esc(p.stateLabel || '')}"></i>` : '';
    return `<a class="lp${mine ? ' mine' : ''}${p.user ? ' viewer' : ''}" href="#/kolonie/${encodeURIComponent(p.id || p.user)}"
        title="${esc(p.name)}${p.user ? ' (@' + esc(p.displayName || p.user) + ')' : ''} – ${esc(p.stateLabel || '')}${mood != null ? ' · Stimmung ' + mood + ' %' : ''}">
      <span class="lp-pic">${img}${st}</span>
      <span class="lp-mood ${MOOD_TONE(p)}"><i style="width:${clamp(mood ?? 0)}%"></i></span>
      <span class="lp-name">${esc(p.name)}</span>
    </a>`;
  }).join('');
}

function fillBar() {
  const g = strip?.querySelector('#live-game-slot');
  if (g) g.innerHTML = gameChipsHtml(barGame);
  const pw = strip?.querySelector('#live-pawns');
  if (pw) { pw.innerHTML = pawnBarHtml(barPawns); pw.hidden = !barPawns?.length; }
}

function startBarPolling() {
  if (barPolling || !live.isLive()) return;
  barPolling = true;
  const alive = () => { const ok = live.isLive(); if (!ok) barPolling = false; return ok; };
  live.poll({ path: '/api/game', every: 10000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barGame = r.data; fillBar(); } } });
  live.poll({ path: '/api/colony', every: 5000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barPawns = r.data?.pawns || []; fillBar(); } } });
}

function renderStrip() {
  if (!strip) return;
  if (!live.isLive()) { strip.hidden = true; strip.innerHTML = ''; stripName = null; barPolling = false; barGame = null; barPawns = null; return; }
  const st = live.getStatus();
  const me = live.getMe();
  stripName = me?.displayName || null;
  let right;
  if (!live.isLinked()) right = '<button type="button" class="btn live-connect" data-live="connect">Verbinden</button>';
  else if (!me) right = '<span class="small muted">Verbunden …</span>';
  else right = `<a class="live-me" href="#/ich" title="Zu deiner Seite"><span class="live-name">${esc(me.displayName || me.user)}</span>${coinsHtml(me.coins)}</a>`;
  strip.hidden = false;
  strip.innerHTML = `<div class="wrap live-in">
    <span class="live-badge" title="Der Stream läuft – die Seite ist mit dem Spiel verbunden"><i aria-hidden="true"></i>LIVE</span>
    ${st?.colony ? `<span class="live-colony">${esc(st.colony)}</span>` : ''}
    <span id="live-game-slot" class="live-game-slot"></span>
    <span class="live-sp"></span>${right}</div>
    <div class="wrap"><nav class="live-pawns" id="live-pawns" aria-label="Kolonisten" hidden></nav></div>`;
  fillBar();
  startBarPolling();
}

/** Neben jeden per Knopf erlaubten Befehl einen Knopf „Sofort kaufen/auslösen“ setzen (nur live + verknüpft). */
function markBuyable() {
  const on = live.isLinked() && live.isLive();
  const coins = live.getMe()?.coins;
  document.querySelectorAll('#view [data-copy]').forEach((b) => {
    const p = on ? parseCommand(b.dataset.copy) : null;
    let nb = b.nextElementSibling?.matches?.('[data-live-buy]') ? b.nextElementSibling : null;
    if (!p) { nb?.remove(); return; }
    const { verb, price } = buyLabel(p);
    const poor = price != null && coins != null && price > coins;
    const html = `<span class="buy-ico" aria-hidden="true">⚡</span><span>${verb}</span>${price != null ? `<span class="buy-price">${fmt(price)}</span>` : ''}`;
    if (!nb) {
      nb = document.createElement('button');
      nb.type = 'button';
      nb.className = 'buy-now';
      b.after(nb);
    }
    if (nb.dataset.liveBuy !== b.dataset.copy || nb.dataset.html !== html) {
      nb.dataset.liveBuy = b.dataset.copy;
      nb.dataset.html = html;
      if (!nb.disabled || !nb.textContent.includes('Läuft')) nb.innerHTML = html;
    }
    nb.classList.toggle('poor', poor);
    nb.title = poor ? 'Dafür reichen deine Münzen gerade nicht' : `${b.dataset.copy} sofort ausführen`;
  });
  document.querySelectorAll('#view [data-live-buy]').forEach((nb) => {
    if (!on || !nb.previousElementSibling?.matches?.('[data-copy]')) nb.remove();
  });
}

export function initLiveUi() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  strip = document.createElement('div');
  strip.className = 'live-strip';
  strip.hidden = true;
  header.appendChild(strip);

  live.on('change', () => { renderStrip(); markBuyable(); });
  const viewEl = document.getElementById('view');
  if (viewEl) {
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(markBuyable, 50); })
      .observe(viewEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-copy'] });
  }
  live.on('me', (e) => {
    if ((e.detail?.displayName || null) !== stripName && live.isLinked()) renderStrip();
    updateCoins(e.detail?.coins);
    markBuyable();
    fillBar(); // eigener Kolonist hervorheben
  });
  live.on('notice', (e) => toast(e.detail, 3500));

  document.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-live-buy]');
    if (nb) { e.preventDefault(); e.stopPropagation(); buyNow(nb); }
  }, true);

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-live]');
    if (!b) return;
    if (b.dataset.live === 'connect') openLinkDialog();
    else if (b.dataset.live === 'logout') { await live.logout(); toast('Abgemeldet'); }
  });
  // Porträt nicht ladbar: Platzhalter statt kaputtem Bild
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img?.matches?.('img[data-portrait]')) return;
    const ph = document.createElement('div');
    ph.className = img.className.replace('portrait', 'portrait ph');
    ph.textContent = img.dataset.initial || '?';
    ph.setAttribute('aria-hidden', 'true');
    img.replaceWith(ph);
  }, true);
}

// =====================================================================
// Charakter-Ansicht
// =====================================================================
const SUBS = [
  { id: 'overview', label: 'Überblick' },
  { id: 'skills', label: 'Fähigkeiten' },
  { id: 'health', label: 'Gesundheit' },
  { id: 'gear', label: 'Ausrüstung' },
  { id: 'goals', label: 'Ziele' },
  { id: 'origin', label: 'Herkunft' },
];
const SUB_KEY = 'ys-live-sub';
let curSub = lsGet(SUB_KEY) || 'overview';
let openTrait = null;

const STATE_BADGE = { ok: 'good', sleeping: 'neutral', away: 'neutral', downed: 'bad', mental: 'doom', dead: 'doom' };
const hasGoals = (p) => p.wants != null || p.quirks != null || p.aspirations != null;
const visibleSubs = (p) => SUBS.filter((s) => s.id !== 'goals' || hasGoals(p));

function portraitHtml(p, cls) {
  const ini = esc((p.name || p.displayName || '?').trim().charAt(0).toUpperCase() || '?');
  if (!p.portrait) return `<div class="portrait ph ${cls}" aria-hidden="true">${ini}</div>`;
  return `<img class="portrait ${cls}" src="${esc(live.portraitUrl(p.id || p.user, p.portrait))}" alt="Porträt von ${esc(p.name)}" width="96" height="96" loading="lazy" data-portrait data-initial="${ini}">`;
}

function heroHtml(p) {
  const meta = [p.race, p.xenotype && p.xenotype !== p.race ? p.xenotype : null, p.age != null ? `${p.age} Jahre` : null, p.gender]
    .filter(Boolean).map(esc).join(' · ');
  const mood = p.moodPct == null ? '' : barRow('Stimmung', p.moodPct, p.moodLabel || `${Math.round(p.moodPct)} %`);
  return `<div class="card ch-hero">
    ${portraitHtml(p, 'ch-portrait')}
    <div class="ch-id">
      <h2 class="ch-name">${esc(p.name)}</h2>
      <div class="ch-sub"><span class="muted">${p.user ? '@' + esc(p.displayName || p.user) : 'Kolonist'}</span>${p.fullName && p.fullName !== p.name ? ` · <span class="muted">${esc(p.fullName)}</span>` : ''}</div>
      <div class="ch-meta">${meta}</div>
      <div class="ch-state"><span class="badge ${STATE_BADGE[p.state] || 'neutral'}">${esc(p.stateLabel || p.state)}</span>${p.job ? `<span class="ch-job">${esc(p.job)}</span>` : ''}</div>
    </div>
    <div class="ch-bars">${barRow('Gesundheit', p.healthPct)}${mood}</div>
  </div>`;
}

const flames = (n) => (n >= 2 ? '🔥🔥' : n === 1 ? '🔥' : '');
const section = (title, inner) => `<section class="ch-sec"><h4>${esc(title)}</h4>${inner}</section>`;

function skillRow(s) {
  if (s.disabled) return `<div class="brow off"><span class="bl">${esc(s.label)}</span><span class="lbar"><i style="width:0"></i></span><span class="bv">nicht möglich</span></div>`;
  return `<div class="brow"><span class="bl">${esc(s.label)}</span>${bar(s.level * 5, 'acc')}<span class="bv">${esc(s.level)}<span class="flames" title="${s.passion >= 2 ? 'Brennende Leidenschaft' : s.passion === 1 ? 'Leidenschaft' : ''}">${flames(s.passion)}</span></span></div>`;
}

function panelOverview(p) {
  const needs = (p.needs || []).length ? section('Bedürfnisse', `<div class="bgrid">${p.needs.map((n) => barRow(n.label, n.pct)).join('')}</div>`) : '';
  const top = (p.skills || []).filter((s) => !s.disabled).sort((a, b) => b.level - a.level || b.passion - a.passion).slice(0, 3);
  const skills = top.length ? section('Beste Fähigkeiten', `<div class="bgrid">${top.map(skillRow).join('')}</div>`) : '';
  let traits = '';
  if ((p.traits || []).length) {
    const open = p.traits.find((t) => t.label === openTrait);
    traits = section('Eigenschaften', `<div class="traits">${p.traits.map((t) =>
      `<button type="button" class="trait" data-trait="${esc(t.label)}" aria-expanded="${t === open}" title="${esc(t.desc)}">${esc(t.label)}</button>`).join('')}</div>
      ${open ? `<p class="trait-desc"><b>${esc(open.label)}:</b> ${esc(open.desc)}</p>` : '<p class="small muted trait-hint">Tippe auf eine Eigenschaft, um sie zu lesen.</p>'}`);
  }
  return needs + skills + traits || '<div class="empty">Keine Angaben.</div>';
}

function panelSkills(p) {
  const list = p.skills || [];
  if (!list.length) return '<div class="empty">Keine Fähigkeiten bekannt.</div>';
  return section('Fähigkeiten (0–20)', `<div class="bgrid">${list.map(skillRow).join('')}</div>
    <p class="small muted" style="margin:10px 0 0">🔥 Leidenschaft · 🔥🔥 brennende Leidenschaft</p>`);
}

function panelHealth(p) {
  const conds = [...(p.conditions || [])].sort((a, b) => (b.bleeding - a.bleeding) || (b.bad - a.bad));
  let html = '';
  if (p.bleeding) html += '<div class="ch-alert">Blutet! Ohne Verband wird es gefährlich.</div>';
  html += section('Zustände', conds.length
    ? `<ul class="conds">${conds.map((c) => `<li class="${c.bleeding ? 'bleed' : c.bad ? 'bad' : 'fine'}">
        <span class="cl">${esc(c.label)}${c.part ? ` <span class="muted">· ${esc(c.part)}</span>` : ''}</span>
        ${c.bleeding ? '<span class="tag bleed">blutet</span>' : ''}</li>`).join('')}</ul>`
    : '<div class="ch-ok">Kerngesund – keine Verletzungen oder Krankheiten.</div>');
  html += section('Schmerz', barRow('Schmerz', p.pain, `${Math.round(clamp(p.pain))} %`, tone(100 - clamp(p.pain))));
  if ((p.capacities || []).length) html += section('Fähigkeiten des Körpers', `<div class="bgrid">${p.capacities.map((c) => barRow(c.label, c.pct)).join('')}</div>`);
  return html;
}

function panelGear(p) {
  const g = p.gear || {};
  const list = (arr) => (arr && arr.length ? `<ul class="plain">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">nichts</p>');
  return section('Waffe', g.weapon ? `<p style="margin:0">${esc(g.weapon)}</p>` : '<p class="muted small" style="margin:0">unbewaffnet</p>')
    + section('Kleidung', list(g.apparel)) + section('Inventar', list(g.inventory));
}

function panelGoals(p) {
  let html = '';
  if (p.wants) {
    const w = p.wants;
    const pct = w.needed > 0 ? (w.points / w.needed) * 100 : 0;
    html += section('Wünsche', `${barRow('Punkte', pct, `${fmt(w.points)} / ${fmt(w.needed)}`, 'acc', 'wide')}
      ${(w.list || []).length ? `<ul class="goal-list">${w.list.map((x) => `<li><div><b>${esc(x.label)}</b>${x.desc ? `<div class="small muted">${esc(x.desc)}</div>` : ''}</div><span class="tag">+${esc(fmt(x.reward))}</span></li>`).join('')}</ul>` : '<p class="muted small" style="margin:8px 0 0">Gerade keine offenen Wünsche.</p>'}`);
  }
  if (p.quirks) {
    html += section('Eigenheiten (Quirks)', p.quirks.length
      ? `<ul class="goal-list">${p.quirks.map((x) => `<li><div><b>${esc(x.label)}</b>${x.desc ? `<div class="small muted">${esc(x.desc)}</div>` : ''}</div></li>`).join('')}</ul>`
      : '<p class="muted small" style="margin:0">Keine.</p>');
  }
  if (p.aspirations) {
    const a = p.aspirations;
    html += section('Lebensziele', `${barRow('Fortschritt', a.pct, `${Math.round(clamp(a.pct))} %`, 'acc', 'wide')}
      ${(a.list || []).length ? `<ul class="goal-list">${a.list.map((x) => `<li class="${x.done ? 'done' : ''}"><div>${x.done ? '✓' : '○'} ${esc(x.label)}</div></li>`).join('')}</ul>` : ''}`);
  }
  return html || '<div class="empty">Keine Ziele.</div>';
}

function panelOrigin(p) {
  const row = (k, v) => `<div class="orow"><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '<span class="muted">–</span>' : esc(v)}</dd></div>`;
  return section('Herkunft', `<dl class="origin">${row('Kindheit', p.childhood)}${row('Erwachsenenleben', p.adulthood)}${row('Aufenthalt', p.location)}${row('Besiegte Gegner', p.kills != null ? fmt(p.kills) : null)}</dl>`);
}

const PANELS = { overview: panelOverview, skills: panelSkills, health: panelHealth, gear: panelGear, goals: panelGoals, origin: panelOrigin };

function subsHtml(p) {
  const vis = visibleSubs(p);
  const cur = vis.some((s) => s.id === curSub) ? curSub : 'overview';
  return `<div class="ch-tabs" role="tablist" aria-label="Bereiche des Charakters">${vis.map((s) =>
    `<button type="button" role="tab" class="ch-tab" data-sub="${s.id}" aria-selected="${s.id === cur}">${esc(s.label)}</button>`).join('')}</div>`;
}
const activeSub = (p) => (visibleSubs(p).some((s) => s.id === curSub) ? curSub : 'overview');

/** Zeichnet Hero + Unterreiter + Inhalt in `host`. Der gewählte Reiter bleibt beim Aktualisieren erhalten. */
function mountCharacter(host, p) {
  host._pawn = p;
  host.innerHTML = `<div class="ch">${heroHtml(p)}${subsHtml(p)}<div class="ch-panel card" role="tabpanel">${PANELS[activeSub(p)](p)}</div></div>`;
  if (host._bound) return;
  host._bound = true;
  host.addEventListener('click', (e) => {
    const pawn = host._pawn;
    const sub = e.target.closest('[data-sub]');
    const tr = e.target.closest('[data-trait]');
    if (!pawn || !(sub || tr)) return;
    if (sub) {
      curSub = sub.dataset.sub; lsSet(SUB_KEY, curSub);
      host.querySelectorAll('.ch-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === curSub)));
    } else {
      openTrait = openTrait === tr.dataset.trait ? null : tr.dataset.trait;
    }
    host.querySelector('.ch-panel').innerHTML = PANELS[activeSub(pawn)](pawn);
  });
}

// =====================================================================
// Ansicht „Ich“
// =====================================================================
const connectCard = () => `<div class="card live-card">
  <h2>Verbinde dich mit deinem Twitch-Namen</h2>
  <p>Dann siehst du hier deinen Kolonisten und deine Münzen, und Käufe lassen sich direkt per Knopf auslösen – ohne etwas in den Chat zu tippen. Das Verbinden dauert einen Moment: du schreibst einmal einen kurzen Code in den Chat.</p>
  <button type="button" class="btn primary" data-live="connect">Verbinden</button>
</div>`;

function walletHtml(me) {
  return `<div class="card wallet">
    <div><span class="wallet-label">Deine Münzen</span><div class="wallet-coins">${coinsHtml(me.coins)}</div></div>
    <div class="wallet-karma"><span class="wallet-label">Karma</span><div><b>${esc(fmt(me.karma))}</b></div></div>
  </div>`;
}

/** Ruft fn auf, solange das Element noch auf der Seite ist; meldet sonst die Zuhörer ab. */
function whileMounted(root, subscriptions) {
  const offs = [];
  const run = (fn) => (e) => { if (!root.isConnected) { offs.forEach((o) => o()); return; } fn(e); };
  subscriptions.forEach(([type, fn]) => offs.push(live.on(type, run(fn))));
}

export function ichView() {
  const html = '<div class="live-page"><div id="ich-host"></div></div>';
  function bind(root) {
    const host = root.querySelector('#ich-host');
    let lastKey = '';
    const render = () => {
      if (!live.isLive()) return;
      if (!live.isLinked()) { if (lastKey !== 'nolink') { host.innerHTML = connectCard(); lastKey = 'nolink'; } return; }
      const me = live.getMe();
      if (!me) { host.innerHTML = '<div class="empty">Lade deine Daten …</div>'; lastKey = 'load'; return; }
      const key = JSON.stringify({ ...me, coins: 0 });
      if (key === lastKey) return;                 // nur Münzen geändert: die Animation übernimmt
      lastKey = key;
      host.innerHTML = `${walletHtml(me)}
        <div id="ich-char" style="margin-top:14px"></div>
        <p class="ich-foot small muted">Verbunden als <b>${esc(me.displayName || me.user)}</b> · <button type="button" class="linklike" data-live="logout">Abmelden</button></p>`;
      const ch = host.querySelector('#ich-char');
      if (me.pawn) mountCharacter(ch, me.pawn);
      else ch.innerHTML = `<div class="card live-card"><h2>Du hast noch keinen Kolonisten</h2>
        <p>Schreib <code>${esc(live.prefix())}join</code> in den Chat, um der Kolonie beizutreten. Sobald dir ein Pawn zugeteilt ist, erscheint er hier.</p>
        <div class="cmd-row">${cmdBtn(live.prefix() + 'join')}</div>
        <p class="small" style="margin:12px 0 0"><a href="#/befehle">Alle Befehle ansehen</a></p></div>`;
    };
    whileMounted(host, [['me', render], ['change', render]]);
    render();
  }
  return { html, bind };
}

// =====================================================================
// Ansicht „Kolonie“
// =====================================================================
function colonyCard(p, meUser) {
  const mine = p.user && p.user === meUser;
  return `<a class="card kol-card${mine ? ' mine' : ''}" href="#/kolonie/${encodeURIComponent(p.id || p.user)}">
    ${portraitHtml(p, 'kol-portrait')}
    <div class="kol-main">
      <div class="kol-name"><b>${esc(p.name)}</b>${mine ? ' <span class="chip accent">Du</span>' : ''}</div>
      <div class="small muted kol-user">${p.user ? '@' + esc(p.displayName || p.user) : 'Kolonist'}</div>
      <div><span class="badge ${STATE_BADGE[p.state] || 'neutral'}">${esc(p.stateLabel || p.state)}</span></div>
    </div>
    <div class="kol-bars">
      ${barRow('Gesundheit', p.healthPct, null, null, 'mini')}
      ${p.moodPct == null ? '' : barRow('Stimmung', p.moodPct, null, null, 'mini')}
    </div>
    ${p.job ? `<div class="kol-job small muted">${esc(p.job)}</div>` : ''}
  </a>`;
}

export function kolonieView() {
  const user = decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[1] || '');
  return user ? pawnDetail(user) : colonyList();
}

function colonyList() {
  const html = `<div class="live-page">
    <div class="kol-head"><h2 class="section-title" style="margin:0">Die Kolonie</h2><span class="small muted" id="kol-count"></span></div>
    <div id="kol-grid" class="kol-grid"><div class="empty" style="grid-column:1/-1">Lade …</div></div></div>`;
  function bind(root) {
    const grid = root.querySelector('#kol-grid'), count = root.querySelector('#kol-count');
    let last = '';
    const draw = (data) => {
      const list = Array.isArray(data?.pawns) ? data.pawns : [];
      const me = live.getMe()?.user;
      const key = JSON.stringify([list, me]);
      if (key === last) return;
      last = key;
      count.textContent = list.length ? `${fmt(list.length)} Kolonist${list.length === 1 ? '' : 'en'}` : '';
      grid.innerHTML = list.length ? list.map((p) => colonyCard(p, me)).join('')
        : `<div class="empty" style="grid-column:1/-1">Noch keine Kolonisten zu sehen. Mit <code>${esc(live.prefix())}join</code> im Chat kannst du die Erste oder der Erste sein.</div>`;
    };
    live.poll({
      path: '/api/colony', every: 5000, alive: () => grid.isConnected,
      onResult: (r) => { if (r.status === 200 && !r.unchanged) draw(r.data); },
    });
    whileMounted(grid, [['me', () => { last = ''; }]]);
  }
  return { html, bind };
}

function pawnDetail(user) {
  const html = `<div class="live-page"><p class="back"><a href="#/kolonie">← Alle Kolonisten</a></p><div id="pd-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    window.scrollTo({ top: 0 });
    const host = root.querySelector('#pd-host');
    let last = '';
    live.poll({
      path: '/api/pawn/' + encodeURIComponent(user), every: 5000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged) return;
        const key = r.status + JSON.stringify(r.data);
        if (key === last) return;
        last = key;
        if (r.status === 200 && r.data) mountCharacter(host, r.data);
        else if (r.status === 404) host.innerHTML = '<div class="empty">Diesen Kolonisten gibt es nicht (mehr).</div>';
      },
    });
  }
  return { html, bind };
}

// =====================================================================
// Ansicht „Spiel“
// =====================================================================
const KIND_LABEL = { threat: 'Gefahr', bad: 'Schlecht', good: 'Gut', neutral: 'Neutral' };

function spielHtml(g) {
  const hh = String(Math.floor(Number(g.hour) || 0)).padStart(2, '0');
  const stat = (k, v, sub) => `<div class="gstat"><span class="gk">${esc(k)}</span><b class="gv">${esc(v)}</b><span class="gs">${esc(sub || '')}</span></div>`;
  const stats = [
    stat('Datum', `Tag ${g.day}`, g.date), stat('Uhrzeit', `${hh}:00 Uhr`), stat('Jahreszeit', g.season),
    stat('Wetter', g.weather, g.temperature), stat('Koloniewert', `${fmt(g.wealth)} Silber`),
    stat('Kolonisten', fmt(g.colonists)), stat('Gefangene', fmt(g.prisoners)), stat('Tiere', fmt(g.animals)),
    stat('Zuschauer-Pawns', fmt(g.viewerPawns)),
  ].join('');
  const conds = (g.conditions || []).length
    ? `<ul class="plain">${g.conditions.map((c) => `<li class="gcond"><div><b>${esc(c.label)}</b>${c.desc ? `<div class="small muted">${esc(c.desc)}</div>` : ''}</div><span class="tag">${c.left ? esc(c.left) : 'dauerhaft'}</span></li>`).join('')}</ul>`
    : '<div class="ch-ok">Alles ruhig.</div>';
  const evs = (g.events || []).length
    ? `<ul class="gevents">${g.events.map((e) => `<li class="k-${KIND_LABEL[e.kind] ? esc(e.kind) : 'neutral'}"><span class="gdot" title="${esc(KIND_LABEL[e.kind] || 'Neutral')}"></span><span class="gl">${esc(e.label)}</span><span class="small muted ga">${esc(e.ago)}</span></li>`).join('')}</ul>`
    : '<p class="muted small" style="margin:0">Noch nichts passiert.</p>';
  const res = g.research ? barRow('Aktuell', g.research.pct, `${Math.round(clamp(g.research.pct))} %`, 'acc', 'wide') + `<p style="margin:6px 0 0">${esc(g.research.label)}</p>` : '<p class="muted small" style="margin:0">Keine laufende Forschung.</p>';
  return `<div class="gstats">${stats}</div>
    <div class="grid cols-2" style="margin-top:12px">
      <section class="card ch-sec"><h4>Gerade los</h4>${conds}</section>
      <section class="card ch-sec"><h4>Was zuletzt passiert ist</h4>${evs}</section>
      <section class="card ch-sec"><h4>Forschung</h4>${res}</section>
      <section class="card ch-sec"><h4>Erzähler</h4><p style="margin:0"><b>${esc(g.storyteller)}</b></p><p class="muted small" style="margin:4px 0 0">Schwierigkeit: ${esc(g.difficulty)}</p></section>
    </div>`;
}

export function spielView() {
  const html = `<div class="live-page"><div id="spiel-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    const host = root.querySelector('#spiel-host');
    let last = '';
    live.poll({
      path: '/api/game', every: 10000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged || r.status !== 200 || !r.data) return;
        const key = JSON.stringify(r.data);
        if (key === last) return;
        last = key;
        host.innerHTML = spielHtml(r.data);
      },
    });
  }
  return { html, bind };
}
