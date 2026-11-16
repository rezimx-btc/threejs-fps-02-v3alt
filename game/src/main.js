// EMBERLINE — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. The loop owns the cross-module wiring only:
// shooting raycasts, grenade projectiles, hostage and charge meshes, the
// carrier hand-off when the player falls, and the deterministic ?shot=
// frames the screenshots are taken from. Game rules live in round.js,
// bot brains in bot.js, the map in world.js.
//
// The menu never waits on pointer lock. Clicking Play hides the overlay on
// the click itself and starts the match; the lock is requested best effort
// afterwards. If the browser cannot lock (headless, or a rejected Promise),
// input falls back to drag-look and the HUD says so — the game runs either
// way instead of sitting behind a menu that never opens.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBot } from './bot.js';
import { createRound } from './round.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createAudio, createNoiseLog } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) document.body.classList.add('shot-mode');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const noise = createNoiseLog();
const player = createPlayer(world);
player.state.team = 'ember';
const weapon = createWeapon();
const raycaster = new THREE.Raycaster();
raycaster.far = 80;

const hud = createHud();
const round = createRound(world, {
  setObjective: (t) => hud.setObjective(t),
  setScore: (e, s) => hud.setScore(e, s),
  setMoney: (m) => hud.setMoney(m),
  setTimer: (s, p) => hud.setTimer(s, p),
  setCharge: (s, v) => hud.setCharge(s, v),
  setHostages: (f, r) => hud.setHostages(f, r),
  banner: (t, s, ms) => hud.banner(t, s, ms),
  sting: (win) => audio.sting(win),
  plantSound: () => audio.plant(),
  beep: (final) => audio.beep(final),
  chime: () => audio.chime(),
  explosion: () => {
    audio.explosion();
    effects.explosionAt(chargePos);
  },
  matchEnd: (winner, score, mvp) => {
    hud.showOverlay('end', { winner, scoreE: score.ember, scoreS: score.slag, mvp });
    input.exitLock();
  },
});

// ---- teams ---------------------------------------------------------------
const ALLY_NAMES = ['Vex', 'Marrow', 'Pike'];
const FOE_NAMES = ['Rook', 'Cinder', 'Grate', 'Talon'];
const bots = [];
for (let i = 0; i < 3; i++) {
  bots.push(createBot(scene, world, { name: ALLY_NAMES[i], team: 'ember', seed: 11 + i, weapon: 'VK7' }));
}
for (let i = 0; i < 4; i++) {
  bots.push(createBot(scene, world, { name: FOE_NAMES[i], team: 'slag', seed: 31 + i, weapon: i === 3 ? 'MAW9' : 'VK7' }));
}
const botHitMeshes = [];
for (const b of bots) botHitMeshes.push(...b.hitMeshes);

// ---- hostages + charge props ---------------------------------------------
const hostageMeshes = [];
for (let i = 0; i < 2; i++) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.hostage, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), mat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark);
  head.position.y = 1.58;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.72, 0.28), dark);
  legs.position.y = 0.36;
  g.add(body, head, legs);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(g);
  hostageMeshes.push(g);
}
const chargeMesh = new THREE.Group();
const chargeBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.6, metalness: 0.4 }));
const chargeLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x220000, emissive: PALETTE.red, emissiveIntensity: 2 }),
);
chargeLamp.position.y = 0.2;
chargeMesh.add(chargeBody, chargeLamp);
chargeMesh.visible = false;
scene.add(chargeMesh);
const chargePos = new THREE.Vector3();

// ---- viewmodel ------------------------------------------------------------
const viewmodel = new THREE.Group();
const vmMat = new THREE.MeshStandardMaterial({ color: 0x5f6368, roughness: 0.4, metalness: 0.7 });
const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.36), vmMat);
const vmBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.22), vmMat);
vmBarrel.position.set(0, 0.012, -0.28);
const vmSight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.03, 0.016), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: PALETTE.amber, emissiveIntensity: 0.4 }));
vmSight.position.set(0, 0.055, -0.06);
viewmodel.add(vmBody, vmBarrel, vmSight);
viewmodel.position.set(0.26, -0.26, -0.5);
camera.add(viewmodel);

// ---- state ----------------------------------------------------------------
const input = createInput(renderer.domElement, { onLockChange, onLockUnavailable });
const owned = new Set(['P9']);
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let flashAmount = 0;
let adsAmount = 0;
let planting = null; // site key while the player plants
let grenades = [];
let walkPhase = 0;
let vmKick = 0;
let defuserAssigned = false;

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

hud.setHealth(100, 0);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
hud.setMoney(round.state.money);
hud.setScore(0, 0);
hud.setWeapon('P9 Sidearm', 'Frag', 0);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  // Hide the menu on the click itself, before anything about the pointer
  // lock is known. The lock is requested after, best effort: if it fails,
  // input drops to drag-look and the game is already running.
  hud.showOverlay('hide');
  if (round.state.phase === 'menu' || round.state.phase === 'match') {
    round.startMatch();
    resetPositions();
  }
  input.requestLock();
});
hud.onBuy((kind, key) => {
  if (round.state.phase !== 'buy') return;
  if (kind === 'weapon') {
    const def = WEAPONS[key];
    if (round.spend(def.price)) {
      owned.add(key);
      weapon.refill(key);
      hud.setWeapon(def.name, weapon.state.grenadeSlot, weapon.state.grenades[weapon.state.grenadeSlot]);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
      hud.setBuyMenu(true, round.state.money, owned);
      audio.chime();
    }
  } else if (kind === 'grenade') {
    const before = round.state.money;
    const after = weapon.buyGrenade(key, before);
    if (after !== before) {
      round.state.money = after;
      hud.setMoney(after);
      hud.setBuyMenu(true, after, owned);
      audio.chime();
    }
  } else if (kind === 'armor') {
    if (round.spend(650)) {
      player.state.armor = 100;
      hud.setHealth(player.state.health, 100);
      hud.setBuyMenu(true, round.state.money, owned);
      audio.chime();
    }
  }
});

function onLockChange(locked) {
  if (shot) return;
  hud.setLockHint(false);
  if (locked) {
    hud.showOverlay('hide');
  } else if (round.state.phase === 'live') {
    // Buy phase has its own UI: the shop. Losing the lock while buying
    // must not raise the pause overlay over it — the overlay sits above
    // the shop and would swallow every click on it.
    hud.showOverlay(player.state.alive ? 'paused' : 'dead');
  }
}

function onLockUnavailable() {
  if (shot) return;
  hud.setLockHint(true);
}

function resetPositions() {
  player.reset(world.spawns.attack[0]);
  player.healFull();
  weapon.refill(weapon.state.slot);
  const allyRoles = ['roamer', 'lurker', 'roamer'];
  const foeRoles = ['anchor', 'anchor', 'roamer', 'guard'];
  const foeObjectives = ['A', 'B', null, null];
  let ai = 0;
  let fi = 0;
  for (const b of bots) {
    if (b.team === 'ember') {
      b.reset(world.spawns.attack[1 + ai], allyRoles[ai], null);
      ai += 1;
    } else {
      b.reset(world.spawns.defend[fi], foeRoles[fi], foeObjectives[fi]);
      fi += 1;
    }
  }
  planting = null;
  defuserAssigned = false;
  chargeMesh.visible = false;
  for (const h of hostageMeshes) h.visible = true;
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
  hud.setRound(round.state.round);
  hud.setBuyMenu(false, round.state.money, owned);
}

function aimAt(point) {
  const p = player.state;
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function applyBotDamage(bot, amount, isHead, killerName) {
  if (!bot.alive) return;
  if (bot.channel) {
    if (bot.channel.kind === 'plant' && round.state.charge.state === 'planting' && round.state.charge.carrier === bot) round.cancelPlant();
    if (bot.channel.kind === 'defuse' && round.state.charge.state === 'defusing') round.cancelDefuse();
    bot.channel = null;
  }
  const died = bot.damage(amount, isHead);
  if (died) {
    round.addKill(killerName);
    hud.killfeed(`${killerName} ▸ ${bot.name}${isHead ? ' ◉' : ''}`, killerName === 'You' || bots.some((b) => b.team === 'ember' && b.name === killerName));
    if (killerName === 'You') audio.kill();
    // The charge drops to the next living attacker.
    if (round.state.charge.carrier === bot) {
      const next = bots.find((b) => b.team === 'ember' && b.alive);
      if (next) {
        round.state.charge.carrier = next;
        next.role = 'planter';
        next.objective = round.state.charge.site === 'A' ? 'B' : 'A';
      }
    }
  }
}

function shoot(spread) {
  // Matrices must be current: in ?shot= mode no frame has rendered yet,
  // so a raycast without this tests the bots at their creation transform.
  scene.updateMatrixWorld(true);
  const result = weapon.takeShot(elapsed);
  if (!result) return;
  if (result.dry) {
    audio.dry();
    return;
  }
  player.eyePosition(_eye);
  player.viewDirection(_dir);
  // Muzzle world position for the tracer + flash.
  _muzzle.set(0.26, -0.22, -0.9);
  camera.localToWorld(_muzzle);
  effects.muzzleAt(_muzzle);
  audio.shot(result.kind, 0);
  noise.add('shot', _eye.x, _eye.y, _eye.z, 32);
  player.addRecoil(result.kick, (random() * 2 - 1) * result.kick * 0.4);
  vmKick = Math.min(0.09, vmKick + 0.03);
  const pellets = result.pellets;
  for (let p = 0; p < pellets; p++) {
    _tmp.copy(_dir);
    _tmp.x += (random() * 2 - 1) * spread;
    _tmp.y += (random() * 2 - 1) * spread;
    _tmp.z += (random() * 2 - 1) * spread;
    _tmp.normalize();
    raycaster.set(_eye, _tmp);
    raycaster.far = result.range;
    const targets = botHitMeshes.concat(world.shootables);
    const hits = raycaster.intersectObjects(targets, false);
    let end = null;
    let endDist = result.range;
    for (const hit of hits) {
      const ref = hit.object.userData.botRef;
      // Smoke eats the shot: nothing past the wall of smoke takes damage.
      const smoked = effects.segmentHitsSmoke(_eye.x, _eye.y, _eye.z, hit.point.x, hit.point.y, hit.point.z);
      if (smoked) {
        end = _tmp.clone().multiplyScalar(hit.distance * 0.55).add(_eye);
        endDist = hit.distance * 0.55;
        break;
      }
      if (ref) {
        if (!ref.alive) continue;
        const isHead = hit.object.userData.part === 'head';
        const dmg = result.damage * (isHead ? result.headMult : 1);
        applyBotDamage(ref, dmg, isHead, 'You');
        hud.hitmarker(ref.hp <= 0);
        if (isHead) audio.headshot();
        else audio.hit();
        end = hit.point;
        endDist = hit.distance;
        break;
      }
      end = hit.point;
      endDist = hit.distance;
      effects.sparksAt(hit.point, hit.face ? hit.face.normal : _tmp);
      break;
    }
    if (!end) {
      end = _tmp.clone().multiplyScalar(result.range).add(_eye);
    }
    effects.tracer(_muzzle, end);
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
}

function throwGrenade() {
  const kind = weapon.state.grenadeSlot;
  const def = weapon.throwGrenade();
  if (!def) return;
  player.eyePosition(_eye);
  player.viewDirection(_dir);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.8 }));
  mesh.position.copy(_eye);
  scene.add(mesh);
  const vel = _dir.clone().multiplyScalar(15);
  vel.y += 3.2;
  grenades.push({ mesh, vel, kind, fuse: def.fuse, def });
  audio.reload();
}

function detonateGrenade(g) {
  const pos = g.mesh.position;
  scene.remove(g.mesh);
  if (g.kind === 'frag') {
    effects.explosionAt(pos);
    audio.explosion();
    noise.add('explosion', pos.x, pos.y, pos.z, 50);
    const victims = [];
    if (player.state.alive) victims.push({ pos: player.state.position, eyeY: 1.2, isPlayer: true });
    for (const b of bots) if (b.alive) victims.push({ pos: b.position, eyeY: 1.2, bot: b });
    for (const v of victims) {
      const d = Math.hypot(v.pos.x - pos.x, v.pos.y - pos.y, v.pos.z - pos.z);
      if (d > g.def.radius) continue;
      raycaster.set(pos, _tmp.set(v.pos.x - pos.x, (v.pos.y + v.eyeY) - pos.y, v.pos.z - pos.z).normalize());
      raycaster.far = d;
      const blocked = raycaster.intersectObjects(world.occluders, false).length > 0;
      if (blocked) continue;
      const dmg = Math.round(g.def.damage * (1 - d / (g.def.radius + 2)));
      if (v.isPlayer) {
        const died = player.damage(dmg);
        hud.setHealth(player.state.health, player.state.armor);
        if (died) onPlayerDeath('Frag');
      } else {
        applyBotDamage(v.bot, dmg, false, 'You');
      }
    }
  } else if (g.kind === 'flash') {
    audio.flash();
    // Player flash: facing the burst hurts more.
    player.eyePosition(_eye);
    _dir.copy(pos).sub(_eye);
    const dist = _dir.length();
    _dir.normalize();
    player.viewDirection(_tmp);
    const facing = Math.max(0, _tmp.dot(_dir));
    if (dist < 24) {
      flashAmount = Math.min(1, (1.25 - dist / 24) * (0.35 + 0.65 * facing));
    }
    for (const b of bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.position.x - pos.x, b.position.z - pos.z);
      if (d < 22) b.blindUntil = elapsed + Math.max(0.6, 2.6 - d * 0.09);
    }
  } else {
    effects.smokeAt(pos.x, Math.max(0.4, pos.y), pos.z);
  }
}

function onPlayerDeath(cause) {
  if (planting) {
    round.cancelPlant();
    planting = null;
  }
  hud.showOverlay('dead');
  input.exitLock();
  hud.killfeed(`${cause || 'Slag'} ▸ You`, false);
  // Hand the charge to a living ally bot.
  const next = bots.find((b) => b.team === 'ember' && b.alive);
  if (next && round.state.charge.state === 'carried') {
    round.state.charge.carrier = next;
    next.role = 'planter';
    next.objective = 'A';
    hud.setObjective('Charge passed to ' + next.name + ' — cover the plant.');
  }
}

function botContext() {
  return {
    time: elapsed,
    player: player.state,
    playerSpeed: player.groundSpeed(),
    bots,
    raycaster,
    noise,
    smokes: effects.smokes,
    charge: round.state.charge,
    onShot(bot, from, dir, dist) {
      _muzzle.copy(from).addScaledVector(dir, 0.6);
      _tmp.copy(from).addScaledVector(dir, dist);
      effects.tracer(_muzzle, _tmp);
      audio.shot(bot.weapon === 'MAW9' ? 'smg' : 'rifle', Math.min(1, dist / 42));
      noise.add('shot', from.x, from.y, from.z, 30);
    },
    onPlayerHit(bot, isHead, damage) {
      if (!player.state.alive) return;
      const died = player.damage(isHead ? damage * 2 : damage);
      hud.setHealth(player.state.health, player.state.armor);
      const dx = bot.position.x - player.state.position.x;
      const dz = bot.position.z - player.state.position.z;
      const rel = Math.atan2(-dx, -dz) - player.state.yaw;
      hud.damageFrom(-rel);
      if (died) onPlayerDeath(bot.name);
    },
    onBotHit(shooter, victim, isHead, damage) {
      applyBotDamage(victim, damage, isHead, shooter.name);
    },
    onChannelStart(bot, kind) {
      if (kind === 'plant') round.startPlant(bot.objective || 'A', bot);
      else round.startDefuse();
    },
    onPlant(bot, site) {
      round.finishPlant();
    },
    onDefuse(bot) {
      round.finishDefuse();
    },
  };
}

function step(dt) {
  elapsed += dt;
  world.update(dt, elapsed);
  noise.clear();
  // Read one-shot presses every step, in every phase, so a key pressed on
  // the menu never leaks into the first live step.
  const pressed = input.takePressed();

  if (round.state.phase === 'menu' || round.state.phase === 'match') {
    if (round.state.phase === 'match' && pressed.has('KeyR')) {
      round.startMatch();
      resetPositions();
      hud.showOverlay('hide');
      input.requestLock();
    }
    effects.step(dt);
    return;
  }

  const keys = input.state.keys;

  // Buy menu toggle (buy phase only).
  if (pressed.has('KeyB') && round.state.phase === 'buy') {
    const open = document.getElementById('buy').style.display !== 'block';
    hud.setBuyMenu(open, round.state.money, owned);
    if (open) input.exitLock();
    else input.requestLock();
  }

  if (round.state.phase === 'buy' || round.state.phase === 'live') {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const stepped = player.step(dt, keys, input.state.ads, elapsed);
    if (stepped > 0) {
      audio.step(stepped > 4);
      noise.add('step', player.state.position.x, player.state.position.y, player.state.position.z, 6);
      walkPhase += dt * stepped * 1.6;
    }
    weapon.step(dt);
    // ADS easing + FOV.
    const adsTarget = input.state.ads && player.state.alive ? 1 : 0;
    adsAmount += (adsTarget - adsAmount) * Math.min(1, dt * 9);
    camera.fov = 74 - 16 * adsAmount;
    camera.updateProjectionMatrix();

    // Firing (live phase only).
    if (round.state.phase === 'live' && player.state.alive) {
      if (input.state.firing && weapon.ready()) {
        shoot(weapon.spread(player.groundSpeed(), player.state.crouched, adsAmount));
      }
      if (pressed.has('KeyR')) {
        if (weapon.reload()) audio.reload();
      }
      // Weapon slots.
      const slots = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      const names = ['P9', 'VK7', 'MAW9', 'F12'];
      for (let i = 0; i < 4; i++) {
        if (pressed.has(slots[i]) && owned.has(names[i])) {
          weapon.switchTo(names[i]);
          hud.setWeapon(WEAPONS[names[i]].name, weapon.state.grenadeSlot, weapon.state.grenades[weapon.state.grenadeSlot]);
          hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
        }
      }
      if (pressed.has('KeyQ')) {
        const next = weapon.cycleGrenade();
        hud.setWeapon(WEAPONS[weapon.state.slot].name, next, weapon.state.grenades[next]);
      }
      if (pressed.has('KeyG')) throwGrenade();
      // Interact: hostage rescue / plant.
      if (pressed.has('KeyE')) {
        const p = player.state.position;
        for (const h of round.state.hostages) {
          if (h.state === 'cell' && Math.hypot(h.x - p.x, h.z - p.z) < 2.4) {
            if (round.freeHostage(h.id, player.state)) {
              hud.killfeed('You freed a hostage — get them to extraction', true);
            }
          }
        }
        if (round.state.charge.state === 'carried' && round.state.charge.carrier === 'player') {
          for (const key of ['A', 'B']) {
            const site = world.sites[key];
            const d = Math.hypot(site.x - p.x, site.z - p.z);
            const dy = Math.abs((site.y || 0) - p.y);
            if (d < 3 && dy < 2.5) {
              if (round.startPlant(key, 'player')) planting = key;
              break;
            }
          }
        }
      }
      // Plant channel: leaving the site cancels it.
      if (planting) {
        const site = world.sites[planting];
        const p = player.state.position;
        const d = Math.hypot(site.x - p.x, site.z - p.z);
        if (!player.state.alive || d > 2.6 || Math.abs((site.y || 0) - p.y) > 2.5) {
          round.cancelPlant();
          planting = null;
        }
      }
    }

    // Grenade projectiles.
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 12 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.1) {
        g.mesh.position.y = 0.1;
        g.vel.y *= -0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        detonateGrenade(g);
        grenades.splice(i, 1);
      }
    }

    // Bots.
    const ctx = botContext();
    // Assign a defuser once the charge is planted.
    if (round.state.charge.state === 'planted' && !defuserAssigned) {
      let best = null;
      let bestD = Infinity;
      const site = world.sites[round.state.charge.site];
      for (const b of bots) {
        if (b.team !== 'slag' || !b.alive) continue;
        const d = Math.hypot(site.x - b.position.x, site.z - b.position.z);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best) {
        best.role = 'defuser';
        defuserAssigned = true;
      }
    }
    for (const b of bots) b.step(dt, ctx);

    // Hostage meshes follow round state.
    for (let i = 0; i < hostageMeshes.length; i++) {
      const h = round.state.hostages[i];
      const mesh = hostageMeshes[i];
      if (!h) continue;
      mesh.visible = h.state !== 'rescued';
      mesh.position.set(h.x, world.groundHeight(h.x, h.z), h.z);
      if (h.state === 'follow' && h.follower) {
        const f = h.follower;
        mesh.lookAt(f.position ? f.position.x : f.x, mesh.position.y, f.position ? f.position.z : f.z);
      }
    }
    // Charge mesh.
    if (round.state.charge.state === 'planted' || round.state.charge.state === 'defusing') {
      const site = world.sites[round.state.charge.site];
      chargeMesh.visible = true;
      chargeMesh.position.set(site.x, site.y + 0.15, site.z);
      chargePos.set(site.x, site.y + 0.5, site.z);
      chargeLamp.material.emissiveIntensity = (Math.sin(elapsed * 8) > 0 ? 3 : 0.4);
    } else {
      chargeMesh.visible = false;
    }

    // Round rules.
    round.step(dt, {
      player: player.state,
      bots,
      onRoundStart: () => {
        resetPositions();
      },
    });

    // The buy phase ends inside round.step: close the shop the moment
    // live play starts instead of letting it float over the round, and
    // re-request the lock the same way closing it by hand does.
    if (round.state.phase === 'live' && document.getElementById('buy').style.display === 'block') {
      hud.setBuyMenu(false, round.state.money, owned);
      input.requestLock();
    }

    // HUD: crosshair spread, compass, interact prompt.
    const spreadPx = 5 + weapon.spread(player.groundSpeed(), player.state.crouched, adsAmount) * 900;
    hud.setCrosshair(spreadPx);
    const markers = [];
    for (const key of ['A', 'B']) {
      const s = world.sites[key];
      markers.push({ label: key, cls: 'site', bearing: Math.atan2(-(s.x - player.state.position.x), -(s.z - player.state.position.z)) });
    }
    for (const h of round.state.hostages) {
      if (h.state === 'cell') {
        markers.push({ label: 'H', cls: 'hostage', bearing: Math.atan2(-(h.x - player.state.position.x), -(h.z - player.state.position.z)) });
      }
    }
    markers.push({ label: 'EX', cls: 'extract', bearing: Math.atan2(-(-18 - player.state.position.x), -(12 - player.state.position.z)) });
    hud.setCompass(player.state.yaw, markers);
    // Interact prompt.
    let prompt = null;
    if (round.state.phase === 'live' && player.state.alive) {
      const p = player.state.position;
      for (const h of round.state.hostages) {
        if (h.state === 'cell' && Math.hypot(h.x - p.x, h.z - p.z) < 2.4) prompt = '[E] Free hostage';
      }
      if (!prompt && round.state.charge.state === 'carried' && round.state.charge.carrier === 'player') {
        for (const key of ['A', 'B']) {
          const site = world.sites[key];
          if (Math.hypot(site.x - p.x, site.z - p.z) < 3 && Math.abs((site.y || 0) - p.y) < 2.5) {
            prompt = '[E] Plant charge — ' + site.name;
          }
        }
      }
      if (planting) prompt = 'Planting… stay in the zone';
    }
    hud.interact(prompt);
    if (round.state.phase === 'live' && !player.state.alive && input.state.locked) {
      input.exitLock();
    }
  }

  // Flash decay + viewmodel + camera, every step.
  if (flashAmount > 0) {
    flashAmount = Math.max(0, flashAmount - dt * 0.45);
    hud.flash(flashAmount);
  }
  vmKick *= Math.exp(-8 * dt);
  viewmodel.position.z = -0.5 + vmKick;
  viewmodel.position.y = -0.26 + Math.sin(walkPhase) * 0.008 - (weapon.state.reloading > 0 ? 0.08 : 0);
  viewmodel.rotation.x = vmKick * 1.2;
  effects.step(dt);
  syncCamera();
}

function syncCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch + p.recoilPitch, p.yaw + p.recoilYaw, 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    if (round.state.phase === 'menu' || round.state.phase === 'match') {
      // Slow menu orbit so the cover scene stays alive behind the overlay.
      const t = performance.now() / 1000;
      camera.position.set(Math.sin(t * 0.08) * 14, 7.5, Math.cos(t * 0.08) * 14);
      camera.lookAt(0, 1.5, 0);
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i++) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.showOverlay('hide');
  audio.unlock();
  round.startMatch();
  resetPositions();
  round.beginLive();
  if (name === 'start') {
    player.state.position.set(-18, 0, 12);
    player.state.yaw = -0.98;
    player.state.pitch = 0.02;
    hud.showOverlay('start');
    settle(10);
  } else if (name === 'play') {
    player.state.position.set(-6, 0, 6);
    const foe1 = bots.find((b) => b.name === 'Rook');
    const foe2 = bots.find((b) => b.name === 'Cinder');
    foe1.position.set(-2, 0, -4);
    foe1.yaw = Math.PI;
    foe2.position.set(8, 0, -6);
    foe2.yaw = Math.PI * 0.75;
    settle(30);
    // Aim at the first foe's head and fire twice: headshot kill, then a
    // follow-up into the wall behind. P9 cooldown is 0.22 s = 14 steps.
    _tmp.set(foe1.position.x, foe1.position.y + 1.66, foe1.position.z);
    aimAt(_tmp);
    shoot(0);
    settle(16);
    shoot(0);
    settle(12);
  } else if (name === 'buy') {
    player.state.position.set(-16, 0, 10);
    player.state.yaw = -0.7;
    settle(10);
    hud.setBuyMenu(true, round.state.money, owned);
  } else if (name === 'end') {
    round.state.score = { ember: 5, slag: 3 };
    hud.setScore(5, 3);
    player.state.position.set(-2, 0, 8);
    player.state.yaw = -0.4;
    settle(10);
    hud.showOverlay('end', { winner: 'EMBER', scoreE: 5, scoreS: 3, mvp: { name: 'You', kills: 14 } });
  }
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, false);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
