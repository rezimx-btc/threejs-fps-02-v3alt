# EMBERLINE — Foundry Protocol

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/rezimx-btc/threejs-fps-02-v3alt/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/rezimx-btc/threejs-fps-02-v3alt/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A 4v4 tactical FPS on the Foundry map — three vertical levels, two ways to
win the round, and an economy that pays for playing the objective.

## The game

**Dual objective.** Attackers win by planting the charge at Site A (the
gantry) or Site B (the vault), or by freeing both hostages and walking them
to extraction. Defenders win by stopping all of it. First to 5 rounds takes
the match; rounds are 100 seconds, buy phase 15 seconds.

**The map.** Foundry is 44 × 36 m of industrial space: a ground floor with
crates and a container maze, a mid gantry ring at 5 m, and a high catwalk at
9 m. Two stairwells, a vent shaft, and a double-door flank connect the
levels. Site A sits on the gantry, Site B in the vault, the hostage cell in
the north-east corner, extraction on the west edge.

**The fight.** Four weapons (P9 sidearm, VK7 rifle, MAW9 SMG, F12
scattergun) with distinct spread, damage and falloff; three grenades (frag,
smoke that blocks sight *and* bullets, flash that blinds); armor, a buy
menu, and a $800 start with kill/round/objective income. Seven bots fill
both teams with roles — anchors hold the sites, the planter carries the
charge, a defuser is assigned the moment the charge goes down, roamers and
lurkers work the flanks. Bots see through a vision cone and line of sight,
hear gunfire and footsteps, hold angles, strafe while shooting, and stop to
fire in bursts — so a still, aimed player out-shoots a running bot.

**The feel.** Recoil with recovery, ADS with FOV pull, spread that grows
with movement and shrinks with crouch and aim, tracers, muzzle flash,
impact sparks, screen shake on explosions, a compass with site/hostage/
extraction bearings, killfeed, hitmarkers, damage direction, and a
round/match end screen with the MVP.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | Move / look (pointer lock; drag to look if lock is unavailable) |
| Click | Fire |
| Right click | Aim down sights |
| R | Reload / play again on the end screen |
| 1–4 | P9 / VK7 / MAW9 / F12 |
| Q | Cycle grenade · G throw grenade |
| E | Free hostage / plant charge |
| B | Buy menu (buy phase) |
| Shift / C | Sprint / crouch |
| Esc | Pause |

## Run it

```bash
node serve.ts        # http://localhost:4173/
# or capture the four screenshots + dossier.json:
MAKEFUN_OUTPUT_DIR=./output node main.ts
```

Node 22, no dependencies. Screenshots are deterministic: same seed, same
frames, byte-identical dossier across runs.

## Shots

| Shot | Frame |
| --- | --- |
| `?shot=start&seed=1` | Menu over the Foundry cover scene |
| `?shot=play&seed=1` | Live fire — headshot on a foe, tracer into the wall |
| `?shot=buy&seed=1` | Buy phase with the economy open |
| `?shot=end&seed=1` | Match end, 5–3, MVP card |

## License

MIT — see [LICENSE](LICENSE).
