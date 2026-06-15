// Pure resolver. Units: [{atk, hp, ...}], index 0 = front. Does not mutate inputs.
// Returns { winner: 'player'|'enemy'|'draw', events: [...] }.
// Events: {type:'clash', pIdx, eIdx, pDmg, eDmg, pHp, eHp} | {type:'death', side, idx}
export function resolveBattle(playerUnits, enemyUnits) {
  const p = playerUnits.map((x) => ({ ...x }));
  const e = enemyUnits.map((x) => ({ ...x }));
  const events = [];
  let pi = 0, ei = 0;
  while (pi < p.length && ei < e.length) {
    const a = p[pi], b = e[ei];
    a.hp -= b.atk;
    b.hp -= a.atk;
    events.push({ type: 'clash', pIdx: pi, eIdx: ei, pDmg: b.atk, eDmg: a.atk, pHp: a.hp, eHp: b.hp });
    if (a.hp <= 0) { events.push({ type: 'death', side: 'player', idx: pi }); pi++; }
    if (b.hp <= 0) { events.push({ type: 'death', side: 'enemy', idx: ei }); ei++; }
  }
  const pAlive = pi < p.length, eAlive = ei < e.length;
  const winner = pAlive && !eAlive ? 'player' : eAlive && !pAlive ? 'enemy' : 'draw';
  return { winner, events };
}
