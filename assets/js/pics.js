// Bilder für Items, Xenotypen und Rassen – ohne dauerndes Neuladen:
//  1. statisches Symbol data/icons/<key>.png (vom Knopf "Preisliste hochladen" erzeugt; nur laden, wenn es laut Liste existiert -> keine 404)
//  2. Live-Mod /api/img/<key> (nur wenn online)
//  3. kein Bild -> Platzhalter bleibt stehen
// Ergebnis je Schlüssel wird gemerkt: kein Flackern beim Neuzeichnen; Live-Bilder bis zu 3 Wiederholungen (3/6/12 s), dann aufgeben.
import * as live from './live.js';
import { imgUrl as liveImg } from './live-visual-b.js';

let known = {}; // key -> kurzer Hash (aus RICSExtras_Labels.json "icons")
const good = new Map();   // key -> url, die funktioniert hat
const bad = new Set();    // urls, die fehlgeschlagen sind

export function setIcons(map) { known = map && typeof map === 'object' ? map : {}; }
/** Gibt es ein exportiertes Symbol (data/icons) für den Schlüssel? */
export const hasStaticPic = (key) => known[key] !== undefined;

/** Mögliche Adressen in Reihenfolge der Vorzugs. */
function candidates(key) {
  const out = [];
  if (known[key] !== undefined) out.push(`data/icons/${encodeURIComponent(key)}.png?v=${encodeURIComponent(known[key])}`);
  if (live.isLive()) { const u = liveImg(key); if (u) out.push(u); }
  return out.filter((u) => !bad.has(u));
}

/**
 * Setzt in `el` (Platzhalter) ein <img>, sobald eines geladen ist. Der Platzhalter bleibt bis dahin sichtbar.
 * `el.dataset.pic` merkt den Stand: 'ok' (Bild drin), 'x' (nichts gefunden, nur nochmal versuchen wenn die Live-Mod neu online ist).
 */
export function fillPic(el, key, cls, size) {
  if (!el || !key || el.dataset.pic === 'ok') return;
  const make = (src) => { const img = new Image(); img.className = cls; img.alt = ''; img.width = size; img.height = size; img.decoding = 'async'; img.src = src; return img; };
  const done = good.get(key);
  if (done) { el.replaceChildren(make(done)); el.dataset.pic = 'ok'; return; }
  const list = candidates(key);
  if (!list.length) { el.dataset.pic = 'x'; return; }
  if (el.dataset.pic === 'try') return;
  el.dataset.pic = 'try';
  const next = (i) => {
    if (i >= list.length) { el.dataset.pic = 'x'; return; }
    const img = make('');
    img.addEventListener('load', () => { good.set(key, list[i]); el.replaceChildren(img); el.dataset.pic = 'ok'; }, { once: true });
    // Live-Bilder malt die Mod erst auf Anfrage (404 bis fertig, ohne Zwischenspeicher) -> nach 3, 6, 12 s erneut fragen
    let tries = 0;
    const isLiveUrl = list[i].includes('/api/img/');
    img.addEventListener('error', function onErr() {
      if (isLiveUrl && tries < 3 && live.isLive()) {
        const wait = 3000 * 2 ** tries++;
        setTimeout(() => { img.src = list[i] + (list[i].includes('?') ? '&' : '?') + 'r=' + tries; }, wait);
        img.addEventListener('error', onErr, { once: true });
        return;
      }
      bad.add(list[i]); next(i + 1);
    }, { once: true });
    img.src = list[i];
  };
  next(0);
}

/** Alle `[data-pickey]` unter host befüllen (Größe/Klasse aus data-pcls / data-psize). */
export function fillAll(host) {
  if (!host) return;
  host.querySelectorAll('[data-pickey]').forEach((el) => {
    if (el.dataset.pic === 'x' && !live.isLive()) return;
    if (el.dataset.pic === 'x') delete el.dataset.pic; // Live-Mod inzwischen online: noch einmal versuchen
    fillPic(el, el.dataset.pickey, el.dataset.pcls || 'pic-img', Number(el.dataset.psize) || 56);
  });
}

/** Platzhalter-Farbe aus dem Namen (stabil). */
export function hue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}
