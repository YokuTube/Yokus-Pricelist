// Daten-Karte (läuft im normalen RICS Live; Nebel und Beziehungslinien nur bei laufender Show): Draufsicht aus reinen Daten (Raster + Punkte), Canvas.
// Gelände kommt einmal (/api/map/terrain/<id>), Figuren/Bauten/Welt alle 2 s (/api/map). Fremdtext nur über textContent bzw. Canvas-Text.
import * as live from './live.js';
import { isShowMode, getShowData } from './show-gate.js';

const COLORS = { g: '#6f8f4f', s: '#b9a56e', w: '#4f86b8', W: '#2f5b8a', r: '#6b6760', t: '#355f33',
  f: '#9a8f7e', b: '#7a5a34', m: '#5b5a37', i: '#cfe3ee', c: '#8d8a80' };   // f gebauter Boden, b Brücke, m Schlamm/Sumpf, i Eis, c Kies
const RGB = {};
for (const [k, v] of Object.entries(COLORS)) RGB[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
const BLD = { fire: '#e8812e', bed: '#c9b48a', door: '#8a6a3a', wall: '#4a4540', build: '#9b8a6b', bench: '#b5703a', table: '#a88a5a', seat: '#8f7a52', turret: '#a94a42',
  storage: '#7a8a96', joy: '#b06fb0', power: '#d8c23a', light: '#f0e08a', plant: '#4f9a4a', med: '#d8e6ea', other: '#8a8478' };
const BLD_SYM = { bench: '🔨', table: '🍴', seat: '🪑', turret: '🎯', storage: '📦', joy: '🎲', power: '⚡', light: '💡', plant: '🌱', med: '🏥', bed: '🛏' };
const BLD_NAME = { bench: 'Werkbank', table: 'Tisch', seat: 'Sitzplatz', turret: 'Geschütz', storage: 'Lager', joy: 'Freizeit', power: 'Strom', light: 'Licht', plant: 'Pflanze', med: 'Krankenbett', bed: 'Bett', fire: 'Feuer', door: 'Tür', other: 'Gebäude', build: 'Gebäude' };
const REL = { enemy: ['Feind', '#c0392b'], guest: ['Gast', '#3b7dd8'], prisoner: ['Gefangene/r', '#e08a1e'], slave: ['Sklave/in', '#e08a1e'], other: ['Fremde/r', '#7d7d7d'] };
const FILT_KEY = 'ys-map-filter';
const FILTERS = [['pawns', 'Kolonisten'], ['animals', 'Tiere'], ['strangers', 'Fremde'], ['blds', 'Gebäude'], ['plants', 'Pflanzen']];
const loadFilt = () => { const f = { pawns: true, animals: true, strangers: true, blds: true, plants: true }; try { Object.assign(f, JSON.parse(localStorage.getItem(FILT_KEY) || '{}')); } catch { /* ohne Speicher */ } return f; };
const saveFilt = (f) => { try { localStorage.setItem(FILT_KEY, JSON.stringify(f)); } catch { /* egal */ } };
const QUAL = ['Schrott', 'Schlecht', 'Normal', 'Gut', 'Hervorragend', 'Meisterhaft', 'Legendär'];
const NEAR = 8;   // Felder
// Pflanzen in der Übersicht: Mischfarbe + Deckkraft je Art; gezoomt Bild (Bäume größer), bis zum Laden dieselbe Farbe
const PL_COL = { grass: [128, 184, 84, 0.45], bush: [72, 144, 62, 0.6], tree: [34, 94, 40, 0.8], crop: [176, 196, 64, 0.6], other: [112, 140, 92, 0.4] };
const HEX = /^#[0-9a-f]{6}$/i;
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

// ---- Spielgrafiken (Bodenkacheln /api/img/tr_<def>, Gebäudesymbole /api/img/t_<def>) ----
// Gemeinsamer Lader (überlebt das Neuöffnen der Karte): höchstens 3 Anfragen gleichzeitig; 404 = "noch nicht gerendert" -> später erneut (Rückzug), danach aufgeben.
// Per fetch geladen, damit der Status bekannt ist und der Durchschnittsfarbwert gelesen werden darf (CORS); scheitert fetch, dient ein <img> (ohne Farbwert).
const GFX = (() => {
  const ents = new Map(), queue = [], subs = new Set(), DELAYS = [3000, 8000, 20000, 45000, 120000, 120000];
  let inflight = 0;
  const base = () => live.artUrl('x', 0).replace(/\/api\/art\/.*$/, '');
  const avgOf = (bmp) => {                                  // Mittelwert über ein 8×8-Verkleinerung (Alpha gewichtet)
    try {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0, a = 0;
      for (let i = 0; i < d.length; i += 4) { const w = d[i + 3]; r += d[i] * w; gg += d[i + 1] * w; b += d[i + 2] * w; a += w; }
      return a ? [Math.round(r / a), Math.round(gg / a), Math.round(b / a)] : null;
    } catch { return null; }
  };
  const miss = (e) => {
    e.state = 'miss'; e.tries++;
    if (e.tries > DELAYS.length) { e.state = 'gone'; return; }
    setTimeout(() => { if (e.state === 'miss') { e.state = 'wait'; queue.push(e); pump(); } }, DELAYS[e.tries - 1]);
  };
  const done = (e) => { e.state = 'ok'; for (const f of subs) f(e); };
  async function run(e) {
    inflight++; e.state = 'load';
    try {
      const r = await fetch(e.url, { mode: 'cors' });
      if (r.status === 200) { const bmp = await createImageBitmap(await r.blob()); e.bmp = bmp; e.avg = avgOf(bmp); done(e); } else miss(e);
    } catch {
      await new Promise((res) => {                          // CORS/Netzfehler: <img> versuchen
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { e.bmp = im; done(e); res(); }; im.onerror = () => { miss(e); res(); }; im.src = e.url;
      });
    } finally { inflight--; pump(); }
  }
  function pump() { while (inflight < 3 && queue.length) run(queue.shift()); }
  return {
    subs,
    // Eintrag holen (stößt das Laden an); e.state === 'ok' -> e.bmp / e.avg benutzbar
    get(key, kind, def) {
      const url = base() + '/api/img/' + encodeURIComponent(key);
      let e = ents.get(url);
      if (!e) { e = { url, key, kind, def, state: 'wait', tries: 0, bmp: null, avg: null }; ents.set(url, e); queue.push(e); pump(); }
      return e;
    },
    peek(key) { return ents.get(base() + '/api/img/' + encodeURIComponent(key)) || null; },
  };
})();
const bw = (b) => b.naturalWidth || b.width, bh = (b) => b.naturalHeight || b.height;
// Gebäudebilder kommen weiß aus dem Spiel: Einfärben per Multiplikation, Alpha bleibt; je (Bild, Farbe) einmal, höchstens 128 px Kante
const TINT = new Map();
const tinted = (ent, col) => {
  const key = ent.url + '|' + col; let c = TINT.get(key);
  if (c) return c;
  const bmp = ent.bmp, iw = bw(bmp), ih = bh(bmp), sc = Math.min(1, 128 / Math.max(iw, ih, 1)), W = Math.max(1, Math.round(iw * sc)), H = Math.max(1, Math.round(ih * sc));
  c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, W, H);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(bmp, 0, 0, W, H);
  if (TINT.size > 300) TINT.clear();
  TINT.set(key, c); return c;
};
const shade = (hex, f) => `rgb(${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f)).join(',')})`;
const CH = 32;                 // Felder je Stück (Kante)
const TILE_MIN = 5;            // ab so vielen Bildpunkten je Feld: Bodenkacheln statt Übersicht
const IMG_MIN = 6;             // ab so vielen Bildpunkten je Feld: Gebäude mit Spielbild
const CHUNK_BYTES = 48 * 1024 * 1024;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ALPHA_IX = {}; for (let i = 0; i < ALPHA.length; i++) ALPHA_IX[ALPHA[i]] = i;
const wallKey = (x, z) => x * 8192 + z;

export function karteView() {
  const html = '<div class="live-page mp-page"><div class="mp-head"><h2 class="section-title" style="margin:0">Karte</h2><span class="small muted" id="mp-info"></span></div><div id="mp-subs" class="mp-subs"></div><div id="mp-body"></div></div>';
  function bind(root) {
    const body = root.querySelector('#mp-body'), subs = root.querySelector('#mp-subs'), infoTxt = root.querySelector('#mp-info');
    let data = null, which = null;                       // which = Karten-id oder 'world'
    const terrain = new Map();                           // id -> { data, canvas }
    const imgs = new Map();                              // pawn id -> Image | false
    let follow = false;                                  // Karte folgt der ausgewählten Figur (bis man selbst verschiebt)
    let filt = loadFilt(), thing = null, thingTimer = 0;
    const animImgs = new Map(), terrLoading = new Set();
    let selected = null, view = { s: 4, x: 0, z: 0, fit: false }, cv = null, ctx = null, raf = 0, card = null, strip = null;
    let size = { w: 300, h: 300 }, legendOpen = false;

    const alive = () => body.isConnected;
    const mapObj = () => data?.maps?.find((m) => m.id === which);
    // Gemaltes Porträt (gibt es erst, wenn der Server es einmal gerendert hat), sonst das normale Porträt; beides später erneut versuchen.
    const tryImg = (id, src, onFail) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { if (!alive()) return; imgs.set(id, im); draw(); };
      im.onerror = onFail; im.src = src;
    };
    const pawnImg = (id) => {
      if (imgs.has(id)) return imgs.get(id);
      imgs.set(id, false);
      tryImg(id, live.artUrl(id, 0), () => {
        if (!imgs.get(id)) tryImg(id, live.portraitUrl(id, 0), () => {});
        setTimeout(() => { if (alive()) tryImg(id, live.artUrl(id, Date.now() % 100000), () => {}); }, 30000);   // gemaltes Bild nachladen, sobald es da ist
      });
      return false;
    };
    // Gelände: Übersicht = ein Pixel je Feld (ImageData, Durchschnittsfarbe der Bodenkachel bzw. Kategoriefarbe), hochskaliert.
    // Ab TILE_MIN Bildpunkten je Feld kommen Stücke (32×32 Felder, Offscreen-Canvas) mit den Bodenkacheln darüber – nur sichtbare, begrenzt zwischengespeichert.
    // Neu laden, wenn die Mod terrainVer erhöht.
    // Wasser hat im Spiel kein Standbild (animierter Shader, die Mod liefert dafür eine einfarbige, oft weiße Kachel) -> immer Kategoriefarbe
    const tileOk = (t, i) => !t.water || !t.water[i];
    const defCols = (t) => t.defs.map((d, i) => { const e = tileOk(t, i) && GFX.peek('tr_' + d); return (e && e.state === 'ok' && e.avg) || t.catRgb[i] || RGB.g; });
    const buildOverview = (t) => {
      const w = t.w, h = t.h;
      if (!t.ov) { t.ov = document.createElement('canvas'); t.ov.width = w; t.ov.height = h; }
      const g = t.ov.getContext('2d'), img = g.createImageData(w, h), px = img.data, cols = t.idx ? defCols(t) : null, pl = filt.plants && t.pidx ? t.pidx : null;
      for (let gz = 0; gz < h; gz++) {
        const row = t.data.rows[gz] || '', base = (h - 1 - gz) * w * 4;
        for (let gx = 0; gx < w; gx++) {
          const col = cols ? cols[t.idx[gz * w + gx]] || RGB.g : RGB[row[gx]] || RGB.g, o = base + gx * 4;
          const pk = pl ? pl[gz * w + gx] : 0;
          if (pk) { const pc = t.pcol[pk], a = pc[3]; px[o] = col[0] + (pc[0] - col[0]) * a; px[o + 1] = col[1] + (pc[1] - col[1]) * a; px[o + 2] = col[2] + (pc[2] - col[2]) * a; }
          else { px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; }
          px[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0); t.ovDirty = false;
    };
    const loadTerrain = async (id, ver) => {
      const cur = terrain.get(id);
      if (terrLoading.has(id) || (cur && cur.ver === ver)) return;
      terrLoading.add(id);
      try {
        const r = await live.getJson('/api/map/terrain/' + encodeURIComponent(id));
        if (r.status !== 200 || !r.data) return;
        const d = r.data, w = Math.max(1, d.w | 0), h = Math.max(1, d.h | 0), step = Math.max(1, d.step | 0);
        const t = { data: d, ver, w, h, step, idx: null, pidx: null, pdefs: [], pkinds: [], pcol: [], defs: [], catRgb: [], catCss: [], chunks: new Map(), bytes: 0, ov: null, ovDirty: false };
        if (Array.isArray(d.defs) && d.defs.length && Array.isArray(d.cells) && d.cells.length) {   // Spielgrafik-Felder (alte Mod: nichts davon)
          const enc2 = d.enc === 2, idx = new Uint16Array(w * h), cnt = new Array(d.defs.length).fill(0), first = new Array(d.defs.length);
          for (let gz = 0; gz < h; gz++) {
            const cr = d.cells[gz] || '', rr = d.rows[gz] || '';
            for (let gx = 0; gx < w; gx++) {
              const v = enc2 ? ALPHA_IX[cr[gx * 2]] * 64 + ALPHA_IX[cr[gx * 2 + 1]] : ALPHA_IX[cr[gx]];
              const k = v < d.defs.length ? v : 0;
              idx[gz * w + gx] = k; cnt[k]++; if (first[k] == null) first[k] = rr[gx];
            }
          }
          t.idx = idx; t.defs = d.defs.map(String);
          t.catRgb = t.defs.map((_, i) => RGB[first[i]] || RGB.g);
          t.water = t.defs.map((_, i) => first[i] === 'w' || first[i] === 'W');
          t.catCss = t.catRgb.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
          t.order = t.defs.map((_, i) => i).sort((a, b) => cnt[b] - cnt[a]);
        }
        if (Array.isArray(d.pdefs) && d.pdefs.length > 1 && Array.isArray(d.pcells) && d.pcells.length) {   // Pflanzen (optional, Index 0 = keine)
          const enc2 = d.penc === 2, pidx = new Uint16Array(w * h), n = d.pdefs.length;
          for (let gz = 0; gz < h; gz++) {
            const cr = d.pcells[gz] || '';
            for (let gx = 0; gx < w; gx++) {
              const v = enc2 ? ALPHA_IX[cr[gx * 2]] * 64 + ALPHA_IX[cr[gx * 2 + 1]] : ALPHA_IX[cr[gx]];
              pidx[gz * w + gx] = v > 0 && v < n ? v : 0;
            }
          }
          t.pidx = pidx; t.pdefs = d.pdefs.map(String);
          t.pkinds = t.pdefs.map((_, i) => (Array.isArray(d.pkinds) && PL_COL[d.pkinds[i]] ? d.pkinds[i] : 'other'));
          t.pcol = t.pkinds.map((k) => PL_COL[k]);
        }
        buildOverview(t);
        if (!alive()) return;
        terrain.set(id, t);
        if (t.idx) for (const i of t.order) if (tileOk(t, i)) GFX.get('tr_' + t.defs[i], 'tr', t.defs[i]);     // häufigste Böden zuerst
        draw();
      } catch { /* später erneut */ } finally { terrLoading.delete(id); }
    };
    // Eine Bodenkachel (oder ein Gebäudebild) ist angekommen: betroffene Stücke neu, Übersichtsfarbe nachziehen (gebündelt)
    let ovTimer = 0;
    const onGfx = (e) => {
      if (!alive()) { GFX.subs.delete(onGfx); return; }
      if (e.kind === 'tr') {
        for (const t of terrain.values()) {
          const i = t.defs.indexOf(e.def); if (i < 0) continue;
          t.ovDirty = true;
          for (const c of t.chunks.values()) if (c.missing.has(i)) c.stale = true;
        }
        clearTimeout(ovTimer);
        ovTimer = setTimeout(() => { for (const t of terrain.values()) if (t.ovDirty) buildOverview(t); draw(); }, 200);
      } else if (e.kind === 'pl') {
        for (const t of terrain.values()) {
          const i = t.pdefs.indexOf(e.def); if (i < 0) continue;
          for (const c of t.chunks.values()) if (c.plMissing?.has(i)) c.plStale = true;
        }
        clearTimeout(plTimer); plTimer = setTimeout(draw, 150);
      } else draw();
    };
    let plTimer = 0;
    GFX.subs.add(onGfx);
    // Stück bauen: je Feld der 16×16-Ausschnitt ((x mod 4)·16, (3 − z mod 4)·16) der 64×64-Kachel; ohne Kachel Kategoriefarbe
    const buildChunk = (t, ccx, ccz, L, old) => {
      const size = CH * L, cv = old?.cv || document.createElement('canvas');
      if (!old) { cv.width = size; cv.height = size; }
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
      const ents = t.defs.map((d, i) => { const e = tileOk(t, i) && GFX.peek('tr_' + d); return e && e.state === 'ok' ? e.bmp : null; }), missing = new Set();
      for (let lz = 0; lz < CH; lz++) {
        const gz = ccz * CH + lz; if (gz >= t.h) break;
        const dy = (CH - 1 - lz) * L, ty = 3 - (gz & 3);
        for (let lx = 0; lx < CH; lx++) {
          const gx = ccx * CH + lx; if (gx >= t.w) break;
          const k = t.idx[gz * t.w + gx], bmp = ents[k];
          if (bmp) { const tw = bw(bmp) / 4, th = bh(bmp) / 4; g.drawImage(bmp, (gx & 3) * tw, ty * th, tw, th, lx * L, dy, L, L); }
          else { missing.add(k); g.fillStyle = t.catCss[k]; g.fillRect(lx * L, dy, L, L); }
        }
      }
      const c = old || { cv, bytes: size * size * 4 };
      c.missing = missing; c.stale = false;
      if (!old) t.bytes += c.bytes;
      return c;
    };
    // Pflanzenschicht eines Stücks: durchsichtig, 1 Feld Rand rundum (Bäume ragen über die Kante), von oben nach unten gemalt; ohne Bild die Mischfarbe
    const buildLayer = (t, ccx, ccz, L, c) => {
      const size = (CH + 2) * L;
      if (!c.pl) { c.pl = document.createElement('canvas'); c.pl.width = size; c.pl.height = size; c.bytes += size * size * 4; t.bytes += size * size * 4; }
      const g = c.pl.getContext('2d'); g.clearRect(0, 0, size, size); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
      const ents = new Array(t.pdefs.length), missing = new Set();
      for (let gz = Math.min(t.h - 1, ccz * CH + CH); gz >= Math.max(0, ccz * CH - 1); gz--) {
        const dy = (CH - gz + ccz * CH) * L;                       // Zeile -1 (unterhalb) .. CH (oberhalb) -> y mit 1 Feld Rand
        for (let gx = Math.max(0, ccx * CH - 1); gx <= Math.min(t.w - 1, ccx * CH + CH); gx++) {
          const k = t.pidx[gz * t.w + gx]; if (!k) continue;
          const dx = (gx - ccx * CH + 1) * L, tree = t.pkinds[k] === 'tree';
          let bmp = ents[k];
          if (bmp === undefined) { const e = GFX.get('t_' + t.pdefs[k], 'pl', t.pdefs[k]); bmp = ents[k] = e.state === 'ok' ? e.bmp : null; }
          if (bmp) {
            const h0 = ((gx * 73856093) ^ (gz * 19349663)) >>> 0, jx = ((h0 & 255) / 255 - 0.5) * 0.2 * L, jy = (((h0 >> 8) & 255) / 255 - 0.5) * 0.2 * L;
            const iw = bw(bmp), ih = bh(bmp), box = tree ? 1.6 * L : L, sc = Math.min(box / iw, box / ih), dw = iw * sc, dh = ih * sc;
            const cx = dx + L / 2 + jx, by = dy + (tree ? 0.95 : 0.5) * L + (tree ? 0 : dh / 2) + jy;   // Baum: Fuß am Feldrand, Krone ragt nach oben; sonst mittig
            g.drawImage(bmp, cx - dw / 2, by - dh, dw, dh);
          } else {
            missing.add(k); const pc = t.pcol[k]; g.fillStyle = `rgba(${pc[0]},${pc[1]},${pc[2]},${Math.min(0.9, pc[3] + 0.1)})`;
            if (tree) { g.beginPath(); g.arc(dx + L / 2, dy + 0.3 * L, 0.7 * L, 0, 7); g.fill(); } else g.fillRect(dx, dy, L, L);
          }
        }
      }
      c.plMissing = missing; c.plStale = false;
    };
    // sichtbare Stücke zeichnen; je Bild nur begrenzt viel neu bauen (Rest im nächsten Bild), darunter liegt immer die Übersicht
    function drawChunks(t, ps) {
      const L = ps <= 10 ? 8 : 16, step = t.step;
      const [wx0, wz1] = toCell(0, 0), [wx1, wz0] = toCell(size.w, size.h);
      const cx0 = Math.max(0, Math.floor((wx0 + 0.5) / step / CH)), cx1 = Math.min(Math.floor((t.w - 1) / CH), Math.floor((wx1 + 0.5) / step / CH));
      const cz0 = Math.max(0, Math.floor((wz0 + 0.5) / step / CH)), cz1 = Math.min(Math.floor((t.h - 1) / CH), Math.floor((wz1 + 0.5) / step / CH));
      const list = [];
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) list.push([cx, cz, Math.hypot((cx + 0.5) * CH * step - view.x, (cz + 0.5) * CH * step - view.z)]);
      list.sort((a, b) => a[2] - b[2]);
      const t0 = performance.now(); let built = 0, more = false; const vis = [];
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
      for (const [cx, cz] of list) {
        const key = L + ':' + cx + ':' + cz;
        let c = t.chunks.get(key);
        if (!c || c.stale) {
          if (built && performance.now() - t0 > 6) { more = true; if (!c) continue; }
          else { c = buildChunk(t, cx, cz, L, c); built++; }
        }
        t.chunks.delete(key); t.chunks.set(key, c);                         // ans Ende = zuletzt benutzt
        const span = CH * step, X0 = toPx(cx * span - 0.5, 0)[0], X1 = toPx((cx + 1) * span - 0.5, 0)[0];
        const Y0 = toPx(0, (cz + 1) * span - 0.5)[1], Y1 = toPx(0, cz * span - 0.5)[1];
        const x = Math.floor(X0), y = Math.floor(Y0);
        ctx.drawImage(c.cv, x, y, Math.ceil(X1) - x, Math.ceil(Y1) - y);
        vis.push([c, cx, cz, X0, Y0, X1, Y1]);
      }
      if (t.pidx && filt.plants) {                                           // Pflanzen über dem gesamten Boden (damit Kronen nicht vom Nachbarstück überdeckt werden)
        for (const [c, cx, cz, X0, Y0, X1, Y1] of vis) {
          if (!c.pl || c.plStale) {
            if (built && performance.now() - t0 > 6) { more = true; if (!c.pl) continue; }
            else { buildLayer(t, cx, cz, L, c); built++; }
          }
          const k = (X1 - X0) / CH;
          ctx.drawImage(c.pl, X0 - k, Y0 - k, (CH + 2) * k, (CH + 2) * k);
        }
      }
      while (t.bytes > CHUNK_BYTES && t.chunks.size) { const k = t.chunks.keys().next().value, c = t.chunks.get(k); t.bytes -= c.bytes; t.chunks.delete(k); }
      if (more) draw();
    }
    const animImg = (kind) => {                           // Tierbild (gleiche Quelle wie Kolonie > Tiere), sonst /api/img, sonst Pfote
      if (!kind) return false;
      if (animImgs.has(kind)) return animImgs.get(kind);
      animImgs.set(kind, false);
      const base = live.artUrl('x', 0).replace(/\/api\/art\/.*$/, '');
      const load = (src, fail) => { const im = new Image(); im.decoding = 'async'; im.onload = () => { if (alive()) { animImgs.set(kind, im); draw(); } }; im.onerror = fail; im.src = src; };
      load(base + '/api/animalimg/' + encodeURIComponent(kind), () => load(base + '/api/img/' + encodeURIComponent(kind), () => setTimeout(() => animImgs.delete(kind), 30000)));
      return false;
    };
    // Gebäude-Detail (Mod liest erst auf Anfrage: 202 = noch nicht da)
    const fetchThing = (id, tries = 0) => {
      clearTimeout(thingTimer);
      if (!thing || thing.id !== id) thing = { id, info: null, state: 'loading' };
      live.getJson('/api/map/thing/' + encodeURIComponent(id)).then((r) => {
        if (!alive() || thing?.id !== id) return;
        if (r.status === 200 && r.data) { thing = { id, info: r.data, state: 'ok' }; thingTimer = setTimeout(() => fetchThing(id), 8000); }
        else if (r.status === 202 && tries < 8) thingTimer = setTimeout(() => fetchThing(id, tries + 1), 1200);
        else thing = { id, info: thing.info, state: thing.info ? 'ok' : 'none' };
        drawCard();
      }).catch(() => { if (thing?.id === id) { thing = { id, info: thing.info, state: thing.info ? 'ok' : 'none' }; drawCard(); } });
    };
    // Auswahl: { t: 'p'|'a'|'s'|'b', id }
    const sameSel = (a, b) => !!a && !!b && a.t === b.t && a.id === b.id;
    const findEnt = (sel, m = mapObj()) => {
      if (!sel || !m) return null;
      const list = sel.t === 'p' ? m.pawns : sel.t === 'a' ? m.animals : sel.t === 's' ? m.strangers : m.buildings;
      return (list || []).find((q) => q.id === sel.id) || null;
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

    // Wände zusammenhängend: Nachbarmaske je Wand einmal je Datenstand (Bits 1 oben, 2 rechts, 4 unten, 8 links = Nachbar ist Wand)
    const wallMasks = (m) => {
      if (m._wm) return;
      const set = new Set(); for (const b of m.buildings) if (b.k === 'wall') set.add(wallKey(b.x, b.z));
      for (const b of m.buildings) if (b.k === 'wall') b._wm = (set.has(wallKey(b.x, b.z + 1)) ? 1 : 0) | (set.has(wallKey(b.x + 1, b.z)) ? 2 : 0) | (set.has(wallKey(b.x, b.z - 1)) ? 4 : 0) | (set.has(wallKey(b.x - 1, b.z)) ? 8 : 0);
      m._wm = true;
    };
    // Gebäudebild auf die Grundfläche: einpassen, bei abweichendem Seitenverhältnis (Grundfläche liegend/stehend) um 90° gedreht (Richtung nach rot)
    const drawBldImg = (bmp, px, py, w, h, rot) => {
      const iw = bw(bmp), ih = bh(bmp);
      const turn = Math.abs(w - h) > 2 && Math.abs(iw - ih) > 2 && (iw > ih) !== (w > h);
      const W = turn ? h : w, H = turn ? w : h, sc = Math.min(W / iw, H / ih), dw = iw * sc, dh = ih * sc;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
      if (!turn) { ctx.drawImage(bmp, px + (w - dw) / 2, py + (h - dh) / 2, dw, dh); return; }
      ctx.save(); ctx.translate(px + w / 2, py + h / 2); ctx.rotate((rot === 3 ? -1 : 1) * Math.PI / 2); ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh); ctx.restore();
    };
    function drawBlds(m) {
      const symOk = view.s >= 6, fs = Math.max(10, Math.min(22, view.s * 1.6)), pics = view.s >= IMG_MIN;
      wallMasks(m);
      for (const b of m.buildings) {
        const w = Math.max(2, b.sx * view.s), h = Math.max(2, b.sz * view.s);
        const [px, py] = toPx(b.x - (b.sx - 1) / 2 - 0.5, b.z + (b.sz - 1) / 2 + 0.5);
        if (px > size.w || py > size.h || px + w < 0 || py + h < 0) continue;      // außerhalb des Bildes
        const ent = pics && b.def ? GFX.get('t_' + b.def, 'th', b.def) : null, col = HEX.test(b.col || '') ? b.col : null;
        let bmp = ent && ent.state === 'ok' ? ent.bmp : null;
        if (bmp && col) bmp = tinted(ent, col);
        if (b.k === 'wall') {                                                      // zusammenhängende Fläche: ganze Pixel, keine Fugen
          const x = Math.floor(px), y = Math.floor(py), ww = Math.ceil(px + w) - x, hh = Math.ceil(py + h) - y;
          if (bmp) { ctx.imageSmoothingEnabled = true; ctx.drawImage(bmp, x, y, ww, hh); }
          else {
            ctx.fillStyle = col || BLD.wall; ctx.fillRect(x, y, ww, hh);
            if (ww >= 8) {                                                         // Kante nur dort, wo keine Wand anschließt
              const mk = b._wm | 0, e = Math.max(1, Math.round(ww / 10)); ctx.fillStyle = col ? shade(col, 0.55) : '#2a2623';
              if (!(mk & 1)) ctx.fillRect(x, y, ww, e); if (!(mk & 2)) ctx.fillRect(x + ww - e, y, e, hh);
              if (!(mk & 4)) ctx.fillRect(x, y + hh - e, ww, e); if (!(mk & 8)) ctx.fillRect(x, y, e, hh);
            }
          }
          continue;
        }
        const on = selected?.t === 'b' && selected.id === b.id;
        if (bmp) {
          drawBldImg(bmp, px, py, w, h, b.rot);
          if (on) { ctx.lineWidth = 3; ctx.strokeStyle = '#d99a4e'; ctx.strokeRect(px - 1, py - 1, w + 2, h + 2); }
          continue;
        }
        if (b.k === 'fire') { ctx.font = Math.max(12, view.s * 2.4) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔥', px + view.s / 2, py + view.s / 2); continue; }
        ctx.fillStyle = BLD[b.k] || BLD.build;
        ctx.fillRect(px, py, w, h);
        if (on) { ctx.lineWidth = 3; ctx.strokeStyle = '#d99a4e'; ctx.strokeRect(px - 1, py - 1, w + 2, h + 2); }
        else if (w >= 5 && h >= 5) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.strokeRect(px + .5, py + .5, w - 1, h - 1); }
        const sym = BLD_SYM[b.k];
        if (sym && symOk && b.k !== 'bed') { ctx.font = fs + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(sym, px + w / 2, py + h / 2 + 1); }
        else if (sym && !symOk && w >= 4 && b.k !== 'bed') { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(px + w / 2 - 1.5, py + h / 2 - 1.5, 3, 3); }   // Punkt statt Symbol bei weitem Zoom
      }
    }

    function drawMap() {
      const m = mapObj(); if (!m) return;
      ctx.fillStyle = '#1d1b18'; ctx.fillRect(0, 0, size.w, size.h);
      const t = terrain.get(m.id);
      if (t) {
        const ps = view.s * t.step, [x0, y0] = toPx(-0.5, t.h * t.step - 0.5);       // Feld x belegt [x−0,5; x+0,5] – wie Figuren und Gebäude
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t.ov, x0, y0, t.w * ps, t.h * ps);
        if (t.idx && ps >= TILE_MIN) drawChunks(t, ps);
      }
      if (filt.blds) drawBlds(m);
      const fog = fogOf(m);
      if (fog) { drawFog(m, fog); drawFogMarks(fog); }
      const ps = filt.pawns ? m.pawns : [];
      const sel = findEnt(selected, m);
      // Wege (gestrichelt) und Nähe-Linien
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,.45)';
      const walkers = sel && (selected.t === 'a' || selected.t === 's') ? ps.concat([sel]) : ps;
      for (const p of walkers) if (p.dx != null) { const [a, b] = toPx(p.x, p.z), [c, d] = toPx(p.dx, p.dz); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
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
      const tag = (txt, px, py, r) => {
        ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const w = ctx.measureText(txt).width + 8;
        ctx.fillStyle = '#000b'; ctx.fillRect(px - w / 2, py + r + 2, w, 15);
        ctx.fillStyle = '#fff'; ctx.fillText(txt, px, py + r + 3);
      };
      const ring = (px, py, r, on, col) => { ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.lineWidth = on ? 3 : 2; ctx.strokeStyle = on ? '#d99a4e' : (col || '#000a'); ctx.stroke(); };
      const inView = (px, py) => px > -30 && py > -30 && px < size.w + 30 && py < size.h + 30;
      if (filt.strangers) for (const q of m.strangers || []) {
        const [px, py] = toPx(q.x, q.z), r = 9, on = sameSel(selected, { t: 's', id: q.id }), c = (REL[q.rel] || REL.other)[1];
        if (!inView(px, py)) continue;
        ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fillStyle = c; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(q.rel === 'enemy' ? '⚔' : '👤', px, py + 1);
        ring(px, py, r, on, '#000a');
        if (on || view.s >= 5) tag(q.name || q.label || '?', px, py, r);
      }
      if (filt.animals) for (const q of m.animals || []) {
        const [px, py] = toPx(q.x, q.z), r = 10, on = sameSel(selected, { t: 'a', id: q.id });
        if (!inView(px, py)) continue;
        ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.closePath(); ctx.fillStyle = '#4a5a3c'; ctx.fill(); ctx.clip();
        const im = animImg(q.kind);
        if (im) ctx.drawImage(im, px - r, py - r, 2 * r, 2 * r);
        else { ctx.fillStyle = '#e8e0c8'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🐾', px, py + 1); }
        ctx.restore();
        ring(px, py, r, on, '#8fd0a8');
        if (q.sleeping) { ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('💤', px + r - 3, py - r); }
        if (on || view.s >= 5) tag(q.name || q.label || '?', px, py, r);
      }
      for (const p of ps) {
        const [px, py] = toPx(p.x, p.z), r = 13;
        ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.closePath(); ctx.fillStyle = '#3a342c'; ctx.fill(); ctx.clip();
        const im = pawnImg(p.id);
        if (im) ctx.drawImage(im, px - r, py - r, 2 * r, 2 * r);
        else { ctx.fillStyle = '#ece4d6'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((p.name || '?')[0].toUpperCase(), px, py + 1); }
        ctx.restore();
        ring(px, py, r, sameSel(selected, { t: 'p', id: p.id }));
        if (p.sleeping) { ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText('💤', px + r - 4, py - r); }
        tag(p.name, px, py, r);
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
      const m = mapObj(), e = findEnt(selected, m);
      card.hidden = !e;
      const add = (...k) => k.flat(Infinity).forEach((c) => { if (c != null && c !== false) card.append(c); });
      if (!e) return;
      const bar = (label, v) => v == null ? null : el('div', { class: 'mp-need' }, el('span', {}, label), el('span', { class: 'mp-bar' }, el('i', { style: `width:${Math.max(2, Math.min(100, v))}%` })), el('span', { class: 'muted small' }, v + ' %'));
      const close = el('button', { type: 'button', class: 'mp-x', 'aria-label': 'Schließen', onclick: () => { selected = null; follow = false; clearTimeout(thingTimer); drawCard(); draw(); } }, '✕');
      const folgen = () => e.dx !== undefined || selected.t !== 'b' ? el('button', { type: 'button', class: 'mp-link mp-follow', 'aria-pressed': follow, onclick: () => { follow = !follow; if (follow) { view.x = e.x; view.z = e.z; } drawCard(); draw(); } }, follow ? '◉ Folge ich – aus' : '○ Folgen') : null;
      const pos = el('div', { class: 'small' }, 'Ort: ' + m.name + ' (' + e.x + ' / ' + e.z + ')');
      const xref = (id, name) => id ? el('a', { class: 'mp-link', href: '#/kolonie/' + encodeURIComponent(id) }, name || 'Kolonist') : el('span', {}, name || '?');
      if (selected.t === 'p') {
        const near = m.pawns.filter((q) => q.id !== e.id && Math.hypot(q.x - e.x, q.z - e.z) < NEAR);
        add(el('div', { class: 'mp-card-h' }, el('b', {}, e.name), close), folgen(),
          el('div', { class: 'small muted' }, (e.job || '') + (e.sleeping ? ' · schläft' : '')),
          bar('Hunger', e.food), bar('Durst', e.thirst), bar('Schlaf', e.rest), bar('Stimmung', e.mood), pos,
          el('div', { class: 'small' }, 'In der Nähe: ', near.length ? near.map((q, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'mp-link', onclick: () => pick({ t: 'p', id: q.id }, true) }, q.name)]) : 'niemand'));
      } else if (selected.t === 'a') {
        add(el('div', { class: 'mp-card-h' }, el('b', {}, '🐾 ' + (e.name || e.label || 'Tier')), close),
          el('div', { class: 'small muted' }, (e.name && e.label ? e.label + ' · ' : '') + (e.job || '') + (e.sleeping ? ' · schläft' : '')), folgen(),
          bar('Gesundheit', e.health), bar('Hunger', e.food),
          e.bondId || e.bondName ? el('div', { class: 'small' }, 'Gebunden an: ', xref(e.bondId, e.bondName)) : null,
          e.masterId ? el('div', { class: 'small' }, 'Meister: ', xref(e.masterId, m.pawns.find((q) => q.id === e.masterId)?.name)) : null, pos,
          el('div', { class: 'small' }, el('a', { class: 'mp-link', href: '#/kolonie' }, 'Kolonie › Tiere')));
      } else if (selected.t === 's') {
        const [rel, col] = REL[e.rel] || REL.other;
        add(el('div', { class: 'mp-card-h' }, el('b', {}, e.name || e.label || 'Fremde/r'), close),
          el('div', { class: 'small' }, el('span', { class: 'mp-rel', style: 'background:' + col }, rel), ' ' + (e.name && e.label ? e.label : '')), folgen(),
          e.faction ? el('div', { class: 'small' }, 'Gruppe: ' + e.faction) : null,
          e.job ? el('div', { class: 'small muted' }, e.job) : null, pos);
      } else {
        const t = thing && thing.id === e.id ? thing : null, i = t?.info;
        const q = i?.quality;
        add(el('div', { class: 'mp-card-h' }, el('b', {}, (i?.label || e.label || BLD_NAME[e.k] || 'Gebäude')), close),
          el('div', { class: 'small muted' }, BLD_NAME[e.k] || 'Gebäude'),
          !t || t.state === 'loading' ? el('div', { class: 'small muted' }, 'lädt …') : null,
          t?.state === 'none' ? el('div', { class: 'small muted' }, 'Keine Einzelheiten verfügbar.') : null,
          i?.hp != null && i.hpMax ? bar('Zustand', Math.round((i.hp / i.hpMax) * 100)) : null,
          q != null ? el('div', { class: 'small' }, 'Qualität: ' + (typeof q === 'number' ? (QUAL[q] || q) : q)) : null,
          i?.stuff ? el('div', { class: 'small' }, 'Material: ' + i.stuff) : null,
          i?.power ? el('div', { class: 'small' }, 'Strom: ' + i.power) : null,
          bar('Brennstoff', i?.fuel),
          i?.bills?.length ? el('div', { class: 'small' }, 'Aufträge:', el('ul', { class: 'mp-bills' }, i.bills.slice(0, 5).map((b) => el('li', {}, String(b))))) : null,
          i?.user ? el('div', { class: 'small' }, 'Gerade dran: ', xref(i.user.id, i.user.name)) : null, pos);
      }
    }

    function drawStrip() {
      if (!strip) return;
      clear(strip);
      for (const p of mapObj()?.pawns || []) {
        const b = el('button', { type: 'button', class: 'mp-chip' + (selected?.t === 'p' && selected.id === p.id ? ' on' : ''), onclick: () => pick({ t: 'p', id: p.id }, true) }, p.name);
        strip.append(b);
      }
    }

    function pick(sel, center) {
      selected = sel; follow = !!sel && sel.t !== 'b'; clearTimeout(thingTimer);
      if (sel?.t === 'b') fetchThing(sel.id); else thing = null;
      drawCard(); drawStrip();
      const p = findEnt(sel);
      if ((center || follow) && p) { view.x = p.x; view.z = p.z; }
      draw();
      if (sel && window.matchMedia('(max-width: 700px)').matches) cv.scrollIntoView({ block: 'start', behavior: 'smooth' });   // Handy: Infokarte verdeckt unten, Karte nach oben
    }

    // Treffertest in Bildpunkten: erst Figuren (großzügige 44-px-Fläche), dann Gebäude (mindestens 22 px Kantenlänge)
    function hit(px, py) {
      const m = mapObj(); if (!m) return null;
      let best = null, bd = 1e9;
      const test = (list, t, reach, bias) => { for (const q of list || []) { const [x, y] = toPx(q.x, q.z), d = Math.hypot(x - px, y - py) - bias; if (d < reach && d < bd) { bd = d; best = { t, id: q.id }; } } };
      if (filt.pawns) test(m.pawns, 'p', 24, 4);
      if (filt.strangers) test(m.strangers, 's', 22, 0);
      if (filt.animals) test(m.animals, 'a', 22, 0);
      if (best) return best;
      if (!filt.blds) return null;
      let area = 1e12;
      for (const b of m.buildings) {
        if (!b.id || b.k === 'wall') continue;
        const w = Math.max(22, b.sx * view.s), h = Math.max(22, b.sz * view.s), [cx, cy] = toPx(b.x, b.z);
        if (Math.abs(px - cx) <= w / 2 && Math.abs(py - cy) <= h / 2 && w * h < area) { area = w * h; best = { t: 'b', id: b.id }; }
      }
      return best;
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

    // Aufklappbare Legende: Figuren-Farben und Übersichtsfarben des Bodens
    const legend = () => {
      const dot = (css, txt, round = true) => el('li', {}, el('i', { class: 'mp-dot' + (round ? '' : ' sq'), style: 'background:' + css }), txt);
      const terr = [['g', 'Gras / Erde'], ['t', 'Wald'], ['s', 'Sand'], ['w', 'Flaches Wasser'], ['W', 'Tiefes Wasser'], ['r', 'Fels'], ['f', 'Gebauter Boden'], ['b', 'Brücke'], ['m', 'Schlamm / Sumpf'], ['i', 'Eis'], ['c', 'Kies']];
      const d = el('details', { class: 'mp-legend', open: legendOpen },
        el('summary', {}, 'Was bedeuten die Farben?'),
        el('div', { class: 'mp-leg-cols' },
          el('div', {}, el('b', { class: 'small' }, 'Figuren'), el('ul', {},
            dot('#3a342c', 'Kolonist (Porträt)'), dot('#4a5a3c', 'Haustier (grüner Ring)'), dot(REL.enemy[1], 'Feind'), dot(REL.guest[1], 'Gast / Händler'),
            dot(REL.prisoner[1], 'Gefangene / Sklaven'), dot(REL.other[1], 'Sonstige Fremde'))),
          el('div', {}, el('b', { class: 'small' }, 'Boden (Übersicht)'), el('ul', {}, terr.map(([k, n]) => dot(COLORS[k], n, false)))),
          el('div', {}, el('b', { class: 'small' }, 'Pflanzen (Übersicht)'), el('ul', {}, [['grass', 'Gras'], ['bush', 'Busch'], ['tree', 'Baum'], ['crop', 'Anbau'], ['other', 'Sonstige']].map(([k, n]) => dot(`rgb(${PL_COL[k][0]},${PL_COL[k][1]},${PL_COL[k][2]})`, n, false)))),
          el('div', {}, el('b', { class: 'small' }, 'Gebäude'), el('ul', {}, [['wall', 'Wand'], ['door', 'Tür'], ['bed', 'Bett'], ['bench', 'Werkbank'], ['table', 'Tisch'], ['storage', 'Lager'], ['other', 'Sonstiges']].map(([k, n]) => dot(BLD[k], n, false)))),
        ),
        el('p', { class: 'small muted' }, 'Ganz nah heranzoomen: dann siehst du den Boden und die Gebäude so wie im Spiel.'));
      d.addEventListener('toggle', () => { legendOpen = d.open; });
      return d;
    };

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
      const bar = which === 'world' ? null : el('div', { class: 'mp-filter', role: 'group', 'aria-label': 'Anzeigen' }, FILTERS.map(([k, label]) =>
        el('button', { type: 'button', class: 'mp-chip mp-fchip', 'aria-pressed': !!filt[k], onclick: (ev) => {
          filt[k] = !filt[k]; saveFilt(filt); if (k === 'plants') for (const t of terrain.values()) buildOverview(t); ev.currentTarget.setAttribute('aria-pressed', String(filt[k]));
          if (selected && !filt[{ p: 'pawns', a: 'animals', s: 'strangers', b: 'blds' }[selected.t]]) { selected = null; follow = false; clearTimeout(thingTimer); drawCard(); }
          draw();
        } }, label)));
      body.append(bar, el('div', { class: 'mp-wrap' }, cv, ctl, card), strip, which === 'world' ? null : legend());
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
        moved += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]); last = [e.clientX, e.clientY];
        if (follow && moved >= 6) { follow = false; drawCard(); }   // selbst verschoben: Folgen aus
        draw();
      });
      const up = (e) => {
        const wasTap = pts.size === 1 && moved < 6; pts.delete(e.pointerId); pinch = 0;
        if (!wasTap || which === 'world') return;
        const r = cv.getBoundingClientRect();
        pick(hit(e.clientX - r.left, e.clientY - r.top), false);
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = 0; });
      cv.addEventListener('wheel', (e) => { if (which === 'world') return; e.preventDefault(); view.s = Math.max(1, Math.min(24, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); draw(); }, { passive: false });
      if (ro) { ro.disconnect(); ro.observe(cv); }
      requestAnimationFrame(() => { resize(); drawStrip(); drawCard(); });
      if (which !== 'world') loadTerrain(which, mapObj()?.terrainVer);
    }

    const ro = window.ResizeObserver ? new ResizeObserver(() => { if (alive()) resize(); }) : null;
    const offPoll = live.poll({
      path: '/api/map', every: 2000, alive,
      onResult: (r) => {
        if (r.status !== 200 || !r.data || r.unchanged) { if (r.status === 503 && !data) clear(body), body.append(el('div', { class: 'empty' }, 'Die Karte wird gelesen …')); return; }
        const first = !data; data = r.data;
        infoTxt.textContent = (data.maps || []).reduce((n, m) => n + m.pawns.length + (m.animals?.length || 0) + (m.strangers?.length || 0), 0) + ' Figuren' + (data.maps?.some((m) => fogOf(m)) ? ' · dunkel = außerhalb der Sicht der Gruppe, ? = zuletzt gesehen' : '');
        if (first || !which || (which !== 'world' && !mapObj())) { which = location.hash.split('/')[2] === 'world' ? 'world' : (data.maps?.[0]?.id || 'world'); rebuild(); return; }
        if (follow && selected) { const fp = findEnt(selected); if (fp) { view.x = fp.x; view.z = fp.z; } }
        drawSubs(); drawStrip(); drawCard(); draw();
        if (which !== 'world') loadTerrain(which, mapObj()?.terrainVer);
      },
    });
    body.append(el('div', { class: 'empty' }, 'Lade Karte …'));
    const obs = new MutationObserver(() => { if (!alive()) { offPoll(); clearTimeout(thingTimer); cancelAnimationFrame(raf); ro?.disconnect(); obs.disconnect(); } });
    obs.observe(document.getElementById('view'), { childList: true });
  }
  return { html, bind };
}
