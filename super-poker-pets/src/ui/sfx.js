// Procedural sound effects via the Web Audio API. No binary assets: every cue
// is synthesized from oscillators, noise and gain envelopes at call time. The
// public surface is the `sfx` object — sfx.click(), sfx.merge(), etc., one
// method per cue — so call sites never change. Mute state persists across runs.

const MASTER = 0.35;        // master gain ceiling — keep it gentle
const MUTE_KEY = 'spp_muted';

let ctx = null;             // AudioContext, created lazily on first gesture
let master = null;          // master GainNode
let noiseBuf = null;        // cached white-noise buffer (reused by every burst)
let muted = loadMuted();

function loadMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

// Lazily build the audio graph. Returns null where Web Audio is unavailable
// (old browsers, SSR, tests) so callers degrade to silence.
function ensureCtx() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ctx.destination);
  return ctx;
}

// Browsers won't start audio until a user gesture. Resume on the first one.
function unlock() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
}
if (typeof document !== 'undefined') {
  const opts = { passive: true };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(ev, unlock, opts);
  }
}

// ---------- synthesis primitives ----------

// A single oscillator note with a linear attack and exponential decay to
// silence. Optional pitch glide via freqEnd, slight detune for shimmer.
function tone(opts) {
  const c = ensureCtx();
  if (!c) return;
  const { freq, type = 'sine', dur = 0.15, attack = 0.005,
          gain = 0.5, when = 0, freqEnd = null, detune = 0 } = opts;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  if (detune) osc.detune.setValueAtTime(detune, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBuffer(c) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(c.sampleRate * 0.5);
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// A filtered burst of white noise — rattles, transients, clangs.
function noise(opts) {
  const c = ensureCtx();
  if (!c) return;
  const { dur = 0.2, gain = 0.3, when = 0, type = 'bandpass', freq = 1000, q = 1 } = opts;
  const t0 = c.currentTime + when;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(freq, t0);
  filt.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// A melodic run: one tone per frequency, spaced by `step` seconds.
function seq(freqs, { type = 'sine', step = 0.12, dur = 0.2, gain = 0.4 } = {}) {
  freqs.forEach((f, i) => tone({ freq: f, type, dur, gain, when: i * step }));
}

// ---------- cue palette ----------
// One recipe per cue. Kept short and distinct so the ear can tell them apart.
const RECIPES = {
  // --- UI / shop ---
  click() {
    tone({ freq: 880, type: 'sine', dur: 0.05, gain: 0.22 });
  },
  select() { // soft selection blip — lower & gentler than click, distinct from buy
    tone({ freq: 560, type: 'sine', dur: 0.045, gain: 0.16 });
  },
  buy() { // two-note coin, up
    tone({ freq: 660, type: 'triangle', dur: 0.08, gain: 0.4 });
    tone({ freq: 990, type: 'triangle', dur: 0.10, gain: 0.4, when: 0.07 });
  },
  sell() { // two-note, down
    tone({ freq: 660, type: 'triangle', dur: 0.08, gain: 0.4 });
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.4, when: 0.07 });
  },
  reroll() { // dice rattle
    for (let i = 0; i < 4; i++) {
      noise({ dur: 0.05, gain: 0.18, when: i * 0.05, freq: 2500 + i * 350, q: 5 });
    }
  },
  lock() { // low thunk + tick
    tone({ freq: 196, type: 'square', dur: 0.10, gain: 0.32 });
    tone({ freq: 1320, type: 'sine', dur: 0.04, gain: 0.16, when: 0.02 });
  },
  merge() { // rising shimmer
    tone({ freq: 400, freqEnd: 1200, type: 'triangle', dur: 0.25, gain: 0.34 });
    tone({ freq: 600, freqEnd: 1800, type: 'sine', dur: 0.25, gain: 0.16, detune: 6 });
  },
  unlock() { // pack unlock — bright ascending arpeggio + bell tail
    seq([659, 880, 1175, 1568], { type: 'triangle', step: 0.09, dur: 0.26, gain: 0.34 });
    tone({ freq: 2349, type: 'sine', dur: 0.6, gain: 0.12, when: 0.30 });
  },

  // --- battle ---
  fight() { // low punchy horn
    tone({ freq: 110, freqEnd: 90, type: 'sawtooth', dur: 0.30, gain: 0.42, attack: 0.012 });
    tone({ freq: 220, type: 'square', dur: 0.18, gain: 0.14 });
  },
  clash() { // inharmonic metal clang + transient
    noise({ dur: 0.12, gain: 0.28, type: 'highpass', freq: 3000 });
    for (const f of [1800, 2700, 3300, 4100]) {
      tone({ freq: f, type: 'square', dur: 0.18, gain: 0.09 });
    }
  },
  death() { // descending fall
    tone({ freq: 330, freqEnd: 70, type: 'sawtooth', dur: 0.45, gain: 0.34 });
  },

  // --- result ---
  victory() { // major arpeggio fanfare (C E G C)
    seq([523, 659, 784, 1047], { type: 'triangle', step: 0.12, dur: 0.22, gain: 0.4 });
  },
  defeat() { // minor descending (A F C)
    seq([440, 349, 262], { type: 'sawtooth', step: 0.16, dur: 0.28, gain: 0.34 });
  },
  draw() { // two flat neutral notes
    tone({ freq: 440, type: 'triangle', dur: 0.12, gain: 0.3 });
    tone({ freq: 440, type: 'triangle', dur: 0.16, gain: 0.3, when: 0.16 });
  },
  trophy() { // bright bell sparkle
    tone({ freq: 1568, type: 'sine', dur: 0.40, gain: 0.28 });
    tone({ freq: 2349, type: 'sine', dur: 0.40, gain: 0.11, when: 0.02 });
    tone({ freq: 3136, type: 'sine', dur: 0.30, gain: 0.07, when: 0.05 });
  },
  heartbreak() { // soft descending minor third
    tone({ freq: 440, type: 'sine', dur: 0.30, gain: 0.3 });
    tone({ freq: 370, type: 'sine', dur: 0.40, gain: 0.3, when: 0.20 });
  },
  payout() { // cascading coin chimes
    [784, 988, 1175, 1568, 1976].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.12, gain: 0.3, when: i * 0.06 }));
  },
};

function play(name) {
  if (muted) return;
  const recipe = RECIPES[name];
  if (!recipe) return; // unknown cue: no-op
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  try { recipe(); } catch { /* never let audio break the UI */ }
}

// sfx.clash(), sfx.buy(), ... — stable hooks for call sites.
export const sfx = Object.fromEntries(Object.keys(RECIPES).map((n) => [n, () => play(n)]));

// ---------- mute control ----------
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : MASTER;
}
export function toggleMuted() { setMuted(!muted); return muted; }
export function isMuted() { return muted; }
