// Run state machine and payout accounting.
import { key, neighbor, opposite, dist } from './hex.js';
import {
  GRASS, CASTLE, TERRAIN_NAMES,
  genDeck, seedBoard, sectionPayout, mulberry32, rotEdges, fmt,
} from './tiles.js';
import { Sections, placementProblem } from './sections.js';
import { boostedTile } from './tiles.js';

export const RUN_TILES = 16;
const BOARD_RADIUS = 7;

// Buy-more-tiles tuning. Each rung draws a boosted tile that fits the near-miss
// with probability EXTRA_BOOST_P. Price is set strictly above the expected payout
// so every purchase is house-positive regardless of outcome (RTP-safe by design).
export const EXTRA_BOOST_P = 0.55;
const EXTRA_MARGIN = 1.25; // house edge over expected payout
const EXTRA_LADDER = 1.6;  // price escalation per rung
export const EXTRA_MAX_RUNGS = 3;

export class Game {
  constructor() {
    let store = null;
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') store = localStorage;
    } catch { /* headless */ }
    this.store = store;
    this.wallet = Number(store?.getItem('mb_wallet') ?? 20);
    this.bet = 1;
    this.listeners = {};
    this.run = null;
  }

  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  emit(ev, data) { for (const fn of this.listeners[ev] ?? []) fn(data); }

  saveWallet() { this.store?.setItem('mb_wallet', String(this.wallet)); }

  newRun(seed = (Math.random() * 2 ** 31) | 0) {
    this.wallet = Math.round((this.wallet - this.bet) * 100) / 100;
    this.saveWallet();
    const rng = mulberry32(seed);
    const board = new Map();
    const sections = new Sections();
    const seedInfo = seedBoard();
    const run = {
      seed, rng, board, sections,
      deck: genDeck(rng),
      idx: 0,
      placements: 0,
      budget: RUN_TILES,   // grows by 1 per bought extra tile
      reserve: null,
      rotation: 0,
      banked: 0,
      bankedOrder: [],   // completed features in order
      over: false,
      exhausted: false,  // base tiles used up, awaiting buy-more / finalize
      boughtRungs: 0,
      castleNearMiss: false,
    };
    for (const t of seedInfo.tiles) {
      const { completed } = sections.place(t.q, t.r, t.edges, board);
      board.set(key(t.q, t.r), { q: t.q, r: t.r, edges: t.edges });
      void completed;
    }
    this.run = run;
    this._undo = null;
    this.emit('run', run);
    return run;
  }

  // The (first) castle feature on the board, if any — completed or not.
  castleFeature() {
    if (!this.run) return null;
    for (const f of this.run.sections.all()) if (f.type === CASTLE) return f;
    return null;
  }

  get current() { return this.run?.deck[this.run.idx] ?? null; }
  get previews() {
    const r = this.run;
    return [r.deck[r.idx + 1], r.deck[r.idx + 2]].filter(Boolean);
  }
  get tilesLeft() { return this.run.budget - this.run.placements; }

  currentEdges() {
    return rotEdges(this.current.edges, this.run.rotation);
  }

  rotate(step = 1) {
    this.run.rotation = (this.run.rotation + step + 6) % 6;
    this.emit('rotate', this.run.rotation);
  }

  swapReserve() {
    const r = this.run;
    if (r.over) return;
    if (r.reserve == null) {
      if (r.idx + 1 >= r.deck.length) return; // nothing to draw into hand
      r.reserve = r.deck[r.idx];
      r.deck.splice(r.idx, 1); // current becomes next tile
    } else {
      const tmp = r.reserve;
      r.reserve = r.deck[r.idx];
      r.deck[r.idx] = tmp;
    }
    r.rotation = 0;
    this.emit('hand', null);
  }

  validCells() {
    const r = this.run;
    const cells = new Set();
    for (const ck of r.board.keys()) {
      const { q, r: rr } = keyToCell(ck);
      for (let d = 0; d < 6; d++) {
        const n = neighbor(q, rr, d);
        const nk = key(n.q, n.r);
        if (!r.board.has(nk) && dist(n, { q: 0, r: 0 }) <= BOARD_RADIUS) cells.add(nk);
      }
    }
    return cells;
  }

  problemAt(q, r) {
    return placementProblem(q, r, this.currentEdges(), this.run.board);
  }

  // Describe what placing the current tile at (q,r) would do — for the preview panel.
  previewAt(q, r) {
    const run = this.run;
    const edges = this.currentEdges();
    const problem = placementProblem(q, r, edges, run.board);
    if (problem) return { valid: false, lines: [{ kind: 'bad', text: problem }] };

    const lines = [];
    const ck = key(q, r);
    // group my edges by type
    const myTypes = new Map(); // type -> dirs[]
    for (let d = 0; d < 6; d++) {
      if (edges[d] === GRASS) continue;
      (myTypes.get(edges[d]) ?? myTypes.set(edges[d], []).get(edges[d])).push(d);
    }
    // neighbor features whose edges face this cell, grouped by root feature
    const facing = new Map(); // featureId -> count of edges facing us
    const merged = new Map(); // type -> Set(featureId) that we merge with
    for (let d = 0; d < 6; d++) {
      const n = neighbor(q, r, d);
      const nk = key(n.q, n.r);
      if (!run.board.has(nk)) continue;
      const od = opposite(d);
      const nf = run.sections.featureAtEdge(nk, od);
      if (!nf || nf.complete) continue;
      facing.set(nf.id, (facing.get(nf.id) ?? 0) + 1);
      const nType = run.board.get(nk).edges[od];
      if (nType !== GRASS && nType === edges[d]) {
        (merged.get(nType) ?? merged.set(nType, new Set()).get(nType)).add(nf.id);
      }
    }

    // castle: starting one, or sealing it with the second castle tile
    if (myTypes.has(CASTLE)) {
      const jackpot = fmt(sectionPayout(CASTLE, 1, this.bet));
      const castleMerge = merged.get(CASTLE);
      if (castleMerge && castleMerge.size > 0) {
        let open = 0;
        for (const d of myTypes.get(CASTLE)) {
          const n = neighbor(q, r, d);
          if (!run.board.has(key(n.q, n.r))) open++;
        }
        for (const fid of castleMerge) {
          const f = run.sections.feat(fid);
          open += f.openEdges.size - (facing.get(fid) ?? 0);
        }
        lines.push(open === 0
          ? { kind: 'castle', text: `SEALS THE CASTLE! +${jackpot} JACKPOT` }
          : { kind: 'castle', text: `Joins the castle — still ${open} open` });
      } else {
        lines.push({ kind: 'castle', text: `Starts the castle — needs a 2nd castle tile (rare!) for the ${jackpot} jackpot` });
      }
    }

    // my new/extended sections
    for (const [type, dirs] of myTypes) {
      if (type === CASTLE) continue;
      const mergeSet = merged.get(type) ?? new Set();
      let size = 1, open = 0;
      for (const d of dirs) {
        const n = neighbor(q, r, d);
        if (!run.board.has(key(n.q, n.r))) open++;
      }
      let before = 0;
      for (const fid of mergeSet) {
        const f = run.sections.feat(fid);
        size += f.tiles.size;
        before = Math.max(before, sectionPayout(type, f.tiles.size, this.bet));
        open += f.openEdges.size - (facing.get(fid) ?? 0);
      }
      const after = sectionPayout(type, size, this.bet);
      const name = TERRAIN_NAMES[type];
      if (mergeSet.size === 0) {
        lines.push(open === 0
          ? { kind: 'meh', text: `Closes a tiny ${name} — too small to pay` }
          : { kind: 'new', text: `Starts ${name} · ${open} open — grows in value as it expands` });
      } else if (open === 0) {
        lines.push(after > 0
          ? { kind: 'bank', text: `Completes ${name}: +${fmt(after)} banked` }
          : { kind: 'meh', text: `Closes a tiny ${name} — too small to pay` });
      } else {
        lines.push({ kind: 'grow', text: `Extends ${name}: ${fmt(before)} → ${fmt(after)} · ${open} open` });
      }
    }

    // neighbor sections we cap without merging — do any complete?
    for (const [fid, count] of facing) {
      const f = run.sections.feat(fid);
      if (f.type === CASTLE) continue;
      let inMerge = false;
      for (const s of merged.values()) if (s.has(fid)) inMerge = true;
      if (inMerge) continue;
      const remain = f.openEdges.size - count;
      if (remain <= 0) {
        const pay = sectionPayout(f.type, f.tiles.size, this.bet);
        lines.push(pay > 0
          ? { kind: 'bank', text: `Caps ${TERRAIN_NAMES[f.type]}: +${fmt(pay)} banked` }
          : { kind: 'meh', text: `Closes a tiny ${TERRAIN_NAMES[f.type]} — too small to pay` });
      }
    }
    if (lines.length === 0) lines.push({ kind: 'meh', text: 'Quiet meadow — nothing gained, nothing risked.' });
    return { valid: true, lines };
  }

  // Return the neighbor sections (their open edge keys) that placing the current
  // tile at (q,r) would extend — for on-board preview highlighting.
  extendPreview(q, r) {
    const run = this.run;
    const edges = this.currentEdges();
    if (placementProblem(q, r, edges, run.board)) return [];
    const ids = new Set();
    for (let d = 0; d < 6; d++) {
      if (edges[d] === GRASS) continue;
      const n = neighbor(q, r, d);
      const nk = key(n.q, n.r);
      if (!run.board.has(nk)) continue;
      const od = opposite(d);
      const nf = run.sections.featureAtEdge(nk, od);
      if (nf && !nf.complete && run.board.get(nk).edges[od] === edges[d]) ids.add(nf.id);
    }
    const out = [];
    for (const id of ids) {
      const f = run.sections.feat(id);
      for (const e of f.openEdges) out.push({ edge: e, type: f.type });
    }
    return out;
  }

  place(q, r) {
    const run = this.run;
    if (run.over) return null;
    const edges = this.currentEdges();
    if (placementProblem(q, r, edges, run.board)) return null;
    const ck = key(q, r);
    if (run.board.has(ck)) return null;

    this.snapshotForUndo();

    // snapshot adjacent incomplete features so we can report what got extended
    const adj = new Set();
    const beforePay = new Map(); // pre-placement feature id -> payout
    for (let d = 0; d < 6; d++) {
      const n = neighbor(q, r, d);
      const nk = key(n.q, n.r);
      if (!run.board.has(nk)) continue;
      const nf = run.sections.featureAtEdge(nk, opposite(d));
      if (nf && !nf.complete) {
        adj.add(nf.id);
        beforePay.set(nf.id, sectionPayout(nf.type, nf.tiles.size, this.bet));
      }
    }

    const { completed } = run.sections.place(q, r, edges, run.board);
    run.board.set(ck, { q, r, edges });
    run.deck.splice(run.idx, 1);
    run.placements++;
    run.rotation = 0;

    let bankedNow = 0;
    let castleWon = false;
    for (const f of completed) {
      const pay = sectionPayout(f.type, f.tiles.size, this.bet);
      f.payout = pay;
      f.completedAt = run.placements;
      run.bankedOrder.push(f);
      bankedNow += pay;
      if (f.type === CASTLE) castleWon = true;
    }
    run.banked = Math.round((run.banked + bankedNow) * 100) / 100;

    // which neighbor sections grew (merged in) but did NOT complete?
    const bestBefore = new Map(); // surviving root id -> max pre-payout merged in
    for (const oldId of adj) {
      const f = run.sections.feat(oldId);
      if (!f) continue;
      bestBefore.set(f.id, Math.max(bestBefore.get(f.id) ?? 0, beforePay.get(oldId) ?? 0));
    }
    const extended = [];
    const seenRoots = new Set();
    for (const oldId of adj) {
      const f = run.sections.feat(oldId);
      if (!f || f.complete || seenRoots.has(f.id)) continue;
      seenRoots.add(f.id);
      const after = sectionPayout(f.type, f.tiles.size, this.bet);
      const delta = Math.round((after - (bestBefore.get(f.id) ?? 0)) * 100) / 100;
      extended.push({ type: f.type, cells: [...f.tiles].filter((c) => c !== ck), after, delta });
    }

    const result = {
      q, r, edges, completed, bankedNow, castleWon, extended,
      castleStarted: edges.includes(CASTLE) && !castleWon,
    };
    this.emit('placed', result);

    if (this.tilesLeft <= 0 || this.validCells().size === 0 || (run.idx >= run.deck.length && run.reserve == null)) {
      this.exhaust();
    }
    return result;
  }

  // ----- buy-more-tiles -----
  // Base tiles are spent. Don't finalize yet — surface the near-miss so the
  // orchestrator can offer extra draws. finalize()/endRun() commits the wallet.
  exhaust() {
    const run = this.run;
    if (run.over || run.exhausted) return;
    run.exhausted = true;
    this.emit('exhausted', { target: this.extraTarget() });
  }

  // Best near-miss the player could pay to chase: an incomplete payable section
  // (or the castle) that's only 1-2 tiles short, ranked by payout × closeness.
  extraTarget() {
    const run = this.run;
    if (this.validCells().size === 0) return null;
    let best = null;
    for (const f of run.sections.incomplete()) {
      const needed = run.sections.cellsNeeded(f).size;
      if (needed < 1 || needed > 2) continue;
      const payout = f.type === CASTLE
        ? sectionPayout(CASTLE, 1, this.bet)
        : sectionPayout(f.type, f.tiles.size, this.bet);
      if (payout <= 0) continue;
      const rank = payout / needed;
      if (!best || rank > best.rank) {
        best = { id: f.id, type: f.type, name: TERRAIN_NAMES[f.type], needed, payout, rank };
      }
    }
    return best;
  }

  // Price of the next rung. Strictly above E[payout] = boostP × targetPayout, so
  // the house nets positive on every purchase whether the player hits or whiffs.
  extraPrice(target, rung = this.run.boughtRungs) {
    const ev = EXTRA_BOOST_P * target.payout;
    return Math.round(ev * EXTRA_MARGIN * Math.pow(EXTRA_LADDER, rung) * 100) / 100;
  }

  // Spend on one boosted draw and reopen the run for a single extra placement.
  buyExtra(target) {
    const run = this.run;
    if (run.over) return null;
    const price = this.extraPrice(target);
    this.wallet = Math.round((this.wallet - price) * 100) / 100;
    this.saveWallet();
    run.boughtRungs++;
    run.budget += 1;
    run.exhausted = false;
    run.deck.splice(run.idx, 0, boostedTile(run.rng, target.type, EXTRA_BOOST_P));
    this.emit('hand', null);
    return { price, rung: run.boughtRungs };
  }

  // ----- single-step undo -----
  snapshotForUndo() {
    const r = this.run;
    this._undo = {
      wallet: this.wallet,
      board: new Map([...r.board].map(([k, v]) => [k, { q: v.q, r: v.r, edges: v.edges.slice() }])),
      sections: r.sections.clone(),
      deck: r.deck.map((t) => ({ edges: t.edges.slice() })),
      idx: r.idx,
      placements: r.placements,
      reserve: r.reserve ? { edges: r.reserve.edges.slice() } : null,
      rotation: r.rotation,
      banked: r.banked,
      bankedOrderIds: r.bankedOrder.map((f) => f.id),
      over: r.over,
      castleNearMiss: r.castleNearMiss,
    };
  }

  canUndo() { return !!this._undo && !this.run.over; }

  undo() {
    if (!this.canUndo()) return false;
    const u = this._undo;
    const r = this.run;
    this.wallet = u.wallet;
    this.saveWallet();
    r.board = u.board;
    r.sections = u.sections;
    r.deck = u.deck;
    r.idx = u.idx;
    r.placements = u.placements;
    r.reserve = u.reserve;
    r.rotation = u.rotation;
    r.banked = u.banked;
    r.bankedOrder = u.bankedOrderIds.map((id) => r.sections.feat(id)).filter(Boolean);
    r.over = u.over;
    r.castleNearMiss = u.castleNearMiss;
    this._undo = null; // single step only
    this.emit('undo', null);
    return true;
  }

  endRun() {
    const run = this.run;
    run.over = true;
    // "so close" if a castle tile was drawn but never sealed by its rare twin
    run.castleNearMiss = !!run.sections.incomplete().find((f) => f.type === CASTLE);
    const lost = run.sections.incomplete()
      .map((f) => ({
        name: TERRAIN_NAMES[f.type],
        type: f.type,
        size: f.tiles.size,
        missed: f.type === CASTLE ? sectionPayout(CASTLE, 1, this.bet) : sectionPayout(f.type, f.tiles.size, this.bet),
      }))
      .filter((l) => l.missed > 0);
    const won = run.bankedOrder
      .filter((f) => f.payout > 0)
      .map((f) => ({
        name: TERRAIN_NAMES[f.type], type: f.type, size: f.tiles.size, payout: f.payout,
      }));
    this.wallet = Math.round((this.wallet + run.banked) * 100) / 100;
    this.saveWallet();
    this.emit('over', { won, lost, banked: run.banked, bet: this.bet, net: Math.round((run.banked - this.bet) * 100) / 100, castleNearMiss: run.castleNearMiss });
  }

  atRisk() {
    const run = this.run;
    let sum = 0;
    for (const f of run.sections.incomplete()) {
      if (f.type === CASTLE) continue;
      sum += sectionPayout(f.type, f.tiles.size, this.bet);
    }
    return Math.round(sum * 100) / 100;
  }

  // section data feeding the on-board value callouts and edge glow
  sectionList() {
    const run = this.run;
    const out = [];
    for (const f of run.sections.all()) {
      const needed = run.sections.cellsNeeded(f).size;
      out.push({
        id: f.id, type: f.type, name: TERRAIN_NAMES[f.type],
        size: f.tiles.size, complete: f.complete,
        payout: f.complete ? f.payout : sectionPayout(f.type, f.tiles.size, this.bet),
        open: f.openEdges.size, needed,
        risk: f.complete ? 'done' : riskLevel(needed, this.tilesLeft),
        tiles: [...f.tiles],
        openEdges: [...f.openEdges],
      });
    }
    out.sort((a, b) => {
      if ((a.type === CASTLE) !== (b.type === CASTLE)) return a.type === CASTLE ? -1 : 1;
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return b.payout - a.payout;
    });
    return out;
  }
}

export function riskLevel(needed, tilesLeft) {
  if (needed === 0) return 'done';
  if (needed > tilesLeft) return 'doomed';
  const ratio = needed / Math.max(tilesLeft, 1);
  if (ratio <= 0.25) return 'low';
  if (ratio <= 0.55) return 'med';
  return 'high';
}

function keyToCell(k) { const [q, r] = k.split(',').map(Number); return { q, r }; }
