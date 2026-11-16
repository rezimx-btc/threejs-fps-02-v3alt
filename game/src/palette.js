// EMBERLINE — one palette for the whole Foundry, plus the two procedural
// textures the map is built from. Cold steel, hazard amber and molten
// orange: every material in world.js and every bot in bot.js reads its
// colours from here, so the scene stays one chosen look. Textures are
// drawn on canvas at boot; the game ships no image assets.
//
// The plate speckle is drawn from a fixed-seed generator, not Math.random:
// the same seed draws the same texture on every boot, so screenshots of
// the same seed are pixel-identical run after run.
import * as THREE from 'three';

export const PALETTE = {
  canvas: 0x0d0f12,
  floor: 0x2b2f35,
  wall: 0x22262c,
  steel: 0x3a4048,
  steelDark: 0x262a30,
  pipe: 0x4a5158,
  amber: 0xff9a1f,
  molten: 0xff6a00,
  ember: 0xffb347,
  hazard: 0xf5c518,
  teal: 0x2dd4bf,
  red: 0xe5484d,
  green: 0x46c26a,
  ink: 0xe9e6df,
  muted: 0x98a0a8,
  ally: 0x2dd4bf,
  foe: 0xe5484d,
  hostage: 0xf5c518,
};

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

function makeTexture(size, draw, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawHazard(ctx, s) {
  ctx.fillStyle = '#15171a';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#f5c518';
  for (let i = -s; i < s * 2; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, s);
    ctx.lineTo(i + 32, 0);
    ctx.lineTo(i + 64, 0);
    ctx.lineTo(i + 32, s);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPlate(ctx, s) {
  ctx.fillStyle = '#3d434b';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#2a2e34';
  ctx.lineWidth = 4;
  const half = s / 2;
  for (let x = 0; x <= s; x += half) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, x);
    ctx.lineTo(s, x);
    ctx.stroke();
  }
  ctx.fillStyle = '#3a4048';
  for (const [x, y] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]]) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wear speckle from a fixed seed: identical texture on every boot.
  const random = mulberry32(0xc0ffee);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 260; i++) {
    ctx.fillRect(random() * s, random() * s, 2, 2);
  }
}

export function makeHazardTexture() {
  return makeTexture(256, drawHazard, 1, 1);
}

export function makePlateTexture(repeatX = 4, repeatY = 4) {
  return makeTexture(256, drawPlate, repeatX, repeatY);
}

export function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
