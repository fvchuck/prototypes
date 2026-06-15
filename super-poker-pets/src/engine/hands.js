import { SUITS, cardStats } from './cards.js';

// Per-card bonuses for the rank-group and full-board hands.
export const BONUS = {
  highCard:      { atk: 0, hp: 1 },
  pair:          { atk: 2, hp: 2 },
  trips:         { atk: 3, hp: 3 },
  quads:         { atk: 5, hp: 5 },
  fullHouse:     { atk: 2, hp: 2 },
  straightFlush: { atk: 4, hp: 4 },
  royalFlush:    { atk: 6, hp: 6 },
};

// Straights and flushes pay INCREMENTALLY by how many cards you've assembled,
// so partial progress is rewarded instead of being all-or-nothing. Keyed by the
// number of contributing cards (3, 4, or the full 5). The full-5 values match
// the historical straight (+2 atk all) / flush (+2 hp all) tuning; 3- and
// 4-card partials sit below. Applied per contributing card.
export const STRAIGHT_RAMP = { 3: { atk: 1, hp: 0 }, 4: { atk: 1, hp: 0 }, 5: { atk: 2, hp: 0 } };
export const FLUSH_RAMP =    { 3: { atk: 0, hp: 1 }, 4: { atk: 0, hp: 1 }, 5: { atk: 0, hp: 2 } };

// The per-card {atk, hp} a trait grants. Sized straights/flushes read their
// ramp; everything else is a flat lookup. Single source of truth for both the
// combat math (applyBonuses) and the UI readout.
export function traitBonus(trait) {
  if (trait.name === 'straight') return STRAIGHT_RAMP[trait.size];
  if (trait.name === 'flush') return FLUSH_RAMP[trait.size];
  return BONUS[trait.name];
}

export const TRAIT_LABEL = {
  highCard: 'High Card', pair: 'Pair', trips: 'Three of a Kind',
  quads: 'Four of a Kind', straight: 'Straight', flush: 'Flush',
  fullHouse: 'Full House', straightFlush: 'Straight Flush', royalFlush: 'Royal Flush',
};

// Largest set of card indices sharing one suit. Merged cards hold several suits
// and count toward each. Returns { suit, idxs } for the best suit (idxs may be
// empty for an empty board).
function bestFlush(cards) {
  let best = { suit: null, idxs: [] };
  for (const s of SUITS) {
    const idxs = [];
    cards.forEach((c, i) => { if (c.suits.includes(s)) idxs.push(i); });
    if (idxs.length > best.idxs.length) best = { suit: s, idxs };
  }
  return best;
}

// Longest run of consecutive distinct ranks. Ace plays high or low (wheel).
// Returns { values, idxs } — the consecutive integer run (ace-low = 1) and the
// card indices forming it (one card per rank, lowest first).
function bestStraight(cards) {
  const byRank = new Map();
  cards.forEach((c, i) => { if (!byRank.has(c.rank)) byRank.set(c.rank, i); });
  // candidate "values" for consecutiveness — ace (14) also counts as 1
  const values = new Set(byRank.keys());
  if (values.has(14)) values.add(1);
  const sorted = [...values].sort((a, b) => a - b);

  let best = [], run = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1] + 1) run.push(sorted[i]);
    else run = [sorted[i]];
    if (run.length > best.length) best = [...run];
  }
  return { values: best, idxs: best.map((v) => byRank.get(v === 1 ? 14 : v)) };
}

// Forward-looking progress toward the best straight and flush on this board —
// reported down to size 0/2 (unlike detectTraits, which only emits a trait at
// 3+). Used by the HUD to show how close a hand is and what completes it.
// straight.values is the consecutive integer run (ace-low = 1) for neighbor math.
export function handProgress(cards) {
  const flush = bestFlush(cards);
  const straight = bestStraight(cards);
  return {
    flush: { suit: flush.suit, size: flush.idxs.length },
    straight: { size: straight.values.length, values: straight.values },
  };
}

// cards: array of {rank, suits, level}. Returns [{name, cardIdxs, size?, suit?}]
export function detectTraits(cards) {
  if (cards.length === 0) return [];
  const traits = [];

  // rank groups — each rank counts at its highest tier only
  const byRank = new Map();
  cards.forEach((c, i) => {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(i);
  });
  let hasTrips = false, hasPair = false;
  for (const idxs of byRank.values()) {
    if (idxs.length >= 4) traits.push({ name: 'quads', cardIdxs: idxs });
    else if (idxs.length === 3) { traits.push({ name: 'trips', cardIdxs: idxs }); hasTrips = true; }
    else if (idxs.length === 2) { traits.push({ name: 'pair', cardIdxs: idxs }); hasPair = true; }
  }
  const all = cards.map((_, i) => i);
  if (hasTrips && hasPair) traits.push({ name: 'fullHouse', cardIdxs: all });

  // straight & flush — now incremental: any run/suit-group of 3+ scores.
  const flush = bestFlush(cards);
  const straightIdxs = bestStraight(cards).idxs;
  const fullStraight = straightIdxs.length === 5;
  const fullFlush = flush.idxs.length === 5;

  if (fullStraight && fullFlush) {
    // a complete straight that is also a complete flush — the premium hand
    const royal = cards.every((c) => c.rank >= 10);
    traits.push({ name: royal ? 'royalFlush' : 'straightFlush', cardIdxs: all });
  } else {
    if (straightIdxs.length >= 3) {
      traits.push({ name: 'straight', cardIdxs: straightIdxs, size: straightIdxs.length });
    }
    if (flush.idxs.length >= 3) {
      traits.push({ name: 'flush', cardIdxs: flush.idxs, size: flush.idxs.length, suit: flush.suit });
    }
  }

  // high card — always active, leftmost highest rank, +0/+1
  let best = 0;
  cards.forEach((c, i) => { if (c.rank > cards[best].rank) best = i; });
  traits.push({ name: 'highCard', cardIdxs: [best] });

  return traits;
}

// Returns { units: [{card, atk, hp}], traits } — hand bonuses are temporary,
// computed fresh from the board every battle. Level bonus is inside cardStats.
export function applyBonuses(cards) {
  const traits = detectTraits(cards);
  const units = cards.map((c) => ({ card: c, ...cardStats(c) }));
  for (const t of traits) {
    const b = traitBonus(t);
    for (const i of t.cardIdxs) {
      units[i].atk += b.atk;
      units[i].hp += b.hp;
    }
  }
  return { units, traits };
}
