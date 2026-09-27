// キーボード・マウス入力。押しっぱなし（held）と、押した瞬間（hit）を分けて持つ

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'jump',
  KeyJ: 'punch', KeyK: 'punch',
  KeyQ: 'camLeft', KeyE: 'camRight',
  KeyR: 'restart',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  KeyH: 'help',
  Enter: 'confirm', NumpadEnter: 'confirm',
};

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.wheel = 0;

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
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.pressed.add('punch');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += e.deltaY;
    }, { passive: false });
  }

  held(a) { return this.down.has(a); }
  hit(a) { return this.pressed.has(a); }
  get x() { return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0); }
  get y() { return (this.held('up') ? 1 : 0) - (this.held('down') ? 1 : 0); }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
  }
}
