// weapons.js — KILNLIGHT arsenal. Same five weapons as the brief asks for,
// no sixth: the twist is lamplight and rain, not more guns. Original names
// and stats, tuned so accuracy beats speed: standing still and tapping wins
// duels; spraying while running does not. Spread is in degrees at the
// muzzle; recoil kicks the aim up and recovers; damage falls off with range;
// headshots pay 4x on rifles.
export const WEAPONS = {
  warden: {
    id: 'warden', name: 'Warden P250', slot: 1, price: 300, kind: 'pistol',
    damage: 34, headMult: 4, rpm: 400, auto: false, mag: 12, reserve: 36,
    reload: 1.5, spread: 0.55, moveSpread: 1.6, recoil: 0.55, range: 42,
    falloff: 0.55, zoom: 1, speed: 1.0, tracer: 0xffd27a,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', slot: 2, price: 1400, kind: 'smg',
    damage: 26, headMult: 3, rpm: 750, auto: true, mag: 30, reserve: 90,
    reload: 2.0, spread: 1.05, moveSpread: 2.2, recoil: 0.42, range: 30,
    falloff: 0.45, zoom: 1, speed: 0.97, tracer: 0xffe08a,
  },
  breacher: {
    id: 'breacher', name: 'Breacher 12', slot: 2, price: 1100, kind: 'shotgun',
    damage: 11, headMult: 2, pellets: 8, rpm: 70, auto: false, mag: 6, reserve: 24,
    reload: 2.6, spread: 3.4, moveSpread: 4.2, recoil: 1.6, range: 16,
    falloff: 0.25, zoom: 1, speed: 0.95, tracer: 0xffb36a,
  },
  longshot: {
    id: 'longshot', name: 'Longshot-77', slot: 3, price: 2700, kind: 'rifle',
    damage: 33, headMult: 4, rpm: 600, auto: true, mag: 30, reserve: 90,
    reload: 2.4, spread: 0.5, moveSpread: 1.9, recoil: 0.7, range: 60,
    falloff: 0.7, zoom: 1.25, speed: 0.93, tracer: 0xfff2b0,
  },
  railspike: {
    id: 'railspike', name: 'Railspike .50', slot: 4, price: 4750, kind: 'sniper',
    damage: 95, headMult: 2, rpm: 48, auto: false, mag: 5, reserve: 15,
    reload: 3.2, spread: 0.12, moveSpread: 3.5, recoil: 2.4, range: 90,
    falloff: 0.9, zoom: 2.6, speed: 0.88, tracer: 0x9fe8ff,
  },
};
export const WEAPON_LIST = [WEAPONS.warden, WEAPONS.hornet, WEAPONS.breacher, WEAPONS.longshot, WEAPONS.railspike];
export const ARMOR_PRICE = 650;
export const ARMOR_REDUCTION = 0.5; // armoured hits lose half their damage

export function makeLoadout() {
  return {
    weapons: { warden: { mag: 12, reserve: 36 } },
    current: 'warden', armor: 0,
  };
}
export function buyWeapon(loadout, id, money) {
  const w = WEAPONS[id];
  if (!w || loadout.weapons[id] || money < w.price) return money;
  loadout.weapons[id] = { mag: w.mag, reserve: w.reserve };
  loadout.current = id;
  return money - w.price;
}
export function buyArmor(loadout, money) {
  if (loadout.armor >= 100 || money < ARMOR_PRICE) return money;
  loadout.armor = 100; return money - ARMOR_PRICE;
}
// Damage after range falloff; headshots use the weapon's multiplier.
export function damageAt(w, dist, head) {
  const f = dist <= w.range * 0.5 ? 1 : Math.max(w.falloff, 1 - (dist - w.range * 0.5) / w.range * (1 - w.falloff));
  return Math.round(w.damage * f * (head ? w.headMult : 1));
}
