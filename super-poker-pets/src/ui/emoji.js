// Pet art + UI icons rendered from locally-vendored Twemoji SVGs (assets/emoji).
// Serving our own SVGs guarantees identical rendering on every OS — native OS
// emoji left boxes on Windows (🪙, 🛡) and mixed full-body animals (🐉) with
// head-only ones (🐰, 🦁).
//
// Animals are keyed by rank ONLY, power-ordered weak→strong, and every one is a
// FULL-BODY creature for a consistent look. Same-rank cards always share an
// animal so merging reads as "two snakes become one", never two different pets.
// Suit identity lives entirely in the glyph + four-color deck.
const RANK_CP = {
  2: '1f41c',  // 🐜 ant
  3: '1f41b',  // 🐛 caterpillar
  4: '1f401',  // 🐁 mouse
  5: '1f422',  // 🐢 turtle
  6: '1f407',  // 🐇 rabbit
  7: '1f98e',  // 🦎 lizard
  8: '1f40d',  // 🐍 snake
  9: '1f982',  // 🦂 scorpion
  10: '1f40a', // 🐊 crocodile
  11: '1f988', // 🦈 shark
  12: '1f405', // 🐅 tiger
  13: '1f418', // 🐘 elephant
  14: '1f409', // 🐉 dragon
};

// UI / status icons, also vendored as SVG so they never fall back to a box.
export const ICON = {
  coin: '1fa99',       // 🪙
  lock: '1f512',       // 🔒
  shield: '1f6e1',     // 🛡 (card HP — never a heart, which collides with ♥)
  swords: '2694',      // ⚔ (card ATK)
  heart: '2764',       // ❤️ (run life)
  heartEmpty: '1f5a4', // 🖤 (lost life)
  trophy: '1f3c6',     // 🏆
  sparkles: '2728',    // ✨ (trophy VFX)
};

const SVG_DIR = 'assets/emoji';

export function emojiUrl(cp) {
  return `${SVG_DIR}/${cp}.svg`;
}

// Build an <img> for a codepoint. `cls` is appended to the base `emoji` class.
export function emojiImg(cp, cls) {
  const img = document.createElement('img');
  img.src = emojiUrl(cp);
  img.className = cls ? `emoji ${cls}` : 'emoji';
  img.alt = '';
  img.draggable = false;
  return img;
}

export function petImg(card, cls) {
  return emojiImg(RANK_CP[card.rank], cls ? `pet ${cls}` : 'pet');
}

export function iconImg(name, cls) {
  const cp = ICON[name];
  if (!cp) throw new Error(`unknown icon: ${name}`);
  return emojiImg(cp, cls);
}

// Suit glyphs are plain text symbols (render fine everywhere); four-color deck.
export const SUIT_GLYPH = { H: '♥', S: '♠', D: '♦', C: '♣' };
export const SUIT_COLOR = { H: '#e0245e', S: '#1c1c28', D: '#1d6fd6', C: '#1e9e4a' };
