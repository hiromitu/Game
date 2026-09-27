// キーボード・マウス入力。押しっぱなし（held）と、押した瞬間（hit）を分けて持つ。
// プレイ中はマウスをポインターロックして、動かした量（lookX / lookY）で向きを変える。

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump',
  KeyJ: 'punch',
  KeyR: 'restart',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  KeyH: 'help',
  Enter: 'confirm', NumpadEnter: 'confirm',
};

// マウスボタン → 操作（左：パンチ / 右：ジャンプ）
const MOUSEMAP = { 0: 'punch', 2: 'jump' };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.wheel = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.onLockChange = null; // (locked) => void

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.down.delete(a);
    });
    window.addEventListener('blur', () => this.down.clear());

    // ロック中はマウスイベントが canvas 以外にも来るので document で受ける
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const a = MOUSEMAP[e.button];
      if (!a) return;
      e.preventDefault();
      this.pressed.add(a);
      this.down.add('mouse-' + a);
    });
    document.addEventListener('mouseup', (e) => {
      const a = MOUSEMAP[e.button];
      if (a) this.down.delete('mouse-' + a);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) { this.down.delete('mouse-punch'); this.down.delete('mouse-jump'); }
      this.onLockChange?.(this.locked);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += e.deltaY;
    }, { passive: false });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  // ブラウザによっては連続で要求すると断られるので、失敗しても例外にしない
  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* 取れなければクリックで取り直す */ }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  held(a) { return this.down.has(a) || this.down.has('mouse-' + a); }
  hit(a) { return this.pressed.has(a); }
  get x() { return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0); }
  get y() { return (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0); }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
    this.lookX = 0;
    this.lookY = 0;
  }
}
