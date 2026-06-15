import { makeRng } from './rng.js';
import { rollFoils } from './cards.js';
import { newShop, refreshRound } from './shop.js';
import { applyBonuses } from './hands.js';
import { resolveBattle } from './combat.js';
import { pickEnemyBoard } from './boards.js';

// Payout ladder. Index = trophies at run end. The exciting 4x jackpot is held
// fixed; opponent board difficulty (boards.js) is the primary RTP lever and was
// calibrated against THIS ladder to land baseline RTP in the 96.5-98.5 band.
// Re-run `npm run sim` after any board/economy change.
export const LADDER = [0, 0.2, 0.4, 0.7, 1.3, 4];
export const MAX_TROPHIES = 5;
export const MAX_HP = 3;

export function newRun(stake, seed, foils = null) {
  const rng = makeRng(seed);
  const sessionFoils = foils ?? rollFoils(rng);
  return {
    stake, seed, rng,
    hp: MAX_HP, trophies: 0, round: 1,
    phase: 'shop', // 'shop' | 'done'
    foils: sessionFoils,
    shop: newShop(rng, 0, sessionFoils), // Game 1: pack 0 (lowest tier) only
  };
}

// Resolves one battle at the current tier and advances the run.
// Returns { battle, enemyCards, player: {units, traits}, enemy: {units, traits} }.
export function startBattle(run) {
  if (run.phase !== 'shop') throw new Error('not in shop phase');
  const enemyCards = pickEnemyBoard(run.trophies, run.rng);
  const player = applyBonuses(run.shop.board);
  const enemy = applyBonuses(enemyCards);
  const battle = resolveBattle(player.units, enemy.units);

  if (battle.winner === 'player') run.trophies++;
  else if (battle.winner === 'enemy') run.hp--;

  if (run.trophies >= MAX_TROPHIES || run.hp <= 0) {
    run.phase = 'done';
  } else {
    run.round++;
    refreshRound(run.shop, run.rng, run.trophies); // newly-won trophies widen the pool
  }
  return { battle, enemyCards, player, enemy };
}

export function payout(run) {
  return run.stake * LADDER[run.trophies];
}
