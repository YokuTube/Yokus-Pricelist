// RICS Live – Gene-Übersicht eines Kolonisten (Biotech + alle Mods mit Genen).
// Daten: PawnDetail.genes (docs/API.md). Reine Darstellung; live-views.js reicht die Helfer durch (kein Rück-Import).
// Antippen nutzt den vorhandenen Aufklapp-Mechanismus der Charakter-Ansicht (data-trait, openTrait).

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const sgn = (n) => (n > 0 ? '+' + n : String(n));
const KEY = 'ge:';

/** true, wenn für diesen Kolonisten eine Gene-Ansicht angezeigt werden soll */
export const hasGenes = (p) => !!p && p.genes != null && typeof p.genes === 'object';

// Ein Gen-Symbol, das nicht lädt (noch nicht gerendert / kein Symbol): Anfangsbuchstabe als Platzhalter
if (typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img?.matches?.('img[data-geneimg]')) return;
    const ph = document.createElement('span');
    ph.className = 'gn-ph';
    ph.setAttribute('aria-hidden', 'true');
    ph.textContent = img.dataset.geneimg || '?';
    img.replaceWith(ph);
  }, true);
}

function icon(h, key, label, cls) {
  const ini = h.esc((label || '?').trim().charAt(0).toUpperCase() || '?');
  if (!key) return `<span class="gn-ph ${cls || ''}" aria-hidden="true">${ini}</span>`;
  return `<img class="gn-ico ${cls || ''}" src="${h.esc(h.imgUrl(key))}" alt="" width="40" height="40" loading="lazy" data-geneimg="${ini}">`;
}

function all(g) {
  const mk = (list, kind) => (Array.isArray(list) ? list : []).map((x) => ({ ...x, kind }));
  return [...mk(g.endo, 'e'), ...mk(g.xeno, 'x')];
}

/** Stoffwechsel als Balken von der Mitte aus (links = kostet Nahrung/Abzug, rechts = Gewinn) */
function metabolism(list) {
  const act = list.filter((x) => x.active !== false);
  const met = act.reduce((s, x) => s + num(x.met), 0);
  const cpx = act.reduce((s, x) => s + num(x.cpx), 0);
  const arc = act.reduce((s, x) => s + num(x.arc), 0);
  const RANGE = 10, pct = Math.min(Math.abs(met), RANGE) / RANGE * 50;
  const side = met >= 0 ? `left:50%;width:${pct}%` : `left:${50 - pct}%;width:${pct}%`;
  const tn = met >= 0 ? 'pos' : met >= -5 ? 'neg' : 'neg2';
  return `<div class="gn-met">
    <div class="gn-met-row"><span class="gn-met-l">Stoffwechsel</span>
      <span class="gn-met-bar ${tn}" role="meter" aria-valuemin="-${RANGE}" aria-valuemax="${RANGE}" aria-valuenow="${met}" aria-label="Stoffwechsel gesamt ${sgn(met)}"><i class="gn-zero"></i><i class="gn-fill" style="${side}"></i></span>
      <b class="gn-met-v">${sgn(met)}</b></div>
    <div class="gn-sums small muted"><span title="Komplexität aller aktiven Gene">Komplexität ${cpx}</span>${arc ? `<span title="Archit-Kapseln, die diese Gene brauchen">Archit-Kapseln ${arc}</span>` : ''}<span>${act.length} aktiv${list.length - act.length ? ` · ${list.length - act.length} überschrieben` : ''}</span></div>
  </div>`;
}

function detail(h, x) {
  const who = x.kind === 'x' ? 'Xenogen' : 'Endogen';
  const tags = [who, x.cat, x.mod && x.mod !== 'Biotech' ? x.mod : null].filter(Boolean).map((t) => `<span class="gn-tag">${h.esc(t)}</span>`).join('');
  const stats = `<span title="Stoffwechsel">Stoffwechsel <b>${sgn(num(x.met))}</b></span><span title="Komplexität">Komplexität <b>${num(x.cpx)}</b></span>${num(x.arc) ? `<span title="Archit-Kapseln">Archit <b>${num(x.arc)}</b></span>` : ''}`;
  const desc = String(x.desc || '').split(/\n{2,}/).filter(Boolean).map((t) => `<p>${h.esc(t).replace(/\n/g, '<br>')}</p>`).join('');
  return `<div class="gn-detail" role="region" aria-label="${h.esc(x.label)}">
    <div class="gn-d-head">${icon(h, x.icon, x.label)}<div><b>${h.esc(x.label)}</b><div class="gn-tags">${tags}</div></div></div>
    <div class="gn-d-stats small">${stats}</div>
    ${x.active === false ? '<p class="gn-off small">Überschrieben – ein anderes Gen ersetzt dieses, es wirkt gerade nicht.</p>' : ''}
    ${desc || '<p class="muted small">Keine Beschreibung.</p>'}
  </div>`;
}

function tile(h, x, open) {
  const key = `${KEY}${x.kind}:${x.label}`;
  const mod = x.mod && x.mod !== 'Biotech' ? `<span class="gn-mod" title="Aus der Mod: ${h.esc(x.mod)}">${h.esc(x.mod)}</span>` : '';
  const state = `${x.kind === 'x' ? 'Xenogen' : 'Endogen'}${x.active === false ? ', überschrieben' : ''}`;
  return `<button type="button" class="gn-tile k-${x.kind}${x.active === false ? ' off' : ''}" data-trait="${h.esc(key)}" aria-expanded="${open === key}" aria-label="${h.esc(x.label)} (${state})">
    ${icon(h, x.icon, x.label)}<span class="gn-name">${h.esc(x.label)}</span>${mod}${x.kind === 'x' ? '<i class="gn-x" aria-hidden="true">X</i>' : ''}</button>`;
}

/**
 * Bereich „Gene“.
 * h = { esc, section, imgUrl(key), openTrait }
 */
export function panelGenes(p, h) {
  const g = p.genes;
  if (!hasGenes(p)) return '<div class="empty">Keine Gene bekannt.</div>';
  const list = all(g);
  const xt = g.xenotype || {};
  const xkey = KEY + 'xt';
  const head = `<button type="button" class="gn-head" data-trait="${xkey}" aria-expanded="${h.openTrait === xkey}">
      ${icon(h, xt.icon, xt.label, 'lg')}<span class="gn-h-t"><small>Xenotyp</small><b>${h.esc(xt.label || 'Unbekannt')}</b></span><span class="gn-chev" aria-hidden="true">${h.openTrait === xkey ? '▾' : '▸'}</span></button>
    ${h.openTrait === xkey && xt.desc ? `<p class="trait-desc">${h.esc(xt.desc)}</p>` : ''}`;
  if (!list.length) return h.section('Xenotyp', head) + '<div class="empty">Keine Gene.</div>';

  const open = h.openTrait;
  const sel = typeof open === 'string' && open.startsWith(KEY) && open !== xkey ? list.find((x) => `${KEY}${x.kind}:${x.label}` === open) : null;
  const cats = [];
  for (const x of list) {
    const c = x.cat || 'Weitere';
    let grp = cats.find((k) => k.cat === c);
    if (!grp) cats.push(grp = { cat: c, items: [] });
    grp.items.push(x);
  }
  const groups = cats.map((grp) => `<section class="ch-sec gn-grp"><h4>${h.esc(grp.cat)} <span class="gn-cnt">${grp.items.length}</span></h4>
    <div class="gn-grid">${grp.items.map((x) => tile(h, x, open)).join('')}</div>
    ${sel && grp.items.includes(sel) ? detail(h, sel) : ''}</section>`).join('');
  const legend = `<div class="gn-legend small muted" aria-hidden="true"><span><i class="gn-sw k-e"></i>Endogen (angeboren)</span><span><i class="gn-sw k-x"></i>Xenogen (eingesetzt)</span><span><i class="gn-sw off"></i>überschrieben</span></div>`;
  return h.section('Xenotyp', head) + metabolism(list) + legend + groups;
}
