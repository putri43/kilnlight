// world.js — "Kilnworks Foundry in monsoon blackout", the map for KILNLIGHT.
// Layout (64 x 48 m, single level): Aurora spawns west, Umbra spawns east.
// Two objective sites — Furnace (A, north-east) and Cooling Yard (B,
// south-west) — joined by Mid Hall, North Pipewalk and South Alley. Cover is
// crates, containers, barrels and furnace machinery; every solid is also an
// AABB collider so movement, bullets and bots all agree on the same map.
//
// THE TWIST — lamplight and rain: the foundry is blacked out by the monsoon.
// The only clear sightlines are warm pools of light under the hanging lamps;
// everywhere else is dark enough that fighters are hard to spot. Rain falls
// through the roof gaps and drums on the roof, masking footsteps. LAMPS is
// the list of lamp pools; inLamplight(x, z) is the visibility test the bots
// and the HUD both use. Rain is a LineSegments streak field, animated by
// updateRain(dt).
import * as THREE from 'three';

export const MAP = { w: 64, d: 48, wallH: 5 };

// Axis-aligned colliders: {x0,z0,x1,z1,h}. y is always 0..h.
export const COLLIDERS = [];
export const WAYPOINTS = []; // {x,z,site?} nav graph nodes for bots
export const SITES = {
  A: { name: 'Furnace', cx: 22, cz: -15, r: 6.5 },
  B: { name: 'Cooling Yard', cx: -20, cz: 15, r: 6.5 },
};
export const SPAWNS = {
  aurora: [[-28, -8], [-28, 0], [-28, 8], [-26, -14]],
  umbra: [[28, -8], [28, 0], [28, 8], [26, 14]],
};
// Hanging lamps: the only clear sightlines in the blackout. {x, z, r} where
// r is the pool radius on the floor — stand inside one and you can be seen
// from far away; stand outside and you are hard to spot.
export const LAMPS = [
  { x: -6, z: 0, r: 4.5 },   // Mid Hall west
  { x: 6, z: 0, r: 4.5 },    // Mid Hall east
  { x: -6, z: -8, r: 4 },    // North Pipewalk west gate
  { x: 10, z: -8, r: 4 },    // North Pipewalk east gate
  { x: -6, z: 8, r: 4 },     // South Alley west gate
  { x: 10, z: 8, r: 4 },     // South Alley east gate
  { x: 22, z: -15, r: 5 },   // Site A — Furnace
  { x: -20, z: 15, r: 5 },   // Site B — Cooling Yard
];
export function inLamplight(x, z) {
  for (const l of LAMPS) { const dx = x - l.x, dz = z - l.z; if (dx * dx + dz * dz < l.r * l.r) return true; }
  return false;
}

function addBox(x0, z0, x1, z1, h = 4) {
  COLLIDERS.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h });
}
function wp(x, z, site) { WAYPOINTS.push({ x, z, site: site || null }); return WAYPOINTS.length - 1; }

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace; return t;
}
function speckle(ctx, s, base, dots, alpha) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${20 + Math.random() * 60 | 0},${20 + Math.random() * 55 | 0},${18 + Math.random() * 45 | 0},${alpha})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  for (const [x, y, w, h, col] of dots) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
}

export function makeTextures() {
  const floor = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#2e3134', [[0, 0, s, 4, '#1c1e20'], [0, s / 2, s, 2, '#232628']], 0.25);
    ctx.strokeStyle = '#222528'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(s, i * 64); ctx.stroke(); }
  }, 16);
  const wall = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#3a3630', [[0, s - 26, s, 26, '#5a4218']], 0.2);
    ctx.fillStyle = '#26231f'; ctx.fillRect(0, 0, s, 10);
  }, 8);
  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#a87c10'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#161616';
    for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * 32, s); ctx.lineTo(i * 32 + 32, 0); ctx.lineTo(i * 32 + 64, 0); ctx.lineTo(i * 32 + 32, s); ctx.fill(); }
  }, 1);
  const crate = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#54401f', [], 0.2);
    ctx.strokeStyle = '#2e210f'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, s - 8, s - 8);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s); ctx.stroke();
  }, 1);
  const metal = canvasTexture(128, (ctx, s) => {
    speckle(ctx, s, '#484e55', [[0, 0, s, 6, '#2e3237'], [0, 60, s, 4, '#2e3237']], 0.18);
  }, 2);
  return { floor, wall, hazard, crate, metal };
}

// Monsoon rain: short vertical streaks falling through the roof gaps.
// buildRain returns { points, update(dt) }; drops wrap to the top.
export function buildRain(scene, count = 700) {
  const pos = new Float32Array(count * 6);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * (MAP.w + 4);
    const z = (Math.random() - 0.5) * (MAP.d + 4);
    const y = Math.random() * 14;
    pos.set([x, y, z, x + 0.06, y - 0.55, z], i * 6);
    speed[i] = 9 + Math.random() * 5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.34 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  return {
    lines,
    update(dt) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        let y = p[i * 6 + 1] - speed[i] * dt;
        if (y < 0) { y = 13 + Math.random() * 2; p[i * 6] = (Math.random() - 0.5) * (MAP.w + 4); p[i * 6 + 2] = (Math.random() - 0.5) * (MAP.d + 4); p[i * 6 + 3] = p[i * 6] + 0.06; p[i * 6 + 5] = p[i * 6 + 2]; }
        p[i * 6 + 1] = y; p[i * 6 + 4] = y - 0.55;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

export function buildWorld(scene) {
  const tex = makeTextures();
  const colliders = COLLIDERS; colliders.length = 0; WAYPOINTS.length = 0;
  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.55, metalness: 0.55 }),
    hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xa84e14, roughness: 0.6, emissive: 0x6e2c00, emissiveIntensity: 0.55 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x155e57, roughness: 0.6, emissive: 0x072a27, emissiveIntensity: 0.5 }),
    lampPole: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.7 }),
    lampBulb: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 2.2 }),
    lampPool: new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0.1, depthWrite: false }),
  };
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
    m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
  };
  // --- ground, sky, light: a blackout, not a day shift -------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w + 8, MAP.d + 8), mats.floor);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  scene.fog = new THREE.Fog(0x0a0c10, 22, 70);
  scene.background = new THREE.Color(0x0a0c10);
  // faint cold moonlight only; the lamps do the real lighting
  scene.add(new THREE.HemisphereLight(0x2a3648, 0x0d0b09, 0.32));
  const moon = new THREE.DirectionalLight(0x8fa8c8, 0.22);
  moon.position.set(18, 30, 12); scene.add(moon);
  // glowing furnace mouth on site A, coolant glow on site B (dim in the rain)
  const furnaceGlow = new THREE.PointLight(0xff6a00, 26, 20, 1.8); furnaceGlow.position.set(24, 2.5, -17); scene.add(furnaceGlow);
  const coolGlow = new THREE.PointLight(0x18c8b8, 18, 17, 1.8); coolGlow.position.set(-22, 2.5, 17); scene.add(coolGlow);
  // --- the lamps: warm pools of light, the only clear sightlines ---------
  const lampPoleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8);
  const lampBulbGeo = new THREE.SphereGeometry(0.28, 12, 8);
  const lampPoolGeo = new THREE.CircleGeometry(1, 24);
  for (const l of LAMPS) {
    add(lampPoleGeo, mats.lampPole, l.x, 2.3, l.z);
    const bulb = add(lampBulbGeo, mats.lampBulb, l.x, 4.5, l.z);
    bulb.castShadow = false;
    const light = new THREE.PointLight(0xffb45e, 34, 15, 1.7);
    light.position.set(l.x, 4.3, l.z); scene.add(light);
    const pool = new THREE.Mesh(lampPoolGeo, mats.lampPool);
    pool.rotation.x = -Math.PI / 2; pool.position.set(l.x, 0.03, l.z);
    pool.scale.setScalar(l.r); pool.receiveShadow = false; scene.add(pool);
  }

  // --- perimeter walls ----------------------------------------------------
  const W = MAP.w / 2, D = MAP.d / 2, H = MAP.wallH;
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wall = (w, d, x, z) => { add(wallGeo, mats.wall, x, H / 2, z).scale.set(w, H, d); addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, H); };
  wall(MAP.w + 2, 1, 0, -D - 0.5); wall(MAP.w + 2, 1, 0, D + 0.5);
  wall(1, MAP.d + 2, -W - 0.5, 0); wall(1, MAP.d + 2, W + 0.5, 0);

  // --- interior structure: Mid Hall spine + cross walls with door gaps ---
  // North pipewalk wall (z=-8) with gaps at x=-6 and x=10; south wall (z=8) gaps at x=-10, x=6.
  const seg = (x0, x1, z, h = H) => { if (x1 > x0) { add(wallGeo, mats.wall, (x0 + x1) / 2, h / 2, z).scale.set(x1 - x0, h, 1); addBox(x0, z - 0.5, x1, z + 0.5, h); } };
  seg(-W, -8, -8); seg(-4, 8, -8); seg(12, W, -8);
  seg(-W, -12, 8); seg(-8, 4, 8); seg(8, W, 8);
  // Mid divider (x=0) with gaps at z=-16 and z=16, plus a central pillar block.
  const segZ = (z0, z1, x, h = H) => { if (z1 > z0) { add(wallGeo, mats.wall, x, h / 2, (z0 + z1) / 2).scale.set(1, h, z1 - z0); addBox(x - 0.5, z0, x + 0.5, z1, h); } };
  segZ(-D, -18, 0); segZ(-14, 14, 0); segZ(18, D, 0);

  // --- cover: crates, containers, barrels --------------------------------
  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crate = (x, z, w = 2, h = 2, d = 2, ry = 0) => {
    const m = add(crateGeo, mats.crate, x, h / 2, z, ry); m.scale.set(w, h, d);
    addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h); return m;
  };
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.4, 12);
  const barrel = (x, z, mat = mats.orange) => { add(barrelGeo, mat, x, 0.7, z); addBox(x - 0.55, z - 0.55, x + 0.55, z + 0.55, 1.4); };
  // Mid hall cover (the duel lane)
  crate(-4, -2, 2, 2, 2); crate(-4, 2, 2, 1.2, 2); crate(4, 0, 2.4, 2.4, 2.4, 0.4);
  crate(10, -4, 2, 2, 2); crate(-12, 4, 2, 2, 2);
  // Site A — furnace machinery + crates
  crate(18, -12, 3, 2.6, 2); crate(24, -10, 2, 2, 2); crate(16, -19, 2, 1.4, 2);
  barrel(20, -18); barrel(27, -13, mats.teal);
  const furnace = add(new THREE.BoxGeometry(5, 4.4, 2.4), mats.dark, 27, 2.2, -20);
  furnace.rotation.y = 0.3; addBox(24.5, -21.2, 29.5, -18.8, 4.4);
  add(new THREE.BoxGeometry(3.4, 1.6, 0.4), mats.orange, 25.4, 1.4, -18.9).rotation.y = 0.3;
  // Site B — coolant tanks + containers
  crate(-18, 12, 3, 2.6, 2); crate(-24, 10, 2, 2, 2); crate(-16, 19, 2, 1.4, 2);
  barrel(-20, 18, mats.teal); barrel(-26, 16);
  const tank = add(new THREE.CylinderGeometry(1.8, 1.8, 4.6, 16), mats.teal, -27, 2.3, 20); tank.rotation.z = 0;
  addBox(-28.8, 18.2, -25.2, 21.8, 4.6);
  // Spawn cover + flank containers
  crate(-24, -14, 2.4, 2, 2.4); crate(24, 14, 2.4, 2, 2.4);
  crate(-14, -16, 4, 2.2, 1.6, 0.2); crate(14, 16, 4, 2.2, 1.6, -0.2);
  // Hazard strips marking both sites
  const strip = (x, z, ry) => { const m = add(new THREE.PlaneGeometry(13, 0.9), mats.hazard, x, 0.02, z, ry); m.rotation.x = -Math.PI / 2; m.rotation.z = ry; };
  strip(SITES.A.cx, SITES.A.cz + 6.5, 0); strip(SITES.B.cx, SITES.B.cz - 6.5, 0);
  // Overhead pipes + catwalk beams (visual only, above head height)
  for (const z of [-8, 8]) for (let x = -28; x <= 28; x += 8)
    add(new THREE.CylinderGeometry(0.28, 0.28, 7.6, 8), mats.metal, x, 4.6, z).rotation.z = Math.PI / 2;
  for (const x of [-16, 0, 16]) add(new THREE.BoxGeometry(0.5, 0.4, MAP.d), mats.metal, x, 4.8, 0);

  // --- waypoints: spawn -> lanes -> sites (bots walk this graph) ---------
  const nodes = {};
  const N = (name, x, z, site) => { nodes[name] = wp(x, z, site); };
  N('aSpawn', -28, 0); N('aMid', -14, 0); N('aNorth', -14, -14); N('aSouth', -14, 14);
  N('midW', -6, 0); N('mid', 0, 0); N('midE', 6, 0);
  N('bNorth', 10, -14); N('bSouth', 10, 14); N('bMid', 14, 0);
  N('uSpawn', 28, 0); N('uNorth', 22, -14); N('uSouth', 22, 14);
  N('siteA', 22, -15, 'A'); N('siteB', -20, 15, 'B');
  N('aGateN', -6, -8); N('aGateS', -6, 8); N('bGateN', 10, -8); N('bGateS', 6, 8);
  const edges = [['aSpawn', 'aMid'], ['aMid', 'aNorth'], ['aMid', 'aSouth'], ['aMid', 'midW'],
    ['aNorth', 'aGateN'], ['aSouth', 'aGateS'], ['midW', 'mid'], ['mid', 'midE'],
    ['aGateN', 'bNorth'], ['aGateS', 'bSouth'], ['bNorth', 'siteA'], ['bNorth', 'midE'],
    ['bSouth', 'siteB'], ['bSouth', 'midE'], ['midE', 'bMid'], ['bMid', 'uSpawn'],
    ['bNorth', 'uNorth'], ['bSouth', 'uSouth'], ['uNorth', 'uSpawn'], ['uSouth', 'uSpawn'],
    ['uNorth', 'siteA'], ['uSouth', 'siteB'], ['mid', 'aGateN'], ['mid', 'aGateS']];
  const adj = WAYPOINTS.map(() => []);
  for (const [a, b] of edges) { adj[nodes[a]].push(nodes[b]); adj[nodes[b]].push(nodes[a]); }
  return { colliders, waypoints: WAYPOINTS, adj, sites: SITES, spawns: SPAWNS, nodes, lamps: LAMPS };
}

// Circle (radius r) vs AABB collision: push a position out of solids.
export function collide(pos, r, y = 0) {
  for (const c of COLLIDERS) {
    if (y > c.h) continue;
    const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
    const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - nx, dz = pos.z - nz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = nx + dx / d * r; pos.z = nz + dz / d * r; }
      else { // centre inside: push out along the smallest penetration axis
        const pl = pos.x - c.x0, pr = c.x1 - pos.x, pt = pos.z - c.z0, pb = c.z1 - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.x0 - r; else if (m === pr) pos.x = c.x1 + r;
        else if (m === pt) pos.z = c.z0 - r; else pos.z = c.z1 + r;
      }
    }
  }
  pos.x = Math.max(-MAP.w / 2 + r, Math.min(MAP.w / 2 - r, pos.x));
  pos.z = Math.max(-MAP.d / 2 + r, Math.min(MAP.d / 2 - r, pos.z));
}

// Segment (ray) vs AABB: distance to first solid hit, or Infinity.
export function rayWalls(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of COLLIDERS) {
    let t0 = 0, t1 = best, ok = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [c.x0, 0, c.z0], mx = [c.x1, c.h, c.z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } }
      else {
        let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 < best && t0 >= 0) best = t0;
  }
  return best;
}

export function dist2D(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
