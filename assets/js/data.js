// Lädt die JSON-Dateien aus data/ und bringt sie in eine einheitliche Form.
import { plain, cap } from './util.js';

const MODS_CORE = new Set(['Core', 'RimWorld']);
export const modName = (m) => (!m || MODS_CORE.has(m) ? 'RimWorld' : m);

async function getJson(url, version) {
  const u = version ? `${url}?v=${encodeURIComponent(version)}` : url;
  const res = await fetch(u, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadAll() {
  let meta = null;
  try { meta = await getJson('data/meta.json'); } catch { /* optional */ }
  const v = meta?.updatedAt || '';
  const files = {
    items: 'data/StoreItems.json', events: 'data/Incidents.json', weather: 'data/Weather.json',
    traits: 'data/Traits.json', races: 'data/RaceSettings.json', mods: 'data/ActiveMods.json',
    cmdSettings: 'data/CommandSettings.json', cmdDocs: 'data/commands.json', notes: 'data/event-notes.json',
    choices: 'data/choices.json', picks: 'data/picks.json',
  };
  const out = { meta, failed: [] };
  await Promise.all(Object.entries(files).map(async ([key, url]) => {
    try { out[key] = await getJson(url, v); }
    catch (e) { console.warn('Laden fehlgeschlagen:', url, e); out[key] = null; out.failed.push(url); }
  }));

  const notes = out.notes || { names: {}, events: {}, weather: {}, types: {} };
  // Namen, wie das Spiel sie anzeigt (bei Andreas Deutsch) – exportiert von RICS Extras beim Hochladen; optional.
  let labels = {};
  try { labels = (await getJson('data/RICSExtras_Labels.json', v)) || {}; } catch { /* gibt es erst nach dem ersten Upload */ }
  return {
    meta,
    failed: out.failed,
    items: processItems(out.items, labels.items || {}),
    events: processEvents(out.events, notes, labels.events || {}),
    weather: processWeather(out.weather, notes, labels.weather || {}),
    traits: processTraits(out.traits),
    races: processRaces(out.races),
    mods: processMods(out.mods),
    commands: processCommands(out.cmdDocs, out.cmdSettings),
    choices: out.choices || {},
    picks: out.picks || {},
  };
}

// ---------- Namen für Befehle ----------
// Spieler tippen einfach "!buy beer 5". Wir nehmen deshalb den lesbaren Namen (klein, Leerzeichen -> _),
// solange er eindeutig und unkompliziert ist. Sonst den technischen DefName (der geht immer).
function assignCmdNames(list, labelOf) {
  // RICS sucht Items per Name OHNE Leerzeichen (graniteblocks) oder exaktem DefName. Leerzeichen raus, Satzzeichen bleiben;
  // bei ungewöhnlichen Zeichen oder doppelten Namen den DefName nehmen (der passt immer, auch mit Unterstrich).
  const simple = (s) => (/^[A-Za-z0-9ÄÖÜäöüß '\-.]+$/.test(s.trim()) ? s.trim().toLowerCase().replace(/ +/g, '') : '');
  const counts = new Map();
  list.forEach((x) => { const t = simple(plain(labelOf(x))); if (t) counts.set(t, (counts.get(t) || 0) + 1); });
  list.forEach((x) => {
    const t = simple(plain(labelOf(x)));
    x.cmdName = t && counts.get(t) === 1 ? t : x.defName;
  });
}

// ---------- Items ----------
function processItems(raw, game = {}) {
  const obj = raw?.items ?? raw ?? {};
  const all = Object.entries(obj).map(([key, d]) => ({
    defName: d.DefName || key,
    // Spielname (Deutsch) zuerst: RICS findet Items auch über den aktuellen Spielnamen ohne Leerzeichen (!buy granitblöcke)
    name: cap(game[d.DefName || key] || d.CustomName || d.DefName || key),
    price: d.BasePrice || 0,
    category: plain(d.Category) || 'Sonstiges',
    limit: d.HasQuantityLimit ? (d.QuantityLimit || 0) : 0,
    mod: modName(d.Mod),
    usable: !!d.IsUsable, equippable: !!d.IsEquippable, wearable: !!d.IsWearable,
    enabled: d.Enabled !== false,
    active: d.modactive === true,
  })).filter((i) => i.active && i.price > 0);
  assignCmdNames(all, (i) => i.name);
  // "available" = der Streamer verkauft es gerade; den Rest merken wir uns, um erklären zu können, warum etwas fehlt.
  all.forEach((i) => { i.available = i.enabled || i.usable || i.equippable || i.wearable; });
  return all;
}

// ---------- Events & Wetter ----------
function eventType(d) {
  const cat = d.CategoryName || '';
  if (d.IsQuestIncident || cat === 'GiveQuest') return 'quest';
  if (d.IsDiseaseIncident || cat.startsWith('Disease')) return 'disease';
  if (d.IsWeatherIncident) return 'weather';
  if (cat === 'FactionArrival' || cat === 'OrbitalVisitor') return 'visitors';
  if (cat === 'ThreatBig') return d.IsRaidIncident ? 'raid' : 'threat_big';
  if (cat === 'ThreatSmall') return 'threat_small';
  return 'misc';
}

export const EVENT_TYPES = {
  raid: 'Überfall', disease: 'Krankheit', weather: 'Wetter', quest: 'Quest', visitors: 'Besucher',
  threat_big: 'Große Gefahr', threat_small: 'Kleine Gefahr', misc: 'Ereignis',
};

function processEvents(raw, notes, game = {}) {
  const list = Object.entries(raw || {}).map(([key, d]) => {
    const defName = d.DefName || key;
    const type = eventType(d);
    const own = plain(d.Description || '');
    return {
      defName,
      label: game[defName] || d.Label || defName,
      de: notes.names?.[defName] || '',
      cost: d.BaseCost || 0,
      karma: d.KarmaType || 'Neutral',
      mod: modName(d.ModSource),
      cooldownDays: d.CooldownDays || 0,
      uses: d.UsesPerCooldownPeriod || 1,
      type,
      text: notes.events?.[defName] || (own && own.length <= 240 ? own : '') || (type === 'misc' ? '' : notes.types?.[type] || ''),
      fromNotes: !!notes.events?.[defName],
      enabled: d.Enabled !== false,
      active: d.modactive === true,
    };
  }).filter((e) => e.active && e.enabled && e.cost > 0);
  // RICS sucht Events nur über den internen Namen oder den gespeicherten ENGLISCHEN Namen -> Befehl immer mit DefName
  list.forEach((e) => { e.cmdName = e.defName; });
  return list;
}

function processWeather(raw, notes, game = {}) {
  const list = Object.entries(raw || {}).map(([key, d]) => {
    const defName = d.DefName || key;
    return {
      defName,
      label: game[defName] || d.Label || defName,
      cost: d.BaseCost || 0,
      karma: d.KarmaType || 'Neutral',
      mod: modName(d.ModSource),
      text: notes.weather?.[defName] || plain(d.Description) || notes.types?.weather || '',
      enabled: d.Enabled !== false,
      active: d.modactive === true,
    };
  }).filter((w) => w.active && w.enabled && w.cost > 0);
  list.forEach((w) => { w.cmdName = w.defName; }); // wie bei Events: DefName passt immer
  return list;
}

// ---------- Traits ----------
const PRON = [
  [/[{[]PAWN_nameDef[}\]]/g, 'Dein Pawn'], [/[{[]PAWN_name[}\]]/g, 'Dein Pawn'], [/[{[]PAWN_label[}\]]/g, 'Dein Pawn'],
  [/[{[]PAWN_def[}\]]/g, 'Dein Pawn'], [/[{[]PAWN_pronoun[}\]]/g, 'er/sie'], [/[{[]PAWN_possessive[}\]]/g, 'sein/ihr'],
  [/[{[]PAWN_objective[}\]]/g, 'ihn/sie'],
];

function processTraits(raw) {
  return Object.entries(raw || {}).map(([key, d]) => {
    let desc = String(d.Description || '');
    PRON.forEach(([re, to]) => { desc = desc.replace(re, to); });
    return {
      defName: d.DefName || key,
      name: d.Name || d.DefName || key,
      description: desc,
      stats: Array.isArray(d.Stats) ? d.Stats : [],
      conflicts: Array.isArray(d.Conflicts) ? d.Conflicts : [],
      canAdd: !!d.CanAdd, canRemove: !!d.CanRemove,
      addPrice: d.AddPrice || 0, removePrice: d.RemovePrice || 0,
      bypassLimit: !!d.BypassLimit,
      mod: modName(d.ModSource),
      active: d.modactive === true,
    };
  }).filter((t) => t.active && (t.canAdd || t.canRemove) && (t.addPrice > 0 || t.removePrice > 0));
}

// ---------- Rassen ----------
function processRaces(raw) {
  return Object.entries(raw || {}).map(([key, d]) => {
    const prices = d.XenotypePrices || {};
    const enabled = d.EnabledXenotypes || {};
    const xenos = Object.keys(enabled).filter((x) => enabled[x] && prices[x] !== undefined)
      .map((x) => ({ name: x, price: Math.round(prices[x]) }))
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    const g = d.AllowedGenders || {};
    return {
      key,
      name: d.DisplayName || key,
      price: Math.round(d.BasePrice || 0),
      minAge: d.MinAge || 0,
      maxAge: d.MaxAge >= 999999 ? null : d.MaxAge,
      male: !!g.AllowMale, female: !!g.AllowFemale, other: !!g.AllowOther,
      customXeno: !!d.AllowCustomXenotypes,
      xenos,
      enabled: d.Enabled !== false && d.ModActive !== false,
    };
  }).filter((r) => r.enabled).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Mods ----------
function processMods(raw) {
  return (raw?.mods || []).map((m) => ({
    name: plain(m.name) || 'Unbenannt', author: m.author || '', steamId: m.steamId || '', version: m.version || '',
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Befehle: gepflegte Beschreibung + Live-Einstellungen aus RICS ----------
const PERM = { everyone: 'Alle', subscriber: 'Subs', vip: 'VIPs', moderator: 'Mods', broadcaster: 'Streamer' };

function processCommands(docs, settings) {
  if (!docs) return { groups: [], list: [] };
  const live = settings || {};
  const list = (docs.commands || []).map((c) => {
    const s = live[c.cmd];
    return {
      ...c,
      known: !!s,
      enabled: s ? s.Enabled !== false : true,
      perm: s?.PermissionLevel || (c.group === 'mod' ? 'moderator' : 'everyone'),
      permLabel: PERM[s?.PermissionLevel || (c.group === 'mod' ? 'moderator' : 'everyone')] || (s?.PermissionLevel || ''),
      alias: s?.CommandAlias || '',
      cooldown: s?.CooldownSeconds || 0,
      cost: s?.SupportsCost && s.Cost > 0 ? s.Cost : 0,
    };
  });
  return { groups: docs.groups || [], list };
}
