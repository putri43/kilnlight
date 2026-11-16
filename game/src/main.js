// main.js — KILNLIGHT. Entry point of the game.
// A complete round-based tactical FPS in three.js: two 4-player teams, a
// spike objective at two sites, an economy with a buy phase, bots with
// waypoint navigation and fair aim, recoil/spread gunplay where accuracy
// counts more than speed, and a HUD with health, ammo, timer, score,
// kill feed and a live minimap. No network, no build step, no assets:
// geometry is procedural and sound is synthesized (see audio.js).
//
// THE TWIST — fight by lamplight while monsoon rain hides every footstep.
// The foundry is blacked out (see world.js: LAMPS, inLamplight, buildRain).
// Two systems make the twist real: (1) LAMPLIGHT VISION — bots spot a
// fighter at 55 m in a lamp pool but only 24 m in the dark, and the HUD
// tells you which you are; (2) THE HEARING BUS — every footstep and gunshot
// is a noise event with a radius (game.noises). Rain masks footsteps to a
// 5 m whisper, so you can sneak the dark lanes; a gunshot rings out to
// 45 m and gives you away. Stand in the light to fight, in the dark to move.
import * as THREE from 'three';
import { buildWorld, buildRain, inLamplight, collide, rayWalls, dist2D, MAP } from './world.js';
import { Bot, updateBot, nearestWp, hasLineOfSight } from './bots.js';
import { BOT_NAMES } from './bots.js';
import { WEAPONS, WEAPON_LIST, makeLoadout, buyWeapon, buyArmor, damageAt, ARMOR_REDUCTION } from './weapons.js';
import { SoundBank } from './audio.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | buy | end — staged screenshot mode
const SEED = Number(params.get('seed') || 7);
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED * 2654435761);

const WIN_SCORE = 5, MAX_ROUNDS = 9, ROUND_TIME = 100, BUY_TIME = 15, PLANT_TIME = 40;
// Hearing bus radii (metres): rain masks footsteps; gunfire gives you away.
const NOISE_STEP = 5, NOISE_STEP_CROUCH = 3, NOISE_STEP_SPRINT = 9, NOISE_SHOT = 45;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
const world = buildWorld(scene);
const rain = buildRain(scene);
const hud = new Hud(document);
const sfx = new SoundBank();

// ---------- player ----------
const player = {
  pos: new THREE.Vector3(-28, 0, 0), yaw: -Math.PI / 2, pitch: 0, vel: new THREE.Vector3(),
  hp: 100, armor: 0, alive: true, money: 800, loadout: makeLoadout(),
  onGround: true, crouch: false, ads: false, sprint: false,
  recoil: 0, bloom: 0, lastShot: 0, reloading: false, reloadEnd: 0,
  keys: {}, spectating: null,
};
player.pos.set(...world.spawns.aurora[0], 0);
const EYE = 1.62;

// viewmodel gun (procedural, attached to the camera)
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.4, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.55), dark); gun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.4); gun.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.12), accent); sight.position.set(0, 0.09, -0.05); gun.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark); grip.position.set(0, -0.13, 0.12); grip.rotation.x = 0.3; gun.add(grip);
  gun.position.set(0.28, -0.24, -0.5);
  camera.add(gun); scene.add(camera);
}
const muzzleLight = new THREE.PointLight(0xffc46a, 0, 9, 2); muzzleLight.position.set(0.28, -0.2, -0.9); camera.add(muzzleLight);

// tracers + impact sparks, pooled
const tracers = [];
function addTracer(from, to, color) {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line); tracers.push({ line, life: 0.09 });
}
const sparks = [];
// Soft round sprite so impact sparks read as sparks, not hard squares,
// even when one spawns right in front of the camera (e.g. when the player
// is hit — the hit point is at the player's own body).
const sparkTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,220,150,0.8)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function addSparks(p, n = 10, color = 0xffc46a) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) { pos.set([p.x, p.y, p.z], i * 3); vel.push(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.09, map: sparkTexture, transparent: true, depthWrite: false }));
  scene.add(pts); sparks.push({ pts, vel, life: 0.4 });
}

// ---------- match state ----------
const game = {
  time: 0, phase: 'menu', round: 1, scoreA: 0, scoreU: 0,
  timer: BUY_TIME, bots: [], player,
  noises: [], // hearing bus: {x, z, radius, maker, until}
  spike: { carrier: null, targetSite: 'A', planted: false, site: null, x: 0, z: 0, timer: 0, defuse: 0 },
  world, rng,
};
// A noise event on the hearing bus: bots inside its radius hear the maker.
game.emitNoise = (x, z, radius, maker) => {
  game.noises.push({ x, z, radius, maker, until: game.time + 0.6 });
};
game.plantSpike = (bot) => {
  const s = game.spike; s.planted = true; s.site = s.targetSite; s.timer = PLANT_TIME; s.defuse = 0;
  const site = world.sites[s.site]; s.x = site.cx; s.z = site.cz;
  bot.hasSpike = false;
  hud.banner('SPIKE PLANTED — ' + site.name, 'Aurora: defuse it before it blows', 3200);
  hud.setSpike('◆ SPIKE PLANTED AT SITE ' + s.site + ' — DEFUSE IT');
  sfx.plantBeep();
};
game.defuseSpike = (bot) => {
  game.spike.planted = false; game.spike.defuse = 0;
  endRound('aurora', 'Spike defused');
};
game.botShoot = (bot, err) => shootFrom(bot, err, false);

function spawnBots() {
  for (const b of game.bots) scene.remove(b.mesh);
  game.bots = [];
  const used = { aurora: [...BOT_NAMES.aurora], umbra: [...BOT_NAMES.umbra] };
  world.spawns.aurora.slice(1).forEach((s, i) => {
    const b = new Bot('aurora', used.aurora[i], s, rng, rng() < 0.7 ? 'longshot' : 'hornet');
    game.bots.push(b); scene.add(b.mesh);
  });
  world.spawns.umbra.forEach((s, i) => {
    const b = new Bot('umbra', used.umbra[i], s, rng, rng() < 0.65 ? 'longshot' : 'hornet');
    game.bots.push(b); scene.add(b.mesh);
  });
  // spike carrier: a random living Umbra bot; target site chosen per round
  const carrier = game.bots.filter(b => b.team === 'umbra')[Math.floor(rng() * 4)];
  carrier.hasSpike = true; game.spike.carrier = carrier;
  game.spike.targetSite = rng() < 0.5 ? 'A' : 'B';
  game.spike.planted = false; game.spike.defuse = 0;
}

function startRound() {
  game.round = game.round; game.phase = 'buy'; game.timer = BUY_TIME;
  player.hp = 100; player.alive = true; player.spectating = null;
  player.pos.set(world.spawns.aurora[0][0], 0, world.spawns.aurora[0][1]);
  player.yaw = -Math.PI / 2; player.pitch = 0; player.recoil = 0; player.bloom = 0;
  player.loadout.weapons.warden = player.loadout.weapons.warden || { mag: 12, reserve: 36 };
  spawnBots();
  hud.showMenu(false); hud.showEnd(false); hud.closeBuy();
  hud.setSpike('Spike target: Site ' + game.spike.targetSite + ' (' + world.sites[game.spike.targetSite].name + ')');
  hud.banner('ROUND ' + game.round, 'Buy phase — spend your $' + player.money, 2200);
  hud.openBuy(player.loadout, player.money, onBuy);
  updateHud();
}

function endRound(winner, reason) {
  if (game.phase === 'over') return;
  game.phase = 'roundEnd'; game.timer = 4;
  if (winner === 'aurora') { game.scoreA++; player.money += 3250; }
  else { game.scoreU++; player.money += 1900; }
  hud.banner(winner === 'aurora' ? 'AURORA WINS THE ROUND' : 'UMBRA WINS THE ROUND', reason, 3200);
  hud.setSpike('');
  if (winner === 'aurora') sfx.roundWin(); else sfx.roundLose();
  if (game.spike.planted && winner === 'umbra') { sfx.explosion(); }
  updateHud();
}
function endMatch() {
  game.phase = 'over';
  const win = game.scoreA > game.scoreU;
  hud.showEnd(true, win ? 'AURORA WINS THE MATCH' : 'UMBRA WINS THE MATCH',
    `Final score ${game.scoreA} — ${game.scoreU} after ${game.round} rounds in the Kilnworks blackout. ` +
    (win ? 'The rain hid every step that mattered.' : 'Umbra held the lamps.'));
  document.exitPointerLock?.();
}

// ---------- combat ----------
// Ray vs a fighter's body/head spheres; returns {dist, head, target} or null.
function rayHitFighter(origin, dir, maxDist, target, exclude) {
  if (!target.alive || target === exclude) return null;
  const cx = target.pos.x, cz = target.pos.z;
  const spheres = [
    { c: new THREE.Vector3(cx, 1.68, cz), r: 0.24, head: true },
    { c: new THREE.Vector3(cx, 1.05, cz), r: 0.5, head: false },
    { c: new THREE.Vector3(cx, 0.4, cz), r: 0.42, head: false },
  ];
  let best = null;
  for (const s of spheres) {
    const oc = new THREE.Vector3().subVectors(s.c, origin);
    const tca = oc.dot(dir); if (tca < 0) continue;
    const d2 = oc.lengthSq() - tca * tca; if (d2 > s.r * s.r) continue;
    const t = tca - Math.sqrt(s.r * s.r - d2);
    if (t < maxDist && (!best || t < best.dist)) best = { dist: t, head: s.head, target };
  }
  return best;
}
function resolveShot(origin, dir, shooter, weapon, pellets, spreadRad) {
  let hitAny = false;
  for (let p = 0; p < pellets; p++) {
    const d = dir.clone();
    if (spreadRad > 0) {
      d.x += (Math.random() - 0.5) * 2 * spreadRad; d.y += (Math.random() - 0.5) * 2 * spreadRad; d.z += (Math.random() - 0.5) * 2 * spreadRad;
      d.normalize();
    }
    const wallDist = rayWalls(origin.x, origin.y, origin.z, d.x, d.y, d.z, 120);
    let best = null;
    const targets = shooter === player ? game.bots : [player, ...game.bots];
    for (const t of targets) {
      if (t === shooter) continue;
      if (t !== player && shooter === player && t.team === 'aurora') continue; // no friendly fire
      if (t !== player && shooter !== player && t.team === shooter.team) continue;
      const h = rayHitFighter(origin, d, wallDist, t, shooter);
      if (h && (!best || h.dist < best.dist)) best = h;
    }
    const end = origin.clone().addScaledVector(d, best ? best.dist : Math.min(wallDist, 120));
    addTracer(origin.clone().addScaledVector(d, 0.6), end, weapon.tracer);
    if (best) {
      hitAny = true;
      const dmg = damageAt(weapon, best.dist, best.head);
      addSparks(end, 8, best.head ? 0xffd27a : 0xff6a4a);
      damageFighter(best.target, dmg, best.head, shooter);
    } else if (wallDist < 120) addSparks(end, 5, 0xcfd6dd);
  }
  return hitAny;
}
function damageFighter(target, dmg, head, shooter) {
  const isPlayer = target === player;
  const before = target.hp;
  if (isPlayer) {
    let d = dmg;
    if (player.armor > 0) { const ab = Math.min(player.armor, d * ARMOR_REDUCTION); player.armor -= ab; d -= ab; }
    player.hp -= d; sfx.hurt();
    const ang = Math.atan2(shooter.pos.x - player.pos.x, shooter.pos.z - player.pos.z);
    hud.damageFrom((ang * 180 / Math.PI + 180) % 360);
    if (player.hp <= 0) { player.hp = 0; player.alive = false; killFeed(shooter, player, head); }
  } else {
    const alive = target.takeDamage(dmg, head);
    if (!alive) killFeed(shooter, target, head);
  }
  if (shooter === player) {
    hud.showHitmarker(!target.alive, head);
    if (head) sfx.hit(true); else sfx.hit(false);
    if (!target.alive) { player.money += 300; sfx.kill(); }
  }
  if (shooter && shooter !== player && target === player && before > 0) { /* bot feedback */ }
  updateHud();
}
function killFeed(killer, victim, head) {
  const kn = killer === player ? 'You' : killer.name;
  const vn = victim === player ? 'You' : victim.name;
  hud.killfeed(kn, vn, head, killer === player || killer.team === 'aurora' ? 'aurora' : 'umbra');
}
function shootFrom(shooter, errRad, isPlayerShot) {
  const w = shooter === player ? WEAPONS[player.loadout.current] : shooter.weapon;
  const origin = shooter === player
    ? camera.position.clone()
    : new THREE.Vector3(shooter.pos.x, 1.55, shooter.pos.z);
  let dir;
  if (shooter === player) {
    dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  } else {
    const t = shooter.enemy;
    const tp = t === player ? new THREE.Vector3(player.pos.x, 1.35, player.pos.z) : new THREE.Vector3(t.pos.x, 1.35, t.pos.z);
    dir = tp.sub(origin).normalize();
  }
  // muzzle flash + sound (distant for far bots)
  if (shooter === player) { muzzleLight.intensity = 14; setTimeout(() => muzzleLight.intensity = 0, 50); }
  const dist = shooter === player ? 0 : dist2D(shooter.pos.x, shooter.pos.z, player.pos.x, player.pos.z);
  sfx.shot(w.kind, shooter !== player && dist > 12);
  // gunfire is loud on the hearing bus: it gives the shooter away
  game.emitNoise(shooter.pos.x, shooter.pos.z, NOISE_SHOT, shooter);
  const spread = (w.spread + (shooter === player ? player.bloom : 0)) * Math.PI / 180;
  resolveShot(origin, dir, shooter, w, w.pellets || 1, Math.max(spread, errRad || 0));
}
function playerShoot() {
  if (!player.alive || game.phase !== 'play' && game.phase !== 'planted') return;
  const w = WEAPONS[player.loadout.current];
  const st = player.loadout.weapons[player.loadout.current];
  const now = game.time;
  if (now - player.lastShot < 60 / w.rpm) return;
  if (player.reloading) return;
  if (st.mag <= 0) { sfx.dryFire(); startReload(); return; }
  player.lastShot = now; st.mag--;
  player.recoil = Math.min(2.2, player.recoil + w.recoil * 0.35);
  player.bloom = Math.min(3.2, player.bloom + w.recoil * 0.5);
  player.pitch += w.recoil * 0.004; // kick up
  shootFrom(player, 0, true);
  updateHud();
}
function startReload() {
  const w = WEAPONS[player.loadout.current], st = player.loadout.weapons[player.loadout.current];
  if (player.reloading || st.mag === w.mag || st.reserve <= 0) return;
  player.reloading = true; player.reloadEnd = game.time + w.reload; sfx.reload();
}
function finishReload() {
  const w = WEAPONS[player.loadout.current], st = player.loadout.weapons[player.loadout.current];
  const need = w.mag - st.mag, take = Math.min(need, st.reserve);
  st.mag += take; st.reserve -= take; player.reloading = false; updateHud();
}

// ---------- input ----------
const canvas = renderer.domElement;
addEventListener('keydown', (e) => {
  player.keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyB' && game.phase === 'buy') hud.openBuy(player.loadout, player.money, onBuy);
  if (e.code.startsWith('Digit')) {
    const w = WEAPON_LIST.find(x => x.slot === Number(e.code.slice(5)));
    if (w && player.loadout.weapons[w.id]) { player.loadout.current = w.id; updateHud(); }
  }
  if (e.code === 'KeyM') sfx.muted = !sfx.muted;
});
addEventListener('keyup', (e) => { player.keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !player.alive) return;
  const sens = player.ads ? 0.0011 : 0.0021;
  player.yaw -= e.movementX * sens;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * sens));
});
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) { if (game.phase !== 'menu') lockPointer(); return; }
  if (e.button === 0) player.firing = true;
  if (e.button === 2) player.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) player.firing = false; if (e.button === 2) player.ads = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function lockPointer() { sfx.ensure(); sfx.startRain(); canvas.requestPointerLock(); }
document.getElementById('play').addEventListener('click', () => {
  sfx.ensure(); sfx.startRain(); sfx.click();
  hud.showMenu(false);
  if (game.phase === 'menu') { game.phase = 'buy'; game.timer = BUY_TIME; hud.openBuy(player.loadout, player.money, onBuy); }
  lockPointer();
});
function onBuy(kind, id) {
  if (kind === 'weapon') { const before = player.money; player.money = buyWeapon(player.loadout, id, player.money); if (player.money !== before) sfx.buy(); }
  else { const before = player.money; player.money = buyArmor(player.loadout, player.money); if (player.money !== before) sfx.buy(); }
  player.armor = player.loadout.armor;
  hud.setMoney(player.money);
  hud.openBuy(player.loadout, player.money, onBuy);
  updateHud();
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- HUD sync ----------
function updateHud() {
  const w = WEAPONS[player.loadout.current], st = player.loadout.weapons[player.loadout.current];
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(st.mag, st.reserve, player.reloading);
  hud.setMoney(player.money);
  hud.setScore(game.scoreA, game.scoreU, game.round);
  hud.setAlive(game.bots.filter(b => b.team === 'aurora' && b.alive).length + (player.alive ? 1 : 0),
    game.bots.filter(b => b.team === 'umbra' && b.alive).length);
  hud.setTimer(game.timer, game.phase);
  hud.setLampStatus(inLamplight(player.pos.x, player.pos.z));
  const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5;
  const spreadPx = 4 + player.bloom * 3 + (moving ? 5 : 0) + (player.crouch ? -2 : 0);
  hud.setCrosshair(Math.max(2, spreadPx), player.ads);
}

// ---------- per-frame ----------
const clock = new THREE.Clock();
let stepTimer = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  game.time += dt;
  const k = player.keys;
  rain.update(dt);
  // hearing bus: drop expired noises
  if (game.noises.length && game.time > game.noises[0].until) game.noises = game.noises.filter(n => game.time <= n.until);

  // phase timers
  if (game.phase === 'buy') {
    game.timer -= dt;
    if (game.timer <= 0) { game.phase = 'play'; game.timer = ROUND_TIME; hud.closeBuy(); hud.banner('GO — ' + (game.spike.targetSite === 'A' ? 'FURNACE' : 'COOLING YARD'), 'Umbra is pushing Site ' + game.spike.targetSite, 1800); }
  } else if (game.phase === 'play' || game.phase === 'planted') {
    game.timer -= dt;
    if (game.spike.planted) {
      game.phase = 'planted'; game.spike.timer -= dt; game.timer = game.spike.timer;
      if (game.timer <= 0) endRound('umbra', 'Spike detonated at Site ' + game.spike.site);
    } else if (game.timer <= 0) endRound('umbra', 'Time expired — Umbra held the sites');
    // defuse channel: any living Aurora fighter inside the planted site
    if (game.spike.planted) {
      const site = world.sites[game.spike.site];
      const inSite = (x, z) => dist2D(x, z, site.cx, site.cz) < site.r;
      let channel = player.alive && inSite(player.pos.x, player.pos.z);
      for (const b of game.bots) if (b.team === 'aurora' && b.alive && inSite(b.pos.x, b.pos.z)) channel = true;
      if (channel) {
        game.spike.defuse += dt;
        hud.setSpike('◆ DEFUSING… ' + Math.ceil(5 - game.spike.defuse) + 's — stay in the site');
        if (game.spike.defuse >= 5) { game.spike.planted = false; endRound('aurora', 'Spike defused'); }
      } else { game.spike.defuse = Math.max(0, game.spike.defuse - dt * 2); }
    }
  } else if (game.phase === 'roundEnd') {
    game.timer -= dt;
    if (game.timer <= 0) {
      if (game.scoreA >= WIN_SCORE || game.scoreU >= WIN_SCORE || game.round >= MAX_ROUNDS) endMatch();
      else { game.round++; startRound(); }
    }
  }

  // player movement (only while alive and round is live)
  const canMove = player.alive && (game.phase === 'play' || game.phase === 'planted' || game.phase === 'buy');
  player.crouch = !!(k['ControlLeft'] || k['KeyC']);
  player.sprint = !!(k['ShiftLeft'] || k['ShiftRight']) && !player.crouch && !player.ads;
  const w = WEAPONS[player.loadout.current];
  const speed = (player.crouch ? 2.2 : player.sprint ? 6.8 : 4.6) * w.speed * (player.ads ? 0.55 : 1);
  let mx = 0, mz = 0;
  if (canMove) {
    if (k['KeyW']) mz -= 1; if (k['KeyS']) mz += 1;
    if (k['KeyA']) mx -= 1; if (k['KeyD']) mx += 1;
  }
  const len = Math.hypot(mx, mz) || 1; mx /= len; mz /= len;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const vx = (mx * cos + mz * sin) * speed, vz = (-mx * sin + mz * cos) * speed;
  player.vel.x += (vx - player.vel.x) * Math.min(1, dt * 12);
  player.vel.z += (vz - player.vel.z) * Math.min(1, dt * 12);
  player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt;
  collide(player.pos, 0.45);
  // jump / gravity (simple: eye height is fixed, jump is a vertical hop)
  if (k['Space'] && player.onGround && canMove) { player.vy = 5.2; player.onGround = false; }
  player.vy = (player.vy || 0) - 14 * dt;
  player.pos.y = Math.max(0, (player.pos.y || 0) + (player.vy || 0) * dt);
  if (player.pos.y === 0) { player.onGround = true; player.vy = 0; }
  // footsteps: rain masks them — a masked step is a whisper on the hearing bus
  if (Math.hypot(player.vel.x, player.vel.z) > 2) {
    stepTimer -= dt;
    if (stepTimer <= 0) {
      sfx.step(true);
      const radius = player.crouch ? NOISE_STEP_CROUCH : player.sprint ? NOISE_STEP_SPRINT : NOISE_STEP;
      game.emitNoise(player.pos.x, player.pos.z, radius, player);
      stepTimer = 0.38;
    }
  }
  // recoil / bloom recovery
  player.recoil = Math.max(0, player.recoil - dt * 3.2);
  player.bloom = Math.max(0, player.bloom - dt * 2.4);
  if (player.reloading && game.time >= player.reloadEnd) finishReload();
  if (player.firing && document.pointerLockElement === canvas) playerShoot();
  else if (player.firing && SHOT === 'play') playerShoot();

  // camera: player eye, or spectator follow after death (staged 'start' shot keeps its fixed camera)
  if (SHOT === 'start') {
    // staged overview camera, left alone
  } else if (player.alive) {
    const eyeH = EYE - (player.crouch ? 0.45 : 0) + (player.pos.y || 0);
    camera.position.set(player.pos.x, eyeH, player.pos.z);
    camera.rotation.set(player.pitch + player.recoil * 0.012, player.yaw, 0);
    camera.fov += ((player.ads ? 74 / w.zoom : 74) - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  } else if (!player.spectating || !player.spectating.alive) {
    player.spectating = game.bots.find(b => b.team === 'aurora' && b.alive) || null;
  }
  if (!player.alive && player.spectating) {
    const b = player.spectating;
    camera.position.set(b.pos.x - Math.sin(b.yaw) * 3, 2.6, b.pos.z - Math.cos(b.yaw) * 3);
    camera.lookAt(b.pos.x, 1.4, b.pos.z);
  }

  // viewmodel bob + recoil + ADS
  const bob = Math.hypot(player.vel.x, player.vel.z) > 0.5 ? Math.sin(game.time * 9) * 0.012 : 0;
  const targetGun = player.ads ? { x: 0, y: -0.185, z: -0.42 } : { x: 0.28, y: -0.24 + bob, z: -0.5 };
  gun.position.x += (targetGun.x - gun.position.x) * Math.min(1, dt * 12);
  gun.position.y += (targetGun.y - gun.position.y) * Math.min(1, dt * 12);
  gun.position.z += (targetGun.z - gun.position.z + player.recoil * 0.03) * Math.min(1, dt * 12);
  gun.visible = player.alive;

  // bots: frozen while staging screenshots (SHOT is set), so the staged
  // marks hold — the live game (no ?shot=) is unaffected
  if (!SHOT && (game.phase === 'play' || game.phase === 'planted' || game.phase === 'buy')) {
    for (const b of game.bots) updateBot(b, dt, game);
  }
  // round end by elimination
  if (game.phase === 'play' || game.phase === 'planted') {
    const aAlive = game.bots.filter(b => b.team === 'aurora' && b.alive).length + (player.alive ? 1 : 0);
    const uAlive = game.bots.filter(b => b.team === 'umbra' && b.alive).length;
    if (uAlive === 0) endRound('aurora', 'Umbra team eliminated');
    else if (aAlive === 0 && !game.spike.planted) endRound('umbra', 'Aurora team eliminated');
    else if (aAlive === 0 && game.spike.planted) { /* spike still live: round continues until it blows */ }
  }

  // effects decay
  for (let i = tracers.length - 1; i >= 0; i--) { tracers[i].life -= dt; tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.09) * 0.9; if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers.splice(i, 1); } }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life -= dt;
    const p = s.pts.geometry.attributes.position;
    for (let j = 0; j < s.vel.length; j++) { p.array[j * 3] += s.vel[j].x * dt; p.array[j * 3 + 1] += s.vel[j].y * dt; p.array[j * 3 + 2] += s.vel[j].z * dt; s.vel[j].y -= 9 * dt; }
    p.needsUpdate = true; s.pts.material.opacity = Math.max(0, s.life / 0.4);
    if (s.life <= 0) { scene.remove(s.pts); sparks.splice(i, 1); }
  }

  hud.drawMinimap(world, player, game.bots, game.spike);
  updateHud();
  renderer.render(scene, camera);
  if (!window.__kilnReady) window.__kilnReady = true;
}

// ---------- staged screenshot mode ----------
// ?shot=start|play|buy|end&seed=N renders a fixed, deterministic scene so
// screenshots are real renders of this code with no pointer lock needed.
// Shot #1 is the cover: a lamplit lane in the rain, weapon raised, HUD
// visible, the twist stated in the banner.
function stageShot() {
  if (!SHOT) return;
  game.phase = 'play'; game.timer = 64; game.round = 2; game.scoreA = 1; game.scoreU = 1;
  spawnBots();
  hud.showMenu(false); hud.showEnd(false); hud.closeBuy();
  player.money = 3650; player.hp = 82; player.armor = 50;
  player.loadout.weapons.longshot = { mag: 24, reserve: 60 }; player.loadout.current = 'longshot';
  if (SHOT === 'start') {
    // cover: first-person view down Mid Hall toward the east lamp pool,
    // two Umbra bots in the light, rain falling, twist in the banner.
    // Foes hold in the west half (the mid divider blocks east-west sight)
    // — one standing in the (-6, 0) lamp pool.
    player.pos.set(-10, 0, -2); player.yaw = -Math.PI / 2 - 0.12; player.pitch = 0;
    camera.position.set(player.pos.x, EYE, player.pos.z);
    camera.rotation.set(0, player.yaw, 0);
    const foes = game.bots.filter(b => b.team === 'umbra');
    foes[0].pos.set(-3, 0, 0.5); foes[0].mesh.position.copy(foes[0].pos);
    foes[0].yaw = Math.atan2(player.pos.x - foes[0].pos.x, player.pos.z - foes[0].pos.z); foes[0].mesh.rotation.y = foes[0].yaw;
    foes[1].pos.set(-2, 0, 2.5); foes[1].mesh.position.copy(foes[1].pos);
    foes[1].yaw = Math.atan2(player.pos.x - foes[1].pos.x, player.pos.z - foes[1].pos.z); foes[1].mesh.rotation.y = foes[1].yaw;
    const ally = game.bots.find(b => b.team === 'aurora');
    ally.pos.set(-6, 0, 3.5); ally.mesh.position.copy(ally.pos); ally.yaw = -Math.PI / 2; ally.mesh.rotation.y = ally.yaw;
    hud.setSpike('Spike target: Site A (Furnace)');
    hud.banner('KILNLIGHT', 'fight by lamplight while monsoon rain hides every footstep', 60000);
  } else if (SHOT === 'play') {
    // player in Mid Hall, two Umbra bots visible ahead, one ally beside.
    // Foes hold north of the mid crates, one in the (-6, -8) lamp pool.
    player.pos.set(-8, 0, -3); player.yaw = -1.18; player.pitch = 0;
    const foes = game.bots.filter(b => b.team === 'umbra');
    foes[0].pos.set(-4, 0, -6); foes[0].mesh.position.copy(foes[0].pos);
    foes[0].yaw = Math.atan2(player.pos.x - foes[0].pos.x, player.pos.z - foes[0].pos.z); foes[0].mesh.rotation.y = foes[0].yaw;
    foes[1].pos.set(-1, 0, -4.5); foes[1].mesh.position.copy(foes[1].pos);
    foes[1].yaw = Math.atan2(player.pos.x - foes[1].pos.x, player.pos.z - foes[1].pos.z); foes[1].mesh.rotation.y = foes[1].yaw;
    const ally = game.bots.find(b => b.team === 'aurora');
    ally.pos.set(-6, 0, 3.5); ally.mesh.position.copy(ally.pos); ally.yaw = -Math.PI / 2; ally.mesh.rotation.y = ally.yaw;
    player.firing = true;
    hud.setSpike('Spike target: Site A (Furnace)');
    addTracer(new THREE.Vector3(-7, 1.5, -2.8), new THREE.Vector3(-4, 1.5, -6), 0xfff2b0);
  } else if (SHOT === 'buy') {
    game.phase = 'buy'; game.timer = 12;
    player.pos.set(-28, 0, 0); player.yaw = -Math.PI / 2;
    hud.openBuy(player.loadout, player.money, onBuy);
  } else if (SHOT === 'end') {
    game.phase = 'roundEnd'; game.scoreA = 2; game.scoreU = 1;
    // face Site A from the south-west so the furnace, its lamp and the site are in frame
    player.pos.set(12, 0, -18); player.yaw = -1.86; player.pitch = -0.05;
    const foes = game.bots.filter(b => b.team === 'umbra');
    foes[0].pos.set(22, 0, -15); foes[0].mesh.position.copy(foes[0].pos);
    foes[0].yaw = Math.atan2(player.pos.x - foes[0].pos.x, player.pos.z - foes[0].pos.z); foes[0].mesh.rotation.y = foes[0].yaw;
    hud.banner('AURORA WINS THE ROUND', 'Spike defused at the Furnace', 60000);
    hud.setSpike('');
  }
  updateHud();
}

// ---------- boot ----------
if (SHOT) { stageShot(); }
else { startRound(); hud.showMenu(true); }
tick();
