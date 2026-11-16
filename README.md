# KILNLIGHT

[![make.fun](https://img.shields.io/badge/make.fun-threejs--fps--02-orange)](https://make.fun/bounty/threejs-fps-02)
[![three.js](https://img.shields.io/badge/three.js-0.187.0-blue)](https://threejs.org)

**Fight by lamplight while monsoon rain hides every footstep.**

A round-based tactical FPS in a blacked-out foundry, built on three.js.
Aurora attacks, Umbra defends. Win a round by eliminating the other team,
or by planting the spike at Site A (Furnace) or Site B (Cooling Yard) and
holding it until it blows — or defusing it in time.

## The twist

The foundry is dark. The only clear sightlines are the warm pools of light
under the hanging lamps — and the monsoon drums on the roof all round long.

- **Lamplight vision.** Bots spot a fighter at 55 m standing in a lamp
  pool, but only 24 m in the dark between the lamps. The HUD tells you
  which you are: `IN LAMPLIGHT — THEY CAN SEE YOU` or
  `IN DARKNESS — HARD TO SPOT`. Fight in the light, move in the dark.
- **The hearing bus.** Every footstep and gunshot is a noise event with a
  radius. Rain masks footsteps to a 5 m whisper (3 m crouched, 9 m
  sprinting), so you can sneak the dark lanes — but a gunshot rings out
  to 45 m and gives your position away. The rain bed itself is synthesized
  WebAudio noise, looping under everything.

## The game

- Two 4-player teams (you + 3 bot teammates vs 4 bots), 9 rounds max,
  first to 5, 100-second rounds, 15-second buy phases.
- 5 weapons (Warden pistol, Hornet SMG, Breacher shotgun, Longshot rifle,
  Railspike sniper) with an economy: kills and round wins pay, the buy
  menu sells guns and armour between rounds.
- Plant/defuse: the Umbra carrier plants the spike at the round's target
  site; Aurora defuses by holding the site for 5 seconds.
- Hitbox gunplay: head/body/leg spheres, recoil, bloom, spread, damage
  falloff, tracers, muzzle light, kill feed, hitmarkers, damage direction.
- Live minimap showing walls, sites, lamp pools, the planted spike and
  every alive fighter. Modelled soldiers with visors, walk animation,
  strafing duels and fair aim error.

No network, no build step, no assets: geometry is procedural, sound is
synthesized, three.js is vendored.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

WASD move · mouse look · click fire · right-click aim · R reload ·
1–5 weapons · Shift sprint · Ctrl crouch · Space jump · B buy · M mute.

Screenshots in `screenshots/` are staged renders of this code
(`?shot=start|play|buy|end&seed=1`); the first is the cover: a lamplit
lane in the rain, weapon raised, HUD visible.

## Entry

Built for [make.fun — threejs-fps-02](https://make.fun/bounty/threejs-fps-02)
("Make the best three.js tactical FPS", $1,000). MIT licensed.
