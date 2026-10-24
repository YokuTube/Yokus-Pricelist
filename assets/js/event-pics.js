// Bilder für Events und Wetter. RimWorld hat dafür keine eigenen Bilder -> passendes Spielsymbol (data/icons/t_<Def>.png,
// Tabelle + Namens-Suche) oder, wenn keins passt, ein großes Symbol auf farbigem Kreis in der Karma-Farbe. Nie leer.
// eventPic()/weatherPic() liefern HTML; danach pics.fillAll(host) aufrufen (macht main.js/pager/Abstimmung).
import { hasStaticPic } from './pics.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Werte der Tabelle sind ThingDef-Namen (-> t_<Def>) oder schon fertige Schlüssel wie x_Baseliner (Xenotyp-Symbol)
const full = (d) => (/^(x|r|tr)_/.test(d) ? d : 't_' + d);
const has = (d) => !!d && hasStaticPic(full(d));

// ---- 1. feste Zuordnung Event -> Spielsymbol (nur genutzt, wenn der Schlüssel existiert) ----
const MAP = {
  ThrumboPasses: 'Thrumbo', Alphabeavers: 'Alphabeaver', VEE_Alphabeavers: 'Alphabeaver',
  Infestation: 'Megaspider', Infestation_Jelly: 'InsectJelly', DeepDrillInfestation: 'Megaspider', VEE_Infestation: 'Megaspider', InfestationPurple: 'Megaspider',
  VFEI_LargeInfestation: 'VFEI2_RoyalMegaspider', VFEI_RoamingInsectoids: 'Megascarab', VFEI_BurrowSiege: 'Spelopede', VFEI_HordeWaveRaid: 'Megascarab',
  AA_Incident_BlackHive: 'AA_BlackSpelopede', AA_Incident_Bumbledrones: 'AA_Bumbledrone', WastepackInfestation: 'WastepackAtomizer', LE_RatInfestation: 'Rat',
  ShipChunkDrop: 'ShipChunk_Mech', VME_JunkChunkDrop: 'ShipChunk_Mech', VFEI_InfestedChunkCrash: 'VFEI2_InfestedShipChunk', VFEI_InfestedPartCrash: 'VFEI2_InfestedShipPart',
  VFEI_InfestedModuleCrash: 'VFEI2_InfestedShipPart', VRE_FungoidShipPartCrash: 'VRE_InfestedShipPart_Spawned',
  ResourcePodCrash: 'TransportPod', AA_ResourcePodCrash: 'TransportPod', RefugeePodCrash: 'TransportPod', RefugeePodCrash_Baby: 'TransportPod', RefugeePodCrash_Ghoul: 'TransportPod',
  VEE_AnimalPodCrash: 'TransportPod', AA_CactipineDropPod: 'TransportPod', VEE_Cargopodsweapons: 'TransportPod', VEE_Cargopodsapparel: 'TransportPod',
  LE_CargoPodsWastepack: 'TransportPod', MysteriousCargoCube: 'GoldenCube', GoldenCubeArrival: 'GoldenCube',
  MeteoriteImpact: 'VEE_ObsidianChunk', VEE_MeteoriteShower: 'VEE_ObsidianChunk', RotR_MeteorShower: 'VEE_ObsidianChunk', AA_Incident_SkyMeteorite: 'VEE_ObsidianChunk',
  VPE_EltexMeteorite: 'VEE_ObsidianChunk', OrbitalDebris: 'ShipChunk_Mech', VEE_SpaceBattle: 'ShipChunk_Mech',
  DefoliatorShipPartCrash: 'VFEP_ShipChunkReactor', PsychicEmanatorShipPartCrash: 'PsychicAmplifier', LE_ShipCrash: 'ShuttleCrashed', VEE_ShuttleCrash: 'VEE_Shuttle', VEE_Crashlanded: 'VEE_Shuttle',
  MechCluster: 'Mech_Lancer', GiveQuest_MechanoidSignal: 'Mech_Pikeman', LE_MechanoidOverclock: 'MechBooster', LE_MechanoidThrottling: 'MechBooster', LE_FireSupportBase: 'Mech_Scyther', LE_ForwardOperatingBase: 'Mech_Militor',
  OrbitalTraderArrival: 'OrbitalTradeBeacon', TraderCaravanArrival: 'Silver', CaravanMeeting: 'Silver', LE_BlackMarket: 'Gold', LE_SilverShower: 'Silver', ProtectionFee: 'Silver', ProtectionFeeLTS: 'Silver', RansomDemand: 'Silver', CaravanDemand: 'Silver',
  LE_Gift: 'Gold', CaravanArrivalTributeCollector: 'Silver',
  RaidEnemy: 'Gun_AssaultRifle', RaidFriendly: 'Gun_AssaultRifle', Ambush: 'Gun_Autopistol', RaidEnemyPurple: 'Gun_AssaultRifle', LE_RaidEnemy_SanguophageHunter: 'Gun_AssaultRifle',
  VEE_VisitorGroupRaid: 'Gun_Autopistol', VFEM_PillageRaid: 'MeleeWeapon_LongSword', VFED_Raid_Absolver: 'Gun_BoltActionRifle', VFED_ImperialPatrol: 'Gun_BoltActionRifle', VEE_HuntingParty: 'Bow_Short',
  Sabotage: 'Gun_Autopistol', Thief: 'Gun_Autopistol', Brawl: 'MeleeWeapon_LongSword', Quarrel: 'MeleeWeapon_LongSword', FriendsQuarrel: 'MeleeWeapon_LongSword',
  Disease_Flu: 'MedicineIndustrial', Disease_Plague: 'MedicineIndustrial', Disease_Malaria: 'MedicineIndustrial', Disease_SleepingSickness: 'MedicineIndustrial', Disease_FibrousMechanites: 'MedicineUltratech',
  Disease_SensoryMechanites: 'MedicineUltratech', Disease_GutWorms: 'MedicineIndustrial', Disease_MuscleParasites: 'MedicineIndustrial', Disease_AnimalFlu: 'MedicineHerbal', Disease_AnimalPlague: 'MedicineHerbal',
  Disease_OrganDecay: 'MedicineIndustrial', Disease_Abasia: 'MedicineIndustrial', Disease_BloodRot: 'MedicineIndustrial', LE_Disease_BionicPlague: 'MedicineUltratech', LE_Disease_DancingPlague: 'MedicineIndustrial',
  LE_MedicineSpoiled: 'MedicineIndustrial', GillRot: 'MedicineHerbal',
  AmbrosiaSprout: 'Ambrosia', BoomshroomSprout: 'Boomalope', LE_AnimaBloom: 'Neurotrainer_Plants', VEE_CropSprout: 'Hay', LE_NutrientRain: 'Hay', VEE_FertileRains: 'Hay',
  FarmAnimalsWanderIn: 'Cow', VEE_CaravanAnimalsWanderIn: 'Dromedary', VEE_BattleAnimalsWanderIn: 'Wolf_Timber', HerdMigration: 'Muffalo', VEE_MigratoryHerds: 'Muffalo', SelfTame: 'Deer',
  ManhunterPack: 'Wolf_Timber', ManhunterAmbush: 'Wolf_Timber', ManhunterPackPurple: 'Wolf_Timber', VEE_ManhunterSingleArrival: 'Bear_Grizzly', AnimalInsanityMass: 'Boomrat', AnimalInsanitySingle: 'Boomrat', AnimalInsanityMassPurple: 'Boomrat',
  LE_PredatorPasses: 'Wolf_Great', AA_BehemothPasses: 'Elephant', AA_Incident_Gallatross: 'Elephant', FrenziedAnimals: 'Boomrat', GR_ManhunterMonstrosities: 'Bear_Grizzly',
  WandererJoin: 'x_Baseliner', WildManWandersIn: 'x_Baseliner', WanderersSkylantern: 'x_Baseliner', GameEndedWanderersJoin: 'x_Baseliner', VisitorGroup: 'x_Baseliner', TravelerGroup: 'x_Baseliner', SW_Visitors: 'x_Baseliner',
  PsychicSoothe: 'PsychicAmplifier', PsychicDrone: 'PsychicAmplifier', VEE_PsychicStimulation: 'PsychicAmplifier', VEE_PsychicOverdrive: 'PsychicAmplifier', VEE_PsychicHum: 'PsychicAmplifier',
  Revenant: 'RevenantSpine', UV_Revenant: 'RevenantSpine', RevenantEmergence: 'RevenantSpine', MysteriousCargoRevenantSpine: 'RevenantSpine', LE_Mimic: 'LE_Mimic',
  AnimaTreeSpawn: 'Neurotrainer_Plants', GauranlenPodSpawn: 'Neurotrainer_Plants', LE_GauranlenBloom: 'Neurotrainer_Plants', LE_RiseTrees: 'Neurotrainer_Plants', LE_RiseTreesInitial: 'Neurotrainer_Plants', LE_MigratingForests: 'Neurotrainer_Plants',
  LE_ResearchBreakthrough: 'Neurotrainer_Intellectual', LE_SuddenEpiphany: 'Neurotrainer_Intellectual', LE_MassInspiration: 'Neurotrainer_Artistic', LE_ArtisticRenaissance: 'Neurotrainer_Artistic', LE_UnexpectedMineralSeams: 'Steel',
};

// ---- 2. Namens-Suche: Wörter aus defName/Name gegen vorhandene t_-Schlüssel ----
const PREFIX = /^(?:VEE|VPE|VFEI|VFED|VFEM|VFEE|VFEP|VRE|VREA|VME|VQE|VSIE|LE|AA|GR|UV|PS|RotR|TI|VFEC|VFET|Isekai|IOUM|CBC|SW|GiveQuest|Incident)_/;
const STOP = new Set('pod group the of and quest random event incident mass single initial drop arrival attack assault raid join spawn passes wander wanders big small blood storm rain cargo chunk ship sprout tree power'.split(' '));
function nameKeys(defName, name) {
  const out = [];
  const base = String(defName || '').replace(PREFIX, '').replace(PREFIX, '');
  const parts = base.split(/[_\s]+/).flatMap((p) => p.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || []);
  const sing = (w) => w.replace(/ies$/, 'y').replace(/s$/, '');
  for (let n = parts.length; n >= 1; n--) {
    for (let i = 0; i + n <= parts.length; i++) {
      const seq = parts.slice(i, i + n);
      if (n === 1 && (seq[0].length < 4 || STOP.has(seq[0].toLowerCase()))) continue;
      const j = seq.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
      out.push(j, sing(j));
    }
  }
  for (const w of String(name || '').split(/[^A-Za-z]+/)) {
    if (w.length >= 4 && !STOP.has(w.toLowerCase())) { const j = w[0].toUpperCase() + w.slice(1).toLowerCase(); out.push(j, sing(j)); }
  }
  return out;
}
const cache = new Map();
function gamePic(defName, name) {
  const ck = defName + '|' + name;
  if (cache.has(ck)) return cache.get(ck);
  let r = null;
  const m = MAP[defName] || MAP[String(defName).replace(PREFIX, '')];
  if (has(m)) r = m;
  if (!r && has(defName)) r = defName;
  if (!r) r = nameKeys(defName, name).find(has) || null;
  cache.set(ck, r);
  return r;
}

// ---- 3. Ersatzsymbole (Emoji) nach Thema ----
const EV_EMO = [
  [/disease|plague|flu\b|malaria|sickness|worms|parasite|rot\b|decay|mechanites|bionic|dancing/, '🦠'],
  [/psychic|psycho|psyche|mind|epiphany|inspiration|echo|hum\b|soothe|calm|aggression/, '🧠'],
  [/infest|insect|jelly|hive|scarab|spider|rat\b/, '🐛'],
  [/mech|drone|cluster|centipede|transponder|overclock/, '🤖'],
  [/meteor|asteroid|debris/, '☄️'], [/crash|pod|shuttle|ship|cargo|drop/, '🚀'],
  [/raid|siege|ambush|assault|attack|sapper|invasion|battle|hunt|brawl|quarrel|sabotage|thief|pillage|patrol|absolver|horde/, '⚔️'],
  [/manhunter|insanity|animal|herd|migrat|thrumbo|beaver|tame|predator|behemoth|alpha/, '🦌'],
  [/trader|caravan|trade|silver|market|fee|ransom|tribute|economic|supply|shower/, '💰'],
  [/refugee|wander|join|visitor|traveler|stranger|defect|recruit|settler|abasia/, '🧑'],
  [/fire|heat|scorch|swelter|flame|lava|volcan|ember|burn|inferno|short.?circuit|power/, '🔥'],
  [/flash|lightning|thunder|solar|flare|emp\b|electric|dielectric|magnetic|surge/, '⚡'],
  [/toxic|fallout|haze|poison|gas|noxious|spore|neurotoxin|blight/, '☠️'],
  [/eclipse|dark|night|void|shadow|pall|obelisk|monolith|pit|shambler|ghoul|flesh|gore|devour|chimera|metalhorror|nocio|death|unnatural|blood|creep|harbinger|cube/, '🌘'],
  [/aurora|bloom|light|glow|stellar/, '🌌'],
  [/gift|reward|quest|bonus|miracle|breakthrough|renaissance|reputation|seam/, '🎁'],
  [/cold|snow|winter|frost|freeze|ice|blizzard|whiteout/, '🥶'],
  [/drought|dry|famine/, '🏜️'], [/flood|tide|tidal/, '🌊'], [/earthquake|tremor|gravity|dimension|jitter|subatomic/, '🌋'],
  [/tree|plant|sprout|crop|garden|fertile|vegetat|forest|rise/, '🌱'],
];
const EV_DEFAULT = { Good: '🎁', Neutral: '🎲', Bad: '⚠️', Doom: '☠️' };
const words = (defName, name) => (String(defName).replace(/([a-z])([A-Z])/g, '$1 $2') + ' ' + (name || '')).toLowerCase();
function evEmoji(defName, name, karma) {
  const s = words(defName, name);
  for (const [re, e] of EV_EMO) if (re.test(s)) return e;
  return EV_DEFAULT[karma] || '🎲';
}

const WE_EMO = [
  [/tox|acid|poison/, '☣️'], [/blood/, '🩸'], [/psychic/, '🧠'],
  [/hurricane|tornado|cyclone/, '🌪️'], [/blizzard|whiteout/, '🌨️'], [/snow|schnee|hail/, '❄️'],
  [/thunder|gewitter|lightning|storm/, '⛈️'], [/torrent|downpour|heavy.?rain/, '🌧️'], [/foggy.?rain|drizzle/, '🌦️'], [/rain|regen/, '🌧️'],
  [/sand|dust|dry|desert/, '🏜️'], [/fog|mist|nebel|dunst/, '🌫️'], [/wind/, '💨'],
  [/inferno|swelter|heat|hitze|fire|feuer|scorch/, '🔥'], [/long.?night|dark|night|nacht|umbra/, '🌑'],
  [/overcast|cloud|bewölkt|wolk|gray|grey|pall/, '☁️'], [/fertile/, '🌱'], [/clear|sun|klar|sonn/, '☀️'],
];
const WE_DEFAULT = { Good: '🌤️', Neutral: '⛅', Bad: '🌩️', Doom: '🌪️' };
function weEmoji(defName, name, text) {
  const s = words(defName, name);
  for (const [re, e] of WE_EMO) if (re.test(s)) return e;
  const t = String(text || '').toLowerCase();
  for (const [re, e] of WE_EMO) if (re.test(t)) return e;
  return null;
}

const KCLS = { Good: 'good', Neutral: 'neutral', Bad: 'bad', Doom: 'doom' };
function wrap(kind, karma, emo, key, size, label) {
  const k = KCLS[karma] || 'neutral';
  const data = key ? ` data-pickey="${esc(full(key))}" data-pcls="evp-img" data-psize="${Math.round(size * 0.78)}"` : '';
  return `<span class="evp evp-${kind} k-${k}${key ? ' has-pic' : ''}" style="--evp:${size}px" role="img" aria-label="${esc(label || '')}"${data}><i class="evp-emo" aria-hidden="true">${emo}</i></span>`;
}

/** Bild für ein Event: Spielsymbol, sonst Themen-Emoji auf Karma-Kreis. */
export function eventPic(defName, name, karma, size = 52) {
  return wrap('event', karma, evEmoji(defName, name, karma), gamePic(defName, name), size, name || defName);
}
/** Bild für eine Wetterlage: immer ein Wettersymbol (RimWorld hat dafür keine Bilder). */
export function weatherPic(defName, name, karma, size = 52, text = '') {
  return wrap('weather', karma, weEmoji(defName, name, text) || WE_DEFAULT[karma] || '⛅', null, size, name || defName);
}
// Abstimmungsoptionen kennen oft nur den Anzeigenamen -> über die Datenlisten (Events/Wetter) auf defName+Karma zurückführen.
const byLabel = new Map();
const nk = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
export function setEventIndex(events = [], weather = []) {
  byLabel.clear();
  for (const [list, kind] of [[events, 'event'], [weather, 'weather']]) {
    for (const e of list) for (const n of [e.label, e.de, e.defName]) { const k = nk(n); if (k && !byLabel.has(k)) byLabel.set(k, { defName: e.defName, karma: e.karma, kind, text: e.text }); }
  }
}
/** Für Abstimmungsoptionen (Art unbekannt): per Name in Events/Wetter suchen, sonst Wetter-Stichwort, sonst Event. */
export function optionPic(defName, name, karma, size = 40, text = '') {
  const hit = byLabel.get(nk(defName)) || byLabel.get(nk(name));
  if (hit) return hit.kind === 'weather' ? weatherPic(hit.defName, name, hit.karma, size, hit.text) : eventPic(hit.defName, name, hit.karma, size);
  const d = String(defName || name || '');
  const isWeather = /^LE_ForceWeather_|^Weather/i.test(d) || (!gamePic(d, name) && /\b(weather|wetter)\b/i.test(`${name} ${text}`));
  return isWeather ? weatherPic(d, name, karma, size, text) : eventPic(d, name, karma, size);
}
