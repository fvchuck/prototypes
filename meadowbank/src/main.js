// Wiring: auto-play orchestration <-> renderer <-> UI <-> audio.
//
// The board plays itself. decide() (src/decide.js) is consulted for each tile and
// either auto-drops it or surfaces 2-3 ghost options for the player to tap. At the
// end of a run a near-miss may trigger the buy-more-tiles ladder.
import { Game, EXTRA_BOOST_P, EXTRA_MAX_RUNGS } from './game.js';
import { decide } from './decide.js';
import { Renderer } from './render.js';
import { initAudio, resumeAudio, setMuted, sfx } from './audio.js';
import {
  $, updateHUD, updateTray, buildCallouts, toast, floatText,
  showEndScreen, hideEndScreen, showBuyOffer, hideBuyOffer,
  showChoiceBanner, hideChoiceBanner,
} from './ui.js';
import { unkey } from './hex.js';
import { CASTLE, CASTLE_MULT, fmt, rotEdges } from './tiles.js';

const AUTO_MS = 560;   // delay between auto-dropped tiles
const TURBO_MS = 160;  // …with turbo on

const game = new Game();
let renderer = null;
let muted = false;
let turbo = false;
try { turbo = localStorage.getItem('mb_turbo') === '1'; } catch { /* headless */ }

let mode = 'idle';        // idle | auto | choice | buy | over
let pendingChoice = null; // [options] while waiting for a tap
let loopTimer = null;

function refresh() {
  updateHUD(game);
  updateTray(game);
  renderer.setCallouts(buildCallouts(game));
  renderer.updateGlow(game.sectionList());
}

// ---------- the auto-play loop ----------
function scheduleNext() {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(loop, turbo ? TURBO_MS : AUTO_MS);
}

function loop() {
  if (!game.run || game.run.over || game.run.exhausted || mode === 'buy') return;
  const d = decide(game);
  if (d.mode === 'end') { game.exhaust(); return; }
  if (d.mode === 'choice') { presentChoice(d.options); return; }
  commit(d.options[0]);
  if (!game.run.exhausted && !game.run.over) scheduleNext();
}

function commit(option) {
  mode = 'auto';
  game.run.rotation = option.rot;
  const result = game.place(option.q, option.r);
  if (!result) return;
  placeJuice(option.q, option.r, result);
  refresh();
}

// ---------- player choice ----------
function presentChoice(options) {
  mode = 'choice';
  for (const o of options) o.edges = rotEdges(game.current.edges, o.rot);
  pendingChoice = options;
  renderer.setValidCells(new Set(options.map((o) => o.cell)));
  renderer.showChoiceGhosts(options);
  renderer.setChoicePins(options.map((o) => ({
    q: o.q, r: o.r, cls: o.label.cls,
    html: `<span class="pin-tag">${o.label.tag}</span><span class="pin-text">${o.label.text}</span>`,
  })));
  showChoiceBanner(choicePrompt(options));
  sfx.select?.();
}

function choicePrompt(options) {
  const tags = new Set(options.map((o) => o.archetype));
  if (tags.has('CASTLE')) return '👑 Your move';
  if (tags.has('BANK') && tags.has('PUSH')) return 'Bank it — or push for more?';
  if (tags.has('BANK')) return 'Lock in which one?';
  if (tags.has('PUSH') && tags.has('SEED')) return 'Grow it, or start fresh?';
  if (tags.has('PUSH')) return 'Which to grow?';
  if (tags.has('SEED')) return 'Where to build?';
  return 'Your move';
}

function resolveChoice(option) {
  pendingChoice = null;
  renderer.clearChoiceGhosts();
  renderer.setChoicePins([]);
  renderer.setValidCells(new Set());
  hideChoiceBanner();
  commit(option);
  if (!game.run.exhausted && !game.run.over) scheduleNext();
}

// ---------- placement celebration (shared by auto + choice + bought tiles) ----------
function placeJuice(q, r, result) {
  renderer.addTile(q, r, result.edges, true);
  sfx.place();
  setTimeout(() => {
    let extendedAny = false;
    for (const ex of result.extended) {
      if (!ex.cells.length) continue;
      renderer.shakeTiles(ex.cells);
      if (ex.delta > 0) {
        const p = renderer.cellsScreenPos(ex.cells);
        floatText(p.x, p.y - 16, `+${fmt(ex.delta)}`, ex.type === CASTLE ? 'gold' : 'good');
        extendedAny = true;
      }
    }
    if (extendedAny) sfx.extend();

    if (result.castleStarted) {
      sfx.castleEdge();
      renderer.burst([`${q},${r}`], 0xffce4f, true);
      toast(`👑 A castle! Its rare twin seals the ${fmt(game.bet * CASTLE_MULT)} jackpot.`, 'gold');
      const p = renderer.cellScreenPos(q, r);
      floatText(p.x, p.y - 30, 'CASTLE!', 'gold');
    }
    let delay = 0;
    for (const f of result.completed) {
      if (!f.payout) continue;
      setTimeout(() => {
        const cells = [...f.tiles];
        if (f.type === CASTLE) {
          sfx.jackpot();
          renderer.burst(cells, 0xffce4f, true);
          toast(`👑 CASTLE COMPLETE! +${fmt(f.payout)} JACKPOT!`, 'gold big');
          document.body.classList.add('flash-gold');
          setTimeout(() => document.body.classList.remove('flash-gold'), 1200);
        } else {
          sfx.complete(f.payout);
          renderer.burst(cells, 0x7ec850);
        }
        const c = unkey(cells[0]);
        const p = renderer.cellScreenPos(c.q, c.r);
        floatText(p.x, p.y, `+${fmt(f.payout)}`, f.type === CASTLE ? 'gold' : 'good');
        sfx.bank();
        refresh();
      }, 350 + delay);
      delay += 450;
    }
  }, 180);
}

// ---------- buy-more-tiles ----------
game.on('exhausted', ({ target }) => {
  setTimeout(() => maybeOfferBuy(target), turbo ? 400 : 850);
});

function maybeOfferBuy(target) {
  if (!game.run || game.run.over) return;
  if (!target || game.run.boughtRungs >= EXTRA_MAX_RUNGS) { finalize(); return; }
  mode = 'buy';
  const price = game.extraPrice(target);
  const canAfford = game.wallet >= price;
  const isCastle = target.type === CASTLE;
  if (isCastle) { sfx.castleEdge?.(); document.body.classList.add('flash-gold'); setTimeout(() => document.body.classList.remove('flash-gold'), 900); }
  showBuyOffer(
    { target, boostP: EXTRA_BOOST_P, price, rung: game.run.boughtRungs + 1, canAfford, isCastle },
    () => {
      hideBuyOffer();
      game.buyExtra(target);
      sfx.select();
      toast(`Bought a boosted draw — ${fmt(price)}`, 'gold');
      refresh();
      mode = 'auto';
      loop();
    },
    () => { hideBuyOffer(); finalize(); },
  );
}

function finalize() {
  mode = 'over';
  game.endRun();
}

game.on('over', (data) => {
  setTimeout(() => {
    sfx.runEnd(data.net);
    if (data.castleNearMiss) sfx.fail();
    showEndScreen(data, () => sfx.tick(), () => {});
    updateHUD(game);
  }, 900);
});

// ---------- run lifecycle ----------
function startRun() {
  if (game.wallet < game.bet) {
    game.wallet = Math.max(20, game.bet);
    game.saveWallet();
    toast(`Wallet refilled to ${fmt(game.wallet)} (prototype)`, '');
  }
  clearTimeout(loopTimer);
  pendingChoice = null;
  hideEndScreen();
  hideBuyOffer();
  hideChoiceBanner();
  $('start-modal').classList.add('hidden');
  game.newRun();
  rebuildBoard();
  renderer.setValidCells(new Set());
  renderer.clearChoiceGhosts();
  renderer.setChoicePins([]);
  refresh();
  toast(`Tiles place themselves — tap when the board asks. Castle pair pays ${fmt(game.bet * CASTLE_MULT)}!`, 'gold');
  mode = 'auto';
  scheduleNext();
}

function rebuildBoard() {
  renderer.tiles.clear();
  renderer.tileMeshes.clear();
  renderer.hideGhost();
  renderer.clearChoiceGhosts();
  for (const t of game.run.board.values()) renderer.addTile(t.q, t.r, t.edges, false);
}

// ---------- bet picker ----------
function setBet(v) {
  game.bet = v;
  for (const chip of document.querySelectorAll('.bet-chip')) {
    chip.classList.toggle('active', Number(chip.dataset.bet) === v);
  }
  $('play-btn').textContent = `PLAY — ${fmt(v)}`;
}
for (const chip of document.querySelectorAll('.bet-chip')) {
  chip.addEventListener('click', () => { setBet(Number(chip.dataset.bet)); sfx.select?.(); });
}
setBet(game.bet);

// ---------- boot ----------
renderer = new Renderer($('board'), {
  onHover() { /* auto-play: no manual ghost */ },
  onTap(cellKey) {
    resumeAudio();
    if (mode !== 'choice' || !pendingChoice || !cellKey) return;
    const opt = pendingChoice.find((o) => o.cell === cellKey);
    if (opt) resolveChoice(opt);
  },
});

// ---------- turbo ----------
function setTurbo(on) {
  turbo = on;
  try { localStorage.setItem('mb_turbo', on ? '1' : '0'); } catch { /* headless */ }
  const btn = $('turbo-btn');
  btn.classList.toggle('on', on);
  btn.textContent = on ? '⏩ Turbo ON' : '⏩ Turbo';
}
$('turbo-btn').addEventListener('click', () => { setTurbo(!turbo); sfx.select?.(); });
setTurbo(turbo);

if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
  document.body.classList.add('is-desktop');
}

$('play-btn').addEventListener('click', () => { initAudio(); resumeAudio(); startRun(); });
$('again-btn').addEventListener('click', () => startRun());
$('view-btn').addEventListener('click', () => hideEndScreen());
$('collect-btn').addEventListener('click', () => {
  hideEndScreen();
  $('start-modal').classList.remove('hidden');
  $('start-sub').textContent = `Wallet: ${fmt(game.wallet)}`;
});
$('mute-btn').addEventListener('click', () => {
  muted = !muted;
  setMuted(muted);
  $('mute-btn').textContent = muted ? '🔇' : '🔊';
});
$('rules-btn').addEventListener('click', () => $('rules-modal').classList.remove('hidden'));
$('rules-close').addEventListener('click', () => $('rules-modal').classList.add('hidden'));

$('start-sub').textContent = `Wallet: ${fmt(game.wallet)}`;

// debug/testing handle
window.SS = {
  game, renderer, decide, loop, startRun,
  state: () => ({
    mode, pending: pendingChoice ? pendingChoice.map((o) => ({ cell: o.cell, tag: o.label.tag, text: o.label.text })) : null,
    placements: game.run?.placements, tilesLeft: game.run ? game.tilesLeft : null,
    banked: game.run?.banked, over: game.run?.over, exhausted: game.run?.exhausted,
    boughtRungs: game.run?.boughtRungs, buyOpen: !$('buy-modal').classList.contains('hidden'),
  }),
  tap: (cell) => renderer.cb.onTap(cell),
};
