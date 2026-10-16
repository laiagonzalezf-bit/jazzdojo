// Accompaniment generator: turns one beat of the sequencer into note events for bass, drums and harmony.
// Pure apart from the injectable RNG; the audio engine plays what it returns.
import { degreeInterval } from './theory.js';

export const STYLES = ['swing', 'bossa', 'even', 'ballad'];
export const HARMONY = ['piano', 'rhodes', 'guitar'];
const BASS_LO = 28, BASS_HI = 50;

export function swingRatio(style, tempo) {
  if (style !== 'swing' && style !== 'ballad') return 0.5;
  return Math.max(0.55, Math.min(0.68, 0.68 - (tempo - 90) * 0.0008));
}

export class Groove {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.reset();
  }
  reset() {
    this.lastBass = 36;
    this.lastVoicing = null;
    this.line = null;
    this.voice = null;
    this.compPlan = [];
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }
  hum(ms) { return (this.rng() - 0.5) * 2 * ms / 1000; }

  /** Nearest MIDI note with pitch class `pc` to `near`, inside [lo, hi]. */
  nearest(pc, near, lo = BASS_LO, hi = BASS_HI) {
    let best = null, bd = 1e9;
    for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === ((pc % 12) + 12) % 12) {
      const d = Math.abs(m - near);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /** Walking line for a whole chord: root on beat 1, chord/scale tones in between, approach note into the next chord. */
  walk(ch, n, nextCh) {
    const rootPc = ch.bass ?? ch.root;
    const root = this.nearest(rootPc, Math.min(Math.max(this.lastBass, 31), 45), 28, 47);
    const pcs = [0, ch.iv[3], ch.iv[5], ch.iv[7], ch.iv[9]].map(i => (ch.root + i) % 12);
    const cands = [];
    for (let m = BASS_LO; m <= BASS_HI; m++) if (pcs.includes(m % 12)) cands.push(m);
    const nextPc = nextCh ? (nextCh.bass ?? nextCh.root) : rootPc;
    const out = [root];
    if (n === 1) { this.lastBass = root; return out; }
    // segments of up to 4 beats; each segment heads for the next segment's first note
    const segs = [];
    for (let s = 0; s < n; s += 4) segs.push([s, Math.min(4, n - s)]);
    let cur = root;
    segs.forEach(([s, len], si) => {
      if (si > 0) {
        const opts = [ch.iv[5], 0, ch.iv[3]].map(i => this.nearest((ch.root + i) % 12, cur, 28, 47));
        cur = this.pick(opts.filter(m => m !== cur)) ?? opts[0];
        out.push(cur);
      }
      const last = si === segs.length - 1;
      const targetPc = last ? nextPc : (ch.root + ch.iv[5]) % 12;
      const target = this.nearest(targetPc, cur + (this.rng() < 0.5 ? 3 : -3), 28, 47);
      const r = this.rng();
      let appr = r < 0.45 ? target - 1 : r < 0.8 ? target + 1 : (target + 7 <= BASS_HI ? target + 7 : target - 5);
      if (appr < BASS_LO) appr = target + 1;
      if (appr > BASS_HI) appr = target - 1;
      const mids = len - 2;
      let prev = cur;
      for (let j = 0; j < mids; j++) {
        const want = cur + (appr - cur) * (j + 1) / (mids + 1) + this.r(-2, 2);
        const c = cands.filter(m => m !== prev && Math.abs(m - prev) <= 7).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
        prev = c[0] ?? prev;
        out.push(prev);
      }
      if (len >= 2) out.push(appr);
      cur = target;
    });
    this.lastBass = out[out.length - 1];
    return out.slice(0, n);
  }

  /** Close rootless voicing with smooth voice leading. */
  voicing(ch, lo, hi, maxNotes = 4) {
    const pcs = ch.tones.slice(0, maxNotes).map(i => (ch.root + i) % 12);
    const target = this.lastVoicing ? this.lastVoicing.reduce((a, b) => a + b, 0) / this.lastVoicing.length : (lo + hi) / 2;
    let best = null, bestScore = 1e9;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      for (let base = lo; base < lo + 12; base++) {
        if (base % 12 !== order[0]) continue;
        const notes = [base];
        for (let k = 1; k < order.length; k++) { let m = notes[k - 1] + 1; while (m % 12 !== order[k]) m++; notes.push(m); }
        if (notes[notes.length - 1] > hi) continue;
        const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
        const score = Math.abs(avg - target) + Math.abs(avg - (lo + hi) / 2) * 0.25;
        if (score < bestScore) { bestScore = score; best = notes; }
      }
    }
    this.lastVoicing = best || [lo + 10, lo + 14, lo + 17];
    return this.lastVoicing;
  }

  /**
   * @param info  one beat from Sequencer.step()
   * @param o     { style, meter:{num,den}, harmony:'piano'|'rhodes'|'guitar', tempo }
   * @returns note events: {kind:'drum', name, t, v} | {kind:'bass', midi, t, dur, v} | {kind:'chord', inst, midis, t, dur, v, roll}
   */
  beat(info, o) {
    const out = [];
    const { t, spb, ev, bi } = info;
    const ch = ev.chord;
    const style = o.style, num = o.meter.num, compound = o.meter.den === 8 && num % 3 === 0;
    const sw = compound ? 0.5 : swingRatio(style, o.tempo);
    const off = t + sw * spb;
    const b = info.bib;
    const lastBeatOfPhrase = b === num - 1 && info.barNo % 4 === 0;
    const D = (name, tt, v) => out.push({ kind: 'drum', name, t: tt + this.hum(5), v: Math.max(0.05, Math.min(1, v * this.r(0.88, 1.08))) });
    const B = (midi, tt, dur, v) => out.push({ kind: 'bass', midi, t: tt + this.hum(4), dur, v: v * this.r(0.9, 1.05) });

    /* ---------- drums ---------- */
    if (compound) {
      const g = b % 3 === 0;
      D(style === 'even' ? 'hhclosed' : 'ride', t, g ? 0.75 : 0.45);
      if (b === 0) D('kick', t, 0.6);
      if (b === 3 || b === 9) D(style === 'swing' || style === 'ballad' ? 'hhpedal' : 'xstick', t, 0.7);
    } else if (style === 'swing') {
      const back = b % 2 === 1;
      D('ride', t, (b === 0 ? 0.62 : back ? 0.78 : 0.66));
      if (back) D('ride', off, 0.42);
      if (back) D('hhpedal', t, 0.75);
      if (this.rng() < 0.55) D('kick', t, 0.18);
      if (this.rng() < 0.16) D('snare', off, 0.2);
      else if (this.rng() < 0.06) D('snare', t, 0.45);
      if (lastBeatOfPhrase && this.rng() < 0.7) { D('snare', t, 0.5); D('snare', t + spb / 3, 0.3); D('snare', off, 0.6); if (this.rng() < 0.4) D('kick', off, 0.6); }
      if (b === 0 && info.barNo % 8 === 1 && info.barNo > 1) D('kick', t, 0.55);
    } else if (style === 'ballad') {
      D('ride', t, b === 0 ? 0.42 : 0.34);
      if (b % 2 === 1) { D('hhpedal', t, 0.6); if (this.rng() < 0.5) D('ride', off, 0.25); }
      if (b === 0) D('kick', t, 0.3);
      if (b === 2 && this.rng() < 0.3) D('xstick', t, 0.35);
    } else if (style === 'bossa') {
      D('hhclosed', t, b === 0 ? 0.55 : 0.45); D('hhclosed', off, 0.3);
      if (b % 2 === 0) { D('kick', t, 0.62); D('kick', t + 1.5 * spb, 0.35); }
      const e = (((info.barNo - 1) % 2) * num + b) * 2 % 16;
      const clave = [0, 3, 6, 10, 12];
      if (clave.includes(e)) D('xstick', t, 0.7);
      if (clave.includes(e + 1)) D('xstick', off, 0.7);
    } else {
      D('hhclosed', t, 0.6); D('hhclosed', off, 0.38);
      if (b % 2 === 0) D('kick', t, 0.85); else D('snare', t, 0.8);
      if (b === num - 2 && this.rng() < 0.45) D('kick', off, 0.6);
      if (lastBeatOfPhrase) { D('snare', off, 0.55); D('snare', t + 0.75 * spb, 0.4); }
    }

    if (!ch) return out;

    /* ---------- bass ---------- */
    if (info.chordStart) this.line = this.walk(ch, ev.beats, info.nextEv && info.nextEv.chord);
    const line = this.line || [this.nearest(ch.root, 36)];
    const root = line[0];
    const fifth = this.nearest((ch.root + ch.iv[5]) % 12, root + 5, 28, 47);
    if (compound) {
      if (b % 3 === 0) B(b % 6 === 0 ? root : fifth, t, spb * 2.8, 0.9);
    } else if (style === 'swing') {
      B(line[Math.min(bi, line.length - 1)], t, spb * 0.88, bi === 0 ? 1 : 0.85);
    } else if (style === 'ballad') {
      if (bi === 0) B(root, t, spb * Math.min(ev.beats, 2) * 0.95, 0.9);
      else if (bi % 2 === 0) B(line[Math.min(bi, line.length - 1)], t, spb * 1.9, 0.75);
    } else if (style === 'bossa') {
      const ab = b % 2;
      if (ab === 0) { B(b % 4 === 0 || bi === 0 ? root : fifth, t, spb * 1.4, 0.95); }
      else B(b % 4 === 1 ? fifth : root, t + spb * 0.5, spb * 0.45, 0.6);
    } else {
      const n = b % 4 === 2 ? fifth : root;
      B(n, t, spb * 0.45, b % 2 === 0 ? 1 : 0.75);
      B(n, t + spb * 0.5, spb * 0.4, 0.6);
    }

    /* ---------- harmony ---------- */
    const inst = o.harmony || 'piano';
    if (info.chordStart) {
      this.voice = inst === 'guitar' ? this.voicing(ch, 52, 72, 3) : this.voicing(ch, 50, 76, 4);
      this.compPlan = [];
    }
    const v = this.voice;
    const chordEnd = t + (ev.beats - bi) * spb; // never ring past the chord
    const C = (tt, durBeats, vel, roll = 0, midis = v) => {
      tt += this.hum(6);
      out.push({ kind: 'chord', inst, midis, t: tt, dur: Math.max(0.05, Math.min(durBeats * spb, chordEnd - tt + 0.03)), v: vel * this.r(0.9, 1.08), roll });
    };
    // swing piano/rhodes: a comping figure chosen per bar, relative to the chord
    const planBar = () => {
      const left = Math.min(num, ev.beats - bi);
      const opts = left >= 4 ? [[0, 1.5], [1.5], [0, 2.5], [0.5, 2], [1.5, 3], [0], [2.5], [0, 2]]
        : left === 3 ? [[0], [0, 1.5], [1.5], [0.5, 2]]
          : left === 2 ? [[0], [0.5], [0, 1.5]] : [[0]];
      let p = this.pick(opts);
      if (bi === 0 && !p.some(x => x < 1) && this.rng() < 0.6) p = [0, ...p];
      this.compPlan = p.map(x => x + bi);
    };
    if (compound) {
      if (b === 0) C(t, Math.min(ev.beats, num) * 0.9, 0.7, inst === 'guitar' ? 0.012 : 0);
      else if (b % 3 === 0 && this.rng() < 0.4) C(t, 2.5, 0.5);
    } else if (style === 'swing') {
      if (inst === 'guitar') {
        C(t, 0.5, b % 2 === 1 ? 0.6 : 0.5, 0.01);
      } else {
        if (bi === 0 || b === 0) planBar();
        for (const pos of this.compPlan) {
          if (Math.floor(pos) !== bi) continue;
          const frac = pos - bi;
          const tt = frac === 0 ? t : off;
          const nextHit = this.compPlan.find(x => x > pos);
          const dur = nextHit !== undefined && nextHit - pos < 1.2 ? 0.45 : this.pick([0.5, 1, 1.5]);
          C(tt, inst === 'rhodes' ? dur * 1.4 : dur, (pos === 0 ? 0.8 : 0.68) * (inst === 'rhodes' ? 0.85 : 1));
        }
      }
    } else if (style === 'ballad') {
      if (inst === 'guitar') {
        // gentle arpeggio through the voicing in eighths
        const notes = v.concat(v.slice(1, -1).reverse());
        for (let h = 0; h < 2; h++) {
          const m = notes[(bi * 2 + h) % notes.length];
          C(h ? off : t, 1.5, 0.5, 0, [m]);
        }
      } else if (bi === 0) C(t, Math.min(ev.beats, num) * 0.98, 0.65, 0.03);
      else if (bi === 2 && ev.beats >= 4 && this.rng() < 0.35) C(off, 1.5, 0.4);
    } else if (style === 'bossa') {
      const e = (((info.barNo - 1) % 2) * num + b) * 2 % 16;
      const pat = [0, 3, 6, 10, 13];
      const roll = inst === 'guitar' ? 0.012 : 0;
      let hit = false;
      if (pat.includes(e)) { C(t, 0.9, 0.62, roll); hit = true; }
      if (pat.includes(e + 1)) { C(off, 0.9, 0.58, roll); hit = true; }
      if (bi === 0 && !hit) C(t, 0.9, 0.6, roll);
    } else {
      if (inst === 'guitar') C(off, 0.25, 0.55, 0.008);
      else {
        if (bi === 0) C(t, Math.min(ev.beats, num) * 0.9, 0.5);
        if (b % 2 === 1) C(off, 0.3, 0.55);
      }
    }
    return out;
  }
}

/** Arpeggio degrees → note names, for the help view. */
export function arpNoteNames(chord, arp, opts, noteName) {
  if (!chord) return '';
  return arp.map(d => noteName(chord.root + degreeInterval(chord, d, opts), chord.flat)).join(' ');
}
