// Web Audio engine: sample playback (with synthesized fallback while samples load), buses, mixer, reverb.

const PAN = { ride: 0.25, bell: 0.25, hhpedal: -0.2, hhclosed: -0.2, hhhalf: -0.2, kick: 0, snare: -0.05, xstick: -0.05 };
const REL = { bass: 0.05, piano: 0.14, rhodes: 0.12, guitar: 0.07 };
const GAIN = { bass: 0.9, piano: 0.42, rhodes: 0.5, guitar: 0.45 };

export class AudioEngine {
  constructor(base = 'samples/') {
    this.base = base;
    this.ctx = null;
    this.sets = {};        // inst -> [{midi, buf, off}]  or drums -> {name: [{buf, off}]}
    this.loading = {};
    this.vol = { bass: 0.8, drums: 0.7, comp: 0.6, master: 0.9 };
    this.onStatus = () => {};
  }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  async init() {
    if (this.ctx) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new C({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
    this.master.connect(comp); comp.connect(ctx.destination);
    // small room reverb
    const len = Math.floor(ctx.sampleRate * 1.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.16;
    this.verbIn.connect(this.verb); this.verb.connect(this.master);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.keysWave = ctx.createPeriodicWave(new Float32Array([0, 1, 0.42, 0.18, 0.09, 0.05]), new Float32Array(6));
    this.applyVolumes();
  }
  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  async suspend() { if (this.ctx) await this.ctx.suspend(); }

  /* ---------- sample loading ---------- */
  async manifest() {
    if (!this._manifest) this._manifest = fetch(this.base + 'manifest.json').then(r => { if (!r.ok) throw new Error('manifest'); return r.json(); });
    return this._manifest;
  }
  async decode(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url);
    const arr = await res.arrayBuffer();
    const buf = await new Promise((ok, ko) => { const p = this.ctx.decodeAudioData(arr, ok, ko); if (p && p.catch) p.catch(ko); });
    // find the onset so every sample starts exactly on time, whatever the encoder padding
    const d = buf.getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    let on = 0; const th = peak * 0.03;
    while (on < d.length && Math.abs(d[on]) < th) on++;
    return { buf, off: Math.max(0, on / buf.sampleRate - 0.002) };
  }
  /** Loads an instrument ('bass', 'piano', 'rhodes', 'guitar' or 'drums'). Resolves when ready. */
  load(inst) {
    if (this.sets[inst]) return Promise.resolve(true);
    if (this.loading[inst]) return this.loading[inst];
    this.onStatus(inst, 'loading');
    this.loading[inst] = (async () => {
      const man = await this.manifest();
      if (inst === 'drums') {
        const set = {};
        await Promise.all(Object.entries(man.drums).map(async ([name, files]) => {
          const got = await Promise.allSettled(files.map(f => this.decode(`${this.base}drums/${f}.mp3`)));
          const ok = got.filter(g => g.status === 'fulfilled').map(g => g.value);
          if (ok.length) set[name] = ok; // a missing layer falls back to its neighbours; a missing sound to the synth
        }));
        this.sets.drums = set;
      } else {
        const got = await Promise.allSettled(man[inst].map(async m => ({ midi: m, ...(await this.decode(`${this.base}${inst}/${m}.mp3`)) })));
        const list = got.filter(g => g.status === 'fulfilled').map(g => g.value);
        if (!list.length) throw new Error('no samples for ' + inst);
        this.sets[inst] = list;
      }
      this.onStatus(inst, 'ready');
      return true;
    })().catch(err => { delete this.loading[inst]; this.onStatus(inst, 'error'); console.warn('sample load failed', inst, err); return false; });
    return this.loading[inst];
  }

  /* ---------- sessions & mixer ---------- */
  newSession() {
    const ctx = this.ctx;
    this.endSession();
    const sess = ctx.createGain(); sess.connect(this.master);
    const bus = {};
    for (const k of ['bass', 'drums', 'comp']) { bus[k] = ctx.createGain(); bus[k].connect(sess); }
    bus.comp.connect(this.verbIn); bus.drums.connect(this.verbIn);
    this.sess = sess; this.bus = bus;
    this.applyVolumes();
  }
  endSession() {
    if (!this.sess) return;
    const s = this.sess;
    try { s.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); } catch (e) { /* ignore */ }
    setTimeout(() => { try { s.disconnect(); } catch (e) { /* ignore */ } }, 500);
    this.sess = null; this.bus = null;
  }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, curve = x => x * x; // perceptual-ish fader
    this.master.gain.setTargetAtTime(curve(this.vol.master) * 1.2, t, 0.02);
    if (this.bus) for (const k of ['bass', 'drums', 'comp']) this.bus[k].gain.setTargetAtTime(curve(this.vol[k]) * 1.3, t, 0.02);
  }

  /* ---------- playback ---------- */
  out(node, dest, pan) {
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(dest); }
    else node.connect(dest);
  }
  sample(s, t, rate, gain, dest, { dur = null, rel = 0.08, pan = 0, cutoff = 0 } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = s.buf; src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.003);
    let node = src;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; src.connect(f); node = f; }
    node.connect(g);
    this.out(g, dest, pan);
    const natural = (s.buf.duration - s.off) / rate;
    let end = t + natural;
    if (dur != null && dur < natural) { g.gain.setTargetAtTime(0, t + dur, rel); end = t + dur + rel * 6; }
    src.start(t, s.off);
    src.stop(Math.min(end, t + natural) + 0.01);
  }
  play(n) {
    if (!this.bus || n.t < this.ctx.currentTime - 0.05) return;
    if (n.kind === 'drum') return this.drum(n.name, n.t, n.v);
    if (n.kind === 'bass') return this.melodic('bass', n.midi, n.t, n.dur, n.v, this.bus.bass);
    if (n.kind === 'chord') {
      const k = 1 / Math.sqrt(n.midis.length);
      n.midis.forEach((m, i) => this.melodic(n.inst, m, n.t + i * (n.roll || 0), n.dur, n.v * k * 1.6, this.bus.comp));
    }
  }
  melodic(inst, midi, t, dur, v, dest) {
    const set = this.sets[inst];
    if (!set) return this.synth(inst, midi, t, dur, v, dest);
    let s = set[0];
    for (const x of set) if (Math.abs(x.midi - midi) < Math.abs(s.midi - midi)) s = x;
    const rate = Math.pow(2, (midi - s.midi) / 12);
    const gain = Math.pow(Math.max(0.05, v), 1.4) * GAIN[inst];
    const cutoff = inst === 'piano' || inst === 'rhodes' ? 1600 + v * 7000 : inst === 'bass' ? 900 + v * 1800 : 0;
    this.sample(s, t, rate, gain, dest, { dur, rel: REL[inst], pan: inst === 'bass' ? 0 : 0.12, cutoff });
  }
  drum(name, t, v) {
    const set = this.sets.drums && this.sets.drums[name];
    if (!set) return this.synthDrum(name, t, v);
    const layers = set.length;
    let idx;
    if (name === 'ride') idx = (v < 0.45 ? 0 : v < 0.72 ? 1 : 2) * 2 + (Math.random() < 0.5 ? 0 : 1);
    else if (name === 'hhpedal' || name === 'hhclosed') idx = (v < 0.6 ? 0 : 1) * 2 + (Math.random() < 0.5 ? 0 : 1);
    else idx = Math.min(layers - 1, Math.floor(v * layers));
    const s = set[Math.min(idx, layers - 1)];
    this.sample(s, t, 1, 0.35 + 0.75 * v, this.bus.drums, { pan: PAN[name] || 0 });
  }
  click(t, accent) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(this.sess || this.master); o.start(t); o.stop(t + 0.08);
  }

  /* ---------- synthesized fallback (used until samples arrive, or if they fail) ---------- */
  env(g, t, peak, a, decay) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay); }
  synth(inst, midi, t, dur, v, dest) {
    const ctx = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12), o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    if (inst === 'bass') { o.type = 'triangle'; lp.frequency.value = f * 4; }
    else { o.setPeriodicWave(this.keysWave); lp.frequency.value = 2600; }
    o.frequency.value = f;
    const peak = (inst === 'bass' ? 0.5 : 0.07) * v;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.006); g.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.4);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    o.connect(lp); lp.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.4);
  }
  synthDrum(name, t, v) {
    const ctx = this.ctx, dest = this.bus.drums;
    const noise = (hp, bp, peak, decay) => {
      const s = ctx.createBufferSource(); s.buffer = this.noise; let node = s;
      if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
      if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; node.connect(f); node = f; }
      const g = ctx.createGain(); this.env(g, t, peak, 0.002, decay); node.connect(g); g.connect(dest);
      s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.05);
    };
    if (name === 'ride' || name === 'bell') noise(5200, 0, 0.14 * v, 0.4);
    else if (name.startsWith('hh')) noise(7500, 0, 0.2 * v, 0.05);
    else if (name === 'snare') noise(0, 1900, 0.4 * v, 0.15);
    else if (name === 'xstick') noise(0, 2600, 0.5 * v, 0.035);
    else if (name === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this.env(g, t, 0.9 * v, 0.003, 0.28); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.35);
    }
  }
}
