// RICS Live – Oberfläche: Live-Leiste, Verbinden-Dialog, Kauf-Dialog, Tabs „Ich“ und „Kolonie“, Charakter-Ansicht.
// Alle Texte aus der Schnittstelle sind Zuschauernamen/Spielinhalte und werden mit esc() entschärft.
import { esc, fmt, copyText, toast, cmdBtn, morph } from './util.js';
import * as live from './live.js';
import { CHAT_POPOUT as CHAT_URL } from './stream.js';

let DATA = null;
/** Preislisten-Daten (für die Preisanzeige im Kauf-Dialog). */
export const setLiveData = (d) => { DATA = d; };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

// RimWorld liefert „34 Tage“; nach „vor“ braucht es den Dativ („vor 34 Tagen“)
const agoDe = (s) => String(s || '').replace(/(Tage|Jahre|Monate|Quadrums|Quartale)/g, (w) => ({ Tage: 'Tagen', Jahre: 'Jahren', Monate: 'Monaten', Quadrums: 'Quadrums', Quartale: 'Quartalen' }[w]));
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
const normName = (s) => s.toLowerCase().trim().replace(/\s+/g, ''); // RICS-Schreibweise: ohne Leerzeichen

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
    const hit = DATA.items.filter((i) => i.cmdName === name || normName(i.defName) === name);
    return hit.length === 1 ? { price: hit[0].price * qty, label: qty > 1 ? `${hit[0].name} ×${fmt(qty)}` : hit[0].name } : null;
  }
  if (cmd === 'event' || cmd === 'weather') {
    const list = cmd === 'event' ? DATA.events : DATA.weather;
    const name = normName(args);
    const hit = list.filter((x) => x.cmdName === name || normName(x.defName) === name);
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

/** Katastrophen-Event (Karma „Doom“)? Dann vor dem Auslösen nachfragen. */
function isDoom({ cmd, args }) {
  if (!DATA || (cmd !== 'event' && cmd !== 'weather')) return false;
  const list = cmd === 'event' ? DATA.events : DATA.weather;
  const name = normName(args);
  const hit = list.find((x) => x.cmdName === name || normName(x.defName) === name);
  return hit?.karma === 'Doom';
}

function confirmDoom(label) {
  return new Promise((resolve) => {
    const d = makeDialog(`
      <h3>Katastrophe auslösen?</h3>
      <p class="ld-warn">Willst du das wirklich tun? Es wird bestimmt eine Ente sterben. 🦆</p>
      ${label ? `<p class="ld-info">${esc(label)}</p>` : ''}
      <div class="ld-actions">
        <button type="button" class="btn primary" id="ld-doom-go">Ja, auslösen</button>
        <button type="button" class="btn" data-close>Lieber nicht</button>
      </div>`);
    let ok = false;
    d.querySelector('#ld-doom-go').addEventListener('click', () => { ok = true; d.close(); });
    d.addEventListener('close', () => resolve(ok));
    d.querySelector('[data-close]').focus();
  });
}

async function buyNow(btn) {
  const src = btn.previousElementSibling?.matches?.('[data-copy]') ? btn.previousElementSibling.dataset.copy : btn.dataset.liveBuy;
  const p = parseCommand(src);
  if (!p || btn.disabled) return;
  if (isDoom(p) && !(await confirmDoom(priceOf(p)?.label))) return;
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
    return `<a data-key="${esc(p.id || p.user)}" class="lp${mine ? ' mine' : ''}${p.user ? ' viewer' : ''}" href="#/kolonie/${encodeURIComponent(p.id || p.user)}"
        title="${esc(p.name)}${p.user ? ' (@' + esc(p.displayName || p.user) + ')' : ''} – ${esc(p.stateLabel || '')}${mood != null ? ' · Stimmung ' + mood + ' %' : ''}">
      <span class="lp-pic">${img}${st}</span>
      <span class="lp-mood ${MOOD_TONE(p)}"><i style="width:${clamp(mood ?? 0)}%"></i></span>
      <span class="lp-name">${esc(p.name)}</span>
    </a>`;
  }).join('');
}

function fillBar() {
  const g = strip?.querySelector('#live-game-slot');
  if (g) morph(g, gameChipsHtml(barGame));
  const pw = strip?.querySelector('#live-pawns');
  if (pw) { morph(pw, pawnBarHtml(barPawns)); pw.hidden = !barPawns?.length; }
}

function startBarPolling() {
  if (barPolling || !live.isLive()) return;
  barPolling = true;
  const alive = () => { const ok = live.isLive(); if (!ok) barPolling = false; return ok; };
  live.poll({ path: '/api/game', every: 5000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barGame = r.data; fillBar(); } } });
  live.poll({ path: '/api/colony', every: 2000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barPawns = r.data?.pawns || []; fillBar(); } } });
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
  else right = `<a class="live-me" href="#/ich" title="Zu deiner Seite"><span class="live-name">${esc(me.displayName || me.user)}</span>${coinsHtml(me.coins)}${rateHtml(me)}</a>`;
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

// =====================================================================
// Abstimmungs-Popup (RICS Voting): festes Kärtchen unten, auf jedem Reiter, solange eine Abstimmung läuft
// =====================================================================
const VOTE_KEY = 'ys-vote';                 // sessionStorage: eigene Stimme zur laufenden Abstimmung
let voteEl = null, voteState = null, voteAt = 0, voteBusy = false, voteTick = null, votePolling = false;

const voteKey = (opts) => opts.map((o) => o.label).join('|');
function myVote(opts) {
  try {
    const v = JSON.parse(sessionStorage.getItem(VOTE_KEY) || 'null');
    return v && v.key === voteKey(opts) ? v.n : null;
  } catch { return null; }
}
function rememberVote(opts, n) {
  try { sessionStorage.setItem(VOTE_KEY, JSON.stringify({ key: voteKey(opts), n })); } catch { /* egal */ }
}
const voteLeft = () => Math.max(0, Math.round((Number(voteState?.secondsLeft) || 0) - (Date.now() - voteAt) / 1000));

function voteHtml(v) {
  const opts = v.options || [];
  const mine = myVote(opts);
  const linked = live.isLinked();
  const rows = opts.map((o, i) => {
    const n = i + 1, pct = clamp(o.pct), isMine = mine === n;
    let act = '';
    if (linked && mine == null) act = `<button type="button" class="btn primary vote-go" data-vote="${n}"${voteBusy ? ' disabled' : ''}>Stimme ${n}</button>`;
    else if (isMine) act = '<span class="vote-mine">✓ Deine Stimme</span>';
    return `<li class="vote-opt${isMine ? ' mine' : ''}">
      <div class="vo-top"><span class="vo-label"><b>${n}</b> ${esc(o.label)}</span><span class="vo-pct">${Math.round(pct)} %${o.count ? ` · ${fmt(o.count)}` : ''}</span></div>
      ${bar(pct, 'acc')}${act}</li>`;
  }).join('');
  const note = linked ? '' : `<p class="small muted vote-note">Schreib die Zahl (1–${opts.length}) in den Chat, oder verbinde dich oben, um hier abzustimmen.</p>`;
  return `<div class="vote-head"><b>Abstimmung</b><span class="vt-left">Noch ${voteLeft()} s</span><span class="small muted">${fmt(v.total)} Stimmen</span></div>
    <ol class="vote-opts">${rows}</ol>${note}`;
}

function startVoteTick() {
  if (voteTick) return;
  voteTick = setInterval(() => { const el = voteEl?.querySelector('.vt-left'); if (el) el.textContent = `Noch ${voteLeft()} s`; }, 1000);
}
function stopVoteTick() { clearInterval(voteTick); voteTick = null; }

function renderVote() {
  if (!voteEl) return;
  if (!voteState?.open || !live.isLive()) {
    voteEl.hidden = true; stopVoteTick(); morph(voteEl, '');
    return;
  }
  voteEl.hidden = false;
  morph(voteEl, voteHtml(voteState));
  startVoteTick();
}

async function castVote(n) {
  if (voteBusy || !voteState?.open) return;
  const opts = voteState.options || [];
  voteBusy = true; renderVote();
  try {
    const msgs = await live.act('vote', String(n));
    rememberVote(opts, n);
    toast(msgs.length ? msgs.join(' · ') : `Stimme ${n} abgegeben`, 4000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    voteBusy = false; renderVote();
  }
}

function ensureVotePoll() {
  if (votePolling || !live.isLive()) return;
  votePolling = true;
  live.poll({
    path: '/api/vote', every: 2000, alive: () => live.isLive(),
    onResult: (r) => {
      if (r.status !== 200 || !r.data || r.unchanged) return;
      voteState = r.data; voteAt = Date.now();
      if (!voteState.open) { try { sessionStorage.removeItem(VOTE_KEY); } catch { /* egal */ } }
      renderVote();
    },
  });
}

// ---------- Duell: eingehende Herausforderung als Popup (Annehmen / Ablehnen) ----------
let duelDlg = null, duelKey = null, duelDismissed = null, duelTimer = null;

function closeDuel() {
  clearInterval(duelTimer); duelTimer = null;
  if (duelDlg?.open) duelDlg.close();
}

function answerDuel(v) {
  duelDismissed = duelKey;
  closeDuel();
  live.act('duel', v)
    .then((msgs) => toast(msgs.length ? msgs.join(' · ') : (v === 'ja' ? 'Angenommen – der Kampf kommt.' : 'Abgelehnt.'), 6000))
    .catch((e) => toast(e.message, 5000));
}

function handleDuel() {
  const inc = live.isLive() ? (live.getMe()?.pawn?.duelIncoming || null) : null;
  if (!inc) { duelDismissed = null; duelKey = null; closeDuel(); return; }
  const key = `${inc.from}|${inc.fromUser || ''}`;
  if (duelDlg?.open && duelKey === key) return;   // läuft schon
  if (duelDismissed === key) return;              // schon weggeklickt
  closeDuel();
  duelKey = key;
  let left = Math.max(0, Math.round(Number(inc.secondsLeft) || 0));
  const from = esc(inc.from);
  const d = makeDialog(`
    <h3>Herausforderung!</h3>
    <p class="ld-lead"><b>${from}</b> fordert dich zur Prügelei heraus.</p>
    <p class="small muted">Antwort in <b id="duel-left">${left}</b> s – sonst gilt es als abgelehnt.</p>
    <div class="ld-actions">
      <button type="button" class="btn primary" data-duel="ja">Annehmen</button>
      <button type="button" class="btn" data-duel="nein">Ablehnen</button>
    </div>`);
  duelDlg = d;
  d.querySelectorAll('[data-duel]').forEach((b) => b.addEventListener('click', () => answerDuel(b.dataset.duel)));
  d.addEventListener('close', () => {
    clearInterval(duelTimer); duelTimer = null;
    if (duelKey) duelDismissed = duelKey;         // mit Escape/Hintergrund weggeschoben: nicht wieder öffnen
    duelDlg = null;
  });
  const out = d.querySelector('#duel-left');
  const t0 = Date.now();
  duelTimer = setInterval(() => {
    const now = Math.max(0, left - Math.round((Date.now() - t0) / 1000));
    if (out) out.textContent = now;
  }, 1000);
}

// ---------- Benachrichtigungen: Zustandswechsel des eigenen Kolonisten und erfüllte Wünsche ----------
const notes = { key: null, state: null, wants: null };
const STATE_ALERT = {
  downed: (n) => ({ text: `${n} ist niedergestreckt!`, tone: 'bad' }),
  mental: (n, l) => ({ text: `${n}: ${l || 'Nervenzusammenbruch'}!`, tone: 'bad' }),
  dead: (n) => ({ text: `${n} ist gestorben.`, tone: 'doom' }),
};
let alertEl = null, alertTimer = null;

/** Auffällige Einblendung oben (antippen schließt sie). textContent statt HTML: Texte kommen aus dem Spiel. */
function flashAlert(text, tone = 'bad') {
  if (!alertEl) return;
  alertEl.className = `live-alert ${tone}`;
  alertEl.textContent = text;
  alertEl.hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { alertEl.hidden = true; }, 9000);
}

/** Browser-Benachrichtigung – nur wenn der Tab im Hintergrund ist und die Erlaubnis erteilt wurde. */
function osNotify(text) {
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('RICS Live', { body: text });
  } catch { /* egal */ }
}

function checkNotices() {
  const p = live.isLive() ? live.getMe()?.pawn : null;
  if (!p) { notes.key = null; return; }
  const key = p.id || p.user || p.name;
  const cnt = Array.isArray(p.wants?.list) ? p.wants.list.length : null;
  if (notes.key !== key) {                         // neuer Kolonist: einmal still merken, nichts melden
    notes.key = key; notes.state = p.state; notes.wants = cnt;
    return;
  }
  if (notes.state !== p.state && STATE_ALERT[p.state]) {
    const a = STATE_ALERT[p.state](p.name, p.stateLabel);
    flashAlert(a.text, a.tone); osNotify(a.text);
  }
  notes.state = p.state;
  if (notes.wants != null && cnt != null && cnt < notes.wants) {
    const txt = `Wunsch erfüllt! ${p.name} hat noch ${cnt} offen.`;
    flashAlert(txt, 'good'); osNotify(txt);
  }
  notes.wants = cnt;
}

export function initLiveUi() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  strip = document.createElement('div');
  strip.className = 'live-strip';
  strip.hidden = true;
  // Leiste klebt zusammen mit den Reitern oben (auch beim Runterscrollen sichtbar und anklickbar)
  const bar = document.querySelector('.tabs-bar');
  if (bar) bar.prepend(strip); else header.appendChild(strip);
  // Beim Scrollen kompakter, damit am Handy genug Platz bleibt
  let compact = false;
  window.addEventListener('scroll', () => {
    const c = window.scrollY > 160;
    if (c !== compact) { compact = c; document.body.classList.toggle('live-compact', c); }
  }, { passive: true });

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
    updateRate(e.detail);
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

  // Abstimmungs-Kärtchen (unten, über allen Reitern)
  voteEl = document.createElement('aside');
  voteEl.className = 'vote-card card';
  voteEl.hidden = true;
  voteEl.setAttribute('aria-label', 'Laufende Abstimmung');
  document.body.appendChild(voteEl);
  voteEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vote]');
    if (b && !b.disabled) castVote(Number(b.dataset.vote));
  });
  live.on('change', () => {
    if (!live.isLive()) { votePolling = false; voteState = null; renderVote(); }
    else ensureVotePoll();
  });
  ensureVotePoll();
  live.on('me', handleDuel);
  live.on('change', handleDuel);

  // Benachrichtigungen
  alertEl = document.createElement('div');
  alertEl.className = 'live-alert';
  alertEl.setAttribute('role', 'alert');
  alertEl.hidden = true;
  alertEl.addEventListener('click', () => { alertEl.hidden = true; });
  document.body.appendChild(alertEl);
  live.on('me', checkNotices);
  live.on('change', () => { if (!live.isLive()) notes.key = null; });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-notify]')) return;
    if (!('Notification' in window)) { toast('Dieser Browser kann keine Benachrichtigungen.'); return; }
    Notification.requestPermission().then((perm) => {
      toast(perm === 'granted' ? 'Benachrichtigungen sind an.' : 'Keine Erlaubnis – du bekommst die Hinweise nur auf der Seite.', 4000);
    }).catch(() => {});
  });
}

// =====================================================================
// Charakter-Ansicht
// =====================================================================
const SUBS = [
  { id: 'overview', label: 'Überblick' },
  { id: 'mood', label: 'Stimmung' },
  { id: 'skills', label: 'Fähigkeiten' },
  { id: 'health', label: 'Gesundheit' },
  { id: 'gear', label: 'Ausrüstung' },
  { id: 'style', label: 'Aussehen' },
  { id: 'work', label: 'Arbeit' },
  { id: 'goals', label: 'Ziele' },
  { id: 'isekai', label: 'Isekai' },
  { id: 'log', label: 'Erlebnisse' },
  { id: 'relations', label: 'Beziehungen' },
  { id: 'story', label: 'Geschichte' },
  { id: 'origin', label: 'Herkunft' },
];
const SUB_KEY = 'ys-live-sub';
let curSub = lsGet(SUB_KEY) || 'overview';
let openTrait = null;

const STATE_BADGE = { ok: 'good', sleeping: 'neutral', away: 'neutral', downed: 'bad', mental: 'doom', dead: 'doom' };
const hasGoals = (p) => p.wants != null || p.quirks != null || p.aspirations != null;
const visibleSubs = (p) => SUBS.filter((s) => (s.id !== 'goals' || hasGoals(p)) && (s.id !== 'mood' || Array.isArray(p.thoughts)) && (s.id !== 'isekai' || p.isekai != null) && (s.id !== 'work' || Array.isArray(p.work)));

function portraitHtml(p, cls) {
  const ini = esc((p.name || p.displayName || '?').trim().charAt(0).toUpperCase() || '?');
  if (!p.portrait) return `<div class="portrait ph ${cls}" aria-hidden="true">${ini}</div>`;
  return `<img class="portrait ${cls}" src="${esc(live.portraitUrl(p.id || p.user, p.portrait))}" alt="Porträt von ${esc(p.name)}" width="96" height="96" loading="lazy" data-portrait data-initial="${ini}">`;
}

// Abzeichen im Charakter-Kopf: werden hier aus den Daten berechnet (nur das jeweils höchste je Gruppe)
const DAY_BADGES = [[365, '1 Jahr in der Kolonie'], [100, '100 Tage in der Kolonie'], [50, '50 Tage in der Kolonie'], [10, '10 Tage in der Kolonie']];
const KILL_BADGES = [[50, '50 Gegner besiegt'], [10, '10 Gegner besiegt'], [1, 'Ersten Gegner besiegt']];
const ISEKAI_BADGES = [[50, 'Isekai-Meister'], [20, 'Isekai-Veteran'], [10, 'Isekai-Erfahren']];
const topBadge = (list, v) => list.find(([n]) => v >= n);

function badgeList(p) {
  const out = [];
  const add = (label, title) => out.push({ label, title: title || label });
  const d = topBadge(DAY_BADGES, Number(p.daysInColony) || 0);
  if (d) add(d[1]);
  const k = topBadge(KILL_BADGES, Number(p.kills) || 0);
  if (k) add(k[1]);
  const lvl = p.isekaiLevel ?? p.isekai?.level ?? null;
  const iz = lvl != null ? topBadge(ISEKAI_BADGES, Number(lvl) || 0) : null;
  if (iz) add(iz[1], `${iz[1]} – Isekai-Stufe ${fmt(lvl)}`);
  // Beziehungen stehen erst nach der ersten Abfrage von /api/log zur Verfügung (siehe ensureBadgeLog)
  const labels = (logCache.get(p.id || p.user)?.relations || []).flatMap((r) => r.relations || []);
  if (labels.some((x) => /^ehe/i.test(x))) add('Verheiratet');
  else if (labels.some((x) => /^verlob/i.test(x))) add('Verlobt');
  const q = Array.isArray(p.quirks) ? p.quirks.length : 0;
  if (q >= 3) add(`${fmt(q)} Eigenheiten`, 'Ab drei Eigenheiten gibt es dieses Abzeichen');
  return out;
}

const badgesInner = (p) => badgeList(p).map((b) => `<span class="ach" title="${esc(b.title)}">${esc(b.label)}</span>`).join('');

function refreshBadges(host) {
  const el = host.querySelector('.ch-badges');
  if (el && host._pawn) morph(el, badgesInner(host._pawn));
}

/** Einmalig /api/log holen, falls noch nicht geschehen – nur für die Beziehungs-Abzeichen. */
function ensureBadgeLog(host) {
  const p = host._pawn;
  if (!p) return;
  const key = p.id || p.user;
  if (!key || logCache.has(key) || host._badgeLog === key) return;
  host._badgeLog = key;
  live.getJson('/api/log/' + encodeURIComponent(key)).then((r) => {
    if (r.status === 200 && r.data) { logCache.set(key, r.data); refreshBadges(host); }
  }).catch(() => {});
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
      <div class="ch-badges">${badgesInner(p)}</div>
      ${p.id || p.user ? `<button type="button" class="linklike ch-share" data-share="${esc(p.id || p.user)}">Link kopieren</button>` : ''}
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
  const bonds = (p.bonds || []).length ? `<p class="bonds"><span class="heart" aria-hidden="true">♥</span> Gebunden an: <b>${p.bonds.map(esc).join(', ')}</b></p>` : '';
  return bonds + needs + skills + traits || '<div class="empty">Keine Angaben.</div>';
}

// Gedanken wie im Stimmungs-Reiter des Spiels; Antippen zeigt die Beschreibung (gleicher Mechanismus wie Eigenschaften)
function panelMood(p) {
  const head = p.moodPct == null ? '' : `<div class="bgrid">${barRow('Stimmung', p.moodPct, p.moodLabel || `${Math.round(p.moodPct)} %`)}</div>`;
  const list = [...(p.thoughts || [])].sort((a, b) => b.value - a.value);
  if (!list.length) return head + '<div class="empty">Gerade keine besonderen Gedanken.</div>';
  const sum = list.reduce((s, t) => s + (Number(t.value) || 0), 0);
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(Math.round(v * 10) / 10));
  const rows = list.map((t) => {
    const key = 't:' + t.label;
    const open = openTrait === key;
    const tn = t.value > 0 ? 'good' : t.value < 0 ? 'doom' : 'neutral';
    return `<button type="button" class="thought" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(t.desc)}">
        <span class="th-label">${esc(t.label)}${t.count > 1 ? ` <span class="muted">×${t.count}</span>` : ''}</span>
        <span class="th-val ${tn}">${sign(t.value)}</span>
      </button>${open && t.desc ? `<p class="trait-desc th-desc">${esc(t.desc)}</p>` : ''}`;
  }).join('');
  return head + section('Was gerade auf die Stimmung wirkt', `<div class="thoughts">${rows}</div>
    <p class="small muted th-sum">Zusammen: <b class="${sum >= 0 ? 'th-pos' : 'th-neg'}">${sign(sum)}</b> · Tippe auf einen Eintrag für Details.</p>`);
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

// ---------- Aktions-Knöpfe (nur für den eigenen Kolonisten) ----------
const isMine = (p) => !!p?.user && live.isLinked() && p.user === live.getMe()?.user;
let armedKey = null, armedTimer = null, busyKey = null;   // Bestätigung per zweitem Tippen / laufende Aktion

/** Kleiner Knopf; bei confirm erst „Sicher?“, dann beim zweiten Tippen ausführen. Der Zustand kommt aus dem HTML (übersteht morph). */
function actBtn(cmd, args, label, { confirm = false, title = '', cls = '', armedLabel = 'Sicher?' } = {}) {
  const key = cmd + ' ' + args;
  const busy = busyKey === key, armed = armedKey === key;
  return `<button type="button" class="act-btn ${cls}${armed ? ' armed' : ''}" data-act="${esc(cmd)}" data-args="${esc(args)}"${confirm ? ' data-confirm="1"' : ''}${busy ? ' disabled' : ''} title="${esc(armed ? 'Zum Bestätigen noch einmal antippen' : title)}">${busy ? '…' : esc(armed ? armedLabel : label)}</button>`;
}

async function runAct(host, btn) {
  const cmd = btn.dataset.act, args = btn.dataset.args, key = cmd + ' ' + args;
  if (busyKey || btn.disabled) return;
  if (btn.dataset.confirm && armedKey !== key) {
    armedKey = key;
    clearTimeout(armedTimer);
    armedTimer = setTimeout(() => { if (armedKey === key) { armedKey = null; if (host.isConnected) repaint(host); } }, 4000);
    repaint(host);
    return;
  }
  clearTimeout(armedTimer);
  armedKey = null; busyKey = key;
  repaint(host);
  try {
    const msgs = await live.act(cmd, args);
    toast(msgs.length ? msgs.join(' · ') : 'An RICS übergeben – Antwort im Chat', 7000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    busyKey = null;
    if (cmd === 'quirks') refreshOffers(host);
    if (host.isConnected) repaint(host);
  }
}

// ---------- Quirk-Angebote: eigene leichte Abfrage von /api/game, solange „Ziele“ offen ist ----------
let quirkOffers = null, offersLoaded = false;

function setOffers(host, g) {
  const next = Array.isArray(g?.quirkOffers) ? g.quirkOffers : null;
  const changed = !offersLoaded || JSON.stringify(next) !== JSON.stringify(quirkOffers);
  quirkOffers = next; offersLoaded = true;
  if (changed && host.isConnected) repaint(host);
}

function refreshOffers(host) {
  live.getJson('/api/game').then((r) => { if (r.status === 200 && r.data) setOffers(host, r.data); }).catch(() => {});
}

function startGoalsPoll(host) {
  const p = host._pawn;
  if (host._goalsPoll || !p || activeSub(p) !== 'goals' || !isMine(p)) return;
  host._goalsPoll = true;
  live.poll({
    path: '/api/game', every: 5000,
    alive: () => {
      const ok = host.isConnected && host._pawn && activeSub(host._pawn) === 'goals' && isMine(host._pawn);
      if (!ok) host._goalsPoll = false;
      return ok;
    },
    onResult: (r) => { if (r.status === 200 && r.data) setOffers(host, r.data); },
  });
}

const RARITY = { common: 'Gewöhnlich', uncommon: 'Ungewöhnlich', rare: 'Selten', legendary: 'Legendär' };

function offersHtml(p) {
  const pts = Number(p.wants?.rewardPoints) || 0;
  const list = quirkOffers.map((o, i) => {
    const r = RARITY[o.rarity] ? o.rarity : 'common';
    const key = 'q:' + o.label;
    const open = openTrait === key;
    const take = pts > 0 && live.isAllowed('quirks') ? actBtn('quirks', `nehmen ${i + 1}`, 'Nehmen', { confirm: true, title: 'Diese Eigenheit nehmen' }) : '';
    return `<li class="offer"><div class="offer-row">
        <button type="button" class="offer-main" data-trait="${esc(key)}" aria-expanded="${open}"><i class="rdot r-${r}" role="img" aria-label="${esc(RARITY[r])}" title="${esc(RARITY[r])}"></i><span>${esc(o.label)}</span></button>${take}</div>
        ${open ? `<p class="trait-desc"><span class="muted">${esc(RARITY[r])}.</span> ${esc(o.desc || '')}</p>` : ''}</li>`;
  }).join('');
  return `<div class="qpts"><span>Belohnungspunkte</span> <b>${fmt(pts)}</b></div>
    ${list ? `<ul class="goal-list offers">${list}</ul><p class="small muted trait-hint">Tippe auf ein Angebot für die Beschreibung.</p>` : '<p class="muted small" style="margin:8px 0 0">Gerade keine Angebote.</p>'}`;
}

function panelGoals(p) {
  const mine = isMine(p);
  let html = '';
  if (p.wants) {
    const w = p.wants;
    const pct = w.needed > 0 ? (w.points / w.needed) * 100 : 0;
    const canWant = mine && live.isAllowed('wants');
    html += section('Wünsche', `${barRow('Punkte', pct, `${fmt(w.points)} / ${fmt(w.needed)}`, 'acc', 'wide')}
      ${(w.list || []).length ? `<ul class="goal-list">${w.list.map((x, i) => `<li><div><b>${esc(x.label)}</b>${x.desc ? `<div class="small muted">${esc(x.desc)}</div>` : ''}</div>
        <span class="goal-side"><span class="tag">+${esc(fmt(x.reward))}</span>${canWant && x.rerollable ? actBtn('wants', `reroll ${i + 1}`, w.rerollCost ? `↻ Tauschen · ${fmt(w.rerollCost)} 🪙` : '↻ Tauschen', { confirm: true, armedLabel: w.rerollCost ? `${fmt(w.rerollCost)} Münzen – sicher?` : 'Sicher?', title: w.rerollCost ? `Diesen Wunsch für ${fmt(w.rerollCost)} Münzen gegen einen neuen tauschen` : 'Diesen Wunsch gegen einen neuen tauschen' }) : ''}</span></li>`).join('')}</ul>` : '<p class="muted small" style="margin:8px 0 0">Gerade keine offenen Wünsche.</p>'}`);
  }
  const showOffers = mine && offersLoaded && quirkOffers != null;
  if (p.quirks || showOffers) {
    const have = p.quirks
      ? (p.quirks.length ? `<ul class="goal-list">${p.quirks.map((x) => `<li><div><b>${esc(x.label)}</b>${x.desc ? `<div class="small muted">${esc(x.desc)}</div>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">Keine.</p>')
      : '';
    html += section('Eigenheiten (Quirks)', have + (showOffers ? `<h5 class="sub-h">Angebote</h5>${offersHtml(p)}` : ''));
  }
  if (p.aspirations) {
    const a = p.aspirations;
    const canAsp = mine && live.isAllowed('aspirations');
    html += section('Lebensziele', `${barRow('Fortschritt', a.pct, `${Math.round(clamp(a.pct))} %`, 'acc', 'wide')}
      ${(a.list || []).length ? `<ul class="goal-list">${a.list.map((x, i) => `<li class="${x.done ? 'done' : ''}"><div>${x.done ? '✓' : '○'} ${esc(x.label)}</div>
        ${!x.done && canAsp ? `<span class="goal-side">${actBtn('aspirations', `reroll ${i + 1}`, a.rerollCost ? `↻ Tauschen · ${fmt(a.rerollCost)} 🪙` : '↻ Tauschen', { confirm: true, armedLabel: a.rerollCost ? `${fmt(a.rerollCost)} Münzen – sicher?` : 'Teuer – sicher?', title: a.rerollCost ? `Lebensziel für ${fmt(a.rerollCost)} Münzen tauschen` : 'Lebensziel tauschen (kostet viel)' })}</span>` : ''}</li>`).join('')}</ul>` : ''}`);
  }
  return html || '<div class="empty">Keine Ziele.</div>';
}

// ---------- Isekai: Stufe, Stats, Skilltree ----------
let trees;                                  // undefined = noch nicht geladen, null = nicht vorhanden, sonst Antwort von /api/isekai
let treesLoading = false, treesRetryAt = 0;
let selTree = null, selNode = null, showAllTrees = false;
const NODE_TYPE = { start: 'Start', minor: 'Klein', notable: 'Bemerkenswert', keystone: 'Schlüsselknoten' };
const NODE_R = { start: 15, minor: 9, notable: 13, keystone: 17 };
const STATS = [['str', 'STR', 'Stärke'], ['dex', 'DEX', 'Geschicklichkeit'], ['vit', 'VIT', 'Vitalität'], ['int', 'INT', 'Intelligenz'], ['wis', 'WIS', 'Weisheit'], ['cha', 'CHA', 'Charisma']];

function ensureTrees(host) {
  if (trees !== undefined || treesLoading || Date.now() < treesRetryAt) return;
  treesLoading = true;
  live.getJson('/api/isekai').then((r) => {
    if (r.status === 200 && Array.isArray(r.data?.trees)) trees = r.data;
    else if (r.status === 404) trees = null;
    else treesRetryAt = Date.now() + 15000;
  }).catch(() => { treesRetryAt = Date.now() + 15000; })
    .finally(() => { treesLoading = false; if (host.isConnected) repaint(host); });
}

const findTree = (s) => (trees?.trees || []).find((t) => t.id === s || t.className === s) || null;

/** Wie weit ist ein Knoten per Kette erreichbar? Liefert { n, cost } (Knoten bis dahin, Gesamtkosten) oder null. */
function chainTo(tree, k, node) {
  const unl = new Set(k.unlocked || []), lrn = new Set(k.learnable || []);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
  for (const [a, b] of tree.links || []) {
    if (!byId.has(a) || !byId.has(b)) continue;
    link(a, b); link(b, a);
  }
  const dist = new Map();
  const q = [];
  for (const id of byId.keys()) if (unl.has(id)) { dist.set(id, { n: 0, cost: 0 }); q.push(id); }
  for (const id of byId.keys()) if (!unl.has(id) && lrn.has(id)) { dist.set(id, { n: 1, cost: Number(byId.get(id).cost) || 0 }); q.push(id); }
  while (q.length) {
    const id = q.shift(), d = dist.get(id);
    for (const nb of adj.get(id) || []) {
      if (dist.has(nb)) continue;
      dist.set(nb, { n: d.n + 1, cost: d.cost + (Number(byId.get(nb).cost) || 0) });
      q.push(nb);
    }
  }
  return dist.get(node.id) || null;
}

function treeSvg(tree, k) {
  const U = 54, PAD = 28, PADX = 44;
  const ns = tree.nodes || [];
  if (!ns.length) return '<div class="empty">Dieser Baum hat keine Knoten.</div>';
  const xs = ns.map((n) => Number(n.x) || 0), ys = ns.map((n) => Number(n.y) || 0);
  const minx = Math.min(...xs), maxx = Math.max(...xs), maxy = Math.max(...ys), miny = Math.min(...ys);
  const innerW = (maxx - minx) * U + PADX * 2;
  const W = Math.max(150, innerW), H = Math.max(110, (maxy - miny) * U + PAD * 2 + 10);
  const pos = new Map(ns.map((n) => [n.id, [Math.round(((Number(n.x) || 0) - minx) * U + PADX + (W - innerW) / 2), Math.round((maxy - (Number(n.y) || 0)) * U + PAD)]]));
  const unl = new Set(k.unlocked || []), lrn = new Set(k.learnable || []);
  const stOf = (id) => (unl.has(id) ? 'learned' : lrn.has(id) ? 'learnable' : 'locked');
  const lines = (tree.links || []).filter(([a, b]) => pos.has(a) && pos.has(b)).map(([a, b]) => {
    const [x1, y1] = pos.get(a), [x2, y2] = pos.get(b);
    const on = unl.has(a) && unl.has(b);
    const half = !on && ((unl.has(a) && lrn.has(b)) || (unl.has(b) && lrn.has(a)));
    return `<line class="it-link${on ? ' on' : half ? ' half' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const nodes = ns.map((n) => {
    const [x, y] = pos.get(n.id);
    const r = NODE_R[n.type] || 9;
    const st = stOf(n.id);
    const shape = n.type === 'keystone'
      ? `<polygon class="it-shape" points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}"/>`
      : `<circle class="it-shape" cx="${x}" cy="${y}" r="${r}"/>`;
    const inner = n.type === 'start' ? `<circle class="it-core" cx="${x}" cy="${y}" r="${r - 6}"/>` : '';
    const ring = st === 'learnable' ? `<circle class="it-ring" cx="${x}" cy="${y}" r="${r + 5}"/>` : '';
    const sel = selNode === n.id ? `<circle class="it-sel" cx="${x}" cy="${y}" r="${r + 8}"/>` : '';
    const lbl = n.type !== 'minor' ? `<text class="it-lbl" x="${x}" y="${y + r + 12}" text-anchor="middle">${esc(String(n.label || '').slice(0, 16))}</text>` : '';
    const stLabel = st === 'learned' ? 'gelernt' : st === 'learnable' ? 'lernbar' : 'gesperrt';
    return `<g class="it-node s-${st} t-${esc(n.type)}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(`${n.label} (${NODE_TYPE[n.type] || n.type}, ${stLabel})`)}">
      <circle class="it-hit" cx="${x}" cy="${y}" r="${Math.max(r + 6, 20)}"/>${sel}${ring}${shape}${inner}${lbl}</g>`;
  }).join('');
  return `<div class="isk-scroll"><svg class="it-svg" data-key="${esc(tree.id)}" viewBox="0 0 ${W} ${H}" style="--w:${W}px" role="group" aria-label="Skilltree ${esc(tree.className)}">${lines}${nodes}</svg></div>`;
}

function nodeInfoHtml(p, tree, k, skilling) {
  const n = (tree.nodes || []).find((x) => x.id === selNode);
  if (!n) return '<p class="small muted trait-hint">Tippe auf einen Knoten, um ihn zu lesen.</p>';
  const unl = (k.unlocked || []).includes(n.id), lrn = (k.learnable || []).includes(n.id);
  const st = unl ? 'Gelernt' : lrn ? 'Lernbar' : 'Gesperrt';
  const chain = !unl && !lrn ? chainTo(tree, k, n) : null;
  const can = isMine(p) && skilling && live.isAllowed('isekai') && !unl && (lrn || chain);
  const cost = Number(n.cost) || 0;
  const chainTxt = chain ? `<div class="small muted">Über ${chain.n} Knoten erreichbar (zusammen ${fmt(chain.cost)} Punkte).</div>` : '';
  return `<div class="isk-info">
    <div class="isk-info-h"><b>${esc(n.label)}</b><span class="tag">${esc(NODE_TYPE[n.type] || n.type)}</span><span class="isk-st st-${unl ? 'learned' : lrn ? 'learnable' : 'locked'}">${st}</span></div>
    <div class="small muted">Kosten: ${fmt(cost)} Skillpunkt${cost === 1 ? '' : 'e'}</div>
    ${(n.bonuses || []).length ? `<ul class="isk-bonus">${n.bonuses.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    ${n.desc ? `<p class="isk-desc">${esc(n.desc)}</p>` : ''}${!n.desc && !(n.bonuses || []).length ? '<p class="small muted">Keine Beschreibung von der Mod.</p>' : ''}${chainTxt}
    ${can ? `<div class="isk-learn">${actBtn('isekai', `lernen ${n.id}`, 'Lernen', { cls: 'primary', title: 'Diesen Knoten lernen' })}</div>` : ''}
  </div>`;
}

function panelIsekai(p) {
  const k = p.isekai;
  if (!k) return '<div class="empty">Kein Isekai-Charakter.</div>';
  const mine = isMine(p);
  const skilling = k.canSkill ?? !!trees?.skilling; // je Kolonist freigegeben (Haken im Spiel) oder global
  const xpPct = k.xpNext > 0 ? (k.xp / k.xpNext) * 100 : 100;
  const tiles = STATS.map(([id, ab, name]) => {
    const plus = mine && k.statPoints > 0 && skilling && live.isAllowed('isekai') ? actBtn('isekai', `stat ${id} 1`, '+', { cls: 'plus', title: `${name} um 1 erhöhen` }) : '';
    return `<div class="isk-stat" title="${esc(name)}"><span class="k">${ab}</span><b>${fmt(k.stats?.[id])}</b>${plus}</div>`;
  }).join('');
  const head = `<div class="isk-head">
      <span class="isk-lv">Stufe <b>${fmt(k.level)}</b></span>
      ${k.rank ? `<span class="chip">${esc(k.rank)}</span>` : ''}${k.className ? `<span class="chip accent">${esc(k.className)}</span>` : ''}
    </div>
    ${barRow('EP', xpPct, `${fmt(k.xp)} / ${fmt(k.xpNext)}`, 'acc', 'wide')}
    <div class="isk-pts"><span>Skillpunkte <b>${fmt(k.points)}</b></span><span>Stat-Punkte <b>${fmt(k.statPoints)}</b></span></div>
    <div class="isk-stats">${tiles}</div>`;
  let tree = '';
  if (trees === undefined) tree = '<p class="muted small">Skilltree wird geladen …</p>';
  else if (trees === null) tree = '<p class="muted small">Der Skilltree ist gerade nicht verfügbar.</p>';
  else {
    const all = trees.trees || [];
    const own = [...new Set([k.tree, ...(k.entered || [])].filter(Boolean))].map(findTree).filter(Boolean);
    const list = showAllTrees || !own.length ? all : own;
    const cur = list.find((t) => t.id === selTree) || (own.length ? own[0] : null);
    const chips = list.map((t) => `<button type="button" class="chip-btn" data-tree="${esc(t.id)}" aria-pressed="${cur?.id === t.id}">${esc(t.className)}</button>`).join('')
      + (own.length ? `<button type="button" class="chip-btn ghost" data-alltrees="1" aria-pressed="${showAllTrees}">${showAllTrees ? 'Nur meine' : 'Alle Klassen'}</button>` : '');
    tree = `<div class="isk-chips">${chips}</div>`
      + (cur
        ? `${cur.desc ? `<p class="small muted isk-tdesc">${esc(cur.desc)}${cur.gimmick ? ` <b>${esc(cur.gimmick)}</b>${cur.gimmickDesc ? ': ' + esc(cur.gimmickDesc) : ''}` : ''}</p>` : ''}${treeSvg(cur, k)}
          <p class="small muted isk-legend"><i class="lg learned"></i>gelernt <i class="lg learnable"></i>lernbar <i class="lg locked"></i>gesperrt</p>${nodeInfoHtml(p, cur, k, skilling)}`
        : '<p class="small muted trait-hint">Wähle eine Klasse, um ihren Baum anzusehen.</p>');
  }
  return section('Isekai', head) + section('Skilltree', tree);
}

function panelOrigin(p) {
  const row = (k, v) => `<div class="orow"><dt>${esc(k)}</dt><dd>${v == null || v === '' ? '<span class="muted">–</span>' : esc(v)}</dd></div>`;
  // Backstory: antippen (oder am PC drüberfahren) zeigt den Text aus dem Spiel
  const story = (k, title, desc) => {
    if (!title) return row(k, null);
    if (!desc) return row(k, title);
    const key = 'b:' + k;
    const open = openTrait === key;
    return `<div class="orow"><dt>${esc(k)}</dt><dd><button type="button" class="trait story" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(desc)}">${esc(title)}</button>
      ${open ? `<p class="trait-desc">${esc(desc)}</p>` : ''}</dd></div>`;
  };
  const hint = p.childhoodDesc || p.adulthoodDesc ? '<p class="small muted trait-hint">Tippe auf Kindheit oder Erwachsenenleben, um die Geschichte zu lesen.</p>' : '';
  return section('Herkunft', `<dl class="origin">${story('Kindheit', p.childhood, p.childhoodDesc)}${story('Erwachsenenleben', p.adulthood, p.adulthoodDesc)}${row('Aufenthalt', p.location)}${row('Besiegte Gegner', p.kills != null ? fmt(p.kills) : null)}</dl>${hint}`);
}

// Erlebnisse: Unterhaltungen und Kampflog – eigene Abfrage (/api/log), nur solange dieser Unterreiter offen ist
let logKind = lsGet('ys-live-log') || 'social';
const logCache = new Map(); // Pawn-Schlüssel -> letzte Antwort (damit beim Umschalten nichts flackert)

function logListHtml(data) {
  const list = data?.[logKind] || [];
  if (!list.length) return `<div class="empty">${logKind === 'social' ? 'Noch keine Unterhaltungen aufgezeichnet.' : 'Noch keine Kämpfe aufgezeichnet.'}</div>`;
  return `<ol class="logl">${list.map((e) => `<li><span class="log-text">${esc(e.text)}</span><span class="log-ago">vor ${esc(agoDe(e.ago))}</span></li>`).join('')}</ol>`;
}

function panelLog(p) {
  const key = p.id || p.user;
  const btn = (k, label) => `<button type="button" class="seg${logKind === k ? ' on' : ''}" data-logkind="${k}" aria-pressed="${logKind === k}">${label}</button>`;
  return `<div class="log-switch">${btn('social', 'Unterhaltungen')}${btn('combat', 'Kämpfe')}</div>
    <div class="log-host" data-key="${esc(key)}:${logKind}" data-morph-keep data-logfor="${esc(key)}">${logCache.has(key) ? logListHtml(logCache.get(key)) : '<div class="empty">Lade …</div>'}</div>
    <p class="small muted">Die letzten Einträge aus dem Spiel-Log, neueste zuerst.</p>`;
}

function startLogPoll(host) {
  const el = host.querySelector('.log-host');
  if (!el || el._polling) return;
  el._polling = true;
  const key = el.dataset.logfor;
  live.poll({
    path: '/api/log/' + encodeURIComponent(key), every: 10000, alive: () => el.isConnected,
    onResult: (r) => {
      if (r.status === 404) { el.innerHTML = '<div class="empty">Noch keine Einträge – kommt gleich.</div>'; return; }
      if (r.status !== 200 || !r.data) return;
      logCache.set(key, r.data);
      if (!r.unchanged || !el.dataset.filled) { morph(el, logListHtml(r.data)); el.dataset.filled = '1'; }
    },
  });
}

// Beziehungen: Daten aus demselben /api/log/<id> (relations), eigene Abfrage nur solange dieser Unterreiter offen ist
const relSign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(Math.round(Number(v) || 0)));
const relTone = (v) => (v > 0 ? 'good' : v < 0 ? 'doom' : 'neutral');

// Wie im Spiel: ab +20 Freund, ab −20 Rivale. In Worten statt Pfeilen, damit sofort klar ist, wer was über wen denkt.
const relSentence = (subj, obj, v, du) => (v >= 20 ? `${subj} ${du ? 'magst' : 'mag'} ${obj}`
  : v <= -20 ? `${subj} ${du ? 'kannst' : 'kann'} ${obj} nicht leiden` : `${subj} ${du ? 'bist' : 'ist'} ${obj === 'dich' ? 'dir' : obj} gegenüber neutral`);
function relStatus(r) {
  const a = Number(r.opinion) || 0, b = Number(r.theirs) || 0;
  if (a >= 20 && b >= 20) return ['Freunde', 'good'];
  if (a <= -20 && b <= -20) return ['Rivalen', 'doom'];
  if (a >= 20 || b >= 20) return [a <= -20 || b <= -20 ? 'Kompliziert' : 'Einseitig befreundet', 'neutral'];
  if (a <= -20 || b <= -20) return ['Einseitige Abneigung', 'bad'];
  return ['Bekannt', 'neutral'];
}

function relRow(p, r) {
  const mine = isMine(p);
  const me = mine ? 'Du' : p.name;
  const who = r.user ? ` <span class="small muted">@${esc(r.user)}</span>` : '';
  const fam = (r.relations || []).map((x) => `<span class="badge accent">${esc(x)}</span>`).join('');
  const [st, tn] = relStatus(r);
  const status = r.dead ? '<span class="badge neutral">tot</span>' : `<span class="badge ${tn}">${st}</span>`;
  const a = Number(r.opinion) || 0, b = Number(r.theirs) || 0;
  const lines = r.dead ? '' : `<div class="rel-lines small">
      <div><span class="rel-op ${relTone(a)}">${relSign(a)}</span> ${esc(relSentence(me, r.name, a, mine))}</div>
      <div><span class="rel-op ${relTone(b)}">${relSign(b)}</span> ${esc(relSentence(r.name, mine ? 'dich' : p.name, b, false))}</div></div>`;
  return `<li class="rel-row"><div class="rel-main"><b class="rel-name">${esc(r.name)}</b>${who}<span class="rel-badges">${fam}${status}</span></div>${lines}</li>`;
}

function relHtml(p, data) {
  const list = (data?.relations || []).filter((r) => r && !r.animal);
  if (!list.length) return '<div class="empty">Noch keine Beziehungen erfasst.</div>';
  const fam = list.filter((r) => (r.relations || []).length);
  const others = list.filter((r) => !(r.relations || []).length && !r.dead).sort((a, b) => (Number(b.opinion) || 0) - (Number(a.opinion) || 0));
  const famHtml = fam.length ? section('Partner & Familie', `<ul class="rel-list">${fam.map((r) => relRow(p, r)).join('')}</ul>`) : '';
  const othHtml = others.length ? section('Freunde & Rivalen', `<ul class="rel-list">${others.map((r) => relRow(p, r)).join('')}</ul>
    <p class="small muted" style="margin:8px 0 0">Die Zahl ist die Meinung wie im Spiel: ab +20 befreundet, ab −20 Rivalen.</p>`) : '';
  return famHtml + othHtml || '<div class="empty">Noch keine Beziehungen erfasst.</div>';
}

function panelRelations(p) {
  const key = p.id || p.user;
  const cached = logCache.get(key);
  return `<div class="rel-host" data-key="${esc(key)}" data-morph-keep data-logfor="${esc(key)}">${cached ? relHtml(p, cached) : '<div class="empty">Lade …</div>'}</div>`;
}

function startRelPoll(host) {
  const el = host.querySelector('.rel-host');
  if (!el || el._polling) return;
  el._polling = true;
  const key = el.dataset.logfor;
  live.poll({
    path: '/api/log/' + encodeURIComponent(key), every: 10000, alive: () => el.isConnected,
    onResult: (r) => {
      if (r.status === 404) { morph(el, '<div class="empty">Noch keine Einträge – kommt gleich.</div>'); return; }
      if (r.status !== 200 || !r.data || !host._pawn) return;
      logCache.set(key, r.data);
      if (!r.unchanged || !el.dataset.filled) { morph(el, relHtml(host._pawn, r.data)); el.dataset.filled = '1'; }
      refreshBadges(host);
    },
  });
}

// Lebensgeschichte: Erinnerungen (story) aus demselben /api/log, eigene Abfrage nur solange dieser Unterreiter offen ist
function storyHtml(list) {
  if (!Array.isArray(list) || !list.length) return '<div class="empty">Noch keine Erinnerungen erfasst.</div>';
  return `<ol class="story">${list.map((e) => `<li class="st-item">
      <span class="st-day">Tag ${fmt(e.day)}</span>
      <span class="st-text">${esc(e.text)}</span>
      ${e.ago ? `<span class="small muted st-ago">vor ${esc(agoDe(e.ago))}</span>` : ''}</li>`).join('')}</ol>`;
}

function panelStory(p) {
  const key = p.id || p.user;
  const cached = logCache.get(key);
  return `<div class="story-host" data-key="${esc(key)}" data-morph-keep data-logfor="${esc(key)}">${cached ? storyHtml(cached.story) : '<div class="empty">Lade …</div>'}</div>
    <p class="small muted">Die Erinnerungen dieses Kolonisten, neueste zuerst.</p>`;
}

function startStoryPoll(host) {
  const el = host.querySelector('.story-host');
  if (!el || el._polling) return;
  el._polling = true;
  const key = el.dataset.logfor;
  live.poll({
    path: '/api/log/' + encodeURIComponent(key), every: 10000, alive: () => el.isConnected,
    onResult: (r) => {
      if (r.status === 404) { morph(el, '<div class="empty">Noch keine Einträge – kommt gleich.</div>'); return; }
      if (r.status !== 200 || !r.data) return;
      logCache.set(key, r.data);
      if (!r.unchanged || !el.dataset.filled) { morph(el, storyHtml(r.data.story)); el.dataset.filled = '1'; }
    },
  });
}

// Arbeit: kompaktes Raster wie im Spiel. Zahl mit ▲ (wichtiger) / ▼ (unwichtiger); Änderungen werden gesammelt und
// mit EINEM Knopf übernommen (RICS nimmt nur alle 2 s einen Befehl an; mehrere Arbeiten passen in einen Befehl).
const workDraft = new Map(); // Pawn-Schlüssel -> Map(workId -> prio)
const prioUp = (n) => (n === 0 ? 4 : Math.max(1, n - 1));      // wichtiger
const prioDown = (n) => (n === 0 ? 0 : n >= 4 ? 0 : n + 1);     // unwichtiger, nach 4 kommt „aus“

function panelWork(p) {
  const list = Array.isArray(p.work) ? p.work : [];
  if (!list.length) return '<div class="empty">Keine Arbeiten bekannt.</div>';
  const key = p.id || p.user;
  const mine = isMine(p);
  const can = mine && p.workEditable === true && live.isAllowed('mypawn');
  const draft = workDraft.get(key) || new Map();
  const cells = list.map((w) => {
    const cur = Number(w.prio) || 0;
    const val = draft.has(w.id) ? draft.get(w.id) : cur;
    const changed = draft.has(w.id) && draft.get(w.id) !== cur;
    const num = w.disabled ? '✕' : val === 0 ? '–' : String(val);
    const ctl = can && !w.disabled
      ? `<button type="button" class="wk-arrow" data-wk="${esc(w.id)}" data-d="up" aria-label="${esc(w.label)} wichtiger">▲</button>
         <span class="wk-num p${val}">${num}</span>
         <button type="button" class="wk-arrow" data-wk="${esc(w.id)}" data-d="down" aria-label="${esc(w.label)} unwichtiger">▼</button>`
      : `<span class="wk-num p${w.disabled ? 'x' : val}">${num}</span>`;
    return `<div class="wk-cell${w.disabled ? ' off' : ''}${changed ? ' changed' : ''}" title="${esc(w.label)}${w.disabled ? ' – kann dieser Kolonist nicht' : ''}">
      <span class="wk-name">${esc(w.label)}</span><span class="wk-ctl">${ctl}</span></div>`;
  }).join('');
  const n = [...draft.entries()].filter(([id, v]) => (list.find((w) => w.id === id)?.prio ?? -1) !== v).length;
  const bar = can
    ? `<div class="wk-bar"><span class="small muted">1 = am wichtigsten, – = aus.</span>${n ? `<button type="button" class="btn primary" data-wk-apply>Übernehmen (${n})</button><button type="button" class="btn" data-wk-reset>Verwerfen</button>` : ''}</div>`
    : `<p class="small muted" style="margin:0 0 8px">${mine ? 'Ändern erlaubt der Streamer gerade nicht – nur ansehen.' : 'Nur ansehen.'}</p>`;
  return `${bar}<div class="wk-grid">${cells}</div>`;
}

async function applyWork(host) {
  const p = host._pawn;
  if (!p) return;
  const key = p.id || p.user;
  const draft = workDraft.get(key);
  if (!draft) return;
  const changes = [...draft.entries()].filter(([id, v]) => (p.work || []).find((w) => w.id === id && w.prio !== v));
  // in Befehle aufteilen (max. 80 Zeichen Argumente)
  const chunks = [];
  let cur = 'work';
  for (const [id, v] of changes) {
    const part = ` ${id} ${v}`;
    if ((cur + part).length > 78 && cur !== 'work') { chunks.push(cur); cur = 'work'; }
    cur += part;
  }
  if (cur !== 'work') chunks.push(cur);
  const btn = host.querySelector('[data-wk-apply]');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird übernommen …'; }
  try {
    for (let k = 0; k < chunks.length; k++) {
      if (k > 0) await new Promise((r) => setTimeout(r, 2200));
      const msgs = await live.act('mypawn', chunks[k]);
      toast(msgs.length ? msgs.join(' · ') : 'Arbeiten übernommen', 6000);
    }
    workDraft.delete(key);
  } catch (e) {
    toast(e.message, 5000);
  }
  repaint(host);
}

const PANELS = { style: panelStyle, overview: panelOverview, mood: panelMood, log: panelLog, relations: panelRelations, story: panelStory, work: panelWork, isekai: panelIsekai, skills: panelSkills, health: panelHealth, gear: panelGear, goals: panelGoals, origin: panelOrigin };

function subsHtml(p) {
  const vis = visibleSubs(p);
  const cur = vis.some((s) => s.id === curSub) ? curSub : 'overview';
  return `<div class="ch-tabs" role="tablist" aria-label="Bereiche des Charakters">${vis.map((s) =>
    `<button type="button" role="tab" class="ch-tab" data-sub="${s.id}" aria-selected="${s.id === cur}">${esc(s.label)}</button>`).join('')}</div>`;
}
const activeSub = (p) => (visibleSubs(p).some((s) => s.id === curSub) ? curSub : 'overview');

/** Zeichnet Hero + Unterreiter + Inhalt in `host`. Der gewählte Reiter bleibt beim Aktualisieren erhalten. */
/** Herausfordern: nur bei fremden Kolonisten und nur, wenn ich selbst einen Kolonisten habe. Ziel = Twitch-Name bzw. Rufname. */
function duelHtml(p) {
  if (!live.isLinked() || !live.getMe()?.pawn || isMine(p) || !live.isAllowed('duel')) return '';
  return `<div class="duel-row">${actBtn('duel', p.user || p.name || '', '⚔ Herausfordern', {
    confirm: true, armedLabel: 'Wirklich herausfordern?', cls: 'duel-btn', title: `${p.name} zu einer Prügelei herausfordern`,
  })}</div>`;
}

function characterHtml(p) {
  return `<div class="ch" data-key="${esc(p.id || p.user)}">${heroHtml(p)}${duelHtml(p)}${subsHtml(p)}<div class="ch-panel card" role="tabpanel">${PANELS[activeSub(p)](p)}</div></div>`;
}

/** Hintergrundabfragen, die nur zum gerade offenen Unterreiter gehören. */
// Aussehen: Frisur/Bart aus Listen (RICS Addon: !sethair/!setbeard mit DefName), Haar-/Lieblingsfarbe per Farbwähler.
// Daten aus /api/log/<id>.style (10 s). Ändern nur für den eigenen Kolonisten.
let styleFilter = '';

function styleListHtml(p, kind, cur, options) {
  if (!Array.isArray(options)) return '';
  const q = styleFilter.trim().toLowerCase();
  const list = options.filter(([id, label]) => !q || label.toLowerCase().includes(q) || id.toLowerCase().includes(q));
  const mine = isMine(p) && live.isAllowed(kind);
  const chips = list.slice(0, 60).map(([id, label]) => id === cur
    ? `<span class="sty-chip on" title="Aktuell">${esc(label)}</span>`
    : mine ? actBtn(kind, id, label, { confirm: true, armedLabel: `${label}?`, cls: 'sty-chip', title: `Zu „${label}“ wechseln` })
      : `<span class="sty-chip">${esc(label)}</span>`).join('');
  const more = list.length > 60 ? `<p class="small muted">… und ${fmt(list.length - 60)} weitere – oben suchen.</p>` : '';
  return `<div class="sty-chips">${chips || '<span class="small muted">Nichts gefunden.</span>'}</div>${more}`;
}

function colorRow(p, kind, label, value) {
  const mine = isMine(p) && live.isAllowed(kind);
  const v = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#888888';
  return `<div class="sty-color"><span class="sty-swatch" style="background:${esc(v)}"></span><b>${esc(label)}</b>
    ${mine ? `<input type="color" value="${esc(v)}" data-style-color="${kind}" aria-label="${esc(label)} wählen">${actBtn(kind, v, 'Übernehmen', { cls: 'sty-apply', title: `${label} setzen` })}` : ''}</div>`;
}

function styleHtml(p, st) {
  if (!st) return '<div class="empty">Lade …</div>';
  const search = `<input class="search sty-search" type="search" placeholder="Frisur oder Bart suchen …" value="${esc(styleFilter)}" data-style-search>`;
  const hair = section(`Frisur: ${st.hairLabel || '–'}`, styleListHtml(p, 'sethair', st.hair, st.hairOptions));
  const beard = st.beardOptions ? section(`Bart: ${st.beardLabel || 'keiner'}`, styleListHtml(p, 'setbeard', st.beard, st.beardOptions)) : '';
  const colors = section('Farben', `${colorRow(p, 'dyehair', 'Haarfarbe', st.hairColor)}${colorRow(p, 'setfavoritecolor', 'Lieblingsfarbe', st.favColor)}`);
  const hint = isMine(p) ? '<p class="small muted">Antippen, dann zum Bestätigen noch einmal. RICS prüft Preis und ob es zu Genen/Rasse passt.</p>' : '<p class="small muted">Nur ansehen.</p>';
  return `${hint}${search}${hair}${beard}${colors}`;
}

function panelStyle(p) {
  const key = p.id || p.user;
  const cached = logCache.get(key);
  return `<div class="sty-host" data-key="${esc(key)}:style" data-morph-keep data-logfor="${esc(key)}">${styleHtml(p, cached?.style)}</div>`;
}

function startStylePoll(host) {
  const el = host.querySelector('.sty-host');
  if (!el || el._polling) return;
  el._polling = true;
  const key = el.dataset.logfor;
  const draw = () => { if (host._pawn) morph(el, styleHtml(host._pawn, logCache.get(key)?.style)); };
  el._draw = draw; // repaint() zeichnet so auch den Bestätigungs-/Lade-Zustand der Knöpfe
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-style-search]')) {
      styleFilter = e.target.value;
      const pos = e.target.selectionStart;
      draw();
      const inp = el.querySelector('[data-style-search]');
      if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* egal */ } }
    } else if (e.target.matches('[data-style-color]')) {
      const row = e.target.closest('.sty-color');
      const btn = row?.querySelector('.sty-apply');
      if (btn) btn.dataset.args = e.target.value;
      const sw = row?.querySelector('.sty-swatch');
      if (sw) sw.style.background = e.target.value;
    }
  });
  live.poll({
    path: '/api/log/' + encodeURIComponent(key), every: 10000, alive: () => el.isConnected,
    onResult: (r) => {
      if (r.status !== 200 || !r.data) return;
      logCache.set(key, r.data);
      if (!r.unchanged || !el.dataset.filled) {
        if (document.activeElement?.matches?.('[data-style-search], [data-style-color]') && el.contains(document.activeElement)) return; // nicht beim Tippen/Wählen
        draw(); el.dataset.filled = '1';
      }
    },
  });
}

function afterPaint(host) {
  startLogPoll(host);
  startRelPoll(host);
  startStoryPoll(host);
  startStylePoll(host);
  startGoalsPoll(host);
  ensureBadgeLog(host);
  refreshBadges(host);
  if (host._pawn && activeSub(host._pawn) === 'isekai') ensureTrees(host);
}

/** Inhalt des offenen Unterreiters per morph neu zeichnen (kein Flackern, Zustand der Knöpfe bleibt). */
function repaint(host) {
  host.querySelector('.sty-host')?._draw?.();
  const p = host._pawn;
  const panel = host.querySelector('.ch-panel');
  if (!p || !panel) return;
  morph(panel, PANELS[activeSub(p)](p));
  afterPaint(host);
}

function mountCharacter(host, p) {
  host._pawn = p;
  morph(host, characterHtml(p));
  afterPaint(host);
  if (host._bound) return;
  host._bound = true;
  host.addEventListener('click', (e) => {
    const pawn = host._pawn;
    const share = e.target.closest('[data-share]');
    if (share) {
      // Direktlink zur Charakter-Seite (gleiche Adresse wie „Kolonie“ → Kolonist)
      copyText(`${location.origin}${location.pathname}#/kolonie/${encodeURIComponent(share.dataset.share)}`);
      return;
    }
    const sub = e.target.closest('[data-sub]');
    const tr = e.target.closest('[data-trait]');
    const lk = e.target.closest('[data-logkind]');
    const ab = e.target.closest('[data-act]');
    const tc = e.target.closest('[data-tree]');
    const at = e.target.closest('[data-alltrees]');
    const nd = e.target.closest('[data-node]');
    if (pawn && ab) { runAct(host, ab); return; }
    const wk = e.target.closest('[data-wk]');
    if (pawn && wk) {
      const key = pawn.id || pawn.user;
      const d = workDraft.get(key) || new Map();
      const w = (pawn.work || []).find((x) => x.id === wk.dataset.wk);
      const curV = d.has(w.id) ? d.get(w.id) : Number(w.prio) || 0;
      d.set(w.id, wk.dataset.d === 'up' ? prioUp(curV) : prioDown(curV));
      workDraft.set(key, d);
      repaint(host);
      return;
    }
    if (pawn && e.target.closest('[data-wk-apply]')) { applyWork(host); return; }
    if (pawn && e.target.closest('[data-wk-reset]')) { workDraft.delete(pawn.id || pawn.user); repaint(host); return; }
    if (pawn && (tc || at || nd)) {
      if (tc) { selTree = tc.dataset.tree; selNode = null; }
      else if (at) showAllTrees = !showAllTrees;
      else selNode = selNode === nd.dataset.node ? null : nd.dataset.node;
      repaint(host);
      return;
    }
    if (pawn && lk) {
      logKind = lk.dataset.logkind; lsSet('ys-live-log', logKind);
      host.querySelector('.ch-panel').innerHTML = PANELS.log(pawn);
      afterPaint(host);
      return;
    }
    if (!pawn || !(sub || tr)) return;
    if (sub) {
      curSub = sub.dataset.sub; lsSet(SUB_KEY, curSub);
      host.querySelectorAll('.ch-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === curSub)));
      host.querySelector('.ch-panel').innerHTML = PANELS[activeSub(pawn)](pawn);
      afterPaint(host);
    } else {
      openTrait = openTrait === tr.dataset.trait ? null : tr.dataset.trait;
      repaint(host);
    }
  });
  host.addEventListener('keydown', (e) => {
    const nd = e.target.closest?.('[data-node]');
    if (!nd || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    selNode = selNode === nd.dataset.node ? null : nd.dataset.node;
    repaint(host);
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

// Münzen pro Minute (RICS zahlt alle 2 Min. an aktive Zuschauer). Wird bei jedem /api/me aktualisiert.
function rateText(me) {
  const r = Number(me?.coinsPerMinute) || 0;
  if (!r) return '';
  const n = r.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  return me.earning ? `+${n}/Min` : `+0/Min`;
}
function rateTitle(me) {
  if (!me || !Number(me.coinsPerMinute)) return '';
  const n = Number(me.coinsPerMinute).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  return me.earning
    ? `Du verdienst gerade ${n} Münzen pro Minute (Auszahlung alle 2 Minuten). Noch ${me.activeMinutesLeft} Min. aktiv ohne neue Chat-Nachricht.`
    : `Gerade keine Münzen: Schreib etwas in den Twitch-Chat, dann verdienst du wieder ${n} pro Minute.`;
}
const rateHtml = (me) => `<span class="coin-rate${me?.earning ? '' : ' idle'}" data-live-rate title="${esc(rateTitle(me))}">${esc(rateText(me))}</span>`;
function updateRate(me) {
  document.querySelectorAll('[data-live-rate]').forEach((el) => {
    el.textContent = rateText(me);
    el.title = rateTitle(me);
    el.classList.toggle('idle', !me?.earning);
  });
}

function walletHtml(me) {
  const askNotify = 'Notification' in window && Notification.permission === 'default';
  return `<div class="card wallet">
    <div><span class="wallet-label">Deine Münzen</span><div class="wallet-coins">${coinsHtml(me.coins)} ${rateHtml(me)}</div>
      <div class="small muted wallet-rate">${esc(rateTitle(me))}</div></div>
    <div class="wallet-karma"><span class="wallet-label">Karma</span><div><b>${esc(fmt(me.karma))}</b></div></div>
    ${askNotify ? '<button type="button" class="btn notify-btn" data-notify="1">🔔 Benachrichtigungen erlauben</button>' : ''}
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
      const noPawn = `<div class="card live-card"><h2>Du hast noch keinen Kolonisten</h2>
        <p>Schreib <code>${esc(live.prefix())}join</code> in den Chat, um der Kolonie beizutreten. Sobald dir ein Pawn zugeteilt ist, erscheint er hier.</p>
        <div class="cmd-row">${cmdBtn(live.prefix() + 'join')}</div>
        <p class="small" style="margin:12px 0 0"><a href="#/befehle">Alle Befehle ansehen</a></p></div>`;
      morph(host, `${walletHtml(me)}
        <div id="ich-char" style="margin-top:14px">${me.pawn ? characterHtml(me.pawn) : noPawn}</div>
        <p class="ich-foot small muted">Verbunden als <b>${esc(me.displayName || me.user)}</b> · <button type="button" class="linklike" data-live="logout">Abmelden</button></p>`);
      if (me.pawn) mountCharacter(host.querySelector('#ich-char'), me.pawn);
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
  return `<a data-key="${esc(p.id || p.user)}" class="card kol-card${mine ? ' mine' : ''}" href="#/kolonie/${encodeURIComponent(p.id || p.user)}">
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

// Tiere: Gebundene immer einzeln, die übrigen bei vielen Tieren nach Art gruppiert
const openKinds = new Set();
const genderSym = (g) => (/^(w|f)/i.test(g || '') ? '♀' : /^m/i.test(g || '') ? '♂' : '');

function animalRow(a) {
  const name = a.name ? esc(a.name) : esc(a.kind);
  const age = a.age != null ? `${fmt(Math.round(Number(a.age) * 10) / 10)} J.` : '';
  const meta = [genderSym(a.gender), age].filter(Boolean).join(' ');
  return `<div class="an${a.bond ? ' bonded' : ''}">
    <div class="an-top"><b class="an-name">${name}</b>${a.name ? `<span class="small muted">${esc(a.kind)}</span>` : ''}<span class="small muted an-meta">${esc(meta)}</span></div>
    ${bar(a.healthPct)}
    ${a.bond ? `<div class="an-bond"><span class="heart" aria-hidden="true">♥</span> gebunden an <b>${esc(a.bond)}</b></div>` : ''}
    ${a.master ? `<div class="small muted">Meister: ${esc(a.master)}</div>` : ''}
  </div>`;
}

function animalsHtml(list) {
  if (!Array.isArray(list)) return '';
  if (!list.length) return '<p class="muted small" style="margin:0">Keine Tiere in der Kolonie.</p>';
  const bonded = list.filter((a) => a.bond);
  const rest = list.filter((a) => !a.bond);
  let out = bonded.map(animalRow).join('');
  if (list.length <= 8) return out + rest.map(animalRow).join('');
  const groups = new Map();
  rest.forEach((a) => { if (!groups.has(a.kind)) groups.set(a.kind, []); groups.get(a.kind).push(a); });
  for (const [kind, arr] of [...groups].sort((x, y) => x[0].localeCompare(y[0], 'de'))) {
    if (arr.length === 1) { out += animalRow(arr[0]); continue; }
    const open = openKinds.has(kind);
    const worst = Math.min(...arr.map((a) => Number(a.healthPct) || 0));
    out += `<button type="button" class="an an-group" data-kind="${esc(kind)}" aria-expanded="${open}">
      <div class="an-top"><b class="an-name">${esc(kind)} ×${arr.length}</b><span class="small muted an-meta">${open ? '▾' : '▸'}</span></div>
      ${bar(worst)}<div class="small muted">schwächstes Tier: ${Math.round(worst)} %</div></button>`;
    if (open) out += `<div class="an-sub">${arr.map(animalRow).join('')}</div>`;
  }
  return out;
}

// Ranglisten (je Top 5) aus /api/colony – keine Münzen, nur Leistung der Kolonisten
const RANK_CATS = [
  { key: 'kills', title: 'Meiste Gegner', val: (v) => `${fmt(v)} besiegt` },
  { key: 'daysInColony', title: 'Am längsten dabei', val: (v) => `${fmt(v)} Tage` },
  { key: 'isekaiLevel', title: 'Höchste Isekai-Stufe', val: (v) => `Stufe ${fmt(v)}` },
];

function ranksHtml(list) {
  if (!list.length) return '';
  const cards = RANK_CATS.map((c) => {
    const rows = list.filter((p) => Number(p[c.key]) > 0).sort((a, b) => Number(b[c.key]) - Number(a[c.key])).slice(0, 5);
    const body = rows.length
      ? `<ol class="rank-list">${rows.map((p, i) => `<li><a class="rank-row" href="#/kolonie/${encodeURIComponent(p.id || p.user)}">
          <span class="rank-pos">${i + 1}.</span>
          <span class="rank-name">${esc(p.name)}${p.user ? ` <span class="small muted">@${esc(p.displayName || p.user)}</span>` : ''}</span>
          <span class="rank-val">${esc(c.val(p[c.key]))}</span></a></li>`).join('')}</ol>`
      : '<p class="muted small" style="margin:0">Noch keine Werte.</p>';
    return `<section class="card ch-sec"><h4>${esc(c.title)}</h4>${body}</section>`;
  }).join('');
  return `<div class="rank-grid">${cards}</div>`;
}

function colonyList() {
  const html = `<div class="live-page">
    <div class="kol-head"><h2 class="section-title" style="margin:0">Die Kolonie</h2><span class="small muted" id="kol-count"></span></div>
    <div id="kol-grid" class="kol-grid"><div class="empty" style="grid-column:1/-1">Lade …</div></div>
    <div id="kol-ranks"></div>
    <section id="tiere-sec" hidden>
      <div class="kol-head" style="margin-top:22px"><h2 class="section-title" style="margin:0">Tiere</h2><span class="small muted" id="tiere-count"></span></div>
      <div id="tiere" class="an-grid"></div>
    </section></div>`;
  function bind(root) {
    const grid = root.querySelector('#kol-grid'), count = root.querySelector('#kol-count'), ranks = root.querySelector('#kol-ranks');
    let last = '';
    const draw = (data) => {
      const list = Array.isArray(data?.pawns) ? data.pawns : [];
      const me = live.getMe()?.user;
      const key = JSON.stringify([list, me]);
      if (key === last) return;
      last = key;
      count.textContent = list.length ? `${fmt(list.length)} Kolonist${list.length === 1 ? '' : 'en'}` : '';
      morph(grid, list.length ? list.map((p) => colonyCard(p, me)).join('')
        : `<div class="empty" style="grid-column:1/-1">Noch keine Kolonisten zu sehen. Mit <code>${esc(live.prefix())}join</code> im Chat kannst du die Erste oder der Erste sein.</div>`);
      morph(ranks, ranksHtml(list));
    };
    live.poll({
      path: '/api/colony', every: 2000, alive: () => grid.isConnected,
      onResult: (r) => { if (r.status === 200 && !r.unchanged) draw(r.data); },
    });
    whileMounted(grid, [['me', () => { last = ''; }]]);

    // Tiere: eigene 5-s-Abfrage von /api/game, solange diese Ansicht sichtbar ist
    const sec = root.querySelector('#tiere-sec'), box = root.querySelector('#tiere'), tcount = root.querySelector('#tiere-count');
    let animals = null, alast = '';
    const drawAnimals = (force) => {
      if (!Array.isArray(animals)) return;
      const key = JSON.stringify(animals);
      if (!force && key === alast) return;
      alast = key;
      sec.hidden = false;
      tcount.textContent = animals.length ? `${fmt(animals.length)} Tier${animals.length === 1 ? '' : 'e'}` : '';
      morph(box, animalsHtml(animals));
    };
    live.poll({
      path: '/api/game', every: 5000, alive: () => grid.isConnected,
      onResult: (r) => { if (r.status === 200 && r.data && !r.unchanged) { animals = r.data.animalList; drawAnimals(false); } },
    });
    box.addEventListener('click', (e) => {
      const g = e.target.closest('[data-kind]');
      if (!g) return;
      const k = g.dataset.kind;
      if (openKinds.has(k)) openKinds.delete(k); else openKinds.add(k);
      drawAnimals(true);
    });
  }
  return { html, bind };
}

function pawnDetail(user) {
  const html = `<div class="live-page"><p class="back"><a href="#/kolonie">← Alle Kolonisten</a></p><div id="pd-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    window.scrollTo({ top: 0 });
    const host = root.querySelector('#pd-host');
    let last = '', cur = null, vk = null;
    // Verknüpfung oder eigener Kolonist ändert sich: Ansicht neu zeichnen (z. B. Knopf „Herausfordern“)
    const linkKey = () => (live.isLinked() && live.getMe()?.pawn ? 'me' : '-');
    whileMounted(host, [['me', () => { const k = linkKey(); if (cur && k !== vk) { vk = k; mountCharacter(host, cur); } }]]);
    live.poll({
      path: '/api/pawn/' + encodeURIComponent(user), every: 2000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged) return;
        const key = r.status + JSON.stringify(r.data);
        if (key === last) return;
        last = key;
        if (r.status === 200 && r.data) { cur = r.data; vk = linkKey(); mountCharacter(host, r.data); }
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

// Forschung: aktuelles Projekt, je Reiter eine aufklappbare Zeile mit Projektliste
const openRTabs = new Set(), shownLocked = new Set();
let openProj = null;
const PROJ = { 0: ['🔒', 'gesperrt'], 1: ['○', 'erforschbar'], 2: ['▶', 'läuft'], 3: ['✓', 'fertig'] };
const PROJ_ORDER = { 2: 0, 1: 1, 3: 2, 0: 3 };

function researchHtml(res, g) {
  const cur = res ? res.current : g.research;
  let html = cur
    ? `<div class="rs-cur"><b>${esc(cur.label)}</b></div>${barRow('Stand', cur.pct, `${Math.round(clamp(cur.pct))} %`, 'acc', 'wide')}`
    : '<p class="muted small" style="margin:0">Keine laufende Forschung.</p>';
  if (!res?.tabs?.length) return html;
  html += '<div class="rs-tabs">' + res.tabs.map((t) => {
    const open = openRTabs.has(t.label);
    const pct = t.total > 0 ? (t.done / t.total) * 100 : 0;
    let body = '';
    if (open) {
      const all = [...(t.projects || [])].sort((a, b) => PROJ_ORDER[a.state] - PROJ_ORDER[b.state]);
      const locked = all.filter((x) => x.state === 0);
      const showL = shownLocked.has(t.label);
      const vis = showL ? all : all.filter((x) => x.state !== 0);
      body = `<ul class="rs-list">${vis.map((x) => {
        const key = t.label + '|' + x.label;
        const [ico, name] = PROJ[x.state] || PROJ[0];
        const o = openProj === key;
        return `<li><button type="button" class="rs-proj st-${x.state in PROJ ? x.state : 0}" data-rproj="${esc(key)}" aria-expanded="${o}" title="${esc(name)}">
          <span class="rs-ico" aria-hidden="true">${ico}</span><span class="rs-pl">${esc(x.label)}</span>${x.state === 2 ? `<span class="rs-pct">${Math.round(clamp(x.pct))} %</span>` : ''}<span class="sr-only">${esc(name)}</span></button>
          ${o && x.desc ? `<p class="trait-desc">${esc(x.desc)}</p>` : ''}</li>`;
      }).join('')}</ul>${locked.length ? `<button type="button" class="linklike rs-locked" data-rlocked="${esc(t.label)}">${showL ? 'Gesperrte ausblenden' : `+${locked.length} gesperrt`}</button>` : ''}`;
    }
    return `<div class="rs-tab-wrap"><button type="button" class="rs-tab" data-rtab="${esc(t.label)}" aria-expanded="${open}">
      <span class="rs-name">${esc(t.label)}</span><span class="rs-count">${fmt(t.done)}/${fmt(t.total)}</span>${bar(pct, 'acc')}<span class="rs-chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button>${body}</div>`;
  }).join('') + '</div>';
  return html;
}

// Zahl oder Text aus der Mod: Zahlen eindeutschen, Text entschärfen
const valTxt = (v) => (typeof v === 'number' ? fmt(v) : esc(v ?? ''));

/** Gemeinschaftsziele (RICS Extras): Fortschritt, Belohnung, Top-3. */
function goalsHtml(goals) {
  if (!Array.isArray(goals) || !goals.length) return '<p class="muted small" style="margin:0">Gerade keine Gemeinschaftsziele.</p>';
  return `<ul class="goal-list gc-list">${goals.map((g) => {
    const cur = Number(g.current) || 0, tgt = Number(g.target) || 0;
    const pct = tgt > 0 ? (cur / tgt) * 100 : 0;
    const top = (g.top || []).slice(0, 3).map((t) => `<li><span class="gt-user">${esc(t.user)}</span> <span class="muted">${valTxt(t.amount)}</span></li>`).join('');
    return `<li class="gc${g.done ? ' done' : ''}">
      <div class="gc-top"><div><b>${esc(g.title)}</b>${g.what ? `<div class="small muted">${esc(g.what)}</div>` : ''}</div>${g.done ? '<span class="badge good">Geschafft</span>' : ''}</div>
      <div class="gc-bar">${bar(pct, g.done ? 'good' : 'acc')}<span class="gc-num">${fmt(cur)} / ${fmt(tgt)}</span></div>
      ${g.reward != null && g.reward !== '' ? `<div class="small"><span class="tag">Belohnung</span> ${valTxt(g.reward)}</div>` : ''}
      ${top ? `<ol class="gc-top3" aria-label="Beste Beiträge">${top}</ol>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

/** Vorräte (RICS Extras): Essen in Tagen und Kacheln. */
function stockHtml(s) {
  if (!s) return '<p class="muted small" style="margin:0">Keine Angaben zu den Vorräten.</p>';
  const days = Number(s.foodDays) || 0;
  const tn = days >= 10 ? 'good' : days >= 4 ? 'mid' : 'low';
  const tiles = (s.items || []).map((i) => `<div class="stock-tile"><span class="st-label">${esc(i.label)}</span><b>${fmt(i.count)}</b></div>`).join('');
  return `<div class="stock-food ${tn}"><span>Essen reicht für</span><b>${fmt(days)} ${days === 1 ? 'Tag' : 'Tage'}</b><span class="small muted">Nährwert ${fmt(s.foodNutrition)}</span></div>
    ${tiles ? `<div class="stock-grid">${tiles}</div>` : '<p class="muted small" style="margin:8px 0 0">Keine Vorräte erfasst.</p>'}`;
}

/** Koloniewert-Verlauf (wealthHistory: [Tag, Wert]). Die Linie ist ein SVG ohne Text; Beschriftung kommt als HTML, damit sie nicht skaliert. */
function wealthHtml(hist) {
  const pts = (Array.isArray(hist) ? hist : [])
    .filter((x) => Array.isArray(x) && Number.isFinite(Number(x[0])) && Number.isFinite(Number(x[1])))
    .map(([d, v]) => [Number(d), Number(v)])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return '<p class="muted small" style="margin:0">Noch zu wenig Tage für einen Verlauf.</p>';
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 300, H = 120, TOP = 6, BOT = 114;
  const xy = pts.map(([, v], i) => [(i / (pts.length - 1)) * W, BOT - ((v - lo) / span) * (BOT - TOP)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const first = pts[0], last = pts[pts.length - 1];
  const diff = last[1] - first[1];
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const tn = diff > 0 ? 'good' : diff < 0 ? 'doom' : 'neutral';
  return `<div class="wv-head"><b>${fmt(last[1])} Silber</b><span class="wv-diff ${tn}">${sign}${fmt(Math.abs(Math.round(diff)))} seit Tag ${fmt(first[0])}</span></div>
    <div class="wv-plot">
      <span class="wv-hi">${fmt(Math.round(hi))}</span><span class="wv-lo">${fmt(Math.round(lo))}</span>
      <svg class="wv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Koloniewert von Tag ${fmt(first[0])} bis Tag ${fmt(last[0])}">
        <line class="wv-grid" x1="0" x2="${W}" y1="${TOP}" y2="${TOP}"/>
        <line class="wv-grid" x1="0" x2="${W}" y1="${BOT}" y2="${BOT}"/>
        <path class="wv-area" d="${area}"/>
        <path class="wv-line" d="${line}"/>
      </svg></div>
    <div class="wv-axis small muted"><span>Tag ${fmt(first[0])}</span><span>Tag ${fmt(last[0])}</span></div>`;
}

/** Fraktionen: Verbündet vor Neutral vor Feindlich, dann nach Wohlwollen. Wohlwollen −100…+100 als Balken. */
const FAC_REL = { ally: ['Verbündet', 'good', 'good', 0], neutral: ['Neutral', 'neutral', 'acc', 1], hostile: ['Feindlich', 'doom', 'doom', 2] };
function factionsHtml(list) {
  const arr = (Array.isArray(list) ? list : []).slice().sort((a, b) =>
    ((FAC_REL[a.relation] || FAC_REL.neutral)[3] - (FAC_REL[b.relation] || FAC_REL.neutral)[3]) || (Number(b.goodwill) || 0) - (Number(a.goodwill) || 0));
  if (!arr.length) return '<p class="muted small" style="margin:0">Keine Fraktionen bekannt.</p>';
  return `<ul class="fac-list">${arr.map((f) => {
    const [label, badgeTn, barTn] = FAC_REL[f.relation] || FAC_REL.neutral;
    const gw = Number(f.goodwill) || 0;
    const gwBar = f.hasGoodwill
      ? `<div class="fac-bar">${bar((clamp(gw, -100, 100) + 100) / 2, barTn)}<span class="fac-num ${relTone(gw)}">${relSign(gw)}</span></div>`
      : '<div class="small muted">Wohlwollen unbekannt</div>';
    return `<li class="fac"><div class="fac-top"><div><b>${esc(f.name)}</b>${f.kind ? ` <span class="small muted">· ${esc(f.kind)}</span>` : ''}</div><span class="badge ${badgeTn}">${label}</span></div>${gwBar}</li>`;
  }).join('')}</ul>`;
}

/** Besucher & Händler: Gruppen und Handelsschiffe. Ohne beides gar keine Karte (Abschnitt entfällt). */
function visitorsHtml(v) {
  const groups = Array.isArray(v?.groups) ? v.groups : [];
  const ships = Array.isArray(v?.ships) ? v.ships : [];
  if (!groups.length && !ships.length) return '';
  const gl = groups.map((x) => `<li><b>${esc(x.faction)}</b>${x.count != null ? ` <span class="muted">×${fmt(x.count)}</span>` : ''}${x.trader ? ` <span class="tag">Händler: ${esc(x.trader)}</span>` : ''}</li>`).join('');
  const sl = ships.map((s) => `<li><span class="tag">Schiff</span> ${esc(s)}</li>`).join('');
  return `<section class="card ch-sec"><h4>Besucher & Händler</h4><ul class="plain vis-list">${gl}${sl}</ul></section>`;
}

function spielHtml(g, res) {
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
  return `<div class="gstats">${stats}</div>
    <div class="grid cols-2" style="margin-top:12px">
      <section class="card ch-sec"><h4>Gerade los</h4>${conds}</section>
      <section class="card ch-sec"><h4>Was zuletzt passiert ist</h4>${evs}</section>
      <section class="card ch-sec rs-card" style="grid-column:1/-1"><h4>Forschung</h4>${researchHtml(res, g)}</section>
      <section class="card ch-sec" style="grid-column:1/-1"><h4>Gemeinschaftsziele</h4>${goalsHtml(g.goals)}</section>
      <section class="card ch-sec" style="grid-column:1/-1"><h4>Koloniewert-Verlauf</h4>${wealthHtml(g.wealthHistory)}</section>
      <section class="card ch-sec"><h4>Vorräte</h4>${stockHtml(g.stock)}</section>
      <section class="card ch-sec"><h4>Fraktionen</h4>${factionsHtml(g.factions)}</section>
      ${visitorsHtml(g.visitors)}
      <section class="card ch-sec"><h4>Erzähler</h4><p style="margin:0"><b>${esc(g.storyteller)}</b></p><p class="muted small" style="margin:4px 0 0">Schwierigkeit: ${esc(g.difficulty)}</p></section>
    </div>`;
}

export function spielView() {
  const html = `<div class="live-page"><div id="spiel-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    const host = root.querySelector('#spiel-host');
    let game = null, research = null, last = '';
    const draw = (force) => {
      if (!game) return;
      const key = JSON.stringify([game, research]);
      if (!force && key === last) return;
      last = key;
      morph(host, spielHtml(game, research));
    };
    live.poll({
      path: '/api/game', every: 5000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged || r.status !== 200 || !r.data) return;
        game = r.data;
        draw(false);
      },
    });
    // Forschung: eigene Abfrage alle 30 s, nur solange „Spiel“ offen ist
    live.poll({
      path: '/api/research', every: 30000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged) return;
        if (r.status === 200 && r.data) research = r.data;
        else if (r.status === 404) research = null;
        else return;
        draw(false);
      },
    });
    host.addEventListener('click', (e) => {
      const t = e.target.closest('[data-rtab]'), pj = e.target.closest('[data-rproj]'), lk = e.target.closest('[data-rlocked]');
      if (!t && !pj && !lk) return;
      const flip = (set, k) => { if (set.has(k)) set.delete(k); else set.add(k); };
      if (t) flip(openRTabs, t.dataset.rtab);
      else if (lk) flip(shownLocked, lk.dataset.rlocked);
      else openProj = openProj === pj.dataset.rproj ? null : pj.dataset.rproj;
      draw(true);
    });
  }
  return { html, bind };
}

// =====================================================================
// Ansicht „Ereignisse“ (nur live): Chronik der letzten Briefe, /api/events alle 10 s, nur solange offen
// =====================================================================
const EV_FILTERS = [['all', 'Alle'], ['threat', 'Gefahr'], ['bad', 'Schlecht'], ['good', 'Gut'], ['neutral', 'Neutral']];
let evFilter = 'all';
const evOpen = new Set();   // aufgeklappte Einträge (über Schlüssel, übersteht Aktualisierungen)
const evKey = (e) => `${e.day}|${e.label}|${e.ago}`;

function eventsLiveHtml(list) {
  const filters = `<div class="ev-filter" role="group" aria-label="Nach Art filtern">${EV_FILTERS.map(([k, l]) =>
    `<button type="button" class="seg${evFilter === k ? ' on' : ''}" data-evf="${k}" aria-pressed="${evFilter === k}">${l}</button>`).join('')}</div>`;
  if (!list.length) return `${filters}<div class="empty">Noch keine Briefe aufgezeichnet.</div>`;
  const shown = list.filter((e) => evFilter === 'all' || e.kind === evFilter);
  if (!shown.length) return `${filters}<div class="empty">Keine Ereignisse in dieser Art.</div>`;
  return `${filters}<ol class="ev-list">${shown.map((e) => {
    const kind = KIND_LABEL[e.kind] ? e.kind : 'neutral';
    const key = evKey(e), open = evOpen.has(key);
    return `<li class="ev k-${kind}">
      <button type="button" class="ev-main" data-evopen="${esc(key)}" aria-expanded="${open}">
        <span class="gdot" aria-hidden="true"></span>
        <span class="ev-label">${esc(e.label)}</span>
        <span class="ev-meta small muted">Tag ${fmt(e.day)} · vor ${esc(agoDe(e.ago))}</span>
        <span class="ev-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
      </button>
      ${open && e.text ? `<p class="ev-text">${esc(e.text)}</p>` : ''}
    </li>`;
  }).join('')}</ol>`;
}

export function ereignisseView() {
  const html = `<div class="live-page"><h2 class="section-title" style="margin:0 0 10px">Ereignisse</h2><div id="ev-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    const host = root.querySelector('#ev-host');
    let list = null, last = '';
    const draw = (force) => {
      if (!list) return;
      const key = JSON.stringify([list, evFilter, [...evOpen]]);
      if (!force && key === last) return;
      last = key;
      morph(host, eventsLiveHtml(list));
    };
    live.poll({
      path: '/api/events', every: 10000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged || r.status !== 200 || !r.data) return;
        list = Array.isArray(r.data.events) ? r.data.events : [];
        draw(false);
      },
    });
    host.addEventListener('click', (e) => {
      const f = e.target.closest('[data-evf]'), o = e.target.closest('[data-evopen]');
      if (!f && !o) return;
      if (f) evFilter = f.dataset.evf;
      else { const k = o.dataset.evopen; if (evOpen.has(k)) evOpen.delete(k); else evOpen.add(k); }
      draw(true);
    });
  }
  return { html, bind };
}

// =====================================================================
// Ansicht „Gedenken“ (nur live): Gedenkwand aus /api/game (memorials), alle 5 s, nur solange offen
// =====================================================================
function memorialCard(m) {
  const joined = m.joinedDay != null ? `Tag ${fmt(m.joinedDay)}` : null;
  const died = m.diedDay != null ? `Tag ${fmt(m.diedDay)}` : null;
  const facts = [
    m.cause ? ['Ursache', m.cause] : null,
    joined || died ? ['In der Kolonie', [joined, died].filter(Boolean).join(' – ')] : null,
    m.age != null ? ['Alter', `${fmt(m.age)} Jahre`] : null,
    m.kills != null ? ['Besiegte Gegner', fmt(m.kills)] : null,
  ].filter(Boolean);
  const full = m.fullName && m.fullName !== m.name ? `<div class="small muted">${esc(m.fullName)}</div>` : '';
  const who = m.user ? `<div class="small muted">@${esc(m.user)}</div>` : '';
  return `<article class="card memo">
    <span class="memo-cross" aria-hidden="true">†</span>
    <h3 class="memo-name">${esc(m.name || '?')}</h3>
    ${full}${who}
    <dl class="memo-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${m.ago ? `<p class="small muted memo-ago">Verstorben vor ${esc(agoDe(m.ago))}</p>` : ''}
  </article>`;
}

function memorialsHtml(list) {
  if (!list.length) return '<div class="empty">Noch niemand gestorben.</div>';
  return `<div class="memo-grid">${list.map(memorialCard).join('')}</div>`;
}

export function gedenkenView() {
  const html = `<div class="live-page"><h2 class="section-title" style="margin:0 0 6px">Gedenken</h2>
    <p class="small muted" style="margin:0 0 14px">Die Kolonisten, die gefallen sind, bleiben hier in Erinnerung.</p>
    <div id="memo-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    const host = root.querySelector('#memo-host');
    let last = null;
    live.poll({
      path: '/api/game', every: 5000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged || r.status !== 200 || !r.data) return;
        const list = Array.isArray(r.data.memorials) ? r.data.memorials : [];
        const key = JSON.stringify(list);
        if (key === last) return;
        last = key;
        morph(host, memorialsHtml(list));
      },
    });
  }
  return { html, bind };
}
