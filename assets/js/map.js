// Daten-Karte (Wildshow 4.9, läuft auch im normalen RICS Live): Draufsicht aus reinen Daten (Raster + Punkte), Canvas.
// Gelände kommt einmal (/api/map/terrain/<id>), Figuren/Bauten/Welt alle 2 s (/api/map). Fremdtext nur über textContent bzw. Canvas-Text.
import * as live from './live.js';
import { isShowMode, getShowData } from './show.js';

const COLORS = { g: '#6f8f4f', s: '#b9a56e', w: '#4f86b8', W: '#2f5b8a', r: '#6b6760', t: '#355f33' };
const BLD = { fire: '#e8812e', bed: '#c9b48a', door: '#8a6a3a', wall: '#4a4540', build: '#9b8a6b' };
const NEAR = 8;   // Felder
const el = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true && !k.startsWith('aria-') ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
};
const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); };

export function karteView() {
  const html = '<div class="live-page mp-page"><div class="mp-head"><h2 class="section-title" style="margin:0">Karte</h2><span class="small muted" id="mp-info"></span></div><div id="mp-subs" class="mp-subs"></div><div id="mp-body"></div></div>';
  function bind(root) {
    const body = root.querySelector('#mp-body'), subs = root.querySelector('#mp-subs'), infoTxt = root.querySelector('#mp-info');
    let data = null, which = null;                       // which = Karten-id oder 'world'
    const terrain = new Map();                           // id -> { data, canvas }
    const imgs = new Map();                              // pawn id -> Image | false
    let selected = null, view = { s: 4, x: 0, z: 0, fit: false }, cv = null, ctx = null, raf = 0, card = null, strip = null;
    let size = { w: 300, h: 300 };

    const alive = () => body.isConnected;
    const mapObj = () => data?.maps?.find((m) => m.id === which);
    const pawnImg = (id) => {
      if (imgs.has(id)) return imgs.get(id);
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { imgs.set(id, im); draw(); };
      im.onerror = () => imgs.set(id, false);
      imgs.set(id, false); im.src = live.artUrl(id, 0);
      return false;
    };
    const loadTerrain = async (id) => {
      if (terrain.has(id)) return;
      terrain.set(id, null);
      try {
        const r = await live.getJson('/api/map/terrain/' + encodeURIComponent(id));
        if (r.status !== 200 || !r.data) { terrain.delete(id); return; }
        const d = r.data, c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
        const g = c.getContext('2d');
        for (let gz = 0; gz < d.h; gz++) {
          const row = d.rows[gz] || '';
          for (let gx = 0; gx < d.w; gx++) { g.fillStyle = COLORS[row[gx]] || COLORS.g; g.fillRect(gx, d.h - 1 - gz, 1, 1); }
        }
        terrain.set(id, { data: d, canvas: c });
        draw();
      } catch { terrain.delete(id); }
    };

    // ---- Umrechnung Feld <-> Bildpunkt (z zeigt nach oben) ----
    const toPx = (x, z) => [(x - view.x) * view.s + size.w / 2, size.h / 2 - (z - view.z) * view.s];
    const toCell = (px, py) => [(px - size.w / 2) / view.s + view.x, (size.h / 2 - py) / view.s + view.z];
    const fit = () => {
      const m = mapObj(); if (!m) return;
      const camp = m.buildings.find((b) => b.k === 'fire') || m.pawns[0];
      view.s = Math.max(2, Math.min(size.w, size.h) / 70);
      view.x = camp ? camp.x : m.sizeX / 2; view.z = camp ? camp.z : m.sizeZ / 2; view.fit = true;
    };

    const friendly = (a, b) => {
      if (!isShowMode()) return 'plain';
      const ops = getShowData()?.opinions || [];
      const f = (x, y) => ops.find((o) => o.a === x && o.b === y)?.v ?? 0;
      const v1 = f(a, b), v2 = f(b, a);
      return v1 >= 30 && v2 >= 30 ? 'friend' : (v1 + v2) / 2 <= -30 ? 'rival' : 'plain';
    };

    // ---- Nebel (Wildshow live-nebel): Daten kommen aus /api/show (fog), nur im Show-Modus mit Surveillance Shift. Ohne fog: alles sichtbar wie bisher. ----
    const fogOf = (m) => (isShowMode() ? getShowData()?.fog?.maps?.find((f) => f.id === m.id) : null) || null;
    const fogCache = new WeakMap();
    const FOGA = { 0: 0.93, 1: 0.58, 2: 0 };
    const fogCanvas = (f) => {                        // winziges Bild (eine Zelle = ein Pixel), beim Hochskalieren weich
      let c = fogCache.get(f); if (c) return c;
      c = document.createElement('canvas'); c.width = f.cols; c.height = f.rows;
      const g = c.getContext('2d');
      for (let gz = 0; gz < f.rows; gz++) {
        const row = f.vis[gz] || '';
        for (let gx = 0; gx < f.cols; gx++) { const a = FOGA[row[gx]] ?? 0; if (a) { g.fillStyle = `rgba(14,12,10,${a})`; g.fillRect(gx, f.rows - 1 - gz, 1, 1); } }
      }
      fogCache.set(f, c); return c;
    };
    const ageText = (ticks) => { const min = Math.round(ticks / 41.7); return min < 60 ? 'vor ' + Math.max(1, min) + ' Min.' : 'vor ' + Math.round(min / 60) + ' Std.'; };
    function drawFog(m, f) {
      const k = f.cell * view.s, [x0, y0] = toPx(0, f.rows * f.cell);
      ctx.save();
      const [cx0, cy0] = toPx(0, m.sizeZ);
      ctx.beginPath(); ctx.rect(cx0, cy0, m.sizeX * view.s, m.sizeZ * view.s); ctx.clip();   // letzte Zelle kann über den Kartenrand ragen
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fogCanvas(f), x0, y0, f.cols * k, f.rows * k);
      ctx.restore();
    }
    function drawFogMarks(f) {
      const fade = Math.max(1, getShowData()?.fog?.fade || 15000);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const w of f.seen || []) {
        const [px, py] = toPx(w.x, w.z);
        ctx.font = '15px system-ui'; ctx.fillText(w.kind === 'foreign' ? '👤' : '🐾', px, py);
        ctx.font = '11px system-ui'; ctx.textBaseline = 'top'; const tw = ctx.measureText(w.label).width + 6;
        ctx.fillStyle = '#000b'; ctx.fillRect(px - tw / 2, py + 9, tw, 14); ctx.fillStyle = '#fff'; ctx.fillText(w.label, px, py + 10); ctx.textBaseline = 'middle';
      }
      for (const g of f.ghosts || []) {
        const [px, py] = toPx(g.x, g.z), a = Math.max(0.25, 1 - g.age / fade);
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(px, py, 11, 0, 7); ctx.fillStyle = '#2b2620'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = g.kind === 'foreign' ? '#e07a6b' : '#d99a4e'; ctx.stroke();
        ctx.font = 'bold 15px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText('?', px, py + 1);
        ctx.font = '11px system-ui'; ctx.textBaseline = 'top'; const txt = g.label + '? · ' + ageText(g.age), tw = ctx.measureText(txt).width + 6;
        ctx.fillStyle = '#000b'; ctx.fillRect(px - tw / 2, py + 13, tw, 14); ctx.fillStyle = '#fff'; ctx.fillText(txt, px, py + 14); ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
      }
    }

    function drawMap() {
      const m = mapObj(); if (!m) return;
      ctx.fillStyle = '#1d1b18'; ctx.fillRect(0, 0, size.w, size.h);
      const t = terrain.get(m.id);
      if (t) {
        const [x0, y0] = toPx(0, m.sizeZ), k = (view.s * t.data.step);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t.canvas, x0, y0, t.data.w * k, t.data.h * k);
      }
      for (const b of m.buildings) {
        const [px, py] = toPx(b.x - (b.sx - 1) / 2 - 0.5, b.z + (b.sz - 1) / 2 + 0.5);
        if (b.k === 'fire') { ctx.font = Math.max(12, view.s * 2.4) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔥', px + view.s / 2, py + view.s / 2); continue; }
        ctx.fillStyle = BLD[b.k] || BLD.build;
        ctx.fillRect(px, py, Math.max(2, b.sx * view.s), Math.max(2, b.sz * view.s));
      }
      const fog = fogOf(m);
      if (fog) { drawFog(m, fog); drawFogMarks(fog); }
      const ps = m.pawns;
      // Wege (gestrichelt) und Nähe-Linien
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,.45)';
      for (const p of ps) if (p.dx != null) { const [a, b] = toPx(p.x, p.z), [c, d] = toPx(p.dx, p.dz); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) >= NEAR) continue;
        const kind = friendly(ps[i].id, ps[j].id);
        const [a, b] = toPx(ps[i].x, ps[i].z), [c, d] = toPx(ps[j].x, ps[j].z);
        ctx.setLineDash(kind === 'rival' ? [6, 5] : []);
        ctx.lineWidth = kind === 'plain' ? 1.5 : 3;
        ctx.strokeStyle = kind === 'friend' ? '#8fbf7a' : kind === 'rival' ? '#e07a6b' : 'rgba(200,200,200,.5)';
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const p of ps) {
        const [px, py] = toPx(p.x, p.z), r = 13;
        ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.closePath(); ctx.fillStyle = '#3a342c'; ctx.fill(); ctx.clip();
        const im = pawnImg(p.id);
        if (im) ctx.drawImage(im, px - r, py - r, 2 * r, 2 * r);
        else { ctx.fillStyle = '#ece4d6'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((p.name || '?')[0].toUpperCase(), px, py + 1); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.lineWidth = selected === p.id ? 3 : 2; ctx.strokeStyle = selected === p.id ? '#d99a4e' : '#000a'; ctx.stroke();
        if (p.sleeping) { ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('💤', px + r - 4, py - r); }
        ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const w = ctx.measureText(p.name).width + 8;
        ctx.fillStyle = '#000b'; ctx.fillRect(px - w / 2, py + r + 2, w, 15);
        ctx.fillStyle = '#fff'; ctx.fillText(p.name, px, py + r + 3);
      }
      // Maßstab
      const nice = [5, 10, 20, 50, 100].find((n) => n * view.s >= 50) || 100;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(10, size.h - 14); ctx.lineTo(10 + nice * view.s, size.h - 14); ctx.stroke();
      ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(nice + ' Felder', 10, size.h - 18);
    }

    function drawWorld() {
      ctx.fillStyle = '#1d2a38'; ctx.fillRect(0, 0, size.w, size.h);
      // Ausschnitt: alle Objekte samt Ziel, mindestens 24 Grad breit, mit Rand
      const pts = [];
      for (const o of data?.world || []) { pts.push([o.lon, o.lat]); if (o.destLon != null) pts.push([o.destLon, o.destLat]); }
      let minX = -180, maxX = 180, minY = -90, maxY = 90;
      if (pts.length) {
        minX = Math.min(...pts.map((q) => q[0])); maxX = Math.max(...pts.map((q) => q[0])); minY = Math.min(...pts.map((q) => q[1])); maxY = Math.max(...pts.map((q) => q[1]));
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const sp = Math.max(24, (maxX - minX) * 1.4, ((maxY - minY) * 1.4 * size.w) / size.h);
        minX = cx - sp / 2; maxX = cx + sp / 2; minY = cy - (sp * size.h) / size.w / 2; maxY = cy + (sp * size.h) / size.w / 2;
      }
      const P = (lon, lat) => [((lon - minX) / (maxX - minX)) * size.w, ((maxY - lat) / (maxY - minY)) * size.h];
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.setLineDash([]);
      const stepG = (maxX - minX) > 100 ? 30 : (maxX - minX) > 40 ? 10 : 5;
      for (let g = Math.ceil(minX / stepG) * stepG; g <= maxX; g += stepG) { const [x] = P(g, 0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke(); }
      for (let g = Math.ceil(minY / stepG) * stepG; g <= maxY; g += stepG) { const [, y] = P(0, g); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.w, y); ctx.stroke(); }
      for (const o of data?.world || []) {
        const [x, y] = P(o.lon, o.lat);
        if (o.kind === 'caravan' && o.destLon != null) { const [a, b] = P(o.destLon, o.destLat); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#d99a4e'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(a, b); ctx.stroke(); ctx.setLineDash([]); ctx.strokeRect(a - 4, b - 4, 8, 8); }
        ctx.fillStyle = o.kind === 'settlement' ? '#8fbf7a' : '#d99a4e';
        if (o.kind === 'settlement') ctx.fillRect(x - 6, y - 6, 12, 12); else { ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }
        ctx.font = '12px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.name, x, y + 9);
      }
    }

    function draw() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (!ctx || !alive()) return; if (which === 'world') drawWorld(); else drawMap(); });
    }

    function drawCard() {
      if (!card) return;
      clear(card);
      const m = mapObj(), p = m?.pawns.find((q) => q.id === selected);
      card.hidden = !p;
      if (!p) return;
      const bar = (label, v) => v == null ? null : el('div', { class: 'mp-need' }, el('span', {}, label), el('span', { class: 'mp-bar' }, el('i', { style: `width:${Math.max(2, Math.min(100, v))}%` })), el('span', { class: 'muted small' }, v + ' %'));
      const near = m.pawns.filter((q) => q.id !== p.id && Math.hypot(q.x - p.x, q.z - p.z) < NEAR);
      card.append(el('div', { class: 'mp-card-h' }, el('b', {}, p.name), el('button', { type: 'button', class: 'mp-x', 'aria-label': 'Schließen', onclick: () => { selected = null; drawCard(); draw(); } }, '✕')),
        el('div', { class: 'small muted' }, (p.job || '') + (p.sleeping ? ' · schläft' : '')),
        bar('Hunger', p.food), bar('Durst', p.thirst), bar('Schlaf', p.rest), bar('Stimmung', p.mood),
        el('div', { class: 'small' }, 'Ort: ' + m.name + ' (' + p.x + ' / ' + p.z + ')'),
        el('div', { class: 'small' }, 'In der Nähe: ', near.length ? near.map((q, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'mp-link', onclick: () => pick(q.id, true) }, q.name)]) : 'niemand'));
    }

    function drawStrip() {
      if (!strip) return;
      clear(strip);
      for (const p of mapObj()?.pawns || []) {
        const b = el('button', { type: 'button', class: 'mp-chip' + (selected === p.id ? ' on' : ''), onclick: () => pick(p.id, true) }, p.name);
        strip.append(b);
      }
    }

    function pick(id, center) {
      selected = id; drawCard(); drawStrip();
      const p = mapObj()?.pawns.find((q) => q.id === id);
      if (center && p) { view.x = p.x; view.z = p.z; }
      draw();
      if (id && window.matchMedia('(max-width: 700px)').matches) cv.scrollIntoView({ block: 'start', behavior: 'smooth' });   // Handy: Infokarte verdeckt unten, Karte nach oben
    }

    function drawSubs() {
      clear(subs);
      for (const m of data?.maps || []) subs.append(el('button', { type: 'button', class: 'mp-sub', 'aria-selected': which === m.id, onclick: () => { which = m.id; view.fit = false; selected = null; rebuild(); } }, m.name));
      subs.append(el('button', { type: 'button', class: 'mp-sub', 'aria-selected': which === 'world', onclick: () => { which = 'world'; rebuild(); } }, 'Weltkarte'));
    }

    function resize() {
      if (!cv) return;
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      size = { w: Math.max(100, Math.round(r.width)), h: Math.max(100, Math.round(r.height)) };
      cv.width = size.w * dpr; cv.height = size.h * dpr;
      ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!view.fit) fit();
      draw();
    }

    function rebuild() {
      clear(body); drawSubs();
      cv = el('canvas', { class: 'mp-cv', 'aria-label': 'Karte' });
      card = el('div', { class: 'mp-card', hidden: true });
      strip = el('div', { class: 'mp-strip' });
      const zoom = (f) => { view.s = Math.max(1, Math.min(24, view.s * f)); draw(); };
      const ctl = which === 'world' ? null : el('div', { class: 'mp-ctl' },
        el('button', { type: 'button', onclick: () => zoom(1.35), 'aria-label': 'Vergrößern' }, '+'),
        el('button', { type: 'button', onclick: () => zoom(1 / 1.35), 'aria-label': 'Verkleinern' }, '−'),
        el('button', { type: 'button', onclick: () => { view.fit = false; fit(); draw(); } }, 'zum Lager'));
      body.append(el('div', { class: 'mp-wrap' }, cv, ctl, card), strip);
      // Ziehen, Mausrad, zwei Finger
      const pts = new Map(); let last = null, pinch = 0, moved = 0;
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; moved = 0; pinch = 0; });
      cv.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId) || which === 'world') return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) { view.s = Math.max(1, Math.min(24, view.s * (d / pinch))); draw(); }
          pinch = d; moved = 99; return;
        }
        view.x -= (e.clientX - last[0]) / view.s; view.z += (e.clientY - last[1]) / view.s;
        moved += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]); last = [e.clientX, e.clientY]; draw();
      });
      const up = (e) => {
        const wasTap = pts.size === 1 && moved < 6; pts.delete(e.pointerId); pinch = 0;
        if (!wasTap || which === 'world') return;
        const r = cv.getBoundingClientRect(), [cx, cz] = toCell(e.clientX - r.left, e.clientY - r.top);
        let best = null, bd = 18 / view.s;
        for (const p of mapObj()?.pawns || []) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; best = p.id; } }
        pick(best, false);
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = 0; });
      cv.addEventListener('wheel', (e) => { if (which === 'world') return; e.preventDefault(); view.s = Math.max(1, Math.min(24, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); draw(); }, { passive: false });
      if (ro) { ro.disconnect(); ro.observe(cv); }
      requestAnimationFrame(() => { resize(); drawStrip(); drawCard(); });
      if (which !== 'world') loadTerrain(which);
    }

    const ro = window.ResizeObserver ? new ResizeObserver(() => { if (alive()) resize(); }) : null;
    const offPoll = live.poll({
      path: '/api/map', every: 2000, alive,
      onResult: (r) => {
        if (r.status !== 200 || !r.data || r.unchanged) { if (r.status === 503 && !data) clear(body), body.append(el('div', { class: 'empty' }, 'Die Karte wird gelesen …')); return; }
        const first = !data; data = r.data;
        infoTxt.textContent = (data.maps || []).reduce((n, m) => n + m.pawns.length, 0) + ' Figuren' + (data.maps?.some((m) => fogOf(m)) ? ' · dunkel = außerhalb der Sicht der Gruppe, ? = zuletzt gesehen' : '');
        if (first || !which || (which !== 'world' && !mapObj())) { which = location.hash.split('/')[2] === 'world' ? 'world' : (data.maps?.[0]?.id || 'world'); rebuild(); return; }
        drawSubs(); drawStrip(); drawCard(); draw();
        if (which !== 'world') loadTerrain(which);
      },
    });
    body.append(el('div', { class: 'empty' }, 'Lade Karte …'));
    const obs = new MutationObserver(() => { if (!alive()) { offPoll(); cancelAnimationFrame(raf); ro?.disconnect(); obs.disconnect(); } });
    obs.observe(document.getElementById('view'), { childList: true });
  }
  return { html, bind };
}
