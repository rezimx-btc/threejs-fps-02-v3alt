// EMBERLINE — bot AI. One module owns every bot: its body, its role, its
// senses and its trigger finger. Bots navigate the waypoint graph, hold
// angles, rotate on sound, and play the objective — planters plant, guards
// hold the hostages, anchors hold the sites. Vision is a cone + line of
// sight, throttled and staggered so eight bots stay cheap; hearing is the
// shared noise log. Bots stop to shoot in bursts, so a still, aimed player
// out-shoots a running bot — the same rule the player lives by.
//
// The sight test keeps its vectors apart on purpose: the eye, the target
// and the direction each live in their own scratch vector. Sharing one
// vector between the target position and the eye collapses the direction
// to zero and the bot goes blind, so _target is never _v1.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const RADIUS = 0.38;
const HEIGHT = 1.72;
const EYE = 1.58;
const WALK = 3.6;
const STRAFE = 2.3;
const FOV = 1.9; // radians, ~109 deg
const SEE_RANGE = 42;
const REACTION_MIN = 0.32;
const REACTION_MAX = 0.62;
const SETTLE = 0.15; // still-aim beat after the reaction delay, before the first shot

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hitsCollider(world, pos) {
  for (let i = 0; i < world.colliders.length; i++) {
    const c = world.colliders[i];
    if (pos.y + HEIGHT < c.y0 || pos.y > c.y1) continue;
    if (pos.x + RADIUS > c.x0 && pos.x - RADIUS < c.x1 && pos.z + RADIUS > c.z0 && pos.z - RADIUS < c.z1) return true;
  }
  return false;
}

export function createBot(scene, world, opts) {
  const random = mulberry32(opts.seed || 1);
  const teamColor = opts.team === 'ember' ? PALETTE.ally : PALETTE.foe;
  const group = new THREE.Group();

  const torsoMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.85, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: teamColor, emissiveIntensity: 0.9, roughness: 0.3 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.78, 0.3), darkMat);
  legs.position.y = 0.39;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.34), torsoMat);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.4, 0.38), darkMat);
  vest.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), darkMat);
  head.position.y = 1.66;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), visorMat);
  visor.position.set(0, 1.68, 0.17);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.72), darkMat);
  gun.position.set(0.22, 1.22, 0.32);
  group.add(legs, torso, vest, head, visor, gun);
  group.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });
  // Health bar: two sprites that always face the camera.
  const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, depthTest: true }));
  barBg.scale.set(0.9, 0.09, 1);
  barBg.position.y = 2.05;
  const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: teamColor, depthTest: true }));
  barFg.scale.set(0.86, 0.06, 1);
  barFg.position.y = 2.05;
  group.add(barBg, barFg);

  torso.userData.part = 'body';
  head.userData.part = 'head';
  scene.add(group);

  const bot = {
    name: opts.name,
    team: opts.team,
    role: opts.role || 'roamer',
    weapon: opts.weapon || 'VK7',
    position: group.position,
    yaw: 0,
    hp: 100,
    armor: 0,
    alive: true,
    speed: WALK,
    path: [],
    pathIndex: 0,
    holdUntil: 0,
    target: null,
    targetKind: 'bot',
    lastSeenAt: -10,
    reactAt: 0,
    burstLeft: 0,
    burstAt: 0,
    nextShotAt: 0,
    thinkAt: random() * 0.12,
    investigate: null,
    investigateUntil: 0,
    channel: null,
    channelAt: 0,
    blindUntil: 0,
    vy: 0,
    grounded: true,
    strafeDir: 1,
    strafeAt: 0,
    objective: opts.objective || null,
    kills: 0,
    group,
    hitMeshes: [torso, head],
  };
  torso.userData.botRef = bot;
  head.userData.botRef = bot;

  function setPathTo(x, z) {
    bot.path = world.findPath(bot.position.x, bot.position.z, x, z);
    bot.pathIndex = 0;
  }

  function eye(out) {
    out.set(bot.position.x, bot.position.y + EYE, bot.position.z);
    return out;
  }

  function canSee(targetPos, raycaster, smokes) {
    eye(_v1);
    _v2.copy(targetPos).sub(_v1);
    const dist = _v2.length();
    if (dist > SEE_RANGE) return false;
    _dir.copy(_v2).normalize();
    // Forward is -Z rotated by yaw.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if (_dir.x * fx + _dir.z * fz < Math.cos(FOV / 2)) return false;
    // Smoke eats sight: a cloud between eye and target blocks the view.
    if (smokes) {
      for (const s of smokes) {
        if (s.life <= 0) continue;
        const lx = targetPos.x - _v1.x;
        const ly = targetPos.y - _v1.y;
        const lz = targetPos.z - _v1.z;
        const len2 = lx * lx + ly * ly + lz * lz;
        let t = len2 > 0 ? -((_v1.x - s.x) * lx + (_v1.y - s.y) * ly + (_v1.z - s.z) * lz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = _v1.x + lx * t;
        const cy = _v1.y + ly * t;
        const cz = _v1.z + lz * t;
        if ((cx - s.x) ** 2 + (cy - s.y) ** 2 + (cz - s.z) ** 2 < s.r * s.r) return false;
      }
    }
    raycaster.set(_v1, _dir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(world.occluders, false);
    return hits.length === 0;
  }

  function moveToward(tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    const pos = bot.position;
    const oldX = pos.x;
    const oldZ = pos.z;
    pos.x += vx * dt;
    if (hitsCollider(world, pos)) pos.x = oldX;
    pos.z += vz * dt;
    if (hitsCollider(world, pos)) pos.z = oldZ;
    pos.x = Math.max(-21.4, Math.min(21.4, pos.x));
    pos.z = Math.max(-17.4, Math.min(17.4, pos.z));
    const ground = world.groundHeight(pos.x, pos.z);
    if (pos.y > ground + 0.02) {
      bot.vy -= 18 * dt;
      pos.y += bot.vy * dt;
      if (pos.y <= ground) {
        pos.y = ground;
        bot.vy = 0;
        bot.grounded = true;
      }
    } else if (ground - pos.y <= 0.6) {
      pos.y = ground;
      bot.grounded = true;
    }
    bot.yaw = Math.atan2(-(tx - pos.x), -(tz - pos.z));
    return false;
  }

  function followPath(dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = bot.path[bot.pathIndex];
    if (moveToward(node.x, node.z, dt, speed)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  bot.reset = function reset(spawn, role, objective) {
    bot.position.set(spawn[0], world.groundHeight(spawn[0], spawn[1]), spawn[1]);
    bot.yaw = Math.atan2(-(0 - spawn[0]), -(11 - spawn[1]));
    bot.hp = 100;
    bot.armor = 0;
    bot.alive = true;
    bot.role = role || bot.role;
    bot.objective = objective || null;
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.channel = null;
    bot.blindUntil = 0;
    bot.kills = 0;
    bot.holdUntil = 0;
    group.visible = true;
    group.rotation.set(0, 0, 0);
    group.position.y = bot.position.y;
    barFg.scale.x = 0.86;
  };

  bot.damage = function damage(amount, isHead) {
    if (!bot.alive) return false;
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.hp -= remaining;
    barFg.scale.x = Math.max(0, 0.86 * (bot.hp / 100));
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.target = null;
      group.rotation.z = Math.PI / 2;
      group.position.y = bot.position.y + 0.2;
      return true;
    }
    return false;
  };

  bot.eyePosition = function eyePosition(out) {
    return eye(out);
  };

  // Analytic ray-vs-capsule test for the player (no mesh needed).
  function rayHitsPlayer(origin, dir, player, maxDist) {
    const px = player.position.x;
    const pz = player.position.z;
    const baseY = player.position.y;
    const topY = baseY + 1.72;
    const ox = origin.x - px;
    const oz = origin.z - pz;
    const a = dir.x * dir.x + dir.z * dir.z;
    let t = 0;
    if (a > 1e-6) t = Math.max(0, -(ox * dir.x + oz * dir.z) / a);
    if (t > maxDist) return null;
    const cx = origin.x + dir.x * t;
    const cz = origin.z + dir.z * t;
    const cy = origin.y + dir.y * t;
    const radial = Math.hypot(cx - px, cz - pz);
    if (radial > 0.42) return null;
    if (cy < baseY - 0.05 || cy > topY + 0.05) return null;
    // Head: top 0.32 m of the capsule.
    return { head: cy > topY - 0.34, t };
  }

  // One fixed step of AI. ctx: { time, player, playerSpeed, bots, raycaster,
  // noise, smokes, charge, onShot, onPlayerHit, onBotHit, onChannelStart,
  // onPlant, onDefuse }
  bot.step = function step(dt, ctx) {
    if (!bot.alive) return;
    const time = ctx.time;
    group.position.y = bot.position.y;
    group.rotation.y = bot.yaw;

    // --- channel (plant / defuse): standing still, interruptible by damage
    if (bot.channel) {
      if (time - bot.channelAt >= bot.channel.duration) {
        const done = bot.channel;
        bot.channel = null;
        if (done.kind === 'plant') ctx.onPlant(bot, done.site);
        else ctx.onDefuse(bot);
      }
      return;
    }

    // --- think tick (staggered): pick a target, hear noise, choose a goal
    if (time >= bot.thinkAt) {
      bot.thinkAt = time + 0.12;
      // Keep the previous target across the tick: wiping it here and
      // re-acquiring the same enemy reset reactAt every 0.12 s, so the
      // reaction delay never elapsed and the bot never fired.
      const prevTarget = bot.target;
      // Visible enemies, nearest first.
      let bestD = Infinity;
      let best = null;
      let bestKind = 'bot';
      const candidates = [];
      for (const other of ctx.bots) {
        if (other === bot || !other.alive || other.team === bot.team) continue;
        candidates.push({ kind: 'bot', ref: other, pos: other.position });
      }
      if (ctx.player.alive && ctx.player.team !== bot.team) {
        _v1.set(ctx.player.position.x, ctx.player.position.y + 1.2, ctx.player.position.z);
        candidates.push({ kind: 'player', ref: ctx.player, pos: _v1.clone() });
      }
      for (const c of candidates) {
        // _target holds the aim point; canSee reads the eye into _v1, so the
        // two must never share a vector.
        _target.set(c.pos.x, c.pos.y + 1.2, c.pos.z);
        const dx = _target.x - bot.position.x;
        const dy = _target.y - (bot.position.y + EYE);
        const dz = _target.z - bot.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < bestD && canSee(_target, ctx.raycaster, ctx.smokes)) {
          bestD = d;
          best = c;
          bestKind = c.kind;
        }
      }
      if (best) {
        // Reset the reaction clock ONLY when the target actually changes;
        // re-acquiring the same enemy must not push the first shot back.
        if (prevTarget !== best.ref) bot.reactAt = time + REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN);
        bot.target = best.ref;
        bot.targetKind = bestKind;
        bot.lastSeenAt = time;
        bot.investigate = null;
      } else if (time - bot.lastSeenAt >= 2.5) {
        // Lost sight for a while: give up the last known position.
        bot.target = null;
      }
      // Otherwise the previous target stays: the bot keeps tracking the
      // last known position instead of forgetting it every think tick.
      // Hearing: a loud noise nearby pulls the bot to investigate.
      if (!bot.target) {
        for (const n of ctx.noise.events) {
          const dx = n.x - bot.position.x;
          const dz = n.z - bot.position.z;
          if (dx * dx + dz * dz < n.radius * n.radius) {
            bot.investigate = { x: n.x, z: n.z };
            bot.investigateUntil = time + 4;
            break;
          }
        }
      }
      // Objective decisions.
      if (bot.role === 'planter' && ctx.charge.state === 'carried' && ctx.charge.carrier === bot) {
        const site = world.sites[bot.objective || 'A'];
        const dx = site.x - bot.position.x;
        const dz = site.z - bot.position.z;
        if (dx * dx + dz * dz < 6.25 && !bot.target) {
          bot.channel = { kind: 'plant', site: bot.objective || 'A', duration: 4 };
          bot.channelAt = time;
          ctx.onChannelStart(bot, 'plant');
        } else if (!bot.target) {
          setPathTo(site.x, site.z);
        }
      } else if (bot.role === 'defuser' && ctx.charge.state === 'planted') {
        const site = world.sites[ctx.charge.site];
        const dx = site.x - bot.position.x;
        const dz = site.z - bot.position.z;
        if (dx * dx + dz * dz < 6.25 && !bot.target) {
          bot.channel = { kind: 'defuse', duration: 5 };
          bot.channelAt = time;
          ctx.onChannelStart(bot, 'defuse');
        } else if (!bot.target) {
          setPathTo(site.x, site.z);
        }
      }
    }

    // --- combat: burst fire at the visible target
    if (bot.target && time >= bot.reactAt && time >= bot.blindUntil) {
      const t = bot.target;
      const tx = t.position.x;
      const tz = t.position.z;
      const ty = t.position.y + 1.2;
      // Face the target.
      bot.yaw = Math.atan2(-(tx - bot.position.x), -(tz - bot.position.z));
      // Settle: stand still and hold the aim for a beat after the
      // reaction delay, and only open fire while the enemy is still in
      // sight (seen within the last two think ticks).
      const settled = time >= bot.reactAt + SETTLE;
      const seen = time - bot.lastSeenAt <= 0.3;
      if (settled && seen) {
        if (bot.burstLeft <= 0 && time >= bot.burstAt) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.burstAt = time + 0.5 + random() * 0.5;
        }
        if (bot.burstLeft > 0) {
          // One shot per 0.11 s inside a burst.
          if (time >= bot.nextShotAt) {
            bot.nextShotAt = time + 0.11;
            bot.burstLeft -= 1;
            const dist = Math.hypot(tx - bot.position.x, tz - bot.position.z);
            const err = 0.02 + dist * 0.0011 + (bot.targetKind === 'player' && ctx.playerSpeed > 2 ? 0.02 : 0);
            eye(_v1);
            _v2.set(tx - _v1.x, ty - _v1.y, tz - _v1.z).normalize();
            _v2.x += (random() * 2 - 1) * err;
            _v2.y += (random() * 2 - 1) * err;
            _v2.z += (random() * 2 - 1) * err;
            _v2.normalize();
            ctx.onShot(bot, _v1, _v2, dist);
            if (bot.targetKind === 'player') {
              const hit = rayHitsPlayer(_v1, _v2, ctx.player, dist + 6);
              if (hit) ctx.onPlayerHit(bot, hit.head, 26);
            } else {
              ctx.raycaster.set(_v1, _v2);
              ctx.raycaster.far = dist + 6;
              const hits = ctx.raycaster.intersectObjects(t.hitMeshes, false);
              if (hits.length > 0) {
                const head = hits[0].object.userData.part === 'head';
                ctx.onBotHit(bot, t, head, head ? 104 : 26);
              }
            }
            if (bot.burstLeft === 0) bot.burstAt = time + 0.45 + random() * 0.5;
          }
        }
      }
      // Strafe once settled; while aiming the bot stands still.
      if (!settled) return;
      if (time >= bot.strafeAt) {
        bot.strafeAt = time + 0.7 + random() * 0.7;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const sx = Math.cos(bot.yaw) * bot.strafeDir;
      const sz = -Math.sin(bot.yaw) * bot.strafeDir;
      moveToward(bot.position.x + sx * 2, bot.position.z + sz * 2, dt, STRAFE);
      return;
    }

    // --- movement: objective, investigation, or patrol
    if (bot.investigate && time < bot.investigateUntil) {
      if (followPath(dt, WALK)) {
        if (moveToward(bot.investigate.x, bot.investigate.z, dt, WALK)) {
          bot.investigate = null;
        }
      }
      return;
    }
    if (bot.pathIndex < bot.path.length) {
      followPath(dt, WALK);
      return;
    }
    // Idle behaviour by role.
    if (bot.role === 'anchor') {
      const site = world.sites[bot.objective || 'A'];
      if (Math.hypot(site.x - bot.position.x, site.z - bot.position.z) > 3) setPathTo(site.x, site.z);
      else if (time > bot.holdUntil) {
        bot.holdUntil = time + 3 + random() * 3;
        bot.yaw += (random() - 0.5) * 2.4;
      }
    } else if (bot.role === 'roamer') {
      const spots = [[0, -6], [12, 0], [-14, 0], [0, 8]];
      const s = spots[Math.floor(random() * spots.length)];
      setPathTo(s[0], s[1]);
    } else if (bot.role === 'lurker') {
      setPathTo(bot.position.x > 0 ? -14 : 4, -14);
    } else if (bot.role === 'guard') {
      if (Math.hypot(16.5 - bot.position.x, -14 - bot.position.z) > 3) setPathTo(16.5, -14);
    } else if (bot.role === 'planter' && ctx.charge.state === 'carried' && ctx.charge.carrier === bot) {
      const site = world.sites[bot.objective || 'A'];
      setPathTo(site.x, site.z);
    } else if (bot.role === 'defuser' && ctx.charge.state === 'planted') {
      const site = world.sites[ctx.charge.site];
      setPathTo(site.x, site.z);
    } else if (time > bot.holdUntil) {
      // Hold ground, scan.
      bot.holdUntil = time + 2 + random() * 3;
      bot.yaw += (random() - 0.5) * 2.0;
    }
  };

  return bot;
}
