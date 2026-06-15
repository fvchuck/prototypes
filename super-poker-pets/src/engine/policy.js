import { ECON, buyToSlot, buyMerge, reroll } from './shop.js';
import { canMerge, baseStats } from './cards.js';

// Baseline drafting policy for RTP calibration ("average player").
// Greedy: 1) buy offers that pair a board rank, 2) buy highest rank to fill
// space, 3) if board full, buy-merge matching ranks, 4) reroll spare gold.
// Never sells. Orders board bulky-first.
export function playShopPhase(shop, rng) {
  let safety = 50;
  while (shop.gold >= ECON.buyCost && safety-- > 0) {
    const offers = shop.offers
      .map((o, i) => (o ? { i, card: o.card } : null))
      .filter(Boolean);
    if (offers.length === 0) {
      if (shop.gold >= ECON.buyCost + ECON.rerollCost) { reroll(shop, rng); continue; }
      break;
    }
    const space = shop.board.length < ECON.boardSlots;
    const boardRanks = new Set(shop.board.map((c) => c.rank));

    // 1) complete a pair in a new slot
    const pairOffer = space ? offers.find((o) => boardRanks.has(o.card.rank)) : null;
    if (pairOffer) { buyToSlot(shop, pairOffer.i); continue; }

    // 2) fill space with the highest rank on offer
    if (space) {
      const best = offers.reduce((a, b) => (b.card.rank > a.card.rank ? b : a));
      buyToSlot(shop, best.i);
      continue;
    }

    // 3) board full: merge a matching offer into the first mergeable board card
    let merged = false;
    for (const o of offers) {
      const target = shop.board.findIndex((c) => canMerge(c, o.card));
      if (target !== -1) { buyMerge(shop, o.i, target); merged = true; break; }
    }
    if (merged) continue;

    // 4) burn spare gold on rerolls hunting merges
    if (shop.gold >= ECON.buyCost + ECON.rerollCost) { reroll(shop, rng); continue; }
    break;
  }
  // bulky first: order by effective hp desc, then atk desc
  shop.board.sort((a, b) => {
    const sa = baseStats(a.rank), sb = baseStats(b.rank);
    return (sb.hp - sa.hp) || (sb.atk - sa.atk);
  });
}
