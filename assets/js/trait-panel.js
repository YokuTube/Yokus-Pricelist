// Eigenschaften ändern in wenigen Klicks (Reiter „Traits“): eigene Eigenschaften (aus /api/me), alle kaufbaren mit Suche,
// Auswahl baut !addtrait / !removetrait / !replacetrait zusammen. Ausführen übernimmt der „Sofort ausführen“-Knopf
// (live-views.js markBuyable → live.act, nur erlaubte Befehle). Ohne Live-Mod/Verknüpfung bleibt nur Kopieren auf den Karten.
// Fremdtext (Namen/Beschreibungen aus der Mod) läuft ausschließlich durch esc().
import { esc as escRaw, plain, slug, fmt, cmdBtn, debounce } from './util.js';
import * as live from './live.js';
import * as vb from './visual-b.js';
import { fillAll as fillPics } from './pics.js';

/** Eigenschaften, die jeder Kolonist hat (Mod-Grundausstattung) – auf der Seite nichtssagend, deshalb ausgeblendet (Nutzerwunsch 2026-10-24). */
export const HIDDEN_TRAITS = new Set(['PE_FirearmProficiency']);

const esc = (s) => escRaw(live.stripTags(s));
const PAGE = 60;
const keyOf = (def, degree) => `${def}:${Number(degree) || 0}`;

export function traitPanel(data) {
  const catalog = data.traits;
  const byKey = new Map(catalog.map((t) => [keyOf(t.defName, t.degree), t]));
  const byName = new Map(catalog.map((t) => [slug(t.name), t]));
  const toneOf = (t) => (t ? t.tone || vb.traitTone(t) : 'neutral');

  /** Eigene Eigenschaft (aus der Mod) → Eintrag im Katalog (über def/degree, sonst über den Namen). */
  const own = () => {
    const pawn = live.getMe()?.pawn;
    return (pawn?.traits || []).filter((t) => !HIDDEN_TRAITS.has(t.def)).map((t) => {
      const label = plain(live.stripTags(t.label));
      const cat = (t.def && byKey.get(keyOf(t.def, t.degree))) || byName.get(slug(label)) || null;
      return { key: t.def ? keyOf(t.def, t.degree) : 'n:' + slug(label), label, desc: t.desc, def: t.def || cat?.defName || '', degree: t.degree ?? cat?.degree ?? 0, cat };
    });
  };

  const html = '<section class="card tp" id="tp" hidden></section>';

  function bind(root) {
    const host = root.querySelector('#tp');
    if (!host) return;
    root._tpOff?.();
    let mode = '';                       // 'off' | 'nolink' | 'load' | 'nopawn' | 'full'
    let selOwn = null, selAdd = null;    // gewählte eigene bzw. neue Eigenschaft (Schlüssel)
    let q = '', tone = '', shown = PAGE;
    let ownKey = '', build = null;

    const price = (o, a) => (o ? o.cat.removePrice : 0) + (a ? a.addPrice : 0);

    function ownHtml(list) {
      if (!list.length) return '<p class="small muted">Dein Kolonist hat gerade keine (sichtbaren) Eigenschaften.</p>';
      return list.map((t) => {
        const ok = !!t.cat?.canRemove;
        const tn = toneOf(t.cat);
        return `<button type="button" class="tp-chip tone-${tn}${ok ? '' : ' fixed'}" data-own="${esc(t.key)}" aria-pressed="${selOwn === t.key}"${ok ? '' : ' disabled'}
          title="${esc(t.desc || '')}${ok ? '' : ' – kann man nicht kaufen/entfernen'}">
          <span class="tr-sym" data-pickey="tr_${esc(t.def)}_${Number(t.degree) || 0}" data-pcls="tr-img sm" data-psize="28">${vb.TRAIT_SYM[tn]}</span>
          <span class="tp-name">${esc(t.label)}</span>${ok ? `<span class="tp-pr">−${fmt(t.cat.removePrice)}</span>` : ''}</button>`;
      }).join('');
    }

    function availList(ownKeys) {
      const m = q.length >= 1 ? q.toLowerCase() : '';
      return catalog.filter((t) => t.canAdd && t.addPrice > 0 && !t.legacy && !ownKeys.has(keyOf(t.defName, t.degree))
        && (!tone || toneOf(t) === tone)
        && (!m || plain(`${t.name} ${t.defName}`).toLowerCase().includes(m)))
        .sort((a, b) => plain(a.name).localeCompare(plain(b.name), 'de'));
    }

    function availHtml(ownKeys) {
      const all = availList(ownKeys);
      const part = all.slice(0, shown);
      const rows = part.map((t) => {
        const tn = toneOf(t), k = keyOf(t.defName, t.degree);
        return `<button type="button" class="tp-chip tone-${tn}" data-add="${esc(k)}" aria-pressed="${selAdd === k}" title="${esc(plain(t.description).slice(0, 220))}${t.conflicts.length ? ' – verträgt sich nicht mit: ' + esc(t.conflicts.map(plain).join(', ')) : ''}">
          <span class="tr-sym" data-pickey="tr_${esc(t.defName)}_${t.degree}" data-pcls="tr-img sm" data-psize="28">${vb.TRAIT_SYM[tn]}</span>
          <span class="tp-name">${esc(plain(t.name))}</span><span class="tp-pr">+${fmt(t.addPrice)}</span></button>`;
      }).join('');
      const more = all.length > part.length ? `<button type="button" class="chip-btn" data-more>${all.length - part.length} weitere anzeigen</button>` : '';
      return (rows || '<p class="small muted">Nichts gefunden.</p>') + more;
    }

    function buildHtml(list) {
      const o = selOwn ? list.find((t) => t.key === selOwn) : null;
      const a = selAdd ? byKey.get(selAdd) : null;
      if (!o && !a) {
        build = null;
        return '<p class="small muted tp-hint">Tippe eine deiner Eigenschaften an (entfernen), eine verfügbare (hinzufügen) – oder beide (tauschen). Der Befehl baut sich von selbst zusammen.</p>';
      }
      const pre = live.prefix();
      const nm = (t) => slug(t.name) || slug(t.defName);
      let cmd, what;
      if (o && a) { cmd = `${pre}replacetrait ${nm(o.cat)} ${nm(a)}`; what = `<b>${esc(o.label)}</b> wird gegen <b>${esc(plain(a.name))}</b> getauscht`; }
      else if (o) { cmd = `${pre}removetrait ${nm(o.cat)}`; what = `<b>${esc(o.label)}</b> wird entfernt`; }
      else { cmd = `${pre}addtrait ${nm(a)}`; what = `<b>${esc(plain(a.name))}</b> wird hinzugefügt`; }
      const total = price(o, a);
      const parts = [o ? `entfernen ${fmt(o.cat.removePrice)}` : '', a ? `hinzufügen ${fmt(a.addPrice)}` : ''].filter(Boolean).join(' + ');
      build = cmd;
      return `<div class="tp-what">${what}</div>
        <div class="tp-total">Gesamt ca. <span class="coin"></span><b>${fmt(total)}</b> <span class="small muted">(${parts}; den genauen Preis rechnet RICS beim Ausführen)</span></div>
        <div class="cmd-row">${cmdBtn(cmd)}<button type="button" class="chip-btn" data-clear>Auswahl löschen</button></div>`;
    }

    function skeleton() {
      host.innerHTML = `<h2 class="tp-h">Deine Eigenschaften</h2>
        <div class="traits tp-own" id="tp-own"></div>
        <div class="tp-buildbox" id="tp-build" aria-live="polite"></div>
        <h3 class="tp-h2">Verfügbar</h3>
        <div class="tp-tools"><input class="search" type="search" id="tp-q" placeholder="Eigenschaft suchen …" autocomplete="off" enterkeyhint="search" value="${esc(q)}">
          <div class="filters-row" id="tp-tone" role="group" aria-label="Wirkung">${[['', '☰'], ['good', vb.TRAIT_SYM.good], ['neutral', vb.TRAIT_SYM.neutral], ['bad', vb.TRAIT_SYM.bad]].map(([k, sym]) =>
    `<button type="button" class="chip-btn" data-tone="${k}" aria-pressed="${tone === k}" title="${esc(k ? vb.TRAIT_LABEL[k] : 'Alle')}">${sym}</button>`).join('')}</div></div>
        <div class="traits tp-avail" id="tp-avail"></div>`;
      ownKey = '';
    }

    function fill() {
      const list = own();
      const ownKeys = new Set(list.map((t) => keyOf(t.def, t.degree)));
      // Auswahl verwerfen, wenn sie nicht mehr stimmt (nach einem Kauf)
      if (selOwn && !list.some((t) => t.key === selOwn)) selOwn = null;
      if (selAdd && ownKeys.has(selAdd)) selAdd = null;
      const $ = (s) => host.querySelector(s);
      $('#tp-own').innerHTML = ownHtml(list);
      $('#tp-avail').innerHTML = availHtml(ownKeys);
      $('#tp-build').innerHTML = buildHtml(list);
      fillPics(host);
    }

    function render(force) {
      let m;
      if (!live.isLive()) m = 'off';
      else if (!live.isLinked()) m = 'nolink';
      else if (!live.getMe()) m = 'load';
      else if (!live.getMe().pawn) m = 'nopawn';
      else m = 'full';
      if (m === 'off') { host.hidden = true; mode = m; return; }
      host.hidden = false;
      if (m !== 'full') {
        if (m === mode) return;
        mode = m;
        host.innerHTML = m === 'nolink'
          ? `<h2 class="tp-h">Deine Eigenschaften</h2><p>Verbinde dich mit dem Spiel, dann siehst du hier die Eigenschaften deines Kolonisten und kannst sie mit ein paar Klicks ändern.</p><button type="button" class="btn primary" data-live="connect">Verbinden</button>`
          : m === 'load' ? '<h2 class="tp-h">Deine Eigenschaften</h2><p class="small muted">Lade deine Daten …</p>'
            : `<h2 class="tp-h">Deine Eigenschaften</h2><p>Du hast noch keinen Kolonisten. Schreib <code>${esc(live.prefix())}join</code> in den Chat.</p>`;
        return;
      }
      if (mode !== 'full') { mode = 'full'; skeleton(); force = true; }
      const key = JSON.stringify(own().map((t) => t.key)) + live.prefix();
      if (!force && key === ownKey) return;      // /api/me kommt jede Sekunde: nur bei Änderung neu zeichnen
      ownKey = key;
      fill();
    }

    host.addEventListener('click', (e) => {
      const o = e.target.closest('[data-own]'), a = e.target.closest('[data-add]');
      if (o) { selOwn = selOwn === o.dataset.own ? null : o.dataset.own; fill(); }
      else if (a) { selAdd = selAdd === a.dataset.add ? null : a.dataset.add; fill(); }
      else if (e.target.closest('[data-clear]')) { selOwn = selAdd = null; fill(); }
      else if (e.target.closest('[data-more]')) { shown += PAGE; fill(); }
      else if (e.target.closest('[data-tone]')) {
        tone = e.target.closest('[data-tone]').dataset.tone; shown = PAGE;
        host.querySelectorAll('#tp-tone .chip-btn').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tone === tone)));
        fill();
      }
    });
    host.addEventListener('input', debounce((e) => { if (e.target.id === 'tp-q') { q = e.target.value.trim(); shown = PAGE; fill(); } }, 120));

    const offs = [];
    const tick = () => { if (!host.isConnected) { offs.forEach((f) => f()); return; } render(false); };   // Ansicht gewechselt: abmelden
    offs.push(live.on('me', tick), live.on('change', tick));
    root._tpOff = () => offs.forEach((f) => f());
    render(true);
  }
  return { html, bind };
}
