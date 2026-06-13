// Auto-play policy + choice detection — the heart of the tap-to-bank redesign.
//
// Pure functions over Game state so sim.mjs can exercise the EXACT same policy.
// `decide(game)` evaluates the current tile across every legal (cell, rotation),
// classifies each placement by archetype, then returns either an auto-placement
// (no real choice) or 2-3 ghost options for the player to tap.
import { key, neighbor, opposite, unkey } from './hex.js';
import { GRASS, CASTLE, TERRAIN_NAMES, sectionPayout, rotEdges, fmt } from './tiles.js';
import { placementProblem } from './sections.js';

// ---- tuning knobs ("let it emerge naturally" — fixed; observe count via sim.mjs) ----
// Overridable via env (MB_FLOOR/MB_DOM/MB_GROW) for offline sweeps; browser uses defaults.
const env = (k, d) => (typeof process !== 'undefined' && process.env?.[k] != null ? Number(process.env[k]) : d);
export const CHOICE_FLOOR = env('MB_FLOOR', 0.30); // min $ a fork option must be worth to count as meaningful
export const DOMINANCE = env('MB_DOM', 3.0);       // best/2nd score ratio above which we just auto-place best
                                                   // (higher = harder to auto-place = more choices surfaced;
                                                   // tuned so ~70% of runs land in the 3-6 band at ~3.9/run,
                                                   // each fork worth >= CHOICE_FLOOR so choices feel meaty)
export const GROW_BIAS = env('MB_GROW', 0.7);      // weight on UNREALISED growth potential vs locked $ (<1 = a
                                  // banked dollar beats an equal dollar of mere potential, so the
                                  // auto-policy banks big sure things but defers closing small ones)

// Structured consequence of placing world-oriented `edges` at (q,r). null if illegal.
export function evalPlacement(game, q, r, edges) {
  const run = game.run, board = run.board, sections = run.sections, bet = game.bet;
  const ck = key(q, r);
  if (board.has(ck)) return null;
  if (placementProblem(q, r, edges, board)) return null;

  const myTypes = new Map(); // type -> dirs[]
  for (let d = 0; d < 6; d++) {
    const t = edges[d];
    if (t === GRASS) continue;
    (myTypes.get(t) ?? myTypes.set(t, []).get(t)).push(d);
  }
  // incomplete neighbour features facing this cell, and which ones we'd merge with
  const facing = new Map(); // featureId -> count of my edges facing it
  const merged = new Map();  // type -> Set(featureId)
  for (let d = 0; d < 6; d++) {
    const n = neighbor(q, r, d);
    const nk = key(n.q, n.r);
    if (!board.has(nk)) continue;
    const od = opposite(d);
    const nf = sections.featureAtEdge(nk, od);
    if (!nf || nf.complete) continue;
    facing.set(nf.id, (facing.get(nf.id) ?? 0) + 1);
    const nType = board.get(nk).edges[od];
    if (nType !== GRASS && nType === edges[d]) {
      (merged.get(nType) ?? merged.set(nType, new Set()).get(nType)).add(nf.id);
    }
  }

  let bankedNow = 0, growthPot = 0, seedPot = 0, castleScore = 0;
  const grows = [], banks = [], seeds = [];
  let castle = null;

  if (myTypes.has(CASTLE)) {
    const jackpot = sectionPayout(CASTLE, 1, bet);
    const cm = merged.get(CASTLE);
    if (cm && cm.size) {
      let open = 0;
      for (const d of myTypes.get(CASTLE)) { const n = neighbor(q, r, d); if (!board.has(key(n.q, n.r))) open++; }
      for (const fid of cm) { const f = sections.feat(fid); open += f.openEdges.size - (facing.get(fid) ?? 0); }
      if (open === 0) { castle = 'seal'; bankedNow += jackpot; castleScore += 1000; }
      else { castle = 'join'; castleScore += 6; }
    } else { castle = 'start'; castleScore += 5; }
  }

  for (const [type, dirs] of myTypes) {
    if (type === CASTLE) continue;
    const ms = merged.get(type) ?? new Set();
    let size = 1, open = 0, before = 0;
    for (const d of dirs) { const n = neighbor(q, r, d); if (!board.has(key(n.q, n.r))) open++; }
    for (const fid of ms) {
      const f = sections.feat(fid);
      size += f.tiles.size;
      before = Math.max(before, sectionPayout(type, f.tiles.size, bet));
      open += f.openEdges.size - (facing.get(fid) ?? 0);
    }
    const after = sectionPayout(type, size, bet);
    if (ms.size === 0) {
      if (open > 0) { const dream = sectionPayout(type, 1 + open, bet); seeds.push({ type, open, dream }); seedPot += dream; }
    } else if (open === 0) {
      if (after > 0) { banks.push({ type, id: rootId(sections, ms), payout: after }); bankedNow += after; }
    } else if (after > 0) {
      grows.push({ type, id: rootId(sections, ms), before, after, open }); growthPot += after;
    }
  }

  // neighbour features we fully cap without merging → they complete
  for (const [fid, count] of facing) {
    const f = sections.feat(fid);
    if (f.type === CASTLE) continue;
    let inMerge = false;
    for (const s of merged.values()) if (s.has(fid)) inMerge = true;
    if (inMerge) continue;
    if (f.openEdges.size - count <= 0) {
      const pay = sectionPayout(f.type, f.tiles.size, bet);
      if (pay > 0) { banks.push({ type: f.type, id: f.id, payout: pay }); bankedNow += pay; }
    }
  }

  // dominant intent + headline value + ghost label
  let archetype = 'FILLER', intent = 'filler', value = 0, label = { tag: 'PLACE', text: 'fill the meadow', cls: 'filler' };
  if (castle === 'seal') {
    const v = sectionPayout(CASTLE, 1, bet);
    archetype = 'CASTLE'; intent = 'castle'; value = v;
    label = { tag: 'JACKPOT', text: `SEAL +${fmt(v)}`, cls: 'castle' };
  } else if (banks.length) {
    const top = banks.reduce((a, b) => (b.payout > a.payout ? b : a));
    archetype = 'BANK'; intent = 'bank:' + top.id; value = top.payout;
    label = { tag: 'BANK', text: `+${fmt(top.payout)}`, cls: 'bank' };
  } else if (castle === 'start' || castle === 'join') {
    const v = sectionPayout(CASTLE, 1, bet);
    archetype = 'CASTLE'; intent = 'castle'; value = v;
    label = { tag: 'CASTLE', text: castle === 'start' ? 'start the chase' : 'extend', cls: 'castle' };
  } else if (grows.length) {
    const top = grows.reduce((a, b) => (b.after > a.after ? b : a));
    archetype = 'PUSH'; intent = 'grow:' + top.id; value = top.after;
    label = { tag: 'GROW', text: top.before > 0 ? `${fmt(top.before)}→${fmt(top.after)}` : `→${fmt(top.after)}`, cls: 'grow' };
  } else if (seeds.length) {
    const top = seeds.reduce((a, b) => (b.dream > a.dream ? b : a));
    archetype = 'SEED'; intent = 'seed:' + top.type; value = top.dream;
    label = { tag: 'NEW', text: TERRAIN_NAMES[top.type] ?? 'area', cls: 'seed' };
  }

  const score = bankedNow + GROW_BIAS * growthPot + 0.15 * seedPot + castleScore;
  return { q, r, rot: 0, cell: ck, archetype, intent, value, label, score, bankedNow, castle };
}

function rootId(sections, idSet) {
  // resolve to the surviving union-find root so two merged neighbours share one intent key
  const any = [...idSet][0];
  return sections.feat(any)?.id ?? any;
}

// Evaluate the current tile everywhere and decide: auto-place, offer a choice, or end.
export function decide(game) {
  const run = game.run;
  if (!run || run.over) return { mode: 'end', options: [] };
  const tile = game.current;
  if (!tile) return { mode: 'end', options: [] };

  const evals = [];
  for (const ck of game.validCells()) {
    const { q, r } = unkey(ck);
    for (let rot = 0; rot < 6; rot++) {
      const ev = evalPlacement(game, q, r, rotEdges(tile.edges, rot));
      if (ev) { ev.rot = rot; evals.push(ev); }
    }
  }
  if (!evals.length) return { mode: 'end', options: [] };

  // best placement per strategic intent
  const byIntent = new Map();
  for (const ev of evals) {
    const cur = byIntent.get(ev.intent);
    if (!cur || ev.score > cur.score) byIntent.set(ev.intent, ev);
  }
  let cands = [...byIntent.values()];
  if (cands.some((c) => c.archetype !== 'FILLER')) cands = cands.filter((c) => c.archetype !== 'FILLER');

  // one ghost per cell (a fork on the same cell is just confusing)
  cands.sort((a, b) => b.score - a.score);
  const byCell = new Map();
  for (const c of cands) if (!byCell.has(c.cell)) byCell.set(c.cell, c);
  cands = [...byCell.values()].sort((a, b) => b.score - a.score);

  const best = cands[0];
  const meaningful = cands.filter((c) => c === best || c.value >= CHOICE_FLOOR);
  if (meaningful.length <= 1) return { mode: 'auto', options: [best] };
  if (best.score >= meaningful[1].score * DOMINANCE) return { mode: 'auto', options: [best] };
  return { mode: 'choice', options: meaningful.slice(0, 3) };
}
