// Tile generation and the run deck.
// A tile is { edges: [t0..t5] } in canonical orientation; rotation rotates the array.

export const GRASS = 'grass';
export const FOREST = 'forest';
export const WATER = 'water';
export const VILLAGE = 'village';
export const ROAD = 'road';
export const CASTLE = 'castle';

export const TERRAIN_NAMES = {
  forest: 'Forest', water: 'Pond', village: 'Village', road: 'Road', castle: 'Castle',
};

// payout = bet * BASE[type] * size^GROWTH[type]
export const PAYOUT = {
  water: { base: 0.14, growth: 1.20 },
  road: { base: 0.11, growth: 1.15 },
  forest: { base: 0.20, growth: 1.35 },
  village: { base: 0.32, growth: 1.50 },
};
export const CASTLE_MULT = 50;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotEdges(edges, rot) {
  // rotation r means canonical edge i appears at world direction (i + r) % 6
  const out = new Array(6);
  for (let i = 0; i < 6; i++) out[(i + rot) % 6] = edges[i];
  return out;
}
export { rotEdges };

function contiguous(start, k, type, edges) {
  for (let i = 0; i < k; i++) edges[(start + i) % 6] = type;
}

function pick(rng, weighted) {
  let total = 0;
  for (const [, w] of weighted) total += w;
  let x = rng() * total;
  for (const [v, w] of weighted) { x -= w; if (x <= 0) return v; }
  return weighted[weighted.length - 1][0];
}

export function genTile(rng) {
  const edges = new Array(6).fill(GRASS);
  const kind = pick(rng, [
    ['forest', 26], ['village', 20], ['water', 17], ['road', 16], ['mixed', 14], ['meadow', 7],
  ]);
  const s = Math.floor(rng() * 6);
  if (kind === 'forest') contiguous(s, 2 + Math.floor(rng() * 3), FOREST, edges);
  else if (kind === 'village') {
    // double-village edges are the castle-gate key — keep them rare
    const x = rng();
    contiguous(s, x < 0.88 ? 1 : x < 0.97 ? 2 : 3, VILLAGE, edges);
  } else if (kind === 'water') contiguous(s, 2 + Math.floor(rng() * 2), WATER, edges);
  else if (kind === 'road') {
    edges[s] = ROAD;
    edges[(s + (rng() < 0.5 ? 2 : 3)) % 6] = ROAD;
  } else if (kind === 'mixed') {
    const combo = pick(rng, [['fv', 3], ['fw', 3], ['rv', 2], ['rf', 2]]);
    if (combo === 'fv') { contiguous(s, 2, FOREST, edges); contiguous(s + 3, 1, VILLAGE, edges); }
    if (combo === 'fw') { contiguous(s, 3, FOREST, edges); contiguous(s + 4, 2, WATER, edges); }
    if (combo === 'rv') { edges[s] = ROAD; edges[(s + 3) % 6] = ROAD; contiguous(s + 1, 1, VILLAGE, edges); }
    if (combo === 'rf') { edges[s] = ROAD; edges[(s + 3) % 6] = ROAD; contiguous(s + 4, 2, FOREST, edges); }
  }
  return { edges };
}

// A castle tile is a single CASTLE edge (rest grass). Two of them placed with
// their castle edges facing each other union into one complete $50 castle.
function castleTile(rng) {
  const e = new Array(6).fill(GRASS);
  e[Math.floor(rng() * 6)] = CASTLE;
  return { edges: e };
}

// Deck of 17 (16 placements + reserve slack).
// Castle jackpot rigging: ~30% of runs contain a castle tile (a visible chase).
// Of those, only ~12% also contain the rare SECOND castle tile required to seal
// it — so the $50 jackpot lands in roughly 3-4% of runs.
export const CASTLE_RUN_CHANCE = 0.30;
export const CASTLE_GATE_CHANCE = 0.12;

export function genDeck(rng, n = 17) {
  const deck = [];
  for (let i = 0; i < n; i++) deck.push(genTile(rng));
  if (rng() < CASTLE_RUN_CHANCE) {
    // first castle tile lands early so the chase is visible
    const first = 1 + Math.floor(rng() * 6);     // slots 1..6
    deck[first] = castleTile(rng);
    if (rng() < CASTLE_GATE_CHANCE) {
      const second = 7 + Math.floor(rng() * 8);  // slots 7..14, after the first
      deck[second] = castleTile(rng);
    }
  }
  return deck;
}

// A "boosted" draw for the buy-more-tiles ladder. With probability `boostP` it
// returns a tile that fits the near-miss target (a castle twin, or a fat block of
// the needed terrain); otherwise an ordinary draw that will most likely whiff.
// Keeping whiffs in the pool is what makes each purchase a gamble — and lets us
// price every rung strictly above its expected payout (see Game.extraPrice).
export function boostedTile(rng, type, boostP) {
  if (rng() >= boostP) return genTile(rng);
  if (type === CASTLE) return castleTile(rng);
  const edges = new Array(6).fill(GRASS);
  contiguous(Math.floor(rng() * 6), 2 + Math.floor(rng() * 2), type, edges);
  return { edges };
}

// Pre-placed board: just a starter meadow tile at the origin to build from.
// The castle is no longer seeded — it arrives (rarely) from the deck.
export function seedBoard() {
  const tiles = [
    { q: 0, r: 0, edges: [FOREST, GRASS, GRASS, GRASS, GRASS, GRASS] },
  ];
  return { tiles };
}

// Single-tile sections pay nothing — value starts at 2 tiles and grows
// superlinearly. This is what forces the grow-vs-bank decision.
export function sectionPayout(type, size, bet) {
  if (type === CASTLE) return Math.round(bet * CASTLE_MULT * 100) / 100;
  if (size <= 1) return 0;
  const p = PAYOUT[type];
  return Math.round(bet * p.base * Math.pow(size - 1, p.growth) * 100) / 100;
}

export function fmt(v) {
  return '$' + v.toFixed(2);
}
