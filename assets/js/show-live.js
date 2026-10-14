// Show-Reiter, Teil 2 (Strang live-show2): "Jetzt" (offene Challenges/Ereignisse mit Countdown + Fortschritt, Spendenfenster, Verschollene,
// Lager + Reisen) und "Archiv" (abgeschlossene Staffeln). Alle Felder sind optional; fehlt etwas, blendet sich der Teil aus.
// Alles Fremde (Spendernamen, Texte) kommt nur per textContent in die Seite (h() setzt Strings als Textknoten).
// show.js reicht die Hilfen per init() herein (vermeidet einen Import-Kreis).

let H = null;   // { h, avatar, nameBtn, nameOf, goto }
export function init(helpers) { H = helpers; }

const KIND = {
  challenge: ['🏆', 'Challenge'], dilemma: ['⚖️', 'Dilemma'], twist: ['🌀', 'Wendung'], nature: ['🌿', 'Naturmoment'], finale: ['🏁', 'Finale'],
};
const TRIP = { Weiterziehen: ['🥾', 'Wir ziehen weiter'], Besuch: ['🚶', 'Besuch'], Heim: ['🏠', 'Heimweg'], Rueckkehr: ['↩️', 'Rückkehr'] };
const TRIP_PHASE = { 0: 'packt', 1: 'unterwegs', 2: 'Ankunft angekündigt', 3: 'gründet das Lager', 5: 'zu Besuch' };
const MISS_PHASE = { vote: 'Die Gruppe berät', search: 'Suche läuft', wait: 'Die Gruppe wartet', gaveup: 'Suche aufgegeben', pause: 'Pause' };
const MISS_STATE = { found: ['✅', 'gefunden'], home: ['🏕️', 'zurück im Lager'], dead: ['🕯️', 'nicht überlebt'], gone: ['❔', 'weg'] };

const arr = (x) => (Array.isArray(x) ? x : []);
const pct = (x) => Math.max(0, Math.min(100, Math.round((Number(x) || 0) * 100)));

// Avatar mit Buchstabe aus dem mitgelieferten Namen (Archiv: Teilnehmer sind meist nicht mehr in der Mitgliederliste).
function avNamed(id, name, size) {
  const a = H.avatar(id, size), l = a.querySelector('.sh-av-l');
  if (l && name) l.textContent = (String(name).trim()[0] || '?').toUpperCase();
  return a;
}

export const donation = (d) => (d && d.donation && d.donation.open ? d.donation : null);
export const events = (d) => arr(d?.events);
export const missing = (d) => arr(d?.missing);
export const openMissing = (d) => missing(d).filter((m) => m.state === 'missing');
export const hasNow = (d) => !!(donation(d) || events(d).length || missing(d).length || arr(d?.journeys).length || arr(d?.camps).length > 1);
export const hasArchive = (d) => arr(d?.archive).length > 0;

function bar(fraction, cls = '') {
  const h = H.h;
  return h('div', { class: 'sx-bar ' + cls, role: 'presentation' }, h('span', { style: `width:${pct(fraction)}%` }));
}
function faces(ids, size = 30) {
  const h = H.h;
  const a = arr(ids);
  return a.length ? h('div', { class: 'sx-faces' }, a.map((id) => h('button', { type: 'button', class: 'sx-face', title: H.nameOf(id), 'aria-label': H.nameOf(id), onclick: () => H.openDiary(id) }, H.avatar(id, size)))) : null;
}
const secText = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };

// ---------- Spendenfenster ----------
export function donationCard(d, compact = false) {
  const h = H.h, don = donation(d);
  if (!don) return null;
  const items = arr(don.items);
  const open = don.secondsLeft < 0 ? h('span', { class: 'sx-badge on' }, 'offen') : h('span', { class: 'sx-badge on', 'data-cd-end': Date.now() + don.secondsLeft * 1000 }, 'noch ' + secText(don.secondsLeft));
  if (compact) {
    return h('button', { type: 'button', class: 'sx-banner don', onclick: () => H.goto('jetzt') },
      h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, '🎁'), h('b', {}, 'Spendenfenster offen'), open,
      h('span', { class: 'muted small' }, (don.donors || 0) + (don.donors === 1 ? ' Spende' : ' Spenden')));
  }
  return h('section', { class: 'sx-card don', 'aria-label': 'Spendenfenster' },
    h('div', { class: 'sx-head' }, h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, '🎁'), h('b', {}, 'Spendenfenster'), open),
    h('p', { class: 'small muted sx-note' }, 'Schreib im Chat !spende und die Sache, z. B. !spende Schokolade 2. Alles wird zusammen als ein Abwurf geliefert, wenn das Fenster schließt.'),
    don.totalMax > 0 ? h('div', { class: 'sx-line' }, bar(don.total / don.totalMax), h('span', { class: 'small' }, `${don.total} von ${don.totalMax} vergeben`)) : null,
    h('ul', { class: 'sx-items' }, items.map((it) => {
      const out = (it.left ?? it.max) <= 0;
      return h('li', { class: 'sx-item' + (out ? ' out' : '') }, h('span', { class: 'sx-item-n' }, it.name || '?'),
        h('span', { class: 'sx-item-m' }, out ? 'ausverkauft' : `noch ${it.left ?? it.max} · ${it.price} Münzen`));
    })),
    arr(don.list).length ? h('div', { class: 'sx-donors' }, h('span', { class: 'small muted' }, 'Spender:'), arr(don.list).map((x) => h('span', { class: 'sx-chip' }, (x.name || '?') + ' · ' + (x.count > 1 ? x.count + '× ' : '') + (x.item || '')))) : null,
    h('p', { class: 'small muted sx-note' }, (don.perViewer || 1) === 1 ? 'Jeder darf einmal spenden.' : `Jeder darf ${don.perViewer}-mal spenden.`));
}

// ---------- Verschollene ----------
export function missingBanner(d) {
  const h = H.h, m = openMissing(d);
  if (!m.length) return null;
  return h('button', { type: 'button', class: 'sx-banner lost', onclick: () => H.goto('jetzt') },
    h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, '🔦'), h('b', {}, m.length === 1 ? H.nameOf(m[0].pawn) + ' ist verschollen' : m.length + ' Verschollene'),
    h('span', { class: 'muted small' }, MISS_PHASE[m[0].phase] || ''));
}
function missingCard(m, d) {
  const h = H.h;
  const open = m.state === 'missing';
  const st = MISS_STATE[m.state];
  const days = d?.tag && m.sinceDay ? Math.max(0, d.tag - m.sinceDay) : null;
  return h('article', { class: 'sx-card lost' + (open ? '' : ' done') },
    h('div', { class: 'sx-head' }, avNamed(m.pawn, m.name, 44), h('div', { class: 'sx-head-t' }, H.nameBtn(m.pawn), h('span', { class: 'small muted' },
      open ? (days ? `verschollen seit Tag ${m.sinceDay} (${days === 1 ? '1 Tag' : days + ' Tage'})` : 'seit Tag ' + (m.sinceDay || '?') + ' verschollen') : `${st ? st[1] : ''} · seit Tag ${m.sinceDay || '?'}`)),
      h('span', { class: 'sx-ico big', 'aria-hidden': 'true' }, open ? '🔦' : st ? st[0] : '')),
    open ? h('div', { class: 'sx-steps', role: 'list', 'aria-label': 'Stand der Suche' }, ['vote', 'search', 'wait', 'gaveup'].map((k) =>
      h('span', { role: 'listitem', class: 'sx-step' + (m.phase === k ? ' on' : ''), title: MISS_PHASE[k] }, MISS_PHASE[k]))) : null);
}

// ---------- Challenges und Ereignisse ----------
function eventCard(e) {
  const h = H.h;
  const k = KIND[e.kind] || KIND.nature;
  const hasTime = e.ticksLeft >= 0 && e.ticksTotal > 0;
  return h('article', { class: 'sx-card ev ' + (e.kind || '') },
    h('div', { class: 'sx-head' }, h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, k[0]), h('div', { class: 'sx-head-t' }, h('b', {}, e.title || e.def || '?'), h('span', { class: 'small muted' }, k[1])),
      h('span', { class: 'sx-badge' + (hasTime && e.ticksLeft < 2500 * 6 ? ' urgent' : '') }, hasTime ? (e.leftText || '') : 'ohne Frist')),
    hasTime ? h('div', { class: 'sx-line' }, bar(e.ticksLeft / e.ticksTotal, 'time'), h('span', { class: 'small muted' }, 'Zeit')) : null,
    e.progress != null ? h('div', { class: 'sx-line' }, bar(e.progress, 'prog'), h('span', { class: 'small' }, pct(e.progress) + ' %')) : null,
    e.text ? h('p', { class: 'sx-text' }, e.text) : null,
    faces(e.members));
}

// ---------- Lager und Reisen ----------
function campCard(c) {
  const h = H.h;
  return h('article', { class: 'sx-card camp' + (c.current ? ' cur' : '') },
    h('div', { class: 'sx-head' }, h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, '⛺'), h('div', { class: 'sx-head-t' }, h('b', {}, c.name || 'Lager'),
      h('span', { class: 'small muted' }, (c.second ? 'zweite Karte' : 'Hauptlager') + ' · ' + arr(c.members).length + (arr(c.members).length === 1 ? ' Person' : ' Personen')))),
    faces(c.members));
}
function tripCard(r) {
  const h = H.h;
  const t = TRIP[r.kind] || ['🥾', 'Reise'];
  return h('article', { class: 'sx-card trip' },
    h('div', { class: 'sx-head' }, h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, t[0]), h('div', { class: 'sx-head-t' }, h('b', {}, t[1]),
      h('span', { class: 'small muted' }, (TRIP_PHASE[r.phase] || '') + (r.resting ? ' · rastet' : r.moving ? ' · in Bewegung' : '') + (r.days != null ? ' · seit ' + (r.days < 1 ? 'heute' : String(r.days).replace('.', ',') + ' T.') : '')))),
    faces(r.members));
}

const section = (title, nodes, hint) => (nodes.length ? H.h('section', { class: 'sx-sec' }, H.h('h3', { class: 'sh-h' }, title), hint ? H.h('p', { class: 'small muted' }, hint) : null, H.h('div', { class: 'sx-grid' }, nodes)) : null);

export function viewJetzt(d) {
  const h = H.h;
  const ev = events(d);
  const ch = ev.filter((e) => e.kind === 'challenge' || e.kind === 'finale');
  const rest = ev.filter((e) => !(e.kind === 'challenge' || e.kind === 'finale'));
  const camps = arr(d.camps), trips = arr(d.journeys);
  const root = h('div', { class: 'sx-now' });
  const don = donationCard(d);
  if (don) root.append(don);
  root.append(section('Verschollen', missing(d).map((m) => missingCard(m, d))) || '');
  root.append(section('Challenges', ch.map(eventCard)) || '');
  root.append(section('Ereignisse', rest.map(eventCard)) || '');
  root.append(section('Unterwegs', trips.map(tripCard)) || '');
  if (camps.length > 1) root.append(section('Lager', camps.map(campCard)) || '');
  const st = d.eventStats;
  if (st && (st.done || st.failed)) root.append(h('p', { class: 'small muted sx-stat' }, `Bisher geschafft: ${st.done || 0} · gescheitert: ${st.failed || 0}`));
  if (!root.children.length) root.append(h('div', { class: 'empty' }, 'Gerade läuft nichts Besonderes. Die Gruppe lebt ihren Alltag.'));
  return root;
}

// ---------- Staffel-Archiv ----------
export function viewArchiv(d) {
  const h = H.h;
  const list = arr(d.archive).slice().reverse();
  return h('div', { class: 'sx-arch' }, list.map((s) => {
    const win = s.winner, vw = s.viewerWinner;
    return h('article', { class: 'sx-card season' },
      h('div', { class: 'sx-head' }, h('span', { class: 'sx-ico', 'aria-hidden': 'true' }, '🏁'), h('div', { class: 'sx-head-t' }, h('b', {}, 'Staffel ' + (s.season || '?')),
        h('span', { class: 'small muted' }, s.endDay ? 'beendet an Tag ' + s.endDay : ''))),
      h('div', { class: 'sx-winners' },
        win ? h('div', { class: 'sx-win' }, avNamed(win.id, win.name, 52), h('div', {}, h('div', { class: 'small muted' }, '👑 Sieger der Gruppe'), h('b', {}, win.name || '?'))) : null,
        vw ? h('div', { class: 'sx-win' }, avNamed(vw.id, vw.name, 52), h('div', {}, h('div', { class: 'small muted' }, '🗳 Sieger der Zuschauer'), h('b', {}, vw.name || '?'))) : null),
      arr(s.members).length ? h('ul', { class: 'sx-fates' }, arr(s.members).map((m) => h('li', {}, h('b', {}, m.name || '?'), m.fate ? h('span', { class: 'muted' }, ' – ' + m.fate) : null))) : null,
      arr(s.highlights).length ? h('ul', { class: 'sh-memos' }, arr(s.highlights).map((t) => h('li', {}, String(t)))) : null);
  }));
}
