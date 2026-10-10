// Kleine Helfer: Escaping, RimWorld-Text, Kopieren, Hinweis-Einblendung.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** RimWorld-Text (<color=#..>, <b>, <i>) in sicheres HTML umwandeln. Alles andere wird entschärft. */
export function rich(text) {
  if (text == null) return '';
  let s = esc(String(text));
  s = s.replace(/&lt;color=#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?&gt;([\s\S]*?)&lt;\/color&gt;/g, '<span style="color:#$1">$2</span>');
  s = s.replace(/&lt;b&gt;([\s\S]*?)&lt;\/b&gt;/g, '<strong>$1</strong>');
  s = s.replace(/&lt;i&gt;([\s\S]*?)&lt;\/i&gt;/g, '<em>$1</em>');
  s = s.replace(/&lt;\/?[a-zA-Z][^&]*?&gt;/g, ''); // übrige Tags weg
  return s.replace(/\r?\n\r?\n/g, '</p><p>').replace(/\r?\n/g, '<br>');
}

/** Nur der Text ohne Formatierung (für Suche und kurze Zeilen). */
export function plain(text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function cap(s) {
  s = plain(s);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Name → Schreibweise für Befehle (klein, Unterstriche). */
export function slug(s) {
  return plain(s).toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').replace(/^_+|_+$/g, '');
}

// Alltagsbegriffe der Zuschauer -> was in den (teils englischen) Daten steht
const SYN = {
  kauf: ['buy', 'shop'], heil: ['heal', 'healpawn', 'medicine'], beleb: ['revive'], tot: ['revive', 'dead'],
  heirat: ['marry'], hochzeit: ['marry'], flirt: ['flirt'], kuss: ['flirt'], streit: ['duel', 'insult'],
  kampf: ['duel', 'attack', 'draft'], pruegel: ['duel'], prügel: ['duel'], schlag: ['duel'],
  wetter: ['weather'], regen: ['rain'], schnee: ['snow'], gewitter: ['thunder'],
  ueberfall: ['raid'], überfall: ['raid'], angriff: ['raid', 'attack'], raid: ['raid'],
  geld: ['coins', 'bal'], coin: ['coins', 'bal'], muenz: ['coins'], münz: ['coins'],
  farbe: ['dye', 'color'], haar: ['hair'], bart: ['beard'], haut: ['skin'], kopf: ['head'], tattoo: ['tattoo'],
  geschlecht: ['gender'], eigenschaft: ['trait'], wunsch: ['wants', 'wish'], ziel: ['goal', 'aspirations'],
  abstimm: ['vote'], pawn: ['pawn', 'mypawn'], kolonist: ['pawn', 'colonist'], waffe: ['weapon', 'equip'],
  kleid: ['wear', 'apparel'], essen: ['food', 'meal'], arbeit: ['work'], schlaf: ['sleep', 'work'],
  hilfe: ['help', 'militaryaid'], gen: ['gene', 'geneedit'], tier: ['animal'], operation: ['surgery'],
  join: ['join', 'queue'], beitret: ['join', 'queue'], mitspiel: ['join', 'queue'], warteschlange: ['queue', 'join'], anmeld: ['join'],
  bier: ['beer'], wein: ['wine'], medizin: ['medicine'], stahl: ['steel'], holz: ['wood'], silber: ['silver'], gold: ['gold'],
  gewehr: ['rifle'], pistole: ['pistol'], schwert: ['sword'], ruestung: ['armor', 'vest'], rüstung: ['armor', 'vest'],
  bett: ['bed'], droge: ['drug'], zigarett: ['smokeleaf'], fleisch: ['meat'], gemuese: ['vegetable'], gemüse: ['vegetable'],
  stoff: ['cloth'], leder: ['leather'], bauen: ['build'], nahrung: ['food'], mahlzeit: ['meal'],
};

/** Verzeihende Suche: Teilwörter, einfacher Wortstamm („heilen“ findet „heilt“), Alltagsbegriffe. */
export function makeMatcher(query) {
  const q = plain(query).toLowerCase();
  if (!q) return () => true;
  const terms = new Set([q]);
  // Deutscher Wortstamm: "heilen" -> "heil" (findet "heilt"). Der Rest muss mindestens 4 Buchstaben haben.
  for (const suf of ['en', 'er', 'st', 'e', 'n', 't']) {
    if (q.endsWith(suf) && q.length - suf.length >= 4) { terms.add(q.slice(0, -suf.length)); break; }
  }
  for (const [stem, extra] of Object.entries(SYN)) if (q.includes(stem) || (q.length >= 3 && stem.startsWith(q))) extra.forEach((x) => terms.add(x));
  const list = [...terms];
  return (hay) => { const h = String(hay).toLowerCase(); return list.some((t) => h.includes(t)); };
}

export const fmt = (n) => Number(n || 0).toLocaleString('de-DE');

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
export function toast(msg, ms = 1800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignorieren */ }
    ta.remove();
  }
  toast('Kopiert: ' + text);
}

/** Knopf, der einen Befehl beim Antippen kopiert. */
export function cmdBtn(text, extra = '') {
  return `<button type="button" class="cmd ${extra}" data-copy="${esc(text)}" title="Antippen zum Kopieren"><span class="txt">${esc(text)}</span><span class="copy" aria-hidden="true">⧉</span></button>`;
}

/** Knopf mit kurzem Text, der aber einen längeren Befehl kopiert (für Auswahllisten). */
export function pickBtn(label, command) {
  return `<button type="button" class="cmd pick-btn" data-copy="${esc(command)}" title="Kopiert: ${esc(command)}"><span class="txt">${esc(label)}</span></button>`;
}

export const KARMA = {
  Good: { cls: 'good', label: 'Gut', hint: 'Gutes Event: belohnt dein Karma.' },
  Neutral: { cls: 'neutral', label: 'Neutral', hint: 'Neutrales Event: weder gut noch schlecht.' },
  Bad: { cls: 'bad', label: 'Schlecht', hint: 'Schlechtes Event: kostet Karma.' },
  Doom: { cls: 'doom', label: 'Katastrophe', hint: 'Sehr gefährlich (Doom): kostet viel Karma.' },
};

export const karmaInfo = (k) => KARMA[k] || { cls: 'neutral', label: k && k !== 'None' ? k : 'Neutral', hint: '' };

export const karmaBadge = (k) => {
  const i = karmaInfo(k);
  return `<span class="badge ${i.cls}" title="${esc(i.hint)}">${esc(i.label)}</span>`;
};

export const days = (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`;
