// bots.js — bot teammates and opponents for KILNLIGHT. Each bot is a simple
// articulated figure (body, head, visor, gun) in its team colour, driven by a
// small state machine: BUY -> PUSH (walk the waypoint graph to a site) ->
// FIGHT (strafe, burst-fire with aim error that grows with range and
// movement) -> PLANT / DEFUSE / HUNT when the round demands it. Bots never
// see through walls: a shot needs a clear ray, and their reaction time and
// spread keep duels fair — a still, aiming player out-shoots them.
//
// THE TWIST — lamplight vision and the hearing bus: in the monsoon blackout
// a bot only spots a fighter far away when that fighter stands in a lamp
// pool (vision 55 m); in the dark the same fighter is only seen within
// 24 m. And bots HEAR: every footstep and gunshot is a noise event on
// game.noises with a radius — rain masks footsteps to a 5 m whisper, while
// a gunshot rings out to 45 m and gives the shooter away. Sneak in the dark,
// fight in the light, and mind the noise you make.
import * as THREE from 'three';
import { collide, rayWalls, dist2D, inLamplight } from './world.js';
import { WEAPONS, damageAt, ARMOR_REDUCTION } from './weapons.js';

export const BOT_NAMES = {
  aurora: ['Vex', 'Mira', 'Sol'],
  umbra: ['Rook', 'Nyx', 'Hale', 'Onyx'],
};
// Vision in the blackout: how far a bot can spot a fighter standing in a
// lamp pool vs one hiding in the dark between the lamps.
export const VISION_LIT = 55;
export const VISION_DARK = 24;
const TEAM_COLOR = { aurora: 0xf08a1e, umbra: 0x2e7fd8 };
const SKILL = { reaction: [0.45, 0.9], aimErr: 1.6, burst: [3, 6], pause: [0.5, 1.1] };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildBotMesh(team) {
  const g = new THREE.Group();
  const col = TEAM_COLOR[team];
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.32), bodyMat);
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.38), darkMat);
  vest.position.y = 1.15; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), darkMat);
  head.position.y = 1.68; head.castShadow = true; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: team === 'aurora' ? 0xffc46a : 0x7ac4ff, emissive: team === 'aurora' ? 0xcc6600 : 0x0055aa, emissiveIntensity: 0.9 }));
  visor.position.set(0, 1.7, 0.18); g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.2), darkMat); legL.position.set(-0.14, 0.31, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
  gun.position.set(0.28, 1.25, 0.35); g.add(gun);
  g.userData = { head, gun, legL, legR, body };
  return g;
}

export class Bot {
  constructor(team, name, spawn, rng, weaponId) {
    this.team = team; this.name = name; this.rng = rng;
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.yaw = team === 'aurora' ? 0 : Math.PI;
    this.hp = 100; this.armor = 0; this.alive = true;
    this.weaponId = weaponId || (rng() < 0.6 ? 'longshot' : 'hornet');
    this.ammo = WEAPONS[this.weaponId].mag; this.reserve = WEAPONS[this.weaponId].reserve;
    this.state = 'push'; this.targetWp = -1; this.path = [];
    this.enemy = null; this.lastSeen = 0; this.reaction = 0;
    this.burstLeft = 0; this.burstPause = 0; this.fireTimer = 0; this.reloadTimer = 0;
    this.strafeDir = 1; this.strafeTimer = 0; this.walkPhase = rng() * 6;
    this.plantTimer = 0; this.defuseTimer = 0; this.hasSpike = false;
    this.speed = 4.2;
    this.mesh = buildBotMesh(team);
    this.mesh.position.copy(this.pos);
    this.flash = null; // muzzle flash light, set by game
  }
  get weapon() { return WEAPONS[this.weaponId]; }
  eye() { return new THREE.Vector3(this.pos.x, 1.62, this.pos.z); }
  reset(spawn, weaponId) {
    this.pos.set(spawn[0], 0, spawn[1]); this.hp = 100; this.alive = true;
    this.weaponId = weaponId; this.ammo = WEAPONS[weaponId].mag; this.reserve = WEAPONS[weaponId].reserve;
    this.state = 'push'; this.path = []; this.enemy = null; this.plantTimer = 0; this.defuseTimer = 0;
    this.mesh.visible = true; this.mesh.position.copy(this.pos);
  }
  takeDamage(amount, head) {
    let dmg = amount;
    if (this.armor > 0) { const absorbed = Math.min(this.armor, dmg * ARMOR_REDUCTION); this.armor -= absorbed; dmg -= absorbed; }
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.mesh.visible = false; }
    return this.alive;
  }
}

// Breadth-first path on the waypoint graph.
export function findPath(adj, from, to) {
  if (from === to) return [to];
  const prev = new Array(adj.length).fill(-1); const q = [from]; prev[from] = from;
  while (q.length) {
    const n = q.shift();
    for (const m of adj[n]) if (prev[m] === -1) { prev[m] = n; if (m === to) { const p = [to]; let c = to; while (c !== from) { c = prev[c]; p.unshift(c); } return p; } q.push(m); }
  }
  return [to];
}
export function nearestWp(waypoints, x, z) {
  let best = 0, bd = Infinity;
  waypoints.forEach((w, i) => { const d = (w.x - x) ** 2 + (w.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
export function hasLineOfSight(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  return rayWalls(from.x, from.y, from.z, dx / dist, dy / dist, dz / dist, dist - 0.05) >= dist - 0.05;
}
// How far this bot can spot a fighter at (x, z): full range in a lamp pool,
// short range in the dark. This is the lamplight half of the twist.
export function visionRange(x, z) { return inLamplight(x, z) ? VISION_LIT : VISION_DARK; }

// One bot tick. `game` is the live match object (see main.js): it carries
// player, bots, world, time, noises (the hearing bus) and the callbacks
// fireShot / onKill / onPlant.
export function updateBot(bot, dt, game) {
  if (!bot.alive) return;
  const now = game.time;
  bot.walkPhase += dt * 6;
  const ud = bot.mesh.userData;
  ud.legL.rotation.x = Math.sin(bot.walkPhase) * 0.4;
  ud.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.4;

  // --- pick nearest visible enemy (player counts if on the other team) ---
  // Vision is lamplight-limited: a fighter in the dark must be close.
  let best = null, bestD = Infinity;
  const candidates = [];
  if (bot.team === 'umbra') candidates.push(game.player);
  for (const b of game.bots) if (b.team !== bot.team && b.alive) candidates.push(b);
  for (const c of candidates) {
    const d = dist2D(bot.pos.x, bot.pos.z, c.pos.x, c.pos.z);
    if (d >= visionRange(c.pos.x, c.pos.z)) continue;
    if (d < bestD && hasLineOfSight(bot.eye(), c.eye ? c.eye() : new THREE.Vector3(c.pos.x, 1.5, c.pos.z))) { best = c; bestD = d; }
  }
  // --- hearing bus: a noise inside its radius betrays the maker's position
  // even with no line of sight. Rain masks footsteps (tiny radius); a
  // gunshot is loud (big radius). A heard enemy is fought, not just noted.
  if (!best && game.noises) {
    for (const n of game.noises) {
      if (now > n.until) continue;
      const d = dist2D(bot.pos.x, bot.pos.z, n.x, n.z);
      if (d < n.radius) {
        const heard = n.maker === game.player ? game.player : game.bots.find(b => b === n.maker && b.team !== bot.team && b.alive);
        if (heard && (!heard.alive || heard === game.player ? game.player.alive : true)) { best = heard; bestD = d; break; }
      }
    }
  }
  if (best) { if (bot.enemy !== best) { bot.reaction = now + SKILL.reaction[0] + bot.rng() * (SKILL.reaction[1] - SKILL.reaction[0]); } bot.enemy = best; bot.lastSeen = now; }
  else if (now - bot.lastSeen > 1.2) bot.enemy = null;

  // --- objective states override movement ---
  if (game.spike.planted && bot.team === 'aurora' && bot.state !== 'defuse') {
    const siteWp = game.world.nodes['site' + game.spike.site];
    if (dist2D(bot.pos.x, bot.pos.z, game.world.waypoints[siteWp].x, game.world.waypoints[siteWp].z) < 1.6) bot.state = 'defuse';
    else bot.state = 'hunt';
  }
  if (bot.hasSpike && !game.spike.planted && bot.state === 'push') {
    const site = game.spike.targetSite;
    const siteWp = game.world.nodes['site' + site];
    if (dist2D(bot.pos.x, bot.pos.z, game.world.waypoints[siteWp].x, game.world.waypoints[siteWp].z) < 2.2) bot.state = 'plant';
  }

  // --- movement ---
  let moveX = 0, moveZ = 0, moving = false;
  if (bot.state === 'plant') {
    bot.plantTimer += dt;
    if (bot.plantTimer > 4) { game.plantSpike(bot); bot.state = 'push'; }
  } else if (bot.state === 'defuse') {
    bot.defuseTimer += dt;
    if (bot.defuseTimer > 5) { game.defuseSpike(bot); bot.state = 'push'; }
  } else if (bot.enemy && bestD < 26) {
    // fight: strafe sideways, keep distance, face the enemy
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) { bot.strafeDir *= bot.rng() < 0.5 ? -1 : 1; bot.strafeTimer = 0.7 + bot.rng() * 0.9; }
    const ex = bot.enemy.pos.x - bot.pos.x, ez = bot.enemy.pos.z - bot.pos.z;
    const len = Math.hypot(ex, ez) || 1;
    moveX = (-ez / len) * bot.strafeDir * 0.8 + (bestD > 18 ? ex / len * 0.6 : bestD < 7 ? -ex / len * 0.6 : 0);
    moveZ = (ex / len) * bot.strafeDir * 0.8 + (bestD > 18 ? ez / len * 0.6 : bestD < 7 ? -ez / len * 0.6 : 0);
    moving = true;
  } else {
    // push: follow the waypoint path to the chosen site
    if (!bot.path.length) {
      const target = bot.team === 'umbra'
        ? game.world.nodes['site' + (game.spike.targetSite || 'A')]
        : (game.spike.planted ? game.world.nodes['site' + game.spike.site] : game.world.nodes['mid']);
      bot.path = findPath(game.world.adj, nearestWp(game.world.waypoints, bot.pos.x, bot.pos.z), target);
    }
    const wpNode = game.world.waypoints[bot.path[0]];
    if (wpNode) {
      const dx = wpNode.x - bot.pos.x, dz = wpNode.z - bot.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.2) bot.path.shift();
      else { moveX = dx / d; moveZ = dz / d; moving = true; }
    }
  }
  if (moving) {
    const sp = bot.speed * (bot.enemy ? 0.55 : 1);
    bot.pos.x += moveX * sp * dt; bot.pos.z += moveZ * sp * dt;
    collide(bot.pos, 0.45);
  }
  // face movement or enemy
  const faceX = bot.enemy ? bot.enemy.pos.x - bot.pos.x : moveX;
  const faceZ = bot.enemy ? bot.enemy.pos.z - bot.pos.z : moveZ;
  if (faceX || faceZ) {
    const want = Math.atan2(faceX, faceZ);
    let diff = want - bot.yaw; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  }
  bot.mesh.position.copy(bot.pos); bot.mesh.rotation.y = bot.yaw;

  // --- firing ---
  if (bot.reloadTimer > 0) { bot.reloadTimer -= dt; if (bot.reloadTimer <= 0) { bot.ammo = bot.weapon.mag; bot.reserve -= bot.weapon.mag; } }
  else if (bot.enemy && now >= bot.reaction && bestD < 55) {
    bot.fireTimer -= dt;
    if (bot.burstLeft <= 0) { bot.burstPause -= dt; if (bot.burstPause <= 0) { bot.burstLeft = SKILL.burst[0] + (bot.rng() * (SKILL.burst[1] - SKILL.burst[0]) | 0); bot.burstPause = SKILL.pause[0] + bot.rng() * (SKILL.pause[1] - SKILL.pause[0]); } }
    if (bot.burstLeft > 0 && bot.fireTimer <= 0) {
      bot.fireTimer = 60 / bot.weapon.rpm;
      bot.burstLeft--;
      if (bot.ammo <= 0) { bot.reloadTimer = bot.weapon.reload; }
      else {
        bot.ammo--;
        const err = (SKILL.aimErr + bestD * 0.045 + (moving ? 1.1 : 0)) * Math.PI / 180;
        game.botShoot(bot, err);
      }
    }
  }
}
