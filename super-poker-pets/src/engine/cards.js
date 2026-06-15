export const SUITS = ['H', 'S', 'D', 'C'];
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const LEVEL_BONUS = { 1: 0, 2: 1, 3: 3, 4: 6 };

export const FOIL_RATE = 0.07;
export const FOIL_BONUS = { atk: 2, hp: 2 };

export function cardKey(rank, suit) { return `${rank}${suit}`; }

// Roll an independent FOIL_RATE chance for each of the 52 cards. Returns a Set
// of "rank+suit" keys. Rolled once per session so a card's foil status is a
// stable, learnable property.
export function rollFoils(rng, rate = FOIL_RATE) {
  const foils = new Set();
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      if (rng.next() < rate) foils.add(cardKey(rank, suit));
    }
  }
  return foils;
}

// Shop deck is gated into "packs" aligned to the stat breakpoints in baseStats.
// A pack unlocks once the player holds that many trophies and is shuffled
// cumulatively into the offer pool. Game 1 (0 trophies) offers pack 0 only.
export const RANK_PACKS = [
  [2, 3, 4, 5],      // pack 0 — atk2/hp5  (unlocked at 0 trophies)
  [6, 7, 8, 9],      // pack 1 — atk3/hp6  (unlocked at 1 trophy)
  [10, 11, 12, 13],  // pack 2 — atk4/hp7  (unlocked at 2 trophies)
  [14],              // pack 3 — atk5/hp8  (unlocked at 3 trophies)
];

// Pack/tier index (0–3) a rank belongs to. Mirrors RANK_PACKS and the
// baseStats breakpoints. Displayed 1-based in the UI as "Tier 1–4".
export function cardTier(rank) {
  if (rank === 14) return 3;
  if (rank >= 10) return 2;
  if (rank >= 6) return 1;
  return 0;
}

// Ranks available in the shop given trophies held. tier === Infinity = all.
export function unlockedRanks(tier) {
  const out = [];
  for (let i = 0; i < RANK_PACKS.length; i++) {
    if (tier >= i) out.push(...RANK_PACKS[i]);
  }
  return out;
}

// Every physical card (level-1, single-suit) for packs 0..tier inclusive.
// This is the literal contents of the player's draw deck at that tier.
export function buildDeck(tier, foils = new Set()) {
  const out = [];
  for (let p = 0; p < RANK_PACKS.length; p++) {
    if (tier < p) continue;
    for (const rank of RANK_PACKS[p]) {
      for (const suit of SUITS) {
        const c = { rank, suits: [suit], level: 1 };
        if (foils.has(cardKey(rank, suit))) c.foil = true;
        out.push(c);
      }
    }
  }
  return out;
}

// The level-1 single-suit cards a (possibly merged) card embodies — one per
// suit it carries. Used to return cards to the deck/discard on sell and to
// check the conservation invariant.
export function physicalCards(card) {
  return card.suits.map((s) => {
    const c = { rank: card.rank, suits: [s], level: 1 };
    if (card.foil) c.foil = true;
    return c;
  });
}

const RANK_CHARS = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank) {
  return LABELS[rank] ?? String(rank);
}

export function baseStats(rank) {
  if (rank === 14) return { atk: 5, hp: 8 };
  if (rank >= 10) return { atk: 4, hp: 7 };
  if (rank >= 6) return { atk: 3, hp: 6 };
  return { atk: 2, hp: 5 };
}

export function cardStats(card) {
  const b = baseStats(card.rank);
  const lv = LEVEL_BONUS[card.level];
  let atk = b.atk + lv, hp = b.hp + lv;
  if (card.foil) { atk += FOIL_BONUS.atk; hp += FOIL_BONUS.hp; }
  return { atk, hp };
}

// 'AH' | 'TD' | '10D' | '8HS' (level = number of suit chars)
export function parseCard(str) {
  let rank, rest;
  if (str.startsWith('10')) {
    rank = 10;
    rest = str.slice(2);
  } else if (RANK_CHARS[str[0]] !== undefined) {
    rank = RANK_CHARS[str[0]];
    rest = str.slice(1);
  } else {
    rank = Number(str[0]);
    rest = str.slice(1);
  }
  const suits = rest.split('');
  if (!RANKS.includes(rank) || suits.length < 1 || suits.length > 4 ||
      suits.some((s) => !SUITS.includes(s))) {
    throw new Error(`bad card string: ${str}`);
  }
  return { rank, suits: [...new Set(suits)], level: suits.length };
}

export function canMerge(a, b) {
  return a.rank === b.rank && a.level + b.level <= 4;
}

export function merge(a, b) {
  if (!canMerge(a, b)) throw new Error('illegal merge');
  const m = {
    rank: a.rank,
    suits: [...new Set([...a.suits, ...b.suits])],
    level: a.level + b.level,
  };
  if (a.foil || b.foil) m.foil = true;
  return m;
}
