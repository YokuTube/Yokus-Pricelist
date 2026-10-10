// Eigene, einfache Linien-Icons (kein Spielmaterial). Farbe kommt aus der Textfarbe.
const P = {
  start: '<path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1.3-.5-2-1-3 2 1 4 3.2 4 6a6 6 0 0 1-12 0c0-5 4-6.500 6-11z"/><path d="M4 21h16"/>',
  befehle: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.500h8M8 12.500h5"/>',
  items: '<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>',
  events: '<path d="M13 2L5 13h6l-1 9 8-12h-6z"/>',
  wetter: '<path d="M7 18a4 4 0 0 1-.5-8A5.500 5.500 0 0 1 17 8.500 4.800 4.800 0 0 1 17 18z"/><path d="M9 21l1-2M14 21l1-2"/>',
  traits: '<path d="M12 3l2.600 5.600 6 .7-4.500 4.100 1.200 6L12 16.400 6.700 19.400l1.200-6L3.400 9.300l6-.7z"/>',
  rassen: '<circle cx="12" cy="8" r="3.500"/><path d="M5 21c0-4 3-6.500 7-6.500s7 2.500 7 6.500"/>',
  ich: '<circle cx="12" cy="8" r="3.500"/><path d="M5 21c0-4 3-6.500 7-6.500s7 2.500 7 6.500"/><path d="M17 4l1 2 2 .3-1.500 1.400.4 2L17 8.700"/>',
  kolonie: '<path d="M3 20V10l5-4 5 4v10M13 20v-7l4-3 4 3v7M3 20h18"/><path d="M6.500 20v-4h3v4"/>',
  stream: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 9l5 2.500-5 2.500z"/><path d="M8 21h8"/>',
  spiel: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ereignisse: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  mods: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M19.100 4.900L17 7M7 17l-2.100 2.100"/>',
};

export function icon(name, size = 18) {
  const p = P[name];
  if (!p) return '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
