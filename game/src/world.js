// EMBERLINE — the Foundry map. One module owns the whole arena: geometry,
// collision boxes, walkable heights, the waypoint graph the bots navigate,
// the two plant sites, the hostage cells and the extraction zone.
// Layout (metres, x east / z south): attackers spawn south-west, defenders
// north-east. Site A is the Furnace floor (south), Site B is the Gantry deck
// (north, 3.2 m up, reached by two ramps). A sunken crucible pit cuts the
// middle lane; a catwalk runs the north wall. Three lanes: west, mid, east.
import * as THREE from 'three';
import { PALETTE, makeHazardTexture, makePlateTexture } from './palette.js';

const BOUNDS = { x0: -22, x1: 22, z0: -18, z1: 18 };
const DECK_Y = 3.2;
const PIT = { x0: 2, z0: -2, x1: 10, z1: 6, y: -1.2 };

export function createWorld(scene) {
  const colliders = [];
  const occluders = [];
  const shootables = [];
  const plate = makePlateTexture(6, 5);
  const hazard = makeHazardTexture();

  const matFloor = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.92, metalness: 0.25 });
  const matWall = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95, metalness: 0.2 });
  const matSteel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.6, metalness: 0.7 });
  const matDark = new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.8, metalness: 0.5 });
  const matHazard = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.85, metalness: 0.2 });
  const matPipe = new THREE.MeshStandardMaterial({ color: PALETTE.pipe, roughness: 0.45, metalness: 0.85 });
  const matMolten = new THREE.MeshStandardMaterial({ color: 0x3a1500, emissive: PALETTE.molten, emissiveIntensity: 2.4, roughness: 0.4 });
  const matEmber = new THREE.MeshStandardMaterial({ color: 0x2a0d00, emissive: PALETTE.amber, emissiveIntensity: 1.6, roughness: 0.5 });
  const matGreen = new THREE.MeshStandardMaterial({ color: 0x0d2a18, emissive: PALETTE.green, emissiveIntensity: 1.4, roughness: 0.5 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x6a5638, roughness: 0.9, metalness: 0.1 });

  function box(mat, cx, cy, cz, w, h, d, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.shadow !== false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (opts.collide !== false) {
      colliders.push({ x0: cx - w / 2, y0: cy - h / 2, z0: cz - d / 2, x1: cx + w / 2, y1: cy + h / 2, z1: cz + d / 2 });
    }
    if (opts.occlude !== false) occluders.push(mesh);
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(mat, cx, cy, cz, r, h, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 18), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (opts.collide !== false) {
      colliders.push({ x0: cx - r, y0: cy - h / 2, z0: cz - r, x1: cx + r, y1: cy + h / 2, z1: cz + r });
    }
    if (opts.occlude !== false) occluders.push(mesh);
    shootables.push(mesh);
    return mesh;
  }

  // ---- floor, pit, walls -------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 36), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  shootables.push(floor);
  // Crucible pit: sunken floor with a molten glow at the bottom.
  const pitFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), matMolten);
  pitFloor.rotation.x = -Math.PI / 2;
  pitFloor.position.set(6, PIT.y + 0.02, 2);
  scene.add(pitFloor);
  box(matDark, 6, -0.6, -2, 8.4, 0.15, 0.4, { collide: false, occlude: false });
  box(matDark, 6, -0.6, 6, 8.4, 0.15, 0.4, { collide: false, occlude: false });
  box(matDark, 2, -0.6, 2, 0.4, 0.15, 8.4, { collide: false, occlude: false });
  box(matDark, 10, -0.6, 2, 0.4, 0.15, 8.4, { collide: false, occlude: false });
  // Hazard trim around the pit rim.
  const rimN = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.06, 0.5), matHazard);
  rimN.position.set(6, 0.03, -2.2);
  scene.add(rimN);
  const rimS = rimN.clone();
  rimS.position.z = 6.2;
  scene.add(rimS);

  // Perimeter walls (6 m high) + hazard skirting.
  box(matWall, 0, 3, -18.4, 45.6, 6, 0.8);
  box(matWall, 0, 3, 18.4, 45.6, 6, 0.8);
  box(matWall, -22.4, 3, 0, 0.8, 6, 37.6);
  box(matWall, 22.4, 3, 0, 0.8, 6, 37.6);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(44, 0.5, 0.1), matHazard);
  skirt.position.set(0, 0.25, -17.95);
  scene.add(skirt);

  // ---- the Furnace (Site A) ----------------------------------------------
  // A slab-sided furnace body, its mouth glowing, chimneys rising through
  // the roof.
  box(matDark, 0, 2.2, 15.2, 10, 4.4, 3.2);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), matMolten);
  mouth.position.set(0, 1.6, 13.55);
  mouth.rotation.y = Math.PI;
  scene.add(mouth);
  cylinder(matSteel, -3.4, 6.4, 15.2, 0.9, 5);
  cylinder(matSteel, 3.4, 6.4, 15.2, 0.9, 5);
  box(matHazard, 0, 0.35, 13.2, 7, 0.7, 0.5, { collide: false, occlude: false });
  const furnaceLight = new THREE.PointLight(PALETTE.molten, 60, 26, 1.8);
  furnaceLight.position.set(0, 2.2, 12.2);
  scene.add(furnaceLight);

  // ---- pillars, tanks, conveyor, crates ----------------------------------
  const pillarSpots = [[-12, -6], [-12, 6], [14, -6], [-4, -12], [16, 6], [-18, -12]];
  for (const [x, z] of pillarSpots) box(matSteel, x, 2.5, z, 1.1, 5, 1.1);
  cylinder(matPipe, 19, 1.6, -6, 1.5, 3.2);
  cylinder(matPipe, 19, 1.6, 2, 1.5, 3.2);
  cylinder(matDark, -19, 1.4, 4, 1.3, 2.8);
  // Conveyor belt along the east wall.
  box(matDark, 18.5, 0.55, -2, 2.2, 1.1, 12);
  box(matSteel, 18.5, 1.15, -2, 2.2, 0.12, 12, { collide: false, occlude: false });
  // Pipes along the north wall.
  const pipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 44, 12), matPipe);
  pipe1.rotation.z = Math.PI / 2;
  pipe1.position.set(0, 5.2, -17.5);
  scene.add(pipe1);
  const pipe2 = pipe1.clone();
  pipe2.position.y = 4.7;
  scene.add(pipe2);
  // Crate stacks: the map's cover. Each crate is a collider + occluder.
  const crates = [
    [-8, 0.6, 2, 1.8], [-8, 0.6, 4.2, 1.2], [-8, 1.8, 3.1, 1.2],
    [12, 0.6, 10, 1.8], [12, 0.6, 12.4, 1.2], [-16, 0.6, -2, 1.8],
    [2, 0.6, -8, 1.8], [4.4, 0.6, -8, 1.2], [-2, 0.6, 10, 1.2],
    [16, 0.6, -14, 1.2], [-12, 0.6, -10, 1.2], [8, 0.6, -12, 1.8],
    [-18, 0.6, 14, 1.2], [18, 0.6, 12, 1.2],
  ];
  for (const [x, y, z, s] of crates) box(matCrate, x, y, z, s, s * 1.1, s);

  // ---- Gantry catwalk (Site B) -------------------------------------------
  // Deck y=3.2 along the north wall, x -20..8, with two ramps down to the floor.
  box(matSteel, -6, DECK_Y - 0.15, -14, 28, 0.3, 4);
  // Railings (visual only, no collision so players can drop off the edge).
  const rail = new THREE.Mesh(new THREE.BoxGeometry(28, 0.08, 0.08), matPipe);
  rail.position.set(-6, DECK_Y + 0.95, -12.1);
  scene.add(rail);
  for (let x = -19; x <= 7; x += 2) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1, 0.08), matPipe);
    post.position.set(x, DECK_Y + 0.5, -12.1);
    scene.add(post);
  }
  // Support pillars under the deck.
  for (const x of [-18, -10, -2, 6]) box(matSteel, x, DECK_Y / 2, -15.4, 0.6, DECK_Y, 0.6);
  // Ramps: west (x -20..-17) and east (x 5..8), rising from z=-6 to z=-12.
  function ramp(x0, x1) {
    const len = 6;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.25, len + 1.4), matSteel);
    mesh.position.set((x0 + x1) / 2, DECK_Y / 2 - 0.12, -9);
    mesh.rotation.x = Math.atan2(DECK_Y, len);
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootables.push(mesh);
  }
  ramp(-20, -17);
  ramp(5, 8);
  // Site B marker: amber strip on the deck.
  const siteBStrip = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 4), matEmber);
  siteBStrip.position.set(-14, DECK_Y + 0.05, -14);
  scene.add(siteBStrip);
  // Site A marker: amber strip on the furnace floor.
  const siteAStrip = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 4), matEmber);
  siteAStrip.position.set(0, 0.05, 11.4);
  scene.add(siteAStrip);

  // ---- hostage cells (north-east room) -----------------------------------
  // Two cells with barred fronts; hostages wait inside until freed.
  box(matWall, 14, 2.5, -16, 0.6, 5, 6);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), matPipe);
    bar.position.set(15.2 + i * 0.7, 1.3, -13.2);
    scene.add(bar);
  }
  const cellLight = new THREE.PointLight(PALETTE.amber, 14, 12, 1.8);
  cellLight.position.set(17, 3, -14);
  scene.add(cellLight);

  // ---- extraction zone (south-west, green strip) -------------------------
  const extractStrip = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 5), matGreen);
  extractStrip.position.set(-18, 0.05, 12);
  scene.add(extractStrip);

  // ---- lights ------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x9fb4c8, 0x2a1c10, 1.5));
  const sun = new THREE.DirectionalLight(0xffe0b8, 2.2);
  sun.position.set(14, 22, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  scene.add(sun);
  const cool = new THREE.PointLight(0x4a6a8a, 18, 30, 1.8);
  cool.position.set(-8, 5.5, -4);
  scene.add(cool);
  const warm = new THREE.PointLight(0xff9a1f, 20, 26, 1.8);
  warm.position.set(2, 5.5, 2);
  scene.add(warm);
  const east = new THREE.PointLight(0x6a8aaa, 14, 22, 1.8);
  east.position.set(14, 5, 8);
  scene.add(east);
  const north = new THREE.PointLight(0x8aa0b8, 16, 24, 1.8);
  north.position.set(-4, 5.5, -13);
  scene.add(north);

  // ---- walkable heights --------------------------------------------------
  function groundHeight(x, z) {
    if (x >= PIT.x0 && x <= PIT.x1 && z >= PIT.z0 && z <= PIT.z1) return PIT.y;
    // Catwalk deck.
    if (x >= -20 && x <= 8 && z >= -16 && z <= -12) return DECK_Y;
    // Ramps: rise from y=0 at z=-6 to DECK_Y at z=-12.
    if (z >= -12 && z <= -6) {
      if (x >= -20 && x <= -17) return DECK_Y * (-6 - z) / 6;
      if (x >= 5 && x <= 8) return DECK_Y * (-6 - z) / 6;
    }
    return 0;
  }

  // ---- waypoint graph ----------------------------------------------------
  // Nodes: [x, z, level]. Edges are listed by index; bots BFS through them.
  const nodeData = [
    [-18, 12, 0], [-14, 8, 0], [-14, 0, 0], [-18, -6, 0], // 0-3 west lane
    [-6, 0, 0], [0, -6, 0], [0, 8, 0], [0, 14, 0], // 4-7 mid + Site A
    [12, 0, 0], [14, 8, 0], [18, 0, 0], [14, -6, 0], // 8-11 east lane
    [16, -10, 0], [16, -14, 0], [-2, -12, 0], [-14, -8, 0], // 12-15 north ground
    [-18.5, -9, 1], [6.5, -9, 1], // 16-17 ramp middles
    [-18, -14, 2], [-8, -14, 2], [4, -14, 2], [-14, -14, 2], // 18-21 deck
    [12, -12, 0], [-10, 4, 0], [6, -4, 0], // 22-24 connectors
    [-18, 4, 0], [18, 12, 0], // 25-26 spawns
  ];
  const edges = [
    [0, 1], [0, 25], [1, 2], [1, 23], [2, 3], [2, 4], [2, 23],
    [3, 15], [3, 16], [4, 5], [4, 7], [4, 24], [5, 15], [5, 11],
    [6, 7], [6, 8], [7, 9], [8, 9], [8, 10], [8, 11], [9, 26],
    [10, 11], [11, 12], [12, 13], [12, 22], [13, 14], [14, 22],
    [15, 16], [15, 21], [16, 18], [17, 20], [17, 22], [18, 19],
    [18, 21], [19, 20], [19, 21], [20, 22], [22, 12], [23, 6],
    [24, 5], [24, 11], [25, 1], [26, 9], [6, 24], [15, 5],
  ];
  const nodes = nodeData.map(([x, z, level]) => ({
    x, z, y: groundHeight(x, z), level,
    pos: new THREE.Vector3(x, groundHeight(x, z), z),
  }));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const dx = nodes[i].x - x;
      const dz = nodes[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // BFS; returns an array of node positions from start to goal (inclusive).
  function findPath(fromX, fromZ, toX, toZ) {
    const start = nearestNode(fromX, fromZ);
    const goal = nearestNode(toX, toZ);
    if (start === goal) return [nodes[goal].pos.clone()];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const next of adjacency[cur]) {
        if (prev[next] === -1) {
          prev[next] = cur;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [nodes[goal].pos.clone()];
    const path = [];
    let cur = goal;
    while (cur !== start) {
      path.unshift(nodes[cur].pos.clone());
      cur = prev[cur];
    }
    return path;
  }

  return {
    bounds: BOUNDS,
    colliders,
    occluders,
    shootables,
    groundHeight,
    nodes,
    findPath,
    nearestNode,
    sites: {
      A: { x: 0, y: 0, z: 11.4, name: 'Furnace' },
      B: { x: -14, y: DECK_Y, z: -14, name: 'Gantry' },
    },
    hostageSpots: [
      { x: 16.4, y: 0, z: -15.2 },
      { x: 18.6, y: 0, z: -15.2 },
    ],
    extraction: { x0: -20.5, z0: 9.5, x1: -15.5, z1: 14.5 },
    spawns: {
      attack: [[-19, 12], [-17, 10], [-19, 14], [-16, 13]],
      defend: [[16, -12], [18, -8], [12, -14], [19, -12]],
    },
    update(dt, time) {
      // Furnace breathes: its glow swells and dips like a working forge.
      furnaceLight.intensity = 52 + Math.sin(time * 2.1) * 10 + Math.sin(time * 5.7) * 5;
    },
  };
}
