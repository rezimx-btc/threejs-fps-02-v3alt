// EMBERLINE — the player body: acceleration, crouching, jumping, collision.
// Movement is resolved one axis at a time against the world's AABB list, so
// the player slides along walls instead of sticking to them; the floor under
// the player comes from world.groundHeight, which covers ramps and the pit.
import * as THREE from 'three';

const RADIUS = 0.38;
const HEIGHT = 1.72;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 5.6;
const CROUCH_SPEED = 2.3;
const ADS_SPEED = 2.6;
const ACCEL = 42;
const GRAVITY = 18;

export function createPlayer(world) {
  const state = {
    position: new THREE.Vector3(-18, 0, 12),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    grounded: true,
    health: 100,
    armor: 0,
    alive: true,
    vy: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    stepPhase: 0,
  };

  function hitsCollider(pos) {
    for (let i = 0; i < world.colliders.length; i++) {
      const c = world.colliders[i];
      if (pos.y + HEIGHT < c.y0 || pos.y > c.y1) continue;
      if (pos.x + RADIUS > c.x0 && pos.x - RADIUS < c.x1 && pos.z + RADIUS > c.z0 && pos.z - RADIUS < c.z1) {
        return true;
      }
    }
    return false;
  }

  function moveAxis(dx, dz) {
    const pos = state.position;
    const oldX = pos.x;
    const oldZ = pos.z;
    pos.x += dx;
    if (hitsCollider(pos)) pos.x = oldX;
    pos.z += dz;
    if (hitsCollider(pos)) pos.z = oldZ;
    // Stay inside the arena walls.
    pos.x = Math.max(-21.4, Math.min(21.4, pos.x));
    pos.z = Math.max(-17.4, Math.min(17.4, pos.z));
  }

  return {
    state,
    look(dx, dy) {
      // Mouse deltas: yaw turns the body, pitch the view; recoil adds on top
      // and recovers toward zero every step.
      state.yaw -= dx * 0.0021;
      state.pitch -= dy * 0.0021;
      const limit = 1.52;
      if (state.pitch > limit) state.pitch = limit;
      if (state.pitch < -limit) state.pitch = -limit;
    },
    addRecoil(pitch, yaw) {
      state.recoilPitch += pitch;
      state.recoilYaw += yaw;
    },
    reset(spawn) {
      state.position.set(spawn[0], world.groundHeight(spawn[0], spawn[1]), spawn[1]);
      state.velocity.set(0, 0, 0);
      state.vy = 0;
      state.yaw = Math.atan2(-(0 - spawn[0]), -(11 - spawn[1]));
      state.pitch = 0;
      state.health = 100;
      state.armor = 0;
      state.alive = true;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
    },
    step(dt, keys, ads) {
      const s = state;
      if (!s.alive) return 0;
      s.crouched = keys.has('ControlLeft') || keys.has('KeyC');
      const speed = s.crouched ? CROUCH_SPEED : ads ? ADS_SPEED : keys.has('ShiftLeft') ? SPRINT_SPEED : WALK_SPEED;
      const sin = Math.sin(s.yaw);
      const cos = Math.cos(s.yaw);
      let ix = 0;
      let iz = 0;
      if (keys.has('KeyW')) { ix -= sin; iz -= cos; }
      if (keys.has('KeyS')) { ix += sin; iz += cos; }
      if (keys.has('KeyA')) { ix -= cos; iz += sin; }
      if (keys.has('KeyD')) { ix += cos; iz -= sin; }
      const len = Math.hypot(ix, iz);
      if (len > 0) {
        ix = (ix / len) * speed;
        iz = (iz / len) * speed;
      }
      // Accelerate toward the wish velocity; friction when no input.
      const k = 1 - Math.exp(-ACCEL * dt / speed);
      s.velocity.x += (ix - s.velocity.x) * k;
      s.velocity.z += (iz - s.velocity.z) * k;
      moveAxis(s.velocity.x * dt, s.velocity.z * dt);
      // Vertical: gravity, ground snap, step-up over small ledges.
      const ground = world.groundHeight(s.position.x, s.position.z);
      if (keys.has('Space') && s.grounded) {
        s.vy = 6.2;
        s.grounded = false;
      }
      if (!s.grounded || s.position.y > ground + 0.02) {
        s.vy -= GRAVITY * dt;
        s.position.y += s.vy * dt;
        if (s.position.y <= ground) {
          s.position.y = ground;
          s.vy = 0;
          s.grounded = true;
        }
      } else if (ground - s.position.y <= 0.6) {
        s.position.y = ground;
        s.grounded = true;
      }
      // Eye height eases between stand and crouch.
      const targetEye = s.crouched ? EYE_CROUCH : EYE_STAND;
      s.eye += (targetEye - s.eye) * Math.min(1, dt * 12);
      // Recoil recovery.
      s.recoilPitch *= Math.exp(-9 * dt);
      s.recoilYaw *= Math.exp(-9 * dt);
      // Footstep timing for audio.
      const planar = Math.hypot(s.velocity.x, s.velocity.z);
      let stepped = false;
      if (s.grounded && planar > 1.2) {
        s.stepPhase += planar * dt;
        if (s.stepPhase > 2.4) {
          s.stepPhase = 0;
          stepped = true;
        }
      }
      return stepped ? planar : 0;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    eyePosition(out) {
      out.set(state.position.x, state.position.y + state.eye, state.position.z);
      return out;
    },
    viewDirection(out) {
      const pitch = state.pitch + state.recoilPitch;
      const yaw = state.yaw + state.recoilYaw;
      out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      return out;
    },
    damage(amount) {
      if (!state.alive) return false;
      let remaining = amount;
      if (state.armor > 0) {
        const absorbed = Math.min(state.armor, remaining * 0.5);
        state.armor -= absorbed;
        remaining -= absorbed;
      }
      state.health -= remaining;
      if (state.health <= 0) {
        state.health = 0;
        state.alive = false;
        return true;
      }
      return false;
    },
    healFull() {
      state.health = 100;
    },
  };
}
