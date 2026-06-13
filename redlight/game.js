// Red Light / Green Light — deterministic game engine (DOM-free ES module)

// ─── CONFIG ──────────────────────────────────────────────────────────────────

export const CONFIG = {
  numPlayers: 20,
  bet: 50,
  houseEdge: 0.025,        // taken off the top of wagered; prizePool = wagered * (1 - houseEdge)
  ticksPerRound: 700,      // ~35s at 20 ticks/sec
  finishDistance: 100,     // distance units from start line to the doll
  moveSpeedPerTick: 0.22,  // distance gained per tick while moving
  // PRIMARY RTP LEVER. finishMult = 1 + finishDistance*multPerDistance.
  // Keep modest so multiplier payouts stay under the pool; residual goes to finishers.
  // Calibrated (Task 6): 20k MC → RTP≈0.9797, avgFinishers≈2.99.
  multPerDistance: 0.0019, // finish multiplier = 1 + 100*0.0019 = 1.19x (calibrated)
  targetFinishers: 3,
  // ─ Red/Green phase scheduling (replaces the old instant-cull schedule) ─
  // Red is now a SUSTAINED, continuously-lethal phase: the instant it triggers,
  // every player still MOVING dies — ALL of them, no fraction, no grace, no
  // warning. This is a crash game, not a twitch-reaction game: holding the run
  // button is holding a rising multiplier and betting red won't hit this instant.
  // Green windows are "the interval" between reds. Durations in ticks (20/s).
  // Everything is seeded → the engine stays deterministic (RTP Lab still runs).
  redDurMin: 40,           // red phase length: 40–100 ticks = 2.0–5.0s (per design)
  redDurMax: 100,
  greenDurMin: 70,         // green window between reds: 70–150 ticks = 3.5–7.5s
  greenDurMax: 150,
  // On each red ONSET most running bots FREEZE (survive); this fraction fail to
  // freeze, keep moving, and die under the verdict. The new "who dies" lever
  // (replaces cullFraction now that the cull is all-or-nothing per player).
  botCaughtChance: 0.13,
  // Reaction realism so bots don't stop & start on a dime. FREEZING stays instant
  // (it has to — red is lethal from tick zero), but the RESTART after green is
  // staggered by each bot's reflex, and sluggish bots are likelier to get caught.
  botResumeDelayMax: 18,   // ticks (~0.9s) a min-reflex bot dawdles before running
  botResumeJitter: 6,      // extra random ticks of slop, so even equal-reflex bots desync
  // bot/human bail-policy levers (kept in sync across createBots + defaultHumanPolicy).
  // finishIntentChance is a Task-6 finisher-rate lever: roll > finishIntentChance pushes
  // for the finish, so LOWERING it makes MORE players go for the finish.
  finishIntentChance: 0.78, // ~22% push for the finish (roll > 0.78)
  bailFloorMult: 1.05,      // lowest multiplier a bailing player targets
  bailSpread: 0.9,          // fraction of the floor→finish range bailers spread across
};

// ─── Task 1: Seeded RNG ───────────────────────────────────────────────────────

// Deterministic PRNG (mulberry32). Returns a function -> float in [0,1).
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Task 2: Settlement math (residual-pool) ──────────────────────────────────

export function settleRound(players, config = CONFIG) {
  const wagered = players.length * config.bet;
  const prizePool = wagered * (1 - config.houseEdge);
  const finishers = players.filter(p => p.status === 'finished');

  // base multiplier payouts for survivors (cashed + finished), from the pool
  let baseMult = 0;
  for (const p of players) {
    if (p.status === 'cashed' || p.status === 'finished') {
      p.payout = p.bet * p.multiplier;
      baseMult += p.payout;
    } else {
      p.payout = 0; // eliminated / timedout forfeit; their stakes fund the pool
    }
  }

  // residual pool = what the multipliers didn't consume; finishers split it
  const residual = finishers.length > 0 ? Math.max(0, prizePool - baseMult) : 0;
  if (finishers.length > 0 && residual > 0) {
    const share = residual / finishers.length;
    for (const f of finishers) f.payout += share;
  }

  const totalPayout = players.reduce((s, p) => s + p.payout, 0);
  const houseTake = wagered - totalPayout; // exact by construction

  return { players, prizePool, residual, houseTake, totalPayout, finishers, wagered };
}

// ─── Task 3: Bots ─────────────────────────────────────────────────────────────

const BOT_NAMES = ['Jay','Luna','Dexter','Mika','Rico','Nova','Zoe','Bray','Kai',
  'Remy','Ivy','Ghost','Ace','Jinx','Blaze','Sage','Vex','Nero','Pixel'];

export function createBots(rng, config = CONFIG) {
  return BOT_NAMES.slice(0, config.numPlayers - 1).map((name, i) => {
    // bail target spread: most bail at low-mid multipliers, a few are greedy / want the finish
    const roll = rng();
    const wantsFinish = roll > config.finishIntentChance;  // ~22% push for the finish
    const finishMult = 1 + config.finishDistance * config.multPerDistance; // e.g. 1.8x
    const targetMult = wantsFinish
      ? finishMult                                 // push all the way to the finish
      // bail between bailFloorMult and bailSpread of the way to the finish multiplier
      : config.bailFloorMult + rng() * (finishMult - config.bailFloorMult) * config.bailSpread;
    // reflex: how quick this bot is off the mark when green returns (and how
    // unlikely to be caught dawdling on red). 0.4 = sluggish, 1.0 = twitchy.
    const reflex = 0.4 + rng() * 0.6;
    return { id: i + 1, name, isHuman: false, bet: config.bet,
             distance: 0, multiplier: 1, moving: true, status: 'running',
             payout: 0, targetMult, wantsFinish, reflex, resumeAt: 0 };
  });
}

// ─── Task 4: Light scheduler ──────────────────────────────────────────────────

// Build the round's red phases as alternating green/red windows. We always open
// with a green window (so players get rolling before the first red), then a red
// phase, then green, ... until the round is full. Each phase length is a seeded
// uniform draw → deterministic. Returns [{start, end}] with red active for tick
// in [start, end). The green window between two reds IS "the interval".
function uniformInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function scheduleLights(rng, config = CONFIG) {
  const phases = [];
  let t = uniformInt(rng, config.greenDurMin, config.greenDurMax); // opening green
  while (t < config.ticksPerRound) {
    const end = Math.min(config.ticksPerRound, t + uniformInt(rng, config.redDurMin, config.redDurMax));
    phases.push({ start: t, end });
    // green gap before the next red
    t = end + uniformInt(rng, config.greenDurMin, config.greenDurMax);
  }
  return phases;
}

// True if `tick` lands inside any scheduled red phase ([start, end) half-open).
function isRedTick(state, tick) {
  for (const ph of state.redPhases) {
    if (tick >= ph.start && tick < ph.end) return true;
  }
  return false;
}

// ─── Task 5: Round state machine ──────────────────────────────────────────────

export function createRound(seed, config = CONFIG) {
  const rng = createRng(seed);
  const bots = createBots(rng, config);

  // Human player (id=0) inserted at index 0
  const human = {
    id: 0, name: 'You', isHuman: true, bet: config.bet,
    distance: 0, multiplier: 1, moving: false, status: 'running',
    payout: 0, targetMult: Infinity, wantsFinish: false,
  };

  const players = [human, ...bots];
  const redPhases = scheduleLights(rng, config);

  return {
    players,
    redPhases,            // [{start, end}] — red active for tick in [start, end)
    rng,
    config,
    tick: 0,
    light: 'green',
    done: false,
    forfeits: 0,
    prizePool: config.numPlayers * config.bet * (1 - config.houseEdge),
    baseMultSoFar: 0,     // running sum of cashed/finished bet*mult for live HUD projection
    redFlash: [],         // transient: ids culled this tick (for renderer)
  };
}

// Private helper: kill EVERY currently-moving+running player. No fraction, no
// mercy — this is the red-light verdict. Returns the ids killed this tick (the
// renderer turns them into the doll's eye-bullet targets + cash drain).
function killAllMoving(state) {
  const deadIds = [];
  for (const p of state.players) {
    if (p.status === 'running' && p.moving) {
      p.status = 'eliminated';
      p.moving = false;
      state.forfeits += p.bet;
      deadIds.push(p.id);
    }
  }
  return deadIds;
}

export function stepRound(state, humanInput = { holding: false, cashOut: false }) {
  if (state.done) return state;

  const { config } = state;

  // Clear last tick's red flash
  state.redFlash = [];

  // Determine the light, and detect the transitions we need to react to.
  const prevLight = state.light;
  state.light = isRedTick(state, state.tick) ? 'red' : 'green';
  const redOnset = state.light === 'red' && prevLight !== 'red';
  const greenResume = state.light === 'green' && prevLight === 'red';

  // Human input: update moving status. There is NO special-casing for red — if
  // the human is holding when red hits, they're moving, and the verdict below
  // kills them. That's the crash.
  const human = state.players.find(p => p.isHuman);
  if (human.status === 'running') {
    if (humanInput.cashOut) {
      human.status = 'cashed';
      state.baseMultSoFar += human.bet * human.multiplier;
    } else {
      human.moving = humanInput.holding;
    }
  }

  // Bot reaction at the instant red triggers: most FREEZE (moving=false → safe);
  // a few fail to freeze, stay moving, and die in the verdict. Sluggish (low-
  // reflex) bots are likelier to be the ones caught. Freezing is instant — it
  // has to be, red is lethal from tick zero — this is what stops a total wipe.
  if (redOnset) {
    for (const p of state.players) {
      if (p.isHuman || p.status !== 'running') continue;
      const caught = p.moving && state.rng() < config.botCaughtChance * (1.5 - p.reflex);
      p.moving = caught;       // survivors freeze (false); caught keep running (die below)
      p.resumeAt = 0;          // cancel any pending restart
    }
  }
  // Green resumes: survivors don't all surge at once — each schedules a restart a
  // few ticks out, scaled by reflex (quick bots first, sluggish ones lag), so the
  // field breaks into a run raggedly instead of in lockstep.
  if (greenResume) {
    for (const p of state.players) {
      if (p.isHuman || p.status !== 'running') continue;
      const delay = Math.round((1 - p.reflex) * config.botResumeDelayMax + state.rng() * config.botResumeJitter);
      p.resumeAt = state.tick + delay;
    }
  }
  // Each green tick, any bot whose reaction delay has elapsed breaks into a run.
  if (state.light === 'green') {
    for (const p of state.players) {
      if (p.isHuman || p.status !== 'running' || !p.resumeAt) continue;
      if (state.tick >= p.resumeAt) { p.moving = true; p.resumeAt = 0; }
    }
  }

  // The verdict. Continuous: every tick red is up, anyone moving dies. On the
  // onset tick this is the mass kill (all caught bots + a holding human); on
  // later red ticks it catches anyone who starts moving again mid-red.
  if (state.light === 'red') {
    state.redFlash = killAllMoving(state);
  }

  // Move all running players (including human if still running+moving)
  const finishMult = 1 + config.finishDistance * config.multPerDistance;
  for (const p of state.players) {
    if (p.status !== 'running') continue;

    if (p.moving) {
      p.distance = Math.min(p.distance + config.moveSpeedPerTick, config.finishDistance);
      p.multiplier = 1 + p.distance * config.multPerDistance;
    }

    // Bot auto-cash logic
    if (!p.isHuman && !p.wantsFinish && p.multiplier >= p.targetMult) {
      p.status = 'cashed';
      p.moving = false;
      state.baseMultSoFar += p.bet * p.multiplier;
    }

    // Finish line reached (re-guard status: a bot may have just auto-cashed above)
    if (p.status === 'running' && p.distance >= config.finishDistance) {
      p.status = 'finished';
      p.moving = false;
      p.multiplier = finishMult; // snap to exact finish multiplier
      state.baseMultSoFar += p.bet * p.multiplier;
    }
  }

  state.tick++;

  // End of round: time out remaining runners
  if (state.tick >= config.ticksPerRound) {
    for (const p of state.players) {
      if (p.status === 'running') {
        p.status = 'timedout';
        p.moving = false;
        state.forfeits += p.bet;
      }
    }
    state.done = true;

    // Settle and merge result onto state
    const result = settleRound(state.players, config);
    Object.assign(state, {
      wagered: result.wagered,
      totalPayout: result.totalPayout,
      houseTake: result.houseTake,
      residual: result.residual,
      finishers: result.finishers,
      prizePool: result.prizePool,
    });
  }

  return state;
}

// Default human policy for headless runs: behaves like a bot
function defaultHumanPolicy(state) {
  const human = state.players.find(p => p.isHuman);
  if (human.status !== 'running') return { holding: false, cashOut: false };
  // Freeze on red — a competent sim player stops the moment she's looking.
  // (The HUMAN at the keyboard gets no such guarantee; this is sim-only.)
  if (state.light === 'red') return { holding: false, cashOut: false };
  // Assign a lazy target on first call (stored on human object)
  if (human._simTarget === undefined) {
    const rng = state.rng;
    const finishMult = 1 + state.config.finishDistance * state.config.multPerDistance;
    const roll = rng();
    human.wantsFinish = roll > state.config.finishIntentChance;
    human._simTarget = human.wantsFinish
      ? finishMult
      : state.config.bailFloorMult + rng() * (finishMult - state.config.bailFloorMult) * state.config.bailSpread;
  }
  if (human.multiplier >= human._simTarget && !human.wantsFinish) {
    return { holding: false, cashOut: true };
  }
  return { holding: true, cashOut: false };
}

export function simulateRound(seed, config = CONFIG, humanPolicy = null) {
  const state = createRound(seed, config);
  const policy = humanPolicy ?? defaultHumanPolicy;
  while (!state.done) {
    stepRound(state, policy(state));
  }
  return state;
}

// ─── Task 6: Monte-Carlo RTP runner ───────────────────────────────────────────

export function runMonteCarlo(baseSeed, n, config = CONFIG) {
  let wagered = 0, payout = 0, finishers = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateRound(baseSeed + i, config);
    wagered += r.wagered;
    payout += r.totalPayout;
    finishers += r.finishers.length;
  }
  return { rtp: payout / wagered, avgFinishers: finishers / n, rounds: n };
}
