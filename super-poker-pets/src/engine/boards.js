import { parseCard } from './cards.js';

// Authored opponent boards, front first. Calibrated by sim (npm run sim) so
// baseline RTP sits in the 96.5-98.5 band against the 4x-jackpot ladder.
//
// RE-HARDEN for INCREMENTAL HANDS + FOILS (2026-06-12). Two player-power buffs
// landed on top of the single-deck model: (1) straights & flushes now score
// INCREMENTALLY — 3- and 4-card partials grant bonuses, not just full 5-card
// hands; (2) ~7% of cards are FOIL, carrying a flat +2/+2. Together these made
// the player MUCH stronger, so RTP shot up to ~148% (the house was losing
// money) on the previously-softened single-deck boards. The boards are re-
// hardened tier-over-tier to pull RTP back to mid-band. The strong player now
// reads quads / straight flushes / Lv4 walls as fair opposition again, so those
// hands are reintroduced where needed (tiers 3-4). Tiers 1-2 (which sat at a
// far-too-easy ~60-62% player-win) were hardened hard into trips / full houses
// / flushes; tier 0 is unchanged (already at target hardness).
//
// Lever notes (learned while tuning): the rank-banded base stats (2-5/6-9/
// 10-13/A) plus the way the full-house bonus stacks on top of the trips+pair
// bonuses make HAND-TYPE swaps very coarse — a single trips->full-house board
// can move a whole tier's win rate by 10-18 points, and at the terminal tier 4
// the 4x jackpot multiplier amplifies that further (one kicker crossing a stat
// band there ~= 1.8 RTP points). Fine tuning therefore leans on the small
// incremental levers: a kicker crossing a band, or suiting three cards on a
// trip board to add a 3-card flush (+1 hp on 3 cards). Intermediate tiers (1-3)
// are partly RTP-neutral — a survivors-are-stronger funnel cancels some of
// their win-rate drop — so the terminal tier 4 carries the most RTP weight.
//
// Measured 2026-06-12 over 200k runs on THREE NON-OVERLAPPING seed ranges
// (sim seeds baseSeed+i, so ranges must not share base offsets):
//   seeds 1..200000        RTP 97.60%
//   seeds 300000..500000   RTP 97.37%
//   seeds 600000..800000   RTP 97.61%
// Center ~97.5%, all strictly within 96.5-98.5. Per-tier win ramp ~52/42/47/
// 30/31 (tiers 1-2 pulled way down from ~62/60; the mild tier-2>tier-1 bump is
// acceptable — both were the over-easy gates and are now near each other in the
// low-mid 40s). Trophy distribution ~0/23/26/27/13/12% for 0..5 trophies, so
// the 5-trophy 4x jackpot pays on ~11.7% of runs (down from ~21%). Boards still
// use only player-facing rules (multi-suit strings = merged/leveled cards, e.g.
// AHSDC = Lv4 ace) so they read as legible poker hands.
const RAW = [
  // Tier 0 — slight edge over a fresh ~3-card player board.
  [
    ['6H', '6C', '5S'],
    ['7S', '7D', '3H'],
    ['9C', '8D', '8S'],
    ['4D', '4C', '8H'],
    ['TH', '9S', '3C'],
    ['8C', '7H', '6D'],
    ['JD', 'JC', '4H'],
    ['5H', '5D', '6S'],
    ['QS', '8H', '3D'],
    ['TH', 'TS'],
    ['AC', 'AD'],
    ['3H', '3C', '7D'],
  ],
  // Tier 1 — mostly trips, with one full house, a K-high flush, a J-high
  // straight and a couple of high two-pair, 5-card boards. Re-hardened hard for
  // the strong (incremental-hands + foils) player, who was winning ~62% here on
  // the old soft set; now ~42%.
  [
    ['TC', 'TD', 'TH', 'JS', '7H'], // trip tens
    ['9H', '9S', '9D', '7C', '7H'], // nines full of sevens
    ['JD', 'JS', 'JH', '9H', '5S'], // trip jacks
    ['KD', 'KH', '9C', '9D', '8H'], // two pair K/9
    ['JH', 'TS', '9C', '8D', '7H'], // J-high straight
    ['QH', 'QC', 'QD', '6S', '2S'], // trip queens
    ['KH', 'QH', '9H', '6H', '3H'], // K-high flush
    ['8H', '8S', '8D', '6C', '4S'], // trip eights
    ['TH', 'TS', 'TD', '8S', '4S'], // trip tens
    ['JC', 'JD', 'JH', 'TS', '2S'], // trip jacks
  ],
  // Tier 2 — high trips (incl. a trip-kings board suited for a 3-card flush),
  // two full houses, a K-high flush and a high two-pair, 5-card boards. Re-
  // hardened hard (was the softest gate, ~60% player-win on the old set); now
  // ~47%.
  [
    ['AH', 'AC', 'AD', '8S', '6C'], // trip aces
    ['JD', 'JS', 'JH', 'AC', 'TD'], // trip jacks + ace
    ['KH', 'KD', 'KC', 'JH', 'TH'], // trip kings + 3-card heart flush
    ['QH', 'QD', 'QC', '9S', '9D'], // queens full of nines
    ['AS', 'AD', 'KC', 'KH', '9S'], // two pair A/K
    ['TC', 'TD', 'TH', '9S', '6D'], // trip tens
    ['KH', 'QH', 'JH', '8H', '4H'], // K-high flush
    ['AH', 'AC', 'AD', 'TS', 'TC'], // aces full of tens
  ],
  // Tier 3 — high trips (one suited into a 3-card flush) and full houses, 5-card
  // boards. Re-hardened up from the soft single-deck set for the strong player
  // (now ~30% player-win), but deliberately kept short of quads / straight
  // flushes / Lv4 walls — a full pool of those over-gated this to ~6%, and even
  // one extra full house here swings the tier ~12 points.
  [
    ['KH', 'KD', 'KC', 'TS', 'TH'], // kings full of tens
    ['AH', 'AC', 'AD', '9S', '7D'], // trip aces
    ['QH', 'QD', 'QC', 'JH', '9H'], // trip queens + 3-card heart flush
    ['KC', 'KS', 'KH', 'QD', 'QH'], // kings full of queens
    ['AD', 'AS', 'AC', 'KD', 'KS'], // aces full of kings
    ['QC', 'QS', 'QD', 'JD', 'JH'], // queens full of jacks
  ],
  // Tier 4 — the final gate to the jackpot. Two high trips, two full houses and
  // a quad-aces board (now ~31% player-win). This terminal tier is the primary
  // RTP lever: with no downstream funnel to absorb changes and the 4x jackpot
  // multiplier on top, it is EXTREMELY sensitive — one full-house swap moves RTP
  // ~16 points and a single kicker crossing a stat band ~1.8. So it is tuned
  // with the finest lever available: the trip-aces kickers were nudged J9 -> JQ
  // (the 9 -> Q crosses the 6-9 band into 10-13) to shave a little jackpot
  // throughput. The brutal pre-softening royal/Lv4 walls over-gated this to ~1%.
  [
    ['AH', 'AC', 'AD', 'JD', 'QD'], // trip aces, jack-queen kickers
    ['KH', 'KD', 'KC', 'AS', 'QS'], // trip kings, ace-queen kickers
    ['AD', 'AS', 'AC', 'KC', 'KH'], // aces full of kings
    ['QH', 'QD', 'KC', 'KS', 'KH'], // kings full of queens
    ['AC', 'AS', 'AH', 'AD', 'TH'], // quad aces
  ],
];

export const TIER_POOLS = RAW.map((pool) => pool.map((b) => b.map(parseCard)));

export function pickEnemyBoard(tier, rng) {
  return rng.pick(TIER_POOLS[tier]);
}
