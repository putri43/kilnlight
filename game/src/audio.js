// audio.js — all sound is synthesized with WebAudio: no audio files, no
// network, nothing to download. Gunfire is filtered noise, UI is short
// oscillators, footsteps are soft thumps. Created lazily on first user
// gesture so browsers allow it; shot mode (screenshots) stays silent.
//
// THE TWIST — the rain bus: a looping rain bed (filtered noise, always on
// once the game starts) is what masks footsteps. step(masked) plays a
// footstep nearly buried under the rain when the walker is masked — that is
// the sound of the monsoon hiding you. Gunshots are never masked: they cut
// through the rain, which is why firing gives your position away on the
// hearing bus (see bots.js).
export class SoundBank {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.rain = null; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  // Looping monsoon rain on the foundry roof: brown-ish noise through a
  // lowpass, quiet enough to sit under gunfire, loud enough to bury steps.
  startRain() {
    if (!this.ctx || this.rain) return;
    try {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain(); g.gain.value = 0.14;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      this.rain = { src, gain: g };
    } catch { this.rain = null; }
  }
  _noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur);
  }
  _tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  }
  shot(kind, distant = false) {
    if (kind === 'sniper') { this._noise(0.28, 900, distant ? 0.25 : 0.9); this._tone(160, 0.18, 0.3, 'sawtooth', 50); }
    else if (kind === 'shotgun') { this._noise(0.22, 700, distant ? 0.3 : 1.0); this._tone(110, 0.15, 0.35, 'square', 45); }
    else if (kind === 'smg') this._noise(0.09, 1800, distant ? 0.2 : 0.55);
    else if (kind === 'pistol') this._noise(0.12, 1400, distant ? 0.2 : 0.65);
    else { this._noise(0.14, 1200, distant ? 0.25 : 0.75); this._tone(190, 0.08, 0.2, 'sawtooth', 70); }
  }
  dryFire() { this._tone(1200, 0.04, 0.15, 'square'); }
  reload() { this._tone(500, 0.06, 0.2, 'square'); setTimeout(() => this._tone(700, 0.06, 0.2, 'square'), 220); }
  hit(head = false) { this._tone(head ? 1900 : 1400, 0.07, 0.3, 'sine'); }
  kill() { this._tone(880, 0.09, 0.3); setTimeout(() => this._tone(1320, 0.12, 0.3), 90); }
  hurt() { this._tone(220, 0.15, 0.35, 'sawtooth', 110); }
  // masked = the monsoon is hiding this step: barely a thump under the rain.
  step(masked = true) { this._noise(0.05, 300, masked ? 0.03 : 0.12); }
  plantBeep() { this._tone(1000, 0.1, 0.3, 'square'); }
  explosion() { this._noise(1.1, 300, 1.0); this._tone(70, 0.9, 0.5, 'sine', 30); }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.3), i * 130)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 0.25), i * 130)); }
  buy() { this._tone(980, 0.08, 0.25); setTimeout(() => this._tone(1240, 0.1, 0.25), 70); }
  click() { this._tone(800, 0.05, 0.2, 'square'); }
}
