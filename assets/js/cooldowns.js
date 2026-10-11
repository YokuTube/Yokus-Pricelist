// Abklingzeiten (Cooldowns) dort anzeigen, wo sie gebraucht werden.
// Quellen (alles optional – ohne Live-Mod oder mit alter Mod-Version passiert hier nichts):
//   global (gilt für alle): GameInfo.cooldowns  (/api/game)   -> "⏱ für alle noch …"
//   persönlich (nur ich):   me.cooldowns        (/api/me)      -> "⏱ du noch …"
// Form siehe RICS-Live/docs/API.md ("Abklingzeiten"). Einheit "game" = Spielstunden, "real" = Sekunden.
// Die Datei verändert fremde Ansichten nur nachträglich im DOM (Knöpfe sperren, Plakette, Banner) und ist idempotent.
import * as live from './live.js';
import { esc } from './util.js';

let DATA = null;
let G = null;     // { t0, d }  GameInfo.cooldowns
let ME = null;    // { t0, d }  me.cooldowns
let polling = false;
let timer = null;
let scheduled = false;
let obs = null;

export function setCooldownData(d) { DATA = d; schedule(); }

const now = () => performance.now();
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const ITEM_CMDS = new Set(['buy', 'use', 'equip', 'wear', 'backpack', 'surgery', 'heal', 'revive']);
const KAR = { good: 'good', neutral: 'neutral', bad: 'bad', doom: 'bad' };
const KAR_LABEL = { good: 'Gute Ereignisse', bad: 'Schlechte Ereignisse', neutral: 'Neutrale Ereignisse' };

// ---------- Zeit ----------
/** Verbleibende Zeit eines Eintrags {left, unit} in seiner Einheit (real zählt lokal herunter). */
function remaining(e, t0) {
  if (!e || !(e.left > 0)) return 0;
  return e.unit === 'real' ? e.left - (now() - t0) / 1000 : e.left;
}
/** Grober Vergleichswert in Sekunden (1 Spielstunde ≈ 42 s bei normalem Tempo). */
const approxSecs = (left, unit) => (unit === 'real' ? left : left * 41.7);

function fmtGame(h) {
  if (h >= 24) { const d = h / 24; const s = Math.abs(d - Math.round(d)) < 0.05 ? String(Math.round(d)) : d.toFixed(1).replace('.', ','); return `${s} ${s === '1' ? 'Spieltag' : 'Spieltage'}`; }
  if (h < 1) return 'unter 1 Spielstunde';
  const s = h < 10 && Math.abs(h - Math.round(h)) >= 0.05 ? h.toFixed(1).replace('.', ',') : String(Math.round(h));
  return `${s} ${s === '1' ? 'Spielstunde' : 'Spielstunden'}`;
}
function fmtReal(sec) {
  sec = Math.max(1, Math.ceil(sec));
  if (sec >= 3600) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return `${h} h ${String(m).padStart(2, '0')} min`; }
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min`;
  return `${sec} s`;
}
const fmtTime = (left, unit) => (unit === 'real' ? fmtReal(left) : fmtGame(left));

// ---------- Sperren ermitteln ----------
function findEvent(list, args) {
  const a = norm(args);
  if (!a || !list) return null;
  return list.find((x) => norm(x.cmdName) === a || norm(x.defName) === a) || null;
}

/** Alle gerade wirksamen Sperren für einen Befehl: [{ scope:'all'|'me', left, unit, reason }] */
function locksFor(cmd, args) {
  cmd = String(cmd || '').toLowerCase();
  const out = [];
  if (!live.isLive()) return out;
  const add = (scope, e, t0, reason) => {
    const left = remaining(e, t0);
    if (left > 0) out.push({ scope, left, unit: e.unit, reason, used: e.used, max: e.max });
  };
  const g = G?.d, gt = G?.t0 || 0;
  if (g) {
    const evCmd = cmd === 'event' || cmd === 'weather' || cmd === 'raid' || cmd === 'militaryaid';
    if (evCmd) {
      if (g.eventsAll) add('all', g.eventsAll, gt, 'Es gibt gerade zu viele Ereignisse – erst wenn ältere abgelaufen sind, darf wieder eines kommen.');
      let kar = cmd === 'raid' ? 'bad' : cmd === 'militaryaid' ? 'good' : null;
      let def = null;
      if (cmd === 'event') { def = findEvent(DATA?.events, args); kar = def ? KAR[String(def.karma).toLowerCase()] : null; }
      if (cmd === 'weather') { const w = findEvent(DATA?.weather, args); kar = w ? KAR[String(w.karma).toLowerCase()] : null; }
      if (kar && g.eventTypes?.[kar]) add('all', g.eventTypes[kar], gt, `${KAR_LABEL[kar]} sind gerade ausgeschöpft.`);
      if (def && g.events?.[def.defName]) add('all', g.events[def.defName], gt, 'Dieses Ereignis hat eine Pause, bevor es wieder geht.');
    }
    if (ITEM_CMDS.has(cmd) && g.items) add('all', g.items, gt, 'Das Kauflimit für Gegenstände ist gerade erreicht.');
    if (g.commands?.[cmd]) add('all', g.commands[cmd], gt, 'Dieser Befehl ist für alle gerade gesperrt (Limit erreicht).');
  }
  const m = ME?.d;
  if (m?.[cmd]) add('me', m[cmd], ME.t0, 'Deine persönliche Pause für diesen Befehl.');
  return out;
}

/** Die Sperre mit der längsten Restzeit (bei beiden Arten gewinnt die längere). */
function worst(locks) {
  let w = null;
  for (const l of locks) if (!w || approxSecs(l.left, l.unit) > approxSecs(w.left, w.unit)) w = l;
  return w;
}

function lockText(l, short) {
  const t = fmtTime(l.left, l.unit);
  return short ? `⏱ ${l.unit === 'real' ? t : t.replace('Spielstunden', 'Std.').replace('Spielstunde', 'Std.').replace('Spieltage', 'Tage').replace('Spieltag', 'Tag')}`
    : `⏱ ${l.scope === 'all' ? 'für alle' : 'du'} noch ${t}`;
}

function lockTitle(locks) {
  return locks.map((l) => `${l.scope === 'all' ? 'Für alle' : 'Nur für dich'}: noch ${fmtTime(l.left, l.unit)}${l.unit === 'game' ? ' (Spielzeit)' : ''} – ${l.reason}${l.max ? ` (${l.used} von ${l.max})` : ''}`).join('\n');
}

// ---------- DOM ----------
function parseCopy(text) {
  const m = /^!?([A-Za-z]+)\s*(.*)$/.exec(String(text || '').trim());
  return m ? { cmd: m[1].toLowerCase(), args: m[2] } : null;
}

const CARD = '.ev-card, .item-detail, .show-item';

function setBlocked(btn, locks) {
  if (locks.length) {
    const w = worst(locks);
    if (!btn.classList.contains('cd-block')) btn.dataset.cdWasDisabled = btn.disabled ? '1' : '';
    btn.classList.add('cd-block');
    if (btn.dataset.cdText !== lockText(w, true)) btn.dataset.cdText = lockText(w, true);
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    const title = lockTitle(locks);
    if (btn.title !== title) btn.title = title;
  } else if (btn.classList.contains('cd-block')) {
    btn.classList.remove('cd-block');
    delete btn.dataset.cdText;
    btn.removeAttribute('aria-disabled');
    if (!btn.dataset.cdWasDisabled) btn.disabled = false;
    delete btn.dataset.cdWasDisabled;
    if (btn.dataset.liveBuy !== undefined) btn.title = `${btn.dataset.liveBuy} sofort ausführen`;
    else btn.removeAttribute('title');
  }
}

function ribbon(card, text, title) {
  let r = card.querySelector(':scope > .cd-ribbon');
  if (!text) { r?.remove(); card.classList.remove('cd-locked'); return; }
  if (!r) { r = document.createElement('div'); r.className = 'cd-ribbon'; card.prepend(r); }
  if (r.textContent !== text) r.textContent = text;
  if (r.title !== title) r.title = title;
  card.classList.add('cd-locked');
}

function applyButtons(view) {
  const cardInfo = new Map();   // Karte -> { total, locked, locks }
  view.querySelectorAll('[data-copy]').forEach((b) => {
    const p = parseCopy(b.dataset.copy);
    const nb = b.nextElementSibling?.matches?.('[data-live-buy]') ? b.nextElementSibling : null;
    const locks = p ? locksFor(p.cmd, p.args) : [];
    if (nb) setBlocked(nb, locks);
    const card = b.closest(CARD);
    if (card && p && ITEM_OR_EVENT.has(p.cmd)) {
      const ci = cardInfo.get(card) || { total: 0, locked: 0, locks: [] };
      ci.total++;
      if (locks.length) { ci.locked++; ci.locks.push(...locks.map((l) => ({ ...l, cmd: p.cmd }))); }
      cardInfo.set(card, ci);
    }
  });
  for (const [card, ci] of cardInfo) {
    if (ci.locked && ci.locked === ci.total) {
      const w = worst(ci.locks);
      ribbon(card, lockText(w), lockTitle(ci.locks));
    } else if (ci.locked) {
      // nur ein Teil der Knöpfe gesperrt (z. B. nur !use): Plakette ohne Ausgrauen
      const w = worst(ci.locks);
      ribbon(card, `!${w.cmd}: ${lockText(w)}`, lockTitle(ci.locks));
      card.classList.remove('cd-locked');
      card.querySelector(':scope > .cd-ribbon')?.classList.add('part');
    } else ribbon(card, '', '');
  }
  // Karten, die nicht mehr in der Liste stehen (neu gezeichnet) haben ihre Plakette ohnehin verloren
  view.querySelectorAll('.cd-ribbon').forEach((r) => { if (!cardInfo.has(r.parentElement)) r.parentElement.classList.remove('cd-locked'), r.remove(); });
}
const ITEM_OR_EVENT = new Set([...ITEM_CMDS, 'event', 'weather', 'raid', 'militaryaid']);

function applyActions(view) {
  view.querySelectorAll('[data-act]').forEach((b) => {
    const locks = locksFor(b.dataset.act, b.dataset.args);
    setBlocked(b, locks);
  });
}

function applyCommandCards(view) {
  view.querySelectorAll('.cmd-card[data-cmd]').forEach((card) => {
    const cmd = card.dataset.cmd;
    const tags = card.querySelector('summary .tags');
    if (!tags) return;
    // statisch: kurze Pausen (< 30 s) zeigt die Ansicht selbst nicht
    const c = DATA?.commands?.list?.find((x) => x.cmd === cmd);
    let st = tags.querySelector('.cd-static');
    if (c && c.cooldown > 0 && c.cooldown < 30) {
      if (!st) { st = document.createElement('span'); st.className = 'chip cd-static'; tags.append(st); }
      const t = `⏱ ${c.cooldown} s Pause`;
      if (st.textContent !== t) st.textContent = t;
      st.title = 'So lange musst du nach der Nutzung warten';
    } else st?.remove();
    // live: persönliche und globale Restzeit
    const locks = locksFor(cmd, '');
    let ch = tags.querySelector('.cd-chip');
    if (!locks.length) { ch?.remove(); return; }
    const w = worst(locks);
    if (!ch) { ch = document.createElement('span'); ch.className = 'chip cd-chip'; tags.append(ch); }
    const text = lockText(w);
    if (ch.textContent !== text) ch.textContent = text;
    ch.classList.toggle('all', w.scope === 'all');
    ch.title = lockTitle(locks);
  });
}

function bannerFor(view) {
  const page = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'start').toLowerCase();
  const g = G?.d;
  const rows = [];
  if (g && live.isLive()) {
    const push = (e, label) => {
      const left = remaining(e, G.t0);
      if (left > 0) rows.push(`<li><b>${esc(label)}</b> – ${esc(lockText({ scope: 'all', left, unit: e.unit }))}${e.max ? ` <span class="small">(${e.used} von ${e.max} im Zeitraum)</span>` : ''}</li>`);
    };
    if (page === 'events' || page === 'wetter') {
      if (g.eventsAll) push(g.eventsAll, 'Alle Events & Wetter gesperrt');
      for (const k of ['good', 'neutral', 'bad']) if (g.eventTypes?.[k]) push(g.eventTypes[k], KAR_LABEL[k] + ' gesperrt' + (k === 'bad' ? ' (auch Katastrophen)' : ''));
    }
    if (page === 'items' || page === 'start') {
      if (g.items) push(g.items, 'Alle Käufe gesperrt (Limit erreicht)');
    }
  }
  let el = view.querySelector(':scope > .cd-banner');
  if (!rows.length) { el?.remove(); return; }
  const html = `<div class="cd-banner-h">⏱ Gerade gesperrt <span class="small">– für alle Zuschauer</span></div><ul>${rows.join('')}</ul>`;
  if (!el) { el = document.createElement('div'); el.className = 'cd-banner'; el.setAttribute('role', 'status'); view.prepend(el); }
  if (el.innerHTML !== html) el.innerHTML = html;
}

function apply() {
  scheduled = false;
  const view = document.getElementById('view');
  if (!view) return;
  obs?.disconnect();
  try {
    bannerFor(view);
    applyButtons(view);
    applyActions(view);
    applyCommandCards(view);
  } catch (e) { console.warn('[cooldowns]', e); }
  observe(view);
  manageTimer();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(apply, 30);
}

function observe(view) {
  if (!obs) obs = new MutationObserver(schedule);
  obs.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-copy', 'data-act', 'data-args', 'disabled', 'class'] });
}

/** Echtzeit-Sperren zählen lokal herunter (und lösen sich von selbst) – nur solange es welche gibt. */
function manageTimer() {
  const hasReal = [G, ME].some((s) => s && s.d && JSON.stringify(s.d).includes('"real"'));
  if (hasReal && !timer) timer = setInterval(() => { if (!document.hidden) schedule(); }, 1000);
  else if (!hasReal && timer) { clearInterval(timer); timer = null; }
}

function startPoll() {
  if (polling || !live.isLive()) return;
  polling = true;
  live.poll({
    path: '/api/game', every: 5000,
    alive: () => { const ok = live.isLive(); if (!ok) polling = false; return ok; },
    onResult: (r) => {
      if (r.status !== 200 || !r.data) return;
      const c = r.data.cooldowns;
      if (!r.unchanged || !G) G = { t0: now(), d: c && typeof c === 'object' ? c : null };
      schedule();
    },
  });
}

export function initCooldowns() {
  live.on('change', () => { if (!live.isLive()) { G = null; ME = null; } else startPoll(); if (!live.isLinked()) ME = null; schedule(); });
  live.on('me', (e) => {
    const c = e.detail?.cooldowns;
    ME = c && typeof c === 'object' ? { t0: now(), d: c } : null;
    schedule();
  });
  window.addEventListener('hashchange', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  const view = document.getElementById('view');
  if (view) observe(view);
  startPoll();
  schedule();
}
