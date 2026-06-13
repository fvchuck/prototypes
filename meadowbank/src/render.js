// Three.js board renderer: procedural low-poly cozy tiles.
import * as THREE from 'three';
import { toWorld, edgeCorners, edgeAngle, edgeMid, unkey, SIZE } from './hex.js';
import { GRASS, FOREST, WATER, VILLAGE, ROAD, CASTLE } from './tiles.js';
import { mulberry32 } from './tiles.js';

const H = 0.34; // tile thickness

const TOP = {
  grass: 0x92c463, forest: 0x5f9e48, water: 0x55b6e6,
  village: 0xa9bf6e, road: 0x92c463, castle: 0xbcb2a2,
};
const SIDE = 0xb98e5f;
const RISK = { low: 0x7ec850, med: 0xf0b840, high: 0xf0584a, doomed: 0x9a8f80 };
const GOLD = 0xffce4f;
const CHOICE_COLORS = { bank: 0x7ec850, grow: 0xffce4f, seed: 0x58b7e6, castle: 0xffce4f, filler: 0xffffff };

const matCache = new Map();
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!matCache.has(k)) {
    matCache.set(k, new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: 0.85, metalness: 0, ...opts,
    }));
  }
  return matCache.get(k);
}

function jitterColor(hex, rng, amt = 0.05) {
  const c = new THREE.Color(hex);
  c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * amt, (rng() - 0.5) * amt);
  return c;
}

// ---------- tile construction ----------
function buildBase(edges, rng) {
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  let vi = 0;
  const push = (x, y, z, color) => { pos.push(x, y, z); col.push(color.r, color.g, color.b); return vi++; };

  for (let d = 0; d < 6; d++) {
    const t = edges[d];
    const [c1, c2] = edgeCorners(d);
    const topC = jitterColor(TOP[t] ?? TOP.grass, rng, t === WATER ? 0.03 : 0.06);
    // top wedge
    const a = push(0, H, 0, topC);
    const b = push(c1.x, H, c1.z, topC);
    const e = push(c2.x, H, c2.z, topC);
    idx.push(a, e, b);
    // side wall
    c.set(SIDE); c.offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    const s1 = push(c1.x, H, c1.z, c), s2 = push(c2.x, H, c2.z, c);
    const s3 = push(c2.x, 0, c2.z, c), s4 = push(c1.x, 0, c1.z, c);
    idx.push(s1, s2, s3, s1, s3, s4);
    // water gets a darker inner triangle for depth
    if (t === WATER) {
      const deep = new THREE.Color(0x3f9ed6);
      const m1 = { x: c1.x * 0.92, z: c1.z * 0.92 }, m2 = { x: c2.x * 0.92, z: c2.z * 0.92 };
      const w1 = push(0.02, H + 0.005, 0.02, deep);
      const w2 = push(m1.x, H + 0.005, m1.z, deep);
      const w3 = push(m2.x, H + 0.005, m2.z, deep);
      idx.push(w1, w3, w2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat(0xffffff, { vertexColors: true }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function tree(rng, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.1, 5), mat(0x8a6238));
  trunk.position.y = 0.05;
  const h = (0.26 + rng() * 0.2) * scale;
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.13 + rng() * 0.07, h, 6),
    mat(rng() < 0.5 ? 0x3e7d3a : 0x4f9645),
  );
  leaf.position.y = 0.1 + h / 2;
  leaf.castShadow = true;
  g.add(trunk, leaf);
  g.rotation.y = rng() * Math.PI;
  return g;
}

function house(rng) {
  const g = new THREE.Group();
  const w = 0.16 + rng() * 0.05;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.13, w * 0.85), mat(0xf2e2c4));
  body.position.y = 0.065; body.castShadow = true;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, w * 0.82, 0.12, 4), mat(rng() < 0.8 ? 0xc8553d : 0xb0654a));
  roof.position.y = 0.19; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  g.add(body, roof);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

function castleTower(rng) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 6), mat(0xcfc6b4));
  body.position.y = 0.25; body.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 6), mat(GOLD, { emissive: 0x553f00, emissiveIntensity: 0.35 }));
  roof.position.y = 0.6; roof.castShadow = true;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), mat(0x8a6238));
  pole.position.y = 0.78;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.05), mat(0xe04848, { side: THREE.DoubleSide }));
  flag.position.set(0.05, 0.81, 0);
  g.add(body, roof, pole, flag);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

export function buildTileGroup(edges, seedStr, ghost = false) {
  const rng = mulberry32(hashStr(seedStr));
  const group = new THREE.Group();
  group.add(buildBase(edges, rng));

  const roadDirs = [];
  let castleDone = false;
  for (let d = 0; d < 6; d++) {
    const t = edges[d];
    const ang = edgeAngle(d);
    const cx = Math.cos(ang) * 0.58, cz = Math.sin(ang) * 0.58;
    const perp = { x: -Math.sin(ang), z: Math.cos(ang) };
    if (t === FOREST) {
      const n = 2 + (rng() < 0.6 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const off = (i / Math.max(n - 1, 1) - 0.5) * 0.5 + (rng() - 0.5) * 0.12;
        const rad = 0.42 + rng() * 0.3;
        const tr = tree(rng);
        tr.position.set(Math.cos(ang) * rad + perp.x * off, H, Math.sin(ang) * rad + perp.z * off);
        group.add(tr);
      }
    } else if (t === VILLAGE) {
      const h = house(rng);
      h.position.set(cx, H, cz);
      group.add(h);
      if (rng() < 0.4) {
        const t2 = tree(rng, 0.6);
        t2.position.set(cx + perp.x * 0.3, H, cz + perp.z * 0.3);
        group.add(t2);
      }
    } else if (t === WATER) {
      if (rng() < 0.75) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 7), mat(0x6fc06a));
        pad.position.set(cx * (0.7 + rng() * 0.4) + perp.x * (rng() - 0.5) * 0.3, H + 0.01, cz * (0.7 + rng() * 0.4) + perp.z * (rng() - 0.5) * 0.3);
        group.add(pad);
      }
    } else if (t === ROAD) {
      roadDirs.push(d);
    } else if (t === CASTLE && !castleDone) {
      castleDone = true; // one tower per castle tile, near its castle edge
      const tw = castleTower(rng);
      tw.position.set(cx * 0.5, H, cz * 0.5);
      group.add(tw);
    } else if (t === GRASS) {
      if (rng() < 0.16) {
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), mat(rng() < 0.5 ? 0xffffff : 0xffd9e8));
        fl.position.set(cx + (rng() - 0.5) * 0.3, H + 0.02, cz + (rng() - 0.5) * 0.3);
        group.add(fl);
      } else if (rng() < 0.12) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), mat(0xb5ab9c));
        rock.scale.y = 0.6;
        rock.position.set(cx + (rng() - 0.5) * 0.3, H + 0.02, cz + (rng() - 0.5) * 0.3);
        rock.castShadow = true;
        group.add(rock);
      }
    }
  }
  // road strips meet in the middle
  for (const d of roadDirs) {
    const m = edgeMid(d);
    const len = Math.hypot(m.x, m.z);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.3), mat(0xd9bd8d));
    strip.position.set(m.x / 2, H + 0.012, m.z / 2);
    strip.rotation.y = -Math.atan2(m.z, m.x);
    group.add(strip);
  }
  if (roadDirs.length) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.035, 8), mat(0xd9bd8d));
    hub.position.y = H + 0.012;
    group.add(hub);
  }
  if (ghost) {
    group.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.material.depthWrite = false;
        o.castShadow = false;
      }
    });
  }
  return group;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- renderer ----------
export class Renderer {
  constructor(container, callbacks) {
    this.cb = callbacks;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf4e3c8, 26, 60);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

    const hemi = new THREE.HemisphereLight(0xfff4e0, 0xcdb795, 1.0);
    const sun = new THREE.DirectionalLight(0xffeecf, 1.6);
    sun.position.set(6, 14, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0008;
    this.scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.25));
    this.sun = sun;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48),
      new THREE.MeshStandardMaterial({ color: 0xead7b3, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.tiles = new THREE.Group();
    this.glow = new THREE.Group();
    this.valid = new THREE.Group();
    this.extendFx = new THREE.Group();
    this.fx = new THREE.Group();
    this.clouds = new THREE.Group();
    this.scene.add(this.tiles, this.glow, this.valid, this.extendFx, this.fx, this.clouds);
    this.makeClouds();

    this.tileMeshes = new Map(); // cellKey -> group
    this.validMeshes = [];
    this.particles = [];
    this.tweens = [];
    this.ghost = null;
    this.ghostRing = null;
    this.extendMats = [];

    // on-board section value callouts (DOM layer projected each frame)
    this.calloutLayer = document.getElementById('callouts');
    this.calloutEls = new Map(); // section id -> element

    // multi-ghost choice mode (tap-to-bank): translucent tiles + floating labels
    this.choicePinLayer = document.getElementById('choice-pins');
    this.pins = [];           // [{ el, q, r }]
    this.choiceGhosts = [];   // translucent tile groups
    this.choiceFx = new THREE.Group(); // halo rings + glow discs under ghosts
    this.choiceAnim = [];     // [{ group, baseY, ringMat, discMat, ring }]
    this.scene.add(this.choiceFx);

    // camera state
    this.auto = { cx: 1.5, cz: 0, dist: 13 };
    this.cur = { cx: 1.5, cz: 0, dist: 13 };
    this.boardHalf = 6; // board footprint radius — clouds skirt outside this
    this.userZoom = 1; this.panX = 0; this.panZ = 0;
    this.pitch = 0.94; this.yaw = -0.22;

    this.setupInput();
    addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  makeClouds() {
    const m = mat(0xffffff, { transparent: true, opacity: 0.85, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Group();
      for (let j = 0; j < 3 + (i % 2); j++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.5, 0), m);
        b.position.set(j * 0.7 - 1, Math.random() * 0.2, Math.random() * 0.5);
        b.scale.y = 0.55;
        c.add(b);
      }
      c.position.set(-14 + i * 8, 6.5 + Math.random() * 1.5, -10);
      c.userData.speed = 0.12 + Math.random() * 0.12;
      c.userData.pad = 2.5 + Math.random() * 3.5; // how far outside the board edge this cloud skirts
      this.clouds.add(c);
    }
  }

  // ----- board -----
  addTile(q, r, edges, animate = true) {
    const k = `${q},${r}`;
    const g = buildTileGroup(edges, k);
    const w = toWorld(q, r);
    g.position.set(w.x, 0, w.z);
    this.tiles.add(g);
    this.tileMeshes.set(k, g);
    if (animate) {
      g.position.y = 3.2;
      this.tweens.push({
        t: 0, dur: 0.32,
        fn: (p) => { g.position.y = 3.2 * (1 - easeOutCubic(p)); },
        done: () => { g.position.y = 0; this.dust(w.x, w.z); },
      });
    }
    this.fitCamera();
  }

  dust(x, z) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.9, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3da, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    this.fx.add(ring);
    this.tweens.push({
      t: 0, dur: 0.45,
      fn: (p) => { ring.scale.setScalar(1 + p * 0.9); ring.material.opacity = 0.7 * (1 - p); },
      done: () => this.fx.remove(ring),
    });
  }

  fitCamera() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of this.tileMeshes.keys()) {
      const { q, r } = unkey(k);
      const w = toWorld(q, r);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
    }
    if (minX === Infinity) return;
    this.auto.cx = (minX + maxX) / 2;
    this.auto.cz = (minZ + maxZ) / 2 + 0.6;
    this.boardHalf = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
    const span = Math.max(maxX - minX, (maxZ - minZ) * 1.3, 6) + 4.5;
    // portrait screens need to pull back further to fit the board width
    const aspectBoost = Math.min(Math.max(1 / this.camera.aspect, 1), 2.1);
    this.auto.dist = Math.max(10, span * 1.18 * aspectBoost);
  }

  // ----- valid cells + ghost -----
  setValidCells(keys, selectedKey = null) {
    this.valid.clear();
    this.validMeshes = [];
    for (const k of keys) {
      const { q, r } = unkey(k);
      const w = toWorld(q, r);
      const isSel = k === selectedKey;
      const disc = new THREE.Mesh(
        hexDiscGeo(),
        new THREE.MeshBasicMaterial({ color: isSel ? 0xfff0b0 : 0xffffff, transparent: true, opacity: isSel ? 0.32 : 0.10 }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(w.x, 0.02, w.z);
      disc.userData.cellKey = k;
      const ring = new THREE.LineLoop(hexRingGeo(), new THREE.LineBasicMaterial({
        color: isSel ? 0xffd96a : 0xffffff, transparent: true, opacity: isSel ? 0.95 : 0.4,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, 0.04, w.z);
      this.valid.add(disc, ring);
      this.validMeshes.push(disc);
    }
  }

  showGhost(q, r, edges, valid) {
    this.hideGhost();
    const g = buildTileGroup(edges, `ghost`, true);
    const w = toWorld(q, r);
    g.position.set(w.x, 0.25, w.z);
    if (!valid) {
      g.traverse((o) => { if (o.isMesh) { o.material.color.lerp(new THREE.Color(0xff5544), 0.45); } });
    }
    this.tiles.add(g);
    this.ghost = g;
  }

  hideGhost() {
    if (this.ghost) { this.tiles.remove(this.ghost); this.ghost = null; }
  }

  // ----- multi-ghost choice -----
  // options: [{ q, r, edges, label:{cls} }] — a translucent tile + colored halo
  // at each candidate cell, bobbing and pulsing to invite a tap.
  showChoiceGhosts(options) {
    this.clearChoiceGhosts();
    for (const o of options) {
      const w = toWorld(o.q, o.r);
      const color = CHOICE_COLORS[o.label?.cls] ?? 0xffffff;
      const g = buildTileGroup(o.edges, 'choice', true);
      g.position.set(w.x, 0.2, w.z);
      this.tiles.add(g);
      this.choiceGhosts.push(g);

      const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(hexDiscGeo(), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(w.x, 0.05, w.z);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.2, 30), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(w.x, 0.07, w.z);
      this.choiceFx.add(disc, ring);
      this.choiceAnim.push({ group: g, baseY: 0.2, ringMat, discMat, ring });
    }
  }

  clearChoiceGhosts() {
    for (const g of this.choiceGhosts) this.tiles.remove(g);
    this.choiceGhosts = [];
    this.choiceFx.clear();
    this.choiceAnim = [];
  }

  // list: [{ q, r, html, cls }] — floating labels pinned over each candidate cell.
  setChoicePins(list) {
    for (const p of this.pins) p.el.remove();
    this.pins = [];
    if (!this.choicePinLayer) return;
    for (const it of list) {
      const el = document.createElement('div');
      el.className = `choice-pin ${it.cls ?? ''}`;
      el.innerHTML = it.html;
      this.choicePinLayer.appendChild(el);
      this.pins.push({ el, q: it.q, r: it.r });
    }
  }

  positionPins() {
    if (!this.pins.length) return;
    const el0 = this.renderer.domElement;
    const W = el0.clientWidth, Hh = el0.clientHeight;
    const v = new THREE.Vector3();
    for (const p of this.pins) {
      const w = toWorld(p.q, p.r);
      v.set(w.x, H + 0.7, w.z).project(this.camera);
      if (v.z > 1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      p.el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      p.el.style.top = `${(-v.y * 0.5 + 0.5) * Hh}px`;
    }
  }

  // ----- section glow -----
  updateGlow(sections) {
    this.glow.clear();
    this.castleGlowMats = [];
    for (const s of sections) {
      if (s.complete) continue;
      const color = s.type === CASTLE ? GOLD : RISK[s.risk] ?? RISK.low;
      for (const e of s.openEdges) {
        const [q, r, d] = e.split(',').map(Number);
        const w = toWorld(q, r);
        const [c1, c2] = edgeCorners(d);
        const len = Math.hypot(c2.x - c1.x, c2.z - c1.z);
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.07, 0.09), m);
        const mid = edgeMid(d);
        bar.position.set(w.x + mid.x, H + 0.05, w.z + mid.z);
        bar.rotation.y = -Math.atan2(c2.z - c1.z, c2.x - c1.x);
        this.glow.add(bar);
        if (s.type === CASTLE) this.castleGlowMats.push(m);
      }
    }
  }

  // ----- on-board value callouts -----
  // list: [{ id, cells:[cellKey], text, cls }]
  setCallouts(list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.id);
      let el = this.calloutEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        this.calloutLayer.appendChild(el);
        this.calloutEls.set(c.id, el);
      }
      el.className = `callout ${c.cls}`;
      el.textContent = c.text;
      el._cells = c.cells;
    }
    for (const [id, el] of this.calloutEls) {
      if (!seen.has(id)) { el.remove(); this.calloutEls.delete(id); }
    }
  }

  positionCallouts() {
    if (!this.calloutLayer) return;
    const el0 = this.renderer.domElement;
    const W = el0.clientWidth, Hh = el0.clientHeight;
    const v = new THREE.Vector3();
    for (const [, el] of this.calloutEls) {
      const cells = el._cells;
      if (!cells || !cells.length) continue;
      let x = 0, z = 0;
      for (const k of cells) { const { q, r } = unkey(k); const w = toWorld(q, r); x += w.x; z += w.z; }
      x /= cells.length; z /= cells.length;
      v.set(x, H + 0.55, z).project(this.camera);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * Hh}px`;
    }
  }

  // ----- preview: highlight the section parts a placement would extend -----
  // edges: [{ edge:'q,r,d', type }]
  showExtendHighlight(edges) {
    this.clearExtendHighlight();
    for (const { edge } of edges) {
      const [q, r, d] = edge.split(',').map(Number);
      const w = toWorld(q, r);
      const [c1, c2] = edgeCorners(d);
      const len = Math.hypot(c2.x - c1.x, c2.z - c1.z);
      const m = new THREE.MeshBasicMaterial({ color: 0xfff6d6, transparent: true, opacity: 0.95 });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, 0.12, 0.16), m);
      const mid = edgeMid(d);
      bar.position.set(w.x + mid.x, H + 0.1, w.z + mid.z);
      bar.rotation.y = -Math.atan2(c2.z - c1.z, c2.x - c1.x);
      this.extendFx.add(bar);
      this.extendMats.push(m);
    }
  }

  clearExtendHighlight() {
    this.extendFx.clear();
    this.extendMats = [];
  }

  // ----- shake tiles that just got extended -----
  shakeTiles(cellKeys) {
    for (const k of cellKeys) {
      const g = this.tileMeshes.get(k);
      if (!g) continue;
      const phase = (k.charCodeAt(0) + (k.charCodeAt(2) || 0)) % 7;
      this.tweens.push({
        t: 0, dur: 0.5,
        fn: (p) => {
          const damp = 1 - p;
          g.rotation.y = Math.sin(p * Math.PI * 9 + phase) * 0.09 * damp;
          g.position.y = Math.abs(Math.sin(p * Math.PI * 7)) * 0.10 * damp;
        },
        done: () => { g.rotation.y = 0; g.position.y = 0; },
      });
    }
  }

  // screen position of the centroid of a set of cells
  cellsScreenPos(cells) {
    let x = 0, z = 0;
    for (const k of cells) { const { q, r } = unkey(k); const w = toWorld(q, r); x += w.x; z += w.z; }
    x /= cells.length; z /= cells.length;
    const v = new THREE.Vector3(x, H + 0.4, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight };
  }

  // ----- fx -----
  burst(cellKeys, colorHex, big = false) {
    for (const k of cellKeys) {
      const { q, r } = unkey(k);
      const w = toWorld(q, r);
      const n = big ? 26 : 12;
      for (let i = 0; i < n; i++) {
        const p = new THREE.Mesh(
          new THREE.TetrahedronGeometry(big ? 0.09 : 0.06),
          new THREE.MeshBasicMaterial({ color: colorHex, transparent: true }),
        );
        p.position.set(w.x + (Math.random() - 0.5) * 0.8, H + 0.1, w.z + (Math.random() - 0.5) * 0.8);
        p.userData.vel = new THREE.Vector3(
          (Math.random() - 0.5) * 2.2,
          2.2 + Math.random() * (big ? 3.4 : 2),
          (Math.random() - 0.5) * 2.2,
        );
        p.userData.life = 1 + Math.random() * 0.4;
        p.userData.age = 0;
        this.fx.add(p);
        this.particles.push(p);
      }
    }
  }

  cellScreenPos(q, r) {
    const w = toWorld(q, r);
    const v = new THREE.Vector3(w.x, H + 0.4, w.z).project(this.camera);
    const el = this.renderer.domElement;
    return {
      x: (v.x * 0.5 + 0.5) * el.clientWidth,
      y: (-v.y * 0.5 + 0.5) * el.clientHeight,
    };
  }

  // ----- input -----
  setupInput() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let down = null, dragging = false;
    let pinch = null;

    const pick = (cx, cy) => {
      const rect = el.getBoundingClientRect();
      ptr.x = ((cx - rect.left) / rect.width) * 2 - 1;
      ptr.y = -((cy - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ptr, this.camera);
      const hits = ray.intersectObjects(this.validMeshes, false);
      return hits.length ? hits[0].object.userData.cellKey : null;
    };

    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      dragging = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (down && (Math.abs(e.clientX - down.x) > 7 || Math.abs(e.clientY - down.y) > 7)) dragging = true;
      if (dragging && down && e.buttons) {
        const s = this.cur.dist * 0.0016;
        this.panX -= (e.movementX) * s;
        this.panZ -= (e.movementY) * s * 1.4;
        this.panX = THREE.MathUtils.clamp(this.panX, -8, 8);
        this.panZ = THREE.MathUtils.clamp(this.panZ, -8, 8);
      } else if (!e.buttons) {
        this.cb.onHover?.(pick(e.clientX, e.clientY));
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!dragging) this.cb.onTap?.(pick(e.clientX, e.clientY));
      down = null; dragging = false;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userZoom = THREE.MathUtils.clamp(this.userZoom * (1 + e.deltaY * 0.0011), 0.55, 1.8);
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (pinch) this.userZoom = THREE.MathUtils.clamp(this.userZoom * (pinch / d), 0.55, 1.8);
        pinch = d;
      }
    }, { passive: true });
    el.addEventListener('touchend', () => { pinch = null; });
  }

  // ----- loop -----
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const p = Math.min(tw.t / tw.dur, 1);
      tw.fn(p);
      if (p >= 1) { tw.done?.(); this.tweens.splice(i, 1); }
    }
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.age += dt;
      p.userData.vel.y -= 6.5 * dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.rotation.x += dt * 4; p.rotation.z += dt * 3;
      const lifeP = p.userData.age / p.userData.life;
      p.material.opacity = 1 - lifeP;
      if (lifeP >= 1) { this.fx.remove(p); this.particles.splice(i, 1); }
    }
    // clouds drift — always skirt AROUND the board's edges, never across the front.
    // Each cloud arcs along a circle of radius (boardHalf + pad) on the far (back)
    // side, so its z bows away from the board whenever it crosses the board's x-span.
    const bx = this.auto.cx, bz = this.auto.cz;
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      // arc radius scales with board size (× >√2) so the path always clears the
      // footprint — even at dx = boardHalf the cloud sits behind the back edge.
      const excl = this.boardHalf * 1.6 + c.userData.pad;
      const reach = excl + 13;
      if (c.position.x > bx + reach) c.position.x = bx - reach;
      const dx = c.position.x - bx;
      const zTarget = bz - Math.sqrt(Math.max(excl * excl - dx * dx, 0)); // hug the back/side edge
      c.position.z += (zTarget - c.position.z) * Math.min(1, dt * 2.5);
    }
    // castle glow pulse
    if (this.castleGlowMats) {
      const pulse = 0.65 + Math.sin(t * 3.4) * 0.35;
      for (const m of this.castleGlowMats) m.opacity = pulse;
    }
    // extend-highlight pulse
    if (this.extendMats.length) {
      const pulse = 0.55 + Math.sin(t * 8) * 0.4;
      for (const m of this.extendMats) m.opacity = pulse;
    }
    // choice ghosts: bob + halo pulse to invite a tap
    if (this.choiceAnim.length) {
      const bob = Math.sin(t * 3) * 0.5 + 0.5;
      for (const a of this.choiceAnim) {
        a.group.position.y = a.baseY + Math.sin(t * 3) * 0.06;
        a.ringMat.opacity = 0.45 + bob * 0.5;
        a.ring.scale.setScalar(1 + bob * 0.14);
        a.discMat.opacity = 0.1 + bob * 0.14;
      }
    }
    // keep value callouts + choice labels pinned over their cells
    this.positionCallouts();
    this.positionPins();
    // camera
    const k = 1 - Math.pow(0.0015, dt);
    this.cur.cx += (this.auto.cx + this.panX - this.cur.cx) * k;
    this.cur.cz += (this.auto.cz + this.panZ - this.cur.cz) * k;
    this.cur.dist += (this.auto.dist * this.userZoom - this.cur.dist) * k;
    const d = this.cur.dist;
    const cy = Math.sin(this.pitch) * d;
    const ch = Math.cos(this.pitch) * d;
    this.camera.position.set(
      this.cur.cx + Math.sin(this.yaw) * ch,
      cy,
      this.cur.cz + Math.cos(this.yaw) * ch,
    );
    this.camera.lookAt(this.cur.cx, 0, this.cur.cz);
    this.sun.position.set(this.cur.cx + 6, 14, this.cur.cz + 4);
    this.sun.target.position.set(this.cur.cx, 0, this.cur.cz);
    this.sun.target.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
  }
}

let _discGeo = null, _ringGeo = null;
function hexDiscGeo() {
  if (!_discGeo) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const [c1] = edgeCorners(i);
      if (i === 0) shape.moveTo(c1.x, c1.z); else shape.lineTo(c1.x, c1.z);
    }
    _discGeo = new THREE.ShapeGeometry(shape);
  }
  return _discGeo;
}
function hexRingGeo() {
  if (!_ringGeo) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const [c1] = edgeCorners(i);
      pts.push(new THREE.Vector3(c1.x * 0.94, c1.z * 0.94, 0));
    }
    _ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
  }
  return _ringGeo;
}

function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
