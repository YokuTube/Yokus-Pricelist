// Optik-Paket A (RICS Live): Spielgrafiken, Symbole und Balken statt Text.
// Reine HTML-Bausteine für Spiel (Übersicht, Vorräte, Fraktionen, Forschung), Gedenken, Ranglisten, Gemeinschaftsziele,
// Kolonistenliste, Live-Leiste und Startseite. Alle neuen Felder der Schnittstelle sind optional – ohne sie sieht es aus wie vorher.
// Die Hilfsfunktionen aus live-views.js kommen über init() (kein Zirkelbezug beim Laden).
import * as live from './live.js';
import * as PICS from './pics.js';

let H = null;
/** h: { esc, bar, clamp, fmt, tone, imgUrl, xrefHtml, userPawnId, portraitHtml } */
export function init(h) {
  H = h;
  live.on('change', fillTeasers);
  // Spielsymbol nicht ladbar (noch nicht gerendert / 404): Ersatzsymbol statt kaputtem Bild
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img?.matches?.('img[data-vimg]')) return;
    const ph = document.createElement('span');
    ph.className = (img.dataset.cls || 'vi') + ' vi-ph';
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = img.dataset.fb || '•';
    img.replaceWith(ph);
  }, true);
}
const e = (s) => H.esc(s);
const num1 = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString('de-DE');

/** Spielsymbol (Bildschlüssel -> /api/img/<key>) oder Ersatz-Emoji, wenn es keins gibt bzw. es nicht lädt. */
export function iconImg(key, fb, cls = 'vi', size = 40) {
  if (!key) return `<span class="${cls} vi-ph" aria-hidden="true">${fb}</span>`;
  return `<img class="${cls}" src="${e(H.imgUrl(key))}" alt="" width="${size}" height="${size}" loading="lazy" data-vimg data-fb="${e(fb)}" data-cls="${cls}">`;
}

// ---------------------------------------------------------------------
// Tageszeit, Jahreszeit, Wetter
// ---------------------------------------------------------------------
export const todIcon = (hour) => { const h = Math.floor(Number(hour) || 0); return h >= 5 && h < 7 ? '🌅' : h >= 7 && h < 17 ? '☀️' : h >= 17 && h < 20 ? '🌇' : '🌙'; };
const SEASONS = { Spring: ['🌱', 'Frühling'], Summer: ['☀️', 'Sommer'], Fall: ['🍂', 'Herbst'], Winter: ['❄️', 'Winter'], PermanentSummer: ['🌴', 'Dauersommer'], PermanentWinter: ['🧊', 'Dauerwinter'] };
export function seasonOf(g) {
  const k = SEASONS[g?.seasonKey];
  if (k) return k;
  const t = String(g?.season || '').toLowerCase();
  if (/fr[üu]hl|spring/.test(t)) return SEASONS.Spring;
  if (/sommer|summer/.test(t)) return SEASONS.Summer;
  if (/herbst|fall|autumn/.test(t)) return SEASONS.Fall;
  if (/winter/.test(t)) return SEASONS.Winter;
  return ['🗓', g?.season || 'Jahreszeit'];
}
export function weatherIcon(g) {
  const d = String(g?.weatherDef || '').toLowerCase();
  const t = String(g?.weather || '').toLowerCase();
  const night = (Number(g?.hour) || 0) >= 20 || (Number(g?.hour) || 0) < 5;
  const any = (re) => re.test(d) || re.test(t);
  if (any(/thunder|gewitter/)) return '⛈';
  if (any(/snow|schnee/)) return /hard|heavy|stark|sturm/.test(d + t) ? '🌨' : '❄️';
  if (any(/hail|hagel/)) return '🌨';
  if (any(/fog|nebel|dunst/)) return /rain|regen/.test(d + t) ? '🌧' : '🌫';
  if (any(/rain|regen/)) return /light|leicht|nieseln/.test(d + t) ? '🌦' : '🌧';
  if (any(/sand|dust|staub/)) return '🌪';
  if (any(/wind|storm|sturm/)) return '💨';
  if (any(/clear|klar|sonn/)) return night ? '🌙' : '☀️';
  return '☁️';
}

// ---------------------------------------------------------------------
// Zustände (Hitzewelle, Polarlicht …)
// ---------------------------------------------------------------------
const COND_ICONS = [[/heat/, '🔥'], [/cold|frost/, '🥶'], [/toxic|noxious|fallout|haze/, '☣️'], [/aurora/, '🌌'], [/eclipse/, '🌑'], [/solar|flare/, '⚡'],
  [/volcan/, '🌋'], [/flash/, '⛈'], [/soothe/, '💜'], [/drone|psychic|wave/, '🧠'], [/quiet|calm|ruhig/, '🕊'], [/infest/, '🐛'], [/fog/, '🌫'], [/dust|sand/, '🌪']];
export const condTone = (c) => (c?.good === true ? 'good' : c?.good === false ? 'bad' : 'neutral');
export function condIcon(c) {
  const k = String(c?.kind || c?.label || '').toLowerCase();
  const hit = COND_ICONS.find(([re]) => re.test(k));
  return hit ? hit[1] : c?.good === true ? '✨' : c?.good === false ? '⚠️' : 'ℹ️';
}
const hoursOf = (left) => {
  const m = /([\d]+(?:[.,]\d+)?)\s*(Jahr|Quadrum|Tag|Stunde|Std|Minute)/i.exec(String(left || ''));
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  return u.startsWith('jahr') ? v * 1440 : u.startsWith('quadrum') ? v * 360 : u.startsWith('tag') ? v * 24 : u.startsWith('minute') ? v / 60 : v;
};
const maxSeen = new Map();   // Zustand -> längste gesehene Restdauer (Stunden): der Balken „leert“ sich von dort
const isPerm = (c) => c.left == null || c.left === '';
const openCond = new Set();

/** Zustände: laufende mit Restdauer als Balken, Dauerzustände ganz dezent. */
export function conditionsHtml(list) {
  const arr = Array.isArray(list) ? list : [];
  const act = arr.filter((c) => !isPerm(c)).sort((a, b) => (condTone(a) === 'bad' ? 0 : 1) - (condTone(b) === 'bad' ? 0 : 1));
  const perm = arr.filter(isPerm);
  const rows = act.map((c) => {
    const tn = condTone(c);
    const key = c.kind || c.label;
    const h = hoursOf(c.left);
    let pct = null;
    if (h != null) { maxSeen.set(key, Math.max(maxSeen.get(key) || 0, h)); pct = (h / maxSeen.get(key)) * 100; }
    const open = openCond.has(key);
    return `<li class="cd cd-${tn}"><button type="button" class="cd-btn" data-cond="${e(key)}" aria-expanded="${open}">
      <span class="cd-ico" aria-hidden="true">${condIcon(c)}</span>
      <span class="cd-main"><span class="cd-name">${e(c.label)}</span>${pct != null ? H.bar(pct, tn === 'good' ? 'good' : tn === 'bad' ? 'low' : 'acc') : ''}</span>
      <span class="cd-left">${e(c.left)}</span>
      <span class="cd-tone" aria-hidden="true">${tn === 'good' ? '▲' : tn === 'bad' ? '▼' : ''}</span></button>
      ${open && c.desc ? `<p class="trait-desc">${e(c.desc)}</p>` : ''}</li>`;
  }).join('');
  const chips = perm.length ? `<div class="cd-perm" aria-label="Dauerhafte Zustände">${perm.map((c) => `<span class="cd-chip" title="${e(c.label)}${c.desc ? ' – ' + e(c.desc) : ''}"><span aria-hidden="true">${condIcon(c)}</span> ${e(c.label)}</span>`).join('')}</div>` : '';
  if (!act.length) return `<div class="ch-ok"><span aria-hidden="true">✔</span> Alles ruhig</div>${chips}`;
  return `<ul class="cd-list">${rows}</ul>${chips}`;
}
/** Klick auf einen Zustand (aufklappen). true = behandelt. */
export function condClick(ev, redraw) {
  const b = ev.target.closest?.('[data-cond]');
  if (!b) return false;
  const k = b.dataset.cond;
  if (openCond.has(k)) openCond.delete(k); else openCond.add(k);
  redraw();
  return true;
}

/** Kompakte Chips für die Live-Leiste: eine Zeile, nur Symbole für Zustände. */
export function stripChipsHtml(g) {
  if (!g) return '';
  const hh = String(Math.floor(Number(g.hour) || 0)).padStart(2, '0');
  const [si, sl] = seasonOf(g);
  const wt = [g.weather, g.temperature].filter(Boolean).join(' ');
  const act = (g.conditions || []).filter((c) => !isPerm(c)).sort((a, b) => (condTone(a) === 'bad' ? 0 : 1) - (condTone(b) === 'bad' ? 0 : 1));
  const shown = act.slice(0, 3).map((c) => `<span class="lg-alarm ${condTone(c)}" title="${e(c.label)}${c.left ? ' · ' + e(c.left) : ''}">${condIcon(c)}</span>`).join('');
  const more = act.length > 3 ? `<span class="lg-alarm neutral" title="${act.slice(3).map((c) => e(c.label)).join(', ')}">+${act.length - 3}</span>` : '';
  return `<a class="live-game" href="#/spiel" title="Mehr zum Spiel">
    <span class="lg-chip">Tag ${H.fmt(g.day)}</span>
    <span class="lg-chip" title="${hh}:00 Uhr">${todIcon(g.hour)} ${hh}:00</span>
    <span class="lg-chip" title="${e(sl)}">${si}</span>
    <span class="lg-chip" title="${e(wt)}">${weatherIcon(g)}${g.temperature ? ' ' + e(g.temperature) : ''}</span>${shown}${more}</a>`;
}

// ---------------------------------------------------------------------
// Spiel -> Übersicht
// ---------------------------------------------------------------------
export function overviewHtml(g) {
  const hh = String(Math.floor(Number(g.hour) || 0)).padStart(2, '0');
  const [si, sl] = seasonOf(g);
  const tile = (ico, val, label, title) => `<div class="ov-tile" title="${e(title || label)}"><span class="ov-ico" aria-hidden="true">${ico}</span><b class="ov-val">${val}</b><span class="ov-lab">${e(label)}</span></div>`;
  const silver = iconImg('t_Silver', '🪙', 'ov-img', 28);
  return `<div class="ov-row">
    ${tile('📅', 'Tag ' + H.fmt(g.day), g.date || 'Datum')}
    ${tile(todIcon(g.hour), `${hh}:00`, 'Uhrzeit')}
    ${tile(si, e(sl), 'Jahreszeit')}
    ${tile(weatherIcon(g), e(g.temperature || '–'), g.weather || 'Wetter', 'Wetter: ' + (g.weather || '–'))}
    ${tile(silver, H.fmt(g.wealth), 'Koloniewert', 'Koloniewert in Silber')}
    ${tile('👤', H.fmt(g.colonists), 'Kolonisten')}
    ${tile('⛓', H.fmt(g.prisoners), 'Gefangene')}
    ${tile('🐾', H.fmt(g.animals), 'Tiere')}
    ${tile('📺', H.fmt(g.viewerPawns), 'Zuschauer')}
  </div>`;
}

const EV_SYM = { threat: ['⚠', 'Gefahr'], bad: ['✖', 'Schlecht'], good: ['✔', 'Gut'], neutral: ['•', 'Neutral'] };
export const evSym = (kind) => { const [s, l] = EV_SYM[kind] || EV_SYM.neutral; return `<span class="ev-sym k-${EV_SYM[kind] ? e(kind) : 'neutral'}" title="${l}" aria-label="${l}">${s}</span>`; };
export function recentEventsHtml(list) {
  if (!list.length) return '<p class="muted small" style="margin:0">Noch nichts passiert.</p>';
  return `<ul class="gevents ev-list">${list.map((x) => `<li>${evSym(x.kind)}<span class="gl">${e(x.label)}</span><span class="small muted ga">${e(x.ago)}</span></li>`).join('')}</ul>`;
}

/** Schmale Duell-Leiste (statt der ganzen Karte): Mini-Porträts, führt zur Duell-Karte unter Kolonie. */
export function duelStripHtml(g) {
  const d = g?.duel;
  if (!d || !d.a || !d.b) return '';
  const side = (s, cls) => `<span class="dm-side ${cls}">${H.portraitHtml({ name: s.name, id: s.id || s.user, portrait: 1 }, 'dm-pic')}<b class="dm-name">${e(s.name)}</b></span>`;
  return `<a class="duel-mini" href="#/kolonie" aria-label="Duell läuft – zur Duell-Karte"><span class="dm-ico" aria-hidden="true">⚔</span>
    ${side(d.a, 'a')}<span class="dm-vs" aria-hidden="true">VS</span>${side(d.b, 'b')}
    <span class="dm-go">${d.betOpen ? 'Wetten offen' : 'Wetten zu'} <span aria-hidden="true">→</span></span></a>`;
}

// ---------------------------------------------------------------------
// Gemeinschaftsziele
// ---------------------------------------------------------------------
export function goalsHtml(goals) {
  if (!Array.isArray(goals) || !goals.length) return '<p class="muted small" style="margin:0">Gerade keine Gemeinschaftsziele.</p>';
  const val = (v) => (typeof v === 'number' ? H.fmt(v) : e(v ?? ''));
  return `<ul class="gc-list2">${goals.map((g) => {
    const cur = Number(g.current) || 0, tgt = Number(g.target) || 0;
    const pct = tgt > 0 ? (cur / tgt) * 100 : 0;
    const top = (g.top || []).slice(0, 3).map((t, i) => {
      const id = H.userPawnId(t.user);
      const pic = id ? H.portraitHtml({ name: t.user, id, portrait: 1 }, 'gc-pic') : `<span class="portrait ph gc-pic" aria-hidden="true">${e(String(t.user || '?').charAt(0).toUpperCase())}</span>`;
      const inner = `<span class="gc-medal" aria-hidden="true">${['🥇', '🥈', '🥉'][i]}</span>${pic}<b class="gc-amt">${val(t.amount)}</b>`;
      return id ? `<li><a class="gc-t" data-xgo="${e(id)}" href="#/kolonie/${encodeURIComponent(id)}" title="${e(t.user)}">${inner}</a></li>` : `<li><span class="gc-t" title="${e(t.user)}">${inner}</span></li>`;
    }).join('');
    return `<li class="gc2${g.done ? ' done' : ''}">
      <div class="gc2-top"><b class="gc2-title">${e(g.title)}</b>${g.done ? '<span class="badge good">✔ Geschafft</span>' : `<span class="gc2-pct">${Math.round(Math.min(100, pct))} %</span>`}</div>
      ${g.what ? `<div class="small muted">${e(g.what)}</div>` : ''}
      <div class="gc2-bar">${H.bar(pct, g.done ? 'good' : 'acc')}<span class="gc-num">${H.fmt(cur)} / ${H.fmt(tgt)}</span></div>
      <div class="gc2-foot">${g.reward != null && g.reward !== '' ? `<span class="gc2-reward" title="Belohnung"><span aria-hidden="true">🎁</span> ${val(g.reward)}</span>` : '<span></span>'}
        ${top ? `<ol class="gc-top3" aria-label="Beste Beiträge">${top}</ol>` : ''}</div>
    </li>`;
  }).join('')}</ul>`;
}

// ---------------------------------------------------------------------
// Vorräte
// ---------------------------------------------------------------------
export function stockHtml(s) {
  if (!s) return '<p class="muted small" style="margin:0">Keine Angaben zu den Vorräten.</p>';
  const days = Number(s.foodDays) || 0;
  const tn = days >= 10 ? 'good' : days >= 4 ? 'mid' : 'low';
  const warn = tn === 'low' ? '<span class="sf-warn" aria-hidden="true">⚠</span>' : '';
  const food = `<div class="stock-food2 ${tn}"><span class="sf-ico" aria-hidden="true">🍲</span>
    <div class="sf-main"><div class="sf-top"><b>${num1(days)} ${days === 1 ? 'Tag' : 'Tage'}</b><span class="small muted">Essen · Nährwert ${H.fmt(s.foodNutrition)}</span>${warn}</div>
    ${H.bar(Math.min(100, (days / 15) * 100), tn)}</div></div>`;
  const tiles = (s.items || []).map((i) => `<div class="stk" title="${e(i.label)}: ${H.fmt(i.count)}">${iconImg(i.img, '📦', 'stk-img', 44)}<b class="stk-n">${H.fmt(i.count)}</b><span class="stk-l">${e(i.label)}</span></div>`).join('');
  return `${food}${tiles ? `<div class="stk-grid">${tiles}</div>` : '<p class="muted small" style="margin:8px 0 0">Keine Vorräte erfasst.</p>'}`;
}

// ---------------------------------------------------------------------
// Koloniewert-Kurve: Ereignis-Punkte (nur wenn Tag und Art bekannt)
// ---------------------------------------------------------------------
export function wealthMarkers(pts, events, lo, span, BOT, TOP, H_) {
  if (!Array.isArray(events) || pts.length < 2) return '';
  const d0 = pts[0][0], d1 = pts[pts.length - 1][0];
  if (d1 <= d0) return '';
  const seen = new Set();
  return events.filter((x) => x && Number.isFinite(Number(x.day)) && Number(x.day) >= d0 && Number(x.day) <= d1 && !/rimazon/i.test(x.label || '')).slice(0, 20).map((x) => {
    const day = Number(x.day);
    // nächster Punkt der Kurve (x der Kurve ist der Index, ein Punkt je Spieltag)
    let bi = 0;
    pts.forEach((p, i) => { if (Math.abs(p[0] - day) < Math.abs(pts[bi][0] - day)) bi = i; });
    const best = pts[bi];
    const left = (bi / (pts.length - 1)) * 100;
    const top = (BOT - ((best[1] - lo) / span) * (BOT - TOP)) / H_ * 100;
    const k = EV_SYM[x.kind] ? x.kind : 'neutral';
    const key = `${Math.round(left)}|${k}`;
    if (seen.has(key)) return '';
    seen.add(key);
    return `<i class="wv-ev k-${k}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%" title="Tag ${H.fmt(day)}: ${e(x.label)}"></i>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Fraktionen und Besucher
// ---------------------------------------------------------------------
const FAC_REL = { ally: ['Verbündet', 'good', '🤝'], neutral: ['Neutral', 'neutral', '😐'], hostile: ['Feindlich', 'doom', '⚔'] };
export function factionsHtml(list, relTone, relSign) {
  const order = { ally: 0, neutral: 1, hostile: 2 };
  const arr = (Array.isArray(list) ? list : []).slice().sort((a, b) => ((order[a.relation] ?? 1) - (order[b.relation] ?? 1)) || (Number(b.goodwill) || 0) - (Number(a.goodwill) || 0));
  if (!arr.length) return '<p class="muted small" style="margin:0">Keine Fraktionen bekannt.</p>';
  return `<ul class="fac-list2">${arr.map((f) => {
    const [label, tn, sym] = FAC_REL[f.relation] || FAC_REL.neutral;
    const gw = Math.max(-100, Math.min(100, Number(f.goodwill) || 0));
    const bal = f.hasGoodwill
      ? `<span class="fbal" role="meter" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${Math.round(gw)}" aria-label="Wohlwollen ${Math.round(gw)}"><i class="fb-mid"></i>${gw < 0 ? `<i class="fb-neg" style="width:${(-gw / 2).toFixed(1)}%"></i>` : `<i class="fb-pos" style="width:${(gw / 2).toFixed(1)}%"></i>`}</span><b class="fac-num ${relTone(gw)}">${relSign(gw)}</b>`
      : '<span class="fbal unk" aria-hidden="true"><i class="fb-mid"></i></span><b class="fac-num neutral" title="Wohlwollen unbekannt">?</b>';
    return `<li class="fac2 f-${tn}"><span class="fac-crest">${iconImg(f.img, '🛡', 'fc-img', 44)}</span>
      <div class="fac2-main"><div class="fac2-top"><b class="fac2-name">${e(f.name)}</b><span class="fac2-rel" title="${label}" aria-label="${label}">${sym}</span></div>
        ${f.kind ? `<div class="small muted fac2-kind">${e(f.kind)}</div>` : ''}
        <div class="fac2-bal">${bal}</div></div></li>`;
  }).join('')}</ul>`;
}

export function visitorsHtml(v, factions) {
  const groups = Array.isArray(v?.groups) ? v.groups : [];
  const ships = Array.isArray(v?.ships) ? v.ships : [];
  if (!groups.length && !ships.length) return '';
  const crest = (name) => (Array.isArray(factions) ? factions.find((f) => f.name === name)?.img : null) || null;
  const gl = groups.map((x) => `<li class="vg" title="${e(x.faction)}${x.trader ? ' – Händler: ' + e(x.trader) : ''}">${iconImg(crest(x.faction), '🧳', 'vg-img', 40)}<span class="vg-main"><b class="vg-name">${e(x.faction)}</b>${x.trader ? `<span class="vg-trader"><span aria-hidden="true">🛒</span> ${e(x.trader)}</span>` : ''}</span>${x.count != null ? `<b class="vg-n">×${H.fmt(x.count)}</b>` : ''}</li>`).join('');
  const sl = ships.map((s) => `<li class="vg"><span class="vg-img vi-ph" aria-hidden="true">🚀</span><span class="vg-main"><b class="vg-name">${e(s)}</b></span></li>`).join('');
  return `<section class="card ch-sec"><h4>Besucher & Händler</h4><ul class="vg-list">${gl}${sl}</ul></section>`;
}

// ---------------------------------------------------------------------
// Forschung: Fortschrittsring, Punkte-Reihe
// ---------------------------------------------------------------------
export function ringHtml(pct, text, big = false) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<span class="pring${big ? ' big' : ''}" role="img" aria-label="${e(text)}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="pring-bg" cx="18" cy="18" r="15.9155"/><circle class="pring-fg" cx="18" cy="18" r="15.9155" stroke-dasharray="${p.toFixed(1)} ${(100 - p).toFixed(1)}" transform="rotate(-90 18 18)"/></svg><b class="pring-t">${e(text)}</b></span>`;
}
const PROJ_NAME = { 0: 'gesperrt', 1: 'erforschbar', 2: 'läuft', 3: 'fertig' };
export function projDots(projects) {
  const order = { 3: 0, 2: 1, 1: 2, 0: 3 };
  const all = [...(projects || [])].sort((a, b) => order[a.state] - order[b.state]);
  return `<span class="rs-dots" aria-hidden="true">${all.map((x) => `<i class="pdot s${x.state in PROJ_NAME ? x.state : 0}"></i>`).join('')}</span>`;
}
export const projLegend = () => `<div class="rs-legend small muted" aria-hidden="true">${[3, 2, 1, 0].map((s) => `<span><i class="pdot s${s}"></i>${PROJ_NAME[s]}</span>`).join('')}</div>`;

// ---------------------------------------------------------------------
// Ranglisten: Podest + Balkenzeilen
// ---------------------------------------------------------------------
const MEDAL = ['🥇', '🥈', '🥉'];
const RK_CATS = [
  { key: 'kills', title: 'Meiste Gegner', ico: '⚔', unit: 'besiegt', val: (v) => H.fmt(v) },
  { key: 'daysInColony', title: 'Am längsten dabei', ico: '⌛', unit: 'Tage', val: (v) => H.fmt(v) },
  { key: 'isekaiLevel', title: 'Höchste Isekai-Stufe', ico: '★', unit: 'Stufe', val: (v) => H.fmt(v) },
];
export function ranksHtml(list, praise) {
  if (!list.length) return '';
  const cats = [...RK_CATS];
  if (praise && typeof praise === 'object') cats.push({ key: '__praise', title: 'Beliebteste', ico: '👏', unit: 'Lob', val: (v) => H.fmt(v), get: (p) => Number(praise[p.id || p.user]) || 0 });
  const cards = cats.map((c) => {
    const get = c.get || ((p) => Number(p[c.key]));
    const rows = list.filter((p) => get(p) > 0).sort((a, b) => get(b) - get(a)).slice(0, 8);
    let body;
    if (!rows.length) body = '<p class="muted small" style="margin:0">Noch keine Werte.</p>';
    else {
      const best = get(rows[0]);
      const link = (p) => `#/kolonie/${encodeURIComponent(p.id || p.user)}`;
      const pod = [1, 0, 2].filter((i) => rows[i]).map((i) => {
        const p = rows[i];
        return `<a class="pd pd-${i + 1}" href="${link(p)}" title="${e(p.name)}"><span class="pd-medal" aria-hidden="true">${MEDAL[i]}</span>${H.portraitHtml(p, 'pd-pic')}
          <b class="pd-name">${e(p.name)}</b><span class="pd-val">${c.val(get(p))}</span><span class="pd-unit small muted">${c.unit}</span><span class="pd-step" aria-hidden="true">${i + 1}</span></a>`;
      }).join('');
      const rest = rows.slice(3).map((p, i) => `<li><a class="rk-row" href="${link(p)}"><b class="rk-pos">${i + 4}</b>${H.portraitHtml(p, 'rk-pic')}
          <span class="rk-main"><span class="rk-name">${e(p.name)}</span>${H.bar((get(p) / best) * 100, 'acc')}</span><b class="rk-val">${c.val(get(p))}</b></a></li>`).join('');
      body = `<div class="podium">${pod}</div>${rest ? `<ol class="rk-list" start="4">${rest}</ol>` : ''}`;
    }
    return `<section class="card ch-sec rk-card"><h4><span class="rk-ico" aria-hidden="true">${c.ico}</span> ${e(c.title)}</h4>${body}</section>`;
  }).join('');
  return `<div class="rank-grid rk-grid">${cards}</div>`;
}

// ---------------------------------------------------------------------
// Gedenken
// ---------------------------------------------------------------------
const CAUSE = { shot: ['🔫', 'Erschossen'], cut: ['🗡', 'Hieb/Schnitt'], bleed: ['🩸', 'Verblutet'], burn: ['🔥', 'Verbrannt'], starve: ['🍽', 'Verhungert'], disease: ['🦠', 'Krankheit'], other: ['✝', ''] };
export function memorialCard(m, today, agoDe) {
  const [ci, cl] = CAUSE[m.causeKind] || CAUSE.other;
  const j = Number(m.joinedDay), d = Number(m.diedDay);
  const hasDays = Number.isFinite(j) && Number.isFinite(d);
  const max = Math.max(Number(today) || 0, hasDays ? d : 0, 1);
  const life = hasDays
    ? `<div class="mm-life" title="Tag ${H.fmt(j)} bis Tag ${H.fmt(d)}"><span class="mm-d">Tag ${H.fmt(j)}</span>
      <span class="mm-track"><i class="mm-seg" style="left:${((j / max) * 100).toFixed(1)}%;width:${(Math.max(0.8, ((d - j) / max) * 100)).toFixed(1)}%"></i><b class="mm-x" style="left:${((d / max) * 100).toFixed(1)}%" aria-hidden="true">✝</b></span>
      <span class="mm-d">Tag ${H.fmt(d)}</span></div>` : '';
  const chips = [
    m.age != null ? `<span class="mm-chip" title="Alter"><span aria-hidden="true">🎂</span> ${H.fmt(m.age)} J.</span>` : '',
    m.kills != null ? `<span class="mm-chip" title="Besiegte Gegner"><span aria-hidden="true">⚔</span> ${H.fmt(m.kills)}</span>` : '',
    hasDays ? `<span class="mm-chip" title="Tage in der Kolonie"><span aria-hidden="true">⌛</span> ${H.fmt(Math.max(0, d - j))} Tage</span>` : '',
  ].join('');
  const full = m.fullName && m.fullName !== m.name ? `<div class="small muted">${e(m.fullName)}</div>` : '';
  const who = m.user ? `<div class="small muted">@${e(m.user)}</div>` : '';
  return `<article class="card memo memo2">
    <div class="mm-head">${iconImg(m.portrait, '✝', 'mm-pic', 72)}
      <div class="mm-id"><h3 class="memo-name">${e(m.name || '?')}</h3>${full}${who}</div><span class="memo-cross" aria-hidden="true">✝</span></div>
    ${life}
    <div class="mm-cause"><span class="mm-ci" aria-hidden="true">${ci}</span><span class="small">${e(m.cause || cl || 'Unbekannt')}</span></div>
    <div class="mm-chips">${chips}</div>
    ${m.ago ? `<p class="small muted memo-ago">Verstorben vor ${e(agoDe(m.ago))}</p>` : ''}
  </article>`;
}

// ---------------------------------------------------------------------
// Kolonistenliste: Kachel
// ---------------------------------------------------------------------
const STATE_ICO = { downed: ['🩹', 'bad'], sleeping: ['💤', 'neutral'], mental: ['⚡', 'doom'], away: ['🚶', 'neutral'], dead: ['☠', 'doom'] };
/** Stimmungsfarbe wie im Charakter: schlecht/mittel nie grün. */
export const moodCol = (v) => (v < 20 ? 'ext' : v < 35 ? 'maj' : v < 50 ? 'min' : v < 65 ? 'mid' : 'good');
export function colonyTileHtml(p, meUser) {
  const mine = p.user && p.user === meUser;
  const st = STATE_ICO[p.state];
  const hp = H.clamp(p.healthPct), md = p.moodPct == null ? null : H.clamp(p.moodPct);
  return `<a data-key="${e(p.id || p.user)}" class="card kol-tile${mine ? ' mine' : ''}" href="#/kolonie/${encodeURIComponent(p.id || p.user)}" title="${e(p.name)}${p.stateLabel ? ' – ' + e(p.stateLabel) : ''}">
    <span class="kt-pic">${H.portraitHtml(p, 'kt-portrait')}${st ? `<i class="kt-state s-${st[1]}" title="${e(p.stateLabel || p.state)}">${st[0]}</i>` : ''}${mine ? '<span class="kt-me">Du</span>' : ''}</span>
    <b class="kt-name">${e(p.name)}</b>
    <span class="kt-sub small muted">${p.user ? '@' + e(p.displayName || p.user) : 'Kolonist'}</span>
    <span class="kt-bars">
      <span class="kt-br" title="Gesundheit ${Math.round(hp)} %"><span class="kt-ic" aria-hidden="true">❤</span><span class="kt-b c-${H.tone(hp)}"><i style="width:${hp}%"></i></span><span class="kt-n">${Math.round(hp)}</span></span>
      ${md == null ? '' : `<span class="kt-br" title="Stimmung ${Math.round(md)} %"><span class="kt-ic" aria-hidden="true">☺</span><span class="kt-b m-${moodCol(md)}"><i style="width:${md}%"></i></span><span class="kt-n">${Math.round(md)}</span></span>`}
    </span>
    ${p.job ? `<span class="kt-job small muted" title="${e(p.job)}">${e(p.job)}</span>` : '<span class="kt-job small muted">&nbsp;</span>'}
  </a>`;
}

// ---------------------------------------------------------------------
// Start: Einführung als Symbolkarten, Item-Streifen
// ---------------------------------------------------------------------
export function introCardsHtml() {
  const card = (ico, title, text, extra = '') => `<li class="ic-card"><span class="ic-ico" aria-hidden="true">${ico}</span><b class="ic-t">${title}</b><span class="ic-x">${text}</span>${extra}</li>`;
  return `<ol class="intro-cards">
    ${card('🎮', 'Beitreten', 'Schreib <code>!join</code> in den Chat – dann bekommst du einen eigenen Kolonisten.')}
    ${card('🪙', 'Coins sammeln', 'Du bekommst sie fürs Dabeisein. <code>!bal</code> zeigt dir, wie viele.')}
    ${card('🔍', 'Stöbern', 'Items, Events, Wetter und Traits – alles mit Preis, nichts auswendig lernen.')}
    ${card('📋', 'Kopieren', 'Befehl antippen, im Chat einfügen, abschicken. Fertig.')}
  </ol>`;
}

/** Item-Streifen: Symbole nur, wenn die Live-Mod online ist (fillTeasers ergänzt sie später); sonst Name + Preis. */
export function itemTeaserHtml(items, total) {
  if (!items.length) return '';
  const tiles = items.map((i) => `<a class="tz-tile" href="#/items" title="${e(i.name)} – ${H.fmt(i.price)} Coins" data-tdef="${e(i.defName)}"><span class="tz-pic" aria-hidden="true" data-pickey="t_${e(i.defName)}" data-pcls="tz-img" data-psize="48"></span><b class="tz-name">${e(i.name)}</b><span class="tz-price small muted">${H.fmt(i.price)} 🪙</span></a>`).join('');
  return `<div class="tz-teaser"><div class="tz-strip">${tiles}</div><a class="small tz-all" href="#/items">Alle ${H.fmt(total)} Items →</a></div>`;
}
/** Symbole in Item-Streifen einsetzen bzw. entfernen, je nachdem ob die Live-Mod erreichbar ist. */
export function fillTeasers() {
  PICS.fillAll(document.querySelector('.tz-teaser'));
}
