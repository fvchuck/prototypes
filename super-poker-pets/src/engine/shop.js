import { canMerge, merge, buildDeck, cardTier, cardKey } from './cards.js';

export const ECON = {
  goldPerRound: 6, buyCost: 2, sellRefund: 1, rerollCost: 1,
  shopSize: 3, boardSlots: 5,
};

// Draw one card from the deck, reshuffling the discard back in if the deck is
// dry at draw time. Deck+discard can never be globally empty when an offer needs
// filling (held cards <= tier-slice size), so both-empty means conservation is
// broken — fail loud rather than silently short the shop.
function drawCard(shop, rng) {
  if (shop.deck.length === 0) {
    if (shop.discard.length === 0) throw new Error('deck and discard both empty — conservation broken');
    shop.deck = rng.shuffle(shop.discard);
    shop.discard = [];
  }
  return shop.deck.pop();
}

function fillOffers(shop, rng) {
  for (let i = 0; i < ECON.shopSize; i++) {
    if (!shop.offers[i]) shop.offers[i] = { card: drawCard(shop, rng), frozen: false };
  }
}

// tier = trophies held; gates which rank packs are in the deck (Infinity = all).
export function newShop(rng, tier = Infinity, foils = new Set()) {
  const shop = {
    gold: ECON.goldPerRound,
    board: [],
    offers: Array(ECON.shopSize).fill(null),
    tier,
    foils,
    deck: rng.shuffle(buildDeck(tier, foils)),
    discard: [],
  };
  fillOffers(shop, rng);
  return shop;
}

function boardCardAt(shop, idx) {
  const card = shop.board[idx];
  if (!card) throw new Error(`no board card at ${idx}`);
  return card;
}

// Move every non-frozen offer to the discard pile, clearing its slot.
function discardOffers(shop) {
  shop.offers = shop.offers.map((o) => {
    if (o && o.frozen) return o;
    if (o) shop.discard.push(o.card);
    return null;
  });
}

// Start of a new round: optionally widen the deck (new packs shuffle in),
// reset gold, discard non-frozen offers, redraw.
export function refreshRound(shop, rng, tier = shop.tier) {
  if (tier > shop.tier) {
    const prevTier = shop.tier;
    const added = buildDeck(tier, shop.foils).filter((c) => cardTier(c.rank) > prevTier);
    shop.deck = rng.shuffle([...shop.deck, ...added]);
  }
  shop.tier = tier;
  shop.gold = ECON.goldPerRound;
  discardOffers(shop);
  fillOffers(shop, rng);
}

function takeOffer(shop, offerIdx) {
  const o = shop.offers[offerIdx];
  if (!o) throw new Error('empty offer');
  if (shop.gold < ECON.buyCost) throw new Error('not enough gold');
  shop.gold -= ECON.buyCost;
  shop.offers[offerIdx] = null;
  return o.card;
}

export function buyToSlot(shop, offerIdx) {
  if (shop.board.length >= ECON.boardSlots) throw new Error('board full');
  shop.board.push(takeOffer(shop, offerIdx));
}

export function buyMerge(shop, offerIdx, boardIdx) {
  const o = shop.offers[offerIdx];
  if (!o) throw new Error('empty offer');
  if (!canMerge(boardCardAt(shop, boardIdx), o.card)) throw new Error('illegal merge');
  const card = takeOffer(shop, offerIdx);
  shop.board[boardIdx] = merge(shop.board[boardIdx], card);
}

// Coins returned for selling a card: sellRefund per level, i.e. ~50% of the
// gold sunk in (each level = one bought card at buyCost). Lv1→1 … Lv4→4.
export function sellValue(card) {
  return ECON.sellRefund * card.level;
}

export function sell(shop, boardIdx) {
  const card = boardCardAt(shop, boardIdx);
  const refund = sellValue(card);
  shop.board.splice(boardIdx, 1);
  for (const s of card.suits) {
    const c = { rank: card.rank, suits: [s], level: 1 };
    if (shop.foils.has(cardKey(card.rank, s))) c.foil = true;
    shop.discard.push(c);
  }
  shop.gold += refund;
  return refund;
}

export function reroll(shop, rng) {
  if (shop.gold < ECON.rerollCost) throw new Error('not enough gold');
  shop.gold -= ECON.rerollCost;
  discardOffers(shop);
  fillOffers(shop, rng);
}

export function toggleFreeze(shop, offerIdx) {
  const o = shop.offers[offerIdx];
  if (!o) throw new Error('empty offer');
  o.frozen = !o.frozen;
}

export function mergeOnBoard(shop, fromIdx, toIdx) {
  if (fromIdx === toIdx) throw new Error('same card');
  if (!canMerge(boardCardAt(shop, toIdx), boardCardAt(shop, fromIdx))) throw new Error('illegal merge');
  shop.board[toIdx] = merge(shop.board[toIdx], shop.board[fromIdx]);
  shop.board.splice(fromIdx, 1);
}

export function moveCard(shop, fromIdx, toIdx) {
  boardCardAt(shop, fromIdx);
  if (toIdx < 0 || toIdx >= shop.board.length) throw new Error(`bad target slot ${toIdx}`);
  const [c] = shop.board.splice(fromIdx, 1);
  shop.board.splice(toIdx, 0, c);
}
