// Flat-top axial hex grid helpers.
export const DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export const SIZE = 1; // hex circumradius in world units

export function key(q, r) { return `${q},${r}`; }
export function unkey(k) { const [q, r] = k.split(',').map(Number); return { q, r }; }
export function neighbor(q, r, d) { return { q: q + DIRS[d].q, r: r + DIRS[d].r }; }
export function opposite(d) { return (d + 3) % 6; }

export function toWorld(q, r) {
  return { x: 1.5 * SIZE * q, z: Math.sqrt(3) * SIZE * (r + q / 2) };
}

export function dist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Angle (radians, around Y) from a cell center toward neighbor d.
export function edgeAngle(d) {
  const w = toWorld(DIRS[d].q, DIRS[d].r);
  return Math.atan2(w.z, w.x);
}

// The two corner points (local x/z) bounding edge d, at radius SIZE.
export function edgeCorners(d) {
  const a = edgeAngle(d);
  const c1 = a - Math.PI / 6, c2 = a + Math.PI / 6;
  return [
    { x: Math.cos(c1) * SIZE, z: Math.sin(c1) * SIZE },
    { x: Math.cos(c2) * SIZE, z: Math.sin(c2) * SIZE },
  ];
}

export function edgeMid(d) {
  const [c1, c2] = edgeCorners(d);
  return { x: (c1.x + c2.x) / 2, z: (c1.z + c2.z) / 2 };
}
