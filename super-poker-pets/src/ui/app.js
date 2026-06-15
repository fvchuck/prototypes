import { newRun, startBattle, payout, LADDER, MAX_TROPHIES, MAX_HP } from '../engine/run.js';
import { ECON, buyToSlot, buyMerge, sell, sellValue, reroll, toggleFreeze, mergeOnBoard, moveCard } from '../engine/shop.js';
import { applyBonuses, TRAIT_LABEL, traitBonus, handProgress, FLUSH_RAMP, STRAIGHT_RAMP } from '../engine/hands.js';
import { cardStats, baseStats, LEVEL_BONUS, canMerge, rankLabel, cardTier, RANK_PACKS, rollFoils, cardKey, FOIL_BONUS, SUITS, unlockedRanks } from '../engine/cards.js';
import { makeRng } from '../engine/rng.js';

// Foils are rolled ONCE per browser session and reused across every run, so a
// card's foil status is a stable, learnable property (the foil 7♠ stays foil).
const SESSION_FOILS = rollFoils(makeRng((Date.now() >>> 0) || 1));
import { petImg, iconImg, SUIT_GLYPH, SUIT_COLOR } from './emoji.js';
import { sfx, toggleMuted, isMuted } from './sfx.js';

const MIN_STAKE = 0.1; // players may wager any amount from here up to their wallet
const WALLET_KEY = 'spp_wallet';

function loadWallet() {
  const raw = localStorage.getItem(WALLET_KEY);
  if (raw === null) return 100; // new visitor
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 100; // recover from corrupt values
}

const state = {
  wallet: loadWallet(),
  stake: 1,
  run: null,
  selected: null, // {zone: 'offer'|'board', idx}
  highlightTrait: null, // traitKey() of the bonus whose cards are lit up
  lastBattle: null,
};

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n).toFixed(2);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// stat badge: SVG icon + number, with the number in its own span so combat
// playback can update it without clobbering the icon.
function statBadge(kind, icon, value) {
  const badge = el('span', `stat-badge ${kind}`);
  badge.appendChild(iconImg(icon, 'stat-ico'));
  badge.appendChild(el('span', 'stat-num', String(value)));
  return badge;
}

// inline icon + text, e.g. for the status bar (coin count, etc.)
function iconText(icon, text, cls) {
  const span = el('span', cls);
  span.appendChild(iconImg(icon, 'hud-ico'));
  span.appendChild(el('span', 'hud-num', text));
  return span;
}

function setWallet(v) {
  state.wallet = v;
  localStorage.setItem(WALLET_KEY, String(v));
}

const SCREENS = ['title', 'shop', 'battle', 'end'];
function show(name) {
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
}

// bonus stat phrase, e.g. "+2/+2" or "+0/+2". Takes the trait so sized
// straights/flushes resolve their ramp value.
function bonusPhrase(trait, isBoardWide) {
  const b = traitBonus(trait);
  const txt = `+${b.atk}/+${b.hp}`;
  return isBoardWide ? `${txt} all` : txt;
}
// Hands that cover the whole board; sized straights/flushes are NOT here —
// they apply to their specific contributing cards and show those ranks.
const BOARD_WIDE = new Set(['fullHouse', 'straightFlush', 'royalFlush']);
// Label for a trait, with the partial size for straights/flushes, e.g. "Flush (4)".
function traitLabel(trait) {
  return TRAIT_LABEL[trait.name] + (trait.size ? ` (${trait.size})` : '');
}

// ---------- card tile ----------
// opts: { stats:{atk,hp}, base:{atk,hp}, selected, frozen, onClick,
//         glow:{suit, rank} } — glow marks hand membership (see glowMapFromTraits)
function cardTile(card, opts = {}) {
  const lv = card.level;
  const tile = el('div', 'card-tile');
  if (lv >= 2) tile.classList.add(`lv${lv}`);
  if (opts.selected) tile.classList.add('selected');
  if (opts.dupe) tile.classList.add('dupe-glow');
  if (card.foil) {
    tile.classList.add('foil');
    tile.appendChild(el('div', 'foil-sheen'));
  }

  // rank + suits. opts.glow marks hand membership: a flush glows the matching
  // suit glyph; a straight glows the rank (blue); a rank-group glows it (gold).
  const glow = opts.glow;
  const rank = el('div', 'card-rank');
  const rankLbl = el('span', 'rank-label', rankLabel(card.rank));
  if (glow && glow.rank === 'straight') rankLbl.classList.add('rank-glow-straight');
  else if (glow && glow.rank === 'group') rankLbl.classList.add('rank-glow-group');
  rank.appendChild(rankLbl);
  const glyphs = el('span', 'suit-glyphs');
  for (const s of card.suits) {
    const g = el('span', null, SUIT_GLYPH[s]);
    g.style.color = SUIT_COLOR[s];
    if (glow && (glow.suit === '*' || glow.suit === s)) g.classList.add('suit-glow');
    glyphs.appendChild(g);
  }
  rank.appendChild(glyphs);
  tile.appendChild(rank);

  if (lv >= 2) tile.appendChild(el('span', 'lv-badge', `LV${lv}`));

  // tier gem (which pack this rank is from, 1–4) — sits in the card frame's
  // top-right cutout. Shown on shop offers (always Lv1, so it never collides
  // with the Lv badge).
  if (opts.showTier) {
    const tier = cardTier(card.rank);
    const gem = el('div', `tier-gem tier-${tier}`, String(tier + 1));
    gem.title = `Tier ${tier + 1}`;
    tile.appendChild(gem);
  }

  const pet = el('div', 'card-pet');
  pet.appendChild(petImg(card));
  tile.appendChild(pet);

  // stats
  const stats = opts.stats ?? cardStats(card);
  const base = opts.base ?? cardStats(card);
  const statsRow = el('div', 'card-stats');
  const atk = statBadge('atk', 'swords', stats.atk);
  const hp = statBadge('hp', 'shield', stats.hp);
  if (stats.atk > base.atk) atk.classList.add('stat-buffed');
  else if (stats.atk < base.atk) atk.classList.add('stat-hurt');
  if (stats.hp > base.hp) hp.classList.add('stat-buffed');
  else if (stats.hp < base.hp) hp.classList.add('stat-hurt');
  statsRow.appendChild(atk);
  statsRow.appendChild(hp);
  tile.appendChild(statsRow);

  if (opts.onClick) tile.addEventListener('click', opts.onClick);
  return tile;
}

// Map each card index to its hand-membership highlight: which suit glyph to
// glow (flush, by suit) and whether the rank label glows for a straight (blue)
// or a rank-group/pair/trips/quads (gold). Drives cardTile's opts.glow.
function glowMapFromTraits(traits) {
  const map = [];
  const at = (i) => (map[i] ??= { suit: null, rank: null });
  for (const t of traits) {
    if (t.name === 'flush') for (const i of t.cardIdxs) at(i).suit = t.suit;
    else if (t.name === 'straight') for (const i of t.cardIdxs) at(i).rank = 'straight';
    else if (t.name === 'pair' || t.name === 'trips' || t.name === 'quads')
      for (const i of t.cardIdxs) at(i).rank = 'group';
    else if (t.name === 'straightFlush' || t.name === 'royalFlush')
      for (const i of t.cardIdxs) { const m = at(i); m.suit = '*'; m.rank = 'straight'; }
  }
  return map;
}

// Stable identity for a trait across re-renders (same hand on the same board
// yields the same key), so a tapped bonus stays highlighted until the board
// actually changes. Keyed on name + suit + the ranks it covers.
function traitKey(trait, board) {
  const ranks = trait.cardIdxs.map((i) => board[i].rank).sort((a, b) => a - b).join(',');
  return `${trait.name}:${trait.suit || ''}:${ranks}`;
}

// Tooltip breaking a card's stats into base (rank) + level + foil, then each
// active hand bonus, then the total. traits/idx/unit are supplied for a board
// card in play; omit them to show just the card's own stats (e.g. a shop offer).
function cardBreakdownEl(card, traits, idx, unit) {
  const pop = el('div', 'card-pop');
  const suitStr = card.suits.map((s) => SUIT_GLYPH[s]).join('');
  const tags = [card.level >= 2 ? `Lv${card.level}` : '', card.foil ? '✦ foil' : ''].filter(Boolean);
  pop.appendChild(el('div', 'cp-title', `${rankLabel(card.rank)}${suitStr}${tags.length ? ' · ' + tags.join(' · ') : ''}`));

  const addRow = (label, a, h, cls) => {
    const r = el('div', 'cp-row' + (cls ? ` ${cls}` : ''));
    r.appendChild(el('span', 'cp-label', label));
    r.appendChild(el('span', 'cp-val', `${a} / ${h}`));
    pop.appendChild(r);
  };

  const base = baseStats(card.rank);
  addRow(`Base (rank ${rankLabel(card.rank)})`, base.atk, base.hp);
  const lv = LEVEL_BONUS[card.level];
  if (lv > 0) addRow(`Level ${card.level}`, `+${lv}`, `+${lv}`);
  if (card.foil) addRow('Foil', `+${FOIL_BONUS.atk}`, `+${FOIL_BONUS.hp}`);

  const hand = traits && idx != null ? traits.filter((t) => t.cardIdxs.includes(idx)) : [];
  const cs = cardStats(card);
  if (hand.length) {
    addRow('Card', cs.atk, cs.hp, 'cp-sub');
    for (const t of hand) {
      const b = traitBonus(t);
      addRow(traitLabel(t), `+${b.atk}`, `+${b.hp}`, 'cp-bonus');
    }
  }
  const total = unit || cs;
  addRow('Total', total.atk, total.hp, 'cp-total');
  return pop;
}

// ---------- feedback ----------
// Modal yes/no, returns a Promise<boolean>. Layered over the whole app.
function confirmDialog(message, { okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay');
    const panel = el('div', 'overlay-panel confirm-panel');
    panel.appendChild(el('div', 'confirm-msg', message));
    const row = el('div', 'confirm-actions');
    const cancel = el('button', 'btn', cancelText);
    const ok = el('button', `btn ${danger ? 'btn-danger' : 'btn-primary'}`, okText);
    const close = (val) => { overlay.remove(); resolve(val); };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    row.appendChild(cancel);
    row.appendChild(ok);
    panel.appendChild(row);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

// Transient bottom toast.
function toast(msg) {
  const t = el('div', 'toast', msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

// Buy an offer when the board is full: combine with a same-rank card, with a
// warning confirmation. This is the only buy path that auto-merges.
async function buyOfferToFullBoard(idx) {
  const shop = state.run.shop;
  const offer = shop.offers[idx];
  if (!offer) return;
  if (shop.gold < ECON.buyCost) { flashError(); return; }
  const target = shop.board.findIndex((c) => canMerge(c, offer.card));
  if (target === -1) {
    flashError();
    toast(`Board full — no ${rankLabel(offer.card.rank)} to combine with.`);
    return;
  }
  const newLevel = shop.board[target].level + offer.card.level;
  const ok = await confirmDialog(
    `Your board is full. Combine this ${rankLabel(offer.card.rank)} into your existing ${rankLabel(offer.card.rank)} to make a Lv${newLevel} card? This permanently merges them.`,
    { okText: 'Combine', cancelText: 'Cancel' }
  );
  if (!ok) return;
  try { buyMerge(shop, idx, target); sfx.merge(); state.selected = null; }
  catch (e) { flashError(); }
  renderShop();
}

function flashError() {
  const g = document.querySelector('#screen-shop .gold');
  if (g) {
    g.classList.remove('flash');
    void g.offsetWidth; // restart animation
    g.classList.add('flash');
  }
}

// ---------- title screen ----------
function renderTitle() {
  const root = $('screen-title');
  root.innerHTML = '';

  // Logo sits ABOVE the wood panel (not inside it), both centered in a wrapper.
  const wrap = el('div', 'title-wrap');

  const logo = el('img', 'title-logo');
  logo.src = 'assets/ui/logo.png';
  logo.alt = 'Super Poker Pets';
  wrap.appendChild(logo);

  const panel = el('div', 'overlay-panel');
  panel.appendChild(el('div', 'wallet-line', `Wallet: ${money(state.wallet)}`));

  // free-form wager: any amount from MIN_STAKE up to the whole wallet
  const wagerRow = el('div', 'wager-row');
  wagerRow.appendChild(el('span', 'wager-label', 'Bet $'));
  const input = el('input', 'wager-input');
  input.type = 'number';
  input.min = String(MIN_STAKE);
  input.step = '0.50';
  input.max = String(state.wallet);
  input.value = clamp(state.stake, MIN_STAKE, Math.max(MIN_STAKE, state.wallet)).toFixed(2);
  wagerRow.appendChild(input);
  panel.appendChild(wagerRow);

  // quick-pick chips — convenience over the free input, not a replacement
  const chips = el('div', 'wager-chips');
  const play = el('button', 'btn btn-primary', 'Play');
  const note = el('div', 'note');
  note.style.minHeight = '1.1em';
  const sync = () => {
    const v = Number(input.value);
    const valid = Number.isFinite(v) && v >= MIN_STAKE && v <= state.wallet;
    if (valid) state.stake = v;
    play.disabled = !valid;
    note.textContent = valid
      ? ''
      : state.wallet < MIN_STAKE
        ? 'insufficient funds'
        : `enter ${money(MIN_STAKE)} – ${money(state.wallet)}`;
  };
  const setBet = (v) => { input.value = clamp(v, MIN_STAKE, state.wallet).toFixed(2); sync(); };
  for (const [lbl, val] of [['$1', () => 1], ['$5', () => 5], ['½', () => state.wallet / 2], ['Max', () => state.wallet]]) {
    const c = el('button', 'btn chip', lbl);
    c.addEventListener('click', () => { sfx.select(); setBet(val()); });
    chips.appendChild(c);
  }
  panel.appendChild(chips);

  input.addEventListener('input', sync);
  play.addEventListener('click', () => {
    const v = clamp(Number(input.value), MIN_STAKE, state.wallet);
    if (!(Number.isFinite(v) && v >= MIN_STAKE && v <= state.wallet)) return;
    sfx.buy();
    setWallet(state.wallet - v);
    state.run = newRun(v, Date.now() >>> 0, SESSION_FOILS);
    state.selected = null;
    state.lastBattle = null;
    renderShop();
    show('shop');
  });
  panel.appendChild(play);
  panel.appendChild(note);

  // dev refill when the wallet can't cover even the minimum wager
  if (state.wallet < MIN_STAKE) {
    const refill = el('button', 'btn', 'Refill to $100');
    refill.addEventListener('click', () => { sfx.payout(); setWallet(100); renderTitle(); });
    panel.appendChild(refill);
  }

  panel.appendChild(el('div', 'note', 'one 52-card deck — cards you take leave the pool'));

  sync();
  wrap.appendChild(panel);
  root.appendChild(wrap);
}

// ---------- shop screen ----------
function clearSelectionIfInvalid() {
  const sel = state.selected;
  if (!sel) return;
  const shop = state.run.shop;
  if (sel.zone === 'board' && !shop.board[sel.idx]) state.selected = null;
  if (sel.zone === 'offer' && !shop.offers[sel.idx]) state.selected = null;
}

function onCardClick(zone, idx) {
  const run = state.run;
  const shop = run.shop;
  const sel = state.selected;

  // toggle deselect
  if (sel && sel.zone === zone && sel.idx === idx) {
    state.selected = null;
    sfx.click();
    renderShop();
    return;
  }

  const select = (z, i) => { state.selected = { zone: z, idx: i }; sfx.select(); };

  try {
    if (zone === 'offer') {
      const offer = shop.offers[idx];
      if (!offer) return; // empty offer slot — nothing to do
      if (sel && sel.zone === 'board') {
        const boardCard = shop.board[sel.idx];
        if (boardCard && canMerge(boardCard, offer.card) && shop.gold >= ECON.buyCost) {
          buyMerge(shop, idx, sel.idx);
          sfx.merge();
          state.selected = null;
        } else if (shop.board.length < ECON.boardSlots && shop.gold >= ECON.buyCost) {
          buyToSlot(shop, idx);
          sfx.buy();
          state.selected = null;
        } else {
          select('offer', idx);
        }
      } else if (shop.board.length < ECON.boardSlots && shop.gold >= ECON.buyCost) {
        // one-click buy: space available → new slot (never auto-merge here)
        buyToSlot(shop, idx);
        sfx.buy();
        state.selected = null;
      } else if (shop.board.length >= ECON.boardSlots) {
        // board full: the only way to buy is to combine — ask first.
        buyOfferToFullBoard(idx); // async; renders itself
        return;
      } else {
        select('offer', idx);
      }
    } else { // board
      const boardCard = shop.board[idx];
      if (!boardCard) {
        // empty board slot
        if (sel && sel.zone === 'offer' && shop.gold >= ECON.buyCost && shop.board.length < ECON.boardSlots) {
          buyToSlot(shop, sel.idx);
          sfx.buy();
          state.selected = null;
        } else if (sel && sel.zone === 'board') {
          // move selected card to the end of the board
          moveCard(shop, sel.idx, shop.board.length - 1);
          sfx.click();
          state.selected = null;
        }
        // else: nothing selected, clicking empty slot does nothing
      } else if (sel && sel.zone === 'offer') {
        const offer = shop.offers[sel.idx];
        if (offer && canMerge(boardCard, offer.card) && shop.gold >= ECON.buyCost) {
          buyMerge(shop, sel.idx, idx);
          sfx.merge();
          state.selected = null;
        } else {
          select('board', idx);
        }
      } else if (sel && sel.zone === 'board') {
        if (canMerge(boardCard, shop.board[sel.idx])) {
          mergeOnBoard(shop, sel.idx, idx);
          sfx.merge();
          state.selected = null;
        } else {
          moveCard(shop, sel.idx, idx);
          sfx.click();
          state.selected = null;
        }
      } else {
        select('board', idx);
      }
    }
  } catch (e) {
    flashError();
    renderShop();
    return;
  }

  clearSelectionIfInvalid();
  renderShop();
}

// ---------- drag & drop ----------
// Pointer-based so mouse and touch both work. A short move threshold lets a
// plain tap fall through to the existing click handlers; a real drag swallows
// the follow-up click. Drop targets are resolved by data-zone/data-idx attrs.
const drag = { source: null, tileEl: null, ghost: null, startX: 0, startY: 0, active: false };
let suppressClick = false;

function attachDrag(tileEl, source) {
  tileEl.dataset.zone = source.zone;
  tileEl.dataset.idx = source.idx;
  tileEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.source = source;
    drag.tileEl = tileEl;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.active = false;
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp, { once: true });
  });
}

function onDragMove(e) {
  if (!drag.source) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    drag.active = true;
    drag.tileEl.classList.add('drag-source');
    drag.ghost = drag.tileEl.cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    document.body.appendChild(drag.ghost);
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  document.querySelectorAll('.drop-ok, .drop-bad').forEach((x) => x.classList.remove('drop-ok', 'drop-bad'));
  const tgt = dropTargetAt(e.clientX, e.clientY);
  if (tgt && (tgt.zone === 'board' || tgt.zone === 'sell')) {
    tgt.el.classList.add(validDrop(drag.source, tgt) ? 'drop-ok' : 'drop-bad');
  }
}

function dropTargetAt(x, y) {
  if (drag.ghost) drag.ghost.style.display = 'none';
  const elAt = document.elementFromPoint(x, y);
  if (drag.ghost) drag.ghost.style.display = '';
  const t = elAt && elAt.closest('[data-zone]');
  return t ? { zone: t.dataset.zone, idx: Number(t.dataset.idx), el: t } : null;
}

function validDrop(src, tgt) {
  if (!tgt) return false;
  if (tgt.zone === 'sell') return src.zone === 'board'; // only board cards can be sold
  if (tgt.zone !== 'board') return false;
  const shop = state.run.shop;
  if (src.zone === 'offer') {
    const offer = shop.offers[src.idx];
    if (!offer || shop.gold < ECON.buyCost) return false;
    const tcard = shop.board[tgt.idx];
    if (tcard) return canMerge(tcard, offer.card) || shop.board.length < ECON.boardSlots;
    return shop.board.length < ECON.boardSlots;
  }
  // board → board: reorder always allowed (merge if matching)
  return src.idx !== tgt.idx;
}

function onDragUp(e) {
  document.removeEventListener('pointermove', onDragMove);
  if (drag.active) {
    performDrop(drag.source, dropTargetAt(e.clientX, e.clientY));
    suppressClick = true; // the click that follows this pointerup is not a tap
  }
  if (drag.ghost) drag.ghost.remove();
  if (drag.tileEl) drag.tileEl.classList.remove('drag-source');
  document.querySelectorAll('.drop-ok, .drop-bad').forEach((x) => x.classList.remove('drop-ok', 'drop-bad'));
  drag.source = drag.tileEl = drag.ghost = null;
  drag.active = false;
}

function performDrop(src, tgt) {
  if (!tgt) return;
  const shop = state.run.shop;
  try {
    if (tgt.zone === 'sell') {
      if (src.zone !== 'board') return;
      sell(shop, src.idx); sfx.sell();
      state.selected = null;
      renderShop();
      return;
    }
    if (tgt.zone !== 'board') return;
    if (src.zone === 'offer') {
      const offer = shop.offers[src.idx];
      if (!offer) return;
      const tcard = shop.board[tgt.idx];
      if (tcard && canMerge(tcard, offer.card)) { buyMerge(shop, src.idx, tgt.idx); sfx.merge(); }
      else if (shop.board.length < ECON.boardSlots) { buyToSlot(shop, src.idx); sfx.buy(); }
      else return;
    } else { // board → board
      if (src.idx === tgt.idx) return;
      const tcard = shop.board[tgt.idx];
      const scard = shop.board[src.idx];
      if (tcard && scard && canMerge(tcard, scard)) { mergeOnBoard(shop, src.idx, tgt.idx); sfx.merge(); }
      else {
        const dest = tcard ? tgt.idx : shop.board.length - 1; // empty slot → move to end
        if (dest !== src.idx) { moveCard(shop, src.idx, dest); sfx.click(); }
      }
    }
    state.selected = null;
  } catch (err) {
    flashError();
  }
  renderShop();
}

// Swallow the synthetic click that fires right after a real drag's pointerup.
document.addEventListener('click', (e) => {
  if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
}, true);

function renderShop() {
  const run = state.run;
  const shop = run.shop;
  clearSelectionIfInvalid();
  const sel = state.selected;
  const root = $('screen-shop');
  root.innerHTML = '';

  const { units, traits } = applyBonuses(shop.board);

  // 1. status bar — persistent HUD: life, bet, wallet, round, ladder, gold
  const bar = el('div', 'status-bar');

  const hearts = el('span', 'hearts');
  for (let i = 0; i < MAX_HP; i++) {
    hearts.appendChild(iconImg(i < run.hp ? 'heart' : 'heartEmpty', 'hud-ico'));
  }
  bar.appendChild(hearts);

  bar.appendChild(el('span', 'round', `Bet ${money(run.stake)}`));
  bar.appendChild(el('span', 'round', `Wallet ${money(state.wallet)}`));
  bar.appendChild(el('span', 'round', `Round ${run.round}`));

  // One unified track: trophies earned (gold-filled), payout × under each slot,
  // and the current "win this next" position pulsing. Replaces the old separate
  // pill ladder + now/next multiplier readout — same language as the result screen.
  bar.appendChild(trophyLadderEl(run.trophies, { currentIdx: run.trophies, compact: true }));

  bar.appendChild(iconText('coin', String(shop.gold), 'gold'));
  root.appendChild(bar);

  // 2. opponent line
  root.appendChild(el('div', 'note', `Round ${run.round} — Tier ${run.trophies} opponent awaits`));

  // 3. board row (5 slots)
  const glowMap = glowMapFromTraits(traits);
  // cards lit because the player tapped a bonus to see what feeds it
  const hiTrait = state.highlightTrait && traits.find((t) => traitKey(t, shop.board) === state.highlightTrait);
  const hiIdxs = hiTrait ? new Set(hiTrait.cardIdxs) : new Set();
  const boardRow = el('div', 'board-row');
  for (let i = 0; i < ECON.boardSlots; i++) {
    const card = shop.board[i];
    const wrap = el('div', null);
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.position = 'relative';
    if (card) {
      const unit = units[i];
      const isSel = sel && sel.zone === 'board' && sel.idx === i;
      const tile = cardTile(card, {
        stats: { atk: unit.atk, hp: unit.hp },
        base: cardStats(card),
        glow: glowMap[i],
        selected: isSel,
        onClick: () => onCardClick('board', i),
      });
      if (hiIdxs.has(i)) tile.classList.add('contributing');
      attachDrag(tile, { zone: 'board', idx: i });
      wrap.appendChild(tile);
      // selecting a board card reveals its stat breakdown as a tooltip above it
      if (isSel) wrap.appendChild(cardBreakdownEl(card, traits, i, unit));
    } else {
      const slot = el('div', 'slot', '+');
      slot.dataset.zone = 'board';
      slot.dataset.idx = i;
      slot.addEventListener('click', () => onCardClick('board', i));
      wrap.appendChild(slot);
    }
    if (i === 0) {
      const fm = el('div', 'front-marker');
      fm.appendChild(iconImg('swords', 'fm-ico'));
      fm.appendChild(el('span', null, 'front'));
      wrap.appendChild(fm);
    }
    boardRow.appendChild(wrap);
  }
  root.appendChild(boardRow);

  // 4. traits panel — tap a bonus to light up the cards feeding it
  const tp = el('div', 'traits-panel');
  for (const t of traits) {
    const key = traitKey(t, shop.board);
    const row = el('div', 'trait-row' + (key === state.highlightTrait ? ' active' : ''));
    row.appendChild(el('div', 'trait-name', traitLabel(t)));
    const wide = BOARD_WIDE.has(t.name);
    const ranks = wide ? '' : ` (${t.cardIdxs.map((i) => rankLabel(shop.board[i].rank)).join(', ')})`;
    row.appendChild(el('div', 'trait-bonus', `${bonusPhrase(t, wide)}${ranks}`));
    row.addEventListener('click', () => {
      state.highlightTrait = state.highlightTrait === key ? null : key;
      sfx.select();
      renderShop();
    });
    tp.appendChild(row);
  }
  root.appendChild(tp);

  // 5. shop row (3 offers) — an offer whose rank matches a pet you already hold
  // gets a glow, so dup/merge opportunities pop without reading every card.
  const shopRow = el('div', 'shop-row');
  const boardRanks = new Set(shop.board.map((c) => c.rank));
  for (let i = 0; i < ECON.shopSize; i++) {
    const offer = shop.offers[i];
    const wrap = el('div', null);
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    if (offer) {
      const tile = cardTile(offer.card, {
        showTier: true,
        dupe: boardRanks.has(offer.card.rank),
        selected: sel && sel.zone === 'offer' && sel.idx === i,
        onClick: () => onCardClick('offer', i),
      });
      attachDrag(tile, { zone: 'offer', idx: i });
      wrap.appendChild(tile);
      const ctrl = el('div', 'offer-ctrl');
      // buy-cost tag (the "2g" belongs to buying, not to the lock)
      const buyTag = el('span', 'buy-tag');
      buyTag.appendChild(iconText('coin', String(ECON.buyCost), null));
      ctrl.appendChild(buyTag);
      // lock = free "keep this offer for next round"
      const lock = el('button', 'btn lock-btn' + (offer.frozen ? ' locked' : ''));
      lock.appendChild(iconImg('lock', 'btn-ico'));
      lock.title = offer.frozen ? 'Locked — kept for next round (free)' : 'Lock to keep next round (free)';
      lock.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try { toggleFreeze(shop, i); sfx.lock(); } catch (e) { flashError(); }
        renderShop();
      });
      ctrl.appendChild(lock);
      wrap.appendChild(ctrl);
    } else {
      const slot = el('div', 'slot', '');
      wrap.appendChild(slot);
    }
    shopRow.appendChild(wrap);
  }
  root.appendChild(shopRow);

  // 6. action bar
  const actions = el('div', null);
  actions.style.display = 'flex';
  actions.style.alignItems = 'center';
  actions.style.gap = '10px';

  const rerollBtn = el('button', 'btn', null);
  rerollBtn.appendChild(el('span', null, 'Reroll'));
  rerollBtn.appendChild(iconText('coin', String(ECON.rerollCost), 'btn-coin'));
  rerollBtn.disabled = shop.gold < ECON.rerollCost;
  rerollBtn.addEventListener('click', () => {
    try { reroll(shop, run.rng); sfx.reroll(); } catch (e) { flashError(); }
    renderShop();
  });
  actions.appendChild(rerollBtn);

  // draggable sell zone — drop a board card here to sell it; also click-to-sell
  // the currently selected card. Refund scales with the card's level.
  const selCard = sel && sel.zone === 'board' ? shop.board[sel.idx] : null;
  const sellZone = el('div', 'sell-zone' + (selCard ? ' armed' : ''));
  sellZone.dataset.zone = 'sell';
  sellZone.appendChild(iconImg('coin', 'sell-zone-ico'));
  if (selCard) {
    sellZone.appendChild(el('span', 'sell-zone-label', `Sell for +${sellValue(selCard)}`));
    sellZone.addEventListener('click', () => {
      if (!(sel && sel.zone === 'board')) return;
      try { sell(shop, sel.idx); sfx.sell(); state.selected = null; } catch (e) { flashError(); }
      renderShop();
    });
  } else {
    sellZone.appendChild(el('span', 'sell-zone-label', 'Drag a pet here to sell'));
  }
  actions.appendChild(sellZone);

  const fightBtn = el('button', 'btn btn-primary', 'Fight');
  fightBtn.disabled = shop.board.length === 0;
  fightBtn.addEventListener('click', () => {
    sfx.fight();
    state.lastBattle = startBattle(run);
    state.selected = null;
    renderBattle();
    show('battle');
  });
  actions.appendChild(fightBtn);

  root.appendChild(actions);

  // 7. hand-progress HUD + deck/discard tracker — how close you are, what
  // completes it, and whether those cards are still live.
  const hud = handHudEl(shop);
  if (hud) root.appendChild(hud);
  root.appendChild(deckTrackerEl(shop));
}

// Forward-looking hand HUD: how close the board is to completing/upgrading a
// straight or flush, the bonus it would add, and whether the completing cards
// are still live in the deck — turning "do I chase it?" into a real read.
function handHudEl(shop) {
  const prog = handProgress(shop.board);
  const hud = el('div', 'hand-hud');
  let rows = 0;

  const { suit, size: fsize } = prog.flush;
  const flushLive = suit ? shop.deck.filter((c) => c.suits[0] === suit).length : 0;
  // show only actionable hands: already scoring (3+) or still completable (live outs)
  if (suit && (fsize >= 3 || (fsize >= 2 && flushLive > 0))) {
    rows++;
    const live = flushLive;
    const now = fsize >= 3 ? FLUSH_RAMP[fsize].hp * fsize : 0;
    const max = FLUSH_RAMP[5].hp * 5;
    const row = el('div', 'hud-row');
    const g = el('span', 'hud-ico'); g.textContent = SUIT_GLYPH[suit]; g.style.color = SUIT_COLOR[suit];
    row.appendChild(g);
    row.appendChild(el('span', 'hud-label', `Flush ${fsize}/5`));
    if (fsize >= 5) {
      row.appendChild(el('span', 'hud-bonus done', `+${now} hp ✓`));
    } else {
      row.appendChild(el('span', 'hud-bonus', `+${now} → +${max} hp`));
      row.appendChild(el('span', 'hud-live' + (live > 0 ? '' : ' dry'), `${live} ${SUIT_GLYPH[suit]} live`));
    }
    hud.appendChild(row);
  }

  const { values: vals, size: ssize } = prog.straight;
  if (ssize >= 2) {
    // ranks that would extend the run at either end (ace-low neighbor maps to A)
    const lo = vals[0], hi = vals[vals.length - 1];
    const ranks = [...new Set([lo - 1, hi + 1].filter((v) => v >= 1 && v <= 14).map((v) => (v === 1 ? 14 : v)))];
    const need = ranks.map((rank) => ({ rank, live: shop.deck.filter((c) => c.rank === rank).length }));
    const anyLive = need.some((n) => n.live > 0);
    if (ssize >= 3 || anyLive) {
      rows++;
      const now = ssize >= 3 ? STRAIGHT_RAMP[ssize].atk * ssize : 0;
      const max = STRAIGHT_RAMP[5].atk * 5;
      const row = el('div', 'hud-row');
      row.appendChild(el('span', 'hud-ico', '⏤'));
      row.appendChild(el('span', 'hud-label', `Straight ${ssize}/5`));
      if (ssize >= 5) {
        row.appendChild(el('span', 'hud-bonus done', `+${now} atk ✓`));
      } else {
        row.appendChild(el('span', 'hud-bonus', `+${now} → +${max} atk`));
        const txt = need.map((n) => `${rankLabel(n.rank)}×${n.live}`).join('  ');
        row.appendChild(el('span', 'hud-live' + (anyLive ? '' : ' dry'), `need ${txt}`));
      }
      hud.appendChild(row);
    }
  }

  return rows === 0 ? null : hud;
}

// Deck & discard tracker — the card-counting affordance. The deck is finite, so
// showing what's still live (per suit for flushes, per rank for straights, plus
// foils) turns "do I chase it?" into an informed read.
function deckTrackerEl(shop) {
  const wrap = el('div', 'deck-tracker');

  const deck = el('div', 'deck-pile');
  deck.appendChild(el('div', 'pile-title', `Deck · ${shop.deck.length}`));

  const suitRow = el('div', 'pile-suits');
  for (const s of SUITS) {
    const n = shop.deck.filter((c) => c.suits[0] === s).length;
    const chip = el('div', 'pile-suit' + (n === 0 ? ' gone' : ''));
    const g = el('span', 'pile-suit-g', SUIT_GLYPH[s]);
    g.style.color = SUIT_COLOR[s];
    chip.appendChild(g);
    chip.appendChild(el('span', 'pile-suit-n', String(n)));
    suitRow.appendChild(chip);
  }
  deck.appendChild(suitRow);

  const rankRow = el('div', 'pile-ranks');
  for (const r of unlockedRanks(shop.tier)) {
    const n = shop.deck.filter((c) => c.rank === r).length;
    const cell = el('div', 'pile-rank' + (n === 0 ? ' gone' : ''));
    cell.appendChild(el('span', 'pile-rank-lbl', rankLabel(r)));
    cell.appendChild(el('span', 'pile-rank-n', String(n)));
    rankRow.appendChild(cell);
  }
  deck.appendChild(rankRow);

  const foilN = shop.deck.filter((c) => c.foil).length;
  deck.appendChild(el('div', 'pile-foils' + (foilN === 0 ? ' none' : ''),
    foilN > 0 ? `✦ ${foilN} foil${foilN > 1 ? 's' : ''} still live` : 'no foils left in the deck'));
  wrap.appendChild(deck);

  const disc = el('div', 'discard-pile');
  disc.appendChild(el('div', 'pile-title', `Discard · ${shop.discard.length}`));
  disc.appendChild(el('div', 'pile-sub', 'spent — reshuffles back when the deck runs dry'));
  wrap.appendChild(disc);

  return wrap;
}

// ---------- battle screen ----------
const CLASH_MS = 500;   // pacing per clash
const DEATH_MS = 450;   // fade-out before tile removal

// Active playback timers; cleared on Skip.
let battleTimers = [];

function clearBattleTimers() {
  for (const t of battleTimers) clearTimeout(t);
  battleTimers = [];
}

// Build a compact traits summary line ("Pair · Flush" or "no traits").
function traitsSummary(traits) {
  if (!traits || traits.length === 0) return 'no traits';
  return traits.map((t) => traitLabel(t)).join(' · ');
}

// One side's row + state. Returns {rowEl, tiles, units} where tiles[i] is the
// DOM tile for unit i (null after death/removal) and units[i] tracks live hp.
function buildBattleRow(rowClass, snapshotUnits, traits) {
  const row = el('div', rowClass);
  const glowMap = glowMapFromTraits(traits || []);
  const units = snapshotUnits.map((u) => ({
    card: u.card,
    atk: u.atk,
    startHp: u.hp,
    hp: u.hp,
  }));
  const tiles = units.map((u, i) =>
    cardTile(u.card, {
      stats: { atk: u.atk, hp: u.hp },
      base: cardStats(u.card), // hand-bonus-buffed stats render green in battle
      glow: glowMap[i],
    })
  );
  for (const t of tiles) row.appendChild(t);
  return { row, tiles, units };
}

// Update the hp badge on a tile to reflect current hp; hurt when below start.
function setTileHp(tile, hp, startHp) {
  if (!tile) return;
  const hpBadge = tile.querySelector('.stat-badge.hp');
  if (!hpBadge) return;
  const num = hpBadge.querySelector('.stat-num');
  if (num) num.textContent = String(hp);
  hpBadge.classList.toggle('stat-hurt', hp < startHp);
  hpBadge.classList.toggle('stat-buffed', false);
}

// Spawn a floating damage number over a tile.
function spawnDmgFloat(tile, dmg) {
  if (!tile || dmg <= 0) return;
  const f = el('div', 'dmg-float', `-${dmg}`);
  tile.appendChild(f);
  const t = setTimeout(() => f.remove(), 950);
  battleTimers.push(t);
}

function renderBattle() {
  clearBattleTimers();
  const root = $('screen-battle');
  root.innerHTML = '';
  const lb = state.lastBattle;

  // header: traits summaries
  const header = el('div', 'status-bar');
  header.appendChild(el('span', 'round', `Enemy: ${traitsSummary(lb.enemy.traits)}`));
  const spacer = el('span', null, '');
  spacer.style.flex = '1';
  header.appendChild(spacer);
  header.appendChild(el('span', 'round', `You: ${traitsSummary(lb.player.traits)}`));
  root.appendChild(header);

  // battle field
  const field = el('div', 'battle-rows');
  field.style.margin = 'auto 0';

  const enemy = buildBattleRow('enemy-row', lb.enemy.units, lb.enemy.traits);
  const divider = el('div', 'battle-divider', 'VS');
  const player = buildBattleRow('player-row', lb.player.units, lb.player.traits);

  field.appendChild(enemy.row);
  field.appendChild(divider);
  field.appendChild(player.row);
  root.appendChild(field);

  // Controls bar (rebuilt by updateControls as playback state changes).
  const controls = el('div', 'battle-controls');
  root.appendChild(controls);
  const hint = el('div', 'battle-hint', 'Examine the matchup, then Step through it or Auto-play.');
  root.appendChild(hint);

  const events = lb.battle.events;
  let cursor = 0;          // index of the next event to apply
  let mode = 'idle';       // 'idle' | 'auto'
  let autoTimer = null;
  const atEnd = () => cursor >= events.length;

  // ----- single-event visuals -----
  function applyClash(ev) {
    const pTile = player.tiles[ev.pIdx];
    const eTile = enemy.tiles[ev.eIdx];
    if (pTile) { pTile.classList.add('clash'); battleTimers.push(setTimeout(() => pTile.classList.remove('clash'), 360)); }
    if (eTile) { eTile.classList.add('clash'); battleTimers.push(setTimeout(() => eTile.classList.remove('clash'), 360)); }
    const dmgT = setTimeout(() => {
      spawnDmgFloat(pTile, ev.pDmg);
      spawnDmgFloat(eTile, ev.eDmg);
      player.units[ev.pIdx].hp = ev.pHp;
      enemy.units[ev.eIdx].hp = ev.eHp;
      setTileHp(pTile, ev.pHp, player.units[ev.pIdx].startHp);
      setTileHp(eTile, ev.eHp, enemy.units[ev.eIdx].startHp);
    }, 160);
    battleTimers.push(dmgT);
    sfx.clash();
  }

  function applyDeath(ev) {
    const tiles = ev.side === 'player' ? player.tiles : enemy.tiles;
    const tile = tiles[ev.idx];
    if (tile) {
      tile.classList.add('dying');
      battleTimers.push(setTimeout(() => tile.remove(), DEATH_MS));
      tiles[ev.idx] = null;
    }
    sfx.death();
  }

  // One exchange = the next clash plus any deaths it caused.
  function stepExchange() {
    if (atEnd()) { endPlayback(); return; }
    const ev = events[cursor++];
    if (ev.type === 'clash') applyClash(ev);
    else applyDeath(ev);
    while (cursor < events.length && events[cursor].type === 'death') applyDeath(events[cursor++]);
    if (atEnd()) {
      battleTimers.push(setTimeout(endPlayback, CLASH_MS));
    } else if (mode === 'auto') {
      autoTimer = setTimeout(stepExchange, CLASH_MS);
      battleTimers.push(autoTimer);
    }
    updateControls();
  }

  function startAuto() { if (atEnd()) return; mode = 'auto'; updateControls(); stepExchange(); }
  function pauseAuto() { mode = 'idle'; if (autoTimer) clearTimeout(autoTimer); autoTimer = null; updateControls(); }
  function manualStep() { if (mode === 'auto' || atEnd()) return; stepExchange(); }

  // Jump straight to the resolved final state: set all hp, remove dead tiles.
  function skipAll() {
    mode = 'idle';
    clearBattleTimers();
    const deadPlayer = new Set();
    const deadEnemy = new Set();
    for (const ev of events) {
      if (ev.type === 'clash') {
        player.units[ev.pIdx].hp = ev.pHp;
        enemy.units[ev.eIdx].hp = ev.eHp;
      } else if (ev.type === 'death') {
        if (ev.side === 'player') deadPlayer.add(ev.idx);
        else deadEnemy.add(ev.idx);
      }
    }
    player.units.forEach((u, i) => {
      if (deadPlayer.has(i)) { if (player.tiles[i]) { player.tiles[i].remove(); player.tiles[i] = null; } }
      else setTileHp(player.tiles[i], u.hp, u.startHp);
    });
    enemy.units.forEach((u, i) => {
      if (deadEnemy.has(i)) { if (enemy.tiles[i]) { enemy.tiles[i].remove(); enemy.tiles[i] = null; } }
      else setTileHp(enemy.tiles[i], u.hp, u.startHp);
    });
    for (const t of root.querySelectorAll('.dying')) t.remove();
    cursor = events.length;
    endPlayback();
  }

  // Rebuild controls for the current state.
  function updateControls() {
    controls.innerHTML = '';
    const started = cursor > 0;
    if (mode === 'auto') {
      controls.appendChild(ctrlBtn('❚❚ Pause', 'btn', pauseAuto));
    } else if (!atEnd()) {
      controls.appendChild(ctrlBtn('▶ Step', 'btn btn-primary', manualStep));
      controls.appendChild(ctrlBtn('▶▶ Auto-play', 'btn', startAuto));
    }
    if (!atEnd()) controls.appendChild(ctrlBtn('Skip to end', 'btn', skipAll));
    hint.style.visibility = started || atEnd() ? 'hidden' : 'visible';
  }

  let overlayShown = false;
  function endPlayback() {
    if (overlayShown) return;
    showResultOverlay();
  }

  function showResultOverlay() {
    if (overlayShown) return;
    overlayShown = true;
    controls.innerHTML = '';
    hint.style.visibility = 'hidden';
    const winner = lb.battle.winner;
    if (winner === 'player') sfx.victory();
    else if (winner === 'enemy') sfx.defeat();
    else sfx.draw();
    const run = state.run;
    const overlay = el('div', 'overlay');
    const panel = el('div', 'overlay-panel result-panel');

    let title;
    if (winner === 'player') title = 'VICTORY';
    // A losing battle that ENDS the run reframes as a positive send-off; a
    // mid-run loss keeps the sting of "DEFEAT" to preserve the stakes.
    else if (winner === 'enemy') title = run.phase === 'done' ? 'Good run!' : 'DEFEAT';
    else title = 'DRAW — run it back';
    panel.appendChild(el('h2', null, title));

    // trophy ladder — animate the just-earned trophy
    const earnIdx = winner === 'player' ? run.trophies - 1 : -1;
    panel.appendChild(trophyLadderEl(run.trophies, { animateIdx: earnIdx }));

    // pack unlock — winning trophy 1/2/3 opens pack 1/2/3. Celebrate it loudly:
    // show the new tier's pets, which appear in the shop from the next round on.
    const unlockedPack = winner === 'player' && run.trophies >= 1 && run.trophies <= 3 ? run.trophies : null;
    if (unlockedPack != null) { panel.appendChild(packUnlockEl(unlockedPack)); sfx.unlock(); }

    // hearts — animate the just-broken heart on a loss
    const brokeIdx = winner === 'enemy' ? run.hp : -1;
    panel.appendChild(heartsRowEl(run.hp, brokeIdx));

    // central wager + current payout
    panel.appendChild(wagerPayoutEl(run).box);

    if (winner === 'player') sfx.trophy();
    else if (winner === 'enemy') sfx.heartbreak();

    const cont = el('button', 'btn btn-primary', 'Continue');
    let continued = false; // guard: rapid double-clicks must not credit payout twice
    cont.addEventListener('click', () => {
      if (continued) return;
      continued = true;
      sfx.click();
      overlay.remove();
      onContinue();
    });
    panel.appendChild(cont);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  updateControls(); // examine state — playback waits for the player
}

// small helper for battle control buttons
function ctrlBtn(label, cls, onClick) {
  const b = el('button', cls, label);
  b.addEventListener('click', () => { sfx.click(); onClick(); });
  return b;
}

// ---------- shared result displays ----------
// A row of MAX_TROPHIES trophy positions: earned ones gold, the rest
// silhouettes, with the payout multiplier for holding that many under each.
// animateIdx (0-based trophy slot) plays the celebratory pop+sparkle.
function trophyLadderEl(trophies, { animateIdx = -1, currentIdx = -1, compact = false } = {}) {
  const row = el('div', 'trophy-ladder' + (compact ? ' compact' : ''));
  for (let i = 0; i < MAX_TROPHIES; i++) {
    const cell = el('div', 'trophy-cell');
    const earned = i < trophies;
    const slot = el('div', 'trophy-slot' + (earned ? ' earned' : ' empty') + (i === currentIdx ? ' current' : ''));
    slot.appendChild(iconImg('trophy', 'trophy-img' + (earned ? '' : ' silhouette')));
    if (i === animateIdx) {
      slot.classList.add('trophy-pop');
      slot.appendChild(iconImg('sparkles', 'trophy-spark'));
    }
    cell.appendChild(slot);
    cell.appendChild(el('div', 'trophy-mult', `${LADDER[i + 1]}×`)); // payout for holding i+1
    row.appendChild(cell);
  }
  return row;
}

// Pack-unlock flourish for the victory screen. `pack` is the 0-based pack index
// (1–3) that just opened; shows its tier gem and the new pets now in the shop.
function packUnlockEl(pack) {
  const box = el('div', 'pack-unlock');
  box.appendChild(el('div', 'pack-unlock-title', 'NEW PACK UNLOCKED'));
  const sub = el('div', 'pack-unlock-sub');
  sub.appendChild(el('span', `tier-gem tier-${pack}`, String(pack + 1)));
  sub.appendChild(el('span', null, `Tier ${pack + 1} pets now appear in the shop`));
  box.appendChild(sub);
  const pets = el('div', 'pack-unlock-pets');
  RANK_PACKS[pack].forEach((rank, i) => {
    const chip = el('div', 'pack-pet');
    chip.style.animationDelay = `${0.15 + i * 0.08}s`;
    chip.appendChild(petImg({ rank, suits: ['H'], level: 1 }));
    chip.appendChild(el('span', 'pack-pet-rank', rankLabel(rank)));
    pets.appendChild(chip);
  });
  box.appendChild(pets);
  return box;
}

// Life hearts; brokenIdx plays a heart-break that resolves to an empty heart.
function heartsRowEl(hp, brokenIdx = -1) {
  const row = el('div', 'hearts-display');
  for (let i = 0; i < MAX_HP; i++) {
    const cell = el('div', 'heart-cell');
    if (i === brokenIdx) {
      cell.appendChild(iconImg('heartEmpty', 'heart-img heart-base'));
      cell.appendChild(iconImg('heart', 'heart-img heart-breaking'));
    } else {
      cell.appendChild(iconImg(i < hp ? 'heart' : 'heartEmpty', 'heart-img'));
    }
    row.appendChild(cell);
  }
  return row;
}

// Central wager + current payout block (always shown on result surfaces).
function wagerPayoutEl(run, { payoutOverride = null } = {}) {
  const mult = LADDER[run.trophies];
  const amount = payoutOverride != null ? payoutOverride : run.stake * mult;
  const box = el('div', 'wager-box');
  box.appendChild(el('div', 'wager-line', `Wager ${money(run.stake)}`));
  const payoutLine = el('div', 'payout-amount', money(amount));
  box.appendChild(payoutLine);
  box.appendChild(el('div', 'payout-sub', `${mult}× payout`));
  return { box, payoutLine };
}

function onContinue() {
  const run = state.run;
  if (run.phase === 'done') {
    const winnings = payout(run);
    setWallet(state.wallet + winnings);
    renderEnd(winnings);
    show('end');
  } else {
    renderShop();
    show('shop');
  }
}

// ---------- run end screen ----------
function renderEnd(winnings) {
  const run = state.run;
  const root = $('screen-end');
  root.innerHTML = '';

  const panel = el('div', 'overlay-panel result-panel');
  panel.style.margin = 'auto';

  const perfect = run.trophies >= MAX_TROPHIES;
  panel.appendChild(el('h2', null, perfect ? 'Perfect Run!' : 'Good run! Try again!'));

  // final trophy ladder (silhouettes for unearned) + multipliers under each
  panel.appendChild(trophyLadderEl(run.trophies));

  // remaining life hearts
  panel.appendChild(heartsRowEl(run.hp));

  // central wager + counted-up payout
  const { box, payoutLine } = wagerPayoutEl(run, { payoutOverride: 0 });
  payoutLine.classList.add('payout-big');
  panel.appendChild(box);

  // summary line — celebrate trophies/winnings rather than dwelling on the loss
  const trophyWord = run.trophies === 1 ? 'trophy' : 'trophies';
  const summary = perfect
    ? `${run.trophies} trophies · perfect run`
    : winnings > 0
      ? `${run.trophies} ${trophyWord} · banked ${money(winnings)}`
      : `${run.trophies} ${trophyWord} · so close!`;
  panel.appendChild(el('div', 'note', summary));

  panel.appendChild(el('div', null, `Wallet: ${money(state.wallet)}`));

  const again = el('button', 'btn btn-primary', 'Play Again');
  again.addEventListener('click', () => {
    sfx.click();
    state.run = null;
    state.lastBattle = null;
    state.selected = null;
    renderTitle();
    show('title');
  });
  panel.appendChild(again);

  root.appendChild(panel);

  // animate payout count-up over ~1s
  const target = winnings;
  if (target <= 0) {
    payoutLine.textContent = money(0);
  } else {
    sfx.payout();
    const duration = 1000;
    const startTs = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - startTs) / duration);
      payoutLine.textContent = money(target * p);
      if (p < 1) requestAnimationFrame(tick);
      else payoutLine.textContent = money(target);
    };
    requestAnimationFrame(tick);
  }
}

// ---------- sound toggle ----------
function mountSfxToggle() {
  const btn = el('button', 'sfx-toggle');
  const sync = () => {
    const on = !isMuted();
    btn.textContent = on ? 'Sound: On' : 'Sound: Off';
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
  };
  btn.addEventListener('click', () => { toggleMuted(); sync(); sfx.click(); });
  sync();
  document.body.appendChild(btn);
}
mountSfxToggle();

// ---------- boot ----------
renderTitle();
show('title');
