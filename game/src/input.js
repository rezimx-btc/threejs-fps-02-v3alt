// EMBERLINE — keyboard, mouse and pointer lock. One module owns every input
// device: it turns DOM events into a small state object the simulation reads
// once per fixed step, so the game logic never touches the DOM.
//
// Pointer lock has two paths. The fast path is the real thing: the browser
// locks the cursor and look deltas come from movementX/Y. The fallback path
// exists because modern requestPointerLock() returns a Promise that can
// reject — headless Chrome rejects it outright (WrongDocumentError), and so
// do some browsers when the call is not from a user gesture. The old code
// only wrapped the call in try/catch, which catches a synchronous throw but
// never a rejected Promise: the rejection went unhandled, no
// pointerlockchange ever fired, and the menu stayed stuck on screen. Here
// the Promise is caught, a pointerlockerror also drops into the fallback,
// and in fallback mode the player looks by dragging the mouse instead.
// Either way the game starts; lock is best effort, never a gate.
export function createInput(dom, hooks) {
  const state = {
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    firing: false,
    ads: false,
    locked: false,
    lockMode: 'none', // 'none' | 'pointer' | 'drag'
    pressed: new Set(),
  };
  let dragging = false;
  let dragX = 0;
  let dragY = 0;

  function enterDragMode() {
    if (state.lockMode === 'drag') return;
    state.lockMode = 'drag';
    state.locked = false;
    state.firing = false;
    state.ads = false;
    if (hooks && hooks.onLockUnavailable) hooks.onLockUnavailable();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    state.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (state.locked) {
      state.lookX += event.movementX || 0;
      state.lookY += event.movementY || 0;
      return;
    }
    if (!dragging) return;
    state.lookX += event.clientX - dragX;
    state.lookY += event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
  }
  function onMouseDown(event) {
    if (state.locked) {
      if (event.button === 0) state.firing = true;
      if (event.button === 2) state.ads = true;
      return;
    }
    // Fallback look only starts from a press on the game canvas itself, so
    // clicks on the menu, the buy panel or the HUD never start a drag.
    if (state.lockMode !== 'drag' || event.target !== dom) return;
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.ads = true;
  }
  function onMouseUp(event) {
    dragging = false;
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.ads = false;
  }
  function onLock() {
    state.locked = document.pointerLockElement === dom;
    if (state.locked) {
      state.lockMode = 'pointer';
      dragging = false;
    } else {
      state.firing = false;
      state.ads = false;
      if (state.lockMode === 'pointer') state.lockMode = 'none';
    }
    if (hooks && hooks.onLockChange) hooks.onLockChange(state.locked);
  }
  function onLockError() {
    enterDragMode();
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('pointerlockerror', onLockError);
  dom.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    isFallback() {
      return state.lockMode === 'drag';
    },
    requestLock() {
      if (state.lockMode === 'drag') return;
      let result;
      try {
        result = dom.requestPointerLock();
      } catch {
        enterDragMode();
        return;
      }
      // Modern browsers return a Promise; a rejection is NOT caught by the
      // try/catch above, so catch it here instead of letting it surface as
      // an unhandled rejection with no pointerlockchange to follow.
      if (result && typeof result.catch === 'function') {
        result.catch(() => enterDragMode());
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
      dragging = false;
      state.firing = false;
      state.ads = false;
    },
    // Look deltas since the last read; reading clears them.
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    // One-shot key presses since the last read; reading clears them.
    takePressed() {
      const out = state.pressed;
      state.pressed = new Set();
      return out;
    },
  };
}
