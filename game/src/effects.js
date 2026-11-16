// EMBERLINE — transient combat effects. Tracers, muzzle flashes, impact
// sparks, smoke walls and explosions. Everything is pooled and reused: no
// mesh, material or geometry is created during a round, so the hot loop
// allocates nothing. Smoke clouds are also gameplay: they block line of
// sight for bots and bullets alike.
//
// All randomness here comes from one fixed-seed generator, never
// Math.random: smoke puff placement is drawn at boot and spark bursts at
// fire time, both in a fixed call order under the fixed-step simulation,
// so the same seed renders the same frame on every run.
import * as THREE from 'three';

const TRACER_COUNT = 10;
const SPARK_COUNT = 36;

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

export function createEffects(scene) {
  const random = mulberry32(20261115);

  // ---- tracers: a pool of two-point lines -------------------------------
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // ---- muzzle flash: one sprite + one light, reused --------------------
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,220,120,1)');
    g.addColorStop(0.5, 'rgba(255,140,40,0.7)');
    g.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, depthWrite: false }));
  muzzle.scale.set(0.7, 0.7, 1);
  scene.add(muzzle);
  const muzzleLight = new THREE.PointLight(0xffa040, 0, 9, 2);
  scene.add(muzzleLight);
  let muzzleLife = 0;

  // ---- impact sparks: one Points cloud, positions rewritten per burst ---
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0 });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  let sparkLife = 0;

  // ---- smoke: three pooled clouds of soft sprites ----------------------
  const smokeTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(200,200,200,0.85)');
    g.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const smokes = [];
  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group();
    const sprites = [];
    for (let j = 0; j < 9; j++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
      s.position.set((random() - 0.5) * 3, random() * 2.4, (random() - 0.5) * 3);
      const sc = 2 + random() * 2;
      s.scale.set(sc, sc, 1);
      group.add(s);
      sprites.push(s);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, sprites, x: 0, y: 0, z: 0, r: 2.6, life: 0, maxLife: 12 });
  }
  let smokeIndex = 0;

  // ---- explosion: expanding sphere + light ------------------------------
  const boomGeo = new THREE.SphereGeometry(1, 20, 14);
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0 });
  const boom = new THREE.Mesh(boomGeo, boomMat);
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff6a00, 0, 30, 1.6);
  scene.add(boomLight);
  let boomLife = 0;

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();

  function segmentHitsSmoke(ax, ay, az, bx, by, bz) {
    for (const s of smokes) {
      if (s.life <= 0) continue;
      _a.set(ax, ay, az);
      _b.set(bx - ax, by - ay, bz - az);
      const len2 = _b.lengthSq();
      let t = len2 > 0 ? -((_a.x - s.x) * _b.x + (_a.y - s.y) * _b.y + (_a.z - s.z) * _b.z) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + _b.x * t;
      const cy = ay + _b.y * t;
      const cz = az + _b.z * t;
      const d2 = (cx - s.x) ** 2 + (cy - s.y) ** 2 + (cz - s.z) ** 2;
      if (d2 < s.r * s.r) return true;
    }
    return false;
  }

  return {
    smokes,
    segmentHitsSmoke,
    tracer(from, to) {
      const t = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
      const attr = t.line.geometry.attributes.position;
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      t.line.material.opacity = 0.9;
      t.life = 0.09;
    },
    muzzleAt(pos) {
      muzzle.position.copy(pos);
      muzzle.material.opacity = 1;
      muzzleLight.position.copy(pos);
      muzzleLight.intensity = 26;
      muzzleLife = 0.06;
    },
    sparksAt(pos, normal) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparkPos[i * 3] = pos.x;
        sparkPos[i * 3 + 1] = pos.y;
        sparkPos[i * 3 + 2] = pos.z;
        sparkVel[i * 3] = normal.x * 2 + (random() - 0.5) * 4;
        sparkVel[i * 3 + 1] = Math.abs(normal.y) * 2 + random() * 3;
        sparkVel[i * 3 + 2] = normal.z * 2 + (random() - 0.5) * 4;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkMat.opacity = 1;
      sparkLife = 0.45;
    },
    smokeAt(x, y, z) {
      const s = smokes[smokeIndex];
      smokeIndex = (smokeIndex + 1) % smokes.length;
      s.x = x;
      s.y = y;
      s.z = z;
      s.life = s.maxLife;
      s.group.position.set(x, y, z);
      s.group.visible = true;
      for (const sprite of s.sprites) sprite.material.opacity = 0.85;
    },
    explosionAt(pos) {
      boom.position.copy(pos);
      boom.scale.setScalar(0.5);
      boomMat.opacity = 0.95;
      boomLight.position.copy(pos);
      boomLight.intensity = 220;
      boomLife = 0.6;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        }
      }
      if (muzzleLife > 0) {
        muzzleLife -= dt;
        muzzle.material.opacity = Math.max(0, muzzleLife / 0.06);
        muzzleLight.intensity = Math.max(0, muzzleLife / 0.06) * 26;
      }
      if (sparkLife > 0) {
        sparkLife -= dt;
        sparkMat.opacity = Math.max(0, sparkLife / 0.45);
        for (let i = 0; i < SPARK_COUNT; i++) {
          sparkVel[i * 3 + 1] -= 9 * dt;
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
          if (sparkPos[i * 3 + 1] < 0.03) sparkPos[i * 3 + 1] = 0.03;
        }
        sparkGeo.attributes.position.needsUpdate = true;
      }
      for (const s of smokes) {
        if (s.life > 0) {
          s.life -= dt;
          const fade = Math.min(1, s.life / 2);
          for (const sprite of s.sprites) sprite.material.opacity = 0.85 * fade;
          if (s.life <= 0) s.group.visible = false;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const k = 1 - boomLife / 0.6;
        boom.scale.setScalar(0.5 + k * 7);
        boomMat.opacity = Math.max(0, 0.95 * (1 - k));
        boomLight.intensity = Math.max(0, 220 * (1 - k));
      }
    },
  };
}
