// EMBERLINE — screenshot capture (Node 22, standard library only). Serves
// game/ on localhost, loads each shot from shots.json in
// chrome-headless-shell over CDP, and writes the PNGs into screenshots/.
// The game is deterministic per seed, so two runs of this program produce
// byte-identical screenshots; the dossier's reproduces check relies on it.
//
// Usage:
//   node capture.ts                     # writes screenshots/ beside this file
//   SHOTS_DIR=/tmp/shots node capture.ts
//
// Headless WebGL needs software rendering: --enable-unsafe-swiftshader +
// --use-angle=swiftshader. Plain --disable-gpu leaves WebGL NULL and the
// renderer constructor throws before any canvas exists.
//
// One wall-clock race is pinned before every screenshot: the round banner
// hides itself on a 2.6 s timeout, but headless rAF paints arrive on the
// wall clock, so the banner could be mid-life or already gone when the
// frame is grabbed. The pin clears that timeout and forces the banner to
// its shown state, so the captured frame is a pure function of the seed.
// The damage-direction ring is pinned off for the same reason (its 600 ms
// fade is also wall-clock); the hitmarker and killfeed already pin
// themselves in shot mode inside hud.js.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const gameRoot = join(root, 'game');
const shotsDir = process.env.SHOTS_DIR || join(root, 'screenshots');
const port = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ts': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function serve() {
  return new Promise((resolveServer) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        let rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const file = resolve(gameRoot, normalize(rel));
        if (!file.startsWith(gameRoot)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(port, () => resolveServer(server));
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`,
    `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux/chrome`,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates[0];
}

// Minimal CDP client over the global WebSocket (Node 22, no deps).
// send() resolves with msg.result already unwrapped, so callers
// destructure the result fields directly — never { result: {...} }.
// A sessionId goes on the message itself (sibling of method/params),
// never inside params — that is what routes a flattened session call
// to the page target instead of the browser target.
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const queue = [];
  let open = false;
  ws.onopen = () => {
    open = true;
    for (const m of queue) ws.send(m);
    queue.length = 0;
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      const handlers = listeners.get(msg.method) || [];
      for (const h of handlers) h(msg.params);
    }
  };
  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const payload = JSON.stringify(message);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (open) ws.send(payload);
      else queue.push(payload);
    });
  }
  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(handler);
  }
  function close() {
    ws.close();
  }
  return { send, on, close };
}

async function captureShot(shot) {
  const chrome = findChrome();
  const args = [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    '--user-data-dir=/tmp/emberline-capture-profile',
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  // Read the DevTools WebSocket URL from stderr.
  const wsUrl = await new Promise((resolveWs, rejectWs) => {
    const timer = setTimeout(() => rejectWs(new Error('chrome did not print DevTools URL: ' + stderr.slice(-500))), 15000);
    const check = () => {
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolveWs(m[1]);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
  const browser = cdp(wsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  // Session-scoped CDP: the session id rides on the message, not in params.
  const s = {
    send: (method, params = {}) => browser.send(method, params, sessionId),
    on: browser.on,
  };
  const errors = [];
  browser.on('Runtime.exceptionThrown', (p) => {
    errors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown'));
  });
  browser.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  browser.on('Network.loadingFailed', (p) => {
    if (!p.canceled) errors.push('network failed: ' + p.errorText);
  });
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Network.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url: `http://localhost:${port}/${shot.query}` });
  // Wait for the game to paint twice, then grab the frame.
  const ready = await new Promise((resolveReady) => {
    const deadline = Date.now() + 30000;
    const poll = async () => {
      try {
        const { result } = await s.send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
        if (result?.value) return resolveReady(true);
      } catch { /* retry */ }
      if (Date.now() > deadline) return resolveReady(false);
      setTimeout(poll, 250);
    };
    poll();
  });
  if (!ready) throw new Error(`shot ${shot.name}: game never became ready (errors: ${errors.join(' | ') || 'none captured'})`);
  // Pin the wall-clock transient DOM state, then grab the frame at once.
  await s.send('Runtime.evaluate', {
    expression: `(() => {
      const b = document.getElementById('banner');
      if (b) { clearTimeout(b._t); b.classList.add('show'); }
      const d = document.getElementById('dmg-dir');
      if (d) d.classList.remove('on');
      return 'pinned';
    })()`,
    returnByValue: true,
  });
  const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
  await s.send('Page.close');
  browser.close();
  proc.kill();
  return { png: Buffer.from(data, 'base64'), errors };
}

async function main() {
  const shots = JSON.parse(await readFile(join(root, 'shots.json'), 'utf8'));
  await mkdir(shotsDir, { recursive: true });
  const server = await serve();
  try {
    for (const shot of shots) {
      const { png, errors } = await captureShot(shot);
      const file = join(shotsDir, shot.name);
      await writeFile(file, png);
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      const ok = png.length <= 262144 && Math.max(w, h) <= 1280 && Math.min(w, h) >= 480;
      console.log(`${shot.name}: ${png.length} bytes, ${w}x${h}, ${errors.length} errors${ok ? '' : '  <-- OUT OF SPEC'}`);
      for (const e of errors) console.log('  ' + e);
      if (errors.length > 0) process.exitCode = 1;
    }
  } finally {
    server.close();
  }
  const files = await readdir(shotsDir);
  console.log('screenshots: ' + files.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
