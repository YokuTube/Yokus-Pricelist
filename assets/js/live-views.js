// RICS Live – Oberfläche: Live-Leiste, Verbinden-Dialog, Kauf-Dialog, Tabs „Ich“ und „Kolonie“, Charakter-Ansicht.
// Alle Texte aus der Schnittstelle sind Zuschauernamen/Spielinhalte und werden mit esc() entschärft.
import { esc as escRaw, fmt, copyText, toast, cmdBtn, morph, scrollPageTo } from './util.js';
import * as live from './live.js';
// Alle Anzeigetexte aus der Mod laufen durch esc(): erst Unity-Rich-Text (<color=..>, <b> …) entfernen, dann entschärfen.
const esc = (s) => escRaw(live.stripTags(s));
import { CHAT_POPOUT as CHAT_URL } from './stream.js';
import { panelGenes, hasGenes } from './live-genes.js';
import * as A from './live-visual-a.js';
import { optionPic } from './event-pics.js';
import { fillAll as fillPics } from './pics.js';
import * as vb from './live-visual-b.js';   // Paket B: Symbole statt Text

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
  return `<div class="brow ${cls}"><span class="bl">${esc(label)}</span>${bar(pct, tn)}<span class="bv">${esc(text ?? Math.round(Number.isFinite(Number(pct)) ? Number(pct) : 0) + ' %')}</span></div>`;
}

// Stimmung als feste Skala 0–100 %: Balken füllt sich bis zur Stimmung, Farbe = Zustand (Zusammenbruch-Grenzen aus
// PawnDetail.breaks in Prozent; fehlen sie → normaler Balken). Grenzen nur als dünne Striche, nichts wird gestaucht.
const BREAK_NAMES = [['extreme', 'extremer Zusammenbruch'], ['major', 'großer Zusammenbruch'], ['minor', 'kleiner Zusammenbruch']];
function moodRow(p, text, legend = false) {
  if (p.moodPct == null) return '';
  const b = p.breaks;
  const th = b && typeof b === 'object' ? BREAK_NAMES.filter(([k]) => b[k] != null && Number.isFinite(Number(b[k]))).map(([k, l]) => [k, l, clamp(b[k])]) : [];
  if (!th.length) return barRow('Stimmung', p.moodPct, text);
  const v = clamp(p.moodPct);
  const cuts = th.slice().sort((x, y) => x[2] - y[2]);
  // Zustand: unter der tiefsten Grenze = extrem, darunter gestaffelt; Grenzen können fehlen → dann greifen die vorhandenen
  const hit = cuts.find(([, , x]) => v < x);
  const st = hit ? hit[0] : 'ok';
  const msg = { extreme: 'Gefahr: extremer Zusammenbruch', major: 'Gefahr: großer Zusammenbruch', minor: 'Gefahr: kleiner Zusammenbruch', ok: 'Stabil – kein Zusammenbruch' }[st];
  const top = cuts[cuts.length - 1][2];
  const ticks = cuts.map(([k, l, x]) => `<b class="mood-tick t-${k}" style="left:${x}%" title="${esc(l)} unter ${Math.round(x)} %"></b>`).join('');
  const title = `Stimmung ${Math.round(v)} % · ` + cuts.map(([, l, x]) => `${l} unter ${Math.round(x)} %`).join(' · ');
  const leg = legend ? `<div class="mood-leg small muted" aria-hidden="true">${cuts.slice().reverse().map(([k, l, x]) => `<span><i class="t-${k}"></i>${esc(l)} &lt; ${Math.round(x)} %</span>`).join('')}</div>` : '';
  const label = text && String(text).trim() && String(text).trim() !== `${Math.round(v)} %` ? esc(text) : '';
  // Farbe = Stimmung selbst (schlecht/mittel nie grün); ein Zusammenbruch-Risiko kann sie nur verschlechtern
  // (manche Kolonisten haben durch Mods/Eigenschaften fast keine Grenzen mehr – dann zählt allein der Wert)
  const byValue = v < 20 ? 0 : v < 35 ? 1 : v < 50 ? 2 : v < 65 ? 3 : 4;
  const byRisk = { extreme: 0, major: 1, minor: 2, ok: 4 }[st];
  const col = ['ext', 'maj', 'min', 'mid', 'good'][Math.min(byValue, byRisk)];
  return `<div class="brow mood-row m-${st} c-${col}"><span class="bl">Stimmung</span>`
    + `<span class="mood-scale" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}" aria-label="${esc(title)}" title="${esc(title)}">`
    + `<i class="mood-zone" style="width:${top}%"></i><i class="mood-fill" style="width:${v}%"></i>${ticks}</span>`
    + `<span class="bv mood-pct">${Math.round(v)} %</span>`
    + `<span class="mood-state"><i class="mood-dot-s" aria-hidden="true"></i><span class="mood-txt">${label ? `<b>${label}</b> · ` : ''}${msg}</span></span></div>${leg}`;
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

let linkDlgOpen = false;
export function openLinkDialog() {
  if (linkDlgOpen) return;
  linkDlgOpen = true;
  const d = makeDialog(`
    <h3>Mit Twitch verbinden</h3>
    <div id="ld-main" class="ld-main"><p class="muted">Code wird geholt …</p></div>
    <div class="ld-actions"><button type="button" class="btn" data-close>Schließen</button></div>`);
  const main = d.querySelector('#ld-main');
  let alive = true, pollTimer = null, clock = null;
  d.addEventListener('close', () => { alive = false; linkDlgOpen = false; clearTimeout(pollTimer); clearInterval(clock); });

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


// =====================================================================
// Live-Leiste im Kopf
// =====================================================================
let strip = null;
let stripName = null;
let barGame = null, barPawns = null, barPolling = false;

const badPortraits = new Map();   // Porträt-Adresse -> Zeitpunkt des Fehlers: danach 60 s lang direkt der Platzhalter, kein erneutes <img>
const isBadPortrait = (u) => { const t = badPortraits.get(u); if (t == null) return false; if (Date.now() - t > 60000) { badPortraits.delete(u); return false; } return true; };
const MOOD_TONE = (p) => (p.state === 'downed' || p.state === 'mental' ? 'low' : tone(p.moodPct ?? p.healthPct ?? 100));

function gameChipsHtml(g) {
  return A.stripChipsHtml(g);
}

function pawnBarHtml(list) {
  if (!list?.length) return '';
  const me = live.getMe()?.user;
  return list.map((p) => {
    const mine = p.user && p.user === me;
    const mood = p.moodPct == null ? null : Math.round(p.moodPct);
    const ini = esc((p.name || '?').charAt(0).toUpperCase());
    const img = p.portrait && !isBadPortrait(live.portraitUrl(p.id || p.user, p.portrait))
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
  live.poll({ path: '/api/game', every: 5000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barGame = r.data; giftPrice = Number(r.data?.giftPrice) || 0; fillBar(); } } });
  live.poll({ path: '/api/colony', every: 2000, alive, onResult: (r) => { if (r.status === 200 && !r.unchanged) { barPawns = r.data?.pawns || []; noteColony(barPawns); fillBar(); } } });
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

const voteKey = (opts) => (voteState?.kind === 'frage' ? String(voteState.question || '') + '#' : '') + opts.map((o) => o.label).join('|');
const isFrage = (v) => v?.kind === 'frage';
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
  const frage = isFrage(v);
  const canVote = linked && (mine == null || frage) && live.isAllowed('vote');   // bei Fragen darf man umstimmen
  const rows = opts.map((o, i) => {
    const n = i + 1, pct = clamp(o.pct), isMine = mine === n;
    const inner = `<span class="vb-fill" style="width:${pct}%"></span><span class="vb-n">${n}</span>${frage ? '' : optionPic(o.defName || o.def, o.label, o.karma, 40)}<span class="vb-l">${esc(o.label)}</span><span class="vb-p">${isMine ? '✓ ' : ''}${Math.round(pct)} %${o.count ? ` · ${fmt(o.count)}` : ''}</span>`;
    return `<li class="vote-opt${isMine ? ' mine' : ''}">${canVote
      ? `<button type="button" class="vote-big${frage ? '' : ' with-pic'}" data-vote="${n}" title="Für Nr. ${n} stimmen"${voteBusy ? ' disabled' : ''}>${inner}</button>`
      : `<div class="vote-big${frage ? '' : ' with-pic'} static${isMine ? ' mine' : ''}">${inner}</div>`}</li>`;
  }).join('');
  const note = linked && live.isAllowed('vote') && !frage ? '' : `<p class="small muted vote-note">${frage && linked && live.isAllowed('vote') ? 'Oder schreib' : 'Schreib'} die Zahl (1–${opts.length}) in den Chat${linked ? '.' : ', oder verbinde dich oben, um hier abzustimmen.'}</p>`;
  if (frage) {
    return `<div class="vote-head vote-q-head"><b>🗳 Frage von Yoku</b><span class="vt-left">Noch ${voteLeft()} s</span></div>
    <p class="vote-q">${esc(v.question || '')}</p>
    <ol class="vote-opts">${rows}</ol><p class="small muted vote-total">${fmt(v.total)} Stimmen</p>${note}`;
  }
  return `<div class="vote-head"><b>🗳 Abstimmung</b><span class="vt-left">Noch ${voteLeft()} s</span><span class="small muted">${fmt(v.total)} Stimmen</span></div>
    <ol class="vote-opts">${rows}</ol>${note}`;
}

function startVoteTick() {
  if (voteTick) return;
  voteTick = setInterval(() => { const el = voteEl?.querySelector('.vt-left'); if (el) el.textContent = `Noch ${voteLeft()} s`; }, 1000);
}
function stopVoteTick() { clearInterval(voteTick); voteTick = null; }

// Einklappen: pro Abstimmung gemerkt; sie startet als Pille (überall), nach eigener Stimme klappt sie ein.
const voteSig = () => (isFrage(voteState) ? String(voteState.question || '') + '#' : '') + (voteState?.options || []).map((o) => o.label).join('|');
function voteMinimized() {
  let st = null;
  try { st = JSON.parse(sessionStorage.getItem('ys-vote-min') || 'null'); } catch { /* egal */ }
  if (st && st.sig === voteSig()) return st.min;
  // Standard: Pille (aufklappbar, nach der Wahl wieder eingeklappt). Im Show-Reiter steht die Frage schon groß im Reiter.
  return !isFrage(voteState) || (document.body.classList.contains('show-mode') && location.hash.startsWith('#/show'));
}
function setVoteMin(min) {
  try { sessionStorage.setItem('ys-vote-min', JSON.stringify({ sig: voteSig(), min })); } catch { /* egal */ }
  renderVote();
}

function announceVote() {
  const v = voteState?.open && live.isLive() ? voteState : null;
  const opts = v?.options || [];
  const detail = v ? { state: v, at: voteAt, mine: myVote(opts), busy: voteBusy } : null;
  window.__ysVoteDetail = detail;   // für Ansichten, die später geladen werden (Show-Reiter)
  try { window.dispatchEvent(new CustomEvent('ys-vote-state', { detail })); } catch { /* egal */ }
}
window.addEventListener('hashchange', () => { if (isFrage(voteState)) renderVote(); });
window.addEventListener('ys-vote-cast', (e) => { const n = Number(e.detail?.n); if (n >= 1) castVote(n); });

function renderVote() {
  announceVote();
  if (!voteEl) return;
  if (!voteState?.open || !live.isLive()) {
    voteEl.hidden = true; stopVoteTick(); morph(voteEl, '');
    return;
  }
  voteEl.hidden = false;
  const min = voteMinimized();
  voteEl.classList.toggle('min', min);
  if (min) {
    stopVoteTick();
    const left = Math.max(0, Math.round((voteState.secondsLeft || 0) - (Date.now() - voteAt) / 1000));
    morph(voteEl, `<button type="button" class="vote-pill" data-vote-toggle aria-label="Abstimmung aufklappen">🗳 ${isFrage(voteState) ? 'Frage' : 'Abstimmung'} · noch ${left} s <span aria-hidden="true">▴</span></button>`);
    return;
  }
  morph(voteEl, `<button type="button" class="vote-min" data-vote-toggle aria-label="Abstimmung einklappen" title="Einklappen">▾</button>${voteHtml(voteState)}`);
  fillPics(voteEl);
  startVoteTick();
}

async function castVote(n) {
  if (voteBusy || !voteState?.open) return;
  const opts = voteState.options || [];
  voteBusy = true; renderVote();
  try {
    const msgs = await live.act('vote', String(n));
    // Klingt die Antwort nach Ablehnung (schon abgestimmt, beendet, ungültig …), die Stimme nicht als abgegeben merken
    if (msgs.some((m) => /schon|bereits|beendet|nicht|kein|ungültig|already|not/i.test(m))) {
      toast(msgs.join(' · '), 5000);
    } else {
      rememberVote(opts, n);
      toast(msgs.length ? msgs.join(' · ') : `Stimme ${n} abgegeben`, 4000);
      if (!isFrage(voteState)) setVoteMin(true); // nach der eigenen Stimme Platz machen (Fragen bleiben offen: man kann umstimmen)
    }
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

// ---------- Duell: eingehende Herausforderung als Streifen unten (kein Vollbild-Fenster, nichts wird abgedunkelt) ----------
let duelStrip = null, duelKey = null, duelDismissed = null, duelTimer = null;

function closeDuel() {
  clearInterval(duelTimer); duelTimer = null;
  duelStrip?.remove(); duelStrip = null;
}

function answerDuel(v) {
  duelDismissed = duelKey;
  closeDuel();
  live.act('duel', v)
    .then((msgs) => toast(msgs.length ? msgs.join(' · ') : (v === 'ja' ? 'Angenommen – der Kampf kommt.' : 'Abgelehnt.'), 6000))
    .catch((e) => toast(e.message, 5000));
}

function handleDuel() {
  const inc = live.isLive() && live.isAllowed('duel') ? (live.getMe()?.pawn?.duelIncoming || null) : null;
  if (!inc) { duelDismissed = null; duelKey = null; closeDuel(); return; }
  const key = `${inc.from}|${inc.fromUser || ''}`;
  if (duelStrip?.isConnected && duelKey === key) return;   // läuft schon
  if (duelDismissed === key) return;                        // schon weggeklickt
  closeDuel();
  duelKey = key;
  const total = Math.max(1, Math.round(Number(inc.secondsLeft) || 0));
  const t0 = Date.now();
  const el = document.createElement('div');
  el.className = 'duel-strip';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<span class="ds-ico" aria-hidden="true">⚔</span>
    <span class="ds-text"><span class="ds-line"><b>${esc(inc.from)}</b> fordert dich heraus!</span><span class="ds-time"><i aria-hidden="true">⏱</i> <b id="duel-left">${total}</b> s</span></span>
    <button type="button" class="ds-btn yes" data-duel="ja"><span aria-hidden="true">✓</span> Annehmen</button>
    <button type="button" class="ds-btn no" data-duel="nein"><span aria-hidden="true">✕</span> Ablehnen</button>
    <span class="ds-bar" aria-hidden="true"><i id="duel-bar"></i></span>`;
  document.body.appendChild(el);
  duelStrip = el;
  el.querySelectorAll('[data-duel]').forEach((b) => b.addEventListener('click', () => answerDuel(b.dataset.duel)));
  const out = el.querySelector('#duel-left'), barEl = el.querySelector('#duel-bar');
  const tick = () => {
    const left = Math.max(0, total - Math.round((Date.now() - t0) / 1000));
    if (out) out.textContent = left;
    if (barEl) barEl.style.width = (left / total * 100) + '%';
    if (left <= 0) { duelDismissed = duelKey; closeDuel(); }   // Zeit um: gilt als abgelehnt, Streifen verschwindet
  };
  tick();
  duelTimer = setInterval(tick, 500);
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
  alertEl.textContent = live.stripTags(text);
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
  document.addEventListener('click', xrefClick, true);
  const header = document.querySelector('.site-header');
  if (!header) return;
  strip = document.createElement('div');
  strip.className = 'live-strip';
  strip.hidden = true;
  // Live-Leiste scrollt mit der Seite weg; nur die Reiterzeile klebt (Handy: wenig Platz)
  const tabsBar = document.querySelector('.tabs-bar');
  if (tabsBar) tabsBar.before(strip); else header.appendChild(strip);
  A.init({ esc, bar, clamp, fmt, tone, imgUrl: animalImg, xrefHtml, userPawnId, portraitHtml });

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
  // Porträt nicht ladbar: Platzhalter statt kaputtem Bild; fehlgeschlagene Adressen werden gemerkt (siehe portraitHtml/pawnBarHtml)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.matches?.('img[data-portrait]')) badPortraits.set(img.getAttribute('src'), Date.now());
    if (img?.matches?.('img[data-evimg]')) { badEvImgs.add(img.getAttribute('src')); img.closest('.np-fig')?.remove(); return; }   // Zeitungsbild fehlt: einfach weglassen
    if (img?.matches?.('img[data-animg]')) {   // Tierbild fehlt (noch nicht gerendert / 404): Pfotensymbol
      const ph = document.createElement('span');
      ph.className = 'an-ph';
      ph.setAttribute('aria-hidden', 'true');
      ph.textContent = '🐾';
      img.replaceWith(ph);
      return;
    }
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
    if (e.target.closest('[data-vote-toggle]')) { setVoteMin(!voteMinimized()); return; }
    const b = e.target.closest('[data-vote]');
    if (b && !b.disabled) castVote(Number(b.dataset.vote));
  });
  live.on('change', () => {
    if (!live.isLive()) { votePolling = false; voteState = null; renderVote(); }
    else ensureVotePoll();
  });
  // Außerhalb tippen: aufgeklappte Abstimmung wieder zur Pille einklappen (verdeckt so nichts)
  document.addEventListener('click', (e) => {
    if (voteEl && !voteEl.hidden && !voteEl.classList.contains('min') && !voteEl.contains(e.target) && !isFrage(voteState)) setVoteMin(true);
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
  { id: 'genes', label: 'Gene' },
  { id: 'gear', label: 'Ausrüstung' },
  { id: 'style', label: 'Aussehen' },
  { id: 'psyche', label: 'Psyche' },
  { id: 'stats', label: 'Alle Werte' },
  { id: 'ideo', label: 'Glaube' },
  { id: 'psy', label: 'Psycasts' },
  { id: 'work', label: 'Arbeit' },
  { id: 'goals', label: 'Ziele' },
  { id: 'isekai', label: 'Isekai' },
  { id: 'log', label: 'Erlebnisse' },
  { id: 'relations', label: 'Beziehungen' },
  { id: 'story', label: 'Geschichte' },
  { id: 'origin', label: 'Herkunft' },
];
// 7 Reiter, darin je ein Umschalter zwischen den Bereichen (Bereichs-ids = frühere Unterreiter-ids aus SUBS)
const TABS = [
  { id: 'overview', label: 'Überblick', areas: ['overview', 'mood'] },
  { id: 'body', label: 'Körper', areas: ['health', 'genes', 'gear'] },
  { id: 'char', label: 'Charakter', areas: ['psyche', 'ideo', 'origin'] },
  { id: 'skills', label: 'Können', areas: ['skills', 'psy', 'isekai', 'stats'] },
  { id: 'goals', label: 'Ziele', areas: ['goals'] },
  { id: 'life', label: 'Leben', areas: ['relations', 'log', 'story'] },
  { id: 'style', label: 'Aussehen & Arbeit', areas: ['style', 'work'] },
];
const SUB_KEY = 'ys-live-sub';
const AREA_KEY = 'ys-live-area';
const tabOfArea = (a) => TABS.find((t) => t.areas.includes(a));
let curSub = lsGet(SUB_KEY) || 'overview';
let areaPref = {};
try { areaPref = JSON.parse(lsGet(AREA_KEY) || '{}') || {}; } catch { areaPref = {}; }
// Alter gespeicherter Wert (frühere Unterreiter-id, z. B. 'mood') -> neuer Reiter + Bereich
if (!TABS.some((t) => t.id === curSub)) {
  const t = tabOfArea(curSub);
  if (t) { areaPref[t.id] = curSub; curSub = t.id; } else curSub = 'overview';
}
let openTrait = null;

const STATE_BADGE = { ok: 'good', sleeping: 'neutral', away: 'neutral', downed: 'bad', mental: 'doom', dead: 'doom' };
const hasGoals = (p) => p.wants != null || p.quirks != null || p.aspirations != null;
const visibleSubs = (p) => SUBS.filter((s) => (s.id !== 'ideo' || !!p.ideo) && (s.id !== 'psy' || !!p.psycasts) && (s.id !== 'psyche' || !!(p.psyche && (p.psyche.personality || p.psyche.interests || p.psyche.sexuality))) && (s.id !== 'goals' || hasGoals(p)) && (s.id !== 'mood' || Array.isArray(p.thoughts)) && (s.id !== 'isekai' || p.isekai != null) && (s.id !== 'work' || Array.isArray(p.work)) && (s.id !== 'genes' || hasGenes(p)));

function portraitHtml(p, cls) {
  const ini = esc((p.name || p.displayName || '?').trim().charAt(0).toUpperCase() || '?');
  if (!p.portrait || isBadPortrait(live.portraitUrl(p.id || p.user, p.portrait))) return `<div class="portrait ph ${cls}" aria-hidden="true">${ini}</div>`;
  return `<img class="portrait ${cls}" src="${esc(live.portraitUrl(p.id || p.user, p.portrait))}" alt="Porträt von ${esc(p.name)}" width="96" height="96" loading="lazy" data-portrait data-initial="${ini}">`;
}

// Abzeichen im Charakter-Kopf: werden hier aus den Daten berechnet (nur das jeweils höchste je Gruppe)
const DAY_BADGES = [[365, '1 Jahr in der Kolonie'], [100, '100 Tage in der Kolonie'], [50, '50 Tage in der Kolonie'], [10, '10 Tage in der Kolonie']];
const KILL_BADGES = [[50, '50 Gegner besiegt'], [10, '10 Gegner besiegt'], [1, 'Ersten Gegner besiegt']];
const ISEKAI_BADGES = [[50, 'Isekai-Meister'], [20, 'Isekai-Veteran'], [10, 'Isekai-Erfahren']];
const topBadge = (list, v) => list.find(([n]) => v >= n);

function praiseBadge(p) {
  const n = praiseOf(p);
  return n ? `<span class="ach praise" title="${fmt(n)}× gelobt">👏 ${fmt(n)}</span>` : '';
}

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

const badgesInner = (p) => praiseBadge(p) + badgeList(p).map((b) => `<span class="ach" title="${esc(b.title)}">${esc(b.label)}</span>`).join('');

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

let artBig = false; // gemaltes Porträt vergrößert (übersteht das Neuzeichnen)

function heroHtml(p) {
  const meta = [p.race, p.xenotype && p.xenotype !== p.race ? p.xenotype : null, p.age != null ? `${fmt(p.age)} Jahre` : null, p.gender]
    .filter(Boolean).map(esc).join(' · ');
  const mood = moodRow(p, p.moodLabel || `${Math.round(p.moodPct)} %`);
  return `<div class="card ch-hero">
    <div class="ch-pics">${portraitHtml(p, 'ch-portrait')}${p.art ? `<button type="button" class="ch-art-btn${artBig ? ' big' : ''}" data-art-zoom aria-pressed="${artBig}" title="Gemaltes Porträt – antippen zum Vergrößern"><img class="ch-art" src="${esc(live.artUrl(p.id || p.user, p.art))}" alt="Gemaltes Porträt von ${esc(p.name)}" width="128" height="128" loading="lazy"></button>` : ''}</div>
    <div class="ch-id">
      <h2 class="ch-name">${esc(p.name)}</h2>
      <div class="ch-sub"><span class="muted">${p.user ? '@' + esc(p.displayName || p.user) : 'Kolonist'}</span>${p.fullName && p.fullName !== p.name ? ` · <span class="muted">${esc(p.fullName)}</span>` : ''}</div>
      <div class="ch-meta">${meta}</div>
      ${p.ideo ? `<div class="ch-ideo" title="Überzeugung ${Math.round(p.ideo.certainty || 0)} %">☯ <b>${esc(p.ideo.name)}</b>${p.ideo.role ? ` · ${esc(p.ideo.role)}` : ''} · ${Math.round(p.ideo.certainty || 0)} % überzeugt</div>` : ''}
      <div class="ch-state"><span class="badge ${STATE_BADGE[p.state] || 'neutral'}">${esc(p.stateLabel || p.state)}</span>${p.job ? `<span class="ch-job">${esc(p.job)}</span>` : ''}</div>
      <div class="ch-badges">${badgesInner(p)}</div>
      ${p.id || p.user ? `<button type="button" class="linklike ch-share" data-share="${esc(p.id || p.user)}" title="Link zu diesem Kolonisten kopieren" aria-label="Link kopieren"><span aria-hidden="true">🔗</span></button>` : ''}
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

// „Rex (Husky)“ -> Name verlinkt auf Kolonie > Tiere
const bondLink = (b) => { const m = /^(.+?)(\s*\(.*\))?$/.exec(String(b)); return m ? animalXref(m[1]) + esc(m[2] || '') : esc(b); };

function panelOverview(p) {
  const needs = (p.needs || []).length ? section('Bedürfnisse', `<div class="bgrid">${p.needs.map((n) => barRow(n.label, n.pct)).join('')}</div>`) : '';
  const top = (p.skills || []).filter((s) => !s.disabled).sort((a, b) => b.level - a.level || b.passion - a.passion).slice(0, 3);
  const skills = top.length ? section('Beste Fähigkeiten', `<div class="bgrid">${top.map(skillRow).join('')}</div>`) : '';
  let traits = '';
  if ((p.traits || []).length) {
    const open = p.traits.find((t) => t.label === openTrait);
    traits = section('Eigenschaften', `<div class="traits">${p.traits.map((t) =>
      `<button type="button" class="trait" data-trait="${esc(t.label)}" aria-expanded="${t === open}" title="${esc(t.desc)}">${t.def ? `<span class="tr-sym" data-pickey="tr_${esc(t.def)}_${Number(t.degree) || 0}" data-pcls="tr-img sm" data-psize="28"></span>` : ''}${esc(t.label)}</button>`).join('')}</div>
      ${open ? `<p class="trait-desc"><b>${esc(open.label)}:</b> ${esc(open.desc)}</p>` : '<p class="small muted trait-hint">Tippe auf eine Eigenschaft, um sie zu lesen.</p>'}`);
  }
  const bonds = (p.bonds || []).length ? `<p class="bonds"><span class="heart" aria-hidden="true">♥</span> Gebunden an: <b>${p.bonds.map((b) => bondLink(b)).join(', ')}</b></p>` : '';
  return bonds + needs + skills + traits || '<div class="empty">Keine Angaben.</div>';
}

// Gedanken wie im Stimmungs-Reiter des Spiels; Antippen zeigt die Beschreibung (gleicher Mechanismus wie Eigenschaften)
function panelMood(p) {
  const head = p.moodPct == null ? '' : `<div class="bgrid mood-wide">${moodRow(p, p.moodLabel || `${Math.round(p.moodPct)} %`, true)}</div>`;
  const list = [...(p.thoughts || [])].sort((a, b) => b.value - a.value);
  if (!list.length) return head + '<div class="empty">Gerade keine besonderen Gedanken.</div>';
  const sum = list.reduce((s, t) => s + (Number(t.value) || 0), 0);
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(Math.round(v * 10) / 10));
  const rows = list.map((t) => {
    const key = 't:' + t.label;
    const open = openTrait === key;
    const tn = t.value > 0 ? 'good' : t.value < 0 ? 'doom' : 'neutral';
    return `<button type="button" class="thought ${tn}" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(t.desc)}">
        ${vb.symHtml(t.icon, vb.thoughtEmoji(t.label), 'th-ico')}
        <span class="th-label">${linkText(t.label, { span: true, skip: p.id || p.user })}${t.count > 1 ? ` <span class="muted">×${fmt(t.count)}</span>` : ''}</span>
        <span class="th-val ${tn}">${sign(t.value)}</span>
      </button>${open && t.desc ? `<p class="trait-desc th-desc">${linkText(t.desc, { skip: p.id || p.user })}</p>` : ''}`;
  }).join('');
  const posSum = list.reduce((s, t) => s + Math.max(0, Number(t.value) || 0), 0), negSum = list.reduce((s, t) => s + Math.min(0, Number(t.value) || 0), 0);
  return head + section('Was gerade auf die Stimmung wirkt', `<div class="th-total"><span class="th-total-l">Summe</span>${vb.sumBarHtml(sum, posSum, negSum)}<b class="th-total-v ${sum >= 0 ? 'th-pos' : 'th-neg'}">${sign(sum)}</b></div>
    <div class="thoughts">${rows}</div>
    <p class="small muted th-sum">Antippen zeigt die Beschreibung.</p>`);
}

// Alle Werte wie in der Infokarte des Spiels (/api/stats, nur solange offen; die Mod rechnet nur auf Anfrage)
const statsCache = new Map();
let statsOpenCat = null, statsFilter = '';

function statsBody(key) {
  const d = statsCache.get(key);
  if (!d) return '<div class="empty">Werte werden berechnet …</div>';
  const q = statsFilter.trim().toLowerCase();
  const cats = (d.categories || []).map((c) => {
    const rows = (c.stats || []).filter((x) => !q || x.label.toLowerCase().includes(q));
    if (!rows.length) return '';
    const open = q || statsOpenCat === c.label;
    return `<div class="st-cat"><button type="button" class="st-head" data-statcat="${esc(c.label)}" aria-expanded="${!!open}"><b>${esc(c.label)}</b><span class="small muted">${rows.length}</span><span aria-hidden="true">${open ? '▾' : '▸'}</span></button>
      ${open ? `<dl class="st-list">${rows.map((x) => `<div class="st-row" title="${esc(x.desc)}"><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl>` : ''}</div>`;
  }).join('');
  return cats || '<div class="empty">Nichts gefunden.</div>';
}

function panelStats(p) {
  const key = p.id || p.user;
  return `<div class="st-host" data-key="${esc(key)}" data-morph-keep data-statsfor="${esc(key)}">
    <input type="search" class="input st-search" placeholder="Wert suchen, z. B. Fruchtbarkeit" value="${esc(statsFilter)}" aria-label="Wert suchen">
    <div class="st-body">${statsBody(key)}</div>
    <p class="small muted trait-hint">Alle Werte wie in der Infokarte im Spiel. Antippen/Hover zeigt die Erklärung.</p></div>`;
}

function startStatsPoll(host) {
  const el = host.querySelector('.st-host');
  if (!el || el._polling) return;
  el._polling = true;
  const key = el.dataset.statsfor;
  const body = el.querySelector('.st-body');
  const draw = () => morph(body, statsBody(key));
  el.addEventListener('click', (e) => {
    const h = e.target.closest('[data-statcat]');
    if (!h) return;
    statsOpenCat = statsOpenCat === h.dataset.statcat ? null : h.dataset.statcat;
    draw();
  });
  el.querySelector('.st-search').addEventListener('input', (e) => { statsFilter = e.target.value; draw(); });
  // erster Abruf liefert 202 (Mod rechnet erst), dann alle 10 s – nur solange der Bereich offen ist
  live.poll({
    path: '/api/stats/' + encodeURIComponent(key), every: 3000, alive: () => el.isConnected,
    onResult: (r) => {
      if (r.status === 200 && r.data && !r.unchanged) { statsCache.set(key, r.data); draw(); }
    },
  });
}

function panelSkills(p) {
  const list = p.skills || [];
  if (!list.length) return '<div class="empty">Keine Fähigkeiten bekannt.</div>';
  return section('Fähigkeiten (0–20)', `<div class="bgrid">${list.map(skillRow).join('')}</div>
    <p class="small muted" style="margin:10px 0 0">🔥 Leidenschaft · 🔥🔥 brennende Leidenschaft</p>`) + expertiseHtml(p);
}

function panelHealth(p) {
  let html = '';
  if (p.bleeding) html += '<div class="ch-alert">🩸 Blutet! Ohne Verband wird es gefährlich.</div>';
  const conds = [...(p.conditions || [])];
  if (!conds.length) html += '<div class="ch-ok">✓ Kerngesund – keine Verletzungen oder Krankheiten.</div>';
  else {
    // Gruppen: Verletzt / Krank / Implantate / Geheilt – Farbe + Symbol (Blutung 🩸)
    const groups = { injury: [], disease: [], implant: [], good: [] };
    for (const c of conds) groups[vb.condGroup(c)].push(c);
    groups.injury.sort((a, b) => (b.bleeding - a.bleeding));
    html += Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => {
      const m = vb.COND_META[g];
      return `<section class="ch-sec cg cg-${m.cls}"><h4><span class="cg-ico" aria-hidden="true">${m.emo}</span> ${esc(m.title)} <span class="cg-n">${l.length}</span></h4>
        <ul class="conds">${l.map((c) => `<li class="${c.bleeding ? 'bleed' : g}"><span class="cs" aria-hidden="true">${c.bleeding ? '🩸' : m.emo}</span>
          <span class="cl">${esc(c.label)}${c.part ? ` <span class="muted">· ${esc(c.part)}</span>` : ''}</span>${c.bleeding ? '<span class="tag bleed">blutet</span>' : ''}</li>`).join('')}</ul></section>`;
    }).join('');
  }
  const pain = Number(p.pain) || 0;
  if (pain > 0) html += section('Schmerz', barRow('Schmerz', pain, `${Math.round(clamp(pain))} %`, tone(100 - clamp(pain))));
  // Körperfähigkeiten nur, wenn eingeschränkt (unter 100 %)
  const caps = p.capacities || [];
  const weak = caps.filter((c) => Number(c.pct) < 99.5);
  if (weak.length) html += section('Eingeschränkt', `<div class="bgrid">${weak.map((c) => barRow(c.label, c.pct)).join('')}</div>`);
  else if (caps.length && !p.bleeding && !conds.some((c) => c.bad)) html += '<div class="ch-ok">✓ Alles in Ordnung – alle Körperfähigkeiten bei 100 %.</div>';
  else if (caps.length) html += '<p class="small muted ch-allok">✓ Alle Körperfähigkeiten bei 100 %.</p>';
  html += bodyHtml(p);
  return html;
}

function panelGear(p) {
  const g = p.gear || {};
  const list = (arr) => (arr && arr.length ? `<ul class="plain">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">nichts</p>');
  // Paket B: mit den neuen Feldern (weaponItem/apparelItems) Spielsymbole, Qualitätsrand und Haltbarkeitsbalken; sonst die Textliste wie bisher
  const rich = g.weaponItem !== undefined || Array.isArray(g.apparelItems);
  if (!rich) {
    return section('Waffe', g.weapon ? `<p style="margin:0">${esc(g.weapon)}</p>` : '<p class="muted small" style="margin:0">unbewaffnet</p>')
      + section('Kleidung', list(g.apparel)) + section('Inventar', inventoryHtml(p, g) || list(g.inventory));
  }
  const weapon = g.weaponItem ? `<div class="gear-grid">${vb.gearTileHtml(g.weaponItem, 'weapon')}</div>` : '<p class="muted small" style="margin:0">unbewaffnet</p>';
  const worn = (g.apparelItems || []).length ? `<div class="gear-grid">${g.apparelItems.map((it) => vb.gearTileHtml(it)).join('')}</div>` : '<p class="muted small" style="margin:0">nichts</p>';
  const legend = '<p class="gear-leg small muted" aria-hidden="true"><i class="q0"></i>schrecklich <i class="q1"></i>schlecht <i class="q2"></i>normal <i class="q3"></i>gut <i class="q4"></i>exzellent <i class="q5"></i>meisterhaft <i class="q6"></i>legendär</p>';
  return section('Waffe', weapon) + section('Kleidung', worn) + section('Inventar', inventoryHtml(p, g) || list(g.inventory)) + legend;
}

// Inventar mit Knopf „Benutzen“ (nur eigener Kolonist, nur wenn !benutzen freigegeben/in RICS an) → !benutzen #t<id>
const USE_VERB = { food: 'Essen', drug: 'Nehmen', apparel: 'Anziehen', weapon: 'Ausrüsten' };
const USE_EMO = { food: '🍽', drug: '💊', apparel: '👕', weapon: '🔫', other: '🎒' };
function inventoryHtml(p, g) {
  const items = g.inventoryItems;
  if (!Array.isArray(items)) return '';
  if (!items.length) return '<p class="muted small" style="margin:0">nichts</p>';
  const can = isMine(p) && live.isAllowed('benutzen');
  const wait = Number(live.getMe()?.useWaitHours);
  const waiting = can && wait > 0;
  const rows = items.map((it) => {
    const verb = USE_VERB[it.kind];
    const img = vb.symHtml(it.icon, USE_EMO[it.kind] || '🎒', 'gear-ico');
    const btn = can && verb && !waiting
      ? actBtn('benutzen', it.id, verb, { confirm: it.kind === 'drug', armedLabel: 'Wirklich?', title: it.kind === 'drug' ? 'Kann süchtig machen' : `${verb}: ${it.label}` })
      : '';
    return `<li class="inv-row gear-tile qn" title="${esc(it.label)}">${img}<span class="gear-name">${esc(it.label)}${it.count > 1 ? ` <span class="muted">×${fmt(it.count)}</span>` : ''}</span>${btn}</li>`;
  }).join('');
  const note = waiting ? `<p class="muted small" style="margin:6px 0 0">⏱ Wieder benutzbar in ${wait < 1 ? '< 1' : Math.ceil(wait)} h (Spielzeit).</p>` : '';
  return `<ul class="plain inv-list gear-grid">${rows}</ul>${note}`;
}

// ---------- Aktions-Knöpfe (nur für den eigenen Kolonisten) ----------
const isMine = (p) => !!p?.user && live.isLinked() && p.user === live.getMe()?.user;
let armedKey = null, armedTimer = null, busyKey = null, armedAt = 0;   // Bestätigung per zweitem Tippen / laufende Aktion

/** Kleiner Knopf; bei confirm erst „Sicher?“, dann beim zweiten Tippen ausführen. Der Zustand kommt aus dem HTML (übersteht morph). */
function actBtn(cmd, args, label, { confirm = false, title = '', cls = '', armedLabel = 'Sicher?' } = {}) {
  const key = cmd + ' ' + args;
  const busy = busyKey === key, armed = armedKey === key;
  return `<button type="button" class="act-btn ${cls}${armed ? ' armed' : ''}" data-act="${esc(cmd)}" data-args="${esc(args)}"${confirm ? ' data-confirm="1"' : ''}${busy ? ' disabled' : ''} title="${esc(armed ? 'Zum Bestätigen noch einmal antippen' : title)}">${busy ? '…' : esc(armed ? armedLabel : label)}</button>`;
}

async function runAct(host, btn, redraw = () => repaint(host)) {
  const cmd = btn.dataset.act, args = btn.dataset.args, key = cmd + ' ' + args;
  if (busyKey || btn.disabled) return;
  if (btn.dataset.confirm && armedKey === key && Date.now() - armedAt < 500) return;   // Doppeltippen soll nicht gleich bestätigen
  if (btn.dataset.confirm && armedKey !== key) {
    armedKey = key; armedAt = Date.now();
    clearTimeout(armedTimer);
    armedTimer = setTimeout(() => { if (armedKey === key) { armedKey = null; if (host.isConnected) redraw(); } }, 4000);
    redraw();
    return;
  }
  clearTimeout(armedTimer);
  armedKey = null; busyKey = key;
  redraw();
  try {
    const msgs = await live.act(cmd, args);
    delete pickedColor[cmd];   // gewählte Farbe ist jetzt angewandt: ab dann gilt wieder der Serverwert
    toast(msgs.length ? msgs.join(' · ') : 'An RICS übergeben.', 7000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    busyKey = null;
    if (cmd === 'quirks') refreshOffers(host);
    if (host.isConnected) redraw();
  }
}

// ---------- Zuschauer-Interaktionen (RICS Extras): Duell-Wetten, Lob, Nachhilfe, Tier-Paten ----------
let gameInfo = null;                       // zuletzt gesehene GameInfo (Lob-Zähler, Nachhilfe-Preis, Patenpreis)
const noteGame = (g) => { if (g && typeof g === 'object') { gameInfo = g; px.animals = (Array.isArray(g.animalList) ? g.animalList : []).map((a) => a?.name).filter(Boolean); } };
const interKey = (g) => JSON.stringify([g?.praise ?? null, g?.tutor ?? null, g?.sponsorPrice ?? null]);

// Duell-Wetten: Karte „Duell läuft“ (Spiel → Übersicht und Kolonie)
let betAmount = 0;
let duelStamp = { secs: 0, at: 0 };        // Restzeit der Wetten beim letzten Abruf (lokal weitergezählt)
let duelTicker = null;
const BET_STEPS = [50, 100, 250];
const duelLeft = () => Math.max(0, Math.round(duelStamp.secs - (Date.now() - duelStamp.at) / 1000));

function noteDuel(g) {
  const d = g?.duel;
  if (d && d.betOpen) duelStamp = { secs: Number(d.betSecondsLeft) || 0, at: Date.now() };
}

function ensureDuelTicker() {
  if (duelTicker) return;
  duelTicker = setInterval(() => {
    const els = document.querySelectorAll('[data-duel-left]');
    if (!els.length) return;
    const t = `⏱ Wetten noch ${duelLeft()} s (Spielzeit)`;
    els.forEach((el) => { if (el.textContent !== t) el.textContent = t; });
  }, 1000);
}

function betAmounts(d) {
  const lo = Math.max(1, Number(d.minBet) || 1), hi = Math.max(lo, Number(d.maxBet) || lo);
  return [...new Set([lo, ...BET_STEPS, hi])].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
}

function duelSide(s, cls) {
  return `<div class="duel-side ${cls}">
    ${portraitHtml({ name: s.name, id: s.id || s.user, portrait: 1 }, 'duel-portrait')}
    <b class="duel-name">${(s.id || s.user) ? xrefHtml(s.name, s.id || s.user) : esc(s.name)}</b>
    ${s.user ? `<span class="small muted duel-user">@${esc(s.user)}</span>` : '<span class="small muted duel-user">&nbsp;</span>'}
    ${s.healthPct == null ? barRow('Gesundheit', 0, '?', 'neutral', 'mini') : barRow('Gesundheit', s.healthPct, null, null, 'mini')}
  </div>`;
}

function duelCardHtml(g) {
  const d = g?.duel;
  if (!d || !d.a || !d.b) return '';
  ensureDuelTicker();
  const me = live.getMe();
  const fighting = !!me?.pawn && [d.a, d.b].some((s) => (s.id && s.id === me.pawn.id) || (s.user && s.user === me.user));
  const ba = Number(d.a.bets) || 0, bb = Number(d.b.bets) || 0, total = ba + bb;
  const pa = total > 0 ? (ba / total) * 100 : 50;
  const pot = d.pot != null ? Number(d.pot) : total;
  const hidden = d.a.healthPct == null || d.b.healthPct == null;
  let ctl = '';
  if (!d.betOpen) ctl = '<p class="small muted duel-note">Die Wetten sind geschlossen – der Kampf läuft.</p>';
  else if (live.isAllowed('wette')) {
    if (!live.isLinked()) ctl = `<p class="small muted duel-note">Verbinde dich oben, um per Knopf zu wetten – oder schreib <code>${esc(live.prefix())}wette Name Betrag</code> in den Chat.</p>`;
    else if (fighting) ctl = '<p class="small muted duel-note">Du kämpfst selbst mit – wetten darfst du nicht.</p>';
    else {
      const list = betAmounts(d);
      const lo = list[0], hi = list[list.length - 1];
      if (!(betAmount >= lo && betAmount <= hi)) betAmount = lo;
      const amts = list.map((v) => `<button type="button" class="chip-btn bet-amt" data-bet="${v}" aria-pressed="${v === betAmount}">${fmt(v)} 🪙</button>`).join('') + betInputHtml(lo, hi, betAmount);
      const bet = (s, cls) => actBtn('wette', `${s.user ? '@' + s.user : s.name} ${betAmount}`, `Auf ${s.name} wetten`,
        { confirm: true, armedLabel: `${fmt(betAmount)} 🪙 – sicher?`, cls: `duel-bet ${cls}`, title: `${fmt(betAmount)} Münzen auf ${s.name} setzen` });
      ctl = `<div class="duel-amts" role="group" aria-label="Einsatz">${amts}</div>
        <div class="duel-btns">${bet(d.a, 'a')}${bet(d.b, 'b')}</div>`;
    }
  }
  return `<section class="card duel-card" aria-label="Duell läuft">
    <div class="duel-head"><b class="duel-title">⚔ Duell läuft</b>${d.betOpen ? `<span class="duel-count" data-duel-left>⏱ Wetten noch ${duelLeft()} s (Spielzeit)</span>` : '<span class="badge neutral">Wetten zu</span>'}</div>
    <div class="duel-vs">${duelSide(d.a, 'a')}<span class="duel-x" aria-hidden="true">VS</span>${duelSide(d.b, 'b')}</div>
    <div class="duel-bets" role="img" aria-label="Wetten: ${fmt(ba)} gegen ${fmt(bb)} Münzen"><i class="a" style="width:${pa.toFixed(1)}%"></i><i class="b" style="width:${(100 - pa).toFixed(1)}%"></i></div>
    <div class="duel-sums"><span class="a">${fmt(ba)} 🪙</span><span class="pot">Topf ${fmt(pot)} 🪙</span><span class="b">${fmt(bb)} 🪙</span></div>
    ${hidden ? '<p class="small muted duel-note">Die Gesundheit der Kämpfer ist verdeckt bis Wettschluss.</p>' : ''}
    ${ctl}
  </section>`;
}

// Spielautomat (RICS Extras !slots): nur, wenn im Spiel einer mit Strom steht (GameInfo.slots)
let slotBet = 0;

function slotsCardHtml(g) {
  const raw = g?.slots;
  if (!raw || !live.isAllowed('slots')) return '';
  const sl = { minBet: Math.round(Number(raw.minBet)), maxBet: Math.round(Number(raw.maxBet)), cooldownHours: Number(raw.cooldownHours) || 0 };
  if (!(sl.minBet >= 1) || !(sl.maxBet >= sl.minBet)) return '';   // ohne gültige Einsätze keinen Knopf zeigen
  const amounts = [...new Set([sl.minBet, 25, 50, 100, sl.maxBet].filter((v) => v >= sl.minBet && v <= sl.maxBet))].sort((a, b) => a - b);
  if (!(slotBet >= sl.minBet && slotBet <= sl.maxBet)) slotBet = amounts[0];
  let ctl;
  if (!live.isLinked()) ctl = `<p class="small muted" style="margin:0">Verbinde dich oben, um per Knopf zu spielen – oder schreib <code>${esc(live.prefix())}slots Einsatz</code> in den Chat.</p>`;
  else {
    const chips = amounts.map((v) => `<button type="button" class="chip-btn" data-slotbet="${v}" aria-pressed="${v === slotBet}">${fmt(v)} 🪙</button>`).join('') + betInputHtml(sl.minBet, sl.maxBet, slotBet);
    ctl = `<div class="duel-amts" role="group" aria-label="Einsatz">${chips}</div>
      ${actBtn('slots', String(slotBet), `🎰 Drehen · ${fmt(slotBet)} 🪙`, { confirm: true, armedLabel: `${fmt(slotBet)} 🪙 – los?`, cls: 'slot-go', title: `Für ${fmt(slotBet)} Münzen drehen` })}`;
  }
  return `<section class="card slot-card" aria-label="Spielautomat">
    <img class="slot-img" src="assets/img/slot-machine.png" alt="" width="96" height="96">
    <div class="slot-body"><div class="slot-head"><b>Spielautomat</b><span class="small muted">${vb.clockHtml(`${fmt(sl.cooldownHours)} h`, 'Pause zwischen zwei Drehs (Spielstunden)')}</span></div>
      <p class="small muted" style="margin:0">Drei Walzen – meistens verlierst du, manchmal gewinnst du richtig.</p>
      ${ctl}</div>
  </section>`;
}

function slotPick(e, redraw) {
  const b = e.target.closest('[data-slotbet]');
  if (!b) return false;
  slotBet = Number(b.dataset.slotbet) || 0;
  const inp = b.closest('.slot-card')?.querySelector('.bet-input');
  if (inp) inp.value = slotBet;
  redraw();
  return true;
}

// Eigener Einsatz: Zahlenfeld neben den festen Beträgen. Beim Tippen wird nur der Wert gemerkt (kein Neuzeichnen, Fokus bleibt);
// erst bei „change“ (Verlassen/Enter) wird auf min..max begrenzt und neu gezeichnet. Das Feld selbst wird von morph weiterverwendet.
function betInputHtml(lo, hi, val) {
  return `<label class="bet-own"><span class="small muted">Eigener Einsatz</span><input type="number" class="bet-input" data-betinput min="${lo}" max="${hi}" step="1" inputmode="numeric" pattern="[0-9]*" value="${val}" aria-label="Eigener Einsatz in Münzen (${fmt(lo)} bis ${fmt(hi)})"><span aria-hidden="true">🪙</span></label>`;
}

/** Eingabe im Einsatzfeld; kind = 'slot' | 'duel'. */
function betInput(e, kind, redraw) {
  const el = e.target.closest?.('[data-betinput]');
  if (!el) return false;
  const lo = Number(el.min) || 1, hi = Number(el.max) || lo;
  const v = Math.round(Number(el.value));
  const set = (n) => { if (kind === 'slot') slotBet = n; else betAmount = n; };
  if (e.type === 'input') { if (Number.isFinite(v) && el.value !== '') set(Math.max(lo, Math.min(hi, v))); return true; }
  if (e.type === 'change') {
    const n = Number.isFinite(v) && el.value !== '' ? Math.max(lo, Math.min(hi, v)) : (kind === 'slot' ? slotBet : betAmount);
    set(n); el.value = n; redraw();
  }
  return true;
}
function betKey(e) {
  if (e.key === 'Enter' && e.target.closest?.('[data-betinput]')) { e.preventDefault(); e.target.blur(); }
}

/** Klick auf einen Einsatz-Knopf; true = behandelt. */
function betPick(e, redraw) {
  const b = e.target.closest('[data-bet]');
  if (!b) return false;
  betAmount = Number(b.dataset.bet) || 0;
  const inp = b.closest('.duel-card')?.querySelector('.bet-input');
  if (inp) inp.value = betAmount;
  redraw();
  return true;
}

// Lob: Knopf im Kopf fremder Kolonisten + Zähler-Abzeichen
const praiseOf = (p) => {
  const m = gameInfo?.praise;
  const n = m && typeof m === 'object' ? Number(m[p.id || p.user]) : 0;
  return n > 0 ? n : 0;
};

/** Kachel „Loben“ (gehört in den gemeinsamen Aktionsblock). */
function praiseBtnHtml(p) {
  if (!live.isLinked() || isMine(p) || !live.isAllowed('lob') || !p.name) return '';
  return tileBtn('lob', p.user ? '@' + p.user : p.name, { ico: '👏', label: 'Loben', tone: 'friend', title: `${p.name} loben` });
}

// Nachhilfe: eigener Kolonist unterrichtet in Fertigkeiten, in denen er deutlich besser ist
let tutorOpen = false;

function tutorSkills(p) {
  const t = gameInfo?.tutor || {};
  const minLevel = Number(t.minLevel) || 0, gap = Number(t.gap) || 0;
  const theirs = new Map((p.skills || []).map((s) => [s.label, s]));
  return (live.getMe()?.pawn?.skills || []).map((s) => ({ s, o: theirs.get(s.label) }))
    .filter(({ s, o }) => o && !s.disabled && !o.disabled && s.level >= minLevel && s.level >= o.level + gap)
    .sort((x, y) => (y.s.level - y.o.level) - (x.s.level - x.o.level))
    .map(({ s, o }) => ({ label: s.label, mine: s.level, theirs: o.level }));
}

function tutorTile(p) {
  const t = gameInfo?.tutor;
  if (!t || !live.isLinked() || !live.getMe()?.pawn || isMine(p) || !live.isAllowed('nachhilfe') || !p.name) return '';
  const price = Number(t.price) || 0;
  return `<button type="button" class="act-tile friend tutor-toggle${tutorOpen ? ' on' : ''}" data-tutor-toggle aria-expanded="${tutorOpen}" title="Nachhilfe geben: ${esc(p.name)} etwas beibringen"><span class="at-ico" aria-hidden="true">📚</span><span class="at-lab">Nachhilfe</span>${price ? `<span class="at-price"><i aria-hidden="true">🪙</i>${fmt(price)}</span>` : ''}</button>`;
}

function tutorBox(p) {
  const t = gameInfo?.tutor;
  if (!tutorOpen || !t || !tutorTile(p)) return '';
  const list = tutorSkills(p);
  const price = fmt(Number(t.price) || 0);
  return list.length
    ? `<div class="tutor-box"><p class="small muted">Du unterrichtest ${esc(p.name)} für <b>🪙 ${price}</b>. Deine Stufe → Stufe von ${esc(p.name)}.</p>
        <div class="tutor-skills">${list.map((k) => actBtn('nachhilfe', `${p.user ? '@' + p.user : p.name} ${k.label}`, `${k.label} ${k.mine} → ${k.theirs}`,
          { confirm: true, armedLabel: `🪙 ${price} – sicher?`, cls: 'tutor-skill', title: `${k.label}: ${price} Münzen` })).join('')}</div></div>`
    : `<div class="tutor-box"><p class="small muted">Gerade passt keine Fertigkeit: Du brauchst mindestens Stufe ${fmt(Number(t.minLevel) || 0)} und ${fmt(Number(t.gap) || 0)} Stufen mehr als ${esc(p.name)}.</p></div>`;
}

// Tier-Paten
let pateOpen = null, pateName = '';
const PATE_RE = /^[\p{L}\p{N} '-]{2,16}$/u;
let curAnimals = [];
const normUser = (s) => String(s ?? '').replace(/^@/, '').trim().toLowerCase();
const animalImg = (key) => live.artUrl('x', 0).replace(/\/api\/art\/.*$/, '/api/animalimg/' + encodeURIComponent(key));   // gleiche Basisadresse wie die Porträts

function animalPic(a) {
  return a.img
    ? `<img class="an-img" src="${esc(animalImg(a.img))}" alt="${esc(a.kind)}" width="52" height="52" loading="lazy" data-animg>`
    : '<span class="an-ph" aria-hidden="true">🐾</span>';
}

function canSponsor(a) {
  if (a.sponsor || !a.id || !live.isLinked() || !live.isAllowed('pate')) return false;
  const me = normUser(live.getMe()?.user);
  return !!me && !curAnimals.some((x) => normUser(x.sponsor) === me);
}

function sponsorHtml(a) {
  if (a.sponsor) {
    const mine = normUser(a.sponsor) === normUser(live.getMe()?.user) && live.isLinked();
    return `<div class="an-sponsor${mine ? ' mine' : ''}"><span class="ach" title="Pate dieses Tiers">Pate: @${(() => { const id = userPawnId(a.sponsor); return id ? xrefHtml(normUser(a.sponsor), id, true) : esc(normUser(a.sponsor)); })()}${mine ? ' (du)' : ''}</span></div>`;
  }
  if (!canSponsor(a)) return '';
  const price = Number(gameInfo?.sponsorPrice) || 0;
  const open = pateOpen === a.id;
  const btn = `<button type="button" class="act-btn pate-open${open ? ' on' : ''}" data-pate-open="${esc(a.id)}" aria-expanded="${open}">Pate werden${price ? ` · ${fmt(price)} 🪙` : ''}</button>`;
  if (!open) return `<div class="an-pate">${btn}</div>`;
  const nm = pateName.trim();
  const ok = !nm || PATE_RE.test(nm);
  const args = `#${a.id}${nm && ok ? ' ' + nm : ''}`;
  return `<div class="an-pate">${btn}
    <div class="pate-form">
      <input class="search pate-in" type="text" maxlength="16" placeholder="Name für das Tier (optional)" value="${esc(pateName)}" data-pate-name aria-label="Name für das Tier">
      <p class="small pate-hint" data-pate-hint${ok ? ' hidden' : ''}>2–16 Zeichen: Buchstaben, Ziffern, Leerzeichen, - und '</p>
      ${actBtn('pate', args, `Patenschaft${price ? ` · ${fmt(price)} 🪙` : ''}`, { confirm: true, armedLabel: price ? `${fmt(price)} 🪙 – sicher?` : 'Sicher?', cls: 'pate-go', title: 'Pate dieses Tiers werden' }).replace('<button ', ok ? '<button ' : '<button disabled ')}
    </div></div>`;
}

/** Klicks im Tier-Bereich (Pate); true = behandelt. */
function pateClick(e, redraw) {
  const o = e.target.closest('[data-pate-open]');
  if (!o) return false;
  const id = o.dataset.pateOpen;
  pateOpen = pateOpen === id ? null : id;
  pateName = '';
  redraw();
  return true;
}

/** Namensfeld: Argumente des Knopfes direkt nachführen (kein Neuzeichnen, Fokus bleibt). */
function pateInput(e) {
  const inp = e.target.closest('[data-pate-name]');
  if (!inp) return;
  pateName = inp.value.replace(/\s+/g, ' ').trimStart();
  const ok = !pateName.trim() || PATE_RE.test(pateName.trim());
  const form = inp.closest('.pate-form');
  const go = form?.querySelector('[data-act="pate"]');
  if (go) { go.dataset.args = `#${pateOpen}${pateName.trim() && ok ? ' ' + pateName.trim() : ''}`; go.disabled = !ok; }
  const hint = form?.querySelector('[data-pate-hint]');
  if (hint) hint.hidden = ok;
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
  if (host._goalsPoll || !p || activeArea(p) !== 'goals' || !isMine(p)) return;
  host._goalsPoll = true;
  live.poll({
    path: '/api/game', every: 5000,
    alive: () => {
      const ok = host.isConnected && host._pawn && activeArea(host._pawn) === 'goals' && isMine(host._pawn);
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
      ${(w.list || []).length ? `<ul class="goal-list want-list">${w.list.map((x, i) => { const wk = 'w:' + x.label, wopen = openTrait === wk; return `<li class="want"><button type="button" class="want-main" data-trait="${esc(wk)}" aria-expanded="${wopen}" title="${esc(x.desc || x.label)}">${x.pct != null ? vb.ringHtml(x.pct, `Fortschritt ${Math.round(x.pct)} Prozent`) : '<span class="want-dot" aria-hidden="true">🎯</span>'}<span class="want-title">${esc(x.label)}</span><span class="want-reward" title="Belohnung: ${esc(fmt(x.reward))} Punkte"><i aria-hidden="true">🪙</i>+${esc(fmt(x.reward))}</span></button>
        ${wopen && x.desc ? `<p class="trait-desc want-desc">${esc(x.desc)}</p>` : ''}
        <span class="goal-side">${canWant && x.rerollable ? actBtn('wants', `reroll ${i + 1}`, w.rerollCost ? `↻ Tauschen · ${fmt(w.rerollCost)} 🪙` : '↻ Tauschen', { confirm: true, armedLabel: w.rerollCost ? `${fmt(w.rerollCost)} Münzen – sicher?` : 'Sicher?', title: w.rerollCost ? `Diesen Wunsch für ${fmt(w.rerollCost)} Münzen gegen einen neuen tauschen` : 'Diesen Wunsch gegen einen neuen tauschen' }) : ''}</span></li>`; }).join('')}</ul>` : '<p class="muted small" style="margin:8px 0 0">Gerade keine offenen Wünsche.</p>'}`);
  }
  const showOffers = mine && offersLoaded && quirkOffers != null;
  if (p.quirks || showOffers) {
    const have = p.quirks
      ? (p.quirks.length ? `<ul class="goal-list quirk-list">${p.quirks.map((x) => { const qk = 'qk:' + x.label, qo = openTrait === qk; return `<li class="quirk qt-${vb.quirkTone(x)}"><button type="button" class="quirk-main" data-trait="${esc(qk)}" aria-expanded="${qo}" title="${esc(x.desc || x.label)}"><i class="quirk-dot" aria-hidden="true"></i><b>${esc(x.label)}</b></button>${qo && x.desc ? `<p class="trait-desc">${esc(x.desc)}</p>` : ''}</li>`; }).join('')}</ul>` : '<p class="muted small" style="margin:0">Keine.</p>')
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

function logListHtml(data, skip) {
  const list = data?.[logKind] || [];
  if (!list.length) return `<div class="empty">${logKind === 'social' ? 'Noch keine Unterhaltungen aufgezeichnet.' : 'Noch keine Kämpfe aufgezeichnet.'}</div>`;
  if (logKind === 'social') return socialListHtml(list, skip);
  // Kampflog: Zeitleiste mit Symbol (⚔ u. a.) und einzeiligem Text
  return `<div class="tlb-list">${list.map((e) => { const h = vb.historyKind(e.text); return vb.timelineItemHtml({ okey: 'cb:' + String(e.text).slice(0, 120), emo: h.emo === '•' ? '⚔' : h.emo, tone: h.tone === 'neutral' ? 'bad' : h.tone, textHtml: linkText(e.text, { pawns: e.pawns, skip, span: true }), fullHtml: linkText(e.text, { pawns: e.pawns, skip }), meta: `<i aria-hidden="true">⏱</i> ${esc(vb.agoShort(e.ago))}` }); }).join('')}</div>`;
}

function panelLog(p) {
  const key = p.id || p.user;
  const btn = (k, label) => `<button type="button" class="seg${logKind === k ? ' on' : ''}" data-logkind="${k}" aria-pressed="${logKind === k}">${label}</button>`;
  return `<div class="log-switch">${btn('social', 'Unterhaltungen')}${btn('combat', 'Kämpfe')}</div>
    <div class="log-host" data-key="${esc(key)}:${logKind}" data-morph-keep data-logfor="${esc(key)}">${logCache.has(key) ? logListHtml(logCache.get(key), key) : '<div class="empty">Lade …</div>'}</div>
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
      if (!r.unchanged || !el.dataset.filled) { morph(el, logListHtml(r.data, key)); el.dataset.filled = '1'; }
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
  // Porträt links (nur Kolonisten haben eins); Name führt zum Kolonisten, wenn er in der Kolonie lebt
  const pic = portraitHtml({ name: r.name, id: r.id, portrait: r.portrait }, 'rel-portrait');
  const name = r.colonist && r.id && !r.dead
    ? `<a class="rel-name" href="#/kolonie/${encodeURIComponent(r.id)}">${esc(r.name)}</a>` : `<b class="rel-name">${esc(r.name)}</b>`;
  return `<li class="rel-row" data-relkey="${esc(r.id || r.name)}">${pic}<div class="rel-body"><div class="rel-main">${name}${who}<span class="rel-badges">${fam}${status}</span></div>${lines}</div></li>`;
}

// Beziehungsnetz: Kolonist in der Mitte, bis zu 10 wichtigste Beziehungen im Kreis (Familie zuerst, dann stärkste Meinung).
// Linienfarbe = Meinung (grün/rot/grau), Dicke = Stärke, gestrichelt + ♥ = Familie/Partner.
const REL_MAX = 10;
function relGraphHtml(p, list) {
  const strength = (r) => Math.abs(Number(r.opinion) || 0);
  const fam = list.filter((r) => (r.relations || []).length).sort((a, b) => strength(b) - strength(a));
  const rest = list.filter((r) => !(r.relations || []).length && !r.dead).sort((a, b) => strength(b) - strength(a));
  const pick = [...fam, ...rest].slice(0, REL_MAX);
  if (!pick.length) return '';
  const R = 37, n = pick.length;
  const lines = [], nodes = [];
  pick.forEach((r, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = 50 + R * Math.cos(a), y = 50 + R * Math.sin(a);
    const op = Number(r.opinion) || 0;
    const tn = r.dead ? 'neutral' : op >= 5 ? 'good' : op <= -5 ? 'doom' : 'neutral';
    const isFam = (r.relations || []).length > 0;
    const w = (1.5 + Math.min(100, Math.abs(op)) / 100 * 4.5).toFixed(1);
    lines.push(`<line class="rg-l ${tn}${isFam ? ' fam' : ''}" x1="50" y1="50" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke-width="${w}"/>`);
    const key = r.id || r.name;
    const goes = r.colonist && r.id && !r.dead;
    const rel = (r.relations || []).join(', ');
    const title = `${r.name}${rel ? ' – ' + rel : ''}${r.dead ? ' (tot)' : ` · Meinung ${relSign(op)}`}${goes ? ' · antippen öffnet den Kolonisten' : ' · antippen zeigt den Eintrag'}`;
    nodes.push(`<button type="button" class="rg-node ${tn}${isFam ? ' fam' : ''}${r.dead ? ' dead' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" data-relnode="${esc(key)}"${goes ? ` data-relgo="${esc(r.id)}"` : ''} title="${esc(title)}" aria-label="${esc(title)}">${portraitHtml({ name: r.name, id: r.id, portrait: r.portrait }, 'rg-pic')}${isFam ? '<span class="rg-heart" aria-hidden="true">♥</span>' : ''}<span class="rg-name">${esc(String(r.name).split(' ')[0])}</span></button>`);
  });
  const summary = pick.map((r) => `${r.name}: ${(r.relations || []).join(', ') || relSign(Number(r.opinion) || 0)}`).join('; ');
  return `<div class="rg" role="group" aria-label="Beziehungsnetz von ${esc(p.name)}: ${esc(summary)}">
    <svg class="rg-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>
    ${nodes.join('')}
    <div class="rg-center" aria-hidden="true">${portraitHtml(p, 'rg-pic rg-me')}<span class="rg-name">${esc(String(p.name).split(' ')[0])}</span></div>
  </div>
  <p class="small muted rg-leg"><span class="rg-k good"></span>mag <span class="rg-k doom"></span>mag nicht <span class="rg-k neutral"></span>neutral <span class="rg-k fam"></span>♥ Familie · dicker = stärker</p>`;
}

function relHtml(p, data) {
  const list = (data?.relations || []).filter((r) => r && !r.animal);
  for (const r of list) if (r.colonist && r.id && !r.dead) noteFullName(r.id, r.name);
  if (!list.length) return '<div class="empty">Noch keine Beziehungen erfasst.</div>';
  const graph = relGraphHtml(p, list);
  const fam = list.filter((r) => (r.relations || []).length);
  const others = list.filter((r) => !(r.relations || []).length && !r.dead).sort((a, b) => (Number(b.opinion) || 0) - (Number(a.opinion) || 0));
  const famHtml = fam.length ? section('Partner & Familie', `<ul class="rel-list">${fam.map((r) => relRow(p, r)).join('')}</ul>`) : '';
  const othHtml = others.length ? section('Freunde & Rivalen', `<ul class="rel-list">${others.map((r) => relRow(p, r)).join('')}</ul>
    <p class="small muted" style="margin:8px 0 0">Die Zahl ist die Meinung wie im Spiel: ab +20 befreundet, ab −20 Rivalen.</p>`) : '';
  return graph + famHtml + othHtml || '<div class="empty">Noch keine Beziehungen erfasst.</div>';
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
function storyHtml(list, skip) {
  if (!Array.isArray(list) || !list.length) return '<div class="empty">Noch keine Erinnerungen erfasst.</div>';
  // Paket B: Zeitleiste mit Farbpunkt + Symbol je Art (Schlüsselwörter), Text einzeilig, Rest antippbar
  let lastDay = null;
  return `<div class="tlb-list">${list.map((e) => {
    const h = vb.historyKind(e.text);
    const day = e.day !== lastDay ? `<div class="tlb-day">Tag ${fmt(e.day)}</div>` : '';
    lastDay = e.day;
    return day + vb.timelineItemHtml({ okey: 'st:' + e.day + '|' + String(e.text).slice(0, 120), emo: h.emo, tone: h.tone,
      textHtml: linkText(e.text, { skip, span: true }), fullHtml: linkText(e.text, { skip }) + (e.ago ? ` <span class="small muted">· vor ${esc(agoDe(e.ago))}</span>` : ''),
      meta: e.ago ? `<i aria-hidden="true">⏱</i> ${esc(vb.agoShort(e.ago))}` : '' });
  }).join('')}</div>`;
}

function panelStory(p) {
  const key = p.id || p.user;
  const cached = logCache.get(key);
  return `<div class="story-host" data-key="${esc(key)}" data-morph-keep data-logfor="${esc(key)}">${cached ? storyHtml(cached.story, key) : '<div class="empty">Lade …</div>'}</div>
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
      if (!r.unchanged || !el.dataset.filled) { morph(el, storyHtml(r.data.story, key)); el.dataset.filled = '1'; }
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

const PANELS = { stats: panelStats, psyche: panelPsyche, psy: panelPsy, ideo: panelIdeo, style: panelStyle, overview: panelOverview, mood: panelMood, log: panelLog, relations: panelRelations, story: panelStory, work: panelWork, isekai: panelIsekai, skills: panelSkills, health: panelHealth, genes: (p) => panelGenes(p, { esc, section, imgUrl: animalImg, openTrait }), gear: panelGear, goals: panelGoals, origin: panelOrigin };

const visibleTabs = (p) => { const v = new Set(visibleSubs(p).map((s) => s.id)); return TABS.filter((t) => t.areas.some((a) => v.has(a))); };
const activeTab = (p) => (visibleTabs(p).some((t) => t.id === curSub) ? curSub : 'overview');
const tabAreas = (p, tab) => { const v = new Set(visibleSubs(p).map((s) => s.id)); return TABS.find((t) => t.id === tab).areas.filter((a) => v.has(a)); };
/** Alte Bereichs-id des gerade offenen Bereichs (z. B. 'relations', 'goals') - fuer alle Pruefungen "laeuft nur, wenn offen". */
const activeArea = (p) => { const tab = activeTab(p); const as = tabAreas(p, tab); return as.includes(areaPref[tab]) ? areaPref[tab] : as[0]; };
const AREA_LABEL = Object.fromEntries(SUBS.map((s) => [s.id, s.label]));

// Paket B: Symbolleiste (eine Zeile, am Handy waagerecht scrollbar) statt Textreitern
const TAB_ICO = { overview: '👤', body: '❤️', char: '🧠', skills: '🛠️', goals: '🎯', life: '📖', style: '✂️' };
const AREA_ICO = { overview: '👤', mood: '😊', health: '🩺', genes: '🧬', gear: '🎒', psyche: '🧠', ideo: '☯️', origin: '🏡', skills: '🛠️', psy: '✨', isekai: '⚔️', stats: '📊', goals: '🎯', relations: '💞', log: '💬', story: '📖', style: '✂️', work: '🔨' };
function subsHtml(p) {
  const cur = activeTab(p);
  return `<div class="ch-tabs ch-iconbar" role="tablist" aria-label="Bereiche des Charakters">${visibleTabs(p).map((t) =>
    `<button type="button" role="tab" class="ch-tab" data-sub="${t.id}" aria-selected="${t.id === cur}" title="${esc(t.label)}"><span class="ct-ico" aria-hidden="true">${TAB_ICO[t.id] || '•'}</span><span class="ct-lab">${esc(t.label)}</span></button>`).join('')}</div>`;
}
/** Inhalt des offenen Reiters: Bereichs-Umschalter (nur bei mehr als einem sichtbaren Bereich) + Panel des Bereichs. */
function tabPanelHtml(p) {
  const as = tabAreas(p, activeTab(p)), cur = activeArea(p);
  const sw = as.length > 1 ? `<div class="log-switch page-subs">${as.map((a) => `<button type="button" class="seg${cur === a ? ' on' : ''}" data-area="${a}" aria-pressed="${cur === a}"><span aria-hidden="true">${AREA_ICO[a] || ''}</span> ${esc(AREA_LABEL[a])}</button>`).join('')}</div>` : '';
  // Ein Fehler in einem Bereich (z. B. unerwartete Daten einer Mod) darf nur diesen Bereich treffen, nie die ganze Ansicht
  let body;
  try { body = PANELS[cur](p); } catch (err) { console.warn('Bereich', cur, err); body = '<div class="empty">Dieser Bereich ist gerade nicht verfügbar.</div>'; }
  return sw + body;
}

/** Zeichnet Hero + Unterreiter + Inhalt in `host`. Der gewählte Reiter bleibt beim Aktualisieren erhalten. */
/** Kachel für den Aktionsblock: großes Symbol, kleine Beschriftung, Preis als Münze. Zustand (Sicher?/…) kommt aus dem HTML (übersteht morph). */
function tileBtn(cmd, args, { ico, label, price = 0, confirm = false, armedLabel = 'Sicher?', tone = 'friend', title = '' } = {}) {
  const key = cmd + ' ' + args;
  const busy = busyKey === key, armed = armedKey === key;
  return `<button type="button" class="act-tile ${tone}${armed ? ' armed' : ''}" data-act="${esc(cmd)}" data-args="${esc(args)}"${confirm ? ' data-confirm="1"' : ''}${busy ? ' disabled' : ''} title="${esc(armed ? 'Zum Bestätigen noch einmal antippen' : title)}"><span class="at-ico" aria-hidden="true">${busy ? '…' : armed ? '❓' : ico}</span><span class="at-lab">${esc(armed ? armedLabel : label)}</span>${price && !armed ? `<span class="at-price"><i aria-hidden="true">🪙</i>${fmt(price)}</span>` : ''}</button>`;
}

// Mit anderen Kolonisten interagieren (nur mit eigenem Kolonisten). Geschenk = RICS Extras, Gespräche = RICS.
const SOCIAL_ACTS = [['chitchat', 'Plaudern', '💬'], ['deeptalk', 'Tiefes Gespräch', '🧠'], ['buildrapport', 'Annähern', '🤝'], ['reassure', 'Trösten', '🫂'], ['flirt', 'Flirten', '💘']];
let giftPrice = 0;

/** EIN Block „Mit <Name> …“: freundliche Kacheln zuerst (grün), Beleidigen und Herausfordern rot am Ende. */
function actionBlockHtml(p) {
  if (!p?.name) return '';
  const linked = live.isLinked();
  if (!linked) return '';
  const hasPawn = !!live.getMe()?.pawn;
  const target = p.user ? '@' + p.user : (p.name || '');
  const nice = [], mean = [];
  const praise = praiseBtnHtml(p);
  if (praise) nice.push(praise);
  if (hasPawn && !isMine(p)) {
    for (const [cmd, label, ico] of SOCIAL_ACTS) if (live.isAllowed(cmd)) nice.push(tileBtn(cmd, target, { ico, label, title: `${label} mit ${p.name}` }));
    if (live.isAllowed('geschenk')) nice.push(tileBtn('geschenk', target, { ico: '🎁', label: 'Geschenk', price: giftPrice, confirm: true, armedLabel: 'Schenken?', tone: 'gift', title: `${p.name} etwas Zufälliges schenken (Bier, Schokolade, Jade …)` }));
    const tut = tutorTile(p);
    if (tut) nice.push(tut);
    if (live.isAllowed('insult')) mean.push(tileBtn('insult', target, { ico: '😠', label: 'Beleidigen', tone: 'foe', title: `${p.name} beleidigen` }));
    if (live.isAllowed('duel')) mean.push(tileBtn('duel', p.user || p.name || '', { ico: '⚔', label: 'Herausfordern', confirm: true, armedLabel: 'Wirklich?', tone: 'foe', title: `${p.name} zu einer Prügelei herausfordern` }));
  }
  if (mean.length) mean[0] = mean[0].replace('class="act-tile foe', 'class="act-tile foe sep');   // rote Kacheln beginnen eine neue Zeile
  const all = [...nice, ...mean];
  if (!all.length) return '';
  return `<div class="card act-block"><div class="ab-head">Mit <b>${esc(p.name)}</b> …</div><div class="ab-grid">${all.join('')}</div>${tutorBox(p)}</div>`;
}

function characterHtml(p) {
  return `<div class="ch" data-key="${esc(p.id || p.user)}">${heroHtml(p)}${actionBlockHtml(p)}${subsHtml(p)}<div class="ch-panel card" role="tabpanel">${tabPanelHtml(p)}</div></div>`;
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

const pickedColor = {};   // gewählte, noch nicht übernommene Farbe je Art (dyehair/setfavoritecolor) - übersteht das Neuzeichnen
function colorRow(p, kind, label, value) {
  const mine = isMine(p) && live.isAllowed(kind);
  let v = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#888888';
  if (pickedColor[kind] && pickedColor[kind].toLowerCase() === v.toLowerCase()) delete pickedColor[kind];   // Server hat sie übernommen
  else if (pickedColor[kind] && mine) v = pickedColor[kind];
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
      const kind = e.target.dataset.styleColor;
      if (kind && /^#[0-9a-f]{6}$/i.test(e.target.value)) pickedColor[kind] = e.target.value;
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

/**
 * Einmaliger Abruf statischer Daten (Glaube, Psycasts, Psyche, Expertise). Ein Fehler darf NIE sofort zu einer neuen Anfrage führen
 * (Fehler -> Neuzeichnen -> Abruf -> Fehler …): nach Fehlern frühestens in 15 s wieder, bei 404 in dieser Sitzung nie wieder.
 * st = { loading, retryAt, gone, at, has }; set(daten) legt die Antwort ab; refreshMs > 0 = nach so langer Zeit erneut laden.
 */
const newLoad = () => ({ loading: false, retryAt: 0, gone: false, at: 0, has: false });
function loadStatic(st, path, set, host, refreshMs = 0) {
  if (st.loading || st.gone || Date.now() < st.retryAt) return;
  if (st.has && !(refreshMs > 0 && Date.now() - st.at >= refreshMs)) return;
  st.loading = true;
  live.getJson(path).then((r) => {
    if (r?.status === 200 && r.data) { set(r.data); st.has = true; st.at = Date.now(); }
    else if (r?.status === 404) st.gone = true;
    else st.retryAt = Date.now() + 15000;
  }).catch(() => { st.retryAt = Date.now() + 15000; })
    .finally(() => { st.loading = false; if (host.isConnected) repaint(host); });
}

// Glaube (Ideology): Meme, Gebote, Rollen, Rituale aus /api/ideos (selten geändert -> einmal laden, alle 60 s auffrischen)
let ideosData = null;
const ideosLd = newLoad();

function ensureIdeos(host) { loadStatic(ideosLd, '/api/ideos', (d) => { ideosData = d; }, host, 60000); }

function ideoItem(key, label, desc, extra = '') {
  const open = openTrait === key; // gleicher Aufklapp-Mechanismus wie Eigenschaften
  return `<button type="button" class="trait ideo-item" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(desc || '')}">${label}${extra}</button>${open && desc ? `<p class="trait-desc">${esc(desc)}</p>` : ''}`;
}

function panelIdeo(p) {
  if (!p.ideo) return '<div class="empty">Kein Glaube.</div>';
  const i = (ideosData?.ideos || []).find((x) => x.id === p.ideo.id);
  const head = `<div class="bgrid">${barRow('Überzeugung', p.ideo.certainty)}</div>`;
  if (!i) return head + `<div class="empty">${ideosLd.gone ? 'Zu dieser Glaubensrichtung gibt es keine Angaben.' : 'Lade die Glaubensrichtung …'}</div>`;
  const memes = section('Meme', `<div class="traits">${(i.memes || []).map((m, n) => ideoItem('im:' + n, `${m.structure ? '✦ ' : ''}${esc(m.label)}`, m.desc)).join('')}</div>`);
  const precepts = i.precepts?.length ? section('Gebote', `<div class="ideo-precepts">${i.precepts.map((x, n) =>
    `<div class="ideo-pre imp-${esc(x.impact)}">${ideoItem('ip:' + n, `<span class="small muted">${esc(x.issue)}:</span> ${esc(x.label)}`, x.desc)}</div>`).join('')}</div>`) : '';
  const roles = i.roles?.length ? section('Rollen', i.roles.map((r, n) =>
    `<div class="ideo-role">${ideoItem('ir:' + n, esc(r.label), r.desc, r.holders?.length ? ` <span class="small muted">· ${r.holders.map((h, k) => { const id = r.holderIds?.[k] || null; return id && id !== (p.id || p.user) ? xrefHtml(h, id, true) : linkText(h, { span: true, skip: p.id || p.user }); }).join(', ')}</span>` : ' <span class="small muted">· unbesetzt</span>')}</div>`).join('')) : '';
  const rituals = i.rituals?.length ? section('Rituale', `<div class="traits">${i.rituals.map((r, n) => ideoItem('it:' + n, esc(r.label), r.desc)).join('')}</div>`) : '';
  const about = `<p class="small muted" style="margin:6px 0 0">${esc(i.name)}${i.culture ? ` · Kultur: ${esc(i.culture)}` : ''} · ${fmt(i.followers)} Anhänger in der Kolonie${i.primary ? ' · Hauptglaube der Kolonie' : ''}</p>`;
  return head + about + (i.desc ? `<p class="ideo-desc">${esc(i.desc)}</p>` : '') + memes + precepts + roles + rituals
    + '<p class="small muted trait-hint">Tippe auf einen Eintrag für die Beschreibung.</p>';
}

// Psycasts (Vanilla Psycasts Expanded): Pfade ("Stile") mit ihren Psycasts je Stufe; gelernt / lernbar / gesperrt.
let psyData = null, psySel = null, psyAll = false;
const psyLd = newLoad();

function ensurePsy(host) { loadStatic(psyLd, '/api/psycasts', (d) => { psyData = d; }, host); }

function panelPsy(p) {
  const k = p.psycasts;
  if (!k) return '<div class="empty">Kein Psycaster.</div>';
  const xpPct = k.xpNext > 0 ? (k.xp / k.xpNext) * 100 : 100;
  const head = `<div class="psy-head"><span class="tag">Psylink Stufe ${fmt(k.level)}</span><span class="tag">${fmt(k.points)} Punkt${k.points === 1 ? '' : 'e'} frei</span></div>
    <div class="bgrid">${barRow('Erfahrung', xpPct, `${fmt(k.xp)} / ${fmt(k.xpNext)}`)}</div>`;
  const paths = psyData?.paths;
  if (!Array.isArray(paths)) return head + `<div class="empty">${psyLd.gone ? 'Die Psycast-Pfade sind nicht vorhanden.' : 'Lade die Psycast-Pfade …'}</div>`;
  const kPaths = Array.isArray(k.paths) ? k.paths : [], kLearned = Array.isArray(k.learned) ? k.learned : [], kLearnable = Array.isArray(k.learnable) ? k.learnable : [], kLearnPaths = Array.isArray(k.learnablePaths) ? k.learnablePaths : [];
  const mine = paths.filter((x) => kPaths.includes(x.id));
  const shown = psyAll || !mine.length ? paths : mine;
  if (!psySel || !shown.some((x) => x.id === psySel)) psySel = (mine[0] || paths[0])?.id;
  const chips = shown.map((x) => {
    const own = kPaths.includes(x.id), can = kLearnPaths.includes(x.id);
    return `<button type="button" class="seg psy-path${x.id === psySel ? ' on' : ''}${own ? ' own' : ''}" data-psypath="${esc(x.id)}">${own ? '★ ' : ''}${esc(x.label)}${can ? ' <span class="small">· freischaltbar</span>' : ''}</button>`;
  }).join('');
  const toggle = mine.length ? `<button type="button" class="linklike small" data-psyall>${psyAll ? 'Nur eigene Pfade' : `Alle ${paths.length} Pfade ansehen`}</button>` : '';
  const path = paths.find((x) => x.id === psySel);
  let body = '';
  if (path) {
    const own = kPaths.includes(path.id);
    const byLevel = new Map();
    const abilities = Array.isArray(path.abilities) ? path.abilities : [];
    for (const a of abilities) { if (!byLevel.has(a.level)) byLevel.set(a.level, []); byLevel.get(a.level).push(a); }
    const names = new Map(abilities.map((a) => [a.id, a.label]));
    const rows = [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, list]) => `<div class="psy-row"><span class="psy-lvl">Stufe ${fmt(lvl)}</span><div class="psy-abs">${list.map((a) => {
      const st = kLearned.includes(a.id) ? 'learned' : kLearnable.includes(a.id) ? 'learnable' : 'locked';
      const key = 'pa:' + a.id, open = openTrait === key;
      return `<button type="button" class="psy-ab st-${st}" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(a.desc)}">${esc(a.label)}</button>`;
    }).join('')}</div></div>`).join('');
    const sel = abilities.find((a) => openTrait === 'pa:' + a.id);
    const info = sel ? `<div class="isk-info"><b>${esc(sel.label)}</b> <span class="small muted">Stufe ${fmt(sel.level)}</span>
      ${(sel.prereqs || []).length ? `<div class="small muted">Braucht: ${esc(sel.prereqs.map((x) => names.get(x) || x).join(', '))}</div>` : ''}
      <p class="isk-desc">${esc(sel.desc)}</p></div>` : '<p class="small muted trait-hint">Tippe auf einen Psycast für die Beschreibung.</p>';
    body = `<p class="ideo-desc">${esc(path.desc)}</p>${!own && path.locked ? `<p class="small muted">🔒 ${esc(path.locked)}</p>` : ''}
      <div class="psy-grid">${rows}</div>
      <p class="small muted isk-legend"><i class="lg learned"></i>gelernt <i class="lg learnable"></i>lernbar <i class="lg locked"></i>gesperrt</p>${info}`;
  }
  return head + section('Pfade', `<div class="log-switch psy-paths">${chips}</div>${toggle}`) + body;
}

// =====================================================================
// Psyche (RimPsyche): Persönlichkeit als Regler zwischen zwei Polen, Interessen als Balken,
// Liebe (Orientierung, Kinsey-Skala, Libido). Körperbau (Rimbody) steht bei „Gesundheit“.
// Nur Werte aus dem Spiel; Beschreibungen erst beim Antippen.
// =====================================================================
let pchData = null, pchHost = null, psyAllP = false;
const pchLd = newLoad();
const PSYV_KEY = 'ys-psyche-view';
let psyView = lsGet(PSYV_KEY) || 'pers';

function ensurePch() { if (pchHost) loadStatic(pchLd, '/api/psyche', (d) => { pchData = d; }, pchHost); }

function persHtml(ps) {
  const defs = pchData.personalities || [];
  const rows = defs.filter((d) => ps.personality[d.id] != null)
    .map((d) => ({ d, v: Number(ps.personality[d.id]) }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  if (!rows.length) return '<div class="empty">Keine Persönlichkeitswerte.</div>';
  const shown = psyAllP ? rows : rows.slice(0, 8);
  const html = shown.map(({ d, v }) => {
    const key = 'pp:' + d.id, open = openTrait === key;
    const pos = clamp((v + 1) * 50);
    const hi = v >= 0;
    const strong = Math.abs(v) >= 0.6 ? ' strong' : Math.abs(v) < 0.2 ? ' weak' : '';
    const desc = hi ? d.highDesc : d.lowDesc;
    const fill = hi ? `left:50%;width:${(pos - 50).toFixed(1)}%` : `left:${pos.toFixed(1)}%;width:${(50 - pos).toFixed(1)}%`;
    return `<button type="button" class="pslider${strong}" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(desc)}">
      <span class="ps-lo${hi ? '' : ' on'}">${esc(d.low)}</span>
      <span class="ps-track"><i class="ps-mid"></i><i class="ps-fill" style="${fill}"></i><i class="ps-dot" style="left:${pos.toFixed(1)}%"></i></span>
      <span class="ps-hi${hi ? ' on' : ''}">${esc(d.high)}</span></button>
      ${open && desc ? `<div class="trait-desc">${esc(desc)}</div>` : ''}`;
  }).join('');
  const more = rows.length > 8 ? `<button type="button" class="linklike" data-psyallp>${psyAllP ? 'Nur die stärksten zeigen' : `Alle ${rows.length} anzeigen`}</button>` : '';
  return `<div class="ps-list">${html}</div>${more}<p class="small muted trait-hint">Je weiter der Punkt außen, desto ausgeprägter. Antippen erklärt es.</p>`;
}

function interestsHtml(ps) {
  const defs = new Map((pchData.interests || []).map((i) => [i.id, i]));
  const rows = Object.entries(ps.interests || {}).map(([id, v]) => ({ i: defs.get(id) || { id, label: id }, v: Number(v) }))
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return '<div class="empty">Keine Interessen erfasst.</div>';
  const one = (x) => {
    const key = 'pi:' + x.i.id, open = openTrait === key;
    return `<button type="button" class="pint" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(x.i.desc || '')}">
      <span class="pi-l">${esc(x.i.label)}</span><span class="pi-bar"><i style="width:${clamp(x.v).toFixed(0)}%"></i></span></button>
      ${open && x.i.desc ? `<div class="trait-desc">${esc(x.i.desc)}</div>` : ''}`;
  };
  const top = rows.slice(0, 5), low = rows.length > 5 ? rows.slice(-3).reverse() : [];
  return `<div class="pi-cols"><div><h5 class="sub-h">Mag am liebsten</h5>${top.map(one).join('')}</div>
    ${low.length ? `<div><h5 class="sub-h">Interessiert sich kaum für</h5>${low.map(one).join('')}</div>` : ''}</div>`;
}

function loveHtml(ps) {
  const sx = ps.sexuality;
  if (!sx) return '<div class="empty">Zur Liebe zeigt das Spiel hier nichts an.</div>';
  const k = sx.kinsey;
  const kin = k == null ? '' : `<div class="kinsey" title="Kinsey-Skala: 0 = nur anderes Geschlecht, 6 = nur gleiches Geschlecht">
    ${[0, 1, 2, 3, 4, 5, 6].map((n) => `<i class="${n === k ? 'on' : ''}">${n}</i>`).join('')}</div>
    <div class="kinsey-legend small muted"><span>anderes Geschlecht</span><span>gleiches Geschlecht</span></div>`;
  const meter = (label, v) => (v == null ? '' : barRow(label, clamp(Number(v) * 100), `${Math.round(Number(v) * 100)} %`, 'acc', 'wide'));
  const key = 'lv:o', open = openTrait === key;
  return `<button type="button" class="love-head" data-trait="${esc(key)}" aria-expanded="${open}"><span class="love-ico" aria-hidden="true">♥</span><b>${esc(sx.orientation || 'Orientierung')}</b></button>
    ${open && sx.orientationDesc ? `<div class="trait-desc">${esc(sx.orientationDesc)}</div>` : ''}
    ${kin}<div class="bgrid love-meters">${meter('Libido', sx.drive)}${meter('Anziehung', sx.attraction)}</div>`;
}

function panelPsyche(p) {
  const ps = p.psyche;
  if (!ps) return '<div class="empty">Keine Psyche-Daten.</div>';
  if (!pchData) { ensurePch(); return `<div class="empty">${pchLd.gone ? 'Zur Psyche gibt es hier keine Angaben.' : 'Lade …'}</div>`; }
  const views = [['pers', 'Persönlichkeit', !!ps.personality], ['int', 'Interessen', !!ps.interests], ['love', 'Liebe', !!ps.sexuality]].filter((v) => v[2]);
  if (!views.length) return '<div class="empty">Keine Psyche-Daten.</div>';
  if (!views.some((v) => v[0] === psyView)) psyView = views[0][0];
  const sw = views.length > 1 ? `<div class="log-switch page-subs">${views.map(([k, l]) => `<button type="button" class="seg${psyView === k ? ' on' : ''}" data-psyv="${k}" aria-pressed="${psyView === k}">${l}</button>`).join('')}</div>` : '';
  const body = psyView === 'int' ? interestsHtml(ps) : psyView === 'love' ? loveHtml(ps) : persHtml(ps);
  return `<div class="psyche">${sw}${body}</div>`;
}

// ---------- Körperbau (Rimbody) – Teil von „Gesundheit“ ----------
// Figur vorne/hinten; jede Muskelgruppe färbt sich nach Ermüdung (grün = frisch, rot = ermüdet)
const BODY_SHAPES = {
  front: [['shoulder', 'M38 50 q-12 2 -14 14 l10 4 q2 -10 8 -12z M82 50 q12 2 14 14 l-10 4 q-2 -10 -8 -12z'],
    ['chest', 'M44 52 h32 q2 14 -4 20 h-24 q-6 -6 -4 -20z'],
    ['biceps', 'M24 68 l10 4 l-3 22 l-9 -2z M96 68 l-10 4 l3 22 l9 -2z'],
    ['core', 'M48 74 h24 l-2 34 h-20z'],
    ['quads', 'M47 114 h12 l-2 44 h-10z M61 114 h12 l0 44 h-10z']],
  back: [['shoulder', 'M38 50 q-12 2 -14 14 l10 4 q2 -10 8 -12z M82 50 q12 2 14 14 l-10 4 q-2 -10 -8 -12z'],
    ['back', 'M44 52 h32 l-4 50 h-24z'],
    ['triceps', 'M24 68 l10 4 l-3 22 l-9 -2z M96 68 l-10 4 l3 22 l9 -2z'],
    ['glutes', 'M47 104 h26 l2 14 h-30z'],
    ['hams', 'M47 120 h12 l-2 40 h-10z M61 120 h12 l0 40 h-10z']],
};
const BODY_OUTLINE = 'M60 18 a12 12 0 1 1 -0.1 0z M38 48 h44 q16 2 18 18 l-6 34 l-10 -2 l2 -26 l-4 -2 l-2 40 l4 6 l-2 44 l-14 0 l-6 -40 l-6 40 l-14 0 l-2 -44 l4 -6 l-2 -40 l-4 2 l2 26 l-10 2 l-6 -34 q2 -16 18 -18z';

function fatigueColor(v) {
  const t = clamp(Number(v) || 0) / 100;
  return `hsl(${Math.round(120 - 120 * t)} 65% 45%)`;
}

function bodyFigure(b, side) {
  if (!Array.isArray(pchData?.body?.parts)) return '';
  const parts = pchData.body.parts.map((x) => x.id);
  const val = (id) => (Array.isArray(b.fatigue) ? b.fatigue[parts.indexOf(id)] : null);
  const label = (id) => pchData.body.parts.find((x) => x.id === id)?.label || id;
  const shapes = BODY_SHAPES[side].map(([id, d]) => {
    const v = val(id);
    return `<path d="${d}" fill="${v == null ? 'var(--surface-2)' : fatigueColor(v)}"><title>${esc(label(id))}: ${v == null ? '–' : Math.round(v) + ' % ermüdet'}</title></path>`;
  }).join('');
  return `<figure class="bfig"><svg viewBox="0 0 120 170" role="img" aria-label="Muskelgruppen ${side === 'front' ? 'vorne' : 'hinten'}"><path class="bf-out" d="${BODY_OUTLINE}"/>${shapes}</svg><figcaption class="small muted">${side === 'front' ? 'vorne' : 'hinten'}</figcaption></figure>`;
}

function scaleHtml(label, v, goal, lo, hi, max, loL, hiL) {
  const P = (x) => clamp((Number(x) / max) * 100);
  return `<div class="bscale"><div class="bs-top"><span>${esc(label)}</span><b>${fmt(Math.round(v))}</b></div>
    <div class="bs-track"><i class="bs-zone lo" style="width:${P(lo).toFixed(1)}%"></i><i class="bs-zone hi" style="left:${P(hi).toFixed(1)}%;width:${(100 - P(hi)).toFixed(1)}%"></i>
      ${goal != null ? `<i class="bs-goal" style="left:${P(goal).toFixed(1)}%" title="Ziel: ${fmt(Math.round(goal))}"></i>` : ''}<i class="bs-dot" style="left:${P(v).toFixed(1)}%"></i></div>
    <div class="bs-leg small muted"><span>${esc(loL)}</span><span>${esc(hiL)}</span></div></div>`;
}

function bodyHtml(p) {
  const b = p.psyche?.body;
  if (!b) return '';
  if (!pchData) { ensurePch(); return ''; }
  if (!pchData.body) return '';
  const B = pchData.body;
  const scales = scaleHtml('Körperfett', b.fat, b.fatGoal, B.fatThin, B.fatFat, B.max, 'schlank', 'füllig')
    + scaleHtml('Muskelmasse', b.muscle, b.muscleGoal, B.muscleThin, B.muscleHulk, B.max, 'schmächtig', 'muskulös');
  const ex = b.exhaustion != null && b.exhaustion > 0 ? barRow('Erschöpfung', clamp(b.exhaustion), `${Math.round(b.exhaustion)} %`, b.exhaustion > 60 ? 'low' : 'acc', 'wide') : '';
  const figs = Array.isArray(b.fatigue) && b.fatigue.length
    ? `<div class="bfigs">${bodyFigure(b, 'front')}${bodyFigure(b, 'back')}</div>`
    : '';
  const leg = figs ? `<p class="small muted bf-leg"><i class="bf-sw" style="background:${fatigueColor(0)}"></i>frisch <i class="bf-sw" style="background:${fatigueColor(100)}"></i>ermüdet (nach Training)</p>` : '';
  return section('Körperbau', `<div class="body-wrap">${figs ? `<div>${figs}${leg}</div>` : ''}<div class="bscales">${scales}${ex}</div></div>`);
}

// Expertise (Vanilla Skills Expanded): alle möglichen Expertisen je Fertigkeit zum Nachlesen, eigene hervorgehoben.
// Vergeben tut sie der Streamer – hier nur lesen.
let expData = null;
const expLd = newLoad();

function ensureExp(host) { loadStatic(expLd, '/api/expertise', (d) => { expData = d; }, host); }
let expHost = null;
const ensureExpLazy = () => { if (expHost) ensureExp(expHost); };

function expertiseHtml(p) {
  const ex = p.expertise;
  if (!ex) return '';
  if (!expData || !Array.isArray(expData.skills)) { ensureExpLazy(); return ''; }
  const own = new Map((ex.owned || []).map((e) => [e.id, e.level]));
  const avail = new Set(ex.available || []);
  const groups = expData.skills.map((g) => {
    const items = (g.list || []).filter((e) => own.has(e.id) || avail.has(e.id));
    if (!items.length) return '';
    const html = items.map((e) => {
      const key = 'ex:' + e.id, open = openTrait === key, has = own.has(e.id);
      return `<button type="button" class="trait exp-item${has ? ' own' : ''}" data-trait="${esc(key)}" aria-expanded="${open}" title="${esc(e.desc)}">${esc(e.label)}${has ? ` · Stufe ${fmt(own.get(e.id))}` : ' · möglich'}</button>`
        + (open ? `<div class="trait-desc">${esc(e.desc)}${(e.effects || []).length ? `<ul class="isk-bonus">${e.effects.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '');
    }).join('');
    return `<div class="exp-group"><div class="small muted exp-skill">${esc(g.skill)}</div><div class="traits">${html}</div></div>`;
  }).join('');
  if (!groups) return '';
  const hint = avail.size ? `<p class="small muted" style="margin:0 0 6px">„möglich“ = ${esc(p.name)} kann diese Expertise jetzt bekommen – vergeben wird sie vom Streamer.</p>` : '';
  return section('Expertise', hint + groups);
}

function afterPaint(host) {
  fillPics(host);
  startLogPoll(host);
  startRelPoll(host);
  startStoryPoll(host);
  startStylePoll(host);
  startGoalsPoll(host);
  startStatsPoll(host);
  ensureBadgeLog(host);
  startInterPoll(host);
  refreshBadges(host);
  if (host._pawn && activeArea(host._pawn) === 'isekai') ensureTrees(host);
  if (host._pawn && activeArea(host._pawn) === 'ideo') ensureIdeos(host);
  if (host._pawn && activeArea(host._pawn) === 'psy') ensurePsy(host);
  expHost = host;
  pchHost = host;
  if (host._pawn && activeArea(host._pawn) === 'skills' && host._pawn.expertise) ensureExp(host);
}

/** Inhalt des offenen Unterreiters per morph neu zeichnen (kein Flackern, Zustand der Knöpfe bleibt). */
function repaint(host) {
  host.querySelector('.sty-host')?._draw?.();
  const p = host._pawn;
  const panel = host.querySelector('.ch-panel');
  if (!p || !panel) return;
  morph(panel, tabPanelHtml(p));
  afterPaint(host);
}

function fullRepaint(host) {
  if (!host._pawn) return;
  morph(host, characterHtml(host._pawn));
  afterPaint(host);
}

/** GameInfo (Lob-Zähler, Nachhilfe, Preise) für die Charakterseite: alle 15 s, nur solange sie offen ist. */
function startInterPoll(host) {
  if (host._interPoll) return;
  host._interPoll = true;
  let last = interKey(gameInfo);
  live.poll({
    path: '/api/game', every: 15000,
    alive: () => { const ok = host.isConnected; if (!ok) host._interPoll = false; return ok; },
    onResult: (r) => {
      if (r.status !== 200 || !r.data) return;
      noteGame(r.data);
      const k = interKey(r.data);
      if (k !== last) { last = k; fullRepaint(host); }
    },
  });
}

function mountCharacter(host, p) {
  host._pawn = p;
  noteFullName(p.id || p.user, p.fullName);
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
    const ar = e.target.closest('[data-area]');
    const tr = e.target.closest('[data-trait]');
    const lk = e.target.closest('[data-logkind]');
    const ab = e.target.closest('[data-act]');
    const tc = e.target.closest('[data-tree]');
    const at = e.target.closest('[data-alltrees]');
    const nd = e.target.closest('[data-node]');
    const az = e.target.closest('[data-art-zoom]');
    const rn = e.target.closest('[data-relnode]');
    if (rn) {
      if (rn.dataset.relgo) { location.hash = '#/kolonie/' + encodeURIComponent(rn.dataset.relgo); return; }
      const row = [...host.querySelectorAll('[data-relkey]')].find((x) => x.dataset.relkey === rn.dataset.relnode);
      if (row) {
        row.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        row.classList.remove('rel-hit'); void row.offsetWidth; row.classList.add('rel-hit');
        setTimeout(() => row.classList.remove('rel-hit'), 2200);
      }
      return;
    }
    if (az) { artBig = !artBig; if (host._pawn) morph(host, characterHtml(host._pawn)); afterPaint(host); return; }
    if (pawn && e.target.closest('[data-tutor-toggle]')) { tutorOpen = !tutorOpen; fullRepaint(host); return; }
    // Knöpfe außerhalb des Panels (Kopf, Herausfordern, Nachhilfe …) brauchen ein Neuzeichnen des Ganzen für „Sicher?“/„…“
    if (pawn && ab) { runAct(host, ab, ab.closest('.ch-panel') ? undefined : () => fullRepaint(host)); return; }
    const pv = e.target.closest('[data-psyv]');
    if (pawn && pv) { psyView = pv.dataset.psyv; lsSet(PSYV_KEY, psyView); openTrait = null; repaint(host); return; }
    if (pawn && e.target.closest('[data-psyallp]')) { psyAllP = !psyAllP; repaint(host); return; }
    const pp = e.target.closest('[data-psypath]');
    if (pawn && pp) { psySel = pp.dataset.psypath; openTrait = null; repaint(host); return; }
    if (pawn && e.target.closest('[data-psyall]')) { psyAll = !psyAll; repaint(host); return; }
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
      host.querySelector(".ch-panel").innerHTML = tabPanelHtml(pawn);
      afterPaint(host);
      return;
    }
    if (pawn && ar) {
      areaPref[activeTab(pawn)] = ar.dataset.area; lsSet(AREA_KEY, JSON.stringify(areaPref)); openTrait = null;
      host.querySelector('.ch-panel').innerHTML = tabPanelHtml(pawn);
      afterPaint(host);
      return;
    }
    if (!pawn || !(sub || tr)) return;
    if (sub) {
      curSub = sub.dataset.sub; lsSet(SUB_KEY, curSub);
      host.querySelectorAll('.ch-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === curSub)));
      host.querySelector('.ch-panel').innerHTML = tabPanelHtml(pawn);
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
  return A.colonyTileHtml(p, meUser);
}

export function kolonieView() {
  let user = '';
  try { user = decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[1] || ''); } catch { user = ''; }   // kaputte %-Folge in der Adresse: Kolonie-Liste
  return user ? pawnDetail(user) : colonyList();
}

// Tiere: Gebundene immer einzeln, die übrigen bei vielen Tieren nach Art gruppiert
const openKinds = new Set();
const genderSym = (g) => (/^(w|f)/i.test(g || '') ? '♀' : /^m/i.test(g || '') ? '♂' : '');

function animalChips(a) {
  const conds = (Array.isArray(a.conditions) ? a.conditions : []).map((c) => (typeof c === 'string' ? { label: c } : c)).filter((c) => c && c.label);
  conds.sort((x, y) => (y.bleeding ? 1 : 0) - (x.bleeding ? 1 : 0) || (y.bad ? 1 : 0) - (x.bad ? 1 : 0));
  const shown = conds.slice(0, 4);
  let out = shown.map((c) => `<span class="an-chip${c.bleeding ? ' bleed' : c.bad ? ' bad' : ''}" title="${esc(c.part ? `${c.label} · ${c.part}` : c.label)}">${c.bleeding ? '🩸 ' : ''}${esc(c.label)}</span>`).join('');
  if (conds.length > shown.length) out += `<span class="an-chip">+${conds.length - shown.length}</span>`;
  if (a.bleeding && !conds.some((c) => c.bleeding)) out = '<span class="an-chip bleed">🩸 blutet</span>' + out;
  return out ? `<div class="an-chips">${out}</div>` : '';
}

// Querverweis: Name eines Kolonisten als Link auf seine Seite (ohne id nur Text)
const pawnLink = (name, id) => (id ? `<a class="xref" data-xgo="${esc(id)}" href="#/kolonie/${encodeURIComponent(id)}">${esc(name)}</a>` : `<b>${esc(name)}</b>`);

// ---------- Querverweise: Namen von Kolonisten (und Tieren) im Text werden zu Links ----------
// Zuordnung Name -> Seite aus der zuletzt geladenen Kolonie-Liste (Rufname, volle Namen aus Detail/Beziehungen, Zuschauername).
// Mehrdeutige Namen (zwei Kolonisten gleichen Namens) werden nie verlinkt. Immer: erst Rohtext zerlegen, Teile einzeln escapen.
const px = { list: [], full: new Map(), animals: [], byName: new Map(), byUser: new Map(), animalNames: new Set(), re: null, sig: '', ver: 0 };
const pxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pxRegex = (names) => {
  const arr = [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!arr.length) return null;
  try { return new RegExp(`(?<![\\p{L}\\p{N}_])(${arr.map(pxEsc).join('|')})(?=s?(?![\\p{L}\\p{N}_]))`, 'gu'); } catch { return null; }   // ältere Browser ohne Lookbehind: keine Links
};
function pxBuild() {
  const key = JSON.stringify([px.list.map((q) => [q.id, q.name, q.user]), [...px.full], px.animals]);
  if (key === px.sig) return;
  px.sig = key; px.ver++;
  px.byName = new Map(); px.byUser = new Map(); px.animalNames = new Set();
  const add = (name, id) => {
    name = String(name || '').trim();
    if (name.length < 3 || !id) return;
    const cur = px.byName.get(name);
    if (cur === undefined) px.byName.set(name, id); else if (cur !== id) px.byName.set(name, null);   // null = mehrdeutig
  };
  const alive = new Set();
  for (const q of px.list) {
    const id = q.id || q.user;
    if (!id) continue;
    alive.add(id);
    add(q.name, id);
    if (q.user) px.byUser.set(String(q.user).toLowerCase(), id);
  }
  for (const [id, full] of px.full) if (alive.has(id)) add(full, id);
  for (const n of px.animals) { const t = String(n || '').trim(); if (t.length >= 3 && !px.byName.has(t)) px.animalNames.add(t); }
  px.re = pxRegex([...[...px.byName].filter(([, v]) => v).map(([k]) => k), ...px.animalNames]);
}
/** Kolonie-Liste (PawnSummary[]) merken. */
function noteColony(list) { if (Array.isArray(list)) px.list = list.map((q) => ({ id: q.id, name: q.name, user: q.user, portrait: q.portrait })); }
/** Voller Name zu einer id (aus Detail/Beziehungen). */
function noteFullName(id, full) { if (id && full && px.full.get(id) !== full) px.full.set(id, full); }
const userPawnId = (user) => { pxBuild(); return px.byUser.get(String(user ?? '').replace(/^@/, '').trim().toLowerCase()) || null; };

const xrefHtml = (name, id, span) => (span
  ? `<span class="xref" role="link" data-xgo="${esc(id)}">${esc(name)}</span>`
  : `<a class="xref" data-xgo="${esc(id)}" href="#/kolonie/${encodeURIComponent(id)}">${esc(name)}</a>`);
const animalXref = (name, span) => (span
  ? `<span class="xref" role="link" data-xanimal="1">${esc(name)}</span>`
  : `<a class="xref" data-xanimal="1" href="#/kolonie">${esc(name)}</a>`);

/**
 * Text -> HTML mit Links auf Kolonisten (Tiere: auf Kolonie > Tiere). o.span: Link als <span> (innerhalb von Knöpfen),
 * o.skip: id, die nicht verlinkt wird (die Seite, auf der man schon ist), o.pawns: [{id, name}] aus der Mod (genauer als die Namenssuche).
 */
function linkText(text, o = {}) {
  const raw = live.stripTags(text == null ? '' : String(text));
  pxBuild();
  const local = new Map();
  for (const q of o.pawns || []) if (q && q.id && String(q.name || '').trim().length >= 2) local.set(String(q.name).trim(), String(q.id));
  let re = px.re;
  if (local.size) {
    const names = new Set([...px.byName].filter(([, v]) => v).map(([k]) => k));
    for (const n of px.animalNames) names.add(n);
    for (const n of local.keys()) names.add(n);
    re = pxRegex(names);
  }
  if (!re) return escRaw(raw);
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(raw))) {
    const nm = m[1];
    const id = local.get(nm) ?? px.byName.get(nm);
    out += escRaw(raw.slice(last, m.index));
    last = m.index + nm.length;
    if (id && id !== o.skip) out += xrefHtml(nm, id, o.span);
    else if (!id && px.animalNames.has(nm) && px.byName.get(nm) === undefined) out += animalXref(nm, o.span);
    else out += escRaw(nm);
  }
  return out + escRaw(raw.slice(last));
}

/** Klick auf einen Querverweis (auch in Knöpfen): zum Kolonisten bzw. zu den Tieren, ohne dass der Eltern-Knopf aufklappt. */
function xrefClick(e) {
  const x = e.target.closest?.('[data-xgo],[data-xanimal]');
  if (!x || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault(); e.stopPropagation();
  if (x.dataset.xgo) { location.hash = '#/kolonie/' + encodeURIComponent(x.dataset.xgo); return; }
  kolSub = 'animals'; saveSub('ys-kol-sub', kolSub);
  if (/^#\/?kolonie\/?$/.test(location.hash)) document.querySelector('[data-kolsub="animals"]')?.click();
  else location.hash = '#/kolonie';
}

// Kleine Balkenzeile in der Tierkachel: Name · Balken (Farbe nach Zustand) · Prozent
const anBar = (label, pct, tn) => `<div class="an-bar"><span>${esc(label)}</span>${bar(clamp(pct), tn)}<span class="an-pct">${Math.round(clamp(pct))} %</span></div>`;

function animalRow(a) {
  const name = a.name ? esc(a.name) : esc(a.kind);
  const age = a.age != null ? `${fmt(Math.round(Number(a.age) * 10) / 10)} J.` : '';
  const meta = [a.name ? a.kind : '', genderSym(a.gender), age].filter(Boolean).join(' · ');
  const needs = (Array.isArray(a.needs) ? a.needs : []).filter((n) => n && n.label && n.pct != null);
  const bars = anBar('Gesundheit', a.healthPct)
    + needs.map((n) => anBar(n.label, n.pct)).join('')
    + (Number(a.pain) > 0 ? anBar('Schmerz', a.pain, Number(a.pain) >= 30 ? 'low' : 'mid') : '');
  return `<div class="an an-row${a.bond ? ' bonded' : ''}">
    <div class="an-head"><div class="an-pic">${animalPic(a)}</div>
      <div class="an-title"><b class="an-name">${name}</b><span class="small muted">${esc(meta)}</span></div></div>
    <div class="an-bars">${bars}</div>
    ${animalChips(a)}
    ${a.bond ? `<div class="an-bond"><span class="heart" aria-hidden="true">♥</span> gebunden an ${pawnLink(a.bond, a.bondId)}</div>` : ''}
    ${a.master ? `<div class="small muted">Meister: ${pawnLink(a.master, a.masterId)}</div>` : ''}
    ${sponsorHtml(a)}
  </div>`;
}

function animalsHtml(list) {
  if (!Array.isArray(list)) return '';
  curAnimals = list;
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
    const hurt = arr.filter((a) => Number(a.pain) > 0 || (Array.isArray(a.conditions) && a.conditions.some((c) => c?.bad || c?.bleeding))).length;
    // Gruppe: schlechtester Wert je Bedürfnis (Hunger usw.), damit man Probleme ohne Aufklappen sieht
    const needMin = new Map();
    arr.forEach((x) => (Array.isArray(x.needs) ? x.needs : []).forEach((n) => { if (n?.label && n.pct != null) needMin.set(n.label, Math.min(needMin.get(n.label) ?? 100, Number(n.pct))); }));
    out += `<button type="button" class="an an-group an-row" data-kind="${esc(kind)}" aria-expanded="${open}">
      <div class="an-head"><div class="an-pic">${animalPic(arr[0])}</div>
        <div class="an-title"><b class="an-name">${esc(kind)} ×${arr.length}</b><span class="small muted">${open ? '▾ zuklappen' : '▸ alle zeigen'}</span></div></div>
      <div class="an-bars">${anBar('Gesundheit', worst)}${[...needMin].map(([l, v]) => anBar(l, v)).join('')}</div>
      <div class="small muted">schwächste Werte der Gruppe${hurt ? ` · ${hurt} verletzt/krank` : ''}</div></button>`;
    if (open) out += `<div class="an-sub">${arr.map(animalRow).join('')}</div>`;
  }
  return out;
}

// Ranglisten aus /api/colony: Podest für Platz 1–3, darunter Balkenzeilen – keine Münzen, nur Leistung der Kolonisten
function ranksHtml(list) {
  return A.ranksHtml(list, gameInfo?.praise);
}

// Unterreiter in langen Seiten (Kolonie, Spiel): Wahl bleibt beim Seitenwechsel erhalten
function subTabsHtml(tabs, cur, attr) {
  return `<div class="log-switch page-subs" role="tablist">${tabs.map(([k, l]) =>
    `<button type="button" class="seg${cur === k ? ' on' : ''}" data-${attr}="${k}" role="tab" aria-selected="${cur === k}">${l}</button>`).join('')}</div>`;
}
const loadSub = (key, def, ok) => { try { const v = localStorage.getItem(key); return ok.includes(v) ? v : def; } catch { return def; } };
const saveSub = (key, v) => { try { localStorage.setItem(key, v); } catch { /* egal */ } };

const KOL_SUBS = [['pawns', 'Kolonisten'], ['animals', 'Tiere'], ['ranks', 'Ranglisten']];
let kolSub = loadSub('ys-kol-sub', 'pawns', KOL_SUBS.map((x) => x[0]));

function colonyList() {
  const html = `<div class="live-page">
    <div class="kol-head"><h2 class="section-title" style="margin:0">Die Kolonie</h2><span class="small muted" id="kol-count"></span></div>
    <div id="kol-duel"></div>
    <div id="kol-subs">${subTabsHtml(KOL_SUBS, kolSub, 'kolsub')}</div>
    <div id="kol-grid" class="kol-grid" data-sub="pawns"><div class="empty" style="grid-column:1/-1">Lade …</div></div>
    <div id="kol-ranks" data-sub="ranks"></div>
    <section id="tiere-sec" data-sub="animals">
      <div class="kol-head"><span class="small muted" id="tiere-count"></span></div>
      <div id="tiere" class="an-grid"><div class="empty">Lade …</div></div>
    </section></div>`;
  function bind(root) {
    const grid = root.querySelector('#kol-grid'), count = root.querySelector('#kol-count'), ranks = root.querySelector('#kol-ranks');
    const showSub = () => {
      root.querySelectorAll('[data-sub]').forEach((el) => { el.hidden = el.dataset.sub !== kolSub; });
      root.querySelector('#kol-subs').innerHTML = subTabsHtml(KOL_SUBS, kolSub, 'kolsub');
    };
    showSub();
    root.querySelector('#kol-subs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kolsub]');
      if (!b || b.dataset.kolsub === kolSub) return;
      kolSub = b.dataset.kolsub; saveSub('ys-kol-sub', kolSub); showSub();
    });
    let last = '', plist = [];
    const drawRanks = () => morph(ranks, ranksHtml(plist));
    const draw = (data) => {
      const list = Array.isArray(data?.pawns) ? data.pawns : [];
      const me = live.getMe()?.user;
      const key = JSON.stringify([list, me]);
      if (key === last) return;
      last = key;
      count.textContent = list.length ? `${fmt(list.length)} Kolonist${list.length === 1 ? '' : 'en'}` : '';
      morph(grid, list.length ? list.map((p) => colonyCard(p, me)).join('')
        : `<div class="empty" style="grid-column:1/-1">Noch keine Kolonisten zu sehen. Mit <code>${esc(live.prefix())}join</code> im Chat kannst du die Erste oder der Erste sein.</div>`);
      plist = list; noteColony(list);
      drawRanks();
    };
    live.poll({
      path: '/api/colony', every: 2000, alive: () => grid.isConnected,
      onResult: (r) => { if (r.status === 200 && !r.unchanged) draw(r.data); },
    });
    whileMounted(grid, [['me', () => { last = ''; drawDuel(); drawAnimals(true); }], ['change', () => { drawDuel(); drawAnimals(true); }]]);

    // Tiere: eigene 5-s-Abfrage von /api/game, solange diese Ansicht sichtbar ist
    const sec = root.querySelector('#tiere-sec'), box = root.querySelector('#tiere'), tcount = root.querySelector('#tiere-count');
    let animals = null, alast = '';
    const drawAnimals = (force) => {
      if (!Array.isArray(animals)) return;
      const key = JSON.stringify([animals, pateOpen]);
      if (!force && key === alast) return;
      alast = key;
      tcount.textContent = animals.length ? `${fmt(animals.length)} Tier${animals.length === 1 ? '' : 'e'}` : '';
      morph(box, animalsHtml(animals));
    };
    // Duell-Karte oben (Wetten), Daten aus derselben /api/game-Abfrage
    const duelBox = root.querySelector('#kol-duel');
    let dlast = '';
    const drawDuel = (force) => {
      const html = duelCardHtml(gameInfo);
      if (!force && html === dlast) return;
      dlast = html;
      morph(duelBox, html);
    };
    live.poll({
      path: '/api/game', every: 5000, alive: () => grid.isConnected,
      onResult: (r) => {
        if (r.status === 200 && r.data && !r.unchanged) {
          noteGame(r.data); noteDuel(r.data);
          animals = r.data.animalList; drawAnimals(false); drawDuel(); drawRanks();
        }
      },
    });
    for (const t of ['input', 'change']) duelBox.addEventListener(t, (e) => betInput(e, 'duel', () => drawDuel(true)));
    duelBox.addEventListener('keydown', betKey);
    duelBox.addEventListener('click', (e) => {
      if (betPick(e, () => drawDuel(true))) return;
      const ab = e.target.closest('[data-act]');
      if (ab) runAct(duelBox, ab, () => drawDuel(true));
    });
    box.addEventListener('input', pateInput);
    box.addEventListener('click', (e) => {
      const ab = e.target.closest('[data-act]');
      if (ab) { runAct(box, ab, () => drawAnimals(true)); return; }
      if (pateClick(e, () => drawAnimals(true))) return;
      const g = e.target.closest('[data-kind]');
      if (!g) return;
      const k = g.dataset.kind;
      if (openKinds.has(k)) openKinds.delete(k); else openKinds.add(k);
      drawAnimals(true);
    });
  }
  return { html, bind };
}

let pdHash = null;
function pawnDetail(user) {
  const html = `<div class="live-page"><p class="back"><a href="#/kolonie">← Alle Kolonisten</a></p><div id="pd-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    if (pdHash !== location.hash) scrollPageTo({ top: 0 });   // nur bei neuer Adresse, nicht beim Neuzeichnen derselben Seite
    pdHash = location.hash;
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

// Forschung anschieben (RICS Extras !forschung): +X % aufs laufende Projekt, Pause je Zuschauer
function boostHtml(g) {
  const rb = g?.researchBoost;
  if (!rb || !live.isAllowed('forschung')) return '';
  const what = `+${fmt(rb.percent)} % für ${fmt(rb.price)} 🪙`;
  const rules = `${rb.maxPerDay > 0 ? `max. ${fmt(rb.maxPerDay)}× pro Tag für alle · ` : ''}${vb.clockHtml(`${fmt(rb.viewerCooldownHours)} h`, 'Pause je Zuschauer (Spielstunden)')} je Zuschauer`;
  let ctl;
  if (!live.isLinked()) ctl = `<p class="small muted" style="margin:0">Verbinde dich oben, um die Forschung per Knopf anzuschieben – oder schreib <code>${esc(live.prefix())}forschung</code> in den Chat.</p>`;
  else {
    const wait = Number(live.getMe()?.researchWaitHours);
    ctl = wait > 0
      ? `<button type="button" class="act-btn" disabled>⏱ ${fmt(Math.ceil(wait))} h</button>`
      : actBtn('forschung', '', `🔬 Anschieben · ${what}`, { confirm: true, cls: 'primary rs-push', armedLabel: `${fmt(rb.price)} Münzen – sicher?`, title: `Laufende Forschung um ${fmt(rb.percent)} % anschieben` });
  }
  return `<div class="rs-boost"><div class="small"><b>Forschung anschieben:</b> ${esc(what)} · ${rules}</div>${ctl}</div>`;
}

function researchHtml(res, g) {
  const cur = res ? res.current : g.research;
  let html = cur
    ? `<div class="rs-cur2">${A.ringHtml(cur.pct, `${Math.round(clamp(cur.pct))} %`, true)}<div class="rs-cur2-t"><span class="small muted">Läuft gerade</span><b>${esc(cur.label)}</b></div></div>`
    : '<p class="muted small" style="margin:0">Keine laufende Forschung.</p>';
  if (cur) html += boostHtml(g);
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
        const name = (PROJ[x.state] || PROJ[0])[1];
        const o = openProj === key;
        return `<li><button type="button" class="rs-proj st-${x.state in PROJ ? x.state : 0}" data-rproj="${esc(key)}" aria-expanded="${o}" title="${esc(name)}">
          <span class="rs-ico" aria-hidden="true"><i class="pdot s${x.state in PROJ ? x.state : 0}"></i></span><span class="rs-pl">${esc(x.label)}</span>${x.state === 2 ? `<span class="rs-pct">${Math.round(clamp(x.pct))} %</span>` : ''}<span class="sr-only">${esc(name)}</span></button>
          ${o && x.desc ? `<p class="trait-desc">${esc(x.desc)}</p>` : ''}</li>`;
      }).join('')}</ul>${locked.length ? `<button type="button" class="linklike rs-locked" data-rlocked="${esc(t.label)}">${showL ? 'Gesperrte ausblenden' : `+${locked.length} gesperrt`}</button>` : ''}`;
    }
    return `<div class="rs-tab-wrap"><button type="button" class="rs-tab" data-rtab="${esc(t.label)}" aria-expanded="${open}">
      ${A.ringHtml(pct, `${fmt(t.done)}/${fmt(t.total)}`)}<span class="rs-main"><span class="rs-name">${esc(t.label)}</span>${A.projDots(t.projects)}</span><span class="rs-chev" aria-hidden="true">${open ? '▾' : '▸'}</span></button>${body}</div>`;
  }).join('') + '</div>' + A.projLegend();
  return html;
}


/** Gemeinschaftsziele (RICS Extras): Fortschritt, Belohnung, Top-3. */
function goalsHtml(goals) {
  return A.goalsHtml(goals);
}

/** Vorräte (RICS Extras): Essen in Tagen und Kacheln. */
function stockHtml(s) {
  return A.stockHtml(s);
}

/** Koloniewert-Verlauf (wealthHistory: [Tag, Wert]). Die Linie ist ein SVG ohne Text; Beschriftung kommt als HTML, damit sie nicht skaliert. */
function wealthHtml(hist, events) {
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
      <span class="wv-hi">${fmt(Math.round(hi))}</span><span class="wv-lo">${fmt(Math.round(lo))}</span>${A.wealthMarkers(pts, events, lo, span, BOT, TOP, H)}
      <svg class="wv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Koloniewert von Tag ${fmt(first[0])} bis Tag ${fmt(last[0])}">
        <line class="wv-grid" x1="0" x2="${W}" y1="${TOP}" y2="${TOP}"/>
        <line class="wv-grid" x1="0" x2="${W}" y1="${BOT}" y2="${BOT}"/>
        <path class="wv-area" d="${area}"/>
        <path class="wv-line" d="${line}"/>
      </svg></div>
    <div class="wv-axis small muted"><span>Tag ${fmt(first[0])}</span><span>Tag ${fmt(last[0])}</span></div>`;
}

/** Fraktionen: Wappen, Beziehungsbalken von der Mitte (rot links = feindlich, grün rechts = verbündet). */
function factionsHtml(list) {
  return A.factionsHtml(list, relTone, relSign);
}

/** Besucher & Händler: Gruppen und Handelsschiffe. Ohne beides gar keine Karte (Abschnitt entfällt). */
function visitorsHtml(v, factions) {
  return A.visitorsHtml(v, factions);
}

const SPIEL_SUBS = [['overview', 'Übersicht'], ['research', 'Forschung'], ['stock', 'Vorräte'], ['factions', 'Fraktionen & Besucher'], ['history', 'Koloniewert']];
let spielSub = loadSub('ys-spiel-sub', 'overview', SPIEL_SUBS.map((x) => x[0]));

function spielHtml(g, res) {
  const gEvs = (g.events || []).filter((e) => !isShopLetter(e));
  const tabs = subTabsHtml(SPIEL_SUBS, spielSub, 'spsub');
  let body;
  if (spielSub === 'research') body = `<section class="card ch-sec rs-card"><h4>Forschung</h4>${researchHtml(res, g)}</section>`;
  else if (spielSub === 'stock') body = `<section class="card ch-sec"><h4>Vorräte</h4>${stockHtml(g.stock)}</section>`;
  else if (spielSub === 'factions') body = `<div class="grid cols-2"><section class="card ch-sec"><h4>Fraktionen</h4>${factionsHtml(g.factions)}</section>${visitorsHtml(g.visitors, g.factions)}</div>`;
  else if (spielSub === 'history') body = `<section class="card ch-sec"><h4>Koloniewert-Verlauf</h4>${wealthHtml(g.wealthHistory, gEvs)}</section>`;
  else body = `${A.overviewHtml(g)}${A.duelStripHtml(g)}${slotsCardHtml(g)}
    <div class="grid cols-2" style="margin-top:12px">
      <section class="card ch-sec"><h4>Gerade los</h4>${A.conditionsHtml(g.conditions)}</section>
      <section class="card ch-sec"><h4>Was zuletzt passiert ist</h4>${A.recentEventsHtml(gEvs)}</section>
      ${Array.isArray(g.goals) ? `<section class="card ch-sec" style="grid-column:1/-1"><h4>Gemeinschaftsziele</h4>${goalsHtml(g.goals)}</section>` : ''}
      <section class="card ch-sec"><h4>Erzähler</h4><p style="margin:0"><b>${esc(g.storyteller)}</b></p><p class="muted small" style="margin:4px 0 0">Schwierigkeit: ${esc(g.difficulty)}</p></section>
    </div>`;
  return tabs + body;
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
        noteGame(game); noteDuel(game);
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
    // Knopf „Anschieben“: Wartezeit/Verknüpfung kommen mit /api/me
    let boostKey = '';
    whileMounted(host, [['me', () => { const k = `${live.isLinked()}|${live.getMe()?.researchWaitHours}|${live.getMe()?.pawn?.id}`; if (k !== boostKey) { boostKey = k; draw(true); } }], ['change', () => draw(true)]]);
    for (const t of ['input', 'change']) host.addEventListener(t, (e) => { if (!betInput(e, e.target.closest('.slot-card') ? 'slot' : 'duel', () => draw(true))) return; });
    host.addEventListener('keydown', betKey);
    host.addEventListener('click', (e) => {
      if (betPick(e, () => draw(true))) return;
      if (slotPick(e, () => draw(true))) return;
      if (A.condClick(e, () => draw(true))) return;
      const ab = e.target.closest('[data-act]');
      if (ab) { runAct(host, ab, () => draw(true)); return; }
      const sb = e.target.closest('[data-spsub]');
      if (sb) {
        if (sb.dataset.spsub !== spielSub) { spielSub = sb.dataset.spsub; saveSub('ys-spiel-sub', spielSub); draw(true); }
        return;
      }
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
let evFilter = 'all';
const evOpen = new Set();   // aufgeklappte Einträge (über Schlüssel, übersteht Aktualisierungen)
// Schlüssel ohne „ago“ (das ändert sich ständig): Tag | Titel | laufende Nummer gleicher Einträge am selben Tag (von den ältesten her)
let evKeys = new Map();
const evKey = (e) => evKeys.get(e) ?? `${e.day}|${e.label}|0`;
function indexEvents(list) {
  evKeys = new Map();
  const seen = new Map();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i], base = `${e.day}|${e.label}`, n = seen.get(base) || 0;
    seen.set(base, n + 1);
    evKeys.set(e, `${base}|${n}`);
  }
}

let evView = 'letters'; // 'letters' = Briefe, 'social' = Gespräche unter Kolonisten
let evSocial = [];

// Ziel des Briefs (img: pawn) ist der Kolonist, um den es geht – genauer als die Namenssuche (Rufname + voller Name)
const evPawns = (e) => {
  const m = e?.img;
  if (!m || m.type !== 'pawn' || !m.id || !m.name) return [];
  const first = String(m.name).trim().split(/\s+/)[0];
  return [{ id: m.id, name: m.name }, { id: m.id, name: first }];
};

// Paket B: Gespräch als Zeile „Porträt – Symbol – Porträt“ (Farbe nach good). Ohne kind/good (alte Mod): Satz wie bisher.
function socialListHtml(list, skip) {
  if (!list.some(vb.hasSocialKind)) {
    return `<ol class="logl">${list.map((e) => `<li><span class="log-text">${linkText(e.text, { pawns: e.pawns, skip })}</span><span class="log-ago">vor ${esc(agoDe(e.ago))}</span></li>`).join('')}</ol>`;
  }
  const avatar = (q) => {
    const ver = px.list.find((x) => x.id === q.id)?.portrait;
    const pic = portraitHtml({ name: q.name, id: q.id, portrait: ver || 1 }, 'so-av');
    return q.id ? `<a class="so-av-link" data-xgo="${esc(q.id)}" href="#/kolonie/${encodeURIComponent(q.id)}" title="${esc(q.name)}">${pic}</a>` : pic;
  };
  const link = (q) => (q.id && q.id !== skip ? xrefHtml(q.name, q.id, false) : `<b>${esc(q.name)}</b>`);
  return `<div class="so-list">${list.map((e) => (vb.hasSocialKind(e)
    ? vb.socialRowHtml(e, { avatar, link, text: (t) => linkText(t, { pawns: e.pawns, skip }) })
    : `<div class="so-old"><span class="log-text">${linkText(e.text, { pawns: e.pawns, skip })}</span><span class="log-ago">vor ${esc(agoDe(e.ago))}</span></div>`)).join('')}</div>`;
}

function socialHtml() {
  if (!evSocial.length) return '<div class="empty">Noch keine Gespräche aufgezeichnet.</div>';
  return socialListHtml(evSocial);
}

// Paket B: eine Symbolzeile (Briefe/Gespräche | Art-Filter mit Zähler), Karten mit Farbband und großem Symbol
function eventsLiveHtml(list) {
  const shop = list.filter((e) => !isShopLetter(e));
  const cnt = { all: shop.length, threat: 0, bad: 0, good: 0, neutral: 0 };
  for (const e of shop) cnt[kindOf(e)]++;
  const vbtn = ([k, ico, l]) => `<button type="button" class="ev-ib seg${evView === k ? ' on' : ''}" data-evv="${k}" aria-pressed="${evView === k}" title="${l}"><span class="ev-ib-i" aria-hidden="true">${ico}</span><span class="ev-ib-l">${l}</span></button>`;
  const fbtn = (k) => `<button type="button" class="ev-ib seg${evFilter === k ? ' on' : ''}" data-evf="${k}" aria-pressed="${evFilter === k}" title="${k === 'all' ? 'Alle' : vb.LETTER_KIND[k].title}" aria-label="${k === 'all' ? 'Alle' : vb.LETTER_KIND[k].title}: ${cnt[k]}">`
    + `<span class="ev-ib-i" aria-hidden="true">${k === 'all' ? '☰' : vb.kindIconHtml(k)}</span><span class="ev-ib-n">${cnt[k]}</span></button>`;
  const bar = `<div class="ev-bar" role="toolbar" aria-label="Ansicht und Filter"><span class="ev-grp">${[['letters', '✉️', 'Briefe'], ['social', '💬', 'Gespräche']].map(vbtn).join('')}</span>`
    + (evView === 'letters' ? `<span class="ev-sep" aria-hidden="true"></span><span class="ev-grp" role="group" aria-label="Nach Art filtern">${['all', 'threat', 'bad', 'good', 'neutral'].map(fbtn).join('')}</span>` : '') + '</div>';
  if (evView === 'social') return bar + socialHtml();
  return bar + eventsLettersHtml(list);
}

// Käufe/Lieferungen der Zuschauer (RICS-Briefe „Rimazon Delivery/Pet Delivery/Surgery …“, Rechnungstext mit „RIMAZON …“, „Customer:/Kunde:“) gehören nicht in den Kurier
const isShopLetter = (e) => /rimazon/i.test(`${e?.label || ''} ${e?.text || ''}`) || /^\s*(Customer|Kunde)\s*:/im.test(e?.text || '');
const sentences = (t) => (String(t || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?:["“”»«)]*)|[^.!?]+$/g) || []).map((x) => x.trim()).filter(Boolean);

function eventsLettersHtml(list) {
  list = list.filter((e) => !isShopLetter(e));
  indexEvents(list);
  if (!list.length) return '<div class="empty">Noch keine Briefe aufgezeichnet.</div>';
  const shown = list.filter((e) => evFilter === 'all' || kindOf(e) === evFilter);
  if (!shown.length) return '<div class="empty">Keine Ereignisse in dieser Art.</div>';
  return lettersBody(shown);
}

const badEvImgs = new Set();   // Bild-Adressen, die nicht ladbar waren (404): beim nächsten Zeichnen gar nicht erst anbieten
// Bild zum Ereignis (Feld img: pawn | img | null). Nur echte Bilder; Kolonist ohne Porträt = Initial.
function evFigHtml(e, big) {
  const m = e.img;
  if (!m || typeof m !== 'object') return '';
  let inner = '', cap = '';
  if (m.type === 'pawn' && (m.id || m.name)) {
    cap = m.name || '';
    const src = m.portrait && m.id ? live.portraitUrl(m.id, m.portrait) : '';
    if (src && badEvImgs.has(src)) return '';
    inner = src
      ? `<img class="np-img" data-evimg src="${esc(src)}" alt="${esc(cap)}">`
      : `<span class="np-ph" aria-hidden="true">${esc(String(cap || '?').trim().charAt(0).toUpperCase())}</span>`;
  } else if (m.type === 'img' && m.img) {
    cap = m.name || '';
    const src = live.artUrl('x', 0).replace(/\/api\/art\/.*$/, '/api/img/' + encodeURIComponent(m.img));
    if (badEvImgs.has(src)) return '';
    inner = `<img class="np-img" data-evimg src="${esc(src)}" alt="${esc(cap)}">`;
  } else return '';
  return `<figure class="np-fig${big ? ' big' : ''}">${inner}${big && cap ? `<figcaption class="small muted">${m.type === 'pawn' && m.id ? xrefHtml(cap, m.id, true) : esc(cap)}</figcaption>` : ''}</figure>`;
}

const kindOf = (e) => (KIND_LABEL[e.kind] ? e.kind : 'neutral');
const rubric = (k) => `<span class="np-rub k-${k}">${esc(KIND_LABEL[k])}</span>`;

// Kompakte Karte: Farbband, großes Symbol, Titel, eine Zeile Text; Antippen klappt den ganzen Brief auf
function letterCard(e) {
  const key = evKey(e), open = evOpen.has(key), k = kindOf(e);
  const lo = { span: true, pawns: evPawns(e) };
  const theme = vb.eventTheme(e);
  const teaser = sentences(e.text)[0] || '';
  const more = !!e.text && e.text.replace(/\s+/g, ' ').trim() !== teaser;
  return `<article class="evc k-${k}${open ? ' open' : ''}">
    <button type="button" class="evc-main" data-evopen="${esc(key)}" aria-expanded="${open}">
      <span class="evc-sym">${vb.kindIconHtml(k)}</span>
      <span class="evc-body"><span class="evc-title">${theme ? `<i class="evc-theme" aria-hidden="true">${theme}</i> ` : ''}${linkText(e.label, lo)}</span>${open ? '' : `<span class="evc-text">${linkText(teaser, lo)}</span>`}</span>
      <span class="evc-ago" title="vor ${esc(agoDe(e.ago))}"><i aria-hidden="true">⏱</i> ${esc(vb.agoShort(e.ago))}</span>
      <span class="evc-chev" aria-hidden="true">${more || open ? (open ? '▾' : '▸') : ''}</span>
    </button>
    ${open && e.text ? `<div class="evc-open">${evFigHtml(e, false)}<p class="evc-full">${linkText(e.text, { pawns: evPawns(e) })}</p></div>` : ''}
  </article>`;
}

// Gefahr/Katastrophe: Zeitungs-Extrablatt mit Bild und Schlagzeile (alles andere bleibt kompakt)
function threatPaper(e) {
  const key = evKey(e), open = evOpen.has(key), k = 'threat';
  const lo = { span: true, pawns: evPawns(e) };
  const sn = sentences(e.text);
  const teaser = sn.slice(0, 2).join(' ');
  const more = !!e.text && e.text.replace(/\s+/g, ' ').trim() !== teaser;
  const body = !e.text ? '' : open ? `<p class="np-text">${linkText(e.text, lo)}</p>` : `<p class="np-text">${linkText(teaser, lo)}${more ? ' …' : ''}</p>`;
  return `<section class="np-issue evn-threat" aria-label="Extrablatt Tag ${fmt(e.day)}">
    <header class="np-head"><div class="np-name">${vb.kindIconHtml('threat', 'np-ki')} Extrablatt</div><div class="np-sub">Tag ${fmt(e.day)}</div></header>
    <article class="np-art np-lead k-${k}"><button type="button" class="np-btn" data-evopen="${esc(key)}" aria-expanded="${open}">
      ${evFigHtml(e, true)}${rubric(k)}<h3 class="np-h">${linkText(e.label, lo)}</h3>
      ${body}<span class="np-meta small muted"><i aria-hidden="true">⏱</i> ${esc(vb.agoShort(e.ago))}${e.text && (more || open) ? ` · ${open ? 'weniger' : 'weiterlesen'}` : ''}</span></button></article></section>`;
}

function lettersBody(shown) {
  let lastDay = null;
  return shown.map((e) => {
    const head = e.day !== lastDay ? `<div class="evd-head"><span>Tag ${fmt(e.day)}</span></div>` : '';
    lastDay = e.day;
    return head + (kindOf(e) === 'threat' ? threatPaper(e) : letterCard(e));
  }).join('');
}

export function ereignisseView() {
  const html = `<div class="live-page"><h2 class="section-title" style="margin:0 0 10px">Ereignisse</h2><div id="ev-host"><div class="empty">Lade …</div></div></div>`;
  function bind(root) {
    const host = root.querySelector('#ev-host');
    let list = null, last = '';
    const draw = (force) => {
      if (!list) return;
      const key = JSON.stringify([list, evSocial, evView, evFilter, [...evOpen], (pxBuild(), px.ver), vb.openKeys.size]);
      if (!force && key === last) return;
      last = key;
      morph(host, eventsLiveHtml(list));
    };
    live.poll({
      path: '/api/events', every: 10000, alive: () => host.isConnected,
      onResult: (r) => {
        if (r.unchanged || r.status !== 200 || !r.data) return;
        list = Array.isArray(r.data.events) ? r.data.events : [];
        evSocial = Array.isArray(r.data.social) ? r.data.social : [];
        draw(false);
      },
    });
    host.addEventListener('click', (e) => {
      const f = e.target.closest('[data-evf]'), o = e.target.closest('[data-evopen]'), vv = e.target.closest('[data-evv]');
      if (!f && !o && !vv) return;
      if (vv) evView = vv.dataset.evv;
      else if (f) evFilter = f.dataset.evf;
      else { const k = o.dataset.evopen; if (evOpen.has(k)) evOpen.delete(k); else evOpen.add(k); }
      draw(true);
    });
  }
  return { html, bind };
}

// =====================================================================
// Ansicht „Gedenken“ (nur live): Gedenkwand aus /api/game (memorials), alle 5 s, nur solange offen
// =====================================================================
function memorialCard(m, today) {
  return A.memorialCard(m, today, agoDe);
}

function memorialsHtml(list, today) {
  if (!list.length) return '<div class="empty">Noch niemand gestorben.</div>';
  return `<div class="memo-grid">${list.map((m) => memorialCard(m, today)).join('')}</div>`;
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
        const key = JSON.stringify([list, r.data.day]);
        if (key === last) return;
        last = key;
        morph(host, memorialsHtml(list, r.data.day));
      },
    });
  }
  return { html, bind };
}
