// Alle Ansichten (Tabs). Jede Funktion liefert { html, bind(root) }.
import { esc, rich, plain, cap, slug, fmt, debounce, cmdBtn, pickBtn, karmaBadge, karmaInfo, days, KARMA, makeMatcher } from './util.js';
import { EVENT_TYPES } from './data.js';
import { icon } from './icons.js';
import * as vb from './visual-b.js';   // Paket B: Symbole statt Text
import * as vbl from './live-visual-b.js';   // Spielsymbole (nur mit laufender Live-Mod)
import * as live from './live.js';
import { setIcons, fillAll as fillPics, hue, hasStaticPic } from './pics.js';
import { introCardsHtml, itemTeaserHtml, fillTeasers } from './live-visual-a.js';

const PAGE = 48;
const norm = (s) => plain(s).toLowerCase();

/** Suchbegriff von der Startseiten-Suche übernehmen (einmalig). */
function takeQuery(input) {
  let q = '';
  try { q = sessionStorage.getItem('ys-q') || ''; sessionStorage.removeItem('ys-q'); } catch { /* egal */ }
  if (q && input) input.value = q;
}

/** Auf dem Handy sind Filter eingeklappt, am Rechner offen. */
const filterPanel = (inner, label = 'Filter & Sortierung') =>
  `<details class="filter-panel" data-auto-open><summary>${label}</summary><div class="fp-body">${inner}</div></details>`;
const openPanels = (root) => root.querySelectorAll('[data-auto-open]').forEach((d) => { d.open = window.innerWidth > 640; });
const uniqSorted = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'de'));
const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

/** RimWorld-Text mit großem Anfangsbuchstaben (auch wenn davor Farb-Tags stehen). */
function richCap(label) {
  const html = rich(label);
  return html.replace(/^((?:<[^>]+>)*)([a-zäöüß])/, (m, tags, c) => tags + c.toUpperCase());
}

function options(values, counts, allLabel) {
  const opts = [`<option value="">${esc(allLabel)}</option>`];
  values.forEach((v) => opts.push(`<option value="${esc(v)}">${esc(v)}${counts ? ` (${counts.get(v) || 0})` : ''}</option>`));
  return opts.join('');
}

/** Zeichnet gefilterte Einträge seitenweise in `host`. */
function pager(host, countEl, list, renderOne, emptyText) {
  let shown = 0;
  const draw = (reset) => {
    if (reset) { shown = 0; host.innerHTML = ''; }
    if (!list.length) {
      host.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
      countEl.textContent = '';
      return;
    }
    const next = list.slice(shown, shown + PAGE);
    host.insertAdjacentHTML('beforeend', next.map(renderOne).join(''));
    shown += next.length;
    host.querySelector('.more-wrap')?.remove();
    if (shown < list.length) {
      host.insertAdjacentHTML('beforeend', `<div class="more-wrap" style="grid-column:1/-1"><button type="button" class="btn" data-more>Mehr anzeigen (${list.length - shown} weitere)</button></div>`);
    }
    countEl.textContent = `${fmt(list.length)} Treffer`;
  };
  host.addEventListener('click', (e) => { if (e.target.closest('[data-more]')) draw(false); });
  draw(true);
  return () => draw(true);
}

// =====================================================================
// START
// =====================================================================
function uniRow(title, sub, price, cmd, link) {
  return `<div class="uni-row"><div class="uni-main"><div class="uni-title">${title}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>
    ${price ? `<div class="price">${fmt(price)}</div>` : ''}<div class="uni-act">${cmd ? cmdBtn(cmd) : link || ''}</div></div>`;
}

/** Item im Schaufenster: wie im Items-Reiter mit Menge (wird in den Befehl eingebaut). */
function showItemRow(i) {
  const max = i.limit > 0 ? i.limit : 9999;
  const base = '!buy ' + i.cmdName;
  const btn = cmdBtn(base).replace('class="cmd "', `class="cmd" data-qty data-base="${esc(base)}"`);
  const qty = max > 1 ? `<div class="qty-box" title="Wie viele? Wird automatisch in den Befehl eingebaut">
      <button type="button" class="qty-btn" data-d="-1" aria-label="Weniger">−</button>
      <input class="qty" type="number" inputmode="numeric" min="1" max="${max}" value="1" aria-label="Menge">
      <button type="button" class="qty-btn" data-d="1" aria-label="Mehr">+</button>
      <span class="sum small muted"></span>
    </div>` : '';
  return `<div class="uni-row item-row show-item" data-price="${i.price}"><div class="uni-main"><div class="uni-title">${esc(i.name)}</div><div class="small muted">${esc(i.category)}</div></div>
    <div class="price">${fmt(i.price)}</div><div class="uni-act">${qty}<div class="cmd-row">${btn}</div></div></div>`;
}

/** Schaufenster: je ein Beispiel-Ausschnitt, damit man sofort sieht, was alles geht. */
function showcase(data) {
  const on = (cmd) => data.commands.list.some((c) => c.cmd === cmd && c.enabled);
  const sold = data.items.filter((i) => i.enabled);
  const preferred = ['Steel', 'MedicineIndustrial', 'Silver', 'WoodLog', 'ComponentIndustrial', 'Beer'];
  const itemPick = [];
  preferred.forEach((d) => { const f = sold.find((i) => i.defName === d); if (f) itemPick.push(f); });
  sold.forEach((i) => { if (itemPick.length < 3 && !itemPick.includes(i)) itemPick.push(i); });
  const cheapest = (k) => data.events.filter((e) => e.karma === k).sort((a, b) => a.cost - b.cost)[0];
  const evPick = ['Good', 'Neutral', 'Bad', 'Doom'].map(cheapest).filter(Boolean);
  const wPref = ['Clear', 'Rain', 'RainyThunderstorm'];
  const wPick = wPref.map((d) => data.weather.find((w) => w.defName === d)).filter(Boolean);
  data.weather.forEach((w) => { if (wPick.length < 3 && !wPick.includes(w)) wPick.push(w); });
  const chips = (arr) => `<div class="cmd-row">${arr.join('')}</div>`;
  const card = (title, tab, desc, body, more) => `
    <article class="card show-card"><h3><a href="#/${tab}">${icon(tab, 20)}${esc(title)}</a></h3><p>${esc(desc)}</p>${body}${more ? `<a class="more" href="#/${tab}">${esc(more)} →</a>` : ''}</article>`;
  const out = [];
  if (itemPick.length) out.push(card('Items kaufen', 'items', 'Rohstoffe, Medizin, Waffen und mehr – direkt in die Kolonie oder an deinen Pawn.',
    itemPick.map(showItemRow).join(''), `Alle ${fmt(sold.length)} Items ansehen`));
  if (evPick.length) out.push(card('Events auslösen', 'events', 'Gutes wie Schlechtes passiert sofort im Spiel – für Coins.',
    evPick.map((e) => uniRow(`${esc(cap(e.label))} ${karmaBadge(e.karma)}`, esc(e.text || ''), e.cost, '!event ' + e.cmdName)).join(''), `Alle ${fmt(data.events.length)} Events ansehen`));
  if (wPick.length) out.push(card('Wetter ändern', 'wetter', 'Vom Sonnenschein bis zum Sturm.',
    wPick.map((w) => uniRow(esc(cap(w.label)), esc(w.text || ''), w.cost, '!weather ' + w.cmdName)).join(''), `Alle ${fmt(data.weather.length)} Wetterlagen ansehen`));
  const own = [['!mypawn', '!mypawn'], ['!genderswap', '!genderswap'], ['!sethair list', '!sethair list'], ['!dyehair list', '!dyehair list'], ['!addtrait', '!addtrait ']]
    .filter(([, c]) => on(c.trim().split(' ')[0].slice(1)));
  if (own.length) out.push(card('Deinen Pawn gestalten', 'befehle', 'Aussehen, Eigenschaften und Werte deines Kolonisten ändern und ansehen.',
    chips(own.map(([l, c]) => pickBtn(l, c))), 'Alle Befehle ansehen'));
  const soc = [['!duel Name', '!duel '], ['!flirt', '!flirt'], ['!deeptalk', '!deeptalk'], ['!chitchat', '!chitchat'], ['!buildrapport', '!buildrapport']]
    .filter(([, c]) => on(c.trim().slice(1)));
  if (soc.length) out.push(card('Mit anderen Pawns', 'befehle', 'Plaudern, flirten, heiraten – oder zum Faustkampf herausfordern.',
    chips(soc.map(([l, c]) => pickBtn(l, c))), 'Soziales & Duelle ansehen'));
  const team = [on('goal') ? ['!goal', '!goal'] : null, ['Abstimmung: einfach die Zahl schreiben', '2']].filter(Boolean);
  out.push(card('Gemeinsam mit dem Chat', 'befehle', 'Abstimmen, welches Event als Nächstes kommt, und gemeinsame Ziele erreichen.',
    chips(team.map(([l, c]) => pickBtn(l, c))), 'Mehr ansehen'));
  out.push(card('Rassen & Eigenschaften', 'rassen', `Such dir aus ${fmt(data.races.length)} Rasse(n) mit ihren Xenotypen deinen Pawn aus und gib ihm unter ${fmt(data.traits.length)} Eigenschaften die passende.`,
    chips([pickBtn('!join', '!join'), pickBtn('!races', '!races')]), 'Rassen ansehen'));
  return out.join('');
}

export function startView(data) {
  setIcons(data.icons);
  const cnt = {
    items: data.items.length, events: data.events.length, weather: data.weather.length,
    traits: data.traits.length, races: data.races.length, commands: data.commands.list.length,
  };
  const sold = data.items.filter((i) => i.enabled);
  const pickDefs = ['Steel', 'MedicineIndustrial', 'Silver', 'WoodLog', 'ComponentIndustrial', 'Beer'];
  const teaserItems = pickDefs.map((d) => sold.find((i) => i.defName === d)).filter(Boolean);
  sold.forEach((i) => { if (teaserItems.length < 6 && !teaserItems.includes(i)) teaserItems.push(i); });
  const teaser = sold.length ? `<h2 style="margin:22px 0 10px;font-size:1.15rem">Im Angebot</h2>${itemTeaserHtml(teaserItems, sold.length)}` : '';
  const html = `
    <section class="card uni">
      <label for="u-search" class="uni-label">Was willst du tun? Einfach suchen:</label>
      <input class="search" type="search" id="u-search" placeholder="z. B. heilen, Regen, Waffe, Heirat, Pawn …" autocomplete="off" enterkeyhint="search">
      <div id="u-results" aria-live="polite"></div>
    </section>

    <p id="welcome-show" class="small" style="margin:10px 0 0" hidden><button type="button" class="linklike" id="welcome-show-btn">Einführung wieder anzeigen</button></p>
    <section class="card hero" id="welcome" style="margin-top:14px">
      <div class="ev-top"><h2>Willkommen im Yokus Store</h2><button type="button" class="btn small-btn" id="welcome-hide" title="Blendet die Einführung aus. Du kannst sie jederzeit wieder einblenden.">Ausblenden</button></div>
      <p class="intro" style="margin:0">Hier siehst du, was du im Stream mit deinen Coins machen kannst: Items kaufen, Events und Wetter auslösen und deinen eigenen Kolonisten steuern. Nichts auswendig lernen – vier Schritte genügen:</p>
      ${introCardsHtml()}
    </section>

    ${teaser}
    <h2 style="margin:22px 0 10px;font-size:1.15rem">Die wichtigsten Befehle</h2>
    <div class="cmd-row">
      ${['!join', '!bal', '!mypawn', '!mypawn needs', '!lookup item steel', '!event list', '!commands'].map((c) => cmdBtn(c)).join('')}
    </div>

    <h2 class="section-title">Das ist möglich</h2>
    <p class="intro" style="margin-top:-4px">Ein Blick ins Schaufenster – tippe auf einen Befehl, um ihn zu kopieren, oder auf die Überschrift für die ganze Liste.</p>
    <div class="grid cols-2">${showcase(data)}</div>

    <h2 style="margin:22px 0 10px;font-size:1.15rem">Kurz erklärt</h2>
    <div class="card"><dl class="glossary" style="margin:0">
      <dt>Coins</dt><dd>Die Währung. Damit bezahlst du Items, Events, Operationen und mehr.</dd>
      <dt>Karma</dt><dd>Gutes tun (Heilen, Helfen, gute Events) belohnt dich, Schlechtes (Überfälle, Katastrophen) kostet Karma. Manche Befehle brauchen ein Mindest-Karma. Mit <code>!karmasettings</code> siehst du die Regeln.</dd>
      <dt>Pawn</dt><dd>Dein Kolonist im Spiel. Er gehört dir, bis er stirbt oder du ihn mit <code>!leave</code> abgibst.</dd>
      <dt>Pause (Cooldown)</dt><dd>Viele Events und Befehle kann man nicht dauernd wiederholen. Die Pause zählt in Spieltagen.</dd>
      <dt>Katastrophe</dt><dd>So heißen die gefährlichsten Events (englisch „Doom“) – sie können die Kolonie ernsthaft bedrohen und sind teuer.</dd>
    </dl></div>
    ${data.failed.length ? `<p class="warn" style="margin-top:16px">Einige Daten konnten nicht geladen werden (${data.failed.map(esc).join(', ')}). Manche Tabs sind deshalb leer.</p>` : ''}
  `;
  function bind(root) {
    bindQuantity(root); // Menge im Schaufenster
    fillTeasers();      // Spielsymbole im Item-Streifen, wenn die Live-Mod erreichbar ist
    // Einführung ausblendbar (wird im Browser gemerkt)
    const welcome = root.querySelector('#welcome'), showLink = root.querySelector('#welcome-show');
    const setWelcome = (visible, remember) => {
      welcome.hidden = !visible; showLink.hidden = visible;
      if (remember) { try { localStorage.setItem('ys-welcome', visible ? 'show' : 'hide'); } catch { /* egal */ } }
    };
    let saved = null;
    try { saved = localStorage.getItem('ys-welcome'); } catch { /* egal */ }
    setWelcome(saved !== 'hide', false);
    root.querySelector('#welcome-hide').addEventListener('click', () => setWelcome(false, true));
    root.querySelector('#welcome-show-btn').addEventListener('click', () => setWelcome(true, true));

    const box = root.querySelector('#u-search'), out = root.querySelector('#u-results');
    const go = (tab, q) => `<a href="#/${tab}" data-q="${esc(q)}" class="small">Alle Treffer ansehen →</a>`;
    const draw = () => {
      const q = norm(box.value);
      if (q.length < 2) { out.innerHTML = ''; return; }
      const m = makeMatcher(q);
      const sections = [];
      const cmds = data.commands.list.filter((c) => c.enabled && c.group !== 'mod' &&
        m([c.cmd, c.alias, c.summary, ...(c.usage || []).map((u) => u.syntax + ' ' + (u.note || ''))].join(' '))).slice(0, 5);
      if (cmds.length) sections.push(['Befehle',cmds.map((c) => uniRow(`<a href="#/befehle/${esc(c.cmd)}">!${esc(c.cmd)}</a>`, esc(c.summary), 0, '', '')).join(''), 'befehle']);
      const its = data.items.filter((i) => i.available && m(`${i.name} ${i.defName} ${i.category}`));
      const itsOff = data.items.filter((i) => !i.available && m(`${i.name} ${i.defName}`));
      if (its.length) sections.push([`Items (${fmt(its.length)})`,its.slice(0, 5).map((i) => uniRow(esc(i.name), esc(i.category), i.price, (i.enabled ? '!buy ' : i.usable ? '!use ' : i.equippable ? '!equip ' : '!wear ') + i.cmdName)).join(''), 'items']);
      else if (itsOff.length) sections.push(['Items',`<div class="small muted" style="padding:6px 0">Gibt es im Spiel, wird aber gerade nicht verkauft: ${itsOff.slice(0, 5).map((i) => esc(i.name)).join(', ')}.</div>`, 'items']);
      const evs = data.events.filter((e) => m(`${e.label} ${e.de} ${e.defName} ${e.text}`));
      if (evs.length) sections.push([`Events (${fmt(evs.length)})`,evs.slice(0, 5).map((e) => uniRow(`${esc(cap(e.label))} ${karmaBadge(e.karma)}`, esc(e.text || ''), e.cost, '!event ' + e.cmdName)).join(''), 'events']);
      const ws = data.weather.filter((e) => m(`${e.label} ${e.defName} ${e.text}`));
      if (ws.length) sections.push([`Wetter (${ws.length})`,ws.slice(0, 4).map((e) => uniRow(`${esc(cap(e.label))} ${karmaBadge(e.karma)}`, esc(e.text || ''), e.cost, '!weather ' + e.cmdName)).join(''), 'wetter']);
      const trs = data.traits.filter((t) => m(`${t.name} ${t.defName} ${t.description}`));
      if (trs.length) sections.push([`Traits (${trs.length})`,trs.slice(0, 4).map((t) => uniRow(rich(t.name), '', t.addPrice, t.canAdd ? '!addtrait ' + slug(t.name) : '')).join(''), 'traits']);
      out.innerHTML = sections.length
        ? sections.map(([title, rows, tab]) => `<div class="uni-sec"><h3>${title}</h3>${rows}${go(tab, box.value)}</div>`).join('')
        : '<div class="empty" style="padding:18px 0 4px">Dazu habe ich nichts gefunden. Probier ein anderes Wort – oder schau unter „Befehle“.</div>';
    };
    box.addEventListener('input', debounce(draw, 150));
    out.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-q]');
      if (a) { try { sessionStorage.setItem('ys-q', a.dataset.q); } catch { /* egal */ } }
    });
  }
  return { html, bind };
}

// =====================================================================
// BEFEHLE
// =====================================================================
const SRC = { rics: 'RICS', addon: 'RICS-Addon', extras: 'Extras', voting: 'Abstimmung', live: 'Live-Seite' };

/** Mögliche Werte zu einem Befehl (aus den Daten oder fest) als antippbare Knöpfe. */
function pickValues(p, data) {
  if (p.values) return p.values;
  switch (p.from) {
    case 'weather': return data.weather.map((w) => w.cmdName);
    case 'races': return data.races.map((r) => slug(r.key));
    case 'xenotypes': return (data.races[0]?.xenos || []).map((x) => slug(x.name));
    default: return data.choices?.[p.from] || [];
  }
}

function pickHtml(p, data) {
  const vals = pickValues(p, data);
  if (!vals.length) return '';
  const race = data.races[0] ? slug(data.races[0].key) : 'human';
  const cmd = (v) => p.template.replace('{r}', race).replace('{c}', v).trimEnd();
  const label = esc((p.label || 'Auswahl').replace('{r}', race));
  const chips = vals.map((v) => pickBtn(v || cmd(v).replace(/^!/, ''), cmd(v))).join('');
  return vals.length > 16
    ? `<div class="pick"><details><summary>${label} (${vals.length} Möglichkeiten anzeigen)</summary><div class="cmd-row" style="margin-top:6px">${chips}</div></details></div>`
    : `<div class="pick"><div class="small muted">${label}</div><div class="cmd-row">${chips}</div></div>`;
}

function cmdCard(c, data) {
  const dim = !c.enabled ? 'dim' : '';
  const shown = c.show || c.cmd;
  const aliasTxt = c.alias ? `<span class="small muted">auch: ${esc(c.alias.split(/[,;\s]+/).filter(Boolean).map((a) => (a.startsWith('!') ? a : '!' + a)).join(', '))}</span>` : '';
  const tags = [];
  if (!c.enabled) tags.push('<span class="chip" style="background:var(--doom);color:#fff">gerade aus</span>');
  if (c.perm && c.perm !== 'everyone') tags.push(`<span class="chip accent">nur ${esc(c.permLabel)}</span>`);
  if (c.requires) tags.push(`<span class="chip">braucht ${esc(c.requires)}</span>`);
  if (SRC[c.src] && c.src !== 'rics') tags.push(`<span class="chip">${esc(SRC[c.src])}</span>`);
  if (c.cooldown >= 30) tags.push(`<span class="chip">${vb.clock(c.cooldown >= 120 ? `${Math.round(c.cooldown / 60)} min` : `${c.cooldown} s`, 'So lange musst du nach der Nutzung warten')}</span>`);
  if (c.cost > 0) tags.push(`<span class="chip">${vb.coin(c.cost)}</span>`);
  const grp = (data.commands.groups || []).find((g) => g.id === c.group);

  const usage = (c.usage || []).map((u) => `
    <div class="usage-item">${cmdBtn(u.syntax.startsWith('!') || /^\d/.test(u.syntax) ? u.syntax : '!' + u.syntax)}${u.note ? `<div class="note">${esc(u.note)}</div>` : ''}</div>`).join('');
  const examples = (c.examples || []).length
    ? `<div><h4>Beispiele</h4><div class="cmd-row">${c.examples.map((e) => cmdBtn(e)).join('')}</div></div>` : '';
  const notes = (c.notes || []).length
    ? `<div><h4>Gut zu wissen</h4><ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';

  return `
    <details class="card cmd-card ${dim}" data-cmd="${esc(c.cmd)}">
      <summary>
        <div class="cmd-head"><span class="cmd-ico" aria-hidden="true">${vb.cmdIcon(c.cmd, grp?.title, c.group)}</span><span class="cmd-name">!${esc(shown)}</span>${aliasTxt}</div>
        <div class="tags" style="grid-column:1;grid-row:2">${tags.join('')}</div>
        <div class="cmd-sum">${esc(c.summary)}</div>
      </summary>
      <div class="cmd-body">
        <div><h4>Das gibst du ein</h4><div class="usage">${usage}${(data.picks?.[c.cmd] || []).map((p) => pickHtml(p, data)).join('')}</div></div>
        ${examples}
        <div><h4>Das passiert</h4><p style="margin:0">${esc(c.effect || '')}</p></div>
        ${notes}
      </div>
    </details>`;
}

export function commandsView(data) {
  const { groups, list } = data.commands;
  const html = `
    <p class="intro"><strong>Tippe auf einen Befehl</strong>, um ihn aufzuklappen. Jede Eingabe ist ein Knopf: antippen kopiert sie. Eckige Klammern <code>[ ]</code> sind optional, spitze <code>&lt; &gt;</code> musst du ersetzen.</p>
    <div class="toolbar">
      <input class="search" type="search" id="c-search" placeholder="Befehl suchen, z. B. kaufen, heilen, duel …" autocomplete="off" enterkeyhint="search">
      <div class="cat-bar" id="c-groups" role="group" aria-label="Bereich">
        <button type="button" class="cat-btn" data-g="" aria-pressed="true" title="Alle"><span class="cb-i" aria-hidden="true">☰</span><span class="cb-l">Alle</span></button>
        ${groups.map((g) => `<button type="button" class="cat-btn" data-g="${esc(g.id)}" aria-pressed="false" title="${esc(g.title)}"><span class="cb-i" aria-hidden="true">${vb.groupIcon(g.title, g.id)}</span><span class="cb-l">${esc(g.title)}</span><b>${list.filter((c) => c.group === g.id && (c.enabled || false)).length}</b></button>`).join('')}
      </div>
      <div class="filters-row">
        <label class="small muted"><input type="checkbox" id="c-off"> ausgeschaltete Befehle anzeigen</label>
        <label class="small muted"><input type="checkbox" id="c-mods"> Befehle für Mods &amp; Streamer</label>
      </div>
    </div>
    <div id="c-count" class="result-count"></div>
    <div id="c-list" class="cols"></div>`;

  function bind(root) {
    const $ = (s) => root.querySelector(s);
    let group = '', showOff = false, showMods = false;
    const draw = () => {
      const q = norm($('#c-search').value);
      const m = makeMatcher(q);
      const match = (c) => !q || m([c.cmd, c.alias, c.summary, c.effect, ...(c.usage || []).flatMap((u) => [u.syntax, u.note]), ...(c.examples || []), ...(c.notes || [])].join(' '));
      const visible = list.filter((c) => match(c) && (showOff || c.enabled) && (showMods || c.group !== 'mod' || group === 'mod' || q) && (!group || c.group === group));
      $('#c-count').textContent = `${visible.length} Befehle`;
      if (!visible.length) { $('#c-list').innerHTML = '<div class="empty">Nichts gefunden. Versuch einen anderen Suchbegriff.</div>'; return; }
      $('#c-list').innerHTML = groups.map((g) => {
        const items = visible.filter((c) => c.group === g.id).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
        if (!items.length) return '';
        return `<section class="group"><h3>${esc(g.title)}</h3><p>${esc(g.intro || '')}</p>${items.map((c) => cmdCard(c, data)).join('')}</section>`;
      }).join('');
      if (q && visible.length <= 6) root.querySelectorAll('.cmd-card').forEach((d) => { d.open = true; });
    };
    takeQuery($('#c-search'));
    $('#c-search').addEventListener('input', debounce(draw));
    $('#c-groups').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      group = b.dataset.g;
      root.querySelectorAll('#c-groups .cat-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    });
    $('#c-off').addEventListener('change', (e) => { showOff = e.target.checked; draw(); });
    $('#c-mods').addEventListener('change', (e) => { showMods = e.target.checked; draw(); });
    draw();
    // Direktlink auf einen Befehl: #/befehle/duel
    const want = (location.hash.split('/')[2] || '').toLowerCase();
    if (want) {
      const el = root.querySelector(`.cmd-card[data-cmd="${CSS.escape(want)}"]`);
      if (el) { el.open = true; el.scrollIntoView({ block: 'center' }); }
    }
  }
  return { html, bind };
}

// =====================================================================
// ITEMS
// =====================================================================
function itemRow(i) {
  const limit = i.limit > 0 ? `<span class="chip" title="Mehr kannst du pro Kauf nicht nehmen">bis zu ${fmt(i.limit)} pro Kauf</span>` : '';
  const max = i.limit > 0 ? i.limit : 9999;
  const q = (text) => cmdBtn(text).replace('class="cmd "', `class="cmd" data-qty data-base="${esc(text)}"`);
  // Genau das anzeigen, was RICS für dieses Item erlaubt: kaufen nur bei "Enabled", benutzen/ausrüsten/anziehen je nach Schalter.
  const acts = [];
  if (i.enabled) acts.push(q('!buy ' + i.cmdName));
  if (i.usable) acts.push(q('!use ' + i.cmdName));
  if (i.equippable) acts.push(cmdBtn('!equip ' + i.cmdName));
  if (i.wearable) acts.push(cmdBtn('!wear ' + i.cmdName));
  const hasQty = i.enabled || i.usable;
  const qty = `<div class="qty-box" title="Wie viele? Wird automatisch in den Befehl eingebaut">
      <span class="small muted">Menge</span>
      <button type="button" class="qty-btn" data-d="-1" aria-label="Weniger">−</button>
      <input class="qty" type="number" inputmode="numeric" min="1" max="${max}" value="1" aria-label="Menge">
      <button type="button" class="qty-btn" data-d="1" aria-label="Mehr">+</button>
      <span class="sum small muted"></span>
    </div>`;
  return `
    <article class="card item-row item-detail" data-price="${i.price}" data-for="${esc(i.defName)}">
      <div>
        <h3>${esc(i.name)}</h3>
        <div class="meta"><span class="chip accent">${esc(i.category)}</span>${i.mod !== 'RimWorld' ? `<span class="chip">${esc(i.mod)}</span>` : ''}${limit}
        ${i.usable ? '<span class="chip">benutzbar</span>' : ''}${i.equippable ? '<span class="chip">ausrüstbar</span>' : ''}${i.wearable ? '<span class="chip">anziehbar</span>' : ''}</div>
      </div>
      <div class="it-d-price">${vb.coin(i.price, 'big')}</div>
      <div class="acts">${!i.available ? '<span class="chip" style="background:var(--doom);color:#fff;justify-self:start" title="Der Streamer hat dieses Item in RICS ausgeschaltet">gerade nicht im Store</span>' : `${hasQty ? qty : ''}<div class="cmd-row">${acts.join('')}</div>`}</div>
    </article>`;
}

/** Menge pro Item-Zeile: passt Befehle und Summe live an. */
function bindQuantity(root) {
  if (root._qtyBound) return;   // #view bleibt zwischen Ansichten dieselbe: Handler nicht mehrfach anhängen
  root._qtyBound = true;
  const sync = (row, fix) => {
    const inp = row.querySelector('.qty');
    const max = Number(inp.max) || 9999;
    let n = parseInt(inp.value, 10);
    if (!Number.isFinite(n) || n < 1) n = fix ? 1 : 1;
    n = Math.min(max, n);
    if (fix) inp.value = String(n);
    row.querySelectorAll('.cmd[data-qty]').forEach((b) => {
      const t = n > 1 ? `${b.dataset.base} ${n}` : b.dataset.base;
      b.dataset.copy = t;
      b.querySelector('.txt').textContent = t;
    });
    const sum = row.querySelector('.sum');
    if (sum) sum.innerHTML = n > 1 ? `Summe <span class="coin"></span>${fmt(Number(row.dataset.price) * n)}` : '';
  };
  root.addEventListener('input', (e) => { const row = e.target.closest('.item-row'); if (row && e.target.matches('.qty')) sync(row, false); });
  root.addEventListener('change', (e) => { const row = e.target.closest('.item-row'); if (row && e.target.matches('.qty')) sync(row, true); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.qty-btn');
    if (!b) return;
    const row = b.closest('.item-row'), inp = row.querySelector('.qty');
    inp.value = String(Math.max(1, (parseInt(inp.value, 10) || 1) + Number(b.dataset.d)));
    sync(row, true);
  });
}

/** Typisches Item einer Kategorie, dessen Spielsymbol es gibt (bevorzugte Liste, sonst das teuerste verkaufte mit Symbol). */
function catRep(c, items) {
  const pool = items.filter((i) => i.category === c);
  for (const d of vb.CAT_REP[c] || []) if (pool.some((i) => i.defName === d) && hasStaticPic('t_' + d)) return d;
  const withPic = pool.filter((i) => hasStaticPic('t_' + i.defName)).sort((a, b) => b.price - a.price);
  return withPic[0]?.defName || '';
}

/** Kachel: Spielsymbol (nur mit Live-Mod, sonst Symbol der Art), Name, Preis-Plakette. */
function itemTile(i) {
  const emo = vb.catIcon(i.category);
  return `<button type="button" class="it-tile${i.available ? '' : ' off'}" data-item="${esc(i.defName)}" aria-expanded="false" title="${esc(i.name)}${i.available ? '' : ' – gerade nicht im Store'}">
    <span class="it-ico" data-pickey="t_${esc(i.defName)}" data-pcls="it-img" data-psize="56"><i class="it-emo" aria-hidden="true">${emo}</i></span>
    <span class="it-name">${esc(i.name)}</span>
    <span class="it-price">${vb.coin(i.price)}</span>
  </button>`;
}

/** Symbole einsetzen: data/icons/t_<DefName>.png, sonst Live-Mod /api/img, sonst bleibt das Symbol der Art (siehe pics.js). */
function fillIcons(host) { fillPics(host); }

export function itemsView(data) {
  setIcons(data.icons);
  const items = data.items;
  const sold = items.filter((i) => i.available);
  const cats = countBy(sold, (i) => i.category);
  const mods = countBy(sold, (i) => i.mod);
  const catList = [...cats.keys()].sort((a, b) => (cats.get(b) - cats.get(a)) || a.localeCompare(b, 'de'));
  const html = `
    <details class="help-box">
      <summary>So kaufst du ein Item</summary>
      <ul>
        <li>Wähle die <strong>Menge</strong>, tippe auf den Befehl-Knopf (z. B. <code>!buy steel 100</code>) und füge ihn im Chat ein. Du kannst auch einfach selbst tippen: <code>!buy medicine 5</code>.</li>
        <li>Bei Waffen und Kleidung sind Qualität und Material optional, z. B. <code>!buy &lt;Item&gt; excellent</code>. Qualitäten: awful, poor, normal, good, excellent, masterwork, legendary. Namen mit mehreren Wörtern schreibst du zusammen, ohne Leerzeichen.</li>
        <li><code>!use</code> benutzt es sofort, <code>!equip</code> rüstet es aus, <code>!wear</code> zieht es an. Das geht nur bei Items mit der passenden Markierung.</li>
        <li>Den genauen Preis für deine Wunschkombination zeigt <code>!pricecheck Steel</code>.</li>
      </ul>
    </details>
    <div class="toolbar">
      <input class="search" type="search" id="i-search" placeholder="Item suchen …" autocomplete="off" enterkeyhint="search">
      ${filterPanel(`
      <div class="filters-row">
        <select class="select" id="i-mod" aria-label="Herkunft">${options(uniqSorted([...mods.keys()]), mods, 'Alle Herkünfte')}</select>
        <select class="select" id="i-sort" aria-label="Sortierung">
          <option value="name">Name A–Z</option><option value="price-asc">Preis ↑</option><option value="price-desc">Preis ↓</option>
        </select>
      </div>
      <div class="filters-row">
        <button type="button" class="chip-btn" data-flag="usable" aria-pressed="false">benutzbar</button>
        <button type="button" class="chip-btn" data-flag="equippable" aria-pressed="false">ausrüstbar</button>
        <button type="button" class="chip-btn" data-flag="wearable" aria-pressed="false">anziehbar</button>
        <button type="button" class="chip-btn" data-flag="__all" aria-pressed="false" title="Auch Items zeigen, die der Streamer in RICS ausgeschaltet hat">auch nicht verkaufte</button>
      </div>`)}
    </div>
    <div class="cat-bar" id="i-cats" role="group" aria-label="Art des Items">
      <button type="button" class="cat-btn" data-cat="" aria-pressed="true" title="Alle"><span class="cb-i" aria-hidden="true">☰</span><span class="cb-l">Alle</span><b>${sold.length}</b></button>
      ${catList.map((c) => `<button type="button" class="cat-btn" data-cat="${esc(c)}" aria-pressed="false" title="${esc(c)}"><span class="cb-i" aria-hidden="true"${catRep(c, sold) ? ` data-pickey="t_${esc(catRep(c, sold))}" data-pcls="cb-img" data-psize="22"` : ''}>${vb.catIcon(c)}</span><span class="cb-l">${esc(c)}</span><b>${cats.get(c)}</b></button>`).join('')}
    </div>
    <div id="i-count" class="result-count"></div>
    <div id="i-hint"></div>
    <div id="i-list" class="grid it-grid"></div>`;

  function bind(root) {
    const $ = (s) => root.querySelector(s);
    const flags = new Set();
    let redraw, cat = '';
    const apply = () => {
      const q = norm($('#i-search').value), mod = $('#i-mod').value, sort = $('#i-sort').value;
      const m = makeMatcher(q);
      const showAll = flags.has('__all');
      const filterFlags = [...flags].filter((f) => f !== '__all');
      const matches = (i) => (!cat || i.category === cat) && (!mod || i.mod === mod) && filterFlags.every((f) => i[f]) &&
        (!q || m(`${i.name} ${i.defName} ${i.cmdName} ${i.category} ${i.mod}`));
      let list = items.filter((i) => (showAll || i.available) && matches(i));
      // Nichts gefunden, aber es gibt das Item im Spiel? Dann erklären, warum es fehlt.
      const hidden = !showAll && q ? items.filter((i) => !i.available && matches(i)) : [];
      $('#i-hint').innerHTML = hidden.length && list.length === 0
        ? `<div class="help-box"><strong>Gibt es im Spiel, wird aber gerade nicht verkauft:</strong> ${hidden.slice(0, 8).map((i) => esc(i.name)).join(', ')}${hidden.length > 8 ? ` und ${hidden.length - 8} weitere` : ''}.<br>Der Streamer hat sie in RICS ausgeschaltet.</div>`
        : hidden.length ? `<p class="small muted">Außerdem ${hidden.length} Treffer, die gerade nicht verkauft werden (Filter „auch nicht verkaufte“).</p>` : '';
      list.sort(sort === 'price-asc' ? (a, b) => a.price - b.price || a.name.localeCompare(b.name, 'de')
        : sort === 'price-desc' ? (a, b) => b.price - a.price || a.name.localeCompare(b.name, 'de')
          : (a, b) => a.name.localeCompare(b.name, 'de'));
      redraw = pager($('#i-list'), $('#i-count'), list, itemTile, 'Nichts gefunden. Probier einen anderen Suchbegriff oder Filter.');
      fillIcons($('#i-list'));
      fillIcons($('#i-cats'));   // Kategorie-Knöpfe: Spielsymbol eines typischen Items
    };
    // pager hängt Klick-Handler an; deshalb Liste bei jedem Filter neu aufbauen
    const rebuild = () => {
      const old = $('#i-list'); const fresh = old.cloneNode(false); old.replaceWith(fresh); apply();
    };
    takeQuery($('#i-search')); openPanels(root); bindQuantity(root);
    // Spielsymbole nachladen, sobald die Live-Mod online ist; neue Kacheln („Mehr anzeigen“) bekommen ihre Symbole ebenfalls
    // #view bleibt zwischen Ansichten dieselbe: alte Beobachter/Handler vorher abbauen
    root._itObs?.disconnect(); root._itOff?.(); if (root._itClick) root.removeEventListener('click', root._itClick);
    root._itObs = new MutationObserver(() => { const l = root.querySelector('#i-list'); if (l) fillIcons(l); });
    root._itObs.observe(root, { childList: true, subtree: true });
    root._itOff = live.on('change', () => { const l = root.querySelector('#i-list'); if (l) fillIcons(l); });
    $('#i-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      cat = b.dataset.cat;
      root.querySelectorAll('#i-cats .cat-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      rebuild();
    });
    // Antippen einer Kachel klappt Menge/Befehl/Kaufen als Zeile unter der Kachelreihe auf
    root._itClick = (e) => {
      const t = e.target.closest('.it-tile'); if (!t) return;
      const host = $('#i-list');
      const open = host.querySelector('.item-detail');
      const same = open && open.dataset.for === t.dataset.item;
      if (open) { host.querySelector(`.it-tile[data-item="${CSS.escape(open.dataset.for)}"]`)?.setAttribute('aria-expanded', 'false'); open.remove(); }
      if (same) return;
      const it = items.find((x) => x.defName === t.dataset.item); if (!it) return;
      const tiles = [...host.querySelectorAll('.it-tile')];
      const cols = Math.max(1, getComputedStyle(host).gridTemplateColumns.split(' ').length);
      const idx = tiles.indexOf(t);
      const last = tiles[Math.min(tiles.length - 1, idx - (idx % cols) + cols - 1)];
      last.insertAdjacentHTML('afterend', itemRow(it));
      t.setAttribute('aria-expanded', 'true');
      host.querySelector('.item-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    root.addEventListener('click', root._itClick);
    $('#i-search').addEventListener('input', debounce(rebuild));
    ['#i-mod', '#i-sort'].forEach((s) => $(s).addEventListener('change', rebuild));
    root.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.flag; flags.has(f) ? flags.delete(f) : flags.add(f);
      b.setAttribute('aria-pressed', String(flags.has(f))); rebuild();
    }));
    apply();
  }
  return { html, bind };
}

// =====================================================================
// EVENTS & WETTER
// =====================================================================
function eventCard(e, cmdName) {
  const title = cap(plain(e.label));
  const de = e.de && norm(e.de) !== norm(title) ? `<div class="sub">${esc(e.de)}</div>` : '';
  const pause = e.cooldownDays > 0 ? vb.clock(`${e.cooldownDays} d`, `Pause: ${days(e.cooldownDays)} (Spieltage) warten, bevor es wieder geht`) : '';
  const type = e.type && e.type !== 'weather' && e.type !== 'misc' ? `<span class="chip accent">${esc(EVENT_TYPES[e.type] || '')}</span>` : '';
  let text = vb.stripModTail(e.text, e.mod);   // Mod-Name steht schon als Badge
  if (vb.looksEnglish(text)) text = '';        // englischer Mod-Text ohne Übersetzung: weglassen
  return `
    <article class="card ev-card kar-${vb.kar(e.karma).cls}">
      <div class="ev-top"><div><h3>${richCap(e.label)}</h3>${de}</div>${vb.karSym(e.karma)}</div>
      ${text ? `<p>${esc(text)}</p>` : ''}
      <div class="meta">${type}${e.mod !== 'RimWorld' ? `<span class="chip">${esc(e.mod)}</span>` : ''}${pause}</div>
      <div class="ev-top" style="align-items:center"><div class="cmd-row">${cmdBtn(`!${cmdName} ${e.cmdName || e.defName}`)}</div>${vb.coin(e.cost, 'big')}</div>
    </article>`;
}

/** Filter nach Wirkung: vier Symbol-Knöpfe mit Zähler (umbrechen statt aus dem Bild zu laufen). */
function karmaChips(idPrefix, list = []) {
  const cnt = countBy(list, (e) => e.karma);
  return `<div class="filters-row kar-filter" id="${idPrefix}-karma" role="group" aria-label="Wirkung">
    <button type="button" class="chip-btn kar-btn" data-k="" aria-pressed="true" title="Alle"><span class="kb-sym" aria-hidden="true">☰</span><b>${list.length}</b></button>
    ${['Good', 'Neutral', 'Bad', 'Doom'].map((k) => `<button type="button" class="chip-btn kar-btn k-${vb.kar(k).cls}" data-k="${k}" aria-pressed="false" title="${esc(vb.kar(k).label)} – ${esc(vb.kar(k).hint)}" aria-label="${esc(vb.kar(k).label)}: ${cnt.get(k) || 0}"><span class="kb-sym" aria-hidden="true">${vb.kar(k).sym}</span><b>${cnt.get(k) || 0}</b></button>`).join('')}
  </div>`;
}

export function eventsView(data) {
  const ev = data.events;
  const mods = countBy(ev, (e) => e.mod);
  const types = countBy(ev, (e) => e.type);
  const html = `
    <details class="help-box">
      <summary>So funktionieren Events</summary>
      <ul>
        <li>Tippe auf den Befehl-Knopf (z. B. <code>!event aurora</code>), füge ihn im Chat ein – das Event passiert im Spiel, und die Coins werden abgezogen.</li>
        <li><strong>Gut</strong> belohnt dein Karma, <strong>Schlecht</strong> und <strong>Katastrophe</strong> kosten Karma. Katastrophen sind sehr gefährlich und teuer.</li>
        <li><strong>Pause</strong> heißt: Danach muss ein paar Spieltage gewartet werden, bevor dasselbe Event wieder geht (falls der Streamer das eingeschaltet hat).</li>
        <li>Alle Events auf einmal im Chat: <code>!event list</code>. Etwas Bestimmtes suchen: <code>!lookup event raid</code>.</li>
      </ul>
    </details>
    <div class="toolbar">
      <input class="search" type="search" id="e-search" placeholder="Event suchen …" autocomplete="off" enterkeyhint="search">
      ${karmaChips('e', ev)}
      ${filterPanel(`<div class="filters-row">
        <select class="select" id="e-type" aria-label="Art">${`<option value="">Alle Arten</option>` + Object.entries(EVENT_TYPES).filter(([k]) => types.has(k)).map(([k, v]) => `<option value="${k}">${esc(v)} (${types.get(k)})</option>`).join('')}</select>
        <select class="select" id="e-mod" aria-label="Herkunft">${options(uniqSorted([...mods.keys()]), mods, 'Alle Herkünfte')}</select>
        <select class="select" id="e-sort" aria-label="Sortierung"><option value="price-asc">Preis ↑</option><option value="price-desc">Preis ↓</option><option value="name">Name A–Z</option></select>
      </div>`, 'Art, Herkunft & Sortierung')}
    </div>
    <div id="e-count" class="result-count"></div>
    <div id="e-list" class="grid cols-2"></div>`;

  function bind(root) {
    const $ = (s) => root.querySelector(s);
    let karma = '';
    const apply = () => {
      const q = norm($('#e-search').value), type = $('#e-type').value, mod = $('#e-mod').value, sort = $('#e-sort').value;
      const list = ev.filter((e) => (!karma || e.karma === karma) && (!type || e.type === type) && (!mod || e.mod === mod) &&
        (!q || norm(`${e.label} ${e.de} ${e.defName} ${e.text} ${e.mod}`).includes(q)));
      list.sort(sort === 'name' ? (a, b) => plain(a.label).localeCompare(plain(b.label), 'de')
        : sort === 'price-desc' ? (a, b) => b.cost - a.cost || plain(a.label).localeCompare(plain(b.label), 'de')
          : (a, b) => a.cost - b.cost || plain(a.label).localeCompare(plain(b.label), 'de'));
      pager($('#e-list'), $('#e-count'), list, (e) => eventCard(e, 'event'), 'Nichts gefunden. Probier einen anderen Suchbegriff oder Filter.');
    };
    const rebuild = () => { const o = $('#e-list'); const f = o.cloneNode(false); o.replaceWith(f); apply(); };
    takeQuery($('#e-search')); openPanels(root);
    $('#e-search').addEventListener('input', debounce(rebuild));
    ['#e-type', '#e-mod', '#e-sort'].forEach((s) => $(s).addEventListener('change', rebuild));
    $('#e-karma').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      karma = b.dataset.k;
      root.querySelectorAll('#e-karma .chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      rebuild();
    });
    apply();
  }
  return { html, bind };
}

export function weatherView(data) {
  const w = data.weather;
  const mods = countBy(w, (e) => e.mod);
  const html = `
    <details class="help-box">
      <summary>So änderst du das Wetter</summary>
      <ul><li>Tippe auf den Befehl-Knopf (z. B. <code>!weather rain</code>) und füge ihn im Chat ein. Das Wetter wechselt, die Coins werden abgezogen.</li>
      <li>Teile des Namens reichen: „rain“ findet auch „foggy rain“. Gefährliche Wetterlagen sind als „Schlecht“ oder „Katastrophe“ markiert.</li></ul>
    </details>
    <div class="toolbar">
      <input class="search" type="search" id="w-search" placeholder="Wetter suchen …" autocomplete="off" enterkeyhint="search">
      ${karmaChips('w', w)}
      <div class="filters-row"><select class="select" id="w-mod" aria-label="Herkunft">${options(uniqSorted([...mods.keys()]), mods, 'Alle Herkünfte')}</select></div>
    </div>
    <div id="w-count" class="result-count"></div>
    <div id="w-list" class="grid cols-2"></div>`;
  function bind(root) {
    const $ = (s) => root.querySelector(s);
    let karma = '';
    const apply = () => {
      const q = norm($('#w-search').value), mod = $('#w-mod').value;
      const list = w.filter((e) => (!karma || e.karma === karma) && (!mod || e.mod === mod) && (!q || norm(`${e.label} ${e.defName} ${e.text}`).includes(q)))
        .sort((a, b) => a.cost - b.cost || plain(a.label).localeCompare(plain(b.label), 'de'));
      pager($('#w-list'), $('#w-count'), list, (e) => eventCard({ ...e, type: 'weather', cooldownDays: 0, de: '' }, 'weather'), 'Nichts gefunden.');
    };
    const rebuild = () => { const o = $('#w-list'); const f = o.cloneNode(false); o.replaceWith(f); apply(); };
    takeQuery($('#w-search'));
    $('#w-search').addEventListener('input', debounce(rebuild));
    $('#w-mod').addEventListener('change', rebuild);
    $('#w-karma').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      karma = b.dataset.k;
      root.querySelectorAll('#w-karma .chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      rebuild();
    });
    apply();
  }
  return { html, bind };
}

// =====================================================================
// TRAITS
// =====================================================================
function traitCard(t) {
  const tone = t.tone || vb.traitTone(t);
  const stats = t.stats.length ? `<div><div class="small muted">Wirkung</div><ul style="margin:4px 0 0;padding-left:18px">${t.stats.map((s) => `<li>${rich(s)}</li>`).join('')}</ul></div>` : '';
  const conf = t.conflicts.length ? `<div class="small muted">Verträgt sich nicht mit: ${t.conflicts.map((c) => rich(c)).join(', ')}</div>` : '';
  const slugName = slug(t.name) || slug(t.defName);
  const price = (ok, v) => (ok ? vb.coin(v) : '<span class="muted" title="nicht möglich">–</span>');
  return `
    <article class="card ev-card tr-card tone-${tone}${t.legacy ? ' legacy' : ''}">
      <div class="ev-top"><h3><span class="tr-sym" role="img" aria-label="${esc(vb.TRAIT_LABEL[tone])}" title="${esc(vb.TRAIT_LABEL[tone])}">${vb.TRAIT_SYM[tone]}</span> ${rich(t.name)}</h3>${t.mod !== 'RimWorld' ? `<span class="chip">${esc(t.mod)}</span>` : ''}${t.legacy ? '<span class="chip" title="Aus einer früheren Mod-Version – wird beim ersten Laden umgewandelt">veraltet</span>' : ''}</div>
      <div class="rt small"><p>${rich(t.description)}</p></div>
      ${stats}${conf}
      <div class="kv tr-prices">
        <span title="Hinzufügen">＋ ${price(t.canAdd, t.addPrice)}</span>
        <span title="Entfernen">－ ${price(t.canRemove, t.removePrice)}</span>
      </div>
      <div class="cmd-row">${t.canAdd ? cmdBtn('!addtrait ' + slugName) : ''}${t.canRemove ? cmdBtn('!removetrait ' + slugName) : ''}</div>
    </article>`;
}

export function traitsView(data) {
  const tr = data.traits;
  tr.forEach((t) => { t.tone = vb.traitTone(t); t.legacy = vb.traitLegacy(t); });
  const html = `
    <details class="help-box">
      <summary>So änderst du die Eigenschaften deines Pawns</summary>
      <ul>
        <li><code>!addtrait Name</code> fügt eine hinzu, <code>!removetrait Name</code> entfernt eine, <code>!replacetrait alt neu</code> tauscht.</li>
        <li>Ein Pawn kann nur eine begrenzte Anzahl haben, und manche Eigenschaften schließen einander aus (steht in der Karte).</li>
        <li>Mehr zu einer Eigenschaft: <code>!trait Name</code>.</li>
      </ul>
    </details>
    <div class="toolbar">
      <input class="search" type="search" id="t-search" placeholder="Eigenschaft suchen …" autocomplete="off" enterkeyhint="search">
      <div class="filters-row kar-filter" id="t-tone" role="group" aria-label="Wirkung">
        <button type="button" class="chip-btn kar-btn" data-tone="" aria-pressed="true" title="Alle"><span class="kb-sym" aria-hidden="true">☰</span><b>${tr.length}</b></button>
        ${['good', 'neutral', 'bad'].map((k) => `<button type="button" class="chip-btn kar-btn k-${k}" data-tone="${k}" aria-pressed="false" title="${esc(vb.TRAIT_LABEL[k])}" aria-label="${esc(vb.TRAIT_LABEL[k])}"><span class="kb-sym" aria-hidden="true">${vb.TRAIT_SYM[k]}</span><b>${tr.filter((t) => t.tone === k).length}</b></button>`).join('')}
      </div>
      <div class="filters-row">
        <button type="button" class="chip-btn" data-f="canAdd" aria-pressed="false">kann man hinzufügen</button>
        <button type="button" class="chip-btn" data-f="canRemove" aria-pressed="false">kann man entfernen</button>
        <select class="select" id="t-sort" aria-label="Sortierung"><option value="name">Name A–Z</option><option value="add">Preis hinzufügen ↑</option><option value="remove">Preis entfernen ↑</option></select>
      </div>
    </div>
    <div id="t-count" class="result-count"></div>
    <div id="t-list" class="grid cols-2"></div>`;
  function bind(root) {
    const $ = (s) => root.querySelector(s);
    const flags = new Set();
    let tone = '';
    const apply = () => {
      const q = norm($('#t-search').value), sort = $('#t-sort').value;
      const list = tr.filter((t) => (!tone || t.tone === tone) && [...flags].every((f) => t[f]) && (!q || norm(`${t.name} ${t.defName} ${t.description} ${t.stats.join(' ')}`).includes(q)));
      list.sort(sort === 'add' ? (a, b) => (a.canAdd ? a.addPrice : 1e12) - (b.canAdd ? b.addPrice : 1e12)
        : sort === 'remove' ? (a, b) => (a.canRemove ? a.removePrice : 1e12) - (b.canRemove ? b.removePrice : 1e12)
          : (a, b) => plain(a.name).localeCompare(plain(b.name), 'de'));
      // veraltete/abgelegte Eigenschaften ans Ende (Reihenfolge sonst unverändert)
      const sorted = [...list.filter((t) => !t.legacy), ...list.filter((t) => t.legacy)];
      pager($('#t-list'), $('#t-count'), sorted, traitCard, 'Nichts gefunden.');
    };
    const rebuild = () => { const o = $('#t-list'); const f = o.cloneNode(false); o.replaceWith(f); apply(); };
    takeQuery($('#t-search'));
    $('#t-search').addEventListener('input', debounce(rebuild));
    $('#t-sort').addEventListener('change', rebuild);
    $('#t-tone').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tone]'); if (!b) return;
      tone = b.dataset.tone;
      root.querySelectorAll('#t-tone .chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      rebuild();
    });
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.f; flags.has(f) ? flags.delete(f) : flags.add(f);
      b.setAttribute('aria-pressed', String(flags.has(f))); rebuild();
    }));
    apply();
  }
  return { html, bind };
}

// =====================================================================
// RASSEN
// =====================================================================
export function racesView(data) {
  setIcons(data.icons);
  const html = `
    <details class="help-box">
      <summary>So kommst du an einen Pawn</summary>
      <ul>
        <li>Der Einstieg ist <code>!join</code> (Warteschlange). Nur falls dir im Chat ein Pawn angeboten wird, bestätigst du mit <code>!acceptpawn</code>.</li>
        <li>Je nach Einstellung des Streamers kannst du auch selbst wählen: <code>!pawn Rasse Xenotyp</code>, z. B. <code>!pawn human hussar</code>. Hier siehst du, was die Rassen kosten.</li>
        <li>Zusätzlich kannst du Geschlecht (<code>male</code>/<code>female</code>) und Alter angeben: <code>!pawn human genie female 25</code>.</li>
        <li>Pro Zuschauer gibt es einen Pawn. Xenotypen brauchen das Biotech-DLC.</li>
      </ul>
    </details>
    <p class="intro"><strong>Tippe auf eine Kachel</strong> – du siehst die Beschreibung und den passenden Befehl zum Kopieren.</p>
    ${data.races.length > 1 ? `<div class="rc-filter" id="rc-filter" role="group" aria-label="Rasse wählen"><button type="button" class="chip-btn" aria-pressed="true" data-race="">Alle</button>${data.races.map((r) => `<button type="button" class="chip-btn" aria-pressed="false" data-race="${esc(r.key)}">${esc(r.name)}</button>`).join('')}</div>` : ''}
    <div id="r-list">
      ${data.races.length ? data.races.map((r) => raceSection(r)).join('') : '<div class="empty">Keine Rassen freigeschaltet.</div>'}
    </div>`;
  function bind(root) {
    const list = root.querySelector('#r-list');
    if (!list) return;
    fillPics(list);
    list.addEventListener('click', (ev) => {
      const b = ev.target.closest('.rc-btn');
      if (!b) return;
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      b.parentElement.querySelector('.rc-detail').hidden = !open;
    });
    const f = root.querySelector('#rc-filter');
    f?.addEventListener('click', (ev) => {
      const c = ev.target.closest('[data-race]');
      if (!c) return;
      f.querySelectorAll('.chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      list.querySelectorAll('.rc-sec').forEach((sec) => { sec.hidden = !!c.dataset.race && sec.dataset.race !== c.dataset.race; });
    });
    // Live-Mod geht später online: Bilder nachladen
    root._rcOff?.(); root._rcOff = live.on('change', () => { if (root.contains(list)) fillPics(list); });
  }
  return { html, bind };
}

/** Eine Kachel: großes Bild (Datei → Live-Mod → Buchstabe), Name, Preis oder „aus“; Antippen klappt Beschreibung + Befehl auf. */
function raceTile({ key, name, desc, price, on, cmd, extra }) {
  const ph = `<i class="rc-ph" style="--h:${hue(name)}" aria-hidden="true">${esc([...name][0] || '?')}</i>`;
  return `<article class="rc-tile${on ? '' : ' off'}">
    <button type="button" class="rc-btn" aria-expanded="false" title="${esc(name)}">
      <span class="rc-pic" data-pickey="${esc(key)}" data-pcls="rc-img" data-psize="96">${ph}</span>
      <span class="rc-name">${esc(name)}</span>
      <span class="rc-price">${on ? vb.coin(price) : '<span class="rc-badge">aus</span>'}</span>
    </button>
    <div class="rc-detail" hidden>
      ${desc ? `<p class="rc-desc">${esc(desc)}</p>` : ''}
      ${extra || ''}
      ${on ? cmdBtn(cmd) : '<p class="small muted">Gerade nicht im Store.</p>'}
    </div>
  </article>`;
}

function raceSection(r) {
  const rk = slug(r.key);
  const g = [r.male ? '♂' : '', r.female ? '♀' : '', r.other ? '⚧' : ''].filter(Boolean).join(' ');
  const meta = `<span class="kv race-kv"><span title="Alter">⏳ <b>${r.minAge}–${r.maxAge ?? '∞'}</b></span>${g ? `<span title="Geschlecht"><b>${g}</b></span>` : ''}</span>`;
  const tiles = [];
  // Nicht-menschliche Rassen bekommen eine eigene Kachel; beim Menschen ist jeder Xenotyp eine Kachel (Mensch = nur Überschrift)
  if (r.key !== 'Human') tiles.push(raceTile({ key: 'r_' + r.key, name: r.name, desc: r.desc, price: r.price, on: true, cmd: `!pawn ${rk}`, extra: meta }));
  r.xenosAll.forEach((x) => tiles.push(raceTile({ key: 'x_' + x.def, name: x.name, desc: x.desc, price: x.price, on: x.on, cmd: `!pawn ${rk} ${slug(x.def)}` })));
  return `<section class="rc-sec" data-race="${esc(r.key)}"><h3 class="rc-group">${esc(r.name)} ${meta}</h3><div class="rc-grid">${tiles.join('')}</div></section>`;
}

// =====================================================================
// MODS
// =====================================================================
export function modsView(data) {
  const html = `
    <p class="intro">Diese Mods sind im Spiel aktiv (<strong>${fmt(data.mods.length)}</strong>). Items, Events und Eigenschaften stammen oft aus ihnen.</p>
    <div class="toolbar"><input class="search" type="search" id="m-search" placeholder="Mod suchen …" autocomplete="off" enterkeyhint="search"></div>
    <div id="m-count" class="result-count"></div>
    <div id="m-list" class="grid cols-2"></div>`;
  function bind(root) {
    const $ = (s) => root.querySelector(s);
    const apply = () => {
      const q = norm($('#m-search').value);
      const list = data.mods.filter((m) => !q || norm(`${m.name} ${m.author}`).includes(q));
      pager($('#m-list'), $('#m-count'), list, (m) => `
        <article class="card" style="padding:12px 14px">
          <h3 style="font-size:1rem;overflow-wrap:anywhere">${esc(m.name)}</h3>
          <div class="meta">${m.author ? `<span class="chip">von ${esc(m.author)}</span>` : ''}${m.version ? `<span class="chip">${esc(m.version)}</span>` : ''}</div>
          ${m.steamId ? `<p style="margin:8px 0 0"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${esc(m.steamId)}" target="_blank" rel="noopener">Im Steam Workshop ansehen ↗</a></p>` : ''}
        </article>`, 'Nichts gefunden.');
    };
    const rebuild = () => { const o = $('#m-list'); const f = o.cloneNode(false); o.replaceWith(f); apply(); };
    $('#m-search').addEventListener('input', debounce(rebuild));
    apply();
  }
  return { html, bind };
}
