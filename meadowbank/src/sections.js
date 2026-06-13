// Section (terrain group) tracking with union-find.
import { key, neighbor, opposite } from './hex.js';
import { GRASS, CASTLE } from './tiles.js';

let nextId = 1;

export class Sections {
  constructor() {
    this.features = new Map();      // id -> feature
    this.parent = new Map();        // union-find
    this.edgeFeature = new Map();   // cellKey -> [featureId|null x6]
  }

  find(id) {
    let p = this.parent.get(id);
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }

  feat(id) { return this.features.get(this.find(id)); }

  newFeature(type) {
    const id = nextId++;
    const f = { id, type, tiles: new Set(), openEdges: new Set(), complete: false, completedAt: -1 };
    this.features.set(id, f);
    this.parent.set(id, id);
    return f;
  }

  union(aId, bId) {
    const ra = this.find(aId), rb = this.find(bId);
    if (ra === rb) return this.features.get(ra);
    const a = this.features.get(ra), b = this.features.get(rb);
    const [big, small] = a.tiles.size >= b.tiles.size ? [a, b] : [b, a];
    for (const t of small.tiles) big.tiles.add(t);
    for (const e of small.openEdges) big.openEdges.add(e);
    this.parent.set(small.id, big.id);
    this.features.delete(small.id);
    return big;
  }

  featureAtEdge(cellKey, d) {
    const arr = this.edgeFeature.get(cellKey);
    if (!arr || arr[d] == null) return null;
    return this.feat(arr[d]);
  }

  // Place a tile (worldEdges already rotated) at cell. board: Map(cellKey -> {edges}).
  // The board must NOT yet contain this tile. Returns { completed: [features] }.
  place(q, r, worldEdges, board) {
    const ck = key(q, r);
    const byType = new Map(); // type -> feature for this tile
    const edgeFeat = new Array(6).fill(null);
    for (let d = 0; d < 6; d++) {
      const t = worldEdges[d];
      if (t === GRASS) continue;
      if (!byType.has(t)) {
        const f = this.newFeature(t);
        f.tiles.add(ck);
        byType.set(t, f);
      }
      edgeFeat[d] = byType.get(t).id;
    }
    this.edgeFeature.set(ck, edgeFeat);

    const touched = new Set();
    for (const f of byType.values()) touched.add(f.id);

    for (let d = 0; d < 6; d++) {
      const n = neighbor(q, r, d);
      const nk = key(n.q, n.r);
      const myType = worldEdges[d];
      if (board.has(nk)) {
        const od = opposite(d);
        const nf = this.featureAtEdge(nk, od);
        if (nf) {
          nf.openEdges.delete(`${nk},${od}`); // their edge no longer faces empty
          touched.add(nf.id);
          const nType = board.get(nk).edges[od];
          if (myType !== GRASS && myType === nType && !nf.complete) {
            const merged = this.union(byType.get(myType).id, nf.id);
            touched.add(merged.id);
          }
        }
      } else if (myType !== GRASS) {
        // resolve through find(): an earlier direction may have merged this
        // tile's feature into a neighbor
        this.feat(byType.get(myType).id).openEdges.add(`${ck},${d}`);
      }
    }

    const completed = [];
    for (const id of touched) {
      const f = this.features.get(this.find(id));
      if (f && !f.complete && f.openEdges.size === 0) {
        f.complete = true;
        completed.push(f);
      }
    }
    return { completed };
  }

  // Cells (keys) a feature still needs filled = distinct empty cells its open edges face.
  cellsNeeded(f) {
    const cells = new Set();
    for (const e of f.openEdges) {
      const [q, r, d] = e.split(',').map(Number);
      const n = neighbor(q, r, d);
      cells.add(key(n.q, n.r));
    }
    return cells;
  }

  incomplete() {
    return [...this.features.values()].filter((f) => !f.complete);
  }
  all() { return [...this.features.values()]; }

  // Deep copy for single-step undo. Feature ids are preserved (the module-global
  // nextId only ever grows, so restored ids never collide with future ones).
  clone() {
    const s = new Sections();
    for (const [id, f] of this.features) {
      s.features.set(id, {
        id: f.id, type: f.type,
        tiles: new Set(f.tiles),
        openEdges: new Set(f.openEdges),
        complete: f.complete, completedAt: f.completedAt,
        payout: f.payout,
      });
    }
    s.parent = new Map(this.parent);
    s.edgeFeature = new Map();
    for (const [k, arr] of this.edgeFeature) s.edgeFeature.set(k, arr.slice());
    return s;
  }
}

// Placement legality. A castle edge may ONLY face empty land or another castle
// edge — never an ordinary tile. So a lone castle tile must point its castle
// edge at open space (staying incomplete) and the only thing that can seal it is
// the rare second castle tile. (Without this, a castle edge laid flush against a
// grass neighbour would have no open edge and complete instantly for free.)
export function placementProblem(q, r, worldEdges, board) {
  for (let d = 0; d < 6; d++) {
    const n = neighbor(q, r, d);
    const nk = key(n.q, n.r);
    if (!board.has(nk)) continue;
    const nType = board.get(nk).edges[opposite(d)];
    if ((nType === CASTLE) !== (worldEdges[d] === CASTLE)) {
      return nType === CASTLE
        ? 'Only a second castle tile can seal the castle.'
        : 'A castle edge can only face open land or another castle.';
    }
  }
  return null;
}
