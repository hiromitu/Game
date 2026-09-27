// Web Audio で合成する効果音（音声ファイルなし）

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.5;
  }

  // ブラウザの自動再生制限のため、最初のクリック / キー入力で呼ぶ
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  get ok() {
    return this.ctx && !this.muted;
  }

  noise({ dur, type = 'bandpass', freq = 1000, freqEnd, q = 1, gain = 0.5, attack = 0.003, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq, freqEnd, dur, type = 'sine', gain = 0.3, attack = 0.005, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  swing(dash) {
    if (!this.ok) return;
    this.noise({ dur: dash ? 0.18 : 0.12, freq: 700, freqEnd: 2600, q: 0.8, gain: dash ? 0.3 : 0.18 });
  }

  hit(sound) {
    if (!this.ok) return;
    this.tone({ freq: sound === 'stone' ? 120 : sound === 'dirt' ? 110 : 170, freqEnd: 55, dur: 0.12, type: 'triangle', gain: 0.5 });
    this.noise({ dur: 0.08, type: 'lowpass', freq: sound === 'leaf' ? 3000 : 1400, gain: 0.35 });
  }

  break(sound) {
    if (!this.ok) return;
    if (sound === 'stone') {
      this.noise({ dur: 0.5, type: 'lowpass', freq: 1600, freqEnd: 200, gain: 0.7 });
      this.tone({ freq: 90, freqEnd: 40, dur: 0.3, gain: 0.45 });
      for (const d of [0.03, 0.09, 0.16]) this.noise({ dur: 0.05, freq: 1800, q: 2, gain: 0.25, delay: d });
    } else if (sound === 'dirt' || sound === 'sand') {
      this.noise({ dur: 0.28, type: 'lowpass', freq: sound === 'sand' ? 2400 : 900, freqEnd: 250, gain: 0.55 });
      this.tone({ freq: 100, freqEnd: 50, dur: 0.15, gain: 0.3 });
    } else if (sound === 'leaf') {
      this.noise({ dur: 0.3, type: 'highpass', freq: 3000, freqEnd: 1400, gain: 0.3 });
    } else {
      this.noise({ dur: 0.35, freq: 900, freqEnd: 300, q: 1.2, gain: 0.6 });
      this.tone({ freq: 120, freqEnd: 55, dur: 0.2, type: 'triangle', gain: 0.35 });
      for (const d of [0.02, 0.07, 0.13]) this.noise({ dur: 0.04, type: 'highpass', freq: 2500, gain: 0.2, delay: d });
    }
  }

  jump() {
    if (!this.ok) return;
    this.tone({ freq: 280, freqEnd: 560, dur: 0.12, type: 'square', gain: 0.06 });
  }

  land(strength) {
    if (!this.ok) return;
    this.noise({ dur: 0.09, type: 'lowpass', freq: 500, gain: 0.25 * strength });
  }

  grab() {
    if (!this.ok) return;
    this.noise({ dur: 0.05, freq: 1400, q: 1.5, gain: 0.15 });
  }

  thud(strength) {
    if (!this.ok) return;
    this.tone({ freq: 90, freqEnd: 45, dur: 0.18, gain: 0.4 * strength });
    this.noise({ dur: 0.15, type: 'lowpass', freq: 600, gain: 0.3 * strength });
  }

  splash(strength) {
    if (!this.ok) return;
    this.noise({ dur: 0.35, freq: 1200, freqEnd: 400, q: 0.7, gain: 0.25 + 0.25 * strength });
  }

  pound() {
    if (!this.ok) return;
    this.tone({ freq: 80, freqEnd: 35, dur: 0.25, gain: 0.55 });
    this.noise({ dur: 0.2, type: 'lowpass', freq: 700, gain: 0.4 });
  }

  checkpoint() {
    if (!this.ok) return;
    this.tone({ freq: 660, dur: 0.15, type: 'triangle', gain: 0.25 });
    this.tone({ freq: 990, dur: 0.3, type: 'triangle', gain: 0.25, delay: 0.1 });
  }

  fall() {
    if (!this.ok) return;
    this.tone({ freq: 700, freqEnd: 120, dur: 0.6, type: 'triangle', gain: 0.2 });
  }

  clear() {
    if (!this.ok) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: i === 3 ? 0.6 : 0.16, type: 'triangle', gain: 0.25, delay: i * 0.1 }));
  }
}
