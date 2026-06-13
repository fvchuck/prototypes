// Procedural WebAudio: cozy generative music + soft SFX. No assets needed.
let ctx = null;
let master, musicGain, sfxGain;
let musicOn = true, started = false;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.28; musicGain.connect(master);
  startMusic();
  started = true;
}

export function setMuted(m) {
  if (!ctx) return;
  master.gain.linearRampToValueAtTime(m ? 0 : 0.6, ctx.currentTime + 0.2);
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// ---------- music ----------
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// warm progression: C - Am - F - G (with color tones)
const CHORDS = [
  [60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 65], [55, 59, 62, 67],
];
const PENTA = [72, 74, 76, 79, 81, 84];
let bar = 0;

function startMusic() {
  const barLen = 3.6;
  const tick = () => {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const chord = CHORDS[bar % CHORDS.length];
    // soft pad
    for (const n of chord) {
      pad(NOTE(n - 12), t, barLen + 0.8, 0.045);
      pad(NOTE(n), t, barLen + 0.8, 0.022);
    }
    // gentle plucks on a pentatonic, sparse
    let pt = t + 0.3;
    while (pt < t + barLen - 0.2) {
      if (Math.random() < 0.55) {
        const n = PENTA[(Math.random() * PENTA.length) | 0];
        pluck(NOTE(n), pt, 0.05 + Math.random() * 0.04, musicGain);
      }
      pt += 0.45 + Math.random() * 0.45;
    }
    bar++;
    setTimeout(tick, barLen * 1000);
  };
  tick();
}

function pad(freq, t, dur, vol) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.005;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 1.2);
  g.gain.setValueAtTime(vol, t + dur - 1.4);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f); o2.connect(f); f.connect(g); g.connect(musicGain);
  o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}

function pluck(freq, t, vol, dest, decay = 1.1) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2.001;
  const g = ctx.createGain();
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
  o.start(t); o2.start(t); o.stop(t + decay + 0.1); o2.stop(t + decay + 0.1);
}

// ---------- sfx ----------
function now() { return ctx ? ctx.currentTime : 0; }
const safe = (fn) => (...a) => { if (ctx) fn(...a); };

export const sfx = {
  hover: safe(() => pluck(880, now(), 0.015, sfxGain, 0.15)),
  rotate: safe(() => pluck(660, now(), 0.04, sfxGain, 0.2)),
  select: safe(() => pluck(523, now(), 0.05, sfxGain, 0.3)),
  invalid: safe(() => {
    pluck(196, now(), 0.06, sfxGain, 0.35);
    pluck(185, now() + 0.09, 0.05, sfxGain, 0.4);
  }),
  place: safe(() => {
    // soft wooden thunk
    const t = now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.25);
    noise(t, 0.05, 0.08, 1800);
  }),
  extend: safe(() => {
    const t = now();
    pluck(NOTE(76), t, 0.06, sfxGain, 0.5);
    pluck(NOTE(79), t + 0.07, 0.05, sfxGain, 0.5);
  }),
  complete: safe((value = 1) => {
    const t = now();
    const base = value >= 4 ? [72, 76, 79, 84, 88] : [72, 76, 79, 84];
    base.forEach((n, i) => pluck(NOTE(n), t + i * 0.085, 0.11, sfxGain, 1.2));
    if (value >= 4) shimmer(t + 0.3, 0.8);
  }),
  bank: safe(() => {
    const t = now();
    pluck(NOTE(88), t, 0.07, sfxGain, 0.4);
    pluck(NOTE(91), t + 0.05, 0.06, sfxGain, 0.5);
  }),
  castleEdge: safe(() => {
    const t = now();
    // deep bell + sparkle — a Big Moment
    bell(NOTE(48), t, 0.3, 2.2);
    bell(NOTE(60), t + 0.05, 0.15, 1.8);
    shimmer(t + 0.2, 1.2);
  }),
  jackpot: safe(() => {
    const t = now();
    [60, 64, 67, 72, 76, 79, 84, 88, 91, 96].forEach((n, i) => {
      pluck(NOTE(n), t + i * 0.09, 0.13, sfxGain, 1.6);
    });
    bell(NOTE(36), t, 0.35, 3);
    bell(NOTE(43), t + 0.4, 0.3, 3);
    shimmer(t + 0.5, 2.5);
  }),
  fail: safe(() => {
    const t = now();
    [64, 62, 59].forEach((n, i) => pluck(NOTE(n - 12), t + i * 0.16, 0.08, sfxGain, 0.9));
  }),
  runEnd: safe((net) => {
    const t = now();
    if (net > 0) [60, 64, 67, 72].forEach((n, i) => pluck(NOTE(n), t + i * 0.11, 0.1, sfxGain, 1.1));
    else [64, 60, 57].forEach((n, i) => pluck(NOTE(n), t + i * 0.18, 0.07, sfxGain, 1));
  }),
  tick: safe(() => pluck(NOTE(84), now(), 0.05, sfxGain, 0.15)),
};

function bell(freq, t, vol, decay) {
  for (const [mult, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / mult);
    o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + decay + 0.1);
  }
}

function shimmer(t, dur) {
  for (let i = 0; i < 8; i++) {
    const tt = t + Math.random() * dur;
    pluck(NOTE(PENTA[(Math.random() * PENTA.length) | 0] + 12), tt, 0.03, sfxGain, 0.6);
  }
}

function noise(t, vol, dur, freq) {
  const len = ctx.sampleRate * dur;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t);
}
