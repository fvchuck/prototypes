// HTML overlay UI: HUD, on-board value callouts, tray thumbnails, preview text, modals, toasts.
import { fmt, CASTLE } from './tiles.js';

const THUMB = {
  grass: '#92c463', forest: '#5f9e48', water: '#55b6e6',
  village: '#a9bf6e', road: '#92c463', castle: '#bcb2a2',
};

export const $ = (id) => document.getElementById(id);

export function drawTileThumb(canvas, tile, rotation = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, cx = W / 2, cy = W / 2, R = W * 0.46;
  ctx.clearRect(0, 0, W, W);
  if (!tile) {
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.setLineDash([4, 4]);
    hexPath(ctx, cx, cy, R);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  for (let d = 0; d < 6; d++) {
    const t = tile.edges[(d - rotation % 6 + 6) % 6];
    const a = (30 - d * 60) * Math.PI / 180; // matches edgeAngle(d) with canvas y-down ≈ world +z
    const a1 = a - Math.PI / 6, a2 = a + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
    ctx.lineTo(cx + Math.cos(a2) * R, cy + Math.sin(a2) * R);
    ctx.closePath();
    ctx.fillStyle = THUMB[t];
    ctx.fill();
    // glyphs
    const gx = cx + Math.cos(a) * R * 0.62, gy = cy + Math.sin(a) * R * 0.62;
    if (t === 'forest') glyphTree(ctx, gx, gy, W * 0.07);
    if (t === 'village') glyphHouse(ctx, gx, gy, W * 0.07);
    if (t === 'castle') glyphHouse(ctx, gx, gy, W * 0.08, '#857d6e', '#ffce4f');
    if (t === 'road') {
      ctx.strokeStyle = '#d9bd8d';
      ctx.lineWidth = W * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(90,60,30,.55)';
  ctx.lineWidth = 2;
  hexPath(ctx, cx, cy, R);
  ctx.stroke();
}

function hexPath(ctx, cx, cy, R) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * 60) * Math.PI / 180;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function glyphTree(ctx, x, y, s) {
  ctx.fillStyle = '#3e7d3a';
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x - s * 0.8, y + s * 0.7);
  ctx.lineTo(x + s * 0.8, y + s * 0.7);
  ctx.closePath();
  ctx.fill();
}

function glyphHouse(ctx, x, y, s, body = '#f2e2c4', roof = '#c8553d') {
  ctx.fillStyle = body;
  ctx.fillRect(x - s * 0.7, y - s * 0.2, s * 1.4, s * 1.1);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.9, y - s * 0.15);
  ctx.lineTo(x, y - s * 1.1);
  ctx.lineTo(x + s * 0.9, y - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

// ---------- HUD ----------
export function updateHUD(game) {
  $('hud-bet').textContent = fmt(game.bet);
  $('hud-banked').textContent = fmt(game.run.banked);
  $('hud-atrisk').textContent = fmt(game.atRisk());
  const left = game.tilesLeft;
  $('hud-tiles').textContent = left;
  $('hud-tiles').parentElement.classList.toggle('urgent', left <= 3 && !game.run.over);
  $('wallet').textContent = fmt(game.wallet);
}

export function updateTray(game) {
  drawTileThumb($('cur-tile'), game.run.over ? null : game.current, 0);
  const prevs = game.previews;
  drawTileThumb($('prev-1'), prevs[0] ?? null, 0);
  drawTileThumb($('prev-2'), prevs[1] ?? null, 0);
}

// ---------- buy-more-tiles offer ----------
// target: { name, type, payout, needed }, boostP 0..1, price, rung, canAfford
export function showBuyOffer({ target, boostP, price, rung, canAfford, isCastle }, onBuy, onSkip) {
  const m = $('buy-modal');
  m.classList.remove('hidden');
  $('buy-spark').textContent = isCastle ? '👑' : '⚡';
  $('buy-title').textContent = isCastle ? 'ONE TILE FROM THE JACKPOT!' : 'So close!';
  const need = target.needed === 1 ? 'one more tile' : `${target.needed} more tiles`;
  $('buy-sub').innerHTML = isCastle
    ? `Your castle is <b>${need}</b> from the <b class="gold">${fmt(target.payout)}</b> jackpot.`
    : `Your <b>${target.name}</b> is <b>${need}</b> from banking <b class="green">${fmt(target.payout)}</b>.`;
  $('buy-odds').innerHTML = `<span class="odds-pct">${Math.round(boostP * 100)}%</span> chance this draw fits`;
  const btn = $('buy-btn');
  btn.textContent = `Draw a tile — ${fmt(price)}`;
  btn.disabled = !canAfford;
  $('buy-fine').textContent = canAfford
    ? `Boosted draw · rung ${rung}. Odds disclosed; a miss keeps the chase alive.`
    : `Not enough in wallet for this draw.`;
  btn.onclick = canAfford ? onBuy : null;
  $('buy-skip').onclick = onSkip;
}

export function hideBuyOffer() { $('buy-modal').classList.add('hidden'); }

// ---------- choice banner + focus vignette ----------
export function showChoiceBanner(text) {
  const b = $('choice-banner');
  $('choice-banner-text').textContent = text;
  b.classList.remove('hidden');
  // retrigger the pop animation each time
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  $('choice-dim').classList.remove('hidden');
}
export function hideChoiceBanner() {
  $('choice-banner').classList.add('hidden');
  $('choice-dim').classList.add('hidden');
}

// ---------- on-board section value callouts ----------
// Builds the data the renderer projects over each section on the board.
// Incomplete sections show their "if completed" value; completed show "+banked".
export function buildCallouts(game) {
  const out = [];
  for (const s of game.sectionList()) {
    if (s.type === CASTLE && !s.complete) {
      // a lone castle tile is always one rare tile from the jackpot — flash it
      out.push({ id: s.id, cells: s.tiles, text: fmt(s.payout), cls: 'castle flash' });
    } else if (s.complete) {
      if (!s.payout) continue; // closed tiny sections aren't worth a label
      out.push({ id: s.id, cells: s.tiles, text: `+${fmt(s.payout)}`, cls: s.type === CASTLE ? 'done castle' : 'done' });
    } else if (s.payout > 0) {
      const flash = s.needed === 1 ? ' flash' : '';
      out.push({ id: s.id, cells: s.tiles, text: fmt(s.payout), cls: `value risk-${s.risk}${flash}` });
    }
  }
  return out;
}

// ---------- preview panel ----------
export function showPreview(lines) {
  const p = $('preview-panel');
  if (!lines || lines.length === 0) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  p.innerHTML = lines.map((l) => `<div class="pl pl-${l.kind}">${l.text}</div>`).join('');
}

// ---------- toast ----------
let toastTimer = null;
export function toast(msg, cls = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${cls}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2200);
}

// ---------- floating money text ----------
export function floatText(x, y, text, cls = '') {
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  $('float-layer').appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// ---------- end screen ----------
export function showEndScreen(data, onTick, onDone) {
  const m = $('end-modal');
  m.classList.remove('hidden');
  $('end-title').textContent = data.net > 0 ? 'Run Complete!' : 'Run Complete';
  $('end-nearmiss').classList.toggle('hidden', !data.castleNearMiss);
  const lines = $('end-lines');
  lines.innerHTML = '';
  const rows = [
    ...data.won.map((w) => ({
      html: `<span>${w.type === 'castle' ? '👑 ' : '✓ '}${w.name}${w.type === 'castle' ? ' JACKPOT' : ` ×${w.size}`}</span><b class="good">+${fmt(w.payout)}</b>`,
    })),
    ...data.lost.map((l) => ({
      html: l.type === 'castle'
        ? `<span class="gold">👑 Castle Jackpot <s>${fmt(l.missed)}</s></span><b class="lost">$0.00</b>`
        : `<span class="lost">✗ ${l.name} ×${l.size} <s>${fmt(l.missed)}</s></span><b class="lost">$0.00</b>`,
    })),
  ];
  $('end-summary').innerHTML = '';
  let i = 0;
  const step = () => {
    if (i < rows.length) {
      const div = document.createElement('div');
      div.className = 'end-row';
      div.innerHTML = rows[i].html;
      lines.appendChild(div);
      onTick?.();
      i++;
      setTimeout(step, 320);
    } else {
      $('end-summary').innerHTML = `
        <div class="end-row sum"><span>Bet</span><b>−${fmt(data.bet)}</b></div>
        <div class="end-row sum"><span>Total won</span><b>${fmt(data.banked)}</b></div>
        <div class="end-row sum net"><span>Net</span><b class="${data.net >= 0 ? 'good' : 'lost'}">${data.net >= 0 ? '+' : '−'}${fmt(Math.abs(data.net))}</b></div>`;
      onDone?.();
    }
  };
  setTimeout(step, 350);
}

export function hideEndScreen() { $('end-modal').classList.add('hidden'); }
