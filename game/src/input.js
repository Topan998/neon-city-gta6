// Keyboard, mouse and pointer lock in one small object. Held keys answer every frame; presses that
// must happen once (start, pause, enter a car, fire, save, the weather) are queued as flags the loop
// takes, so a press between two frames is never lost and never counted twice. A screenshot scene
// turns the real listeners off with `goSimulated` and steers through `setKey`/`press`/`fire` instead.

export const ACTION_START = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_CAR = 4;
export const ACTION_SAVE_QUIT = 8;
export const ACTION_RESTART = 16;
export const ACTION_TOGGLE_RAIN = 32;

const PREVENT = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let clickActions = 0;
  let lookX = 0;
  let lookY = 0;
  let simulated = false;
  let locked = false;

  window.addEventListener('keydown', (event) => {
    if (PREVENT.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    held.add(event.code);
    if (event.code === 'Enter' || event.code === 'Space') actions |= ACTION_START;
    if (event.code === 'Escape' || event.code === 'KeyP') actions |= ACTION_PAUSE;
    if (event.code === 'KeyF') actions |= ACTION_ENTER_CAR;
    if (event.code === 'KeyQ') actions |= ACTION_SAVE_QUIT;
    if (event.code === 'KeyR') actions |= ACTION_RESTART;
    if (event.code === 'KeyT') actions |= ACTION_TOGGLE_RAIN;
  });
  window.addEventListener('keyup', (event) => { held.delete(event.code); });
  // A key released while the tab is hidden never sends keyup: drop every key on blur.
  window.addEventListener('blur', () => { held.clear(); });

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    clickActions |= 1;
    if (!locked && !simulated) canvas.requestPointerLock?.();
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });

  return {
    get locked() { return locked; },
    /** +1 forward, -1 back. */
    forward() {
      const up = held.has('KeyW') || held.has('ArrowUp') ? 1 : 0;
      const down = held.has('KeyS') || held.has('ArrowDown') ? 1 : 0;
      return up - down;
    },
    /** +1 right, -1 left. */
    strafe() {
      const right = held.has('KeyD') || held.has('ArrowRight') ? 1 : 0;
      const left = held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0;
      return right - left;
    },
    sprint() { return held.has('ShiftLeft') || held.has('ShiftRight'); },
    /** The queued one-shot presses as ACTION_* flags, cleared by the read. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Whether the fire button was pressed since the last read. */
    takeFire() {
      const taken = clickActions;
      clickActions = 0;
      return taken !== 0;
    },
    /** Mouse movement since the last read, in pixels. */
    takeLook() {
      const taken = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return taken;
    },
    requestLock() { if (!simulated) canvas.requestPointerLock?.(); },
    /** Turn the real listeners off and let a scene inject its own state: the screenshot path. */
    goSimulated() {
      simulated = true;
      held.clear();
      actions = 0;
      clickActions = 0;
      lookX = 0;
      lookY = 0;
      document.exitPointerLock?.();
    },
    setKey(code, down) {
      if (down) held.add(code);
      else held.delete(code);
    },
    press(action) { actions |= action; },
    look(dx, dy) { lookX += dx; lookY += dy; },
    fire() { clickActions |= 1; },
    clear() { held.clear(); actions = 0; clickActions = 0; lookX = 0; lookY = 0; },
  };
}
