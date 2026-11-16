// hud.js — DOM HUD for KILNLIGHT: health/armour, ammo, money, round timer,
// team scores, alive counts, kill feed, hitmarker, damage direction, a live
// top-down minimap, the buy menu — plus the twist readouts: a lamplight
// status line (are you standing in a lamp pool, visible from far away, or
// in the dark, hard to spot?) and a rain note. The 3D canvas stays clean;
// all UI is DOM so it is crisp at any resolution and readable in screenshots.
import { WEAPONS, WEAPON_LIST, ARMOR_PRICE } from './weapons.js';

export class Hud {
  constructor(root) {
    this.el = {};
    const ids = ['health-num', 'health-bar', 'armor-num', 'ammo-mag', 'ammo-reserve', 'money',
      'timer', 'score-a', 'score-u', 'round-label', 'alive-a', 'alive-u', 'killfeed',
      'hitmarker', 'banner', 'banner-sub', 'crosshair', 'damage', 'minimap', 'buy', 'buy-money',
      'buy-list', 'menu', 'end', 'end-title', 'end-sub', 'hint', 'spike-status', 'reload-tip',
      'lamp-status'];
    for (const id of ids) this.el[id] = root.querySelector('#' + id);
    this.minimapCtx = this.el['minimap'].getContext('2d');
    this.feed = [];
  }
  setHealth(hp, armor) {
    this.el['health-num'].textContent = Math.max(0, Math.ceil(hp));
    this.el['health-bar'].style.width = Math.max(0, hp) + '%';
    this.el['health-bar'].style.background = hp > 50 ? '#e8b23a' : hp > 25 ? '#e06a1e' : '#d83a2e';
    this.el['armor-num'].textContent = armor > 0 ? '🛡 ' + Math.ceil(armor) : '';
  }
  setAmmo(mag, reserve, reloading) {
    this.el['ammo-mag'].textContent = mag;
    this.el['ammo-reserve'].textContent = '/ ' + reserve;
    this.el['reload-tip'].hidden = !reloading;
  }
  setMoney(m) { this.el['money'].textContent = '$' + m; this.el['buy-money'].textContent = '$' + m; }
  setTimer(sec, phase) {
    const s = Math.max(0, Math.ceil(sec));
    this.el['timer'].textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el['timer'].style.color = s <= 10 && phase === 'play' ? '#ff5a4a' : '';
    this.el['round-label'].textContent = phase === 'buy' ? 'BUY PHASE' : phase === 'planted' ? 'SPIKE LIVE' : 'ROUND';
  }
  setScore(a, u, round) {
    this.el['score-a'].textContent = a; this.el['score-u'].textContent = u;
  }
  setAlive(a, u) { this.el['alive-a'].textContent = '●'.repeat(a); this.el['alive-u'].textContent = '●'.repeat(u); }
  setSpike(text) { this.el['spike-status'].textContent = text; }
  // The twist, on screen: lit = you stand in a lamp pool and can be seen
  // from far away; dark = you are hard to spot, and the rain hides your steps.
  setLampStatus(lit) {
    const el = this.el['lamp-status'];
    el.textContent = lit ? '☀ IN LAMPLIGHT — THEY CAN SEE YOU' : '☾ IN DARKNESS — HARD TO SPOT · RAIN HIDES YOUR STEPS';
    el.style.color = lit ? '#ffb45e' : '#9fb8cc';
  }
  showHitmarker(kill, head) {
    const h = this.el['hitmarker']; h.classList.add('on'); if (kill) h.classList.add('kill'); if (head) h.classList.add('head');
    clearTimeout(this._hm); this._hm = setTimeout(() => h.classList.remove('on', 'kill', 'head'), 140);
  }
  damageFrom(angleDeg) {
    const d = this.el['damage']; d.style.setProperty('--ang', angleDeg + 'deg'); d.classList.add('on');
    clearTimeout(this._dm); this._dm = setTimeout(() => d.classList.remove('on'), 450);
  }
  killfeed(killer, victim, head, killerTeam) {
    const div = document.createElement('div');
    div.className = 'feed-line ' + (killerTeam === 'aurora' ? 'ta' : 'tu');
    div.textContent = `${killer} ${head ? '◉' : '✕'} ${victim}`;
    this.el['killfeed'].prepend(div);
    while (this.el['killfeed'].children.length > 5) this.el['killfeed'].lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }
  banner(title, sub = '', ms = 2600) {
    this.el['banner'].textContent = title; this.el['banner-sub'].textContent = sub;
    const wrap = this.el['banner'].closest('#banner-wrap'); wrap.hidden = false;
    clearTimeout(this._bn); this._bn = setTimeout(() => { wrap.hidden = true; }, ms);
  }
  setCrosshair(spreadPx, ads) {
    this.el['crosshair'].style.setProperty('--gap', (ads ? 2 : spreadPx) + 'px');
    this.el['crosshair'].classList.toggle('ads', !!ads);
  }
  showMenu(show) { this.el['menu'].hidden = !show; }
  showEnd(show, title, sub) {
    this.el['end'].hidden = !show;
    if (show) { this.el['end-title'].textContent = title; this.el['end-sub'].textContent = sub; }
  }
  setHint(text) { this.el['hint'].textContent = text; }
  // Buy menu: rebuilt each buy phase so prices and owned state are current.
  openBuy(loadout, money, onBuy) {
    const list = this.el['buy-list']; list.innerHTML = '';
    for (const w of WEAPON_LIST) {
      const owned = !!loadout.weapons[w.id];
      const b = document.createElement('button');
      b.className = 'buy-item' + (owned ? ' owned' : '') + (money < w.price && !owned ? ' poor' : '');
      b.innerHTML = `<b>[${w.slot}] ${w.name}</b><span>${w.kind} · ${w.damage} dmg · ${w.mag} rnd</span><i>${owned ? 'OWNED' : '$' + w.price}</i>`;
      b.onclick = () => onBuy('weapon', w.id);
      list.appendChild(b);
    }
    const a = document.createElement('button');
    a.className = 'buy-item' + (loadout.armor >= 100 ? ' owned' : '');
    a.innerHTML = `<b>[5] Plated Vest</b><span>absorbs half of each hit · 100 armour</span><i>${loadout.armor >= 100 ? 'OWNED' : '$' + ARMOR_PRICE}</i>`;
    a.onclick = () => onBuy('armor');
    list.appendChild(a);
    this.el['buy'].hidden = false;
  }
  closeBuy() { this.el['buy'].hidden = true; }
  // Top-down minimap: walls, sites, lamp pools, spike, alive players as dots.
  drawMinimap(world, player, bots, spike) {
    const ctx = this.minimapCtx, S = 148, W = 64, D = 48;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(12,14,18,0.82)'; ctx.fillRect(0, 0, S, S);
    const X = x => (x + W / 2) / W * S, Z = z => (z + D / 2) / D * S;
    ctx.strokeStyle = '#3a4048'; ctx.lineWidth = 1;
    for (const c of world.colliders) ctx.strokeRect(X(c.x0), Z(c.z0), X(c.x1) - X(c.x0), Z(c.z1) - Z(c.z0));
    for (const [k, s] of Object.entries(world.sites)) {
      ctx.fillStyle = k === 'A' ? 'rgba(255,140,40,0.25)' : 'rgba(40,200,190,0.25)';
      ctx.beginPath(); ctx.arc(X(s.cx), Z(s.cz), s.r / W * S, 0, 7); ctx.fill();
      ctx.fillStyle = '#e9e6df'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(k, X(s.cx) - 4, Z(s.cz) + 4);
    }
    // lamp pools: warm circles, the only clear sightlines
    for (const l of world.lamps || []) {
      ctx.fillStyle = 'rgba(255,180,94,0.28)';
      ctx.beginPath(); ctx.arc(X(l.x), Z(l.z), l.r / W * S, 0, 7); ctx.fill();
    }
    if (spike.planted) { ctx.fillStyle = '#ff3a2e'; ctx.beginPath(); ctx.arc(X(spike.x), Z(spike.z), 5, 0, 7); ctx.fill(); }
    const dot = (x, z, col, r = 3.5) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(x), Z(z), r, 0, 7); ctx.fill(); };
    for (const b of bots) if (b.alive) dot(b.pos.x, b.pos.z, b.team === 'aurora' ? '#f0a830' : '#4aa8ff');
    // player: white triangle pointing along yaw
    ctx.save(); ctx.translate(X(player.pos.x), Z(player.pos.z)); ctx.rotate(Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw)) * -1 + Math.PI);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}
