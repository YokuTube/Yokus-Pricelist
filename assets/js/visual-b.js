// Paket B: Bausteine für die Preislisten-Seiten (Events, Wetter, Items, Eigenschaften, Rassen, Befehle) – Symbole statt Text.
// Nur HTML-Zeichenketten und Zuordnungstabellen; keine Abhängigkeit von der Live-Mod.
import { esc, fmt } from './util.js';

/** Preis als Münze + Zahl. */
export const coin = (n, cls = '') => `<span class="pcoin ${cls}" title="${esc(fmt(n))} Münzen"><i class="pc-ico" aria-hidden="true">🪙</i>${esc(fmt(n))}</span>`;
/** Wartezeit als Uhr + Zahl. */
export const clock = (txt, title = 'Wartezeit') => `<span class="pclock" title="${esc(title)}"><i aria-hidden="true">⏱</i>${esc(txt)}</span>`;

// ---------- Gut / Schlecht: farbiger Rand + Symbol ----------
export const KAR = {
  Good: { cls: 'good', sym: '▲', label: 'Gut', hint: 'Gut: belohnt dein Karma.' },
  Neutral: { cls: 'neutral', sym: '■', label: 'Neutral', hint: 'Neutral: weder gut noch schlecht.' },
  Bad: { cls: 'bad', sym: '▼', label: 'Schlecht', hint: 'Schlecht: kostet Karma.' },
  Doom: { cls: 'doom', sym: '☠', label: 'Katastrophe', hint: 'Katastrophe: sehr gefährlich, kostet viel Karma.' },
};
export const kar = (k) => KAR[k] || KAR.Neutral;
export const karSym = (k) => { const i = kar(k); return `<span class="kar-sym k-${i.cls}" role="img" aria-label="${esc(i.label)}" title="${esc(i.hint)}">${i.sym}</span>`; };

// ---------- Item-Kategorien: deutsche Namen + Symbol ----------
const CAT_DE = {
  Animals: 'Tiere', Apparel: 'Kleidung', Weapon: 'Waffen', Weapons: 'Waffen', Drugs: 'Drogen', Misc: 'Sonstiges', Medicine: 'Medizin',
  "Children's Apparel": 'Kinderkleidung', Food: 'Nahrung', Furniture: 'Möbel', Buildings: 'Gebäude', Items: 'Gegenstände', Manufactured: 'Hergestellt',
  'Raw Resources': 'Rohstoffe', Resources: 'Rohstoffe', Textiles: 'Textilien', Leather: 'Leder', Art: 'Kunst', Artifacts: 'Artefakte', Implants: 'Implantate',
  Special: 'Spezial', Books: 'Bücher', Mechs: 'Mechs', Plants: 'Pflanzen', Meat: 'Fleisch', Eggs: 'Eier', Apparels: 'Kleidung', Other: 'Sonstiges',
};
export const catDe = (c) => CAT_DE[c] || c;

const CAT_ICON = [
  [/waffe|munition|mörser|granat/i, '🔫'], [/kinderkleid/i, '🧒'], [/kleidung|rüstung|textil|wolle|stoff/i, '👕'], [/mahlzeit|nahrung|vegetar|pflanzlich|speise|essen/i, '🍽'],
  [/fleisch|monsterfleisch/i, '🥩'], [/^ei\b|eier|ei \(/i, '🥚'], [/fisch/i, '🐟'], [/medizin|booster|hygiene/i, '💊'], [/droge|entspann/i, '🌿'],
  [/tier/i, '🐾'], [/möbel|temperatur|sicherheit|strom|fabrik|produktion|trainingsger/i, '🪑'], [/stein|edelstein|juwel|facetten/i, '🪨'],
  [/rohstoff|metall|erz/i, '⛏'], [/leder/i, '🧶'], [/psytrainer|psy/i, '🧠'], [/fertigkeit|buch|bücher|forschung|techpl/i, '📚'], [/beute|schatz|truhe|kiste/i, '🎁'],
  [/hergestellt|produkt/i, '🏭'], [/bionisch|prothet|implantat|android|hybrid|archotech|mechtech|körperteil|teratogen/i, '🦾'], [/gen|archit|xeno|proben|wachstum/i, '🧬'],
  [/kunst|artefakt|reliquie|runen|talisman|schicksal/i, '🎨'], [/saat|samen|pflanz/i, '🌱'], [/mech/i, '🤖'], [/ghul/i, '🧟'], [/diverses|sonstiges|objekte|spezial|unfertig|abfall/i, '📦'],
];
export const catIcon = (c) => { for (const [re, e] of CAT_ICON) if (re.test(c || '')) return e; return '📦'; };

// ---------- Eigenschaften (Traits): gut / schlecht / neutral ----------
// Vanilla-Eigenschaften nach DefName[:Grad] (die Daten enthalten dafür keinen Wert); Mods: Vorzeichen der Wirkungen, sonst neutral.
const T_GOOD = new Set(['Kind', 'Nimble', 'FastLearner', 'GreatMemory', 'Tough', 'Industriousness:1', 'Industriousness:2', 'Nerves:1', 'Nerves:2', 'NaturalMood:1', 'NaturalMood:2', 'Beauty:1', 'Beauty:2',
  'Immunity:1', 'SpeedOffset:1', 'SpeedOffset:2', 'PsychicSensitivity:1', 'PsychicSensitivity:2', 'ShootingAccuracy:1']);
const T_BAD = new Set(['Abrasive', 'Greedy', 'Jealous', 'AnnoyingVoice', 'CreepyBreathing', 'Pyromaniac', 'Wimp', 'SlowLearner', 'Delicate', 'Industriousness:-1', 'Industriousness:-2', 'Nerves:-1', 'Nerves:-2',
  'NaturalMood:-1', 'NaturalMood:-2', 'Beauty:-1', 'Beauty:-2', 'Immunity:-1', 'SpeedOffset:-1', 'PsychicSensitivity:-1', 'PsychicSensitivity:-2', 'ShootingAccuracy:-1', 'DislikesMen', 'DislikesWomen',
  ]);
export function traitTone(t) {
  const k = `${t.defName}:${t.degree || 0}`;
  if (T_GOOD.has(k) || T_GOOD.has(t.defName)) return 'good';
  if (T_BAD.has(k) || T_BAD.has(t.defName)) return 'bad';
  const stats = Array.isArray(t.stats) ? t.stats : [];
  let p = 0, n = 0;
  for (const s of stats) { const x = String(s).trim(); if (/^[-−]/.test(x)) n++; else if (/^\+/.test(x)) p++; }
  if (p > n) return 'good';
  if (n > p) return 'bad';
  return 'neutral';
}
/** Veraltete/abgelegte Eigenschaften (z. B. „Abgelegter Titel“ aus einer früheren Mod-Version). */
export const traitLegacy = (t) => /^abgelegt|veraltet|obsolete|deprecated/i.test(t.name || '') || /früheren version|nicht mehr verwendet|veraltet/i.test(t.description || '');
export const TRAIT_SYM = { good: '▲', bad: '▼', neutral: '■' };
export const TRAIT_LABEL = { good: 'Eher vorteilhaft', bad: 'Eher nachteilig', neutral: 'Neutral / Geschmackssache' };

// ---------- Befehle: Symbol je Kategorie / Befehl ----------
const GROUP_ICON = [
  [/start|einstieg|loslegen|beitreten|join/i, '🚀'], [/kauf|shop|item|kaufen|einkauf/i, '🛒'], [/event|ereign/i, '⚡'], [/wetter/i, '🌦'], [/pawn|kolonist|charakter|figur/i, '🧑'],
  [/sozial|duell|mit anderen|kampf|interaktion/i, '💬'], [/abstimm|ziel|gemein|team/i, '🗳'], [/info|hilfe|abfrage|status|liste|münz|konto|bank/i, 'ℹ️'], [/mod|streamer|admin/i, '🛠'],
  [/aussehen|stil|farbe/i, '✂️'], [/tier|pet/i, '🐾'], [/spiel|spaß|casino|glück|slot/i, '🎰'],
];
export const groupIcon = (title, id) => { const h = `${title || ''} ${id || ''}`; for (const [re, e] of GROUP_ICON) if (re.test(h)) return e; return '❯'; };
const CMD_ICON = [
  [/^(buy|kaufen|pricecheck|price)/i, '🛒'], [/^(event|weather|wetter)/i, '⚡'], [/^(duel|attack|fight)/i, '⚔'], [/^(flirt|marry|romance|lovin)/i, '💘'], [/^(chitchat|deeptalk|buildrapport|reassure|insult)/i, '💬'],
  [/^(join|queue|leave|acceptpawn|pawn|mypawn)/i, '🧑'], [/^(bal|coins|gift|geschenk|donate|give)/i, '🪙'], [/^(vote|goal)/i, '🗳'], [/^(heal|revive|medic|healpawn)/i, '❤'], [/^(use|equip|wear)/i, '🎒'],
  [/^(sethair|setbeard|dyehair|setfav|skin|tattoo)/i, '✂️'], [/^(trait|addtrait|removetrait|replacetrait)/i, '⭐'], [/^(help|commands|lookup|list|info)/i, 'ℹ️'], [/^(wants|aspir|quirk)/i, '🎯'],
  [/^(slot|gamble|bet|wette)/i, '🎰'], [/^(lob|praise|nachhilfe|pate|forsch)/i, '👏'], [/^(work|prio)/i, '🔨'], [/^(gene|xeno|genderswap)/i, '🧬'],
];
export const cmdIcon = (cmd, groupTitle, groupId) => { for (const [re, e] of CMD_ICON) if (re.test(cmd || '')) return e; return groupIcon(groupTitle, groupId); };

/** Hängt der Beschreibungstext hinten den Mod-Namen an (so liefert ihn RimWorld), entfernen – der Name steht schon als Badge da. */
export function stripModTail(text, mod) {
  let t = String(text || '').trim();
  if (!t || !mod || mod === 'RimWorld') return t;
  const m = String(mod).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`\\s*${m}\\s*$`, 'i'), '').trim();
  return t;
}

/** Englischer Beschreibungstext aus einer Mod (keine Übersetzung vorhanden)? Dann lieber weglassen als Englisch zu zeigen. */
export function looksEnglish(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-zäöüß' ]+/g, ' ')} `;
  const en = (t.match(/ (the|and|of|is|are|with|that|to|in|for|will|can|from|by|this|their|which|an|it|its|be|as|on|or) /g) || []).length;
  const de = (t.match(/ (der|die|das|und|ist|sind|mit|von|zu|im|für|wird|kann|den|dem|ein|eine|nicht|auf|oder|sich|es|des) /g) || []).length;
  return en >= 2 && en > de * 2;
}
