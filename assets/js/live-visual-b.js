// Paket B: gemeinsame, rein darstellende Bausteine für die Live-Ansichten (Symbole statt Text).
// Alles hier liefert nur HTML-Zeichenketten; Daten aus der Mod laufen durch esc().
import { esc as escRaw, fmt } from './util.js';
import * as live from './live.js';

const esc = (s) => escRaw(live.stripTags(s));

/** Bild der Mod (/api/img/<key>); nur wenn die Live-Mod online ist. */
export const imgUrl = (key) => (live.isLive() && key ? live.artUrl('x', 0).replace(/\/api\/art\/.*$/, '/api/img/' + encodeURIComponent(key)) : '');

// ---------- Aufgeklappte Einträge (übersteht Neuzeichnen per morph) ----------
export const openKeys = new Set();
if (typeof document !== 'undefined') {
  // <details> meldet toggle ohne Bubbling -> in der Capture-Phase mitlesen
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d?.matches?.('details[data-okey]')) return;
    if (d.open) openKeys.add(d.dataset.okey); else openKeys.delete(d.dataset.okey);
  }, true);
  // Spielbild nicht vorhanden (404, noch nicht gerendert): Ersatzsymbol
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img?.matches?.('img[data-sym]')) return;
    const sp = document.createElement('span');
    sp.className = img.className.replace('sym-img', 'sym-emo');
    sp.setAttribute('aria-hidden', 'true');
    sp.textContent = img.dataset.sym || '';
    img.replaceWith(sp);
  }, true);
}

/** Spielsymbol mit Emoji als Ersatz. */
export function symHtml(key, emo, cls = '') {
  const src = imgUrl(key);
  return src
    ? `<img class="sym-img ${cls}" src="${esc(src)}" alt="" width="32" height="32" loading="lazy" data-sym="${esc(emo || '')}">`
    : `<span class="sym-emo ${cls}" aria-hidden="true">${esc(emo || '')}</span>`;
}

/** Münze + Zahl (Preis). */
export const coinHtml = (n, cls = '') => `<span class="pcoin ${cls}" title="${esc(fmt(n))} Münzen"><i class="pc-ico" aria-hidden="true">🪙</i>${esc(fmt(n))}</span>`;
/** Uhr + Dauer (Wartezeit). */
export const clockHtml = (txt, title = '') => `<span class="pclock" title="${esc(title || 'Wartezeit')}"><i aria-hidden="true">⏱</i>${esc(txt)}</span>`;

// ---------- Zeit kurz: „2 Stunden“ -> „2 h“ ----------
export function agoShort(s) {
  return String(s || '').replace(/^vor\s+/i, '')
    .replace(/\bStunden?\b/g, 'h').replace(/\bMinuten?\b/g, 'min').replace(/\bTagen?\b|\bTage\b/g, 'd')
    .replace(/\bQuadrums?\b/g, 'Q').replace(/\bJahren?\b/g, 'J').replace(/\bMonaten?\b/g, 'Mon').replace(/\bSekunden?\b/g, 's').trim();
}

// ---------- Gespräche ----------
const SOCIAL_KINDS = [
  [/marriage|proposal|antrag|heirat/i, '💍', 'Heiratsantrag'],
  [/breakup|trenn/i, '💔', 'Trennung'],
  [/romance|flirt|kiss|lovin/i, '💘', 'Flirt'],
  [/deeptalk|deep/i, '🧠', 'Tiefes Gespräch'],
  [/gift|geschenk/i, '💝', 'Geschenk'],
  [/rapport|annäher|annaeher/i, '🤝', 'Annäherung'],
  [/reassure|tröst|troest|beruhig/i, '🫂', 'Trösten'],
  [/insult|slight|beleid/i, '😠', 'Beleidigung'],
  [/animal|tame|train|zähm/i, '🐾', 'Tiere'],
  [/kind|nett/i, '😊', 'Nette Worte'],
  [/chitchat|plaud/i, '💬', 'Plaudern'],
];
export function socialKind(kind, good) {
  const k = String(kind || '');
  for (const [re, emo, label] of SOCIAL_KINDS) if (re.test(k)) return { emo, label };
  return good === true ? { emo: '💬', label: 'Gespräch' } : good === false ? { emo: '💢', label: 'Streit' } : { emo: '💭', label: 'Gespräch' };
}
export const socialTone = (e) => (e.good === true ? 'good' : e.good === false ? 'bad' : 'neutral');
export const hasSocialKind = (e) => !!(e && (e.kind || e.good != null));

/**
 * Gespräch als Zeile „Porträt A – Symbol – Porträt B“, Farbe nach good. Der volle Satz klappt beim Antippen auf.
 * ctx: { avatar(q) -> HTML, link(q) -> HTML (Name), text(str) -> HTML (verlinkter Satz) }
 */
export function socialRowHtml(e, ctx) {
  const tone = socialTone(e), k = socialKind(e.kind, e.good);
  const ps = Array.isArray(e.pawns) ? e.pawns.filter((q) => q && (q.id || q.name)) : [];
  // „ago“ ändert sich ständig -> Schlüssel nur über den Text
  const okey = 'so:' + String(e.text || '').slice(0, 120);
  const open = openKeys.has(okey);
  const sym = e.icon ? symHtml(e.icon, k.emo, 'so-sym') : `<span class="sym-emo so-sym" aria-hidden="true">${k.emo}</span>`;
  const av = (q) => (q ? ctx.avatar(q) : '<span class="so-av ph" aria-hidden="true">?</span>');
  const pair = ps.length ? `${av(ps[0])}<span class="so-mid">${sym}</span>${ps[1] ? av(ps[1]) : ''}` : `<span class="so-mid">${sym}</span>`;
  const names = ps.length ? ps.slice(0, 2).map((q) => ctx.link(q)).join(` <span class="so-arrow" aria-hidden="true">${e.good === false ? '⚡' : '↔'}</span> `) : '';
  return `<details class="so-ev tone-${tone}" data-okey="${esc(okey)}"${open ? ' open' : ''}>
    <summary title="${esc(k.label)} – antippen für den ganzen Satz"><span class="so-pair">${pair}</span>
      <span class="so-meta"><span class="so-names">${names || ctx.text(e.text)}</span><span class="so-ago"><i aria-hidden="true">⏱</i> ${esc(agoShort(e.ago))}</span></span></summary>
    <p class="so-full"><b class="so-kind">${esc(k.label)}.</b> ${ctx.text(e.text)}</p></details>`;
}

// ---------- Geschichte / Kampflog: Symbol nach Schlüsselwörtern ----------
const HIST = [
  [/gestorben|starb|ist tot|\btot\b|getötet|tod\b|beerdigt|leiche|verstorben/i, '✝', 'doom'],
  [/geboren|geburt|baby|zur welt/i, '👶', 'good'],
  [/krank|grippe|infekt|seuche|malaria|pest\b|fieber|vergift|erkrankt|parasit/i, '🦠', 'bad'],
  [/heirat|vermählt|verlob|verliebt|liebe|ehe\b|kuss|antrag|flirt|romanz|partner/i, '💕', 'good'],
  [/fest\b|party|feier|konzert|ritual|bankett|tanz|gefeiert|spiel(?:abend)?/i, '🎉', 'good'],
  [/kampf|besiegt|angegriffen|erschossen|geschlagen|erstochen|getroffen|schlacht|schlug|prügel|schuss|feuerte|erledigt|niedergestreckt|zerschmettert/i, '⚔', 'bad'],
  [/verletz|wund|schnitt|blutung|blutet|biss|verbrannt|schaden|verstümmel/i, '✚', 'doom'],
  [/gerettet|gerettet|befreit|gerettet|geheilt|operiert|behandelt/i, '❤', 'good'],
  [/schloss sich an|beigetreten|angekommen|aufgenommen|rekrutiert|gefangen/i, '🚪', 'neutral'],
  [/gespräch|unterhalt|geredet|plauder|beleidig|gesprochen/i, '💬', 'neutral'],
  [/gearbeitet|gebaut|gekocht|geerntet|geforscht|gepflanzt|geschmiedet|hergestellt/i, '🔨', 'neutral'],
];
export function historyKind(text) {
  const t = String(text || '');
  for (const [re, emo, tone] of HIST) if (re.test(t)) return { emo, tone };
  return { emo: '•', tone: 'neutral' };
}

/** Zeitleisten-Eintrag: Farbpunkt + Symbol, ein Text, Rest antippbar. */
export function timelineItemHtml({ okey, emo, tone, head, textHtml, fullHtml, meta }) {
  const open = openKeys.has(okey);
  return `<details class="tlb tone-${tone}" data-okey="${esc(okey)}"${open ? ' open' : ''}>
    <summary><span class="tlb-dot" aria-hidden="true"><i>${esc(emo)}</i></span>
      ${head ? `<span class="tlb-head">${esc(head)}</span>` : ''}<span class="tlb-text">${textHtml}</span>${meta ? `<span class="tlb-meta">${meta}</span>` : ''}</summary>
    <p class="tlb-full">${fullHtml}</p></details>`;
}

// ---------- Gedanken ----------
const THOUGHT = [
  [/essen|mahlzeit|hunger|nahrung|gegessen|roh|schmeck|köstlich|verhungert|mahl|speise|trunk|durst|getrunk/i, '🍽'],
  [/schlaf|müde|bett|ruhe\b|erschöpf|ausgeruht|schlaflos|matratze|geschlafen/i, '🛏'],
  [/schmerz|verletz|wund|krank|übel|schwäche|weh\b/i, '🤕'],
  [/tod|gestorben|tot\b|leiche|begräbnis|verstorben|gefallen|trauer/i, '✝'],
  [/liebe|\behe|verheirat|partner|verlobt|geliebt|beziehung|affäre|ehepartner|kuss|flirt/i, '💕'],
  [/gespräch|unterhalt|beleidig|plaudern|nett|geredet|sozial|freund|gesellig|einsam|rivale|streit/i, '💬'],
  [/raum|umgebung|schön|hässlich|dunkel|eng\b|drinnen|draußen|temperatur|kalt|heiß|hitze|frost|nass|regen|schmutz|dreck|gestank|beauty|schlafzimmer|zimmer|haus|decke|licht/i, '🏠'],
  [/droge|sucht|rausch|entzug|bier|alkohol|wein|smokeleaf|psychit/i, '💊'],
  [/arbeit|job|aufgabe|zwang|langweil|müh/i, '🔨'],
  [/glaube|ideo|ritual|zeremon|zuversicht|gebet|religion/i, '☯'],
];
export function thoughtEmoji(label) {
  const t = String(label || '');
  for (const [re, emo] of THOUGHT) if (re.test(t)) return emo;
  return '💭';
}

/** Summe der Gedanken als zweiseitiger Balken (links schlecht, rechts gut). */
export function sumBarHtml(sum, posSum, negSum) {
  const span = Math.max(20, Math.abs(posSum), Math.abs(negSum));
  const w = (v) => Math.min(50, (Math.abs(v) / span) * 50);
  return `<div class="th-bar" role="meter" aria-valuemin="${-span}" aria-valuemax="${span}" aria-valuenow="${Math.round(sum)}" aria-label="Summe der Gedanken">
    <i class="neg" style="width:${w(negSum)}%"></i><i class="pos" style="width:${w(posSum)}%"></i><b class="zero"></b></div>`;
}

// ---------- Gesundheit ----------
const R_IMPLANT = /implantat|prothese|bioni|holzbein|holzhand|haken|ersatz|augmetic|archotech|archit|nano|cyber|synthet|kunst(?:bein|arm|auge|hand)|sensor|transplant|exoskel|pegbein|metallbein|steinglied|neuro|bionic|prosthe|\bimplant/i;
const R_DISEASE = /grippe|pest\b|malaria|infekt|seuche|schlafkrankheit|blutvergiftung|sepsis|pilz|lungenentz|krankheit|fieber|vergift|toxi|sucht|entzug|parasit|krebs|demenz|katarakt|blind|asthma|arthritis|rückenschäden|müdigkeit|erkältung|immun|darm|muskelparasit|fibrös|nahrungsmittelver|gehirn|alzheimer|bleich|sensorik|allergi|schwäche/i;
export function condGroup(c) {
  if (c.bleeding) return 'injury';
  if (R_IMPLANT.test(c.label || '') && !c.bad) return 'implant';
  if (c.bad && R_DISEASE.test(c.label || '') && !c.part) return 'disease';
  if (c.bad) return 'injury';
  if (R_DISEASE.test(c.label || '') && /immun/i.test(c.label || '')) return 'good';
  if (R_IMPLANT.test(c.label || '')) return 'implant';
  return 'good';
}
export const COND_META = {
  injury: { emo: '✚', title: 'Verletzt', cls: 'bad' },
  disease: { emo: '🦠', title: 'Krank', cls: 'bad' },
  implant: { emo: '🔧', title: 'Implantate & Prothesen', cls: 'impl' },
  good: { emo: '✓', title: 'Geheilt / gut', cls: 'good' },
};

// ---------- Ausrüstung ----------
export const QUALITY_CLS = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
export const qualityCls = (q) => (q == null || !Number.isFinite(Number(q)) ? 'qn' : QUALITY_CLS[Math.max(0, Math.min(6, Number(q)))]);
export function gearTileHtml(it, slotLabel = '') {
  if (!it) return '';
  const hp = it.hpPct == null ? null : Math.max(0, Math.min(100, Number(it.hpPct) || 0));
  const hpCls = hp == null ? '' : hp >= 66 ? 'ok' : hp >= 33 ? 'mid' : 'low';
  return `<div class="gear-tile ${qualityCls(it.quality)}" title="${esc(it.label)}${it.qualityLabel ? ` (${esc(it.qualityLabel)})` : ''}${hp != null ? ` – Haltbarkeit ${Math.round(hp)} %` : ''}">
    ${symHtml(it.icon, slotLabel === 'weapon' ? '🔫' : '👕', 'gear-ico')}
    <span class="gear-name">${esc(it.label)}</span>
    ${it.qualityLabel ? `<span class="gear-q">${esc(it.qualityLabel)}</span>` : ''}
    ${hp != null ? `<span class="gear-hp ${hpCls}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(hp)}" aria-label="Haltbarkeit"><i style="width:${hp}%"></i></span>` : ''}
  </div>`;
}

// ---------- Fortschrittsring ----------
export function ringHtml(pct, label = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 15.5, c = 2 * Math.PI * r;
  return `<span class="ring" role="img" aria-label="${esc(label || `${Math.round(p)} Prozent`)}" title="${Math.round(p)} %">
    <svg viewBox="0 0 36 36" width="40" height="40" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="ring-bg"/><circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/></svg><b>${Math.round(p)}</b></span>`;
}

// ---------- Eigenheiten (Quirks): Farbe nach Wirkung ----------
export function quirkTone(q) {
  const t = `${q?.label || ''} ${q?.desc || ''}`;
  const bad = /nachteil|schlecht|weniger|verringert|verlangsamt|langsam|abneigung|hasst|[−-]\s?\d|mindert|schwäche|anfällig|gereizt|aggressiv|furcht|angst/i.test(t);
  const good = /vorteil|besser|mehr\b|schneller|bonus|stärker|\+\s?\d|erhöht|gewinn|zufrieden|robust|immun|geschickt/i.test(t);
  return bad && !good ? 'bad' : good && !bad ? 'good' : bad && good ? 'mixed' : 'neutral';
}

// ---------- Ereignisse (Briefe) ----------
export const LETTER_KIND = {
  threat: { label: 'Gefahr', title: 'Gefahr / Katastrophe' },
  bad: { label: 'Schlecht', title: 'Schlecht' },
  good: { label: 'Gut', title: 'Gut' },
  neutral: { label: 'Neutral', title: 'Neutral' },
};
/** Großes Symbol einer Brief-Art als SVG: Gefahr rotes Dreieck, Schlecht oranger Pfeil nach unten, Gut grüner Haken, Neutral graue Scheibe. */
export function kindIconHtml(kind, cls = '') {
  const k = LETTER_KIND[kind] ? kind : 'neutral';
  const sv = {
    threat: '<path d="M16 3 30 28H2z" class="ki-f"/><path d="M16 12v8" class="ki-s"/><circle cx="16" cy="24" r="1.4" class="ki-d"/>',
    bad: '<path d="M3 8h26L16 29z" class="ki-f"/><path d="M16 12v8" class="ki-s"/>',
    good: '<circle cx="16" cy="16" r="13" class="ki-f"/><path d="M9.500 16.500 14 21l8.500-9.500" class="ki-s"/>',
    neutral: '<circle cx="16" cy="16" r="13" class="ki-f"/><circle cx="16" cy="16" r="3.500" class="ki-d"/>',
  }[k];
  return `<svg class="kind-ico k-${k} ${cls}" viewBox="0 0 32 32" role="img" aria-label="${esc(LETTER_KIND[k].title)}"><title>${esc(LETTER_KIND[k].title)}</title>${sv}</svg>`;
}
/** Kleines Symbol je Art des Ereignisses (aus def/Titel), für die Karte neben dem Brief-Symbol. */
const EV_THEME = [
  [/raid|überfall|plünder|belager|invasion|angriff|infestation|ambush|hinterhalt|manhunter|mech/i, '⚔'],
  [/disease|krank|seuche|grippe|pest|malaria|pawn ist krank|infekt|cluster|parasit/i, '🦠'],
  [/trader|händler|handel|karawane|caravan|kaufmann|schiff|orbital|bettler/i, '💰'],
  [/wander|beitritt|schließt sich|rekrut|flüchtling|refugee|join|aufgenommen/i, '🚪'],
  [/weather|wetter|regen|schnee|sturm|gewitter|kälte|hitze|frost|nebel|flash|blitz|dürre|eclipse|finsternis|aurora|polarlicht|nieselregen/i, '🌦'],
  [/fest|party|feier|concert|konzert|ritual|hochzeit|bankett|tanz/i, '🎉'],
  [/geburt|baby|geboren/i, '👶'],
  [/tod|gestorben|tot\b|starb/i, '✝'],
  [/quest|auftrag|mission/i, '📜'],
  [/tier|animal|tame|rudel|herde|schwarm|manhunter|fledermaus/i, '🐾'],
  [/brand|feuer|fire|explos|kurzschluss|short/i, '🔥'],
  [/ernte|pflanz|crop|blight|seuche|saat/i, '🌾'],
  [/schiff|absturz|crash|drop|ship|chunk|pod|lieferung|abwurf/i, '📦'],
];
export function eventTheme(e) {
  const hay = `${e?.def || ''} ${e?.letterDef || ''} ${e?.label || ''}`;
  for (const [re, emo] of EV_THEME) if (re.test(hay)) return emo;
  return '';
}
