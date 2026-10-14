// Wildshow-Ansicht (Show-Teil der Live-Seite, Baustein 4.8). Läuft nur, wenn die Mod RICS Live erreichbar ist UND
// ihr /api/show eine laufende Show meldet (Mod andreas.wildshow, Show-Modus). Sonst: nichts davon sichtbar, die Seite bleibt wie bisher.
// Alles Fremde (Namen, Zuschauer, Gespräche, Tagebuch) wird nur per textContent in die Seite gesetzt – nie innerHTML.
import * as live from './live.js';

const NS = 'http://www.w3.org/2000/svg';
const CLIQUE_COLORS = ['#e0a653', '#6fb7d6', '#b38fd9', '#8fbf7a', '#e07a6b', '#d6cf6f'];
const SUB_KEY = 'ys-show-sub';
const SUBS = [['buehne', 'Bühne'], ['netz', 'Netz'], ['feuer', 'Feuer'], ['zeit', 'Zeitleiste'], ['rat', 'Rat']];

// ---------- kleine DOM-Helfer (Text nur als Textknoten) ----------
function build(make, props, kids) {
  const e = make();
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.setAttribute('class', v);
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
}
const h = (tag, props, ...kids) => build(() => document.createElement(tag), props, kids);
const s = (tag, props, ...kids) => build(() => document.createElementNS(NS, tag), props, kids);
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

// ---------- Zustand ----------
let showData = null;          // letzte Antwort von /api/show (nur wenn active)
let active = false;
const listeners = new Set();
let probeStop = null;

export const isShowMode = () => active && live.isLive();
export const getShowData = () => showData;
export const onShowChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function setActive(v) {
  v = !!v;
  if (v === active) return;
  active = v;
  document.body.classList.toggle('show-mode', active && live.isLive());
  listeners.forEach((fn) => { try { fn(active); } catch (e) { console.warn('[show]', e); } });
}

/** Einmal beim Start: erkennt im Hintergrund, ob eine Show läuft. Ohne Live-Mod passiert nichts. */
export function initShow() {
  const start = () => {
    if (probeStop) { probeStop(); probeStop = null; }
    if (!live.isLive()) { showData = null; setActive(false); document.body.classList.remove('show-mode'); return; }
    probeStop = live.poll({
      path: '/api/show', every: 8000, alive: () => live.isLive(),
      onResult: (r) => {
        if (r.status === 200 && r.data && r.data.active) { if (!r.unchanged || !showData) showData = r.data; setActive(true); document.body.classList.add('show-mode'); }
        else if (r.status === 200 || r.status === 404) { showData = null; setActive(false); }
      },
    });
  };
  live.on('change', start);
  start();
}

// ---------- Hilfen ----------
const byId = (id) => (showData?.members || []).find((m) => m.id === id);
const nameOf = (id) => byId(id)?.name || colony.get(id)?.name || '?';
const colony = new Map();   // id -> PawnSummary (Stimmung, Zuschauername)
const cliqueColor = (nr) => (nr >= 0 ? CLIQUE_COLORS[nr % CLIQUE_COLORS.length] : null);
const moodTone = (p) => (p == null ? '' : p >= 60 ? 'good' : p < 35 ? 'bad' : '');
let openDiary = () => {};   // wird von bind() gesetzt

function avatar(id, size, extra = '') {
  const m = byId(id);
  const name = m?.name || colony.get(id)?.name || '?';
  const wrap = h('span', { class: 'sh-av ' + extra, style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px` });
  const ring = cliqueColor(m?.clique ?? -1);
  if (ring) wrap.style.boxShadow = `0 0 0 2px ${ring}`;
  const letter = h('span', { class: 'sh-av-l' }, (name.trim()[0] || '?').toUpperCase());
  const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: live.artUrl(id, 0) });
  img.addEventListener('error', () => img.remove());
  wrap.append(letter, img);
  return wrap;
}

function nameBtn(id, cls = '') {
  return h('button', { type: 'button', class: ('sh-name ' + cls).trim(), 'data-id': id, onclick: () => openDiary(id) }, nameOf(id));
}

function roleBadge(m) {
  const r = m.role;
  if (!r || !r.text) return h('span', { class: 'sh-role none' }, 'Keine Aufgabe');
  const d = r.done;
  const state = d == null ? 'open' : d >= 0.7 ? 'ok' : d < 0.35 ? 'no' : 'part';
  const sym = state === 'ok' ? '✓' : state === 'no' ? '✗' : state === 'part' ? '◐' : '·';
  const label = state === 'ok' ? 'erfüllt' : state === 'no' ? 'nicht erfüllt' : state === 'part' ? 'teilweise' : 'läuft';
  return h('span', { class: 'sh-role ' + state, title: `Heute: ${r.text} – ${label}` },
    h('span', { class: 'sh-role-sym' }, sym), h('span', { class: 'sh-role-t' }, r.text));
}

const MARKS = { scar: ['🩹', 'Narbe'], saboteur: ['🕵', 'Saboteur'], hoard: ['🎒', 'hortet'] };
function marks(m) {
  const arr = Array.isArray(m.marks) ? m.marks : [];
  const out = arr.filter((k) => MARKS[k]).map((k) => h('span', { class: 'sh-mark', title: MARKS[k][1] }, MARKS[k][0]));
  return out.length ? h('span', { class: 'sh-marks' }, out) : null;
}

// ---------- Bühne: Karten ----------
function card(m) {
  const c = colony.get(m.id);
  const mood = c?.moodPct;
  const ring = cliqueColor(m.clique);
  const viewer = c?.displayName || c?.user;
  return h('button', { type: 'button', class: 'sh-card' + (m.leader ? ' leader' : ''), 'data-id': m.id, onclick: () => openDiary(m.id), style: ring ? `--ring:${ring}` : '' },
    h('span', { class: 'sh-card-top' },
      avatar(m.id, 64),
      m.leader ? h('span', { class: 'sh-crown', title: 'Anführung' }, '👑') : null),
    h('span', { class: 'sh-card-name' }, m.name, marks(m)),
    viewer ? h('span', { class: 'sh-viewer', title: 'Gehört einem Zuschauer' }, '@' + viewer) : null,
    h('span', { class: 'sh-mood ' + moodTone(mood), title: mood == null ? '' : `Stimmung ${Math.round(mood)} %` },
      h('span', { class: 'sh-mood-bar', style: `width:${mood == null ? 0 : Math.max(4, Math.min(100, mood))}%` })),
    roleBadge(m),
    Array.isArray(m.psyche) && m.psyche.length
      ? h('span', { class: 'sh-chips' }, m.psyche.slice(0, 3).map((t) => h('span', { class: 'sh-chip' }, t))) : null);
}

function viewBuehne() {
  const d = showData;
  const ms = d.members || [];
  const talk = (d.talk || []).slice(-8).reverse();
  return h('div', { class: 'sh-stage' },
    ms.length ? h('div', { class: 'sh-grid' }, ms.map(card)) : h('div', { class: 'empty' }, 'Noch keine Teilnehmer.'),
    talk.length ? h('details', { class: 'sh-talk', open: true }, h('summary', {}, 'Zuletzt gesagt'),
      talk.map((t) => h('div', { class: 'sh-line' },
        avatar(t.from, 28), h('div', { class: 'sh-line-b' },
          h('div', { class: 'sh-line-h' }, nameBtn(t.from), t.to ? [h('span', { class: 'muted' }, ' → '), nameBtn(t.to)] : null),
          h('div', { class: 'sh-line-t' }, t.text || ''))))) : null);
}

// ---------- Beziehungsnetz ----------
function pairMap() {
  const m = new Map();
  for (const o of showData.opinions || []) m.set(o.a + '|' + o.b, o.v);
  return m;
}
function edgesOf(ids) {
  const pm = pairMap(), out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = pm.get(ids[i] + '|' + ids[j]) ?? 0, b = pm.get(ids[j] + '|' + ids[i]) ?? 0;
    const avg = (a + b) / 2;
    let kind = null;
    if (a >= 30 && b >= 30) kind = 'friend';
    else if (avg <= -30 || (a <= -30 && b <= -30)) kind = 'rival';
    else if (Math.abs(avg) >= 12) kind = avg > 0 ? 'warm' : 'cold';
    if (kind) out.push({ i, j, a, b, kind });
  }
  return out;
}
function netSvg(ids, pos, withLines, onEdge) {
  const svg = s('svg', { class: 'sh-svg', viewBox: '0 0 360 360', role: 'img', 'aria-label': 'Beziehungsnetz' });
  const g = s('g', {});
  svg.append(g);
  if (withLines) for (const e of edgesOf(ids)) {
    const p = pos[e.i], q = pos[e.j];
    const line = s('line', { class: 'sh-edge ' + e.kind, x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    line.append(s('title', {}, `${nameOf(ids[e.i])} → ${nameOf(ids[e.j])}: ${e.a} · zurück: ${e.b}`));
    line.addEventListener('click', () => onEdge && onEdge(e));
    g.append(line);
    // breite, unsichtbare Fläche zum Antippen am Handy
    const hit = s('line', { class: 'sh-edge-hit', x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    hit.addEventListener('click', () => onEdge && onEdge(e));
    g.append(hit);
  }
  return svg;
}
function ringPositions(n, r, cx = 180, cy = 180, start = -Math.PI / 2) {
  return Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(start + (i / Math.max(n, 1)) * Math.PI * 2), y: cy + r * Math.sin(start + (i / Math.max(n, 1)) * Math.PI * 2) }));
}
function nodesHtml(ids, pos, box) {
  // Figuren als HTML über der SVG (Bilder, Antippen); Position in Prozent => skaliert mit
  ids.forEach((id, i) => {
    const m = byId(id);
    const n = h('button', { type: 'button', class: 'sh-node' + (m?.leader ? ' leader' : ''), style: `left:${(pos[i].x / 360) * 100}%;top:${(pos[i].y / 360) * 100}%`, onclick: () => openDiary(id), 'aria-label': nameOf(id) },
      avatar(id, 44), m?.leader ? h('span', { class: 'sh-crown sm' }, '👑') : null, h('span', { class: 'sh-node-n' }, nameOf(id)), m ? marks(m) : null);
    box.append(n);
  });
}

function viewNetz() {
  const ids = (showData.members || []).map((m) => m.id);
  const pos = ringPositions(ids.length, 128);
  const cap = h('div', { class: 'sh-cap muted' }, 'Tippe auf eine Linie oder eine Person.');
  const box = h('div', { class: 'sh-netbox' });
  box.append(netSvg(ids, pos, true, (e) => {
    cap.textContent = `${nameOf(ids[e.i])} ↔ ${nameOf(ids[e.j])}: ${e.a} / ${e.b} – ${e.kind === 'friend' ? 'Freunde' : e.kind === 'rival' ? 'Rivalen' : e.kind === 'warm' ? 'mögen sich eher' : 'mögen sich eher nicht'}`;
  }));
  nodesHtml(ids, pos, box);
  const cl = showData.cliques || [];
  return h('div', { class: 'sh-net' }, box, cap,
    h('div', { class: 'sh-legend' },
      h('span', {}, h('i', { class: 'sh-key friend' }), 'Freunde'), h('span', {}, h('i', { class: 'sh-key rival' }), 'Rivalen'),
      h('span', {}, h('i', { class: 'sh-key warm' }), 'mögen sich'), h('span', {}, h('i', { class: 'sh-key cold' }), 'mögen sich nicht'), h('span', {}, '👑 Anführung')),
    cl.length ? h('div', { class: 'sh-cliques' }, cl.map((c) => h('div', { class: 'sh-clique', style: `--ring:${cliqueColor(c.nr)}` },
      h('span', { class: 'sh-clique-t' }, 'Gruppe ' + (c.nr + 1)), (c.members || []).map((id) => avatar(id, 30))))) : h('div', { class: 'muted small' }, 'Noch keine festen Gruppen.'));
}

// ---------- Feuerabend ----------
let threadTimer = null;
function viewFeuer() {
  const f = showData.feuerabend || {};
  const all = (showData.members || []).map((m) => m.id);
  const seated = f.running ? (f.seated || []).filter((id) => all.includes(id)) : [];
  const away = all.filter((id) => !seated.includes(id));
  const root = h('div', { class: 'sh-fire' + (f.running ? ' on' : '') });
  const stage = h('div', { class: 'sh-fire-stage' });
  const pos = ringPositions(seated.length, 78, 180, 190, Math.PI * 0.75);
  stage.append(s('svg', { class: 'sh-svg', viewBox: '0 0 360 360', 'aria-hidden': 'true' }));
  stage.append(h('div', { class: 'sh-flame', 'aria-label': f.running ? 'Lagerfeuer' : 'erloschenes Feuer' }, f.running ? '🔥' : '🪵'));
  const withLines = h('input', { type: 'checkbox', id: 'sh-lines' });
  const drawLines = () => {
    const old = stage.querySelector('svg'); if (!old) return;
    const nsvg = netSvg(seated, pos, withLines.checked, null);
    stage.replaceChild(nsvg, old);
  };
  seated.forEach((id, i) => {
    stage.append(h('button', { type: 'button', class: 'sh-node sit', style: `left:${(pos[i].x / 360) * 100}%;top:${(pos[i].y / 360) * 100}%`, onclick: () => openDiary(id), 'data-id': id },
      avatar(id, 44), h('span', { class: 'sh-node-n' }, nameOf(id))));
  });
  const outer = ringPositions(away.length, 150, 180, 190, Math.PI * 0.2);
  away.forEach((id, i) => {
    const m = byId(id);
    stage.append(h('button', { type: 'button', class: 'sh-node away', style: `left:${(outer[i].x / 360) * 100}%;top:${(Math.min(340, Math.max(24, outer[i].y)) / 360) * 100}%`, onclick: () => openDiary(id), 'data-id': id, title: 'nicht am Feuer' },
      avatar(id, 34), h('span', { class: 'sh-node-n' }, nameOf(id)), m ? null : null));
  });
  const bubble = h('div', { class: 'sh-bubble', hidden: true });
  stage.append(bubble);
  root.append(
    f.running ? h('div', { class: 'sh-topic' }, f.topic ? h('span', {}, '„' + f.topic + '“') : h('span', { class: 'muted' }, 'Gemütliche Runde am Feuer')) : h('div', { class: 'sh-topic muted' }, 'Gerade ist kein Feuerabend. Die anderen sind unterwegs.'),
    stage,
    h('label', { class: 'sh-check' }, withLines, ' Linien einblenden (Freund/Rivale)'));
  withLines.addEventListener('change', drawLines);
  drawLines();

  // Faden spielt nacheinander ab (jüngster Faden mit mindestens zwei Zeilen)
  clearInterval(threadTimer);
  const talk = (showData.talk || []).filter((t) => t.thread > 0);
  const last = talk.length ? talk[talk.length - 1].thread : 0;
  const lines = talk.filter((t) => t.thread === last);
  if (lines.length) {
    let i = 0;
    const show = () => {
      const t = lines[i % lines.length];
      bubble.hidden = false;
      clear(bubble);
      bubble.append(h('b', {}, nameOf(t.from) + ': '), document.createTextNode(t.text || ''));
      i += 1;
    };
    show();
    if (lines.length > 1) threadTimer = setInterval(() => { if (!bubble.isConnected) { clearInterval(threadTimer); return; } show(); }, 4000);
  }
  return root;
}

// ---------- Zeitleiste ----------
const KIND_SYM = { Etappe: '★', Erster: '①', Bestwert: '▲' };
function viewZeit() {
  const tl = (showData.timeline || []).slice().reverse();
  if (!tl.length) return h('div', { class: 'empty' }, 'Noch nichts passiert.');
  return h('ol', { class: 'sh-time' }, tl.map((e) => h('li', { class: 'sh-ev ' + (e.kind || '') },
    h('span', { class: 'sh-ev-sym', 'aria-hidden': 'true' }, KIND_SYM[e.kind] || '•'),
    h('div', { class: 'sh-ev-b' },
      h('div', { class: 'sh-ev-h' }, h('b', {}, e.title || ''), h('span', { class: 'sh-day' }, 'Tag ' + e.day)),
      h('div', { class: 'sh-ev-t' }, e.text || '', e.pawn ? [' ', nameBtn(e.pawn, 'inline')] : null)))));
}

// ---------- Rat, Regeln, Wünsche ----------
function viewRat() {
  const c = showData.council || {};
  const root = h('div', { class: 'sh-council' });
  root.append(h('div', { class: 'sh-status' },
    h('span', { class: 'sh-pill ' + (c.running ? 'on' : '') }, c.running ? 'Rat tagt' : 'Kein Rat'),
    c.openWishes > 0 ? h('span', { class: 'sh-pill' }, c.openWishes === 1 ? '1 offener Wunsch' : `${c.openWishes} offene Wünsche`) : null));
  const rules = c.rules || [];
  root.append(h('h3', { class: 'sh-h' }, 'Gruppenregeln'),
    rules.length ? h('ul', { class: 'sh-rules' }, rules.map((r) => h('li', {}, h('span', {}, r.text || ''), r.pawn ? [' ', h('span', { class: 'muted' }, 'vorgeschlagen von '), nameBtn(r.pawn, 'inline')] : null)))
      : h('div', { class: 'muted small' }, 'Es gibt noch keine Regeln.'));
  const prot = (c.protocol || []).slice().reverse();
  root.append(h('h3', { class: 'sh-h' }, 'Abstimmungen'));
  if (!prot.length) root.append(h('div', { class: 'muted small' }, 'Noch keine Abstimmung.'));
  for (const p of prot) {
    const opts = p.options || [];
    const total = (p.votes || []).reduce((a, v) => a + (v.weight || 1), 0) || 1;
    root.append(h('div', { class: 'sh-vote' },
      h('div', { class: 'sh-vote-q' }, p.question || ''),
      opts.map((o, k) => {
        const vs = (p.votes || []).filter((v) => v.option === k);
        const w = vs.reduce((a, v) => a + (v.weight || 1), 0);
        return h('div', { class: 'sh-opt' + (p.chosen === k ? ' won' : '') },
          h('div', { class: 'sh-opt-h' }, h('span', {}, (p.chosen === k ? '✓ ' : '') + o), h('span', { class: 'muted' }, Math.round((w / total) * 100) + ' %')),
          h('div', { class: 'sh-opt-bar' }, h('span', { style: `width:${Math.round((w / total) * 100)}%` })),
          h('div', { class: 'sh-opt-voters' }, vs.map((v) => avatar(v.pawn, 24))));
      }),
      p.decision ? h('div', { class: 'sh-decision' }, p.decision) : null,
      p.tie ? h('div', { class: 'muted small' }, 'Gleichstand – das Los hat entschieden.') : null));
  }
  return root;
}

// ---------- Tagebuch (PC: Seitenleiste, Handy: Vollbild-Blatt) ----------
function diarySheet() {
  const sheet = h('aside', { class: 'sh-sheet', hidden: true, role: 'dialog', 'aria-label': 'Tagebuch' });
  const bd = h('div', { class: 'sh-backdrop', hidden: true });
  let stop = null, curId = null;
  const close = () => { if (stop) { stop(); stop = null; } curId = null; sheet.hidden = true; bd.hidden = true; document.body.classList.remove('sh-sheet-open'); };
  bd.addEventListener('click', close);
  const draw = (id, data) => {
    clear(sheet);
    const m = byId(id), c = colony.get(id);
    sheet.append(h('div', { class: 'sh-sheet-head' }, avatar(id, 52), h('div', { class: 'sh-sheet-t' }, h('b', {}, nameOf(id)),
      h('span', { class: 'muted small' }, [m?.leader ? 'Anführung · ' : '', c?.displayName ? '@' + c.displayName : ''].join(''))),
    h('button', { type: 'button', class: 'sh-x', onclick: close, 'aria-label': 'Schließen' }, '✕')));
    if (!data) { sheet.append(h('div', { class: 'empty' }, 'Lade Tagebuch …')); return; }
    const body = h('div', { class: 'sh-sheet-body' });
    for (const sec of data.sections || []) body.append(h('section', { class: 'sh-sec' }, h('h4', {}, sec.title || ''),
      (sec.lines || []).map((l) => h('p', { class: 'sh-dl ' + (l.tone || 'text') }, l.text || ''))));
    sheet.append(body);
  };
  return {
    nodes: [bd, sheet],
    open(id) {
      if (curId === id) { close(); return; }
      close(); curId = id; sheet.hidden = false; bd.hidden = false; document.body.classList.add('sh-sheet-open');
      draw(id, null);
      stop = live.poll({
        path: '/api/show/diary/' + encodeURIComponent(id), every: 10000, alive: () => curId === id && sheet.isConnected,
        onResult: (r) => { if (curId !== id) return; if (r.status === 200 && r.data) draw(id, r.data); else if (r.status === 404) draw(id, { sections: [{ title: '', lines: [{ text: 'Noch kein Tagebuch.', tone: 'quiet' }] }] }); },
      });
    },
    close,
  };
}

// ---------- Ansicht ----------
function readSub() { const hs = location.hash.replace(/^#\/?/, '').split('/')[1]; if (SUBS.some((x) => x[0] === hs)) return hs; try { const v = localStorage.getItem(SUB_KEY); return SUBS.some((x) => x[0] === v) ? v : 'buehne'; } catch { return 'buehne'; } }
function saveSub(v) { try { localStorage.setItem(SUB_KEY, v); } catch { /* egal */ } }

export function showView() {
  const html = '<div class="live-page sh-page"><div class="sh-head"><h2 class="section-title" style="margin:0">Die Show</h2><span class="small muted" id="sh-day"></span></div><div id="sh-subs" class="sh-subs" role="tablist"></div><div id="sh-body"></div></div>';
  function bind(root) {
    const body = root.querySelector('#sh-body'), subs = root.querySelector('#sh-subs'), day = root.querySelector('#sh-day');
    let sub = readSub(), lastKey = '', lastColony = '';
    const sheet = diarySheet();
    document.querySelectorAll('.sh-sheet, .sh-backdrop').forEach((n) => n.remove());
    document.body.append(...sheet.nodes);
    openDiary = (id) => sheet.open(id);
    const drawSubs = () => {
      clear(subs);
      for (const [id, label] of SUBS) subs.append(h('button', { type: 'button', role: 'tab', class: 'sh-sub', 'aria-selected': id === sub, onclick: () => { sub = id; saveSub(id); lastKey = ''; render(); } }, label));
    };
    const render = () => {
      if (!showData) { clear(body); body.append(h('div', { class: 'empty' }, 'Die Show wird geladen …')); return; }
      const key = JSON.stringify([sub, showData, lastColony]);
      if (key === lastKey) return;
      lastKey = key;
      day.textContent = showData.tag ? 'Tag ' + showData.tag : '';
      clear(body);
      const v = { buehne: viewBuehne, netz: viewNetz, feuer: viewFeuer, zeit: viewZeit, rat: viewRat }[sub];
      try { body.append(v()); } catch (e) { console.warn('[show]', e); body.append(h('div', { class: 'empty' }, 'Diese Ansicht ist gerade nicht verfügbar.')); }
      drawSubs();
    };
    drawSubs(); render();
    const alive = () => body.isConnected;
    const offA = live.poll({ path: '/api/show', every: 2500, alive, onResult: (r) => { if (r.status === 200 && r.data?.active) { showData = r.data; render(); } } });
    const offB = live.poll({ path: '/api/colony', every: 2500, alive, onResult: (r) => {
      if (r.status !== 200 || !r.data) return;
      colony.clear();
      for (const p of r.data.pawns || []) colony.set(p.id, p);
      lastColony = JSON.stringify([...colony.values()].map((p) => [p.id, p.moodPct, p.displayName]));
      render();
    } });
    const obs = new MutationObserver(() => { if (!alive()) { offA(); offB(); sheet.close(); sheet.nodes.forEach((n) => n.remove()); clearInterval(threadTimer); obs.disconnect(); } });
    obs.observe(document.getElementById('view'), { childList: true });
  }
  return { html, bind };
}
